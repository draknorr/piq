# Bug Intake: Restore apps Tiger growth momentum sparklines

- Bug ID: `20260504-021510-restore-apps-tiger-growth-momentum-sparklines`
- Created At: `2026-05-04T02:15:10.867681+00:00`
- Slug: `restore-apps-tiger-growth-momentum-sparklines`

## Original Request

The user reported that 7d growth, trend lines, momentum, and related `/apps` metrics changed or disappeared after moving `/apps` reads from Supabase to TigerData, and asked to determine why and implement the recovery plan.

## Supplied Context

- Screenshots copied into the case directory:
  - None
- Relevant files/routes/logs:
  - `/apps`
  - `/apps/[appid]`
  - `apps/admin/src/app/(main)/apps/lib/apps-queries.ts`
  - `apps/admin/src/app/(main)/apps/hooks/useSparklineLoader.ts`
  - `packages/data-plane/sql/tiger-bootstrap/0072_primary_writer_surfaces.sql`
  - `packages/data-plane/sql/tiger-bootstrap/0080_apps_page_query_accelerators.sql`

## Constraints

- Ask before behavior-changing fixes.
- Use read-only DB checks only when relevant.
- Do not apply production migrations or database writes automatically.

## Notes

- Read-only Tiger checks showed `metrics.app_trends.ccu_trend_7d_pct` populated for 0 rows and `/apps` projection 7d growth populated for 0 rows.
- Read-only Supabase checks showed old `public.ccu_tier_assignments.ccu_growth_7d_percent` still had 29k non-null values.
- The user approved implementation after the plan was presented.
