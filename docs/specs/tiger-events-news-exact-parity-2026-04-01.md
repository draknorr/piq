# Tiger Events/News Exact Parity and `searchDocuments` Promotion

Date: April 1, 2026

> Historical note: this document records the parity gate that promoted `searchDocuments` into the ready Tiger contract set. Keep it as a milestone record, not as the source of truth for the current runtime.

This note records the first exact-parity green run for the Tiger docs/event
slice after the sync-hardening and chat-shadow phases.

## What changed

- `pnpm tiger:reconcile-events-news` now repairs two different classes of drift:
  - recent live-window churn for `docs.steam_news_items` and
    `events.app_change_events`
  - historical under-sync for `docs.steam_news_search_projection`, with a full
    mismatched-month replay
- The reconcile runner now emits progress logs for each table and exits
  deterministically after writing its manifest.
- `searchDocuments` is promoted from `planned` to `ready` in the Tiger contract
  registry.

## Repair strategy

- `docs.steam_news_items`
  - replay current day, previous day, and mismatched recent days
  - if full counts still differ, scan day counts across full history and replay
    older mismatched days
  - replay the recent window again after any historical repair
- `events.app_change_events`
  - same strategy as `steam_news_items`
- `docs.steam_news_search_projection`
  - replay every mismatched month across full history plus current and previous
    month
  - if the first projection pass leaves any month or recent-day mismatches,
    run a second month replay pass automatically

## Gate artifacts

- Successful full reconcile:
  - `docs/reference/tiger-target-baseline/2026-04-01/events-news-reconcile-exact-parity-2026-04-01/events-news-sync-manifest.json`
- Successful final validate:
  - `docs/reference/tiger-target-baseline/2026-04-01/events-news-validate-final-parity-2026-04-01/events-news-sync-manifest.json`

The final validate artifact shows:

- `steam_news_items`: exact full-table parity
- `app_change_events`: exact full-table parity
- `steam_news_search_projection`: exact full-table parity
- `duplicateEventIds = 0`
- `orphanedNewsItemGids = 0`
- `projectionRowsMissingNewsItems = 0`

## Effect on chat

- Tiger shadow prompt evals for recent-news and change-intel prompts remain the
  validation surface for `/chat`.
- Because the data gate is now green, `searchDocuments` is eligible for
  non-shadow readiness reporting via `/v1/contracts`.
