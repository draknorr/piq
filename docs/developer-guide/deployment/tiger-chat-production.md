# Tiger Chat Production Deployment

This guide covers the production rollout for the Tiger/query-api contract runtime while the rest of
the site continues to run on the current Supabase and Cube paths.

Target topology:

- Vercel Preview -> Railway Preview `query-api` -> Tiger Preview database
- Vercel Production -> Railway Production `query-api` -> Tiger Production database
- Supabase remains the write authority
- TigerData powers the contract-serving query plane used by `/chat`, similarity, momentum, and change-intel routes

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

Then seed core identity:

10. `packages/data-plane/sql/tiger-bootstrap/0030_seed_core_identity_from_legacy.sql`

For an already-bootstrapped Tiger target, apply only the incremental identity delta:

1. `packages/data-plane/sql/tiger-bootstrap/0015_core_identity_loose_lookup.sql`
2. `packages/data-plane/sql/tiger-bootstrap/0030_seed_core_identity_from_legacy.sql`

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
- `NEXT_PUBLIC_CHAT_TIGER_DEBUG=true`

Production envs:

- `QUERY_API_BASE_URL=<production railway https url>`
- `QUERY_API_BEARER_TOKEN=<production bearer token>`
- `CHAT_TIGER_PRIMARY_MODE=all`
- `CHAT_TIGER_SHADOW_MODE=off`
- `CHAT_TIGER_LEGACY_FALLBACK_ENABLED=false`
- `NEXT_PUBLIC_CHAT_TIGER_DEBUG=false`

Important:

- `QUERY_API_BASE_URL` must be set explicitly in Vercel preview and production
- the admin app now refuses to silently fall back to `127.0.0.1:4318` on
  deployed Vercel environments

## 6. Enable Scheduled Tiger Refresh

GitHub Actions now includes:

- `.github/workflows/tiger-production-sync.yml`
- `.github/workflows/tiger-preview-sync.yml`

Required repository secrets:

- `DATABASE_URL`
- `TIGER_PRODUCTION_URL`
- `TIGER_PREVIEW_URL`

Production sync:

- runs daily
- assumes the Tiger target already has the full bootstrap set above
- does not apply migrations or bootstrap SQL itself
- refreshes the legacy compatibility slice
- replays the trailing metrics window into `metrics.daily_metrics`
- reconciles and validates the events/news slice
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
- starts with the same `recent_window` reconcile path and automatic
  projection-only exact-parity fallback as production
- supports the same `projection_repair_scope` input when an operator wants the
  first reconcile pass to use exact parity

## 7. Smoke Test Before Go-Live

Use preview first, then production.

Contract checks:

- authenticated `GET /v1/contracts`
- `searchCatalog`
- `rankEntities`
- `discoverMomentum`
- `traceMetricHistory`
- `searchDocuments`
- `explainChanges`

Chat prompts:

- `What free-to-play games have the most players right now?`
- `Show Counter-Strike 2 CCU over time`
- `What are the top games by reviews?`
- `What are the top indie games currently?`
- `Any recent announcements about Primeval?`

Expected outcome:

- source trail shows Tiger-backed contracts rather than legacy catalog-screen helpers
- Preview and Production each call their own Railway service
- production chat works without legacy fallback
