# PICS Durable Canary and Automatic Rollback

Executed on July 25, 2026 UTC. This record covers the approved durable PICS
canary on the genuine Railway service, the failed upstream-response archive
gate, and the previously approved automatic rollback to the isolated shadow
stream. It does not authorize another durable deployment, catch-up
acceleration, direct database repair, lease requeue, destructive rollback, or
any change to the duplicate Railway service.

Supabase was not inspected or used for product data.

## Approval and targets

The user explicitly approved both operations:

> Approve PR #60 ready and squash-merge, and approve the durable canary with
> rollback to shadow on failure.

PR [#60](https://github.com/draknorr/piq/pull/60) was marked ready and
squash-merged as commit
`ed0911499440912fde0fa846d15675514b8c7e9d` at
`2026-07-25T04:36:18Z`.

The canary and rollback were restricted to:

- Railway project: `68a3b2a8-43a6-45df-856e-0ba0e1309216`;
- environment: `4d6625a7-d942-4835-b74b-f0eff3e626ac`
  (`production`);
- genuine PICS service:
  `e6c49263-8466-4cb5-a37f-16299aae499e` (`publisheriq`);
- exact locked image:
  `sha256:b7281a4d329d4e2661c24084a54ddf9d748c56a56cfb5dcd56b82717e40dd198`;
- canary settings: `PICS_WORK_MODE=durable`,
  `PICS_PROCESSING_ENABLED=true`, `40` live/new claims and `10` catch-up
  claims per pass; and
- rollback settings: `PICS_WORK_MODE=shadow`,
  `PICS_INTAKE_STREAM_KEY=shadow-fixed-2026-07-24-37517027`, with no
  destructive data undo.

The duplicate non-PICS service remained:

- project: `c36c95df-2284-4ffc-af85-cd3c31a3b8ea`;
- service: `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`; and
- stopped, with zero active deployments.

## Pre-canary boundary

The repeatable-read Tiger checkpoint at
`2026-07-25T04:37:25.394732Z` proved:

- canonical cursor `37,519,592`;
- `190` complete contiguous isolated-shadow batches through
  `37,520,374`;
- exact `3,242 / 3,242` shadow parent/child manifest parity;
- zero shadow watermark mismatches, stale-payload errors, dead letters, or
  expired claims;
- zero primary batches;
- `282,630` primary work rows, all pending and unattempted; and
- one active audited reconciliation with all `282,630` items pending.

The genuine service reported healthy shadow mode and Steam connectivity. The
duplicate service had no active deployment.

## Canary deployment

The variables were staged without an implicit deployment and verified before
redeploy:

- `PICS_WORK_MODE=durable`;
- `PICS_CONSUMER_LIVE_BATCH_SIZE=40`;
- `PICS_CONSUMER_CATCHUP_BATCH_SIZE=10`; and
- `PICS_PROCESSING_ENABLED=true`.

Deployment `f9409362-bbe3-420b-8461-453f1cd84c42` reached `SUCCESS` on the
same locked image. Runtime logs proved that it:

- started at `2026-07-25T04:38:18.983284Z`;
- selected durable mode and the canonical `primary` stream;
- started from cursor `37,519,592`; and
- connected to Steam successfully.

The first canonical batch,
`b2b3d06e-369d-4c58-b6f3-2854fac6268e`, advanced from `37,519,592` to
`37,520,400` with:

- exact `561 / 561 / 561` source, distinct, and durable counts;
- sequential child indexes `0` through `560`;
- exact ordered-manifest SHA-256
  `cb877a720b7f9e7b589b014239618c256c26cc7fdff3eea79f9337e00042e3c0`;
  and
- one atomic canonical cursor advance after manifest reconciliation.

The first protected processing pass claimed exactly `40` live/new and `10`
catch-up rows. It settled as `24` completed and `26` explicitly
`source_blocked` with `missing_access_token`, with zero retries, dead letters,
expired claims, or stale-payload errors.

## Failed gate

At `2026-07-25T04:46:05.956448Z`, the bounded repeatable-read validation found:

- three contiguous canonical batches from `37,519,592` through `37,520,458`;
- exact parent/child counts and zero cursor or manifest gaps;
- all three batches marked source-complete with their cursor advances
  retained; but
- `0 / 3` parent rows had an R2 archive pointer.

The app product payload archives were present and valid, but the exact
upstream change response was not archived before the canonical cursor moved.
This violates the durable-intake contract requiring the immutable response
archive reference to be stored in the same Tiger transaction that advances
the cursor.

Code inspection isolated the cause:

- `TigerPICSDurableIntakeStore.persist_batch(...)` already accepted and stored
  a `PICSArchiveReference`;
- `DurableChangeIntakeWorker.poll_once(...)` never wrote the upstream response
  to R2 and called `persist_batch(...)` without that reference; and
- the store treated the archive argument as optional, so the missing handoff
  did not fail closed.

This was a canary gate failure even though cursor, manifest, promotion, and
per-app archive checks remained healthy.

## Automatic rollback

The approved rollback changed only the genuine service back to
`PICS_WORK_MODE=shadow`, retained the exact isolated stream key, and
redeployed the same locked image.

- Rollback deployment:
  `63adb1e6-5f63-4eab-9de5-1fc7272a911a`.
- Railway status: `SUCCESS`.
- Image digest:
  `sha256:b7281a4d329d4e2661c24084a54ddf9d748c56a56cfb5dcd56b82717e40dd198`.
- Shadow startup: `2026-07-25T04:47:22.095430Z`.
- Steam connection: successful at `2026-07-25T04:47:23.727537Z`.
- `/status`: `status=running`, `health_state=ok`,
  `pics_work_mode=shadow`,
  `intake_stream=shadow-fixed-2026-07-24-37517027`, zero consecutive poll
  failures, and no poll error.

No canary row, event, snapshot, relationship, readiness record, work
disposition, or cursor advance was deleted or rewritten.

## Post-rollback truth

The final repeatable-read Tiger checkpoint at
`2026-07-25T04:55:40.113590Z` proved:

| Check                                       | Result                                    |
| ------------------------------------------- | ----------------------------------------- |
| Canonical cursor                            | `37,520,458`                              |
| Canonical cursor last update                | `2026-07-25 04:45:22.703217+00`           |
| Canonical batches after rollback deployment | `0`                                       |
| Canary batches / source rows / durable rows | `3 / 609 / 609`                           |
| Canary parent response archive pointers     | `0 / 3`                                   |
| Completed primary work                      | `62`                                      |
| Explicitly source-blocked primary work      | `65`                                      |
| Retrying / dead-letter primary work         | `0 / 0`                                   |
| Interrupted primary claims                  | `21`, all durably expired and recoverable |
| Changed app snapshots                       | `61`, all with archive pointers           |
| Change events                               | `93`                                      |
| Unknown event-registry mappings             | `0`                                       |
| Isolated shadow cursor                      | `37,520,550`                              |
| Isolated shadow batches after rollback      | `3`                                       |
| Duplicate service active deployments        | `0`                                       |

One of the `62` completed rows had an unchanged normalized snapshot, so the
`61` changed snapshots are expected. A read-only R2 verification fetched all
`61` canary snapshot objects and recomputed:

- archive read failures: `0`;
- SHA-256 mismatches: `0`; and
- byte-count mismatches: `0`.

The `21` interrupted primary claims were not requeued or repaired. Their
leases expired between `2026-07-25T04:49:38.278568Z` and
`2026-07-25T04:52:25.514247Z`; the next approved durable worker can recover
them through the existing stale-claim path.

## Repair and next gate

The repair is code-only and does not require a Tiger migration:

1. deterministically serialize the exact upstream response, including ordered
   app positions, per-app change numbers, token requirements, force-full
   flags, source counts, manifest hash, and package list;
2. write that document to R2 before opening the Tiger transaction;
3. make the archive reference mandatory for every durable-intake store call;
4. store bucket, key, SHA-256, byte count, and content type with the parent
   batch;
5. reject an idempotent replay if the stored archive provenance is missing or
   does not match; and
6. prove that an R2 failure prevents Tiger persistence and cursor advancement.

Before another durable canary:

- merge the repair after CI;
- deploy the repaired image to the genuine service in shadow mode;
- prove a new shadow batch has a readable, hash-matching parent response
  archive and exact child manifest parity;
- confirm the canonical cursor remains `37,520,458`;
- confirm expired primary claims remain recoverable and unmodified; and
- obtain fresh explicit approval for the second durable canary.
