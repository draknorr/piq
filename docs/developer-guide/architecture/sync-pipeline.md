# Sync Pipeline

This document describes how PublisherIQ moves data from external sources into the warehouse and then into product-facing surfaces.

**Last Updated:** March 30, 2026

## Pipeline Summary

PublisherIQ has two ingestion families:

- **scheduled warehouse syncs** for catalog, metrics, reviews, CCU, and embeddings
- **change-intelligence runtimes** for recent storefront, media, news, projection, and PICS changes

## Scheduled Warehouse Syncs

The TypeScript workers in `packages/ingestion` handle the regular warehouse pipeline:

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
| `embedding-sync` | Qdrant embeddings |
| `refresh-views` | Materialized view refreshes |
| `change-intel-backfill-projection` | Seed projection refresh jobs for change-intel backfills |

## Change-Intelligence Pipeline

Change intelligence runs across three components.

### 1. Hint Seeding

`app-change-hints` pages `IStoreService/GetAppList`, stores the latest hint cursor in `sync_status`, and enqueues storefront capture work when the cursor changes.

### 2. Queue Draining

`change-intel-worker` drains `app_capture_work_state` for:

- `storefront`
- `news`
- `projection_refresh`
- `hero_asset`

It captures data, writes snapshots and versions, refreshes the change/news projections, and emits `app_change_events`.

### 3. PICS-Side History

`services/pics-service` runs in `bulk_sync`, `first_pass`, or `change_monitor` mode. `first_pass` pulls prioritized unsynced apps before the usual latest-state upserts, while the change monitor writes normalized PICS snapshots and PICS diff events inline.

## Operational Characteristics

- stale queue claims are automatically requeued through the worker’s stale-claim sweep
- canonical diffing normalizes JSON payloads before comparing them to reduce false positives from key-order churn
- projection refresh jobs update `change_activity_bursts`, `change_pattern_activity_days`, `change_pattern_app_windows`, and `steam_news_search_projection`
- `app_capture_work_state` keeps one live row per app/source pair and coalesces repeated dirty signals
- PICS history capture retries transient/schema-cache failures
- repeated PICS history failures trigger a short cooldown for historical writes while latest-state upserts continue

## Change Feed Read Path

The `/changes` page is backed by SQL read surfaces and internal APIs:

- `get_change_feed_bursts`
- `get_change_feed_burst_detail`
- `get_change_feed_news`
- `get_change_feed_activity`
- `/api/change-feed/activity/[activityId]`
- `/api/change-feed/status`

These provide grouped activity rows, news rows, detail drill-down, and capture health status.

Shared chat surfaces such as `get_chat_recent_news` and `search_recent_news_topics` use the same underlying projections, but they are not the primary `/changes` page contract.

## Authority Rules

- Storefront is authoritative for parsed `release_date` and `is_free`
- PICS is enrichment/fallback data
- when Storefront release text is not parseable, raw text is preserved instead of forcing invalid typed dates
- projection refresh is a derived read surface only and never the source of truth for Storefront values

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

## Related Documentation

- [Running Workers](../workers/running-workers.md)
- [Steam Change Intelligence](../workers/steam-change-intelligence.md)
- [Data Sources](./data-sources.md)
