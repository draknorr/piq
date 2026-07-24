# Readiness, Events, and Signal Windows Validation

Captured on July 24, 2026 UTC while preparing PR 5. All production database
checks were read-only. No Tiger schema, Tiger row, Supabase row, R2 object,
Railway configuration, or deployed application was changed.

## Validated decisions

- `overall` readiness depends only on `catalog`, `storefront`, and `pics`.
  `market_metrics` and `creator` remain independently visible and cannot block
  core source readiness.
- Normalized `first_observed` and `release_state_changed` events live in the
  separate `events.app_lifecycle_events` stream. Release transitions do not
  create synthetic rows in the existing raw `events.app_change_events` stream,
  so this slice does not silently alter Change Feed results.
- `metrics.app_signal_windows_v1` stores one recomputable current row per app.
  The existing `metrics.daily_metrics` relation remains the historical source.
- Unknown raw change types remain visible as `unknown`; they do not default to
  `store-page`.
- Supabase is not a product-data dependency for this slice and is considered
  only at the auth/session boundary. Existing legacy non-auth paths are not
  preparation truth and no Supabase path was touched.

## Live Tiger source-of-truth checks

Read-only `information_schema`, `pg_constraint`,
`timescaledb_information.hypertables`, and bounded aggregate queries verified:

| Contract                    | Live result                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs.app_source_snapshots` | Contains immutable snapshot IDs, previous pointers, `snapshot_summary`, archive provenance, and observed/source times used by lifecycle materialization.                                                            |
| Storefront freshness        | Successful fetch freshness comes from `ops.sync_status.last_storefront_sync`; the latest versioned snapshot supplies content/archive provenance. This avoids treating an unchanged successful fetch as stale.       |
| `ops.app_data_readiness`    | Accepts `catalog`, `storefront`, `pics`, `market_metrics`, `creator`, and `overall`; accepts the proposed readiness statuses; contained zero rows before this PR.                                                   |
| Catalog observation         | `ops.catalog_scan_runs`, `ops.app_catalog_state`, and `events.app_catalog_events` expose the IDs, modes, timestamps, and idempotency keys used by the new functions.                                                |
| `metrics.daily_metrics`     | Primary key is `(appid, metric_date)`; a bounded recent duplicate check returned zero duplicate app/date pairs.                                                                                                     |
| Creator rollups             | Exactly three live content classes exist: `standard_video`, `short`, and `live_or_recent_live`; allowed coverage is `none`, `partial`, or `full`. All current rows observed during validation were partial.         |
| Raw change events           | `events.app_change_events` is a Timescale hypertable partitioned by `occurred_at`; normalized lifecycle events therefore remain separate instead of adding an unsafe or consumer-visible raw-event uniqueness path. |

The schema and calculation design was corrected from these live facts rather
than inferred from the preparation document.

A final read-only invariant check found all three new relations and the
registry resolver absent, `ops.app_data_readiness` still at zero rows, and the
canonical PICS cursor unchanged from the durable-processing baseline at
`37,491,237` (`updated_at = 2026-07-24 02:52:52.69384+00`).

Those statements describe the pre-apply validation boundary. The user later
approved the exact 0089 transaction; its successful production application,
post-apply schema manifest, empty initial state, and runtime containment are
recorded in
[`readiness-events-windows-schema-apply.md`](./readiness-events-windows-schema-apply.md).

## Additive contracts

The then-unapplied `0089_readiness_events_signal_windows.sql` bootstrap adds:

- versioned registry metadata plus exact source/type resolution and unknown
  telemetry;
- `events.app_change_events_v1`, which interprets existing raw events without
  rewriting their history;
- idempotent `events.app_lifecycle_events`;
- source readiness updates with provenance and a core-only overall policy;
- a bounded cursor materializer for existing catalog lifecycle events;
- one-row-per-app calendar-aligned review/CCU windows with separate observed
  and missing-day counts; and
- bounded creator-readiness refresh from Tiger YouTube rollups.

The TypeScript registry is the writer/query/UI mirror for
`change-events/v1`. Storefront, ingestion, durable PICS promotion, legacy PICS
history compatibility, query-api classification, Change Feed, and chat use the
same vocabulary. Event writers persist registry version, known/unknown state,
and signal family in event context.

## Fail-closed execution

`refresh-preparation-derived-state` defaults to
`PREPARATION_STATE_MODE=off`. A non-off run requires:

- an exact comma-separated `PREPARATION_APPIDS` list;
- an exact UTC `PREPARATION_AS_OF_DATE`;
- no more than 5,000 distinct positive app IDs; and
- `PREPARATION_PRIMARY_CUTOVER_APPROVED=true` for primary mode.

Shadow mode still performs bounded writes to the new, non-consumed Tiger
contracts. It is not a dry run and therefore still requires the normal
operation-specific database-write explanation and explicit approval.

## Verification

| Check                                         |               Result |
| --------------------------------------------- | -------------------: |
| Shared, data-plane, and ingestion type checks |               passed |
| Shared, data-plane, and ingestion builds      |               passed |
| Admin production build                        |               passed |
| Data-plane tests                              |            70 passed |
| Change-intel tests                            |            46 passed |
| Admin tests                                   |           249 passed |
| PICS tests                                    |            89 passed |
| Changed admin ESLint                          |               passed |
| New data-plane-file ESLint                    |               passed |
| Changed Python Ruff                           |               passed |
| PostgreSQL parse                              | 37 statements parsed |

The full admin standalone type check still reports existing test-only typing
errors in chat continuation/compatibility and query-api configuration tests.
The full data-plane lint still reports the four existing errors documented in
PR 4: one empty interface, one unused helper, and two unused `lightweight`
parameters. No changed admin file, new data-plane file, ingestion source file,
or changed Python file introduced a lint error.

## Railway boundary

This slice does not deploy or restart PICS. Read-only checks by exact project
and service ID kept the two same-named services distinct:

- genuine legacy PICS:
  `enthusiastic-caring/e6c49263-8466-4cb5-a37f-16299aae499e`, stopped,
  no active deployment, source disconnected;
- accidental query-api duplicate:
  `confident-education/455d7fca-96a3-44f9-b5f0-5e6dca1c093f`, stopped,
  no active deployment, source disconnected.

Other correctly named Railway services were not changed.

## Remaining gates

1. Review and merge PR 5 with the already verified schema-before-writer
   ordering intact.
2. Keep both stopped PICS services stopped; merging the repository change does
   not authorize a PICS deployment or restart.
3. With separate approval, run a small exact-ID shadow batch and verify row
   parity, lifecycle idempotency, source timestamps, window boundaries,
   unknown-event telemetry, and unchanged existing consumer results.
4. Do not enable primary mode or a reader cutover until the required healthy
   cycles and the later per-surface PR gates pass.
