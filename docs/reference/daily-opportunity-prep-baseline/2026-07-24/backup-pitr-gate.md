# Production Backup/PITR Gate

Status: **Tiger writes blocked pending provider-dashboard evidence**

No production Tiger migration, materialized-view refresh, backfill, or repair
may proceed until every required Tiger field below is recorded. PICS must not
be restarted into the current lossy path regardless of backup status.

## TigerData

- Provider project/database:
- Backup feature enabled:
- Retention window:
- Latest successful backup:
- Oldest available restore point:
- Restore target and procedure:
- Evidence URL or access-controlled screenshot:
- Verified by:
- Verified at:

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
