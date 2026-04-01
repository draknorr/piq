# Tiger Change-Intel Foundation

Date: March 31, 2026

This note defines the next Tiger milestone after `metrics.daily_metrics`.

## Goal

Land the first change-intel slice in Tiger so the new data plane can answer:

- "What changed for this game this week?"
- "Any noteworthy updates or announcements for this title in the last few days?"
- "Show only pricing or release-timing changes for this game this month."

without exposing raw SQL or depending on Supabase-specific read surfaces.

## Storage

This milestone adds three Tiger relations:

- `events.app_change_events`
- `docs.steam_news_items`
- `docs.steam_news_search_projection`

Important Tiger constraint:

- `events.app_change_events` is a hypertable partitioned by `occurred_at`
- Tiger requires hypertable uniqueness to include the partitioning column
- because of that, the table uses a composite primary key `(occurred_at, id)` rather than `id` alone
- source `id` values are still preserved exactly and post-backfill validation must confirm zero duplicate `id` values

## Contract

Endpoint:

- `POST /v1/contracts/explain-changes`

Request shape:

- `entityUid`
- `startTime?`
- `endTime?`
- `includeNews?`
- `sources?`
- `changeTypes?`
- `limit?`

Current defaults and limits:

- default window: last `14` days ending now
- maximum window: `90` days
- default moment limit: `20`
- maximum moment limit: `50`
- scope: Steam game entities only

Current response shape:

- resolved entity metadata
- checked `timeWindow`
- `summary`
- grouped `moments[]`
- event evidence inside each moment
- optional linked recent-news evidence inside each moment
- `provenance`
- `sufficientToAnswer`

## Execution rules

`explainChanges`:

- resolves the game from `core.entities`
- loads matching events from `events.app_change_events`
- groups adjacent events into the same moment when the gap is `<= 6 hours`
- links direct `news_item_gid` matches first
- if a moment has fewer than `3` direct news matches, fills with same-app news within `24 hours` of that moment

This phase intentionally does not:

- cut over `/changes`
- wire `/chat` to the new contract
- migrate raw article/version bodies like `steam_news_versions`
- infer long-form narratives inside Tiger itself

## Validation

Backfill acceptance for this phase requires:

- exact full-table count parity for all three tables
- exact per-day parity for `app_change_events`
- exact per-month parity for both news tables
- zero duplicate `events.app_change_events.id` values in Tiger
- zero orphan `news_item_gid` references
- zero `steam_news_search_projection.gid` rows missing a matching `steam_news_items.gid`

Contract acceptance requires:

- `/v1/contracts` reports `explainChanges` as runtime-ready once the three tables are present and non-empty
- `includeNews=false` returns event-only evidence
- valid empty windows return `200` with empty `moments[]`
- invalid entity kinds, bad UUIDs, and oversized ranges return typed errors
