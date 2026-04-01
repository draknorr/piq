# Source To Target Gap

Date: March 31, 2026

This note compares the live Supabase source baseline with the empty Tiger target baseline captured on the same day.

## Engine versions

- Source: PostgreSQL `17.6`
- Target: PostgreSQL `18.3`

The major-version difference is acceptable for migration planning, but extension and DDL compatibility should be checked on every bootstrap step.

## Source-only extensions

The live source has these extensions that are not enabled on Tiger yet:

- `pg_trgm`
- `pgcrypto`
- `"uuid-ossp"`

These are the first compatibility extensions to enable on Tiger.

## Source-only Supabase platform extensions

These exist on the source but should not be migrated as part of the Tiger bootstrap:

- `pg_cron`
- `pg_graphql`
- `supabase_vault`

They are Supabase platform concerns, not core PublisherIQ data-plane requirements.

## Tiger-only default extensions

These are already present on the Tiger target:

- `pg_buffercache`
- `pg_stat_statements`
- `postgres_fdw`
- `timescaledb`
- `timescaledb_toolkit`

These are expected Tiger defaults and do not need to be removed for the migration.

## Application schemas

The source contains the current application data under `public` plus Supabase-managed schemas.

The Tiger target does not yet contain the application schemas from the architecture plan:

- `legacy`
- `core`
- `metrics`
- `events`
- `docs`
- `ops`
- `chat`

Creating these empty schemas is the correct first write because it gives the migration a stable layout without loading data yet.

## Large source relations that drive migration order

The heaviest source relations remain:

- `public.steam_news_versions` at about `4768 MB`
- `public.app_change_events` at about `3161 MB`
- `public.steam_news_search_projection` at about `2991 MB`
- `public.daily_metrics` at about `2069 MB`
- `public.app_source_snapshots` at about `1956 MB`
- `public.ccu_snapshots` at about `1888 MB`

This reinforces the planned order:

- bootstrap Tiger schemas first
- land hot analytical and operational tables next
- keep cold archives out of the initial hot Tiger layout

## First write recommendation

Execute only `packages/data-plane/sql/tiger-bootstrap/0001_extensions_and_schemas.sql`.

That write is intentionally small:

- no source writes
- no data copy
- no destructive target action
- no role or permission changes yet

After that succeeds, the next safe phase is designing the `core` identity tables and `legacy` landing tables before any bulk data movement begins.
