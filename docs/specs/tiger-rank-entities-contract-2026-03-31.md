# Tiger Rank Entities Contract

Date: March 31, 2026

This note defines the first ranking-oriented contract implemented on top of the
Tiger compatibility slice.

## Goal

Support broad natural-language questions like:

- "What are the most reviewed games on Steam?"
- "Which publishers have the biggest portfolios?"
- "Who has the strongest catalog if I only mean Valve?"

without exposing raw SQL or Cube internals to the planner layer.

## Contract

Endpoint:

- `POST /v1/contracts/rank-entities`

Current request shape:

- `entityKind`: `game | publisher | developer`
- `metric`: `total_reviews | owners_midpoint | ccu_peak | review_score | game_count`
- `query?`
- `limit?`
- `sortDirection?`

Current behavior:

- game rankings use `legacy.apps` + `legacy.latest_daily_metrics`
- publisher/developer rankings aggregate over:
  - `legacy.app_publishers` or `legacy.app_developers`
  - `legacy.apps`
  - `legacy.latest_daily_metrics`

## Current scoring semantics

- games:
  - `total_reviews`, `owners_midpoint`, `ccu_peak`, and `review_score` come
    from `legacy.latest_daily_metrics`
- publishers/developers:
  - `game_count` is portfolio title count
  - `total_reviews` is summed across portfolio
  - `owners_midpoint` is summed across portfolio
  - `ccu_peak` is the max title peak inside the portfolio
  - `review_score` is review-count-weighted across portfolio

## Safety rules

- `entityKind = game` rejects `metric = game_count` with a typed
  `INVALID_RANK_METRIC` error
- readiness depends on the same landed Tiger compatibility tables already used
  by entity resolution and catalog search

## Why this phase matters for `/chat`

This contract makes the new Tiger-backed data plane better at natural ranking
questions before the full historical time-series migration is complete.

It is intentionally typed and planner-friendly:

- broad enough for natural prompts
- constrained enough to stay safe and explainable
- compatible with later follow-up and comparison contracts

## Next contract phases

The next meaningful chat-oriented additions should be:

- `traceMetricHistory` after `metrics.daily_metrics` is landed in Tiger
- `compareEntities` after ranking and history surfaces are stable
- `explainChanges` after `events.app_change_events` and related docs/news
  slices are migrated
