# Apps Projection Manual Refresh — 2026-07-24

Status: **passed**

This was the first manually approved production refresh of the existing Tiger
Apps materialized views. The recurring schedule remains disabled.

## Approval

- Proposed operation: concurrently refresh the existing Apps read projections.
- Affected objects:
  - `metrics.apps_page_projection`
  - `metrics.apps_page_filter_counts`
- Reason: the Apps projection had not incorporated source changes since May 4,
  2026 and was missing 56,987 eligible source rows at final preflight.
- Risk: medium. The expected risks were temporary Tiger CPU/I/O pressure,
  timeout, or concurrent-refresh failure.
- Rollback: no base table or read flag changed. A failed concurrent refresh is
  transactional; the existing projection could remain in service and be
  rebuilt again from unchanged source tables.
- Approval reference: the user replied `yes` in the current Codex task
  immediately after receiving the operation, reason, risk, and rollback
  summary.
- Recovery evidence: automatic same-region backup and a live three-day PITR
  fork window were verified before execution.

## Preflight

Read-only preflight at `2026-07-24T02:22:11Z`:

- source rows: `223,851`
- projection rows: `166,864`
- row delta: `-56,987`
- latest projected source update: `2026-05-04T03:47:38.203909Z`
- freshness: `1,942.58` hours
- active Tiger connections: `1`
- active connections older than five minutes: `0`
- total Tiger connections: `8`
- both materialized views had unique indexes suitable for concurrent refresh

The draft workflow originally set `temp_buffers=512MB` and `work_mem=128MB`.
Those overrides were removed before execution because production has only
2 GiB RAM and the allocations could multiply across query-plan nodes. The
approved refresh used the service defaults:

- `temp_buffers=8MB`
- `work_mem=10,485kB`
- `maintenance_work_mem=256MB`

The Apps projection occupied `214MB` including indexes; the filter-count
projection occupied `112kB`.

## Execution

No GitHub workflow was dispatched because the new workflow is not yet present
on the default branch. The exact workflow SQL contract was executed from the
clean worktree against the production Tiger connection:

1. `REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_projection`
   - duration: `57.56s`
   - statement timeout: `30min`
   - lock timeout: `15s`
2. `REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_filter_counts`
   - duration: `4.41s`
   - statement timeout: `10min`
   - lock timeout: `15s`

No base table, cursor, writer target, reader flag, service, or recurring
schedule changed.

## Post-Validation

Read-only validation at `2026-07-24T02:24:29.891388Z`:

- source rows: `223,851`
- projection rows: `223,851`
- row delta: `0`
- missing source IDs: `0`
- extra projection IDs: `0`
- duplicate projection app IDs: `0`
- latest projected source update: `2026-07-24T02:12:23.873775Z`
- freshness: `0.202` hours
- filter rows: `585`
- filter types: `3`
- active Tiger connections: `1`
- active connections older than five minutes: `0`
- total Tiger connections: `8`

Authenticated production `/apps` rendered successfully after the refresh with
its existing route, filters, sorting, table, entity links, and pin controls.

## Remaining Schedule Gate

`ENABLE_TIGER_APPS_PROJECTION_REFRESH` remains disabled. Enabling the recurring
six-hour schedule is a separate authorization for ongoing production writes
and must not occur implicitly as part of this one-time approval.
