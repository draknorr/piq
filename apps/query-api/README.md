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
- `POST /v1/contracts/trace-metric-history`
- `POST /v1/contracts/explain-changes`
- `POST /v1/contracts/search-documents`

`search-documents` is now promoted to `ready` once the Tiger events/news
validate gate is green. It remains metadata-first and is intended for
news/topic lookups plus Tiger shadow chat coverage.

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
- entity ranking
- metric history

News and change-intel can stay shadow-only while the live ingesting docs/events slice continues to drift.

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
