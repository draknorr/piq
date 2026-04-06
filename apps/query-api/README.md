# Query API

This service is the first step of the Tiger migration runtime split.

## Purpose

- Keep Vercel away from direct database connections
- Expose typed contracts that future `/chat` can use without forcing structured user input
- Bridge current live Postgres data into the new data-plane abstraction before Tiger is provisioned

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `GET /v1/contracts`
- `POST /v1/contracts/resolve-entities`
- `POST /v1/contracts/search-catalog`
- `POST /v1/contracts/rank-entities`
- `POST /v1/contracts/compare-entities`
- `POST /v1/contracts/trace-metric-history`
- `POST /v1/contracts/explain-changes`
- `POST /v1/contracts/search-documents`
- `POST /v1/contracts/semantic-search`
- `POST /v1/contracts/continue-result-set`

`search-documents` is now promoted to `ready` once the Tiger events/news
validate gate is green. It remains metadata-first and is intended for
news/topic lookups plus Tiger shadow chat coverage.

`semantic-search` is now served by the Tiger data plane itself. Admin chat and
similarity routes should proxy here instead of executing direct semantic
lookups inside the Next.js app.

## Environment

- `TIGER_PRIMARY_URL`
- `DATA_PLANE_SOURCE_URL`
- `DATABASE_URL`
- `DATA_PLANE_MAX_POOL_SIZE`
- `DATA_PLANE_STATEMENT_TIMEOUT_MS`
- `QUERY_API_HOST`
- `QUERY_API_PORT`
- `QUERY_API_BEARER_TOKEN`

`TIGER_PRIMARY_URL` is preferred. Until Tiger exists, the service falls back to `DATA_PLANE_SOURCE_URL` or `DATABASE_URL`.

## Staging / Canary Runtime Notes

For the first Tiger-primary rollout:

- deploy `query-api` behind a stable HTTPS endpoint in the same region as Tiger
- keep `QUERY_API_BEARER_TOKEN` server-side only
- point the admin app at the deployed endpoint with `QUERY_API_BASE_URL`
- use chat rollout envs in the admin app:
  - `CHAT_TIGER_PRIMARY_MODE=canary`
  - `CHAT_TIGER_SHADOW_MODE=canary`
  - `CHAT_TIGER_CANARY_USER_IDS=<comma-separated user ids>`

The chat runtime currently promotes only these prompt families to Tiger-owned visible answers:

- catalog search
- entity compare
- entity ranking
- metric history
- momentum discovery
- semantic search

News and change-intel can stay shadow-only while the live ingesting docs/events slice continues to drift.

## Railway Preview Deployment

For branch-preview testing, deploy `query-api` to Railway from the repo root.
This repo now includes [`railway.toml`](../../railway.toml) pointing at
[`apps/query-api/Dockerfile`](./Dockerfile).

Recommended Railway env:

- `TIGER_PRIMARY_URL`
- `QUERY_API_BEARER_TOKEN`
- `DATA_PLANE_STATEMENT_TIMEOUT_MS=10000`
- `DATA_PLANE_MAX_POOL_SIZE=5`
- `QUERY_API_HOST=0.0.0.0`

`query-api` now falls back to Railway's injected `PORT` if `QUERY_API_PORT` is
not set explicitly.

After deploy, verify:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/contracts`

Then point the Vercel preview at Railway with:

- `QUERY_API_BASE_URL=<railway https url>`
- `QUERY_API_BEARER_TOKEN=<same bearer token>`
- `CHAT_TIGER_PRIMARY_MODE=all`
- `CHAT_TIGER_SHADOW_MODE=off`
- `NEXT_PUBLIC_CHAT_TIGER_DEBUG=true`

## Railway Production Deployment

For production, keep a separate Railway service and a separate Tiger target.

Recommended production env:

- `TIGER_PRIMARY_URL`
- `QUERY_API_BEARER_TOKEN`
- `DATA_PLANE_STATEMENT_TIMEOUT_MS=10000`
- `DATA_PLANE_MAX_POOL_SIZE=5`
- `QUERY_API_HOST=0.0.0.0`

Then point Vercel production at that service with:

- `QUERY_API_BASE_URL=<production railway https url>`
- `QUERY_API_BEARER_TOKEN=<same production bearer token>`
- `CHAT_TIGER_PRIMARY_MODE=all`
- `CHAT_TIGER_SHADOW_MODE=off`
- `CHAT_TIGER_LEGACY_FALLBACK_ENABLED=false`

Do not share preview and production bearer tokens or Tiger connection strings.

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
