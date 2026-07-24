# Custom Daily Steam Opportunity Brief

## Product Definition

PublisherIQ will add a new site area for a team-based Steam sourcing workflow. Each team member defines the kinds of games they want to discover, then receives a personalized daily update containing new games that match those criteria and known matches that became newly relevant. Every result also explains why it ranked where it did, how comparable games are performing, and what the available evidence suggests about the surrounding market.

The website is the canonical record. Email and Slack are personalized delivery channels that summarize and link back to the complete website record.

In one sentence:

> Define what a relevant Steam opportunity looks like, then receive a fresh daily list of matching games with enough game-level and market-level evidence to decide what deserves independent research.

Backend and data-intake preparation is defined separately in the [Daily Opportunity Tracker Backend Preparation Plan](./custom-daily-steam-opportunity-preparation-plan.md). That plan must be completed before this product is implemented.

## Product Boundary

The feature helps a publishing team discover and triage titles. It does not decide whether a game is a good deal, automatically contact developers, conduct full diligence, or manage a deal pipeline.

PublisherIQ's responsibility is to:

1. monitor Steam;
2. identify new or materially changed games that match a user's choices;
3. explain exactly why each game appeared;
4. compare the game with a transparent cohort of similar titles;
5. explain the market signals that strengthen or weaken the opportunity;
6. centralize the supporting information; and
7. make it easy for the user to begin researching the title independently.

## Decisions

- **This is a new product area.** It is not a redesign of an existing dashboard.
- **This is a team sourcing workflow.** Team members share game records and basic viewing/research activity.
- **Profiles are personal.** Each user chooses their own criteria, followed profiles, delivery channels, timing, and notification rules.
- **Presets come from PublisherIQ.** Ryan or PublisherIQ creates and maintains the starting templates.
- **The website is canonical.** Email and Slack never become separate records of truth.
- **The normal cadence is every 24 hours.** The report covers activity since that user's last successful daily run.
- **Immediate notifications are opt-in and rare.** The initial immediate-alert use case is a newly discovered, fully evaluated game matching every required rule in a profile configured for immediate delivery.
- **Users research opportunities themselves.** The main action is opening the complete game record and its source material.
- **Market context is part of every result.** A match should explain both why the game fits the user's profile and how comparable released games are performing.
- **Preset health is monitored separately from game eligibility.** PublisherIQ can label a preset Growing, Surging, or Cooling, but market momentum never overrides the user's required or excluded rules.
- **Preset recommendations are a future capability.** PublisherIQ may suggest a new preset when broad and persistent market evidence supports it, but must not silently create, enable, or modify a user's profile.
- **Supabase remains the Auth authority only.** Authentication identities and sessions stay in Supabase; all non-auth account, team, preference, credit, alert, and opportunity state belongs in Tiger behind the query API.
- **Tiger owns this feature's operational and product truth.** Profiles, profile versions, team/workspace authorization records, source events, readiness, runs, results, evidence, game state, delivery work, Steam data, and calculations live together in Tiger behind the query API.
- **Dismissed games may reappear.** A new subscribed material event can make a dismissed game eligible again.
- **Ignored games remain suppressed.** Ignore is a separate, user-level choice that lasts until the user reverses it.

## Core Workflow

### 1. Start with a PublisherIQ preset

PublisherIQ provides an editorially maintained set of presets based on market niches and sourcing strategies. Initial examples can include:

- Roguelike Deckbuilder
- Cozy Sim
- Extraction Shooter
- Narrative Horror
- Colony Sim + Survival
- New Self-Published Indie Releases
- Upcoming Games With Demos
- Recently Released Games Showing Early Traction

A preset contains visible criteria and defaults. It is never an opaque recommendation model.

When a user selects a preset, PublisherIQ creates a user-owned copy. Subsequent preset changes must not silently change that user's alerts. PublisherIQ can offer an optional update with a visible rule diff.

Users can also start with a blank profile.

### 2. Customize the profile

Each saved profile belongs to one user account. A profile contains:

- a name and optional description;
- required, preferred, and excluded rules;
- the material event types that can make an existing match appear or reappear;
- daily or immediate delivery choices;
- email, Slack, and website notification preferences;
- maximum results per delivered summary; and
- the user's dismissal and ignore history.

### 3. Preview the profile

Before saving, the user sees a profile preview rather than relying on an untested rule set.

The v1 preview should show:

- the number of games that match the current catalog;
- up to 10 representative matches;
- which required rules are eliminating the most games;
- the percentage of candidate games with data available for each rule;
- warnings for criteria with limited or delayed coverage; and
- an estimated daily volume once the feature has enough run history.

This is a sanity check, not a promise that the same games would have appeared historically. Exact historical replay can be added after the daily evaluation ledger has accumulated sufficient history.

### 4. Evaluate new activity

PublisherIQ evaluates profiles against a durable run window:

```text
[last successful evaluation time, current evaluation time)
```

The engine first identifies games with an eligible event, waits until the fields required by the user's profile are available, applies the profile rules, ranks eligible games, deduplicates them, and creates one canonical result per user and game for that run.

Every change to a field used by a profile triggers rule re-evaluation, even when the user has not chosen that change type as a notification category. This is necessary because a taxonomy, publisher, release, demo, platform, price, or readiness change can make a previously ineligible game qualify. The user's event preferences determine whether an already-matching game is shown merely because it changed; they do not prevent the matching engine from noticing that the rules themselves changed.

### 5. Contextualize and rank the match

For each eligible game, PublisherIQ builds a transparent comparable-game cohort, measures the game against that cohort, summarizes the cohort's current performance and momentum, and decomposes the final rank into visible components. This analysis affects ordering among eligible games; it cannot make a game pass a required rule or bypass an exclusion.

### 6. Deliver the summary

Each user receives the results through their selected channels. The website stores the complete result. Email and Slack carry only the summary appropriate to those channels.

### 7. Research the title

The user opens the canonical game record, reviews the evidence, visits Steam or other source material, and conducts their own research.

## What Counts as New

"New" is an event label, not a permanent game status.

A result can be:

- **Newly discovered:** PublisherIQ first observed the game during the current 24-hour run window.
- **Newly released:** PublisherIQ observed the game transition into a released state during the run window.
- **Newly qualified:** the game was observed recently, but required metadata arrived later and it matched for the first time during the current run.
- **Materially changed:** a previously known match produced an event the user chose to monitor.

A game is labeled **Newly discovered** or **Newly released** only when the relevant event occurred within the run window, normally about 24 hours. It does not remain "new" in later reports.

New games often arrive before tags and other enrichment data. PublisherIQ must not send a raw catalog record simply because it was inserted. It should hold the candidate until every required rule can be evaluated. If enrichment arrives after the original 24-hour window, the result is labeled **Newly qualified**, not falsely labeled new.

## Eligible Event Types

### V1 daily events

- first observation of a Steam game;
- transition to released state;
- first observed demo relationship;
- release-date or release-window change;
- publisher-association change;
- meaningful taxonomy, store-page, media, platform, build, commercial, or pricing change;
- official Steam announcement selected by the user;
- review or CCU threshold selected by the user; and
- a previously dismissed game producing a newly subscribed material event.

The default daily experience has four core result groups:

1. newly discovered or newly qualified games;
2. newly released games;
3. major changes to existing matches; and
4. early traction or breakthrough changes.

PublisherIQ presets provide sensible material-change defaults. Users can customize which change families cause an existing match to reappear, but criteria-affecting changes always trigger eligibility re-evaluation in the background.

An initial snapshot establishes a baseline; it must not manufacture a separate "change" for every populated field. Subsequent snapshots produce before/after events. First observation remains its own event class.

### Change materiality

Raw change volume is not the same as opportunity importance. The product must group related raw events into one change moment and score that moment using:

- the event class and magnitude;
- relevance to the user's required and preferred rules;
- recency and proximity to release;
- whether independent source families corroborate the change;
- whether the edit is novel or repetitive churn;
- whether the change caused the game to become eligible; and
- the freshness and completeness of the supporting evidence.

Release-state transitions, first demos, publisher/developer changes, meaningful taxonomy repositioning, major release-window movement, and multi-signal traction breakouts are normally high-value. Routine discount cycling, repeated text edits, reordered media, and isolated build churn normally require corroboration or user opt-in.

### V1 immediate event

The initial immediate notification is **New full match**:

1. the game has a new-game event;
2. all data needed by the profile is ready;
3. every required rule passes;
4. no exclusion rule passes; and
5. the user enabled immediate delivery for that profile.

Existing-game breakthrough alerts should remain daily in the first version. A later version can introduce a rare immediate **Breakthrough** event requiring multiple independent signals rather than a single volatile metric.

## Criteria Supported by Existing Data

The criteria below were selected after reviewing the current Tiger schema, current production population, the unreleased-game projection, the existing alert worker, and the opportunity reports listed in [Research Basis](#research-basis).

### Reliable v1 filters

These can determine eligibility when the necessary value is present:

| Criteria group    | Supported choices                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Steam identity    | app type, exact game, developer, publisher                                                                              |
| Release state     | unreleased, coming soon, dated future, newly released, released within a chosen window, Early Access/release-state text |
| Release timing    | exact date where available, days until release, dated or undated                                                        |
| Taxonomy          | tags, genres, Steam categories/features, match any or match all                                                         |
| Commercial        | free or paid, current price range, discount, purchase-package presence                                                  |
| Platform          | Windows, macOS, Linux, controller support, Steam Deck state where available, languages                                  |
| Product readiness | demo relationship, screenshots, trailers, store-page completeness                                                       |
| Publisher context | no publisher listed, developer/publisher name overlap, small publisher, established publisher                           |
| Company history   | developer game count, publisher game count, released-game count, prior portfolio review/owner context where available   |
| Content policy    | adult-content exclusion and other available Steam content descriptors                                                   |
| Fresh activity    | selected store-change types, official Steam announcements, build activity, and activity counts within a chosen window   |

Publisher status must be worded honestly:

- **No publisher listed** is an observed Steam-data state, not proof that no agreement exists.
- **Self-published** means a normalized developer name overlaps a listed publisher name.
- **Small publisher** is a PublisherIQ classification based on visible portfolio size and reach.
- **Unsigned** must not be presented as a verified fact unless separately confirmed.

### Supported derived preferences and thresholds

These are useful for ranking or optional thresholds, but must show their calculation and data window:

- review count and positive percentage;
- reviews added over 7 or 30 days;
- review velocity and velocity tier;
- current or peak CCU;
- CCU change relative to a 7-day baseline;
- 7-day and 30-day CCU growth where fresh history exists;
- trend direction and acceleration;
- announcement and change cadence;
- store-readiness components;
- developer/publisher portfolio reach;
- comparable-game cohort rank and percentile;
- cohort performance distributions, supply, momentum, and concentration;
- preset-level market health and acceleration;
- new YouTube videos, uploading channels, views, and view deltas for games with coverage; and
- decomposed opportunity-score components.

The current alert system already provides useful starting thresholds:

- CCU anomaly: at least 100 CCU and roughly 50% above or below the 7-day average;
- review surge: at least 5 reviews per day and at least 3x the normal velocity;
- sentiment shift: at least 50 reviews and a 5-point positive-ratio change; and
- review milestones: 1K, 10K, 50K, 100K, 500K, and 1M.

These are defaults users can modify where the profile exposes that signal. They are not universal definitions of a publishing opportunity.

### Not reliable as v1 hard filters

These should be excluded, marked experimental, or used only as clearly labeled research context:

- verified unsigned or deal-availability status;
- actual Steam wishlists;
- developer funding need, budget, team size, or willingness to sign;
- contactability or verified outreach details;
- predicted revenue or actual unit sales;
- complete Twitch or creator-market coverage;
- YouTube absence as evidence that no coverage exists;
- full multilingual community sentiment;
- automated judgments about product quality or team fit; and
- whether a publisher can materially improve the game.

Existing bespoke reports can enrich the canonical game record with some of this context, but it should not silently become a daily eligibility rule until coverage and refresh behavior are standardized.

## Rule Logic

The evaluation order is deterministic and visible:

1. **Check data readiness.** Hold the candidate if a required field is unknown.
2. **Apply exclusions.** Any positively matched exclusion removes the game.
3. **Apply required rules.** Every required rule group must pass.
4. **Apply preferences.** Preferred matches affect rank but not eligibility.
5. **Apply event recency.** The qualifying event must belong to the current run window unless this is an explicitly labeled newly qualified result.
6. **Deduplicate.** One user receives one result per game per run, even if several profiles match.

### Combining rules

- Different required rule groups use **AND**.
- A list within one rule defaults to **ANY**.
- Users can change a taxonomy list to **ALL** for combinations such as `Roguelike AND Deckbuilder`.
- Exclusion lists use **ANY**: one matched exclusion is enough to remove the game.
- Preferred rules can use low, medium, or high importance. Their contribution is shown in the result explanation.

### Unknown values

Rules use three states: true, false, and unknown.

- Unknown required value: hold while enrichment is pending; fail with a visible data-coverage reason after the readiness window expires.
- Unknown preferred value: no ranking benefit and no penalty.
- Unknown excluded value: does not exclude the game.

This prevents missing data from being silently treated as a positive match.

## Ranking and Deduplication

Required rules decide eligibility. Ranking happens only after eligibility.

Rank order should use:

1. **User fit (35%):** preferred-rule importance and match count after every required rule and exclusion has already been resolved;
2. **Current signal strength (30%):** event recency, change materiality, whether the event caused first qualification, and the magnitude of relevant game-level changes against stated baselines;
3. **Relative peer position (20%):** the game's percentile within its comparable cohort on the metrics available for its release state;
4. **Market and preset momentum (10%):** the breadth and persistence of growth across comparable games, not merely the performance of one hit; and
5. **Evidence quality (5%):** source freshness, coverage, and confidence, followed by stable appid ordering as the final tie-breaker.

These are the starting v1 weights and must be backtested before launch. User-selected preference importance changes the distribution inside the User fit component; it does not change the hard-filter rules. The stored result must retain every component, raw metric, baseline, comparison window, and material event so that the rank can be explained without relying on the combined number.

The existing 100-point opportunity score should be decomposed and shown as supporting context, not used as the sole alert threshold. In the May 11 unreleased report, the top 30 games all scored 93, demonstrating that the score is useful for broad shortlisting but too saturated to determine precise daily alerts by itself.

When one game matches multiple profiles:

- the website stores one canonical user result;
- the result lists every matching profile and rule set;
- the highest delivery urgency wins;
- email and Slack include the game only once; and
- the team-level game record remains singular.

## Market Context and Preset Intelligence

### Why a game ranked highly

Every result needs a short, evidence-backed answer to five questions:

1. **Why did it qualify?** Name the required and preferred profile rules it matched.
2. **Why now?** Name the new or material event that caused the current appearance.
3. **How does it compare?** State its rank or percentile within the relevant peer cohort and the metrics driving that position.
4. **How is this market performing?** Summarize the comparable cohort's performance, trajectory, supply, and concentration.
5. **How certain are we?** State coverage gaps, stale sources, proxy measurements, and whether the conclusion is High confidence or Directional.

The explanation should identify favorable and unfavorable evidence. A high rank is a research-priority signal, not a prediction that the game will succeed or that a publishing deal is available.

### Comparable-game cohort

A comparable cohort must be reproducible rather than an unexplained list of “similar games.” The default v1 cohort uses:

- overlap in primary tags, genres, and Steam categories;
- the same release state and a relevant release-age window;
- a similar price band and free-to-play or premium model;
- similar Early Access status where relevant; and
- publisher/developer scale when it materially changes the comparison.

The result stores the cohort definition, cohort size, included games, and the reason each game was included. Semantic similarity can improve the candidate set later, but cannot be the only unexplained basis for comparison.

An unreleased game's product-readiness and pre-release signals should be compared with other upcoming games. Its market potential should be grounded primarily in the performance of comparable **released** games. This avoids treating the absence of post-release metrics on an unreleased title as poor performance.

The cohort summary should cover, where data is sufficiently fresh:

- sample size and source coverage;
- review count, positive percentage, and review-velocity distributions;
- current and peak CCU, growth, and persistence distributions;
- price and discount distributions;
- recent releases, upcoming supply, demos, and new entrants;
- the percentage of games improving rather than only aggregate growth;
- official-news, store-change, and creator activity where covered; and
- concentration, including whether one or two outliers explain most of the apparent market.

### Market-potential language

PublisherIQ should describe **market potential**, not present a falsely precise total addressable market or guaranteed revenue forecast. The v1 result should use the released peer cohort to provide:

- lower-quartile, median, upper-quartile, and breakout performance outcomes;
- the number and share of comparable games that crossed meaningful review or CCU thresholds;
- recent demand direction and the breadth of that movement;
- current and upcoming supply; and
- an overall potential band with a plain-language explanation.

CCU is an activity proxy, reviews are a purchase-and-engagement proxy, and neither is total market size. Owner or revenue ranges may be added only when the estimation method, coverage, date, and uncertainty are visible; such estimates remain **Directional**. The result should explicitly warn when a cohort is small, stale, highly concentrated, or poorly matched.

### Preset health and “Surging”

Each PublisherIQ preset and sufficiently broad user profile can receive one of these health states:

- **Insufficient data:** the cohort or source coverage cannot support a responsible conclusion.
- **Quiet:** little qualifying activity and no broad demand movement.
- **Active:** normal activity near the preset's historical baseline.
- **Growing:** multiple indicators are improving, but the evidence has not met the stricter surge test.
- **Surging:** demand is accelerating broadly and persistently across the comparable market.
- **Cooling:** demand has fallen materially below the preset's recent baseline across more than isolated titles.

The initial **Surging** rule is conservative. It requires:

1. at least 10 comparable released games with current core metrics and at least 60% coverage of the eligible cohort;
2. material improvement in at least two independent demand indicators, with at least one derived from reviews or CCU;
3. positive movement across at least 40% of the measured cohort;
4. no single game accounting for more than half of the aggregate improvement; and
5. the condition persisting across two consecutive daily evaluations.

The primary comparisons are the latest 7 days against the preceding 30-day baseline and the latest 30 days against the preceding 90-day baseline. Exact materiality thresholds should be backtested and versioned before release. A state change must name the metrics, windows, cohort size, coverage, and leading contributors that caused it.

Tag and genre additions/removals can indicate that developers are repositioning toward or away from a theme. They are useful supply and positioning evidence, but do not prove player demand and cannot produce a Surging label without corroborating review, CCU, or other audience evidence.

Preset health is context and a ranking input. It never makes an otherwise ineligible game appear in a user's alert.

### Future recommended presets

A later interaction can recommend new presets based on growth across PublisherIQ's overall data. A candidate recommendation should require sustained demand growth, breadth across several games, adequate data coverage, a coherent tag/genre/category intersection, and an understandable relationship between current supply and audience activity.

Each recommendation should contain:

- a proposed preset name and complete visible rule set;
- why the market was detected and the time windows used;
- cohort performance, growth breadth, supply, and concentration;
- representative released, upcoming, and newly matching games;
- confidence and important counterevidence; and
- a preview of current matches before the user creates a personal copy.

PublisherIQ should not recommend a preset solely because of one breakout game, taxonomy churn, a very small cohort, or sparse creator data. A recommendation never auto-subscribes a user. PublisherIQ can editorially review and promote strong system suggestions into maintained presets.

## Website: Canonical Record

The website is the complete and durable source of truth for every result.

### Daily overview

The daily overview contains:

1. coverage period and data-evaluation time;
2. profiles evaluated;
3. preset and profile health changes, including any newly Surging or Cooling areas;
4. new discoveries;
5. newly released matches;
6. newly qualified matches;
7. materially changed prior matches;
8. tracked-game updates, when enabled;
9. data coverage or source-health warnings; and
10. total matches found versus results included in delivered summaries.

### Canonical game record

Each game record should include:

- game, developer, publisher, Steam link, and current release state;
- the event that caused the game to appear and its timestamp;
- whether the game is newly discovered, newly released, newly qualified, or materially changed;
- every profile and criterion it matched;
- required, preferred, excluded, and unknown rule outcomes;
- the decomposed ranking and the evidence behind every component;
- the comparable cohort definition, included titles, and the game's relative position;
- peer performance distributions, market momentum, supply, concentration, and a directional market-potential assessment;
- current metrics, deltas, baselines, and named measurement windows;
- recent store, demo, media, build, price, publisher, and release-date changes;
- available Steam news and YouTube evidence;
- data sources, last-updated timestamps, and missing-data warnings;
- observed facts, derived metrics, and PublisherIQ interpretations;
- previous appearances and the events that caused them;
- the user's dismiss or ignore state; and
- basic team viewing/research activity.

Any score must expose its component values. No result should require the user to trust an unexplained ranking.

## Evidence Language

Each claim uses one of three evidence classes:

- **Observed fact:** directly captured Steam or source data, such as release date, listed publisher, price, CCU observation, review count, or store change.
- **Derived metric:** a reproducible calculation, such as review velocity, CCU change from baseline, portfolio reach, or estimated base price.
- **PublisherIQ interpretation:** an explanation of why the observed and derived signals may matter to a publisher.

Confidence is separate from evidence class:

- **High confidence:** direct or well-covered data with clear provenance.
- **Directional:** incomplete coverage, proxy data, automated classification, or a pattern that supports investigation but not certainty.

Hard filters should rely on observed facts or explicitly chosen derived metrics. Interpretations explain and prioritize; they do not silently determine eligibility.

“Surging,” “market potential,” and preset recommendations are PublisherIQ interpretations derived from named metrics and versioned rules. They must not be presented as observed facts. Taxonomy movement is interpreted as supply or positioning activity unless separate audience data supports a demand claim.

## Team Workflow

The feature needs a real team or workspace identity. The current `user_profiles.organization` text field is not enough to support shared visibility, membership, roles, or access control.

The minimum team behavior is intentionally lighter than a CRM:

- **Viewed by:** recorded automatically when a member opens the canonical game record.
- **Researching:** an optional manual claim showing that a member is actively researching the title.

These are the "lightweight team states." They prevent duplicate work without introducing contact, negotiation, deal-stage, or pipeline management.

Personal actions do not affect teammates:

- **Dismiss:** removes this occurrence for the user. The game can reappear for that user after a new subscribed material event.
- **Ignore:** suppresses the game across that user's profiles until the user restores it.
- **Track:** keeps the game visible to that user for future selected updates.

Another team member can still receive, view, research, dismiss, ignore, or track the same game independently.

## Delivery Channels

### Website

- complete result set;
- full evidence and change history;
- profile-match explanation;
- team viewing/research activity;
- dismiss, ignore, track, and researching actions; and
- links to Steam and other available research sources.

### Email

- personalized subject indicating whether new matches exist;
- coverage period and short summary;
- top results up to the user's configured maximum;
- one concise reason and strongest evidence for each result;
- one concise peer or market comparison for each result;
- clear link to the canonical game record;
- link to the full daily overview when results are truncated; and
- personal frequency, timing, profile, and quiet-day controls.

### Slack

- delivered to the user's selected destination where permissions allow;
- compact summary with top results;
- compact preset-health changes and one market-context reason per top result;
- one message per daily digest rather than one message per ordinary result;
- urgent new-full-match alerts delivered separately when enabled;
- links to canonical game records;
- no duplicate delivery of the same game for overlapping profiles; and
- no exposure of private personal criteria beyond what the user chooses to send.

Channel delivery is personalized. The underlying result and game record are shared from the website; the volume and presentation are not identical across channels.

## Quiet Days, Failures, and Reappearance

- Users choose whether to receive an explicit "no new matches" message or skip quiet-day delivery.
- Failed runs do not advance the evaluation cursor.
- The next successful run covers the missed interval and states the longer coverage period.
- Source outages or stale data are shown in the overview and on affected results.
- A dismissed game can reappear only after a new event enabled by one of the user's profiles.
- An ignored game does not reappear until the user removes the ignore.
- A game reappearing must say what changed since its prior appearance.

## Data and Pipeline Findings

Read-only production inspection through July 23, 2026 found:

- `legacy.latest_daily_metrics` was current through July 23 with about 132K rows on the latest metric date.
- `metrics.review_velocity_stats` contained about 82K games, with roughly 11K refreshed on the latest day.
- the unreleased projection contained about 51K games, including tags for about 43K, screenshots for about 51K, and trailers for about 39K;
- fresh change data included price, description, discount, news, trailer, release-date, screenshot, demo, taxonomy, publisher, developer, platform, controller, and language changes;
- daily YouTube rollups were current, but coverage was partial and represented roughly 400 games per content class on the inspected date;
- 266 app rows were created in the preceding 24 hours: 198 AppList game rows and 68 demo stubs discovered through storefront relationships;
- all 198 new AppList games had completed storefront sync and received developer/publisher relationships, but none had completed PICS sync or received Tiger tag or genre rows;
- the most recent Tiger `last_pics_sync` and PICS change event were June 16, 2026, with no Tiger PICS latest-state syncs in the preceding 24 hours and a large first-pass backlog;
- Tiger held about 3.45 million change events in total and about 13,700 in the preceding 24 hours, but price and discount events accounted for roughly 62% of the daily raw event volume; and
- the retained Supabase PICS state was older still, with its most recent `last_pics_sync` on April 30, 2026.

These findings lead to the following requirements:

1. **Do not use `metrics.unreleased_games_projection.latest_added_at` as the new-game clock.** It currently derives from `last_seen_in_steam_applist_at`, which is refreshed for much of the catalog and made roughly 50K unreleased games appear added within 24 hours.
2. **Create a durable first-seen and evaluation ledger.** Newness, last successful run, prior match state, deduplication, dismissal, ignore, and reappearance must not be reconstructed from mutable current-state fields.
3. **Restore and verify PICS latest-state ingestion before depending on taxonomy.** The missing tags in the inspected cohort were not merely a short per-game delay; the PICS latest-state path was stale in both Tiger and Supabase. The repository implements a bounded `MODE=first_pass` worker, but no checked-in scheduled workflow runs it automatically. Friday, July 24, 2026 production inspection verified that Railway service `publisheriq` was deployed in `change_monitor` mode with Tiger targets, while `/health` remained `OK` even though `/status.updated_at`, `/status.last_successful_change_poll_at`, and the Tiger cursor were frozen on June 16, 2026.
4. **Use a dedicated, freshly maintained opportunity read model.** The existing generic apps projection inspected during research was stale, while underlying daily metrics and change data were current.
5. **Treat YouTube as additive evidence.** Partial coverage cannot support a universal exclusion such as "no creator coverage."
6. **Add a real team/workspace control model.** Shared records and team activity require memberships and access rules beyond the existing organization text field.
7. **Keep a data-readiness gate even after PICS is repaired.** Catalog, storefront, PICS, metrics, and creator data arrive through separate pipelines and will not become available atomically. New records must be re-evaluated as required fields arrive instead of being alerted prematurely or dropped permanently.
8. **Persist comparable-cohort and preset-health snapshots.** Ranking explanations, market context, and Surging state changes must be reproducible from the cohort membership, metrics, baselines, coverage, and rule version used for that daily run rather than recalculated later from mutable current state.
9. **Treat change intelligence as a first-class candidate source.** Every criteria-affecting event re-evaluates the game, and subscribed material events can resurface an existing match. Do not reduce change handling to an optional notification after the new-game scan.
10. **Separate raw events from material opportunity events.** Preserve the existing detailed change ledger, then version the grouping, materiality, and opportunity classification used by daily results. This prevents routine discount churn from overwhelming release, demo, publisher, taxonomy, and traction events.
11. **Do not trust the current `catalog_seed_state='hydrated'` value as readiness.** The AppList worker assigns it before storefront or taxonomy enrichment, while demo discovery uses `stub` for a different path. Readiness needs source-specific durable states.

No database or production changes are part of this document. These are implementation prerequisites for a later approved design and migration plan.

The detailed implementation gap analysis, recommended data ownership, new calculations, launch blockers, and delivery sequence are documented in [Custom Daily Steam Opportunity Brief: Backend Assessment](./custom-daily-steam-opportunity-backend-assessment.md).

## Research Basis

The criteria and evidence model draw from:

- [Unreleased Game Publishing Opportunity Overview](../reports/unreleased-publisher-opportunity-overview-2026-05-11.md)
- [How We Rank Publisher Opportunities Today](../reports/publisher-opportunity-ranking-overview.md)
- [Six-Month Self-Published Publisher Opportunity Memo](../reports/self-published-six-month-15-25-publisher-opportunity-2026-06-12.md)
- [Self-Published Steam Breakouts](../reports/self-published-steam-breakouts-content-strategy-2026-06-11.md)
- [Roguelike Publisher Opportunity Methodology](../reports/roguelike-publisher-opportunity-methodology-2026-04-09.md)
- [Tag and Genre Market Shifts](../reports/tag-genre-market-shifts-2026-04-06.md)
- [Go-to-Market Opportunity Study](../reports/go-to-market-opportunity-study-2026-03-26.md)
- [Go-to-Market Opportunity Overview](../reports/go-to-market-opportunity-overview-2026-03-26.md)
- [Unreleased Games Tiger Projection](../../packages/data-plane/sql/tiger-bootstrap/0084_unreleased_games_page_projection.sql)
- [Existing Alert Detection Worker](../../packages/ingestion/src/workers/alert-detection-worker.ts)

The reports demonstrate that PublisherIQ can already combine release timing, taxonomy, listed publisher status, portfolio reach, store readiness, activity cadence, reviews, CCU, official announcements, content strategy, and confidence language into useful research shortlists. They also provide precedents for decomposed rankings and for measuring whether tag/genre activity is accelerating. The new feature turns the repeatable portion of that work into a user-defined daily detection system, adds released-peer context to every opportunity, and keeps bespoke interpretation in the canonical research record.

## Minimum Viable Version

The first version requires:

- a new canonical opportunities area on the website;
- PublisherIQ-authored, versioned presets;
- user-owned profiles cloned from presets or created from scratch;
- required, preferred, excluded, ANY, and ALL rule behavior;
- visible missing-data handling;
- a current-catalog profile preview;
- a durable first-seen, run, and result ledger;
- data-readiness gating and delayed re-evaluation;
- daily detection of newly discovered, newly released, and newly qualified full matches;
- optional material-change events for known matches;
- website delivery plus user-configurable email and Slack summaries;
- an opt-in immediate new-full-match notification;
- canonical game records with evidence and source timestamps;
- a decomposed “why this ranked” explanation for every result;
- transparent comparable-game cohorts and released-peer performance context;
- directional market-potential summaries with coverage and concentration warnings;
- versioned preset-health states, including a conservative Surging test;
- team-level viewed/researching visibility;
- personal dismiss, ignore, and track actions; and
- explicit observed, derived, interpretation, and confidence labels.

It does not require:

- automated developer outreach;
- contact or deal-stage management;
- a sourcing CRM;
- automatic claims that a game is unsigned;
- full diligence reports for every match;
- predicted deal quality;
- a precise or guaranteed total market-size estimate;
- automatically generated or enabled preset recommendations;
- complete creator-market coverage; or
- a real-time market firehose.

## Success Condition

The feature succeeds when each team member can describe the Steam games they care about, understand how their rules behave before enabling them, receive a manageable daily set of genuinely new or newly relevant matches, see why every game appeared and ranked highly, understand how similar games and the broader preset market are performing, avoid duplicate team research, and begin investigating a promising title earlier than they would through manual discovery.
