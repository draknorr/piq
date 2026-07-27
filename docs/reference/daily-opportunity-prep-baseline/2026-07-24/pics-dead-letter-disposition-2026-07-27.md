# PICS Dead-Letter Operator Disposition

Status captured on 2026-07-27 UTC. This is an operator classification record,
not a database repair. No Tiger row was updated, requeued, or deleted.

## Records reviewed

The durable catch-up queue retains three historical dead letters from
reconciliation run `54e2444b-2fc4-472a-b686-1173703f9212`:

| App ID | Work ID | Attempts | Recorded cause    | Current independent evidence                                                                              |
| ------ | ------: | -------: | ----------------- | --------------------------------------------------------------------------------------------------------- |
| 314    |    3338 |        8 | `payload_missing` | Delisted placeholder; current Steam Store lookup is inaccessible.                                         |
| 1000   |    3370 |        8 | `payload_missing` | Delisted placeholder; current Steam Store lookup is inaccessible.                                         |
| 8780   |    3684 |        8 | `payload_missing` | `RACE On` storefront metadata remains accessible; PICS product payload was unavailable to this work item. |

All three readiness rows are failed and non-retryable, and all three
reconciliation items have a terminal dead-letter disposition. None has been
manually requeued.

The contemporaneous bounded queue snapshot contained:

- `9,396` completed work items;
- `3` dead letters;
- `272,172` pending items;
- `46` claimed items; and
- `4,940` `source_blocked` items.

## Current runtime semantics

The current durable processor no longer converts a final
`payload_missing` source omission into a dead letter. It archives the blocked
evidence and settles the work and readiness state as `source_blocked`. This is
implemented in:

- `services/pics-service/src/workers/durable_processor.py`; and
- `services/pics-service/src/database/durable_work.py`.

Newer durable source intake safely reopens prior `completed`, `dead_letter`, or
`source_blocked` work for the same app, resets its attempts, and records an
audited reconciliation requeue reason. This behavior is implemented in
`services/pics-service/src/database/durable_intake.py`.

The three records predate those current final-source-omission semantics. Their
historical state is therefore preserved rather than rewritten to make old
evidence look as if it ran under new code.

## Operator decisions

| App ID | Disposition                                                                                                                                                            | Operator action                                                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 314    | Accepted terminal historical dead letter: source payload unavailable for a delisted/inaccessible app.                                                                  | Do not manually retry. Preserve the immutable record. If a newer durable Steam batch names the app, allow normal intake to reopen it and apply current `source_blocked` semantics if the payload remains unavailable.                  |
| 1000   | Accepted terminal historical dead letter: source payload unavailable for a delisted/inaccessible app.                                                                  | Do not manually retry. Preserve the immutable record. If a newer durable Steam batch names the app, allow normal intake to reopen it and apply current `source_blocked` semantics if the payload remains unavailable.                  |
| 8780   | Accepted terminal historical dead letter for the unavailable PICS product payload. The separate current storefront record remains authoritative and is not downgraded. | Do not synthesize PICS data or overwrite storefront truth. Do not manually retry stale work. A newer durable Steam batch may reopen it; if PICS still omits the product after bounded attempts, current code records `source_blocked`. |

## Closeout effect

The preparation requirement that dead letters have explicit causes and
operator actions is satisfied for these three records. The chosen action is
deliberately non-mutating:

- preserve the source and failure evidence;
- avoid an unproven manual replay;
- allow only newer durable source activity to reopen work automatically; and
- keep current storefront and PICS readiness meanings independent.

This disposition does not claim that every pending catch-up item is complete,
and it does not substitute for the required three healthy daily primary
operating cycles.
