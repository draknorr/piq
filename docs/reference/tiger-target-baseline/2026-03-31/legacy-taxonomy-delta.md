# Legacy Taxonomy Delta

Date: March 31, 2026

This note records the exact change between:

- `docs/reference/tiger-target-baseline/2026-03-31/pre-legacy-taxonomy/`
- `docs/reference/tiger-target-baseline/2026-03-31/post-legacy-taxonomy/`

## Result

The Tiger taxonomy compatibility slice completed successfully.

## Added tables

- `legacy.steam_genres`
- `legacy.app_genres`
- `legacy.steam_tags`
- `legacy.app_steam_tags`

## Added indexes

The write added the planned lookup indexes needed for Tiger-backed filter
execution, including:

- `lower(name)` indexes on `legacy.steam_genres` and `legacy.steam_tags`
- foreign-key lookup indexes on `genre_id` and `tag_id`
- `created_at` indexes for replay/debug visibility
- rank-aware lookup index on `legacy.app_steam_tags`
- primary-genre lookup index on `legacy.app_genres`

## Row verification

Source and Tiger counts match exactly:

- `steam_genres = 42`
- `app_genres = 476,423`
- `steam_tags = 446`
- `app_steam_tags = 2,534,054`

## Integrity verification

Orphan checks returned zero rows for all four join paths:

- `legacy.app_genres.appid -> legacy.apps.appid`
- `legacy.app_genres.genre_id -> legacy.steam_genres.genre_id`
- `legacy.app_steam_tags.appid -> legacy.apps.appid`
- `legacy.app_steam_tags.tag_id -> legacy.steam_tags.tag_id`

## Runtime verification

After backfill:

- Tiger `searchCatalog` requests with `genres` now return `200`
- Tiger `searchCatalog` requests with `tags` now return `200`
- mixed `genres + tags + publisherQuery` requests also return `200`

## Scope confirmation

This phase changed only the Tiger `legacy` schema and the query-service contract
runtime behavior around optional taxonomy filters.

It did not:

- alter the Supabase source database
- backfill heavy time-series history tables
- create hypertables
- change browser-facing website routes
