# Audited PICS Cursor Reconciliation

## Purpose

Steam no longer retains item-level PICS changes from PublisherIQ's frozen
canonical cursor. A request from that cursor returns a forced-full response
with no app IDs. Advancing the cursor without another durable record would
erase the only visible evidence of the gap.

Migration `0092_pics_cursor_checkpoint_reconciliation.sql` provides the
recovery path. Migration
`0093_fix_pics_reconciliation_function_ambiguity.sql` repairs three helper
functions from 0092 without changing their signatures or semantics:

1. prove the old interval is unavailable from a retained `source_blocked`
   shadow batch;
2. prove a recent cursor from a complete, count-reconciled shadow batch;
3. persist a deterministic manifest of every current Tiger app;
4. enqueue one durable full-state attempt per manifest item;
5. mark PICS readiness pending; and
6. advance the canonical cursor only after all prior steps reconcile in the
   same Tiger transaction.

This design uses the existing Tiger work queue, R2 archive, and one genuine
Railway PICS service. It adds no queue vendor or permanent service.

## Current Source-of-Truth Checkpoint

The following facts were captured read-only at `2026-07-25 00:59 UTC`. They
are evidence, not reusable thresholds or function arguments:

| Signal                          | Observed value                                               |
| ------------------------------- | ------------------------------------------------------------ |
| Canonical cursor                | `37,491,237`, unchanged since `2026-07-24 02:52:52.69384+00` |
| Current complete shadow head    | `37,518,046` on `shadow-fixed-2026-07-24-37517027`           |
| Current complete-shadow batches | `45`                                                         |
| Current legacy apps             | `282,630`                                                    |
| Current sync-status rows        | `281,501`                                                    |
| Current never-PICS-synced rows  | `93,968`                                                     |
| Reconciliation tables           | absent                                                       |
| Genuine PICS runtime            | running `shadow`, processing enabled                         |
| Duplicate non-PICS runtime      | stopped and source-disconnected                              |

The current shadow stream's terminal blocks were
`missing_access_token`. They are explicit source limitations, not successful
product refreshes. Finalization therefore requires an exact manually reviewed
source-blocked count, verifier identity, and note.

Supabase is not a product-data source or target in this procedure.

## Records and Invariants

| Record                                      | Invariant                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ops.pics_cursor_checkpoints`               | One audited boundary with gap evidence, healthy-head evidence, manifest count/hash, reason, requester, and apply/rollback state. |
| `ops.pics_reconciliation_runs`              | One active run per checkpoint, exact current manifest, terminal outcome, and completion review.                                  |
| `ops.pics_reconciliation_items`             | One immutable source index per app plus baseline state, work link, actual payload evidence, and terminal disposition.            |
| `ops.pics_work_state.reconciliation_run_id` | Links full-state catch-up to the existing primary queue without inventing a fake source batch.                                   |
| `ops.pics_reconciliation_progress`          | Bounded operational summary of manifest, pending, completed, source-blocked, dead-letter, and lease counts.                      |

Full-state work uses change watermark `0`. The current PICS payload's actual
source change number is recorded in snapshots, sync status, events, readiness,
and the reconciliation item. Assigning the checkpoint cursor to every app
would incorrectly reject normal unchanged payloads as stale.

`new` and `live` work are claimed before `catchup`. If a live change reaches a
reconciliation row, intake preserves the active reconciliation link while
raising the lane and watermark. Settlement resolves the item through durable
`work_id`, including the race where a live claim began just before the
reconciliation link was attached. A newer durable source batch reopens a
previously completed, source-blocked, or dead-letter item and increments its
audited requeue count so later processing cannot be hidden behind an older
terminal disposition.

## Approval Boundaries

There are four independent production mutations. Approval for one does not
authorize the next:

1. apply additive Tiger migration `0092`;
2. apply forward repair migration `0093`;
3. call `ops.apply_pics_reconciliation_checkpoint(...)`; and
4. change and deploy the genuine Railway PICS service in durable primary mode.

Before each action, record the exact change, reason, risk, rollback, recovery
evidence, and explicit approval. Do not use Supabase, do not restart the lossy
legacy monitor, and do not touch the duplicate Railway service.

## 1. Schema Apply

Apply `0092` only after fresh Tiger backup/PITR evidence. The migration:

- adds three audit/reconciliation records and one progress view;
- makes the existing work-state batch references nullable only when a
  reconciliation run provides provenance;
- adds reconciliation foreign keys and a partial index; and
- installs checkpoint, extension, reviewed requeue, rollback, and finalization
  functions.

Risk is medium: the DDL is additive, but the work table alteration takes a
brief lock and the new service code references the new tables. Rollback before
runtime use is to leave the unused additive objects in place. Dropping them is
destructive and requires another approval.

Deploying the new service code before this schema exists is prohibited.

Before calling the checkpoint, apply 0093 under its own approval. The repair
migration:

- checks the exact installed 0092 source-body SHA-256 for the checkpoint,
  rollback, and reviewed-requeue helpers;
- refuses to run if any body differs from the reviewed source;
- replaces only the unqualified references that collide with `RETURNS TABLE`
  output variables;
- verifies the exact repaired body SHA-256 in the same transaction; and
- preserves function identity, ownership, grants, inputs, outputs, and
  behavior, while refreshing the comments to record the repair.

The repair is required because the first production checkpoint attempt on
July 25, 2026 UTC failed at its initial lookup with
`column reference "from_change_number" is ambiguous`. The single transaction
made no checkpoint, queue, readiness, or cursor change. Do not retry the
checkpoint against the unrepaired 0092 functions.

## 2. Fresh Evidence and Checkpoint

This section is gate 3 after both schema migrations above.

Use one bounded read-only transaction immediately before proposing arguments:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT last_change_number, updated_at
FROM ops.pics_sync_state
WHERE id = 1;

SELECT
  id,
  stream_key,
  from_change_number,
  to_change_number,
  response_since_change_number,
  source_app_count,
  durable_app_count,
  force_full_update,
  force_full_app_update,
  source_complete,
  status,
  received_at
FROM ops.pics_change_batches
WHERE (
    from_change_number = (
      SELECT last_change_number FROM ops.pics_sync_state WHERE id = 1
    )
    AND status = 'source_blocked'
  )
  OR (
    work_mode = 'shadow'
    AND source_complete
  )
ORDER BY received_at DESC
LIMIT 25;

SELECT count(*) AS manifest_count
FROM legacy.apps
WHERE appid > 0;

SELECT *
FROM ops.pics_reconciliation_progress
ORDER BY started_at DESC
LIMIT 5;

COMMIT;
```

The write proposal must substitute exact fresh values:

```sql
SELECT *
FROM ops.apply_pics_reconciliation_checkpoint(
  p_expected_cursor => :canonical_cursor,
  p_target_cursor => :healthy_shadow_head_cursor,
  p_gap_evidence_batch_id => :'forced_full_gap_batch_id',
  p_head_evidence_batch_id => :'healthy_shadow_head_batch_id',
  p_reason => :'approved_reason',
  p_requested_by => :'approved_operator'
);
```

The function fails closed unless:

- the canonical cursor still equals the expected cursor;
- no primary work exists;
- the gap batch is shadow, source-blocked, forced-full, starts at the expected
  cursor, and never advanced the primary cursor;
- the head batch is shadow, complete, committed/reconciled, ends at the target,
  and has exact source/durable count parity;
- the staged and durable app manifests have the same count and ordered SHA-256;
- every item links to exactly one primary catch-up work row; and
- the cursor compare-and-set succeeds.

Risk is high because the transaction deliberately advances the canonical
cursor past an unrecoverable incremental interval and creates a large primary
queue. Its compensation function is available only before primary intake or
reconciliation processing starts:

```sql
SELECT *
FROM ops.rollback_unstarted_pics_reconciliation_checkpoint(
  :'checkpoint_id',
  :'approved_rollback_reason'
);
```

That function restores the old cursor and readiness and removes the newly
created work. Audit records remain. Once durable primary intake or processing
starts, rollback fails closed; recovery is roll-forward.

## 3. Genuine Railway Cutover

Select by immutable identifiers:

- project `68a3b2a8-43a6-45df-856e-0ba0e1309216`;
- environment `4d6625a7-d942-4835-b74b-f0eff3e626ac`;
- genuine PICS service `e6c49263-8466-4cb5-a37f-16299aae499e`.

The non-PICS duplicate in project
`c36c95df-2284-4ffc-af85-cd3c31a3b8ea`, service
`455d7fca-96a3-44f9-b5f0-5e6dca1c093f`, must remain stopped and
source-disconnected.

The approved genuine-service deployment must use:

```text
MODE=change_monitor
PICS_WORK_MODE=durable
PICS_PROCESSING_ENABLED=true
PICS_INTAKE_LANE=live
```

`durable` always resolves the stream to `primary`; a shadow stream setting is
ignored. Keep Tiger for intake/latest state/history and R2 for archive
evidence. Do not configure a Supabase product target.

The conservative steady-state quotas are `40` live/new and `10` catch-up apps
per pass. A temporary accelerated catch-up may use `40` live/new and up to
`160` catch-up apps per pass, keeping one Steam product request at or below
`200` apps. The temporary value needs explicit Railway approval and must be
reduced if lease renewal, Steam responses, R2 writes, Tiger latency, retries,
or dead letters degrade. This increases throughput without another paid
service; it does not guarantee a completion time.

## Operation and Monitoring

After primary mode starts, query the progress view and bounded reason counts:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT *
FROM ops.pics_reconciliation_progress
WHERE status = 'active'
ORDER BY started_at;

SELECT
  items.status,
  coalesce(items.last_error_code, '(none)') AS error_code,
  count(*) AS item_count
FROM ops.pics_reconciliation_items items
WHERE items.run_id = :'run_id'
GROUP BY items.status, coalesce(items.last_error_code, '(none)')
ORDER BY items.status, item_count DESC;

SELECT
  lane,
  state,
  count(*) AS work_count,
  min(updated_at) AS oldest_updated_at,
  max(updated_at) AS newest_updated_at
FROM ops.pics_work_state
WHERE stream_key = 'primary'
GROUP BY lane, state
ORDER BY lane, state;

SELECT last_change_number, updated_at
FROM ops.pics_sync_state
WHERE id = 1;

COMMIT;
```

Stop and investigate on cursor staleness, unexplained manifest drift, lease
expiry growth, any dead letter, missing R2 evidence, Tiger/R2 hash mismatch,
or unexpected source-block growth. After cutover, do not restore the old
cursor or legacy monitor.

A reviewed source-blocked or dead-letter item can be retried individually
without direct table edits:

```sql
SELECT *
FROM ops.requeue_pics_reconciliation_item(
  p_run_id => :'run_id',
  p_appid => :appid,
  p_requested_by => :'approved_operator',
  p_reason => :'approved_retry_reason'
);
```

This is a production data write and requires its own explicit approval. It
fails unless the run is active and both the item and work row are terminal.
The function resets the lease/retry state, marks readiness pending, and
retains cumulative requeue count, operator, reason, and time.

New apps may enter `legacy.apps` during a long run. Extend idempotently:

```sql
SELECT *
FROM ops.extend_pics_reconciliation_run(:'run_id');
```

The function appends missing apps without moving the cursor. It accepts an app
already completed by durable live processing only when its PICS sync,
snapshot observation, ready-state processing time, primary-stream work
provenance, snapshot ID, and source change number all reconcile after the run
start; otherwise it enqueues catch-up work.

## Finalization

Run `extend` until it adds zero apps. Review every terminal error group and
record the exact source-blocked count. Finalization briefly takes a `SHARE`
lock on `legacy.apps` so a catalog insert cannot slip between the final
coverage check and status change:

```sql
SELECT *
FROM ops.finalize_pics_reconciliation_run(
  p_run_id => :'run_id',
  p_expected_source_blocked_count => :reviewed_source_blocked_count,
  p_completed_by => :'verifier',
  p_completion_note => :'evidence_and_limitations'
);
```

Finalization requires:

- every current app is in the manifest;
- exact manifest count and SHA-256;
- zero pending items;
- zero dead-letter items;
- no pending, claimed, retrying, or dead-letter reconciliation work;
- the exact manually reviewed source-blocked count; and
- verifier identity and a non-empty completion note.

Source-blocked items remain visible as limitations and retain their R2/error
evidence. They are never reclassified as refreshed.
