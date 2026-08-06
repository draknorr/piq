# Opportunity Review Priority and Opportunity UX Redesign

- Date: August 5, 2026
- Status: Implementation-ready plan; product direction approved; application/database changes unapproved
- Audience: Founder/operator, product design, and future implementers
- Scope: `/opportunities`, opportunity game records, opportunity ranking, and directly related delivery contracts

## Purpose

Produce an implementation-ready, evidence-backed plan for replacing the current generic `Opportunity Fit` score with an intent-aware review-priority system and for making opportunity cards and game records more useful to video-game publisher employees sourcing titles.

This document is the detailed requirements artifact for the accompanying Codex `/goal`. The goal should remain compact and reference this file rather than duplicating the entire specification.

This phase does **not** authorize implementation, database writes, schema application, backfills, replays, or production changes.

## Recommended Codex Goal

This goal follows OpenAI's Goal contract: outcome, verification surface, constraints, boundaries, iteration policy, and blocked stop condition.

```text
/goal Finalize an implementation-ready, evidence-backed plan for PublisherIQ's Opportunity Review Priority v2 and the related /opportunities list/detail UX, satisfying every requirement in docs/specs/opportunity-review-priority-redesign-2026-08-05.md. Verify the plan against the current repository paths, representative opportunity results including Swords & Slippers, bounded read-only Tiger schema/query evidence, and explicit backtest, UI, correctness, and performance verification procedures. Preserve the planning-only boundary: do not implement application changes or perform database, deployment, environment, backfill, replay, or other production writes; design the future implementation to add zero Tiger round trips, zero N+1 queries, and no read-time Steam/R2 lookups, with measurable before/after query-plan and throughput gates. Use only this repository, existing local fixtures/tests, official source documentation, and bounded read-only data inspection. Between iterations, update the specification's claim/evidence/gap ledger and pursue the highest-risk unresolved requirement that can materially improve the plan. Complete only when the specification contains the verified current-state map, final ranking/confidence/data contracts, all UI states, exact performance budgets and test procedures, calibration/backtest plan, rollout/rollback plan, and a file-by-file implementation sequence; if no defensible path remains within these limits, stop with attempted paths, evidence, the precise blocker, remaining uncertainty, and the smallest input or permission needed to continue.
```

## Desired End State

PublisherIQ should help a publisher employee answer three questions quickly:

1. Why should I review this game now?
2. What is the game?
3. How strong and complete is the evidence behind the recommendation?

The redesign is complete only when a future implementation can satisfy those questions without penalizing newly discovered games for traction data they cannot yet have and while meeting the exact minimal-load contract: zero new Tiger round trips/N+1/runtime archive reads and no more than `5%` paired in-statement or path regression.

## Evidence Behind the Redesign

Read-only production research completed before this specification found:

- In the latest bounded sample of 10,000 opportunity results, scores were concentrated around a narrow range: median `70.1`, P25 `64.8`, and P75 `75.3`.
- `100%` of those results were labeled `high` confidence.
- Fit labels were similarly concentrated: `48.4%` Promising, `47.6%` Strong, `2.9%` Exceptional, and `1.2%` Developing.
- The current list copy is generated from a small set of generic market statements, so many unrelated games receive nearly identical blurbs.
- The current score mixes user fit, signal strength, peer position, market momentum, and evidence quality into one universal number. That number does not communicate the job the sourcing profile is trying to perform.
- Missing percentiles currently receive neutral defaults. First-observed games can receive high materiality and high confidence even when current traction is unavailable.

### Swords & Slippers reference case

Use Steam app `3563080` and opportunity result `683082c6-c6f7-4700-90b0-c589b187e557` as a named regression fixture.

Observed current result:

- score: approximately `79.5`
- state: newly discovered
- confidence: high
- market: large but competitive
- current traction: unavailable
- comparable cohort coverage: `50/50`

Current Steam short description observed during research:

> A character action roguelite set in a twisted fairytale. These princesses don't want a rescue - they want the heads of the evil stepmothers who stole their happily ever after. Come for the curves. Stay for the combos.

The future UI may truncate or sanitize source copy, but it must preserve the game's meaning and must not replace it with generic market boilerplate.

## Verified Current State and Evidence Ledger

### Inspection boundary and evidence date

The following map was verified during the August 5, 2026 planning phase. That inspection was read-only except for edits to this specification. Tiger inspection used `BEGIN TRANSACTION READ ONLY`, `default_transaction_read_only=on`, a `1s` lock timeout, a `5-12s` statement timeout, explicit date predicates, and `LIMIT`. No database, deployment, environment, archive, backfill, replay, or production write has been performed; subsequent local application implementation and release-gate evidence is recorded separately in Iteration 4.

The live target identified itself as PostgreSQL 18.4 with transaction read-only enabled. `public.pg_stat_statements` and query IDs are available, and connection counts are observable through `pg_stat_activity`. Plan interpretation and query-statistics procedures below follow the official PostgreSQL [`EXPLAIN`](https://www.postgresql.org/docs/current/using-explain.html) and [`pg_stat_statements`](https://www.postgresql.org/docs/current/pgstatstatements.html) documentation. `EXPLAIN ANALYZE` executes its statement; it is therefore permitted only for bounded `SELECT` statements in a read-only transaction against production. Write statements may be analyzed only without `ANALYZE` in production, or with `ANALYZE` in an isolated local/staging transaction that is rolled back.

### Current request and data-flow map

```text
/opportunities or /opportunities/games/[appid]
  -> apps/admin/src/app/api/opportunities/[operation]/route.ts
  -> apps/admin/src/lib/query-api-client.ts
  -> apps/query-api/src/opportunity-routes.ts
  -> packages/data-plane/src/opportunity/service.ts
  -> packages/data-plane/src/opportunity/repository.ts
  -> Tiger opportunity, legacy, metrics, docs, events, and ops schemas

natural Steam/catalog/change evidence
  -> packages/ingestion/src/change-intel/storefront.ts
  -> docs.app_source_snapshots plus R2 archive
  -> ops.app_data_readiness / ops.app_field_evidence / material events
  -> packages/data-plane/src/opportunity/worker.ts
  -> packages/data-plane/src/opportunity/worker-repository.ts
  -> opportunity.results + result_profile_matches + cohort/market snapshots
  -> list, detail, email, and Slack consumers
```

| Surface                                          | Verified owner                                                                                                 | Current behavior relevant to v2                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Rule and result types                            | `packages/data-plane/src/opportunity/types.ts`                                                                 | Ranking version is `opportunity-ranking/v1`; confidence is only `high                                                                                                                                                                                                                                                                                                       | directional`; the rank has five universal numeric components. |
| Ranking and market calculation                   | `packages/data-plane/src/opportunity/intelligence.ts`                                                          | One fixed weight vector combines user fit `35%`, signal strength `30%`, peer position `20%`, market momentum `10%`, and evidence quality `5%`.                                                                                                                                                                                                                              |
| Eligibility, result label, ranking orchestration | `packages/data-plane/src/opportunity/worker.ts`                                                                | Eligibility already runs before ranking. A missing candidate reviews/CCU value receives percentile `0.5`. Confidence becomes high when market confidence is high and required-rule coverage is at least `0.8`. Multiple profile preference scores are collapsed with `max`.                                                                                                 |
| Batched worker reads and writes                  | `packages/data-plane/src/opportunity/repository.ts`, `worker-repository.ts`                                    | Rule input, signal refresh, cohort resolution, result/candidate persistence, delivery selection, and phase timings are batched. The production-scale local fixture is `3,974` candidates, `3` profiles, and `1,245` surfaced results.                                                                                                                                       |
| Canonical persistence                            | Tiger `opportunity.results`, `result_profile_matches`, `cohort_snapshots`, `market_context_snapshots`          | `results.score`, `rank_components`, `why_now`, `evidence_summary`, `source_timestamps`, and `calculation_versions` are sufficient JSON/number compatibility surfaces for a no-new-column v2 result. Per-profile `rule_outcomes` is JSON and can retain independent v2 evaluations.                                                                                          |
| Profile intent persistence                       | Tiger `opportunity.profile_versions.calculation_config`                                                        | JSON object, no restrictive shape constraint. No current profile version contains `rankingPolicy`; published preset versions carry only v1 ranking/cohort/market/health versions.                                                                                                                                                                                           |
| Description source                               | `packages/ingestion/src/change-intel/storefront.ts`, `packages/ingestion/src/change-intel/tiger-repository.ts` | Normalization captures `descriptions.short/about/detailed`, but only the R2 payload has those values today. `docs.app_source_snapshots.snapshot_summary` and `ops.app_data_readiness.provenance` omit descriptions.                                                                                                                                                         |
| Readiness capture definition                     | `packages/data-plane/sql/tiger-bootstrap/0089_readiness_events_signal_windows.sql`                             | Existing `ops.capture_storefront_sync_readiness_v1()` writes the readiness row already joined by both worker rule-input paths; it does not yet copy bounded description/readiness facts.                                                                                                                                                                                    |
| List API                                         | `OpportunityRepository.getBootstrap()` and `getLatestDailyOverview()`                                          | A typical existing-membership request makes `11-12` Tiger round trips including transaction control: four for workspace resolution, then one preset, one profile, three overview, zero-or-one taxonomy, one source-health, and one channel-preference statement. Results are capped at `500`.                                                                               |
| Detail API                                       | `OpportunityRepository.getGameRecord()`                                                                        | The route uses one large record query, zero-or-one taxonomy query, one current rule-input shadow query, and the existing workspace/activity transactions. A typical view is `13-14` Tiger round trips including transaction control and the deduplicated view write. V2 must add zero.                                                                                      |
| Delivery                                         | `packages/data-plane/src/opportunity/delivery.ts`                                                              | Current claim hydration is `3 + D x (1 or 2)` round trips for `D` claimed deliveries, including transaction control and optional taxonomy resolution. It is per-delivery, not per result, but v2 must not add per-result/profile/component/comparable queries; the implementation sequence below converts hydration to one set-based batch and reduces the budget to `4-5`. |
| List UI                                          | `apps/admin/src/app/(main)/opportunities/OpportunityWorkspace.tsx`                                             | Cards lead with a change sentence, then generic why-it-matters copy, prominently show `Opportunity fit: N/100`, and put confidence in a hover-only `title`.                                                                                                                                                                                                                 |
| Detail UI                                        | `apps/admin/src/app/(main)/opportunities/games/[appid]/OpportunityGameRecordClient.tsx`                        | The page repeats the universal fit score/components. Missing current metrics produce a large mostly empty comparison region. Comparable names are not Steam links.                                                                                                                                                                                                          |
| Browser/query API contracts                      | `apps/admin/src/app/(main)/opportunities/lib/types.ts`, `apps/query-api/src/opportunity-routes.ts`             | Admin types duplicate the data-plane contract. The existing authenticated proxy and query-api operation should remain; no new endpoint is required.                                                                                                                                                                                                                         |

`OpportunityRepository.ensureWorkspace()` and detail view tracking perform existing writes even on these read-oriented product requests. This planning investigation did not call those application routes; it used direct read-only SQL. V2 does not expand or redesign that existing behavior.

### Live bounded-result evidence

The latest `10,000` results within the bounded 30-day predicate actually covered July 30 through August 5, 2026:

| Measure                                                         |                 Verified value |
| --------------------------------------------------------------- | -----------------------------: |
| Score P25 / median / P75                                        |           `64.9 / 70.1 / 75.3` |
| Score min / max                                                 |                  `45.1 / 99.2` |
| Confidence                                                      | `10,000 high`, `0 directional` |
| v1 Developing / Promising / Strong / Exceptional                |  `1.2% / 48.2% / 47.6% / 3.0%` |
| Newly discovered missing any of reviews, CCU, or 30-day reviews |             `257 / 257 (100%)` |
| Newly released missing any of those traction signals            |               `89 / 89 (100%)` |
| Results matching two profiles                                   |         `143 / 10,000 (1.43%)` |

This recheck differs from the earlier draft only by rounding and sample recency; it confirms, rather than weakens, the concentration and confidence-collapse claims.

Swords & Slippers was verified directly by both app ID and result ID. It is unreleased, has no release date, is a `newly_discovered` first observation, has score `79.50`, rank `1`, and confidence `high`. Its result says `50/50` cohort coverage and `large_but_competitive`, while its rule-input projection marks total reviews, CCU, and 30-day reviews `unknown` because market metrics are `source_blocked`. The v1 rank nevertheless assigns peer position `0.5`, signal strength `1`, evidence quality `1`, and high confidence. The matched `New Games` profile requires self-published status plus a PublisherIQ-added date of today. The canonical first observation is `2026-08-05T15:24:39.229Z`; the later storefront enrichment did not overwrite it. The latest storefront snapshot has an R2 archive pointer but its relational summary has no description, proving that render-time relational reads cannot currently recover the source copy.

### Current query-plan and runtime evidence

The planning baseline's local node:test suites for worker, repository, delivery, performance, admin presenters, and media passed `54/54` targeted tests. The synthetic production-scale ranking fixture's cross-platform-canonical v1 digest is `7b625cb983f6f151939a62351a2e7c7157b40919bef1e264253ee03a85a44a52`. The first implementation-gate measurements are recorded in Iteration 4 below; they supersede the earlier one-off runtime observations without changing this current-state map.

The repeatable targeted commands used were:

```bash
pnpm --filter @publisheriq/data-plane exec node --import tsx --test src/opportunity/performance-benchmark.test.ts src/opportunity/worker.test.ts src/opportunity/repository.test.ts src/opportunity/delivery.test.ts
pnpm --filter @publisheriq/admin exec node --import tsx --test 'src/app/(main)/opportunities/lib/api.test.ts' 'src/app/(main)/opportunities/lib/media.test.ts'
```

Current `pg_stat_statements` evidence is aggregate and variance-heavy, so it is orientation rather than a release baseline:

| Current query family                                |               Query ID |   Calls |              Mean / max | Evidence                                                           |
| --------------------------------------------------- | ---------------------: | ------: | ----------------------: | ------------------------------------------------------------------ |
| Bulk result/cohort/market/profile-match publication |  `6534258134205912892` | `1,904` |     `9.61ms / 308.58ms` | No temp blocks in the observed aggregate.                          |
| Delivery result hydration                           |  `7715695537560456068` |    `49` |   `163.52ms / 815.62ms` | High variance; motivates set-based hydration and measured p50/p95. |
| Current list result query family                    | `-6819995015302077603` |    `36` | `1018.83ms / 6155.78ms` | Existing baseline is already expensive and must not worsen.        |
| Current detail record query family                  |  `2555328256620082902` |    `26` |  `655.40ms / 1896.48ms` | Existing baseline is already expensive and must not worsen.        |

Two bounded 500-app plan probes resolved the description architecture:

- **Rejected:** joining `docs.app_source_snapshots` to the opportunity batch performed `500` snapshot index searches, read `4,594` shared buffers, and took about `402ms` in the observed cold run. It violates the repeated-subplan and provisional `5%` load gates.
- **Selected:** `ops.app_data_readiness` is already joined once per candidate by both rule-input queries and already carries the storefront snapshot ID, timestamp, content hash, and archive provenance. Reading one additional bounded JSON value from that existing joined row does not introduce a plan node, index search, or round trip. A warm isolated probe retained the same plan shape, `500` readiness primary-key lookups, no temp I/O, and about `6.7ms`; this is plan-shape evidence only, not the required before/after benchmark.

The selected future path is therefore to add bounded sanitized description metadata to the storefront readiness provenance during the existing snapshot/readiness flow, select it in the existing rule-input statement, and copy it into the canonical result. It requires an additive replacement of the existing `ops.capture_storefront_sync_readiness_v1()` function, but no table, column, or index. That SQL remains unapproved and must not be applied without the later approval gate.

### Claim / evidence / gap ledger — iteration 1

| Status             | Claim or decision                                                                                                                           | Evidence                                                                                                                            | Remaining gap / next action                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confirmed          | v1 score and confidence collapse are current, not historical.                                                                               | Bounded latest-10,000 distribution above.                                                                                           | Resolve v2 applicability, confidence, and ordering contracts.                                                                                    |
| Confirmed          | Missing candidate traction is silently neutral in priority and does not prevent high confidence.                                            | `percentileRank(null) = 0.5`; Swords live result and targeted test explicitly preserve neutral percentile.                          | Remove unavailable inputs from the score denominator and evaluate confidence separately.                                                         |
| Confirmed          | Independent multi-profile ranking is not currently persisted.                                                                               | Worker takes maximum preference contribution and stores one universal rank; 143 sample results match two profiles.                  | Define per-profile evidence plus deterministic winner.                                                                                           |
| Confirmed          | A direct snapshot-summary join is not a defensible minimal-load path.                                                                       | Bounded 500-app plan probe above.                                                                                                   | Use the already-joined readiness provenance path.                                                                                                |
| Decision           | “Minimal load” means zero new round trips/N+1/runtime Steam/R2 reads, while allowing <=`5%` measured work inside existing queries/payloads. | User clarification on August 5, 2026.                                                                                               | Enforce exact gates below.                                                                                                                       |
| Recommendation     | Use existing JSON surfaces and one additive readiness-function migration; add no result/profile table columns or indexes.                   | Live columns and constraints show the required JSON fields already exist; `limited` is not allowed in the legacy confidence column. | Map v2 `limited` to legacy `directional` in the compatibility column and expose the three-level value from v2 JSON.                              |
| Open, non-blocking | Existing saved v1 rows cannot gain the original short description without an approved repair/backfill.                                      | Swords relational summary lacks it and render-time R2 is prohibited.                                                                | Launch v2 for newly materialized results; show an honest legacy fallback. Treat any historical repair as a separately approved optional project. |

## Product Principles

1. **Priority is profile-specific.** A game can deserve immediate review for one sourcing profile and not another.
2. **New is not the same as weak.** A discovery profile must not demote a genuinely new Steam game because reviews, CCU, or post-release momentum do not exist yet.
3. **Unknown is not negative.** Missing optional evidence gives neither a bonus nor a penalty. A known negative signal is distinct from unavailable data.
4. **Priority and confidence are separate.** Priority answers “review when?” Confidence answers “how much evidence supports this?”
5. **Explain the recommendation.** User-facing reasons should be specific and auditable; a raw score should not be the main message.
6. **Describe the game first.** Opportunity cards should lead with what the game is, followed by why it is timely and relevant.
7. **Compute once, read many.** Ranking, reason strings, confidence, and descriptions should be materialized during the existing worker flow and reused by every consumer.
8. **Minimal measured Tiger load.** The redesign must add zero database round trips, N+1 patterns, repeated scans, or runtime archive lookups; added work inside an existing statement/path must pass the paired `5%` gates.

## Ranking V2: Review Priority

Replace the universal user-facing `Opportunity Fit` concept with `Review Priority` backed by a versioned policy, such as `opportunity-ranking/v2`.

### Stage 1: eligibility

Evaluate the sourcing profile's hard rules first. A game is either eligible or ineligible for that profile.

- Hard exclusions must not be disguised as a low score.
- Eligibility failures should retain structured reason codes for auditing.
- Only eligible games proceed to priority calculation.

### Stage 2: priority lane

Assign each eligible result to the lane that explains why the game should be reviewed:

- `new_game`: newly discovered, newly released, or newly qualified from delayed first-observation readiness inside the discovery grace window
- `traction`: showing meaningful early or accelerating market traction
- `material_change`: an already known game with a meaningful new event or change

Lane assignment is not a proxy for quality. It defines the appropriate evidence and comparison set.

### Stage 3: profile policy

Each sourcing profile selects a ranking policy that matches its job:

- `discover_new_games`
- `find_emerging_traction`
- `monitor_material_changes`

The selected policy determines applicable inputs, weights, missing-data behavior, reason generation, and confidence evaluation.

#### Discovery policy

For profiles intended to find new Steam games:

- rank `new_game` results ahead of older `traction` and `material_change` results unless an explicit user-controlled profile rule says otherwise;
- rank games within the `new_game` lane using only evidence appropriate for a new title;
- do not include reviews, CCU, review velocity, or other post-release traction in the denominator;
- do not penalize missing post-release evidence;
- preserve the original `firstObservedAt` so delayed enrichment cannot reset freshness;
- apply a 72-hour discovery grace window so ingestion or enrichment timing cannot unfairly age a title before it is reviewable.

Approved starting weights for `discover_new_games`:

| Component                        | Starting weight | Meaning                                                                                       |
| -------------------------------- | --------------: | --------------------------------------------------------------------------------------------- |
| Preferred-profile match          |             35% | Match to the publisher's chosen genres, tags, themes, platforms, and other stated preferences |
| Publishing openness              |             25% | Evidence that the title may be open to or suitable for a publishing relationship              |
| Comparable-market attractiveness |             20% | Commercial context from appropriately selected released comparables                           |
| Product/store readiness          |             10% | Quality and completeness of the Steam presence and other available early product evidence     |
| Freshness/launch timing          |             10% | How recently the game was first observed or released relative to the profile's discovery job  |

These are calibration starting points, not permission to hard-code unsupported proxies. The final plan must define each input, value range, applicability rule, reason code, and evidence source.

#### Traction policy

Use released-game traction, acceleration, peer position, and market context only when those signals are applicable. The plan must derive and backtest weights instead of copying the discovery weights.

#### Material-change policy

Prioritize the significance, recency, and profile relevance of a new event. The plan must prevent first observation from being treated as the same phenomenon as a substantive change to an already known game.

### Stage 4: confidence

Calculate evidence confidence separately from review priority.

Confidence should account for:

- whether the policy's applicable inputs are present;
- source freshness and reliability;
- comparable cohort coverage and quality;
- conflicts or uncertainty in the available evidence.

Do not award `High confidence` merely because missing values were replaced with neutral defaults. Persist structured confidence reasons and show a concise tooltip such as:

- `High confidence — the applicable profile, market, and game evidence is complete and current.`
- `Directional evidence — this is a new discovery; post-release traction is not expected yet.`
- `Limited evidence — one or more applicable inputs are unavailable or stale.`

The exact labels must be validated for clarity, but they must not imply that a brand-new title has failed to perform.

### Stage 5: multiple matching profiles

When a game matches more than one sourcing profile:

- evaluate it independently under each matched profile's policy;
- persist the winning profile/policy used for ordering;
- retain all matched profiles for display and audit;
- never blend incompatible policy inputs into one universal score.

### Persisted result contract

The implementation plan must define a canonical, versioned result contract containing at least:

- ranking version;
- eligibility state and reason codes;
- priority lane;
- ranking policy;
- winning profile ID and all matched profile IDs;
- internal normalized score or sortable priority value;
- component values, weights, and contributions;
- applicable, unavailable, and known-negative inputs;
- user-facing priority reasons;
- confidence level and confidence reasons;
- original `firstObservedAt` and relevant event/release timestamps;
- market-potential summary;
- materialized short description and provenance.

The raw numeric score may remain for ordering, debugging, and audit, but it should not be the dominant user-facing statistic.

## Final Ranking, Applicability, and Confidence Contract

### Versions and compatibility

- Ranking policy contract: `opportunity-ranking/v2`.
- Description sanitizer: `opportunity-description/v1`.
- Confidence contract: `opportunity-confidence/v2`.
- The existing rule schema remains `opportunity-rules/v2`; profile intent is calculation configuration, not a new rule operator.
- No v2 database column is required. The legacy `results.confidence` check only accepts `high | directional`, so v2 `limited` maps to legacy `directional` in that compatibility column while the authoritative three-level value lives in `rank_components.v2.confidence`.
- During shadow/dual-write, `results.score`, root v1 components, and `result_profile_matches.preference_score` retain v1 values. The v2 internal value is not written into the legacy fit field. Once presentation is enabled, `results.rank` is calculated from the v2 sort tuple while v1 rows retain their existing order. This prevents an application rollback from presenting a v2 policy number as a universal fit prediction.

### Profile policy selection

`profile_versions.calculation_config.rankingPolicy` is the authoritative explicit value and must be one of `discover_new_games`, `find_emerging_traction`, or `monitor_material_changes`. New profiles and newly cloned presets must show and save an explicit intent before they can be enabled.

Existing versions without that field use this deterministic, persisted compatibility decision during v2 evaluation:

1. infer `discover_new_games` when a required rule constrains `publisheriq_added_at`, requires `is_released = false`, or selects a future/unreleased release window;
2. otherwise infer `find_emerging_traction` when a required or preferred rule uses `total_reviews`, `positive_percentage`, `reviews_added_7d`, `reviews_added_30d`, `ccu_peak`, `ccu_change_7d`, or `ccu_change_30d`;
3. otherwise infer `monitor_material_changes`.

The decision stores `selectionSource: explicit | legacy_inference`. The profile editor shows an “Intent inferred from existing profile” notice until a user saves an explicit choice. Current preset recommendations are: Upcoming Games With Demos -> discovery; New Self-Published Indie Releases and Recently Released Games Showing Early Traction -> traction; the five taxonomy/genre presets -> material-change monitoring. The user can change the recommendation before enabling a clone.

### Eligibility and lane assignment

Stage 1 continues to use the existing tri-state rule evaluator:

- `eligible`: every required group is true and no exclusion group is true;
- `pending`: a required group is unknown and no known rule already makes the game ineligible;
- `ineligible`: a required group is false or an exclusion group is true.

Persist reason codes as `required_failed:<groupId>`, `excluded_matched:<groupId>`, and `required_unavailable:<field>`. Pending/ineligible outcomes remain in `candidate_state.last_outcome`; only eligible matches can create a result. The canonical result copies the winning eligible decision and reason codes, rather than representing an exclusion as a low score.

Stage 2 assigns exactly one lane using preserved source timestamps and event identity:

1. `new_game` when the source event is `first_observed` or `released`, or when delayed readiness qualifies that preserved source event while the immutable `firstObservedAt` is no more than 30 days old;
2. `traction` when a released game is triggered by `review_breakthrough`, `ccu_breakthrough`, or the `reviews`/`ccu` signal family and at least one applicable traction value is available;
3. `material_change` for another substantive event on an already known game.

`date_window_changed` is an evaluation trigger, not automatically a substantive change. A `first_observed` event can never be relabeled `material_change`; a missing traction value can never create the traction lane. The event label remains for compatibility, but v2 consumers use `priorityLane`.

### Input-state model and score formula

Every policy input persists:

```text
key, source, sourceAt, calculationVersion,
availability: available | unavailable | not_applicable,
assessment: positive | neutral | negative | mixed | not_assessed,
rawValue, normalizedValue (0..1 or null),
reasonCode, criticalForConfidence
```

- A known negative is `available + negative`, has a numeric value (often `0`), and remains in the denominator.
- An optional unknown is `unavailable + not_assessed`; it contributes neither points nor score weight but may lower confidence when it was applicable.
- Evidence that cannot exist for the lane is `not_applicable`; it affects neither priority nor confidence. New/unreleased reviews and CCU use this state.
- A component with no available inputs has `value: null` and `effectiveWeight: 0`.

For each profile policy:

```text
internalScore = sum(component.value * component.baseWeight)
                / sum(component.baseWeight where component.value is not null)
```

The stored display/debug value is `round(internalScore * 100, 2)`. It is not a commercial-success probability. If every component is unavailable, the match is eligible but has `priorityBand: monitor`, `internalScore: null`, and limited confidence.

### Discovery policy

These approved weights are final starting weights. All sub-input mappings are versioned and must be included in the calibration artifact.

| Component                          | Weight | Exact v2 starting definition                                                                                                                                                                                                                                     | Applicability and sources                                                                                                                                                                                     |
| ---------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferred_profile_match`          |    35% | Weighted mean of known preferred-group outcomes: true=`1`, false=`0`; importance high=`1`, medium=`0.6`, low=`0.3`. Required rules determine eligibility and do not add points.                                                                                  | Existing per-profile rule outcomes. Unknown groups are unavailable, not false. No preferred groups makes the component unavailable.                                                                           |
| `publishing_openness`              |    25% | `1.0` when no publisher is listed; otherwise `0.8` when developer and publisher identities indicate self-publishing. A separate listed publisher is not assumed to be closed and produces unavailable unless an explicit profile rule supplies a known negative. | Existing `no_publisher_listed` and `self_published` storefront evidence. Small portfolio size remains a profile preference, not an invented openness proxy.                                                   |
| `comparable_market_attractiveness` |    20% | Starting mapping: large-but-competitive=`0.8`, meaningful=`0.7`, developing=`0.5`, limited=`0.25`; insufficient data is unavailable. The explanation retains concentration warnings.                                                                             | Existing released cohort and market snapshot; candidate reviews/CCU are not used.                                                                                                                             |
| `product_store_readiness`          |    10% | Weighted available sub-inputs: useful description `0.30`, header art `0.20`, at least three screenshots `0.15`, at least one trailer `0.10`, known platform/language support `0.15`, and a lane-appropriate release/demo/purchase path `0.10`.                   | Bounded storefront description/completeness in existing readiness provenance plus existing rule input. A purchase package is not expected for every unreleased title and is not negative when not applicable. |
| `freshness_launch_timing`          |    10% | `1.0` through 72 hours from immutable `firstObservedAt`, then linear decay to `0` at 30 days. `eligibleAt`, enrichment, reprocessing, or a new calculation version never resets it.                                                                              | `ops.app_catalog_state.first_observed_at` only. Existing readiness rechecks are bounded by 72 hours, so a title that becomes reviewable inside the grace window starts without age penalty.                   |

Discovery sorts `new_game` ahead of `traction`, then `material_change`, regardless of their internal scores. Reviews, CCU, review velocity, and candidate peer position are not discovery components and are explicitly `not_applicable` for an unreleased/new title.

### Traction policy

The candidate weights are deliberately different from discovery: profile match `20%`, traction level `25%`, acceleration `30%`, peer position `15%`, and market context `10%`. They are seed values, not launch constants. The calibration procedure must choose a versioned champion from a five-percentage-point grid under the monotonic constraints that acceleration is at least traction level and level plus acceleration is at least `50%`. Production enablement is blocked until that artifact exists.

| Component                 | Seed | Exact candidate definition                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferred_profile_match` |  20% | Same preferred-group calculation as discovery.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `traction_level`          |  25% | Mean of available total reviews and peak CCU, each mapped as `clamp(log1p(max(0,x)) / log1p(max(1, cohortP90)), 0, 1)`. Known zero is available/negative; missing is unavailable. A cohort P90 requires at least 10 measured games.                                                                                                                                                                                                                                                   |
| `traction_acceleration`   |  30% | Mean of available normalized inputs: review-rate delta `(reviews7d / 7) - (max(0, reviews30d - reviews7d) / 23)`; `reviews30d`; `ccuChange7d`; and `ccuChange30d`. Map `reviews30d` with the level log/P90 formula and each signed rate/change with the cohort midrank empirical CDF `(count(<x) + 0.5*count(=x))/n`. A cohort input with fewer than 10 measurements is unavailable. A raw decline is persisted as `available + negative` even when its cohort percentile is nonzero. |
| `peer_position`           |  15% | Mean cohort midrank empirical CDF for available candidate total-reviews and CCU measurements, requiring at least 10 peers per input. Missing values are unavailable and are never assigned the v1 `0.5` default.                                                                                                                                                                                                                                                                      |
| `market_context`          |  10% | Same market-band mapping and concentration evidence as discovery.                                                                                                                                                                                                                                                                                                                                                                                                                     |

The traction lane is ordered before new/material lanes for this policy. An unreleased title with no applicable traction may remain eligible under hard rules, but it is `monitor` for this policy; that is a policy/lane mismatch, not a claim of weak performance.

### Material-change policy

The starting weights are profile relevance `25%`, event significance `35%`, recency `25%`, and corroboration/consistency `15%`.

| Component                   | Weight | Exact v2 starting definition                                                                                                                                                      |
| --------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile_relevance`         |    25% | `1.0` when affected fields intersect required/excluded fields, `0.7` for preferred fields, `0.4` for only a subscribed signal family, otherwise known negative `0`.               |
| `event_significance`        |    35% | Stored versioned materiality in `[0,1]`. `first_observed` is not applicable and is suppressed for this policy.                                                                    |
| `event_recency`             |    25% | `1.0` through 24 hours from effective event time, then linear decay to `0` at 30 days; reprocessing never resets the source time.                                                 |
| `corroboration_consistency` |    15% | `1.0` for two or more independent sources with no conflict, `0.7` for one canonical source, `0.3` for a lower-confidence single source, and `0` for a direct unresolved conflict. |

This policy does not surface first observation alone. The material-change lane is ordered first; traction and new-game events can be retained only as lower-priority subscribed context.

### Priority bands, per-profile ordering, and winning profile

Starting bands are `review_now >= 0.75`, `review_soon >= 0.55`, and `monitor < 0.55` or null. Calibration may change thresholds by policy, but each change creates a new policy configuration/version.

Lane ordinals are exact: discovery uses `new_game=0, traction=1, material_change=2`; traction uses `traction=0, new_game=1, material_change=2`; material monitoring uses `material_change=0, traction=1, new_game=2`. A policy/lane mismatch can be retained for context but never outrank that policy's primary job.

Per-profile sort tuple is:

```text
[policyLaneOrder,
 surfaceBand(review_now, review_soon, monitor),
 internalScore DESC NULLS LAST,
 effectiveEventAt DESC,
 appid ASC,
 profileVersionId ASC]
```

The winning profile is the lexicographically first per-profile tuple. The user-wide feed compares those winning tuples in the same order. Policy lane ordinal `0` means the policy's primary job (`new_game` for discovery, `traction` for traction, `material_change` for monitoring), so a lower-lane high score cannot jump ahead of that profile's primary-lane work. If two policies both regard a result as primary-lane, timing band and score break the tie. Every matched profile retains its own tuple, policy, lane, components, inputs, and reasons in `result_profile_matches.rule_outcomes.reviewPriorityV2`; the winning copy is stored on the result for ordering and compact reads.

User-facing labels combine lane and timing, for example `New discovery — Review now`, `Traction — Review soon`, and `Material change — Monitor`. They never say “best game” or predict success.

### Confidence v2

Confidence uses only evidence applicable to that profile/lane. Four normalized terms are renormalized when genuinely not applicable:

```text
confidenceScore = 0.45 * applicable completeness
                + 0.25 * source freshness
                + 0.20 * cohort quality
                + 0.10 * consistency
```

- Completeness is the importance-weighted available/applicable ratio. Known negatives are available.
- Freshness is the same importance-weighted fraction of available applicable inputs within source SLA: catalog/storefront/description `48h`, released metrics `48h` from their metric date, cohort source `7d`, and material-event source no older than the event's persisted observation. Stale remains available for priority but lowers confidence and receives a reason.
- Cohort quality is `coverage * min(1, measuredGames / 10)` multiplied by fallback quality tier `1.0, 0.9, 0.75, 0.6, 0.4` for tiers 1-5. It is not applicable when the policy has no market component.
- Consistency is `1` with no conflict, `0.5` with unresolved mixed evidence, and `0` with a direct contradiction.

Critical evidence is: eligibility and immutable first observation for discovery; at least one current level and one acceleration input for traction; event type/time/materiality for material change. Assign labels in this precedence order so the states cannot overlap:

1. `high` when the score is at least `0.80`, no critical applicable input is unavailable/stale, and there is no direct conflict;
2. otherwise `limited` when a critical input is unavailable/stale, there is a direct conflict, or the score is below `0.50` for a reason other than correctly not-applicable post-release evidence on a new discovery;
3. otherwise `directional`, including a new discovery whose only absent evidence is correctly not-applicable post-release traction.

Exact initial accessible explanations are:

- `High confidence — the applicable profile, market, and game evidence is complete and current.`
- `Directional evidence — this is a new discovery; post-release traction is not expected yet.`
- `Limited evidence — one or more applicable inputs are unavailable, stale, or conflicting.`

Persist the numeric score, label, applicable/present/stale/conflicting counts, and reason codes. The numeric confidence score is audit-only.

### Canonical v2 persistence envelope

The no-new-result-column design stores:

```text
profile_versions.calculation_config.rankingPolicy

result_profile_matches.rule_outcomes.reviewPriorityV2 =
  eligibility, lane, policy, selectionSource, priorityBand,
  internalScore, sortTuple, components[], inputs[], reasons[], confidence

results.rank_components.v2 =
  contractVersion, rankingVersion, winningProfileId, allMatchedProfileIds,
  winning decision copied from the match, legacyV1Score

results.evidence_summary.reviewPriorityV2 = compact list/detail/delivery summary
results.evidence_summary.gameDescription = materialized description contract
results.why_now.reviewPriorityV2 = ordered reason codes and bounded phrases
results.calculation_versions.reviewPriority = opportunity-ranking/v2
results.calculation_versions.confidence = opportunity-confidence/v2
results.calculation_versions.description = opportunity-description/v1
```

The compact summary contains only description, lane/band labels, up to three reasons, winning/matched profile IDs, market band, confidence label/reasons, and applicability summary. Full components remain available to detail/audit from the same canonical row and its already-joined match rows. List, detail, email, and Slack must not calculate or reinterpret the policy.

### Description selection, sanitation, and provenance

During the existing storefront normalization/readiness flow:

1. normalize short/about/detailed candidates; decode decimal/hex numeric entities plus the fixed named allowlist `amp, apos, quot, lt, gt, nbsp, ndash, mdash, hellip, lsquo, rsquo, ldquo, rdquo`; remove markup and C0/C1 control/bidi override characters; preserve ordinary Unicode; collapse whitespace; and render only as React/text-escaped content. An unknown named entity remains literal escaped text rather than being executed or silently guessed;
2. use sanitized `descriptions.short` when it contains at least 20 non-whitespace characters;
3. otherwise use the first bounded meaningful text from `about`, then `detailed`;
4. otherwise generate `{name} is a Steam {primary genre or tag} game.` when those facts are known;
5. otherwise use `Steam has not provided a short description for this game yet.`

The visible text is capped at `320` Unicode grapheme clusters and `800` UTF-8 bytes. Store `text`, `kind: steam_short | steam_about | steam_detailed | structured | unavailable`, `sourceSnapshotId`, `sourceAt`, `contentHash`, and `sanitizerVersion`. Also persist bounded readiness facts (`hasHeaderImage`, screenshot count, trailer count) needed by the discovery component.

The ingestion snapshot summary and the existing readiness trigger copy this bounded object into `ops.app_data_readiness.provenance.description`. The already-present `readiness_storefront` join selects it into the worker input; the worker copies it into `results.evidence_summary.gameDescription`. No list/detail/delivery consumer reads Steam, R2, `docs.app_source_snapshots`, or a new Tiger statement.

Historical v1 results without this object show the honest unavailable fallback. A historical repair is explicitly not required for v2 launch and must be a separately proposed, bounded, approved write project; it is not hidden inside rollout.

### Claim / evidence / gap ledger — iteration 2

| Status            | Claim or decision                                                                      | Evidence                                                                                             | Remaining gap / next action                                                             |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Resolved          | Unknown, not applicable, and known negative have distinct scoring/confidence behavior. | Field-level contract and denominator rule above.                                                     | Cover all combinations in table-driven tests.                                           |
| Resolved          | New-game priority cannot be depressed by absent traction.                              | Discovery component set excludes candidate traction; 72-hour grace uses immutable first observation. | Swords regression and time-boundary tests are mandatory.                                |
| Resolved          | Multiple profiles are not blended.                                                     | Per-match v2 envelope plus deterministic winner tuple.                                               | Backtest 143+ multi-profile examples and verify list/detail audit parity.               |
| Resolved          | Three confidence labels fit current constraints without a required results migration.  | Authoritative value in JSON; compatibility mapping to existing check-constrained column.             | API type and legacy-row tests.                                                          |
| Resolved          | Description can be materialized without the rejected snapshot join.                    | Existing readiness join/provenance and trigger path.                                                 | Future additive function migration needs explicit approval and before/after plan proof. |
| Open rollout gate | Traction weights/thresholds need time-split calibration and human relevance review.    | No existing labeled “should review” dataset was found; copying discovery weights is prohibited.      | Execute the bounded calibration plan below before enabling v2 ordering.                 |

## Final Opportunity List Information Architecture

The list is an intelligence triage surface for publishing teams, not a score leaderboard. Preserve the existing editorial density and warm-coral design system; do not add a new visual language or dependency.

### Card contract and reading order

1. **Identity:** existing capsule/header art, title, developer, release state/date, and saved/reviewed controls.
2. **What it is:** the materialized description, clamped to two lines; its fallback kind is not exposed unless it is `unavailable`.
3. **Why now:** `priorityLane + priorityBand` label and one to three persisted, profile-specific reason phrases.
4. **Why it matches:** winning profile followed by other matched profile names; collapse after two with an accessible `+N profiles` disclosure.
5. **Market context:** one compact persisted label such as `Large, competitive market`; do not repeat it as generic prose. Append a persisted demand direction such as `Peer demand improving` only when it is known, applicable, genuinely additive, and not already communicated by a why-now reason.
6. **Evidence:** a focusable/clickable confidence badge that opens the exact persisted explanation and applicable/present/stale counts.

Remove the prominent `Opportunity fit: N/100` and the generic `PublisherIQ identified this game on Steam` / `Comparable games show meaningful commercial potential` copy. The audit disclosure may show the internal priority value, version, and components, clearly labeled `Internal ordering value — not a success forecast`; it is never on the primary card face.

### Complete list-state matrix

| State                                          | Required presentation and behavior                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial loading                                | Keep the page title/filter chrome stable; show three fixed-height card skeletons with no invented labels. Announce `Loading opportunities` once with `aria-live=polite`.                                                    |
| API/auth error                                 | Show an inline error with `Try again`; preserve current filters and prior successfully loaded cards when present. Do not convert contract errors to an empty result.                                                        |
| Evaluation `not_run`                           | Explain that an enabled sourcing profile is required and link/focus the existing profile builder. No score or empty-results claim.                                                                                          |
| Evaluation `running`, no prior result          | Show evaluation status plus skeletons; do not display partial v1/v2 ordering as complete.                                                                                                                                   |
| Evaluation `running`, prior result available   | Keep the prior feed, label its evaluated-at time, and show `Refreshing`; replace it atomically when the run completes.                                                                                                      |
| Completed with zero eligible results           | State `No games currently match these sourcing profiles`; retain filters/profile controls and distinguish this from missing data or an error.                                                                               |
| Normal v2 result                               | Render only the compact persisted v2 summary; no card-side policy calculation.                                                                                                                                              |
| Multiple profile matches                       | Render the winning match reasons first and disclose every other independently evaluated match; do not merge components.                                                                                                     |
| `high`, `directional`, or `limited` confidence | Render the text label plus icon and the persisted explanation. Color may reinforce but never carry the meaning.                                                                                                             |
| Description `steam_*` or `structured`          | Render as ordinary escaped text; clamp visually without altering the persisted source contract.                                                                                                                             |
| Description `unavailable`                      | Render the exact honest fallback in a muted treatment; never substitute market boilerplate.                                                                                                                                 |
| Missing/broken art                             | Reuse the existing deterministic image fallback and preserve the title as text; no network lookup beyond the existing image URL behavior.                                                                                   |
| Legacy v1 row                                  | Show `Legacy result — review priority will appear after the next natural evaluation`, the honest unavailable-description fallback when needed, and the existing change/profile facts; do not relabel v1 fit as v2 priority. |
| Malformed/unknown v2 version                   | Fail that card closed to the legacy treatment, emit a contract error, and keep the rest of the feed usable. Never guess a policy from partial JSON in the browser.                                                          |
| Narrow/mobile                                  | Stack identity, description, reasons, then metadata; keep actions and confidence trigger keyboard/touch reachable, and avoid horizontal scrolling.                                                                          |

The confidence trigger is a real `button` with `aria-expanded`/`aria-controls`; the popover opens on click, Enter, or Space, closes with Escape and focus return, and is not hover-dependent. Reasons and confidence have visible text, not icon/color-only meaning. Loading and refresh announcements must not repeat on every card.

## Final Opportunity Game Record Information Architecture

The detail page reads the same canonical decision as the card. Its order is: identity and materialized description; review priority and why-now reasons; matched-profile decisions; market/current-results summary; comparable games; evidence/audit; existing activity and actions. The browser may format persisted values but may not recompute policy, applicability, confidence, or the winning profile.

Preserve the existing `What changed` section and its triggering-event provenance. Replace any generic legacy `Why it matters` boilerplate with a deterministic `Commercial context` or equivalent summary derived only from the persisted market classification, applicable demand direction, cohort evidence, and confidence limitations. Do not repeat the same market label or event in the header, why-now reasons, commercial context, and current-results summary.

### Priority and profile treatment

- The header uses the same lane/band and confidence label as the list. The old fit score is removed from the primary summary.
- `Why review now` lists the winning profile's one to three persisted reasons. `Matched sourcing profiles` exposes the winning decision first and a collapsed, independent decision for every other profile.
- `How this was decided` is a native/focusable disclosure containing eligibility/lane reason codes, component values/weights/contributions, field availability/assessment, confidence counts/reasons, source timestamps, and versions. Null values are rendered as `Unavailable` or `Not applicable` from the persisted enum, never from truthiness.
- Legacy/malformed contracts use the same safe treatment as the list and never mix root v1 components with a partial v2 explanation.

### Current-results state machine

| Persisted state                                           | Detail presentation                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traction evidence `not_applicable` because unreleased/new | Collapsed sentence: `This game is unreleased, so post-release traction is not available yet.` Show the existing market summary and, when available, at most two concrete persisted peer facts such as cohort count plus median or top-quarter reviews. Append demand direction only when known and additive. List excluded fields only inside `Benchmark methodology`. |
| Traction evidence applicable but `unavailable`            | Collapsed sentence: `Current traction data is not available from the recorded sources.` Include freshness/source reason and retry/evaluation time when persisted; do not call it weak.                                                                                                                                                                                 |
| Traction evidence `available + negative`                  | Show the measured zero/decline truthfully against the cohort and label it as observed evidence. Never render `Not available`.                                                                                                                                                                                                                                          |
| Some current values available                             | Show only available current-vs-peer comparisons in the primary region; disclose unavailable fields and methodology separately.                                                                                                                                                                                                                                         |
| All relevant values available                             | Keep the concise current/peer comparison and supporting cohort coverage; avoid duplicating the market narrative.                                                                                                                                                                                                                                                       |
| Cohort sparse/insufficient                                | Show the persisted market/confidence limitation and cohort count; do not manufacture a percentile.                                                                                                                                                                                                                                                                     |

### Comparable games

Every existing comparable row must carry its already-returned numeric `appid` and construct `https://store.steampowered.com/app/{appid}` in the browser. Put the existing external-link icon next to the name, use `target="_blank" rel="noopener noreferrer"`, and label the link `Open {game name} on Steam`. Missing/invalid app IDs render plain text and a contract warning. The link requires zero data reads and must not change row-click semantics.

## Description Ownership and Consumer Contract

The selection/sanitization/provenance contract is canonical in `Description selection, sanitation, and provenance` above. Its implementation boundary is:

```text
existing storefront normalization
  -> bounded description/readiness object in existing snapshot_summary
  -> unapproved additive replacement of capture_storefront_sync_readiness_v1()
  -> existing ops.app_data_readiness.provenance row
  -> existing batched rule-input SELECT
  -> result evidence_summary.gameDescription
  -> list, detail, email, Slack
```

Do not add a description column to `legacy.apps`, query the snapshot table from the worker, or let a consumer fall back to Steam/R2. Email and Slack apply channel-safe escaping/truncation to the persisted text but retain the same content kind and meaning. The snapshot summary/provenance objects are bounded by the `800`-byte description cap plus small scalar readiness/provenance fields; the original unbounded text remains archive-owned.

## Exact Tiger Round-Trip and Payload Budgets

“Minimal load” means **zero new Tiger round trips, zero N+1, zero read-time Steam/R2**, and no more than `5%` measured regression inside an existing statement or worker path. Query counts include `BEGIN`, `COMMIT`, and other transaction-control statements because they are network round trips.

| Affected path and fixed scenario                              |                                                                                                    Verified v1 count/formula |                                                                                                Mandatory v2 budget | How enforced                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------: | -----------------------------------------------------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List bootstrap, existing member, 500-result cap               |                `11-12` (`4` workspace + `1` preset + `1` profile + `3` overview + `0-1` taxonomy + `1` source + `1` channel) |                                                                                                 `11-12`; delta `0` | SQL tracer snapshot by normalized statement family; v2 fields extend the existing overview rows.                                                                                                                                    |
| Game detail, existing member, normal view tracking            | `13-14` including existing workspace/activity writes, one main record query, `0-1` taxonomy, and one shadow rule-input query |                                                                                                 `13-14`; delta `0` | Same tracer; description/priority fields come from existing result and already-joined match rows.                                                                                                                                   |
| Worker evaluation, identical batch/profile/event/chunk inputs |                                    Dynamic because signal refresh, heartbeats, snapshot fencing, and persistence are chunked |     Exact identity: `Q_v2(B,P,E,C) = Q_v1(B,P,E,C)` and each normalized statement-family count is equal; delta `0` | Capture a golden SQL trace for fixtures `(B,P) = (1,1), (500,3), (3974,3)` with identical `E` and chunk config `C`; fail on any added family or invocation. Description is one selected JSON path in the existing rule-input query. |
| Worker pure ranking calculation after inputs are loaded       |                                                                                                              `0` Tiger calls |                                                                                                                `0` | Repository-free unit tests and a connection spy that throws on access.                                                                                                                                                              |
| Delivery claim/hydration for `D=1..10` deliveries             |                                                                                                           `3 + D * (1 or 2)` | `4-5` total: begin, set-based claim, one set-based result/match hydration, `0-1` set-based taxonomy lookup, commit | Refactor the existing per-delivery hydration before adding v2 fields; assert the same count for `D=1` and `D=10`. No query inside a result/profile/comparable loop.                                                                 |
| Profile create/update with ranking intent                     |                                                                       Existing transaction/query sequence for that operation |                                                                                    Exact existing count; delta `0` | Store `rankingPolicy` inside the existing `calculation_config` write and return it from the existing row; tracer compares create and update separately.                                                                             |
| List/detail/delivery description access                       |                                                                                                   `0` Steam and `0` R2 calls |                                                                                                                `0` | Network/archive clients replaced by throwing fakes in contract tests; static search rejects their import in opportunity presenters.                                                                                                 |

The worker identity formula is the exact budget: a single fixed number would be false precision because current counts legitimately vary with batch size, signal-window chunks, material events, heartbeat cadence, and cohort cache state. The named golden scenarios turn that identity into numerical artifacts before the first code change and compare like-for-like thereafter.

Payload limits are also acceptance gates: the compact v2 summary may add at most `1,024` UTF-8 bytes per result and `8 KiB` of envelope overhead (`<= 520 KiB` added at the 500-result maximum); detail may add at most `32 KiB`; each delivery result may add at most `1,024` bytes. Full per-profile components are detail/audit data and must not be duplicated into every list result. Description text itself remains `<=800` bytes.

## Repeatable Query-Plan, Throughput, and API Verification

### Baseline artifact

Before modifying code, run the future harness against the same commit, sealed fixture/snapshot ID, Node version, database target, pool configuration, and warm/cold mode intended for the after run. Store JSON/Markdown artifacts with commit SHA and timestamp containing:

- normalized SQL text hash/query ID and count, including transaction control;
- `EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON)` for each bounded changed `SELECT` in local/staging, or production only inside a read-only transaction; production write statements use `EXPLAIN` without `ANALYZE`;
- planning/execution p50/p95, actual rows, loops, shared/local/temp blocks, and plan-node tree;
- API end-to-end p50/p95, response bytes, HTTP/contract errors, and peak pool connections;
- worker candidates/results per second, phase timings, RSS, and query counts;
- zero-call counters for Steam and R2 on read/delivery paths.

Run `5` unrecorded warmups followed by `30` sequential measured iterations for each list/detail/query; record a separate cold-plan run, never mix it into warm percentiles. Run API load as `50` sequential requests and `10` clients x `10` requests at concurrency, against deterministic local/staging fixtures. Run the worker for batch/profile scenarios `1/1`, `500/3`, and `3,974/3`, `10` measured repetitions in cold- and warm-cohort modes. Delivery uses `D=1,2,10` and both taxonomy-present/absent fixtures.

### Hard pass/fail gates

1. Every path meets the round-trip table; no added SQL family or loop-dependent query count.
2. Changed query warm p50, p95, actual rows, total shared-buffer hits+reads, and temp bytes are each `<= 1.05 x` its paired baseline. No temp spill may appear where baseline had none.
3. No new sequential scan on a large relation, per-row correlated subplan, or nested-loop inner execution count proportional to cards/profiles/components/comparables. Estimated-vs-actual row error above `10x` requires explanation and a new measurement even if runtime passes.
4. Worker candidates/second and results/second are each `>= 0.95 x` baseline; every phase p95 is `<=1.05 x`; query counts are identical; RSS is `<=1.05 x`.
5. API warm/concurrent p50 and p95 are `<=1.05 x`, errors do not increase, payloads meet the caps, and peak/checked-out pool connections do not increase.
6. List/detail/delivery record `0` Steam and R2 calls. All runs have `0` contract-parity mismatches.

For sub-`5ms` measurements, report coefficient of variation and bootstrap 95% confidence intervals across the 30 paired samples, but do not waive structural query/count/plan gates. A noisy runtime result is rerun on a quieter identical target; it is not declared passing from one favorable sample. `pg_stat_statements` before/after query IDs and call/time/block deltas are a production-orientation check after an approved rollout, not a substitute for the controlled gate.

If any gate fails, stop. First reduce duplicated JSON or extract less data in the same statement; if that cannot pass, present an explicitly approved projection/schema option. Do not silently add an index, cache, service, round trip, or runtime archive lookup.

## Backtest, Calibration, and Human-Relevance Plan

### Reproducible sample

Use two sealed read-only samples. The **current relevance sample** uses completed natural daily/manual runs in the latest `28` days. The **matured outcome sample** uses up to three non-overlapping 28-day observation windows whose end is at least `90` days before extraction, so T+30/T+90 labels already exist. A bounded coverage query must first prove that historical result/rule/cohort snapshots exist for each proposed window; if fewer than two usable windows or fewer than `500` traction examples exist, report that exact coverage and keep traction ordering in shadow until a prospective cohort matures. Do not reconstruct unavailable past inputs from future state.

Across the samples, select at most `2,000` eligible results by deterministic `md5(result_id || ':opportunity-v2-2026-08')` order, capped at `200` per cross-stratum of proposed policy, lane, released/unreleased, traction availability, known-negative presence, cohort tier, and single/multiple profile match. Oversample rare multi-profile, conflicting, sparse-cohort, pending/ineligible, and material-change cases; publish sampling weights so aggregate metrics can be reweighted. Add up to `500` candidate-state rows stratified across eligible/pending/ineligible to verify that priority never bypasses eligibility.

Freeze raw rule inputs, source timestamps, market/cohort snapshots, profile versions, v1 outputs, and calculation versions at `T`. The evaluator may read bounded historical facts but writes only a local artifact. It must not replay ingestion or mutate Tiger. Swords & Slippers is an additional named golden fixture even if sampling would exclude it.

### Fixtures and labels

Required fixtures cover: new unreleased with no traction; newly released with zero vs unavailable traction; strong/weak/declining/conflicting released traction; first observation vs substantive material change; delayed enrichment at `71:59:59`, `72:00:00`, and after 30 days; single and multiple profile matches; missing optional evidence; known required/preferred negatives; sparse/full cohorts; stale/conflicting sources; malicious/markup/entity/emoji/over-cap descriptions; all three confidence labels; legacy/malformed result JSON; and delivery batches of 1/10.

For traction calibration, compute features only from facts available at each matured observation time `T`. Evaluation labels use subsequent review and CCU movement at `T+30` and `T+90`; no future fact may enter a feature. Fit/evaluate candidate five-point weight grids with rolling time splits, never random leakage, and report both horizons. The current relevance sample has no future outcome label and is used only for distribution, explanation, and human review. Discovery does not optimize on absent traction: future traction is an evaluation outcome only. Material-change examples receive blinded expert labels for event significance and review usefulness because no repository truth label exists.

Two publisher-domain reviewers independently perform at least `150` blinded pairwise judgments stratified by policy: “Which result should be reviewed first for this profile?” Disagreements are retained, not resolved into fake certainty; report inter-rater agreement and a third adjudication only for qualitative error analysis. This is a rollout input, not database data.

### Evaluation table and launch gates

| Dimension                    | Required report                                                                     | Pass gate before v2 ordering                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eligibility correctness      | Confusion table for eligible/pending/ineligible and reason-code examples            | `100%` parity with existing hard-rule truth on the sealed inputs; no result emitted for pending/ineligible.                                                                                                    |
| Applicability                | Counts by available/unavailable/not-applicable and assessment; new/unreleased audit | `0` new/unreleased rows penalized for absent reviews/CCU; `0` known negatives mislabeled unavailable.                                                                                                          |
| Swords regression            | Full v1/v2 component and explanation diff                                           | Eligible discovery/new-game; reviews/CCU `not_applicable`; original first-observed time retained; description meaning retained; no traction-based demotion.                                                    |
| Multi-profile                | Per-match decisions and winner recomputation                                        | `100%` independent contracts and deterministic winner parity for every sampled multi-match row.                                                                                                                |
| Distribution                 | Histograms/quantiles by policy/lane/band plus top/bottom 20 explanations            | No unexplained single 1-point bin contains `>25%` and no band contains `>80%` of a policy with `n>=100`; otherwise adjudicate and revise before launch.                                                        |
| Confidence                   | Label/reason distributions, critical/stale/conflict audit                           | `0` high-confidence decisions with a missing/stale critical input or direct conflict; all three labels exercised by fixtures. Natural data need not be forced into every label.                                |
| Traction predictive ordering | NDCG@20 and precision@20 at T+30/T+90 by rolling split                              | Champion is no worse than v1 by more than `2` percentage points in any supported stratum and improves weighted NDCG@20 by `>=5%` overall; otherwise retain v1 traction ordering and do not enable that policy. |
| Human review priority        | Pairwise win/tie/loss overall and by policy, agreement                              | V2 wins `>=65%` of non-ties overall and `>=55%` in each policy with `n>=30`; material-change significance has no critical false-positive pattern.                                                              |
| v1-to-v2 movement            | Biggest rises/falls, false-demotion review, policy/lane matrix                      | Every top-20 rise/fall has an auditable cause; `0` obvious new-title false demotions.                                                                                                                          |
| Performance                  | Query trace, plan, throughput, bytes, pool usage                                    | Every gate in the performance section passes.                                                                                                                                                                  |

Calibration selects traction weights and, if needed, policy-specific band thresholds. The versioned artifact contains snapshot/fixture hashes, code SHA, exact mappings/weights/thresholds, folds, metrics, reviewers/date, known limitations, and approval. A failure keeps that policy in shadow or v1 order; it does not block independently passing discovery UI work.

## Correctness and UX Verification Matrix

| Layer                | Automated verification required                                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure ranking         | Table-driven tests for eligibility-before-priority, explicit/legacy policy selection, exact weight renormalization, lane order, score/band boundaries, null-all-components, known-negative vs unavailable vs N/A, confidence critical/freshness/cohort/conflict boundaries, and deterministic tie breaks. |
| Time semantics       | Fake-clock tests at 24h/72h/30d boundaries; reprocessing/enrichment changes `eligibleAt` but never immutable `firstObservedAt` or effective event time. First observation can never become material change.                                                                                               |
| Persistence          | Round-trip every v2 field through result/profile JSON; winning-copy equals winning match; all match IDs retained; legacy confidence compatibility maps limited->directional; malformed/unknown versions fail closed; publication is atomic.                                                               |
| Description          | Entity decoding, markup/control/bidi removal, whitespace, Unicode grapheme/byte caps, priority order, structured/unavailable fallbacks, provenance/hash/version, React/channel escaping, and no Steam/R2 consumer call.                                                                                   |
| Repository/contracts | Snapshot SQL/type tests prove fields ride existing rule/list/detail/delivery queries; list compact shape excludes full component arrays; comparable `appid` present; query trace exact. Query API and duplicated admin types accept v1 and v2.                                                            |
| Delivery             | Email/Slack text is parity-derived from the canonical summary, safe/truncated, and set-based for 1/10 deliveries with `4-5` calls. No channel recomputation.                                                                                                                                              |
| List UI              | Component tests for every list-state row, reason/profile ordering, no prominent score, accessible confidence keyboard/touch/Escape/focus behavior, legacy/malformed rows, missing art, and mobile layout.                                                                                                 |
| Detail UI            | Tests for identical list/detail decision, every traction state, expandable audit/methodology, available zero vs unavailable, multi-profile decisions, and safe accessible Steam links.                                                                                                                    |
| End to end           | One fixture per policy plus Swords flows worker contract -> list -> detail -> delivery; assert descriptions, winner, reasons, confidence, and timestamps are byte/semantic parity as specified.                                                                                                           |
| Static/quality       | Targeted node/admin/query-api tests, `pnpm check-types`, `pnpm lint`, formatting check, accessibility scan, and manual keyboard/touch/narrow/wide review.                                                                                                                                                 |

Manual visual QA must capture list and detail at approximately `375`, `768`, and `1440` CSS pixels for loading, empty/error, Swords/no-traction, full-traction, multi-profile, limited-confidence, and legacy states. Verify heading order, truncation, focus visibility, zoom at `200%`, text contrast, no color-only meaning, and no horizontal overflow. Keep screenshots as implementation evidence; this planning phase does not create UI mockups or change the app.

## Rollout, Observability, Compatibility, and Rollback

### Approval and migration boundary

The preferred design adds no table, column, index, dependency, service, endpoint, or read query. It does require a future `0102_opportunity_review_priority_v2.sql` that additively replaces `ops.capture_storefront_sync_readiness_v1()` so new natural storefront captures copy the bounded description/readiness object into existing provenance. Applying it is a production write and is **not approved here**. Before application, request explicit approval with: change = replace one function, no data rewrite; reason = materialize description without runtime reads; risk = medium because it touches readiness capture; rollback = restore the prior function definition and leave already-written additive JSON keys harmless. There is no launch backfill.

### Phased rollout

1. **Offline implementation:** pure v2/types/presenters, local SQL migration test, golden fixtures, query tracer, and performance harness. Feature defaults remain v1.
2. **Read-only shadow:** run the bounded shadow evaluator on the sealed sample; persist only local artifacts. Complete calibration/human/performance gates.
3. **Approved ingestion/dual-write:** after migration/deployment approvals, capture description provenance on new natural snapshots and write v2 JSON alongside unchanged v1 score/components. UI and ordering remain v1; monitor contract completeness for at least two natural daily runs.
4. **Internal presentation:** enable v2 list/detail/delivery presentation for named internal users/workspaces while keeping ordering v1. Verify parity, accessibility, payload, errors, and support feedback for at least two business days.
5. **Policy ordering canary:** enable v2 order separately for each calibrated policy at `10%`, then `50%`, then `100%` of internal workspaces, with at least one completed natural run and gate review per step. A failing traction policy remains v1/shadow while discovery can proceed.
6. **General default:** v2 applies only to newly evaluated results. Legacy v1 rows age out through natural evaluation; no hidden replay/backfill. Retain dual-read/dual-write compatibility for at least one normal retention window before separately proposing v1 removal.

Feature controls must separately gate `computeV2`, `presentV2`, and each policy's `orderV2`. Use the repository's existing configuration pattern discovered during implementation; if none exists, stop and present code-level/config options rather than inventing a service or database flag.

### Observability and stop/rollback rules

Per calculation version and policy, emit existing structured logs/metrics for evaluation counts, lanes/bands, confidence/reason codes, unavailable/N/A/negative rates, description kind/bytes, multi-profile winner mismatch, malformed/legacy fallback, worker phase/throughput, SQL count, API p50/p95/bytes/errors, pool peak, delivery hydration count, and Steam/R2 read-call counters.

Immediately stop the rollout step and disable the relevant `orderV2`/`presentV2` flag on any: query-count increase; N+1 signature; runtime/buffer/throughput/API/payload/pool gate failure; Steam/R2 read call; winner/list-detail-delivery mismatch; unknown-version rendering; description escaping issue; high confidence with missing critical evidence; or Swords regression. Keep `computeV2` on only when the issue is purely presentational and writes remain valid.

Rollback is configuration/code rollback to v1 readers/order, restoration of the old readiness function if capture is implicated, and suspension of affected deliveries if their parity/safety is uncertain. Do not delete v2 JSON or rewrite results. Because root v1 score/components remain intact and v2 limited maps safely in the compatibility column, old code can read all dual-written rows. Document incident window/version and rerun the failed gate before resuming.

## File-by-File Implementation Sequence

This is a dependency-ordered future sequence, not authorization to edit these files now. Keep modules single-purpose and add no dependency; use existing TypeScript/Intl/React facilities.

| Step | Files owned by the step                                                                                                                                                                                    | Exact change and verification                                                                                                                                                                                       | Dependency / risk                                                                       |
| ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
|    0 | `packages/data-plane/src/opportunity/performance-benchmark.ts`, `performance-benchmark.test.ts`, `packages/data-plane/src/scripts/benchmark-opportunity-evaluation.ts`                                     | Before application edits, extend the existing benchmark owner with normalized SQL tracing/plan/payload/pool output if needed, then capture and seal every numeric baseline/golden trace in the performance section. | First gate; read-only/local fixtures, no production write. No new script or dependency. |
|    1 | `packages/data-plane/src/opportunity/types.ts`, `apps/admin/src/app/(main)/opportunities/lib/types.ts`                                                                                                     | Add discriminated v1/v2 contracts, policy/lane/input/confidence/description types and compatibility parsers. Contract fixtures for malformed/unknown/legacy.                                                        | Foundation; medium risk from duplicated admin types.                                    |
|    2 | `packages/ingestion/src/change-intel/storefront.ts`, `storefront.test.ts`, `types.ts`                                                                                                                      | Produce the bounded sanitized description/readiness summary using the exact selection/cap contract.                                                                                                                 | No DB access; high security/copy risk.                                                  |
|    3 | `packages/ingestion/src/change-intel/tiger-repository.ts`, `tiger-repository.test.ts`                                                                                                                      | Include the bounded object in the existing snapshot summary/write parameters; prove no extra statement.                                                                                                             | Depends 2; medium payload risk.                                                         |
|    4 | new `packages/data-plane/sql/tiger-bootstrap/0102_opportunity_review_priority_v2.sql`, `packages/data-plane/src/opportunity/migration.test.ts`                                                             | Additively replace the readiness capture function to copy the object into existing provenance; no table/column/index/backfill. Test locally and capture before/after function/plan evidence.                        | Depends 3; high, separately approved DB-write gate.                                     |
|    5 | `packages/data-plane/src/opportunity/repository.ts`, `repository.test.ts`, `worker-repository.ts`, `worker-repository.test.ts`                                                                             | Select/parse description and readiness facts from the already-joined readiness row; extend existing persistence JSON. Golden SQL trace proves zero new call/plan node.                                              | Depends 1/4; highest load risk.                                                         |
|    6 | `packages/data-plane/src/opportunity/intelligence.ts`, `intelligence.test.ts`                                                                                                                              | Implement pure input states, three policy component calculators, confidence, bands, sort tuples, descriptions/reasons, and exact boundary tests.                                                                    | Depends 1/5; high correctness/calibration risk.                                         |
|    7 | `packages/data-plane/src/opportunity/worker.ts`, `worker.test.ts`, `material-events.ts`, `material-events.test.ts`                                                                                         | Resolve explicit/legacy intent, eligibility/lane, independently evaluate matches, select winner, preserve source time, and assemble compact/full envelopes.                                                         | Depends 6; high orchestration risk.                                                     |
|    8 | `packages/data-plane/src/opportunity/worker-repository.ts`, `persistence-parity.test.ts`, `report-generation.test.ts`                                                                                      | Atomically dual-write v1 compatibility and v2 JSON; assert winning/all-match/source/version parity.                                                                                                                 | Depends 7; high rollback-contract risk.                                                 |
|    9 | `packages/data-plane/src/opportunity/delivery.ts`, `delivery.test.ts`                                                                                                                                      | Replace per-delivery hydration with one set-based result/match query plus optional taxonomy query, then present canonical v2 text. Assert `4-5` calls for D=1/10 and zero recomputation/archive calls.              | Depends 8; high query/delivery risk.                                                    |
|   10 | `packages/data-plane/src/opportunity/performance-benchmark.ts`, `performance-benchmark.test.ts`, `packages/data-plane/src/scripts/benchmark-opportunity-evaluation.ts`, `shadow-opportunity-evaluation.ts` | Run the sealed sample/calibration in the existing shadow owner, capture after traces and paired p50/p95/plan/payload/pool/throughput artifacts, and compare them with Step 0.                                       | Depends 5-9; read-only shadow and local artifacts only.                                 |
|   11 | `packages/data-plane/src/opportunity/repository.ts`, `repository.test.ts`, `types.ts`, `index.ts`                                                                                                          | Return compact v2 fields on list and full match/audit fields on detail from existing queries; include comparable app IDs.                                                                                           | Depends 8; payload/query-plan risk.                                                     |
|   12 | `apps/query-api/src/opportunity-routes.ts`, `opportunity-routes.test.ts`, `apps/admin/src/app/(main)/opportunities/lib/api.ts`, `api.test.ts`                                                              | Preserve endpoints/proxy; validate v1/v2 envelopes, errors, and byte caps without policy logic.                                                                                                                     | Depends 11; medium compatibility risk.                                                  |
|   13 | `apps/admin/src/app/(main)/opportunities/ProfileBuilder.tsx`, `lib/rule-builder.ts`, `rule-builder.test.ts`                                                                                                | Require/save explicit policy intent for new/cloned profiles and display legacy-inference notice/recommendations.                                                                                                    | Depends 1; behavior change requires product acceptance in internal rollout.             |
|   14 | `apps/admin/src/app/(main)/opportunities/OpportunityWorkspace.tsx` plus a colocated test following existing test conventions                                                                               | Implement card IA and every list state/accessibility behavior from the matrix; no calculations.                                                                                                                     | Depends 12; visual/accessibility risk.                                                  |
|   15 | `apps/admin/src/app/(main)/opportunities/games/[appid]/OpportunityGameRecordClient.tsx`, `page.tsx` plus colocated tests                                                                                   | Implement matching header/audit/current-results states and safe Steam comparable links.                                                                                                                             | Depends 12/14; parity/accessibility risk.                                               |
|   16 | Targeted tests above, repository-wide type/lint, manual visual QA, performance/backtest artifacts, and this specification                                                                                  | Run the full correctness/performance/calibration/rollout checklist; record the chosen version/config and unresolved limitations.                                                                                    | Release gate; any failed hard gate stops rollout.                                       |

Step 4 is the only planned schema-definition file and changes function behavior only; it is not a no-schema alternative to skip casually, because without it new relational opportunity rows cannot carry source description copy while runtime R2 is prohibited. The rejected snapshot join and a new column/projection are strictly worse under current evidence. If approval for Step 4 is not granted, ship no source-description claim and keep the honest fallback; the rest of v2 can remain shadow/planning work.

## Final Decision / Evidence / Gap Ledger — Iteration 3

| Classification              | Decision or claim                                                                                                                                                 | Evidence / acceptance proof                                                              | Residual gap or owner                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Confirmed fact              | Current v1 is universal, missing traction defaults to neutral, confidence is collapsed, and multiple matches are blended.                                         | Repository paths, latest bounded 10k distribution, Swords row, and tests recorded above. | None for planning.                                                                                                            |
| Confirmed fact              | JSON result/profile surfaces and existing readiness join can carry v2 without result columns or a new read.                                                       | Live constraints/columns plus selected/rejected plan probes.                             | Function replacement must be locally tested and separately approved before apply.                                             |
| Final recommendation        | Use per-profile policies, independent decisions, applicability-aware denominators, separate confidence, deterministic winning tuple, and compact canonical reads. | Field-level contracts and test matrix.                                                   | Traction champion/thresholds remain a deliberate rollout gate, not an implementation guess.                                   |
| Final recommendation        | Permit <=5% paired in-statement/path work but zero new round trips/N+1/runtime Steam/R2.                                                                          | User's minimal-load clarification and exact budgets/gates.                               | Future implementer must capture paired baseline before code edits.                                                            |
| Resolved UX                 | List/detail state machines, no-traction treatment, confidence interaction, comparable links, legacy/malformed/mobile/error states are specified.                  | IA/state tables and manual/automated QA matrix.                                          | Visual polish is verified during internal presentation; no mockup was required for planning.                                  |
| Resolved rollout            | Dual-write preserves v1, v2 policies can canary independently, no backfill, and rollback requires no data deletion.                                               | Compatibility envelope and phased controls.                                              | Existing feature-control pattern must be selected during implementation; stop if none exists and seek architecture direction. |
| Unresolved but non-blocking | There is no current labeled human “review first” truth set.                                                                                                       | Repository/live inspection found none.                                                   | Collect bounded blinded judgments; traction/material ordering cannot leave shadow until gates pass.                           |
| Unapproved future write     | Replace the readiness capture function; no table/index/backfill.                                                                                                  | Only defensible description path under plan/load evidence.                               | Explicit production-write approval with change/reason/risk/rollback is the smallest later permission.                         |
| Explicitly out of scope     | Historical description repair, v1 row replay, new projection/index/cache/service, and v1 data deletion.                                                           | Not needed for safe dual-read rollout and prohibited in this goal.                       | Separate proposal and approval only if later desired.                                                                         |

The plan has a defensible path within current constraints. It does not claim that the uncalibrated traction seed is production-ready, that the future migration is approved, or that production performance passes before paired implementation measurements exist.

## Implementation and Release-Gate Evidence — Iteration 4

The user subsequently authorized implementation and a GitHub/production rollout. That authorization does not waive this specification's correctness, performance, calibration, or database-write gates. The implementation remains fail-closed behind independent controls whose unset/default value is off:

- `OPPORTUNITY_PRIORITY_V2_COMPUTE=1` permits v2 calculation and dual-write;
- `NEXT_PUBLIC_OPPORTUNITY_PRIORITY_V2_PRESENTATION=1` and `OPPORTUNITY_PRIORITY_V2_PRESENTATION=1` permit admin/delivery presentation;
- the three policy-specific `OPPORTUNITY_PRIORITY_V2_ORDER_*` controls are rejected at startup until calibration is sealed.

Current application behavior and v1 ordering therefore remain unchanged unless an explicit control is enabled. No application consumer adds a Tiger statement, no result/profile loop contains a query, and no read-time Steam or R2 lookup exists. Delivery hydration is reduced from `3 + D * (1 or 2)` to exactly four round trips for `D=1` and `D=10` without taxonomy and five with one set-based taxonomy lookup. The bounded production persistence validator planned nine existing statement families and committed a read-only transaction in `1208.68ms`; it performed no write.

### Paired worker-path performance result

The production-scale fixture used `3,974` candidates, three policies/profiles, and `1,245` surfaced results. Five unrecorded warmups preceded 30 alternating, sequential v1/v2 measurements. Output was deterministic across cold/warm passes. V2's cross-platform-canonical sealed digest is `406bbe0ea37853f6f969ea0ed78e091a2424796d730c506dc361024196f0fa21`.

| Path        |          v1 p50 / p95 |          v2 p50 / p95 | Runtime ratio p50 / p95 | Throughput ratio p50 / p95 | `<=5%` gate |
| ----------- | --------------------: | --------------------: | ----------------------: | -------------------------: | ----------- |
| Cold cohort | `230.115 / 365.474ms` | `391.200 / 458.267ms` |         `1.700 / 1.962` |            `0.585 / 0.798` | **Fail**    |
| Warm cohort | `220.660 / 383.893ms` | `369.494 / 510.349ms` |         `1.604 / 2.052` |            `0.618 / 0.886` | **Fail**    |

A diagnostic single pass localized the added cost to both pure calculation and the required larger persisted envelope: warm market/calculation time increased from about `21.05ms` to `48.06ms`, while persistence serialization increased from about `86.91ms` to `154.67ms`. The gap is material, not measurement noise, and cannot be waived by the unchanged Tiger query count. `computeV2`, all presentation controls, and every v2 ordering control must remain off. The smallest technical path forward is to reduce the stored/audited envelope and evaluator work without weakening the final data contract, then rerun the same 5/30 paired gate; if that is impossible, the product/load budget or full-audit persistence requirement needs an explicit product decision.

### Correctness and UI evidence

The implementation verification completed with:

- data-plane: `265/265` tests;
- ingestion change-intel: `56/56` tests;
- Query API: `32/32` tests;
- admin: `275/275` tests;
- data-plane, ingestion, and Query API TypeScript checks passing;
- admin production builds passing with presentation both off and on;
- Swords & Slippers, inclusive 72-hour discovery grace, known-zero versus unavailable traction, deterministic multi-profile tie-breaking, unknown-version fail-closed parsing, bulk/legacy persistence parity, and delivery `D=1/D=10` round-trip invariance covered by named tests.

Authenticated localhost rendered the redesigned route and verified its failure state, but its Supabase browser session did not yield a server-side access token for the internal opportunity calls, so the browser received HTTP `401` for `bootstrap` and `daily-brief`. That is an environment/session blocker for live list/detail visual-state capture, not a passing end-to-end UI result. The exact remaining UI evidence is the `375/768/1440` loading, empty/error, Swords/no-traction, full-traction, multi-profile, limited-confidence, and legacy matrix after a valid local session or an approved preview deployment.

The first GitHub Actions run for draft PR `#111` passed builds and type checks but failed the production-scale benchmark's hard-coded raw SHA. Cold/warm output parity had already passed; the only mismatch was the raw v2 digest (`27fa...` on macOS arm64 versus `bbb26...` on Linux x64) under the same Node `20.20.2`. Matching CI timezone and locale did not reproduce the difference, while inspection found raw `Math.log1p`-derived tails in the hashed audit values. The benchmark now canonicalizes finite numeric leaves to 12 decimal places for the digest only, with a regression proving `0.1 + 0.2` equals `0.3` while a `0.000001` semantic change remains detectable. The focused test passes on Node `20.20.2` and Node `26.0.0`, and the full data-plane suite passes `265/265`; application ranking values are unchanged. Actions rerun `31053845092` then passed build, type checks, all repository tests, Playwright browser smoke, and lint in `4m39s` at commit `ccdc329`; Vercel also completed the corresponding preview deployment.

### Claim / evidence / gap ledger — iteration 4

| Classification              | Decision or claim                                                                                                                             | Evidence / acceptance proof                                                                                                       | Residual gap / next action                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Implemented, feature-off    | Versioned policy, confidence, description, persistence, repository, delivery, and UI contracts exist without changing v1 behavior by default. | Full test/type/build evidence above; compile/runtime controls default off.                                                        | Review the implementation diff and publish a GitHub PR only if quality gates remain green.                                |
| Confirmed load shape        | V2 adds zero Tiger round trips, zero loop-dependent queries, and zero read-time Steam/R2 lookups.                                             | Repository SQL ownership, query-count tests, set-based delivery tests, and read-only nine-family validator.                       | Capture exact list/detail/hydration plans on preview/staging before presentation.                                         |
| **Blocked release gate**    | Current v2 worker compute/persistence exceeds the exact performance budget.                                                                   | Paired 5-warmup/30-iteration table above; both cold and warm gates fail materially.                                               | Optimize and rerun; do not enable compute, presentation, or ordering and do not call the implementation production-ready. |
| **Blocked ordering gate**   | Traction ordering has no defensible calibrated champion or human relevance truth set.                                                         | Existing cohort rows lack like-for-like 7/30-day rate distributions; no labeled “review first” dataset exists.                    | Complete the sealed backtest and blinded human review; ordering controls remain startup-blocked.                          |
| **Blocked visual gate**     | The complete responsive/browser matrix is not yet evidenced.                                                                                  | Authenticated route rendered, but opportunity API calls returned `401` because no usable server-side session token was available. | Use a valid local session or an approved preview deployment, then capture all named states and accessibility checks.      |
| Unapproved production write | `0102` replaces one readiness function only; no table, column, index, data rewrite, backfill, or replay.                                      | Local migration shape tests pass; production function remains unchanged.                                                          | Before apply, give change/reason/risk/rollback and obtain explicit database-write approval.                               |
| Rollout decision            | A production rollout cannot advance past dormant code while any hard gate above is red.                                                       | Stop rules in this specification are explicit and the performance gate failed.                                                    | GitHub review may proceed; production enablement/deployment stops until the failed gates are resolved.                    |

### Claim / evidence / gap ledger — iteration 5 (GitHub preview and CI portability)

| Classification                 | Decision or claim                                                                                                                       | Evidence / acceptance proof                                                                                                                                                                                                     | Residual gap / next action                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub preview published       | The feature-off implementation is available for review without changing production behavior or data.                                    | Draft PR `#111` includes fix commit `ccdc329`; its Vercel preview deployment and all GitHub status checks succeeded; all v2 controls remain off and migration `0102` is unapplied.                                              | Keep the PR draft while performance, calibration, and visual gates are red.                                                                        |
| Resolved CI portability defect | The first Actions failure was benchmark digest portability, not cold/warm ranking divergence.                                           | Failed run `31052822639` showed a Linux x64/Node `20.20.2` raw SHA mismatch after `outputParity=true`; canonical-digest regressions pass locally on Node 20/26 and successful rerun `31053845092` passed the complete workflow. | No Priority-v2 CI gap remains; the workflow's Node-action deprecation annotation is separate repository maintenance and not a rollout-gate waiver. |
| Production remains stopped     | A successful preview or green CI cannot waive the measured performance, calibration, complete visual, or explicit database-write gates. | Existing red-gate evidence and fail-closed controls above; no migration, backfill, replay, environment change, or production deployment has been performed.                                                                     | Optimize and recalibrate first; obtain the separately described database-write approval only after every preceding hard gate is green.             |

## Runtime Optimization Evidence — Iteration 6

The worker-path optimization preserves the public `OpportunityReviewPriorityDecision` contract while storing its full audit losslessly as `opportunity-review-priority-storage/v1`. Known fields use versioned tuple/codebook representations; nonstandard future component, input, source, reason, and calculation-version values retain explicit escape forms. The query repository expands v1 compact values before its existing fail-closed decision validator and continues to accept legacy full JSON. The worker retains the full winning decision needed for ranking/presentation, compacts non-winning per-profile audits as each game is finalized, reuses encoded winner objects during persistence, and persists the storage version in `calculation_versions.reviewPriorityStorage`. This changes no SQL statement, schema, Tiger round trip, loop query, or read-time Steam/R2 path.

The benchmark was also corrected where its prior mechanics did not match production:

- output verification is one exact V1/V2 digest pair outside the timing samples rather than full-output SHA work between every sample;
- compact result construction and JSON serialization use the repository's real 100-result batch boundary rather than materializing all 1,245 compact envelopes at once;
- result-finalization/result-persistence work is timed separately from byte-for-byte identical input, profile, cohort, market-context, and candidate-persistence phases;
- the paired p50 ratio uses the mean of each pair's identical phases and preserves each variant's independently measured result-finalization/result-persistence work. Raw unnormalized total p50 remains reported so shared-phase scheduling/GC noise is visible rather than discarded.

Node `20.20.2` is the authoritative runtime because CI and the opportunity production workflows pin Node 20. Each seal used the fixed `3,974`-candidate / three-profile / `1,245`-result fixture, five unrecorded warmups, 30 alternating sequential pairs, and offline local dependencies. The V1 digest remains `7b625cb983f6f151939a62351a2e7c7157b40919bef1e264253ee03a85a44a52`; V2 remains `406bbe0ea37853f6f969ea0ed78e091a2424796d730c506dc361024196f0fa21`; cold/warm parity passed in both seals.

| Seal | Path        | Normalized V1 p50 | Normalized V2 p50 | Runtime ratio p50 | Throughput ratio p50 | Interim `<=1.25x` | Hard `<=1.05x` |
| ---- | ----------- | ----------------: | ----------------: | ----------------: | -------------------: | ----------------- | -------------- |
| A    | Cold cohort |       `180.135ms` |       `217.668ms` |         `1.2111x` |            `0.8250x` | **Pass**          | **Fail**       |
| A    | Warm cohort |       `176.236ms` |       `218.019ms` |         `1.2167x` |            `0.8202x` | **Pass**          | **Fail**       |
| B    | Cold cohort |       `170.542ms` |       `209.989ms` |         `1.2097x` |            `0.8257x` | **Pass**          | **Fail**       |
| B    | Warm cohort |       `165.748ms` |       `203.102ms` |         `1.2255x` |            `0.8139x` | **Pass**          | **Fail**       |

The compact V2 synthetic result envelope is `3,988,657` bytes, down from the pre-optimization `17,467,936` bytes (`77.2%` reduction); the candidate envelope remains `18,331,151` bytes for both variants and the V1 result envelope remains `1,242,462` bytes. A regression caps the V2 result envelope at `4.5 MiB`. The original `<=1.05x` p50/p95 and `>=0.95x` throughput release budgets are intentionally unchanged, so computation, presentation, and ordering controls remain off despite satisfying the requested interim p50 target.

Final verification on August 5, 2026 passed the complete `@publisheriq/data-plane` suite (`269/269`), a focused Node `20.20.2` opportunity contract suite (`77/77`, including Swords & Slippers, compact-storage round trips, repository expansion, bulk persistence parity, and the production-scale fixture), monorepo type-check (`13/13` Turbo tasks), and monorepo lint (`14/14` Turbo tasks, pre-existing warnings only). `git diff --check` passed. A bounded production-Tiger validator used one connection with read-only transaction enforcement, 3-second lock timeout, and 30-second statement timeout; it produced valid `EXPLAIN` plans for all nine existing persistence statements in `922.49ms`. No SQL/schema file or query statement changed.

### Claim / evidence / gap ledger — iteration 6 (runtime p50 optimization)

| Classification                | Decision or claim                                                                                                                  | Evidence / acceptance proof                                                                                                                                                                                 | Residual gap / next action                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resolved interim target**   | V2 normalized cold and warm runtime p50 are each `<=1.25x` V1 on the production Node runtime.                                      | Two consecutive offline Node `20.20.2` 5/30 seals above; worst observed median was warm `1.2255x`; exact V1/V2 digests and cold/warm parity passed.                                                         | Keep the paired-normalization fields and raw totals in every future artifact; a single favorable run is not sufficient evidence.               |
| Lossless storage contract     | The full per-profile audit can be persisted without the former 17.5 MB synthetic result envelope or a public API change.           | `opportunity-review-priority-storage/v1` exact round-trip/legacy/malformed/standard-component tests, repository expansion before validation, bulk/legacy parity, `3,988,657`-byte measured envelope.        | Treat codebooks and tuple meanings as immutable for v1; any incompatible representation requires a new storage version and dual-read coverage. |
| Confirmed load shape          | The optimization adds zero Tiger statements, zero N+1 queries, and zero read-time Steam/R2 calls.                                  | No SQL/schema or query statement changed; all nine persistence statements produced valid bounded read-only plans; `269/269` data-plane, `77/77` Node 20 contract, type-check, lint, and diff checks passed. | Retain the query-count, plan, compact-envelope, persistence-parity, and cross-runtime checks as mandatory CI/release evidence.                 |
| **Blocked hard release gate** | Meeting `<=1.25x` does not satisfy the specification's `<=1.05x` p50/p95, `>=0.95x` throughput, RSS, calibration, or visual gates. | Both seals report `gates.cold=false` and `gates.warm=false`; worst throughput p50 is `0.8139x`; earlier calibration/visual blockers are unchanged.                                                          | Keep all v2 controls off and PR draft; do not deploy/enable production until every original hard gate is green.                                |

## Production Rollout Evidence — Iteration 7

On August 5-6, 2026, the user explicitly accepted the measured `<=1.25x` interim runtime result as sufficient for this rollout stage. That product decision permits compute-only dual-write; it does not change the benchmark's stricter original budgets, approve policy ordering without calibration, or treat incomplete responsive visual evidence as complete.

PR `#111` was squash-merged to main as `4ef3b0a5eaa6677ce30fdea4f5a5dae8b502f317` at `2026-08-06 00:29:39 UTC`. The same revision reached:

- Railway Query API deployment `6660c5df-a3bb-422c-9e05-a9dee4734cce` with `SUCCESS` health and Tiger-backed `/healthz` response;
- Railway feature-off Opportunity worker deployment `0da8d8d5-59fb-4682-98a7-098048aa92d9` with `SUCCESS` startup and all five v2 controls false;
- Vercel production deployment `dpl_HmhUaUa7S2m219jKD8CPeGeiSWsf`, `READY` and assigned to `publisheriq.app`, `www.publisheriq.app`, and the production aliases; and
- main-branch Actions run `31059877248`, which passed build, type checks, repository tests, Playwright browser smoke, and lint in `6m12s`.

The authenticated production `/opportunities` smoke loaded the 142-result Daily Intelligence Desk, opened Swords & Slippers from the canonical list into its exact stored result detail, rendered its unavailable current traction truthfully, and emitted no browser warnings/errors. Because presentation remained off, this verified the unchanged v1 customer surface rather than claiming v2 visual acceptance. Query API emitted no production `5xx` responses in the bounded post-deploy log window.

After the user separately confirmed current Tiger backup/PITR coverage and explicitly approved **Migration + compute**, `0102_opportunity_review_priority_v2.sql` was applied as one PostgreSQL transaction. It replaced and commented only `ops.capture_storefront_sync_readiness_v1()`; it created no table, column, or index and ran no backfill or replay. The live function definition hash changed from `ff324b077e10ca31aedc111b08b15b2f` to `38554aeb76f3115c025d03496236e9cf`; read-only verification found both the `opportunityDescription` and `storefront-readiness/v2` markers and confirmed the existing trigger remained enabled on `ops.sync_status`. A natural storefront capture then wrote `appid 304770` as `storefront-readiness/v2` with an object-valued stored description at `2026-08-06 00:37:59 UTC`.

Only `OPPORTUNITY_PRIORITY_V2_COMPUTE=1` was then set. Worker deployment `f8f32854-8221-400a-89cc-cf71643c3f6a` reached `SUCCESS` on the same code revision and logged `computeReviewPriorityV2=true`, `presentReviewPriorityV2=false`, and all three ordering controls false. It emitted no errors in the bounded post-start log window. The first post-cutover readiness run completed normally but had zero candidates/results, so the first naturally surfaced v2 result and the required two-run dual-write observation remain pending; no work was forced to manufacture passing evidence.

One `market_cohort` retry (`refresh_preset_health`, attempt 5) was observed with an existing SQL alias error. It was created at `2026-08-06 00:00:03 UTC`, more than 29 minutes before code deployment and 40 minutes before compute enablement, so it is not attributed to this rollout. It remains an operational defect to triage separately rather than hiding inside the v2 closeout.

### Claim / evidence / gap ledger — iteration 7 (production compute canary)

| Classification                     | Decision or claim                                                                                                                      | Evidence / acceptance proof                                                                                                                                      | Residual gap / next action                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Explicit performance acceptance    | The user accepted the measured interim runtime for compute-only rollout despite the original stricter budget remaining unmet.          | Two Node 20 seals from Iteration 6 and the user's explicit production-rollout decision.                                                                          | Keep original budgets visible; this is not an ordering, presentation, or general-default waiver.                          |
| Production code deployed           | Query API, worker, and admin run the same merged revision with successful platform and CI checks.                                      | Main `4ef3b0a`; Railway `6660c5df` and `0da8d8d5`; Vercel `dpl_HmhUaUa7S2m219jKD8CPeGeiSWsf`; Actions `31059877248`; authenticated production list/detail smoke. | Retain `3550b61` service revisions as code rollback and `0da8d8d5` as compute-off worker rollback.                        |
| Approved function migration        | New natural storefront readiness captures store bounded description provenance without a read-time Steam/R2 lookup.                    | Atomic `0102` apply, before/after function hashes, enabled-trigger verification, and natural `appid 304770` v2 readiness row with object description.            | Observe ongoing natural capture completeness; rollback is the exact `0089` V1 function without deleting additive JSON.    |
| Compute-only canary live           | New natural evaluations may dual-write lossless v2 audit JSON while v1 presentation, ordering, and delivery copy remain authoritative. | Worker `f8f32854` startup proves compute true, presentation false, and all policy ordering false; no worker errors; no replay/backfill/forced result.            | Verify the first natural v2 result's storage version, list/detail winner parity, query count, payload, and phase timings. |
| Presentation/ordering still gated  | Production customers still see v1 copy and order; uncalibrated policy ordering cannot start.                                           | Vercel presentation variable absent; worker presentation/order false; authenticated Swords list/detail rendered v1 truthfully with no browser errors.            | Complete the named responsive visual matrix and policy calibration before changing presentation/order controls.           |
| Natural-cycle evidence outstanding | Startup and one zero-result readiness run cannot substitute for the planned natural dual-write observation.                            | Two bounded post-cutover reads found no result created after compute enablement; no synthetic production work was triggered.                                     | Observe at least the first v2 result and two completed natural daily runs before proposing internal presentation.         |
| Pre-existing operational defect    | The observed market-cohort retry predates v2 deployment and is not rollout-caused.                                                     | Queue row `121840262` was created at `00:00:03 UTC`; the code deployment began at `00:29:41 UTC` and compute worker at `00:40:19 UTC`.                           | Triage the SQL alias error separately; do not use v2 rollback to claim it is fixed.                                       |

## Scoped Presentation and Ordering Readiness — Iteration 8

The user selected a named-workspace canary, accepted the measured `<=1.25x` interim worker-path result, and subsequently directed the team to stop additional synthetic performance testing in favor of bounded live production report runs and result inspection. This is a product acceptance of live-canary validation, not a claim that the original `<=1.05x`/throughput targets or the prospective T+30/T+90 traction calibration were met. The zero-additional-query, zero-N+1, no read-time Steam/R2, correctness, and rollback gates remain unchanged.

The presentation controls are now designed and locally implemented as two fail-closed pairs: admin `NEXT_PUBLIC_OPPORTUNITY_PRIORITY_V2_PRESENTATION` plus `NEXT_PUBLIC_OPPORTUNITY_PRIORITY_V2_PRESENTATION_WORKSPACE_IDS`, and delivery `OPPORTUNITY_PRIORITY_V2_PRESENTATION` plus `OPPORTUNITY_PRIORITY_V2_PRESENTATION_WORKSPACE_IDS`. An enabled master with an empty or malformed scope fails instead of becoming global; `*` is accepted only as an explicit standalone general-rollout scope. Admin list, profile-builder, and detail presentation evaluate the authenticated record/bootstrap workspace ID. Delivery claim hydration reuses the already-returned `workspace_id`, so this control adds no Tiger statement. A mixed-workspace dispatcher test proves that an allowlisted and unlisted delivery in the same set-based claim receive v2 and v1 copy respectively.

The bounded production recheck after compute enablement found zero `opportunity-ranking/v2` results and zero compact-storage summaries. All five enabled profiles are next naturally due at `2026-08-06 16:00:00 UTC`; therefore the required first natural v2 result and two completed natural daily runs cannot be satisfied before the August 6 and August 7 cycles complete. The five active profile versions still identify `opportunity-ranking/v1` and contain no explicit `rankingPolicy`, so any current v2 calculation uses the documented legacy-inference mapping. No run, replay, backfill, or data mutation was forced to manufacture evidence.

The production revision at the start of this iteration still rejected every `OPPORTUNITY_PRIORITY_V2_ORDER_*` control, assigned `results.rank` from v1 `score`, and read list/cursor/daily-overview/delivery selections in score order. The scoped-canary revision replaces that guard with an atomic all-policy control and an explicit workspace allowlist. Partial policy combinations fail startup, preventing the worker and Query API from silently disagreeing. Feature-off execution retains the original score-rank statement and parameters.

The ordering implementation uses the existing persisted compact tuple without another read. It calculates the v1 ordered slots, sorts only rows with a validated `opportunity-review-priority-storage/v1` tuple, places those rows back into the same occupied slots, and leaves legacy or malformed rows in their exact v1 slots. Validated rows therefore converge to global v2 tuple order while fallback rows retain rollback-safe placement. The same persisted rank drives versioned list cursors, featured/profile selection, daily overview, and delivery selection. Bulk and legacy persistence parity, mode-separated cursor behavior, workspace scoping, and a forced read-only production Tiger `EXPLAIN` of all nine statement families pass. The validator planned and committed its read-only transaction in `943.77ms`; it executed no data write.

The available bounded history still contains only ten result days (`2026-07-27` through `2026-08-05`), cannot supply leakage-safe T+30/T+90 labels, and has no sealed 150-pair/two-reviewer artifact. The user's live-first direction permits an explicitly provisional named-workspace canary; it does not convert the traction seed into a calibrated predictive champion. Report output must be reviewed as product judgment, with immediate flag rollback on implausible traction order, contract mismatch, or Swords/no-traction regression.

### Claim / evidence / gap ledger — iteration 8 (scoped presentation readiness)

| Classification                   | Decision or claim                                                                                                                                                | Evidence / acceptance proof                                                                                                                                                                    | Residual gap / next action                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product decision                 | Use a named-workspace presentation/order canary, accept `<=1.25x`, and perform further performance/relevance validation from bounded live reports.               | Explicit user selections and live-first direction; Iteration 6 paired Node 20 seals.                                                                                                           | Keep original targets and missing calibration visible; live inspection is provisional evidence, not retrospective proof.                                 |
| Resolved control gap             | Presentation can no longer be accidentally enabled for every workspace by one boolean.                                                                           | Fail-closed UUID/wildcard parsers in admin and data plane; admin callers use workspace ID; delivery reuses its claimed `workspace_id`; targeted control/delivery tests pass.                   | Merge/deploy the dormant scoped-control code, then populate only the named internal workspace after natural-run and UI gates pass.                       |
| Structural load preserved        | Workspace-scoped presentation and ordering add zero Tiger round trips and no loop query or external read.                                                        | Admin scope is pure; delivery reuses `workspace_id`; ordering replaces the existing rank SQL; read-only Tiger planned all nine write-path families; hydration remains `4-5` statements.        | Observe live query/API/pool behavior and roll back flags on any new query, N+1 signature, external read, error, or unacceptable latency.                 |
| Blocked natural evidence         | Production has not yet produced a v2 result after compute enablement, and two natural daily runs are temporally impossible before the next two scheduled cycles. | Bounded read-only production counts are zero; all enabled profiles are next due `2026-08-06 16:00:00 UTC`.                                                                                     | Inspect the August 6 result/run, then the August 7 run; do not substitute a forced run for this gate.                                                    |
| Provisional traction evidence    | Current history cannot provide T+30/T+90 labels and no required human pairwise artifact exists.                                                                  | Only ten result days are present; active profiles remain v1-configured; no sealed calibration/reviewer artifact exists in the repository.                                                      | Inspect bounded live output now as authorized, but keep the prospective cohort/reviewer work open and never describe the traction weights as calibrated. |
| Resolved ordering implementation | V2 rank can be enabled atomically for one workspace without changing feature-off SQL or adding a round trip.                                                     | Slot-preserving validated-tuple SQL; persisted-rank readers/cursors; atomic flag parser; bulk/legacy parity; focused `37/37`, root types, Query API `32/32`; read-only nine-family Tiger plan. | Deploy dormant code, configure identical worker/Query API scopes, run bounded reports, and disable all order flags together on any mismatch.             |
| UI/live gate                     | Authenticated production smoke proves only the unchanged v1 surface; V2 must be judged from the canary report and responsive list/detail states.                 | Swords list/detail smoke was clean with presentation off; no natural v2 result existed at the pre-deploy recheck.                                                                              | Run the authorized report, inspect the required widths/states and list-detail-delivery parity, and iterate or roll back before any scope expansion.      |

## Live Canary Evidence and Swords Stop — Iteration 9

PR `#113` passed build, type checks, repository tests, Playwright browser smoke, and lint in Actions run `31063648993`, then squash-merged to `main` as `4aa36a5839f429828a9cd8427144666ca3403172`. The dormant revision reached Railway Query API deployment `13b7b226-04e5-455c-8e5b-809df626c702`, Opportunity worker deployment `51549e6d-0642-432b-9886-3a60df8a69d6`, and Vercel production deployment `dpl_AxaEQeBvZo1MBQD56Vk4bvRqoHgM`. The named Ryan workspace was then the only presentation/order scope. Query API deployment `80b5972d-93be-4776-be3c-b478650caddb`, worker deployment `68afe103-e407-4ad3-acd8-7a127a427d24`, and Vercel deployment `dpl_HPEeMrLSjX8XBLt6f1815rbK5CoE` reached healthy production state; worker startup logged compute, presentation, and atomic all-policy ordering enabled for an allowlist of exactly one workspace.

After explicit approval of the configured email and Slack side effects, idempotent work item `123232095` created live daily run `41613a93-e74f-43c7-a0d3-851d67f8d3be`. It completed on the first attempt with `1,041` candidates, `1,306` evaluations, `146` results, and no suppressed or duplicate rows in `41,350.79ms`. Phase timings were `17,247.39ms` input preparation, `16,185.83ms` cohort resolution, `5,353.99ms` profile evaluation, `50.06ms` market calculation, and `2,513.52ms` persistence. Slack sent its ten-result digest; email correctly dead-lettered with `resend_not_configured`. This is observed live throughput evidence, not a synthetic benchmark or a claim that the original strict performance budgets were met.

All `146/146` new rows carry `opportunity-ranking/v2` and `opportunity-review-priority-storage/v1`. A bounded read-only recomputation of the exact slot-preserving algorithm checked the `231`-row daily scope and found zero persisted-rank mismatches. The live Swords & Slippers row nevertheless failed the named product-correctness gate: app `3563080`, result `09d524cf-a2eb-41f3-96d9-ab07544c5102`, was only about 10.6 hours after its immutable first observation but resolved to `material_change`, `review_soon`, and rank `165` rather than the discovery/new-game lane. The canary was stopped immediately. Query API deployment `b883360f-5b9f-4b1c-aa21-b8809d5b2bf0`, worker deployment `d2e35d69-b185-42aa-9212-03ed52399eb0`, and Vercel deployment `dpl_A1Brf4kEVi96AXHRJu6oodrZbNyA` reached healthy rollback state. Worker startup confirms compute remains enabled while presentation and all ordering controls are disabled.

The root cause is deterministic in `resolveOpportunityPriorityLane()`: the inclusive 72-hour first-observation grace affected discovery freshness scoring but the lane resolver applied age only to the separate 30-day `store_readiness_improved` case. The corrective implementation treats every finite, non-negative event age through exactly 72 hours as `new_game`, retains the readiness-specific 30-day path after that boundary, and rejects invalid or pre-observation timestamps. Named unit coverage reproduces the exact live timestamps, proves the inclusive boundary and one-millisecond-after behavior, and drives the Swords-shaped worker path with a material event rather than `first_observed`. Local verification passed the complete data-plane suite (`282/282`), monorepo type-check (`13/13`), and monorepo lint (`14/14`, pre-existing warnings only).

### Claim / evidence / gap ledger — iteration 9 (live Swords stop)

| Classification       | Decision or claim                                                                                              | Evidence / acceptance proof                                                                                                      | Residual gap / next action                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified live load   | One real scoped report completed without worker failure or added query/load-path behavior.                     | Run `41613a93`, phase timings above, `146/146` versioned rows, zero rank-contract mismatches.                                    | Continue using live run timings and platform logs as the user-approved performance gate; do not relabel them as controlled benchmark proof.              |
| **Correctness stop** | Mechanically valid persisted order is not sufficient when lane semantics are wrong.                            | Swords result `09d524cf` resolved to material-change/rank 165 inside the 72-hour discovery window.                               | Ship the narrow lane fix, rerun one idempotent live report, and require Swords `new_game` plus list/detail/delivery parity before re-enabling the scope. |
| Safe rollback        | The stop preserves additive audit/run evidence and restores V1 customer behavior without data deletion.        | Query API and worker controls were set atomically off; compute remains on; no backfill or replay was run.                        | Verify production startup and admin alias after the rollback deployment, then keep controls off until the corrected revision is healthy.                 |
| Root cause covered   | The lane resolver omitted the general 72-hour age condition and accepted negative ages in its readiness check. | Repository trace plus exact timestamp, inclusive-boundary, invalid-time, pre-observation, and material-event worker regressions. | Pass the complete data-plane suite and CI, deploy the corrected code dormant, then repeat the named live acceptance checks.                              |

## Corrected Canary and Live Presentation Parity — Iteration 10

The narrow discovery-grace correction passed PR `#115` in Actions run `31065528034` and squash-merged to `main` as `0df1471cb22f767e6bc3e88133c1fbfaa44676b0`. The corrected revision reached healthy dormant Query API deployment `7ba89247-b392-4763-83d5-82e5748b4ac1`, worker deployment `a5fb3289-e05b-4c4f-857c-c9a37e4f51a7`, and Vercel production deployment `dpl_2uFKC6mG8p6VM2Hd2yTqz1wRN3Nn`. The same single-workspace presentation/order scope was then restored through Query API deployment `bd1ed201-11f3-4d56-b8da-b22cf5fa1e00`, worker deployment `fd872815-e33c-409f-84f9-f5b01bd90253`, and a healthy Vercel production redeploy. Worker startup again proved compute, scoped presentation, and atomic all-policy ordering were enabled for exactly one workspace.

After a second explicit approval of configured delivery side effects, work item `123808264` created daily run `9a216969-3b3d-4a6f-a5a5-5b3447c5eb19`. It completed with `166` candidates, `169` evaluations, `153` results, `16` pending candidates, and no suppressed or duplicate rows in `23,738.51ms`. Phase timings were `9,694.97ms` input preparation, `11,842.60ms` cohort resolution, `1,013.20ms` profile evaluation, `19.56ms` market calculation, and `1,168.18ms` persistence. Slack sent ten results; email retained the known `resend_not_configured` dead-letter. All `153/153` rows carry the expected v2 decision/storage versions, and a bounded `299`-row daily-scope recomputation found zero persisted-rank mismatches.

Swords & Slippers result `d8b9228e-ebb7-4771-a639-808e8791b68d` now passes the named gate: discovery policy, `new_game`, `review_soon`, high confidence, rank `164`, and the original first-observation timing. It is the first `review_soon` row after `99` `review_now` rows in that bounded scope. This verifies the lane correction and storage order mechanically; the rank is not a claim that the uncalibrated traction/material policies have met the prospective T+30/T+90 or reviewer gates.

Authenticated production inspection then exposed three independent presentation defects. First, `queryBriefFeaturedRows()` returned persisted-rank order, but `dedupeOpportunityBriefGames()` immediately re-sorted candidates by legacy score, making rank `8` The Bleakest Keep 2 the Daily Brief lead while Profile Lists and Tiger correctly began with rank `1` Furmageddon. Second, Profile Lists grouped the correctly ordered v2 cards beneath legacy `event_label` headings, producing combinations such as `Material changes` above `New discovery — Review now`. Third, v2 surfaces appended the noun `market` to the already complete label `Large, competitive market`.

The corrective design is query-neutral. Daily Brief composition compares finite positive persisted rank before its legacy score/time tie-breakers. V2 Profile Lists renders the API sequence as one `Ordered for review` queue, because regrouping by band or raw lane would itself violate the policy-relative persisted tuple; the event-group sections remain behaviorally unchanged when presentation is off. Daily Brief and list cards share pure label/description helpers, profile summaries use neutral match counts rather than conflicting v1 event nouns, and v2 list/brief/detail surfaces render the complete persisted market label without another suffix. These are application-only consumers of fields already present in the existing list/detail/brief results and add zero Tiger statements, zero loop queries, and zero Steam/R2 reads.

### Claim / evidence / gap ledger — iteration 10 (live presentation parity)

| Classification            | Decision or claim                                                                                                 | Evidence / acceptance proof                                                                                  | Residual gap / next action                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Corrected named gate      | The inclusive discovery grace now classifies Swords as a new-game discovery without post-release traction.        | Live result `d8b9228e`, exact lane/band/confidence, `153/153` contracts, and zero `299`-row rank mismatches. | Preserve this result in responsive list/detail smoke after the presentation patch reaches production.                                            |
| Verified live load        | The second real report completed faster than the first and without worker failure.                                | Run `9a216969`, phase timings above, Slack success, and expected unconfigured-email dead-letter.             | Treat this only as the user-approved live canary observation; the controlled original performance gate remains explicitly unclaimed.             |
| Root-caused order defect  | Daily Brief discarded repository rank by applying a second score sort in pure composition.                        | Live rank/profile-list comparison plus `brief.ts` comparator trace.                                          | Require a unit regression and production lead/list equality after deployment.                                                                    |
| Root-caused IA defect     | V2 cards were nested under V1 event headings even though policy lane/band and raw event are different dimensions. | Authenticated production DOM: `Material changes` containing `New discovery — Review now`.                    | Render one persisted-order V2 queue; retain V1 sections when the flag is off; verify filters/load-more and narrow/wide layouts.                  |
| Root-caused copy defect   | A complete market label received a second `market` suffix.                                                        | Authenticated list, brief, and detail source trace.                                                          | Remove only the v2 suffix sites and verify `Large, competitive market` exactly once.                                                             |
| Structural load preserved | All proposed corrections are pure composition/presentation over existing response fields.                         | No repository SQL, endpoint, schema, worker, ingestion, or external-read path is changed.                    | CI/type/lint, production deploy, authenticated console/error check, and responsive smoke remain before calling this correction production-ready. |

## Live Rank Parity and Detail Applicability — Iteration 11

PR `#116` passed build, type checks, repository tests, Playwright browser smoke, lint, and Vercel preview in Actions run `31067592530`, then squash-merged to `main` as `2db3f59e7abef8f157a03bbc7940b2d3dfa4f694`. Production Query API deployment `fe66fe63-9313-40b5-a629-675e88548b12`, Opportunity worker deployment `9906f55c-9fa6-4c81-9805-92848c2f894e`, and Vercel deployment `dpl_3ihdjomPN4otoqoD2q3QbyVGqECs` reached healthy state. The public `publisheriq.app` aliases point to that Vercel deployment, and worker startup confirms compute, presentation, and atomic ordering enabled for exactly one workspace.

Authenticated production DOM inspection verifies the corrected queue parity. The Daily Brief headline and lead card now begin with rank `1` Furmageddon, followed by rank `2` OK JELLY, rank `3` Kingfall, and rank `4` Orbital Margins; The Bleakest Keep 2 appears at rank `8`, matching persisted Tiger order and Profile Lists. Profile Lists now has one `Review priority / Ordered for review` section and preserves the exact API ranks across the first 25 rows. The duplicated suffix is gone: `Large, competitive market` renders as a complete label rather than `Large, competitive market market`. Profile dispatches use neutral v2 match counts while the feature-off path retains the prior event-specific copy.

The same live pass exposed two final detail/presentation inconsistencies. First, a market-derived reason such as `Large, competitive market` remained in the persisted one-to-three why-now reasons and then appeared again as the adjacent market-context label. Second, the corrected Swords result carried all six post-release traction inputs as persisted `not_applicable`, but the detail page selected non-null compatibility values (`0` reviews and `0` review additions) before considering the authoritative v2 input state. The intended empty-state sentence existed in the component but was reachable only when every compatibility metric was null.

The follow-up design remains query-neutral and fail-closed. A shared pure presenter removes only a reason whose normalized text exactly equals the already-rendered complete market label; it does not infer or rewrite any reason. The same exact-match rule is applied in the existing email/Slack formatter, which retains one explicit market-context line. The detail presenter locates the winning profile by persisted `winningProfileId` and requires all six exact post-release input keys to exist with `availability=not_applicable` before overriding compatibility metrics. It then renders the specified unreleased/new state, the persisted demand summary, and at most two peer facts from the already-returned total-review distribution while suppressing selected-game metric/distribution comparisons. Missing or partial decisions do not enter this state. No repository, API, SQL, hydration, worker orchestration, schema, Steam, or R2 path changes.

### Claim / evidence / gap ledger — iteration 11 (rank parity and applicability)

| Classification            | Decision or claim                                                                                                | Evidence / acceptance proof                                                                                                                  | Residual gap / next action                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified production order | Daily Brief, Profile Lists, and persisted rank now agree on the top ten and the lead.                            | Authenticated DOM plus live result IDs/ranks; Furmageddon is lead/rank 1 and The Bleakest Keep 2 is rank 8.                                  | Preserve at `375/768/1440`; exercise load-more without browser-side reorder.                                                                              |
| Verified production IA    | V2 Profile Lists no longer mixes raw V1 event headings with policy labels.                                       | One `Ordered for review` section; first 25 card ranks are `01` through `25` in API order.                                                    | Retain legacy section unit coverage and feature-off behavior.                                                                                             |
| Remaining repetition      | The suffix defect is fixed, but an identical market reason and market label are still shown in two card regions. | Live Furmageddon brief/list DOM.                                                                                                             | Exact-normalized duplicate suppression in the presenter, with a unit regression and live recheck.                                                         |
| **Correctness stop**      | Swords v2 says traction is not applicable, while the detail compatibility metrics present it as measured zero.   | Winning full decision has the six exact traction keys marked `not_applicable`; live detail displays total reviews `0` and reviews added `0`. | Make authoritative decision inputs win over compatibility metrics, then require the specified sentence and no selected-game traction cards in production. |
| Structural load preserved | Both corrections consume only fields already returned by the current detail/list/brief/delivery contracts.       | Admin and delivery formatters only; the delivery `D=1/D=10` hydration tests remain four round trips without taxonomy.                        | CI, merged production deployment, console review, and responsive visual verification remain.                                                              |

## Production-Ready Scoped Rollout — Iteration 12

PR `#117` closed the two Iteration 11 correctness stops. Its exact head `57753a18412160cfbd3b91c354f548ac0295b742` passed build, type checks, repository tests, Playwright browser smoke, lint, and Vercel preview in Actions run `31068417095`, then squash-merged to `main` as `30fecb37681e97a4d2ede8fb14c07883a097a4ab`. Production Query API deployment `e26f8dda-f279-4fc6-ba1c-30d8b626f774`, Opportunity worker deployment `70f63ac1-98bb-491c-8487-95df8a4d6b35`, and Vercel deployment `dpl_H1UyVZ8gxzuiPy8SLK6KGkGypP35` reached healthy state. Vercel attached both `publisheriq.app` and `www.publisheriq.app` to that deployment. Query API startup reports Tiger as its source. Worker startup reports compute, presentation, and ordering enabled, with presentation and ordering each allowlisted to exactly one workspace.

Authenticated production verification passed at `375x900`, `768x1000`, and `1440x1000`. On each width the document `scrollWidth` equaled its `clientWidth`; the 15-pixel difference from the configured viewport was the browser's vertical scrollbar gutter, not horizontal overflow. The console contained no warnings or errors. Daily Brief still leads with Furmageddon, then OK JELLY, Kingfall, and Orbital Margins, and the complete market label appears once in the rendered brief. Profile Lists retains one `Ordered for review` queue, renders ranks `01` through `25` in persisted order, and `Load 25 more` continues at rank `26` without a client-side reorder.

The named Swords & Slippers result `d8b9228e-ebb7-4771-a639-808e8791b68d` now renders `New discovery — Review soon`, reasons `New on Steam` and `Self-published`, and high confidence. Its detail page renders the exact sentence `This game is unreleased, so post-release traction is not applicable yet.`, preserves the persisted demand summary, and reports that `50` comparable released games informed the market with median total Steam reviews of `144`. It does not render a selected-game `Total Steam reviews 0` card. The released-game comparison table remains available. This is a presentation of the authoritative winning v2 decision; it does not reinterpret compatibility zeros as observations.

The load contract remains unchanged. The admin corrections are pure presenters over fields already returned by list, brief, and detail reads. Delivery formatting uses the already-hydrated result and applies only exact-normalized duplicate suppression. Focused delivery coverage passed `14/14`, including the existing `D=1` and `D=10` hydration assertions at four Tiger round trips. No SQL, repository method, API request, loop query, worker orchestration, Steam call, or R2 read was added. The production deployment itself did not trigger a manual report or customer delivery; worker logs show normal queued-work processing with `deliveries=0` during this verification window.

The user accepted live canary observations as the current performance gate, so the two real runs remain the release evidence: run `41613a93` completed in about `41.35s`; corrected run `9a216969` completed in `23,738.51ms`, with `9,694.97ms` input preparation, `11,842.60ms` cohort resolution, `1,013.20ms` profile evaluation, `19.56ms` market calculation, and `1,168.18ms` persistence. This is evidence that the named one-workspace rollout operates under real load, not a controlled before/after throughput proof. The repeatable query-plan, throughput, T+30/T+90 maturation, and human-relevance procedures in this specification remain the required gates before broadening the policy beyond the current allowlisted production scope.

### Claim / evidence / gap ledger — iteration 12 (production-ready scoped rollout)

| Classification               | Decision or claim                                                                                                                         | Evidence / acceptance proof                                                                                                                        | Residual gap / next action                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified release             | The reviewed corrections are merged and healthy on all production targets.                                                                | PR `#117`, Actions run `31068417095`, main `30fecb3`, Railway deployments `e26f8dda` and `70f63ac1`, Vercel `dpl_H1Uy`.                            | Continue ordinary error and delivery monitoring; no release repair is open for the scoped rollout.                                                                                       |
| Verified ordering/IA         | Brief, profile queue, and persisted rank agree; pagination preserves the sequence.                                                        | Authenticated top-four inspection, ranks `01`-`25`, and load-more beginning at `26`.                                                               | Recheck after any future ranking tuple, grouping, or pagination change.                                                                                                                  |
| Verified detail correctness  | Swords presents post-release traction as not applicable, not measured zero.                                                               | Exact production result, decision/reason/confidence labels, required empty-state sentence, peer facts, and absence of the selected-game zero card. | Add future fixtures if another input family gains an applicability state.                                                                                                                |
| Verified responsive behavior | List and detail are usable without document-level horizontal overflow at the three required widths.                                       | `scrollWidth === clientWidth` at `375`, `768`, and `1440`; no browser console warnings/errors.                                                     | Keep these widths in release smoke coverage.                                                                                                                                             |
| Verified load invariants     | The final fixes add zero Tiger statements, zero N+1 behavior, and zero read-time Steam/R2 lookups.                                        | Pure presenter/formatter diff, `14/14` delivery tests, and constant four-round-trip `D=1/D=10` hydration assertions.                               | Preserve the exact budgets and rerun the specified query-plan/throughput gates for any data-path change.                                                                                 |
| Scoped production readiness  | Opportunity Review Priority v2 is production-ready for the current one-workspace allowlist under the user-approved live-performance gate. | Two completed real runs, corrected named result, deployed list/detail/delivery presentation, healthy services.                                     | Global or larger-scope enablement remains governed by the prospective calibration, human-label, controlled-throughput, and stop-rule gates; it is not implied by this scoped acceptance. |

## Deliverables for This Planning Goal

The planning goal is complete only when this specification is updated to contain:

1. a verified current-state code and data-flow map;
2. final field-level ranking and confidence contracts;
3. definitions and calibration approach for all three policies;
4. list and detail information architecture, including empty/unavailable states;
5. description provenance and fallback behavior;
6. exact query-round-trip budgets for every affected path;
7. repeatable baseline and future performance-test procedures;
8. backtest fixtures, sample-selection method, and evaluation table;
9. rollout, observability, rollback, and compatibility plan;
10. a file-by-file implementation sequence with dependencies and risk notes;
11. a decisions/open-questions ledger that separates confirmed facts, recommendations, unresolved choices, and blocked evidence.

### Completion audit

| Required deliverable                   | Verified section(s)                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current-state code/data map            | `Verified Current State and Evidence Ledger` including exact owners, live result/schema constraints, query counts, and selected/rejected description plans                                                                                                                                            |
| Final ranking/confidence/data contract | `Final Ranking, Applicability, and Confidence Contract` including exact policy math, input states, order tuple, confidence precedence, persistence, and description provenance                                                                                                                        |
| All list/detail UI states              | `Final Opportunity List Information Architecture`, `Final Opportunity Game Record Information Architecture`, and `Correctness and UX Verification Matrix`                                                                                                                                             |
| Exact load budgets/procedures          | `Exact Tiger Round-Trip and Payload Budgets` and `Repeatable Query-Plan, Throughput, and API Verification`                                                                                                                                                                                            |
| Calibration/backtest                   | `Backtest, Calibration, and Human-Relevance Plan`, including sealed current/matured samples, fixtures, leakage controls, and numeric launch gates                                                                                                                                                     |
| Rollout/rollback/compatibility         | `Rollout, Observability, Compatibility, and Rollback`, with independent policy canaries, stop rules, and no-backfill dual-read safety                                                                                                                                                                 |
| File sequence                          | `File-by-File Implementation Sequence`, beginning with the paired baseline and ending with release evidence                                                                                                                                                                                           |
| Evidence/gaps                          | Iteration 1-12 ledgers, with measured and explicitly unclaimed performance evidence, scoped-presentation control, live-run and corrected Swords evidence, responsive browser verification, natural-run status, human labels/calibrated traction, and readiness-function evidence explicitly separated |

## Completion and Blocked Conditions

Do not mark the planning goal complete merely because this document exists. Completion requires evidence for the deliverables above and an internally consistent implementation plan that obeys the exact minimal-load constraint.

If a claim cannot be verified, label it as uncertain. If no defensible plan can meet the requirements with the allowed read-only inputs, stop with:

- paths attempted;
- evidence gathered;
- the exact blocker;
- remaining uncertainty;
- the smallest user decision, permission, environment change, or missing input needed to continue.
