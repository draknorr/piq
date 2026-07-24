# Apps Projection Native Scheduler Schema Apply

Applied and verified on July 24, 2026 UTC. This record covers only the
validator, refresh procedure, and one disabled Timescale job in schema file 0091. It does not authorize or record a projection refresh, recurring
execution, reader cutover, deployment, or PICS action.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`.
- Merged source commit:
  `92f0bb665b42af1fa1f0b4f3b38b5957d11a94bb`.
- Source file:
  `packages/data-plane/sql/tiger-bootstrap/0091_apps_projection_native_scheduler.sql`.
- Source SHA-256:
  `3ef1882699193857164f8e46f92f6240e862270992608a693f97a88c065ea330`.
- Execution: `psql` with `ON_ERROR_STOP=1` and
  `--single-transaction`.
- Risk presented: medium because the operation changes production schema and
  Timescale scheduler metadata.
- Explicit approval: the user replied `yes` after the exact change, reason,
  risk, transaction rollback, and disabled post-success state were presented
  in the current Codex task.

## Recovery and preflight

Immediately before the write:

- the authenticated Tiger CLI reported `publisheriq-tiger-prod`
  (`hdp8cp0w5i`) as `READY`;
- the authenticated Tiger recovery form offered a point-in-time recovery fork
  to any point in the last three days;
- the `Create recovery fork` control was enabled;
- no recovery fork was submitted or created;
- `origin/main` was the merged source commit above;
- the exact SQL checksum matched the approved value;
- both target routines and a matching Timescale job were absent;
- no Apps projection refresh was active;
- the PICS cursor was `37,491,237`, updated
  `2026-07-24T02:52:52.69384Z`; and
- both Railway services named `publisheriq` were stopped.

Supabase was not inspected or changed because this was a Tiger-only
product-data operation.

## Apply result

The single transaction completed successfully immediately before
`2026-07-24T20:22:16.417426Z`. PostgreSQL reported:

```text
SET
SET
CREATE FUNCTION
CREATE PROCEDURE
DO
COMMENT
COMMENT
```

No statement failed and no partial transaction remained. The transaction did
not refresh either materialized view.

## Post-apply verification

Exactly one matching job exists:

| Property                    | Live value                                          |
| --------------------------- | --------------------------------------------------- |
| Job ID                      | `1016`                                              |
| Application name            | `apps-projection-refresh-v1 [1016]`                 |
| Schedule                    | `04:00:00`, fixed UTC                               |
| Initial anchor              | `2000-01-01T00:47:00Z`                              |
| Maximum runtime             | `00:45:00`                                          |
| Retries                     | `3`, `00:15:00` apart                               |
| Config                      | `{"contract_version":"apps-projection-refresh/v1"}` |
| Scheduled                   | `false`                                             |
| Job status                  | `Paused`                                            |
| Runs / successes / failures | `0 / 0 / 0`                                         |
| Job-error rows              | `0`                                                 |

The validator is an immutable, security-invoker function and the refresh
routine is a security-invoker procedure, both owned by `tsdbadmin`.

At `2026-07-24T20:23:59.467948Z`:

- active Apps projection refreshes: `0`;
- eligible released, non-delisted source rows: `224,031`;
- legacy and v2 projection rows: `224,030 / 224,030`;
- eligible source IDs missing from the projection: `2`;
- projected IDs no longer in the eligible source set: `1`; and
- the PICS cursor remained `37,491,237`, updated
  `2026-07-24T02:52:52.69384Z`.

The source/projection difference is time-sensitive pre-refresh drift, not a
schema-apply failure or permanent threshold. A separately approved smoke must
refresh and then satisfy the procedure's exact row and app-ID parity checks.

## Live scheduler behavior correction

The paused fixed-schedule job reported
`next_start = 2026-07-24T20:47:00Z`. Tiger therefore retains a calculated next
fixed slot even while `scheduled = false` and `job_status = 'Paused'`.
`next_start = 'infinity'` is not a valid disabled-state requirement on this
service. The operator runbook now uses `scheduled = false`, `Paused`, and run
history as the authoritative containment evidence.

## Runtime containment

Read-only Railway checks after the transaction reported `stopped=true` and
latest deployment status `FAILED` for both same-named services:

- genuine legacy PICS in project `enthusiastic-caring`,
  `e6c49263-8466-4cb5-a37f-16299aae499e`;
- duplicate-named service in project `confident-education`,
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`.

Neither service was restarted, redeployed, reconnected, or used by the
scheduler.

## Rollback and next gates

The job is already in its safest post-success state: installed, paused, never
run, and unused by readers. Reapplying 0091 also enforces
`scheduled = false`. Dropping the job or routines is destructive and requires
separate approval.

The next database action is a one-time `CALL public.run_job(1016)` smoke. It is
a full production refresh of the two allowlisted materialized views and
requires fresh recovery/preflight evidence plus separate explicit approval.
Enabling recurring execution is a third, later production metadata write and
requires another approval after the smoke passes.
