# @publisheriq/youtube

Direct-to-Tiger YouTube collector for tracked Steam games and the shipped YouTube chat contract family.

## Overview

This package owns the collector side of YouTube support:

- routing and cohort seeding for tracked games
- historical bootstrap and backfill work
- sparse discovery and cheap refresh passes
- daily rollups for the YouTube game metrics served through `apps/query-api`
- preview mirroring for parity checks before promotion

The query-serving side lives in `apps/query-api` and `@publisheriq/data-plane`.

## Operator Workflow

Typical order of operations:

1. seed or refresh routing state for the tracked cohort
2. run the historical bootstrap/backfill when a new slice is introduced
3. run discovery to find new candidate videos
4. run refresh to hydrate known videos cheaply
5. run the daily rollup after fresh snapshots land
6. use preview mirroring to compare a preview target against production when needed

## Scripts

```bash
pnpm --filter @publisheriq/youtube seed-routing
pnpm --filter @publisheriq/youtube bootstrap-backfill
pnpm --filter @publisheriq/youtube sync-discovery
pnpm --filter @publisheriq/youtube sync-refresh
pnpm --filter @publisheriq/youtube rollup-daily
pnpm --filter @publisheriq/youtube mirror-preview
```

## What Each Script Does

- `seed-routing` initializes or repairs tracked-game routing state.
- `bootstrap-backfill` loads historical YouTube data for the current cohort.
- `sync-discovery` runs sparse search-based discovery for new candidate videos.
- `sync-refresh` rehydrates already matched videos with cheap ID-based API calls.
- `rollup-daily` computes the per-game daily metrics consumed by the chat contract.
- `mirror-preview` mirrors production YouTube state into a preview target for comparison.

## Environment

- `TIGER_PRIMARY_URL`: target Tiger database for writes and rollups
- `DATABASE_URL` or `YOUTUBE_SOURCE_DATABASE_URL`: source database for routing and bootstrap reads
- `YOUTUBE_API_KEY`: required for discovery and refresh
- `YOUTUBE_WRITE_TARGET`: explicit write target, `production` or `preview`
- `YOUTUBE_MIRROR_SOURCE_URL`: production Tiger when running preview mirror
- `.env.youtube.local`: optional local operator env file

## Related Documentation

- [Query API](../../apps/query-api/README.md)
- [Tiger Data Plane](../../packages/data-plane/README.md)
- [YouTube Chat Interface](../../docs/user-guide/chat-interface.md)
