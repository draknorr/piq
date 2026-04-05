# Multi-Platform Architecture Budget-Conscious Alternative

Date: March 30, 2026  
Audience: Founder/operator, future implementers, and anyone optimizing for cost, simplicity, and a cleaner database-centric rebuild than the current Supabase warehouse pattern

This memo is the explicit budget-conscious alternative to [Multi-Platform Architecture Recommendation](./multi-platform-architecture-recommendation-2026-03-30.md).

For the direct tradeoff table across the three realistic options, see [Timescale vs Tinybird vs ClickHouse for PublisherIQ](./timescale-vs-tinybird-vs-clickhouse-2026-03-30.md).

For the concrete execution plan behind this direction, see [Timescale Architecture Plan](./timescale-architecture-plan-2026-03-30.md).

It reflects an updated conclusion:

- if ClickHouse is affordable and the team wants the strongest long-term analytics backbone, it is still the best end-state
- if ClickHouse is too expensive right now, the primary budget-conscious rebuild option should be **Timescale / Tiger Data**, not “keep stretching Supabase” and not MotherDuck as the default

This is the recommended path if the team wants:

- a more database-centric product architecture
- stronger time-series and historical query capabilities than Supabase is currently providing
- fewer moving parts than a full split ClickHouse architecture
- lower monthly cost than ClickHouse Cloud’s practical floor
- standard Postgres ergonomics for app code, SQL, admin work, and LLM/CLI workflows

## Executive Summary

The primary budget-conscious rebuild option for PublisherIQ should be:

1. Timescale / Tiger Data as the main application and analytics database
2. object storage for raw archive and long-tail history
3. Qdrant retained initially for similarity and semantic retrieval
4. Vercel retained for app hosting
5. `/chat` rebuilt around typed query contracts even though the backend remains more database-centric

This option is attractive because it preserves the main advantages of “all in one place” while moving to a database product that is materially better suited to time-series and analytical history than the current Supabase setup.

It should be treated as:

- the best **budget-conscious rebuild path now**
- more durable than “stay on Supabase and optimize harder”
- still not as strong as ClickHouse for the eventual highest scale of event-heavy multi-platform analytics

## Recommendation In One Sentence

If ClickHouse is too expensive today, rebuild PublisherIQ on Timescale first, offload raw/versioned history to object storage, and treat ClickHouse as a later upgrade path rather than forcing it immediately.

## Why This Option Exists

The current system is showing three separate issues:

1. Supabase Postgres is being used as warehouse, event store, queue/control store, auth store, and chat-serving dependency
2. the workload is increasingly time-series and event-heavy
3. the product is growing toward multi-platform historical analytics, not just app-platform CRUD

If the team is comfortable being more database-centric and wants fewer moving parts, Timescale is the natural budget-conscious alternative because it improves the database side directly rather than introducing a second analytics product immediately.

## Current State Snapshot

Key findings from read-only inspection on March 30, 2026:

- current live database size is about `21 GB`
- the biggest storage pressure is not just core metrics; it is also change/news history and search projections
- some of the largest surfaces are:
  - `steam_news_versions` about `4.5 GB`
  - `app_change_events` about `3.0 GB`
  - `steam_news_search_projection` about `2.5 GB`
  - `daily_metrics` about `2.0 GB`
  - `ccu_snapshots` about `1.8 GB`
- several tables and summary surfaces show high write churn, especially `sync_status`, `apps`, `review_histogram`, and summary tables/views
- `/chat` is a sequential orchestration loop over multiple services and prompt guardrails
- the identity model is still Steam-native in too many places

That means the budget-conscious option still has to solve:

- platform-native identity
- better time-series and history handling
- `/chat` query discipline
- archive separation

## Why Timescale Instead Of Supabase

Supabase is valuable as an app platform. Your current problem is increasingly a **database and analytics shape** problem rather than a missing app-platform feature problem.

Timescale improves the specific parts that matter here:

- **hypertables** for time-series partitioning and chunking
- **continuous aggregates** for incremental rollups instead of repeatedly rebuilding broad summary surfaces
- **compression and tiering** for historical retention
- normal Postgres access patterns for app code, SQL tools, and agents

Official docs and pricing:

- pricing starts around `"$30/month"` compute on Tiger Data Cloud ([pricing](https://www.tigerdata.com/pricing))
- hypertables ([docs](https://www.tigerdata.com/docs/use-timescale/latest/hypertables))
- continuous aggregates ([docs](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates))
- compression / Hypercore ([docs](https://www.tigerdata.com/docs/use-timescale/latest/compression/about-compression))

## Design Goal

This option optimizes for:

- lower monthly cost than ClickHouse Cloud
- one primary database mental model
- easier admin and agent workflows
- lower architectural complexity
- better time-series/history ergonomics than Supabase

This option does **not** optimize for:

- the strongest final-form analytics engine
- the largest future event/search workload ceiling
- the cleanest long-term separation between control plane and analytics plane

## Proposed Budget-Conscious Stack

### Core Stack

| Layer | Service | Role |
|---|---|---|
| Frontend and route hosting | Vercel | app hosting, streaming UX, deployments |
| Primary database | Timescale / Tiger Data | application data, hot analytical data, time-series history, incremental rollups |
| Raw archive | S3-compatible object storage | raw payloads, source snapshots, old versions, replay and backfill |
| Retrieval plane | Qdrant Cloud | semantic similarity and concept retrieval |
| Auth layer | keep existing auth short-term or move later | separate decision from the database rebuild; do not let auth choice block the database decision |

### Why This Stack

### Timescale becomes the main data home

Timescale is the key change in this memo because it gives you:

- one serious database
- better time-series storage and query behavior
- better long-horizon retention patterns than current Supabase usage
- strong Postgres compatibility for code, SQL, and tool access

### Object storage becomes mandatory

Even in an all-in-one-ish Timescale architecture, raw archives should not stay forever in the main database.

The following categories should be stored primarily in object storage:

- full source versions
- full news versions
- large raw snapshots
- replay and backfill artifacts

### Qdrant stays for now

Qdrant remains the simplest way to preserve:

- “games like X”
- concept search
- semantic retrieval

without forcing a broader search/retrieval rewrite while the data plane changes.

## What Changes Vs The Main Recommendation

| Area | Main recommendation | Budget-conscious Timescale option |
|---|---|---|
| Core data shape | split control plane and analytics plane | one stronger Postgres-first data core plus object storage |
| Analytical engine | ClickHouse | Timescale |
| Operational complexity | moderate | lower |
| Cost floor | higher | lower |
| “all in one place” ergonomics | lower | much higher |
| Event analytics ceiling | higher | lower |
| Agent / CLI friendliness | good | strongest |

## What Changes Vs Tinybird

| Area | Tinybird | Timescale |
|---|---|---|
| Architecture style | split analytics-serving layer | one main Postgres-first database |
| Cost model | request/QPS-oriented | database compute/storage-oriented |
| Best fit | product-facing analytical APIs | one primary app and analytics database |
| Ad hoc SQL and agent access | more bounded and endpoint-shaped | much easier and more direct |
| “all in one place” feel | lower | much higher |
| Long-term analytics ceiling | higher than Timescale in some product-analytics shapes | lower than Tinybird for some heavy analytics, but simpler overall |

## Product Impact Summary

### What Users Should Notice

- `/chat` should become more reliable because metric and event queries can be routed through a cleaner query layer over one database instead of the current Supabase + Cube + RPC sprawl
- `/apps` and `/companies` should feel more stable and more predictable on time-series-heavy filters
- `/changes` should support longer retention and better hot-history reads without leaning on the current Supabase pattern
- the product should feel less brittle as historical coverage expands

### What Mostly Improves Internally

- easier SQL access for developers and agents
- simpler debugging because more of the data lives in one relational system
- easier migrations and schema changes than a split analytical stack
- easier time-series tuning than current Supabase usage

### What New Capabilities Become Realistic

- cleaner incremental rollups instead of repeated broad summary rebuilds
- more historical windows on pages and chat
- more credible multi-platform rollout without immediately introducing a second analytics engine
- stronger direct SQL and admin tooling for operators and AI agents

## Experience Changes By Product Surface

| Surface | Improvement in this option | Remaining limit | Magnitude |
|---|---|---|---|
| `/chat` | better query discipline over one primary DB, easier identity resolution, easier direct SQL-style reasoning | lower analytical ceiling than ClickHouse for very large ranking/event workloads | Major |
| `/apps` | stronger time-series reads, incremental aggregates, better stability for historical slices | still weaker than ClickHouse for the largest wide analytics scans | Moderate to major |
| `/companies` | easier cross-company rollups and historical analysis in one SQL system | may still require carefully designed aggregates as data broadens | Moderate |
| `/changes` | better hot-history handling than current Supabase usage, easier retention strategies with hypertables and archive offload | full event/search growth still has a lower ceiling than ClickHouse | Moderate |
| Admin / ops | cleaner operational model and easier tooling than a multi-engine stack | fewer specialization tools for extreme analytics scale | Moderate |

## Capability Unlocks By Service

| Service | What it enables | User-visible? | Magnitude |
|---|---|---|---|
| Timescale | one primary SQL system with better time-series handling, incremental rollups, and historical retention | Yes | Major |
| Object storage | raw replay, archive retention, version history outside the main DB | Mostly indirect | Moderate |
| Qdrant | similarity search and retrieval augmentation | Yes | Moderate |
| Vercel | frontend delivery and streaming UX | Yes | Moderate |
| Typed query service | safer `/chat`, cleaner page contracts, less prompt routing ambiguity | Yes | Major |

## Major vs Moderate vs Mostly Invisible Changes

### Major Changes

- Timescale replaces Supabase as the main data home for product and analytics workloads
- `/chat` becomes more deterministic because data access can be simplified
- historical product surfaces get a better long-term home than current Supabase usage

### Moderate Changes

- better page speed and stability for time-series-heavy filters
- more maintainable rollups and summaries
- more operator and agent friendliness through standard Postgres access

### Mostly Invisible Improvements

- less warehouse pressure on the current app platform
- cleaner archive strategy
- easier direct database workflows for maintenance and debugging

## Expected Performance And Quality Improvements

These are expected target ranges, not promises.

| Area | Current pattern | Expected target in Timescale-first path |
|---|---|---|
| `/chat` first token for common structured prompts | multi-hop, retry-sensitive | roughly `1.5-3s` target for common typed prompts |
| `/chat` answer stability | prompt/tool routing heavy | fewer weird metric answers and less adjacent-tool churn |
| `/apps` and `/companies` | bounded by current summary surfaces and warehouse pressure | stronger common historical filters and better stability on time-window queries |
| `/changes` | increasingly heavy on the current main DB | improved hot-history handling, but not the same future ceiling as ClickHouse |

## Chat Implications

Timescale does not remove the need to redesign `/chat`.

Even in a Timescale-first path, `/chat` should move toward:

- `lookup_entity`
- `query_metrics`
- `query_events`
- `semantic_search`

### Why Timescale is good for chat today

- standard Postgres access means direct SQL and tooling are simpler
- agent workflows are easier because the database protocol and ecosystem are standard
- fewer moving pieces can make operator debugging easier

### Where Timescale is weaker than ClickHouse

- huge event-heavy analytical scans
- broader future `/changes` scale
- top-end cross-platform analytical serving

## Recommended Data Placement

### Keep hot in Timescale

- entities and latest-state catalog data
- `daily_metrics`
- `ccu_snapshots`
- `review_deltas`
- `review_histogram`
- hot `app_change_events`
- hot searchable projections for recent change/news use cases
- app-serving rollups and aggregates

### Move to object storage

- raw source snapshots
- full document/news version history
- older large immutable historical artifacts
- replay and backfill payloads

### Keep separate from the database decision

- auth provider choice
- billing provider choice
- frontend hosting

Do not let those block the Timescale decision.

## Cost Model Assumptions

These are budgetary planning ranges, not invoice reconstructions.

Assumptions:

- current live DB is about `21 GB`
- not all of that should remain hot in the main database after archive separation
- object storage holds raw/version history
- Qdrant remains for vector retrieval
- traffic is currently light, with significant growth planned

## Budgetary Cost Breakdown: Timescale-First

### Monthly cost bands by service

| Service | Current-ish | 5x Steam | 5 platforms | Notes |
|---|---:|---:|---:|---|
| Timescale / Tiger Data | `$30-$150` | `$150-$600` | `$500-$2,000+` | compute and storage grow with hot analytical usage |
| Object storage | `$10-$80` | `$75-$300` | `$250-$1,000` | archive and raw replay store |
| Qdrant Cloud | `$0-$150` | `$100-$500` | `$300-$1,200` | optional initially if semantic retrieval remains important |
| Vercel | `$20-$150` | `$50-$300` | `$150-$1,000` | traffic dependent |
| Background jobs / observability | `$25-$200` | `$100-$400` | `$250-$1,000` | worker runtime plus logs/monitoring |
| **Estimated total** | **`$85-$730`** | **`$475-$2,100`** | **`$1,450-$5,200+`** | broad planning range |

### Product outcome by spend tier

| Spend tier | What it buys |
|---|---|
| Under `$1k` | a serious single-database rebuild with much better time-series behavior than current Supabase usage |
| Low thousands | stronger historical product features and more room for new platforms before needing a second analytical engine |
| Mid thousands and up | sustained growth, but likely the point where ClickHouse should be revisited |

## Cost Comparison vs Other Options

| Stack direction | Small scale | Growth scale | Product effect |
|---|---|---|---|
| Current direction: Supabase warehouse + Cube + Qdrant | cheap-to-moderate initially | pain rises as history and projections grow | good iteration speed, poor long-term fit |
| Budget-conscious: Timescale + object storage + Qdrant | best price-to-architecture balance if ClickHouse is too expensive now | scales better than current Supabase usage, but with a lower ultimate ceiling than ClickHouse | best practical rebuild path on a tighter budget |
| Low-ops split analytics: Tinybird + app DB + Qdrant | attractive if you want a managed analytics API layer | can be very good for product APIs, but less “one place” and more endpoint/QPS shaped | best if you want a split analytics layer without ClickHouse |
| Main recommendation: ClickHouse + control-plane Postgres + object storage + Qdrant | more expensive early | strongest long-term scale and product headroom | best end-state |

## Why Not Tinybird As The Primary Budget-Conscious Default

Tinybird is still a valid option. It is just no longer the primary budget-conscious rebuild option in these docs.

### Tinybird remains attractive when

- the team wants a product-facing analytics API layer
- low ops is more important than “all in one place”
- traffic is light enough that Developer or modest production plans are sufficient

### Timescale is the better default when

- the team wants one serious database
- SQL access and Postgres tooling matter a lot
- LLM/CLI direct database access is a product and workflow advantage
- the budget rules out ClickHouse but the team still wants a robust rebuild

## Why Not Stay On Supabase

### Pros Of Staying

- lowest migration friction
- app platform conveniences remain in one place
- strong developer ergonomics for auth and app plumbing

### Cons Of Staying

- the product is already hitting the wrong shape for the current feature set
- time-series and history-heavy workloads remain awkward
- analytical and control-plane workloads remain coupled
- the same long-term problem is likely to return even after optimization work

### Bottom line

If Supabase no longer feels like the right database product for PublisherIQ’s workload, that instinct is probably correct.

## Migration Approach

This path is a **budget-conscious rebuild**, not a pile of isolated optimizations.

### Phase 1: Identity foundation

- adopt `entity_uid`
- adopt `platform`
- adopt `platform_entity_id`
- stop assuming Steam identity everywhere

### User/Product Impact

- mostly invisible
- critical precondition for a clean multi-platform future

### Phase 2: Timescale landing

- stand up Timescale
- move core app and hot analytical tables
- adopt hypertables for time-series surfaces
- replace broad rebuild patterns with continuous aggregates where appropriate

### User/Product Impact

- improved stability and query behavior on key analytical paths

### Phase 3: Archive separation

- move raw versions and large immutable history to object storage
- keep only hot analytical/search-serving representations in Timescale

### User/Product Impact

- better long-term historical retention without bloating the main database

### Phase 4: Query service and chat rebuild

- add typed query contracts
- simplify `/chat`
- remove dependence on prompt-heavy data planning wherever possible

### User/Product Impact

- major
- this is where users most clearly feel improved speed and answer quality

### Phase 5: First new platform

- add one platform using the new identity and query contracts

### User/Product Impact

- first real proof that the architecture scales beyond Steam cleanly

## When To Choose This Option

Choose the Timescale-first path if:

- ClickHouse is too expensive right now
- the team wants a more database-centric product architecture
- staying “mostly in one place” is a feature, not a drawback
- direct SQL, CLI, and agent workflows matter
- the team accepts that a later move to ClickHouse may still happen if the product becomes much larger

## Where This Option Stops Being The Right Answer

You have outgrown the Timescale-first path when:

- `/changes` becomes a much larger event/search product than it is today
- chat traffic and analytical exploration become materially heavier
- multiple new platforms meaningfully expand event and document history
- the team keeps inventing workarounds to avoid wide analytical workloads in the main database

At that point, the main recommendation should be revisited.

## Final Read

This option should now be treated as the primary **budget-conscious rebuild option** for PublisherIQ.

It is not the strongest long-term analytical end-state. It is the strongest combination of:

- price
- simplicity
- database quality
- direct SQL friendliness
- realistic migration value

If budget is the binding constraint, Timescale is the best serious rebuild option right now.

## Source Appendix

Official sources retrieved on or around March 30, 2026:

- Tiger Data pricing: <https://www.tigerdata.com/pricing>
- Tiger Data hypertables docs: <https://www.tigerdata.com/docs/use-timescale/latest/hypertables>
- Tiger Data continuous aggregates docs: <https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates>
- Tiger Data compression docs: <https://www.tigerdata.com/docs/use-timescale/latest/compression/about-compression>
- Tinybird pricing: <https://www.tinybird.co/pricing>
- Tinybird pricing concepts: <https://www.tinybird.co/docs/forward/pricing/concepts>
- Tinybird pricing limits: <https://www.tinybird.co/docs/forward/pricing/limits>
- ClickHouse pricing: <https://clickhouse.com/pricing>
- ClickHouse Postgres integration: <https://clickhouse.com/integrations/postgres>
- Qdrant pricing: <https://qdrant.tech/pricing/>
- Qdrant Hybrid Cloud docs: <https://qdrant.tech/documentation/hybrid-cloud/>
- Supabase pricing: <https://supabase.com/pricing>
- Supabase compute and disk docs: <https://supabase.com/docs/guides/platform/compute-and-disk>
- Vercel pricing: <https://vercel.com/pricing>
- Amazon S3 pricing: <https://aws.amazon.com/s3/pricing/>
