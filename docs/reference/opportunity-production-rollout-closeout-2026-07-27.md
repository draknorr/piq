# Opportunity production rollout closeout — July 27, 2026

This note records the production state of the Custom Daily Steam Opportunity
Brief after the explicitly approved rollout. It separates completed rollout
and rule-evaluation evidence from the remaining source-provenance acceptance
check. Live email and Slack dispatch are not an acceptance requirement for
this environment because no test destinations are configured.

## Change and deployment ledger

| Change                                | Evidence                                          |
| ------------------------------------- | ------------------------------------------------- |
| Feature implementation                | PR #86, merged                                    |
| Bootstrap SQL parameter repair        | PR #87, merge `a5d3716`                           |
| Material-event queue parameter repair | PR #88, merge `d7f575d`                           |
| Lease-safe bounded materialization    | PR #89, merge `e33b22b`                           |
| Production rollout documentation      | PR #90, merge `4b04fb1`                           |
| Source timestamp propagation          | PR #91, merge `13e327a`                           |
| Opportunity worker deployment         | `aaf1f358-7a61-4c50-8262-2f3e121734f8`, `SUCCESS` |
| Query API implementation deployment   | `389505f1-8302-47fc-8501-a58a0e113d1c`, `SUCCESS` |
| Query API source-timestamp deployment | `d8474a1f-3002-43f6-97dc-b8c69d7a9cc8`, `SUCCESS` |
| Query API health                      | Tiger-backed `/healthz` returned `{"ok":true}`    |
| Worker topology                       | one production replica                            |

Both current service deployments identify merge `13e327a`. The worker started
cleanly, scheduled one item, and completed its first claimed work with zero
deliveries. The query API passed its Railway health gate and a direct
Tiger-backed `/healthz` check.

## Applied production state

- `0097_opportunity_mvp.sql` and `0098_opportunity_preset_seed.sql` are applied.
- Workspace:
  `f80bdd3a-7185-4f00-a9ee-48b80439acb1`
- Profile:
  `a77e184d-8215-4558-b815-f79123776fc4`
- Profile source: Roguelike Deckbuilder preset
- Profile state: enabled
- Timezone and cadence: `America/Los_Angeles`, 09:00 local
- Immediate full match: disabled
- External channel preferences: 0
- Deliveries in any state: 0

Authenticated production smoke completed bootstrap, preset clone/profile
creation, preview, enable, pause, resume, and two successful daily run records.
Both initial daily runs preceded material-event recovery and correctly produced
zero results. A later explicitly approved schedule update triggered the first
non-empty daily run; the profile automatically returned to its next 09:00 local
schedule afterward.

## Production rule evaluation

The authenticated production profile editor loaded profile version 3 with:

- one required `ALL` group: tags contain `Roguelike` and tags contain
  `Deckbuilding`;
- a high-weight preferred group for a playable demo;
- a medium-weight preferred group for publisher game count at or below 10;
- an adult-content exclusion; and
- the configured material-event reappearance families.

The production `Preview profile` action ran through the same tri-state rule
engine as the worker. It returned 25 current full matches across 177,074 games.
The required tags were available for 2% of the catalog; unknown required
taxonomy remained pending rather than being treated as false. Representative
matches included Epic Auto Towers, Wireworks, Dice Gun Commando, Dice A Million,
Slay the Spire 2, and Apokerlypse.

This proves the browser-authenticated profile contract, required `ALL` rule,
readiness behavior, and shared preview evaluator against production Tiger data.
The daily event-to-result integration evidence is recorded below.

## First non-empty production daily run

The user explicitly approved exactly one update to enabled profile
`a77e184d-8215-4558-b815-f79123776fc4`:
`next_evaluation_at = now()`. One row changed. The scheduler claimed work item
`1274`, and daily run `b37b7f77-3e42-4bce-a555-123b1af114c3` completed at
`2026-07-27T22:34:30.926033Z`.

| Measure                       | Count |
| ----------------------------- | ----: |
| Candidate material events     |   171 |
| Evaluated candidates          |   171 |
| Canonical ranked results      |     3 |
| Pending for missing readiness |   168 |
| Suppressed results            |     0 |
| Duplicate results             |     0 |

All 168 pending candidates were missing the required `tags` field. The three
results correctly matched both required tags:

| Rank | App                                    | Score | Event                | Preference evidence   |
| ---: | -------------------------------------- | ----: | -------------------- | --------------------- |
|    1 | Frostrain 2 (`3690490`)                | 79.55 | platform expanded    | demo; small publisher |
|    2 | 2 Fights in 2 Tight Spaces (`3734890`) | 68.30 | platform expanded    | none                  |
|    3 | Toads of the Bayou (`2190400`)         | 62.60 | material build event | demo                  |

Each result is high confidence, uses a 50-game released-peer cohort with full
core-measurement coverage, labels the market conservatively as
limited/high-confidence, persists missing-evidence fields, and identifies the
rules, cohort, market, ranking, signal, and materiality calculation versions.
This proves the required profile rules and daily evaluation pipeline on
production data.

The run also exposed one provenance defect: `legacy.apps`,
`steam_storefront`, and `steam_pics` source timestamps were null even when
Tiger readiness rows contained authoritative `source_at` values. The shared
repository query discarded those timestamps before evaluation. The contained
repair in PR #91 joins/selects the readiness timestamps and has
repository/worker regression coverage. The three original results remain
immutable.

After deployment, the merged repository path was run read only against the
three production apps:

| App       | Catalog                    | Storefront                   | PICS                       |
| --------- | -------------------------- | ---------------------------- | -------------------------- |
| `2190400` | `2026-07-27T04:04:43.827Z` | `2026-07-26T17:01:51.820Z`   | `2026-07-27T20:35:35.886Z` |
| `3690490` | `2026-07-27T11:36:16.366Z` | `2026-07-27T11:39:00.832Z`   | `2026-07-27T20:31:16.500Z` |
| `3734890` | `2026-07-27T04:04:43.827Z` | no row; remains unknown/null | `2026-07-27T20:31:11.702Z` |

This proves the deployed rule-input contract uses real Tiger provenance and
does not invent a storefront timestamp when the source row is absent.

## Material-event recovery

The first production worker exposed PostgreSQL parameter inference failures.
PR #88 added explicit target casts. Work item 495 then committed 2,853 material
events with 2,853 distinct fingerprints and advanced the cursor, proving the
repair.

That batch also exposed a lease mismatch:

- claimed: `2026-07-27T20:19:27.870514Z`
- completed: `2026-07-27T20:36:45.225481Z`
- elapsed: `17m17.354967s`
- queue lease: `5m`
- expired before commit: `12m17.354967s`

PR #89 bounded each pass to 100 catalog, 100 lifecycle, and 500 raw source
rows, added a progress heartbeat every 50 moments, and limited one worker pass
to one global materialization trigger.

Post-deploy read-only evidence:

| Pass   | Queue item |       Duration | Cursor movement                      | Events |    Uniqueness |
| ------ | ---------: | -------------: | ------------------------------------ | -----: | ------------: |
| First  |          1 | `2m21.098803s` | catalog +18, lifecycle +23, raw +500 |   +350 | 5,900 / 5,900 |
| Second |          5 | `2m18.639550s` | raw +500                             |   +323 | 6,223 / 6,223 |

During both passes, `heartbeat_at` advanced and `claim_expires_at` returned to
nearly five minutes. The worker claimed one new materialization row at a time.
Cursor and event counts remained unchanged while each transaction was open,
then advanced atomically at commit.

At `2026-07-27T22:55:09.831039Z`, catalog and lifecycle cursors exactly matched
their source heads (`176352` and `613`). The raw cursor was
`1000001048164`, only 15 IDs behind the then-current moving source head
`1000001048179`. Recent opportunity queue state contained only completed daily,
materialization, and readiness work.

Completed rows retain historical error fields from earlier attempts. Their
`completed` state and completion timestamp are authoritative.

## Validation ledger

The production merge and closeout retained:

- GitHub CI build, typecheck, tests, browser smoke, and lint: green
- Vercel deployment check: green
- repository `pnpm build`: 10/10 tasks
- repository `pnpm check-types`: 13/13 tasks
- repository `pnpm test`: 10/10 tasks
- repository `pnpm lint`: zero errors; existing warnings remain
- data-plane: 156/156 tests, including source-provenance regressions
- query API: 24/24 tests
- change-intelligence: 46/46 tests
- PICS Python 3.11: 130/130 tests
- Playwright: 5/5 tests
- strict Supabase writer audit: zero scheduled blockers
- live Tiger ingestion verification: all core source/freshness checks passed

The live verifier still reports the pre-existing empty
`ops.alert_detection_state` freshness warning, an unregistered
`ccu-demo-tiered-sync.yml` static warning, and optional Railway-variable checks
when not requested. These are not opportunity rollout failures.

The source-provenance repair adds two regression tests. Its validation reran
the complete repository build (10/10 tasks), type-check (13/13), test (10/10),
and lint (14/14) plus the data-plane ESM/declaration build. Lint retained only
pre-existing warnings and zero errors.

## Remaining acceptance evidence

The remaining production acceptance focus is:

1. allow the next normal 09:00 America/Los_Angeles schedule to create a new
   qualifying immutable result (or use a separately approved trigger if
   natural traffic does not produce one); and
2. verify the newly persisted record exposes the already-proven
   catalog/storefront/PICS input timestamps.

The authenticated website replayed dispatch `b37b7f77` with all three results.
The Frostrain 2 record replayed the matching rule outcomes, decomposed rank,
50-game cohort, market context, event ledger, calculation versions,
missing-evidence state, and delivery history. Its null source timestamps remain
visible as expected for immutable pre-fix evidence.

Track, dismiss, ignore, restore, shared viewed/researching activity, delayed
readiness, event-driven reappearance, and delivery idempotency retain their
automated test coverage. They are not prerequisites for this production smoke.

The user explicitly accepted omitting live email and Slack dispatch because no
test email recipient or Slack webhook is configured. No external destination
will be invented or inferred. Delivery remains unconfigured until the user
provides or designates those targets.

## Rollback

Routine rollback is reversible service cutback:

1. redeploy the worker and query API from `d7f575d`;
2. leave the additive opportunity schema, cursor, events, runs, results, and
   audit evidence intact;
3. inspect active claims and delivery rows read only; and
4. let any interrupted materialization transaction roll back so its unchanged
   cursor range is replayed.

Dropping the schema, deleting queue rows, or rewriting production evidence is
not part of routine rollback and requires a separate destructive-change
review.
