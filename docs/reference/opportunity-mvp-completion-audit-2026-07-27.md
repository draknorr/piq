# Opportunity MVP Completion Audit — July 27, 2026

This audit maps the Custom Daily Steam Opportunity Brief objective and its three
canonical repository specifications to current implementation evidence. It
distinguishes code/test completion from production rollout; a green local or CI
check is not treated as proof that the unapplied Tiger domain works in
production.

## Status

- Implementation branch: `codex/custom-daily-opportunity-mvp`
- Draft pull request: `#86`
- Production schema state: `0097_opportunity_mvp.sql` and
  `0098_opportunity_preset_seed.sql` are intentionally unapplied pending an
  explicit production-write approval.
- Production delivery/runtime state: not yet eligible for acceptance until the
  migrations, query API/admin deployment, Railway worker deployment, and
  authenticated smoke sequence are complete.
- Existing production data: no opportunity-domain write or destructive
  operation was performed during implementation or this audit.

The final bounded read-only preflight at 2026-07-27 19:00 UTC confirmed:

| Check                                                            | Live result                     |
| ---------------------------------------------------------------- | ------------------------------- |
| `to_regnamespace('opportunity')`                                 | `NULL` (unapplied as intended)  |
| Required `legacy`, `events`, `metrics`, and `ops` source objects | Present                         |
| Catalog event head                                               | `176324`                        |
| Lifecycle event head                                             | `575`                           |
| Change-event head                                                | `1000001045932`                 |
| Latest readiness update                                          | `2026-07-27 18:56:35.779454+00` |
| `metrics.app_signal_windows_v1` rows                             | `100`                           |

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
3. The implementation does not claim the new product is live merely because
   application checks pass. The opportunity schema and worker must still be
   rolled out and verified under the production write gate.

## Requirement-to-evidence matrix

| Requirement                                                                                                                    | Authoritative implementation evidence                                                                                                                                    | Verification evidence                                                                                                                  | Audit result                                               |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Supabase remains the auth/session authority; Tiger owns opportunity truth; the browser reaches Tiger only through query API    | `apps/query-api/src/opportunity-routes.ts`, `apps/admin/src/app/api/opportunities/[action]/route.ts`, `packages/data-plane/sql/tiger-bootstrap/0097_opportunity_mvp.sql` | Query API auth tests and route tests; admin production build                                                                           | Verified in code; production smoke pending                 |
| Eight visible, immutable PublisherIQ presets and personal clones/blank profiles                                                | `0098_opportunity_preset_seed.sql`, `OpportunityWorkspace.tsx`, `ProfileBuilder.tsx`, repository profile/version transactions                                            | Migration seed test; create/clone/save type checks                                                                                     | Verified in code; production seed pending                  |
| Profile lifecycle, local timezone/time, event subscriptions, immediate choice, pause/resume/archive                            | `ProfileBuilder.tsx`, `service.ts`, `repository.ts`, `next_profile_evaluation_v1` in `0097`                                                                              | Delivery-time validation tests, migration scheduling test, admin build                                                                 | Verified in code; local-time production smoke pending      |
| Shared required/preferred/excluded tri-state rule engine with ANY/ALL                                                          | `rules.ts`, `sql-compiler.ts`, preview/evaluation service and worker                                                                                                     | Rule-engine and SQL-compiler suites, including unknown-required and unknown-exclusion cases                                            | Verified                                                   |
| Preview exposes total matches, representative sample, elimination funnel, field coverage, warnings, and estimated daily volume | `OpportunityService.previewProfile`, preview compiler/repository, `ProfileBuilder.tsx`                                                                                   | Compiler/rule tests and browser flow tests                                                                                             | Verified in code; authenticated production preview pending |
| Durable `[last successful, current)` daily window and immutable first-observed/released/material events                        | `createRunContext`, `materializeEvents`, `material-events.ts`, event/cursor tables in `0097`                                                                             | Material-event, recovery, reconciliation, and preservation tests                                                                       | Verified                                                   |
| Required-data waiting and delayed `newly_qualified` behavior                                                                   | Candidate-state/outbox logic in `worker-repository.ts`; `resolveOpportunityResultLabel` in `worker.ts`                                                                   | Tests retain original material-event IDs, distinguish delayed qualification, and ensure readiness runs cannot advance the daily cursor | Verified                                                   |
| Newly discovered, newly released, newly qualified, subscribed material changes, tracked updates                                | Event classifier and surfacing policy in `material-events.ts` and `worker.ts`                                                                                            | Worker policy and material-event suites                                                                                                | Verified                                                   |
| Dedupe, dismiss, ignore, track, and event-driven reappearance                                                                  | Result unique key, user-game state, prior fingerprint ledger, reappearance reset                                                                                         | Recovery/preservation tests prove canonical idempotency and dismissal-only reset                                                       | Verified                                                   |
| One canonical per-user/app/event result with all matching profiles and one ranked position                                     | Result transaction and `result_profile_matches`; profile-version set fingerprint                                                                                         | Migration uniqueness and worker assignment tests                                                                                       | Verified                                                   |
| Reproducible match, rank, cohort, context, timestamps, versions, missing evidence, and prior appearances                       | Canonical game-record query and UI reproduction ledger; immutable cohort/market/result snapshots                                                                         | Recovery test asserts exposed calculation/profile/event/run/delivery provenance; admin build                                           | Verified in code                                           |
| Explainable 35/30/20/10/5 ranking                                                                                              | `OPPORTUNITY_RANK_WEIGHTS` and persisted component/weight/reason evidence                                                                                                | Intelligence tests                                                                                                                     | Verified                                                   |
| Transparent deterministic released-peer cohorts and directional market context with coverage/concentration warnings            | `getReleasedCohort`, `calculateOpportunityMarketContext`, game-record cohort table                                                                                       | Intelligence tests and bounded production calibration                                                                                  | Verified; directional limitations explicit                 |
| Preset health with conservative coverage, breadth, concentration, multi-signal, and persistence gates                          | `calculateOpportunityPresetHealth`, daily snapshot worker                                                                                                                | Intelligence tests and calibration note                                                                                                | Verified; production state may remain `insufficient_data`  |
| Workspace-shared viewed/researching activity plus personal profile/dismiss/ignore/track state                                  | Workspace membership, team activity/research state, personal state tables and game-record actions                                                                        | Migration preservation tests, auth-scoped repository queries, browser action flow                                                      | Verified in code; multi-user production smoke pending      |
| Canonical website plus configurable encrypted email/Slack summaries                                                            | Delivery preferences, AES-256-GCM destination cipher, outbox, Resend/Slack providers                                                                                     | Cipher and renderer tests; query API validation                                                                                        | Verified in code; provider smoke pending                   |
| Per-user or per-profile delivery, quiet days, maximum results, explicit truncation, idempotency, and failure handling          | Delivery desk, preference-scoped assignment, outbox leases/retries/dead letters                                                                                          | Delivery-assignment, truncation, escaping, recovery, and idempotency tests                                                             | Verified                                                   |
| Rare opt-in immediate alert is first-observed full match only                                                                  | Immediate material-event flag, immediate-only profile evaluation, channel opt-in                                                                                         | Worker policy tests                                                                                                                    | Verified                                                   |
| Railway owns persistent schedule/queue/delivery; GitHub is bounded reconciliation only                                         | `railway-opportunity.json`, worker runner, manual `opportunity-reconcile.yml`                                                                                            | Reconciliation tests reject delivery dispatch and require bounded/manual inputs                                                        | Verified in code; Railway deployment pending               |
| Existing product paths and legacy alert storage are preserved                                                                  | Additive migrations, separate `opportunity` schema, no legacy alert writes                                                                                               | Migration/recovery preservation tests, full build/type/lint/test gates, writer audit                                                   | Verified before rollout; post-deploy regression pending    |

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
| Full JavaScript/TypeScript tests | Passed; opportunity/data-plane package 150/150, admin 266/266, query API 24/24          |
| Lint                             | Passed with pre-existing warnings and zero errors                                       |
| Change-intelligence tests        | 46/46 passed                                                                            |
| PICS Python 3.11 tests           | 130/130 passed                                                                          |
| Supabase writer audit            | Zero scheduled blockers                                                                 |
| Tiger live read-only verifier    | Core sources/freshness passed; optional Railway env checks and empty alert state warned |
| Playwright                       | 5/5 passed, including the daily-record reproduction ledger and profile preview          |
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

The implementation is not production-complete until all of the following have
direct evidence:

1. exact migration change, reason, medium risk, backup/PITR proof, rollback, and
   explicit user approval are recorded;
2. `0097` and then `0098` apply successfully;
3. read-only post-apply schema/preset/source checks pass;
4. query API and admin deployments expose the authenticated contracts;
5. one Railway opportunity worker is healthy with the required environment;
6. a test identity clones/creates, previews, enables, pauses/resumes, and runs a
   profile;
7. a readiness case, a daily result, team/personal state, email, Slack,
   idempotency, and replay are smoke-tested; and
8. existing application routes pass post-deploy regression checks.

Routine rollback is a service cutback: stop the worker and revert application
deployments while retaining the additive schema and immutable evidence.
