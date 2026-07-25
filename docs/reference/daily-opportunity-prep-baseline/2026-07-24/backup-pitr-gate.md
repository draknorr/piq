# Production Backup/PITR Gate

Status: **Tiger recovery gate passed; writes still require separate approval**

The provider-specific recovery evidence below is complete. This does not
authorize a production Tiger migration, materialized-view refresh, backfill, or
repair; every write still requires the separate approval record below. PICS
must not be restarted into the current lossy path regardless of backup status.

## TigerData

- Provider project/database: project `n9lactseoj`; service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`, region
  `us-west-2`, status `READY`.
- Plan reported by authenticated CLI: `Performance`.
- Backup feature enabled: the live service console states that a backup is
  automatically created in the same region as the service and lists
  `us-west-2`. The authenticated CLI exposes last-snapshot and timestamped PITR
  fork operations.
- Cross-region backup: not enabled; the live console requires an Enterprise
  upgrade for this service.
- Retention window: the live production recovery page offers a fork to any
  point in the last **3 days**. This provider- and service-specific evidence
  supersedes the earlier generic 14-day planning assumption.
- Latest successful backup: the console does not expose a discrete backup-job
  timestamp. It exposes current-time recovery through a continuous PITR window
  and an enabled recovery-fork form.
- Oldest available restore point at inspection:
  `2026-07-21T02:17:00Z`, displayed as `Mon, 20 Jul 2026 19:17 (GMT -07:00)`.
- Restore target and procedure: create a separate fork, leaving production
  untouched, with
  `tiger service fork hdp8cp0w5i --to-timestamp <RFC3339> --name <recovery-name> --no-set-default`;
  validate the fork before any separately approved connection-string cutover.
  Creating the fork is itself a billable infrastructure write and requires
  explicit approval.
- Provider documentation:
  <https://docs.tigerdata.com/use-timescale/latest/backup-restore/point-in-time-recovery>
- Backup evidence URL:
  <https://console.cloud.tigerdata.com/projects/n9lactseoj/services/hdp8cp0w5i/operations/backup-restore>
- Recovery-form evidence URL:
  <https://console.cloud.tigerdata.com/projects/n9lactseoj/create_services/recovery_fork/hdp8cp0w5i>
- Verified by: Codex authenticated CLI and Chrome inspection.
- Verified at: `2026-07-24T02:19:18Z`.

### Fresh pre-0088 recovery recheck

Reverified at `2026-07-24T06:36:43Z` before requesting approval for the
durable PICS schema:

- authenticated Tiger CLI reported `publisheriq-tiger-prod`
  (`hdp8cp0w5i`) as `READY` in `us-west-2`;
- the provider console still reported automatic same-region backup and a
  three-day point-in-time recovery window;
- the recovery form offered July 23, July 22, July 21, and a partially expired
  July 20 boundary; and
- `Thu, 23 Jul 2026 22:34 (GMT -07:00)` was accepted as an available recovery
  point and enabled `Create recovery fork`.

The recovery fork was **not** created. That would be a separate billable
infrastructure write requiring explicit approval.

## Supabase

Status: **not a gate for Tiger-only work**

Supabase is authoritative only for authentication identities and sessions.
Complete this section only before an auth-plane mutation or an approved
migration that changes legacy Supabase rows. A read-only export or checksum
does not require this gate.

- Provider project:
- Backup feature enabled:
- Retention window:
- Latest successful backup:
- Oldest available restore point:
- Restore target and procedure:
- Evidence URL or access-controlled screenshot:
- Verified by:
- Verified at:

## Approval Record

- Proposed operation: concurrent refresh of the existing Apps materialized
  views.
- Affected objects: `metrics.apps_page_projection` and
  `metrics.apps_page_filter_counts`.
- Reason: restore projection/source parity and the eight-hour freshness SLO.
- Risk level: medium.
- Rollback: no base table or read flag changed; keep the recurring schedule
  disabled and rebuild again from unchanged source data if validation fails.
- Maintenance window: `2026-07-24T02:22:11Z` through
  `2026-07-24T02:24:29.891388Z`.
- Operator: Codex under the user's explicit approval.
- Communication channel: current Codex task.
- Explicit approval reference: user reply `yes` immediately following the
  operation/risk/rollback approval request.
- Outcome: passed with exact row and ID parity; see
  `apps-projection-refresh.md`.

## Approval Record: Catalog Observation Schema 0087

- Proposed operation: apply the additive Tiger catalog-observation schema.
- Affected objects: `ops.catalog_scan_runs`, `ops.app_catalog_state`,
  `events.app_catalog_events`, their indexes, and four transactional functions.
- Reason: install the durable catalog ledger needed for a separately approved
  shadow rollout.
- Risk level: medium.
- Rollback: keep `CATALOG_OBSERVATION_MODE=off` and leave the additive objects
  unused; destructive removal would require separate approval.
- Operator: Codex under the user's explicit approval.
- Communication channel: current Codex task.
- Explicit approval reference: user reply `yes` immediately following the
  operation/risk/rollback approval request.
- Outcome: applied transactionally and verified with zero initial rows; see
  `catalog-observation-schema-apply.md`.

## Approval Record: Durable PICS Schema 0088

- Proposed operation: apply
  `packages/data-plane/sql/tiger-bootstrap/0088_durable_pics_intake.sql` to
  Tiger production with `psql --single-transaction`.
- Affected objects: new `ops.pics_change_batches`,
  `ops.pics_change_batch_apps`, `ops.pics_work_state`, and
  `ops.app_data_readiness` tables plus their indexes and constraints.
- Existing-object preflight: all four tables are absent; `pgcrypto` is
  installed; `ops.pics_sync_state.id = 1` remains at cursor `37,491,237`.
- Reason: install the durable, completeness-aware PICS intake ledger needed
  for a separately approved shadow capture.
- Risk level: medium. The operation changes the production catalog and briefly
  takes normal DDL locks, but creates only new empty objects and does not alter
  or write existing tables.
- Failure rollback: `--single-transaction` rolls back the entire file if any
  statement fails.
- Post-success rollback: keep both PICS services stopped and leave
  `PICS_WORK_MODE` unset so the additive objects remain unused. Dropping them
  would be destructive and requires separate approval.
- Required verification: exact tables, columns, constraints, and indexes;
  zero rows in all four tables; unchanged PICS cursor; and no runtime
  deployment or service restart.
- Explicit approval reference: the user replied `yes` immediately after the
  operation, reason, risk, and rollback terms were presented in the current
  Codex task.
- Outcome: applied in one transaction and verified with zero rows, an unchanged
  PICS cursor, and both Railway services still stopped. See
  `durable-pics-intake-schema-apply.md`.

## Approval Record: Readiness, Events, and Signal Windows Schema 0089

- Proposed operation: apply
  `packages/data-plane/sql/tiger-bootstrap/0089_readiness_events_signal_windows.sql`
  to Tiger production with `psql --single-transaction`.
- Affected objects: additive change-event registry/version tables and seed
  rows, interpreted and health views, lifecycle events, signal windows, ten
  functions, and five source triggers.
- Reason: install the normalized readiness, event, lifecycle, and signal-window
  contracts required before versioned consumer reads.
- Risk level: medium. The operation changes the production catalog, takes
  normal DDL locks, and installs triggers on existing source relations, but
  performs no destructive migration or historical backfill.
- Recovery recheck: the authenticated Tiger console still offered a three-day
  PITR fork and enabled `Create recovery fork` for
  `Thu, 23 Jul 2026 22:34 (GMT -07:00)`. No fork was created.
- Failure rollback: `--single-transaction` rolls back the entire file if any
  statement fails.
- Post-success rollback: keep the preparation runner off and both dependent
  PICS services stopped. Disable only a faulty exact trigger in a separately
  approved write window; destructive removal requires separate approval.
- Explicit approval reference: the user wrote `0089 approved` and directed
  review/merge in the current Codex task.
- Outcome: applied successfully and verified with 43 registry definitions,
  empty lifecycle/signal/readiness state, an unchanged PICS cursor, and both
  same-named Railway services still stopped. See
  `readiness-events-windows-schema-apply.md`.

## Approval Record: Versioned Consumer Views 0090

- Proposed operation: apply
  `packages/data-plane/sql/tiger-bootstrap/0090_apps_page_projection_v2.sql`
  to Tiger production with `psql --single-transaction`.
- Affected objects: additive normal views
  `metrics.apps_page_projection_v2` and
  `metrics.apps_page_filter_counts_v2`, plus their comments.
- Reason: install the low-cost, versioned Apps contract without duplicating the
  maintained materialized projection or its refresh cost.
- Risk level: medium. The operation changes the production catalog and takes
  brief DDL locks, but does not change base-table data, refresh a projection,
  deploy a reader, or change a runtime flag.
- Recovery recheck: Tiger was `READY`; the authenticated provider form still
  offered any-point PITR for the last three days and its recovery-fork control
  was enabled. No recovery fork was created.
- Failure rollback: `--single-transaction` rolls back the entire file if any
  statement fails.
- Post-success rollback: keep every reader on its legacy default and leave the
  additive views unused. Destructive removal requires separate approval.
- Explicit approval reference: the user replied `yes` immediately after the
  operation, reason, risk, rollback, recovery, commit, and checksum were
  presented in the current Codex task.
- Outcome: applied successfully with exact Apps and filter-count row/key
  parity, no v2 ID fan-out, an unchanged PICS cursor, and both same-named
  Railway services still stopped. See
  `versioned-consumer-schema-apply.md`.

## Approval Record: Post-0090 Apps Projection Refresh

- Proposed operation: manually dispatch
  `.github/workflows/apps-projection-refresh.yml` with its backup and approval
  inputs to refresh the two existing Apps materialized views concurrently.
- Affected objects: `metrics.apps_page_projection` and
  `metrics.apps_page_filter_counts`.
- Reason: restore exact source parity and freshness before evaluating v2
  readers.
- Risk level: medium because the operation creates temporary Tiger CPU and I/O
  load and can fail on a lock or statement timeout.
- Recovery recheck: Tiger was `READY`; the authenticated provider form still
  offered any-point PITR for the last three days and its recovery-fork control
  was enabled. No recovery fork was created.
- Failure rollback: a failed concurrent refresh leaves the existing
  materialization in service; no base table, reader flag, or recurring
  schedule changes.
- Explicit approval reference: the user replied `yes` immediately after the
  one-time refresh, expected duration, risk, rollback, and separately disabled
  cadence were presented in the current Codex task.
- Outcome: GitHub Actions run `30120074312` passed; source, legacy, and v2 Apps
  counts reached exact `224,030` parity; freshness reached `0.031` hours; the
  PICS cursor remained unchanged; and both same-named Railway services stayed
  stopped. See `versioned-consumer-projection-refresh.md`.

## Approval Record: Audited PICS Reconciliation Schema 0092

- Proposed operation: apply
  `packages/data-plane/sql/tiger-bootstrap/0092_pics_cursor_checkpoint_reconciliation.sql`
  to Tiger production with `psql --single-transaction`.
- Affected objects: additive cursor-checkpoint, reconciliation-run, and
  reconciliation-item tables; a progress view; five transaction functions;
  and reconciliation provenance on `ops.pics_work_state`.
- Reason: install the audited, fail-closed transaction boundary needed to
  reconcile the frozen canonical cursor without returning to the lossy
  in-memory monitor.
- Risk level: medium. The operation changes the production catalog and takes
  brief DDL locks, but does not invoke a checkpoint, start reconciliation,
  advance a cursor, deploy a service, or change product state.
- Recovery recheck: the authenticated Tiger console still reported automatic
  same-region backup and a continuous three-day PITR fork window; the recovery
  form enabled `Create recovery fork` for a current selectable restore point.
  No recovery fork was created.
- Failure rollback: `--single-transaction` rolls back the entire file if any
  statement or lock acquisition fails.
- Post-success rollback: keep the new controls empty and unused. Destructive
  removal requires separate approval.
- Explicit approval reference: the user wrote `I approve 0092` after the
  change, reason, risk, and rollback terms were presented in the current Codex
  task.
- Outcome: applied successfully; every expected object, function, constraint,
  and index was verified; all reconciliation controls remained empty; the
  canonical cursor stayed at `37,491,237`; and the genuine PICS service
  continued isolated shadow processing while the duplicate service remained
  stopped. See `pics-audited-reconciliation-schema-apply.md`.

Repository artifacts must not contain credentials, private profile fields, or
downloaded production backups. Access-controlled evidence may be linked from
this file after verification.
