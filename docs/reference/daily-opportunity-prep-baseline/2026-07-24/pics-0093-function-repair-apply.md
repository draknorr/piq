# PICS Checkpoint Function Repair Apply

Applied and verified on July 25, 2026 UTC. This record covers only Tiger
migration 0093. It does not authorize or record a cursor checkpoint,
reconciliation run, canonical cursor advance, Railway deployment, reader
cutover, or Supabase operation.

## Reason for the repair

Migration 0092 installed the audited PICS cursor-reconciliation controls. The
first separately approved checkpoint call then failed before its first write
with:

```text
column reference "from_change_number" is ambiguous
```

The call used `ON_ERROR_STOP=1` and `--single-transaction`, so PostgreSQL rolled
the entire call back. The canonical cursor and all reconciliation controls
remained unchanged and empty.

The failure came from PL/pgSQL `RETURNS TABLE` output variables sharing names
with unqualified table columns. Migration 0093 repairs only those known
ambiguities in:

- `ops.apply_pics_reconciliation_checkpoint(...)`;
- `ops.requeue_pics_reconciliation_item(...)`; and
- `ops.rollback_unstarted_pics_reconciliation_checkpoint(...)`.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`, region
  `us-west-2`.
- Merged source commit:
  `84fa46b9d2872eb714aaba8a7704f3cc9007d0de`.
- Source file:
  `packages/data-plane/sql/tiger-bootstrap/0093_fix_pics_reconciliation_function_ambiguity.sql`.
- Source SHA-256:
  `63f76dc28b741517b69dfb7cb0ad3e00131735b5df84f43e4ead2109dd41443f`.
- Execution: `psql` with `ON_ERROR_STOP=1` and `--single-transaction`.
- Risk presented: medium-low because this is a production schema write that
  replaces three function bodies and briefly takes normal catalog locks, but
  it does not invoke the functions or mutate application data.
- Failure rollback: the single transaction rolls back the entire file on any
  SQL error, unexpected source hash, repaired-body mismatch, or lock timeout.
- Post-success rollback: restore the three exact 0092 function bodies in a new
  reviewed migration. The repaired functions remain inert until separately
  invoked.
- Explicit approval: the user wrote `approve 0093` after the exact change,
  reason, risk, rollback, and approval boundary were presented in the current
  Codex task.

Supabase was not inspected or changed because it is not a product-data source
or a gate for this Tiger-only operation.

## Fail-closed preflight

The exact migration on merged `origin/main` was checksummed before execution.
The bounded read-only Tiger preflight at
`2026-07-25T03:09:52.119904Z` proved:

- the canonical cursor was `37,491,237`, last updated
  `2026-07-24 02:52:52.69384+00`;
- checkpoint, reconciliation-run, reconciliation-item, primary-work, and PICS
  readiness counts were all zero;
- no checked PICS relation had a waiting lock; and
- every installed source body exactly matched the migration's reviewed input
  hash:

| Function                                            | Pre-repair SHA-256                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `apply_pics_reconciliation_checkpoint`              | `eb1393fdb0a02e5730dd408e1c0bd6f50fd5a13a0d146663db113c2b8d335969` |
| `requeue_pics_reconciliation_item`                  | `e7ef5dc4c4a7454d0ff6d257812025958d5d70ae17d4ec396372ac5d257c3a41` |
| `rollback_unstarted_pics_reconciliation_checkpoint` | `2c33a13cc98fe22f4869e2f8cdab94c114310aafa1a931362ec50f2df08e2177` |

Any source drift would have aborted the migration before replacement.

## Apply result

The single transaction completed successfully. PostgreSQL reported:

```text
SET
SET
DO
COMMENT
COMMENT
COMMENT
```

The `DO` block:

1. loaded each exact installed 0092 source body;
2. verified its SHA-256;
3. applied only the reviewed column-qualification replacements;
4. recreated each function with the same identity arguments and return shape;
5. verified each repaired body SHA-256; and
6. updated the three function comments.

The migration did not call a checkpoint or other reconciliation function.

## Post-apply verification

The bounded read-only postflight at
`2026-07-25T03:10:17.456565Z` proved:

- all three functions retain owner `tsdbadmin`;
- their identity arguments and `RETURNS TABLE` shapes are unchanged;
- their comments identify the 0093 qualification repair;
- every installed body exactly matches its reviewed repaired hash:

| Function                                            | Repaired SHA-256                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `apply_pics_reconciliation_checkpoint`              | `9858f651739b591a9fd5d63ff8ba42ae6f6d0e3c523ff1c819fd346218ebd85d` |
| `requeue_pics_reconciliation_item`                  | `ab6ab462582368468e549493cffd4e84700fdd0d8115ca5121394a63e36073e9` |
| `rollback_unstarted_pics_reconciliation_checkpoint` | `6ad2c3f9e7b9dfdd90191fac35a2940040f9137aa03386208a515fee5c479ea1` |

The canonical state remained exactly:

```text
id=1
last_change_number=37491237
updated_at=2026-07-24 02:52:52.69384+00
```

Checkpoint, reconciliation-run, reconciliation-item, primary-work, and PICS
readiness counts remained zero. No checked PICS relation had a waiting lock.
No Railway service, runtime mode, environment variable, deployment, scheduler,
or R2 object was changed.

## Next gate

Migration 0093 is installed and inert. The next production write is a fresh
call to `ops.apply_pics_reconciliation_checkpoint(...)` using live cursor and
batch evidence. That transaction deliberately advances the canonical cursor
and creates a large primary reconciliation queue, so it remains a separate
high-risk action requiring fresh bounded evidence, exact arguments, a rollback
window, and explicit approval.
