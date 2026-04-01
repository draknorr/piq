# Tiger Core Identity Foundation

Date: March 31, 2026

This note defines the first post-bootstrap schema phase for Tiger.

It is based on the live source schema captured in `docs/reference/tiger-live-baseline/2026-03-31/schema.sql`.

## Source tables that feed `core`

- `public.apps`
- `public.developers`
- `public.publishers`
- `public.app_developers`
- `public.app_publishers`
- `public.app_dlc`

## Current source cardinality

- `apps`: `167,747`
- `developers`: `111,979`
- `publishers`: `96,336`
- `app_developers`: `183,251`
- `app_publishers`: `175,305`
- `apps` with `parent_appid`: `339`

These counts support a compact identity foundation write now. The heavy fact tables can wait until after entity mapping is in place.

## Canonical entity mapping

- `public.apps` maps to `core.entities` with:
  - `entity_kind = 'game'`
  - `platform = 'steam'`
  - `platform_entity_id = appid::text`
- `public.developers` maps to `core.entities` with:
  - `entity_kind = 'developer'`
  - `platform = 'publisheriq'`
  - `platform_entity_id = id::text`
- `public.publishers` maps to `core.entities` with:
  - `entity_kind = 'publisher'`
  - `platform = 'publisheriq'`
  - `platform_entity_id = id::text`

`entity_uid` must be generated with the existing deterministic helper in `packages/data-plane/src/identity.ts`:

- `buildEntityUid(platform, entityKind, platformEntityId)`

This preserves stable IDs across dev, staging, prod, and replays.

## Relationship mapping

- `public.app_developers` becomes `core.entity_relationships`
  - `game -> developer`
  - `relationship_type = 'developed_by'`
- `public.app_publishers` becomes `core.entity_relationships`
  - `game -> publisher`
  - `relationship_type = 'published_by'`
- `public.apps.parent_appid` becomes `core.entities.parent_entity_uid`
- `public.app_dlc` can later add an explicit `child_of` relationship where needed, but the parent pointer on `core.entities` is enough for the first pass

## Alias and external-ID mapping

- Every entity gets at least one canonical alias row from its source `name`
- `normalized_name` becomes a searchable alias row as well
- Platform IDs become `core.entity_external_ids`
  - `steam_appid`
  - `publisheriq_developer_id`
  - `publisheriq_publisher_id`

Current `steam_vanity_url` fields are empty for developers and publishers, so they do not need first-pass handling.

## Why this shape

This schema is intentionally small and lookup-oriented:

- enough structure for natural-language entity resolution
- enough provenance to trace every entity back to the live source
- enough relationship modeling for game/company queries
- no premature attempt to redesign every downstream aggregate

## Next Tiger write after bootstrap

Run `packages/data-plane/sql/tiger-bootstrap/0010_core_identity.sql`.

That write should still be treated as low to medium risk:

- it creates empty tables and indexes only
- it does not move source data yet
- rollback is dropping the four empty `core` tables before any backfill
