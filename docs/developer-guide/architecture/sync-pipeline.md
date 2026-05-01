# Sync Pipeline

This document describes how PublisherIQ moves data from external sources into the accepted Tiger/R2 and retained Supabase paths that feed TigerData-backed contract reads.

**Last Updated:** May 1, 2026

## Pipeline Summary

PublisherIQ currently has three data-plane roles:

- **TigerData + R2 product-data plane** for accepted/tested incoming ingestion and product-data writer paths
- **Supabase control/legacy plane** for auth, sessions, reference data, retained/default ingestion paths, queues, projections, and page-facing RPCs not proven Tiger-backed
- **TigerData read plane** for contract-backed chat, search/discovery, semantic retrieval, momentum, change/news, and YouTube contracts

That means the pipeline is now:

```text
source APIs
  -> workers / PICS service
  -> TigerData + R2 for accepted writer paths
  -> Supabase for retained/default paths
  -> Tiger bootstrap/backfill/refresh workflows where Supabase remains the source
  -> YouTube routing / discovery / refresh / rollup workflows
  -> query-api
  -> contract-backed reads
```

## Scheduled Warehouse Syncs

The TypeScript workers in `packages/ingestion` handle regular ingestion/product-data jobs. Accepted writer paths can target TigerData/R2; retained or legacy paths still use Supabase:

| Command | Purpose |
|---------|---------|
| `applist-sync` | Steam app catalog and app-list hints |
| `steamspy-sync` | Owners, playtime, and SteamSpy enrichment |
| `storefront-sync` | Storefront metadata and pricing |
| `reviews-sync` | Review totals and scores |
| `histogram-sync` | Review histogram history |
| `calculate-trends` | Derived trend metrics |
| `update-priorities` | Sync scheduling priorities |
| `calculate-velocity` | Review velocity tiers |
| `interpolate-reviews` | Fill review gaps |
| `ccu-sync` / `ccu-tiered-sync` / `ccu-daily-sync` | Exact CCU collection |
| `embedding-sync` | Embedding generation for the Tiger-backed retrieval pipeline |
| `refresh-views` | Materialized view refreshes |
| `change-intel-backfill-projection` | Seed projection refresh jobs for change-intel backfills |
| `repair-storefront-authority` | Repair missing storefront-authority fields before downstream refreshes |

Do not describe these workers as Supabase-only. Tiger writer surfaces exist for accepted product-data paths, while Supabase remains the target for retained/default worker flows and page-facing projections that have not been cut over.

## YouTube Collector Pipeline

The YouTube collector is a separate TigerData-facing pipeline in `@publisheriq/youtube`.

- `pnpm youtube:seed-routing` seeds per-game routing from the Steam-tracked cohort and writes `ops.youtube_game_routing`.
- `pnpm youtube:bootstrap-backfill` performs the initial historical discovery backfill into TigerData.
- `pnpm youtube:sync-discovery` and `pnpm youtube:sync-refresh` run the steady-state discovery and video-hydration passes.
- `pnpm youtube:rollup-daily` rebuilds `metrics.youtube_game_daily` and keeps the coverage summary current.
- `pnpm youtube:mirror-preview` mirrors production Tiger YouTube slices into preview Tiger for validation.

This collector reads the source database for routing state and writes the YouTube coverage slice directly into TigerData. It does not flow through the normal Supabase ingestion landing path.

## Change-Intelligence Runtime

Change intelligence is split: accepted incoming product-data writes can use Tiger/R2, while the `/changes` page and some projections still rely on Supabase-backed read surfaces.

### 1. Hint Seeding

`app-change-hints` pages `IStoreService/GetAppList`, stores the latest hint cursor in `sync_status`, and enqueues storefront capture work when the cursor changes.

### 2. Queue Draining

`change-intel-worker` drains `app_capture_work_state` for:

- `storefront`
- `news`
- `projection_refresh`
- `hero_asset`

It captures data, writes snapshots and versions, refreshes change/news projections, and emits `app_change_events`.

### 3. PICS-Side History

`services/pics-service` runs in `bulk_sync`, `first_pass`, or `change_monitor` mode. `first_pass` pulls prioritized unsynced apps before the usual latest-state upserts, while the change monitor writes normalized PICS snapshots and PICS diff events inline.

Do not overclaim latest-state cutover: PICS latest-state still defaults to Supabase unless `PICS_LATEST_STATE_TARGET=tiger` and the Tiger URL are present in the running Railway environment. PICS change history can write to Tiger/R2 when `PICS_CHANGE_HISTORY_TARGET=tiger` and object-storage archive settings are configured. App runtime writes should only be called Tiger-backed when that specific path has been tested.

## TigerData Bootstrap and Refresh Flow

TigerData is populated by accepted primary writer paths and by Supabase-to-Tiger bootstrap/backfill/refresh workflows for retained or historical slices. Do not treat every raw source API flow as direct-to-Tiger unless the writer path is enabled and verified.

### Bootstrap phases

Bootstrap SQL in `packages/data-plane/sql/tiger-bootstrap/` creates the target schemas and core contract-serving slices.

### Backfill flow

The ordered backfill flow is:

1. legacy compatibility slice
2. daily metrics slice
3. events/news slice
4. reconcile
5. validate

### Ongoing refresh

GitHub Actions now includes Tiger refresh workflows:

- production Tiger sync
- preview Tiger sync

Those workflows refresh selected slices from Supabase into the TigerData targets and upload manifest artifacts for parity review.
They do not manage the YouTube collector, which has its own `youtube-production-*` and `youtube-preview-mirror` workflows.

## Operational Characteristics

- stale queue claims are automatically requeued through the worker’s stale-claim sweep
- canonical diffing normalizes JSON payloads before comparing them to reduce false positives from key-order churn
- projection refresh jobs update `change_activity_bursts`, `change_pattern_activity_days`, `change_pattern_app_windows`, and `steam_news_search_projection`
- `app_capture_work_state` keeps one live row per app/source pair and coalesces repeated dirty signals
- PICS history capture retries transient/schema-cache failures
- repeated PICS history failures trigger a short cooldown for historical writes while latest-state upserts continue on their configured target

## Serving Split After Sync

After data lands:

- `/apps`, `/companies`, `/changes`, `/admin`, and most operational reads still use Supabase RPCs/views/tables
- `query-api` contracts read TigerData for chat/search/discovery families that have already moved, including `getYoutubeGameCoverage`
- Cube reads Supabase-backed analytical models for compatibility and page-level paths not yet cut over

## Authority Rules

- Storefront is authoritative for parsed `release_date` and `is_free`
- PICS is enrichment/fallback data
- projection refresh is a derived read surface only and never the source of truth for Storefront values
- TigerData/R2 is primary for accepted/tested incoming ingestion and product-data writer paths
- Supabase remains authoritative for auth/session/control data, reference data, legacy surfaces, and product surfaces not proven Tiger-backed
- TigerData is a contract-serving read target and accepted product-data write target, not a universal replacement for Supabase
- YouTube coverage data is written directly to TigerData by `@publisheriq/youtube`; Supabase only holds the source-side routing and operational state that the collector reads

## Useful Runtime Knobs

### Change-Intel Worker

```bash
CLAIM_LIMIT=25
POLL_INTERVAL_MS=5000
QUEUE_SOURCES=storefront,news,projection_refresh,hero_asset
NEWS_CATCHUP_SEED_LIMIT=10
MAX_IDLE_POLLS=0
CLAIM_STALE_AFTER_MS=1800000
STALE_CLAIM_SWEEP_INTERVAL_MS=60000
```

### Other Common Knobs

```bash
BATCH_SIZE=500
MAX_PAGES=0
CCU_DAILY_LIMIT=150000
SYNC_COLLECTION=all
```

## Validation

- `pnpm --filter @publisheriq/ingestion check-types`
- `pnpm --filter @publisheriq/ingestion test:change-intel`
- `cd services/pics-service && pytest`
- Tiger refresh and parity checks from `packages/data-plane` / GitHub Actions artifacts

## Related Documentation

- [TigerData Operating Model](./tigerdata-operating-model.md)
- [Running Workers](../workers/running-workers.md)
- [Steam Change Intelligence](../workers/steam-change-intelligence.md)
- [Data Sources](./data-sources.md)
