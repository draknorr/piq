# Durable PICS Intake

## Status

Implementation-only. `0088_durable_pics_intake.sql` has not been applied, no
PICS service has been restarted, and neither `shadow` nor `durable` is enabled
in production.

At the July 24, 2026 UTC inspection, the canonical Tiger row was
`ops.pics_sync_state.id = 1`, with `last_change_number = 37,491,237`. That value
is incident evidence, not proof that the skipped interval was processed.

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

## Runtime Modes

`MODE=change_monitor` requires one explicit value:

| `PICS_WORK_MODE` | Behavior                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `legacy`         | Compatibility-only in-memory monitor. Unsafe as production primary.                          |
| `shadow`         | Durable isolated intake without canonical cursor/readiness changes.                          |
| `durable`        | Durable primary intake and canonical cursor advance. Intake-only until consumers are merged. |

Missing or unknown values fail at startup. PICS product targets now default to
Tiger; Supabase target values remain explicit legacy compatibility only.

## Approval Boundary

Before any production action:

1. capture fresh Tiger backup/PITR and schema evidence;
2. explain the additive tables/indexes, risk, and rollback;
3. receive explicit approval to apply `0088`;
4. verify all created objects and prove the canonical cursor is unchanged;
5. receive separate approval for a uniquely named historical shadow capture
   and a bounded comparison selected by item change number; and
6. keep both Railway services named `publisheriq` stopped unless the exact
   genuine PICS service ID is selected in an approved rollout.

`PICS_WORK_MODE=durable` remains prohibited until PR 4 adds leased consumers,
payload promotion, relationship completeness evidence, and restart/parity
gates.
