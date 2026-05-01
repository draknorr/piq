# Change-Intel Tiger/R2 Cutover Runbook

This runbook covers the accepted cutover state for Steam change intelligence.

Current state: Storefront/news/change-intel writer paths are Tiger/R2-primary when they run with `CHANGE_INTEL_WRITE_TARGET=tiger`, `DATA_WRITE_TARGET=tiger`, and `CHANGE_INTEL_ARCHIVE_TARGET=object_storage`. Supabase is retained for auth/session/reference/legacy surfaces and any product read path not proven Tiger-backed.

## Ownership

| Surface | Current owner | Notes |
| ------- | ------------- | ----- |
| Storefront latest-state writes from accepted workflows | Tiger | `storefront-sync.yml` and change-intel workers use Tiger writer envs |
| News/change events and projections | Tiger | `news-hot-refresh.yml`, `news-catchup.yml`, and Tiger sync/reconcile paths |
| Raw and normalized payload archives | R2/S3-compatible object storage | Required for Tiger change-intel archival |
| `/chat` change/news contracts | Tiger via `query-api` | `explainChanges`, `searchDocuments`, and related contract paths |
| `/changes` product page | Supabase unless separately proven | Do not assume this page has moved just because chat contracts have |
| Auth, sessions, credits, legacy reads | Supabase | Retained system |

## Required Environment

Set these on accepted change-intel workflows/services:

```bash
DATA_READ_TARGET=tiger
DATA_WRITE_TARGET=tiger
CHANGE_INTEL_READ_TARGET=tiger
CHANGE_INTEL_WRITE_TARGET=tiger
TIGER_PRIMARY_URL=<production tiger url>

CHANGE_INTEL_ARCHIVE_TARGET=object_storage
CHANGE_INTEL_ARCHIVE_BUCKET=publisheriq-change-intel-archive
CHANGE_INTEL_ARCHIVE_PREFIX=production/change-intel
CHANGE_INTEL_ARCHIVE_ENDPOINT=<cloudflare r2 endpoint>
CHANGE_INTEL_ARCHIVE_REGION=auto
CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID=<r2 access key>
CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY=<r2 secret key>
CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE=true
```

Do not include `SUPABASE_SERVICE_KEY` on Tiger writer jobs unless the process also has an approved non-product-write `SUPABASE_SERVICE_CLIENT_PURPOSE`.

## GitHub Gates

- `ENABLE_TIGER_CATALOG_WRITERS=true` allows scheduled app-list/storefront catalog writer jobs.
- `ENABLE_TIGER_METRICS_WRITERS=true` allows scheduled metric/product-derived writer jobs that may feed change-intel context.
- `ENABLE_LEGACY_SUPABASE_WRITERS=true` is only for approved legacy Supabase writer workflows. Keep it off for Tiger cutover.

Manual dispatch still works without the schedule gates and should be used for smoke tests first.

## Cutover Steps

1. Confirm Tiger bootstrap and events/news schema are present.
2. Confirm R2 bucket, prefix, endpoint, and credentials work from the runtime that will write archives.
3. Run a small manual `storefront-sync.yml` dispatch.
4. Run `news-hot-refresh.yml` manually with a small `claim_limit` and `refresh_limit`.
5. Inspect logs for Tiger write target and R2 archive writes.
6. Run parity/health checks:

```bash
pnpm --filter @publisheriq/ingestion change-intel-tiger-parity
node scripts/ops/audit-supabase-writers.mjs --fail-on-supabase-writers
```

7. Enable `ENABLE_TIGER_CATALOG_WRITERS=true` only after manual smoke is clean.
8. Leave legacy Supabase gates off unless a specific retained operation requires them.

## Verification

Check:

- workflow success
- no Supabase service-role credential on Tiger writer jobs
- Tiger rows for changed apps/news/events
- R2 objects under `production/change-intel`
- `query-api` health: `GET /healthz`, `GET /readyz`, authenticated `GET /v1/contracts`
- chat prompts for recent announcements/change explanations

Useful prompts:

- `Any recent announcements about Primeval?`
- `What changed for Primeval this week?`
- `Show only pricing changes for this game this month.`

## Rollback

Rollback is gate-based:

1. Disable `ENABLE_TIGER_CATALOG_WRITERS`.
2. Stop or scale down Railway change-intel worker services if they are part of the active write path.
3. Keep R2 objects; do not delete archives during rollback.
4. Re-enable a legacy Supabase writer only if the retained surface explicitly needs it and the operation has been approved.

Do not run destructive Tiger or Supabase cleanup as part of rollback. Treat cleanup as a separate approved database operation.

## Caveats

- Tiger/R2 is primary for accepted incoming change-intel writer paths, not for every product read surface.
- R2 archive success and Tiger row success are both required for a healthy history path.
- PICS contributes change-intel evidence through its own Railway service and has separate target flags; see [Railway](./railway.md).
- Storefront remains authoritative for parsed release dates and `is_free`; PICS is enrichment/fallback.
