# Running Workers Manually

Use these commands for testing, debugging, or bounded manual runs.

## Common Commands

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
pnpm --filter @publisheriq/ingestion repair-storefront-authority
pnpm youtube:seed-routing
pnpm youtube:bootstrap-backfill
pnpm youtube:sync-discovery
pnpm youtube:sync-refresh
pnpm youtube:rollup-daily
pnpm youtube:mirror-preview
```

`refresh-views` refreshes the heavyweight materialized-view chain only. `app_filter_data` is refreshed by GitHub Actions, and the small Games page filter-count views are refreshed by `pg_cron`.

`repair-storefront-authority` repairs missing storefront fields (`is_free`, `is_released`, `release_date`) before downstream refreshes or change-intel reruns. The `youtube:*` scripts run the direct-to-Tiger YouTube collector and do not touch the Supabase ingestion path.

## Useful Environment Overrides

```bash
BATCH_SIZE=100
MAX_PAGES=5
CCU_DAILY_LIMIT=10000
SYNC_COLLECTION=games
```

## Change-Intel Manual Runs

### Seed Hints

```bash
pnpm --filter @publisheriq/ingestion app-change-hints
```

### Drain Only News Jobs

```bash
QUEUE_SOURCES=news MAX_IDLE_POLLS=10 pnpm --filter @publisheriq/ingestion change-intel-worker
```

### Drain Only Storefront Jobs

```bash
QUEUE_SOURCES=storefront MAX_IDLE_POLLS=10 pnpm --filter @publisheriq/ingestion change-intel-worker
```

### Drain Only Projection Refresh Jobs

```bash
QUEUE_SOURCES=projection_refresh MAX_IDLE_POLLS=10 pnpm --filter @publisheriq/ingestion change-intel-worker
```

### Relevant Change-Intel Knobs

```bash
CLAIM_LIMIT=25
POLL_INTERVAL_MS=5000
NEWS_CATCHUP_SEED_LIMIT=10
CLAIM_STALE_AFTER_MS=1800000
STALE_CLAIM_SWEEP_INTERVAL_MS=60000
```

### PICS First Pass

```bash
cd services/pics-service
MODE=first_pass python3 -m src.main
```

### YouTube Collector

```bash
pnpm youtube:seed-routing
pnpm youtube:bootstrap-backfill
pnpm youtube:sync-discovery
pnpm youtube:sync-refresh
pnpm youtube:rollup-daily
pnpm youtube:mirror-preview
```

Required environment:

- `TIGER_PRIMARY_URL`
- `DATABASE_URL` or `YOUTUBE_SOURCE_DATABASE_URL`
- `YOUTUBE_API_KEY`
- `YOUTUBE_WRITE_TARGET`

## Validation

```bash
pnpm --filter @publisheriq/ingestion check-types
pnpm --filter @publisheriq/ingestion test:change-intel
```

For the PICS service:

```bash
cd services/pics-service
pytest
```

## Related Documentation

- [Steam Change Intelligence](./steam-change-intelligence.md)
- [Sync Pipeline](../architecture/sync-pipeline.md)
