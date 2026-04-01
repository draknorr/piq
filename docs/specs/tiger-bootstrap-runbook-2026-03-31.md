# Tiger Bootstrap Runbook

Date: March 31, 2026

This runbook covers the first intentional Tiger write for PublisherIQ.

It is designed to be safe, reversible, and small in scope.

## Preconditions

- Live source baseline exists under `docs/reference/tiger-live-baseline/`.
- Tiger target baseline exists under `docs/reference/tiger-target-baseline/`.
- Tiger target is still empty apart from Timescale-managed schemas and extensions.
- No application or backfill jobs point at Tiger yet.

## Approved write set

Run `packages/data-plane/sql/tiger-bootstrap/0001_extensions_and_schemas.sql`.

This write set does only two things:

- enables supported source-parity extensions needed for migration compatibility
- creates the empty target schemas defined in the Timescale architecture plan

## Extensions included

- `pg_trgm`
- `pgcrypto`
- `"uuid-ossp"`

These are present on the live source today and are portable to Tiger.

This runbook intentionally does not include Supabase-specific extensions such as:

- `pg_graphql`
- `pg_cron`
- `supabase_vault`

## Schemas created

- `legacy`
- `core`
- `metrics`
- `events`
- `docs`
- `ops`
- `chat`

These schemas match the target layout in `docs/specs/timescale-architecture-plan-2026-03-30.md`.

## Risk

Low.

The target database is currently empty, and this step does not import data, mutate source data, or alter existing Tiger user data.

## Rollback

If the bootstrap needs to be reverted before any data load:

- drop the empty application schemas
- optionally drop the newly enabled extensions if they were not needed

Suggested rollback SQL:

```sql
DROP SCHEMA IF EXISTS chat CASCADE;
DROP SCHEMA IF EXISTS ops CASCADE;
DROP SCHEMA IF EXISTS docs CASCADE;
DROP SCHEMA IF EXISTS events CASCADE;
DROP SCHEMA IF EXISTS metrics CASCADE;
DROP SCHEMA IF EXISTS core CASCADE;
DROP SCHEMA IF EXISTS legacy CASCADE;

DROP EXTENSION IF EXISTS "uuid-ossp";
DROP EXTENSION IF EXISTS pgcrypto;
DROP EXTENSION IF EXISTS pg_trgm;
```

## Execution

Capture a labeled pre-bootstrap target snapshot:

```bash
set -a
source .env.tiger.local
BASELINE_CAPTURE_LABEL=pre-bootstrap pnpm tiger:target-baseline
```

Then run the Tiger bootstrap SQL:

```bash
set -a
source .env.tiger.local
/opt/homebrew/opt/libpq/bin/psql "$TIGER_PRIMARY_URL" -f packages/data-plane/sql/tiger-bootstrap/0001_extensions_and_schemas.sql
```

## Verification

After execution, confirm:

- the three extensions are enabled
- the seven application schemas exist
- no user tables were created yet
- a labeled post-bootstrap snapshot exists alongside the pre-bootstrap snapshot

Capture the post-bootstrap target snapshot:

```bash
set -a
source .env.tiger.local
BASELINE_CAPTURE_LABEL=post-bootstrap pnpm tiger:target-baseline
```

## What comes next

After this bootstrap is accepted:

- create the platform-native identity tables in `core`
- create migration landing tables in `legacy`
- create the first hypertables in `metrics` and `events`
- start bulk-copy planning table by table from the live source baseline
