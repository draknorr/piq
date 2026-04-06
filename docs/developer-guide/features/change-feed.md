# Steam Activity Architecture

This document describes the implementation of the `/changes` feature and its unified activity read path.

## Overview

Steam Activity is a signed-in dashboard surface that lets users inspect:

- one unified activity feed of grouped change cards and announcement cards
- readable before / after detail for grouped change activity
- related announcements, news digests, and topic search results
- capture health and projection freshness status

The page itself remains Supabase-backed. Chat uses some of the same underlying projections through the system contract service, but the page route does not go through query-api.

## Main Route

- page route: `apps/admin/src/app/(main)/changes/page.tsx`
- client UI: `apps/admin/src/app/(main)/changes/ChangeFeedPageClient.tsx`
- legacy drawer: `apps/admin/src/app/(main)/changes/ChangeFeedDrawer.tsx`

## Data Model

The feature now works with these main response shapes:

- `ChangeFeedActivityResponse`
- `ChangeFeedActivityDetailResponse`
- legacy burst/news response types for fallback and app-specific drill-down

These are defined in `apps/admin/src/app/(main)/changes/lib/change-feed-types.ts`.

## Filters and Querying

The unified activity feed supports:

- quick view
- mode
- range
- app type
- signal family filters
- search
- sort
- cursor pagination

Parameter parsing and row mapping live in `change-feed-query.ts`.

## Server Access Layer

`change-feed-server.ts` is the server-side access layer.

It is responsible for:

- calling Supabase RPCs
- mapping raw rows into activity-card UI types
- falling back to legacy burst/news surfaces if the unified RPC is unavailable
- caching default activity responses for a short TTL
- pulling recent-news digests and topic-search rows from the lean news projection
- exposing topic search through the server access layer and chat tools rather than a dedicated public route

## Internal APIs

| Endpoint | Purpose |
|----------|---------|
| `/api/change-feed/activity` | unified activity list |
| `/api/change-feed/activity/[activityId]` | unified activity detail |
| `/api/change-feed/bursts` | burst list |
| `/api/change-feed/bursts/[burstId]` | burst detail |
| `/api/change-feed/news` | news list |
| `/api/change-feed/status` | capture health status |

All endpoints require an authenticated session.

## SQL Read Surfaces

The feature depends on these functions:

- `get_change_feed_activity`
- `get_change_feed_bursts`
- `get_change_feed_burst_detail`
- `get_change_feed_news`

The broader change-intel runtime also shares `get_chat_recent_news`, `search_recent_news_topics`, `get_chat_change_activity_candidates`, and `get_chat_change_pattern_candidates` with the chat system, but those RPCs are not used directly by the page route.

They are created by:

- `20260323193000_add_change_activity_projection.sql`
- `20260324110000_add_change_pattern_activity_days.sql`
- `20260324133000_add_change_pattern_app_windows.sql`
- `20260329235900_add_chat_recent_news_digest_rpc.sql`
- `20260330001000_add_recent_news_topic_search.sql`
- `20260315193000_add_change_feed_activity_read_surface.sql`
- `20260315114500_add_change_feed_read_surfaces.sql`
- `20260315143000_optimize_change_feed_news_rpc.sql`

## Status Semantics

The status endpoint derives one of three states:

- `healthy`
- `catching_up`
- `delayed`

The state is based on:

- queued storefront/news jobs
- queued projection refresh jobs
- age of the oldest queued item
- freshness of the latest storefront change event
- freshness of the latest news change event
- freshness of the latest projection refresh data

## Dependencies on the Change-Intel Runtime

The UI is only as useful as the runtime beneath it:

- `app-change-hints` must continue seeding new storefront capture work
- `change-intel-worker` must keep draining `storefront`, `news`, `projection_refresh`, and `hero_asset`
- `pics-service` must keep writing internal history and diff events
- the projection refresh path must keep the unified `/changes` feed current

## Related Documentation

- [Steam Activity User Guide](../../user-guide/change-feed.md)
- [Steam Change Intelligence](../workers/steam-change-intelligence.md)
- [Internal API](../../api/internal-api.md)
