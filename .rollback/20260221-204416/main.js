'use strict';

const path = require('path');
const {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  ItemView,
  TFile,
  normalizePath,
  requestUrl,
  parseYaml,
  stringifyYaml,
} = require('obsidian');

const VIEW_TYPE_VINYL_COLLECTION = 'vinyl-catalog-view';

const DEFAULT_SETTINGS = {
  collectionFolder: 'Vinyl',
  artistsFolder: 'Vinyl/Artists',
  coversFolder: 'Vinyl/covers',
};

function toText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return toText(value[0]);
  return String(value).trim();
}

function toPrice(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeName(value) {
  return toText(value).replace(/[\\/:*?"<>|]/g, '').trim();
}

function translitRu(value) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    А: 'a', Б: 'b', В: 'v', Г: 'g', Д: 'd', Е: 'e', Ё: 'e', Ж: 'zh', З: 'z', И: 'i', Й: 'y', К: 'k', Л: 'l', М: 'm',
    Н: 'n', О: 'o', П: 'p', Р: 'r', С: 's', Т: 't', У: 'u', Ф: 'f', Х: 'h', Ц: 'ts', Ч: 'ch', Ш: 'sh', Щ: 'sch',
    Ъ: '', Ы: 'y', Ь: '', Э: 'e', Ю: 'yu', Я: 'ya',
  };
  return [...value].map((ch) => map[ch] ?? ch).join('');
}

function slugify(value) {
  return translitRu(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'cover';
}

function extFromUrl(url) {
  try {
    const match = new URL(url).pathname.toLowerCase().match(/\.(jpg|jpeg|png|webp|svg)$/);
    if (!match) return '';
    return match[1] === 'jpeg' ? 'jpg' : match[1];
  } catch {
    return '';
  }
}

function extFromContentType(contentType) {
  const raw = toText(contentType).toLowerCase();
  if (raw.includes('svg')) return 'svg';
  if (raw.includes('png')) return 'png';
  if (raw.includes('webp')) return 'webp';
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'jpg';
  return '';
}

function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  return {
    frontmatterRaw: match[1],
    body: content.slice(match[0].length),
  };
}

function unwrapCoverValue(raw) {
  if (raw == null) return '';
  if (Array.isArray(raw)) return unwrapCoverValue(raw[0]);
  if (typeof raw === 'object') {
    if (raw.path) return `[[${raw.path}]]`;
    if (raw.url) return raw.url;
    if (raw.value) return raw.value;
  }
  return toText(raw);
}

function normalizeCoverLinkTarget(raw) {
  let cover = toText(raw);
  if (!cover) return '';

  const markdownImage = cover.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (markdownImage?.[1]) cover = markdownImage[1].trim();

  const wiki = cover.match(/^\[\[([^\]]+)\]\]$/);
  if (wiki?.[1]) cover = wiki[1].trim();

  if (cover.includes('|') && !/^(https?:|data:|file:|app:)/i.test(cover)) {
    cover = cover.split('|')[0].trim();
  }

  return cover;
}

function escapeDoubleQuoted(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeLookupValue(value) {
  return toText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function makeArtistTitleLookupKey(artist, title) {
  return `${normalizeLookupValue(artist)}::${normalizeLookupValue(title)}`;
}

function parseCsvToObjects(text) {
  const input = String(text || '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        const next = input[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') continue;

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((header, index) => {
    const cleaned = String(header || '').replace(/^\uFEFF/, '').trim();
    return cleaned || `column_${index + 1}`;
  });

  return rows
    .slice(1)
    .filter((csvRow) => csvRow.some((value) => toText(value) !== ''))
    .map((csvRow) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = csvRow[index] ?? '';
      });
      return item;
    });
}

function mapDiscogsCsvRow(row) {
  const artist = toText(row.Artist);
  const title = toText(row.Title);
  if (!artist || !title) return null;

  const releaseId = toText(row.release_id);
  const mapped = {
    artist,
    title,
    year: toText(row.Released),
    releaseId,
    catalogNumber: toText(row['Catalog#']),
    label: toText(row.Label),
    format: toText(row.Format),
    rating: toText(row.Rating),
    dateAdded: toText(row['Date Added']),
    mediaCondition: toText(row['Collection Media Condition']),
    sleeveCondition: toText(row['Collection Sleeve Condition']),
    notes: toText(row['Collection Notes']),
  };

  return mapped;
}

function escapeCsvCell(value) {
  return `"${toText(value).replace(/"/g, '""')}"`;
}

function downloadTextFile(content, filename, mimeType, addBom = false) {
  const payload = addBom ? `\ufeff${content}` : content;
  const blob = new Blob([payload], { type: mimeType });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Не удалось сформировать файл изображения'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = toText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (words.length > 0 && lines.length === maxLines) {
    let tail = lines[maxLines - 1];
    while (tail && ctx.measureText(`${tail}...`).width > maxWidth) {
      tail = tail.slice(0, -1);
    }
    lines[maxLines - 1] = `${tail}...`;
  }

  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });

  return y + lines.length * lineHeight;
}

function loadImageSafe(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    const img = new Image();
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function exportTimestamp() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

class AddVinylModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.form = {
      artist: '',
      title: '',
      year: '',
      price: '',
      coverUrl: '',
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vinyl-modal');

    contentEl.createEl('h2', { text: 'Добавить пластинку' });

    new Setting(contentEl)
      .setName('Артист *')
      .addText((text) => {
        text.setPlaceholder('Например: Linkin Park');
        text.onChange((value) => {
          this.form.artist = value;
        });
        setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .setName('Название *')
      .addText((text) => {
        text.setPlaceholder('Например: Meteora');
        text.onChange((value) => {
          this.form.title = value;
        });
      });

    new Setting(contentEl)
      .setName('Год')
      .addText((text) => {
        text.setPlaceholder('Например: 2003');
        text.onChange((value) => {
          this.form.year = value;
        });
      });

    new Setting(contentEl)
      .setName('Цена')
      .addText((text) => {
        text.setPlaceholder('Например: 3990');
        text.onChange((value) => {
          this.form.price = value;
        });
      });

    new Setting(contentEl)
      .setName('URL обложки')
      .setDesc('jpg, png, webp или svg')
      .addText((text) => {
        text.setPlaceholder('https://...');
        text.onChange((value) => {
          this.form.coverUrl = value;
        });
      });

    this.errorEl = contentEl.createDiv({ cls: 'vinyl-modal-error' });

    const actions = contentEl.createDiv({ cls: 'vinyl-modal-actions' });

    const cancelBtn = actions.createEl('button', { text: 'Отмена' });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());

    this.submitBtn = actions.createEl('button', { text: 'Создать' });
    this.submitBtn.addClass('mod-cta');
    this.submitBtn.addEventListener('click', async () => {
      await this.handleSubmit();
    });
  }

  onClose() {
    this.contentEl.empty();
  }

  async handleSubmit() {
    const artist = sanitizeName(this.form.artist);
    const title = sanitizeName(this.form.title);

    if (!artist || !title) {
      this.setError('Поля «Артист» и «Название» обязательны.');
      return;
    }

    this.setError('');
    this.submitBtn.disabled = true;
    const originalText = this.submitBtn.textContent;
    this.submitBtn.textContent = 'Создаю...';

    try {
      const file = await this.plugin.createVinylRecord({
        artist,
        title,
        year: toText(this.form.year),
        price: this.form.price,
        coverUrl: toText(this.form.coverUrl),
      });
      await this.plugin.openRecord(file);
      await this.plugin.refreshOpenViews();
      new Notice('Карточка пластинки создана');
      this.close();
    } catch (error) {
      console.error(error);
      this.setError(`Ошибка: ${error?.message ?? 'не удалось создать карточку'}`);
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.textContent = originalText;
    }
  }

  setError(message) {
    if (!this.errorEl) return;
    this.errorEl.setText(message || '');
    this.errorEl.style.display = message ? 'block' : 'none';
  }
}

class VinylCollectionView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = 'table';
    this.sortKey = 'artist';
    this.sortDir = 'asc';
    this.search = '';
    this.rows = [];
  }

  getViewType() {
    return VIEW_TYPE_VINYL_COLLECTION;
  }

  getDisplayText() {
    return 'Vinyl Collection';
  }

  getIcon() {
    return 'disc';
  }

  async onOpen() {
    this.renderShell();
    await this.refreshData();
  }

  async onClose() {
    this.contentEl.empty();
  }

  async refreshData() {
    this.rows = await this.plugin.loadVinylRows();
    this.renderContent();
  }

  renderShell() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vinyl-view');

    const top = contentEl.createDiv({ cls: 'vinyl-top' });

    const titleWrap = top.createDiv({ cls: 'vinyl-title-wrap' });
    titleWrap.createEl('h2', { text: 'Коллекция винила' });
    titleWrap.createEl('div', {
      cls: 'vinyl-subtitle',
      text: this.plugin.settings.artistsFolder,
    });

    const headerActions = top.createDiv({ cls: 'vinyl-header-actions' });
    this.addBtn = headerActions.createEl('button', { text: '+', cls: 'vinyl-add-btn' });
    this.addBtn.setAttribute('aria-label', 'Добавить пластинку');
    this.addBtn.title = 'Добавить пластинку';

    const toolbar = contentEl.createDiv({ cls: 'vinyl-toolbar' });

    this.searchInput = toolbar.createEl('input', {
      cls: 'vinyl-search',
      attr: {
        type: 'search',
        placeholder: 'Поиск: артист, название, год',
      },
    });
    this.searchInput.addEventListener('input', () => {
      this.search = toText(this.searchInput.value).toLowerCase();
      this.renderContent();
    });

    const groups = toolbar.createDiv({ cls: 'vinyl-toolbar-groups' });

    const modeGroup = groups.createDiv({ cls: 'vinyl-segment-group' });
    this.tableModeBtn = modeGroup.createEl('button', { text: 'Таблица' });
    this.cardsModeBtn = modeGroup.createEl('button', { text: 'Карточки' });

    groups.createDiv({ cls: 'vinyl-toolbar-divider' });

    const exportGroup = groups.createDiv({ cls: 'vinyl-export-group' });
    this.importDiscogsBtn = exportGroup.createEl('button', { text: 'Импорт Discogs' });
    this.exportBtn = exportGroup.createEl('button', { text: 'Экспорт' });
    this.imageExportBtn = exportGroup.createEl('button', { text: 'Карточки PNG/JPG' });

    this.tableModeBtn.addEventListener('click', () => {
      this.mode = 'table';
      this.renderContent();
    });

    this.cardsModeBtn.addEventListener('click', () => {
      this.mode = 'cards';
      this.renderContent();
    });

    this.addBtn.addEventListener('click', () => {
      this.plugin.openAddModal();
    });

    this.importDiscogsBtn.addEventListener('click', () => {
      this.showDiscogsImportDialog();
    });

    this.exportBtn.addEventListener('click', () => {
      this.showExportDialog();
    });

    this.imageExportBtn.addEventListener('click', () => {
      this.showCardImageExportDialog();
    });

    this.summaryEl = contentEl.createDiv({ cls: 'vinyl-summary' });
    this.bodyEl = contentEl.createDiv({ cls: 'vinyl-body' });
  }

  renderContent() {
    this.bodyEl.empty();

    const rows = this.getRenderedRows();
    this.renderSummary(rows);
    this.syncModeButtons();

    if (this.mode === 'cards') {
      this.renderCards(rows);
      return;
    }

    this.renderTable(rows);
  }

  renderSummary(rows) {
    const totalPrice = rows.reduce((sum, row) => sum + (row.price || 0), 0);
    this.summaryEl.empty();
    this.summaryEl.createDiv({ cls: 'vinyl-kpi', text: `Всего: ${rows.length}` });
    this.summaryEl.createDiv({ cls: 'vinyl-kpi', text: `Сумма: ${Math.round(totalPrice)} ₽` });
  }

  syncModeButtons() {
    this.tableModeBtn.toggleClass('is-active', this.mode === 'table');
    this.cardsModeBtn.toggleClass('is-active', this.mode === 'cards');
  }

  getRenderedRows() {
    let rows = [...this.rows];
    if (this.search) {
      rows = rows.filter((row) => {
        const haystack = [row.artist, row.title, row.year || ''].join(' ').toLowerCase();
        return haystack.includes(this.search);
      });
    }

    rows.sort((a, b) => {
      const aValue = this.sortValueFor(a, this.sortKey);
      const bValue = this.sortValueFor(b, this.sortKey);

      let cmp = 0;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        cmp = aValue - bValue;
      } else {
        cmp = String(aValue).localeCompare(String(bValue), 'ru', {
          numeric: true,
          sensitivity: 'base',
        });
      }

      return this.sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }

  sortValueFor(row, key) {
    if (key === 'year') {
      const yearNum = Number(row.year);
      return Number.isFinite(yearNum) ? yearNum : Number.NEGATIVE_INFINITY;
    }
    if (key === 'price') return row.price || 0;
    if (key === 'added') return row.added || 0;
    if (key === 'artist') return row.artist || '';
    if (key === 'title') return row.title || '';
    return '';
  }

  makeSortHeader(label, key) {
    const th = document.createElement('th');
    th.className = 'sortable';
    const arrow = this.sortKey === key ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    th.textContent = `${label}${arrow}`;
    th.addEventListener('click', () => {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortKey = key;
        this.sortDir = key === 'added' ? 'desc' : 'asc';
      }
      this.renderContent();
    });
    return th;
  }

  renderTable(rows) {
    const tableWrap = this.bodyEl.createDiv({ cls: 'vinyl-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'vinyl-table' });

    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    headRow.appendChild(this.makeSortHeader('Артист', 'artist'));
    headRow.appendChild(this.makeSortHeader('Название', 'title'));
    headRow.appendChild(this.makeSortHeader('Год', 'year'));
    headRow.appendChild(this.makeSortHeader('Цена', 'price'));
    headRow.appendChild(this.makeSortHeader('Добавлено', 'added'));

    const actionsHead = document.createElement('th');
    actionsHead.textContent = '';
    headRow.appendChild(actionsHead);

    const tbody = table.createEl('tbody');

    for (const row of rows) {
      const tr = tbody.createEl('tr');

      tr.createEl('td', { text: row.artist || '—' });

      const tdTitle = tr.createEl('td');
      const openBtn = tdTitle.createEl('button', {
        text: row.title || row.file.basename,
        cls: 'vinyl-link-btn',
      });
      openBtn.addEventListener('click', async () => {
        await this.plugin.openRecord(row.file);
      });

      tr.createEl('td', { text: row.year || '—' });
      tr.createEl('td', { text: row.price ? `${row.price} ₽` : '—' });
      tr.createEl('td', { text: row.addedText });

      const tdAction = tr.createEl('td', { cls: 'vinyl-actions' });
      const hideBtn = tdAction.createEl('button', { text: 'Скрыть', cls: 'vinyl-danger-btn' });
      hideBtn.addEventListener('click', async () => {
        const ok = window.confirm(`Скрыть «${row.title}» из коллекции?`);
        if (!ok) return;
        await this.plugin.setHiddenFlag(row.file, true);
        new Notice('Запись скрыта');
        await this.refreshData();
      });
    }

    if (rows.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: 'vinyl-empty' });
      empty.setText('Нет записей. Нажми «Добавить», чтобы создать первую карточку.');
    }
  }

  renderCards(rows) {
    if (rows.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: 'vinyl-empty' });
      empty.setText('Нет записей. Нажми «Добавить», чтобы создать первую карточку.');
      return;
    }

    const grid = this.bodyEl.createDiv({ cls: 'vinyl-grid' });

    for (const row of rows) {
      const card = grid.createDiv({ cls: 'vinyl-card' });

      const imageWrap = card.createDiv({ cls: 'vinyl-cover-wrap' });
      const coverSrc = this.plugin.resolveCoverSrc(row);
      if (coverSrc) {
        const img = imageWrap.createEl('img', { cls: 'vinyl-cover', attr: { src: coverSrc, alt: row.title } });
        img.loading = 'lazy';
      } else {
        imageWrap.createDiv({ cls: 'vinyl-cover-placeholder', text: 'Нет обложки' });
      }

      const info = card.createDiv({ cls: 'vinyl-card-info' });
      info.createEl('div', { cls: 'vinyl-card-artist', text: row.artist || '—' });
      info.createEl('div', { cls: 'vinyl-card-title', text: row.title || row.file.basename });
      info.createEl('div', {
        cls: 'vinyl-card-meta',
        text: `${row.year || 'Год —'} • ${row.price ? `${row.price} ₽` : 'Цена —'}`,
      });

      const actions = card.createDiv({ cls: 'vinyl-card-actions' });
      const openBtn = actions.createEl('button', { text: 'Открыть', cls: 'mod-cta' });
      openBtn.addEventListener('click', async () => {
        await this.plugin.openRecord(row.file);
      });

      const hideBtn = actions.createEl('button', { text: 'Скрыть' });
      hideBtn.addEventListener('click', async () => {
        const ok = window.confirm(`Скрыть «${row.title}» из коллекции?`);
        if (!ok) return;
        await this.plugin.setHiddenFlag(row.file, true);
        new Notice('Запись скрыта');
        await this.refreshData();
      });
    }
  }

  createDialog(titleText) {
    const overlay = document.createElement('div');
    overlay.className = 'vinyl-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'vinyl-dialog';

    const title = document.createElement('div');
    title.className = 'vinyl-dialog-title';
    title.textContent = titleText;
    dialog.appendChild(title);

    const body = document.createElement('div');
    body.className = 'vinyl-dialog-body';
    dialog.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'vinyl-dialog-actions';
    dialog.appendChild(actions);

    const close = () => {
      dialog.remove();
      overlay.remove();
    };

    overlay.addEventListener('click', close);
    dialog.addEventListener('click', (event) => event.stopPropagation());

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    return { body, actions, close };
  }

  showDiscogsImportDialog() {
    const { body, actions, close } = this.createDialog('Импорт Discogs CSV');

    body.createEl('div', { cls: 'vinyl-dialog-label', text: 'CSV файл экспорта Discogs:' });
    const fileInput = body.createEl('input', {
      cls: 'vinyl-file-input',
      attr: { type: 'file', accept: '.csv,text/csv' },
    });

    const upsertLabel = body.createEl('label', { cls: 'vinyl-dialog-checkbox' });
    const upsertInput = upsertLabel.createEl('input', { attr: { type: 'checkbox' } });
    upsertInput.checked = true;
    upsertLabel.createSpan({ text: 'Обновлять существующие карточки (по release_id и артист+название)' });

    body.createEl('div', {
      cls: 'vinyl-dialog-note',
      text: 'Маппинг: Artist→artist, Title→title, Released→year, release_id→discogs_release_id, Label/Format/Catalog#/conditions.',
    });

    const status = body.createEl('div', { cls: 'vinyl-dialog-note' });

    const cancelBtn = actions.createEl('button', { text: 'Отмена' });
    cancelBtn.addEventListener('click', close);

    const importBtn = actions.createEl('button', { text: 'Импортировать', cls: 'mod-cta' });
    importBtn.disabled = true;

    fileInput.addEventListener('change', () => {
      const selected = fileInput.files && fileInput.files.length > 0;
      importBtn.disabled = !selected;
      status.textContent = selected ? `Файл выбран: ${fileInput.files[0].name}` : '';
    });

    importBtn.addEventListener('click', async () => {
      if (!fileInput.files || fileInput.files.length === 0) return;

      const file = fileInput.files[0];
      importBtn.disabled = true;
      importBtn.textContent = 'Импортирую...';
      status.textContent = 'Чтение и обработка CSV...';

      try {
        const csvText = await file.text();
        const summary = await this.plugin.importDiscogsCsv(csvText, {
          upsert: upsertInput.checked,
        });

        const parts = [
          `Создано: ${summary.created}`,
          `Обновлено: ${summary.updated}`,
          `Пропущено: ${summary.skipped}`,
          `Ошибок: ${summary.errors.length}`,
        ];
        status.textContent = parts.join(' • ');

        if (summary.errors.length > 0) {
          new Notice(`Импорт завершён с ошибками (${summary.errors.length})`);
        } else {
          new Notice('Импорт Discogs завершён');
        }

        await this.refreshData();
      } catch (error) {
        console.error(error);
        status.textContent = `Ошибка: ${error?.message ?? 'не удалось импортировать CSV'}`;
        new Notice('Ошибка импорта Discogs CSV');
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Импортировать';
      }
    });
  }

  showExportDialog() {
    const rows = this.getRenderedRows();

    const { body, actions, close } = this.createDialog('Экспорт коллекции');

    body.createEl('div', { cls: 'vinyl-dialog-label', text: 'Формат:' });
    const formatWrap = body.createDiv({ cls: 'vinyl-dialog-options' });

    const csvLabel = formatWrap.createEl('label', { cls: 'vinyl-dialog-radio' });
    const csvInput = csvLabel.createEl('input', {
      attr: { type: 'radio', name: 'vinyl-export-format', value: 'csv' },
    });
    csvInput.checked = true;
    csvLabel.createSpan({ text: 'CSV' });

    const mdLabel = formatWrap.createEl('label', { cls: 'vinyl-dialog-radio' });
    const mdInput = mdLabel.createEl('input', {
      attr: { type: 'radio', name: 'vinyl-export-format', value: 'md' },
    });
    mdLabel.createSpan({ text: 'Markdown' });

    const baseLabel = formatWrap.createEl('label', { cls: 'vinyl-dialog-radio' });
    const baseInput = baseLabel.createEl('input', {
      attr: { type: 'radio', name: 'vinyl-export-format', value: 'base' },
    });
    baseLabel.createSpan({ text: '.base (в vault)' });

    const priceLabel = body.createEl('label', { cls: 'vinyl-dialog-checkbox' });
    const includePrice = priceLabel.createEl('input', { attr: { type: 'checkbox' } });
    includePrice.checked = true;
    priceLabel.createSpan({ text: 'Включить цену' });

    const info = body.createEl('div', { cls: 'vinyl-dialog-note' });
    const updateUiByFormat = () => {
      const baseMode = baseInput.checked;
      priceLabel.style.display = baseMode ? 'none' : 'flex';
      info.textContent = baseMode
        ? `Будет создан/обновлён файл в корне коллекции: ${this.plugin.getBaseFilePath()}`
        : 'Файл будет скачан на устройство.';
    };

    csvInput.addEventListener('change', updateUiByFormat);
    mdInput.addEventListener('change', updateUiByFormat);
    baseInput.addEventListener('change', updateUiByFormat);
    updateUiByFormat();

    const cancelBtn = actions.createEl('button', { text: 'Отмена' });
    cancelBtn.addEventListener('click', close);

    const exportBtn = actions.createEl('button', { text: 'Экспортировать', cls: 'mod-cta' });
    exportBtn.addEventListener('click', async () => {
      if (baseInput.checked) {
        const basePath = await this.plugin.createOrUpdateBaseFile();
        new Notice(`.base обновлен: ${basePath}`);
        close();
        return;
      }

      if (!rows.length) {
        new Notice('Нет записей для экспорта');
        return;
      }

      const include = includePrice.checked;
      if (csvInput.checked) {
        const content = this.exportRowsToCSV(rows, include);
        const filename = include ? 'vinyl-collection.csv' : 'vinyl-collection-no-price.csv';
        downloadTextFile(content, filename, 'text/csv;charset=utf-8;', true);
      } else {
        const content = this.exportRowsToMarkdown(rows, include);
        const filename = include ? 'vinyl-collection.md' : 'vinyl-collection-no-price.md';
        downloadTextFile(content, filename, 'text/markdown;charset=utf-8;');
      }
      new Notice('Экспорт готов');
      close();
    });
  }

  exportRowsToCSV(rows, includePrice = true) {
    const headers = includePrice
      ? ['Артист', 'Название', 'Год', 'Цена']
      : ['Артист', 'Название', 'Год'];

    const lines = [headers.map((header) => escapeCsvCell(header)).join(',')];

    for (const row of rows) {
      const values = [
        escapeCsvCell(row.artist || ''),
        escapeCsvCell(row.title || row.file.basename),
        escapeCsvCell(row.year || ''),
      ];
      if (includePrice) {
        values.push(escapeCsvCell(row.price ? row.price : ''));
      }
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  exportRowsToMarkdown(rows, includePrice = true) {
    let md = '# Коллекция винила\n\n';

    if (includePrice) {
      md += '| Артист | Название | Год | Цена |\n';
      md += '|:-------|:---------|:----|:-----|\n';
      for (const row of rows) {
        const title = (row.title || row.file.basename).replace(/\|/g, '\\|');
        const artist = (row.artist || '').replace(/\|/g, '\\|');
        const year = (row.year || '').replace(/\|/g, '\\|');
        const price = row.price ? `${row.price} ₽` : '—';
        md += `| ${artist} | ${title} | ${year} | ${price} |\n`;
      }
    } else {
      md += '| Артист | Название | Год |\n';
      md += '|:-------|:---------|:----|\n';
      for (const row of rows) {
        const title = (row.title || row.file.basename).replace(/\|/g, '\\|');
        const artist = (row.artist || '').replace(/\|/g, '\\|');
        const year = (row.year || '').replace(/\|/g, '\\|');
        md += `| ${artist} | ${title} | ${year} |\n`;
      }
    }

    return md;
  }

  showCardImageExportDialog() {
    const rows = this.getRenderedRows();
    if (!rows.length) {
      new Notice('Нет карточек для экспорта');
      return;
    }

    const { body, actions, close } = this.createDialog('Экспорт карточек в изображение');
    body.createEl('div', { cls: 'vinyl-dialog-label', text: 'Формат:' });

    const formatWrap = body.createDiv({ cls: 'vinyl-dialog-options' });
    const pngLabel = formatWrap.createEl('label', { cls: 'vinyl-dialog-radio' });
    const pngInput = pngLabel.createEl('input', {
      attr: { type: 'radio', name: 'vinyl-image-format', value: 'png' },
    });
    pngInput.checked = true;
    pngLabel.createSpan({ text: 'PNG' });

    const jpgLabel = formatWrap.createEl('label', { cls: 'vinyl-dialog-radio' });
    const jpgInput = jpgLabel.createEl('input', {
      attr: { type: 'radio', name: 'vinyl-image-format', value: 'jpeg' },
    });
    jpgLabel.createSpan({ text: 'JPEG' });

    body.createEl('div', { cls: 'vinyl-dialog-label', text: 'Тема:' });
    const themeWrap = body.createDiv({ cls: 'vinyl-dialog-options' });

    const lightLabel = themeWrap.createEl('label', { cls: 'vinyl-dialog-radio' });
    const lightInput = lightLabel.createEl('input', {
      attr: { type: 'radio', name: 'vinyl-image-theme', value: 'light' },
    });
    lightInput.checked = true;
    lightLabel.createSpan({ text: 'Светлая' });

    const darkLabel = themeWrap.createEl('label', { cls: 'vinyl-dialog-radio' });
    const darkInput = darkLabel.createEl('input', {
      attr: { type: 'radio', name: 'vinyl-image-theme', value: 'dark' },
    });
    darkLabel.createSpan({ text: 'Тёмная' });

    body.createEl('div', {
      cls: 'vinyl-dialog-note',
      text: 'Будет создан 1 файл со всеми карточками из текущего списка.',
    });

    const cancelBtn = actions.createEl('button', { text: 'Отмена' });
    cancelBtn.addEventListener('click', close);

    const exportBtn = actions.createEl('button', { text: 'Скачать', cls: 'mod-cta' });
    exportBtn.addEventListener('click', async () => {
      try {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Генерирую...';
        const format = pngInput.checked ? 'png' : 'jpeg';
        const theme = darkInput.checked ? 'dark' : 'light';
        await this.exportCardsImage(rows, format, theme);
        new Notice('Изображение с карточками готово');
        close();
      } catch (error) {
        console.error(error);
        new Notice('Ошибка при экспорте карточек');
        exportBtn.disabled = false;
        exportBtn.textContent = 'Скачать';
      }
    });

  }

  async exportCardsImage(rows, format, theme = 'light') {
    const cardsPerRow = 3;
    const cardW = 340;
    const cardH = 500;
    const gap = 22;
    const pad = 24;
    const headerH = 92;
    const totalRows = Math.ceil(rows.length / cardsPerRow);

    const canvas = document.createElement('canvas');
    canvas.width = pad * 2 + cardsPerRow * cardW + Math.max(0, cardsPerRow - 1) * gap;
    canvas.height = pad * 2 + headerH + totalRows * cardH + Math.max(0, totalRows - 1) * gap;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is not available');

    const isDark = theme === 'dark';
    const palette = isDark
      ? {
          bg: '#0f172a',
          heading: '#f8fafc',
          subtitle: '#94a3b8',
          cardBg: '#111827',
          shadow: 'rgba(2, 6, 23, 0.55)',
          coverBg: '#1f2937',
          placeholder: '#94a3b8',
          artist: '#cbd5e1',
          title: '#f8fafc',
          meta: '#94a3b8',
        }
      : {
          bg: '#f3f4f6',
          heading: '#111827',
          subtitle: '#6b7280',
          cardBg: '#ffffff',
          shadow: 'rgba(17, 24, 39, 0.12)',
          coverBg: '#eef1f5',
          placeholder: '#9ca3af',
          artist: '#4b5563',
          title: '#111827',
          meta: '#374151',
        };

    const prepared = await Promise.all(
      rows.map(async (row) => ({
        row,
        img: await loadImageSafe(this.plugin.resolveCoverSrc(row)),
      })),
    );

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = palette.heading;
    ctx.font = '700 34px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.fillText('Коллекция винила', pad, pad + 34);

    ctx.fillStyle = palette.subtitle;
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    const themeLabel = isDark ? 'Тема: темная' : 'Тема: светлая';
    ctx.fillText(`Карточек: ${rows.length} • ${themeLabel}`, pad, pad + 64);

    prepared.forEach((entry, index) => {
      const col = index % cardsPerRow;
      const rowIndex = Math.floor(index / cardsPerRow);
      const x = pad + col * (cardW + gap);
      const y = pad + headerH + rowIndex * (cardH + gap);

      ctx.save();
      ctx.shadowColor = palette.shadow;
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = palette.cardBg;
      roundedRect(ctx, x, y, cardW, cardH, 18);
      ctx.fill();
      ctx.restore();

      const coverPad = 14;
      const coverX = x + coverPad;
      const coverY = y + coverPad;
      const coverW = cardW - coverPad * 2;
      const coverH = 300;

      ctx.save();
      ctx.fillStyle = palette.coverBg;
      roundedRect(ctx, coverX, coverY, coverW, coverH, 12);
      ctx.fill();

      roundedRect(ctx, coverX, coverY, coverW, coverH, 12);
      ctx.clip();

      if (entry.img) {
        const scale = Math.min(coverW / entry.img.width, coverH / entry.img.height);
        const drawW = entry.img.width * scale;
        const drawH = entry.img.height * scale;
        const drawX = coverX + (coverW - drawW) / 2;
        const drawY = coverY + (coverH - drawH) / 2;
        ctx.drawImage(entry.img, drawX, drawY, drawW, drawH);
      } else {
        ctx.fillStyle = palette.placeholder;
        ctx.font = '500 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Нет обложки', coverX + coverW / 2, coverY + coverH / 2);
        ctx.textAlign = 'start';
      }
      ctx.restore();

      const textX = x + 16;
      let textY = coverY + coverH + 30;

      ctx.fillStyle = palette.artist;
      ctx.font = '600 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      textY = drawWrappedText(ctx, entry.row.artist || '—', textX, textY, cardW - 32, 22, 2) + 8;

      ctx.fillStyle = palette.title;
      ctx.font = '700 20px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      textY = drawWrappedText(ctx, entry.row.title || entry.row.file.basename, textX, textY, cardW - 32, 26, 3) + 10;

      ctx.fillStyle = palette.meta;
      ctx.font = '500 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      const meta = `${entry.row.year || 'Год —'} • ${entry.row.price ? `${entry.row.price} ₽` : 'Цена —'}`;
      drawWrappedText(ctx, meta, textX, textY, cardW - 32, 22, 2);
    });

    const isJpeg = format === 'jpeg';
    const blob = await canvasToBlob(canvas, isJpeg ? 'image/jpeg' : 'image/png', isJpeg ? 0.92 : undefined);
    const ext = isJpeg ? 'jpg' : 'png';
    const themeSuffix = isDark ? 'dark' : 'light';
    downloadBlob(blob, `vinyl-cards-${themeSuffix}-${exportTimestamp()}.${ext}`);
  }
}

class VinylSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Vinyl Catalog Tools' });

    new Setting(containerEl)
      .setName('Папка коллекции')
      .setDesc('Корневая папка раздела с винилом в vault')
      .addText((text) => {
        text.setValue(this.plugin.settings.collectionFolder);
        text.onChange(async (value) => {
          this.plugin.settings.collectionFolder = normalizePath(value || DEFAULT_SETTINGS.collectionFolder);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Папка артистов')
      .setDesc('Карточки пишутся в подпапки внутри этой директории')
      .addText((text) => {
        text.setValue(this.plugin.settings.artistsFolder);
        text.onChange(async (value) => {
          this.plugin.settings.artistsFolder = normalizePath(value || DEFAULT_SETTINGS.artistsFolder);
          await this.plugin.saveSettings();
          await this.plugin.refreshOpenViews();
        });
      });

    new Setting(containerEl)
      .setName('Папка обложек')
      .setDesc('Куда сохранять скачанные обложки')
      .addText((text) => {
        text.setValue(this.plugin.settings.coversFolder);
        text.onChange(async (value) => {
          this.plugin.settings.coversFolder = normalizePath(value || DEFAULT_SETTINGS.coversFolder);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Инициализировать структуру')
      .setDesc('Создать папки коллекции, артистов и обложек по путям из настроек')
      .addButton((button) => {
        button.setButtonText('Создать').setCta().onClick(async () => {
          await this.plugin.ensureStructure();
          new Notice('Структура винила готова');
        });
      });

    new Setting(containerEl)
      .setName('Создать .base файл')
      .setDesc('Создать или обновить файл базы коллекции с видами таблицы и карточек')
      .addButton((button) => {
        button.setButtonText('Создать .base').onClick(async () => {
          const basePath = await this.plugin.createOrUpdateBaseFile();
          new Notice(`.base обновлен: ${basePath}`);
        });
      });
  }
}

class VinylCatalogToolsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_VINYL_COLLECTION,
      (leaf) => new VinylCollectionView(leaf, this),
    );

    this.addRibbonIcon('disc', 'Vinyl: открыть коллекцию', async () => {
      await this.activateCollectionView();
    });

    this.addCommand({
      id: 'vinyl-open-collection',
      name: 'Vinyl: Open collection',
      callback: async () => {
        await this.activateCollectionView();
      },
    });

    this.addCommand({
      id: 'vinyl-add-record',
      name: 'Vinyl: Add record',
      callback: () => {
        this.openAddModal();
      },
    });

    this.addCommand({
      id: 'vinyl-init-structure',
      name: 'Vinyl: Initialize folders',
      callback: async () => {
        await this.ensureStructure();
        new Notice('Структура винила готова');
      },
    });

    this.addCommand({
      id: 'vinyl-import-discogs-csv',
      name: 'Vinyl: Import Discogs CSV',
      callback: async () => {
        await this.activateCollectionView();
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VINYL_COLLECTION);
        const view = leaves[0]?.view;
        if (view instanceof VinylCollectionView) {
          view.showDiscogsImportDialog();
        }
      },
    });

    this.addCommand({
      id: 'vinyl-create-base-file',
      name: 'Vinyl: Create .base file',
      callback: async () => {
        const basePath = await this.createOrUpdateBaseFile();
        new Notice(`.base обновлен: ${basePath}`);
      },
    });

    this.addSettingTab(new VinylSettingsTab(this.app, this));

    this.registerEvent(this.app.vault.on('create', async (file) => {
      await this.maybeRefreshForFile(file);
    }));
    this.registerEvent(this.app.vault.on('modify', async (file) => {
      await this.maybeRefreshForFile(file);
    }));
    this.registerEvent(this.app.vault.on('delete', async (file) => {
      await this.maybeRefreshForFile(file);
    }));
    this.registerEvent(this.app.vault.on('rename', async (file) => {
      await this.maybeRefreshForFile(file);
    }));
    this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
      await this.maybeRefreshForFile(file);
    }));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_VINYL_COLLECTION);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  openAddModal() {
    new AddVinylModal(this.app, this).open();
  }

  async activateCollectionView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_VINYL_COLLECTION)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_VINYL_COLLECTION,
        active: true,
      });
    }

    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof VinylCollectionView) {
      await view.refreshData();
    }
  }

  async maybeRefreshForFile(file) {
    if (!(file instanceof TFile)) return;
    if (file.extension !== 'md') return;

    const normalizedArtists = `${normalizePath(this.settings.artistsFolder).replace(/\/$/, '')}/`;
    if (file.path.startsWith(normalizedArtists)) {
      await this.refreshOpenViews();
    }
  }

  async refreshOpenViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VINYL_COLLECTION);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof VinylCollectionView) {
        await view.refreshData();
      }
    }
  }

  async ensureStructure() {
    await this.ensureFolder(this.settings.collectionFolder);
    await this.ensureFolder(this.settings.artistsFolder);
    await this.ensureFolder(this.settings.coversFolder);
  }

  getBaseFilePath() {
    const collectionRoot = normalizePath(this.settings.collectionFolder || DEFAULT_SETTINGS.collectionFolder);
    return normalizePath(`${collectionRoot}/🎶 Коллекция винила.base`);
  }

  buildBaseFileContent() {
    const artistsFolder = normalizePath(this.settings.artistsFolder || DEFAULT_SETTINGS.artistsFolder);
    const inFolderExpr = `file.inFolder("${escapeDoubleQuoted(artistsFolder)}")`;

    return [
      'filters:',
      '  and:',
      `    - ${inFolderExpr}`,
      '    - artist',
      '    - hidden != true',
      'formulas:',
      '  items: "1"',
      'properties:',
      '  artist:',
      '    displayName: 🎤 Артист',
      '  title:',
      '    displayName: 🎵 Название',
      '  year:',
      '    displayName: 🗓️ Год',
      '  price:',
      '    displayName: 💰 Цена',
      '  cover:',
      '    displayName: 🖼️ Обложка',
      '  formula.items:',
      '    displayName: 🔢 Кол-во',
      'views:',
      '  - type: table',
      '    name: Коллекция',
      '    order:',
      '      - artist',
      '      - title',
      '      - year',
      '      - price',
      '      - cover',
      '    sort:',
      '      - property: cover',
      '        direction: DESC',
      '      - property: artist',
      '        direction: ASC',
      '      - property: title',
      '        direction: ASC',
      '      - property: year',
      '        direction: DESC',
      '    summaries:',
      '      price: Sum',
      '      formula.items: Sum',
      '  - type: cards',
      '    name: Карточки',
      '    order:',
      '      - artist',
      '      - title',
      '      - year',
      '    sort:',
      '      - property: artist',
      '        direction: ASC',
      '      - property: title',
      '        direction: ASC',
      '    image: cover',
      '    imageFit: contain',
      '    imageAspectRatio: 1',
      '    cardSize: 220',
      '',
    ].join('\n');
  }

  async createOrUpdateBaseFile() {
    await this.ensureStructure();

    const basePath = this.getBaseFilePath();
    const content = this.buildBaseFileContent();
    const exists = await this.app.vault.adapter.exists(basePath);

    if (exists) {
      const existing = this.app.vault.getAbstractFileByPath(basePath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.adapter.write(basePath, content);
      }
    } else {
      await this.app.vault.create(basePath, content);
    }

    return basePath;
  }

  async ensureFolder(folderPath) {
    const normalized = normalizePath(folderPath);
    if (!normalized) return;
    if (await this.app.vault.adapter.exists(normalized)) return;

    const segments = normalized.split('/');
    let current = '';

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async getUniqueNotePath(initialPath) {
    const normalized = normalizePath(initialPath);
    if (!(await this.app.vault.adapter.exists(normalized))) return normalized;

    const ext = path.posix.extname(normalized);
    const noExt = normalized.slice(0, -ext.length);

    let counter = 2;
    while (true) {
      const candidate = `${noExt} ${counter}${ext}`;
      if (!(await this.app.vault.adapter.exists(candidate))) return candidate;
      counter += 1;
    }
  }

  async downloadCover(coverUrl, artist, title) {
    if (!coverUrl) return '';

    await this.ensureFolder(this.settings.coversFolder);

    const baseName = slugify(`${artist} ${title}`);
    let ext = extFromUrl(coverUrl) || 'jpg';

    const response = await requestUrl({
      url: coverUrl,
      method: 'GET',
      headers: {
        accept: 'image/*,*/*',
        'user-agent': 'Mozilla/5.0 (Obsidian)',
      },
    });

    const byContentType = extFromContentType(response.headers['content-type'] || response.headers['Content-Type']);
    if (byContentType) ext = byContentType;

    let targetPath = normalizePath(`${this.settings.coversFolder}/${baseName}.${ext}`);
    const existing = await this.app.vault.adapter.exists(targetPath);
    if (existing) {
      const unique = await this.getUniqueNotePath(targetPath);
      targetPath = unique;
    }

    if (ext === 'svg') {
      await this.app.vault.adapter.write(targetPath, response.text || '');
    } else {
      await this.app.vault.adapter.writeBinary(targetPath, new Uint8Array(response.arrayBuffer));
    }

    return targetPath;
  }

  buildRecordContent({ artist, title, year, price, coverPath }) {
    const frontmatter = {
      artist,
      title,
      tags: ['vinyl'],
    };

    if (toText(year)) frontmatter.year = toText(year);
    const parsedPrice = toPrice(price);
    if (parsedPrice) frontmatter.price = parsedPrice;
    if (coverPath) frontmatter.cover = `[[${coverPath}]]`;

    const yaml = stringifyYaml(frontmatter).trimEnd();

    const lines = [];
    if (coverPath) lines.push(`![[${coverPath}|300]]`, '');

    lines.push(
      `**Артист:** ${artist}`,
      '',
      '',
      '### Notes',
      '- Состояние:',
      '- Издание:',
      '- Комментарии:',
      '',
    );

    return `---\n${yaml}\n---\n\n${lines.join('\n')}`;
  }

  async createVinylRecord({ artist, title, year, price, coverUrl }) {
    await this.ensureStructure();

    const artistFolder = normalizePath(`${this.settings.artistsFolder}/${sanitizeName(artist)}`);
    await this.ensureFolder(artistFolder);

    let coverPath = '';
    if (coverUrl) {
      try {
        coverPath = await this.downloadCover(coverUrl, artist, title);
      } catch (error) {
        console.error(error);
        new Notice('Не удалось скачать обложку, карточка будет создана без неё');
      }
    }

    const baseName = `${sanitizeName(artist)} — ${sanitizeName(title)}`;
    const notePath = await this.getUniqueNotePath(`${artistFolder}/${baseName}.md`);
    const content = this.buildRecordContent({ artist, title, year, price, coverPath });

    return this.app.vault.create(notePath, content);
  }

  async openRecord(file) {
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  }

  async setHiddenFlag(file, hidden) {
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const parts = splitFrontmatter(content);

    let frontmatter = {};
    let body = content;

    if (parts) {
      frontmatter = parseYaml(parts.frontmatterRaw) || {};
      body = parts.body;
    }

    if (hidden) {
      frontmatter.hidden = true;
    } else {
      delete frontmatter.hidden;
    }

    const yaml = stringifyYaml(frontmatter).trimEnd();
    const next = `---\n${yaml}\n---\n\n${body.replace(/^\s*/, '')}`;
    await this.app.vault.modify(file, next);
  }

  async readFrontmatter(file) {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached && Object.keys(cached).length > 0) {
      return cached;
    }

    const content = await this.app.vault.cachedRead(file);
    const parts = splitFrontmatter(content);
    if (!parts) return {};
    return parseYaml(parts.frontmatterRaw) || {};
  }

  async modifyFrontmatter(file, mutator) {
    const content = await this.app.vault.read(file);
    const parts = splitFrontmatter(content);

    let frontmatter = {};
    let body = content;
    if (parts) {
      frontmatter = parseYaml(parts.frontmatterRaw) || {};
      body = parts.body;
    }

    const nextFrontmatter = (await mutator(frontmatter)) || frontmatter;
    const yaml = stringifyYaml(nextFrontmatter).trimEnd();
    const next = `---\n${yaml}\n---\n\n${body.replace(/^\s*/, '')}`;
    await this.app.vault.modify(file, next);
  }

  applyDiscogsFields(frontmatter, record) {
    frontmatter.artist = record.artist;
    frontmatter.title = record.title;
    if (record.year) frontmatter.year = record.year;
    if (record.releaseId) frontmatter.discogs_release_id = record.releaseId;
    if (record.catalogNumber) frontmatter.catalog_number = record.catalogNumber;
    if (record.label) frontmatter.label = record.label;
    if (record.format) frontmatter.format = record.format;
    if (record.rating) frontmatter.discogs_rating = record.rating;
    if (record.dateAdded) frontmatter.discogs_date_added = record.dateAdded;
    if (record.mediaCondition) frontmatter.media_condition = record.mediaCondition;
    if (record.sleeveCondition) frontmatter.sleeve_condition = record.sleeveCondition;
    frontmatter.source = 'discogs';

    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map((tag) => toText(tag)).filter(Boolean) : [];
    if (!tags.includes('vinyl')) tags.push('vinyl');
    frontmatter.tags = tags;
  }

  buildDiscogsRecordContent(record) {
    const frontmatter = {};
    this.applyDiscogsFields(frontmatter, record);

    const yaml = stringifyYaml(frontmatter).trimEnd();
    const lines = [
      `**Артист:** ${record.artist}`,
      '',
      '### Discogs',
      `- Release ID: ${record.releaseId || '—'}`,
      `- Каталожный номер: ${record.catalogNumber || '—'}`,
      `- Лейбл: ${record.label || '—'}`,
      `- Формат: ${record.format || '—'}`,
      `- Добавлено в коллекцию Discogs: ${record.dateAdded || '—'}`,
      '',
      '### Notes',
      `- Состояние пластинки: ${record.mediaCondition || ''}`,
      `- Состояние конверта: ${record.sleeveCondition || ''}`,
      '- Издание:',
      `- Комментарии: ${record.notes || ''}`,
      '',
    ];

    return `---\n${yaml}\n---\n\n${lines.join('\n')}`;
  }

  async createVinylRecordFromDiscogs(record) {
    await this.ensureStructure();
    const artistFolder = normalizePath(`${this.settings.artistsFolder}/${sanitizeName(record.artist)}`);
    await this.ensureFolder(artistFolder);

    const baseName = `${sanitizeName(record.artist)} — ${sanitizeName(record.title)}`;
    const notePath = await this.getUniqueNotePath(`${artistFolder}/${baseName}.md`);
    const content = this.buildDiscogsRecordContent(record);
    return this.app.vault.create(notePath, content);
  }

  async updateVinylRecordFromDiscogs(file, record) {
    await this.modifyFrontmatter(file, async (frontmatter) => {
      this.applyDiscogsFields(frontmatter, record);
      return frontmatter;
    });
  }

  async buildDiscogsIndex() {
    const byReleaseId = new Map();
    const byArtistTitle = new Map();
    const prefix = `${normalizePath(this.settings.artistsFolder).replace(/\/$/, '')}/`;

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .filter((file) => {
        const tail = file.path.slice(prefix.length);
        return tail.includes('/');
      });

    for (const file of files) {
      const fm = await this.readFrontmatter(file);
      const artist = toText(fm.artist);
      const title = toText(fm.title) || file.basename;
      const releaseId = toText(fm.discogs_release_id || fm.release_id);

      if (artist && title) {
        byArtistTitle.set(makeArtistTitleLookupKey(artist, title), file);
      }
      if (releaseId) byReleaseId.set(releaseId, file);
    }

    return { byReleaseId, byArtistTitle };
  }

  async importDiscogsCsv(csvText, options = {}) {
    const upsert = options.upsert !== false;
    const rawRows = parseCsvToObjects(csvText);
    if (!rawRows.length) {
      throw new Error('CSV пустой или не удалось прочитать строки');
    }

    const mappedRows = rawRows.map(mapDiscogsCsvRow).filter(Boolean);
    const summary = {
      total: rawRows.length,
      created: 0,
      updated: 0,
      skipped: rawRows.length - mappedRows.length,
      errors: [],
    };

    if (!mappedRows.length) {
      throw new Error('В CSV не найдено валидных строк с Artist и Title');
    }

    const index = await this.buildDiscogsIndex();

    for (const record of mappedRows) {
      try {
        let targetFile = null;
        if (upsert) {
          if (record.releaseId) targetFile = index.byReleaseId.get(record.releaseId) || null;
          if (!targetFile) {
            targetFile = index.byArtistTitle.get(makeArtistTitleLookupKey(record.artist, record.title)) || null;
          }
        }

        if (targetFile) {
          await this.updateVinylRecordFromDiscogs(targetFile, record);
          summary.updated += 1;
        } else {
          targetFile = await this.createVinylRecordFromDiscogs(record);
          summary.created += 1;
        }

        if (record.releaseId) index.byReleaseId.set(record.releaseId, targetFile);
        index.byArtistTitle.set(makeArtistTitleLookupKey(record.artist, record.title), targetFile);
      } catch (error) {
        summary.errors.push(`${record.artist} — ${record.title}: ${error?.message ?? 'ошибка импорта'}`);
      }
    }

    await this.refreshOpenViews();
    return summary;
  }

  async loadVinylRows() {
    const prefix = `${normalizePath(this.settings.artistsFolder).replace(/\/$/, '')}/`;

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .filter((file) => {
        const tail = file.path.slice(prefix.length);
        return tail.includes('/');
      });

    const rows = await Promise.all(files.map(async (file) => {
      const fm = await this.readFrontmatter(file);

      const isHidden = fm.hidden === true || toText(fm.hidden).toLowerCase() === 'true';
      if (isHidden) return null;

      const artist = toText(fm.artist);
      if (!artist) return null;

      const title = toText(fm.title) || file.basename;
      const year = toText(fm.year);
      const price = toPrice(fm.price);
      const addedTs = file.stat?.ctime || 0;
      const addedDate = addedTs ? new Date(addedTs) : null;
      const addedText = addedDate
        ? `${String(addedDate.getDate()).padStart(2, '0')}.${String(addedDate.getMonth() + 1).padStart(2, '0')}.${addedDate.getFullYear()}`
        : '—';

      return {
        file,
        artist,
        title,
        year,
        price,
        cover: fm.cover,
        added: addedTs,
        addedText,
      };
    }));

    return rows.filter(Boolean);
  }

  resolveCoverSrc(row) {
    const raw = normalizeCoverLinkTarget(unwrapCoverValue(row.cover));
    if (!raw) return '';

    if (/^(https?:|data:|file:|app:)/i.test(raw)) {
      return raw;
    }

    const direct = this.app.vault.getAbstractFileByPath(raw);
    if (direct instanceof TFile) {
      return this.app.vault.getResourcePath(direct);
    }

    const linked = this.app.metadataCache.getFirstLinkpathDest(raw, row.file.path);
    if (linked instanceof TFile) {
      return this.app.vault.getResourcePath(linked);
    }

    return '';
  }
}

module.exports = VinylCatalogToolsPlugin;
