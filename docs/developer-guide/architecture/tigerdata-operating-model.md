# TigerData Operating Model

This document is the current source of truth for how PublisherIQ uses **TigerData (Timescale)** alongside Supabase and Cube.

**Last Updated:** May 1, 2026

## Summary

PublisherIQ is currently a **split-serving system**:

- **TigerData + R2** are primary for accepted and tested incoming ingestion/product-data paths that have been cut over.
- **Supabase** remains the control plane for auth/session/reference data, legacy reads, and product surfaces that are not proven Tiger-backed.
- **TigerData** serves the contract-backed read plane through `apps/query-api`, including YouTube coverage.
- **Cube.js** remains available for compatibility and legacy analytics reads that have not yet moved to typed contracts.

This is the live operating model today. It is not a future-state memo and it is not a full Supabase exit.

## Topology

### Production / Preview Shape

```text
Vercel Preview      -> Railway Preview query-api      -> Tiger Preview
Vercel Production   -> Railway Production query-api   -> Tiger Production

Accepted ingestion/product-data path:
Workers + PICS service -> TigerData + R2 where the writer path is enabled and verified
Supabase -> Tiger refresh workflows for retained/backfilled slices
Supabase + source DB -> @publisheriq/youtube -> Tiger targets
```

### Local Shape

```text
Local admin app      -> local query-api on 127.0.0.1:4318 -> TigerData target
Workers / scripts    -> TigerData/R2 for enabled writer paths; Supabase for retained/default paths
Tiger scripts        -> Supabase source + Tiger target for backfill/refresh
```

Local admin development can default to `http://127.0.0.1:4318` if `QUERY_API_BASE_URL` is unset. Deployed Vercel preview and production environments must set an explicit HTTPS `QUERY_API_BASE_URL`.

## Current Load-Sharing Matrix

| Area                     | Primary Write / Source Path                       | Primary Read Path                  | Primary Store | Notes                                              |
| ------------------------ | ------------------------------------------------- | ---------------------------------- | ------------- | -------------------------------------------------- |
| Auth and sessions        | Supabase                                          | admin app                          | Supabase      | OTP-first auth, callbacks, waitlist, roles         |
| Credits and chat logging | Supabase                                          | admin app                          | Supabase      | reservations, finalized charges, chat logs         |
| `/apps`                  | Supabase                                          | Supabase RPCs/views                | Supabase      | current page-serving path                          |
| `/companies`             | Supabase                                          | Supabase RPCs/views                | Supabase      | current page-serving path                          |
| `/insights`              | Supabase                                          | Supabase and Cube                  | Supabase      | not yet re-homed to TigerData                      |
| `/changes`               | Supabase                                          | Supabase RPCs/projections          | Supabase      | page stays on Supabase change surfaces             |
| `/admin`                 | Supabase                                          | Supabase RPCs/tables               | Supabase      | queue, catalog, CCU, usage, logs                   |
| Accepted product ingestion | TigerData/R2 writer surfaces where enabled       | `query-api` contracts or retained product reads | TigerData/R2 | do not infer every app route is Tiger-backed       |
| Chat contract reads      | TigerData-backed slices, some refreshed from Supabase | `query-api` contracts          | TigerData     | canonical path for supported families              |
| YouTube chat coverage    | Supabase source routing plus TigerData collector   | `query-api` contracts              | TigerData     | `getYoutubeGameCoverage` and `/api/chat/youtube-coverage` |
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
- YouTube coverage relations and daily rollups across `ops`, `docs`, `events`, and `metrics`
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
- `getYoutubeGameCoverage`
- `getUserContext`
- `continueResultSet`

These are served by `apps/query-api`. The admin app should consume them through HTTP, not by connecting directly to TigerData.

## Data Movement and Refresh Path

### 1. Ingest and normalize into the accepted target

Current accepted/tested incoming ingestion and product-data paths write to TigerData and, for archived payloads, R2 when their writer flags and environment variables are enabled. Supabase remains the target for retained/default paths and for surfaces that have not been proven Tiger-backed.

- catalog and metadata sync
- reviews, histograms, CCU, and derived metrics
- change-intel events and projections
- PICS latest-state enrichment and PICS history capture

Do not overclaim PICS latest-state cutover: the service supports `PICS_LATEST_STATE_TARGET=tiger`, but the default remains Supabase until the Tiger bootstrap SQL is present and the Railway service environment is explicitly flipped and verified. PICS change history can use Tiger/R2 when `PICS_CHANGE_HISTORY_TARGET=tiger` and object-storage archive configuration are present.

Auth, session state, credits, pins, alerts, logs, and other user/control-plane data remain Supabase-owned.

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
8. events/news performance delta
9. core identity seed

### 3. Backfill TigerData from the live source

The primary backfill flow is:

1. legacy compatibility slice
2. daily metrics slice
3. events/news slice
4. reconcile
5. validate

YouTube has a separate collector path and does not participate in this Tiger bootstrap/backfill order. It is loaded and refreshed by the `@publisheriq/youtube` scripts and GitHub Actions workflows described in the deployment guide.

### 4. Keep TigerData current

Scheduled GitHub Actions refresh selected TigerData slices from Supabase where Supabase remains the retained source or historical backfill source:

- production Tiger refresh runs daily
- preview Tiger refresh is manual
- reconcile and validate artifacts are uploaded for inspection
- YouTube bootstrap, sync, and preview-mirror workflows run separately and write directly to TigerData

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
`app_change_events` still has count-only drift, the workflow automatically
retries one bounded `app_change_events` reconcile/validate pass. When the
initial reconcile fails only because `docs.steam_news_search_projection` still
has historical month drift, the workflow automatically reruns a projection-only
`exact_parity` reconcile before the final validate step. Operators can still
select `projection_repair_scope=exact_parity` to force that historical repair
on the first reconcile pass, and can use the preview-only
`tiger-preview-events-news.yml` workflow for faster events/news recovery
verification without legacy or metrics backfills. When the goal is only to
confirm the classifier and routing logic, `stop_after_classification=true`
turns that preview workflow into a smoke test that skips retries, fallback, and
the final validate pass.

The exact-parity milestone note remains historical documentation, but the current operational expectation is that these validations continue to gate trust in the Tiger-backed document and change contracts.

## Environment Boundaries

### Admin / Vercel

Important environment variables:

- `QUERY_API_BASE_URL`
- `QUERY_API_BEARER_TOKEN`
- `CHAT_TIGER_PRIMARY_MODE`
- `CHAT_TIGER_SHADOW_MODE`
- `CHAT_TIGER_LEGACY_FALLBACK_ENABLED`
- `CHAT_TIGER_YOUTUBE_ENABLED`

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
- `DATA_PLANE_SOURCE_URL` / `DATABASE_URL` represent the retained live source for bootstrap, backfill, and local fallback cases.
- The admin app never needs `TIGER_PRIMARY_URL` directly.
- `CHAT_TIGER_YOUTUBE_ENABLED=true` exposes the YouTube coverage family in `/chat`; the contract itself remains available through `query-api`.
- PICS latest-state Tiger writes require `PICS_LATEST_STATE_TARGET=tiger` plus a Tiger URL in the Railway service environment; do not treat code support alone as runtime proof.
- PICS change-history Tiger/R2 writes require `PICS_CHANGE_HISTORY_TARGET=tiger` and object-storage archive configuration.

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
- YouTube bootstrap/sync workflow success and preview mirror completion for the `youtube:*` collector jobs

### Admin-side debugging

When chat results look wrong, inspect:

- query details in `/chat`
- admin chat logs
- execution traces
- contract summaries
- query-api health and readiness
- `/api/chat/youtube-coverage` responses and inline pagination when YouTube cards are involved

## What TigerData Does Not Own Yet

TigerData does **not** currently replace Supabase for:

- product-page reads for `/apps`, `/companies`, `/changes`, `/admin`
- auth and user/session state
- credits and chat logs
- reference/control-plane tables and legacy warehouse surfaces not proven Tiger-backed
- app runtime writes that have not been explicitly cut over and verified
- PICS latest-state writes unless the Railway environment is confirmed to use the Tiger target
- the YouTube collector's source routing and Tiger write path, which are owned by `@publisheriq/youtube`

TigerData should therefore be described as the **contract-serving read plane plus accepted primary product-data writer target**, not the universal product database.

## Related Documentation

- [System Overview](./overview.md)
- [Database Schema](./database-schema.md)
- [Sync Pipeline](./sync-pipeline.md)
- [Chat Data System](./chat-data-system.md)
- [Tiger Chat Production](../deployment/tiger-chat-production.md)
- [Query API README](../../../apps/query-api/README.md)
