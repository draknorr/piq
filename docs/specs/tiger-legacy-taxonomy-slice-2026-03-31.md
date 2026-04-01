# Tiger Legacy Taxonomy Slice

Date: March 31, 2026

This note defines the next Tiger compatibility phase after the initial `legacy`
catalog slice and `core` identity seed.

It is based on the live source schema captured in
`docs/reference/tiger-live-baseline/2026-03-31/schema.sql`.

## Goal

Make Tiger-backed `searchCatalog` support real `genres` and `tags` filters
without falling back to Supabase or returning a runtime block.

This is the smallest schema addition that materially improves future `/chat`
natural-language breadth because genre and tag constraints appear frequently in
 free-form discovery prompts.

## Source tables

- `public.steam_genres`
- `public.app_genres`
- `public.steam_tags`
- `public.app_steam_tags`

## Current source cardinality

- `steam_genres`: `42`
- `app_genres`: `476,423`
- `steam_tags`: `446`
- `app_steam_tags`: `2,534,054`

## Landing strategy

Create near-lossless landing tables in `legacy`:

- `legacy.steam_genres`
- `legacy.app_genres`
- `legacy.steam_tags`
- `legacy.app_steam_tags`

Rules:

- preserve source primary keys
- preserve source column names wherever practical
- add only the indexes needed for Tiger-backed lookup paths
- do not redesign these tables into domain models yet

## Query-api behavior after backfill

After this slice is loaded:

- `searchCatalog` on Tiger should accept `genres`
- `searchCatalog` on Tiger should accept `tags`
- Tiger should stop returning `CONTRACT_RUNTIME_UNAVAILABLE` for those filters
  when the four taxonomy tables are present and non-empty

The contract should still return a typed runtime block if those tables are
missing in a new environment.

## Validation

At minimum, verify:

- exact row-count parity for the four taxonomy tables
- no orphan `legacy.app_genres.appid` rows relative to `legacy.apps`
- no orphan `legacy.app_steam_tags.appid` rows relative to `legacy.apps`
- no orphan `legacy.app_genres.genre_id` rows relative to `legacy.steam_genres`
- no orphan `legacy.app_steam_tags.tag_id` rows relative to `legacy.steam_tags`
- `searchCatalog` Tiger requests with `genres` and `tags` now return `200`

## Rollback

Before any downstream dependency is added, rollback is:

- drop `legacy.app_steam_tags`
- drop `legacy.steam_tags`
- drop `legacy.app_genres`
- drop `legacy.steam_genres`

Because these are landing tables only, rollback does not affect the Supabase
source database or any already-captured baseline artifacts.
