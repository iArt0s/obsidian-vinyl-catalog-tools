# Vinyl Catalog Tools

Obsidian plugin for vinyl collection management with a simple flow:

1. Add record card.
2. Browse collection in table view.
3. Switch to card view with cover previews.

## Features

- Command: `Vinyl: Add record`
- Command: `Vinyl: Open collection`
- Command: `Vinyl: Initialize folders`
- Command: `Vinyl: Create .base file`
- Command: `Vinyl: Import Discogs CSV`
- Table view: sorting, search, open note, hide record
- Cards view: cover image, metadata, open note, hide record
- Export collection: CSV / Markdown / `.base`
- Export cards image: PNG / JPEG (one image with all cards, light/dark theme)
- Discogs CSV import: upsert by `release_id` or `artist+title`
- Optional cover download from URL during record creation

## Default Paths

- Collection folder: `Vinyl`
- Records folder: `Vinyl/Artists`
- Covers folder: `Vinyl/covers`

All paths are configurable in plugin settings. Command `Vinyl: Initialize folders` uses these values.
Command `Vinyl: Create .base file` creates/updates `🎶 Коллекция винила.base` in collection folder root.
Discogs import works from local CSV file only (no API token required).

## Clean Start Flow

1. Open your test vault.
2. Enable Community plugins and enable `Vinyl Catalog Tools`.
3. Run `Vinyl: Initialize folders`.
4. Run `Vinyl: Create .base file`.
5. (Optional) Run `Vinyl: Import Discogs CSV` and select your Discogs export file.
6. Run `Vinyl: Add record` and create 2-3 records.
7. Run `Vinyl: Open collection`.
8. Verify:
   - table sorting by columns;
   - search filtering;
   - card mode with covers;
   - note opens on click.

## Publish Checklist

1. Keep `manifest.json`, `main.js`, `styles.css`, `versions.json` in release assets.
2. Tag release as `0.4.0`.
3. Submit plugin to Obsidian community list repository.

## Notes

- Desktop and mobile compatible, but cover download from URL depends on network availability.
- Hide action sets frontmatter `hidden: true`.
