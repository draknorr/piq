# Tiger DLC Source-First Deploy Checklist

Date: 2026-04-04

This runbook is for the DLC repair work that starts in the source Supabase
database and is replayed into Tiger later.

Use this after the branch containing the new source-side DLC repair code is
deployed to the live ingestion environment.

This checklist does not move ingestion jobs to Tiger.

## Goal

Make the live source database self-maintaining for DLC relations before adding
the missing Tiger compatibility table `legacy.app_dlc`.

The rule is:

- source first
- Tiger replay later

Do not apply Tiger
`packages/data-plane/sql/tiger-bootstrap/0021_legacy_relationship_context.sql`
until the source-side code is live and source has been reconciled once after
deploy.

## What Must Be Live

Deploy these pieces together:

- `supabase/migrations/20260405043000_seed_discovered_apps_and_hydrate_storefront.sql`
- `packages/ingestion/src/workers/storefront-worker.ts`
- `packages/ingestion/src/workers/applist-worker.ts`
- `services/pics-service/src/database/operations.py`

Expected live behavior after deploy:

- PICS seeds newly discovered DLC appids into `public.apps` as `stub`
- storefront hydrates resolvable stubs into real app rows
- storefront marks no-data stubs as `inaccessible`
- applist continues to promote canonical app rows to `hydrated`

## Immediate Post-Deploy Checks

Let the live ingestion environment run at least one normal cycle after deploy.

Then verify the source schema and function exist:

```bash
set -a
source .env
set +a

/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -At -F '|' -c "
select column_name, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'apps'
  and column_name = 'catalog_seed_state';

select proname
from pg_proc
where proname = 'seed_discovered_apps';
"
```

Expected:

- `catalog_seed_state` exists on `public.apps`
- `seed_discovered_apps` exists

## Source Reconciliation Pass

Run a one-time repair to seed anything that accumulated before the new code was
deployed:

```bash
set -a
source .env
set +a

pnpm --filter @publisheriq/ingestion repair-dlc-discovered-apps
```

Then hydrate unresolved stubs in batches:

```bash
set -a
source .env
set +a

BATCH_SIZE=100 pnpm --filter @publisheriq/ingestion hydrate-storefront-apps
```

Repeat the hydration command as needed until the rows you care about are no
longer stuck as `stub`.

`stub = 0` is not required globally.

## Readiness Checks

Check overall source seed-state counts:

```bash
set -a
source .env
set +a

/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -At -F '|' -c "
select catalog_seed_state, count(*)
from public.apps
group by catalog_seed_state
order by catalog_seed_state;
"
```

Check a specific parent app's DLC coverage. Example: Elden Ring `1245620`.

```bash
set -a
source .env
set +a

/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -At -F '|' -c "
select d.parent_appid,
       count(*) as total_links,
       count(*) filter (where a.catalog_seed_state = 'hydrated') as hydrated_links,
       count(*) filter (where a.catalog_seed_state = 'inaccessible') as inaccessible_links,
       count(*) filter (where a.catalog_seed_state = 'stub') as stub_links
from public.app_dlc d
left join public.apps a on a.appid = d.dlc_appid
where d.parent_appid = 1245620
group by d.parent_appid;
"
```

Optional row-level inspection for a known appid set:

```bash
set -a
source .env
set +a

/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -At -F '|' -c "
select a.appid,
       a.name,
       a.catalog_seed_state,
       a.type,
       s.storefront_accessible,
       to_char(s.last_storefront_sync at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
from public.apps a
left join public.sync_status s on s.appid = a.appid
where a.appid in (1799420,1896300,1896320,1922350,2778580,2778590,2855520,2855530)
order by a.appid;
"
```

## Gate Before Tiger 0021

Do not schedule Tiger `0021` until all of the following are true:

- the new source-side code is live
- live ingestion has completed at least one normal cycle after deploy
- `repair-dlc-discovered-apps` has been rerun once after deploy
- `hydrate-storefront-apps` has been rerun at least once after deploy
- the important DLC relations you care about are mostly `hydrated` or
  intentionally `inaccessible`, not still `stub`

You do not need:

- Tiger storefront sync jobs
- a Tiger cutover for ingestion
- zero global stubs in source

## Tiger Replay Day

When you are ready for strict Tiger DLC support:

1. Rerun the source repair pass.
2. Rerun source hydration.
3. Apply `packages/data-plane/sql/tiger-bootstrap/0021_legacy_relationship_context.sql`.
4. Immediately run `packages/data-plane/src/scripts/backfill-legacy-compatibility.ts`.
5. Verify Tiger now has:
   - `legacy.app_dlc`
   - hydrated DLC app rows in `legacy.apps`
   - no user-facing dependency on baseline fallback for DLC answers

## Why This Order Matters

The current live source database is still the write authority.

If Tiger `0021` is applied before source has the new code live and reconciled,
Tiger will inherit an incomplete DLC graph again.

This order avoids that:

- repair source once
- confirm source is now self-maintaining
- replay repaired source into Tiger

## Short Version

On deploy day:

1. Deploy the source-side code.
2. Let live ingestion run.
3. Run `repair-dlc-discovered-apps`.
4. Run `hydrate-storefront-apps`.
5. Verify source DLC rows look correct.

Later, in a separate Tiger window:

1. Rerun source repair and hydration.
2. Apply Tiger `0021`.
3. Run legacy backfill.
