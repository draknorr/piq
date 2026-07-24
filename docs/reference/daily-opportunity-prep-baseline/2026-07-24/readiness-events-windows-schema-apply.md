# Readiness, Events, and Signal Windows Schema Apply

Applied and verified on July 24, 2026 UTC. This record covers only the
additive Tiger schema. It does not authorize or record a lifecycle backfill,
derived-state refresh, shadow run, PICS deployment, service restart, or reader
cutover.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`.
- Source commit: `b864058f3f1ab760829ef89ee8dd626b50b5230c`.
- Source file:
  `packages/data-plane/sql/tiger-bootstrap/0089_readiness_events_signal_windows.sql`.
- Source SHA-256:
  `5f03e65f66cd3fb03c58eb1fad7cfd1a8099f75dc2d611ce64536a8b6b1ddebc`.
- Execution: `psql` with `ON_ERROR_STOP=1` and `--single-transaction`.
- Risk presented: medium because the operation takes normal DDL locks and
  installs triggers on existing Tiger source tables.
- Explicit approval: the user wrote `0089 approved` and directed review/merge
  after the change, reason, risk, and rollback terms were presented in the
  current Codex task.

## Recovery and preflight

Immediately before the write:

- the authenticated Tiger recovery form still offered a fork to any point in
  the last three days;
- `Thu, 23 Jul 2026 22:34 (GMT -07:00)` was selected as an available recovery
  point and the `Create recovery fork` control was enabled;
- no recovery fork was submitted or created;
- `origin/main` remained at
  `4d955ec0619d13141554a17ef022fa85a1293c5a`;
- the exact committed SQL parsed as 37 PostgreSQL statements;
- all four target tables, the registry resolver, and both new views were
  absent;
- every required Tiger dependency relation was present;
- `ops.app_data_readiness` contained zero rows; and
- `ops.pics_sync_state.id = 1` remained at cursor `37,491,237`, updated
  `2026-07-24 02:52:52.69384+00`.

Supabase was not inspected or changed because this is a Tiger-only product
data-plane operation.

## Apply result

The single transaction completed successfully immediately before
`2026-07-24T08:58:28Z`. PostgreSQL reported successful creation of:

- four additive tables and their indexes;
- the `change-events/v1` registry version and 43 exact source/type
  definitions;
- two interpreted/health views;
- ten registry, lifecycle, readiness, and bounded-refresh functions;
- five source-trigger bindings; and
- the associated table/function comments.

No statement failed and no partial transaction remained.

## Post-apply verification

| Object                                  | Columns | Constraints | Indexes | Rows |
| --------------------------------------- | ------: | ----------: | ------: | ---: |
| `events.change_event_registry_versions` |       7 |           9 |       1 |    1 |
| `events.change_event_registry`          |      13 |          18 |       2 |   43 |
| `events.app_lifecycle_events`           |      13 |          19 |       4 |    0 |
| `metrics.app_signal_windows_v1`         |      46 |          29 |       3 |    0 |

Additional verification proved:

- all ten functions use invoker security;
- all five intended triggers exist and are enabled;
- `events.app_change_events_v1` and
  `ops.change_event_registry_health_v1` resolve;
- `demo_references_changed` resolves to the known `release` family;
- an unregistered source/type resolves visibly to `unknown`;
- 13 registry definitions explicitly affect readiness;
- `ops.app_data_readiness` still contains zero rows; and
- the canonical PICS cursor remains exactly `37,491,237`.

The credential-free catalog manifest across columns, constraints, indexes,
functions, triggers, and views is:

```text
record_count=181
sha256=c71940b234a0ede88293d1bc268590e95c7980613e2cb91b0d9ce66d7ce2f591
```

## Runtime containment

No bounded refresh or lifecycle materialization was run. The preparation
runner remains off by default and PR 5 was still a draft at apply time.

Exact Railway service checks after the transaction reported:

- genuine legacy PICS
  `e6c49263-8466-4cb5-a37f-16299aae499e`: `stopped=true`, deployment status
  `FAILED`;
- accidental query-api duplicate
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`: `stopped=true`, deployment status
  `FAILED`.

Neither service was restarted, redeployed, or reconnected.

## Rollback and next gate

The safest post-success rollback is to keep the runner off, keep dependent
PICS services stopped, and leave the additive evidence unused. If trigger
behavior is faulty, disable only the exact trigger in a separately approved
Tiger change window. Dropping tables, registry history, or lifecycle evidence
is destructive and requires separate approval.

PR 5 may now merge with schema-before-writer ordering satisfied. A bounded
shadow refresh or catalog lifecycle materialization remains a separate
production write requiring exact IDs/cursor, expected evidence, risk,
rollback, and explicit approval.
