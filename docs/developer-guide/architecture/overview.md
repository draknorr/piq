# System Architecture Overview

PublisherIQ is a Steam analytics platform with three main product surfaces:

- analytics pages for games, companies, and insights
- a Change Feed for recent storefront, media, PICS, and news activity
- an AI chat interface over curated catalog, momentum, semantic, and change-intelligence contracts

**Last Updated:** May 1, 2026

## High-Level Stack

| Layer | Technology | Current Role |
|-------|------------|--------------|
| Frontend | Next.js 15 + React 19 | Signed-in dashboard and public entry surfaces |
| Write / Control Plane | Supabase Postgres | auth, sessions, user/control data, reference data, legacy warehouse surfaces, and product reads not proven Tiger-backed |
| Semantic Layer | Cube.js | legacy and compatibility analytics reads that still have not moved to Tiger-backed contracts |
| Product Data Plane | TigerData + R2 | accepted/tested incoming ingestion and product-data writer paths, archived evidence payloads, and contract-serving slices |
| Contract Read Plane | `apps/query-api` + `packages/data-plane` | TigerData-backed typed contracts for chat, semantic retrieval, momentum, change search, news search, YouTube coverage, and continuation |
| TS Workers | `@publisheriq/ingestion` + `@publisheriq/youtube` | scheduled syncs, queue workers, change-intel maintenance, and YouTube collector jobs |
| Python Service | `services/pics-service` | PICS ingestion, latest-state enrichment, and PICS history capture |

## Current Serving Model

PublisherIQ currently runs as a **split data plane**, not a single-database application:

- **TigerData + R2** are primary for accepted and tested incoming ingestion/product-data paths that have been cut over.
- **Supabase** is retained for auth/session data, user/control state, reference data, legacy reads, product RPCs, and page reads that are not proven Tiger-backed.
- **TigerData (Timescale)** is the read-optimized target for contract-backed chat and search/discovery paths, served only through `query-api`.
- **Cube.js** still exists for compatibility and legacy analytics reads while those prompt families and page-level data flows continue to be migrated.

The important boundary is:

- Vercel should call `query-api`
- `query-api` should call TigerData
- Vercel should not connect directly to TigerData

## Current Load Sharing

| Surface | Primary Read Path | Primary Store | Notes |
|--------|-------------------|---------------|-------|
| `/chat` supported contract families | `/api/chat/stream` -> `query-api` | TigerData | canonical path for entity resolution, catalog search, momentum, semantic, news/change analysis, YouTube coverage, user context, and continuation |
| Chat auth, credits, logging | admin app + Supabase | Supabase | sessions, rate limiting, reservations, logs, and final billing remain on Supabase |
| `/apps` | Supabase RPCs/views | Supabase | page-serving path remains Supabase-first today |
| `/companies` | Supabase RPCs/views | Supabase | page-serving path remains Supabase-first today |
| `/insights` | Supabase + Cube compatibility reads | Supabase | not yet re-homed to TigerData |
| `/changes` | Supabase RPCs and projections | Supabase | change-feed page still reads Supabase projections and read surfaces |
| `/admin` | Supabase RPCs and tables | Supabase | admin stats, queue state, and logs remain on Supabase |
| Legacy analytics in chat | Cube.js compatibility path | Supabase | shrinking compatibility layer, still present for some non-contract prompt patterns |

## Runtime Topology

```text
Steam APIs / Steam News / SteamSpy / PICS
        ↓
TypeScript workers + PICS service + @publisheriq/youtube
        ↓
TigerData + R2
  - accepted product-data writer paths
  - archived normalized/evidence payloads where configured
Supabase
  - retained/default source paths
  - legacy warehouse tables
  - queues and operational state
  - auth, credits, and chat logs
  - page-facing RPCs and projections
        ↓
Tiger refresh / bootstrap / reconcile workflows
YouTube routing / discovery / refresh / rollup workflows
        ↓
TigerData + query-api
  - typed contract-serving read plane
  - semantic retrieval and continuation
  - momentum, entity, change, news, and YouTube contracts
        ↓
Next.js dashboard
```

## Major Subsystems

### Dashboard App

The dashboard in `apps/admin` owns:

- OTP-first login and callback handling
- games, companies, insights, chat, and Change Feed pages
- admin pages for users, waitlist, usage, and system health
- internal APIs for chat, alerts, pins, and Change Feed

### Supabase Retained Control And Legacy Plane

Supabase remains online for retained control-plane, reference, and legacy data:

- auth/session state and retained account records
- historical warehouse/reference tables and materialized views
- legacy product read surfaces and admin/debugging data not proven Tiger-backed
- app runtime data such as credits, chat logs, pins, and alerts unless a route is explicitly documented as Tiger-backed
- parity/reference data used to compare Tiger/R2 cutover behavior

Do not add new incoming product or ingestion writes to Supabase. Accepted/tested ingestion paths write to TigerData and R2 directly, while unproven legacy surfaces stay read-only or retained until separately migrated.

### TigerData Contract Read Plane

TigerData currently serves the contract-backed chat/search runtime through `apps/query-api` and `packages/data-plane`.

Live contract families include:

- entity resolution and overview
- related entities / DLC / franchise context
- broad catalog discovery
- momentum and breakout discovery
- cross-game change discovery and pattern discovery
- ranking and comparison
- metric history
- change explanation
- news/document search
- semantic search
- YouTube game coverage and structured video activity
- user context
- continuation

### Cube.js Compatibility Layer

Cube remains in the stack for:

- older analytics prompt families still routed through compatibility logic
- page-level or legacy analytics surfaces that have not yet moved to a typed Tiger-backed contract

Cube should be treated as a compatibility dependency, not the long-term contract boundary for chat.

## Change-Intelligence Flow

The current change-intelligence system has four cooperating layers:

1. `app-change-hints` reads Steam hint cursors and enqueues storefront capture work.
2. `change-intel-worker` captures storefront snapshots, Steam news, projection refreshes, and hero assets, then writes change events and refreshes downstream projections.
3. `app_capture_work_state` coalesces repeated dirty signals so the worker maintains one live task per app/source.
4. `pics-service` captures normalized PICS history and diff events inline before latest-state writes, while `first_pass` can bootstrap prioritized catalog gaps.

The `/changes` page still reads Supabase SQL functions and internal APIs on top of those stored events and projections. The contract-backed chat path reads the TigerData change/news slice instead.

PICS caveat: latest-state writes support a Tiger target, but the service defaults to Supabase unless `PICS_LATEST_STATE_TARGET=tiger` and the Tiger URL are set in the running Railway environment. Code support and local tests do not by themselves prove the deployed Railway service or app runtime is writing latest-state rows to Tiger.

## Source-of-Truth Rules

- **Storefront** is authoritative for parsed `release_date`, pricing, and `is_free`.
- **PICS** is enrichment and fallback for tags, genres, categories, Deck, release state, relationships, and historical PICS change capture.
- **TigerData + R2** are primary for accepted/tested incoming ingestion and product-data paths that have been cut over.
- **Supabase** remains authoritative for auth/session/control data, reference data, legacy surfaces, and product surfaces not proven Tiger-backed.
- **TigerData** is the current contract-serving read plane and accepted product-data target, not a universal replacement for Supabase.
- **Cube** is a compatibility analytics layer over Supabase-backed data, not the primary chat contract system.
- **@publisheriq/youtube** writes YouTube coverage and rollup state directly into TigerData for the chat contract plane; it is not part of the Supabase ingestion path.

## Current Operational Reality

- preview and production each need their own `query-api` service and TigerData target
- deployed Vercel environments must set `QUERY_API_BASE_URL`; there is no silent localhost fallback
- local admin development can still default to `http://127.0.0.1:4318`
- TigerData slices are kept current through explicit bootstrap/backfill/reconcile/validate flows and scheduled Tiger refresh workflows
- YouTube chat coverage is gated in the admin app by `CHAT_TIGER_YOUTUBE_ENABLED`, and the collector runs through the `youtube:*` scripts plus the `youtube-production-*` and `youtube-preview-mirror` workflows

## Related Documentation

- [TigerData Operating Model](./tigerdata-operating-model.md)
- [Database Schema](./database-schema.md)
- [Sync Pipeline](./sync-pipeline.md)
- [Chat Data System](./chat-data-system.md)
- [Data Sources](./data-sources.md)
