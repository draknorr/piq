# Timescale Architecture Plan

Date: March 30, 2026  
Audience: Founder/operator, future implementers, and anyone executing the Timescale-first rebuild for PublisherIQ

This memo turns the Timescale decision into a concrete architecture and migration plan. It is intentionally more detailed than the comparison docs and budget memos.

It is based on:

- repo inspection across `apps/admin`, `packages/ingestion`, `packages/cube`, `packages/qdrant`, and existing architecture docs
- read-only inspection of the live Supabase Postgres database on March 30, 2026
- official Tiger Data, Qdrant, Vercel, Supabase, and AWS pricing/docs retrieved on or around March 30, 2026

Related docs:

- [Multi-Platform Architecture Recommendation](./multi-platform-architecture-recommendation-2026-03-30.md)
- [Multi-Platform Architecture Budget-Conscious Alternative](./multi-platform-architecture-low-ops-2026-03-30.md)
- [Timescale vs Tinybird vs ClickHouse for PublisherIQ](./timescale-vs-tinybird-vs-clickhouse-2026-03-30.md)

## Executive Summary

PublisherIQ should rebuild around:

1. Tiger Data / Timescale as the main database for application state, hot analytics, and time-series history
2. object storage for raw archives, full document versions, large snapshots, and replay/backfill data
3. Qdrant retained initially for semantic retrieval and similarity
4. a typed internal query service for pages and `/chat`
5. Supabase removed from the main data path, with auth either migrated or retained only temporarily as a bridge

This is a serious rebuild, not a light optimization pass.

The goal is to keep the stack much simpler than a full ClickHouse split while still fixing the current failure mode:

- one Supabase/Postgres instance doing app DB, warehouse, queue store, history archive, search projection store, and chat dependency work

Timescale is the right move if the priorities are:

- lower cost than ClickHouse Cloud today
- better database fit than Supabase for time-series and history-heavy product surfaces
- direct Postgres ergonomics for app code, SQL, scripts, and LLM tooling
- fewer moving parts than a split analytical architecture

It is not the highest possible long-term ceiling. It is the best budget-conscious serious rebuild.

## Recommendation In One Sentence

Move the main PublisherIQ data plane off Supabase and onto Timescale, keep only hot product-serving data in the database, push raw/versioned archives into object storage, preserve Qdrant for retrieval in v1, and rebuild `/chat` around typed query contracts instead of prompt-heavy orchestration.

## What This Decision Means

### Yes, move off Supabase as the main database

Supabase should stop being the main data home. The clean end-state is that Supabase is either:

- gone entirely, or
- kept only temporarily for auth during migration

### Yes, still split a few things

Going Timescale-first does not mean putting literally everything in one database forever.

The recommended split is:

- Timescale for hot application and analytical data
- Tiger tiered storage for older queryable chunks that still need SQL access
- object storage for cold/raw/versioned history
- Qdrant for vector retrieval

That is still much simpler than the ClickHouse architecture, but it avoids recreating the current warehouse-in-the-app-DB problem.

### No, do not keep Supabase as a second major database long-term

Keeping Supabase as a meaningful second product database would preserve too much of the current coupling and operational confusion.

### No, Timescale does not eliminate the chat redesign

The infrastructure choice helps, but `/chat` still needs:

- typed query contracts
- platform-native identity
- less prompt-driven data planning

## Why Timescale Is The Right Choice Now

The current situation is a good fit for Timescale because:

- the live database is about `21 GB`, which is large enough to require architectural discipline but not so large that a Postgres-first rebuild is unreasonable
- the product is time-series and event-heavy, but not yet so large that it justifies paying ClickHouse’s cost floor immediately
- the team values direct SQL, low operational drag, and staying more database-centric
- the current pain is less about missing app-platform features and more about the wrong database shape

Tiger Data’s official pricing and feature positioning line up with that choice:

- Performance compute starts at `"$30/month"` and storage is listed at `"$0.177 / GB-month"` ([pricing](https://www.tigerdata.com/pricing))
- Scale starts at `"$36/month"` compute, adds read replicas, 14-day PITR, and tiered storage at `"$0.021 / GB-month"` for low-cost storage ([pricing](https://www.tigerdata.com/pricing))
- Tiger Data positions hypertables, incremental materialized views, compression/columnstore, and tiered storage as the core way to handle time-series and event-heavy Postgres workloads ([hypertables](https://www.tigerdata.com/docs/use-timescale/latest/hypertables), [continuous aggregates](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates), [compression](https://www.tigerdata.com/docs/use-timescale/latest/compression/about-compression))

The important practical consequence is:

- storage is not the main cost problem here
- compute, write churn, bad summary rebuild patterns, and keeping raw archives hot are the bigger problems

## Current-State Findings That Drive This Plan

Read-only inspection on March 30, 2026 showed:

- total DB size about `21 GB`
- biggest large-table pressure coming from both metrics and history surfaces
- large tables include:
  - `steam_news_versions` about `4.5 GB`
  - `app_change_events` about `3.0 GB`
  - `steam_news_search_projection` about `2.5 GB`
  - `daily_metrics` about `2.0 GB`
  - `ccu_snapshots` about `1.8 GB`
  - `app_source_snapshots` about `1.7 GB`
- large indexes on search and time-series paths
- very high write churn in `sync_status`, `apps`, `review_histogram`, and summary surfaces
- `/chat` currently uses sequential orchestration across provider logic, Cube, direct Postgres, Qdrant, guardrails, and session/logging concerns

This means the Timescale plan has to solve five things at once:

1. give hot metrics and event history a better home
2. stop raw/versioned archives from bloating the main DB
3. replace repeated summary rebuild behavior with incremental rollups
4. make cross-platform identity first-class
5. simplify `/chat` into a smaller number of deterministic data access paths

## Target Architecture

```text
Platform APIs / Steam / future platforms / PICS
        ↓
Ingestion workers and normalizers
        ↓
Timescale (main DB)
  - app state
  - entities
  - hot metrics
  - hot event history
  - rollups
  - chat query service backing tables
        ↓
Typed query service
  - page APIs
  - /chat tools
        ↓
Next.js app on Vercel

Alongside:
  - Tiger tiered storage for cold but still queryable hypertable chunks
  - object storage for raw archives and replay
  - Qdrant for semantic retrieval
```

## Service-By-Service Plan

| Service | Recommended role | Why it exists | Product impact | Operational burden |
|---|---|---|---|---|
| Timescale / Tiger Data | primary application and analytics DB | replaces Supabase as the main data plane and replaces Cube-facing warehouse pressure | faster and more stable time-window filters, cleaner `/chat` query paths, easier operator debugging | moderate but still much lower than a split analytical stack |
| Tiger tiered storage | queryable cold history for older hypertable chunks | lowers cost for older metrics and event history that still needs SQL access | lets you keep longer history accessible without paying hot-storage prices for all of it | low once policies are defined |
| Object storage | raw archive and replay store | keeps full versions, snapshots, and cold history out of the hot DB | enables full history retention and cheap reprocessing without bloating product queries | low |
| Qdrant Cloud | retrieval and similarity | keeps semantic search separate while the DB migration happens | preserves "games like X", concept retrieval, and semantic search quality | low to moderate |
| Vercel | frontend hosting and streaming routes | keeps the current app deployment story intact | no major user-visible change beyond app responsiveness and deployment continuity | low |
| Background workers | ingestion, transforms, backfills, archive jobs | moves data from source APIs into normalized contracts and rollups | determines freshness and reliability of product data | moderate |
| Auth provider | separate decision | auth should not block the database architecture choice | users should not care which provider backs auth as long as sessions survive | low to moderate |

## Supabase Exit Strategy

### Recommended end-state

Move off Supabase for the main data plane.

### Recommended transition path

Keep Supabase only for auth if doing so reduces migration risk, then decide later whether to:

- keep Supabase Auth only, or
- migrate auth to another provider

### Decision table

| Option | What it means | Pros | Cons | Recommendation |
|---|---|---|---|---|
| Full Supabase exit | move auth and DB at the same time | cleanest long-term architecture | more migration risk in one wave | good later, not required day one |
| Supabase auth-only bridge | move product data plane now, keep auth temporarily | fastest path to the real DB fix with less user-session risk | one extra vendor remains for a while | recommended transition path |
| Supabase kept as meaningful second DB | split product logic and state across both systems | lowest short-term change | preserves the current architectural confusion | not recommended |

### Not recommended

Do not keep:

- Supabase as the main analytical store
- Supabase as a second major application database
- Supabase plus Timescale plus duplicated operational tables

That would preserve too much of the current complexity while adding a new database on top.

## What Splits And What Does Not

### What stays together in Timescale

- application state
- platform-native entities
- latest-state catalog data
- hot metrics
- hot event history
- rollups and page-serving aggregates
- chat thread state and query read models

### What is intentionally split out

- cold but still queryable historical chunks through Tiger tiered storage
- raw API payloads
- full version history
- full source snapshots
- large immutable artifacts
- vector search

This is the right compromise between:

- "everything in one place"
- and "do not repeat the current warehouse/archive mistakes"

## Data Placement Plan

The right question is not "how do we move all 22 GB into Timescale?"

The right question is "what data deserves to stay hot in Timescale, and what should become cheap archive?"

### Recommended placement by major surface

| Current surface | Approx. current size | Recommended target | Why |
|---|---:|---|---|
| `daily_metrics` | `~2.0 GB` | Timescale hypertable | core analytical fact table and page/chat dependency |
| `ccu_snapshots` | `~1.8 GB` | Timescale hypertable, compressed and downsampled | high-value hot time-series, but older raw granularity should not stay equally expensive forever |
| `review_deltas` | `~0.5 GB` | Timescale hypertable | useful hot analytical history |
| `review_histogram` | `~0.5 GB` | Timescale hot table or hypertable depending on access pattern | still product-serving and analytical |
| `app_change_events` | `~3.0 GB` | Timescale hypertable for hot history plus archive for raw context if needed | `/changes` depends on it directly |
| `steam_news_search_projection` | `~2.5 GB` | Timescale searchable hot projection | keep the lean search/read model hot, not every raw version |
| `steam_news_versions` | `~4.5 GB` | object storage canonical archive plus extracted metadata in Timescale | full version archive is not worth keeping entirely hot |
| `app_source_snapshots` | `~1.7 GB` | object storage canonical archive | replay and audit value, not hot product value |
| `app_media_versions` | `~0.6 GB` | object storage | version archive workload |
| `sync_status`, `sync_jobs`, queue/control tables | smaller but high churn | Timescale regular tables | still operational state; keep hot and transactional |
| auth, billing, pins, alerts, chat threads | relatively small | Timescale regular tables, or auth temporarily external | product-control data, not analytical bulk |

### Practical hot/cold split

The likely long-term outcome is:

- Timescale holds the hot `12-15 GB` class of data plus growth
- Tiger tiered storage absorbs the older queryable slices of metrics and event history that still need SQL access
- object storage takes over the `6-7 GB` raw/version archive portion and most future archive growth
- Qdrant remains a separate retrieval cost line until proven unnecessary

The exact numbers will change. The architectural point does not:

- future growth should mostly go to Timescale hot facts and object-storage cold archives, not back into a single Supabase database

## Timescale Schema Strategy

### 1. Separate schemas by responsibility

Use schemas to reduce sprawl and make the new model easier to reason about:

- `core` for entities, relationships, and latest-state catalog data
- `metrics` for time-series facts and continuous aggregates
- `events` for change history and event read models
- `docs` for searchable document projections and metadata
- `ops` for sync state, jobs, locks, and workflow tables
- `chat` for thread state, evals, and query context

### 2. Make identity platform-native first

Core identity fields:

- `entity_uid`
- `platform`
- `platform_entity_id`
- `entity_kind`
- `parent_entity_uid`
- `canonical_name`

Supporting tables:

- `core.entities`
- `core.entity_aliases`
- `core.entity_relationships`
- `core.entity_external_ids`

This is what lets the product stop treating a game as "a Steam appid with extra cases."

### 3. Turn the real time-series surfaces into hypertables

Recommended hypertables:

- `metrics.daily_metrics`
  - time column: `metric_date`
  - partition key: `entity_uid`
- `metrics.ccu_snapshots`
  - time column: `snapshot_time`
  - partition key: `entity_uid`
- `metrics.review_deltas`
  - time column: event timestamp or metric date
  - partition key: `entity_uid`
- `events.app_change_events`
  - time column: detected or created timestamp
  - partition key: `entity_uid`
- `docs.news_projection`
  - time column: `published_at`
  - partition key: `entity_uid` or source key if helpful

Not every table needs to be a hypertable. Use ordinary Postgres tables for:

- auth-linked state
- pins and alerts
- queue/control state
- latest-state entity rows
- chat threads and messages

### 4. Replace broad rebuild tables with continuous aggregates

Current write churn strongly suggests that several summary surfaces are being rebuilt too aggressively.

The Timescale plan should replace that pattern with continuous aggregates for:

- latest metrics rollups
- 7-day and 30-day entity summaries
- publisher portfolio rollups
- developer portfolio rollups
- change activity summaries
- trend windows used by `/apps`, `/companies`, and `/chat`

The target is to stop recreating large summary tables when incremental rollups will do.

### 5. Apply compression and retention policies intentionally

Use compression / columnstore and retention to make hot history cheaper over time ([compression docs](https://www.tigerdata.com/docs/use-timescale/latest/compression/about-compression)).

Recommended first-pass policy shape:

- `ccu_snapshots`
  - keep most recent `30-90` days uncompressed
  - compress older chunks
  - tier colder but still queryable chunks if Scale economics justify it
  - keep hourly or daily rollups indefinitely
- `daily_metrics`
  - keep full daily grain hot longer because it is already relatively compact
  - compress older chunks
  - tier very old but still queryable slices if needed
- `app_change_events`
  - keep recent event detail hot
  - compress older chunks
  - tier older but still product-serving slices if query volume drops
  - archive raw payload context outside the DB if it stops being product-serving
- document/search projections
  - keep searchable recent and useful history hot
  - push full versions to object storage

These exact windows should be tuned from real query logs, not guessed once and never revisited.

## Archive Strategy

Object storage is not optional in this plan, but it is not the same thing as Tiger tiered storage.

Use them for different jobs:

- Tiger tiered storage: older chunks of hypertables that still need SQL query access
- external object storage: raw payloads, full versions, replay inputs, and canonical archives

It should become the canonical home for:

- raw platform payloads
- full source snapshots
- full news/version history
- old immutable event context blobs
- backfill inputs and replay datasets

Each archived object should carry enough metadata to be replayed or linked back to a normalized entity:

- `platform`
- `platform_entity_id`
- `entity_uid` when available
- `source_type`
- `captured_at`
- `version_key`

This is what makes future backfills and fixes cheap instead of terrifying.

## Query Service Plan

The app should stop letting every product surface improvise its own data path.

Build one internal query service with a small number of stable read contracts.

### Required contracts

| Contract | Purpose | Primary backing data |
|---|---|---|
| `lookup_entity` | resolve games, companies, franchises, and documents | `core` tables |
| `query_metrics` | rankings, trends, comparisons, and summaries | `metrics` hypertables and continuous aggregates |
| `query_events` | change timelines, event rankings, topic windows | `events` and `docs` read models |
| `semantic_search` | similarity and concept retrieval | Qdrant plus entity metadata |
| `get_user_context` | pins, alerts, tracked portfolio, recent entities | `core` or `chat` + product tables |

### Why this matters

It gives pages and `/chat` the same stable data access layer.

That reduces:

- custom page queries
- Cube-specific coupling
- prompt-level data planning complexity
- inconsistent ranking logic

Do not port Cube.js 1:1 onto Timescale. Replace it with:

- curated read models
- continuous aggregates
- a typed internal query service

## `/chat` Plan

Timescale improves the chat backend, but only if `/chat` is rebuilt around the new query service.

## What changes in `/chat`

### 1. Typed query contracts replace backend improvisation

Instead of the model deciding among Cube, direct Postgres, change RPCs, and other paths, the model should call a smaller set of tools with predictable shapes.

### 2. Platform-native identity replaces Steam-native assumptions

The model stops thinking "game equals `appid`" and starts working with platform-aware entities.

### 3. Less prompt-driven planning

The model spends less effort inventing the query path and more effort interpreting results.

## Practical `/chat` examples

| User prompt | Current risk | New path | User-visible effect |
|---|---|---|---|
| "Show me breakout indie games from 2025 under $20." | wrong query shape, extra tool hops, inconsistent ranking logic | `query_metrics` ranking contract | faster and more stable rankings |
| "Now only the ones with strong review momentum." | loses prior set or reruns too broadly | refine previous structured result set through `query_metrics` | better conversational continuity |
| "Which games had the most meaningful changes in the last 2 weeks and saw CCU growth?" | event and metric joins are fragile and multi-step | `query_events` plus attached metrics read model | stronger `/changes` answers |
| "Compare Devolver Digital to similar-sized publishers." | similarity logic and company rollups are loosely stitched | `lookup_entity` plus `query_metrics` comparison contract | more defensible peer analysis |
| "What Roblox games are closest to the Steam games I pinned?" | current identity model makes this awkward or impossible | platform-native `lookup_entity`, `get_user_context`, and `semantic_search` | real cross-platform chat capability |
| "Which games in my tracked portfolio are showing early warning signs?" | personalization is not first-class in the current data path | `get_user_context` plus portfolio risk query | more useful product intelligence behavior |

## Expected `/chat` outcomes

Target outcomes, not guarantees:

- common structured prompts first token in roughly `1.5-3s`
- fewer retries and fewer timeout-sensitive query loops
- more reliable follow-up continuity
- fewer wrong or partial metric comparisons
- cleaner cross-platform entity handling once new platforms are onboarded

## Product Impact By Surface

| Surface | Expected change | Why it changes |
|---|---|---|
| `/chat` | materially faster and more accurate on structured prompts | smaller tool surface, one main DB, typed contracts |
| `/apps` | stronger filter/sort stability on historical windows | hypertables and rollups replace fragile summary rebuilds |
| `/companies` | better portfolio and peer rollups | one normalized identity model and incremental aggregates |
| `/changes` | better hot-history handling and less main-DB stress | event hypertables plus archive split |
| admin / internal ops | much easier direct SQL inspection and debugging | standard Postgres workflows on a better-suited DB |

## Implementation Plan

This should be executed as a staged rebuild with parity checkpoints, not a single cutover weekend.

## Phase 0: Foundation And Environment

### Work

- choose Tiger Data tier and region
- stand up dev, staging, and prod services
- define database schemas and naming conventions
- choose object storage vendor and bucket layout
- define secrets, monitoring, and backup expectations

### Exit criteria

- environments exist
- connection/security model is documented
- migration owners are assigned

### Product impact

- none directly

## Phase 1: Identity Foundation

### Work

- create platform-native entity model
- define `entity_uid` mapping rules
- add alias and relationship tables
- stop designing new features around Steam-only IDs

### Exit criteria

- every page and chat concept can resolve through `entity_uid`
- one non-Steam platform can be represented without schema hacks

### Product impact

- mostly invisible immediately
- critical for future multi-platform product quality

## Phase 2: Core Timescale Landing

### Work

- create `core`, `metrics`, `events`, `docs`, `ops`, and `chat` schemas
- create hypertables for time-series and event surfaces
- move operational and latest-state tables
- backfill hot history from Supabase

### Exit criteria

- core data lands cleanly in Timescale
- parity checks pass for major entity and metric surfaces

### Product impact

- limited user-visible change at first
- sets up future page and chat improvements

## Phase 3: Rollups And Read Models

### Work

- replace broad rebuild summary surfaces with continuous aggregates
- create page-serving read models
- create `/changes` hot-history projections
- add search indexes for hot document projections where justified

### Exit criteria

- `/apps`, `/companies`, and `/changes` can read from Timescale-backed APIs
- summary rebuild load is materially reduced

### Product impact

- faster and more stable analytical pages

## Phase 4: Archive Separation

### Work

- move raw versions and snapshots into object storage
- keep links and metadata in Timescale
- build replay and backfill tooling

### Exit criteria

- raw/version history no longer needs to stay hot in the DB
- archive restore path is documented and tested

### Product impact

- mostly invisible to users
- major operational improvement for retention and cost control

## Phase 5: Query Service And `/chat` Rebuild

### Work

- build typed query contracts
- move pages onto the same query service where sensible
- remove Cube-centric assumptions from the chat path
- simplify chat tool routing

### Exit criteria

- common chat prompts run on the new contracts
- regression set shows better speed and answer stability

### Product impact

- major
- this is when users should most clearly feel the upgrade

## Phase 6: First New Platform

### Work

- onboard one non-Steam platform using the new identity, ingest, and query contracts
- verify that no core schema redesign is required

### Exit criteria

- one non-Steam platform is live
- pages and chat can answer cross-platform questions

### Product impact

- first visible proof that the rebuild solved the expansion problem

## Phase 7: Cutover And Supabase Reduction

### Work

- move remaining read paths
- retire or shrink Supabase usage
- archive legacy cubes and warehouse-only tables
- document operating procedures

### Exit criteria

- Supabase is no longer the main product database
- old read paths are removed or disabled

### Product impact

- improved reliability and less architecture drag

## Cost Model

These are planning ranges, not invoice reconstructions.

Important notes:

- Tiger Data pricing is consumption-based and can change with plan tier, HA, replicas, and add-ons ([pricing](https://www.tigerdata.com/pricing))
- Tiger Data markets "effective storage" based on average compression assumptions; your real compression ratio will vary
- the biggest lever in this plan is reducing hot data volume and eliminating wasteful rebuild/query patterns, not chasing the lowest raw storage number

## Budget assumptions

- current live DB around `21 GB`
- current product traffic is light
- not all current data should remain hot in the primary DB after archive separation
- some older queryable history can move to Tiger tiered storage instead of staying on hot storage
- near-real-time freshness is enough; sub-minute streaming is not required
- Qdrant stays in phase 1

## Monthly spend ranges by stage

| Service | Initial rebuild / light prod | 5x Steam | 5 platforms | Notes |
|---|---:|---:|---:|---|
| Timescale / Tiger Data | `$30-$200` | `$150-$800` | `$600-$2,500+` | compute and HA dominate more than raw storage |
| Object storage | `$10-$75` | `$50-$250` | `$200-$1,000` | archive growth is the right place for long-tail history spend |
| Qdrant Cloud | `$0-$150` | `$100-$500` | `$300-$1,200` | depends on retrieval traffic and collection size |
| Vercel | `$20-$150` | `$50-$300` | `$150-$1,000` | app traffic dependent |
| Workers / observability | `$25-$200` | `$100-$400` | `$250-$1,000` | includes backfills, logs, monitoring |
| **Estimated total** | **`$85-$775`** | **`$450-$2,250`** | **`$1,500-$5,700+`** | broad planning band |

## Cost comparison versus staying on Supabase

| Direction | Small-scale economics | Large-scale economics | Read on cost shape |
|---|---|---|---|
| Stay on Supabase as the main DB | low migration cost, familiar billing | tends to become expensive in the wrong places as DB size, churn, egress, and add-ons grow | easiest to delay, not the cleanest long-term outcome |
| Timescale-first | strongest price-to-architecture balance now | still cheaper and simpler than ClickHouse early, but may eventually need another step if the product gets very large | best fit for current constraints |
| ClickHouse split stack | expensive now | strongest long-term analytical efficiency and headroom | probably better later, not now |

## Downsides Of Choosing Timescale

This is the right choice now, but it is still a compromise.

### 1. It may not be the forever architecture

If PublisherIQ becomes a very large multi-platform event/history analytics product, ClickHouse may still be the better final-form engine later.

### 2. `/changes` still has a ceiling

Timescale is much better than the current Supabase usage for `/changes`, but it is still a Postgres-first system, not a purpose-built large-scale analytical column store.

### 3. One main database can become the new bottleneck if discipline slips

If raw archives, broad summary rebuilds, and every new feature get stuffed back into Timescale, the same structural problem will return.

### 4. You still need a chat and identity redesign

Choosing Timescale does not remove the need for:

- platform-native identity
- typed query contracts
- simpler `/chat` routing

### 5. You give up some Supabase bundle convenience if you fully exit

If you remove Supabase entirely, you lose the integrated DB + auth + storage bundle. That is a trade worth taking only if the database fit has clearly become wrong.

## Why Not Just Stay On Supabase

Staying on Supabase is still the lowest-migration path, but it keeps too much of the current problem alive:

- analytical and operational workloads stay coupled
- raw/version history keeps growing inside the main DB unless you redesign anyway
- `/chat` remains too close to prompt-heavy routing over mixed backends
- future scale work is still shaped around an app platform rather than a better database fit

If the core instinct is "Supabase is not the right product for this workload anymore," the evidence supports that instinct.

## Open Decisions

These are the main choices that should remain open while the plan is executed:

1. whether to keep Supabase Auth during transition or replace it immediately
2. whether Qdrant remains long-term or some retrieval moves into Postgres later
3. whether `/changes` search stays Postgres-native or eventually needs a more specialized search path
4. exact retention windows for hot versus cold history
5. whether the first new platform after Steam is Roblox or another platform with cleaner data shape

## Revisit-Later Items

These are explicitly not day-one requirements:

- moving vectors into Timescale via `pgvector` / `pgvectorscale`
- replacing Qdrant during the first migration wave
- building a graph database
- jumping straight to ClickHouse
- migrating auth on the same day as the data plane move

Tiger Data does support `pgvector`, `pgvectorscale`, and AI workflows in Postgres ([extensions docs](https://docs.tigerdata.com/use-timescale/latest/extensions), [AI docs](https://docs.tigerdata.com/ai/latest/sql-interface-for-pgvector-and-timescale-vector/)). That makes it a credible future consolidation path. It should not be the first move.

## Success Metrics

The rebuild should be judged on product and operational outcomes, not only on whether the new DB is online.

### Product goals

- `/chat` first token for common structured prompts roughly `1.5-3s`
- fewer timeout/retry loops on page and chat reads
- more stable rankings and follow-up behavior
- at least one non-Steam platform onboarded without a new core schema redesign

### Operational goals

- raw/version archives no longer dominate the hot DB
- large summary rebuild churn materially reduced
- DB growth becomes more predictable
- replay and backfill path exists and is documented

### Cost goals

- keep the small-scale stack materially below a ClickHouse-first cost floor
- keep Supabase-style overage growth from remaining the default path

## Final Recommendation

If the decision is "we are going with Timescale," the concrete recommendation is:

1. move the main data plane off Supabase
2. keep only hot product-serving data in Timescale
3. make object storage the archive of record
4. keep Qdrant for retrieval in v1
5. rebuild `/chat` on typed query contracts
6. treat full Supabase retention only as a temporary bridge, not the target architecture

This is the best serious rebuild path that matches the current budget, current product shape, and current desire for a cleaner database-centric architecture.

## Source Appendix

Official sources retrieved on or around March 30, 2026:

- Tiger Data pricing: <https://www.tigerdata.com/pricing>
- Tiger Data cloud overview: <https://www.tigerdata.com/cloud>
- Tiger Data hypertables docs: <https://www.tigerdata.com/docs/use-timescale/latest/hypertables>
- Tiger Data continuous aggregates docs: <https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates>
- Tiger Data compression docs: <https://www.tigerdata.com/docs/use-timescale/latest/compression/about-compression>
- Tiger Data extensions docs: <https://docs.tigerdata.com/use-timescale/latest/extensions>
- Tiger Data SQL interface for pgvector and pgvectorscale: <https://docs.tigerdata.com/ai/latest/sql-interface-for-pgvector-and-timescale-vector/>
- Qdrant pricing: <https://qdrant.tech/pricing/>
- Vercel pricing: <https://vercel.com/pricing>
- AWS S3 pricing: <https://aws.amazon.com/s3/pricing/>
- Supabase pricing: <https://supabase.com/pricing>
- Supabase compute docs: <https://supabase.com/docs/guides/platform/manage-your-usage/compute>
- Supabase disk throughput docs: <https://supabase.com/docs/guides/platform/manage-your-usage/disk-throughput>
