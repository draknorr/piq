# Durable PICS Intake

## Status

`0088_durable_pics_intake.sql` was applied to Tiger production after explicit
approval on July 24, 2026 UTC. PR #43 merged the intake implementation as
commit `ac81b9d`. A separately approved historical shadow request produced one
`source_blocked` parent row and zero batch-app, work, or readiness rows.

The runtime changed later that day. At `2026-07-25 00:59 UTC`, the genuine
Railway PICS service was running `PICS_WORK_MODE=shadow` with processing
enabled on isolated stream `shadow-fixed-2026-07-24-37517027`. Its committed
shadow head was `37,518,046`. The canonical Tiger cursor was still frozen at
`37,491,237`; shadow processing had not advanced it or promoted primary state.
The accidental non-PICS service with the same `publisheriq` name remained
stopped and source-disconnected.

At the July 24, 2026 UTC inspection, the canonical Tiger row was
`ops.pics_sync_state.id = 1`, with `last_change_number = 37,491,237`. That value
is incident evidence, not proof that the skipped interval was processed.

Leased processing, completeness-aware promotion, and single-service
orchestration remain disabled by default with
`PICS_PROCESSING_ENABLED=false`. The explicit production shadow setting is
validation evidence, not approval for primary mode.

Migration `0092_pics_cursor_checkpoint_reconciliation.sql` and its production
data functions are not applied at this checkpoint. See
[Audited PICS Cursor Reconciliation](./pics-audited-cursor-reconciliation.md)
for the recovery design and separate approval boundaries.

## Architecture Decision

The intake leader uses one Python-managed Tiger transaction with a temporary
staging table and psycopg binary `COPY`.

This is the preferred long-term and low-cost design because:

- it adds no queue vendor, broker, or second always-on service;
- the raw source list and coalesced work share Tiger's existing transactional
  boundary;
- binary `COPY` keeps client/server overhead low for large catch-up responses;
- the canonical cursor row lock makes one leader explicit; and
- PostgreSQL constraints keep reconciliation and lease invariants close to the
  durable records.

The trade-offs are:

- correctness spans Python orchestration and SQL constraints instead of one
  stored procedure;
- a large upstream response holds the cursor row lock and produces WAL until
  commit;
- temporary staging and COPY require PostgreSQL-specific integration tests; and
- only one intake leader can advance the canonical stream.

Mitigations are one upstream response per transaction, statement and lock
timeouts, no payload processing inside intake, exact count/hash checks before
the cursor update, and failure injection at each transaction boundary. If a
source response cannot complete inside the approved transaction envelope, the
leader fails with the old cursor intact. It never silently chunks the response
and advances past uncommitted source items.

## Records

| Record                       | Contract                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ops.pics_change_batches`    | Immutable request/response cursor boundary, source counts, SHA-256, receipt time, force-full flags, completeness, mode/lane, and optional archive reference. |
| `ops.pics_change_batch_apps` | Every source list position, app ID, item change number, and token requirement, including duplicate IDs.                                                      |
| `ops.pics_work_state`        | Coalesced claimable state per app and stream; shadow streams cannot contaminate primary work.                                                                |
| `ops.app_data_readiness`     | Normalized per-app/per-source readiness scaffold; durable intake marks only the PICS source pending.                                                         |

The batch child table intentionally has no app foreign key. PICS may expose an
ID before catalog reconciliation has created `legacy.apps`; durability cannot
depend on prior catalog presence.

## Transaction

For one response `(from_change_number, to_change_number]`:

1. take an advisory lock for the stream;
2. lock `ops.pics_sync_state.id = 1` for the primary stream;
3. reject a noncontiguous cursor or a conflicting replay;
4. binary-COPY every ordered
   `(source_index, appid, source_change_number, needs_token)` into a temporary
   table;
5. have Tiger recompute count, distinct count, and ordered SHA-256;
6. insert the batch and every source position;
7. recompute the permanent child-row manifest;
8. verify that Steam echoed the requested starting cursor and did not set
   `force_full_update` or `force_full_app_update`;
9. only for a complete incremental response, coalesce stream-isolated work
   without lowering active priority;
10. mark PICS readiness pending for primary durable intake only; and
11. update the canonical cursor with a compare-and-set predicate.

Any exception rolls back every step.

An echoed-cursor mismatch or forced-full app response is itself retained with
`status = source_blocked`, but it creates no work, changes no readiness, and
does not advance either cursor. `force_full_package_update` is retained for
audit but does not block the app stream because package changes are not
requested.

## Historical Replay Limitation

Steam's `get_changes_since` request accepts a starting cursor but no ending
cursor. A historical shadow request therefore returns one response through
Steam's current cursor. Every returned app entry does include its own change
number, so a bounded comparison interval can be selected from the persisted
response after intake.

This does not prove that Steam retained an arbitrarily old interval. A
forced-full response, echoed-cursor mismatch, or a response that has already
collapsed beyond the frozen cursor must remain visible as a source limitation.
It cannot be described as a successful reconstruction of the June gap. Shadow
replay must not mutate the canonical cursor.

## Work Isolation and Fairness

- `shadow` must use a non-primary stream key and never updates
  `ops.pics_sync_state` or canonical readiness.
- `durable` must use `stream_key = primary`.
- each shadow stream has independent work rows; replay A cannot coalesce into
  replay B.
- only a catalog state with `first_observation_kind = new` and no completed
  PICS sync receives the protected `new` lane.
- the existing never-synced backlog does not automatically become `new`; it
  remains in its incoming `live` or `catchup` lane.
- terminal work can be revived by a later source change, while an active claim
  keeps its lease and records the later dirty cursor for another pass.

## Leased Processing

The same PICS process can run intake and bounded consumers, avoiding a second
always-on service or external broker.

For each pass:

1. recover expired claims as `retrying` or `dead_letter`;
2. claim protected `new`/`live` capacity with `FOR UPDATE SKIP LOCKED`;
3. claim a separate, smaller `catchup` quota;
4. increment attempts when the lease is acquired so a crash cannot retry
   forever without consuming its cap;
5. heartbeat before and after the bounded Steam product-info request and renew
   every still-unprocessed lease before each app promotion;
6. retry transient payload or processing failures with capped exponential
   backoff;
7. record inaccessible or token-blocked source payloads as `source_blocked`;
   and
8. acknowledge work only inside the shadow settlement or primary promotion
   transaction.

If a newer PICS change arrives during processing, acknowledgement records the
claimed cursor and returns the row to `pending` for the later cursor. It never
marks unseen work complete.

## Payload Completeness and Promotion

The legacy extractor normalized both a missing family and an explicitly empty
family to the same empty Python value. Durable processing retains evidence
before normalization:

- payload access-token state, source change number, source SHA-1, and source
  byte size;
- the exact set of scalar fields present in the source;
- `complete`, `absent`, or `partial` status for categories, genres, store tags,
  associations/franchises, and DLC; and
- a canonical SHA-256 of the raw payload plus a separate SHA-256 of the
  effective normalized state.

Only a present, well-typed family in a source-complete payload may replace its
Tiger relationship set. A present empty family may clear existing edges.
Absent or partial families preserve the prior normalized snapshot and latest
relationships. The normalized state includes every PICS field that the durable
path may promote, and source timestamps are normalized to UTC before hashing,
so evidence does not depend on the worker host timezone.

For durable primary work, one Tiger transaction:

1. verifies the live lease and latest-snapshot pointer;
2. inserts or touches the PICS source snapshot;
3. updates only PICS-owned or approved fallback fields;
4. replaces only complete relationship families;
5. inserts diff events with the R2 evidence pointer;
6. updates `ops.sync_status` and PICS readiness; and
7. acknowledges the exact claimed change number.

R2 is written before the transaction because object storage cannot participate
in a PostgreSQL commit. A failed Tiger transaction may therefore leave a
content-addressed orphan, but it cannot leave partial latest state or
acknowledged work. Replaying the claim reuses deterministic evidence safely.
Developer/publisher relationships remain Storefront-owned. PICS supplies
`release_date`, `is_free`, and `is_released` only while the corresponding
Storefront authority has not been established.

## Runtime Modes

`MODE=change_monitor` requires one explicit value:

| `PICS_WORK_MODE` | Behavior                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `legacy`         | Compatibility-only in-memory monitor. Unsafe as production primary.                                  |
| `shadow`         | Durable isolated intake and optional isolated processing without canonical cursor/readiness changes. |
| `durable`        | Durable primary intake; optional consumers promote and acknowledge primary work transactionally.     |

Missing or unknown values fail at startup. PICS product targets now default to
Tiger. The durable intake and processing path neither reads nor writes
Supabase.

`PICS_PROCESSING_ENABLED` is a second fail-closed gate. It defaults to `false`;
enabling it requires working Tiger/R2 configuration and does not bypass the
separate shadow or primary rollout approval.

## Approval Boundary

Before any production action:

1. capture fresh Tiger backup/PITR and schema evidence;
2. explain the additive tables/indexes, risk, and rollback;
3. verify the already applied `0088` objects and capture their current state;
4. verify all created objects and prove the canonical cursor is unchanged;
5. receive separate approval for any new shadow intake or processing run and
   a bounded comparison selected by item change number; and
6. select the genuine PICS service by exact project and service ID; the
   source-disconnected duplicate must remain stopped.

`PICS_WORK_MODE=durable` remains prohibited until the audited checkpoint
migration is merged and separately applied, fresh evidence identifies the
exact source-blocked gap and healthy shadow-head batches, the checkpoint
transaction receives separate approval, and the exact genuine-service Railway
rollout receives separate approval.
