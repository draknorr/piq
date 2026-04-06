# Query API

`apps/query-api` is the HTTP contract boundary between the admin app and the TigerData-backed data plane.

## Purpose

- Keep Vercel away from direct TigerData connections.
- Expose typed query contracts instead of raw SQL or prompt-shaped analytics.
- Serve the chat and search contracts that are now owned by the TigerData data plane.

## Contract Surface

Current ready contracts:

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
- `continueResultSet`

These contracts are what `/chat`, similarity routes, momentum screens, and recent-news/change-intel paths should use. The service is no longer a placeholder for future Tiger work.

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `GET /v1/contracts`
- `POST /v1/contracts/resolve-entities`
- `POST /v1/contracts/get-entity-overview`
- `POST /v1/contracts/get-related-entities`
- `POST /v1/contracts/search-catalog`
- `POST /v1/contracts/discover-momentum`
- `POST /v1/contracts/search-change-activity`
- `POST /v1/contracts/discover-change-patterns`
- `POST /v1/contracts/rank-entities`
- `POST /v1/contracts/compare-entities`
- `POST /v1/contracts/trace-metric-history`
- `POST /v1/contracts/explain-changes`
- `POST /v1/contracts/search-documents`
- `POST /v1/contracts/semantic-search`
- `POST /v1/contracts/get-user-context`
- `POST /v1/contracts/continue-result-set`

## Runtime Model

- `TIGER_PRIMARY_URL` is the primary connection string and should point at TigerData / Timescale.
- `DATA_PLANE_SOURCE_URL` is for live-source baseline/backfill workflows.
- `DATABASE_URL` is the Supabase fallback for local or source-side access.
- `query-api` loads from Tiger first, then source/baseline URLs only when the script explicitly intends to read the source database.

## Environment

- `TIGER_PRIMARY_URL`
- `DATA_PLANE_SOURCE_URL`
- `DATABASE_URL`
- `DATA_PLANE_MAX_POOL_SIZE`
- `DATA_PLANE_STATEMENT_TIMEOUT_MS`
- `QUERY_API_HOST`
- `QUERY_API_PORT`
- `QUERY_API_BEARER_TOKEN`

## Health And Readiness

- `GET /healthz` verifies the server is alive.
- `GET /readyz` verifies the data plane can reach the configured primary source and serve contracts.
- `GET /v1/contracts` returns the contract registry and source metadata.

## Deployment Notes

- Deploy preview and production `query-api` services separately.
- Keep preview and production TigerData connection strings separate.
- Keep `QUERY_API_BEARER_TOKEN` server-side only.
- Vercel preview and production must set `QUERY_API_BASE_URL`; localhost fallback is only for local development.

For Railway:

- build from `apps/query-api/Dockerfile`
- use the repo-root `/railway.toml` only for `query-api`
- set `QUERY_API_HOST=0.0.0.0`
- set `QUERY_API_BEARER_TOKEN`
- set `TIGER_PRIMARY_URL`
- set `DATA_PLANE_STATEMENT_TIMEOUT_MS=10000`
- set `DATA_PLANE_MAX_POOL_SIZE=5`

Do not reuse the repo-root Railway config for background workers. The
`change-intel-*` services should point at `/packages/ingestion/railway.json`
and continue running `pnpm --filter @publisheriq/ingestion change-intel-worker`
without an HTTP healthcheck.

## Local Development

- Local admin chat can point at `http://127.0.0.1:4318`.
- If `QUERY_API_BASE_URL` is unset outside Vercel preview/production, the app falls back to localhost.
- Use the local `query-api` process to exercise the same contract boundary the deployed app uses.

## Container Build

Build from the repo root so workspace packages are available:

```bash
docker build -f apps/query-api/Dockerfile -t publisheriq-query-api:staging .
```

Run locally:

```bash
docker run --rm -p 4318:4318 \
  -e TIGER_PRIMARY_URL \
  -e QUERY_API_BEARER_TOKEN \
  publisheriq-query-api:staging
```
