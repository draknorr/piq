# Daily Opportunity Tracker Readiness Handoff

> Historical snapshot through PR #70. For current status through PR #77, use
> [`tracker-readiness-closeout-2026-07-27.md`](./tracker-readiness-closeout-2026-07-27.md).

Status captured on 2026-07-26 UTC against `origin/main` commit
`404abcc54adc044afc337b5239dc007a49e86a86` (PR #70).

## Verdict

**Preparation is operating but is not yet complete.**

The difficult integrity work is implemented and active: catalog observation is
primary, PICS uses its durable primary path, the audited shadow-gap replay ran,
Apps v2 and Dashboard Tiger readers are live, Change Feed is current, and the
validated codebase passes its build and test suites.

The tracker must not be declared ready until the open gates in this document
are closed. In particular:

1. catalog and durable PICS need three complete healthy daily primary cycles;
2. the signal-window contract needs an approved production population and
   boundary/coverage validation;
3. Admin and Insights product readers are still on stale legacy sources;
4. the Apps scheduler's live-source parity check has a concurrent-write race;
5. the YouTube hydration repair must reach production and pass a browser smoke;
6. the full route/API interaction matrix needs final evidence; and
7. this handoff must be updated from `not ready` to `ready` only after every
   gate is evidenced.

This handoff does not authorize a database write, migration, service restart,
reader switch, deployment, or destructive cleanup.

## Scope and exclusion confirmation

The preparation line introduced infrastructure contracts only. It did **not**
create opportunity workspaces, profiles, presets, rules, evaluations, runs,
results, rankings, cohorts, preset-health calculations, delivery outboxes,
email/Slack delivery, or an opportunity UI.

The later tracker may consume the durable contracts listed below. It must not
reinterpret projection refresh time as first observation or bypass the
authenticated application/query-API boundary.

## Merged implementation ledger

| PRs          | Capability                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| #39–#42      | Production baseline, containment, durable catalog schema, and shadow evidence.                                                |
| #43–#44      | Durable PICS batch intake, cursor transaction, leased work, and protected latest-state promotion.                             |
| #45          | Independent readiness, lifecycle events, central event registry, and versioned signal-window contracts.                       |
| #46          | Versioned Apps projection and Tiger-backed Insights/product-health reader contracts with fail-closed flags.                   |
| #47–#50, #54 | Tiger-native Apps scheduler, schema apply, foreground smoke, background enablement, and first natural run evidence.           |
| #51          | Data-plane lint cleanup.                                                                                                      |
| #52–#58      | PICS watermarks, audited reconciliation, schema/function repair, and durable checkpoint evidence.                             |
| #59–#64      | Reproducible PICS image, locked shadow rollout, archive-before-cursor repair, settlement typing, and accepted durable canary. |
| #65–#68      | Retry ordering, franchise collision handling, terminal source-blocked classification, and bounded catalog finalization.       |
| #70          | Audited shadow-gap replay and immutable replay provenance.                                                                    |

PR #69 is an open documentation-only draft. Its July 25 narrative predates the
current primary catalog/PICS state and the executed PR #70 replay. It should be
refreshed or superseded rather than merged as current rollout truth.

## Current source ownership

| Surface or domain                                 | Current authority                                       | Live status                                            | Required disposition                                                   |
| ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Authentication, sessions, accounts, roles         | Supabase                                                | Preserved and working                                  | Retain.                                                                |
| Pins, alert preferences, retained alerts, credits | Supabase                                                | Preserved                                              | Retain; do not reuse for opportunity state.                            |
| Apps list and Apps filters                        | Tiger `metrics.apps_page_projection_v2` through the app | `APP_PROJECTION_VERSION=v2`; current                   | Retain v2 with legacy projection rollback.                             |
| App details and company data                      | Tiger/query API                                         | Current route smoke passed                             | Retain.                                                                |
| Unreleased                                        | Tiger `metrics.unreleased_games_projection`             | Current route smoke passed                             | Retain; do not use `latest_added_at` as durable newness.               |
| Change Feed                                       | Tiger/query API plus central registry semantics         | `Capture healthy`, 25 current rows                     | Retain strict Tiger behavior and preserved unknown types.              |
| Chat product data                                 | Tiger/query API                                         | Three Playwright Chat smokes passed                    | Retain Supabase session/credit/log boundaries.                         |
| YouTube Pulse                                     | Tiger/query API                                         | Data current; hydration repair not deployed            | Deploy repair and repeat browser smoke.                                |
| Dashboard product metrics                         | Tiger/query API                                         | `DASHBOARD_PRODUCT_READ_TARGET=tiger`                  | Retain.                                                                |
| Admin account operations                          | Supabase                                                | Working                                                | Retain.                                                                |
| Admin product/PICS health                         | Mixed; product reader defaults legacy                   | PICS runtime card current, legacy product panels stale | Switch product-health reader to Tiger after approval and smoke.        |
| Insights product metrics                          | Supabase legacy default                                 | Route renders but source is stale                      | Switch to the existing Tiger contract after approval and parity smoke. |
| Reports                                           | Static/report-specific contracts                        | Not changed by preparation                             | Preserve field meanings and URLs.                                      |

## Durable data contracts available

### Catalog observation

- `ops.catalog_scan_runs`
- `ops.app_catalog_state`
- `events.app_catalog_events`

`ops.app_catalog_state.first_observed_at` is the immutable prepared first-seen
clock. `legacy.apps.created_at`, `last_seen_in_steam_applist_at`, and
`catalog_seed_state` retain their legacy meanings.

### PICS durability and reconciliation

- `ops.pics_change_batches`
- `ops.pics_change_batch_apps`
- `ops.pics_work_state`
- `ops.pics_sync_state`
- `ops.pics_reconciliation_runs`
- `ops.pics_reconciliation_items`
- `ops.pics_shadow_gap_replay_provenance`
- R2 parent-response and per-product archived payloads

The source cursor may advance only with a fully recorded batch. Terminal
`source_blocked` is a classified outcome, not a retrying failure. Relationship
removal requires a complete archived family.

### Readiness

- `ops.app_data_readiness`

Independent sources are `catalog`, `storefront`, `pics`, `market_metrics`,
`creator`, and `overall`. Supported statuses are `unknown`, `pending`, `ready`,
`partial`, `stale`, `source_blocked`, `invalid`, and `failed`.

Each state includes source time, processed time, version, blocking reason,
retryability, and JSON provenance. Overall readiness requires catalog,
storefront, and PICS; market metrics and creator readiness stay independent.

### Normalized events

- `events.change_event_registry_versions`
- `events.change_event_registry`
- `events.change_event_registry_health_v1`
- `events.app_lifecycle_events`

The active registry is `change-events/v1`. Unknown raw types remain visible as
`unknown`; they do not silently become storefront events. Initial storefront
state does not fan out into a change event for every populated field.

### Signal windows

- `metrics.app_signal_windows_v1`
- `metrics.refresh_app_signal_windows_v1(date, integer[], text)`
- `ops.refresh_creator_readiness_v1(date, integer[])`

The table publishes calendar-aligned 7-day and 30-day review and CCU windows,
observed/missing-day counts, source/calculation timestamps,
`signal-windows/v1`, and complete/partial/none coverage. The runner is bounded
to 5,000 IDs and defaults off.

At this handoff snapshot the table has **zero rows**. The contract is
implemented and unit-tested, but it is not yet production-populated evidence
for a tracker.

### Query API

Current versioned browser-facing contracts include:

- `/v1/contracts/search-catalog`
- `/v1/contracts/get-insights-dashboard`
- `/v1/contracts/get-product-health`
- `/v1/contracts/get-change-feed-status`
- `/v1/contracts/explain-changes`
- `/v1/contracts/get-youtube-game-coverage`
- `/v1/contracts/get-youtube-market-pulse`

Browsers authenticate through the application. They do not receive a direct
Tiger connection.

## Worker topology and runtime placement

| Work                                     | Runtime                                                                | Current state                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Incremental/full catalog observation     | Existing bounded ingestion jobs                                        | Primary; one full primary cycle and seven incremental primary runs observed. |
| PICS source stream and durable consumers | Genuine Railway `publisheriq` service in project `enthusiastic-caring` | `PICS_WORK_MODE=durable`, primary stream, processing enabled, connected.     |
| Query API                                | Railway `publisheriq-query-api-prod`                                   | `/healthz` reports `ok: true` with Tiger provenance.                         |
| Apps projection refresh                  | Tiger/Timescale job 1016                                               | Fixed four-hour cadence; GitHub workflow is manual fallback.                 |
| Signal-window/creator refresh            | Manual bounded data-plane runner                                       | Off; no production population or recurring owner.                            |
| Dashboard/Admin app                      | Vercel `publisheriq-admin`                                             | Production deployment ready at `www.publisheriq.app`.                        |

The separate failed/stopped Railway service with the same `publisheriq` name in
project `confident-education` is not the genuine PICS service. See
[`railway-pics-service-topology.md`](./railway-pics-service-topology.md).

## Live operating snapshot

Time-bound inspection on 2026-07-26 UTC showed:

- catalog state: 176,250 rows;
- catalog readiness: 176,239 ready;
- primary catalog runs: one full and seven incremental completed;
- PICS cursor: 37,544,403 and advancing;
- durable primary committed batches: 655;
- durable pending work: 272,751 catch-up plus 2,479 live;
- completed durable work: 2,874 catch-up plus 4,289 live;
- PICS readiness: 7,163 ready, 275,237 pending, 3,705
  `source_blocked`, and 3 failed;
- PR #70 replay: 408 provenance rows covering change numbers 37,522,925 through
  37,530,944 under one plan hash;
- Apps legacy/v2 projections: equal row sets during inspection;
- signal-window rows: 0;
- registry rows/version: 43 rows at version 1;
- lifecycle events: 419, current through 2026-07-26 19:38 UTC.

These values are evidence timestamps, not permanent thresholds. PICS and
catalog counts move continuously.

## Scheduler incident and current state

Job 1016 completed 12 consecutive successes, then failed its 2026-07-26
20:47 UTC run with:

```text
apps projection/source row parity failed: projection=225781, source=225777
```

Its first automatic retry started at 21:03:12 UTC and succeeded at 21:03:48
UTC. The fixed schedule resumed for 2026-07-27 00:47 UTC, so this was not an
ongoing Apps freshness outage.

The source procedure refreshes the materialized view and then compares it with
a later statement-level snapshot of mutable `legacy.apps`. Concurrent accepted
writes can therefore create a false exact-parity failure. A forward additive
migration should make this validation snapshot-aware. Do not edit applied
migration 0091 or apply a replacement without a separate database-write
approval.

## Backfill and reconciliation status

The durable live path is healthy, but historical reconciliation is not drained.
The large pending catch-up queue is expected work, not permission to restore
the lossy in-memory writer. New/live capacity is separated from catch-up, and
terminal omissions are classified `source_blocked`.

Before readiness is declared:

1. demonstrate that new-game work is not starved during three complete daily
   cycles;
2. record oldest-pending age and lane-specific throughput for each cycle;
3. classify the three dead-lettered reconciliation items with operator action;
4. preserve archive/hash evidence for relationship removals; and
5. record the remaining backlog and product limitation in the final update.

## Rollback and containment

| Change                          | Containment/rollback                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog primary                 | Set `CATALOG_OBSERVATION_MODE=off`; retain state/events and repair from scan manifests.                                                               |
| Durable PICS                    | Stop at the last committed durable batch/cursor. Do not restore the lossy in-memory writer. Retain batch, archive, work, and reconciliation evidence. |
| Apps v2 reader                  | Set `APP_PROJECTION_VERSION=legacy`; keep both projections refreshed.                                                                                 |
| Dashboard/Admin/Insights reader | Change only the relevant read-target flag to `legacy` and redeploy. Supabase account/control data remains authoritative throughout.                   |
| Apps scheduler                  | Disable exact job 1016; use the manual GitHub refresh only as the documented recovery path. Retain job history.                                       |
| Signal-window refresh           | Set `PREPARATION_STATE_MODE=off`; do not cut readers over; retain generated additive rows for reconciliation.                                         |
| Change Feed                     | Restore the previous read flag only if the Tiger contract fails its route/shape gate; never delete raw unknown events.                                |

No rollback procedure uses `DROP`, `TRUNCATE`, broad `DELETE`, or a destructive
repository reset.

## Regression evidence

Validated against an isolated `origin/main` snapshot:

- `pnpm install --frozen-lockfile`: passed;
- `pnpm check-types`: passed;
- `pnpm lint`: passed with warnings only;
- `pnpm build`: passed;
- full `pnpm test`: passed;
- Playwright Chat smoke: 3/3 passed;
- PICS pytest: 130 passed.

Authenticated production route smoke:

- `/apps`: populated v2 table, no console errors;
- `/dashboard`: current Tiger counts;
- `/admin`: renders, with current PICS runtime but stale legacy product panels;
- `/insights`: renders, still on the legacy product reader;
- `/changes`: `Capture healthy`, 25 current rows;
- `/unreleased`: populated;
- `/companies?type=publisher`: populated;
- `/youtube`: populated but logged React hydration error 418.

A hydration-safe YouTube time-label repair was subsequently validated on
`codex/daily-opportunity-readiness-finalize` at commit `93cd29f`. Workspace
build/type checks, Admin lint, and all 261 Admin tests passed. It still needs
the normal PR/deployment path and a production browser confirmation.

The broad interaction matrix remains incomplete. Final evidence must still
cover representative Apps filtering/pagination/detail flows, company details,
Unreleased export/detail/timeline, Insights tabs, Change Feed inspector,
YouTube inspector, pin CRUD, alerts/preferences, account/sign-out,
role-negative Admin access, and unauthorized API contracts. Mutating user
control checks require an explicit disposable test account/record strategy.

## Monitoring and alerts

The Tiger product-health contract exposes catalog/PICS cursor and queue state,
readiness coverage, projection freshness, and source health for Dashboard/Admin
consumers. Current verification also inspects:

- `timescaledb_information.job_stats` for job 1016;
- PICS `/health` and `/status`;
- Query API `/healthz`;
- lane/state counts in `ops.pics_work_state`;
- reconciliation state and oldest pending work;
- registry unknown-type health;
- projection row/freshness parity.

The final handoff still needs named alert destinations and thresholds for:

- stopped/stale PICS cursor;
- cursor/batch item mismatch;
- oldest live-lane work age;
- repeated job 1016 failure or projection age over eight hours;
- failed/dead-letter growth;
- catalog full-reconciliation gap;
- unknown event-type growth; and
- signal-window refresh failure/staleness once a cadence is approved.

## Open gates

| Gate                                   | Current evidence                                                             | Status                 |
| -------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- |
| Reproducible baseline and preservation | Dated manifests, protected-object comparison, R2 manifest, recovery evidence | Substantially complete |
| Durable catalog activation             | Primary full/incremental runs and current state/events                       | Active                 |
| Three healthy catalog daily cycles     | Only one full primary cycle elapsed                                          | **Open**               |
| Durable PICS activation/restart safety | Canary accepted; durable primary current; replay provenance present          | Active                 |
| Three healthy PICS daily cycles        | Required elapsed window not yet present                                      | **Open**               |
| New-game starvation/backlog health     | Live lane progressing; large catch-up remains                                | **Open**               |
| Readiness/registry/lifecycle contracts | Schema and current registry/lifecycle state present                          | Complete               |
| Signal-window production validation    | Zero rows                                                                    | **Open**               |
| Apps v2 and Dashboard Tiger            | Live and current                                                             | Complete               |
| Admin Tiger product health             | Flag unset; stale panels visible                                             | **Open**               |
| Insights Tiger reader                  | Flag unset                                                                   | **Open**               |
| YouTube hydration                      | Source repair validated but not deployed                                     | **Open**               |
| Apps scheduler stable validation       | Retry recovered; source-snapshot race remains                                | **Open**               |
| Full route/API matrix                  | High-signal smoke plus Chat E2E only                                         | **Open**               |
| Named monitoring/alert ownership       | Health contracts exist; final alert ownership incomplete                     | **Open**               |

## Required closeout sequence

1. Deploy and production-smoke the YouTube hydration repair.
2. Approve, apply, and verify a forward scheduler validation repair, or record
   an explicit decision to accept automatic retry as the operational policy.
3. Approve a bounded signal-window shadow population, verify it, then decide
   primary cadence and backfill ownership.
4. Approve and smoke the Admin and Insights Tiger reader switches independently
   with their rollback flags.
5. Complete the remaining non-mutating route matrix. Use separately approved
   disposable records for pin/alert/account mutations.
6. Capture three complete daily catalog/PICS cycles and the named monitoring
   evidence.
7. Update every open gate above to complete with exact artifact links,
   timestamps, and current counts.

Only then may the first verdict in this document change to:
`Preparation complete; tracker implementation may begin.`
