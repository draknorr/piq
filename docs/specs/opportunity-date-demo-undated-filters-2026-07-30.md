# Opportunity Date, Demo-Only, and Undated Filters

Status: implemented and verified in
`codex/opportunity-date-demo-filters`

Captured: July 30, 2026 America/Los_Angeles / July 31, 2026 UTC

Database access: read-only TigerData transactions only

## Objective

Add trustworthy date, demo-only, and undated-unreleased filters to the
Opportunity Tracker at `/opportunities` while preserving immutable saved
profile and preset versions. Preview SQL and daily worker evaluation must
produce the same eligibility result.

No production database write or schema application was performed during this
research. The application rollout is handled separately from the read-only
validation recorded here.

## Current rule path

The current end-to-end path is:

1. `apps/admin/src/app/(main)/opportunities/ProfileBuilder.tsx`
   constructs `opportunity-rules/v1` JSON. It exposes release state,
   `is_released`, days until release, and linked-demo availability. It does not
   expose release date, app type, or a demo-only classification.
2. `apps/admin/src/app/(main)/opportunities/lib/types.ts` mirrors the
   data-plane rule contract. `lib/api.ts` posts the request to the admin proxy.
3. `apps/admin/src/app/api/opportunities/[operation]/route.ts` authenticates
   with Supabase and forwards the body to query-api.
4. `apps/query-api/src/opportunity-routes.ts` accepts preview, create, clone,
   get, save, and status operations and delegates to `OpportunityService`.
5. `packages/data-plane/src/opportunity/rules.ts` validates v1 rules and
   evaluates them in memory with three-state outcomes.
6. `packages/data-plane/src/opportunity/sql-compiler.ts` compiles the same
   clauses for preview and preset-health SQL.
7. `packages/data-plane/src/opportunity/repository.ts` loads rule inputs from
   Tiger sources, persists the versioned rule-input projection, clones
   immutable preset rules, and inserts immutable profile versions.
8. `packages/data-plane/src/opportunity/worker-repository.ts` loads enabled
   profile versions and material events. `worker.ts` evaluates the loaded rule
   inputs and persists candidate state, results, evidence, and provenance.
9. Preset health reuses the SQL compiler and repository input mapper, but
   explicitly selects released games.

### Verified parity defects

- In-memory numeric comparisons call `Number(value)`. `Number(null)` is zero,
  so a known-null numeric/date value can accidentally pass a comparison.
- In-memory release-date values are ISO strings, but generic comparison
  operators only perform numeric comparisons.
- SQL marks `release_date` known only when it is non-null. Therefore
  `release_date not_exists` can never match in preview SQL, while the worker
  represents a ready storefront with a null release date as a known null and
  matches `not_exists`.
- The preview and preset-health candidate universe uses the case-sensitive
  predicate `a.type = 'game'`. Daily worker material-event selection has no app
  type predicate, so it evaluates demos, DLC, applications, and other product
  types.
- `has_demo` is derived from `legacy.app_demos`, which is a Storefront-created
  relationship, but rule-input readiness currently assigns it to PICS.

## Date-source inventory

| Field                                          | Type          | Meaning                                                                      | Product use                                                 |
| ---------------------------------------------- | ------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `legacy.apps.release_date`                     | `date`        | Parsed Steam Storefront launch date                                          | Authoritative launch-date filter                            |
| `legacy.apps.release_date_raw`                 | `text`        | Steam's unparsed date wording                                                | Explanation only; not a comparison clock                    |
| `ops.app_catalog_state.first_observed_at`      | `timestamptz` | Immutable time PublisherIQ's durable catalog observer first recorded the app | “Added to PublisherIQ,” only for genuinely new observations |
| `ops.app_catalog_state.first_observation_kind` | `text`        | `new` or `baseline`                                                          | Exclude baseline imports from “recently added” semantics    |
| `legacy.apps.created_at`                       | `timestamptz` | Time the PublisherIQ app row was inserted                                    | Legacy/bootstrap provenance; not Steam page creation        |
| `legacy.apps.last_seen_in_steam_applist_at`    | `timestamptz` | Latest AppList reconciliation observation                                    | Freshness only; unsafe as a first-seen date                 |
| `legacy.apps.updated_at`                       | `timestamptz` | Mutable ingestion update time                                                | Freshness only                                              |
| `legacy.apps.store_asset_mtime`                | `date`        | Store asset modification date                                                | Change evidence, not catalog discovery                      |
| `legacy.apps.last_content_update`              | `timestamptz` | PICS content/build update                                                    | Change evidence, not catalog discovery                      |

`metrics.unreleased_games_projection.latest_added_at` is
`COALESCE(last_seen_in_steam_applist_at, created_at)`. Full AppList refreshes
make much of the catalog appear recent, so it must not be used by opportunity
profiles.

### Live date coverage

The read-only snapshot contained:

- approximately 151.7k lowercase `game` records;
- 99,370 released lowercase games;
- 13,782 unreleased lowercase games with an exact date;
- 38,385 unreleased lowercase games with no exact date;
- 2,575 storefront-ready, unreleased lowercase games with no exact date;
- for those 2,575 ready games, 1,719 had raw text `Coming soon`, 854 had
  `To be announced`, and 2 had blank raw text.

The durable catalog ledger contained 147,064 game rows:

- 975 genuinely new game observations;
- 146,089 baseline observations;
- baseline timestamps cluster around the July 24, 2026 ledger bootstrap.

Therefore the honest product label is **Added to PublisherIQ**, not “Steam page
created.” Relative added-date rules must require
`first_observation_kind = 'new'`. Baseline rows are unavailable for this
filter, not recently added on the bootstrap date.

### Active indexes and plans

The active database has:

- `idx_legacy_apps_release_date_desc` on `legacy.apps.release_date`;
- `idx_ops_app_catalog_state_first_observed` on
  `(first_observed_at DESC, appid DESC)`;
- parent and child indexes on `legacy.app_demos`;
- source/status and primary-key indexes on `ops.app_data_readiness`.

Representative bounded `EXPLAIN (ANALYZE, BUFFERS)` executions were:

| Shape                                                                           | Execution time |
| ------------------------------------------------------------------------------- | -------------: |
| July 2026 launch-date range, 100 rows                                           |        15.7 ms |
| New catalog observations in a seven-day UTC range, 100 rows                     |        0.65 ms |
| Ready, unreleased, exact date absent, 100 rows                                  |        46.2 ms |
| Ready, unreleased, non-purchasable canonical games with a linked demo, 100 rows |       189.2 ms |

All four used existing indexes. No new index or schema object is justified by
the measured plans.

## Demo inventory

Steam app types are not normalized in the live legacy table. Both `game` and
`Game`, and both `demo` and `Demo`, occur.

Using case-insensitive type classification:

- 23,318 demo app records exist;
- 21,804 demo records resolve through `legacy.app_demos` to a game parent;
- 1,514 demo records have no resolvable game parent;
- 21,811 distinct canonical game parents have a linked demo;
- 21,806 of those parents are usable/non-delisted;
- 7,474 linked canonical parents are unreleased;
- 7,467 are unreleased and explicitly have no purchase package.

Canonical parents have substantially better sourcing data than demo rows:

- 20,872 of 21,806 usable parents have tags;
- 21,761 have a publisher and 21,799 have a developer;
- all 7,467 unreleased/non-purchasable parents have a developer and 7,459
  have a publisher.

Standalone demo records have weak positioning/readiness coverage and can
duplicate their parent game. The current worker has already produced 52 demo
results and 17 DLC results because worker candidate selection is broader than
preview SQL.

## Product decisions

### “Only Demo”

1. **Selected: canonical game whose demo is the currently playable Steam
   product.** Require a linked demo, `is_released = false`, and
   `has_purchase_packages = false`, with all three facts confirmed from a ready
   Storefront source. Live population: 7,467.
2. **Any canonical game with a linked demo.** Live population: 21,806. This
   duplicates the current “Has playable demo” criterion and does not make
   “only” meaningful.
3. **Standalone Steam demo apps.** Live population: 23,318, including 1,514
   unresolved demo apps. This materially widens the opportunity entity model,
   weakens evidence coverage, and creates parent/demo duplicates.

### Canonical game universe

1. **Selected: case-insensitive canonical games only.** Treat `game` and
   `Game` as games in preview, preset health, and the worker. Do not create new
   demo/DLC opportunity results. This adds about 32.2k valid uppercase `Game`
   records to preview while removing non-game worker drift.
2. **Preserve lowercase-only preview.** Apply the same exact lowercase filter
   in the worker. This restores parity but excludes about 32.2k valid game
   records and would stop future results for that population.

The user selected option 1 for both decisions on July 30, 2026.

## Implemented date architecture

### Contract compatibility

Publish `opportunity-rules/v2` for typed date operands and keep the v1 reader,
compiler, evaluator, profile loader, and preset cloning path. Existing v1 JSON,
profile versions, and preset versions remain immutable. Editing an old profile
creates a new v2 profile version; it does not rewrite history.

Suggested date operands:

```json
{ "kind": "absolute_date", "date": "2026-08-15" }
```

```json
{ "kind": "relative_window", "window": "next_30_days" }
```

Relative windows remain symbolic in saved JSON and are resolved at preview or
worker evaluation time.

### Date semantics

- Profile timezone is sent in preview requests and loaded with enabled worker
  profiles.
- Preview captures one `asOf` instant and uses it for both SQL compilation and
  in-memory representative evaluation.
- Worker evaluation uses the run's `windowEnd` as its `asOf` instant.
- Weeks start Monday using ISO week semantics.
- Release dates are calendar dates in the profile timezone:
  - after/before are exclusive;
  - on is exact;
  - on-or-after/on-or-before are inclusive.
- Added timestamps use local calendar boundaries converted once to UTC
  parameters. SQL compares the indexed timestamp directly and never applies a
  timezone function to every row.
- `today` is the current local calendar date.
- `last_7_days` and `last_30_days` include today.
- `next_7_days` and `next_30_days` start tomorrow, avoiding overlap with
  `today`.
- DST tests must prove that added-date UTC ranges may be 23 or 25 hours while
  still representing one local calendar day.

### Known absence versus unavailable source

- Storefront ready plus `release_date = null` is a **known absence**.
  `not_exists` matches and `exists` does not.
- Storefront not ready is **unknown**. Required rules remain pending.
- Baseline catalog observation is **unknown** for “Added to PublisherIQ,”
  because the true first-seen date predates the durable observer.
- Numeric and date comparisons against null return unknown and never coerce
  null to zero.

### Source and projection path

- Preview SQL joins `ops.app_catalog_state` only when an added-date rule is
  present.
- Worker rule inputs include the observation timestamp and kind in
  `opportunity-rule-input-projection/v2`.
- The existing projection table stores the new projection version alongside
  v1; no migration or historical rewrite is required.
- A shared date-boundary resolver supplies both SQL parameters and in-memory
  comparisons.

### Relative-date daily evaluation

Relative windows can change eligibility without a Steam event. At the existing
daily profile schedule, compare the current and prior local-day compiled match
sets and reevaluate their bounded symmetric difference. Use an ephemeral
date-window evaluation trigger with no fabricated Steam event. Do not run this
catalog comparison for absolute-only profiles or more often than the existing
daily schedule.

### Undated unreleased shortcut

Add an obvious **Unreleased — date TBD** shortcut to the profile builder. It
emits one required `all` group containing:

```json
[
  { "field": "is_released", "operator": "equals", "value": false },
  { "field": "release_date", "operator": "not_exists" }
]
```

This is preferable to a new derived rule field because the saved meaning stays
explicit, composable, and backward-readable. No preset mutation is required.

## Implementation summary

- `opportunity-rules/v2` adds typed absolute dates, symbolic relative windows,
  `in_window`, `publisheriq_added_at`, and `demo_only`; the evaluator and
  compiler continue to accept immutable v1 rules.
- New and edited builder rules use v2. Editing a v1 profile creates a new v2
  version. Profile-version inserts explicitly persist the rule schema version.
- Preview captures one instant, receives the profile timezone, and uses the
  same context for SQL and representative in-memory evaluation.
- Release dates use date-only comparisons. Added timestamps use precomputed UTC
  parameters for local-day boundaries. Weeks start Monday.
- Storefront-ready null launch dates are known absence. Baseline catalog
  observations remain unknown for the added-date field.
- `demo_only` is true only for a canonical game with a linked demo,
  `is_released = false`, and `has_purchase_packages = false`, with Storefront
  truth ready.
- Preview, preset health, worker event selection, and rule-input selection all
  use case-insensitive canonical `game` classification and exclude delisted
  rows.
- Daily runs compare current and prior-local-day match sets only for profiles
  containing relative windows. The bounded symmetric difference is evaluated
  through a nullable ephemeral trigger; no Steam material-event row is
  fabricated.
- The existing rule-input projection table stores
  `opportunity-rule-input-projection/v2` beside v1. No migration or index was
  added.
- The builder exposes launch date, added date, date-specific operators and
  windows, Only Demo, and Unreleased date TBD.

## Verification evidence

- Data-plane type-check and build pass.
- All 130 Opportunity data-plane tests pass, including new date, DST,
  null/unknown, v1 compatibility, v2 persistence, SQL compilation, canonical
  worker universe, daily relative-window, and worker-timezone coverage.
- Query-api type-check passes. All 26 query-api tests pass; the opportunity
  route has explicit v2 date/timezone forwarding coverage.
- All 268 admin tests pass, including the focused rule-builder tests. ESLint
  passes for all changed admin Opportunity files. The Opportunities files
  produce no TypeScript errors; the repository-wide admin check still reports
  unrelated pre-existing chat/config test errors.
- Data-plane ESLint completes with zero errors (existing warnings remain in the
  unrelated root `service.test.ts`).
- Seven production-scale synthetic benchmark repetitions preserve the exact
  output digest
  `d2cb0d80127d5555db643776f26087914cb73ad6685649e1c1075e9362019312`.
  Cold median/p95 were 216.704/260.106 ms; warm median/p95 were
  219.195/236.415 ms. Against the captured 243.098 ms cold and 207.786 ms warm
  references, every median/p95 comparison stayed within the 25% regression
  budget.
- The earlier read-only live plans remained the index justification: existing
  release-date, first-observed, and demo-relation indexes serve all new
  predicates, so no schema write was warranted.
- A production-built query-api server was load-tested locally against live
  TigerData through the real opportunity HTTP route, service, SQL compiler,
  repository queries, JSON serialization, and default 10-connection pool.
  Every database connection enforced
  `default_transaction_read_only = on`. The harness replaced external Supabase
  token verification with an in-process identity. Preview no longer calls
  `ensureWorkspace`, removing its membership update and row-lock contention
  from the production path as well.

### Live query-server load results

The load mix rotated evenly through Only Demo, Added to PublisherIQ in the last
30 days, and Unreleased date TBD. The optimized path:

- selects only joins required by the active rule fields;
- evaluates required groups, exclusions, and coverage once in a materialized
  catalog pass;
- selects bounded candidate IDs from that pass and hydrates them through the
  existing set-based input query on the same pooled connection;
- coalesces identical work only while it is in flight, without serving stale
  completed previews;
- uses the active `(type, is_released, is_delisted)` index with
  `type IN ('game', 'Game')`; a live check proved those are the only two
  case-insensitive game values;
- omits workspace provisioning from read-only preview;
- returns database timeouts as `504 OPPORTUNITY_QUERY_TIMEOUT` instead of
  misclassifying them as invalid HTTP 400 requests.

Repeated-profile before/after results:

| Concurrency | Requests | Before successes | Before p95 | After successes | After p95 | After p99 | After success throughput |
| ----------: | -------: | ---------------: | ---------: | --------------: | --------: | --------: | -----------------------: |
|           1 |        6 |              6/6 |     6.22 s |             6/6 |    0.81 s |    0.81 s |              1.355 req/s |
|           2 |       12 |            12/12 |     9.36 s |           12/12 |    1.96 s |    1.96 s |              1.471 req/s |
|           5 |       30 |            11/30 |    15.76 s |           30/30 |    2.34 s |    2.35 s |              3.297 req/s |
|          10 |       30 |            11/30 |    33.75 s |           30/30 |    2.36 s |    2.36 s |              6.280 req/s |
|          20 |       40 |            13/40 |    60.01 s |           40/40 |    3.17 s |    3.17 s |              7.531 req/s |

An adversarial matrix added a distinct indexed app-ID clause to every request,
preventing in-flight coalescing:

| Concurrency | Requests | Successes | Observed p95 | Observed p99 | Success throughput | Peak pool waiting |
| ----------: | -------: | --------: | -----------: | -----------: | -----------------: | ----------------: |
|           5 |       30 |     30/30 |       4.37 s |       4.42 s |        1.392 req/s |                 0 |
|          10 |       30 |     30/30 |       9.69 s |      10.65 s |        1.328 req/s |                 0 |
|          20 |       40 |     40/40 |      17.20 s |      19.35 s |        1.323 req/s |                10 |

The combined worst-case run enabled both distinct rules and saved-profile
history lookup: 40/40 requests succeeded at concurrency 20, p95/p99 were
16.67/20.50 seconds, catalog-query p99 was 9.70 seconds, and peak pool waiting
was 30. The server-side 15-second statement timeout was not reached. A
repeated saved-profile run at concurrency 20 completed 40/40 with 2.96-second
p95 and 7.989 successful requests/second.

These are observed sample percentiles, not production SLO percentiles. The
Node event loop remained healthy at roughly 12–15 ms p99. Live result counts
changed slightly between runs as ingestion continued; each individual run
returned stable successful results.

### Live option-enabled report smoke

A read-only live-candidate smoke passed through preview selection, the worker
evaluator, ranking/finalization, evidence construction, and delivery rendering:

| Option                    | Live candidate              |  App ID | Report evidence             |
| ------------------------- | --------------------------- | ------: | --------------------------- |
| Only Demo                 | The Way of Wrath            |  969330 | Only demo available         |
| Added in the last 30 days | Message From Aliens         | 1858720 | Added to PublisherIQ        |
| Unreleased date TBD       | Bubblez: Magic Bubble Quest |  359270 | Released; Steam launch date |

The generated “3 games to review in Daily Intelligence Desk” report included
each matched profile criterion and rendered successfully as email HTML, email
text, and Slack blocks. The deterministic report-generation test exercises the
same evaluator-to-renderer path. The smoke generated content in memory only;
it did not persist a run, enqueue a delivery, or send a message.

- The authenticated `/opportunities` runtime could not be exercised from the
  local worktree because its bootstrap request returned 401. Source inspection
  and the focused builder/API tests cover the UI and request contract without
  changing authentication or production data.

The validation did not write production data or apply a migration. The
application rollout requires no schema change.
