# Versioned Consumer Reads Validation

Status: **PR 6 implementation validated locally; no schema, deployment, or
reader cutover applied**

This record covers the versioned Apps projection contract, Tiger-backed
Insights and product-health readers, and chat telemetry ownership prepared in
PR 6. All live checks in this record were read-only.

## Live source-of-truth snapshot

Fresh Tiger evidence at `2026-07-24T18:36:56.877022Z`:

- current catalog apps: `281,419`;
- publishers: `110,272`;
- developers: `128,236`;
- legacy Apps projection rows: `223,851`;
- legacy Apps projection latest source time:
  `2026-07-24T02:12:23.873775Z`;
- legacy Apps projection size including indexes: `362 MB`;
- `metrics.apps_page_projection_v2`: absent;
- `metrics.apps_page_filter_counts_v2`: absent;
- PICS cursor: `37,491,237`, last updated
  `2026-07-24T02:52:52.69384Z`;
- capture queue: `182` pending, `2,846` dead-lettered, oldest pending
  `2026-07-24T13:27:43.790057Z`;
- unknown registered event pairs in the last 30 days: `0`; and
- Tiger chat query logs in the last seven days: `0`.

The two distinct Railway services named `publisheriq` were checked again
read-only before publication:

- the genuine legacy PICS service
  `enthusiastic-caring/e6c49263-8466-4cb5-a37f-16299aae499e` had zero active
  deployments, `deploymentStopped=true`, and latest status `FAILED`; and
- the separate duplicate-named service
  `confident-education/455d7fca-96a3-44f9-b5f0-5e6dca1c093f` also had zero
  active deployments, `deploymentStopped=true`, and latest status `FAILED`.

Neither service was restarted, redeployed, reconnected, or otherwise mutated.

Readiness rows were:

| Source     | Status         |  Rows |
| ---------- | -------------- | ----: |
| overall    | pending        | 8,508 |
| overall    | source_blocked | 2,098 |
| storefront | ready          | 8,508 |
| storefront | source_blocked | 2,098 |

The Apps projection was about `16.4` hours behind its newest source row at the
snapshot time, outside the eight-hour SLO. The six-hour refresh workflow exists
but its recurring production-write gate remains disabled. This blocks every
Apps v2 reader cutover even though row parity was established during the
approved one-time refresh.

## Validated architecture

`metrics.apps_page_projection_v2` is an inexpensive normal view over the
maintained legacy materialized projection. It adds normalized overall readiness
and signal-window provenance without storing a second `362 MB` projection or
running a second expensive refresh. The stable v2 name allows the backing
implementation to change later without another reader cutover.

`metrics.apps_page_filter_counts_v2` is a normal parity view over the maintained
legacy filter-count projection for this stage.

The unapplied 0090 SELECT was parsed and planned against the live Tiger
relations inside a read-only transaction. PostgreSQL produced a valid plan, and
the legacy projection had zero column-name collisions with the added v2
columns. The schema file was not executed.

This design has one explicit trade-off: v2 freshness depends on the maintained
legacy projection. That is lower-cost than duplicate materialization, but it
means the refresh SLO must be restored before v2 can become primary.

## Runtime controls

All new controls fail closed and retain the current reader as their default:

| Control                         | Values              | Default    | Scope                                                       |
| ------------------------------- | ------------------- | ---------- | ----------------------------------------------------------- |
| `APP_PROJECTION_VERSION`        | `legacy`, `v2`      | `legacy`   | Apps list, aggregates, filter counts, and projection health |
| `INSIGHTS_READ_TARGET`          | `legacy`, `tiger`   | `legacy`   | Insights product data                                       |
| `DASHBOARD_PRODUCT_READ_TARGET` | `legacy`, `tiger`   | `legacy`   | Dashboard catalog counts                                    |
| `ADMIN_PRODUCT_READ_TARGET`     | `legacy`, `tiger`   | `legacy`   | Admin product and ingestion health                          |
| `PRODUCT_HEALTH_READ_TARGET`    | `legacy`, `tiger`   | `legacy`   | Optional shared dashboard/admin default                     |
| `CHAT_QUERY_LOG_WRITE_TARGET`   | `supabase`, `tiger` | `supabase` | Non-auth chat telemetry only                                |

Surface-specific product-health flags override the shared flag. Invalid values
throw instead of selecting a fallback. When Apps v2 is selected and either v2
view is missing, the affected read returns an explicit unavailable error and
never falls back to the legacy or direct reader.

Tiger chat-log mode writes only columns present in the live
`chat.chat_query_logs` schema. The Supabase-only diagnostic fields
`quality_flags`, `session_context_summary`, `guardrail_trace`, and
`answer_contract_summary` are omitted rather than causing an invalid Tiger
insert. A failed Tiger log write remains non-fatal to the chat response but
never invokes Supabase.

## Query API contracts

Two bounded Tiger/query-API contracts were added:

- `POST /v1/contracts/get-insights-dashboard`
  - preserves the existing `topGames`, `newestGames`, and `trendingGames`
    browser shapes;
  - reads current Apps, latest metrics, CCU snapshots, tier assignments, and
    trends from Tiger;
  - preserves the existing 24-hour, 7-day, and 30-day semantics and peak-aware
    sparkline downsampling.
- `POST /v1/contracts/get-product-health`
  - returns catalog counts and source-health summaries;
  - optionally returns bounded admin jobs, app errors, completion, queue, PICS,
    CCU-quality, and chat-log diagnostics;
  - reports capture queue, event-registry, readiness, PICS cursor, selected
    projection, and verification time;
  - rejects unknown projection versions; and
  - returns contract-unavailable when the selected projection relation is
    absent.

Final read-only execution of the built contracts against production Tiger
returned:

- Insights: `50` top games, `3` newest games, and `50` trending games in
  `3.66s`;
- product-health summary in `2.29s`, with the then-current catalog counts of
  `281,440` apps, `110,285` publishers, and `128,249` developers; and
- full admin health with `100` jobs and `20` app errors in about `8.29s`.

The slow registry health view was not reused for the request path. Unknown
event health is a bounded 30-day registry join, reducing the source-health
portion from about `19.5s` to about `1.74s`.

## Supabase boundary verified from live data

PR 6 removes Supabase from the new Tiger product-data and operational-health
paths. Supabase auth/session behavior is unchanged.

The live databases prove that user-control cutover cannot be bundled into this
PR without a reconciliation write:

| Record              | Tiger | Supabase |
| ------------------- | ----: | -------: |
| user profiles       |     8 |        9 |
| user pins           |     6 |        7 |
| credit transactions |     8 |        9 |
| credit reservations |     0 |        0 |
| user alerts         |     0 |        0 |

Tiger also has one alert-preference row; the current Supabase schema no longer
exposes the older alert-preference table. The count mismatch means moving
account, pin, or credit consumers to Tiger now would hide current user state.
Those routes remain unchanged until a separately approved, no-loss
reconciliation and writer cutover. This is a temporary source limitation, not
an assertion that Supabase should remain a long-term non-auth data plane.

## Verification completed

- data-plane type check passed;
- data-plane tests passed: `73/73`;
- query-api type check passed;
- query-api tests passed: `21/21`;
- full admin tests passed: `261/261`;
- admin, query-api, data-plane, database, and shared builds passed;
- database type check and tests passed: `52/52`;
- the new chat-log tests prove target parsing, live-schema field filtering, and
  no Supabase fallback from Tiger mode;
- the 0090 view body planned successfully against live Tiger;
- added v2 columns had zero live legacy-name collisions; and
- `git diff --check` passed.

The production Next.js admin build completed its type check successfully. A
direct all-file admin `tsc` invocation still reports only the pre-existing chat
test fixture/type drift recorded in the baseline verification; no PR 6 file
appears in that error set. Admin and query-api lint complete with warnings only.
Data-plane lint remains blocked by four pre-existing errors in the change-feed
empty request type, one backfill helper, and two existing unused lightweight
parameters; the PR 6 type check and tests pass.

## Cutover gates

No production mutation, deployment, environment change, or PICS action is
authorized by this record.

Before any reader becomes primary:

1. verify the current Tiger recovery/PITR gate;
2. obtain separate explicit approval for 0090;
3. apply 0090 with `ON_ERROR_STOP=1` and one transaction;
4. prove legacy/v2 row and key parity and exercise route latency;
5. separately approve and enable the Apps refresh cadence, then prove the
   eight-hour freshness SLO;
6. cut over one surface flag at a time;
7. verify auth, authorization, pagination, entity links, browser response
   shapes, and latency; and
8. roll back only the affected flag on failure.

Chat telemetry can move independently after a non-writing route smoke proves
the Tiger connection. After the first real chat request, verify one new Tiger
log row and no new Supabase log row without inspecting query text.

Neither Railway service named `publisheriq` may be restarted, redeployed, or
reconnected as part of PR 6.
