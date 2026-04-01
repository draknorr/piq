# Tiger Trace Metric History Contract

Date: March 31, 2026

This note defines the first history-oriented query contract implemented on top
of Tiger.

## Goal

Support natural questions like:

- "How has Counter-Strike CCU changed this month?"
- "Show me owners and review sentiment over time for this game."
- "What happened to this game's price and reviews over the last 30 days?"

without exposing raw SQL, Cube internals, or fragile prompt-only logic.

## Contract

Endpoint:

- `POST /v1/contracts/trace-metric-history`

Current request shape:

- `entityUid`
- `metrics`
- `startDate?`
- `endDate?`

Current supported metrics:

- `owners_midpoint`
- `ccu_peak`
- `total_reviews`
- `positive_reviews`
- `negative_reviews`
- `review_score`
- `positive_percentage`
- `price_cents`
- `discount_percent`
- `average_playtime_forever`
- `average_playtime_2weeks`

Current defaults and limits:

- default window: last `30` days
- maximum window: `180` days
- maximum metrics per request: `4`
- output cadence: daily points only
- no gap-filling in this phase

## Current execution path

The contract resolves identity from:

- `core.entities`

and reads history from:

- `metrics.daily_metrics`

Derived metrics are computed at read time:

- `owners_midpoint` from `owners_min` and `owners_max`
- `positive_percentage` from `positive_reviews / total_reviews`

## Safety rules

- only Steam game entities are supported in this phase
- unknown `entityUid` returns `TRACE_ENTITY_NOT_FOUND`
- non-game entities return `INVALID_TRACE_ENTITY_KIND`
- invalid UUIDs return `INVALID_TRACE_ENTITY_UID`
- unsupported metrics return `INVALID_TRACE_METRIC`
- date ranges over `180` days return `TRACE_RANGE_TOO_LARGE`

## Validation

Validated on March 31, 2026:

- `/v1/contracts` reports `traceMetricHistory` as Tiger runtime-ready
- `/readyz` remains green after the table is loaded
- a Tiger-backed request for Counter-Strike returned `200` with daily series for:
  - `owners_midpoint`
  - `ccu_peak`
  - `positive_percentage`
- typed failure paths returned the expected errors for:
  - unknown valid UUID
  - publisher entity UID
  - unsupported metric
  - oversized date range

## Why this phase matters for `/chat`

This is the first contract that materially improves time-aware natural language.

It gives the planner a safe typed tool for:

- trend questions
- follow-up narrowing around a single game
- mixed metric questions over a bounded time window

The next meaningful chat-facing addition should be `events.app_change_events`
plus `explainChanges`, so the system can answer "why did this move?" and not
just "how did this move?"
