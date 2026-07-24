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

Repository artifacts must not contain credentials, private profile fields, or
downloaded production backups. Access-controlled evidence may be linked from
this file after verification.
