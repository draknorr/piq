# Timescale vs Tinybird vs ClickHouse for PublisherIQ

Date: March 30, 2026  
Audience: Founder/operator and future implementers evaluating the next analytical backbone for PublisherIQ

This memo compares the three serious options that emerged from the architecture review:

- **Timescale / Tiger Data**
- **Tinybird**
- **ClickHouse**

For the concrete execution plan behind the recommended budget-conscious option, see [Timescale Architecture Plan](./timescale-architecture-plan-2026-03-30.md).

This is not a generic warehouse comparison. It is specific to PublisherIQ’s actual workload:

- current live database around `21 GB`
- significant time-series facts
- a growing `/changes` event/history/search surface
- `/chat` that needs faster and more deterministic analytical access
- future multi-platform growth
- current budget constraints

## Executive Summary

### If you want the strongest long-term architecture

Choose **ClickHouse + a small control-plane Postgres**.

### If you want the best budget-conscious rebuild right now

Choose **Timescale**.

### If you want the best low-ops split analytics platform right now

Choose **Tinybird**.

That is the short answer.

## What Each Option Really Is

## Timescale

Timescale is Postgres with time-series and analytical improvements like:

- hypertables
- continuous aggregates
- compression / Hypercore

It is the easiest way to keep one serious SQL database while materially improving time-series and historical query behavior.

## Tinybird

Tinybird is a managed analytics-serving product built on ClickHouse. It is strongest when you want:

- analytical APIs
- low ops
- fast productization

It is less “one database” and more “managed analytics layer.”

## ClickHouse

ClickHouse is the strongest standalone analytical engine of the three. It is best for:

- large aggregations
- event history
- broad historical scans
- product-facing analytical scale

It is the best end-state, but not the cheapest starting point.

## Quick Verdict Table

| Question | Winner |
|---|---|
| Cheapest serious rebuild | Timescale |
| Most “all in one place” | Timescale |
| Lowest-ops analytics-serving layer | Tinybird |
| Best final-form analytical backbone | ClickHouse |
| Best for current budget constraint | Timescale |
| Best for eventual large `/changes` and multi-platform analytics | ClickHouse |
| Best for founder-friendly product APIs | Tinybird |
| Best for Codex/Claude direct DB workflows | Timescale |

## Comparison By Category

## 1. Cost Floor

### Timescale

- official Tiger Data pricing starts at about `"$30/month"` compute ([pricing](https://www.tigerdata.com/pricing))
- easiest to enter on a tight budget

### Tinybird

- Tinybird Developer is listed at `"$49/month"` with `15 QPS`, `25 GB` included storage, and shared infrastructure ([pricing](https://www.tinybird.co/pricing))
- still affordable, but the pricing model is shaped more around request volume and plan limits

### ClickHouse

- practical managed cost floor is much higher than Timescale right now
- this is the main reason it is not the first move under current budget constraints

### Verdict

**Timescale** wins on pure budget-conscious practicality.

## 2. Ease Of Use

### Timescale

Strongest ease-of-use profile if you like “one serious database.”

Why:

- standard Postgres protocol
- standard SQL workflows
- easiest schema migration story
- easiest app integration story
- easiest direct use from CLIs, drivers, and AI agents

### Tinybird

Very easy operationally, but not “all in one place.” It is easier if you like:

- data pipelines into product-facing endpoints
- managed analytics APIs

It is less ideal if you want one main SQL system.

### ClickHouse

Most powerful, but least “simple” in day-to-day architecture.

### Verdict

**Timescale** wins if ease of use means “one database and standard Postgres tooling.”  
**Tinybird** wins if ease of use means “managed analytics product with low ops.”

## 3. `/chat` Fit

## Timescale

### Best at

- direct SQL friendliness
- simpler operator debugging
- simpler agent workflows
- keeping more of the analytical logic in one relational system

### Weakness

- lower long-term ceiling for very large event-heavy and ranking-heavy analytical chat questions

## Tinybird

### Best at

- bounded product-facing analytical endpoints
- typed analytical APIs for chat tools
- low-ops serving for structured analytical prompts

### Weakness

- less natural for broad ad hoc warehouse-style chat
- request/QPS shape matters more

## ClickHouse

### Best at

- long-term analytical depth
- broad historical analysis
- large event-heavy chat-backed analytical questions

### Weakness

- more cost and complexity now

### Verdict

- **Timescale** is the best budget-conscious choice for a cleaner, database-centric `/chat`
- **Tinybird** is the best low-ops choice if chat is rebuilt around bounded analytics endpoints
- **ClickHouse** is the best eventual engine if `/chat` becomes a major analytical surface at scale

## 4. `/changes` Fit

`/changes` is already a meaningful event/history/search product surface.

## Timescale

Good for:

- hot event history
- time-window analysis
- incremental rollups
- keeping things simple

Less ideal for:

- very large long-term event and search-serving growth
- the largest eventual change-history product

## Tinybird

Good for:

- hot analytical projections
- product-facing history and ranking endpoints
- recent-search and bounded change-intel serving

Less ideal for:

- “put all raw history here forever”
- very large open-ended exploratory analytics

## ClickHouse

Best for:

- large event history
- heavy slice-and-dice analytics
- a very ambitious `/changes` surface

### Verdict

**ClickHouse** is best for the final version of `/changes`.  
**Timescale** is the best budget-conscious upgrade from where you are today.  
**Tinybird** is the best low-ops split analytics middle ground.

## 5. Multi-Platform Growth

## Timescale

Can support a serious first rebuild and multiple platforms if the product remains disciplined.

Main risk:

- if PublisherIQ becomes a very broad historical analytics product, Timescale may become the next bridge rather than the final answer

## Tinybird

Can support multi-platform analytical product surfaces well if they are designed as curated analytical endpoints.

Main risk:

- less natural as the one core system for everything

## ClickHouse

Best long-term engine for:

- broad multi-platform analytical marts
- large event history
- big filtered rankings
- large search-serving projections

### Verdict

**ClickHouse** wins on long-term multi-platform scale.  
**Timescale** wins on budget-conscious rebuild realism.

## 6. Agent / CLI Friendliness

## Timescale

Strongest of the three because it is standard Postgres.

That means:

- `psql`
- standard drivers
- migrations
- MCP Postgres tools
- direct SQL exploration

all work naturally.

## Tinybird

Good tooling and product ergonomics, but still more platform-shaped and endpoint-shaped than raw Postgres.

## ClickHouse

Powerful, but less naturally aligned with the “one DB, one SQL mental model” that agents and general app tooling often assume.

### Verdict

**Timescale** clearly wins here.

## 7. Product Impact

## Timescale

### What users would feel

- more stable historical filters
- cleaner time-series product behavior
- better direct database-backed `/chat`
- easier evolution from current product shape

### What users would not get as much of

- the same long-term headroom for very large analytical exploration

## Tinybird

### What users would feel

- fast product-facing analytical endpoints
- strong low-ops product analytics
- good bounded `/chat` behavior

### What users would not get as much of

- one unified database feeling
- broad ad hoc analytical flexibility

## ClickHouse

### What users would feel

- biggest eventual improvements in `/changes`, `/chat`, and broad analytics

### What users would not get immediately

- low cost
- low complexity

## Pricing Snapshot

These are rough entry-level planning anchors, not exact invoices.

| Option | Entry pricing signal | Important constraint |
|---|---|---|
| Timescale | about `"$30/month"` compute ([pricing](https://www.tigerdata.com/pricing)) | still one Postgres-first system |
| Tinybird | Developer at `"$49/month"` with `15 QPS` and `25 GB` included storage ([pricing](https://www.tinybird.co/pricing)) | request/QPS and shared-plan ceilings matter |
| ClickHouse | meaningfully higher practical floor in managed form ([pricing](https://clickhouse.com/pricing)) | current budget constraint rules it out as the immediate move |

## Recommendation By Stage

## Stage 1: Right Now, Budget Constrained

Choose **Timescale**.

Why:

- materially better database fit than current Supabase usage
- much cheaper than ClickHouse
- more “one place” than Tinybird
- easiest direct SQL and operator workflow

## Stage 2: If You Want Low-Ops Split Analytics Instead

Choose **Tinybird**.

Why:

- strongest low-ops analytical-serving option
- great if product analytics APIs are the main goal
- good fit if you do not care as much about one core database

## Stage 3: If The Product Grows Into A Much Larger Analytical Surface

Revisit **ClickHouse**.

Why:

- strongest long-term analytical engine
- best fit for a much larger `/changes` and multi-platform analytical product

## Final Verdict

For PublisherIQ on March 30, 2026:

- **Timescale** is the best budget-conscious rebuild option
- **Tinybird** is the best low-ops split analytics option
- **ClickHouse** is the best long-term end-state if and when budget allows

That is the recommendation this memo supports.

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
- ClickHouse PostgreSQL integration: <https://clickhouse.com/integrations/postgres>
