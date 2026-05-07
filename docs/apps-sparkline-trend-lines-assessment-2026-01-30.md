# Assessment: `/apps` Sparkline Trend Lines Not Rendering

Date: 2026-01-30
Area: `apps/admin` → `/apps` (Games list) sparkline column
Request: troubleshoot + document; **no code changes/fixes in this doc**

> Historical note: this assessment describes the old Supabase sparkline path. The current `/apps` product-data read path is Tiger-backed through server-side `runTigerQuery`.

---

> **RESOLVED (2026-01-31):** This issue was fixed in commit `3c2dda3` by changing the Supabase client pattern in `useSparklineLoader` from `getSupabase()` to `createBrowserClient()`. The fix ensures the RPC call uses session-aware cookies. A follow-up fix in commit `dc8dbd8` applied the same pattern to the Companies page. See [v2.8 Release Notes](./releases/v2.8-security-fixes.md) for details.

---

## Executive Summary

On production (`publisheriq.app`), the Sparkline column on `/apps` renders an em‑dash (`—`) instead of a chart.

At the time of this assessment, the `/apps` table data was fetched server-side while sparklines were fetched client-side via a Supabase RPC (`get_app_sparkline_data`) triggered by an `IntersectionObserver`. Any failure in that client-side path (auth/session mismatch, missing env, RPC error, observer not firing) was silently converted into “no data” because the sparkline loader cached empty results on error and did not log.

The repo contains a very recent commit explicitly titled “Fix sparkline trend lines not loading on /apps page” (`3c2dda3`, 2026-01-29). Given the timing (“recently broke”) and the symptom (“always `—`”), the most likely explanation is that production is still running a build prior to that change (or an equivalent regression reintroduced the pre-fix behavior).

## Observed Symptom (from reporter)

- Environment: production (`publisheriq.app`)
- Repro: both hard refresh and client-side navigation
- What you see: Sparkline column is `—` (no chart)

## How sparklines work (current implementation)

### UI behavior

- The table cell renders:
  - **skeleton** while `isLoading(appid)` is true
  - **`—`** when there’s no sparkline data (`dataPoints.length === 0`)
  - a Recharts sparkline when points exist

Key file: `apps/admin/src/app/(main)/apps/components/cells/SparklineCell.tsx`

### Data flow

1. `/apps` initial table data is fetched server-side (service role) and rendered.
2. Client side, `useSparklineLoader()`:
   - observes each visible sparkline cell (`IntersectionObserver`)
   - batches visible `appid`s
   - calls Supabase RPC `get_app_sparkline_data(p_appids, p_days=7)`
   - caches results per `appid`

Key file: `apps/admin/src/app/(main)/apps/hooks/useSparklineLoader.ts`

### Important failure-mode detail: errors become “no data”

If the RPC errors, throws, or returns unexpected data, the loader writes:

```ts
loadedRef.current.set(appid, { dataPoints: [], trend: 'stable' });
```

That forces the UI into the `—` state and prevents retries (until a full page reload).

This means production can “look like there’s no data” even when the real issue is auth/config/permissions/network.

## Backend verification (DB configured in this repo)

Using the `DATABASE_URL` in the repo’s root `.env`, the underlying data and RPC appear healthy:

- `ccu_snapshots` has recent rows:
  - latest snapshot observed: `2026-01-30 07:31:45.992869+00`
  - rows in last 7 days: `955,399`
- RPC returns non-empty data:
  - example: `get_app_sparkline_data(ARRAY[221100], 7)` returned 8 daily points (2026-01-23 → 2026-01-30)
- Security posture (in that DB):
  - `get_app_sparkline_data` is `SECURITY INVOKER`
  - `anon` + `authenticated` have `EXECUTE` on the function
  - `ccu_snapshots` has RLS disabled and `anon`/`authenticated` have table privileges

Interpretation:
- If production uses the same Supabase project/DB, there is no obvious backend-data outage explaining “all `—`”.
- This increases the likelihood that the break is in the **client-side fetch/trigger path** or an **out-of-date production deploy**.

## Most likely root causes (ranked)

### 1) Production deploy is behind the repo fix `3c2dda3` (highest likelihood)

Evidence:
- `git log` shows an extremely recent commit:
  - `3c2dda3` (2026-01-29): “Fix sparkline trend lines not loading on /apps page”
  - It changes `useSparklineLoader` from `getSupabase()` to `createBrowserClient()` (cookie/session-aware).

Why it would cause `—`:
- If the browser Supabase client is constructed without the correct session mechanism, the RPC may execute as the wrong role (or with missing auth context), fail, and the loader will cache an empty sparkline → UI shows `—`.

How to confirm quickly:
- Check the production deployment SHA (Vercel dashboard / deployment metadata) and verify it includes `3c2dda3` or later.

### 2) Client-side RPC is failing (401/403/5xx) but the loader hides it

Evidence:
- Loader error handling intentionally suppresses errors and stores empty arrays.
- There is no logging in the catch/error path.

Why it would cause `—`:
- Any transient failure on first load becomes a “sticky” empty state for that page session.

How to confirm:
- In browser DevTools on production:
  - Network → filter for `get_app_sparkline_data`
  - Confirm whether calls exist and their HTTP status
  - Console → look for CORS/auth/runtime errors

### 3) `IntersectionObserver` isn’t observing rows (no RPC calls fired)

Why it would cause `—`:
- If elements never get observed/intersect, no appids are queued and `sparklineData` remains null.
- UI then shows `—` (not loading skeleton) because `isLoading()` is false.

How to confirm:
- DevTools:
  - `document.querySelectorAll('[data-sparkline-appid]').length` should be > 0 on the desktop table.
  - Network should show at least one `get_app_sparkline_data` request shortly after load.

### 4) The RPC doesn’t exist or signature differs in production (lower likelihood)

Why it would cause `—`:
- The RPC call would return an error and the loader would cache empty results.

Evidence against (for DB configured in this repo):
- migration `20260116000002 (apps_page_rpcs)` is present in `supabase_migrations.schema_migrations`.
- `get_app_sparkline_data` executes and returns expected JSON.

How to confirm:
- In production’s Supabase SQL editor: run `SELECT * FROM get_app_sparkline_data(ARRAY[<some_appid>], 7);`

## Recommended verification steps (no code changes)

1. Confirm production is on the expected commit:
   - Is `3c2dda3` deployed?
2. In production DevTools, capture:
   - Network trace for `get_app_sparkline_data` (status codes + response bodies)
   - Console errors/warnings at time of load
3. In Supabase logs, filter around the time you test production:
   - look for RPC errors (auth/permissions/runtime) for `get_app_sparkline_data`

## Notes / Footguns

- The sparkline loader’s “cache empty on error” behavior makes debugging difficult because it is indistinguishable from real “no data”.
- In the old path, the `/apps` page could look “mostly fine” even if client-side Supabase calls were broken, because the primary table data path was server/service-role based.
