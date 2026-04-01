# Tiger Events and News Load Status

Date: March 31, 2026

This note records the observed state of the change-intel milestone after the
Tiger dev load, validation pass, and same-day reconciliation.

## Loaded Tiger relations

- `events.app_change_events`
- `docs.steam_news_items`
- `docs.steam_news_search_projection`

Baseline snapshot:

- [post-events-news](/Users/ryanbohmann/Desktop/publisheriq/docs/reference/tiger-target-baseline/2026-03-31/post-events-news)

## Validation outcome

At the end of the March 31 validation pass:

- `docs.steam_news_items`
  - source count: `1,736,471`
  - Tiger count: `1,736,471`
  - status: exact parity at validation time
- `events.app_change_events`
  - source count: `2,133,199`
  - Tiger count: `2,133,199`
  - status: exact parity at validation time
- `docs.steam_news_search_projection`
  - source count: `1,331,335`
  - Tiger count: `1,331,290`
  - status: structurally valid, but still `45` rows behind the live source

Integrity checks:

- duplicate `events.app_change_events.id` rows in Tiger: `0`
- orphan `events.app_change_events.news_item_gid` rows: `0`
- `docs.steam_news_search_projection.gid` rows missing a matching `docs.steam_news_items.gid`: `0`

## Contract readiness

Tiger-backed contract readiness at the end of the validation pass:

- `resolveEntities`: ready
- `searchCatalog`: ready
- `rankEntities`: ready
- `traceMetricHistory`: ready
- `explainChanges`: ready
- `searchDocuments`: still planned

## ExplainChanges smoke test

Validated against Tiger using:

- entity: `Primeval`
- `entity_uid`: `c96bdd61-1eed-5e4b-bd9b-3089da15bb50`

Observed response summary:

- `eventCount`: `13`
- `momentCount`: `3`
- `newsCount`: `0`
- `countsBySource.pics`: `13`
- `countsByChangeType.build_id_changed`: `6`
- `countsByChangeType.last_content_update_changed`: `7`

## Remaining gap

`docs.steam_news_search_projection` is the only table in this slice that was not
at exact parity at the end of the March 31 validation pass.

This is not a schema or integrity failure. The live source continued mutating
while the load and reconciliation were running, including inserts into older
projection months. The table is usable for dependency satisfaction and internal
joins, but it should not be treated as fully converged until we add a repeatable
incremental reconciliation path for projection churn.
