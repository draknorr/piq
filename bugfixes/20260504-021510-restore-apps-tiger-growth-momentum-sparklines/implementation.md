# Implementation Notes

## Changed

- `/apps` now reads `ccu_growth_7d_percent` and `ccu_growth_30d_percent` from Tiger `ops.ccu_tier_assignments`.
- Tiger `public.recalculate_ccu_tiers()` now computes the old 3-day/prior-3-day growth metric and the 30-day baseline metric.
- `metrics.apps_page_projection` is rebuilt by migration `0081_restore_apps_ccu_growth_contract.sql`.
- The refresh worker supports Tiger materialized views when `DATA_WRITE_TARGET=tiger`.
- Added `pnpm --filter @publisheriq/ingestion backfill-tiger-ccu-snapshots`.
- Sparkline loading retries transient failures instead of caching them as empty data.

## Not Run Automatically

No production database writes were run. The migration, backfill, tier recalculation, and materialized view refresh still require explicit approval.
