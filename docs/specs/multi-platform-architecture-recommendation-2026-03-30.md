# Multi-Platform Architecture Recommendation

Date: March 30, 2026  
Audience: Founder/operator, future implementers, and anyone making infrastructure or product-platform decisions for PublisherIQ

This memo is based on:

- repo inspection across `apps/admin`, `packages/ingestion`, `packages/cube`, `packages/qdrant`, `services/pics-service`, and current docs
- read-only database inspection against the live Supabase Postgres instance on March 30, 2026
- official vendor pricing/docs retrieved on or around March 30, 2026

This is a recommendation memo, not a migration PRD. It is intentionally opinionated.

For a direct budget and tooling comparison between Timescale, Tinybird, and ClickHouse, see [Timescale vs Tinybird vs ClickHouse for PublisherIQ](./timescale-vs-tinybird-vs-clickhouse-2026-03-30.md).

For the detailed Timescale execution path if budget rules out ClickHouse right now, see [Timescale Architecture Plan](./timescale-architecture-plan-2026-03-30.md).

## Executive Summary

PublisherIQ should move to a split architecture:

1. Supabase retained only as a thin control plane
2. cheap raw-history storage in object storage
3. ClickHouse as the analytical serving layer
4. Qdrant retained initially for retrieval and similarity
5. `/chat` rebuilt around typed query contracts instead of prompt-heavy Cube and SQL orchestration

The current stack is already carrying too much coupling:

- Supabase Postgres is acting as warehouse, event store, queue store, auth store, RPC layer, and parts of the chat/debugging surface
- `/chat` is a sequential orchestration loop across LLM provider calls, Cube, direct Postgres reads, Qdrant, lookups, guardrails, and logging
- the identity model is still Steam-native, with `appid` assumptions spread across data, chat, and product surfaces

That shape can survive more Steam work. It is not the best long-term shape for:

- 3-5x more Steam data
- 5 more platforms over time
- faster and more accurate `/chat`
- non-explosive cost growth

The recommendation is a ground-up rewrite of the data and query architecture, not a literal rebuild of every UI surface from scratch. The product should keep the current routes and user-facing product idea, but the core serving model should change.

If the ClickHouse cost floor is too high right now, the primary budget-conscious rebuild option should be **Timescale**, not “keep stretching Supabase.”

## Recommendation In One Sentence

Keep Supabase for auth and control-plane workflows, move analytical history and event-heavy serving to ClickHouse plus object storage, normalize identity across platforms, and replace the current `/chat` orchestration with a typed query service.

## Current State Assessment

### Current Runtime Shape

Current documented runtime in [System Overview](../developer-guide/architecture/overview.md):

```text
Steam APIs / Steam News / SteamSpy / PICS
        ↓
TypeScript workers + PICS service
        ↓
Supabase (tables, queues, projections, RPCs, auth)
        ↓
Cube.js + Qdrant
        ↓
Next.js dashboard
```

That architecture has been productive. It is also why the same primary database is carrying almost every important concern.

### Live Database Findings

Read-only inspection on March 30, 2026:

#### Database footprint

- Total database size: about `21 GB`
- Public tables: `50`
- Public materialized views: `17`
- No partitioned public tables were visible during inspection

#### Largest tables by total size

| Table | Approx. rows | Total size | Why it matters |
|---|---:|---:|---|
| `steam_news_versions` | 1.66M | 4.5 GB | full history archive; fast growth with text-heavy payloads |
| `app_change_events` | 2.03M | 3.0 GB | append-heavy event history already large |
| `steam_news_search_projection` | 1.22M | 2.5 GB | search-serving projection inside the primary DB |
| `daily_metrics` | 10.36M | 2.0 GB | core time-series fact table |
| `ccu_snapshots` | 9.63M | 1.8 GB | high-volume snapshot history |
| `app_source_snapshots` | 436K | 1.7 GB | versioned source capture history |
| `steam_news_items` | 1.65M | 910 MB | archived Steam news corpus |

#### Largest indexes observed

| Index | Table | Approx. size | Read on this |
|---|---|---:|---|
| `idx_steam_news_search_projection_search_document` | `steam_news_search_projection` | 572 MB | text search inside the primary warehouse |
| `ccu_snapshots_appid_snapshot_time_key` | `ccu_snapshots` | 416 MB | large time-series uniqueness cost |
| `idx_ccu_snapshots_appid_time` | `ccu_snapshots` | 395 MB | heavy read path cost on hot history |
| `daily_metrics_appid_metric_date_key` | `daily_metrics` | 310 MB | daily uniqueness/indexing overhead |
| `idx_daily_metrics_appid_date` | `daily_metrics` | 294 MB | core time-series read path |

#### Coverage windows

| Surface | Earliest data seen | Latest data seen |
|---|---|---|
| `daily_metrics` | December 28, 2025 | March 30, 2026 |
| `ccu_snapshots` | January 9, 2026 | March 30, 2026 |
| `review_deltas` | January 9, 2026 | March 30, 2026 |
| `steam_news_items` | October 14, 2008 | March 30, 2026 |
| `app_change_events` | March 14, 2026 | March 30, 2026 |

#### Write amplification

`pg_stat_user_tables` shows very high write/update churn in surfaces that should not be living in the same place as auth and operational state:

| Table | Inserts | Updates | Deletes | Takeaway |
|---|---:|---:|---:|---|
| `sync_status` | 173K | 88.3M | 0 | control-plane hot row churn is massive |
| `apps` | 168K | 30.8M | 0 | latest-state updates are expensive in a general-purpose row store |
| `review_histogram` | 3.08M | 32.3M | 0 | historical facts are not append-only in practice |
| `developer_metrics` | 34.8M | 0 | 34.7M | repeated matview-like rebuild behavior |
| `publisher_metrics` | 29.8M | 0 | 29.6M | repeated matview-like rebuild behavior |
| `latest_daily_metrics` | 12.6M | 0 | 12.1M | hot summary surface rebuilt repeatedly |
| `app_filter_data` | 11.1M | 0 | 10.9M | page-serving surface rebuilt repeatedly |

### Current Chat Architecture

Current `/chat` behavior from [Chat Data System](../developer-guide/architecture/chat-data-system.md) and the live route code in `apps/admin/src/app/api/chat/stream/route.ts`:

- one route owns provider selection, tool orchestration, guardrails, session context, quality contracts, credits, rate limits, and logging
- tools fan out to:
  - Cube for structured analytics
  - Qdrant for semantic similarity
  - direct Postgres lookups and change/news RPCs
- tool calls are executed sequentially and fed back into the model loop
- the system still depends on prompt instructions and guardrail layers to stay accurate

This matters because growth will not just mean “more rows.” It will mean:

- more cubes
- more platforms
- more lookup ambiguity
- more prompt surface area
- more tool routing ambiguity

### Steam-Centric Identity Debt

The current Roblox plan in [Roblox Integration Plan v2](./roblox-integration-plan-v2.md) already identifies the same structural issue:

- shared tables and APIs still assume Steam-shaped game identity
- platform-aware identity is still a retrofit
- chat links and entity handling still need migration

That means the current multi-platform path is still:

1. add platform-specific tables
2. add platform-specific cubes and embeddings
3. retrofit shared identity

That is acceptable for one platform. It is not the cleanest path for five more.

## Requirements And Success Criteria

### Product Requirements

- The user should be able to ask for information across games, companies, changes, and news without the system feeling like separate products glued together.
- `/chat` should feel faster, more grounded, and less “LLM-ish” on metric-heavy questions.
- The product should support 3-5x Steam growth plus additional platforms without constantly constraining the UI to protect the primary database.
- The product should support richer cross-platform comparisons and identity resolution.
- Costs should grow more linearly than the current warehouse-in-Supabase path.

### Engineering Requirements

- Operational state and analytical state must be separated.
- Identity must become platform-native.
- Raw history must become replayable and cheap to retain.
- Hot analytical read paths must live in an engine designed for large filtered aggregations and append-heavy event history.
- Chat should be driven by typed contracts instead of a growing prompt/cube maze.

### Freshness Requirements

- Near-real-time for important changes and recent activity
- minutes-level freshness is good enough
- sub-minute streaming is not required for v1 of the redesign

## Recommended Target Architecture

### Architecture Summary

### Plane 1: Control Plane

**Recommended service:** Supabase  
**Role:** auth, users, billing, pins, alerts, rate limits, workflow state, sync cursors, admin state

Supabase stays because it is already valuable for:

- auth
- dashboard-side developer speed
- simple operational tables
- RPCs where the data is truly operational

Supabase stops being the warehouse center.

### Plane 2: Raw History Plane

**Recommended service:** S3-compatible object storage  
**Role:** raw payload archive, replay, backfill, cold history, document snapshots, source-of-truth landing zone

Every platform connector writes append-only raw artifacts here:

- API responses
- normalized source snapshots
- event payloads
- news/content documents

This is what makes future backfills, repairs, and reprocessing cheap.

### Plane 3: Analytical Serving Plane

**Recommended service:** ClickHouse Cloud  
**Role:** facts, event history, topic search projections, product-facing aggregations, ranked filters, cross-platform marts

ClickHouse becomes the place where the product reads for:

- `/apps`
- `/companies`
- `/changes`
- most quantitative `/chat` queries

This replaces the current pattern of:

- large facts in Supabase
- projections in Supabase
- Cube as an extra semantic layer
- repeated matview rebuild chains

### Plane 4: Retrieval Plane

**Recommended service:** Qdrant Cloud  
**Role:** semantic retrieval, ANN similarity, hybrid retrieval companion to the query service

Qdrant stays initially because:

- it is already integrated
- it keeps semantic retrieval isolated
- it lowers migration risk for `/chat`

This should be revisited later only after the new query service is stable.

### App Plane

**Recommended services:** Vercel + typed query service in `apps/admin` or a small service layer  
**Role:** frontend delivery, streaming UX, typed data access, answer rendering

The product keeps the current route surface. The big change is what those routes talk to.

### Canonical Identity Model

Every entity should be normalized around:

- `entity_uid`
- `platform`
- `platform_entity_id`
- `entity_kind`
- `canonical_name`
- `parent_entity_uid`

Platform-specific IDs like `appid` and `universe_id` remain important, but they stop being the global product key.

### Example

| Field | Steam game | Roblox game |
|---|---|---|
| `entity_uid` | `game_steam_730` | `game_roblox_123456789` |
| `platform` | `steam` | `roblox` |
| `platform_entity_id` | `730` | `123456789` |
| `entity_kind` | `game` | `game` |

This change is major. It affects:

- chat links
- pins and alerts
- admin references
- future APIs
- future document retrieval

### Shared Ingestion Contracts

Every platform connector should emit the same internal contracts:

- `raw_record`
- `canonical_entity`
- `metric_point`
- `event_record`
- `document_record`

That lets the platform-specific work live at the edge of the system instead of at the center of every product feature.

### Chat Redesign

Replace the current prompt-heavy orchestration with typed internal query surfaces:

- `lookup_entity`
- `query_metrics`
- `query_events`
- `semantic_search`

The model still writes language. It stops deciding the entire data plan by itself.

### What changes technically

- retire Cube from the serving path
- stop routing metric-heavy answers through large prompt instructions about cubes
- add deterministic renderers for metric tables, comparisons, rankings, and timelines
- keep LLM reasoning for:
  - clarification
  - summarization
  - narrative framing
  - synthesis across query results

This is the biggest product quality change in the whole proposal.

## Product Impact Summary

### What Users Will Notice Directly

### `/chat`

- faster first answer on structured questions
- fewer “tool thrash” responses where the system does too many adjacent searches
- better follow-up continuity because identity and query contracts become cleaner
- more reliable rankings, comparisons, and time-window answers
- cross-platform questions become realistic

### `/apps` and `/companies`

- faster filters and sorts when many dimensions are stacked together
- room for more derived metrics without constantly guarding against warehouse pain
- room for broader history windows and more market slices

### `/changes`

- larger event and news volume without the same pressure on the operational database
- richer topic search, clustering, and change-window analysis
- easier expansion to new sources and platforms

### What Mostly Improves Internally

- easier backfills and data repair
- less risk from Cube drift or prompt drift
- less need to protect the product by trimming features
- clearer observability over why a result was produced
- much easier addition of new platforms

### What New Capabilities Become Realistic

- true cross-platform entity pages and chat answers
- richer event analytics over a much larger change/news corpus
- better chat answer determinism for metrics and rankings
- platform onboarding through connector work instead of full schema-and-chat rewrites
- longer retention of raw history without the same warehouse penalty

## Experience Changes By Product Surface

| Surface | Current pain | New architecture change | User-visible effect | Magnitude |
|---|---|---|---|---|
| `/chat` | sequential tool loop, prompt routing ambiguity, Steam-native identity | typed query service + platform-native identity + analytical serving layer | faster answers, fewer weird metric answers, better follow-ups, cross-platform support | Major |
| `/apps` | page-serving surfaces rely on repeated rebuilds and primary DB read pressure | large filtered analytics move to ClickHouse marts | faster sort/filter and more room for richer metrics | Moderate to major |
| `/companies` | portfolio rollups become harder as platforms multiply | shared company/entity identity plus analytical marts | better peer comparison and cross-platform portfolio views | Major over time |
| `/changes` | change/news history already large in the primary DB | append-heavy events and search projections move to analytics plane | more history, more sources, faster search, less operational fragility | Major |
| Admin / ops | same DB carries operational and analytical stress | control plane separated from analytical plane | clearer health visibility and less hidden coupling | Moderate |

## Capability Unlocks By Service

| Service | Why it exists | What it enables in the product | User-visible? | Magnitude |
|---|---|---|---|---|
| Supabase | thin control plane | auth, user state, pins, alerts, credits, workflow control | Mostly indirect | Moderate |
| S3-compatible object storage | cheap raw history | replay, backfill, cross-platform connector safety, longer retention | Mostly indirect | Moderate |
| ClickHouse Cloud | analytical serving engine | fast rankings, large filters, change analytics, hot event history, broad time windows | Yes | Major |
| Qdrant Cloud | retrieval plane | semantic similarity, retrieval augmentation, concept search | Yes | Moderate |
| Vercel | app delivery | streaming UX, fast frontend iteration, product hosting | Yes | Moderate |
| Typed query service | product-facing data contract | safer `/chat`, unified route behavior, less prompt drift | Yes | Major |

## Major vs Moderate vs Mostly Invisible Changes

### Major Changes

- cross-platform identity becomes a first-class product concept
- `/chat` becomes materially more deterministic on analytics questions
- `/changes` can expand meaningfully without abusing the operational DB
- new platforms become additive connector work rather than whole-product rewrites

### Moderate Changes

- better filter speed on heavy analytics pages
- better company rollups and cross-platform comparisons
- better admin observability
- easier product iteration on new derived metrics

### Mostly Invisible Infrastructure Improvements

- cheaper long-term raw history retention
- replayable ingestion and safer backfills
- less write amplification in the primary DB
- lower risk that one serving pattern harms unrelated product surfaces

## Expected Performance And Quality Improvements

These are expected targets, not already-observed facts.

| Area | Current pattern | Expected target after rewrite |
|---|---|---|
| `/chat` first token for structured questions | often multi-hop and retry-sensitive | roughly `1-2s` target for common typed queries |
| `/chat` full answer for metric-heavy prompts | can depend on sequential tool chains and retries | fewer iterations and lower timeout sensitivity |
| `/apps` and `/companies` heavy filter combinations | bounded by warehouse and projection strategy | sub-second to low-single-second target for common slices |
| `/changes` topic search and activity views | increasingly expensive in the main DB | lower p95 variance and more history headroom |
| Chat accuracy on ranking/comparison prompts | depends on prompt discipline and tool selection | improved because metric paths become deterministic |

Quality goals:

- fewer retries and fallbacks inside chat
- fewer adjacent or redundant tool calls
- less need for prompt guardrail sprawl
- cleaner answer traceability for admin debugging

## Service-By-Service Architecture Breakdown

### Supabase

### Role

- auth
- user profiles
- credits
- pins
- alerts
- workflow state
- operational admin state

### Why keep it

- already integrated
- strong developer ergonomics
- excellent fit for control-plane data

### What it replaces

Nothing. It stays, but its role shrinks.

### Product impact

- users keep the same auth/account behavior
- control-plane features remain easy to build
- failures in analytical history should stop endangering user/account paths

### Operational burden

Low to moderate.

### Object Storage

### Role

- raw platform payload archive
- snapshot archive
- cold documents and version history
- replay and backfill source

### Why it exists

Raw history should not live forever in the same high-cost operational/warehouse database.

### Product impact

Mostly indirect, but important:

- faster incident recovery
- easier onboarding of new platforms
- longer retention without punishing product query paths

### Operational burden

Low.

### ClickHouse Cloud

### Role

- analytical facts
- hot event history
- large aggregations
- change/news topic search projections
- page and chat serving marts

### Why it exists

This is the core performance and cost decision. The current workload is increasingly event-heavy and aggregation-heavy, which is the wrong shape for “everything in Supabase Postgres.”

### What it replaces

- Supabase as the primary warehouse center
- much of the current projection and matview serving pattern
- Cube as the core serving abstraction

### Product impact

Major:

- more responsive analytics pages
- more scalable `/changes`
- cleaner quantitative `/chat`
- much better room for multi-platform growth

### Operational burden

Moderate, but acceptable for the recommended path.

### Qdrant Cloud

### Role

- similarity search
- concept retrieval
- retrieval augmentation for chat

### Why keep it initially

It reduces migration risk and preserves an already-working semantic search path.

### Product impact

Moderate:

- keeps “games like X” and concept-style discovery strong during the transition

### Operational burden

Low.

### Vercel

### Role

- frontend hosting
- streaming UX
- route hosting

### Product impact

Moderate:

- keeps a fast frontend delivery loop
- does not need to be re-architected just because the data plane changes

### Operational burden

Low.

## Cost Model Assumptions

These cost tables are **budgetary estimates**, not invoice reconstructions.

They are based on:

- current live DB footprint observed on March 30, 2026
- current architecture shape from repo inspection
- a 5x Steam expansion assumption
- a later 5-platform expansion assumption
- near-real-time freshness
- moderate production chat usage

They are not based on:

- private vendor quotes
- your actual current invoices
- enterprise discounts

### Scenario Definitions

| Scenario | Definition |
|---|---|
| Current-ish | current product shape, but modeled as if the architecture were already split cleanly |
| 5x Steam | around 5x current Steam-scale facts/events/history, still mainly one platform |
| 5 platforms | Steam plus roughly 5 additional platforms over time, with a much larger event/document footprint |

## Budgetary Cost Breakdown: Recommended Architecture

### Monthly cost bands by service

| Service | Current-ish | 5x Steam | 5 platforms | Notes |
|---|---:|---:|---:|---|
| Supabase control plane | `$25-$150` | `$100-$300` | `$150-$500` | auth and control-plane only; much thinner than today |
| Object storage | `$10-$80` | `$75-$300` | `$250-$1,000` | depends heavily on retention and raw replay strategy |
| ClickHouse Cloud | `$200-$800` | `$800-$2,500` | `$2,000-$6,000+` | biggest driver once analytical serving moves here |
| Qdrant Cloud | `$0-$150` | `$100-$500` | `$300-$1,200` | depends on vector count, payload size, replication |
| Vercel | `$20-$150` | `$50-$300` | `$150-$1,000` | depends on traffic, functions, and data transfer |
| Background orchestration / workers | `$50-$300` | `$150-$600` | `$300-$1,500` | depends on runtime choice and schedule density |
| Observability / logs | `$0-$150` | `$50-$300` | `$150-$800` | optional but likely necessary at scale |
| **Estimated total** | **`$305-$1,630`** | **`$1,325-$4,800`** | **`$3,300-$12,000+`** | broad planning band, not quote |

### Product outcome by spend tier

| Spend tier | What it buys |
|---|---|
| Low hundreds | current-ish split architecture with much better separation than today |
| Low thousands | serious Steam-scale analytics with better `/chat` and `/changes` headroom |
| Mid thousands and up | true multi-platform analytical product with strong historical retention and product-facing performance |

## Cost Comparison: Current Direction vs Recommended vs Low-Ops

| Stack direction | Small scale | Growth scale | Product effect |
|---|---|---|---|
| Current direction: Supabase warehouse + Cube + Qdrant | cheap-to-moderate initially | cost and operational pain rise quickly as history and projections grow | good iteration speed, but rising limits on performance and product breadth |
| Recommended: thin Supabase + ClickHouse + object storage + Qdrant | usually somewhat more expensive than “all in Supabase” at very small scale | scales more cleanly and predictably as history and platforms grow | best long-term speed, chat quality, and product headroom |
| Budget-conscious alternative: Timescale + object storage + Qdrant | strongest price-to-architecture balance if ClickHouse is too expensive now | scales better than the current Supabase pattern, but with a lower eventual ceiling than ClickHouse | best practical rebuild path under tighter budget constraints |
| Low-ops split alternative: Tinybird + app DB + Qdrant | strong early-stage ops profile | very good product-analytics serving, but less “one place” and more plan/QPS shaped | best if the team wants managed analytics APIs rather than one main database |

## Why Not Stay On Supabase As The Main Warehouse

### Pros Of Staying

- lowest migration complexity
- strong developer ergonomics
- one primary SQL system
- keeps auth, data, and app workflows tightly integrated
- easier for a small team to reason about day-to-day

### Cons Of Staying

- large append-heavy history and text-search projections continue to live in a row-store core
- control-plane and analytical workloads remain coupled
- write amplification and index growth remain expensive
- multi-platform expansion still pressures the same primary system
- `/chat` still needs a substantial architecture rewrite even if Supabase remains central
- the product keeps inheriting “feature budget” constraints from warehouse pressure

### What Would Need To Change If You Still Stayed

If Supabase remained the main warehouse center, you would still need to do all of the following:

- adopt platform-native identity
- partition and tier more large time-series and event surfaces
- separate control-plane tables from heavy warehouse read/write paths as much as possible
- aggressively prune or relocate raw/history-heavy tables such as news versions and older event archives
- likely reduce dependence on large in-DB search projections
- still redesign `/chat` around typed contracts

In other words: staying on Supabase does **not** mean keeping the product architecture mostly as-is.

### User/Product Impact If You Stay

#### Improvements still possible

- better chat behavior from typed contracts
- cleaner platform identity
- some filter speed improvements
- some admin reliability improvements

#### Limits likely to remain

- more product caution around large event/history features
- more latency risk on large cross-cutting analytics
- more pressure to simplify `/changes` and broad topic search
- more risk that multi-platform breadth feels constrained by the primary DB

### Bottom Line On Staying

Staying on Supabase as the **main warehouse** is a bridge strategy, not the best long-term target architecture.

Staying on Supabase as the **control plane** is completely reasonable.

## Alternatives Considered

### 1. Postgres / Timescale-First

### Fit

Primary budget-conscious rebuild option if ClickHouse is too expensive right now and the team wants to stay close to a one-database mental model.

### Pros

- least disruptive mental model
- time-series features like hypertables and continuous aggregates are attractive
- lower re-platforming pain than a columnar move
- strongest fit if direct SQL, standard Postgres tooling, and agent/CLI access matter a lot
- much better database-centric fit than continuing to push the current Supabase setup

### Cons

- still the wrong long-term center for massive append-heavy events plus analytics plus change search
- still less clean for 5+ platform analytical growth
- lower upside on large analytical serving than ClickHouse-centered design
- may still become a bridge if the product grows into a much larger multi-platform event and search product

### User/Product Impact

- some speed gains
- lower rewrite risk
- much cleaner “all in one place” rebuild path
- smaller improvement ceiling than ClickHouse

### When to choose it

If ClickHouse is too expensive now and you want the strongest practical rebuild path without staying on Supabase.

### 2. ClickHouse-Centered Split Stack

### Fit

Best overall fit for your goals.

### Pros

- best balance of performance, cost profile, and growth headroom
- strong fit for hot history and event analytics
- strong fit for product-facing filtered rankings

### Cons

- more moving parts than an all-Supabase path
- needs a clean query-service redesign

### User/Product Impact

- biggest upside for `/chat`, `/changes`, and future multi-platform breadth

### When to choose it

Now.

### 3. Iceberg + StarRocks / Trino Lakehouse

### Fit

Best if open formats and long-term engine flexibility are more important than implementation simplicity.

### Pros

- strongest long-term openness
- cheap cold retention
- excellent future flexibility

### Cons

- more data-platform engineering
- slower path to product wins
- higher coordination burden for a small team

### User/Product Impact

- great long-term upside
- slower short-term product payoff

### When to choose it

If open lakehouse architecture is a core strategic goal, not just an optimization.

### 4. Tinybird Split Analytics Alternative

### Fit

Best if you want a managed analytics-serving layer, lower ops, and product-facing analytical APIs without going all the way to ClickHouse right now.

### Pros

- lower ops than direct ClickHouse
- strong fit for bounded product-facing analytical endpoints
- good option if you want a split analytics layer but do not want to run a more serious data platform yet

### Cons

- less “all in one place” than Timescale
- more plan- and QPS-shaped than a direct database-first architecture
- lower flexibility than raw ClickHouse

### User/Product Impact

- fast developer iteration
- strong low-ops product analytics
- lower top-end confidence than ClickHouse and less unified than Timescale

### When to choose it

If the team wants a low-ops split analytics platform rather than one main database.

## Migration Strategy

This memo assumes a **ground-up rewrite of the data plane**, not a full UI reset.

### Phase 1: Identity Foundation

Build the canonical entity model first.

### Deliverables

- `entity_uid`
- `platform`
- `platform_entity_id`
- platform-safe linking strategy
- shared product references refactored away from Steam-only identity

### User/Product Impact

- mostly invisible at first
- critical precondition for real cross-platform product behavior

### Phase 2: Raw History Plane + ClickHouse Landing

Stand up raw object storage and the new analytical plane. Begin dual-writing or replay-based backfill from Steam.

### Deliverables

- raw landing contracts
- analytical fact/event tables
- replayable history archive

### User/Product Impact

- mostly invisible initially
- reliability and future velocity improve immediately

### Phase 3: Product Marts + Query Service

Build the curated marts and typed query service.

### Deliverables

- replacements for page-serving projections
- typed query contracts for analytics and events
- no Cube dependency for new serving paths

### User/Product Impact

- first meaningful page speed improvements
- more stable heavy filters and rankings

### Phase 4: Chat Rebuild

Rebuild `/chat` around the typed query contracts.

### Deliverables

- `lookup_entity`
- `query_metrics`
- `query_events`
- `semantic_search`
- deterministic answer assembly for quantitative prompts

### User/Product Impact

- major
- this is where users should most clearly feel speed and accuracy gains

### Phase 5: Steam Parity + Cutover

Get Steam surfaces fully onto the new analytical stack.

### User/Product Impact

- broader improvements across `/apps`, `/companies`, and `/changes`

### Phase 6: First New Platform

Add exactly one non-Steam platform through the new connector model.

### User/Product Impact

- proves the architecture
- enables first real cross-platform user experience

### What Not To Do First

- do not start by porting Cube models one-for-one
- do not start by adding 5 platforms at once
- do not keep current chat orchestration and only change the database under it
- do not try to solve everything through “better prompts”

## Risks And Open Decisions

- whether Qdrant should remain long-term or only through transition
- whether Supabase auth remains permanent or temporary
- which orchestration/runtime layer owns background jobs long-term
- exact CDC / ELT path into ClickHouse
- how much raw history is retained hot versus cold

None of these should block the core recommendation.

## Final Recommendation

### Recommended Now

- thin Supabase control plane
- raw history in object storage
- ClickHouse as the analytical serving center
- Qdrant retained initially
- typed `/chat` query service
- platform-native identity before adding more platforms

If that cost floor is not workable right now:

- choose Timescale as the primary budget-conscious rebuild path
- choose Tinybird only if you prefer a split managed analytics layer over one main database

### Not Recommended Now

- keeping Supabase as the primary analytical warehouse
- expanding Cube and prompt logic as the main answer to growth
- adding multiple new platforms before identity and serving layers are fixed

### Revisit Later

- whether vectors should remain in Qdrant
- whether a lakehouse format should be introduced for colder analytical layers
- whether auth/control-plane stays in Supabase permanently
- whether a Timescale-first rebuild should later graduate to ClickHouse after funding or substantially higher scale

### User/Product Impact If This Recommendation Is Followed

The user should feel:

- faster and more dependable `/chat`
- more confidence in rankings and comparisons
- richer change/news exploration
- fewer invisible platform limits as the catalog expands

The team should feel:

- less fear of adding data
- less fear of adding platforms
- less need to trade product ambition against the primary DB

## Source Appendix

Official sources retrieved on or around March 30, 2026:

- Supabase compute and disk docs: <https://supabase.com/docs/guides/platform/compute-and-disk>
- Supabase disk usage billing examples: <https://supabase.com/docs/guides/platform/manage-your-usage/disk-size>
- ClickHouse pricing: <https://clickhouse.com/pricing>
- ClickHouse PostgreSQL integration: <https://clickhouse.com/integrations/postgres>
- Qdrant pricing: <https://qdrant.tech/pricing/>
- Qdrant Hybrid Cloud docs: <https://qdrant.tech/documentation/hybrid-cloud/>
- Tiger Data pricing: <https://www.tigerdata.com/pricing>
- Tiger Data hypertables docs: <https://www.tigerdata.com/docs/use-timescale/latest/hypertables>
- Tiger Data continuous aggregates docs: <https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates>
- Tiger Data compression docs: <https://www.tigerdata.com/docs/use-timescale/latest/compression/about-compression>
- Tinybird pricing: <https://www.tinybird.co/pricing>
- Tinybird pricing concepts: <https://www.tinybird.co/docs/forward/pricing/concepts>
- Tinybird pricing limits: <https://www.tinybird.co/docs/forward/pricing/limits>
- Apache Iceberg docs: <https://iceberg.apache.org/docs/1.7.0/>
- Trino Iceberg connector docs: <https://trino.io/docs/current/connector/iceberg>
- StarRocks vector index docs: <https://docs.starrocks.io/docs/table_design/indexes/vector_index/>
- StarRocks async materialized view docs: <https://docs.starrocks.io/docs/using_starrocks/async_mv/feature-support-asynchronous-materialized-views/>
- Vercel pricing overview: <https://vercel.com/pricing>
- Vercel pricing docs: <https://vercel.com/docs/pricing>
- Amazon S3 pricing: <https://aws.amazon.com/s3/pricing/>
