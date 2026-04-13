# YouTube Data V1

Date: April 6, 2026  
Audience: Founder/operator and future implementers  
Scope: Historical design for the original YouTube ingestion, matching, and per-game trend data proposal

> Historical note: this document captures the original v1 proposal. The shipped YouTube collector and chat contract family now live in `packages/youtube`, `packages/data-plane`, and `apps/query-api`. Keep the sections below as the original design record.

## Executive Summary

PublisherIQ should add YouTube as a narrow, Steam-scoped signal layer with one clear v1 job:

- for tracked Steam games that are already important in PublisherIQ, collect enough matched YouTube history to measure whether video publishing and observed view growth are accelerating
- begin building the historical dataset now instead of waiting for a future product surface
- stay inside the default free YouTube Data API v3 quota unless the system proves valuable enough to justify a formal quota increase

This is not a general YouTube discovery product.

V1 should not try to:

- discover or track non-Steam games
- rank the whole market by YouTube growth
- answer cross-game questions like "which game is seeing the most YouTube growth?" as a primary v1 feature

The recommended v1 operating model is:

1. one `top 100` Steam hot cohort
2. temporary `escalation` for recent releases and high-signal Steam changes
3. deterministic game matching with a high-precision bias
4. separate discovery cadence from metric-refresh cadence
5. separate `standard_videos`, `shorts`, and `live_or_recent_live` content classes
6. manual suppressions and match controls from day one

At the time, this phase was documentation only. No package, schema, API route, or UI work was part of the deliverable; the shipped runtime now exists separately.

## Immediate Goal

The immediate goal is narrow and concrete:

- start collecting matched YouTube history now for tracked Steam games
- store enough daily and snapshot-level data to answer later whether more matched videos are being published for a game
- store enough daily and snapshot-level data to answer later whether the observed views on those matched videos are also accelerating

The design should optimize for trustworthy historical capture first. Website design, dashboards, and chat surfaces can come later.

## Goals

Primary goals:

1. Regularly capture matched YouTube video activity for the tracked Steam games that matter most right now.
2. Build stable per-game rollups for matched video publishing volume.
3. Build stable per-game rollups for observed view growth on matched videos.
4. Keep cost and operational complexity low enough to start on the default YouTube quota.

Non-goals for v1:

- no coverage of non-Steam games
- no YouTube-first game universe or identity layer
- no broad cross-game ranking by YouTube growth in v1
- no transcript ingestion
- no comment ingestion
- no audience demographic or watch-time analytics
- no paid third-party YouTube data
- no attempt at complete YouTube recall for each game
- no implementation in this phase

## Non-Negotiable Design Decisions

1. Steam / PublisherIQ remains the authoritative game universe. If a game is not in PublisherIQ's tracked Steam identity, v1 ignores it.
2. Reuse existing PublisherIQ Steam-side importance signals instead of creating a long-lived `youtube_priority_score`.
3. Treat `search.list` as the expensive discovery lane and use cheap ID-based APIs for follow-up work.
4. Separate discovery cadence from metric-refresh cadence. Discovery finds candidate videos; metric refresh measures view growth on already matched videos.
5. Keep the future implementation isolated in its own package, `@publisheriq/youtube`.
6. Write future YouTube data to Tiger only, not Supabase.
7. Use one production Google Cloud project and one quota pool for this workload.
8. Count each accepted video toward one `primary game` only.
9. Bias the system toward high precision over broad recall.
10. Do not mix `shorts` with `standard_videos` in the core growth metrics.
11. Operator controls for suppressions, alias fixes, and allow/block rules are part of v1 requirements, not a deferred v2 nice-to-have.

## Why One Production Quota Pool

Using two API keys only helps if they belong to different Google Cloud projects. Two keys on the same project do not increase quota.

Even if separate projects technically increase headroom, the recommended design should not depend on that because:

- it creates policy and compliance risk if the same product workload is split mainly to gain more quota
- it makes future quota-audit conversations harder
- it adds operational overhead without improving discovery efficiency
- it hides the real problem, which is expensive search usage rather than cheap hydration usage

The correct progression is:

1. optimize discovery efficiency
2. observe value and real quota pressure
3. request more quota through the official process if needed

## Existing Signals To Reuse

The repo already contains the right Steam-side urgency signals for YouTube routing:

- `priority_score`
- `refresh_tier`
- `release_date`
- launch-window logic
- `change_critical`
- recent `app_change_events`
- rank movement inside existing important-game surfaces

This is important because YouTube should explain momentum on already-important tracked games rather than becoming a second top-level ranking system.

## Prioritization Model

### Cohort

The baseline cohort should be the top `100` Steam games by existing importance logic, restricted to actual games and minus explicit suppressions.

There should be no broad off-cohort breakout sweep in v1.

### Scheduler States

The future scheduler should operate on four states:

- `escalated`
- `active_baseline`
- `evergreen_baseline`
- `suppressed`

### Escalation Rules

A game should enter `escalated` status for `30 days` when any of these are true:

- the game is in a recent release or launch window
- the game is marked `change_critical` or has a comparable major recent Steam change burst
- the game recently entered the high-importance slice
- the game climbed sharply inside the hot cohort in a short time window

This is not intended to find non-Steam breakouts. It is intended to spend more YouTube budget on tracked games that already have reason to matter.

### Evergreen Rules

Old, stable leaders such as CS2 or Dota 2 should stay tracked but be downgraded when they are:

- more than `2` years old
- consistently high-ranked for an extended period
- not in a launch window
- not firing recent major change signals
- not showing major recent rank movement

These games still matter, but recurring blind search is usually not the highest-value use of quota.

### Suppressions

The system should support manual suppressions from day one for titles that are technically hot on Steam but low-signal for the actual YouTube use case.

This exists specifically for cases like Wallpaper Engine-type anomalies.

## Discovery And Quota Design

### Why Search Must Be Sparse

Official YouTube Data API costs make discovery the hard part:

- `search.list`: `100` quota units per call
- `videos.list`: `1` quota unit per call
- `channels.list`: `1` quota unit per call
- `playlistItems.list`: `1` quota unit per call

That means the design should be:

- sparse search for discovery
- cheap ID-based hydration for known videos
- cheap channel monitoring for known relevant creators

### Discovery Cadence

Recommended baseline discovery cadence:

- `escalated`: up to `15` games every `12` hours
- `active_baseline` daily lane: up to `25` games every `24` hours
- `active_baseline` rotating lane: `45` games every `3` days
- `evergreen_baseline`: `15` games every `7` days

### Discovery Budget

Expected discovery volume under the default cadence:

- about `72` `search.list` calls per day
- about `7,200` discovery quota units per day
- up to about `3,600` raw search hits per day at the API maximum of `50` results per page

This leaves some headroom for video hydration, channel hydration, playlist polling, retries, and limited operator debugging, but not enough room for a broad market-wide sweep.

### Search Rules

Default discovery behavior:

- one search page per game by default
- use `type=video`
- use `order=date`
- use `publishedAfter` based on the game's discovery cursor
- use exact-phrase or alias-based query templates with negative keywords when needed

Allow a second page only when:

- the game is `escalated`
- page 1 relevance is already strong
- the extra page is likely to add fresh, distinct channels rather than more noise

### Discovery Cursor Rules

The future implementation should keep a cursor per `(appid, query_template_id)`.

Rules:

- a cursor advances only after the search call, candidate persistence, and first hydration pass complete successfully
- searches should use a small overlap window when resuming from the previous cursor, then dedupe by `video_id`
- retries must re-run the same cursor window instead of skipping forward

This keeps discovery correctness tied to a specific game/query lane rather than to a single app-wide timestamp.

### Metric Refresh Cadence

Discovery and growth measurement are separate concerns. The future implementation should refresh already matched videos on a fixed cadence:

- matched videos published in the last `7` days: every `6` hours
- matched videos published `8-30` days ago: every `24` hours
- matched videos published `31-90` days ago: every `72` hours
- matched videos older than `90` days: no recurring refresh unless the game is `escalated` or manually boosted

Live broadcasts can still be hydrated when discovered, but live-concurrency metrics are secondary in v1 and should not block the launch of the core per-game trend dataset.

## How Videos Should Be Grouped To Games

### Important Constraint

The YouTube Data API does not provide a reliable per-game identity field.

There is no canonical "this video is about Steam game X" property that can be trusted for grouping.

### Matching Strategy

The future implementation should use a deterministic evidence stack:

1. canonical game aliases from existing identity data such as `core.entity_aliases`
2. exact or phrase matches in the video title
3. supporting matches in the description
4. tag matches when video tags are available
5. query provenance, meaning which game-specific search template produced the video
6. channel priors from previously accepted matches
7. negative-keyword rules and suppressions for noisy titles

Constraints:

- channel priors may increase confidence, but they must never be sufficient on their own to auto-accept a match
- multi-game or roundup content should be stored separately instead of being forced into core KPIs
- any game not in PublisherIQ's Steam-tracked identity is out of scope for v1

### Attribution Rule

Each accepted video should count toward one `primary game` only.

Why:

- it keeps game-level metrics interpretable
- it avoids inflating totals from roundup or comparison videos
- it preserves a high-precision bias

### Match States

The future system should use these match states:

- `matched_primary`
- `matched_multi_game`
- `pending_review`
- `rejected`
- `suppressed`

Only `matched_primary` videos should feed the core per-game rollups.

`matched_multi_game` videos may be stored for future analysis, but they should not be blended into v1 core growth metrics.

## What Data V1 Should Capture

### Discovery Metadata

For each discovered video:

- video ID
- title
- description
- thumbnails
- published time
- channel ID
- channel title
- live or broadcast status
- query template or discovery source
- search request timestamp

### Hydrated Video Metadata

For matched or candidate videos:

- current view count
- like count
- comment count
- duration
- tags when available
- category metadata
- content class: `standard_video`, `short`, or `live_or_recent_live`
- live-stream metadata when present

### Channel Metadata

For channels that repeatedly produce accepted videos:

- channel metadata
- subscriber count when available through the API response
- video count
- view count
- uploads playlist pointer for cheap follow-up polling

Channel metadata is useful for routing and operator review, but channel-level metrics should not be treated as core game growth metrics in v1.

## Minimal Internal Contract

The future implementation should define these minimum internal relations:

- `ops.youtube_game_routing`
- one row per tracked game with routing state, suppression state, boosts, and discovery timing
- `docs.youtube_search_hits`
- raw search hits keyed by request and `video_id`
- `docs.youtube_videos`
- canonical per-video metadata keyed by `video_id`
- `docs.youtube_channels`
- canonical per-channel metadata keyed by `channel_id`
- `events.youtube_video_matches`
- match decisions keyed by `(appid, video_id)` with state, evidence summary, and decision timestamps
- `metrics.youtube_video_snapshots`
- repeated metric snapshots keyed by `(video_id, snapshot_time)`
- `metrics.youtube_game_daily`
- per-game, per-content-class daily rollups

YouTube videos and channels do not need to become first-class browse surfaces in v1, but they do need stable internal identity to support matching and snapshotting.

## Derived Game Metrics

The stored dataset should distinguish between coverage, publishing activity, and observed view growth.

### Core Growth Metrics

These are the metrics v1 should optimize for collecting and storing:

- `new_matched_videos_1d`
- count of `matched_primary` videos with `published_at` in the last `1` day
- `new_matched_videos_7d`
- count of `matched_primary` videos with `published_at` in the last `7` days
- `new_matched_videos_30d`
- count of `matched_primary` videos with `published_at` in the last `30` days
- `distinct_upload_channels_7d`
- distinct `channel_id` count for `matched_primary` videos published in the last `7` days
- `distinct_upload_channels_30d`
- distinct `channel_id` count for `matched_primary` videos published in the last `30` days
- `views_on_new_videos_7d`
- sum of the latest known `view_count` for `matched_primary` videos published in the last `7` days
- `views_on_new_videos_30d`
- sum of the latest known `view_count` for `matched_primary` videos published in the last `30` days
- `matched_video_view_delta_1d`
- sum of per-video `view_count` growth across `matched_primary` videos that have snapshots at both the start and end of the last `1` day window
- `matched_video_view_delta_7d`
- sum of per-video `view_count` growth across `matched_primary` videos that have snapshots at both the start and end of the last `7` day window

These metrics answer the core data question:

- are more matched videos being published for this game?
- are those matched videos also gaining views faster?

### Content-Class Rules

The future implementation should compute the above metrics separately for:

- `standard_video`
- `short`
- `live_or_recent_live`

Rules:

- `standard_video` should be the default core rollup for early analysis
- `short` metrics should be shown separately because Shorts view counts are not comparable to standard long-form views
- `live_or_recent_live` should be treated as a secondary slice, not part of the default core trend

### Secondary Metrics

These may be useful later, but should not be treated as the primary v1 growth metrics:

- `like_delta_7d`
- `comment_delta_7d`
- `active_live_streams_now`
- `concurrent_viewers_now`

These are secondary because they are more sensitive to sparse refresh, hidden counters, and live-session timing.

### Internal Coverage Metrics

The future implementation should also track internal-only coverage diagnostics:

- search calls per game per day
- accepted match rate by game
- pending review rate by game
- refresh freshness for matched videos
- latest methodology version applied to the rollup

These should support operator trust and debugging.

## Admin Controls

Manual controls are required in v1 because matching and suppressions are not stable enough to defer all operator intervention.

Minimum controls:

- `blacklist game`
- `priority boost`
- `query override` or alias override
- `channel allow`
- `channel suppress`

The corresponding future override store should be YouTube-specific, for example:

- `ops.youtube_game_overrides`
- `ops.youtube_channel_overrides`

Minimum override fields:

- game or channel identifier
- override type
- reason
- optional expiration
- created by
- created at

Override precedence:

1. manual blacklist overrides everything
2. manual channel suppression blocks automatic acceptance from that channel
3. manual priority boost overrides automatic cadence
4. automatic routing applies only when no active manual override exists

## Validation Requirements For The Future Build

The eventual implementation should prove these scenarios:

1. old evergreen leaders remain tracked but fall to low-cadence discovery unless Steam-side triggers fire
2. recent releases and major-change games get temporary aggressive discovery
3. suppressed titles do not consume recurring discovery budget
4. only strong `matched_primary` videos feed the core per-game rollups
5. `matched_multi_game` videos are stored but do not inflate core per-game rollups
6. the scheduler stays below the daily quota ceiling over a simulated `30`-day run
7. the same game's trend line remains directionally stable when the game changes scheduler state
8. `short` and `standard_video` metrics remain separated end to end
9. a labeled benchmark set exists for ambiguous names, sequels, acronyms, and localized titles

## Open Risks And Caveats

1. Search recall will always be imperfect because YouTube does not expose a canonical per-game classification system.
2. Ambiguous game names will require ongoing negative-keyword, alias, and suppression tuning.
3. This system measures observed matched YouTube activity for tracked Steam games, not complete YouTube coverage.
4. Shorts-heavy titles can distort naive cross-format comparisons because Shorts view counts behave differently from standard long-form views.
5. Very successful v1 usage may still outgrow the free quota even with an efficient design.
6. Cross-game ranking by YouTube growth is deferred because coverage effort and matching quality are not stable enough in v1 to support strong market-wide comparisons.

## Final Recommendation

Start with a narrow, disciplined design:

- top `100` Steam-driven cohort
- per-game trend data only
- Steam / PublisherIQ as the only game universe
- sparse search plus cheap refresh on already matched videos
- manual suppressions and matching controls from day one
- separate `standard_video`, `short`, and `live_or_recent_live` slices
- one production quota pool

That gives PublisherIQ the best chance of shipping a useful YouTube explanation layer for hot tracked games without turning v1 into either:

- an expensive quota-burning discovery machine
- or a weak global ranking system that overclaims what the data can actually prove

## Sources

- YouTube Data API overview: https://developers.google.com/youtube/v3/getting-started
- YouTube quota costs: https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube quota and compliance audits: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- YouTube search.list: https://developers.google.com/youtube/v3/docs/search/list
- YouTube videos resource: https://developers.google.com/youtube/v3/docs/videos
- YouTube videoCategories.list: https://developers.google.com/youtube/v3/docs/videoCategories/list
- Existing Steam priority logic: [packages/ingestion/src/workers/priority-worker.ts](../../packages/ingestion/src/workers/priority-worker.ts)
- Existing launch-window and override logic: [packages/ingestion/src/workers-support/reviews-sync.ts](../../packages/ingestion/src/workers-support/reviews-sync.ts)
- Existing Steam change-hint promotion logic: [packages/ingestion/src/workers/app-change-hints-worker.ts](../../packages/ingestion/src/workers/app-change-hints-worker.ts)
- Existing core alias model: [packages/data-plane/sql/tiger-bootstrap/0010_core_identity.sql](../../packages/data-plane/sql/tiger-bootstrap/0010_core_identity.sql)
