# Tiger Storage And Preview Ops

This runbook covers storage and preview operations for Tiger/R2-backed deployment paths.

Current state: production accepted ingestion/product-data writers can be Tiger/R2-primary, while Supabase remains retained for auth/session/reference/legacy surfaces. Preview Tiger is a separate target and must not share a connection string with production.

## Storage Inventory

| Store | Purpose | Caveat |
| ----- | ------- | ------ |
| Tiger Production | Accepted production contract reads and Tiger writer state | Not a full Supabase replacement |
| Tiger Preview | Preview validation and manual sync target | Keep isolated from production |
| R2/S3 archive bucket | Change-intel and PICS normalized/raw archives | Required for Tiger history writers |
| Supabase | Auth/session/reference/legacy and source reads | Still required |
| Qdrant | Embedding vector store | Embedding status writes are Tiger-gated |

## R2 Environment

Use the same archive variable family across GitHub Actions, change-intel workers, and PICS history writers:

```bash
CHANGE_INTEL_ARCHIVE_TARGET=object_storage
CHANGE_INTEL_ARCHIVE_BUCKET=publisheriq-change-intel-archive
CHANGE_INTEL_ARCHIVE_PREFIX=production/change-intel
CHANGE_INTEL_ARCHIVE_ENDPOINT=<cloudflare r2 endpoint>
CHANGE_INTEL_ARCHIVE_REGION=auto
CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID=<r2 access key>
CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY=<r2 secret key>
CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE=true
```

For preview-only archive tests, use a preview prefix such as `preview/change-intel` if the script/service supports it. Do not point preview write tests at a production prefix unless the run is read-only or explicitly approved.

## Preview Tiger Refresh

Use GitHub Actions:

- `tiger-preview-sync.yml` for full preview Tiger refresh from the live source.
- `tiger-preview-events-news.yml` for a faster events/news reconcile smoke.
- `youtube-preview-mirror.yml` for YouTube slices.

Recommended preview smoke:

1. Run `tiger-preview-events-news.yml` with `stop_after_classification=true`.
2. If classification is clean or recoverable, rerun without `stop_after_classification`.
3. Run `tiger-preview-sync.yml` only when you need the full legacy/metrics/events-news preview target refreshed.
4. Verify preview `query-api` with authenticated `GET /v1/contracts`.

## Embedding Smoke

Use manual dispatch of `embedding-sync.yml`:

| Input | Smoke value |
| ----- | ----------- |
| `sync_collection` | `all`, or a single collection if debugging |
| `batch_size` | `100` or smaller |
| `max_batches` | `1` |

Expected behavior:

- the job uses `DATA_READ_TARGET=tiger`
- the job uses `DATA_WRITE_TARGET=tiger`
- `MAX_BATCHES=1` stops after one batch per selected collection path
- Qdrant receives vectors and Tiger receives embedding status updates

Leave `ENABLE_TIGER_EMBEDDING_WRITER` off until the manual smoke is clean.

## Hero Asset And Archive Ops

Useful scripts:

```bash
pnpm --filter @publisheriq/ingestion change-intel-copy-hero-assets-to-r2
pnpm --filter @publisheriq/ingestion change-intel-tiger-backfill-archives
pnpm --filter @publisheriq/ingestion change-intel-tiger-backfill-bulk
```

Important controls:

| Variable | Use |
| -------- | --- |
| `HERO_ASSET_R2_COPY_MODE` | `inventory`, `copy`, `delta-copy`, or `verify` |
| `HERO_ASSET_R2_COPY_DRY_RUN` | Keep `true` for inventory/smoke |
| `HERO_ASSET_R2_COPY_LIMIT` | Bound copy/verify runs |
| `HERO_ASSET_R2_COPY_PREFIXES` | Restrict object prefixes |
| `CHANGE_INTEL_TIGER_BULK_DRY_RUN` | Keep true until ready for bulk writes |
| `CHANGE_INTEL_TIGER_BACKFILL_DRY_RUN` | Keep true until ready for archive backfill writes |

Do inventory/verify before copy. Do not delete source objects as part of these scripts.

## PICS Storage Caveats

PICS has two independent target flags:

| Variable | Controls |
| -------- | -------- |
| `PICS_CHANGE_HISTORY_TARGET` | PICS `app_source_snapshots` and `app_change_events`; requires R2 when set to `tiger` |
| `PICS_LATEST_STATE_TARGET` | PICS app, relationship, sync-status, and cursor writes |

Use `MODE=first_pass` with a small `FIRST_PASS_BATCH_LIMIT` to smoke newly discovered app coverage. Use `MODE=change_monitor` only after the target flags, Tiger URL, and archive settings are verified.

## Writer Audit

Before enabling a scheduled writer gate or after changing workflow envs, run:

```bash
node scripts/ops/audit-supabase-writers.mjs --fail-on-supabase-writers
```

A clean audit does not prove product readiness by itself; it only catches unexpected active Supabase write credentials/paths.

## Recovery Notes

- Prefer disabling schedule gates over changing secrets during an incident.
- Preserve R2 objects and Tiger manifests for investigation.
- Never share production and preview Tiger URLs.
- Supabase backup/restore does not cover Tiger/R2-primary history and writer state.
