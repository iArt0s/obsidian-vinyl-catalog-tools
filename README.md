# vinyl-catalog-tools

Manage your vinyl collection in Obsidian: add records, browse in table/cards view, import Discogs CSV, and export collection data or images.

## Features

- Add new vinyl record cards with optional cover URL download
- Table view with sorting, search, open-note action, and hide action
- Cards view with cover previews
- Discogs CSV import (`release_id`, upsert mode, cover backfill)
- Export collection to `CSV`, `Markdown`, or `.base`
- Export card grid to `PNG/JPEG`:
  - single image or multi-file grid
  - custom columns/rows for multi-file mode
  - aspect ratio options: `1:1`, `16:9`, `21:9`
  - light or dark theme
- RU/EN interface localization (`Auto`, `RU`, `EN`)

## Commands

- `Vinyl: Add record`
- `Vinyl: Open collection`
- `Vinyl: Initialize folders`
- `Vinyl: Create .base file`
- `Vinyl: Import Discogs CSV`

## Screenshot

![Vinyl Catalog Tools screenshot](assets/screenshot-vinyl-catalog-tools.png)

## Default Paths

- Collection folder: `Vinyl`
- Records folder: `Vinyl/Artists`
- Covers folder: `Vinyl/covers`
- Mobile image export folder: `<Collection folder>/exports`

All paths are configurable in plugin settings.

## Quick Start

1. Enable Community Plugins in your vault.
2. Enable `Vinyl Catalog Tools`.
3. Run `Vinyl: Initialize folders`.
4. (Optional) Run `Vinyl: Import Discogs CSV`.
5. Run `Vinyl: Open collection`.

## Notes

- Discogs import works from local CSV only (no token required).
- On mobile, exported card images are saved into vault (`<Collection folder>/exports`).
- Hidden records are marked with frontmatter `hidden: true`.

## Say Thanks

If this plugin saves you time and you want to support development:

[![Donate with PayPal](https://img.shields.io/badge/PayPal-Donate-0070BA?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/iArt0s)
[![USDT TRC20](https://img.shields.io/badge/USDT-TRC20-26A17B?style=for-the-badge&logo=tether&logoColor=white)](https://tronscan.org/#/address/TW4a7UHkfwQ29Ue55Be3GxtSxnG3XdkWXa)

USDT wallet: `TW4a7UHkfwQ29Ue55Be3GxtSxnG3XdkWXa`

Replace placeholders with your real PayPal link and wallet address before release.

## Publish Checklist

1. Keep `manifest.json`, `main.js`, `styles.css`, `versions.json` in release assets.
2. Tag release as `0.5.11`.
3. Submit plugin to Obsidian community list repository.
4. Do not include local `data.json` in release assets.
5. Use `PUBLISH.md` for ready PR text and release checklist.
