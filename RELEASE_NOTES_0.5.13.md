# Release 0.5.13

## Discogs cover backfill

- Added optional Discogs personal access token support for higher API limits.
- Slowed unauthenticated Discogs requests to stay within the current public API rate limit.
- Added Discogs release search fallback by artist and title when a note has no `discogs_release_id`.
- Saved discovered `discogs_release_id` back to the note when a fallback search attaches a cover.
- Improved Discogs CSV header handling for `Release ID`, `Discogs ID`, and related variants.
- Prefer primary release images and surface Discogs API/image HTTP errors in import summaries.

## UI text

- Renamed the collection view button and command to `Import Discogs data`.
