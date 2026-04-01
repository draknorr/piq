# Metrics Daily Metrics Delta

Date: March 31, 2026

Compared snapshots:

- `docs/reference/tiger-target-baseline/2026-03-31/pre-metrics-daily-metrics/`
- `docs/reference/tiger-target-baseline/2026-03-31/post-metrics-daily-metrics/`

## Schema delta

Before this phase:

- no `metrics.daily_metrics` hypertable existed in Tiger
- `traceMetricHistory` was blocked by missing runtime data

After this phase:

- `metrics.daily_metrics` exists as a Tiger hypertable
- chunk interval is `7 days`
- Tiger created `14` chunks for the loaded history window
- the query-api now reports `traceMetricHistory` as runtime-ready

## Data delta

Final post-load parity against the live source:

- source row count: `10,501,406`
- Tiger row count: `10,501,406`
- date range: `2025-12-28` through `2026-03-31`
- per-day mismatches: `0`
- duplicate `(appid, metric_date)` rows: `0`
- null key rows: `0`

## Storage notes

The hypertable parent relation stays tiny in the relation snapshot because the
real data lives in Timescale chunk tables.

Tiger-reported hypertable size after load:

- table bytes: `954,236,928`
- index bytes: `1,037,647,872`
- total bytes: `1,992,007,680`

## Runtime delta

Before load:

- `/readyz` stayed green
- `/v1/contracts` showed `traceMetricHistory` as `runtimeReadiness = blocked`

After load:

- `/readyz` is green with no blocked contracts
- `/v1/contracts` shows `traceMetricHistory` as `runtimeReadiness = ready`
- `POST /v1/contracts/trace-metric-history` returns Tiger-backed history

## Note on the raw manifest

The generated backfill manifest records the source count seen at the start of
the long-running copy. The live source added `16` rows before the copy
finished, so the final exact parity had to be verified with a fresh
post-completion check.
