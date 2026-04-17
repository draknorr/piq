# Implementation

## Summary

Rewrote the `rebuildDailyRollups()` SQL in
[`packages/youtube/src/storage.ts`](</Users/ryanbohmann/Desktop/publisheriq/packages/youtube/src/storage.ts>)
to remove repeated correlated subqueries against
`metrics.youtube_video_snapshots`.

## What Changed

- Replaced the old `app_days` + correlated snapshot lookup pattern with:
  - `rollup_counts` for the non-delta aggregates
  - `primary_matched_days` for primary-match day expansion
  - `snapshot_intervals` plus `boundary_view_counts` to compute latest snapshot
    values at each required day boundary in a set-based way
  - `primary_delta_rollups` to aggregate `matched_video_view_delta_1d` and
    `matched_video_view_delta_7d` without per-row subqueries
- Kept the output columns, delete-and-rebuild transaction, and methodology
  version behavior unchanged.

## Validation

- `pnpm --filter @publisheriq/youtube check-types`
- `pnpm --filter @publisheriq/youtube lint`
- `pnpm --filter @publisheriq/youtube test`
- Read-only production validation:
  - old query timed out at `15s`
  - old query completed in about `29.5s` at `60s`
  - new query completed in about `4.0s` at `15s`
  - old/new result diff count was `0`

## Remaining Risk

The new query is fast enough for current production volume, but rollup runtime
should still be monitored as `metrics.youtube_video_snapshots` continues to
grow.
