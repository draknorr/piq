# Daily Opportunity Brief

The Daily Opportunity Brief at `/opportunities` turns your sourcing criteria into a
personal, replayable list of newly relevant Steam games. The website is the
canonical record; email and Slack are summaries that link back to it.

## Start from a preset or a blank profile

PublisherIQ ships eight visible, versioned starting presets:

- Roguelike Deckbuilder
- Cozy Sim
- Extraction Shooter
- Narrative Horror
- Colony Sim + Survival
- New Self-Published Indie Releases
- Upcoming Games With Demos
- Recently Released Games Showing Early Traction

Cloning a preset creates your own profile. Later preset revisions do not silently
change it. You can also build a blank profile.

## Build and preview a profile

A profile has three rule sections:

- **Required:** every group must pass for the game to qualify.
- **Preferred:** changes ranking within the eligible set; it never overrides a
  required rule or exclusion.
- **Excluded:** any positively matched exclusion suppresses the game.

Each group can match **ALL** or **ANY** of its rules. Missing required data is
shown as unknown and held for readiness re-evaluation; it is not treated as a
failed match.

Use **Preview profile** before enabling it. Preview uses the same rule compiler
as the daily evaluator and shows:

- current catalog match count;
- representative matches;
- the required groups eliminating the most candidates;
- field coverage; and
- warnings where evidence is sparse or delayed.

Preview describes the current catalog. It does not promise what a historical
daily report would have contained.

Choose the profile's local daily time before saving. The timezone shown in the
editor comes from your browser. Enabling starts the first evaluation
immediately; later briefs follow that local schedule. Enabled profiles can be
paused, resumed, or archived without deleting their versions or historical
results.

## What appears in the daily brief

A result can be:

- **Newly discovered:** PublisherIQ first observed the Steam game in the run
  window.
- **Newly released:** an observed release-state transition occurred in the
  window.
- **Newly qualified:** required enrichment arrived after discovery and the game
  passed for the first time.
- **Materially changed:** a previously matching game produced a subscribed,
  material event.
- **Tracked update:** a tracked title received a relevant update.

Routine source churn can trigger background re-evaluation without creating a
result. Immediate alerts are opt-in and, in v1, are limited to a newly observed
game that is ready and fully matches the profile.

## Read a canonical game record

Open any result to inspect:

- why the game appeared now;
- all matched profile versions and tri-state rule outcomes;
- the decomposed rank and published v1 weights;
- the deterministic released-game cohort, inclusion reasons, coverage, and
  fallback tier;
- directional market context, distributions, demand direction, and
  concentration warnings;
- observed and derived evidence with source timestamps;
- before/after material changes;
- recent official Steam news;
- additive YouTube evidence, explicitly labeled as partial coverage;
- missing evidence and calculation versions;
- the exact run window, source watermarks, triggering-event timestamps, matched
  profile version IDs, calculation versions, and delivery history; and
- earlier appearances of the same game.

Market-potential labels are directional. Reviews and CCU are proxies, not a
revenue forecast or guaranteed market size.

## Personal and team state

- **Track** keeps the title in your personal watch set.
- **Dismiss** removes only the current occurrence. A different subscribed event
  can make the game reappear.
- **Ignore** suppresses the game until you restore it.
- **Research** shares that you are actively researching the title with workspace
  members.
- Opening a record adds a shared viewed marker.

Profiles, delivery preferences, dismissals, ignores, and tracking are personal.
Viewed and researching activity is shared inside the workspace.

## Delivery settings

Website results are always canonical. You can additionally enable:

- email to the verified email address on your Supabase identity; or
- a Slack incoming-webhook URL.

Choose a maximum result count and whether quiet days should be skipped or sent
as an empty digest. Delivery can cover all profiles in one combined brief or be
scoped to one profile. A result that matches several profiles is included at
most once per channel, and a limited summary states how many additional results
remain on the canonical website. Destinations are encrypted at rest. Slack URLs
must use an approved Slack webhook host.

Delivery retries use a stable idempotency key. If Slack returns an ambiguous
network failure after the request may have reached Slack, PublisherIQ fails
closed rather than risking a duplicate post.

## Evidence limits

- Taxonomy-dependent rules wait when PICS readiness is incomplete.
- YouTube coverage is partial and additive. No matched video is not evidence
  that a title has no creator coverage.
- Small, stale, concentrated, or poorly measured cohorts remain directional or
  insufficient.
- Preset-health labels describe a stable released reference cohort and never
  make a game eligible.

## Related documentation

- [Unreleased Games](./unreleased-games.md)
- [Change Feed](./change-feed.md)
- [Daily Opportunity Brief operations](../developer-guide/workers/opportunity-brief.md)
- [Opportunity calibration](../reference/opportunity-calibration-2026-07-27.md)
