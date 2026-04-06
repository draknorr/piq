# System Architecture Overview

PublisherIQ is a Steam analytics platform with three main product surfaces:

- analytics pages for games, companies, and insights
- a Change Feed for recent storefront, media, PICS, and news activity
- an AI chat interface over curated catalog, momentum, semantic, and change-intelligence contracts

**Last Updated:** April 6, 2026

## High-Level Stack

| Layer | Technology | Current Role |
|-------|------------|--------------|
| Frontend | Next.js 15 + React 19 | Signed-in dashboard and public entry surfaces |
| Write / Control Plane | Supabase Postgres | warehouse tables, queues, auth, RPCs, admin stats, product-page reads |
| Semantic Layer | Cube.js | legacy and compatibility analytics reads that still have not moved to Tiger-backed contracts |
| Contract Read Plane | `apps/query-api` + `packages/data-plane` | TigerData-backed typed contracts for chat, semantic retrieval, momentum, change search, news search, and continuation |
| TS Workers | `@publisheriq/ingestion` | scheduled syncs, queue workers, change-intel maintenance |
| Python Service | `services/pics-service` | PICS ingestion, latest-state enrichment, and PICS history capture |

## Current Serving Model

PublisherIQ currently runs as a **split data plane**, not a single-database application:

- **Supabase** is still the authoritative write target for source ingestion, auth, operational state, product RPCs, and most page reads.
- **TigerData (Timescale)** is the read-optimized target for contract-backed chat and search/discovery paths, served only through `query-api`.
- **Cube.js** still exists for compatibility and legacy analytics reads while those prompt families and page-level data flows continue to be migrated.

The important boundary is:

- Vercel should call `query-api`
- `query-api` should call TigerData
- Vercel should not connect directly to TigerData

## Current Load Sharing

| Surface | Primary Read Path | Primary Store | Notes |
|--------|-------------------|---------------|-------|
| `/chat` supported contract families | `/api/chat/stream` -> `query-api` | TigerData | canonical path for entity resolution, catalog search, momentum, semantic, news/change analysis, user context, and continuation |
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
TypeScript workers + PICS service
        ↓
Supabase
  - source ingestion landing
  - warehouse tables
  - queues and operational state
  - auth, credits, and chat logs
  - page-facing RPCs and projections
        ↓
Tiger refresh / bootstrap / reconcile workflows
        ↓
TigerData + query-api
  - typed contract-serving read plane
  - semantic retrieval and continuation
  - momentum, entity, change, and news contracts
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

### Supabase Write / Control Plane

Supabase currently stores:

- warehouse tables and materialized views
- `sync_status`, queue state, and worker control data
- auth/session state, user profiles, credits, pins, and alerts
- change-intel projections and `/changes` read surfaces
- cached admin stats and chat logs

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

## Source-of-Truth Rules

- **Storefront** is authoritative for parsed `release_date`, pricing, and `is_free`.
- **PICS** is enrichment and fallback for tags, genres, categories, Deck, release state, relationships, and historical PICS change capture.
- **Supabase** is the current write authority for operational data and most page-serving data.
- **TigerData** is the current contract-serving read plane, not the write authority.
- **Cube** is a compatibility analytics layer over Supabase-backed data, not the primary chat contract system.

## Current Operational Reality

- preview and production each need their own `query-api` service and TigerData target
- deployed Vercel environments must set `QUERY_API_BASE_URL`; there is no silent localhost fallback
- local admin development can still default to `http://127.0.0.1:4318`
- TigerData slices are kept current through explicit bootstrap/backfill/reconcile/validate flows and scheduled Tiger refresh workflows

## Related Documentation

- [TigerData Operating Model](./tigerdata-operating-model.md)
- [Database Schema](./database-schema.md)
- [Sync Pipeline](./sync-pipeline.md)
- [Chat Data System](./chat-data-system.md)
- [Data Sources](./data-sources.md)
