# Publish Guide

This document is a ready-to-run checklist for publishing `vinyl-catalog-tools` to Obsidian Community Plugins.

## 1. Repository Preparation

Required files in repo root:

- `README.md`
- `LICENSE`
- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

Do not include local runtime config in release assets:

- `data.json`

## 2. Current Release Metadata

- Plugin id: `vinyl-catalog-tools`
- Current version: `0.5.13`
- Min app version: `1.5.0`

## 3. Release Assets

Attach these files to GitHub Release tag `0.5.13`:

- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`

Prepared bundle (local):

- `release/0.5.13/vinyl-catalog-tools-0.5.13.zip`

SHA256:

- `539851424348110bc2ba9f85167174fd1f4fdf41615d2e1cc7e0243b6b42f9ff`

## 4. GitHub Release Steps

1. Push all source changes to your default branch.
2. Create tag `0.5.13`.
3. Create GitHub Release from this tag.
4. Upload release assets listed above.
5. Publish release.

## 5. Community Plugins Submission PR

Open PR to:

- `https://github.com/obsidianmd/obsidian-releases`

File to edit:

- `community-plugins.json`

Use this JSON entry (replace `REPO_OWNER/REPO_NAME`):

```json
{
  "id": "vinyl-catalog-tools",
  "name": "Vinyl Catalog Tools",
  "author": "arthem",
  "description": "Manage your vinyl collection: table/cards view, Discogs CSV import, and export.",
  "repo": "REPO_OWNER/REPO_NAME"
}
```

Suggested PR title:

- `Add plugin: Vinyl Catalog Tools`

Suggested PR body:

```
## Summary
Adds `vinyl-catalog-tools` to Community Plugins.

## Plugin info
- id: vinyl-catalog-tools
- name: Vinyl Catalog Tools
- author: arthem
- repo: https://github.com/REPO_OWNER/REPO_NAME
- latest release: 0.5.13

## Notes
- Release assets include main.js, manifest.json, styles.css, versions.json.
```

## 6. Pre-submit Validation

Before opening PR, verify:

1. `manifest.json` version equals release tag (`0.5.13`).
2. `versions.json` contains `"0.5.13": "1.5.0"`.
3. GitHub release contains required assets.
4. Release is public.
