# Durable PICS Intake Schema Apply

Applied and verified on July 24, 2026 UTC. This record covers only the additive
Tiger schema. It does not authorize or record a PICS deployment, restart,
shadow capture, primary cursor advance, or payload processing.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`.
- Source commit: `ac77ec53834b669ede80a8f3530ad4e13fc9ee97`.
- Source file:
  `packages/data-plane/sql/tiger-bootstrap/0088_durable_pics_intake.sql`.
- Source SHA-256:
  `3f9e94532f3be050cf780a1476e3291f2ef17d7340abdf35820494069a6783d2`.
- Execution: `psql` with `ON_ERROR_STOP=1` and `--single-transaction`.
- Risk presented: medium.
- Explicit approval: the user replied `yes` immediately after the operation,
  reason, risk, and rollback terms were presented in the current Codex task.

## Recovery and preflight

Immediately before approval:

- Tiger CLI reported the production service `READY` in `us-west-2`;
- the provider console reported automatic same-region backup and three-day
  point-in-time recovery;
- a recovery fork form accepted
  `Thu, 23 Jul 2026 22:34 (GMT -07:00)` as an available point without
  submitting or creating the fork;
- all four target tables were absent;
- `pgcrypto` was installed; and
- `ops.pics_sync_state.id = 1` remained at `37,491,237`, updated
  `2026-07-24 02:52:52.69384+00`.

Supabase was not inspected or changed because this is a Tiger-only product
data-plane operation.

## Apply result

The single transaction completed successfully at approximately
`2026-07-24T06:39:26Z`:

- four `CREATE TABLE` statements succeeded; and
- nine explicit `CREATE INDEX` statements succeeded.

No statement failed and no partial transaction remained.

## Post-apply verification

| Object                       | Columns | Total indexes | Rows |
| ---------------------------- | ------: | ------------: | ---: |
| `ops.app_data_readiness`     |      11 |             3 |    0 |
| `ops.pics_change_batch_apps` |       6 |             2 |    0 |
| `ops.pics_change_batches`    |      26 |             5 |    0 |
| `ops.pics_work_state`        |      28 |             5 |    0 |

The total-index counts include primary-key and unique-constraint indexes.
Catalog columns, constraints, and indexes produced this credential-free
manifest:

```text
record_count=178
sha256=b57ee01039847b90699a3b379c81b121932fcfb89677f3e53e0a10af541c5355
```

The canonical PICS cursor remained exactly:

```text
id=1
last_change_number=37491237
updated_at=2026-07-24 02:52:52.69384+00
```

Railway verification after the schema transaction:

- genuine legacy PICS service
  `e6c49263-8466-4cb5-a37f-16299aae499e`: `stopped=true`,
  deployment status `FAILED`;
- accidental Query API duplicate
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`: `stopped=true`,
  deployment status `FAILED`.

## Rollback and next gate

The additive objects are installed but unused. Both PICS services remain
stopped, no runtime was deployed, and `PICS_WORK_MODE` was not enabled. The
safest rollback is to leave the empty objects unused. Dropping them is
destructive and requires separate approval.

A uniquely named historical shadow capture is the next possible production
operation. It requires its own source cursor, limits, expected evidence, risk,
and explicit approval. Steam accepts no ending cursor, so the complete source
response must be retained and any bounded comparison must be derived from
per-item change numbers.
