# Chat Data System Architecture

This document provides a complete reference for the PublisherIQ chat system's data handling architecture, including all cubes, dimensions, measures, segments, and tools. Use this as a guide for understanding the system and planning future expansions.

**Last Updated:** March 30, 2026

## Recent Improvements

- **Change-intel tools**: `query_change_activity`, `get_game_change_timeline`, `get_recent_news_detail`, `get_recent_news_digest`, `search_recent_news_topics`, `get_change_activity_detail`, `compare_change_before_after`, and `find_change_patterns`
- **Streaming metadata**: `message_end` now includes `quality`, `sessionContext`, and credit usage metadata
- **GameCatalog routing**: specific title and broad catalog questions now use the richer catalog cube rather than the older discovery-only model
- **Lookup-first behavior**: `lookup_games`, `lookup_publishers`, and `lookup_developers` remain the canonical identity resolvers
- **Retry Logic**: 3 retries with exponential backoff (500ms-4s) for Cube.js 502/503/504 errors
- **30s Timeout**: AbortController timeout prevents hanging queries
- **Tag Normalization**: "coop" automatically converts to "co-op"
- **Category Fallback**: Falls back to category search when tags return 0 results
- **NULL Handling**: Improved game search with NULL review percentage support

---

## Table of Contents

1. [System Overview](#system-overview)
2. [LLM Tools Reference](#llm-tools-reference)
3. [Cube.js Semantic Layer](#cubejs-semantic-layer)
4. [Query Execution Flow](#query-execution-flow)
5. [Streaming API Protocol](#streaming-api-protocol)
6. [Entity Linking System](#entity-linking-system)
7. [Chat Query Logging](#chat-query-logging)
8. [System Prompt Architecture](#system-prompt-architecture)
9. [Future Expansion Guide](#future-expansion-guide)
10. [Complete Reference Tables](#complete-reference-tables)

---

## System Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                    │
│                    "Show me games from Valve released in 2024"              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LLM Provider Layer                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ System Prompt: Cube schema, tool definitions, entity linking rules  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                           Tool Selection                                     │
│            ┌──────────────────────┼──────────────────────┐                  │
│            ▼                      ▼                      ▼                  │
│   lookup_publishers     query_analytics          find_similar               │
│   lookup_developers     search_games             lookup_tags                │
│   lookup_games          change-intel tools      discover_trending           │
└────────────┬──────────────────────┬──────────────────────┬──────────────────┘
             │                      │                      │
             ▼                      ▼                      ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────┐
│  Publisher Lookup   │  │  Cube.dev API       │  │  Qdrant Cloud           │
│  (Supabase ILIKE)   │  │  (JWT Auth)         │  │  (Vector Search)        │
└─────────────────────┘  └──────────┬──────────┘  └─────────────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  PostgreSQL         │
                         │  (Supabase)         │
                         │  - Tables           │
                         │  - Views            │
                         │  - Materialized     │
                         └──────────┬──────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ENTITY LINK PRE-FORMATTING                              │
│  formatResultWithEntityLinks() transforms raw results:                      │
│  {gameName: "Half-Life 2", appid: 220}                                     │
│     → {gameName: "[Half-Life 2](game:220)", appid: 220}                    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LLM RESPONSE                                        │
│  Uses pre-formatted links directly in tables and text                       │
│  | Game | Score |                                                           │
│  | [Half-Life 2](game:220) | 9 |                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Semantic Layer**: Cube.js provides type-safe, pre-defined queries instead of raw SQL
2. **Entity Linking at Backend**: Links are formatted before LLM sees results, ensuring reliability
3. **Lookup-First Pattern**: Publisher/developer queries use lookup tools to find exact names first
4. **Segment-First Filtering**: Pre-computed segments are faster than dynamic filters

---

## LLM Tools Reference

The chat system provides 18 tools to the LLM for data access.

### 1. query_analytics

**Purpose**: Query structured game, publisher, and developer analytics using Cube.js semantic models.

**File**: [cube-tools.ts](../../apps/admin/src/lib/llm/cube-tools.ts)

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cube` | string | Yes | One of: GameCatalog, DlcRelations, Discovery, PublisherMetrics, PublisherYearMetrics, PublisherGameMetrics, DeveloperMetrics, DeveloperYearMetrics, DeveloperGameMetrics, DailyMetrics, LatestMetrics, MonthlyGameMetrics, MonthlyPublisherMetrics |
| `dimensions` | string[] | No | Fields to select (e.g., `["Discovery.appid", "Discovery.name"]`) |
| `measures` | string[] | No | Aggregations (e.g., `["Discovery.count"]`) |
| `filters` | array | No | Filter conditions (see [Filter Syntax](#filter-syntax)) |
| `segments` | string[] | No | Pre-defined filters (e.g., `["Discovery.highlyRated"]`) |
| `order` | object | No | Sort order (e.g., `{"Discovery.totalReviews": "desc"}`) |
| `limit` | number | No | Max results (default 50, max 100) |
| `reasoning` | string | Yes | Explanation of why this query answers the user's question |

**Example**:
```json
{
  "cube": "Discovery",
  "dimensions": ["Discovery.appid", "Discovery.name", "Discovery.reviewPercentage"],
  "segments": ["Discovery.veryPositive", "Discovery.steamDeckVerified"],
  "order": {"Discovery.totalReviews": "desc"},
  "limit": 20,
  "reasoning": "Find highly-rated Steam Deck games by popularity"
}
```

---

### 2. find_similar

**Purpose**: Semantic similarity search using Qdrant vector embeddings.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity_type` | string | Yes | `"game"`, `"publisher"`, or `"developer"` |
| `reference_name` | string | Yes | Name of entity to find similar matches for |
| `filters` | object | No | Narrowing filters (see below) |
| `limit` | number | No | Max results 1-20 (default 10) |

**Filter Options**:

| Filter | Type | Values |
|--------|------|--------|
| `popularity_comparison` | string | `"any"`, `"less_popular"`, `"similar"`, `"more_popular"` |
| `review_comparison` | string | `"any"`, `"similar_or_better"`, `"better_only"` |
| `max_price_cents` | number | Maximum price in cents |
| `is_free` | boolean | Only free-to-play games |
| `platforms` | string[] | `["windows", "macos", "linux"]` |
| `steam_deck` | string[] | `["verified", "playable"]` |
| `genres` | string[] | Genre names |
| `tags` | string[] | Steam tag names |
| `min_reviews` | number | Minimum review count |
| `release_year` | object | `{gte: 2020, lte: 2024}` |

---

### 3. search_games

**Purpose**: Find games by tags, genres, categories, and platform criteria with fuzzy matching.

**Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `tags` | string[] | Steam tags (fuzzy match): "CRPG", "Cozy", "Souls-like" |
| `genres` | string[] | Genres: "RPG", "Action", "Adventure", "Indie" |
| `categories` | string[] | Features: "Achievements", "Workshop", "VR" |
| `platforms` | string[] | `["windows", "macos", "linux"]` |
| `controller_support` | string | `"full"`, `"partial"`, `"any"` |
| `steam_deck` | string[] | `["verified", "playable"]` |
| `release_year` | object | `{gte: 2019, lte: 2024}` |
| `review_percentage` | object | `{gte: 90}` for 90%+ positive |
| `metacritic_score` | object | `{gte: 80}` |
| `is_free` | boolean | Free-to-play filter |
| `limit` | number | Max results (default 20, max 50) |
| `order_by` | string | `"reviews"`, `"score"`, `"release_date"`, `"owners"` |

---

### 4. lookup_tags

**Purpose**: Discover available Steam tags, genres, or categories before using in search_games.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search term (e.g., "rogue" finds "Roguelike", "Roguelite") |
| `type` | string | No | `"tags"`, `"genres"`, `"categories"`, or `"all"` (default) |
| `limit` | number | No | Max results per type (default 10, max 20) |

---

### 5. lookup_publishers

**Purpose**: Find exact publisher names in the database before querying.

**Why**: Database names may differ from user input (e.g., "Krafton" → "Krafton Inc.").

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Publisher name to search (partial match via ILIKE) |
| `limit` | number | No | Max results (default 10, max 20) |

**Returns**: Array of `{id: number, name: string}` for use in filters with `equals` operator.

---

### 6. lookup_developers

**Purpose**: Find exact developer names in the database before querying.

**Parameters**: Same as lookup_publishers.

**Example Workflow**:
1. User asks: "Show me games from Krafton"
2. LLM calls: `lookup_publishers("Krafton")` → `[{id: 1788, name: "Krafton Inc."}]`
3. LLM calls: `query_analytics` with filter: `{"member": "PublisherGameMetrics.publisherName", "operator": "equals", "values": ["Krafton Inc."]}`

---

### 7. lookup_games (v2.1+)

**Purpose**: Search for games by name in the database.

**File**: [cube-tools.ts](../../apps/admin/src/lib/llm/cube-tools.ts)

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Game name to search for (partial match via ILIKE) |
| `limit` | number | No | Maximum results (default 10, max 20) |

**Returns**: Array of `{appid: number, name: string, releaseYear: number}`

**Use When**:
- User asks about a **specific game by name**
- Need to find appid before querying metrics
- "What's the review score for Hades?" → lookup first, then query_analytics

**Example Workflow**:
1. User asks: "What's the review score for Elden Ring?"
2. LLM calls: `lookup_games("Elden Ring")` → `[{appid: 1245620, name: "ELDEN RING", releaseYear: 2022}]`
3. LLM calls: `query_analytics` with filter: `{"member": "Discovery.appid", "operator": "equals", "values": ["1245620"]}`

---

### 8. search_by_concept (v2.4+)

**Purpose**: Find games matching a natural language description using semantic similarity.

**Use for**: Concept-based queries WITHOUT a reference game.

**File**: [apps/admin/src/lib/qdrant/search-service.ts](../../apps/admin/src/lib/qdrant/search-service.ts)

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | Yes | Natural language description of games to find |
| `filters` | object | No | Optional filters (price, platforms, steam_deck, genres, tags, etc.) |
| `limit` | number | No | Max results 1-20 (default 10) |

**Filter Options** (same as find_similar):

| Filter | Type | Values |
|--------|------|--------|
| `max_price_cents` | number | Maximum price in cents |
| `is_free` | boolean | Only free-to-play games |
| `platforms` | string[] | `["windows", "macos", "linux"]` |
| `steam_deck` | string[] | `["verified", "playable"]` |
| `genres` | string[] | Genre names |
| `tags` | string[] | Steam tag names |
| `min_reviews` | number | Minimum review count |
| `release_year` | object | `{gte: 2020, lte: 2024}` |
| `review_percentage` | object | `{gte: 90}` |

**Example Queries**:
- "tactical roguelikes with deck building"
- "cozy farming games with crafting"
- "horror games with investigation elements"
- "fast-paced action games with pixel art"

**How It Works**:
1. User provides natural language description
2. Description is embedded using OpenAI text-embedding-3-small (512 dims)
3. Vector search in Qdrant's `publisheriq_games` collection
4. Filters applied during search
5. Results returned with similarity scores

**Difference from find_similar**: No reference game needed - pure concept matching.

---

### 9. discover_trending (v2.4+)

**Purpose**: Discover games by review momentum and trend patterns.

**Use for**: Queries about trending, accelerating, or declining games.

**File**: [apps/admin/src/lib/search/trend-discovery.ts](../../apps/admin/src/lib/search/trend-discovery.ts)

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trend_type` | string | Yes | `review_momentum`, `accelerating`, `breaking_out`, `declining` |
| `timeframe` | string | No | `7d` or `30d` (default 7d) |
| `filters` | object | No | Optional filters (tags, genres, platforms, steam_deck, min/max_reviews) |
| `limit` | number | No | Max results 1-20 (default 10) |

**Trend Types**:

| Type | Criteria | Cube Segment |
|------|----------|--------------|
| `review_momentum` | Highest review activity (most reviews/day) | `Discovery.activelyReviewed` |
| `accelerating` | Review rate increasing (7d > 30d × 1.2) | `Discovery.acceleratingVelocity` |
| `breaking_out` | Hidden gems gaining attention (accelerating + 100-10K reviews) | `Discovery.acceleratingVelocity` |
| `declining` | Review velocity dropping (7d < 30d × 0.8) | `Discovery.deceleratingVelocity` |

**Filter Options**:

| Filter | Type | Description |
|--------|------|-------------|
| `tags` | string[] | Required tags (e.g., ["Roguelike", "Indie"]) |
| `genres` | string[] | Required genres (e.g., ["Action", "RPG"]) |
| `platforms` | string[] | `["windows", "macos", "linux"]` |
| `steam_deck` | string[] | `["verified", "playable"]` |
| `min_reviews` | number | Minimum total reviews |
| `max_reviews` | number | Maximum total reviews (for hidden gems) |
| `is_free` | boolean | Free-to-play filter |
| `release_year` | object | `{gte: 2020, lte: 2024}` |

**Returns**:
- Game info with velocity metrics: velocity7d, velocity30d, velocityTier, reviewsAdded7d, reviewsAdded30d
- Sorted by velocity (highest first for momentum/accelerating, lowest first for declining)

**Example Queries**:
- "Games gaining traction this week"
- "What's breaking out right now?"
- "Games with accelerating reviews"
- "Show me declining games"

---

### 10. Change-Intelligence Tools

These tools cover the current `/changes` and recent-news surfaces.

| Tool | Purpose |
|------|---------|
| `query_change_activity` | Cross-game recent activity search across change cards and announcement cards |
| `get_game_change_timeline` | Per-game timeline of storefront, PICS, media, and news-derived changes |
| `get_recent_news_detail` | Latest Steam news item for one title, summarized as what actually changed |
| `get_recent_news_digest` | Bounded recent-news digest for one title or a small known set |
| `search_recent_news_topics` | Cross-game stored news text search for concrete topics like patch notes or roadmaps |
| `get_change_activity_detail` | Single activity drill-down with before/after detail |
| `compare_change_before_after` | Before/after comparison around a major recent change burst |
| `find_change_patterns` | Deterministic pattern-finding for marketing, relaunch, under-marketed, rescue, and sustained-response prompts |

These tools are routed directly by intent in the chat system prompt. For recent-news topic prompts, use `search_recent_news_topics` instead of generic discovery tools.

---

## Cube.js Semantic Layer

Cube.js provides a semantic layer over PostgreSQL with pre-defined schemas.

Current chat routing uses `GameCatalog` for specific-title and broad catalog questions, `DlcRelations` for DLC/expansion lookups, and `Discovery` for the hardcoded discovery segments.

**Configuration**: [packages/cube/cube.js](../../packages/cube/cube.js)

### Discovery Cube

**Purpose**: Optimized game discovery with all key metrics pre-joined.

**Data Source**: `apps` + `latest_daily_metrics` (materialized view) + `app_trends` + `app_steam_deck`

**File**: [packages/cube/model/Discovery.js](../../packages/cube/model/Discovery.js)

#### Dimensions (27)

| Dimension | Type | Description |
|-----------|------|-------------|
| `appid` | number | Primary key (Steam app ID) |
| `name` | string | Game display name |
| `isFree` | boolean | Whether game is free |
| `priceCents` | number | Current price in cents |
| `priceDollars` | number | Current price in dollars |
| `releaseDate` | time | Release date |
| `releaseYear` | number | Release year (extracted) |
| `lastContentUpdate` | time | Last content update timestamp |
| `platforms` | string | Comma-separated platform list |
| `hasWindows` | boolean | Has Windows support |
| `hasMac` | boolean | Has macOS support |
| `hasLinux` | boolean | Has Linux support |
| `controllerSupport` | string | `"full"`, `"partial"`, or null |
| `steamDeckCategory` | string | `"verified"`, `"playable"`, `"unsupported"`, `"unknown"` |
| `isSteamDeckVerified` | boolean | Steam Deck verified |
| `isSteamDeckPlayable` | boolean | Steam Deck playable (includes verified) |
| `ownersMidpoint` | number | Estimated owner count (midpoint) |
| `ccuPeak` | number | Peak concurrent users |
| `totalReviews` | number | Total review count |
| `positivePercentage` | number | Positive review percentage (from daily_metrics) |
| `reviewScore` | number | Steam review score (1-9) |
| `picsReviewPercentage` | number | Review percentage from PICS data |
| `reviewPercentage` | number | Best available review % (COALESCE) |
| `metacriticScore` | number | Metacritic score (0-100) |
| `trend30dDirection` | string | `"up"`, `"down"`, `"stable"` |
| `trend30dChangePct` | number | 30-day trend change percentage |
| `reviewVelocity7d` | number | Reviews per day (7-day average) |
| `ccuTrend7dPct` | number | CCU change percentage (7-day) |
| `isTrendingUp` | boolean | Whether trending up |

#### Measures (5)

| Measure | Type | Description |
|---------|------|-------------|
| `count` | count | Number of games |
| `avgPrice` | avg | Average price (paid games only) |
| `avgReviewPercentage` | avg | Average review percentage |
| `sumOwners` | sum | Total owner count (aggregation) |
| `sumCcu` | sum | Total CCU (aggregation) |

#### Segments (26)

| Segment | Criteria |
|---------|----------|
| `released` | `is_released = true` |
| `free` | `is_free = true` |
| `paid` | `is_free = false` |
| `highlyRated` | Review % >= 80 |
| `veryPositive` | Review % >= 90 |
| `overwhelminglyPositive` | Review % >= 95 |
| `hasMetacritic` | Has Metacritic score |
| `highMetacritic` | Metacritic >= 75 |
| `steamDeckVerified` | Steam Deck verified |
| `steamDeckPlayable` | Steam Deck playable (includes verified) |
| `trending` | 30-day trend direction = 'up' |
| `popular` | 1000+ reviews |
| `indie` | < 100K owners |
| `mainstream` | >= 100K owners |
| `releasedThisYear` | Released in current year |
| `recentlyReleased` | Released in last 30 days |
| `recentlyUpdated` | Content update in last 30 days |
| `lastYear` | Released in last 12 months (rolling) |
| `last6Months` | Released in last 6 months (rolling) |
| `last3Months` | Released in last 3 months (rolling) |
| `vrGame` | Has VR tag |
| `roguelike` | Has roguelike/roguelite tag |
| `multiplayer` | Has multiplayer tag |
| `singleplayer` | Has single player tag |
| `coop` | Has co-op tag |
| `openWorld` | Has open world tag |

---

### PublisherMetrics Cube

**Purpose**: ALL-TIME aggregated publisher statistics.

**Data Source**: `publisher_metrics` materialized view

**File**: [packages/cube/model/Publishers.js](../../packages/cube/model/Publishers.js)

#### Dimensions (10)

| Dimension | Type | Description |
|-----------|------|-------------|
| `publisherId` | number | Primary key |
| `publisherName` | string | Publisher name |
| `gameCount` | number | Number of games |
| `totalOwners` | number | Total estimated owners |
| `totalCcu` | number | Total concurrent users |
| `avgReviewScore` | number | Average review score |
| `totalReviews` | number | Total reviews |
| `positiveReviews` | number | Positive review count |
| `revenueEstimateDollars` | number | Revenue estimate (USD) |
| `isTrending` | boolean | Has trending games |
| `uniqueDevelopers` | number | Number of developers worked with |

#### Measures (6)

| Measure | Type |
|---------|------|
| `count` | count |
| `sumOwners` | sum |
| `sumCcu` | sum |
| `sumRevenue` | sum |
| `avgScore` | avg |
| `trendingCount` | count (filtered) |

#### Segments (3)

| Segment | Criteria |
|---------|----------|
| `trending` | Has trending games |
| `highRevenue` | Revenue > $1M |
| `highOwners` | Total owners > 100K |

---

### PublisherYearMetrics Cube

**Purpose**: Publisher statistics filtered by release year.

**Use Case**: "Publishers with 2025 releases"

**Data Source**: `publisher_year_metrics` view

#### Dimensions

Same as PublisherMetrics plus:
- `releaseYear` (number): Filter by specific year

---

### PublisherGameMetrics Cube

**Purpose**: Per-game publisher data with rolling period support.

**Use Case**: "Games from Valve in the past 12 months"

**Data Source**: `publisher_game_metrics` view

#### Dimensions (11)

| Dimension | Type | Description |
|-----------|------|-------------|
| `publisherId` | number | Publisher ID (for linking) |
| `publisherName` | string | Publisher name |
| `appid` | number | Game ID (primary key, for linking) |
| `gameName` | string | Game name |
| `releaseDate` | time | Release date (for filtering) |
| `releaseYear` | number | Release year |
| `owners` | number | Owner estimate |
| `ccu` | number | Peak CCU |
| `totalReviews` | number | Review count |
| `reviewScore` | number | Review score |
| `revenueEstimateCents` | number | Revenue estimate |

#### Segments (4)

| Segment | Criteria |
|---------|----------|
| `lastYear` | Released in last 12 months |
| `last6Months` | Released in last 6 months |
| `last3Months` | Released in last 3 months |
| `last30Days` | Released in last 30 days |

---

### DeveloperMetrics Cube

**Purpose**: ALL-TIME aggregated developer statistics.

**Data Source**: `developer_metrics` materialized view

Same structure as PublisherMetrics with developer-specific thresholds:
- `highRevenue`: > $100K (vs $1M for publishers)
- `highOwners`: > 50K (vs 100K for publishers)

---

### DeveloperYearMetrics Cube

**Purpose**: Developer statistics filtered by release year.

Same structure as PublisherYearMetrics.

---

### DeveloperGameMetrics Cube

**Purpose**: Per-game developer data with rolling period support.

Same structure as PublisherGameMetrics with `developerId` instead of `publisherId`.

---

### DailyMetrics Cube

**Purpose**: Historical time-series metrics for trend analysis.

**Data Source**: `daily_metrics` table

#### Dimensions (15)

| Dimension | Type | Description |
|-----------|------|-------------|
| `id` | number | Primary key |
| `appid` | number | Game ID |
| `metricDate` | time | Snapshot date |
| `ownersMin` | number | Owner estimate lower bound |
| `ownersMax` | number | Owner estimate upper bound |
| `ownersMidpoint` | number | Calculated midpoint |
| `ccuPeak` | number | Peak concurrent users |
| `avgPlaytimeForever` | number | Average playtime (minutes) |
| `avgPlaytime2Weeks` | number | 2-week playtime |
| `totalReviews` | number | Total reviews |
| `positiveReviews` | number | Positive reviews |
| `negativeReviews` | number | Negative reviews |
| `reviewScore` | number | Review score (1-9) |
| `reviewScoreDesc` | string | Score description |
| `positivePercentage` | number | Calculated percentage |
| `priceCents` | number | Price at snapshot |
| `discountPercent` | number | Active discount |

#### Measures (12)

- count, sumOwners, avgOwners, maxOwners
- sumCcu, avgCcu, maxCcu
- sumTotalReviews, sumPositiveReviews, sumNegativeReviews
- avgReviewScore, avgPlaytime

---

### LatestMetrics Cube

**Purpose**: Most recent metrics per app (from materialized view).

**Data Source**: `latest_daily_metrics` materialized view

Optimized for fast lookups of current game state.

---

### ReviewVelocity Cube (v2.1+)

**Purpose**: Pre-computed review velocity stats for discovery and sync scheduling insights.

**Data Source**: `review_velocity_stats` materialized view

**File**: [packages/cube/model/ReviewVelocity.js](../../packages/cube/model/ReviewVelocity.js)

#### Dimensions (9)

| Dimension | Type | Description |
|-----------|------|-------------|
| `appid` | number | Primary key (game ID) |
| `velocity7d` | number | Average reviews/day over 7 days |
| `velocity30d` | number | Average reviews/day over 30 days |
| `velocityTier` | string | 'high', 'medium', 'low', 'dormant' |
| `reviewsAdded7d` | number | Total reviews added in 7 days |
| `reviewsAdded30d` | number | Total reviews added in 30 days |
| `lastDeltaDate` | time | Most recent delta record date |
| `actualSyncCount` | number | Number of actual API syncs |
| `velocityTrend` | string | 'accelerating', 'stable', 'decelerating' |

#### Measures (11)

| Measure | Type | Description |
|---------|------|-------------|
| `count` | count | Number of apps with velocity data |
| `avgVelocity7d` | avg | Average 7-day velocity |
| `avgVelocity30d` | avg | Average 30-day velocity |
| `maxVelocity7d` | max | Maximum 7-day velocity |
| `sumReviewsAdded7d` | sum | Total reviews added 7d |
| `sumReviewsAdded30d` | sum | Total reviews added 30d |
| `highVelocityCount` | sum | Count of high velocity games |
| `mediumVelocityCount` | sum | Count of medium velocity games |
| `lowVelocityCount` | sum | Count of low velocity games |
| `dormantCount` | sum | Count of dormant games |

#### Segments (7)

| Segment | Criteria |
|---------|----------|
| `highVelocity` | velocity_tier = 'high' (>=5 reviews/day) |
| `mediumVelocity` | velocity_tier = 'medium' (1-5 reviews/day) |
| `lowVelocity` | velocity_tier = 'low' (0.1-1 reviews/day) |
| `dormant` | velocity_tier = 'dormant' (<0.1 reviews/day) |
| `active` | velocity_7d > 0 |
| `accelerating` | 7d velocity > 30d velocity * 1.2 |
| `decelerating` | 7d velocity < 30d velocity * 0.8 |

---

### ReviewDeltas Cube (v2.1+)

**Purpose**: Time-series data for per-game review trend charts.

**Data Source**: `review_deltas` table

**File**: [packages/cube/model/ReviewDeltas.js](../../packages/cube/model/ReviewDeltas.js)

#### Dimensions (12)

| Dimension | Type | Description |
|-----------|------|-------------|
| `id` | number | Primary key |
| `appid` | number | Game ID |
| `deltaDate` | time | Snapshot date |
| `totalReviews` | number | Absolute review count |
| `positiveReviews` | number | Absolute positive count |
| `reviewScore` | number | Review score (1-9) |
| `reviewScoreDesc` | string | Score description |
| `reviewsAdded` | number | Delta from previous sync |
| `positiveAdded` | number | Positive delta |
| `negativeAdded` | number | Negative delta |
| `dailyVelocity` | number | Reviews/day (normalized to 24h) |
| `isInterpolated` | boolean | TRUE if estimated, FALSE if from API |

#### Measures (8)

| Measure | Type | Description |
|---------|------|-------------|
| `count` | count | Number of delta records |
| `sumReviewsAdded` | sum | Total reviews added |
| `sumPositiveAdded` | sum | Total positive added |
| `sumNegativeAdded` | sum | Total negative added |
| `avgDailyVelocity` | avg | Average reviews/day |
| `maxDailyVelocity` | max | Maximum reviews/day |
| `latestTotalReviews` | max | Most recent total count |
| `actualSyncCount` | sum | Count of actual syncs |

#### Segments (4)

| Segment | Criteria |
|---------|----------|
| `actualOnly` | Only real API syncs (not interpolated) |
| `interpolatedOnly` | Only gap-filled data |
| `hasActivity` | reviews_added > 0 |
| `highVelocity` | daily_velocity >= 5 |

---

### MonthlyGameMetrics Cube

**Purpose**: Time-series estimated played hours per game per month.

**Data Source**: `monthly_game_metrics` table

**File**: [packages/cube/model/MonthlyMetrics.js](../../packages/cube/model/MonthlyMetrics.js)

#### Dimensions (6)

| Dimension | Type | Description |
|-----------|------|-------------|
| `appid` | number | Primary key (game ID) |
| `gameName` | string | Game display name |
| `month` | time | Month (first day of month) |
| `year` | number | Year |
| `monthNum` | number | Month number (1-12) |
| `estimatedMonthlyHours` | number | ESTIMATE based on monthly CCU × avg playtime (not actual Steam data) |

#### Measures (4)

| Measure | Type | Description |
|---------|------|-------------|
| `count` | count | Number of records |
| `sumEstimatedHours` | sum | Total estimated hours |
| `sumMonthlyCcu` | sum | Total monthly CCU |
| `gameCount` | countDistinct | Unique games |

#### Segments (7)

| Segment | Criteria |
|---------|----------|
| `currentMonth` | Current calendar month |
| `lastMonth` | Previous complete month |
| `last3Months` | Rolling 3 months |
| `last6Months` | Rolling 6 months |
| `last12Months` | Rolling 12 months |
| `year2025` | Calendar year 2025 |
| `year2024` | Calendar year 2024 |

**Important**: `estimatedMonthlyHours` is an estimate only - Steam does not provide actual "total played hours" data.

---

### MonthlyPublisherMetrics Cube

**Purpose**: Time-series estimated played hours per publisher per month.

**Data Source**: `monthly_publisher_metrics` table

**File**: [packages/cube/model/MonthlyMetrics.js](../../packages/cube/model/MonthlyMetrics.js)

#### Dimensions (6)

| Dimension | Type | Description |
|-----------|------|-------------|
| `publisherId` | number | Primary key |
| `publisherName` | string | Publisher name |
| `month` | time | Month (first day of month) |
| `year` | number | Year |
| `monthNum` | number | Month number (1-12) |
| `gameCount` | number | Games published |
| `estimatedMonthlyHours` | number | ESTIMATE sum of game monthly hours (not actual Steam data) |

#### Measures (3)

| Measure | Type | Description |
|---------|------|-------------|
| `count` | count | Number of records |
| `sumEstimatedHours` | sum | Total estimated hours |
| `publisherCount` | countDistinct | Unique publishers |

#### Segments (7)

Same time-based segments as MonthlyGameMetrics: `currentMonth`, `lastMonth`, `last3Months`, `last6Months`, `last12Months`, `year2025`, `year2024`.

---

## Query Execution Flow

**File**: [apps/admin/src/lib/cube-executor.ts](../../apps/admin/src/lib/cube-executor.ts)

### 1. Token Generation

```typescript
function generateToken(): string {
  return jwt.sign(
    { iss: 'publisheriq-admin', iat: now, exp: now + 3600 },
    process.env.CUBE_API_SECRET,
    { algorithm: 'HS256' }
  );
}
```

### 2. Filter Normalization

Converts LLM-generated operators to Cube.js format:

| LLM Input | Cube Output |
|-----------|-------------|
| `>=` | `gte` |
| `<=` | `lte` |
| `>` | `gt` |
| `<` | `lt` |
| `=` or `==` | `equals` |
| `!=` or `<>` | `notEquals` |

Also handles:
- Values combined with operators (`">=90"` → operator: `gte`, values: `[90]`)
- String-to-number coercion for numeric fields
- Auto-retry if first query fails with operator error

### 3. Cube API Call

```
POST {CUBE_API_URL}/cubejs-api/v1/load
Authorization: Bearer {JWT}
Body: { query: cubeQuery }
```

### 4. Result Processing

1. **Simplify field names**: `"Discovery.name"` → `"name"`
2. **Application-layer sorting**: Re-sort results (Cube doesn't always respect ORDER BY)
3. **Entity link pre-formatting**: Transform names to markdown links

### 5. Auto-Retry

If the first attempt fails with operator syntax error:
1. Rewrite all SQL operators in query JSON
2. Retry the request
3. Return successful result (user never sees the error)

---

## Streaming API Protocol

The chat system uses Server-Sent Events (SSE) for real-time streaming responses.

**Endpoint**: `POST /api/chat/stream`

**File**: [apps/admin/src/app/api/chat/stream/route.ts](../../apps/admin/src/app/api/chat/stream/route.ts)

### Event Types

The stream emits JSON events in `data: {...}\n\n` format:

| Event | Description |
|-------|-------------|
| `text_delta` | Incremental text chunk from LLM |
| `tool_start` | Tool call initiated |
| `tool_result` | Tool execution completed |
| `message_end` | Response complete with timing/debug, quality, context, and credit info |
| `error` | Error occurred |

### Event Schemas

**File**: [apps/admin/src/lib/llm/streaming-types.ts](../../apps/admin/src/lib/llm/streaming-types.ts)

```typescript
// Incremental text from LLM
interface TextDeltaEvent {
  type: 'text_delta';
  delta: string;  // Text chunk
}

// Tool call started
interface ToolStartEvent {
  type: 'tool_start';
  toolCallId: string;
  name: string;  // e.g., "query_analytics", "find_similar"
  arguments: Record<string, unknown>;
}

// Tool execution complete
interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: { success: boolean; error?: string; [key: string]: any };
  timing: { executionMs: number };
}

// Stream complete
interface MessageEndEvent {
  type: 'message_end';
  timing: {
    llmMs: number;    // Total LLM processing time
    toolsMs: number;  // Total tool execution time
    totalMs: number;  // Total request time
  };
  debug?: {
    iterations: number;        // LLM call count (max 5)
    textDeltaCount: number;    // Text chunks received
    totalChars: number;        // Total characters streamed
    toolCallCount: number;     // Tools called
    lastIterationHadText: boolean;
  };
  quality?: ChatTurnQualityInfo;
  sessionContext?: SessionChatContext | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  creditsCharged?: number;
}

// Error occurred
interface ErrorEvent {
  type: 'error';
  message: string;
}
```

### Tool Iteration Loop

The streaming API uses a tool loop with a maximum of 5 iterations:

1. Send user message to LLM
2. If LLM requests tool calls, execute them
3. Send tool results back to LLM
4. Repeat until LLM produces final text response or max iterations reached
5. Emit `message_end` with timing and debug stats

**Constant**: `MAX_TOOL_ITERATIONS = 5`

If max iterations reached without final response, a fallback message is generated.

### Entity Link Pre-Formatting

Before tool results are sent back to the LLM, `formatResultWithEntityLinks()` transforms entity names into markdown links:

```
{gameName: "Half-Life 2", appid: 220}
  → {gameName: "[Half-Life 2](game:220)", appid: 220}
```

This ensures the LLM copies links directly into responses without needing to format them.

---

## Entity Linking System

**File**: [apps/admin/src/lib/llm/format-entity-links.ts](../../apps/admin/src/lib/llm/format-entity-links.ts)

### Link Formats

| Entity Type | Format |
|-------------|--------|
| Game | `[Name](game:APPID)` |
| Developer | `[Name](/developers/ID)` |
| Publisher | `[Name](/publishers/ID)` |

### How It Works

1. **formatResultWithEntityLinks()** is called on every tool result
2. Checks for ID fields: `appid`, `developerId`, `publisherId`
3. Transforms name fields to include markdown links
4. LLM receives pre-formatted data and uses links directly

### Field Mapping

| Original Field | Formatted Output |
|----------------|------------------|
| `gameName` + `appid` | `[gameName](game:appid)` |
| `name` + `appid` | `[name](game:appid)` |
| `developerName` + `developerId` | `[developerName](/developers/developerId)` |
| `publisherName` + `publisherId` | `[publisherName](/publishers/publisherId)` |

### Why This Approach

- **Reliability**: Links work regardless of LLM behavior
- **Consistency**: Same format across all queries
- **Simplicity**: LLM just copies values into tables

---

## Chat Query Logging

Every chat query is logged to the `chat_query_logs` table for analytics and debugging.

**Files**:
- Logger: [apps/admin/src/lib/chat-query-logger.ts](../../apps/admin/src/lib/chat-query-logger.ts)
- Migration: [supabase/migrations/20260102000001_add_chat_query_logs.sql](../../supabase/migrations/20260102000001_add_chat_query_logs.sql)
- Admin UI: [apps/admin/src/app/(main)/admin/chat-logs/page.tsx](../../apps/admin/src/app/(main)/admin/chat-logs/page.tsx)

### What's Logged

| Field | Description |
|-------|-------------|
| `query_text` | User's original query |
| `tool_names` | Array of unique tools called |
| `tool_count` | Total number of tool calls |
| `iteration_count` | Number of LLM iterations |
| `response_length` | Final response character count |
| `timing_llm_ms` | Time spent in LLM calls |
| `timing_tools_ms` | Time spent executing tools |
| `timing_total_ms` | Total request time |
| `chat_family` | Routed answer family, when available |
| `quality_flags` | Phase-1 / guardrail quality flags |
| `session_context_summary` | Condensed session context payload |
| `guardrail_trace` | Guardrail decisions taken during the turn |
| `answer_contract_summary` | Deterministic answer contract summary |
| `input_tokens` / `output_tokens` | Provider token usage |
| `tool_credits_used` / `total_credits_charged` | Credit accounting metadata |

### Data Retention

**Policy**: 7 days

Logs older than 7 days are automatically deleted by:
- **Cleanup function**: `cleanup_old_chat_logs()` in PostgreSQL
- **Cron job**: GitHub Actions workflow runs daily at 3 AM UTC

**File**: [.github/workflows/cleanup-chat-logs.yml](../../.github/workflows/cleanup-chat-logs.yml)

### Serverless Considerations

Logs are inserted immediately after each request completes (not buffered) because:
1. Vercel serverless functions don't persist between requests
2. Background tasks may be killed before completion
3. Immediate insert ensures data is captured

### Admin Dashboard

Access chat logs at `/admin/chat-logs`:
- Search queries by text
- View timing breakdowns
- Analyze tool usage patterns
- Monitor iteration counts (high counts may indicate issues)

### Interpreting Timing Metrics

| Metric | Normal Range | Concern If |
|--------|--------------|------------|
| `timing_llm_ms` | 500-3000ms | > 5000ms (slow LLM response) |
| `timing_tools_ms` | 100-1000ms | > 3000ms (slow tool execution) |
| `iteration_count` | 1-2 | >= 4 (LLM struggling to complete) |

---

## System Prompt Architecture

**File**: [apps/admin/src/lib/llm/cube-system-prompt.ts](../../apps/admin/src/lib/llm/cube-system-prompt.ts)

### Structure

1. **Date/Year Injection**: Current year for temporal queries
2. **Mandatory Entity Linking Rules**: Format requirements
3. **Tool Descriptions**: When to use each cube, lookup, similarity, and change-intel tool
4. **Cube Schema Documentation**: Current cube dimensions, measures, and segments
5. **Query Format Examples**: JSON query templates
6. **Filter Syntax Reference**: All supported operators
7. **Natural Language Mappings**: Domain terms to query translations
8. **Common Mistakes**: Anti-patterns to avoid
9. **Stop Conditions**: When to stop calling tools and respond

### Critical Rules

1. Always include ID columns for entity linking
2. Use segments over filters when possible
3. Call lookup tools before filtering by name
4. Use fully-qualified segment names and the current cube names
5. Prefer the change-intel tools for recent activity and news prompts instead of generic discovery
6. Keep iterating until the answer is complete or the iteration limit is reached
7. Never invent data or use external URLs

---

## Future Expansion Guide

### Adding a New Cube

1. **Create cube model file**: `packages/cube/model/NewCube.js`
2. **Define SQL source**: Table or view
3. **Define dimensions, measures, segments**
4. **Add pre-aggregations** for performance
5. **Update system prompt**: Add cube to schema documentation
6. **Update tool definition**: Add to `cube` enum in `query_analytics_tool`

### Adding New Dimensions/Measures

1. **Update cube model**: Add to `dimensions` or `measures` object
2. **Update system prompt**: Document the new field
3. **Update tool description** if dimension changes query behavior

### Adding New Segments

1. **Update cube model**: Add to `segments` object with SQL condition
2. **Update system prompt**: Add to segment list with description
3. **Add to natural language mappings** if it maps to common terms

### Adding a New Tool

1. **Define tool schema**: Add to `cube-tools.ts`
2. **Implement handler**: Add to `cube-route.ts` tool execution switch
3. **Update system prompt**: Document when to use the tool
4. **Add entity link formatting** if tool returns entities

### Modifying Entity Link Formats

1. **Update format function**: `format-entity-links.ts`
2. **Update frontend context**: `EntityLinkContext.tsx` if needed
3. **Update system prompt**: Document new format

### Extending Similarity Search

1. **Add Qdrant collection** if new entity type
2. **Update find_similar tool** schema with new filters
3. **Implement filter logic** in similarity search handler
4. **Update system prompt** with examples

---

## Complete Reference Tables

### Filter Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact match | `{"member": "Discovery.isFree", "operator": "equals", "values": [true]}` |
| `notEquals` | Not equal | `{"member": "Discovery.type", "operator": "notEquals", "values": ["dlc"]}` |
| `contains` | String contains | `{"member": "Discovery.platforms", "operator": "contains", "values": ["linux"]}` |
| `notContains` | String doesn't contain | `{"member": "Discovery.name", "operator": "notContains", "values": ["Demo"]}` |
| `gt` | Greater than | `{"member": "Discovery.totalReviews", "operator": "gt", "values": [1000]}` |
| `gte` | Greater than or equal | `{"member": "Discovery.reviewPercentage", "operator": "gte", "values": [90]}` |
| `lt` | Less than | `{"member": "Discovery.priceDollars", "operator": "lt", "values": [20]}` |
| `lte` | Less than or equal | `{"member": "Discovery.metacriticScore", "operator": "lte", "values": [60]}` |
| `set` | Value is set (not null) | `{"member": "Discovery.metacriticScore", "operator": "set"}` |
| `notSet` | Value is not set (null) | `{"member": "Discovery.controllerSupport", "operator": "notSet"}` |
| `inDateRange` | Date within range | `{"member": "Discovery.releaseDate", "operator": "inDateRange", "values": ["2024-01-01", "2024-12-31"]}` |
| `beforeDate` | Before date | `{"member": "Discovery.releaseDate", "operator": "beforeDate", "values": ["2024-01-01"]}` |
| `afterDate` | After date | `{"member": "Discovery.releaseDate", "operator": "afterDate", "values": ["2023-12-31"]}` |
| `notIn` | Not in list | `{"member": "Discovery.appid", "operator": "notIn", "values": [123, 456, 789]}` |

### Natural Language Mappings

| User Says | Query Translation |
|-----------|------------------|
| "indie" | Segment: `Discovery.indie` |
| "trending" | Segment: `Discovery.trending` (NOT filter on isTrendingUp) |
| "highly rated" / "good reviews" | Segment: `Discovery.highlyRated` |
| "very positive" | Segment: `Discovery.veryPositive` |
| "overwhelmingly positive" | Segment: `Discovery.overwhelminglyPositive` |
| "well reviewed" | Filter: `reviewPercentage >= 70` |
| "free" / "free-to-play" | Segment: `Discovery.free` |
| "Steam Deck" | Segment: `Discovery.steamDeckVerified` or `steamDeckPlayable` |
| "popular" | Segment: `Discovery.popular` |
| "new releases" | Segment: `Discovery.recentlyReleased` |
| "recently updated" | Segment: `Discovery.recentlyUpdated` |
| "past 12 months" / "last year" (rolling) | Segment: `*.lastYear` |
| "past 6 months" | Segment: `*.last6Months` |
| "past 3 months" | Segment: `*.last3Months` |
| "released in 2025" | Filter: `releaseYear equals [2025]` |
| "VR games" | Segment: `Discovery.vrGame` |
| "roguelike" / "roguelite" | Segment: `Discovery.roguelike` |
| "multiplayer" | Segment: `Discovery.multiplayer` |
| "single player" | Segment: `Discovery.singleplayer` |
| "co-op" / "coop" | Segment: `Discovery.coop` |
| "open world" | Segment: `Discovery.openWorld` |

### Cube Selection Guide

| Query Type | Cube to Use |
|------------|-------------|
| Specific game title lookup | GameCatalog |
| Broad game discovery with prices/reviews/release state | GameCatalog |
| DLC / expansion lists | DlcRelations |
| Hardcoded Discovery segments | Discovery |
| Publisher ALL-TIME stats | PublisherMetrics |
| Developer ALL-TIME stats | DeveloperMetrics |
| Publishers by release year | PublisherYearMetrics |
| Developers by release year | DeveloperYearMetrics |
| Games by publisher (with links) | PublisherGameMetrics |
| Games by developer (with links) | DeveloperGameMetrics |
| Rolling period queries | *GameMetrics with segments |
| Historical time-series | DailyMetrics |
| Current snapshot | LatestMetrics |
| Monthly playtime by game | MonthlyGameMetrics |
| Monthly playtime by publisher | MonthlyPublisherMetrics |
| Review velocity stats | ReviewVelocity |
| Review trend time-series | ReviewDeltas |

---

## Related Documentation

- [Database Schema](database-schema.md) - Table definitions and SQL patterns
- [Chat Interface Guide](../../user-guide/chat-interface.md) - User guide for chat features
- [System Overview](overview.md) - High-level architecture
