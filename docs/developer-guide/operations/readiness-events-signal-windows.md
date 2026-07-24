# Readiness, Lifecycle Events, and Signal Windows

This runbook covers the additive preparation contracts in
`packages/data-plane/sql/tiger-bootstrap/0089_readiness_events_signal_windows.sql`.
They are Tiger product-data contracts. Supabase is not a fallback destination.

## Safety boundary

The SQL is intentionally unapplied by normal builds and schedules. Applying it
is a production database write. Before applying it, provide:

- the exact change and target;
- why it is needed;
- risk level;
- rollback and containment; and
- an explicit approval request.

Do not deploy ingestion or PICS code that calls
`events.resolve_change_event_v1` before the function exists in Tiger.

## Contract semantics

| Contract                        | Meaning                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ops.app_data_readiness`        | Independent catalog, storefront, PICS, market-metric, creator, and overall state with source/processed time, version, blocker, retryability, and provenance. |
| `overall` readiness             | Requires catalog, storefront, and PICS only. Market and creator states are independent.                                                                      |
| `events.change_event_registry`  | Exact source/type semantics for `change-events/v1`; unknown types remain `unknown`.                                                                          |
| `events.app_lifecycle_events`   | Idempotent first-observed and release-state transitions, separate from raw Change Feed events.                                                               |
| `metrics.app_signal_windows_v1` | One current recomputable row per app for calendar-aligned 7/30-day reviews and CCU plus coverage/confidence.                                                 |

An initial successful storefront capture establishes readiness but emits no
release transition. Storefront readiness freshness comes from
`ops.sync_status.last_storefront_sync`, including unchanged successful fetches;
the latest immutable snapshot supplies content/archive provenance. A later
snapshot emits a transition only when both the previous
and next immutable snapshot summaries contain a valid `comingSoon` boolean and
that value changed.

## Bounded refresh

The runner is off by default:

```bash
pnpm --filter @publisheriq/data-plane refresh-preparation-derived-state
```

An approved bounded shadow run requires exact inputs:

```bash
PREPARATION_STATE_MODE=shadow \
PREPARATION_APPIDS=10,20 \
PREPARATION_AS_OF_DATE=2026-07-24 \
pnpm --filter @publisheriq/data-plane refresh-preparation-derived-state
```

Shadow mode writes only the additive, currently non-consumed preparation
contracts. It is not read-only. The runner rejects empty lists, invalid dates,
invalid modes, non-positive IDs, and more than 5,000 IDs.

Primary mode additionally requires:

```bash
PREPARATION_PRIMARY_CUTOVER_APPROVED=true
```

The environment acknowledgement is a fail-closed guard, not a substitute for
the user's operation-specific database-write approval.

## Verification

For every approved batch, record:

- exact app IDs and as-of date;
- before/after row counts;
- one row per app in the signal-window table;
- calendar boundaries and observed/missing-day arithmetic;
- readiness source and processed times;
- registry version and unknown-event counts;
- lifecycle idempotency under replay; and
- unchanged existing Change Feed/chat response shapes.

The release-state stream is separate from `events.app_change_events`; a
preparation rollout must not cause a new raw Change Feed event count.

## Containment and rollback

1. Set `PREPARATION_STATE_MODE=off` and stop any manual/scheduled runner.
2. Do not cut readers to the additive tables.
3. Keep generated rows for reconciliation unless deletion is separately
   explained and approved.
4. If trigger behavior is faulty, disable the exact trigger in an approved
   Tiger change window; do not drop tables or history as an emergency default.
5. Roll back reader behavior with the later per-surface read flag, not by
   mutating raw evidence.

Because the schema is additive and no current reader is switched in this
slice, normal containment is to stop new writes and leave evidence intact.
