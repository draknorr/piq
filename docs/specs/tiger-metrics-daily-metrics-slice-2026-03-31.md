# Tiger Metrics Daily Metrics Slice

Date: March 31, 2026

This note defines the first historical time-series migration landed in Tiger.

It is based on the live source schema captured in
`docs/reference/tiger-live-baseline/2026-03-31/schema.sql`.

## Goal

Move the live `public.daily_metrics` fact table into Tiger as a real hypertable
without disturbing the existing `legacy.latest_daily_metrics` compatibility
slice.

This is the minimum historical surface needed for trend questions in `/chat`
and for the first history-oriented query contract.

## Source and target

Source table:

- `public.daily_metrics`

Target table:

- `metrics.daily_metrics`

## Landing rules

- preserve source rows losslessly enough for replay and parity checking
- keep source `id` as provenance in `source_daily_metric_id`
- use `(appid, metric_date)` as the canonical key in Tiger
- keep source review/playtime/pricing/recent-review fields
- do not add compression, retention, or tiering in this phase
- do not replace `legacy.latest_daily_metrics` yet

## Hypertable shape

- time column: `metric_date`
- chunk interval: `7 days`
- compatibility indexes:
  - `(appid, metric_date DESC)`
  - `(metric_date)`
  - partial index on `ccu_source`
  - partial provenance index on `source_daily_metric_id`

## Final validation

Final post-load parity was validated against the live source after the backfill
completed:

- source row count: `10,501,406`
- Tiger row count: `10,501,406`
- date range: `2025-12-28` through `2026-03-31`
- mismatched day counts: `0`
- duplicate `(appid, metric_date)` rows in Tiger: `0`
- null-key rows in Tiger: `0`
- hypertable chunk count: `14`
- hypertable total size: `1,992,007,680` bytes

The raw manifest captured during the load shows an initial source total of
`10,501,390`. The live source grew by `16` rows while the copy was in flight,
so final parity had to be verified against a fresh post-load source count.

## Sample row parity

Spot checks matched exactly for:

- `appid = 10`, `metric_date = 2025-12-28`
- `appid = 1511000`, `metric_date = 2026-02-12`
- `appid = 4566970`, `metric_date = 2026-03-31`

## Rollback

Rollback is still contained to Tiger dev:

- stop consumers of `metrics.daily_metrics`
- drop `metrics.daily_metrics`
- reapply the corrected bootstrap SQL
- rerun the backfill from the live source

Supabase remains the source of truth for this phase.
