# Opportunity MVP Completion Audit — July 27, 2026

This audit maps the Custom Daily Steam Opportunity Brief objective and its three
canonical repository specifications to current implementation evidence. It
distinguishes code/test completion from production evidence; a green local or
CI check is not treated as proof that the deployed Tiger domain works in
production.

## Status

- Feature PR: `#86`, merged.
- Production bootstrap repair: PR `#87`, merged as `a5d3716`.
- Material-event parameter repair: PR `#88`, merged as `d7f575d`.
- Lease-safe materialization repair: PR `#89`, merged as `e33b22b`.
- Source-timestamp propagation: PR `#91`, merged as `13e327a`.
- Production acceptance closeout: PR `#92`, merged as `2e4485e`.
- Production schema state: `0097_opportunity_mvp.sql` and
  `0098_opportunity_preset_seed.sql` applied under the explicitly approved
  production window.
- Production runtime state: query API and the single-replica Railway
  opportunity worker are healthy on the source-timestamp implementation. The
  docs-only PR #92 correctly skipped the worker deploy; its query-API rebuild
  completed successfully and returned a Tiger-backed healthy response.
- Production delivery state: the encryption key and dispatcher process are
  available. The smoke workspace has no external channel preference or delivery
  row. The user explicitly accepted omitting live email and Slack delivery
  because no designated destinations exist; no external address or webhook was
  invented.

The bounded read-only production closeout on July 27 confirmed:

| Check                                 | Live result                                       |
| ------------------------------------- | ------------------------------------------------- |
| Opportunity schema and launch presets | Applied; eight preset-health snapshots created    |
| Smoke workspace                       | `f80bdd3a-7185-4f00-a9ee-48b80439acb1`            |
| Smoke profile                         | `a77e184d-8215-4558-b815-f79123776fc4`, enabled   |
| Profile schedule                      | `America/Los_Angeles`, 09:00 local                |
| Daily runs                            | 3 completed, 0 failed                             |
| First non-empty daily evaluation      | 171 evaluated, 3 results, 168 pending             |
| Canonical results                     | 3 immutable results                               |
| First post-fix readiness cycle        | 181 completed, 1 resolved ineligible, 167 pending |
| Material events at 21:05 UTC          | 6,223 events / 6,223 distinct fingerprints        |
| First post-fix bounded batch          | 350 events in `2m21.099s`                         |
| Second post-fix bounded batch         | 323 events in `2m18.640s`                         |
| External preferences / deliveries     | 0 / 0                                             |

## Authoritative-state discrepancies

Repository code and read-only production inspection override older planning
text where they differ:

1. The July 24 preparation notes described a stale PICS head. The July 27
   read-only calibration found the catalog, incremental catalog, and PICS paths
   current. The later evidence is recorded in
   `docs/reference/opportunity-calibration-2026-07-27.md`.
2. The live signal-window population remained sparse: only 10 usable
   review-acceleration and 23 usable CCU-growth observations appeared in the
   bounded calibration sample. Preset health therefore fails closed to
   `insufficient_data`, and its movement thresholds remain explicitly
   provisional.
3. The first production materialization attempt exposed two runtime-only
   defects not found by broad green checks: untyped PostgreSQL parameters in
   queue fan-out and a batch duration longer than the five-minute queue lease.
   PRs `#88` and `#89` repaired both. Two consecutive production batches then
   completed inside the lease with periodic renewal and exact fingerprint
   uniqueness.
4. The explicitly approved daily evaluation after material-event recovery
   evaluated 171 candidates, persisted three correctly matched and ranked
   results, and retained 168 tag-unknown candidates for readiness rechecks.
   That run exposed one repository provenance defect: catalog, storefront, and
   PICS readiness timestamps were discarded before result persistence. PR #91
   repaired the mapping and added repository/worker regressions. The original
   three immutable results correctly retain their pre-fix nulls; a merged-path
   read-only query against their production apps proves the corrected
   catalog/PICS timestamps, both present storefront timestamps, and the one
   genuinely absent storefront row. The first complete post-fix readiness cycle
   then processed 181 queue items without a worker error. `Immortal Generals`
   (`4739690`) naturally moved from pending to ineligible after PICS tags became
   available: both required `ALL` tag clauses failed, the adult exclusion
   remained false, and the small-publisher preference passed. Its persisted
   rule outcomes carry the real PICS source time
   `2026-07-27T22:48:48.955Z` and storefront source time
   `2026-07-27T20:47:54.851Z`. This directly proves post-fix tri-state
   re-evaluation and rule provenance, but it correctly created no result. A
   newly persisted post-fix matching result remains the final time-gated
   acceptance artifact.

## Requirement-to-evidence matrix

| Requirement                                                                                                                    | Authoritative implementation evidence                                                                                                                                    | Verification evidence                                                                                                                     | Audit result                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Supabase remains the auth/session authority; Tiger owns opportunity truth; the browser reaches Tiger only through query API    | `apps/query-api/src/opportunity-routes.ts`, `apps/admin/src/app/api/opportunities/[action]/route.ts`, `packages/data-plane/sql/tiger-bootstrap/0097_opportunity_mvp.sql` | Query API auth tests and route tests; production Tiger-backed health                                                                      | Verified in code and production                             |
| Eight visible, immutable PublisherIQ presets and personal clones/blank profiles                                                | `0098_opportunity_preset_seed.sql`, `OpportunityWorkspace.tsx`, `ProfileBuilder.tsx`, repository profile/version transactions                                            | Migration seed test; production bootstrap and cloned-profile smoke                                                                        | Verified in code and production                             |
| Profile lifecycle, local timezone/time, event subscriptions, immediate choice, pause/resume/archive                            | `ProfileBuilder.tsx`, `service.ts`, `repository.ts`, `next_profile_evaluation_v1` in `0097`                                                                              | Delivery-time tests; production enable/pause/resume and schedule smoke                                                                    | Verified in code and production                             |
| Shared required/preferred/excluded tri-state rule engine with ANY/ALL                                                          | `rules.ts`, `sql-compiler.ts`, preview/evaluation service and worker                                                                                                     | Rule-engine and SQL-compiler suites, including unknown-required and unknown-exclusion cases                                               | Verified                                                    |
| Preview exposes total matches, representative sample, elimination funnel, field coverage, warnings, and estimated daily volume | `OpportunityService.previewProfile`, preview compiler/repository, `ProfileBuilder.tsx`                                                                                   | Compiler/rule tests, browser flow tests, and authenticated production preview                                                             | Verified in code and production                             |
| Durable `[last successful, current)` daily window and immutable first-observed/released/material events                        | `createRunContext`, `materializeEvents`, `material-events.ts`, event/cursor tables in `0097`                                                                             | Material-event, recovery, reconciliation, and preservation tests                                                                          | Verified                                                    |
| Required-data waiting and delayed `newly_qualified` behavior                                                                   | Candidate-state/outbox logic in `worker-repository.ts`; `resolveOpportunityResultLabel` in `worker.ts`                                                                   | Tests retain original material-event IDs, distinguish delayed qualification, and ensure readiness runs cannot advance the daily cursor    | Verified                                                    |
| Newly discovered, newly released, newly qualified, subscribed material changes, tracked updates                                | Event classifier and surfacing policy in `material-events.ts` and `worker.ts`                                                                                            | Worker policy and material-event suites                                                                                                   | Verified                                                    |
| Dedupe, dismiss, ignore, track, and event-driven reappearance                                                                  | Result unique key, user-game state, prior fingerprint ledger, reappearance reset                                                                                         | Recovery/preservation tests prove canonical idempotency and dismissal-only reset                                                          | Verified                                                    |
| One canonical per-user/app/event result with all matching profiles and one ranked position                                     | Result transaction and `result_profile_matches`; profile-version set fingerprint                                                                                         | Migration uniqueness and worker assignment tests                                                                                          | Verified                                                    |
| Reproducible match, rank, cohort, context, timestamps, versions, missing evidence, and prior appearances                       | Canonical game-record query and UI reproduction ledger; immutable cohort/market/result snapshots                                                                         | Recovery and provenance tests; authenticated production record replay; read-only merged-path source-timestamp proof                       | Verified except newly persisted post-fix timestamp artifact |
| Explainable 35/30/20/10/5 ranking                                                                                              | `OPPORTUNITY_RANK_WEIGHTS` and persisted component/weight/reason evidence                                                                                                | Intelligence tests                                                                                                                        | Verified                                                    |
| Transparent deterministic released-peer cohorts and directional market context with coverage/concentration warnings            | `getReleasedCohort`, `calculateOpportunityMarketContext`, game-record cohort table                                                                                       | Intelligence tests and bounded production calibration                                                                                     | Verified; directional limitations explicit                  |
| Preset health with conservative coverage, breadth, concentration, multi-signal, and persistence gates                          | `calculateOpportunityPresetHealth`, daily snapshot worker                                                                                                                | Intelligence tests and calibration note                                                                                                   | Verified; production state may remain `insufficient_data`   |
| Workspace-shared viewed/researching activity plus personal profile/dismiss/ignore/track state                                  | Workspace membership, team activity/research state, personal state tables and game-record actions                                                                        | Migration/recovery tests; authenticated viewed marker; browser action/reload regression for track, dismiss, ignore, restore, and research | Verified                                                    |
| Canonical website plus configurable encrypted email/Slack summaries                                                            | Delivery preferences, AES-256-GCM destination cipher, outbox, Resend/Slack providers                                                                                     | Cipher and renderer tests; query API validation                                                                                           | Verified in code; live provider check explicitly waived     |
| Per-user or per-profile delivery, quiet days, maximum results, explicit truncation, idempotency, and failure handling          | Delivery desk, preference-scoped assignment, outbox leases/retries/dead letters                                                                                          | Delivery-assignment, truncation, escaping, recovery, and idempotency tests                                                                | Verified                                                    |
| Rare opt-in immediate alert is first-observed full match only                                                                  | Immediate material-event flag, immediate-only profile evaluation, channel opt-in                                                                                         | Worker policy tests                                                                                                                       | Verified                                                    |
| Railway owns persistent schedule/queue/delivery; GitHub is bounded reconciliation only                                         | `railway-opportunity.json`, worker runner, manual `opportunity-reconcile.yml`                                                                                            | Production single-replica worker plus bounded/manual reconciliation tests                                                                 | Verified in code and production                             |
| Existing product paths and legacy alert storage are preserved                                                                  | Additive migrations, separate `opportunity` schema, no legacy alert writes                                                                                               | Full build/type/lint/test, strict writer audit, 6/6 browser regression, Vercel and GitHub checks                                          | Verified after rollout                                      |

## Correctness findings closed during completion audit

The final audit found and repaired issues that earlier broad green checks did not
cover:

1. Scheduled readiness work now retains its triggering material-event ID.
2. A delayed first-observed/released match is labeled `newly_qualified`, not
   newly discovered/released.
3. Readiness runs have their own run kind, never advance the durable daily
   cursor, never move profile schedules, and are absorbed into the next daily
   brief.
4. Successful daily runs return each profile to its timezone-aware local time
   instead of `now() + 24 hours`.
5. Profile-scoped channel preferences are evaluated instead of silently
   ignored, with per-channel result dedupe and no spill into a user-wide
   destination when a profile-scoped summary is truncated.
6. All enabled profiles share one personal local-time schedule, preserving the
   product's single-daily-brief contract even when a user has several profiles.
7. Profiles can be paused, resumed, and archived from the workspace while
   immutable versions and prior results remain available.
8. Limited summaries disclose the full available count.
9. Missing expected sources remain visible as delayed/blocked health rows, and
   repeated page loads cannot flood shared viewed activity.
10. Demo removal is no longer mislabeled as a demo addition.
11. The canonical record now exposes profile versions, calculation versions,
    run/source/event timestamps, watermarks, and delivery history.
12. Untrusted Steam text is escaped in both email HTML and Slack mrkdwn.
13. Material-event fan-out parameters now bind explicit integer, UUID, and text
    types, closing the production PostgreSQL inference failure.
14. Materialization now reads at most 100 catalog, 100 lifecycle, and 500 raw
    rows per pass, renews its active lease every 50 moments, and claims only one
    global materialization trigger per worker pass.

## Required validation ledger

The branch must retain passing evidence for:

```text
pnpm build
pnpm check-types
pnpm test
pnpm lint
pnpm --filter @publisheriq/ingestion test:change-intel
Python 3.11 PICS pytest suite
pnpm tiger:ingestion-verify
strict writer audit
opportunity Playwright browser suite
git diff --check
```

GitHub Actions and Vercel checks on the final pushed revision must also pass.
Warnings from existing lint debt are recorded separately and are not represented
as new opportunity failures.

The final local pass on July 27 completed with:

| Gate                             | Result                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Build                            | 10/10 Turbo tasks passed, including the Next.js production build                        |
| Type check                       | 13/13 Turbo tasks passed                                                                |
| Full JavaScript/TypeScript tests | Passed; data-plane 154/154 and query API 24/24, with all 10 Turbo test tasks green      |
| Lint                             | Passed with pre-existing warnings and zero errors                                       |
| Change-intelligence tests        | 46/46 passed                                                                            |
| PICS Python 3.11 tests           | 130/130 passed                                                                          |
| Supabase writer audit            | Zero scheduled blockers                                                                 |
| Tiger live read-only verifier    | Core sources/freshness passed; optional Railway env checks and empty alert state warned |
| Playwright                       | 6/6 passed, including record replay, profile preview, and personal/team action reload   |
| Whitespace/patch validation      | `git diff --check` passed                                                               |

## Explicit non-MVP deferrals

These remain deliberately out of scope and are not hidden as missing MVP work:

- automated developer outreach;
- CRM/deal/pipeline management;
- guaranteed revenue or market-size claims;
- automatically generated, published, enabled, or silently modified presets;
- semantic-only cohorts;
- immediate existing-game breakthrough alerts;
- full historical replay before a sufficient run ledger exists; and
- treating partial YouTube coverage as universal absence.

## Remaining production acceptance gate

The schema, presets, authenticated profile lifecycle and preview, one non-empty
daily evaluation, canonical website replay, query API, single Railway worker,
queue recovery, source-timestamp repair, and route regressions now have direct
production or exact-branch evidence.

One artifact still blocks an unqualified “production-complete” claim: a result
persisted by a post-PR-#91 evaluation must expose the corrected
catalog/storefront/PICS timestamps from immutable result evidence. The enabled
profile remains on its normal `America/Los_Angeles` 09:00 schedule. Readiness
rechecks may produce that artifact earlier if a pending tag-dependent candidate
becomes evaluable; otherwise the next normal daily run supplies the opportunity.
The prior one-row trigger approval was consumed and is not reused.

The first post-fix readiness cycle is direct production evidence that the
pending path is working rather than stalled: 181 work items completed without
an error, one candidate resolved against newly available PICS tags and became
ineligible with source-attributed rule outcomes, and 167 candidates remained
pending instead of being converted to false. It did not happen to produce a
qualifying match, so it cannot substitute for the remaining immutable-result
check.

Live email and Slack dispatch are explicitly accepted as untested in this
environment because no test recipient or webhook is configured. Automated
coverage still proves encryption, canonical-link projection, truncation,
escaping, retries, dead letters, and idempotency. Live mutating
dismiss/ignore/track/researching smoke is likewise unnecessary for this final
provenance gate: the authenticated record created a bounded viewed marker, and
the browser regression now exercises every personal/team control through its
canonical reload contract without writing additional production state.

See
`docs/reference/opportunity-production-rollout-closeout-2026-07-27.md`
for deployment IDs, queue timings, exact remaining dependencies, and rollback.

Routine rollback is a service cutback: stop the worker and revert application
deployments while retaining the additive schema and immutable evidence.
