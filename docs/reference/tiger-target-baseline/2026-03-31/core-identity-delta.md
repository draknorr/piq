# Core Identity Delta

Date: March 31, 2026

This note records the exact change between:

- `docs/reference/tiger-target-baseline/2026-03-31/post-bootstrap/`
- `docs/reference/tiger-target-baseline/2026-03-31/post-core-identity/`

## Result

The first post-bootstrap schema write completed successfully.

## Added tables

- `core.entities`
- `core.entity_aliases`
- `core.entity_external_ids`
- `core.entity_relationships`

## Added indexes and constraints

The write added the planned primary keys, lookup constraints, and search indexes, including:

- deterministic platform identity uniqueness on `core.entities`
- trigram indexes for canonical names and aliases
- external ID uniqueness on `(external_system, external_id)`
- directed relationship indexes on source and target entity lookups

## Row verification

All four `core` tables are still empty:

- `entities = 0`
- `entity_aliases = 0`
- `entity_external_ids = 0`
- `entity_relationships = 0`

## Scope confirmation

This write changed only the `core` schema.

It did not:

- load source data
- alter source systems
- create hypertables
- create any `metrics`, `events`, `docs`, `ops`, `chat`, or `legacy` tables

## Next step

The next schema write should create the `legacy` landing tables and the first explicit backfill SQL for:

- `apps`
- `developers`
- `publishers`
- `app_developers`
- `app_publishers`
