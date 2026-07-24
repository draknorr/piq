# Durable Steam Catalog Observation

PublisherIQ records Steam catalog discovery in TigerData before advancing the
incremental hint cursor. The implementation covers both
`IStoreService/GetAppList` sources:

- `steam_change_hints`: hourly incremental observations using
  `if_modified_since`, with a five-minute overlap.
- `steam_applist`: the independent daily full-list reconciliation.

Supabase is not part of this product-data path. It remains authoritative for
authentication, sessions, and user-control records.

## Safety Boundary

The code and workflows default to `CATALOG_OBSERVATION_MODE=off`. Merging or
deploying the code does not create tables and does not activate catalog
observation.

Both `shadow` and `primary` write durable catalog records, seed previously
unknown apps, initialize priority, and enqueue storefront capture in Tiger.
`shadow` additionally compares the database transaction's unknown and
changed-known ID dispositions with the legacy calculation and fails the run on
any mismatch. `primary` removes that comparison only after the shadow exit gates
have passed.

| Mode      | Behavior                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------- |
| `off`     | Preserve the current AppList and hint paths. Invalid values fail closed before a worker starts. |
| `shadow`  | Use transactional catalog observation and require exact per-batch parity.                       |
| `primary` | Use transactional catalog observation without the legacy parity assertion.                      |

## Schema

The additive schema is
`packages/data-plane/sql/tiger-bootstrap/0087_catalog_observation.sql`:

- `ops.catalog_scan_runs` stores scan identity, fixed source time, cursor,
  batch manifests, counts, reconciliation, and terminal status.
- `ops.app_catalog_state` preserves first observation and tracks the latest
  successful and full-list observations.
- `events.app_catalog_events` stores idempotent first/baseline observations.
- `ops.begin_catalog_scan`, `ops.commit_catalog_scan_batch`,
  `ops.complete_catalog_scan`, and `ops.fail_catalog_scan` provide the
  transactional writer boundary.

The schema file is never applied by a scheduled workflow.

## Required Approval Gate

Before applying the schema, capture current Tiger provider-dashboard evidence
for:

1. backup/PITR retention;
2. latest successful backup or available restore point;
3. the earliest and latest restorable times;
4. the documented restore procedure and target database.

Applying `0087_catalog_observation.sql` is a production database write and
requires separate explicit approval. The approval request must state the exact
database, change, reason, risk, and rollback.

After approval, apply with `ON_ERROR_STOP` during the approved window:

```bash
source .env
/opt/homebrew/opt/libpq/bin/psql "$TIGER_PRIMARY_URL" \
  -v ON_ERROR_STOP=1 \
  -f packages/data-plane/sql/tiger-bootstrap/0087_catalog_observation.sql
```

Do not set `CATALOG_OBSERVATION_MODE` during the schema-application step.

## Post-Apply Verification

Run read-only checks before activating a worker:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE (table_schema, table_name) IN (
  ('ops', 'catalog_scan_runs'),
  ('ops', 'app_catalog_state'),
  ('events', 'app_catalog_events')
)
ORDER BY table_schema, table_name;

SELECT routine_schema, routine_name
FROM information_schema.routines
WHERE routine_schema = 'ops'
  AND routine_name IN (
    'begin_catalog_scan',
    'commit_catalog_scan_batch',
    'complete_catalog_scan',
    'fail_catalog_scan'
  )
ORDER BY routine_name;
```

## Shadow Rollout

1. Keep the repository variable absent or set to `off` after merge.
2. Apply and verify the additive schema under the separate database approval.
3. Dispatch bounded manual AppList and hint runs with `shadow`.
4. Confirm exact disposition and replay behavior.
5. Enable `shadow` for the scheduled workers.
6. Require three complete daily AppList cycles before considering `primary`.

For every cycle, verify:

```sql
SELECT
  id,
  run_key,
  source,
  mode,
  scan_kind,
  status,
  source_started_at,
  requested_if_modified_since,
  committed_through,
  source_rows_committed,
  accepted_rows,
  rejected_rows,
  known_rows,
  unknown_rows,
  changed_known_rows,
  unchanged_known_rows,
  seeded_rows,
  enqueued_rows,
  event_rows,
  reconciliation_outcome,
  error_message,
  completed_at
FROM ops.catalog_scan_runs
ORDER BY created_at DESC
LIMIT 20;
```

Required evidence:

- `source_rows_committed = accepted_rows + rejected_rows`;
- every batch index is present once and its replay hash is stable;
- per-batch unknown and changed-known ID parity passed;
- new apps remain `catalog_seed_state = 'stub'` until storefront hydration;
- new apps have priority at least `25`;
- every unknown or changed-known ID has a storefront work disposition;
- unchanged hint rows retain their prior `ops.sync_status.updated_at`;
- the daily run is `scan_kind = 'full'`;
- no removal is inferred from a single missing full scan.

GitHub job reruns retain `GITHUB_RUN_ID`, so they resume the same run key and
verify every committed batch hash before continuing.

## Rollback

The first rollback is configuration-only:

1. set `CATALOG_OBSERVATION_MODE=off`;
2. cancel any newly queued manual catalog workflow run;
3. leave the additive tables and events intact for audit;
4. verify the hourly and daily legacy paths complete normally.

Do not drop tables, delete observations, or rewrite first-observation timestamps
as part of rollback. A schema removal would be destructive and requires a
separate migration, impact review, backup verification, and explicit approval.
