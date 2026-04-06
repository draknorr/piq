# @publisheriq/youtube

Direct-to-Tiger YouTube collector for tracked Steam games.

## Scripts

```bash
pnpm --filter @publisheriq/youtube seed-routing
pnpm --filter @publisheriq/youtube bootstrap-backfill
pnpm --filter @publisheriq/youtube sync-discovery
pnpm --filter @publisheriq/youtube sync-refresh
pnpm --filter @publisheriq/youtube rollup-daily
pnpm --filter @publisheriq/youtube mirror-preview
```

## Environment

- `TIGER_PRIMARY_URL`: target Tiger database
- `DATABASE_URL` or `YOUTUBE_SOURCE_DATABASE_URL`: Steam/source database for routing
- `YOUTUBE_API_KEY`: required for discovery and refresh
- `YOUTUBE_WRITE_TARGET`: explicit write target, `production` or `preview`
- `YOUTUBE_MIRROR_SOURCE_URL`: production Tiger when running preview mirror
- `.env.youtube.local`: optional local operator env file
