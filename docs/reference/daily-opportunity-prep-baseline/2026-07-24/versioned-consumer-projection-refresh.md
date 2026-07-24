# Versioned Consumer Projection Refresh

Status: **passed**

This record covers the separately approved one-time production refresh of the
legacy Apps materialized projections after schema 0090 was installed. The v2
Apps views inherit those refreshed rows without a second materialization. The
recurring schedule remains disabled.

## Approval and recovery gate

- Operation: manually dispatch `.github/workflows/apps-projection-refresh.yml`
  with its backup and approval inputs.
- Affected objects:
  - `metrics.apps_page_projection`;
  - `metrics.apps_page_filter_counts`.
- Reason: restore source parity and the eight-hour freshness SLO before any v2
  reader evaluation.
- Risk presented: medium because concurrent refresh can create temporary Tiger
  CPU and I/O pressure or fail on a lock/statement timeout.
- Failure rollback: concurrent refresh failure leaves the existing
  materialization available; no base table, reader flag, or recurring schedule
  changes.
- Explicit approval: the user replied `yes` immediately after the operation,
  expected duration, risk, and rollback were presented in the current Codex
  task.
- Recovery evidence: production Tiger was `READY`; the authenticated provider
  form offered any-point PITR for the last three days and its recovery-fork
  control was enabled. No recovery fork was created.

Supabase was not inspected or changed because this was a Tiger-only
product-data operation.

## Preflight

Read-only preflight at `2026-07-24T19:14:56.795803Z`:

- eligible source rows: `224,030`;
- legacy projection rows: `223,851`;
- row delta: `-179`;
- latest projected source update: `2026-07-24T02:12:23.873775Z`;
- freshness: `17.042` hours;
- both materialized views had valid unique indexes required by concurrent
  refresh;
- active Tiger connections: `1`;
- active connections older than five minutes: `0`;
- no Apps projection refresh was already running; and
- `ENABLE_TIGER_APPS_PROJECTION_REFRESH` was absent.

## Execution

GitHub Actions run:
<https://github.com/draknorr/piq/actions/runs/30120074312>

- event: `workflow_dispatch`;
- source ref: `main`;
- source commit:
  `92a44826e21918d6f5075ecf96abd9ca91cd46ae`;
- backup input: `true`;
- approval reference: the current Codex task and explicit one-time approval;
- job result: passed in `1m6s`;
- Apps projection concurrent refresh: about `38s`;
- filter-count concurrent refresh: about `4s`;
- workflow-recorded refresh duration: about `42s`.

The workflow's own before/after evidence was:

| State  | Projection rows | Source rows | Delta | Latest source update          |
| ------ | --------------: | ----------: | ----: | ----------------------------- |
| Before |         223,851 |     224,030 |  -179 | `2026-07-24T02:12:23.873775Z` |
| After  |         224,030 |     224,030 |     0 | `2026-07-24T19:15:39.671046Z` |

The built-in row-parity and eight-hour freshness gates both passed.

## Independent post-validation

Read-only validation at `2026-07-24T19:17:31.585814Z` proved:

- eligible source rows: `224,030`;
- legacy Apps projection rows: `224,030`;
- v2 Apps view rows: `224,030`;
- freshness: `0.031` hours;
- missing or extra source/legacy IDs: `0`;
- missing or extra legacy/v2 IDs: `0`;
- duplicate v2 app ID groups: `0`;
- legacy and v2 filter rows: `585 / 585`;
- missing or extra v2 filter rows: `0`;
- v2 rows with overall-readiness enrichment: `5,585`;
- v2 rows with signal-window enrichment: `0`, because no signal-window refresh
  or backfill has been approved;
- representative released/non-delisted v2 top-50 query:
  `297.378 ms`; and
- `ops.pics_sync_state.id = 1` remained at cursor `37,491,237`, updated
  `2026-07-24T02:52:52.69384Z`.

## Runtime containment

`ENABLE_TIGER_APPS_PROJECTION_REFRESH` remains absent. No reader flag,
deployment, or environment value changed.

Exact post-refresh Railway checks reported:

- genuine legacy PICS
  `e6c49263-8466-4cb5-a37f-16299aae499e`:
  `deploymentStopped=true`, zero active deployments, latest status `FAILED`;
- duplicate-named service
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`:
  `deploymentStopped=true`, zero active deployments, latest status `FAILED`.

Neither service was restarted, redeployed, or reconnected.

## Remaining cadence gate

The first two disabled GitHub schedule events were created about `2h19m` and
`1h51m` after their nominal cron times. That observed scheduler delay leaves
insufficient margin for an eight-hour freshness SLO, even though the refresh
itself is inexpensive.

The user selected a Tiger-native four-hour job as the long-term cadence. PR 7
removes the GitHub cron so the existing workflow remains an approval-gated
manual fallback. Schema 0091 contains the native job source, but installs it
disabled and has not been applied. Applying, smoke-running, and enabling the
native job each remain separate production writes. No recurring write was
authorized by this one-time refresh approval.
