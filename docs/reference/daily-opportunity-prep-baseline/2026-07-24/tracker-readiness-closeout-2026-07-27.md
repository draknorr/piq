# Daily Opportunity Preparation Closeout Status

Status captured on 2026-07-27 UTC against `main` commit
`846e8c6d6589319de5598ae3f874454d56f28eaf` (merged PR #77).

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
- A snapshot-aware forward scheduler repair is merged, tested, and deliberately
  unapplied pending a separate production-schema approval.

No current product reader needs to be rolled back. The remaining gates are
data-write approvals, elapsed operating evidence, retained alert/histogram
ownership, and broader interaction evidence. They must not be relabeled as
complete merely because the core site renders.

## Closeout implementation ledger

| PR  | Result                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------- |
| #71 | Deployed hydration-safe YouTube time labels and published the first current readiness handoff.                   |
| #72 | Split Admin and Insights Tiger reads into bounded statements with explicit timeouts.                             |
| #73 | Bounded the exact 30-day Top Games peak scan.                                                                    |
| #74 | Bounded the 30-day Insights trend aggregates and raised the server timeout to the measured safe limit.           |
| #75 | Split Admin PICS relation counts to avoid one large relation scan.                                               |
| #76 | Split Admin source-health reads into independently bounded statements.                                           |
| #77 | Added and tested forward migration 0096 for snapshot-aware Apps projection parity. The migration is not applied. |

PR #69 remains an open documentation-only draft whose rollout narrative
predates primary catalog/PICS operation and the PR #70 replay. It is not
current rollout truth.

## Current source ownership and runtime

| Surface or domain                                      | Current source                                | Verified status                                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and sessions                            | Supabase Auth                                 | Preserved. Protected-route redirects, authenticated sessions, and API `401` behavior remain intact.                                    |
| Profiles, roles, pins, credits, retained alert records | Supabase compatibility plane                  | Preserved. This remains a legacy non-auth dependency, not the target authority.                                                        |
| Apps list and filters                                  | Tiger `metrics.apps_page_projection_v2`       | Current and populated. Legacy projection remains available for rollback.                                                               |
| Dashboard product metrics                              | Tiger/query API                               | Current.                                                                                                                               |
| Admin product and PICS health                          | Tiger/query API                               | `ADMIN_PRODUCT_READ_TARGET=tiger`; current panels render without browser or server errors. Account administration remains on Supabase. |
| Insights product metrics                               | Tiger/query API                               | `INSIGHTS_READ_TARGET=tiger`; 30-day Top Games and trend data render without browser or server errors.                                 |
| Change Feed                                            | Tiger/query API                               | Current with central event-registry semantics.                                                                                         |
| YouTube Pulse                                          | Tiger/query API                               | Current; hydration repair is deployed and verified.                                                                                    |
| PICS                                                   | Durable primary Railway service plus Tiger/R2 | `/health` is `OK`; `/status` reports durable primary, connected, processing enabled, and zero consecutive poll failures.               |
| Query API                                              | Railway/Tiger                                 | `/healthz` returned `ok: true` with Tiger provenance at `2026-07-27T01:49:28Z`.                                                        |
| Apps refresh                                           | Timescale job 1016                            | Enabled on the fixed four-hour cadence; latest run successful.                                                                         |
| Signal windows                                         | Tiger manual bounded runner                   | Schema and runner exist, but the table remains empty and no cadence is approved.                                                       |

The exact PR #77 production deployment was `Ready` in Vercel and `Success` in
Railway. An authenticated overlap smoke kept Admin and Insights open
simultaneously; both rendered their Tiger data with no browser errors, and the
corresponding server logs contained no hidden timeout or query failures.

## Phase status

| Phase                              | Status                                                       | Current evidence                                                                                                                                       | Exit gate still open                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — baseline and preservation      | Substantially complete                                       | Dated Tiger/Supabase/R2 manifests, protected-object comparisons, recovery evidence, ownership maps, and rollback records exist.                        | Keep the final preservation comparison current when later approved writes occur.                                                                    |
| 1 — durable catalog                | Active; observation window incomplete                        | One complete primary full scan on 2026-07-26 committed 176,236 source rows. Completed full shadow evidence also exists on July 24 and 25.              | Three complete healthy **primary** daily full cycles have not elapsed.                                                                              |
| 2 — durable PICS                   | Active; observation and disposition incomplete               | Durable primary is current, cursor-safe, archive-backed, and processing live plus catch-up lanes. PR #70 left 408 immutable replay-provenance rows.    | Three complete healthy daily primary cycles have not elapsed; three dead letters require an operator disposition.                                   |
| 3 — readiness, events, and windows | Partial                                                      | Readiness, registry, lifecycle, runner, boundary tests, and runbooks exist.                                                                            | `metrics.app_signal_windows_v1` has zero rows; the revised 100-app shadow transaction has not been approved or run.                                 |
| 4 — current consumers              | Product readers complete; full compatibility gate incomplete | Apps, Dashboard, Admin, Insights, Change Feed, Chat, and YouTube use current intended product sources and high-signal route checks pass.               | Legacy non-auth controls are not reconciled to Tiger; the alert detector is disabled; the full mutating route matrix needs disposable test records. |
| 5 — controls and cutovers          | Partial                                                      | Fail-closed reader/writer modes and non-destructive rollback flags exist. Catalog/PICS primary and Apps/Dashboard/Admin/Insights Tiger modes are live. | Migration 0096 is unapplied; three-cycle evidence is missing; histogram and alert ownership/cadence are unresolved.                                 |
| 6 — handoff                        | Current status published; final-ready verdict blocked        | This record reconciles PRs #39–#77 with live runtime, tests, limitations, and exact approval boundaries.                                               | The verdict cannot become `Preparation complete` until Phases 1–5 pass.                                                                             |

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
- signal windows: zero rows and zero creator-readiness rows;
- Apps projections: 226,115 rows in both legacy and v2 after the successful
  retry;
- Tiger retained controls: six pins, zero alerts, and zero detection-state
  rows.

The three durable catch-up dead letters are:

| App ID | Current evidence                                                                                           | Required operator decision                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 314    | Eight `payload_missing` attempts; Steam Store API currently returns `success=false`; delisted placeholder. | Classify as terminal invalid/source-blocked or approve another explicit repair.                           |
| 1000   | Eight `payload_missing` attempts; Steam Store API currently returns `success=false`; delisted placeholder. | Classify as terminal invalid/source-blocked or approve another explicit repair.                           |
| 8780   | Eight `payload_missing` attempts; Steam Store API currently returns current `RACE On` storefront data.     | Preserve storefront truth and classify PICS unavailability explicitly, or approve a targeted PICS repair. |

The PICS service remained healthy after the snapshot. At
`2026-07-27T01:47:24Z`, `/status` reported cursor `37,547,482`, connected Steam,
processing enabled, and zero consecutive poll failures.

## Scheduler state and unapplied repair

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
the source is stable, and always requires legacy/v2 and filter parity. It does
not alter or run job 1016. Applying its `CREATE OR REPLACE PROCEDURE` remains a
separate production schema write.

## Signal-window approval boundary

The originally approved 100-app shadow transaction failed its foreign-key
check because seven selected IDs were absent from `legacy.apps`. The
transaction rolled back atomically; pre- and post-state remained zero signal
rows and zero creator-readiness rows.

The revised manifest is
[`signal-window-shadow-revised-manifest.md`](./signal-window-shadow-revised-manifest.md).

It keeps the approved `2026-07-26` as-of date and replaces only the seven
non-canonical IDs with deterministic canonical PICS `source_blocked` apps. Its
verified pre-state is exactly 100 distinct canonical apps, 15 PICS
`source_blocked` cohort rows, zero signal rows, and zero creator-readiness rows.
It has **not** been approved or executed.

## Regression and operational verification

Validated on the merged PR #77 source:

- `pnpm build`: 10/10 workspace tasks passed;
- `pnpm check-types`: 13/13 workspace tasks passed;
- `pnpm lint`: zero errors;
- `pnpm test`: 10/10 workspace tasks passed, including data-plane 95/95 and
  ingestion 102/102;
- `pnpm --filter @publisheriq/ingestion test:change-intel`: 46/46 passed;
- `pnpm test:e2e`: all three Playwright Chat smokes passed;
- complete `services/pics-service` pytest: 130/130 passed;
- production Admin and Insights authenticated overlap smoke: passed;
- production YouTube hydration smoke: passed;
- Vercel deployment: Ready;
- Railway query API deployment and health: Success/healthy.

Two required audit commands correctly remain non-green:

1. `pnpm supabase:writer-audit` reports one scheduled-code blocker:
   `.github/workflows/alert-detection.yml` still contains the Supabase
   service-key writer and no Tiger target. GitHub reports this workflow
   `disabled_manually`; its last run was April 30, so it is not currently
   writing, but retained alert detection is also not operating.
2. `pnpm tiger:ingestion-verify -- --live` reports:
   - Review Histogram has no current scheduled trigger;
   - Alert Detection has no Tiger writer/gate;
   - recent Tiger `ops.sync_jobs` has neither histogram nor alert-detection
     work; and
   - its broad table-freshness loop still exceeds the 15-second statement
     timeout, although bounded catalog, sync-status, worker-job, and
     change-intel checks return current evidence.

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

## Remaining closeout decisions

The following actions require explicit choices rather than silent changes:

1. approve or reject the revised exact 100-app signal-window shadow manifest;
2. separately approve or reject applying migration 0096 to production Tiger;
3. choose the retained alert policy:
   - migrate the existing detector to its prepared Tiger tables and re-enable
     it behind a fail-closed gate;
   - formally retain alert UI/data while keeping automated detection disabled;
     or
   - remove alerts only through a separately approved product change;
4. choose a bounded Review Histogram cadence or formally record it as
   manual/on-demand;
5. disposition the three PICS dead letters; and
6. provide a disposable account/record strategy before mutating pin, alert,
   account, and sign-out regression checks.

Three complete healthy primary catalog and PICS daily cycles must then be
captured. That elapsed evidence cannot be substituted with multiple runs on
one day or with earlier shadow cycles.

## Verdict

The current site is operational, the previously stale Admin and Insights
product panels are current, and the YouTube hydration regression is fixed.
The daily opportunity preparation is **close but not complete**. Declaring it
ready today would overclaim the signal-window, alert/histogram, scheduler,
dead-letter, full-route, and three-cycle gates.
