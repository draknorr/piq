# Audited PICS Reconciliation Checkpoint Apply

Applied and verified on July 25, 2026 UTC. This record covers only the
separately approved call to
`ops.apply_pics_reconciliation_checkpoint(...)`. It does not authorize or
record a Railway mode change, primary PICS processing, run finalization,
reader cutover, Supabase operation, or destructive cleanup.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`, region
  `us-west-2`.
- Function:
  `ops.apply_pics_reconciliation_checkpoint(bigint,bigint,uuid,uuid,text,text)`.
- Expected canonical cursor: `37,491,237`.
- Target cursor: `37,519,592`.
- Forced-full gap evidence:
  `7e43f678-e682-465a-882c-f5564469fbd9`.
- Complete shadow-head evidence:
  `59fc4dee-761f-48f5-ab99-e6f8b244f8e1`.
- Audit identity: `draknorr`.
- Reason: `Steam no longer retains incremental PICS changes from cursor
37491237; checkpoint to validated shadow head 37519592 and seed full-state
reconciliation`.
- Execution: `psql` with `ON_ERROR_STOP=1` and `--single-transaction`.
- Risk presented: high. The transaction deliberately advances the canonical
  cursor past an upstream interval that Steam no longer retains and creates a
  full-state reconciliation item, primary work row, and PICS readiness row for
  every current Tiger app.
- Failure rollback: any SQL error, stale cursor, invalid evidence, count/hash
  difference, missing work link, lock timeout, or statement timeout rolls back
  the whole transaction.
- Post-success rollback: while primary intake has not started and every
  reconciliation row remains unattempted and pending,
  `ops.rollback_unstarted_pics_reconciliation_checkpoint(...)` can restore the
  old cursor and readiness state and remove the primary work rows. Audit
  records remain.
- Explicit approval: after the complete change, reason, high risk, rollback,
  exact evidence IDs, target cursor, and expected scale were presented, the
  user replied `approve`.

Supabase was not inspected or changed because it is not a product-data source
or target for this operation.

## Final preflight

The bounded read-only Tiger transaction at
`2026-07-25T03:23:06.620724Z` proved:

- the canonical cursor remained `37,491,237`, last updated
  `2026-07-24 02:52:52.69384+00`;
- checkpoint, reconciliation-run, reconciliation-item, primary-work, and PICS
  readiness counts were all zero;
- the repaired checkpoint body hash was exactly
  `9858f651739b591a9fd5d63ff8ba42ae6f6d0e3c523ff1c819fd346218ebd85d`;
- the repaired pre-processing rollback body hash was exactly
  `6ad2c3f9e7b9dfdd90191fac35a2940040f9137aa03386208a515fee5c479ea1`;
- no checked PICS relation had a waiting lock;
- the current manifest contained exactly `282,630` distinct positive app IDs,
  with ordered SHA-256
  `228f499f2755a4eb8b484d63b688ee44130b8bfe560a3a26b8b050e8edb2c301`;
- the gap evidence was a shadow `source_blocked` response beginning at
  `37,491,237`, with `force_full_app_update=true`, no source apps, incomplete
  source status, and no canonical advance; and
- the head evidence was a complete committed shadow batch ending at
  `37,519,592`, with exact `33/33/33` source, durable, and stored app-row
  parity and no canonical advance.

The batch-level raw response archive pointer is optional under the durable
intake contract and was absent on these batches. Tiger retained the immutable
cursor boundary, forced-full flags, count/hash, and every complete head app
row. The genuine service had Tiger/R2 latest-state processing configured;
changed product snapshots require R2 evidence when processing later begins.
The checkpoint itself did not process payloads or write R2.

## Runtime containment

Immediately before execution:

- genuine Railway PICS service
  `e6c49263-8466-4cb5-a37f-16299aae499e` was running
  `MODE=change_monitor`, `PICS_WORK_MODE=shadow`,
  `PICS_PROCESSING_ENABLED=true`, on isolated stream
  `shadow-fixed-2026-07-24-37517027`;
- its product and history targets were Tiger, and its archive target was R2
  object storage;
- duplicate non-PICS service
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f` had zero active deployments and
  remained stopped; and
- no runtime was able to claim `stream_key=primary`.

The isolated shadow stream had `140` contiguous complete batches through
`37,519,620`, exact `2,538/2,538/2,538` source, durable, and stored app-row
parity, zero count differences, zero non-shadow batches, zero canonical
advances, zero cursor gaps, zero dead letters, zero expired claims, and zero
`stale_product_payload` errors at `2026-07-25T03:21:31.681066Z`.

## Apply result

The single transaction completed successfully in approximately seven and a
half minutes. A bounded activity check during execution found the backend
active with zero blockers.

The function returned:

```text
checkpoint_id=a58a5a0e-26d9-48bf-9a20-693380208fdc
reconciliation_run_id=54e2444b-2fc4-472a-b686-1173703f9212
from_change_number=37491237
to_change_number=37519592
item_manifest_count=282630
item_manifest_sha256=228f499f2755a4eb8b484d63b688ee44130b8bfe560a3a26b8b050e8edb2c301
work_rows=282630
```

The checkpoint and reconciliation timestamps are
`2026-07-25 03:23:23.169921+00`.

## Post-apply verification

The bounded read-only postflight at
`2026-07-25T03:31:47.062413Z` proved:

- the canonical cursor is exactly `37,519,592`, updated at the checkpoint
  timestamp;
- the checkpoint is `applied` with the exact approved evidence, reason,
  requester, count, and hash;
- the reconciliation run is `active` with the same count and hash;
- reconciliation items contain exactly `282,630` rows and `282,630` distinct
  apps;
- source indexes are complete and sequential from `0` through `282,629`;
- the recomputed durable item manifest hash exactly matches the approved
  manifest hash;
- every item is `pending` and linked to work;
- the primary queue contains exactly `282,630` rows, all
  `durable/catchup/pending`, with neutral `0` watermarks, zero attempts, and the
  exact reconciliation-run identity;
- PICS readiness contains exactly `282,630` pending rows with the exact
  checkpoint, run, cursor, and
  `awaiting_full_state_reconciliation` provenance;
- no primary batch has advanced from the new checkpoint;
- the progress view reports `282,630` durable items, all pending, with zero
  completed, source-blocked, dead-lettered, active-claim, or expired-claim
  rows;
- zero work rows block the pre-processing rollback; and
- no checked PICS relation has a waiting lock.

After verification, the genuine PICS service still reported shadow mode on the
same isolated stream, while the duplicate remained stopped. No checkpoint
work was processed.

## Next gate

The checkpoint is applied and the primary reconciliation queue is intentionally
inert. The next production mutation is changing and deploying only the genuine
PICS service in `PICS_WORK_MODE=durable`.

That cutover requires a separate approval covering the exact deployment source,
live/new and catch-up quotas, cost, rollout monitoring, rollback boundary, and
the fact that starting primary intake or processing permanently closes the
pre-processing checkpoint rollback path. The duplicate service must remain
stopped and Supabase must not be used for product data.
