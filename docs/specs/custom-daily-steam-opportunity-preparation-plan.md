# Daily Opportunity Tracker Backend Preparation Plan

> **Current execution status:** the evidence-backed closeout through merged PR
> #77 is in
> [`tracker-readiness-closeout-2026-07-27.md`](../reference/daily-opportunity-prep-baseline/2026-07-24/tracker-readiness-closeout-2026-07-27.md).
> The production site and its Tiger product readers are operational, but the
> preparation exit gates are not all complete.

## Purpose

This document defines the work required to make PublisherIQ's backend, Steam data intake, and current website safe foundations for the [Custom Daily Steam Opportunity Brief](./custom-daily-steam-opportunity-brief.md).

It is an execution plan for infrastructure preparation, not an implementation of the opportunity tracker.

The preparation project will:

1. preserve all existing Tiger, Supabase, and R2 data;
2. make catalog discovery and PICS processing durable and replayable;
3. establish explicit source-readiness and event contracts;
4. repair stale or incompatible backend reads used by the current site;
5. prove that existing routes, APIs, pins, alerts, and account flows still work; and
6. produce a documented handoff for the later tracker implementation.

The preparation project will **not** create opportunity workspaces, profiles, presets, rules, evaluations, runs, results, rankings, cohorts, preset-health calculations, delivery outboxes, email or Slack delivery, or a new opportunity UI.

The supporting architectural analysis is in the [Backend Assessment](./custom-daily-steam-opportunity-backend-assessment.md).

## Non-Negotiable Safety Rules

- Existing data preservation is stricter than uptime. A short maintenance window is acceptable; losing existing records or silently skipping source activity is not.
- All production database writes, migrations, and Tiger bootstrap SQL require separate explicit approval with the affected objects, risk level, and rollback procedure.
- Preparation changes must be additive. No legacy table, projection, workflow, route, or fallback is removed during this project.
- Existing primary keys and append-only history must not disappear.
- A relationship may be removed only when a complete archived source payload explicitly proves that the relationship is absent.
- A source cursor must not advance until every item it covers is durably recorded.
- Failed primary writer cutovers pause at the last durable cursor. They do not fall back to a writer known to have a data-loss window.
- Supabase remains authoritative only for authentication identities and sessions.
- Tiger and R2 remain authoritative for all non-auth product, operational, user-control, credit, alert, workspace, opportunity, ingestion, event, calculation, and archived-source state.
- Existing non-auth Supabase rows are legacy migration inputs, not the target source of truth. Preserve them until a reconciled Tiger migration is complete; do not add new non-auth Supabase writes.
- Browsers continue to use authenticated application and query-API boundaries. They never connect directly to Tiger.

## Current Production Baseline

Read-only production inspection on Friday, July 24, 2026 UTC established the following time-bound baseline:

| Area                       | Observed state                                                                                                                                                                                                                                                                                                                  | Preparation consequence                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recent game intake         | 198 Tiger game rows created in the preceding 24 hours had storefront sync and developer or publisher relationships. None had Steam tags or genres.                                                                                                                                                                              | Catalog discovery is working, but taxonomy-dependent readiness is not.                                                                                            |
| Tiger PICS                 | The latest `ops.sync_status.last_pics_sync` was June 16, 2026. About 93,557 sync-status rows had never completed a PICS sync.                                                                                                                                                                                                   | PICS repair is a preparation blocker.                                                                                                                             |
| PICS runtime               | Railway service `publisheriq` was deployed in `change_monitor` mode with Tiger latest-state/history targets. `/health` returned `OK`, but `/status.updated_at`, `/status.last_successful_change_poll_at`, and the Tiger cursor were frozen on June 16.                                                                          | Process liveness is not source progress. Report the worker as stalled and do not restart it into the lossy catch-up path.                                         |
| PICS events                | The latest Tiger PICS change event was June 16, while storefront, news, and media events were current.                                                                                                                                                                                                                          | Restarting the existing worker is not evidence of recovery. Cursor and queue durability must be fixed.                                                            |
| Change-intel work          | At the refreshed July 24 00:59 UTC baseline, `ops.app_capture_work_state` contained 2,858 dead-lettered records and 179 non-dead records with `dirty_since` set.                                                                                                                                                                | Terminal causes and the meaning of dirty versus completed work must be understood before relying on this queue for readiness or health.                           |
| Change Feed                | The authenticated `/changes` route initially displayed `Capture delayed` and zero activity while Tiger contained 14,026 storefront, news, and media events in the preceding 24 hours. After the July 24 Vercel configuration repair, it reported `Capture healthy` and displayed 25 current Tiger-backed rows for the last day. | Preserve the repaired strict Tiger/query-API contract and its authentication/shape regression checks before changing event semantics or introducing the registry. |
| Apps projection            | `metrics.apps_page_projection` contained about 166,864 rows, but its newest `data_updated_at` was May 4, 2026.                                                                                                                                                                                                                  | `/apps` needs a versioned replacement and a reversible read cutover.                                                                                              |
| Unreleased projection      | `metrics.unreleased_games_projection` contained about 51,427 rows and was refreshed on July 23.                                                                                                                                                                                                                                 | Its current behavior must be preserved, but `latest_added_at` must not become the opportunity newness clock.                                                      |
| Supabase product plane     | Supabase product sync jobs and PICS freshness stopped around April 30. No recent `daily_metrics.metric_date` was found in the inspected 14-day window.                                                                                                                                                                          | Retained product and operational reads cannot be treated as monitors for current Tiger ingestion.                                                                 |
| Existing user control data | Supabase contained 9 user profiles, 7 pins, no `public.alert_preferences` or `public.pin_alert_settings` table in the current schema, 0 user alerts, 9 credit transactions, and 0 credit reservations at inspection time.                                                                                                       | These are legacy dependencies to reconcile into Tiger, not target authority. Low usage does not authorize deleting or silently ignoring them.                     |
| Route protection           | The deployed `/apps` route redirected an unauthenticated request to `/login?next=%2Fapps`.                                                                                                                                                                                                                                      | Existing authentication and redirect behavior is a regression contract.                                                                                           |

These numbers are evidence for planning, not permanent thresholds. Phase 0 must capture a fresh baseline before any later execution.

## Current Consumer Matrix

The preparation project must maintain a versioned source-and-contract matrix for the current site.

| Consumer group                               | Current primary dependency                                                 | Preparation treatment                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing, login, auth callback                | Supabase Auth and application middleware                                   | Preserve authentication identity and session behavior exactly.                                                                                       |
| Waitlist                                     | Legacy Supabase non-auth table                                             | Preserve browser behavior while moving durable state to Tiger/query API through a reconciled cutover.                                                |
| Account, users, credits                      | Supabase Auth plus legacy profile and credit data                          | Keep authentication in Supabase; migrate non-auth profile and credit contracts to Tiger behind the query API.                                        |
| Pins and retained alerts                     | Legacy Supabase user-control and alert tables                              | Preserve during reconciliation, then migrate non-auth state to Tiger; do not reuse the legacy alert model for opportunities.                         |
| `/apps` and app details                      | Tiger projections and Tiger relational data                                | Build and compare a new Apps projection beside the old one.                                                                                          |
| `/companies`, publisher, and developer paths | Tiger relational data and projections                                      | Preserve response and navigation contracts.                                                                                                          |
| `/unreleased`                                | Tiger unreleased projection                                                | Preserve behavior and remove any future newness dependency on projection refresh time.                                                               |
| `/changes`                                   | Strict Tiger/query API in production                                       | Preserve the repaired contract; centralize event interpretation only after parity is proved.                                                         |
| `/chat`                                      | Query API and Tiger, with Supabase session plus legacy credit/log behavior | Keep Supabase session validation; move non-auth credit and log state behind Tiger/query-API contracts without changing browser shapes.               |
| `/youtube`                                   | Query API and Tiger YouTube data                                           | Regression-test only unless a shared readiness change affects it.                                                                                    |
| `/insights`                                  | Retained Supabase product and metric reads                                 | Migrate the server-side data contract to Tiger without redesigning the UI.                                                                           |
| `/dashboard` and `/admin` sync health        | Retained Supabase product and operational reads                            | Move all non-auth product, ingestion, account-control, and operational state to Tiger; retain only Auth identity/session administration in Supabase. |
| Reports                                      | Static and report-specific data access                                     | Verify that shared field and calculation meanings do not change underneath existing reports.                                                         |

Phase 0 must expand this matrix to the route, API, query, field, and test level.

## Phase 0: Capture the Production Baseline

### Work

1. Record the live Tiger and Supabase:
   - schemas, tables, views, and materialized views;
   - columns, types, constraints, and indexes;
   - row counts or bounded estimates appropriate to table size;
   - maximum IDs and latest source timestamps;
   - queue depths, cursor positions, dead letters, and oldest pending work; and
   - projection row counts and freshness.
2. Record current:
   - GitHub workflow schedules and enablement gates;
   - Railway services, modes, replicas, and health when access is available;
   - ingestion and PICS environment **keys and modes**, without recording secret values;
   - query-API readiness and configured data targets; and
   - deployed route, authentication, API-shape, and latency behavior.
3. Confirm managed backup or point-in-time recovery for Tiger before any Tiger write. Confirm Supabase recovery only before an auth-plane mutation or an approved migration that changes legacy Supabase rows.
4. Capture restorable, access-controlled snapshots for every table that a later phase may update in place.
5. Capture R2 object counts and prefix-level manifests for affected archive paths without copying credentials into the artifact.
6. Define the approved maintenance-window procedure, operator, abort conditions, and communication channel.
7. Add a machine-readable baseline manifest that later verification can compare without storing credentials or personal data.
8. Store the tracked manifest and human-readable notes under
   `docs/reference/daily-opportunity-prep-baseline/<UTC-date>/`.

### Preservation Checks

- Append-only tables record total rows, maximum IDs, maximum event time, and a stable bounded sample hash.
- Mutable current-state tables record primary-key sets and the before-state of every row selected for a repair.
- Relationship tables record per-app counts and values for the exact app IDs a repair will touch.
- Large metrics tables use time-bounded partitions and aggregate checks rather than unsafe unbounded scans.
- Existing Supabase Auth user IDs and legacy non-auth row IDs are included in protected-object checks without exporting private profile fields into general CI artifacts. These checks prevent migration loss; they do not assign non-auth authority to Supabase.

### Exit Gate

Phase 0 is complete only when:

- the baseline can be reproduced;
- every planned mutable object has a tested restoration path;
- every current route and API has an assigned owner and source;
- the maintenance and rollback procedures name exact commands or flags; and
- no production mutation has occurred without its separate approval record.

## Phase 1: Make Catalog Discovery Durable

### Target Records

Add the following Tiger records in an approved additive migration:

| Record                      | Purpose                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ops.catalog_scan_runs`     | One auditable record per incremental or full catalog scan, including status, counts, source cursor, and reconciliation outcome.        |
| `ops.app_catalog_state`     | Current per-app catalog state, including immutable first observation, last observation, latest source hints, and last successful scan. |
| `events.app_catalog_events` | Append-only first-observed and later normalized catalog events with stable idempotency keys.                                           |

These records must not change the existing meanings of:

- `legacy.apps.created_at`;
- `legacy.apps.last_seen_in_steam_applist_at`; or
- `legacy.apps.catalog_seed_state`.

### Worker Behavior

1. Keep the hourly `IStoreService/GetAppList` hint workflow on the free standard GitHub runner.
2. Process known and unknown IDs instead of discarding unknown IDs.
3. For each scan batch, transactionally:
   - create or resume the scan run;
   - insert unknown `legacy.apps` seed rows idempotently;
   - establish immutable first-observed state;
   - write exactly one first-observed event;
   - initialize source readiness;
   - enqueue protected storefront intake; and
   - record the batch as durable.
4. Mark the scan complete only after every fetched batch commits.
5. Preserve the daily full AppList job as an independent reconciliation path.
6. Do not infer removal or delisting from a single missing AppList observation.

### Shadow Verification

Run `CATALOG_OBSERVATION_MODE=shadow` for three complete daily reconciliation cycles and require:

- exact unknown-ID parity with the full AppList reconciliation;
- idempotent results across repeated input;
- no duplicate first-observed events;
- stable first-observed timestamps;
- a recorded reason for every rejected source row; and
- no lost ID when the worker is terminated between source receipt, queue persistence, and run completion.

### Rollback

- Set `CATALOG_OBSERVATION_MODE=off`.
- Leave every new event and state record intact.
- Continue the existing daily AppList reconciliation.
- Repair from the last scan manifest rather than deleting partially prepared data.

### Exit Gate

A new Steam ID must be durably observable, replayable, and independently reconciled before Phase 1 is complete.

## Phase 2: Replace the Lossy PICS Work Path

### Why a Restart Is Not Sufficient

The current change monitor advances the stored PICS change number after adding app IDs to a bounded in-memory queue. A process exit can therefore retain the later cursor while losing queued IDs. Restarting that worker may improve uptime but does not close the data-loss window.

### Target Records

Add:

| Record                       | Purpose                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ops.pics_change_batches`    | Durable upstream PICS request/response cursor boundaries, counts, hashes, receipt times, force-full flags, completeness, and status. |
| `ops.pics_change_batch_apps` | Every ordered app entry, including app ID, item change number, token requirement, and duplicates.                                    |
| `ops.pics_work_state`        | Coalesced, claimable app work with priority lane, lease, retry, next-attempt, completion, and dead-letter state.                     |
| `ops.app_data_readiness`     | Independent catalog, storefront, taxonomy, market-metric, creator, and overall source states.                                        |

### Cursor Transaction

Within one Tiger transaction, the PICS leader must:

1. insert the upstream batch idempotently;
2. insert every contained app ID;
3. upsert claimable work without lowering existing priority;
4. verify the durable item count against the upstream count;
5. record the payload or content-addressed archive reference; and
6. retain the echoed starting cursor plus `force_full_update`,
   `force_full_app_update`, and `force_full_package_update`;
7. create work and advance `ops.pics_sync_state.last_change_number` only when
   the echoed starting cursor matches the request and no app/global force-full
   flag is set.

If any step fails, the transaction rolls back and the cursor remains unchanged.
An incomplete response is durable evidence, not claimable work: retain it as
`source_blocked` and leave the old cursor unchanged.

### Work Processing

- Use `FOR UPDATE SKIP LOCKED`, bounded leases, heartbeats, stale-claim recovery, capped retries, and explicit dead letters.
- Reserve capacity for newly observed games so historical catch-up cannot starve live intake.
- Keep historical catch-up in a separate quota lane over the same canonical state.
- Coalesce repeated app changes while preserving every source batch that referenced the app.
- Record terminal `source_blocked`, inaccessible, unsupported, or invalid states instead of retrying forever.

### Latest-State Promotion

For each app:

1. archive or stage the source payload;
2. validate whether each field and relationship family is present and complete;
3. compute a normalized snapshot and content hash;
4. atomically update all PICS-owned latest-state fields and complete relationship families;
5. preserve prior fields or relationships for missing or partial families;
6. emit change events from the committed before/after state;
7. update PICS readiness and sync status; and
8. acknowledge the durable work item.

An explicitly complete empty relationship family may clear prior edges. An absent or ambiguous family may not.

### Cutover

1. Capture the current PICS cursor, health, and relevant relationship baselines.
2. Capture a historical response from the frozen cursor into a uniquely named
   shadow stream. Steam accepts a starting change number but no ending change
   number, so persist the complete returned response and derive the bounded
   comparison interval from each app entry's change number. Do not claim the
   skipped interval was reconstructed if Steam returns force-full signals, an
   echoed-cursor mismatch, or retention-limited evidence.
3. Compare app IDs, normalized hashes, relationships, events, errors, and final cursor.
4. Run `PICS_WORK_MODE=shadow` until parity and restart tests pass.
5. Use a short maintenance window to stop the legacy monitor.
6. Confirm that no unrecorded in-memory work remains.
7. Set `PICS_WORK_MODE=durable` and start one leader plus bounded consumers.
8. Restarting PICS is safe only after the cursor snapshot or durable path exists.

If the new path fails, stop it at the last committed batch. Do not make the in-memory monitor primary again.

### Backfill

- Prioritize newly observed games, near-release games, and existing site dependencies.
- Then drain the never-synced catalog with bounded quotas.
- Preserve already populated PICS data unless a complete newer payload justifies a change.
- Classify every syncable app as `ready`, `source_blocked`, or another documented terminal state.

### Exit Gate

Phase 2 is complete only when:

- forced restarts produce no cursor or batch-item gaps;
- the bounded comparison has exact ordered app-entry, item-change-number,
  force-flag, and cursor parity;
- new-game PICS work is not starved by catch-up;
- every relationship removal has archived complete-source evidence;
- dead letters have explicit causes and operator actions; and
- backlog age and source freshness remain healthy for three daily cycles.

## Phase 3: Normalize Readiness, Changes, and Metric Inputs

### Source Readiness

Track these independently:

- catalog observation;
- storefront metadata;
- PICS taxonomy and relationships;
- review and CCU market metrics;
- creator evidence; and
- overall latest-state freshness.

Each source state must include status, source time, processed time, schema or calculation version, blocking reason, retryability, and provenance. `catalog_seed_state` is not a readiness input.

The validated v1 policy uses `catalog`, `storefront`, and `pics` as the only
requirements for `overall`. Market metrics and creator evidence remain
independent states so sparse observations cannot block core source readiness.
The current-row signal-window contract is recomputable; raw daily metrics
retain history. First-observed and release-state transitions use the separate
`events.app_lifecycle_events` stream and do not write synthetic rows into the
existing raw Change Feed stream.

### Normalized Events

- Keep all existing raw snapshots and raw change events.
- Add normalized first-observed and release-state-transition events.
- An initial snapshot establishes state; it does not emit a separate change for every populated field.
- Event writes use stable source-derived idempotency keys.
- Existing history is not rewritten merely to match the new taxonomy.

### Change Event Registry

Add a versioned `events.change_event_registry` containing:

- raw event type;
- source;
- signal family;
- user-facing label;
- compatibility story kind;
- whether the type affects readiness or eligibility inputs;
- default unknown behavior;
- registry version; and
- activation and deprecation metadata.

Ingestion, materialization, the query API, Change Feed, and chat must validate against the same registry version. Unknown types remain visible as `unknown`, increment an operational health signal, and never silently default to `storefront`.

### Versioned Signal Windows

Add an additive `metrics.app_signal_windows_v1` contract for:

- calendar-aligned 7-day and 30-day review changes;
- calendar-aligned CCU windows;
- observation coverage and missing-day counts;
- source and calculation timestamps;
- calculation version; and
- confidence or incomplete-coverage state.

Existing page, chat, report, and alert fields keep their current meanings. The preparation contract is published beside them.

### Explicit Exclusions

This phase does not implement:

- opportunity materiality;
- eligibility rules;
- ranking;
- comparable cohorts;
- market-potential bands;
- preset health; or
- preset recommendations.

### Exit Gate

Phase 3 is complete when current source readiness is explainable, every observed event type is registered or explicitly unknown, release transitions are reproducible, and signal windows pass boundary and missing-data tests without changing legacy consumers.

## Phase 4: Repair Existing Data Consumers Safely

### Apps

1. Add a dedicated, fail-closed Tiger refresh workflow for the existing
   projection. Keep its schedule disabled until a manually approved refresh
   passes row-count, duration, lock, and route checks.
2. Once enabled, keep the existing projection's maximum source age within
   eight hours while the versioned replacement is developed.
3. Build `metrics.apps_page_projection_v2` beside the existing projection.
4. Populate it from current Tiger source tables and versioned calculations.
5. Compare row presence, filters, sorting, pagination, aggregates, and representative app values.
6. Add `APP_PROJECTION_VERSION=legacy|v2`.
7. Switch `/apps`, its APIs, and app-detail dependencies in a maintenance window.
8. Keep the original projection populated and available throughout preparation.

### Unreleased

- Preserve existing response, filter, sort, export, detail, and timeline behavior.
- Continue using the current projection while it is healthy.
- Treat `latest_added_at` only according to its existing UI contract.
- Do not expose it as durable first observation or opportunity newness.

### Insights

- Replace stale Supabase product and metric reads with Tiger/query-API contracts.
- Preserve the current UI, URL parameters, tabs, result shapes, empty states, and error behavior.
- Values are allowed to become fresher; every semantic difference must be tied to documented source provenance rather than hidden shape changes.

### Dashboard and Admin

- Move catalog counts, job health, queue state, PICS health, source completion, and freshness to Tiger operational contracts.
- Keep Supabase authentication identity and session behavior unchanged.
- Move roles, waitlist, credits, pins, alerts, account controls, and other non-auth state to versioned Tiger/query-API contracts through separately approved, reconciled cutovers.
- Make the current Tiger PICS stall and future cursor gaps visible to administrators.

### Change Feed and Chat

- Compare current and registry-backed type, family, label, and story-kind output.
- Cut over only after event-count and response-shape parity.
- Preserve raw unknown events instead of misclassifying them.
- Keep current authentication, chat credit, logging, entity-link, and pagination behavior.

### Pins and Legacy Alerts

- Do not change their tables, thresholds, baselines, deduplication, or delivery behavior.
- Do not write preparation events into `user_alerts`.
- Shadow any shared metric-cadence change and compare legacy alert volume before enabling it.

### Semantic Parity Standard

For a consumer moving away from a stale source:

- authentication, authorization, response shape, filtering, sorting, pagination, navigation, empty states, and error states must remain compatible;
- exact values may change when Tiger is demonstrably fresher;
- every intentional difference must be documented with source and calculation provenance; and
- unexplained omissions, additions, or count changes block cutover.

### Exit Gate

Every current user path must pass its contract and browser checks against the intended live source before Phase 4 is complete.

## Phase 5: Add Operational Controls and Execute Staged Cutovers

### Required Modes

| Mode                              | Values                        | Purpose                                                                                |
| --------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `CATALOG_OBSERVATION_MODE`        | `off`, `shadow`, `primary`    | Controls durable catalog observation without changing the daily safety reconciliation. |
| `PICS_WORK_MODE`                  | `legacy`, `shadow`, `durable` | Separates parity testing from the durable PICS cutover.                                |
| `APP_PROJECTION_VERSION`          | `legacy`, `v2`                | Makes Apps read rollback immediate and non-destructive.                                |
| Existing per-surface read targets | Existing supported values     | Gate Insights, admin-health, and Change Feed cutovers independently.                   |

Unknown values must fail closed at startup rather than silently choosing a writer or reader.

### Source Health Contract

Operational health must expose:

- latest received and committed source cursor;
- cursor lag;
- batch and work-item count reconciliation;
- pending, claimed, retrying, and dead-letter counts;
- oldest pending and readiness age;
- new-game and catch-up lane depth;
- catalog reconciliation gaps;
- PICS and storefront readiness coverage;
- projection row count and freshness;
- latest event time by source;
- unknown event types; and
- last successful full verification.

### Cutover Procedure

For each writer or reader:

1. capture a fresh baseline;
2. pause only the affected workers;
3. apply the separately approved additive migration or deployment;
4. backfill and reconcile;
5. switch one writer or reader;
6. run database, API, route, and latency checks;
7. resume workers; and
8. observe three healthy daily cycles before advancing.

### Rollback

- Reader rollback changes only its feature flag.
- Writer rollback pauses at the last durable cursor.
- New and legacy records remain intact.
- Any in-place repair uses the Phase 0 snapshot to restore exact affected keys.
- No rollback procedure includes `DROP`, `TRUNCATE`, broad `DELETE`, or destructive repository commands.

### Exit Gate

Every primary mode must have a tested, documented, non-destructive rollback and three healthy cycles of operating evidence.

## Phase 6: Produce the Tracker-Readiness Handoff

Publish:

1. the final source-ownership matrix;
2. approved schemas and data dictionaries;
3. readiness states and transition rules;
4. the active event registry and unknown-type policy;
5. signal-window definitions and coverage rules;
6. worker topology and runtime placement;
7. monitoring dashboards and alerts;
8. backfill and reconciliation status;
9. maintenance, restart, and rollback runbooks;
10. route and API regression results;
11. unresolved Steam, PICS, YouTube, SteamSpy, or coverage limitations; and
12. the exact durable contracts available to the future opportunity tracker.

The handoff must explicitly confirm that preparation created none of the excluded opportunity product objects.

### Final Exit Gate

Tracker implementation may begin only when:

- Phases 0-5 have passed;
- newly observed games reach an explicit source-readiness outcome without cursor loss;
- current site paths use a current, documented source or an explicitly retained legacy source;
- all preservation and regression checks pass;
- rollback remains possible without deleting data; and
- remaining limitations are product calibrations rather than unresolved ingestion integrity failures.

## Interfaces and Compatibility

### Internal Types

Preparation introduces internal contracts for:

- catalog scan and reconciliation runs;
- first observations and catalog state;
- PICS change batches and contained app IDs;
- durable work claims and terminal outcomes;
- per-source app readiness;
- registered change event definitions;
- normalized release transitions;
- versioned review and CCU signal windows; and
- source-health summaries.

These types are infrastructure contracts. They must not include opportunity-profile, ranking, or delivery semantics.

### Query API

Add query-API contracts only where required to:

- preserve the current Insights response behavior on Tiger data;
- expose Tiger-backed product and ingestion health to the dashboard and admin surfaces; or
- keep Change Feed and chat interpretation consistent with the central registry.

Existing browser-facing response shapes should be adapted server-side. The UI must not coordinate Tiger and Supabase writes.

### Compatibility Guarantees

- Existing public and protected routes remain available.
- Unauthenticated protected routes retain the `?next=` redirect contract.
- API routes retain authenticated `401` behavior.
- Admin paths remain role-restricted.
- Supabase authentication identity and session behavior remains authoritative.
- Existing non-auth account, pin, alert, credit, and waitlist behavior remains a compatibility contract only until its reconciled Tiger cutover.
- Existing report URLs and underlying field meanings remain stable unless a separate report migration is approved.

## Verification Plan

### Unit Tests

Cover:

- catalog idempotency and stable first observation;
- cursor advancement conditions;
- batch count reconciliation;
- PICS lease, retry, and stale-claim recovery;
- partial versus complete relationship families;
- normalized snapshot hashing;
- release transitions;
- event-registry mappings and unknown handling;
- readiness transitions;
- calendar window boundaries, leap days, missing days, and late observations; and
- configuration-mode validation.

### Integration and Failure-Injection Tests

Terminate workers:

- after source receipt but before batch insert;
- after batch insert but before work upsert;
- before and after cursor advancement;
- during PICS latest-state promotion;
- after latest-state commit but before work acknowledgement; and
- during projection refresh or reader cutover.

Every scenario must replay without losing a source ID, duplicating a first observation, corrupting a relationship set, or advancing past uncommitted work.

### Database Preservation Checks

Before and after each stage:

- existing primary-key sets cannot shrink unexpectedly;
- append-only history row counts and maximum IDs cannot move backward;
- all received source IDs are durable or have a recorded rejection;
- every relationship removal maps to a complete archived source payload;
- Supabase Auth identities and legacy non-auth records remain unchanged until an approved migration proves one-to-one reconciliation and rollback;
- repaired current-state rows match their approved source payload; and
- R2 references resolve to the expected content hash.

### Route and API Matrix

Expand Playwright coverage beyond the current Chat smoke test to cover:

- landing, login, waitlist, and protected-route redirects;
- dashboard navigation;
- Apps filters, pagination, sparklines, comparison, and app details;
- Companies, publisher, and developer lists and details;
- Unreleased filters, export, details, and timelines;
- Insights tabs and pinned-item behavior;
- Change Feed list, filters, activity details, and status;
- Chat entity links and change-intel responses;
- YouTube list and inspector flows;
- pin creation, update, and removal;
- alert list, read state, preferences, and counts;
- account display and sign-out;
- admin authorization and product-health panels; and
- existing API response schemas and unauthorized behavior.

### Performance and Acceptance

- No unexpected `5xx` response is allowed.
- Existing API shapes remain compatible.
- No unexplained filter, pagination, or count difference is allowed.
- Core-route median and p95 response time may not regress more than 25% from the fresh Phase 0 baseline.
- Fresher values replacing stale values are accepted only with documented source provenance.

### Required Commands

Run, as applicable:

```bash
pnpm build
pnpm check-types
pnpm test
pnpm --filter @publisheriq/ingestion test:change-intel
pnpm tiger:ingestion-verify
pnpm supabase:writer-audit
pnpm test:e2e
```

Run the complete PICS pytest suite from `services/pics-service` using its documented environment.

No primary writer or reader switch proceeds while its relevant command, preservation check, parity check, or route smoke test is failing.

## Runtime and Cost Assumptions

- Short coordinated maintenance windows are acceptable because the site is not currently in active use.
- Standard GitHub-hosted runners for the public repository remain the default for bounded catalog scans, reconciliation, broad sweeps, backfills, projection rebuilds, and verification.
- Railway is used where continuous runtime, a singleton PICS connection, durable queue draining, or bounded background consumers require it.
- The existing adaptive demo CCU collector already runs continuously on Railway;
  runtime inventories and cost estimates must include it.
- Moving bounded work to Railway is not justified by GitHub runner savings.
- Railway service restarts are reversible operator actions, but a PICS restart must still respect the durable-cursor rules in Phase 2.

## Definition of Prepared

PublisherIQ is prepared to implement the daily opportunity tracker when its catalog, storefront, PICS, event, and metric inputs are durable and explainable; current site consumers are current or deliberately retained; every relevant route passes regression checks; source work can replay after failure; and all existing data remains present or demonstrably restorable.

Preparation is not completion of the opportunity product. It is the point at which that product can be built without inheriting known data-loss windows, stale monitoring, misleading newness, or hidden regressions across the existing site.
