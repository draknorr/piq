# Production Backup/PITR Gate

Status: **Tiger writes blocked pending provider-dashboard evidence**

No production Tiger migration, materialized-view refresh, backfill, or repair
may proceed until every required Tiger field below is recorded. PICS must not
be restarted into the current lossy path regardless of backup status.

## TigerData

- Provider project/database: project `n9lactseoj`; service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`, region
  `us-west-2`, status `READY`.
- Plan reported by authenticated CLI: `Performance`.
- Backup feature enabled: Tiger documents automatic managed backups for cloud
  services, and the authenticated CLI exposes last-snapshot and timestamped
  PITR fork operations. The exact service Backup History remains to be
  confirmed.
- Retention window: Tiger documents 14 days for Performance services; exact
  oldest retained timestamp remains to be confirmed in Backup History.
- Latest successful backup: **pending Tiger console evidence**.
- Oldest available restore point: **pending Tiger console evidence**.
- Restore target and procedure: create a separate fork, leaving production
  untouched, with
  `tiger service fork hdp8cp0w5i --to-timestamp <RFC3339> --name <recovery-name> --no-set-default`;
  validate the fork before any separately approved connection-string cutover.
  Creating the fork is itself a billable infrastructure write and requires
  explicit approval.
- Provider documentation:
  <https://docs.tigerdata.com/use-timescale/latest/backup-restore/point-in-time-recovery>
- Evidence URL:
  <https://console.cloud.tigerdata.com/dashboard/services/hdp8cp0w5i>
- Verified by: Codex CLI inspection; dashboard history pending.
- Verified at: `2026-07-24T02:05:59Z`.

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

- Proposed operation:
- Affected objects:
- Reason:
- Risk level:
- Rollback:
- Maintenance window:
- Operator:
- Communication channel:
- Explicit approval reference:

Repository artifacts must not contain credentials, private profile fields, or
downloaded production backups. Access-controlled evidence may be linked from
this file after verification.
