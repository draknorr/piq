# Versioned Consumer Schema Apply

Applied and verified on July 24, 2026 UTC. This record covers only the two
additive Tiger views in schema file 0090. It does not authorize or record a
projection refresh, signal-window refresh, deployment, environment change,
reader cutover, or PICS action.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`.
- Source commit:
  `92a44826e21918d6f5075ecf96abd9ca91cd46ae`.
- Source file:
  `packages/data-plane/sql/tiger-bootstrap/0090_apps_page_projection_v2.sql`.
- Source SHA-256:
  `cb9ef36e8d423c8ea5021b854385b5d96c998b5182c6b098bb4bb4c2965e8fa3`.
- Execution: `psql` with `ON_ERROR_STOP=1` and `--single-transaction`.
- Risk presented: medium because the operation performs production DDL and
  takes brief catalog locks.
- Explicit approval: the user replied `yes` after the exact change, reason,
  risk, failure rollback, and post-success containment terms were presented in
  the current Codex task.

## Recovery and preflight

Immediately before the write:

- the authenticated Tiger CLI reported `publisheriq-tiger-prod`
  (`hdp8cp0w5i`) as `READY`;
- the authenticated provider recovery form still offered a point-in-time fork
  to any point in the last three days;
- the `Create recovery fork` control was enabled;
- no recovery fork was submitted or created;
- `origin/main` and the clean PR 7 worktree were based on the merged source
  commit above;
- the exact SQL checksum matched the approved value;
- both target views were absent;
- the legacy Apps and filter-count projections, normalized readiness table,
  and signal-windows table were present; and
- the production role could create objects in `metrics`.

Supabase was not inspected or changed because this was a Tiger-only
product-data operation.

## Apply result

The single transaction completed successfully immediately before
`2026-07-24T19:10:58Z`. PostgreSQL reported:

```text
SET
SET
CREATE VIEW
CREATE VIEW
COMMENT
COMMENT
```

No statement failed and no partial transaction remained.

## Post-apply verification

Both targets resolve as normal views owned by `tsdbadmin`:

- `metrics.apps_page_projection_v2`;
- `metrics.apps_page_filter_counts_v2`.

Parity checks proved:

| Check                              |  Legacy |      v2 | Difference |
| ---------------------------------- | ------: | ------: | ---------: |
| Apps projection rows               | 223,851 | 223,851 |          0 |
| Filter-count projection rows       |     585 |     585 |          0 |
| Missing or added Apps IDs          |       0 |       0 |          0 |
| Duplicate v2 Apps ID groups        |       0 |       0 |          0 |
| Missing or added filter-count rows |       0 |       0 |          0 |

Additional evidence:

- `5,263` Apps rows expose normalized overall readiness;
- `0` rows expose signal-window dates because no signal-window refresh or
  backfill has been approved;
- the inherited newest projection source time remains
  `2026-07-24T02:12:23.873775Z`;
- a representative released/non-delisted top-50 v2 Apps query completed in
  `392.215 ms`; and
- `ops.pics_sync_state.id = 1` remained at cursor `37,491,237`, updated
  `2026-07-24T02:52:52.69384Z`.

## Runtime containment

No reader flag, workflow variable, deployment, or schedule changed. All new
reader controls retain their legacy defaults.

Exact Railway checks after the transaction reported:

- genuine legacy PICS
  `e6c49263-8466-4cb5-a37f-16299aae499e`:
  `deploymentStopped=true`, zero active deployments, latest status `FAILED`;
- duplicate-named service
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`:
  `deploymentStopped=true`, zero active deployments, latest status `FAILED`.

Neither service was restarted, redeployed, or reconnected.

## Rollback and next gates

The safest post-success containment is to keep all reader flags on their
legacy values and leave the additive views unused if a later check fails.
Removing the views is destructive and requires separate approval. A failed
apply would have rolled back automatically because the file ran in one
transaction.

The Apps source projection is still outside its eight-hour freshness SLO, and
signal windows remain empty. A production projection refresh/cadence change,
signal-window refresh, and each per-surface reader cutover remain separate
operations requiring their own current evidence, risk, rollback, and explicit
approval.
