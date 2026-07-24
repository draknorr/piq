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

Repository artifacts must not contain credentials, private profile fields, or
downloaded production backups. Access-controlled evidence may be linked from
this file after verification.
