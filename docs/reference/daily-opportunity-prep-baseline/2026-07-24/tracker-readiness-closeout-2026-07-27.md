# Daily Opportunity Preparation Closeout Status

Status updated on 2026-07-27 UTC against `main` commit
`129d8eb2988db2856cf7980bd9f872953b0753c5` (merged PR #80), plus the
separately approved production controls and database writes recorded below.

## Outcome

**The production site and its current Tiger product readers are operational,
but the preparation plan is not complete by its own exit gates.**

The closeout pass repaired and verified the user-visible regressions found
after PR #70:

- YouTube no longer emits the reproduced React hydration error.
- Admin product/PICS health now reads current Tiger data.
- Insights now reads current Tiger data and completes its 30-day Top Games
  queries without the earlier timeouts.
- Apps projection job 1016 recovered to exact legacy/v2 parity.
- Snapshot-aware scheduler migration 0096 is applied without changing or
  prematurely running job 1016; its first natural fixed-slot run remains to be
  observed.
- The corrected exact 100-app signal-window shadow cohort is populated and
  idempotency-verified.
- Alert Detection is enabled on the approved Tiger/Supabase compatibility
  split and its production no-op smoke succeeded.
- Review Histogram completed its bounded 300-app production smoke with 297
  successful fetches, zero failures, and three Steam-empty skips.
- The three retained PICS dead letters now have explicit non-mutating operator
  dispositions.

No current product reader needs to be rolled back. The remaining gates are
the first natural 0096 scheduler observation, elapsed primary-cycle evidence,
deployment of the final route fixes, and disposable-record coverage for
mutating compatibility branches. They must not be relabeled as complete merely
because the core site renders.

## Closeout implementation ledger

| PR  | Result                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------- |
| #71 | Deployed hydration-safe YouTube time labels and published the first current readiness handoff.             |
| #72 | Split Admin and Insights Tiger reads into bounded statements with explicit timeouts.                       |
| #73 | Bounded the exact 30-day Top Games peak scan.                                                              |
| #74 | Bounded the 30-day Insights trend aggregates and raised the server timeout to the measured safe limit.     |
| #75 | Split Admin PICS relation counts to avoid one large relation scan.                                         |
| #76 | Split Admin source-health reads into independently bounded statements.                                     |
| #77 | Added and tested forward migration 0096 for snapshot-aware Apps projection parity.                         |
| #78 | Published the first reconciled readiness closeout and corrected signal-window manifest.                    |
| #79 | Repaired the live verifier so one slow table probe no longer erases the remaining evidence.                |
| #80 | Restored the approved Tiger-backed Alert Detection split and bounded twice-daily Review Histogram cadence. |

PR #69 remains an open documentation-only draft whose rollout narrative
predates primary catalog/PICS operation and the PR #70 replay. It is not
current rollout truth.

## Current source ownership and runtime

| Surface or domain                                      | Current source                                           | Verified status                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and sessions                            | Supabase Auth                                            | Preserved. Protected-route redirects, authenticated sessions, and API `401` behavior remain intact.                                                |
| Profiles, roles, pins, credits, retained alert records | Supabase compatibility plane                             | Preserved. This remains a legacy non-auth dependency, not the target authority.                                                                    |
| Apps list and filters                                  | Tiger `metrics.apps_page_projection_v2`                  | Current and populated. Legacy projection remains available for rollback.                                                                           |
| Dashboard product metrics                              | Tiger/query API                                          | Current.                                                                                                                                           |
| Admin product and PICS health                          | Tiger/query API                                          | `ADMIN_PRODUCT_READ_TARGET=tiger`; current panels render without browser or server errors. Account administration remains on Supabase.             |
| Insights product metrics                               | Tiger/query API                                          | `INSIGHTS_READ_TARGET=tiger`; 30-day Top Games and trend data render without browser or server errors.                                             |
| Change Feed                                            | Tiger/query API                                          | Current with central event-registry semantics.                                                                                                     |
| YouTube Pulse                                          | Tiger/query API                                          | Current; hydration repair is deployed and verified.                                                                                                |
| PICS                                                   | Durable primary Railway service plus Tiger/R2            | `/health` is `OK`; `/status` reports durable primary, connected, processing enabled, and zero consecutive poll failures.                           |
| Query API                                              | Railway/Tiger                                            | `/healthz` returned `ok: true` with Tiger provenance at `2026-07-27T01:49:28Z`.                                                                    |
| Apps refresh                                           | Timescale job 1016                                       | Enabled on the fixed four-hour cadence; latest run successful.                                                                                     |
| Signal windows                                         | Tiger manual bounded runner                              | Corrected 100-app shadow cohort is populated and idempotency-verified; no recurring cadence or reader cutover was introduced.                      |
| Alert Detection                                        | Tiger metrics/state plus Supabase compatibility controls | Workflow and gate enabled; production run 30234116732 succeeded. Zero eligible entities is correct because all retained pins have alerts disabled. |
| Review Histogram                                       | Tiger metrics and sync state                             | Workflow active at 04:15/16:15 UTC; production run 30234313903 processed 300 apps with zero failures.                                              |

The exact PR #77 production deployment was `Ready` in Vercel and `Success` in
Railway. An authenticated overlap smoke kept Admin and Insights open
simultaneously; both rendered their Tiger data with no browser errors, and the
corresponding server logs contained no hidden timeout or query failures.

## Phase status

| Phase                              | Status                                                       | Current evidence                                                                                                                                                                                     | Exit gate still open                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0 — baseline and preservation      | Substantially complete                                       | Dated Tiger/Supabase/R2 manifests, protected-object comparisons, recovery evidence, ownership maps, and rollback records exist.                                                                      | Keep the final preservation comparison current when later approved writes occur.                                                     |
| 1 — durable catalog                | Active; observation window incomplete                        | One complete primary full scan on 2026-07-26 committed 176,236 source rows. Completed full shadow evidence also exists on July 24 and 25.                                                            | Three complete healthy **primary** daily full cycles have not elapsed.                                                               |
| 2 — durable PICS                   | Active; observation window incomplete                        | Durable primary is current, cursor-safe, archive-backed, and processing live plus catch-up lanes. The three historical dead letters have explicit preserved-terminal dispositions.                   | Three complete healthy daily primary cycles have not elapsed.                                                                        |
| 3 — readiness, events, and windows | Substantially complete                                       | Readiness, registry, lifecycle, runner, boundary tests, runbooks, and a validated 100-app shadow population exist.                                                                                   | Product cadence and consumer cutover remain intentionally separate future decisions.                                                 |
| 4 — current consumers              | Product readers complete; full compatibility gate incomplete | Apps, Dashboard, Admin, Insights, Change Feed, Chat, and YouTube use current intended product sources. Read-only route checks now include filters, entity details, and Unreleased timeline behavior. | Apps pagination and the corrected Admin Actions link await deployment; mutating compatibility branches need disposable test records. |
| 5 — controls and cutovers          | Partial                                                      | Fail-closed modes exist; migration 0096 is applied; Alert and Histogram are active and production-smoked; dead letters are dispositioned.                                                            | First natural 0096 run and three-cycle evidence remain.                                                                              |
| 6 — handoff                        | Current status published; final-ready verdict blocked        | This record reconciles PRs #39–#80 with live runtime, tests, limitations, and exact approval boundaries.                                                                                             | The verdict cannot become `Preparation complete` until Phases 1–5 pass.                                                              |

## Live data snapshot

All database checks below ran inside bounded read-only transactions.

Captured at `2026-07-27T01:50:05Z`:

- catalog:
  - one complete primary full run on July 26;
  - 176,236 source rows, 18 rejected rows, and one unknown row in that run;
  - 176,245 current catalog-readiness rows;
- durable PICS batches:
  - July 25: 444 committed live batches, 10,826 source apps, plus two
    `source_blocked` responses;
  - July 26: 255 committed live batches and 13,394 source apps;
  - July 27 partial day: 27 committed live batches and 1,007 source apps;
- durable PICS work:
  - catch-up: 3,538 completed, 271,414 pending, 10 claimed, 77
    `source_blocked`, and three dead letters;
  - live: 5,413 completed, 1,373 pending, 10 claimed, and 4,454
    `source_blocked`;
  - new lane: 147 `source_blocked`;
- PICS readiness: 8,951 ready, 272,807 pending, 4,678
  `source_blocked`, and three failed;
- overall readiness: 2,568 ready, 274,499 pending, 9,521
  `source_blocked`, and three failed;
- signal windows at the original snapshot: zero rows and zero
  creator-readiness rows; the approved follow-up shadow run later added the
  exact 100 signal rows and 200 readiness rows described below;
- Apps projections: 226,115 rows in both legacy and v2 after the successful
  retry;
- Tiger retained controls: six pins, zero alerts, and zero detection-state
  rows.

The three durable catch-up dead letters are:

| App ID | Current evidence                                                                                           | Operator disposition                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 314    | Eight `payload_missing` attempts; Steam Store API currently returns `success=false`; delisted placeholder. | Preserve the terminal historical record; no manual retry. New durable source activity may reopen it under current `source_blocked` semantics. |
| 1000   | Eight `payload_missing` attempts; Steam Store API currently returns `success=false`; delisted placeholder. | Preserve the terminal historical record; no manual retry. New durable source activity may reopen it under current `source_blocked` semantics. |
| 8780   | Eight `payload_missing` attempts; Steam Store API currently returns current `RACE On` storefront data.     | Preserve storefront truth and the terminal PICS-unavailable evidence; no synthetic data or stale manual retry.                                |

The exact causes, work IDs, current-code behavior, and operator actions are in
[`pics-dead-letter-disposition-2026-07-27.md`](./pics-dead-letter-disposition-2026-07-27.md).
No database row was changed to create the disposition.

The PICS service remained healthy after the snapshot. At
`2026-07-27T01:47:24Z`, `/status` reported cursor `37,547,482`, connected Steam,
processing enabled, and zero consecutive poll failures.

A bounded follow-up at `2026-07-27T03:40:27Z` found:

- July 27 had reached 55 committed durable live PICS batches and 2,765 source
  apps, with zero source-blocked live batches;
- work state had reached 13,939 completed, 272,207 pending, 90 claimed, 196
  retrying, 9,161 `source_blocked`, and the same three preserved dead letters;
  and
- catalog full-run evidence was unchanged at one successful July 26 primary
  cycle.

## Scheduler state and applied repair

Job 1016 reported three failures and fourteen successes across seventeen runs.
The 2026-07-27 fixed run failed twice because accepted source writes changed
`legacy.apps` between the refresh snapshot and the later parity statement:

| Run start    | Result           | Evidence                                          |
| ------------ | ---------------- | ------------------------------------------------- |
| 00:47:00 UTC | Failed           | projection 226,082; later source snapshot 226,083 |
| 01:02:34 UTC | Failed retry     | projection 226,089; later source snapshot 226,095 |
| 01:35:04 UTC | Successful retry | exact 226,115-row legacy/v2/source parity         |

The final retry finished at `01:36:11Z` and restored the fixed `04:47:00Z`
schedule. Production is current, but applied migration 0091 still contains the
race.

PR #77 added
`packages/data-plane/sql/tiger-bootstrap/0096_apps_projection_snapshot_aware_parity.sql`.
It captures before/after source fingerprints, requires exact source parity when
the source is stable, and always requires legacy/v2 and filter parity.

The separately approved production apply completed atomically. The procedure
definition MD5 changed from `7869dad37e0a575e042db5df5151e88a` to
`9fdc8e71ab143dcc3b148fe865fc11c3`; snapshot-aware markers are present. Job
1016's schedule, config, runtime limit, retry policy, counters, and
`2026-07-27T04:47:00Z` next start remained unchanged. The apply did not run the
job. Its first natural execution under 0096 remains an open validation gate.

## Signal-window execution

The originally approved 100-app shadow transaction failed its foreign-key
check because seven selected IDs were absent from `legacy.apps`. The
transaction rolled back atomically; pre- and post-state remained zero signal
rows and zero creator-readiness rows.

The revised manifest is
[`signal-window-shadow-revised-manifest.md`](./signal-window-shadow-revised-manifest.md).

It keeps the approved `2026-07-26` as-of date and replaces only the seven
non-canonical IDs with deterministic canonical PICS `source_blocked` apps. A
fail-closed preflight caught and corrected a 99-ID transcription error before
any write. The executed 100-app cohort produced:

- 100 `metrics.app_signal_windows_v1` rows;
- 100 `market_metrics` readiness rows;
- 100 `creator` readiness rows;
- zero date, boundary, coverage, or provenance violations; and
- identical semantic hashes across the required idempotency rerun.

The manifest records the exact cohort, actual 300-row footprint, state counts,
and semantic hashes.

## Regression and operational verification

The original merged PR #77 source passed the full repository regression suite.
The PR #80 Alert/Histogram restoration additionally passed:

- `pnpm build`: 10/10 workspace tasks passed;
- `pnpm check-types`: 13/13 workspace tasks passed;
- `pnpm lint`: zero errors;
- `pnpm test`: 10/10 workspace tasks passed, including database 55/55 and
  ingestion 105/105;
- bounded read-only production execution of both new Tiger alert queries;
- static ingestion verifier: zero failures;
- enforced writer audit: zero scheduled blockers.

Previously merged live evidence remains valid: all three Playwright Chat
smokes, 130 PICS tests, authenticated Admin/Insights overlap, YouTube hydration,
Vercel readiness, and Railway query-API health passed.

The restoration changes the Alert static contract to the approved exact split:
Tiger metrics/events/state/jobs and Supabase pins/preferences/delivered alerts.
It restores Histogram at 04:15 and 16:15 UTC with a 300-app batch and
30-minute cap.

Both production smokes succeeded:

- Alert run
  [30234116732](https://github.com/draknorr/piq/actions/runs/30234116732)
  completed the correct zero-eligible-entity no-op because all seven retained
  pins have alerts globally disabled; and
- Histogram run
  [30234313903](https://github.com/draknorr/piq/actions/runs/30234313903)
  processed 300 apps, fetched 297, failed zero, skipped three Steam-empty
  responses, and advanced the newest Histogram sync to
  `2026-07-27T03:26:50.946Z`.

Exact preflight hashes, Tiger job IDs, row counts, controls, and rollback are in
[`alert-histogram-production-restoration.md`](./alert-histogram-production-restoration.md).

The follow-up verifier repair in PR #79 replaced full-table exact counts with
explicitly labeled Timescale estimates plus indexed latest/recent probes. A
read-only production run at `2026-07-27T02:07:52Z` completed every registered
freshness check without a statement timeout: 22 table surfaces were current,
Review Histogram was stale, and Alert Detection was empty. Per-table error
isolation now preserves the remaining evidence if any individual probe fails.

The read-only Supabase snapshot remains preserved:

- nine profiles;
- seven pins;
- zero alerts;
- nine credit transactions;
- zero credit reservations;
- product freshness remains stale: `daily_metrics.metric_date = 2026-04-30`,
  latest sync job `2026-04-30T00:12:13Z`, latest storefront sync
  `2026-05-01T01:25:20Z`, and latest app update
  `2026-05-06T05:43:19Z`.

The broader route pass is recorded in
[`route-regression-closeout-2026-07-27.md`](./route-regression-closeout-2026-07-27.md).
It verified current Apps filtering, publisher and developer details, Unreleased
filter/detail/timeline behavior, and the other high-signal authenticated
surfaces. It also found two final repair candidates:

- Apps did not expose the pagination required by its existing query contract;
  bounded URL Previous/Next controls and offset reset now pass 266 Admin tests
  plus the optimized Next production build; and
- Admin job links still targeted the obsolete `draknorr/publisheriq`
  repository; the candidate targets `draknorr/piq`.

## Remaining closeout actions

The user approved the signal shadow run, migration 0096 apply, hybrid
Tiger-metrics Alert Detection port, and twice-daily 300-app Histogram cadence.
All four approved actions are complete. The remaining actions are:

1. validate job 1016's first natural execution under migration 0096;
2. merge, deploy, and production-smoke Apps pagination and the corrected Admin
   GitHub Actions links; and
3. provide a disposable account/record strategy before mutating pin, alert,
   account, and sign-out regression checks.

Three complete healthy primary catalog and PICS daily cycles must then be
captured. That elapsed evidence cannot be substituted with multiple runs on
one day or with earlier shadow cycles.

## Verdict

The current site is operational, the previously stale Admin and Insights
product panels are current, and the YouTube hydration regression is fixed.
The daily opportunity preparation is **close but not complete**. Declaring it
ready today would still overclaim the natural scheduler observation, final
route-fix deployment, mutating compatibility branches, and three-cycle gates.
