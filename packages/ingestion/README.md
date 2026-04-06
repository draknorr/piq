# @publisheriq/ingestion

TypeScript workers and API clients for Steam ingestion, sync scheduling, and change intelligence.

**Last Updated:** April 2026

## Overview

This package provides:

- Steam, SteamSpy, reviews, storefront, CCU, and embedding clients
- scheduled sync workers for metadata and metrics
- the change-intelligence queue worker, hint seeding worker, and news hot-refresh paths
- repair and backfill scripts for review truth, CCU quality, and change-intel projections
- rate limiting, retry, and change-intel support utilities
- source-side preparation for TigerData refresh flows via the `@publisheriq/data-plane` package

## Core Commands

```bash
pnpm --filter @publisheriq/ingestion applist-sync
pnpm --filter @publisheriq/ingestion steamspy-sync
pnpm --filter @publisheriq/ingestion storefront-sync
pnpm --filter @publisheriq/ingestion reviews-sync
pnpm --filter @publisheriq/ingestion histogram-sync
pnpm --filter @publisheriq/ingestion calculate-trends
pnpm --filter @publisheriq/ingestion update-priorities
pnpm --filter @publisheriq/ingestion calculate-velocity
pnpm --filter @publisheriq/ingestion interpolate-reviews
pnpm --filter @publisheriq/ingestion ccu-sync
pnpm --filter @publisheriq/ingestion ccu-tiered-sync
pnpm --filter @publisheriq/ingestion ccu-daily-sync
pnpm --filter @publisheriq/ingestion embedding-sync
pnpm --filter @publisheriq/ingestion price-sync
pnpm --filter @publisheriq/ingestion refresh-views
pnpm --filter @publisheriq/ingestion alert-detection
pnpm --filter @publisheriq/ingestion app-change-hints
pnpm --filter @publisheriq/ingestion change-intel-worker
pnpm --filter @publisheriq/ingestion change-intel-backfill-projection
pnpm --filter @publisheriq/ingestion repair-current-ccu-state
pnpm --filter @publisheriq/ingestion repair-review-truth
pnpm --filter @publisheriq/ingestion reviews-queue-health
pnpm --filter @publisheriq/ingestion test:change-intel
```

## Change Intelligence

The change-intelligence runtime is split across two TypeScript workers plus the PICS service:

- `app-change-hints` reads Steam app list hints and seeds capture work when the hint cursor changes.
- `change-intel-worker` drains `app_capture_work_state` for `storefront`, `news`, `projection_refresh`, and `hero_asset`, including bounded news catch-up and hot-refresh paths.
- `services/pics-service` writes normalized PICS history snapshots and PICS diff events before latest-state upserts.

### Operational Notes

- Storefront and news queue work is requeued automatically when stale claims are detected.
- Canonical diffing normalizes JSON payloads before comparing them, which reduces false positives caused by key ordering.
- Storefront remains authoritative for parsed `release_date` and `is_free`; PICS is enrichment/fallback data.
- Recent news search projections and latest projections keep chat/news queries fast without depending on the legacy projection path.

## TigerData Refresh Workflows

TigerData refresh and parity workflows are not run from this package, but they are part of the same overall data pipeline:

- bootstrap SQL lives in `packages/data-plane/sql/tiger-bootstrap/`
- backfill and reconcile scripts live in `packages/data-plane/src/scripts/`
- scheduled Tiger syncs are triggered from GitHub Actions using the same package-level contract assumptions

The ingestion workers continue to own the live source side of the pipeline. TigerData owns the query-serving slice.

## Railway Worker Deployment

The production `change-intel-*` Railway services should use the dedicated worker
config at `/packages/ingestion/railway.json`.

- Keep the Railway service root directory at `/` so the worker build can see the
  workspace packages it imports from.
- Keep the start command as `pnpm --filter @publisheriq/ingestion change-intel-worker`.
- Do not attach the repo-root `/railway.toml` to these services. That file is
  reserved for `query-api`.
- Do not add an HTTP healthcheck to these workers. They are background queue
  processors, not web services.

### Important Environment Variables

```bash
CLAIM_LIMIT=25
POLL_INTERVAL_MS=5000
QUEUE_SOURCES=storefront,news,projection_refresh,hero_asset
NEWS_CATCHUP_SEED_LIMIT=10
MAX_IDLE_POLLS=0
CLAIM_STALE_AFTER_MS=1800000
STALE_CLAIM_SWEEP_INTERVAL_MS=60000
```

## Other Useful Environment Variables

```bash
BATCH_SIZE=500
MAX_PAGES=0
CCU_DAILY_LIMIT=150000
SYNC_COLLECTION=all
INTERPOLATION_DAYS=30
INTERPOLATION_APP_BATCH_SIZE=2000
```

## Package Layout

```text
src/
├── change-intel/             # Diffing, news, storefront, hashing, repository
├── workers/                  # Scheduled and long-running workers
├── workers-support/          # Shared runtime helpers
├── utils/                    # Retry and rate limiter
├── scripts/                  # Manual/debug scripts
└── index.ts                  # Package exports
```

## Validation

```bash
pnpm --filter @publisheriq/ingestion build
pnpm --filter @publisheriq/ingestion check-types
pnpm --filter @publisheriq/ingestion lint
pnpm --filter @publisheriq/ingestion test:change-intel

# transitive build smoke used by the Railway worker config
pnpm --filter @publisheriq/ingestion... build
```

## Related Documentation

- [Running Workers](../../docs/developer-guide/workers/running-workers.md)
- [Steam Change Intelligence](../../docs/developer-guide/workers/steam-change-intelligence.md)
- [Sync Pipeline](../../docs/developer-guide/architecture/sync-pipeline.md)
