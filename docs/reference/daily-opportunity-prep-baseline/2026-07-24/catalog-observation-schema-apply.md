# Catalog Observation Schema Apply

Status: **applied and verified; observation remains disabled**

## Approval

- Approved operation: apply the additive Tiger schema in
  `packages/data-plane/sql/tiger-bootstrap/0087_catalog_observation.sql`.
- Reason: install the durable catalog scan ledger and transactional RPCs needed
  for a separately approved shadow rollout.
- Risk communicated: medium; production DDL and catalog locking, with no
  deletes, rewrites, or backfill.
- Rollback communicated: keep `CATALOG_OBSERVATION_MODE=off` and leave the
  additive objects unused. Any destructive removal requires separate approval.
- Explicit approval reference: user reply `yes` immediately following the
  operation, risk, and rollback request in the current Codex task.

## Applied Artifact

- Git commit: `06407084113c5423c5b7f54e6a02a6d15f2bd245`
- SQL SHA-256:
  `19d5a5a45f80385be3c8c278089ac99871a036c71b24ea0beeeb3d2b20579049`
- Target: Tiger service `publisheriq-tiger-prod`, database `tsdb`, role
  `tsdbadmin`.
- Execution safety: `ON_ERROR_STOP=1` and one transaction for the complete SQL
  file.
- Outcome: three tables, nine explicit supporting indexes, and four functions
  were created without error.

## Read-only Verification

Verified after the apply on `2026-07-24T04:08:07Z`:

- Tables:
  - `ops.catalog_scan_runs`
  - `ops.app_catalog_state`
  - `events.app_catalog_events`
- Functions:
  - `ops.begin_catalog_scan`
  - `ops.commit_catalog_scan_batch`
  - `ops.complete_catalog_scan`
  - `ops.fail_catalog_scan`
- All `68` table constraints reported as validated.
- PostgreSQL reported `14` total indexes across the three tables, including
  primary-key and unique-constraint indexes.
- Every new table contained zero rows.
- Every function remained invoker-security (`SECURITY DEFINER = false`).

## Activation State

- GitHub repository variable `CATALOG_OBSERVATION_MODE` is not defined.
- Both catalog workflows use a fail-closed fallback of `off`.
- Pull request `#41` remains a draft and is not merged.
- No catalog scan, backfill, stub seed, priority update, or storefront enqueue
  was run.
- No Supabase schema or data was read or changed for this Tiger-only operation.

The next production mutation is a separately approved manual shadow scan after
the implementation is reviewed and merged.
