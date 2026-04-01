# Tiger Bootstrap Delta

Date: March 31, 2026

This note records the exact change between:

- `docs/reference/tiger-target-baseline/2026-03-31/pre-bootstrap/`
- `docs/reference/tiger-target-baseline/2026-03-31/post-bootstrap/`

## Result

The first Tiger bootstrap write completed successfully.

## Added extensions

- `pg_trgm` `1.6`
- `pgcrypto` `1.4`
- `"uuid-ossp"` `1.1`

## Added schemas

- `chat`
- `core`
- `docs`
- `events`
- `legacy`
- `metrics`
- `ops`

## Table verification

No user tables were created by the bootstrap.

`diff -u` between `pre-bootstrap/relations.json` and `post-bootstrap/relations.json` returned no changes.

## Scope confirmation

The bootstrap changed only:

- extension inventory
- schema inventory

It did not:

- create application tables
- import any source data
- alter the Supabase source database
- create users or roles
- configure connection poolers or runtime app access

## Verified commands

Post-bootstrap verification confirmed:

- `pg_extension` contains `pg_trgm`, `pgcrypto`, and `"uuid-ossp"`
- `information_schema.schemata` contains all seven application schemas
- `information_schema.tables` contains zero rows for those schemas
