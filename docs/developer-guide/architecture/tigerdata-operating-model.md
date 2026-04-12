# TigerData Operating Model

This document is the current source of truth for how PublisherIQ uses **TigerData (Timescale)** alongside Supabase and Cube.

**Last Updated:** April 6, 2026

## Summary

PublisherIQ is currently a **split-serving system**:

- **Supabase** remains the write authority and control plane.
- **TigerData** serves the contract-backed read plane through `apps/query-api`.
- **Cube.js** remains available for compatibility and legacy analytics reads that have not yet moved to typed contracts.

This is the live operating model today. It is not a future-state memo and it is not a full Supabase exit.

## Topology

### Production / Preview Shape

```text
Vercel Preview      -> Railway Preview query-api      -> Tiger Preview
Vercel Production   -> Railway Production query-api   -> Tiger Production

Shared write/control path:
Workers + PICS service -> Supabase
Supabase -> Tiger refresh workflows -> Tiger targets
```

### Local Shape

```text
Local admin app      -> local query-api on 127.0.0.1:4318 -> TigerData target
Workers / scripts    -> Supabase live source by default
Tiger scripts        -> Supabase source + Tiger target
```

Local admin development can default to `http://127.0.0.1:4318` if `QUERY_API_BASE_URL` is unset. Deployed Vercel preview and production environments must set an explicit HTTPS `QUERY_API_BASE_URL`.

## Current Load-Sharing Matrix

| Area                     | Write Authority                                   | Primary Read Path                  | Primary Store | Notes                                              |
| ------------------------ | ------------------------------------------------- | ---------------------------------- | ------------- | -------------------------------------------------- |
| Auth and sessions        | Supabase                                          | admin app                          | Supabase      | OTP-first auth, callbacks, waitlist, roles         |
| Credits and chat logging | Supabase                                          | admin app                          | Supabase      | reservations, finalized charges, chat logs         |
| `/apps`                  | Supabase                                          | Supabase RPCs/views                | Supabase      | current page-serving path                          |
| `/companies`             | Supabase                                          | Supabase RPCs/views                | Supabase      | current page-serving path                          |
| `/insights`              | Supabase                                          | Supabase and Cube                  | Supabase      | not yet re-homed to TigerData                      |
| `/changes`               | Supabase                                          | Supabase RPCs/projections          | Supabase      | page stays on Supabase change surfaces             |
| `/admin`                 | Supabase                                          | Supabase RPCs/tables               | Supabase      | queue, catalog, CCU, usage, logs                   |
| Chat contract reads      | Supabase source materialized into TigerData       | `query-api` contracts              | TigerData     | canonical path for supported families              |
| Legacy chat analytics    | Supabase                                          | Cube compatibility or legacy reads | Supabase      | shrinking fallback layer                           |
| Semantic retrieval       | Supabase data embedded then loaded into TigerData | `query-api` -> `semanticSearch`    | TigerData     | no longer separate vector DB in the canonical path |

## What Lives In TigerData Today

TigerData is not a generic mirror of the full Supabase database. It contains the read slices needed for contract-backed chat and discovery.

### Primary TigerData schema groups

| Schema    | Purpose                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `core`    | entities and identity-backed cross-entity read models                     |
| `metrics` | time-series history, especially `metrics.daily_metrics`                   |
| `events`  | app change event history                                                  |
| `docs`    | news items and search projections                                         |
| `ops`     | operational metadata needed by data-plane flows                           |
| `chat`    | contract-serving or chat-oriented helper relations                        |
| `legacy`  | compatibility landing zone for slices still shaped like the old warehouse |

### Contract-serving relation categories

- entity resolution and current-overview relations
- catalog search relations
- momentum and ranking relations
- semantic retrieval inputs and embeddings
- change/news event and search relations
- user-context relations for pins and alerts

## Current Contract Surface

The live contract registry in `packages/data-plane/src/contract-registry.ts` currently marks all of these as `ready`:

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

These are served by `apps/query-api`. The admin app should consume them through HTTP, not by connecting directly to TigerData.

## Data Movement and Refresh Path

### 1. Ingest and normalize into Supabase

Workers and services write into Supabase first:

- catalog and metadata sync
- reviews, histograms, CCU, and derived metrics
- change-intel events and projections
- auth, user data, credits, pins, alerts, and logs
- PICS latest-state enrichment and PICS history capture

### 2. Bootstrap TigerData

Initial target setup uses ordered bootstrap SQL from `packages/data-plane/sql/tiger-bootstrap/`.

The key phases are:

1. extensions and schemas
2. core identity
3. legacy compatibility
4. taxonomy and relationship context
5. feature and user context
6. metrics daily history
7. events and news
8. core identity seed

### 3. Backfill TigerData from the live source

The primary backfill flow is:

1. legacy compatibility slice
2. daily metrics slice
3. events/news slice
4. reconcile
5. validate

### 4. Keep TigerData current

Scheduled GitHub Actions refresh selected TigerData slices from Supabase:

- production Tiger refresh runs daily
- preview Tiger refresh is manual
- reconcile and validate artifacts are uploaded for inspection

## Events / News Parity Expectations

The TigerData change/news slice is only considered ready when reconcile and validate runs stay green.

Important parity expectations:

- `docs.steam_news_items` matches the source
- `events.app_change_events` matches the source
- `docs.steam_news_search_projection` matches the source
- duplicate event IDs remain zero
- orphaned or projection-missing news rows remain zero

The scheduled production and preview sync workflows start with
`recent_window` projection repair by default so normal runs only chase the
trailing projection window. When the initial reconcile fails only because
`docs.steam_news_search_projection` still has historical month drift, the
workflow automatically reruns a projection-only `exact_parity` reconcile before
the final validate step. Operators can still select
`projection_repair_scope=exact_parity` to force that historical repair on the
first reconcile pass.

The exact-parity milestone note remains historical documentation, but the current operational expectation is that these validations continue to gate trust in the Tiger-backed document and change contracts.

## Environment Boundaries

### Admin / Vercel

Important environment variables:

- `QUERY_API_BASE_URL`
- `QUERY_API_BEARER_TOKEN`
- `CHAT_TIGER_PRIMARY_MODE`
- `CHAT_TIGER_SHADOW_MODE`
- `CHAT_TIGER_LEGACY_FALLBACK_ENABLED`

### Query API / Data Plane

Important environment variables:

- `TIGER_PRIMARY_URL`
- `DATA_PLANE_SOURCE_URL`
- `DATABASE_URL`
- `DATA_PLANE_MAX_POOL_SIZE`
- `DATA_PLANE_STATEMENT_TIMEOUT_MS`
- `QUERY_API_BEARER_TOKEN`

### Principle

- `TIGER_PRIMARY_URL` points at the TigerData target.
- `DATA_PLANE_SOURCE_URL` / `DATABASE_URL` represent the live source for bootstrap, backfill, and local fallback cases.
- The admin app never needs `TIGER_PRIMARY_URL` directly.

## Operational Checks

### Query API

Verify:

- `GET /healthz`
- `GET /readyz`
- authenticated `GET /v1/contracts`

Expected result:

- source reports `tiger`

### Tiger refresh workflows

Verify:

- workflow success
- uploaded manifest artifacts
- reconcile / validate outputs

### Admin-side debugging

When chat results look wrong, inspect:

- query details in `/chat`
- admin chat logs
- execution traces
- contract summaries
- query-api health and readiness

## What TigerData Does Not Own Yet

TigerData does **not** currently replace Supabase for:

- product-page reads for `/apps`, `/companies`, `/changes`, `/admin`
- auth and user/session state
- credits and chat logs
- general warehouse writes

TigerData should therefore be described as the **contract-serving read plane**, not the universal product database.

## Related Documentation

- [System Overview](./overview.md)
- [Database Schema](./database-schema.md)
- [Sync Pipeline](./sync-pipeline.md)
- [Chat Data System](./chat-data-system.md)
- [Tiger Chat Production](../deployment/tiger-chat-production.md)
- [Query API README](../../../apps/query-api/README.md)
