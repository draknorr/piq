# Unreleased Games Architecture

This document describes the implementation of the `/unreleased` feature.

**Last Updated:** May 8, 2026

## Overview

The Unreleased Games page is a Tiger-backed admin dashboard surface for Steam games that are not released, not delisted, and still storefront-accessible. It is optimized for launch discovery: publisher opportunity, media readiness, recent storefront changes, Steam news, and upcoming release timing.

The page reads TigerData directly from the admin server runtime through `runTigerQuery`. It does not use Supabase RPCs for game data and it does not go through `apps/query-api`. Supabase is still used for signed-in session state and pins.

## Main Route

- page route: `apps/admin/src/app/(main)/unreleased/page.tsx`
- client UI: `apps/admin/src/app/(main)/unreleased/components/UnreleasedPageClient.tsx`
- column selector: `apps/admin/src/app/(main)/unreleased/components/UnreleasedColumnSelector.tsx`
- query layer: `apps/admin/src/app/(main)/unreleased/lib/unreleased-queries.ts`
- column/export helpers: `apps/admin/src/app/(main)/unreleased/lib/unreleased-columns.ts` and `unreleased-export.ts`

## Tiger Projections

The feature depends on `packages/data-plane/sql/tiger-bootstrap/0084_unreleased_games_page_projection.sql`.

That bootstrap SQL creates:

- `metrics.unreleased_games_projection`
- `metrics.unreleased_filter_counts`

`metrics.unreleased_games_projection` precomputes the page row shape from Tiger-side legacy catalog, publisher/developer relationships, taxonomy, storefront snapshots, Steam media, Steam news, and change-intelligence tables.

`metrics.unreleased_filter_counts` precomputes default non-adult taxonomy option counts for genre, tag, and category filters.

Apply this SQL only during an approved Tiger maintenance window. The initial refresh scans multiple large slices and the page intentionally returns a clear missing-projection error instead of falling back to a slow raw query.

Follow-up refreshes are scheduled every 4 hours by
`.github/workflows/unreleased-projection-refresh.yml` when
`ENABLE_UNRELEASED_PROJECTION_REFRESH=true`. The workflow runs against
`TIGER_PRODUCTION_URL`, refreshes the main projection first, then refreshes the
dependent filter-count projection.

Manual follow-up refreshes can use the same dependency order:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.unreleased_games_projection;
REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.unreleased_filter_counts;
```

## Query Behavior

The list and stats APIs build parameterized SQL against `metrics.unreleased_games_projection`.

Performance rules:

- default limit is 50 rows
- max limit is 250 rows
- all search/filter values are bound parameters
- stats are cached in memory for 5 minutes per normalized filter set
- filter-count requests use `metrics.unreleased_filter_counts` for the unfiltered default state
- broad text search uses app title, app ID, publisher, and developer fields

The projection includes B-tree indexes for common sort orders, GIN indexes for array filters, and trigram indexes for name/entity search.

## Opportunity Score

`opportunity_score` is computed in the projection as a 0-100 signal from:

- release timing
- 30d change and announcement activity
- taxonomy, store page, and media changes
- screenshots, trailers, tags, categories, genres, and price/free completeness
- publisher fit, with more weight for no-publisher, self-published, and small-publisher games

The UI labels this as `Opp Score` in compact table headers and exposes a tooltip with the short methodology.

## Filters And Sorting

Supported sort fields:

- `opportunity_score`
- `latest_added_at`
- `release_date`
- `name`
- `publisher_name`
- `developer_name`
- `primary_tag_name`
- `primary_category_name`
- `latest_news_at`
- `latest_change_at`
- `change_count_30d`
- `screenshot_count`
- `movie_count`

Supported filters include search, adult-content mode, release status, publisher status, publisher/developer search, release window, minimum Opportunity Score, change/news activity, media presence, commercial flags, taxonomy arrays, platform arrays, and signal-family arrays.

Adult content defaults to `exclude`. `include` keeps adult and non-adult rows, and `only` shows adult rows only.

## Column And Export Model

Visible data columns are URL-first through the `columns` query parameter.

Rules:

- invalid or duplicate column IDs are removed
- an empty or fully invalid column list falls back to defaults
- selection, row actions, and game identity are locked outside the customizable data-column list
- the table renders visible data columns in user-defined order
- CSV export uses the same visible data-column order

CSV export always starts with `appid`, `name`, `steam_url`, and `publisheriq_url`, then appends export fields from visible columns.

## Detail Drawer

The drawer fetches `/api/unreleased/[appid]/detail` on demand.

The detail query returns:

- the projected game row
- latest media version screenshots, trailers, and hero assets from `docs.app_media_versions`
- recent change events from `events.app_change_events`
- recent Steam news from `docs.steam_news_items` plus `docs.steam_news_search_projection`

The drawer tabs are Overview, Media, Timeline, and News. Media frames use contained image layout so unusual Steam asset dimensions remain visible.

## Timeline

`/api/unreleased/[appid]/timeline` merges:

- change events from `events.app_change_events`
- Steam news from `docs.steam_news_items`

The route sorts by event/news time descending, supports `limit` and `offset`, caps page size at 100, and returns `next_offset` when more items are available.

Steam news URLs are normalized to:

```text
https://store.steampowered.com/news/app/{appid}/view/{gid}
```

This avoids community announcement pages that can show no events even when Tiger captured a news item.

## Pins And Watch State

The Watch button uses the existing Supabase-owned `user_pins` system:

- create pin: `POST /api/pins`
- check visible rows: `GET /api/pins/check?entityType=game&entityIds=...`

Bulk pin checks are capped to 250 entity IDs, matching the page max limit. This keeps table watch state fast without one request per row.

## Internal APIs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/unreleased` | list rows plus aggregate stats |
| `GET /api/unreleased/filter-counts` | genre/tag/category option counts |
| `GET /api/unreleased/[appid]/detail` | drawer detail payload |
| `GET /api/unreleased/[appid]/timeline` | paginated timeline events |

All endpoints require an authenticated Supabase session cookie.

## Failure Modes

| Failure | Behavior |
|---------|----------|
| `TIGER_PRIMARY_URL` / `CHANGE_INTEL_TIGER_URL` missing | page renders Tiger configuration error |
| projection missing | page renders the explicit `0084_unreleased_games_page_projection.sql` message |
| detail not found | detail route returns 404 |
| invalid app ID | detail/timeline routes return 400 |
| unauthenticated request | API returns auth error response |

## Validation

Useful checks for this surface:

```bash
pnpm --filter @publisheriq/admin test -- src/app/'(main)'/unreleased/lib/unreleased-columns.test.ts src/app/'(main)'/unreleased/lib/unreleased-export.test.ts
pnpm --filter @publisheriq/admin lint
pnpm --filter @publisheriq/admin build
```

Manual smoke:

- open `/unreleased`
- verify rows load instead of the missing-projection error
- sort by Opportunity Score, release date, latest added, latest update, and news
- change visible column order and confirm the URL `columns` parameter updates
- export visible rows and selected rows
- open a drawer, review Media, Timeline, and News tabs
- watch a game and confirm it appears pinned

## Related Documentation

- [Unreleased Games User Guide](../../user-guide/unreleased-games.md)
- [Internal API](../../api/internal-api.md)
- [TigerData Operating Model](../architecture/tigerdata-operating-model.md)
- [Database Schema](../architecture/database-schema.md)
- [Personalization](./personalization.md)
