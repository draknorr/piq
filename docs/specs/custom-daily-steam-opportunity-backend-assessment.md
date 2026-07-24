# Custom Daily Steam Opportunity Brief: Backend Assessment

## Assessment Summary

The proposed daily opportunity brief is feasible with PublisherIQ's current Steam data, but it is not an extension of the existing alert worker. It requires a new opportunity-intelligence subsystem with its own:

- user and team control model;
- immutable profile versions;
- source-event and first-observation ledger;
- data-readiness queue;
- daily evaluation cursor and result history;
- versioned scoring, cohort, market, and preset-health calculations;
- delivery outbox for website, email, and Slack; and
- source-health, replay, and audit controls.

The current platform already has many of the raw ingredients: Steam catalog discovery, storefront state, tags and genres when PICS is healthy, change intelligence, reviews, CCU, publisher/developer relationships, official news, partial YouTube evidence, auth, and several useful opportunity-report methods. The missing work is primarily the durable event model, user/team control plane, repeatable calculation layer, and reliable orchestration connecting those ingredients.

The largest immediate blocker is data readiness. On July 23, 2026, all 198 AppList game rows created in the preceding 24 hours had storefront and developer/publisher data, but none had PICS state, Steam tags, or genres. The most recent Tiger `last_pics_sync` and PICS change event were June 16, not merely a few hours behind. A taxonomy-dependent profile therefore cannot responsibly evaluate most genuinely new games until the PICS first-pass path is restored and monitored.

The storage decision is now settled for this feature:

- Supabase remains authoritative for accounts, authentication, and sessions.
- Tiger owns the opportunity domain, workspace/team authorization records used by the feature, Steam product truth, change/readiness state, calculations, profiles and versions, runs, results, user game state, and delivery work.
- The query API validates the Supabase identity and is the only browser-facing boundary to the Tiger opportunity domain.

No database, pipeline, or production changes were made during this assessment.

The staged work required to repair inputs and protect current site behavior before opportunity implementation is defined in the [Daily Opportunity Tracker Backend Preparation Plan](./custom-daily-steam-opportunity-preparation-plan.md).

## Bottom-Line Recommendation

Build the feature as a new opportunity domain that consumes existing Steam observations but does not inherit the contracts, scores, scheduling, or prioritization of current alerts and projections.

For the best long-term outcome:

- **Keep Supabase Auth:** continue using the existing account, identity, and session system.
- **Use one transactional opportunity store:** keep profiles, immutable versions, runs, canonical results, evidence, user/team state, and the delivery outbox together. Tiger is the selected store because evaluation inputs, metrics, cohorts, and market calculations already belong there.
- **Use the query API as the feature boundary:** validate the Supabase identity, authorize workspace access, and expose purpose-built opportunity commands and queries. Do not make the UI coordinate writes across databases.
- **Keep R2 as an optional evidence archive:** use it for large immutable payloads while retaining hashes, versions, and searchable explanation fields in Tiger.
- **Build a dedicated opportunity worker:** use durable claims, idempotent events, source watermarks, and replay rather than an hourly scan of user pins.

The earlier Supabase-control/Tiger-evidence split is no longer the target. It would create a permanent cross-database reconciliation burden around profiles, results, evidence, cursors, and delivery. The opportunity domain will instead remain transactionally coherent in Tiger and be accessed only through an authorization-aware service. Supabase account IDs are external identity keys in that domain; they do not make Supabase the store for an opportunity run or result.

This decision does not authorize a migration or production write. It fixes the target boundary for the later implementation plan.

| Storage option                                         | Advantages                                                                                    | Costs                                                                                          | Assessment                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Tiger opportunity domain; Supabase accounts/Auth only  | Atomic runs/results/evidence/outbox, local metric joins, one replay model, clean API boundary | Requires query-API authorization for every command/query and new workspace membership handling | **Selected target.**                                                             |
| Supabase profiles/results; Tiger evidence/calculations | Reuses Supabase RLS and user-control patterns                                                 | Permanent cross-database saga, reconciliation, and partial-failure handling                    | Acceptable if minimizing change is more important than architectural simplicity. |
| Entire opportunity feature in Supabase                 | Familiar auth and RLS                                                                         | Duplicates or moves heavy Steam calculations away from the primary data plane                  | Not recommended.                                                                 |

## Does Existing Reuse Limit the Product?

Yes, if “reuse” means preserving existing behavior or data contracts. No, if PublisherIQ reuses only sound infrastructure and raw observations behind new domain contracts.

The most important distinction is:

> Reuse source collection and operational patterns; replace legacy product semantics.

The feature will be limited if it inherits any of the following:

- daily-only catalog discovery;
- `catalog_seed_state` as a readiness definition;
- popularity-weighted sync priority for newly discovered games;
- in-memory PICS change queues;
- current pin-based alert tables and detection state;
- projection refresh timestamps as event truth;
- duplicated change-type mappings with unknown types defaulting to an unrelated family;
- current trend and CCU-growth field meanings;
- popularity-first similarity candidate selection;
- one-off report scores as production ranking;
- GitHub Actions as the personalized scheduler;
- a cross-database result transaction;
- retained Supabase product/operational reads as the monitor for Tiger ingestion; or
- the 13,000-line general data-plane service as the home for all new domain logic.

## Keep, Revamp, or Replace

| Existing component                                  | Decision                               | Reason                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steam API clients                                   | **Keep**                               | The transport and retry code is useful and already supports paginated `IStoreService/GetAppList`.                                                                                                                                                                     |
| TigerData/Timescale                                 | **Keep**                               | It is the correct home for event, metric-window, cohort, and opportunity-domain data.                                                                                                                                                                                 |
| R2 change archive                                   | **Keep**                               | Immutable raw payloads and large evidence artifacts remain valuable for replay.                                                                                                                                                                                       |
| Supabase Auth                                       | **Keep**                               | Identity/session behavior is not a product constraint.                                                                                                                                                                                                                |
| Durable Tiger change-intel queue pattern            | **Keep the pattern**                   | Claims, `SKIP LOCKED`, stale-claim recovery, priority, retry, and dead-letter behavior are good foundations.                                                                                                                                                          |
| Hourly app-change hint sweep and daily AppList sync | **Merge and revamp**                   | The hourly sweep already sees the full catalog but discards unknown apps; it should become the primary catalog scanner.                                                                                                                                               |
| Global `priority_score`                             | **Do not reuse for opportunities**     | New apps start at zero and the daily priority worker later gives never-synced apps a base score of 25, but established CCU, reviews, recency, and trends still dominate the shared ordering.                                                                          |
| Storefront snapshot capture                         | **Revamp behind a new contract**       | Raw snapshots are useful, but release transitions, materiality, and new-app priority are incomplete.                                                                                                                                                                  |
| PICS service                                        | **Major redesign**                     | Railway service `publisheriq` is deployed in `change_monitor` mode with Tiger targets, but its health/status contract failed to mark a June-stalled worker unhealthy, first-pass selection can starve new unreleased games, and the live change queue is not durable. |
| Current alert worker and `user_alerts` model        | **Replace for this product**           | It scans pins, has mutable baselines, and deduplicates by calendar date rather than source event.                                                                                                                                                                     |
| Current alert thresholds                            | **Retain only as backtest candidates** | They may seed defaults but should not define opportunity ranking or market health.                                                                                                                                                                                    |
| Raw review deltas and CCU snapshots                 | **Keep**                               | The raw observations support better calculations.                                                                                                                                                                                                                     |
| Current trend, velocity, and CCU-growth outputs     | **Replace calculation contracts**      | Some windows are misnamed, observation-row-based, or derived from coarse monthly data.                                                                                                                                                                                |
| Current apps/unreleased projections                 | **Keep for their existing pages**      | They should not become the opportunity engine or source of event truth.                                                                                                                                                                                               |
| Current similarity endpoint                         | **Do not use as peer truth**           | Its limited popularity-ordered candidate window biases the cohort before reranking.                                                                                                                                                                                   |
| Qdrant embeddings                                   | **Optional candidate enrichment**      | Useful for recall, but not a reproducible cohort definition by itself.                                                                                                                                                                                                |
| Existing opportunity reports                        | **Keep as research precedents**        | Their concepts are useful; their date-bound cohorts and formulas must be rebuilt as versioned calculations.                                                                                                                                                           |
| Query API transport and auth boundary               | **Keep and modularize**                | Add a separate opportunity domain rather than expanding the current monolithic service file.                                                                                                                                                                          |
| GitHub Actions schedules                            | **Keep for reconciliation/backfills**  | They are not the right primary mechanism for per-user timezones, retries, immediate delivery, or durable cursors.                                                                                                                                                     |
| YouTube collection                                  | **Keep as optional evidence**          | Partial coverage should not block or universally score games.                                                                                                                                                                                                         |

## Production Evidence Snapshot

Read-only inspection on July 23, 2026 found:

| Area                         | Production observation                                                                                                                                                                                                                                 | Product implication                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog discovery            | The latest daily AppList job processed about 176,000 games. A total of 266 app rows were created in the preceding 24 hours: 198 AppList games and 68 storefront-discovered demo stubs.                                                                 | AppList can supply daily candidates, but row creation alone does not identify one homogeneous “new game” population.                                                      |
| Mutable catalog clock        | 175,797 apps had `last_seen_in_steam_applist_at` inside 24 hours, versus 266 genuinely created rows.                                                                                                                                                   | `latest_added_at` cannot be used as the new-game clock.                                                                                                                   |
| New-game readiness           | All 198 newly created AppList games had storefront and developer/publisher data; none had PICS state, tags, or genres.                                                                                                                                 | Taxonomy-dependent profiles would remain unknown rather than match or fail.                                                                                               |
| Misleading seed state        | The AppList worker writes `catalog_seed_state='hydrated'` before storefront or taxonomy enrichment. The 198 new games were marked hydrated despite having no PICS taxonomy.                                                                            | The existing seed-state field cannot serve as the opportunity readiness gate.                                                                                             |
| PICS freshness               | Latest Tiger `last_pics_sync` was June 16, with 93,557 sync-status rows never PICS-synced and 88,362 eligible for the current first-pass selector at inspection time.                                                                                  | Restoring and scheduling PICS is a launch blocker.                                                                                                                        |
| Daily metrics                | Latest metric date was July 23 with about 132,250 rows.                                                                                                                                                                                                | Core daily metrics are current enough to build corrected windows.                                                                                                         |
| CCU                          | About 170,700 snapshots across 129,700 apps arrived in the preceding 24 hours.                                                                                                                                                                         | CCU is broad, but cohort calculations still need per-window coverage.                                                                                                     |
| Review velocity              | About 81,200 apps had velocity state; 4,841 had been refreshed since the preceding UTC day boundary at inspection time.                                                                                                                                | A missing or stale value cannot be treated as zero, and time-windowed counts must be regenerated rather than copied into permanent thresholds.                            |
| Change intelligence          | Tiger held about 3.45 million change events. About 13,700 arrived in the preceding 24 hours across 27 raw types; price and discount events were roughly 62% of that daily volume.                                                                      | Change candidates are abundant, but raw volume needs materiality and grouping.                                                                                            |
| PICS change coverage         | Storefront, media, and news events were current on July 23, but the latest PICS event was June 16.                                                                                                                                                     | Taxonomy, Steam Deck, build, and content-update change coverage is incomplete.                                                                                            |
| Release events               | No normalized release-state transition event exists.                                                                                                                                                                                                   | `Newly released` cannot yet be assigned reliably.                                                                                                                         |
| Event registry drift         | `demo_references_changed` is produced and present in Tiger but is absent from the data-plane signal-family registry and the original Supabase enum. Unknown types default to `store-page`.                                                             | Adding event types can silently misclassify `/changes`, chat, and opportunity results unless one versioned registry owns the mapping.                                     |
| Hint write amplification     | The hourly hint worker reads about 176,000 known games and upserts hint status for all known rows, even when only a small fraction changed. `/apps` and `/unreleased` freshness derive partly from `sync_status.updated_at`.                           | The scanner creates unnecessary Tiger writes and can make unrelated page freshness look current.                                                                          |
| Change queue health          | The live work-state table contained 2,790 dead-lettered `steam_app_change_hint` storefront rows and smaller pending news/projection backlogs during inspection.                                                                                        | Dead-letter reasons and recovery SLOs must be understood before opportunities depend on the queue.                                                                        |
| Change Feed contract         | The authenticated `/changes` route showed `Capture delayed` and zero activity while Tiger contained current storefront, news, and media events; the stale Supabase fallback had no events in the same 24-hour window.                                  | Repair source selection and status semantics before using the feed or chat as evidence for opportunity evaluation.                                                        |
| Storefront execution volume  | Tiger job records showed 9,020 worker-minutes across 429 completed storefront jobs in the preceding seven days, excluding checkout, install, and build.                                                                                                | This is substantial operational volume, but the confirmed public-repository GitHub runners make it a capacity/latency measure rather than a runner-cost case for Railway. |
| Released projection coverage | Of about 166,900 games, roughly 64% had tags, 59% had reviews, 36% had owner estimates, 17% had positive CCU, 31% had review velocity, and 13% had the current CCU-growth field.                                                                       | Peer and market calculations need metric-specific denominators and confidence.                                                                                            |
| Unreleased projection        | About 51,400 games; roughly 83% had tags, almost all had screenshots and publisher data, and about 76% had trailers. Its refresh lagged fresher source tables during inspection.                                                                       | A dedicated opportunity read model needs its own freshness SLO.                                                                                                           |
| YouTube                      | The latest daily classes each covered about 400 games and were labeled partial.                                                                                                                                                                        | Creator data is additive evidence, not a universal hard filter.                                                                                                           |
| Product control schema       | Live Supabase had user profiles, pins, alerts, credit records, and retained account tables, but no opportunity profiles, workspaces, runs, or results; the current schema no longer exposed `public.alert_preferences` or `public.pin_alert_settings`. | The personalized/team workflow requires a new opportunity-domain schema.                                                                                                  |

The data supports the feature, but coverage varies dramatically by source and metric. All calculations and explanations therefore need an explicit eligible denominator, measured sample, freshness timestamp, and coverage status.

## Cross-Site Impact Assessment

The opportunity area can be additive at the product boundary, but the ingestion changes are not isolated. `legacy.apps`, `ops.sync_status`, taxonomy edges, metrics, and `events.app_change_events` already feed several pages and chat contracts. Inserting games earlier, changing readiness semantics, increasing collection frequency, or adding event types can therefore alter other areas unless the rollout separates raw observation from product-ready state.

| Existing area                                | Impact                               | Failure mode if the new pipeline is connected directly                                                                                                                                                                                                                                                                                                           | Required protection                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/apps` list and aggregate statistics        | High                                 | A newly observed AppList row defaults to `type='game'` and `is_released=true`; the page filters on release/delisted state but not readiness. A name-only row can therefore appear as a released game before storefront truth arrives. Its `data_updated_at` also includes `sync_status.updated_at`, which the hint sweep currently rewrites for all known games. | Give catalog observations a non-product-ready state; require storefront readiness for normal list inclusion; calculate page freshness from the source fields displayed, not a generic sync row timestamp.                  |
| `/apps/[appid]` detail                       | Medium                               | A deep link can resolve a name-only or taxonomy-empty row and look like a complete game record.                                                                                                                                                                                                                                                                  | Allow a deliberate “data arriving” state, but do not present missing sections as observed zeroes. Opportunity results must not link as research-ready until profile-required fields are ready.                             |
| `/unreleased`                                | High                                 | `latest_added_at` is `COALESCE(last_seen_in_steam_applist_at, created_at)`. The daily AppList refresh therefore makes much of the unreleased catalog look newly added. Running that write hourly would amplify the error. The projection also includes `sync_status.updated_at` in `data_updated_at`.                                                            | Replace `latest_added_at` with a durable first-observation field/event; never update it during reconciliation; use source-specific freshness. Keep the existing projection out of opportunity event truth.                 |
| `/companies`, publisher, and developer pages | Medium                               | Earlier storefront hydration adds relationships sooner and can change portfolio game counts, taxonomy facets, latest release, and company aggregates at refresh time. AppList default release state can create false portfolio membership if relationships arrive before release truth is normalized.                                                            | Include only storefront-ready games in portfolio aggregates and make projection refreshes explicit downstream consumers of committed latest state.                                                                         |
| `/changes`                                   | High                                 | New change types can be silently misclassified. Today `demo_references_changed` falls through to `store-page`; the retained Supabase enum also does not contain it. A Tiger write combined with a Supabase fallback can show different feeds.                                                                                                                    | Define one versioned event registry used by ingestion, materialization, query API, UI labels, and filters. Move the page to strict Tiger reads after parity; do not dual-write product events merely to preserve fallback. |
| `/chat`                                      | High                                 | Chat change tools, entity search, similarity, and market queries read the same Tiger catalog, taxonomy, metrics, and event families. Stubs can resolve with empty evidence; new event types can receive the wrong narrative; calculation changes can alter answers.                                                                                              | Filter or label incomplete entities, version calculation contracts, add unknown-event handling, and regression-test change, similarity, and opportunity prompts before cutover.                                            |
| Qdrant embeddings and semantic search        | Medium                               | Faster taxonomy and company-edge updates increase embedding churn. Catalog-only rows are not useful semantic documents.                                                                                                                                                                                                                                          | Keep the existing genre/tag quality gate, enqueue embeddings only after a readiness transition, and coalesce repeated mutations into one latest-state re-embed.                                                            |
| `/insights`                                  | High during data-plane cleanup       | The page still reads Supabase `apps`, `latest_daily_metrics`, `app_trends`, `ccu_snapshots`, and `ccu_tier_assignments` directly. A Tiger-only opportunity implementation will not make this retained surface fresher. Ending legacy product writes without migrating it would make it stale.                                                                    | Treat `/insights` migration to Tiger/query-API contracts as separate but required data-plane debt. Do not dual-write opportunity data into Supabase to make this page appear compatible.                                   |
| `/admin` sync health                         | High during data-plane cleanup       | Admin health and PICS coverage still read Supabase operational tables. They currently cannot be the authoritative monitor for a Tiger-only opportunity pipeline and would miss the June PICS stall in Tiger.                                                                                                                                                     | Add Tiger operational health contracts and move the admin page to them. Preserve Supabase only for account/admin-user management.                                                                                          |
| Existing pins and alerts                     | Medium                               | The legacy worker reads Supabase pins and product metrics, maintains mutable baselines, and writes `user_alerts`. Increasing raw metric frequency can alter when old alerts fire. Reusing it would also mix two dedupe models.                                                                                                                                   | Keep legacy alerts operationally separate. Shadow any shared raw-metric cadence change and monitor legacy alert volume; do not route opportunity results through `user_alerts`.                                            |
| Reports and saved methodologies              | Medium                               | Correcting metric windows, taxonomy timing, or release state can change historical ranks and report recreation.                                                                                                                                                                                                                                                  | Version new calculations beside old fields, retain source snapshots, and state the calculation version in reports/results.                                                                                                 |
| Email and Slack                              | Low direct, high privacy if miswired | These channels do not consume raw ingestion directly, but could leak another team member's personal profile or become a second record of truth.                                                                                                                                                                                                                  | Project only the authorized user's canonical result through the Tiger outbox; resolve account identity through Supabase at request/delivery time.                                                                          |

### Shared-field changes that should not be made in place

Several tempting “small fixes” would create cross-site regressions:

- Do not redefine `legacy.apps.created_at`, `updated_at`, or `last_seen_in_steam_applist_at` to mean opportunity newness.
- Do not make `catalog_seed_state='hydrated'` the readiness gate; the current AppList worker sets it before enrichment.
- Do not use `ops.sync_status.updated_at` as generic data freshness. The hourly hint sweep currently refreshes it for about 176,000 rows even when their hints are unchanged.
- Do not replace existing metric fields with corrected formulas under the same name.
- Do not make every raw change event a user-visible opportunity.
- Do not add product-data dual writes to Supabase to support retained fallbacks.

The safe pattern is additive: create versioned catalog-observation, readiness, material-event, and metric contracts; shadow them; update each consumer deliberately; then retire misleading legacy derivations.

### Recommended cross-site rollout order

1. Add Tiger observation/readiness and event-registry contracts without changing existing page queries.
2. Run the incremental catalog scanner and material-event classifier in shadow mode.
3. Prove new-game time-to-storefront, time-to-taxonomy, event classification, queue recovery, and duplicate suppression.
4. Update `/apps` and `/unreleased` freshness/newness semantics before increasing catalog write cadence.
5. Update `/changes` and chat to the central event registry and strict Tiger reads.
6. Add the opportunity area and query-API module.
7. Migrate `/insights` and `/admin` operational reads separately; do not make them a launch dependency if their current behavior remains intact and explicitly legacy.

## Runtime Placement: Railway, GitHub Actions, and Source Limits

### Recommendation

Keep bounded ingestion on the standard GitHub-hosted runners because PublisherIQ's public-repository runs are not billed. Use Railway only where the workload must remain connected, drain a durable queue continuously, coordinate a singleton cursor, or deliver personalized work reliably. Railway should be justified by service behavior, not GitHub runner savings.

The split should be by workload lane, not by creating a second copy of game data:

| Workload                                                    | Target runtime                                   | Reason                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Incremental `IStoreService/GetAppList` scanner              | GitHub Actions hourly initially                  | It is bounded and free in the confirmed public-repository setup. Add `if_modified_since`, a durable cursor, unknown-app insertion, and changed-row-only writes. Railway remains optional if a future sub-hour SLO requires it. |
| Daily full AppList reconciliation                           | GitHub Actions initially                         | It is bounded, low-frequency, and useful as an independent completeness check. It must not rewrite first-observation time.                                                                                                     |
| New-game storefront lane                                    | Railway background worker                        | Queue latency and retries matter; the existing durable change-intel storefront worker pattern is appropriate after adding a protected lane or claim quota.                                                                     |
| Known-game storefront change lane                           | Existing Railway change-intel worker             | It already drains durable storefront work. Keep it, but centralize event classification and audit dead letters.                                                                                                                |
| PICS change stream                                          | One Railway leader plus durable Tiger work queue | PICS is a long-running connection and does not fit cron. The leader must durably record the upstream batch before advancing its change cursor.                                                                                 |
| New-game PICS enrichment                                    | Railway queue consumer with reserved capacity    | New games should not wait behind the historical first-pass backlog. This is a workload lane over the same Tiger state, not a separate PICS truth store.                                                                        |
| PICS historical catch-up                                    | Bounded Railway worker or operator job           | Backlog work needs quotas and can yield to live/new-game lanes. It should not require repeatedly changing the production service `MODE`.                                                                                       |
| Opportunity evaluator, daily scheduler, and delivery outbox | Railway background workers                       | Per-user timezones, durable claims, retries, and canonical result transactions need a persistent application runtime.                                                                                                          |
| Broad reviews, CCU, SteamSpy, and price sweeps              | Keep in GitHub Actions initially                 | These are already partitioned batch jobs. Promote newly observed, newly released, and matched games into protected targeted queues without moving the entire catalog on day one.                                               |
| Adaptive demo CCU collection                                | Existing Railway worker                          | `publisheriq-demo-ccu-worker-prod` already runs continuously against Tiger. Keep it in the runtime and cost inventory; do not duplicate it in a new scheduler.                                                                 |
| Projection rebuilds, backfills, and repair scripts          | GitHub Actions/manual operator jobs              | They are bounded, auditable maintenance work rather than interactive product scheduling.                                                                                                                                       |

Railway documents a five-minute minimum cron interval and skips a scheduled execution if the previous one is still active. Railway cron would technically support a future incremental catalog scanner, but the confirmed free GitHub runner changes the default to keeping that bounded task in Actions. Cron still does not fit the continuous PICS connection or queue drainers. See [Railway Cron Jobs](https://docs.railway.com/cron-jobs) and [Railway's cron/worker/queue guidance](https://docs.railway.com/guides/cron-workers-queues).

### New-game lane design

“Split the new games up” should mean reserved capacity, not a separate table or duplicate ingestion stack:

1. The incremental catalog scanner writes an idempotent `first_observed` event and minimal catalog identity.
2. The row starts as observed, not falsely hydrated or released.
3. One transaction enqueues storefront work in a `new_catalog` lane.
4. Storefront completion sets source-specific readiness and enqueues new-game PICS work.
5. PICS completion emits taxonomy/readiness events; reviews and CCU are promoted only when the release state makes them useful.
6. The evaluator re-runs affected profiles after every readiness or criteria-affecting event.
7. Reserved worker capacity prevents a price-change storm or historical PICS backlog from consuming all new-game slots.
8. The daily full scan reconciles misses without changing the original observation time.

The existing work-state table already provides priority, claims, retries, stale-claim recovery, and dead letters. To make an actual service-level guarantee, its claim contract needs an explicit lane or quota; high priority alone does not protect capacity when several workers consume the same queue.

### API limits and source behavior

Valve's documented `IStoreService/GetAppList` supports 50,000 results per page, `if_modified_since`, `last_modified`, and `price_change_number`. At about 176,000 returned games, a full scan is roughly four Web API calls. An hourly full scan is therefore about 96 calls per day, only 0.096% of Valve's documented 100,000-call daily Web API ceiling. The Web API call count is not the current bottleneck. See [Valve's IStoreService documentation](https://partner.steamgames.com/doc/webapi/IStoreService) and [Steam Web API Terms](https://steamcommunity.com/dev/apiterms).

The larger avoidable cost is database and runner work:

- the current hourly implementation reads all known rows and upserts hint status for roughly 176,000 games, even when unchanged;
- those writes update `sync_status.updated_at`, which contaminates page freshness;
- GitHub jobs repeatedly check out, install, and build before doing the bounded scan; and
- the broad storefront workflow launches six matrix jobs every two hours.

Use `if_modified_since` for the incremental feed, persist only changed hints and new observations, and retain a daily full reconciliation for deletion/missed-cursor defense.

Valve does not publish an equivalent official quota for the public storefront details endpoint or the PICS connection used here. Do not translate the Web API's 100,000-call allowance into permission to increase those sources without bound. Use:

- one shared Tiger-backed token/rate budget across GitHub and Railway workers;
- adaptive concurrency with exponential backoff and jitter;
- response-code and latency monitoring by source;
- one PICS change-stream leader;
- per-lane quotas and backlog age;
- retry ceilings and dead-letter review; and
- a controlled ramp that compares error rates before and after each increase.

Moving work to Railway does not increase Valve's key-level Web API quota. It can also concentrate traffic onto fewer egress IPs, so source throttling must be measured during the rollout.

### Cost assessment

Current Tiger job records show the scale of the bounded workload:

- 429 storefront jobs completed in seven days;
- the workers recorded 9,020 execution minutes;
- this excludes GitHub checkout, dependency installation, build time, per-job minute rounding, failed runs, and other workflows.

The previously stated $54/week or $232/month estimate does **not** apply. GitHub documents standard GitHub-hosted Actions as free for public repositories, and PublisherIQ has confirmed that these workflows use that arrangement. The execution minutes remain useful for throughput, reliability, and source-pressure analysis, but their direct runner cost is $0. Larger runners and any future private-repository execution would need a new assessment. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Railway currently charges $10 per GB-month of actual RAM use, $20 per vCPU-month of actual CPU use, and $0.05 per GB of egress; the Pro plan has a $20 minimum that counts toward usage. Illustrative marginal monthly usage is:

- 0.5 GB average RAM plus 0.1 vCPU average CPU: about $7 before egress;
- 1 GB average RAM plus 0.25 vCPU average CPU: about $15 before egress.

These are scenarios, not a forecast. Authenticated Railway inspection on July
24 found five production worker services in the ingestion project:
`change-intel-storefront`, `change-intel-news`, `change-intel-hero`,
`publisheriq-demo-ccu-worker-prod`, and the PICS `publisheriq` service. The
separate query project contains the query API, admin site, and research MCP
services. Actual plan allowances and per-service consumption still require the
Railway billing dashboard. See [Railway pricing](https://docs.railway.com/pricing/plans).

The correct decision is therefore:

1. keep AppList, broad storefront, reviews, CCU, SteamSpy, price, reconciliation, and backfill jobs on the free standard GitHub runners;
2. keep or move only continuous/stateful work on Railway: the PICS leader, queue drainers, protected new-game consumers, opportunity evaluator, scheduler, and delivery outbox;
3. reuse an existing Railway queue service or worker pool where isolation and capacity allow, rather than creating a paid service for every lane;
4. instrument actual CPU, RAM, egress, queue latency, source errors, and requests per result;
5. move a bounded sweep to Railway only for a demonstrated reliability or latency requirement—not expected runner savings; and
6. set Railway spend alerts, replica limits, and a hard-limit policy that will not unexpectedly take the query API or PICS monitor offline.

## Change Intelligence Is a First-Class Opportunity Input

The existing plan accounted for changes, but it treated too many of them as optional event subscriptions. The corrected design gives changes three separate responsibilities.

### 1. Changes re-evaluate eligibility

Any event that affects a profile field must cause rule re-evaluation whether or not the user asked to be notified about that event type. Examples include:

- tags, genres, categories, and content descriptors;
- developer or publisher associations;
- demo, DLC, and package relationships;
- release state, release date, and release window;
- price, free/paid state, and purchase readiness;
- platforms, languages, controller support, and Steam Deck state; and
- the arrival or invalidation of source readiness.

If the game passes for the first time after such an event, the result is `newly_qualified`. This is matching correctness, not a notification preference.

### 2. Material changes can be results themselves

A known game that already matches can appear again when a subscribed material event occurs. The default daily brief should include:

- major changes to existing matches;
- newly released matches;
- first demos or major demo changes;
- publisher/developer changes;
- meaningful taxonomy repositioning;
- material release-window movement;
- commercial or store-readiness changes with sourcing relevance;
- official announcements linked to other activity; and
- corroborated review/CCU breakthroughs.

Users can customize change families and thresholds, and PublisherIQ presets provide defaults. Routine change noise does not become a result simply because it exists.

### 3. Changes inform market and preset context

Aggregate change behavior can show supply and positioning:

- more games adopting or abandoning a tag combination;
- increased demo, release, or store-readiness activity;
- coordinated media/store refreshes near launch; and
- shifts in publisher participation or release timing.

These signals can support Growing/Surging/Cooling explanations and future preset recommendations, but they do not prove demand. A Surging claim still needs broad review, CCU, or other measured audience movement.

### Required event architecture

Use this chain:

```text
source observation
  -> immutable raw change event
  -> grouped change moment
  -> versioned material opportunity event
  -> affected-profile re-evaluation
  -> canonical result and explanation
```

The immutable raw event remains useful to `/changes`, chat, audits, and future classifiers. The material event is the stable product contract used by opportunities. It stores:

- event-registry and classifier version;
- raw event IDs and source snapshots;
- game and effective/observed times;
- grouped window and fingerprint;
- signal families;
- materiality and confidence;
- user-rule fields affected;
- before/after summary;
- corroborating and contradicting evidence; and
- whether it caused first qualification, reappearance, or only context.

### Central event registry

The current type knowledge is duplicated in TypeScript, SQL `CASE` expressions, the original Supabase enum, and UI/query code. This has already drifted: `demo_references_changed` is emitted into Tiger but is not mapped by the data-plane family registry, so it defaults to `store-page`.

Create one versioned registry that defines for every event type:

- source and canonical name;
- signal family and user-facing label;
- fields affected;
- default materiality prior;
- whether it triggers profile re-evaluation;
- whether it may independently create a daily or immediate result;
- grouping/fingerprint behavior;
- severity/magnitude calculation; and
- backward-compatible unknown handling.

Generate or validate ingestion, query-API, UI, and materializer mappings from that registry. Tiger text event types allow additive evolution; the opportunity contract should not depend on the retained Supabase enum.

### Missing and misleading events to fix

- Emit an explicit `release_state_changed` or `released` transition from `comingSoon/is_released` before/after values. A release-date text edit is not a release.
- Preserve first observation as its own event; do not generate dozens of false “changes” from the first full snapshot.
- Normalize demo relationship changes as a release/readiness family, not a generic store-page edit.
- Restore PICS so tag additions/removals, Steam Deck, build, and last-content-update changes resume.
- Keep source observation time distinct from an effective date supplied by Steam.
- Treat raw price/discount cycling as low-value by default unless magnitude, profile relevance, release context, or corroborating demand makes it material.

### Ranking and reappearance

Change relevance should not be represented only by a larger scalar weight. It is both:

1. a candidate gate explaining why the game is in this run; and
2. a decomposed ranking component after eligibility.

The starting product weights are 35% user fit, 30% current signal/change strength, 20% peer position, 10% market/preset momentum, and 5% evidence quality, subject to backtesting. New games are not penalized for lacking a prior diff because `first_observed` is an event class with its own evidence.

A dismissed game may reappear only with a new subscribed material-event fingerprint. An ignored game remains suppressed. The result must show what changed since the previous appearance and must never reappear merely because a projection refreshed or a mutable timestamp changed.

### Change-specific service objectives

Track:

- source-observation-to-raw-event latency;
- raw-event-to-material-event latency;
- material-event-to-profile-re-evaluation latency;
- event counts and distinct games by source/type;
- unknown/unmapped event types;
- grouping compression ratio;
- material-event rate by family;
- duplicate/fingerprint suppression;
- dead-letter counts and oldest age;
- PICS change-cursor lag;
- source coverage gaps; and
- results, reappearances, and dismissals attributable to each event family.

The opportunity feature should not launch while PICS change coverage is stale, release transitions are absent, or event-registry drift can silently classify an unknown type as an unrelated family.

## Required Revamps to Remove Product Ceilings

### 1. Merge catalog discovery and change hints

The hourly app-change-hints worker already scans the full paginated Steam game list. It currently divides rows into known and unknown app IDs, explicitly skips unknown IDs, and upserts hint status for every known row rather than only changed rows. The separate AppList worker inserts unknown apps only once per day and labels them `hydrated` before storefront or taxonomy enrichment.

That creates an unnecessary product ceiling: “immediate” discovery can be almost 24 hours late even though PublisherIQ already sees the unknown ID during the hourly hint sweep.

Replace the two overlapping behaviors with one catalog-scanner contract:

1. use `if_modified_since` for the hourly incremental scan and retain a daily full reconciliation;
2. compare the page against a durable catalog-observation ledger;
3. atomically insert an observation and minimal non-ready app identity for unknown IDs;
4. enqueue unknown IDs into high-priority storefront and PICS lanes;
5. update only changed hint rows and enqueue changed known apps;
6. persist a scan watermark and page/job provenance; and
7. keep full-scan `last_seen` reconciliation separate from first-observation time and displayed freshness.

PICS change numbers can be a second discovery source, but no single source should be allowed to overwrite the true earliest observation. Store source-specific observations and derive `first_observed_at` as the earliest trustworthy event.

### 2. Replace popularity priority with opportunity freshness lanes

The global sync priority is designed to spend more collection budget on games that already demonstrate CCU, reviews, or trend activity. That is appropriate for a broad analytics product but counterproductive for sourcing:

- newly inserted AppList rows receive `priority_score = 0`;
- the daily priority worker later assigns a base score of 25 to never-synced
  rows, so the zero is an initial state rather than a permanent one;
- storefront selection orders by the global priority score;
- high-CCU and high-review games rise ahead of unknown games; and
- a new unreleased game may wait behind the exact established titles the opportunity product is not trying to rediscover.

Do not modify the global priority model to satisfy two competing products. Add independent, quota-protected opportunity lanes:

| Lane                       | Purpose                                                    | Service objective                                      |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `new_observation`          | First storefront and PICS capture for newly discovered IDs | Highest priority; measured in minutes or low hours.    |
| `release_transition_watch` | Games close to or crossing release                         | Frequent until the transition is confirmed.            |
| `profile_readiness`        | Missing source data blocking active profiles               | Priority based on affected profiles and candidate age. |
| `material_change`          | Known matches with subscribed changes                      | Event-driven, severity-aware.                          |
| `tracked_game`             | User-tracked games                                         | Budgeted recurring refresh.                            |
| `market_cohort`            | Games needed to keep cohort context current                | Scheduled by cohort coverage and health needs.         |
| `reconciliation`           | Long-tail completeness and repairs                         | Reserved capacity so it cannot starve.                 |

Use aging within each lane and fixed minimum capacity across lanes. Neither popularity nor the number of users interested in a game should be able to starve all other newly observed titles.

### 3. Redesign PICS rather than only restarting it

Restoring the current service would address the immediate outage but preserve several correctness and fairness risks:

- latest-state writes still default to Supabase in configuration;
- the change monitor uses an in-memory deque;
- it persists the upstream change cursor before every queued app is durably processed;
- a process exit after cursor advancement can lose queued changes;
- the queue has a fixed maximum and advances the cursor even when not every app can be added;
- first-pass selection looks only at a recent candidate pool;
- recently released and near-release titles rank ahead of newly observed undated/unreleased games; and
- the default first-pass batch is bounded without a checked-in continuous schedule.

The target PICS design should:

1. write latest state and history to Tiger only;
2. persist every upstream change batch and app ID before advancing the durable cursor;
3. claim app work from a durable queue with leases, retries, aging, and dead letters;
4. separate change-monitor, new-observation, and backlog consumers;
5. give new observations a protected queue share;
6. retry IDs missing from a batch response rather than treating the batch as complete;
7. expose backlog age and change-cursor lag, not only queue length;
8. emit field-readiness events after successful persistence; and
9. make source provenance available to the rule engine.

The existing Tiger change-intel queue is a good implementation pattern. Its exact queue should not be overloaded with PICS and opportunity semantics, but its durable claim and stale-claim recovery behavior should be reused.

### 4. Extend storefront capture into an opportunity-grade event source

The current normalized storefront snapshot is useful and should remain. The event contract needs additional behavior:

- `comingSoon` or normalized release state must produce a before/after transition;
- a first successful storefront capture must emit readiness, not a fake change event;
- first demo, paid-to-free, purchase-package, Early Access, and accessibility transitions need explicit normalized events;
- description and media edits need materiality thresholds or grouped moments;
- publisher/developer changes need normalized added/removed identities;
- every event needs raw snapshot references and a stable fingerprint; and
- new-observation jobs must bypass popularity-weighted storefront ordering.

Keep raw source events separate from product material events. A versioned classifier can combine several low-level edits into one explainable `store_readiness_improved` or `positioning_changed` event without destroying the raw history.

### 5. Create an opportunity sampling policy for reviews and CCU

Existing collection spends more capacity on active and popular games. The opportunity product also needs enough fresh data for:

- recently released matches;
- games approaching release;
- tracked opportunities;
- peer cohorts used in active presets; and
- suspected early breakouts that have not yet entered a high activity tier.

Add a bounded opportunity watch policy that temporarily promotes those games into appropriate review and CCU sampling lanes. The watch policy must have explicit budgets and expiry so many broad user profiles cannot force high-frequency collection of the entire catalog.

This does not require replacing the review or CCU clients. It requires changing scheduling inputs, preserving observation coverage, and separating “measured zero” from “not measured.”

### 6. Rebuild derived metrics as a versioned semantic layer

Do not patch existing fields in place when their names are already consumed elsewhere. Build new, accurately named opportunity metrics from raw review deltas, daily observations, and CCU snapshots.

The opportunity layer should own:

- complete, non-overlapping calendar windows;
- required boundary observations;
- measured-day and expected-day counts;
- source and last-observed time;
- minimum absolute baselines;
- coverage and quality status;
- cohort-normalized values; and
- calculation version.

Existing page and chat fields can remain for backward compatibility. New opportunity code must import only the new metric contract.

### 7. Build a dedicated cohort engine

The current similarity endpoint scans at most 120 candidates, orders that candidate set by total reviews and CCU before reranking, and then scores primarily shared tags, genres, developer, and publisher. Using it directly would systematically omit less-popular comparables and distort market potential upward.

Build a separate cohort engine that:

- generates candidates without popularity-first truncation;
- applies release-state, release-age, business-model, price, Early Access, and content constraints;
- uses ranked taxonomy rather than unweighted set overlap;
- supports a documented fallback ladder;
- optionally uses Qdrant to improve recall;
- persists membership, inclusion reasons, exclusions, and cohort version; and
- produces separate upcoming-readiness and released-market cohorts.

The interactive similarity endpoint can continue serving its current use case. It should not be renamed or quietly repurposed as the market-comparison engine.

### 8. Use a persistent scheduler, not user-facing GitHub cron

GitHub Actions are acceptable for catalog reconciliation, backfills, projection rebuilds, and operational smoke tests. They are a poor foundation for:

- user-local daily send times;
- per-profile run cursors;
- immediate new-full-match events;
- retryable channel delivery;
- quiet-day choices;
- long-lived readiness waits; and
- source-health-aware pausing.

Run a dedicated opportunity scheduler/worker against durable database work. It should claim due profile runs and candidate evaluations, heartbeat leases, retry safely, dead-letter terminal failures, and advance cursors only after canonical results commit.

No specific new job framework is required to begin. PublisherIQ already has a successful Postgres `SKIP LOCKED` queue pattern that can be extracted into a reusable worker primitive.

### 9. Modularize the query API before adding the feature

The central data-plane service file is currently roughly 13,800 lines. Adding profile commands, preview, run history, evidence, cohorts, team state, and delivery administration directly to that class would slow testing and make domain ownership unclear.

Keep the query API process and transport, but add an opportunity module with:

- command handlers;
- query handlers;
- authorization policy;
- repositories;
- rule compiler/evaluator;
- calculation contracts;
- evidence schemas; and
- worker-facing internal services.

The existing data-plane service can call or register the module during transition. The opportunity domain should be independently testable without initializing every chat and search contract.

### 10. Keep legacy alerts separate

The old alert feature can continue serving pins while the opportunity area is built. Do not:

- add opportunity profile columns to pin settings;
- reuse `alert_detection_state` as candidate state;
- write opportunity results into `user_alerts`;
- reuse the calendar-day deduplication key;
- reuse publisher/developer relationship triggers as release events; or
- make old alert thresholds the hidden opportunity model.

If PublisherIQ later wants one notification center, unify presentation after both domains expose stable event/result APIs. Do not merge their storage and execution models first.

### 11. Avoid a permanent cross-database result saga

Splitting a canonical result header, its evidence, its run cursor, and its delivery outbox across Supabase and Tiger would not immediately limit the UI, but it would create permanent failure modes:

- evidence committed without a visible result;
- a result pointing to missing evidence;
- cursor advancement before every result exists;
- delivery enqueued before the canonical result commits; and
- difficult transactional ignore/dismiss/reappearance behavior.

The strongest design keeps the whole opportunity transaction in Tiger and exposes it through an authorization-aware API. Supabase identity can remain authoritative without making Supabase the opportunity result database.

If the lower-change split is chosen anyway, the reconciliation and idempotency design in this assessment becomes mandatory rather than optional.

## Revamp Strategy Without a Risky Big Bang

The existing alerts, apps pages, and ingestion consumers do not need to be rewritten simultaneously. Use parallel versioned contracts and cut over one capability at a time.

### Step 1: Define new domain contracts first

Create versioned schemas for:

- catalog observations;
- normalized release transitions;
- field readiness;
- material events;
- opportunity metric windows;
- cohorts;
- profiles and rule outcomes;
- canonical results; and
- delivery outbox records.

No new opportunity code should read a legacy field unless an adapter translates it into one of these contracts with provenance and freshness.

### Step 2: Shadow the unified catalog scanner

Run the new scanner alongside the daily AppList job and current hourly hint logic:

- record what each path classified as known, unknown, and changed;
- compare counts and IDs;
- confirm idempotency across reruns;
- inject worker termination between queue persistence and cursor advancement; and
- prove that no unknown ID is lost or duplicated.

After parity, the daily AppList job becomes reconciliation rather than the only discovery writer.

### Step 3: Replace PICS work management before relying on PICS output

Deploy the durable queue/cursor path in shadow mode, then replay a bounded change-number interval and compare:

- app IDs received;
- latest-state hashes;
- relationship sets;
- change events;
- missing batch responses;
- retry outcomes; and
- cursor positions.

Only after parity and backlog-age targets are met should taxonomy become a required daily-profile input.

### Step 4: Publish new calculations beside old fields

Do not change compatibility fields consumed by `/apps`, chat, or reports. Publish opportunity-specific versioned metric windows and compare them against historical examples. The new product imports only the new semantic contract.

### Step 5: Backtest cohorts, ranks, and preset health

Replay historical observation windows with fixed source cutoffs. Measure:

- result volume per profile;
- time from observation to readiness;
- rank stability;
- small-cohort fallback frequency;
- false urgency from near-zero baselines;
- concentration sensitivity;
- how often `Surging` is caused by one title;
- missing-data effects; and
- whether top results are meaningfully different from a popularity ranking.

The final test is important: if the opportunity rank mostly reproduces “games with the most reviews,” the revamp has failed even if the code is technically correct.

### Step 6: Cut over the opportunity area only

Launch the new website area and worker without changing the current pin-alert experience. The old alert system can be deprecated later after its use cases are deliberately mapped into the new domain.

### Draft service objectives

These targets should be confirmed against source limits and operating cost:

| Capability                    | Draft objective                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Catalog discovery             | Complete an incremental catalog scan at least hourly plus one daily full reconciliation; no unknown IDs discarded.           |
| New-game storefront readiness | P95 under two hours after PublisherIQ first observes the app, when Steam returns data.                                       |
| New-game PICS readiness       | P95 under four hours after first observation once the PICS backlog is healthy, with explicit source-blocked state otherwise. |
| Event durability              | Zero cursor advancement before all upstream app IDs are durably recorded.                                                    |
| Daily run                     | Exactly one successful cursor advance per due user/profile run.                                                              |
| Replay                        | Same profile, source cutoff, calculation versions, and evidence produce the same eligibility and component scores.           |
| Delivery                      | At-least-once work processing with effectively-once provider delivery through idempotency.                                   |
| Explanation                   | Every result resolves all required rules and identifies source time, cohort version, calculation version, and confidence.    |

## Current Backend Gaps

### 1. Newness is not represented as a durable event

`metrics.unreleased_games_projection.latest_added_at` currently coalesces `last_seen_in_steam_applist_at` and `created_at`. AppList refreshes `last_seen_in_steam_applist_at` across much of the catalog, so it cannot identify first discovery.

`legacy.apps.created_at` appears insertion-stable in the current Tiger writer and can help bootstrap history, but it is not a sufficient operational ledger. It does not record:

- discovery source;
- upstream cursor or AppList version;
- sync job;
- retry and processing state;
- release-state transitions;
- data-readiness attempts; or
- which event produced a user result.

Add a durable `catalog_observations` event with a unique first-observation constraint per app and source. Every observation must include an upstream or computed idempotency key, observed time, ingested time, source, and job provenance.

### 2. Release transitions are not emitted

The storefront path stores `comingSoon` and updates `is_released`, but the current storefront diff does not emit a release-state-change event. The existing Supabase “new release” behavior is tied to publisher/developer relationship inserts and is not trustworthy evidence that a game just released.

Add an event such as `release_state_changed` with:

- before and after normalized states;
- raw storefront values;
- observed and ingested timestamps;
- source snapshot IDs; and
- a stable fingerprint so retries cannot create duplicate opportunities.

The product-level `newly_released` event should be derived only from a valid transition into the released state.

### 3. Data readiness is neither durable nor event-driven

Catalog, storefront, PICS, review, CCU, and creator data do not arrive atomically. A new candidate needs a state machine:

```text
observed -> awaiting_required_data -> evaluable -> evaluated
                                      \-> readiness_expired
                                      \-> source_blocked
```

Readiness must be evaluated against the actual active profile rules. A game can be ready for a release-date-only profile while still pending for a tag-dependent profile.

The current `catalog_seed_state` is not this state machine. AppList assigns `hydrated` to a minimal identity row before storefront/PICS enrichment, while storefront demo discovery uses `stub` for a different relationship-discovery path. Keep source-specific readiness in a dedicated contract rather than trying to reinterpret those legacy values in place.

Required additions:

- field-level provenance and freshness metadata;
- a readiness policy for each rule type;
- missing-field reasons;
- next evaluation time;
- retry count and terminal deadline;
- source-health-aware pausing; and
- re-evaluation triggers when storefront, PICS, relationship, or metric data arrives.

If a required field remains unavailable at the deadline, the system records a visible non-match reason. It must not silently convert unknown into false.

### 4. There is no profile or rule execution model

The live control schema has pin alerts and general alert preferences, but no opportunity presets, personal profiles, immutable rule versions, run ledger, or opportunity results.

The backend needs one canonical rule schema with:

- a schema version;
- required, preferred, and excluded groups;
- `ANY` and `ALL` group operators;
- type-safe operators for strings, sets, ranges, dates, booleans, and derived metrics;
- user-selected event types;
- preference importance;
- data-readiness requirements;
- calculation version references; and
- a human-readable representation generated from the same structure.

Preview and scheduled evaluation must call the same compiler and evaluator. Reimplementing rules in the UI, API, and worker would create inconsistent counts and explanations.

### 5. There is no real team model

`user_profiles.organization` is free text and cannot support shared visibility or access control.

Add workspaces, memberships, and roles. Profiles remain personal, while canonical game records and lightweight activity are workspace-scoped:

- `viewed` is an append-only or upserted user/game activity;
- `researching` is a claim with owner, start time, optional note, and cleared time;
- dismiss, ignore, and track are user-scoped; and
- one member's personal criteria are not exposed to another member unless explicitly shared.

### 6. There is no reliable channel-delivery backend

The current schema stores an email-digest preference, but no opportunity email worker, Slack integration, or delivery outbox was found.

Every digest or immediate notification needs an outbox record with:

- canonical run and result IDs;
- user, destination, and channel;
- rendered-content version;
- idempotency key;
- status, attempt count, and next attempt;
- provider message ID;
- last error; and
- sent time.

External delivery failure cannot roll back or erase the website result. Retries must not resend a successful digest.

## Recommended Data Model

Names below are architectural proposals, not approved migrations.

### Tiger opportunity-domain records

| Record                               | Purpose                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `opportunity.workspaces`             | Team identity and lifecycle within the opportunity service.                                |
| `opportunity.workspace_memberships`  | Supabase auth user ID, role, status, and access boundary.                                  |
| `opportunity.presets`                | PublisherIQ-authored preset identity and editorial status.                                 |
| `opportunity.preset_versions`        | Immutable public rule definitions and visible change notes.                                |
| `opportunity.profiles`               | User-owned profile identity, schedule, status, and source preset.                          |
| `opportunity.profile_versions`       | Immutable rules, calculation configuration, and activation time.                           |
| `opportunity.channel_preferences`    | Per-profile or per-user channel, quiet-day, timezone, and result-limit settings.           |
| `opportunity.runs`                   | User/profile run window, source watermarks, status, counts, and active version references. |
| `opportunity.results`                | Canonical per-user/app/run result, event label, rank, evidence, and matching profiles.     |
| `opportunity.result_profile_matches` | Every matching profile and immutable rule outcome attached to one deduplicated result.     |
| `opportunity.user_game_state`        | Dismiss, ignore, and track state with timestamps and causal event fingerprint.             |
| `opportunity.team_activity`          | Workspace viewed/researching activity without CRM stages.                                  |
| `opportunity.deliveries`             | Channel outbox and provider delivery history committed with canonical results.             |
| `opportunity.audit_log`              | Security- and behavior-relevant domain changes.                                            |

PublisherIQ presets need immutable versions because editing a preset must not silently change users' personal copies. Cloning a preset should copy the full rule version, retain ancestry, and allow an explicit future “apply update” operation with a visible diff.

### Tiger source and calculation records

| Record                                                  | Purpose                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `events.catalog_observations`                           | First observed and subsequent catalog evidence with source/job provenance.          |
| `events.release_state_events` or normalized change rows | Trustworthy before/after release transitions.                                       |
| `events.material_game_events`                           | Product-facing event type, severity, raw source events, and stable fingerprint.     |
| `ops.opportunity_candidate_state`                       | Candidate readiness, missing fields, retries, deadlines, and source blockers.       |
| `ops.opportunity_work`                                  | Durable candidate/profile/run claims with lanes, leases, retries, and dead letters. |
| `ops.source_health_snapshots`                           | Freshness, backlog, coverage, and circuit-breaker state for each source.            |
| `metrics.opportunity_rule_inputs`                       | Fresh, typed, source-attributed fields available to the rule engine.                |
| `metrics.game_metric_windows`                           | Correctly calculated review, CCU, news, change, and creator windows with coverage.  |
| `metrics.comparable_cohort_snapshots`                   | Versioned cohort definition, membership, reasons, and fallback tier.                |
| `metrics.market_context_snapshots`                      | Cohort distributions, demand, supply, concentration, and potential band.            |
| `metrics.preset_health_snapshots`                       | Daily health inputs, state, explanations, and consecutive-state history.            |

Large evidence payloads can be stored in R2 with a hash, schema version, generated time, and Tiger reference. Frequently queried explanation fields should remain relational or indexed JSON rather than requiring an object fetch for every list view.

### Identity and secret boundary

Supabase remains the identity provider. The query API verifies the Supabase session/JWT and maps the immutable auth user ID into `opportunity.workspace_memberships`. Browser clients do not connect directly to Tiger.

Slack and email provider credentials should live in an encrypted secret store or vault. Tiger stores only the integration identity, destination, permission metadata, and secret reference required by the opportunity service.

### Result transaction

Within one Tiger transaction, the evaluator should:

1. lock or verify the active run and profile version;
2. insert immutable rule, cohort, market, and ranking evidence;
3. insert or upsert the canonical result and matching-profile rows;
4. enqueue the channel outbox records; and
5. advance the successful-run cursor only after the run's expected results are complete.

Core evidence required to render and explain the result should remain in Tiger. Optional large R2 artifacts can be written using content-addressed keys before the transaction and referenced by hash; an orphaned immutable object is safe to clean up later. A failed or partial run must leave the previous cursor intact.

## Event and Reappearance Model

### Versioned material events

Raw changes need to map into a stable product event catalog. Each catalog version defines:

- raw event types included;
- normalization rules;
- severity or materiality threshold;
- event-specific cooldown;
- whether it is eligible for daily or immediate delivery;
- fields used in the user explanation; and
- which new evidence can cause a dismissed title to reappear.

Recommended v1 product events include:

- first observed game;
- transitioned to released;
- first demo relationship;
- material release-date/window change;
- publisher association added, removed, or changed;
- material taxonomy or content-policy repositioning;
- material price or business-model change;
- meaningful store-readiness change;
- subscribed platform or language expansion;
- selected official announcement;
- review threshold or acceleration;
- CCU threshold or acceleration; and
- a compound breakthrough event reserved for later immediate delivery.

Description, screenshot, taxonomy, and build changes need minimum thresholds or aggregation. One raw edit should not automatically become one user opportunity.

### Stable deduplication

The existing `{user}:{entity}:{alert_type}:{calendar_date}` model is insufficient. Use a fingerprint based on:

```text
user + app + qualifying event fingerprint + active profile version set
```

One canonical result can list multiple matching profiles. Daily delivery includes it once.

- **Dismiss** suppresses the current occurrence and can be overridden by a later subscribed material-event fingerprint.
- **Ignore** suppresses the app for that user regardless of profile or event until reversed.
- **Track** does not bypass required rules; it subscribes the user to selected future changes.

## Opportunity Evaluation Engine

### Avoid a daily catalog-by-profile cross join

Evaluating every Steam game against every personal profile every day will become expensive. Use event-driven candidate selection:

1. collect candidate apps from new catalog observations, normalized material events, readiness completions, and subscribed metric thresholds;
2. identify potentially relevant profile buckets using indexed coarse dimensions such as release state, taxonomy, price model, and event subscription;
3. run the full tri-state evaluator only on those candidate/profile pairs;
4. cache reusable rule inputs and cohort calculations;
5. create results; and
6. perform a bounded daily reconciliation sweep to catch missed events.

Profile preview can query the current catalog directly, but it must use bounded query plans and the same compiled predicates.

### Durable windows and lateness

The logical daily window is:

```text
[last successful evaluation time, current evaluation time)
```

Every source also needs an ingestion watermark. The evaluator distinguishes:

- event observed time;
- event ingested time;
- source watermark;
- profile evaluation time; and
- user delivery time.

Late-arriving required data produces `newly_qualified`, preserving the original observation time and the later readiness time. Backfills should be labeled and should not produce immediate alerts unless explicitly allowed.

### Tri-state outcomes

Persist the outcome of every rule:

- `true`, `false`, or `unknown`;
- raw value and source timestamp;
- operator and comparison value;
- calculation version for derived metrics; and
- explanation text or structured reason code.

Unknown required fields keep a candidate pending until the deadline. Unknown preferences receive no benefit and no penalty. Unknown exclusions do not exclude.

## Calculation Changes

### 1. Correct metric windows before ranking

Several current calculations should not be used unchanged:

- `ccu_growth_7d_percent` currently compares a recent three-day average with the prior three-day average.
- `ccu_growth_30d_percent` compares a recent three-day average with a 30-day baseline.
- one existing trend path labels a review rate as seven-day even though its input is a monthly histogram bucket.
- `review_velocity_stats` uses recent observed rows; seven rows do not always equal seven complete calendar days.
- a daily-metrics rollup sums cumulative total-review values, which is not meaningful growth.

Create `game_metric_windows` with accurately named, non-overlapping calendar windows:

| Metric                  | Recommended calculation                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviews added 7d        | cumulative reviews at the window end minus the last valid cumulative value at or before the window start, with boundary freshness and observed-day count. |
| Review velocity 7d      | reviews added over seven elapsed calendar days when both boundaries and minimum daily coverage are valid; otherwise unknown.                              |
| Review acceleration     | latest 7d daily velocity versus the preceding non-overlapping 28d baseline.                                                                               |
| Review sentiment change | current positive ratio versus the preceding baseline, with minimum review depth and new-review count.                                                     |
| CCU level               | median daily peak and median sampled CCU over the window, not sum of snapshots.                                                                           |
| CCU growth 7d           | latest seven complete days versus the preceding seven complete days using the same aggregation.                                                           |
| CCU growth 30d          | latest 30 complete days versus the preceding 30 complete days.                                                                                            |
| CCU persistence         | share of observed days above the cohort or game baseline.                                                                                                 |
| Change cadence          | distinct material-event days and weighted event count, not raw edit count alone.                                                                          |
| Creator change          | views/videos/channels only among games with current measured coverage.                                                                                    |

Each value stores observed days, expected days, last observation, source freshness, and a coverage status. Very small baselines need absolute minimums so a move from near zero cannot create an exaggerated percentage signal.

### 2. Build reproducible comparable cohorts

The current Tiger similarity query is a useful starting point but is not sufficient for product evidence. It fetches a limited, popularity-ordered candidate set and reranks mainly on shared taxonomy and developer/publisher identity. This can exclude genuinely comparable smaller games before similarity is applied.

Use a deterministic cohort signature and fallback ladder.

#### Candidate constraints

- Steam app type is game;
- compatible release state;
- relevant release-age window;
- premium versus free-to-play;
- price band;
- Early Access state;
- content-policy compatibility; and
- no demos, DLC, or delisted titles unless intentionally requested.

#### Similarity score

A v1 structured score can combine:

```text
45% weighted primary-tag overlap
20% genre overlap
10% Steam-category overlap
10% price/business-model proximity
10% release-age/state proximity
 5% publisher/developer scale proximity
```

Use weighted Jaccard overlap for taxonomy, giving higher weight to a game's highest-ranked Steam tags. Exact weights must be backtested and versioned.

#### Fallback ladder

1. full structured signature;
2. relax price and scale;
3. primary tags plus genre;
4. broader genre/category cohort; and
5. optional semantic candidate enrichment, never an unexplained semantic-only cohort.

Store the cohort version, membership, inclusion score, inclusion reasons, exclusion policy, and fallback tier. Use one upcoming-game cohort for readiness comparisons and a separate released-reference cohort for market outcomes.

### 3. Calculate market context with distributions, breadth, and concentration

For every released-reference cohort and time window, calculate:

- eligible cohort size;
- measured sample and coverage per metric;
- P25, median, P75, and P90 outcomes;
- share above meaningful review and CCU thresholds;
- median and trimmed-mean change;
- share of games improving;
- recent and upcoming supply;
- number of demos and new entrants;
- top-one and top-three share of total improvement; and
- a concentration measure such as HHI where sample size supports it.

Winsorize only for aggregate calculations and preserve raw values in evidence. Never remove a breakout game from the visible cohort merely because it is an outlier.

Market outcomes should be normalized where possible by:

- days since release, such as D7, D30, or D90;
- premium versus free-to-play;
- price band;
- Early Access state; and
- cohort coverage.

Review count, CCU, and estimated owners are proxies. Owner or revenue ranges remain directional and need method, date, coverage, and uncertainty.

### 4. Produce a conservative market-potential band

Do not calculate a falsely precise total addressable market. Produce a versioned band such as `Limited`, `Developing`, `Meaningful`, or `Large but competitive`, supported by separate dimensions:

- released-peer outcome distribution;
- current demand direction;
- breadth of improving titles;
- durability across windows;
- supply and upcoming competition;
- concentration in a few hits; and
- evidence coverage.

Store the dimension scores and explanation. A high-outcome but highly concentrated cohort can be labeled large but hit-driven rather than universally attractive.

### 5. Replace saturated scores with cohort-normalized components

The current unreleased opportunity score uses five capped 20-point components and saturates near the top. Existing bespoke reports already demonstrate a better direction by using percentile components, but their one-off candidate populations and dates make them unsuitable as a production rank.

Keep the product brief's five default components:

| Component                  | Weight | Backend calculation                                                                                                                 |
| -------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------- |
| User fit                   |    35% | Preferred-rule match contributions weighted low/medium/high after hard eligibility.                                                 |
| Current signal strength    |    30% | Event-specific magnitude percentile, first-qualification effect, recency decay, materiality, and corroborating independent signals. |
| Relative peer position     |    20% | Available game metrics normalized within the persisted comparable cohort.                                                           |
| Market and preset momentum |    10% | Versioned preset-health inputs, breadth, persistence, and concentration penalty.                                                    |
| Evidence quality           |     5% | Required-field completeness, metric coverage, source freshness, cohort quality, and fallback tier.                                  |

Use empirical percentiles or robust, winsorized z-scores within an appropriate reference population. Do not rank all game types and release ages against one global pool.

Missing optional data should be neutral inside its component, not positive. Do not rescale missing evidence in a way that lets a poorly measured game equal a well-supported game; the evidence-quality component and visible confidence must reflect the gap.

Persist:

- raw metrics;
- normalized values;
- reference population;
- component scores and weights;
- final score;
- stable tie-breaker;
- ranking version; and
- explanation reason codes.

Hard eligibility is calculated before ranking. Market strength cannot override a failed required rule.

### 6. Implement preset health as a daily snapshot

Preset health should be calculated against a stable released-reference cohort, not only the current day's matching new games.

Recommended demand indicators:

- median review-velocity acceleration;
- breadth of positive review acceleration;
- median CCU growth;
- breadth of positive CCU growth;
- persistence of elevated CCU;
- creator growth only where measured coverage is sufficient; and
- supply/positioning indicators reported separately.

Use non-overlapping comparisons:

- latest seven complete days versus the preceding 28 days; and
- latest 30 complete days versus the preceding 90 days.

The initial `Surging` gate from the product brief remains appropriate:

1. at least 10 comparable released games;
2. at least 60% coverage for the core metric population;
3. material improvement in two independent demand indicators, including reviews or CCU;
4. positive movement across at least 40% of measured games;
5. no single game responsible for more than 50% of aggregate improvement; and
6. the state persists for two consecutive daily snapshots.

Add minimum absolute changes, not only percentages, and backtest exact thresholds. The snapshot stores cohort version, windows, sample, coverage, median/trimmed changes, breadth, concentration, leading contributors, prior state, and rule version.

Tag additions/removals remain a supply or positioning signal. They cannot independently trigger `Surging`.

### 7. Prepare future preset recommendations without automating publication

The future recommendation system needs:

- frequent, coherent taxonomy-intersection discovery;
- minimum released cohort size and shrinkage for small samples;
- sustained demand and breadth across multiple windows;
- supply-gap and concentration calculations;
- similarity/deduplication against existing preset signatures;
- evidence and counterevidence;
- representative games; and
- an editorial review state before publication.

A useful first method is constrained frequent-itemset mining over approved tags/genres/categories, followed by the same market-health calculations used for maintained presets. It must never auto-create a user's profile or subscription.

## Source Health and Operational Controls

The opportunity engine should refuse to overstate results when a required source is stale.

Track at least:

- last successful ingestion by source;
- source watermark and ingestion lag;
- first-pass PICS backlog and oldest waiting app;
- candidate age by readiness state;
- projection refresh age;
- metric coverage by cohort/profile;
- run duration and candidate/profile pair count;
- match, pending, expired, and suppressed counts;
- duplicate-suppression count;
- evidence/header reconciliation failures;
- email and Slack delivery success/retry/dead-letter counts; and
- time from first observation to evaluable result.

Use circuit breakers:

- a stale required source pauses affected criteria and shows a warning;
- unaffected profiles can still run;
- cursors advance only for successfully completed scope; and
- recovery replays the missed readiness events without relabeling old observations as new.

The July 23 production inspection also found the unreleased projection refreshed substantially earlier than the underlying metrics and change events. Every opportunity read model needs an explicit freshness service-level objective and alert, rather than assuming a scheduled job ran.

## Delivery Requirements

### Website

The website is created first and remains available even if external channels fail. List queries should read compact canonical result headers; detailed evidence is loaded on demand.

### Email

The backend needs:

- verified sender/provider integration;
- per-user timezone and local delivery time;
- daily versus immediate preference;
- quiet-day behavior;
- maximum included results and truncation notice;
- unsubscribe/preference links;
- template and rendered-content versioning; and
- bounce/complaint handling appropriate to the provider.

### Slack

The backend needs:

- an installation or webhook authorization model;
- encrypted credentials kept out of profile JSON;
- workspace/channel or direct-destination binding;
- permission and revocation handling;
- compact Block Kit or equivalent rendering;
- provider rate-limit/retry handling; and
- no leakage of private personal criteria beyond the user's chosen destination.

Daily Slack delivery should be one digest. Immediate alerts get separate outbox records only for profiles explicitly enabled for new full matches.

## Profile Preview Requirements

Preview should return:

- total current matches;
- up to 10 representative games;
- an elimination funnel by required rule;
- field coverage and freshness for every criterion;
- warnings for delayed or partial sources;
- comparable-cohort availability for sample results; and
- estimated daily volume after enough run history exists.

Representative examples should be sampled across score bands or rule combinations rather than simply returning the 10 largest games. Exact historical volume is unavailable until the new event and result ledgers accumulate history.

## Security and Access Control

Required controls include:

- query-API verification of the Supabase identity on every opportunity request;
- service-enforced workspace membership and role checks;
- owner-only authorization for personal profiles and personal game state;
- no direct browser access to Tiger opportunity tables;
- server-only service access for evaluation and delivery workers;
- encrypted Slack/provider secrets;
- audit records for preset publication, profile-version activation, researching claims, ignore changes, and delivery preference changes;
- safe signed links for external-channel actions; and
- retention rules for rendered messages and provider errors.

Tiger RLS can provide defense in depth if PublisherIQ establishes a safe user-claim propagation model, but it must not be assumed merely because Supabase Auth is used. The query API should expose typed contracts for opportunity commands and evidence rather than letting the UI issue arbitrary heavy cohort queries.

## Recommended Delivery Sequence

### Phase 0: Repair and prove the inputs

- Merge hourly change hints and catalog discovery so unknown IDs become durable observations immediately.
- Redesign PICS around Tiger latest state and durable work before restoring it as a product dependency.
- Add protected new-observation storefront and PICS lanes.
- Add first-observation and release-transition events.
- Define the versioned material-event catalog.
- Correct and validate calendar-based review and CCU windows.
- Establish source-health snapshots and freshness gates.

**Exit condition:** a newly discovered game can move from observation through storefront/PICS readiness with traceable provenance and no mutable timestamp inference.

### Phase 1: Build the control plane and ledger

- Implement the selected Supabase-account/Tiger-opportunity boundary.
- Add workspaces and memberships.
- Add preset/profile/version records and rule schema.
- Add run, result, user-game-state, and team-activity records.
- Implement shared rule compiler and profile preview.
- Add query-API authorization and modular opportunity contracts.
- Define result transaction, idempotency, and R2 artifact behavior.

**Exit condition:** a user can save a versioned profile, preview it, and run a replayable website-only evaluation.

### Phase 2: Ship daily website opportunities

- Build event-driven candidate selection and readiness state.
- Implement daily cursors, dedupe, dismiss, ignore, track, and reappearance.
- Store canonical result headers and immutable rule evidence.
- Add operational dashboards and failure recovery.

**Exit condition:** daily new, released, newly qualified, and selected material-change results are reliable on the website.

### Phase 3: Add explainable ranking and market intelligence

- Build comparable-cohort snapshots.
- Build corrected metric windows and market-context snapshots.
- Implement decomposed scoring and confidence.
- Implement versioned preset-health states and Surging detection.

**Exit condition:** every result can reproduce why it ranked, how peers are performing, why the preset is or is not growing, and what evidence is missing.

### Phase 4: Add external delivery

- Implement email and Slack authorization.
- Add delivery outbox, retries, idempotency, quiet days, and per-user timing.
- Add rare opt-in immediate new-full-match delivery.

**Exit condition:** external messages accurately project canonical results and failures never lose or duplicate website truth.

### Phase 5: Explore recommended presets

- Backtest market-health history.
- Mine coherent taxonomy intersections.
- Add novelty, breadth, concentration, and editorial-review gates.

**Exit condition:** PublisherIQ can review evidence-backed candidate presets without auto-subscribing users.

## Launch Blockers and Risk Ratings

| Risk                                                 | Severity                     | Why it matters                                                                                  | Required mitigation                                                                                   |
| ---------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stale PICS latest-state and large first-pass backlog | Blocker                      | New taxonomy-dependent games cannot be evaluated.                                               | Redesign for Tiger latest state, durable work, protected new-game capacity, and measured backlog age. |
| Non-durable PICS cursor/queue behavior               | Blocker                      | A restart or full in-memory queue can permanently skip source changes after cursor advancement. | Persist the upstream batch and app work transactionally before advancing the cursor.                  |
| No first-observation ledger                          | Blocker                      | “New” cannot be reconstructed reliably.                                                         | Turn the hourly catalog scan into idempotent catalog observations.                                    |
| Daily-only unknown-app insertion                     | Blocker for immediate alerts | PublisherIQ already sees unknown IDs hourly but currently discards them.                        | Merge catalog discovery with the hourly hint scanner.                                                 |
| No release-transition event                          | Blocker                      | Newly released labels can be wrong.                                                             | Emit normalized before/after release events.                                                          |
| Event-registry drift                                 | Blocker                      | New raw types can be silently assigned to the wrong family and produce incorrect results.       | Use one versioned registry across ingestion, materialization, API, and UI; alert on unknown types.    |
| No profile/run/result schema                         | Blocker                      | No durable personalized product truth exists.                                                   | Add a versioned Tiger opportunity domain and canonical result ledger.                                 |
| Misleading catalog/readiness state                   | High                         | AppList rows are marked hydrated and default released before enrichment.                        | Add source-specific observed/storefront/taxonomy/market readiness and gate existing consumers.        |
| Popularity-biased global sync priority               | High                         | Unknown sourcing candidates can wait behind established titles.                                 | Add quota-protected opportunity freshness lanes.                                                      |
| Existing change-intel dead letters                   | High                         | Thousands of storefront hint jobs have terminal work state without a proven product policy.     | Classify terminal causes, repair retryability, and meet backlog/dead-letter SLOs before launch.       |
| Shared freshness timestamp contamination             | High                         | Hourly unchanged hint upserts can make `/apps` and `/unreleased` look fresh.                    | Persist only changed hints and migrate pages to source-specific freshness.                            |
| Misnamed or loose metric windows                     | High                         | Rankings and Surging explanations would be misleading.                                          | Replace with calendar-based, covered, versioned calculations.                                         |
| No channel delivery outbox                           | High                         | Retries can lose or duplicate messages.                                                         | Commit provider-independent outbox records with canonical results.                                    |
| No workspace authorization model                     | High                         | Team visibility cannot be secured.                                                              | Add workspaces/memberships and query-API authorization policies.                                      |
| Similarity candidate bias                            | High                         | Peer comparisons can favor already-popular titles.                                              | Build deterministic cohort generation and persist membership.                                         |
| Choosing a split result store                        | High                         | Evidence, results, cursors, and deliveries can disagree.                                        | Keep the opportunity transaction in Tiger; otherwise accept mandatory reconciliation.                 |
| Partial YouTube/owner coverage                       | Medium                       | Missing data can look like poor demand.                                                         | Carry coverage and use these signals only when sufficiently measured.                                 |
| Score/model drift                                    | Medium                       | Old results become impossible to explain.                                                       | Persist input snapshots and calculation versions.                                                     |
| Query API domain coupling                            | Medium                       | Adding the feature to a 13,000-line service increases regression and testing risk.              | Create a separately testable opportunity module.                                                      |

## Decisions That Can Be Made Now

The backend should proceed with these defaults unless later evidence from backtesting contradicts them:

- website is canonical;
- profiles are personal and game activity is workspace-shared;
- Supabase owns authentication and session identity;
- Tiger owns the transactional opportunity domain, Steam truth, and heavy calculations;
- the query API is the only browser-facing opportunity data boundary;
- an hourly incremental catalog scan should discover unknown/changed apps, with a daily full reconciliation;
- the bounded hourly catalog scanner, broad safety sweeps, and backfills remain on the free standard GitHub runners;
- continuous/stateful new-game queue consumers, PICS, evaluation, and delivery work belongs on Railway;
- opportunity freshness uses separate protected lanes rather than the global popularity score;
- newness comes from durable events, never projection refresh timestamps;
- required-rule unknowns wait, preferences receive no benefit, and exclusions require a positive match;
- profile preview and scheduled evaluation share one rule engine;
- cohorts are structured, versioned, and explainable;
- released peers provide market-outcome evidence for unreleased games;
- ranking never changes eligibility;
- market-potential language is directional;
- Surging requires breadth, persistence, multiple signals, and concentration controls;
- email and Slack project canonical results through an outbox; and
- recommended presets require editorial review and never auto-subscribe users.

## Product Calibrations Still Needed Before Launch

With the single-store Tiger opportunity boundary now selected, the remaining items are backtesting and policy calibrations rather than architectural decisions:

1. readiness deadlines by source and rule type;
2. exact materiality thresholds for store, price, media, and metric changes;
3. final cohort weights, minimum size, and fallback thresholds;
4. score normalization reference populations and event-specific recency decay;
5. absolute and percentage thresholds separating Growing, Surging, and Cooling;
6. market-potential band thresholds and wording;
7. immediate-alert rate caps and per-user limits;
8. default timezone/send-time behavior;
9. retention periods for result evidence and rendered channel payloads; and
10. PublisherIQ preset editorial roles and publication workflow.

Each threshold should be tested against historical candidate windows, versioned, and evaluated for alert volume, false urgency, small-sample distortion, and sensitivity to one breakout title.

## Repository Evidence

The assessment traced the current implementation and report methods through:

- [Steam Web API and paginated catalog scan](../../packages/ingestion/src/apis/steam-web.ts)
- [Daily AppList worker](../../packages/ingestion/src/workers/applist-worker.ts)
- [Hourly change-hint worker](../../packages/ingestion/src/workers/app-change-hints-worker.ts)
- [Change-hint unknown-app partitioning](../../packages/ingestion/src/change-intel/hints.ts)
- [Hourly change-hint workflow](../../.github/workflows/app-change-hints.yml)
- [Partitioned storefront workflow](../../.github/workflows/storefront-sync.yml)
- [Storefront worker](../../packages/ingestion/src/workers/storefront-worker.ts)
- [Storefront change diff](../../packages/ingestion/src/change-intel/storefront.ts)
- [Change-event type definitions](../../packages/ingestion/src/change-intel/types.ts)
- [Current change-family mappings](../../packages/data-plane/src/service.ts)
- [Durable Tiger change-intel queue pattern](../../packages/data-plane/sql/tiger-bootstrap/0070_change_intel_write_surfaces.sql)
- [Railway change-intel worker configuration](../../packages/ingestion/railway.json)
- [Railway change-intel service layout](../developer-guide/workers/steam-change-intelligence.md)
- [Current global sync priority](../../packages/ingestion/src/workers/priority-worker.ts)
- [PICS change monitor](../../services/pics-service/src/workers/change_monitor.py)
- [PICS first-pass worker](../../services/pics-service/src/workers/bulk_sync.py)
- [PICS first-pass selection](../../services/pics-service/src/database/operations.py)
- [Existing alert detection worker](../../packages/ingestion/src/workers/alert-detection-worker.ts)
- [Current personalization schema](../../supabase/migrations/20260112000001_add_personalization.sql)
- [Current alert detection schema](../../supabase/migrations/20260112000002_add_alert_detection.sql)
- [Pin alert settings](../../supabase/migrations/20260113000001_add_pin_alert_settings.sql)
- [Current data-plane service](../../packages/data-plane/src/service.ts)
- [`/apps` Tiger queries and freshness behavior](<../../apps/admin/src/app/(main)/apps/lib/apps-queries.ts>)
- [Retained Supabase `/insights` queries](<../../apps/admin/src/app/(main)/insights/lib/insights-queries.ts>)
- [Retained Supabase admin sync-health queries](../../apps/admin/src/lib/sync-queries.ts)
- [`/changes` Tiger/Supabase fallback](<../../apps/admin/src/app/(main)/changes/lib/change-feed-server.ts>)
- [Unreleased games projection](../../packages/data-plane/sql/tiger-bootstrap/0084_unreleased_games_page_projection.sql)
- [Released opportunity ranking SQL](../reports/sql/go-to-market-opportunities-released-2026-03-26.sql)
- [Upcoming opportunity ranking SQL](../reports/sql/go-to-market-opportunities-upcoming-2026-03-26.sql)
- [Unreleased publisher opportunity SQL](../reports/sql/unreleased-publisher-opportunity-overview-2026-05-11.sql)
- [Tag and genre market-shift SQL](../reports/sql/tag-genre-market-shifts-2026-04-06.sql)

## Final Assessment

PublisherIQ has enough underlying Steam and market data to build this feature, but the reliable product does not yet exist in the backend. The work is best understood as:

1. merging catalog discovery and change hints into one durable hourly incremental scanner plus daily reconciliation;
2. replacing popularity-first work selection with protected opportunity freshness lanes;
3. redesigning PICS queue and cursor correctness rather than merely restarting it;
4. turning raw change intelligence into versioned, material opportunity events that always trigger affected-rule re-evaluation;
5. protecting existing pages and chat from incomplete catalog rows, misleading freshness, and unmapped event types;
6. creating one transactional Tiger opportunity domain behind the query API while Supabase remains the account authority;
7. keeping free bounded ingestion in GitHub Actions while using Railway for continuous/stateful queue, PICS, evaluation, and delivery work;
8. standardizing metric windows and rebuilding peer cohorts;
9. persisting explainable ranking, market, and preset-health snapshots; and
10. delivering canonical results through a resilient outbox and per-user channels.

The product is not limited by continuing to use Steam clients, Tiger, R2, Supabase Auth, raw review/CCU observations, or the durable change-intel queue pattern. It would be limited by extending the current alert schema, global popularity priority, PICS work management, derived metric contracts, similarity endpoint, generic projections, or GitHub scheduling into the new feature.

The first release should therefore be built on the new contracts rather than launched quickly on legacy alerts and rewritten later. It should not bypass peer context or evidence quality, because those elements are central to why a user would trust the update. It can defer automated preset recommendations until enough versioned preset-health history exists to backtest them responsibly.
