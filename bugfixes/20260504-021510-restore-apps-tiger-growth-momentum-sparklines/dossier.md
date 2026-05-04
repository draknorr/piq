# Bug Dossier: Restore apps Tiger growth momentum sparklines

## Observed Behavior

After the `/apps` Tiger cutover, 7d growth was missing, momentum changed scale/meaning, trend counts dropped to zero, and some sparklines had no points.

## Expected Behavior

`/apps` should preserve the old Supabase metric contract: CCU growth comes from `ccu_tier_assignments`, momentum uses CCU growth plus review velocity acceleration, and the default app list excludes unreleased/delisted games.

## Evidence

- Tiger `metrics.app_trends.ccu_trend_7d_pct`: 0 non-null rows.
- Tiger `metrics.apps_page_projection.ccu_growth_7d_percent`: 0 non-null rows.
- Supabase `public.ccu_tier_assignments.ccu_growth_7d_percent`: 29,099 non-null rows.
- Supabase `public.ccu_tier_assignments.ccu_growth_30d_percent`: 48,485 non-null rows.
- Tiger `ops.ccu_tier_assignments` lacked `ccu_growth_7d_percent` and `ccu_growth_30d_percent`.
- Tiger CCU snapshots only had recent history from May 1 onward during investigation, while Supabase retained 30-day history through April 30.

## Root Cause

The Tiger migration did not preserve the Supabase `/apps` growth source or formula. `/apps` read `metrics.app_trends.ccu_trend_7d_pct`, but that field was unpopulated and is not the old CCU-tier growth metric. The materialized projection also used the new formula and included rows that the old RPC filtered out.

## Implemented Fix

- Restored growth columns and formulas in Tiger `ops.ccu_tier_assignments`.
- Updated `/apps` queries and projection SQL to read growth from `ops.ccu_tier_assignments`.
- Restored old momentum semantics.
- Reapplied active-game eligibility for list/aggregate/projection paths.
- Added a Tiger CCU snapshot backfill script.
- Made the materialized-view refresh worker Tiger-aware.
- Prevented sparkline API/auth errors from permanently caching empty sparklines.

## Remaining Operational Step

The code is ready, but production data will not show restored values until the Tiger migration/backfill/recalc/refresh sequence is run with explicit DB-write approval.

- Bug ID: `20260504-021510-restore-apps-tiger-growth-momentum-sparklines`
- Status: `assessment_in_progress`
- Created At: `2026-05-04T02:15:10.867681+00:00`

## Summary

_Assessment in progress._

## Evidence Gathered

_TBD_

## Ready for Fix Verdict

_Not yet assessed._
