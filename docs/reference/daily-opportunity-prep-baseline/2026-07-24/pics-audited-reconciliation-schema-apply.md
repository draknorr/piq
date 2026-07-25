# Audited PICS Reconciliation Schema Apply

Applied and verified on July 25, 2026 UTC. This record covers only Tiger
migration 0092. It does not authorize or record a cursor checkpoint,
reconciliation run, canonical cursor advance, Railway deployment, reader
cutover, or Supabase operation.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`, region
  `us-west-2`.
- Source commit: `c5973fe09048884c58bca1efed742a746f665c8c`.
- Source file:
  `packages/data-plane/sql/tiger-bootstrap/0092_pics_cursor_checkpoint_reconciliation.sql`.
- Source SHA-256:
  `5a30173641903d17340bd61d27f060c844efba1500397be0c6d95257d4fbb6b4`.
- Execution: `psql` with `ON_ERROR_STOP=1` and `--single-transaction`.
- Risk presented: medium because the migration changes the production catalog
  and briefly takes normal DDL locks.
- Failure rollback: the single transaction rolls back the entire file on any
  SQL error or lock timeout.
- Post-success rollback: leave the additive objects unused. Destructive removal
  requires separate approval.
- Explicit approval: the user wrote `I approve 0092` after the exact scope,
  reason, risk, and rollback terms were presented in the current Codex task.

## Recovery and preflight

Immediately before execution, the authenticated Tiger console confirmed:

- automatic same-region backup for `publisheriq-tiger-prod`;
- a continuous point-in-time recovery fork to any point in the last three days;
- an enabled `Create recovery fork` action for a currently selectable restore
  point; and
- backup region `us-west-2`, with the listed backup created at
  `2026-04-06T03:58:24.617497Z`.

No recovery fork was created. A fork is a separate billable infrastructure
write.

The bounded read-only Tiger preflight at
`2026-07-25T02:14:04.470729Z` proved:

- all three target tables, the progress view, the five functions, and
  `ops.pics_work_state.reconciliation_run_id` were absent;
- `pgcrypto` and every referenced source relation were present;
- the canonical cursor was `37,491,237`, last updated
  `2026-07-24 02:52:52.69384+00`;
- the isolated stream `shadow-fixed-2026-07-24-37517027` had `94` batches,
  exact `1,731/1,731` source/durable app parity, no non-shadow batch, no
  canonical cursor advance, and a high watermark of `37,518,896`;
- `ops.pics_work_state` had `1,828` rows, no dead letters, and no null batch
  provenance; and
- no sampled transaction or waiting lock touched the PICS intake/work
  relations.

The genuine Railway PICS service was running and processing the isolated stream
in shadow mode. A brief Steam disconnect recovered automatically before the
apply. The other Railway service named `publisheriq` remained stopped and
source-disconnected.

Supabase was not inspected or changed because it is not a product-data source
or a gate for this Tiger-only operation.

## Apply result

The single transaction completed successfully before the first postcondition
sample at `2026-07-25T02:16:07.098675Z`. PostgreSQL reported:

- three `CREATE TABLE` statements;
- four explicit `CREATE INDEX` statements;
- one `CREATE VIEW` statement;
- five `CREATE FUNCTION` statements;
- the expected `ALTER TABLE` and constraint operations; and
- eight object comments.

No statement failed and no partial transaction remained.

Installed control objects:

- `ops.pics_cursor_checkpoints`;
- `ops.pics_reconciliation_runs`;
- `ops.pics_reconciliation_items`;
- `ops.pics_reconciliation_progress`;
- `ops.apply_pics_reconciliation_checkpoint(...)`;
- `ops.extend_pics_reconciliation_run(...)`;
- `ops.requeue_pics_reconciliation_item(...)`;
- `ops.rollback_unstarted_pics_reconciliation_checkpoint(...)`; and
- `ops.finalize_pics_reconciliation_run(...)`.

`ops.pics_work_state` now permits reconciliation provenance by:

- making `first_batch_id` and `latest_batch_id` nullable;
- adding nullable `reconciliation_run_id`;
- adding validated run, item, and work foreign keys;
- enforcing that every work row has either batch provenance or reconciliation
  provenance; and
- adding the partial reconciliation-work index.

The migration defined the transaction functions but invoked none of them.

## Post-apply verification

The bounded read-only verification at
`2026-07-25T02:16:07.098675Z` through
`2026-07-25T02:16:31.151199Z` proved:

- all three relations and the progress view exist with their expected relation
  kinds;
- all five functions exist with their exact argument identities;
- all four expected foreign-key/check constraints are present and validated;
- all four expected explicit indexes are present, including the partial
  reconciliation-work index;
- `first_batch_id`, `latest_batch_id`, and `reconciliation_run_id` have the
  intended nullable state;
- all three new tables contain zero rows;
- the progress view contains zero rows;
- no `ops.pics_work_state` row has a reconciliation run;
- all `1,842` then-current work rows still have non-null first/latest batch
  provenance;
- no PICS work row is dead-lettered; and
- no lock was waiting on the checked PICS relations.

The canonical cursor remained exactly:

```text
id=1
last_change_number=37491237
updated_at=2026-07-24 02:52:52.69384+00
```

Concurrent shadow intake explained the bounded count movement during the
operation. At `2026-07-25T02:16:31.151199Z`, the isolated stream had:

```text
batches=95
max_to_change_number=37518935
source_apps=1758
durable_apps=1758
non_shadow_batches=0
primary_cursor_advances=0
latest_received_at=2026-07-25 02:14:56.024797+00
```

Railway verification after the transaction:

- genuine PICS service `e6c49263-8466-4cb5-a37f-16299aae499e`: deployment
  running, `MODE=change_monitor`, `PICS_WORK_MODE=shadow`,
  `PICS_PROCESSING_ENABLED=true`, exact isolated stream key retained, and
  validated shadow work recorded after the schema apply;
- duplicate non-PICS service `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`: zero
  active deployments, source `null`, and prior deployment stopped.

## Next gate

Migration 0092 is installed and inert. The next production write would call
the audited checkpoint transaction with exact expected and target cursors plus
gap/head evidence batches. That operation can advance the canonical cursor and
seed reconciliation work, so it requires a fresh live manifest, a separate
change/risk/rollback explanation, and separate explicit approval.

No Railway primary-mode deployment or reader cutover may occur as part of this
schema approval.
