# PublisherIQ Database Schema

> This document is optimized for LLM text-to-SQL generation. Use exact column names, types, and SQL patterns shown below.

**Databases / Storage**: Supabase Postgres + TigerData (Timescale) + R2

**Last Updated:** May 1, 2026

**Semantic Layer**: Cube.js still provides compatibility analytics queries over Supabase-backed models. TigerData now serves the contract-backed chat/query plane, including YouTube coverage, through `apps/query-api`.

---

## Current Database Topology

PublisherIQ now operates with these database/storage roles:

| Plane | System | Current Role |
|------|--------|--------------|
| Product data plane | TigerData (Timescale) + R2 | accepted/tested incoming ingestion and product-data writer paths, archived payloads, and contract-backed reads |
| Control / legacy plane | Supabase Postgres | auth, sessions, user/control data, reference data, retained/default ingestion paths, legacy warehouse surfaces, product RPCs and page reads not proven Tiger-backed |
| Contract read plane | TigerData (Timescale) | contract-backed chat/search/discovery reads served through `query-api` |

This is not a full migration off Supabase. Tiger/R2 is primary only for accepted and tested product-data paths; Supabase remains authoritative for retained control, reference, legacy, and product surfaces that are not proven Tiger-backed.

## TigerData Schema Overview

TigerData does not mirror the entire Supabase schema. It currently holds the slices needed for contract-backed reads.

### Main TigerData schema groups

| Schema | Purpose |
|--------|---------|
| `core` | entity identity and overview relations |
| `metrics` | time-series history such as `metrics.daily_metrics` |
| `events` | change-event history |
| `docs` | news items and search projections |
| `ops` | operational metadata used by the data plane |
| `chat` | chat-oriented helper relations |
| `legacy` | compatibility landing zone for slices still shaped like legacy warehouse reads |

### Contract-serving relation families

TigerData-backed contracts currently depend on relations in these categories:

- apps and latest metrics
- publishers, developers, and entity-link context
- daily metric history
- news and document search projections
- change events and change-pattern slices
- user pins, alerts, and alert settings for `getUserContext`
- YouTube coverage, channel, and rollup relations for `getYoutubeGameCoverage`

For the exact live contract list and ownership, see:

- [TigerData Operating Model](./tigerdata-operating-model.md)
- [Chat Data System](./chat-data-system.md)
- [Query API README](../../../apps/query-api/README.md)

## How To Read This Document

The remainder of this document focuses on the Supabase schema detail, because:

- generated database types in `@publisheriq/database` come from the Supabase schema
- Supabase still serves most product-page reads
- retained/default paths and legacy surfaces still depend on this schema

TigerData schema detail currently lives primarily in:

- `packages/data-plane/sql/tiger-bootstrap/`
- `packages/data-plane/src/contract-registry.ts`
- `docs/developer-guide/architecture/tigerdata-operating-model.md`

## Current Serving Split

| Surface | Primary Read Store |
|--------|--------------------|
| `/apps` | Supabase |
| `/companies` | Supabase |
| `/changes` | Supabase |
| `/admin` | Supabase |
| contract-backed chat/search/discovery | TigerData |
| contract-backed YouTube coverage | TigerData |
| Cube compatibility analytics | Supabase-backed Cube models |

PICS note: Tiger schema and service code support PICS latest-state writes, but the runtime default is Supabase unless `PICS_LATEST_STATE_TARGET=tiger` and a Tiger URL are configured in Railway. PICS change-history Tiger/R2 writes also require object-storage archive configuration. Do not use this schema document to claim app runtime writes are Tiger-backed unless the specific path has been tested.

### TigerData YouTube Relations

TigerData now also stores the contract-serving YouTube coverage slice used by `getYoutubeGameCoverage`.

| Relation | Purpose |
|---------|---------|
| `ops.youtube_game_routing` | Per-game routing state, discovery cursors, and cohort priority |
| `ops.youtube_search_runs` | Search and playlist run history |
| `ops.youtube_channel_monitors` | Uploads-playlist polling state for monitored creator channels |
| `ops.youtube_game_overrides` | Manual per-game routing overrides |
| `ops.youtube_channel_overrides` | Manual per-channel match and monitoring overrides |
| `docs.youtube_videos` | Latest YouTube video metadata and hydration state |
| `docs.youtube_channels` | Latest YouTube channel metadata and hydration state |
| `docs.youtube_video_matches` | Current Steam app to YouTube video match state |
| `metrics.youtube_video_snapshots` | Time-series video snapshots for view deltas and growth |
| `metrics.youtube_game_daily` | Derived per-game daily rollups by content class |

---

## Enum Types

```sql
-- App content type
CREATE TYPE app_type AS ENUM ('game', 'dlc', 'demo', 'mod', 'video', 'hardware', 'music', 'episode', 'tool', 'application', 'series', 'advertising');

-- Data sync source
CREATE TYPE sync_source AS ENUM ('steamspy', 'storefront', 'reviews', 'histogram', 'scraper', 'pics', 'news', 'hero_asset', 'change_hints');

-- Change-intelligence capture source
CREATE TYPE app_capture_source AS ENUM ('storefront', 'news', 'hero_asset', 'projection_refresh');

-- Review sentiment trend
CREATE TYPE trend_direction AS ENUM ('up', 'down', 'stable');

-- Sync frequency tier
CREATE TYPE refresh_tier AS ENUM ('active', 'moderate', 'dormant', 'dead');

-- Steam Deck compatibility category
CREATE TYPE steam_deck_category AS ENUM ('unknown', 'unsupported', 'playable', 'verified');

-- User role (v2.1+)
CREATE TYPE user_role AS ENUM ('user', 'admin');

-- Waitlist application status (v2.1+)
CREATE TYPE waitlist_status AS ENUM ('pending', 'approved', 'rejected');

-- Credit transaction types (v2.1+)
CREATE TYPE credit_transaction_type AS ENUM (
    'signup_bonus',     -- Initial credits on account creation
    'admin_grant',      -- Admin manually adds credits
    'admin_deduct',     -- Admin manually removes credits
    'chat_usage',       -- Consumed by chat (finalized reservation)
    'refund'            -- Refund for failed operations
);

-- Credit reservation status (v2.1+)
CREATE TYPE credit_reservation_status AS ENUM ('pending', 'finalized', 'refunded');
```

---

## Tables

### publishers

Steam game publishers.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | auto | Primary key |
| name | TEXT | NO | - | Publisher name (unique) |
| normalized_name | TEXT | NO | - | Lowercase, trimmed name for lookups |
| steam_vanity_url | TEXT | YES | NULL | Steam store vanity URL slug |
| first_game_release_date | DATE | YES | NULL | Earliest game release date |
| game_count | INTEGER | NO | 0 | Number of games published |
| last_embedding_sync | TIMESTAMPTZ | YES | NULL | Last embedding sync to the Tiger semantic retrieval pipeline |
| embedding_hash | TEXT | YES | NULL | Hash of embedding text for change detection |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Indexes**:
- `idx_publishers_normalized` on `normalized_name`
- `idx_publishers_embedding_needed` on `(game_count DESC, last_embedding_sync)` WHERE `game_count > 0`

---

### developers

Steam game developers.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | auto | Primary key |
| name | TEXT | NO | - | Developer name (unique) |
| normalized_name | TEXT | NO | - | Lowercase, trimmed name for lookups |
| steam_vanity_url | TEXT | YES | NULL | Steam store vanity URL slug |
| first_game_release_date | DATE | YES | NULL | Earliest game release date |
| game_count | INTEGER | NO | 0 | Number of games developed |
| last_embedding_sync | TIMESTAMPTZ | YES | NULL | Last embedding sync to the Tiger semantic retrieval pipeline |
| embedding_hash | TEXT | YES | NULL | Hash of embedding text for change detection |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Indexes**:
- `idx_developers_normalized` on `normalized_name`
- `idx_developers_embedding_needed` on `(game_count DESC, last_embedding_sync)` WHERE `game_count > 0`

---

### apps

Steam apps (games, DLC, demos, etc).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | Primary key (Steam app ID) |
| name | TEXT | NO | - | App display name |
| type | app_type | NO | 'game' | Content type |
| is_free | BOOLEAN | NO | FALSE | Whether app is free |
| release_date | DATE | YES | NULL | Parsed release date |
| release_date_raw | TEXT | YES | NULL | Raw release date string from Steam |
| store_asset_mtime | TIMESTAMPTZ | YES | NULL | Steam store page creation timestamp (from PICS) |
| has_workshop | BOOLEAN | NO | FALSE | Has Steam Workshop support |
| current_price_cents | INTEGER | YES | NULL | Current price in cents (USD) |
| current_discount_percent | INTEGER | NO | 0 | Active discount percentage |
| is_released | BOOLEAN | NO | TRUE | Whether app is released |
| is_delisted | BOOLEAN | NO | FALSE | Whether app is removed from store |
| has_developer_info | BOOLEAN | NO | FALSE | Developer/publisher data fetched |
| controller_support | TEXT | YES | NULL | Controller support: "full", "partial", or NULL |
| pics_review_score | SMALLINT | YES | NULL | Steam review score (1-9) from PICS |
| pics_review_percentage | SMALLINT | YES | NULL | Positive review percentage (0-100) from PICS |
| metacritic_score | SMALLINT | YES | NULL | Metacritic score |
| platforms | TEXT | YES | NULL | Supported platforms: "windows,macos,linux" |
| release_state | TEXT | YES | NULL | PICS release state: released, prerelease, etc. |
| parent_appid | INTEGER | YES | NULL | Parent app ID for DLC, demos, mods |
| homepage_url | TEXT | YES | NULL | Publisher/developer homepage |
| languages | JSONB | YES | NULL | Supported languages |
| content_descriptors | JSONB | YES | NULL | Mature content descriptors |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Indexes**:
- `idx_apps_name` on `name`
- `idx_apps_type` on `type` WHERE `type = 'game'`
- `idx_apps_released` on `(is_released, is_delisted)`
- `idx_apps_parent_appid` on `parent_appid` WHERE `parent_appid IS NOT NULL`
- `idx_apps_platforms` on `platforms` WHERE `platforms IS NOT NULL`

**Pricing semantics**:
- `current_price_cents` is the storefront-first effective price signal; `NULL` means unavailable, not free.
- `current_discount_percent` only reflects an active discount. Sale badges and discount UI should only render when the app is not free and the storefront has a real discounted price.
- Downstream consumers should prefer the storefront price over derived or inferred price state when both are available.

---

### app_developers

Junction table linking apps to developers (many-to-many).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| appid | INTEGER | NO | FK to apps.appid |
| developer_id | INTEGER | NO | FK to developers.id |

**Primary Key**: `(appid, developer_id)`

---

### app_publishers

Junction table linking apps to publishers (many-to-many).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| appid | INTEGER | NO | FK to apps.appid |
| publisher_id | INTEGER | NO | FK to publishers.id |

**Primary Key**: `(appid, publisher_id)`

---

### app_tags

User-voted tags from SteamSpy.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | FK to apps.appid |
| tag | TEXT | NO | - | Tag name (e.g., "RPG", "Multiplayer") |
| vote_count | INTEGER | NO | 0 | Number of user votes for this tag |

**Primary Key**: `(appid, tag)`
**Indexes**: `idx_app_tags_tag` on `tag`

---

### steam_tags

Official Steam tag definitions from PICS (different from user-voted SteamSpy tags).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| tag_id | INTEGER | NO | - | Primary key (Steam tag ID) |
| name | TEXT | NO | - | Tag name |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Indexes**: `idx_steam_tags_name` on `name`

---

### steam_genres

Official Steam genre definitions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| genre_id | INTEGER | NO | - | Primary key (Steam genre ID) |
| name | TEXT | NO | - | Genre name (e.g., "Action", "RPG") |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |

---

### steam_categories

Steam feature categories (achievements, multiplayer, etc.).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| category_id | INTEGER | NO | - | Primary key (Steam category ID) |
| name | TEXT | NO | - | Category name (e.g., "Steam Achievements") |
| description | TEXT | YES | NULL | Category description |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |

---

### franchises

Game franchises/series from PICS.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | auto | Primary key |
| name | TEXT | NO | - | Franchise name (unique) |
| normalized_name | TEXT | NO | - | Lowercase, trimmed name for lookups |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Indexes**: `idx_franchises_normalized` on `normalized_name`

---

### app_steam_tags

Junction table linking apps to Steam tags (from PICS).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| appid | INTEGER | NO | FK to apps.appid |
| tag_id | INTEGER | NO | FK to steam_tags.tag_id |
| rank | INTEGER | YES | Tag rank/priority (lower = more relevant) |
| created_at | TIMESTAMPTZ | NO | When relationship was created |

**Primary Key**: `(appid, tag_id)`
**Indexes**:
- `idx_app_steam_tags_tag_id` on `tag_id`
- `idx_app_steam_tags_created_at` on `created_at`

---

### app_genres

Junction table linking apps to genres.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| appid | INTEGER | NO | FK to apps.appid |
| genre_id | INTEGER | NO | FK to steam_genres.genre_id |
| is_primary | BOOLEAN | NO | Whether this is the primary genre |
| created_at | TIMESTAMPTZ | NO | When relationship was created |

**Primary Key**: `(appid, genre_id)`
**Indexes**:
- `idx_app_genres_genre_id` on `genre_id`
- `idx_app_genres_primary` on `appid` WHERE `is_primary = TRUE`
- `idx_app_genres_created_at` on `created_at`

---

### app_categories

Junction table linking apps to feature categories.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| appid | INTEGER | NO | FK to apps.appid |
| category_id | INTEGER | NO | FK to steam_categories.category_id |
| created_at | TIMESTAMPTZ | NO | When relationship was created |

**Primary Key**: `(appid, category_id)`
**Indexes**:
- `idx_app_categories_category_id` on `category_id`
- `idx_app_categories_created_at` on `created_at`

---

### app_franchises

Junction table linking apps to franchises.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| appid | INTEGER | NO | FK to apps.appid |
| franchise_id | INTEGER | NO | FK to franchises.id |
| created_at | TIMESTAMPTZ | NO | When relationship was created |

**Primary Key**: `(appid, franchise_id)`
**Indexes**:
- `idx_app_franchises_franchise` on `franchise_id`
- `idx_app_franchises_created_at` on `created_at`

---

### app_steam_deck

Steam Deck compatibility data.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | Primary key, FK to apps.appid |
| category | steam_deck_category | NO | 'unknown' | Compatibility category |
| test_timestamp | TIMESTAMPTZ | YES | NULL | When compatibility was tested |
| tested_build_id | TEXT | YES | NULL | Build ID that was tested |
| tests | JSONB | YES | NULL | Detailed test results |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Indexes**: `idx_app_steam_deck_category` on `category`

---

### daily_metrics

Daily snapshots of app metrics.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | auto | Primary key |
| appid | INTEGER | NO | - | FK to apps.appid |
| metric_date | DATE | NO | - | Date of snapshot |
| owners_min | INTEGER | YES | NULL | Estimated owner count (lower bound) |
| owners_max | INTEGER | YES | NULL | Estimated owner count (upper bound) |
| ccu_peak | INTEGER | YES | NULL | Peak concurrent users |
| average_playtime_forever | INTEGER | YES | NULL | Avg playtime in minutes (all-time) |
| average_playtime_2weeks | INTEGER | YES | NULL | Avg playtime in minutes (last 2 weeks) |
| total_reviews | INTEGER | YES | NULL | Total review count |
| positive_reviews | INTEGER | YES | NULL | Positive review count |
| negative_reviews | INTEGER | YES | NULL | Negative review count |
| review_score | SMALLINT | YES | NULL | Steam review score (1-9) |
| review_score_desc | TEXT | YES | NULL | Review score description |
| recent_total_reviews | INTEGER | YES | NULL | Recent review count |
| recent_positive | INTEGER | YES | NULL | Recent positive reviews |
| recent_negative | INTEGER | YES | NULL | Recent negative reviews |
| recent_score_desc | TEXT | YES | NULL | Recent review score description |
| price_cents | INTEGER | YES | NULL | Price in cents at snapshot time |
| discount_percent | SMALLINT | NO | 0 | Discount at snapshot time |
| ccu_source | TEXT | YES | NULL | CCU data source: 'steam_api' (exact) or 'steamspy' (estimate) (v2.2+) |

**Unique**: `(appid, metric_date)`
**Indexes**:
- `idx_daily_metrics_appid_date` on `(appid, metric_date DESC)`
- `idx_daily_metrics_date` on `metric_date`
- `idx_daily_metrics_ccu_source` on `ccu_source` WHERE `ccu_source IS NOT NULL`

---

### review_histogram

Monthly review aggregates from Steam.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | auto | Primary key |
| appid | INTEGER | NO | - | FK to apps.appid |
| month_start | DATE | NO | - | First day of the month |
| recommendations_up | INTEGER | NO | - | Positive reviews in month |
| recommendations_down | INTEGER | NO | - | Negative reviews in month |
| fetched_at | TIMESTAMPTZ | NO | NOW() | When data was fetched |

**Unique**: `(appid, month_start)`
**Indexes**: `idx_review_histogram_appid_month` on `(appid, month_start DESC)`

---

### app_trends

Computed trend data from review histograms.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | Primary key, FK to apps.appid |
| trend_30d_direction | trend_direction | YES | NULL | 30-day trend: 'up', 'down', or 'stable' |
| trend_30d_change_pct | DECIMAL(6,2) | YES | NULL | 30-day positive ratio change % |
| trend_90d_direction | trend_direction | YES | NULL | 90-day trend: 'up', 'down', or 'stable' |
| trend_90d_change_pct | DECIMAL(6,2) | YES | NULL | 90-day positive ratio change % |
| current_positive_ratio | DECIMAL(5,4) | YES | NULL | Current positive/total ratio (0-1) |
| previous_positive_ratio | DECIMAL(5,4) | YES | NULL | Previous period positive ratio |
| review_velocity_7d | DECIMAL(10,2) | YES | NULL | Reviews per day (7-day avg) |
| review_velocity_30d | DECIMAL(10,2) | YES | NULL | Reviews per day (30-day avg) |
| ccu_trend_7d_pct | DECIMAL(6,2) | YES | NULL | CCU change % over 7 days |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last calculation time |

**Indexes**: `idx_app_trends_30d` on `(trend_30d_direction, trend_30d_change_pct DESC)` WHERE `trend_30d_direction = 'up'`

---

### sync_status

Per-app sync tracking and scheduling.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | Primary key, FK to apps.appid |
| last_steamspy_sync | TIMESTAMPTZ | YES | NULL | Last SteamSpy sync time |
| last_storefront_sync | TIMESTAMPTZ | YES | NULL | Last Storefront sync time |
| last_reviews_sync | TIMESTAMPTZ | YES | NULL | Last Reviews sync time |
| last_histogram_sync | TIMESTAMPTZ | YES | NULL | Last Histogram sync time |
| last_pics_sync | TIMESTAMPTZ | YES | NULL | Last PICS data sync time |
| pics_change_number | BIGINT | YES | NULL | Last processed PICS change number |
| last_embedding_sync | TIMESTAMPTZ | YES | NULL | Last embedding sync to the Tiger semantic retrieval pipeline |
| embedding_hash | TEXT | YES | NULL | Hash of embedding text for change detection |
| priority_score | INTEGER | NO | 0 | Sync priority (higher = more frequent) |
| priority_calculated_at | TIMESTAMPTZ | YES | NULL | When priority was calculated |
| next_sync_after | TIMESTAMPTZ | NO | NOW() | When app is due for sync |
| sync_interval_hours | INTEGER | NO | 24 | Hours between syncs |
| consecutive_errors | INTEGER | NO | 0 | Error count for circuit breaker |
| last_error_source | sync_source | YES | NULL | Which source had last error |
| last_error_message | TEXT | YES | NULL | Last error details |
| last_error_at | TIMESTAMPTZ | YES | NULL | When last error occurred |
| is_syncable | BOOLEAN | NO | TRUE | Whether to sync this app |
| refresh_tier | refresh_tier | YES | 'moderate' | Sync frequency tier |
| last_activity_at | TIMESTAMPTZ | YES | NULL | Last detected activity |
| next_reviews_sync | TIMESTAMPTZ | YES | NULL | When app is due for review sync (v2.1+) |
| reviews_interval_hours | INTEGER | NO | 24 | Hours between review syncs (v2.1+) |
| review_velocity_tier | TEXT | YES | NULL | Velocity tier: 'high', 'medium', 'low', 'dormant' (v2.1+) |
| velocity_7d | DECIMAL | YES | NULL | 7-day average reviews/day (v2.1+) |
| velocity_calculated_at | TIMESTAMPTZ | YES | NULL | When velocity was last calculated (v2.1+) |
| last_steamspy_individual_fetch | TIMESTAMPTZ | YES | NULL | Last SteamSpy individual fetch attempt (v2.2+) |
| steamspy_available | BOOLEAN | YES | NULL | Whether SteamSpy has data for this app |

**Indexes**:
- `idx_sync_status_embedding_needed` on `(priority_score DESC, last_embedding_sync)` WHERE `is_syncable = TRUE`
- `idx_sync_status_pics` on `last_pics_sync` WHERE `is_syncable = TRUE`

---

### sync_jobs

Job execution history.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| job_type | TEXT | NO | - | Job name (e.g., 'steamspy', 'reviews') |
| started_at | TIMESTAMPTZ | NO | NOW() | Job start time |
| completed_at | TIMESTAMPTZ | YES | NULL | Job completion time |
| status | TEXT | NO | 'running' | 'running', 'completed', 'failed' |
| items_processed | INTEGER | NO | 0 | Total items attempted |
| items_succeeded | INTEGER | NO | 0 | Successfully processed |
| items_failed | INTEGER | NO | 0 | Failed items |
| items_created | INTEGER | NO | 0 | New records created |
| items_updated | INTEGER | NO | 0 | Existing records updated |
| batch_size | INTEGER | YES | NULL | Batch size used |
| error_message | TEXT | YES | NULL | Error details if failed |
| github_run_id | TEXT | YES | NULL | GitHub Actions run ID |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |

---

### app_capture_work_state

Coalesced dirty-state work tracking for storefront, news, projection refresh, and hero asset capture.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | auto | Primary key |
| appid | INTEGER | NO | - | FK to apps.appid |
| source | app_capture_source | NO | - | Capture source |
| priority | INTEGER | NO | 100 | Work priority |
| latest_trigger_reason | TEXT | NO | - | Latest reason the row was dirtied |
| latest_trigger_cursor | TEXT | NO | '' | Latest trigger cursor |
| payload | JSONB | NO | '{}' | Merged work payload |
| dirty_since | TIMESTAMPTZ | YES | NULL | First dirty timestamp for current work |
| last_dirty_at | TIMESTAMPTZ | YES | NULL | Most recent dirty timestamp |
| claimed_at | TIMESTAMPTZ | YES | NULL | Current claim time |
| worker_id | TEXT | YES | NULL | Worker that claimed the row |
| attempts | INTEGER | NO | 0 | Attempt count |
| next_available_at | TIMESTAMPTZ | NO | NOW() | When the row can be claimed again |
| last_completed_at | TIMESTAMPTZ | YES | NULL | Last successful completion |
| last_error | TEXT | YES | NULL | Last failure detail |
| dead_lettered_at | TIMESTAMPTZ | YES | NULL | Dead-letter timestamp |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Unique**: `(appid, source)`

### change_activity_bursts

Grouped per-app change bursts used by the `/changes` feed and change-intel chat tools.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| burst_id | TEXT | NO | - | Primary key |
| appid | INTEGER | NO | - | FK to apps.appid |
| app_name | TEXT | NO | - | App name at projection time |
| app_type | app_type | YES | NULL | App type |
| is_released | BOOLEAN | YES | NULL | Release flag |
| release_date | DATE | YES | NULL | Release date |
| effective_at | TIMESTAMPTZ | NO | - | Burst effective timestamp |
| burst_started_at | TIMESTAMPTZ | NO | - | Burst start |
| burst_ended_at | TIMESTAMPTZ | NO | - | Burst end |
| event_count | INTEGER | NO | - | Number of source events |
| change_type_count | INTEGER | NO | - | Distinct change type count |
| source_set | TEXT[] | NO | ARRAY[]::TEXT[] | Source set |
| change_types | TEXT[] | NO | ARRAY[]::TEXT[] | Change types in the burst |
| headline_change_types | TEXT[] | NO | ARRAY[]::TEXT[] | Headline change types |
| highlight_labels | TEXT[] | NO | ARRAY[]::TEXT[] | Human-readable highlights |
| signal_families | TEXT[] | NO | ARRAY[]::TEXT[] | Signal family labels |
| story_kind | TEXT | NO | - | Burst story kind |
| has_related_news | BOOLEAN | NO | FALSE | Whether related news exists |
| related_news_count | INTEGER | NO | 0 | Related news row count |
| include_in_high_signal | BOOLEAN | NO | FALSE | Whether the burst qualifies for high-signal views |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

### change_pattern_activity_days

Daily rollup of grouped change activity used for pattern searches.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | FK to apps.appid |
| activity_date | DATE | NO | - | Activity date |
| app_name | TEXT | NO | - | App name at projection time |
| app_type | app_type | YES | NULL | App type |
| is_released | BOOLEAN | YES | NULL | Release flag |
| release_date | DATE | YES | NULL | Release date |
| latest_occurred_at | TIMESTAMPTZ | NO | - | Latest event timestamp |
| burst_ids | TEXT[] | NO | ARRAY[]::TEXT[] | Burst ids included in the rollup |
| signal_families | TEXT[] | NO | ARRAY[]::TEXT[] | Signal families |
| story_kinds | TEXT[] | NO | ARRAY[]::TEXT[] | Story kinds |
| announcement_count | INTEGER | NO | 0 | Announcement count |
| total_bursts | INTEGER | NO | 0 | Burst count |
| release_count | INTEGER | NO | 0 | Release count |
| pricing_count | INTEGER | NO | 0 | Pricing count |
| store_page_count | INTEGER | NO | 0 | Store-page count |
| media_count | INTEGER | NO | 0 | Media count |
| taxonomy_count | INTEGER | NO | 0 | Taxonomy count |
| platform_count | INTEGER | NO | 0 | Platform count |
| build_count | INTEGER | NO | 0 | Build count |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

### change_pattern_app_windows

Windowed shortlist projection for broad change-pattern candidate search.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | FK to apps.appid |
| window_days | INTEGER | NO | - | Window length |
| app_name | TEXT | NO | - | App name at projection time |
| app_type | app_type | YES | NULL | App type |
| is_released | BOOLEAN | YES | NULL | Release flag |
| release_date | DATE | YES | NULL | Release date |
| latest_occurred_at | TIMESTAMPTZ | NO | - | Latest event timestamp |
| activity_ids | TEXT[] | NO | ARRAY[]::TEXT[] | Activity ids included in the window |
| signal_families | TEXT[] | NO | ARRAY[]::TEXT[] | Signal families |
| story_kinds | TEXT[] | NO | ARRAY[]::TEXT[] | Story kinds |
| announcement_count | INTEGER | NO | 0 | Announcement count |
| change_count | INTEGER | NO | 0 | Change count |
| release_count | INTEGER | NO | 0 | Release count |
| pricing_count | INTEGER | NO | 0 | Pricing count |
| store_page_count | INTEGER | NO | 0 | Store-page count |
| media_count | INTEGER | NO | 0 | Media count |
| taxonomy_count | INTEGER | NO | 0 | Taxonomy count |
| platform_count | INTEGER | NO | 0 | Platform count |
| build_count | INTEGER | NO | 0 | Build count |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

### steam_news_search_projection

Lean recent-news search projection used by chat topic search.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| gid | TEXT | NO | - | Primary key |
| appid | INTEGER | NO | - | FK to apps.appid |
| published_at | TIMESTAMPTZ | YES | NULL | Original publish time |
| first_seen_at | TIMESTAMPTZ | NO | - | First time the gid was observed |
| sort_time | TIMESTAMPTZ | NO | - | Sort timestamp used for ranking |
| feed_scope | TEXT | NO | - | Feed scope label |
| title | TEXT | YES | NULL | News title |
| search_document | TSVECTOR | NO | - | Search vector for topic search |

**Indexes**:
- `idx_steam_news_search_projection_search_document` on `search_document`
- `idx_steam_news_search_projection_feed_scope_sort_time_gid` on `(feed_scope, sort_time DESC, gid DESC)`
- `idx_steam_news_search_projection_appid_sort_time` on `(appid, sort_time DESC)`

---

### chat_query_logs

Chat query analytics and debugging logs. **7-day retention** with automatic cleanup.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| query_text | TEXT | NO | - | User's chat query |
| tool_names | TEXT[] | NO | '{}' | Array of tools used |
| tool_count | INTEGER | NO | 0 | Number of tools called |
| iteration_count | INTEGER | NO | 1 | LLM iteration count |
| response_length | INTEGER | NO | 0 | Response character count |
| timing_llm_ms | INTEGER | YES | NULL | LLM processing time (ms) |
| timing_tools_ms | INTEGER | YES | NULL | Tool execution time (ms) |
| timing_total_ms | INTEGER | YES | NULL | Total request time (ms) |
| input_tokens | INTEGER | YES | NULL | Provider input tokens |
| output_tokens | INTEGER | YES | NULL | Provider output tokens |
| tool_credits_used | INTEGER | YES | NULL | Credits used for tool calls |
| total_credits_charged | INTEGER | YES | NULL | Total credits charged |
| chat_family | TEXT | YES | NULL | Answer family |
| quality_flags | TEXT[] | YES | NULL | Quality flags emitted during the turn |
| session_context_summary | JSONB | YES | NULL | Condensed session context payload |
| guardrail_trace | JSONB | YES | NULL | Guardrail trace |
| answer_contract_summary | JSONB | YES | NULL | Deterministic answer contract summary |
| created_at | TIMESTAMPTZ | NO | NOW() | Query timestamp |

**Indexes**:
- `idx_chat_query_logs_created_at` on `created_at DESC`
- `idx_chat_query_logs_tool_names` GIN index on `tool_names`

**Cleanup Function**:
```sql
cleanup_old_chat_logs() -- Deletes logs older than 7 days
```

**Used by**: Admin chat logs dashboard at `/admin/chat-logs`

---

### Operational RPCs

These read-only RPCs back the admin dashboard, `/changes`, and chat change-intel tools:

- `get_source_completion_stats()`
- `get_catalog_control_stats()`
- `get_ccu_quality_stats()`
- `get_change_feed_activity()`
- `get_change_feed_bursts()`
- `get_change_feed_burst_detail()`
- `get_change_feed_news()`
- `get_chat_recent_news(appids, days, limit)`
- `get_chat_change_activity_candidates(...)`
- `get_chat_change_pattern_candidates(...)`
- `search_recent_news_topics(query, days, recent_days, feed_scope, app_types, appids, exclude_gids)`

They are paired with the projection tables above:

- `change_activity_bursts`
- `change_pattern_activity_days`
- `change_pattern_app_windows`
- `steam_news_search_projection`
- `app_capture_work_state`

---

### review_deltas (v2.1+)

Daily review change tracking for trend visualization and velocity-based sync scheduling.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | auto | Primary key |
| appid | INTEGER | NO | - | FK to apps.appid |
| delta_date | DATE | NO | - | Date of snapshot |
| total_reviews | INTEGER | NO | - | Absolute review count at sync |
| positive_reviews | INTEGER | NO | - | Absolute positive count at sync |
| review_score | SMALLINT | YES | NULL | Review score (1-9) |
| review_score_desc | TEXT | YES | NULL | Score description |
| reviews_added | INTEGER | NO | 0 | Delta from previous sync |
| positive_added | INTEGER | NO | 0 | Positive delta |
| negative_added | INTEGER | NO | 0 | Negative delta |
| hours_since_last_sync | DECIMAL(6,2) | YES | NULL | Hours since previous sync |
| daily_velocity | DECIMAL(8,4) | GENERATED | - | Reviews per day (normalized to 24h) |
| is_interpolated | BOOLEAN | NO | FALSE | TRUE if estimated, FALSE if from API |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |

**Unique**: `(appid, delta_date)`

**Indexes**:
- `idx_review_deltas_appid_date` on `(appid, delta_date DESC)`
- `idx_review_deltas_velocity` on `daily_velocity DESC` WHERE `is_interpolated = FALSE`
- `idx_review_deltas_date` on `delta_date DESC`

---

### user_profiles (v2.1+)

User profiles extending Supabase auth.users with role and credits.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | - | PK, references auth.users |
| email | TEXT | NO | - | User email |
| full_name | TEXT | YES | NULL | Display name |
| organization | TEXT | YES | NULL | Company/org name |
| role | user_role | NO | 'user' | 'user' or 'admin' |
| credit_balance | INTEGER | NO | 0 | Current credit balance (>= 0) |
| total_credits_used | INTEGER | NO | 0 | Lifetime credits consumed |
| total_messages_sent | INTEGER | NO | 0 | Lifetime chat messages |
| created_at | TIMESTAMPTZ | NO | NOW() | Profile creation time |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |

**Indexes**:
- `idx_user_profiles_email` on `email`
- `idx_user_profiles_role` on `role`

**RLS Policies**: Users can read own profile; Admins can read all.

---

### waitlist (v2.1+)

Invite-only waitlist for user signups.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| email | TEXT | NO | - | Applicant email (unique) |
| full_name | TEXT | NO | - | Applicant name |
| organization | TEXT | YES | NULL | Company/org |
| how_i_plan_to_use | TEXT | YES | NULL | Application reason |
| status | waitlist_status | NO | 'pending' | 'pending', 'approved', 'rejected' |
| reviewed_by | UUID | YES | NULL | Admin who reviewed |
| reviewed_at | TIMESTAMPTZ | YES | NULL | Review timestamp |
| invite_sent_at | TIMESTAMPTZ | YES | NULL | When invite was sent |
| created_at | TIMESTAMPTZ | NO | NOW() | Application time |

**Indexes**:
- `idx_waitlist_email` on `email`
- `idx_waitlist_status` on `status`
- `idx_waitlist_created_at` on `created_at DESC`

**RLS Policies**: Public can INSERT; Admins can SELECT/UPDATE.

---

### credit_transactions (v2.1+)

Immutable audit log of all credit movements.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| user_id | UUID | NO | - | FK to user_profiles |
| amount | INTEGER | NO | - | Positive for grants, negative for usage |
| balance_after | INTEGER | NO | - | Balance after this transaction |
| transaction_type | credit_transaction_type | NO | - | Type of transaction |
| description | TEXT | YES | NULL | Human-readable description |
| input_tokens | INTEGER | YES | NULL | Input tokens (chat_usage only) |
| output_tokens | INTEGER | YES | NULL | Output tokens (chat_usage only) |
| tool_credits | INTEGER | YES | NULL | Tool usage credits |
| admin_user_id | UUID | YES | NULL | Admin who made adjustment |
| reservation_id | UUID | YES | NULL | Link to reservation |
| created_at | TIMESTAMPTZ | NO | NOW() | Transaction time |

**Indexes**:
- `idx_credit_transactions_user_date` on `(user_id, created_at DESC)`
- `idx_credit_transactions_type` on `transaction_type`

---

### credit_reservations (v2.1+)

Credit reservations for deduct-at-start pattern (prevents overspend).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| user_id | UUID | NO | - | FK to user_profiles |
| reserved_amount | INTEGER | NO | - | Credits reserved upfront |
| actual_amount | INTEGER | YES | NULL | Actual credits used (filled on finalize) |
| status | credit_reservation_status | NO | 'pending' | 'pending', 'finalized', 'refunded' |
| created_at | TIMESTAMPTZ | NO | NOW() | Reservation time |
| finalized_at | TIMESTAMPTZ | YES | NULL | When finalized/refunded |

**Indexes**:
- `idx_credit_reservations_user_pending` on `user_id` WHERE `status = 'pending'`
- `idx_credit_reservations_created` on `created_at DESC`

---

### rate_limit_state (v2.1+)

Per-user rate limiting state.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | UUID | NO | - | PK, FK to user_profiles |
| requests_this_minute | INTEGER | NO | 0 | Requests in current minute window |
| requests_this_hour | INTEGER | NO | 0 | Requests in current hour window |
| minute_window_start | TIMESTAMPTZ | NO | NOW() | Start of minute window |
| hour_window_start | TIMESTAMPTZ | NO | NOW() | Start of hour window |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update |

**Rate Limits**: 20 requests/minute, 200 requests/hour

---

### ccu_snapshots (v2.2+)

Hourly/2-hourly CCU snapshots for Tier 1+2 games. 30-day retention.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | auto | Primary key |
| appid | INTEGER | NO | - | FK to apps.appid |
| snapshot_time | TIMESTAMPTZ | NO | - | Snapshot timestamp |
| player_count | INTEGER | NO | - | Exact CCU from Steam API |
| ccu_tier | SMALLINT | NO | - | Tier at snapshot time (1/2/3) |
| created_at | TIMESTAMPTZ | NO | NOW() | Record creation time |

**Indexes**:
- `idx_ccu_snapshots_appid_time` on `(appid, snapshot_time DESC)`
- `idx_ccu_snapshots_time` on `snapshot_time`
- `idx_ccu_snapshots_tier_time` on `(ccu_tier, snapshot_time DESC)`

**Retention**: Snapshots older than 30 days are aggregated to `daily_metrics` then deleted.

---

### ccu_tier_assignments (v2.2+)

Current CCU tier assignment for each game. Recalculated hourly.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| appid | INTEGER | NO | - | Primary key, FK to apps.appid |
| ccu_tier | SMALLINT | NO | 3 | Current tier (1/2/3) |
| tier_reason | TEXT | YES | NULL | 'top_ccu', 'new_release', 'default' |
| recent_peak_ccu | INTEGER | YES | NULL | 7-day peak CCU |
| release_rank | INTEGER | YES | NULL | Rank by release date (for Tier 2) |
| last_tier_change | TIMESTAMPTZ | YES | NULL | When tier last changed |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update time |
| ccu_fetch_status | TEXT | YES | NULL | Last fetch result: 'valid', 'invalid', 'error' |
| ccu_skip_until | TIMESTAMPTZ | YES | NULL | Skip until this time (30 days for invalid appids) |
| last_ccu_synced | TIMESTAMPTZ | YES | NULL | Last CCU sync time (for Tier 3 rotation) |

**Tier Definitions**:
- **Tier 1**: Top 500 games by 7-day peak CCU → hourly polling
- **Tier 2**: Top 1000 newest releases (past year) → every 2 hours
- **Tier 3**: All other games → 3x daily polling (rotation)

**Indexes**:
- `idx_ccu_tier_assignments_tier` on `ccu_tier`
- `idx_ccu_tier_assignments_tier1` on `appid` WHERE `ccu_tier = 1`
- `idx_ccu_tier_assignments_tier2` on `appid` WHERE `ccu_tier = 2`

**RPC Functions**:
```sql
recalculate_ccu_tiers()       -- Reassign tiers based on 7-day peak CCU
cleanup_old_ccu_snapshots()   -- Delete snapshots > 30 days old
aggregate_daily_ccu_peaks(target_date)  -- Roll up to daily_metrics
```

---

## Relationships

```
publishers 1──M app_publishers M──1 apps 1──M app_developers M──1 developers
                                    │
                                    ├──M daily_metrics
                                    ├──M review_histogram
                                    ├──1 app_trends
                                    ├──1 sync_status
                                    ├──M app_tags (SteamSpy)
                                    ├──M app_steam_tags ──M steam_tags (PICS)
                                    ├──M app_genres ──M steam_genres
                                    ├──M app_categories ──M steam_categories
                                    ├──M app_franchises ──M franchises
                                    └──1 app_steam_deck
```

**Key joins**:
- `apps` to `developers`: `apps JOIN app_developers ON apps.appid = app_developers.appid JOIN developers ON app_developers.developer_id = developers.id`
- `apps` to `publishers`: `apps JOIN app_publishers ON apps.appid = app_publishers.appid JOIN publishers ON app_publishers.publisher_id = publishers.id`
- `apps` to metrics: `apps JOIN daily_metrics ON apps.appid = daily_metrics.appid`
- `apps` to genres: `apps JOIN app_genres ON apps.appid = app_genres.appid JOIN steam_genres ON app_genres.genre_id = steam_genres.genre_id`
- `apps` to Steam tags: `apps JOIN app_steam_tags ON apps.appid = app_steam_tags.appid JOIN steam_tags ON app_steam_tags.tag_id = steam_tags.tag_id`
- `apps` to Steam Deck: `apps LEFT JOIN app_steam_deck ON apps.appid = app_steam_deck.appid`

---

## Domain Definitions

Use these SQL translations for natural language concepts:

| Natural Language | SQL Condition |
|-----------------|---------------|
| "well reviewed" | `(dm.positive_reviews::float / NULLIF(dm.total_reviews, 0)) >= 0.90` OR `dm.review_score >= 8` |
| "independent developer" / "indie" | Developer where `developer_id = publisher_id AND d.game_count < 5` (see example query below) |
| "major publisher" | `p.game_count >= 10` |
| "prolific developer" | `d.game_count >= 5` |
| "trending up" | `at.trend_30d_direction = 'up'` |
| "trending down" | `at.trend_30d_direction = 'down'` |
| "stable reviews" | `at.trend_30d_direction = 'stable'` |
| "recently released" | `a.release_date >= CURRENT_DATE - INTERVAL '1 year'` |
| "recently active" (publisher/developer) | `first_game_release_date >= CURRENT_DATE - INTERVAL '1 year'` |
| "dead game" | `at.review_velocity_7d < 0.1` |
| "popular" | `dm.ccu_peak >= 10000` OR `dm.owners_max >= 1000000` |
| "free game" | `a.is_free = TRUE` |
| "has discount" / "on sale" | `a.current_discount_percent > 0` |
| "has workshop" | `a.has_workshop = TRUE` |
| "delisted" | `a.is_delisted = TRUE` |
| "unreleased" / "upcoming" | `a.is_released = FALSE` |
| "Steam Deck verified" | `asd.category = 'verified'` |
| "Steam Deck playable" | `asd.category IN ('verified', 'playable')` |
| "Steam Deck compatible" | `asd.category IN ('verified', 'playable')` |
| "Steam Deck unsupported" | `asd.category = 'unsupported'` |
| "has controller support" | `a.controller_support IS NOT NULL` |
| "full controller support" | `a.controller_support = 'full'` |
| "partial controller support" | `a.controller_support = 'partial'` |
| "supports Windows" | `a.platforms LIKE '%windows%'` |
| "supports Mac" / "macOS" | `a.platforms LIKE '%macos%'` |
| "supports Linux" | `a.platforms LIKE '%linux%'` |
| "in genre X" | `EXISTS (SELECT 1 FROM app_genres ag JOIN steam_genres sg ON ag.genre_id = sg.genre_id WHERE ag.appid = a.appid AND sg.name = 'X')` |
| "has tag X" | `EXISTS (SELECT 1 FROM app_steam_tags ast JOIN steam_tags st ON ast.tag_id = st.tag_id WHERE ast.appid = a.appid AND st.name = 'X')` |
| "has feature X" | `EXISTS (SELECT 1 FROM app_categories ac JOIN steam_categories sc ON ac.category_id = sc.category_id WHERE ac.appid = a.appid AND sc.name = 'X')` |

---

## Review Score Reference

| Score | Description | Positive % Range |
|-------|-------------|------------------|
| 9 | Overwhelmingly Positive | 95%+ |
| 8 | Very Positive | 80-94% |
| 7 | Positive | 70-79% |
| 6 | Mostly Positive | 40-69% (more positive) |
| 5 | Mixed | 40-69% |
| 4 | Mostly Negative | 20-39% |
| 3 | Negative | 10-19% |
| 2 | Very Negative | 0-9% |
| 1 | Overwhelmingly Negative | 0-9% (many reviews) |

---

## Example Queries

### 1. Simple lookup
**Q**: "Find the game Stardew Valley"
```sql
SELECT appid, name, type, release_date, is_free
FROM apps
WHERE name ILIKE '%Stardew Valley%'
  AND type = 'game';
```

### 2. Count aggregation
**Q**: "How many games are on Steam?"
```sql
SELECT COUNT(*) as game_count
FROM apps
WHERE type = 'game'
  AND is_released = TRUE
  AND is_delisted = FALSE;
```

### 3. Join with filter
**Q**: "Show me all games by Valve"
```sql
SELECT a.appid, a.name, a.release_date
FROM apps a
JOIN app_publishers ap ON a.appid = ap.appid
JOIN publishers p ON ap.publisher_id = p.id
WHERE p.name = 'Valve'
  AND a.type = 'game'
ORDER BY a.release_date DESC;
```

### 4. Date filtering
**Q**: "Games released in 2024"
```sql
SELECT appid, name, release_date
FROM apps
WHERE type = 'game'
  AND release_date >= '2024-01-01'
  AND release_date < '2025-01-01'
ORDER BY release_date DESC;
```

### 5. Domain concept - well-reviewed indie games
**Q**: "Find well-reviewed indie games"
```sql
SELECT DISTINCT a.appid, a.name,
       ROUND(dm.positive_reviews::numeric / NULLIF(dm.total_reviews, 0) * 100, 1) as positive_pct
FROM apps a
JOIN app_developers ad ON a.appid = ad.appid
JOIN developers d ON ad.developer_id = d.id
JOIN app_publishers ap ON a.appid = ap.appid
JOIN publishers p ON ap.publisher_id = p.id
JOIN daily_metrics dm ON a.appid = dm.appid
WHERE a.type = 'game'
  AND d.game_count < 5
  AND d.name = p.name  -- Self-published (developer is publisher)
  AND dm.metric_date = (SELECT MAX(metric_date) FROM daily_metrics WHERE appid = a.appid)
  AND dm.total_reviews > 100
  AND (dm.positive_reviews::float / NULLIF(dm.total_reviews, 0)) >= 0.90
ORDER BY dm.total_reviews DESC
LIMIT 20;
```

### 6. Trend query
**Q**: "Which games are trending up?"
```sql
SELECT a.appid, a.name,
       at.trend_30d_change_pct,
       at.review_velocity_30d
FROM apps a
JOIN app_trends at ON a.appid = at.appid
WHERE a.type = 'game'
  AND at.trend_30d_direction = 'up'
ORDER BY at.trend_30d_change_pct DESC
LIMIT 20;
```

### 7. Complex aggregation
**Q**: "Publishers with the most well-reviewed games"
```sql
SELECT p.id, p.name, p.game_count,
       COUNT(DISTINCT a.appid) as positive_game_count
FROM publishers p
JOIN app_publishers ap ON p.id = ap.publisher_id
JOIN apps a ON ap.appid = a.appid
JOIN daily_metrics dm ON a.appid = dm.appid
WHERE a.type = 'game'
  AND dm.metric_date = (SELECT MAX(metric_date) FROM daily_metrics WHERE appid = a.appid)
  AND dm.total_reviews >= 100
  AND (dm.positive_reviews::float / NULLIF(dm.total_reviews, 0)) >= 0.90
GROUP BY p.id, p.name, p.game_count
HAVING COUNT(DISTINCT a.appid) >= 3
ORDER BY positive_game_count DESC
LIMIT 20;
```

### 8. Metrics query
**Q**: "Top 10 games by peak concurrent users"
```sql
SELECT a.appid, a.name, dm.ccu_peak, dm.metric_date
FROM apps a
JOIN daily_metrics dm ON a.appid = dm.appid
WHERE a.type = 'game'
  AND dm.ccu_peak IS NOT NULL
  AND dm.metric_date = (SELECT MAX(metric_date) FROM daily_metrics WHERE appid = a.appid)
ORDER BY dm.ccu_peak DESC
LIMIT 10;
```

### 9. Time-series analysis
**Q**: "Games with improving reviews over time"
```sql
SELECT a.appid, a.name,
       at.previous_positive_ratio,
       at.current_positive_ratio,
       at.trend_90d_change_pct
FROM apps a
JOIN app_trends at ON a.appid = at.appid
WHERE a.type = 'game'
  AND at.trend_90d_direction = 'up'
  AND at.current_positive_ratio > at.previous_positive_ratio
  AND at.trend_90d_change_pct > 5
ORDER BY at.trend_90d_change_pct DESC
LIMIT 20;
```

### 10. Multi-condition query
**Q**: "Free games with high player counts"
```sql
SELECT a.appid, a.name,
       dm.ccu_peak,
       dm.owners_min, dm.owners_max,
       dm.total_reviews
FROM apps a
JOIN daily_metrics dm ON a.appid = dm.appid
WHERE a.type = 'game'
  AND a.is_free = TRUE
  AND a.is_released = TRUE
  AND a.is_delisted = FALSE
  AND dm.metric_date = (SELECT MAX(metric_date) FROM daily_metrics WHERE appid = a.appid)
  AND dm.ccu_peak >= 1000
ORDER BY dm.ccu_peak DESC
LIMIT 20;
```

### 11. Steam Deck verified games
**Q**: "Show me Steam Deck verified games with good reviews"
```sql
SELECT a.appid, a.name, a.pics_review_percentage,
       asd.category as steam_deck_status
FROM apps a
JOIN app_steam_deck asd ON a.appid = asd.appid
WHERE a.type = 'game'
  AND a.is_released = TRUE
  AND asd.category = 'verified'
  AND a.pics_review_percentage >= 80
ORDER BY a.pics_review_percentage DESC
LIMIT 20;
```

### 12. Games by genre
**Q**: "Find Action RPG games"
```sql
SELECT a.appid, a.name, a.release_date
FROM apps a
WHERE a.type = 'game'
  AND a.is_released = TRUE
  AND EXISTS (
    SELECT 1 FROM app_genres ag
    JOIN steam_genres sg ON ag.genre_id = sg.genre_id
    WHERE ag.appid = a.appid AND sg.name = 'Action'
  )
  AND EXISTS (
    SELECT 1 FROM app_genres ag
    JOIN steam_genres sg ON ag.genre_id = sg.genre_id
    WHERE ag.appid = a.appid AND sg.name = 'RPG'
  )
ORDER BY a.release_date DESC
LIMIT 20;
```

### 13. Games with specific tag
**Q**: "Find roguelike games"
```sql
SELECT a.appid, a.name, ast.rank as tag_rank
FROM apps a
JOIN app_steam_tags ast ON a.appid = ast.appid
JOIN steam_tags st ON ast.tag_id = st.tag_id
WHERE a.type = 'game'
  AND a.is_released = TRUE
  AND st.name ILIKE '%roguelike%'
ORDER BY ast.rank ASC
LIMIT 20;
```

### 14. Games with controller support
**Q**: "Games with full controller support on Steam Deck"
```sql
SELECT a.appid, a.name, a.controller_support,
       asd.category as steam_deck_status
FROM apps a
JOIN app_steam_deck asd ON a.appid = asd.appid
WHERE a.type = 'game'
  AND a.controller_support = 'full'
  AND asd.category IN ('verified', 'playable')
ORDER BY a.name
LIMIT 20;
```

### 15. Games by platform
**Q**: "Linux-native games"
```sql
SELECT a.appid, a.name, a.platforms
FROM apps a
WHERE a.type = 'game'
  AND a.is_released = TRUE
  AND a.platforms LIKE '%linux%'
ORDER BY a.release_date DESC
LIMIT 20;
```

---

## Materialized Views

These pre-computed views power the Cube.js semantic layer for fast analytics.

### latest_daily_metrics

Most recent metrics snapshot for each game.

```sql
-- Pre-computed latest metrics per app
SELECT DISTINCT ON (appid)
  appid, metric_date, owners_min, owners_max,
  ccu_peak, total_reviews, positive_reviews, review_score, price_cents
FROM daily_metrics
ORDER BY appid, metric_date DESC;
```

**Refreshed**: Daily via GitHub Actions `refresh-views.yml`

**Used by**: Discovery cube, LatestMetrics cube

---

### publisher_metrics

ALL-TIME aggregated publisher statistics.

| Column | Description |
|--------|-------------|
| `publisher_id` | Publisher ID (primary key) |
| `publisher_name` | Publisher name |
| `game_count` | Number of games published |
| `total_owners` | Sum of estimated owners |
| `total_ccu` | Sum of peak CCU |
| `avg_review_score` | Average review score |
| `total_reviews` | Total reviews across all games |
| `positive_reviews` | Total positive reviews |
| `revenue_estimate_cents` | Estimated revenue (owners × price) |
| `is_trending` | Has at least one trending game |
| `unique_developers` | Number of unique developers |

**Used by**: PublisherMetrics cube

---

### developer_metrics

ALL-TIME aggregated developer statistics. Same structure as publisher_metrics with `developer_id` instead of `publisher_id`.

**Used by**: DeveloperMetrics cube

---

### publisher_year_metrics / developer_year_metrics

Per-year aggregations for year-filtered queries.

Additional columns:
- `release_year` - Year games were released

**Used by**: PublisherYearMetrics, DeveloperYearMetrics cubes

---

### publisher_game_metrics / developer_game_metrics

Per-game data joined with publisher/developer info for rolling period queries.

| Column | Description |
|--------|-------------|
| `publisher_id` / `developer_id` | Entity ID |
| `publisher_name` / `developer_name` | Entity name |
| `appid` | Game ID |
| `game_name` | Game name |
| `release_date` | Release date (for period filtering) |
| `release_year` | Release year |
| `owners` | Owner estimate midpoint |
| `ccu` | Peak CCU |
| `total_reviews` | Review count |
| `review_score` | Review score |
| `revenue_estimate_cents` | Revenue estimate |

**Used by**: PublisherGameMetrics, DeveloperGameMetrics cubes (for "games in past 12 months" queries)

**Indexes**:
- Unique index on `(publisher_id, appid)` for concurrent refresh
- Index on `release_date` for date-range filtering

---

### review_velocity_stats (v2.1+)

Pre-computed review velocity stats for fast Cube.js queries and sync scheduling.

| Column | Type | Description |
|--------|------|-------------|
| `appid` | INTEGER | Primary key (game ID) |
| `velocity_7d` | DECIMAL(8,4) | Average reviews/day over 7 days |
| `velocity_30d` | DECIMAL(8,4) | Average reviews/day over 30 days |
| `reviews_added_7d` | INTEGER | Total reviews added in 7 days |
| `reviews_added_30d` | INTEGER | Total reviews added in 30 days |
| `last_delta_date` | DATE | Most recent delta record |
| `actual_sync_count` | INTEGER | Number of actual API syncs |
| `velocity_tier` | TEXT | 'high', 'medium', 'low', 'dormant' |

**Velocity Tier Classification**:
- `high`: velocity_7d >= 5 reviews/day
- `medium`: velocity_7d >= 1 reviews/day
- `low`: velocity_7d >= 0.1 reviews/day
- `dormant`: velocity_7d < 0.1 reviews/day

**Indexes**:
- Unique index on `appid` for concurrent refresh
- Index on `(velocity_tier, velocity_7d DESC)` for tier queries

**Refresh Functions**:
```sql
SELECT refresh_review_velocity_stats();  -- Refresh view
SELECT update_review_velocity_tiers();   -- Sync to sync_status
```

**Used by**: ReviewVelocity cube, velocity-calculator-worker

---

### Games Page Materialized Views (v2.6+)

Pre-computed views for the Games page at `/apps` with two-path optimization.

#### app_filter_data

Pre-computed content arrays for O(1) filtering in `get_apps_with_filters()`.

| Column | Type | Description |
|--------|------|-------------|
| `appid` | INTEGER | Primary key |
| `genre_ids` | INT[] | Pre-computed genre IDs |
| `tag_ids` | INT[] | Pre-computed tag IDs |
| `category_ids` | INT[] | Pre-computed category IDs |
| `has_workshop` | BOOLEAN | Workshop support flag |
| `platform_array` | TEXT[] | ['windows', 'macos', 'linux'] |
| `steam_deck_category` | TEXT | 'verified', 'playable', 'unsupported', 'unknown' |
| `publisher_id` | INTEGER | Primary publisher ID |
| `publisher_name` | TEXT | Publisher name |
| `publisher_game_count` | INTEGER | Publisher's total games |
| `developer_id` | INTEGER | Primary developer ID |
| `developer_name` | TEXT | Developer name |

**GIN Indexes**:
- `idx_app_filter_data_genre_ids` on `genre_ids`
- `idx_app_filter_data_tag_ids` on `tag_ids`
- `idx_app_filter_data_category_ids` on `category_ids`
- `idx_app_filter_data_platform_array` on `platform_array`

**Refreshed**: Every 6 hours via GitHub Actions `refresh-app-filter-data.yml`

**Query Pattern**:
```sql
-- Array containment for content filtering
WHERE afd.genre_ids @> ARRAY[1,2,3]::INT[]   -- Contains ALL (All mode)
WHERE afd.genre_ids && ARRAY[1,2,3]::INT[]   -- Overlaps ANY (Any mode)
```

---

#### Filter Count Views

Pre-computed counts for fast filter dropdown options (<10ms).

| View | Columns | Purpose |
|------|---------|---------|
| `mv_tag_counts` | app_type, tag_id, tag_name, app_count | Tag filter options |
| `mv_genre_counts` | app_type, genre_id, genre_name, app_count | Genre filter options |
| `mv_category_counts` | app_type, category_id, category_name, app_count | Category filter options |
| `mv_steam_deck_counts` | app_type, steam_deck_category, app_count | Steam Deck filter options |
| `mv_ccu_tier_counts` | app_type, ccu_tier, app_count | CCU tier filter options |
| `mv_velocity_tier_counts` | app_type, velocity_tier, app_count | Velocity tier filter options |

**Refreshed**: Every 4 hours via `pg_cron` calling `refresh_filter_count_views()`

---

#### mv_apps_aggregate_stats

Pre-computed summary statistics for the Games page stats bar.

| Column | Type | Description |
|--------|------|-------------|
| `app_type` | TEXT | 'game', 'dlc', 'demo', or 'all' |
| `total_games` | BIGINT | Total count |
| `avg_ccu` | DECIMAL | Average peak CCU |
| `avg_score` | DECIMAL | Average review score % |
| `avg_momentum` | DECIMAL | Average momentum score |
| `trending_up_count` | INTEGER | Games with >10% 7d growth |
| `trending_down_count` | INTEGER | Games with <-10% 7d growth |
| `sentiment_improving_count` | INTEGER | Games with >3% sentiment delta |
| `sentiment_declining_count` | INTEGER | Games with <-3% sentiment delta |
| `avg_value_score` | DECIMAL | Average value score |

**Refreshed**: Daily via GitHub Actions `refresh-views.yml`

---

## Query Tips

1. **Latest metrics**: Always filter `daily_metrics` to most recent date per app:
   ```sql
   WHERE dm.metric_date = (SELECT MAX(metric_date) FROM daily_metrics WHERE appid = a.appid)
   ```

2. **Games only**: Filter `type = 'game'` to exclude DLC, demos, etc.

3. **Active games**: Add `is_released = TRUE AND is_delisted = FALSE`

4. **Avoid division by zero**: Use `NULLIF(total_reviews, 0)` when calculating ratios

5. **Case-insensitive search**: Use `ILIKE` for name searches

6. **SteamSpy tag filtering**: Join through `app_tags` (user-voted):
   ```sql
   JOIN app_tags t ON a.appid = t.appid WHERE t.tag = 'RPG'
   ```

7. **PICS tag filtering**: Join through `app_steam_tags` (official Steam tags):
   ```sql
   JOIN app_steam_tags ast ON a.appid = ast.appid
   JOIN steam_tags st ON ast.tag_id = st.tag_id
   WHERE st.name = 'Roguelike'
   ```

8. **Genre filtering**: Join through `app_genres`:
   ```sql
   JOIN app_genres ag ON a.appid = ag.appid
   JOIN steam_genres sg ON ag.genre_id = sg.genre_id
   WHERE sg.name = 'Action'
   ```

9. **Steam Deck compatibility**: Join through `app_steam_deck`:
   ```sql
   LEFT JOIN app_steam_deck asd ON a.appid = asd.appid
   WHERE asd.category IN ('verified', 'playable')
   ```

10. **Platform filtering**: Use LIKE on the platforms column:
    ```sql
    WHERE a.platforms LIKE '%linux%'
    ```
