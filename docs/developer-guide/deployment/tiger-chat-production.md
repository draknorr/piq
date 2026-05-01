# Tiger Chat Production Deployment

This guide covers the production rollout for the Tiger/query-api contract runtime and the accepted Tiger/R2 ingestion writer paths. Supabase and Cube still exist for retained auth/session/reference/legacy surfaces and product pages not proven Tiger-backed.

Target topology:

- Vercel Preview -> Railway Preview `query-api` -> Tiger Preview database
- Vercel Production -> Railway Production `query-api` -> Tiger Production database
- TigerData powers the contract-serving query plane used by `/chat`, similarity, momentum, change-intel, and YouTube coverage routes
- Tiger/R2 is primary for accepted incoming ingestion/product-data writer paths that set Tiger write targets
- Supabase remains retained for auth/session/reference/legacy data and product surfaces not yet cut over

Do not treat this as a full Supabase exit. The cutover boundary is per writer/read surface.

## 1. Provision The Tiger Databases

Create two TigerData / Timescale services:

- preview / staging
- production

Keep them separate. Do not share the preview and production connection strings.

## 2. Bootstrap The Production Tiger Schema

Apply the Tiger bootstrap SQL in this order:

1. `packages/data-plane/sql/tiger-bootstrap/0001_extensions_and_schemas.sql`
2. `packages/data-plane/sql/tiger-bootstrap/0010_core_identity.sql`
3. `packages/data-plane/sql/tiger-bootstrap/0015_core_identity_loose_lookup.sql`
4. `packages/data-plane/sql/tiger-bootstrap/0020_legacy_compatibility.sql`
5. `packages/data-plane/sql/tiger-bootstrap/0021_legacy_taxonomy.sql`
6. `packages/data-plane/sql/tiger-bootstrap/0021_legacy_relationship_context.sql`
7. `packages/data-plane/sql/tiger-bootstrap/0022_legacy_feature_and_user_context.sql`
8. `packages/data-plane/sql/tiger-bootstrap/0040_metrics_daily_metrics.sql`
9. `packages/data-plane/sql/tiger-bootstrap/0050_events_and_news.sql`
10. `packages/data-plane/sql/tiger-bootstrap/0051_events_and_news_projection_performance.sql`

Then seed core identity:

11. `packages/data-plane/sql/tiger-bootstrap/0030_seed_core_identity_from_legacy.sql`

For an already-bootstrapped Tiger target, apply only the incremental deltas that
are not already present:

1. `packages/data-plane/sql/tiger-bootstrap/0015_core_identity_loose_lookup.sql`
2. `packages/data-plane/sql/tiger-bootstrap/0030_seed_core_identity_from_legacy.sql`
3. `packages/data-plane/sql/tiger-bootstrap/0051_events_and_news_projection_performance.sql`

Use `pnpm tiger:target-baseline` before and after the bootstrap window so you
have a recorded snapshot of the target service.

Scheduled Tiger syncs do not apply bootstrap SQL for you. The GitHub Actions
jobs assume this full bootstrap set is already present on the Tiger target
before `pnpm tiger:backfill-legacy` runs.

## 3. Load Production Tiger From Live Source

Set:

- `DATABASE_URL=<live supabase postgres url>`
- `TIGER_PRIMARY_URL=<production tiger url>`

Run the initial production load in this order:

1. `pnpm tiger:backfill-legacy`
2. `pnpm tiger:backfill-daily-metrics`
3. `pnpm tiger:backfill-events-news`
4. `EVENTS_NEWS_SYNC_MODE=reconcile pnpm tiger:reconcile-events-news`
5. `EVENTS_NEWS_SYNC_MODE=validate pnpm tiger:reconcile-events-news`

The same order applies to the preview Tiger database, but point
`TIGER_PRIMARY_URL` at the preview target instead of production.

Performance note:

- the live source Postgres should also be on the latest Supabase migrations so
  `public.steam_news_search_projection` includes
  `idx_steam_news_search_projection_sort_time_gid`

## 3.5. Enable Incoming Tiger/R2 Writers

Accepted incoming ingestion/product-data writers should use Tiger and R2 directly instead of writing fresh product data back to Supabase.

Core runtime variables:

| Variable | Use |
| -------- | --- |
| `DATA_READ_TARGET=tiger` | Read worker scheduling/state from Tiger when supported |
| `DATA_WRITE_TARGET=tiger` | Write catalog/metric/product-derived state to Tiger |
| `CHANGE_INTEL_READ_TARGET=tiger` | Read change-intel queue/state from Tiger |
| `CHANGE_INTEL_WRITE_TARGET=tiger` | Write storefront/news/change-intel rows to Tiger |
| `TIGER_PRIMARY_URL` | Target Tiger Postgres URL |
| `CHANGE_INTEL_ARCHIVE_TARGET=object_storage` | Store raw/normalized payload archives in R2/S3 |
| `CHANGE_INTEL_ARCHIVE_BUCKET` | R2/S3 archive bucket |
| `CHANGE_INTEL_ARCHIVE_PREFIX` | Prefix such as `production/change-intel` |
| `CHANGE_INTEL_ARCHIVE_ENDPOINT` | R2/S3 endpoint |
| `CHANGE_INTEL_ARCHIVE_REGION` | R2 commonly uses `auto` |
| `CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID` | R2/S3 access key |
| `CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY` | R2/S3 secret key |
| `CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE=true` | R2 path-style setting |

Scheduled writer gates in GitHub Actions:

| Gate | Enables |
| ---- | ------- |
| `ENABLE_TIGER_CATALOG_WRITERS=true` | App list, storefront, catalog/change-intel writer schedules |
| `ENABLE_TIGER_METRICS_WRITERS=true` | Reviews, price, SteamSpy, CCU, trends, velocity, interpolation, priority schedules |
| `ENABLE_TIGER_EMBEDDING_WRITER=true` | Embedding sync schedule |

Use manual dispatch first. For embeddings, set `max_batches=1` on `embedding-sync.yml` as the smoke test before enabling `ENABLE_TIGER_EMBEDDING_WRITER`.

Legacy Supabase writer schedules are intentionally gated separately with `ENABLE_LEGACY_SUPABASE_WRITERS=true`; keep this off except for an approved legacy operation.

## 4. Deploy Railway Query API

Create two Railway services from this repo using `apps/query-api/Dockerfile`:

- preview `query-api`
- production `query-api`

Set these variables on each service:

- `TIGER_PRIMARY_URL`
- `QUERY_API_BEARER_TOKEN`
- `QUERY_API_HOST=0.0.0.0`
- `DATA_PLANE_STATEMENT_TIMEOUT_MS=10000`
- `DATA_PLANE_MAX_POOL_SIZE=5`

Verify each service after deploy:

- `GET /healthz`
- `GET /readyz`
- authenticated `GET /v1/contracts`

Expected health shape:

- `source: "tiger"`

## 5. Configure Vercel

Preview envs:

- `QUERY_API_BASE_URL=<preview railway https url>`
- `QUERY_API_BEARER_TOKEN=<preview bearer token>`
- `CHAT_TIGER_PRIMARY_MODE=all`
- `CHAT_TIGER_SHADOW_MODE=off`
- `CHAT_TIGER_LEGACY_FALLBACK_ENABLED=false`
- `CHAT_TIGER_YOUTUBE_ENABLED=true` when the preview environment should expose YouTube coverage
- `NEXT_PUBLIC_CHAT_TIGER_DEBUG=true`

Production envs:

- `QUERY_API_BASE_URL=<production railway https url>`
- `QUERY_API_BEARER_TOKEN=<production bearer token>`
- `CHAT_TIGER_PRIMARY_MODE=all`
- `CHAT_TIGER_SHADOW_MODE=off`
- `CHAT_TIGER_LEGACY_FALLBACK_ENABLED=false`
- `CHAT_TIGER_YOUTUBE_ENABLED=true` when the production environment should expose YouTube coverage
- `NEXT_PUBLIC_CHAT_TIGER_DEBUG=false`

Important:

- `QUERY_API_BASE_URL` must be set explicitly in Vercel preview and production
- the admin app now refuses to silently fall back to `127.0.0.1:4318` on
  deployed Vercel environments

Supabase-facing product surfaces:

- keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for auth/session and client-side Supabase surfaces
- keep server-side Supabase service-role credentials only for approved auth/reference/legacy server paths
- set `SUPABASE_SERVICE_CLIENT_PURPOSE=auth`, `legacy-read`, `reference`, `migration`, or `parity` when a server process legitimately needs a Supabase service client while Tiger writer targets are enabled

## 6. Enable Scheduled Tiger Refresh

GitHub Actions now includes:

- `.github/workflows/tiger-production-sync.yml`
- `.github/workflows/tiger-preview-sync.yml`

Required repository secrets:

- `DATABASE_URL`
- `TIGER_PRODUCTION_URL`
- `TIGER_PREVIEW_URL`

Additional secrets for accepted Tiger/R2 ingestion paths:

- `CHANGE_INTEL_ARCHIVE_ENDPOINT`
- `CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID`
- `CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY`
- `QDRANT_URL`
- `QDRANT_API_KEY`
- `OPENAI_API_KEY`

Production sync:

- runs daily
- assumes the Tiger target already has the full bootstrap set above
- does not apply migrations or bootstrap SQL itself
- refreshes the legacy compatibility slice
- replays the trailing metrics window into `metrics.daily_metrics`
- reconciles and validates the events/news slice
- automatically retries one `app_change_events`-only reconcile/validate pass
  when the first reconcile fails only because `app_change_events` still has
  count-only drift and integrity checks remain zero
- starts with `recent_window` projection repair by default so daily runs only
  replay trailing projection churn
- automatically reruns a projection-only `exact_parity` reconcile when the
  first reconcile fails only because `docs.steam_news_search_projection` still
  has historical month drift
- still fails if the fallback path does not converge or any non-projection
  parity/integrity check fails
- supports manual `projection_repair_scope=exact_parity` when an operator wants
  the first reconcile pass to do historical projection repair immediately
- uploads manifest artifacts for each run

Preview sync:

- manual only
- uses the same sync path against the preview Tiger database
- uses the same app-change retry, recent-window-first reconcile path, and
  projection-only exact-parity fallback behavior as production
- supports the same `projection_repair_scope` input when an operator wants the
  first reconcile pass to use exact parity

Fast preview validation:

- use `.github/workflows/tiger-preview-events-news.yml` when you want to test
  only the events/news reconcile logic on preview without waiting for legacy or
  metrics backfills
- this workflow supports optional table narrowing through
  `events_news_tables=steam_news_items,app_change_events,steam_news_search_projection`
- set `stop_after_classification=true` when you only want to verify the initial
  failure classification and recovery routing without waiting for retry,
  exact-parity fallback, or final validate

## 7. Smoke Test Before Go-Live

Use preview first, then production.

Writer checks:

- `applist-sync.yml` manual dispatch with a small `max_apps`
- `storefront-sync.yml` manual dispatch with a small `batch_size`
- `embedding-sync.yml` manual dispatch with `max_batches=1`
- `node scripts/ops/audit-supabase-writers.mjs --fail-on-supabase-writers`
- R2 archive inventory for `production/change-intel`

Contract checks:

- authenticated `GET /v1/contracts`
- `searchCatalog`
- `rankEntities`
- `discoverMomentum`
- `traceMetricHistory`
- `searchDocuments`
- `explainChanges`
- `getYoutubeGameCoverage`
- `POST /api/chat/youtube-coverage` inline pagination

Chat prompts:

- `What free-to-play games have the most players right now?`
- `Show Counter-Strike 2 CCU over time`
- `What are the top games by reviews?`
- `What are the top indie games currently?`
- `Any recent announcements about Primeval?`
- `Show the latest YouTube videos for ARC Raiders`
- `Which YouTube creators are covering ARC Raiders this week?`
- `What YouTube videos are growing fastest for ARC Raiders?`

Expected outcome:

- source trail shows Tiger-backed contracts rather than legacy catalog-screen helpers
- Preview and Production each call their own Railway service
- production chat works without legacy fallback
- YouTube prompts render `youtube_game_activity` cards with inline pagination when the gate is enabled
- incoming accepted catalog, metric, embedding-status, storefront/news, and change-intel writes land in Tiger/R2
- Supabase remains present for auth/session/reference/legacy surfaces and is not considered fully retired
