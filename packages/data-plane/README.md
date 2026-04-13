# @publisheriq/data-plane

TigerData-backed contract service, bootstrap SQL, and repair scripts for PublisherIQ.

## Overview

This package owns the TigerData-facing data plane:

- typed contract execution and contract registry metadata
- Tiger bootstrap SQL for the target database
- source-to-Tiger backfill and reconcile scripts
- target/source baseline capture utilities
- the contract source of truth used by `apps/query-api`
- the shipped YouTube contract family, including `getYoutubeGameCoverage`

The package is intentionally separate from `@publisheriq/database`, which remains the Supabase client/types package.

## Primary Role

- `query-api` loads this package to answer chat and search contracts.
- The package reads from TigerData for serving paths.
- The package reads from the live source database only for baseline, backfill, and reconcile workflows.

## Contract Surface

Current ready contracts include:

- `resolveEntities`
- `getEntityOverview`
- `getRelatedEntities`
- `searchCatalog`
- `discoverMomentum`
- `searchChangeActivity`
- `discoverChangePatterns`
- `rankEntities`
- `compareEntities`
- `traceMetricHistory`
- `explainChanges`
- `searchDocuments`
- `semanticSearch`
- `getUserContext`
- `getYoutubeGameCoverage`
- `continueResultSet`

The YouTube contract reads from the Tiger-side tables bootstrapped under
`packages/data-plane/sql/tiger-bootstrap/0060_youtube.sql` and backs the
admin-side `/api/chat/youtube-coverage` helper through `apps/query-api`.

## Scripts

```bash
pnpm --filter @publisheriq/data-plane capture-live-baseline
pnpm --filter @publisheriq/data-plane capture-target-baseline
pnpm --filter @publisheriq/data-plane backfill-legacy-compatibility
pnpm --filter @publisheriq/data-plane backfill-metrics-daily-metrics
pnpm --filter @publisheriq/data-plane backfill-events-news
pnpm --filter @publisheriq/data-plane reconcile-events-news
```

## Operational Flow

1. Capture live and target baselines before/after bootstrap windows.
2. Bootstrap TigerData schemas and target slices.
3. Backfill legacy compatibility, metrics history, and events/news.
4. Reconcile the events/news slice until parity is clean.
5. Validate the target and keep scheduled refreshes running after cutover.

## Environment

- `TIGER_PRIMARY_URL` for TigerData serving and target-side operations
- `DATA_PLANE_SOURCE_URL` for live source baseline/backfill reads
- `DATABASE_URL` for Supabase/source fallback reads

## Related Documentation

- [Tiger Chat Production](../../docs/developer-guide/deployment/tiger-chat-production.md)
- [Sync Pipeline](../../docs/developer-guide/architecture/sync-pipeline.md)
- [Database Schema](../../docs/developer-guide/architecture/database-schema.md)
- [YouTube Collector](../../packages/youtube/README.md)
