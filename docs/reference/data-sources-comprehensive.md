# PublisherIQ Data Sources - Comprehensive Reference

> Complete documentation of all data sources, APIs, sync workers, and the PICS microservice.
> Last updated: January 10, 2026

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Data Source Quick Reference](#data-source-quick-reference)
3. [Data Authority Hierarchy](#data-authority-hierarchy)
4. [Steam Web API - App List](#1-steam-web-api---app-list)
5. [Steam Storefront API](#2-steam-storefront-api-authoritative)
6. [Steam Reviews API](#3-steam-reviews-api)
7. [Steam CCU API](#4-steam-ccu-api)
8. [SteamSpy API](#5-steamspy-api)
9. [PICS Service](#6-pics-service-python-microservice)
10. [Computed Data Workers](#7-computed-data-workers)
11. [Embedding Generation](#8-embedding-generation)
12. [Database Schema Mapping](#9-database-schema-mapping)
13. [Rate Limits Reference](#10-rate-limits-reference)
14. [Sync Schedules](#11-sync-schedules-github-actions)
15. [Appendix: Complete Field Reference](#appendix-complete-field-reference)

---

## Executive Summary

PublisherIQ collects Steam game data from **7 external data sources** through **15 sync workers** and **1 Python microservice**. This document provides exhaustive detail on every field captured, where it comes from, and where it's stored.

### Key Principles

1. **Storefront API is AUTHORITATIVE** for developer/publisher names - never use SteamSpy for these
2. **PICS tags ≠ SteamSpy tags** - stored in different tables (`app_steam_tags` vs `app_tags`)
3. **CCU data sources differ** - Steam API provides exact counts, SteamSpy provides estimates
4. **Release dates follow hierarchy** - Storefront > PICS (fallback only)
5. **Multi-source fields use last-write-wins** - Supabase upsert merges changes

### Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL DATA SOURCES                              │
├───────────────┬───────────────┬───────────────┬───────────────┬─────────────┤
│ Steam App List│  Storefront   │    Reviews    │   Steam CCU   │  SteamSpy   │
│   (Master)    │ (AUTHORITATIVE)│  (Scores)    │   (Exact)     │ (Estimates) │
└───────┬───────┴───────┬───────┴───────┬───────┴───────┬───────┴──────┬──────┘
        │               │               │               │              │
        ▼               ▼               ▼               ▼              ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         SYNC WORKERS (TypeScript)                          │
│  applist │ storefront │ reviews │ histogram │ ccu-tiered │ steamspy       │
│          │            │         │           │ ccu-daily  │                │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         PICS SERVICE (Python)                              │
│              SteamKit2 → Tags, Genres, Categories, Steam Deck             │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE (PostgreSQL)                              │
│   apps │ daily_metrics │ review_histogram │ ccu_snapshots │ sync_status   │
│   publishers │ developers │ app_steam_tags │ app_genres │ app_categories │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      COMPUTED WORKERS & VIEWS                              │
│   trends │ priority │ velocity │ interpolation │ refresh-views            │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      EMBEDDING GENERATION                                  │
│              OpenAI text-embedding-3-small → Qdrant Cloud                 │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Data Source Quick Reference

| Source               | Endpoint                                        | Worker                                  | Primary Data             | Rate Limit    | Schedule       |
| -------------------- | ----------------------------------------------- | --------------------------------------- | ------------------------ | ------------- | -------------- |
| **Steam App List**   | `IStoreService/GetAppList/v1/`                  | `applist-worker`                        | appid, name              | Unlimited     | Daily 00:15    |
| **Steam Storefront** | `store.steampowered.com/api/appdetails/`        | `storefront-worker`                     | Metadata, dev/pub (AUTH) | ~200/5min     | 5x daily       |
| **Steam Reviews**    | `store.steampowered.com/appreviews/`            | `reviews-worker`                        | Review counts, scores    | ~60/min       | Adaptive       |
| **Steam Histogram**  | `store.steampowered.com/appreviewhistogram/`    | `histogram-worker`                      | Monthly trends           | ~60/min       | Priority-based |
| **Steam CCU**        | `ISteamUserStats/GetNumberOfCurrentPlayers/v1/` | `ccu-tiered-worker`, `ccu-daily-worker` | Exact player count       | 1/sec         | Tiered         |
| **SteamSpy**         | `steamspy.com/api.php`                          | `steamspy-worker`                       | Owners, playtime, tags   | 1/60sec       | Daily 02:15    |
| **PICS Service**     | SteamKit2 (anonymous)                           | Python microservice                     | Tags, genres, Steam Deck | ~200 apps/req | Continuous     |

---

## Data Authority Hierarchy

When multiple sources provide the same field, this hierarchy determines which source is authoritative:

| Field                  | Authoritative Source | Fallback Sources                | Notes                                 |
| ---------------------- | -------------------- | ------------------------------- | ------------------------------------- |
| **Developer names**    | Storefront API       | None                            | SteamSpy has gaps, NEVER use          |
| **Publisher names**    | Storefront API       | None                            | SteamSpy has gaps, NEVER use          |
| **Release date**       | Storefront API       | PICS (only if storefront empty) | PICS never overwrites storefront      |
| **CCU (concurrent)**   | Steam CCU API        | SteamSpy (estimate)             | `ccu_source` column tracks provenance |
| **Review counts**      | Steam Reviews API    | SteamSpy                        | Reviews API is authoritative          |
| **Review score**       | Steam Reviews API    | PICS (`pics_review_score`)      | Reviews API for daily_metrics         |
| **Owner estimates**    | SteamSpy API         | None                            | Only source for owner data            |
| **Playtime stats**     | SteamSpy API         | None                            | Only source for playtime data         |
| **Official tags**      | PICS Service         | None                            | Stored in `app_steam_tags`            |
| **User-voted tags**    | SteamSpy API         | None                            | Stored in `app_tags`                  |
| **Genres**             | PICS Service         | None                            | Official Steam genres                 |
| **Categories**         | PICS Service         | None                            | Official Steam feature flags          |
| **Steam Deck**         | PICS Service         | None                            | Only source                           |
| **Controller support** | PICS Service         | None                            | Only source                           |
| **Platforms**          | PICS Service         | Storefront (basic)              | PICS has detailed oslist              |
| **Price/discount**     | Last write wins      | Storefront, SteamSpy            | Both sources update                   |

---

## 1. Steam Web API - App List

### Overview

The master list of all Steam applications. This is the entry point for discovering new apps.

### API Details

| Property           | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| **Endpoint**       | `https://api.steampowered.com/IStoreService/GetAppList/v1/` |
| **Authentication** | Steam Web API Key (required)                                |
| **Rate Limit**     | Unlimited (but be respectful)                               |
| **Response Size**  | ~50,000 apps per page                                       |

### Request Parameters

| Parameter          | Type   | Required | Description                                       |
| ------------------ | ------ | -------- | ------------------------------------------------- |
| `key`              | string | Yes      | Steam Web API key                                 |
| `include_games`    | bool   | No       | Include games (default: true)                     |
| `include_dlc`      | bool   | No       | Include DLC (default: true)                       |
| `include_software` | bool   | No       | Include software (default: true)                  |
| `include_videos`   | bool   | No       | Include videos (default: true)                    |
| `include_hardware` | bool   | No       | Include hardware (default: true)                  |
| `max_results`      | int    | No       | Results per page (default: 50,000)                |
| `last_appid`       | int    | No       | Pagination cursor (last appid from previous page) |

### Response Structure

```json
{
  "response": {
    "apps": [
      { "appid": 730, "name": "Counter-Strike 2" },
      { "appid": 440, "name": "Team Fortress 2" }
    ],
    "have_more_results": true,
    "last_appid": 2500000
  }
}
```

### Data Captured

| Field   | Type    | Description                 |
| ------- | ------- | --------------------------- |
| `appid` | integer | Unique Steam application ID |
| `name`  | string  | Application display name    |

### Worker Implementation

**File:** `packages/ingestion/src/workers/applist-worker.ts`

**Process:**

1. Fetch complete app list with pagination (50k apps/page)
2. Load all existing app IDs from database (via pagination, 10k per query)
3. Determine new vs existing apps
4. Batch upsert to `apps` table (500 apps/batch)
5. Create `sync_status` records for new apps with `needs_page_creation_scrape=true`

**Database Operations:**

| Table         | Operation | Fields                                                                         |
| ------------- | --------- | ------------------------------------------------------------------------------ |
| `apps`        | UPSERT    | `appid`, `name`                                                                |
| `sync_status` | UPSERT    | `appid`, `priority_score=0`, `needs_page_creation_scrape=true` (new apps only) |

### Statistics Tracked

- `newApps` - Apps discovered for the first time
- `updatedApps` - Apps with name changes
- `errors` - Failed operations
- `totalPages` - API pages fetched
- `duration` - Total execution time

---

## 2. Steam Storefront API (AUTHORITATIVE)

### Overview

The primary source for game metadata. **AUTHORITATIVE for developer and publisher names** - do not use SteamSpy for these fields.

### API Details

| Property           | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Endpoint**       | `https://store.steampowered.com/api/appdetails/` |
| **Authentication** | None (public API)                                |
| **Rate Limit**     | ~200 requests per 5 minutes (token bucket)       |
| **Response Size**  | ~5-50KB per app                                  |

### Request Parameters

| Parameter | Type   | Required | Description                                           |
| --------- | ------ | -------- | ----------------------------------------------------- |
| `appids`  | string | Yes      | Comma-separated app IDs (typically 1 per request)     |
| `cc`      | string | No       | Country code for pricing (default: `us`)              |
| `l`       | string | No       | Language code (default: `english`)                    |
| `filters` | string | No       | Comma-separated data filters (e.g., `price_overview`) |

### Request Headers

```http
Cookie: birthtime=0; mature_content=1
```

These cookies bypass age gates for mature content.

### Response Structure

```json
{
  "730": {
    "success": true,
    "data": {
      "type": "game",
      "name": "Counter-Strike 2",
      "steam_appid": 730,
      "is_free": true,
      "detailed_description": "...",
      "about_the_game": "...",
      "short_description": "...",
      "supported_languages": "English, French, ...",
      "header_image": "https://...",
      "capsule_image": "https://...",
      "website": "https://...",
      "pc_requirements": { "minimum": "...", "recommended": "..." },
      "mac_requirements": { ... },
      "linux_requirements": { ... },
      "developers": ["Valve"],
      "publishers": ["Valve"],
      "price_overview": {
        "currency": "USD",
        "initial": 0,
        "final": 0,
        "discount_percent": 0
      },
      "platforms": { "windows": true, "mac": true, "linux": true },
      "metacritic": { "score": 83, "url": "https://..." },
      "categories": [
        { "id": 1, "description": "Multi-player" },
        { "id": 49, "description": "PvP" }
      ],
      "genres": [
        { "id": "1", "description": "Action" }
      ],
      "release_date": {
        "coming_soon": false,
        "date": "Aug 21, 2012"
      },
      "content_descriptors": { "ids": [], "notes": null },
      "recommendations": { "total": 7500000 },
      "dlc": [123456, 234567],
      "fullgame": { "appid": "220", "name": "Half-Life 2" }
    }
  }
}
```

### Data Captured

| Field                             | Type      | DB Column                                    | Description                                  |
| --------------------------------- | --------- | -------------------------------------------- | -------------------------------------------- |
| `type`                            | string    | `apps.type`                                  | game, dlc, demo, mod, video, hardware, music |
| `name`                            | string    | `apps.name`                                  | Display name                                 |
| `is_free`                         | boolean   | `apps.is_free`                               | Free-to-play flag                            |
| `developers`                      | string[]  | `developers`, `app_developers`               | **AUTHORITATIVE** developer names            |
| `publishers`                      | string[]  | `publishers`, `app_publishers`               | **AUTHORITATIVE** publisher names            |
| `release_date.date`               | string    | `apps.release_date`, `apps.release_date_raw` | Release date (parsed + raw)                  |
| `release_date.coming_soon`        | boolean   | `apps.is_released`                           | Inverse: is_released = !coming_soon          |
| `price_overview.final`            | integer   | `apps.current_price_cents`                   | Price in cents                               |
| `price_overview.discount_percent` | integer   | `apps.current_discount_percent`              | Discount percentage                          |
| `platforms.windows`               | boolean   | (stored via PICS)                            | Windows support                              |
| `platforms.mac`                   | boolean   | (stored via PICS)                            | macOS support                                |
| `platforms.linux`                 | boolean   | (stored via PICS)                            | Linux support                                |
| `metacritic.score`                | integer   | `apps.metacritic_score`                      | Metacritic score                             |
| `recommendations.total`           | integer   | (informational)                              | Total recommendations                        |
| `categories`                      | array     | (stored via PICS)                            | Feature categories                           |
| `genres`                          | array     | (stored via PICS)                            | Game genres                                  |
| `dlc`                             | integer[] | (tracked separately)                         | DLC app IDs                                  |
| `fullgame.appid`                  | integer   | `apps.parent_appid`                          | Parent app for DLC/demos                     |

### Release Date Parsing

The worker parses various date formats:

| Input Format     | Parsed Output |
| ---------------- | ------------- |
| `"Mar 15, 2020"` | `2020-03-15`  |
| `"Q1 2021"`      | `2021-01-01`  |
| `"Q2 2021"`      | `2021-04-01`  |
| `"Q3 2021"`      | `2021-07-01`  |
| `"Q4 2021"`      | `2021-10-01`  |
| `"2021"`         | `2021-01-01`  |
| `"Coming Soon"`  | `null`        |

### Response Status Handling

| Status                 | Meaning                   | Action                             |
| ---------------------- | ------------------------- | ---------------------------------- |
| `success: true` + data | Data available            | Process and store                  |
| `success: false`       | Private/removed/age-gated | Mark `storefront_accessible=false` |
| Network error          | Transient failure         | Retry with backoff                 |

### Worker Implementation

**File:** `packages/ingestion/src/workers/storefront-worker.ts`

**Process:**

1. Fetch apps needing sync via RPC `get_apps_for_sync()` or `get_apps_for_sync_partitioned()`
2. Process concurrently (8 concurrent fetches) with rate limiting
3. Parse response and extract all fields
4. Call RPC `upsert_storefront_app()` for batch database operations
5. Update `sync_status` with results

**Concurrency:** 8 concurrent fetches via `p-limit`

**Partitioning Support:**

```bash
PARTITION_COUNT=4 PARTITION_ID=0 pnpm --filter @publisheriq/ingestion storefront-sync
```

### Database Operations

The `upsert_storefront_app()` RPC performs these operations atomically:

| Table            | Operation       | Fields                                                                                                                                      |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps`           | UPSERT          | name, type, is_free, release_date, release_date_raw, has_workshop, current_price_cents, current_discount_percent, is_released, parent_appid |
| `developers`     | UPSERT          | name, normalized_name                                                                                                                       |
| `publishers`     | UPSERT          | name, normalized_name                                                                                                                       |
| `app_developers` | DELETE + INSERT | appid, developer_id                                                                                                                         |
| `app_publishers` | DELETE + INSERT | appid, publisher_id                                                                                                                         |
| `sync_status`    | UPDATE          | storefront*accessible, last_storefront_sync, last_error*\*                                                                                  |

### Statistics Tracked

- `appsProcessed` - Total apps attempted
- `appsCreated` - First-time enrichment
- `appsUpdated` - Refresh syncs
- `appsSkipped` - No data available (`storefront_accessible=false`)
- `appsFailed` - Processing errors

---

## 3. Steam Reviews API

### Overview

Provides review counts, scores, and monthly trend data for calculating review velocity and sentiment trends.

### API Details - Review Summary

| Property           | Value                                               |
| ------------------ | --------------------------------------------------- |
| **Endpoint**       | `https://store.steampowered.com/appreviews/{appid}` |
| **Authentication** | None (public API)                                   |
| **Rate Limit**     | ~60 requests per minute (token bucket)              |

### Request Parameters (Summary)

| Parameter       | Type   | Required | Description                                         |
| --------------- | ------ | -------- | --------------------------------------------------- |
| `json`          | int    | Yes      | Set to `1` for JSON response                        |
| `num_per_page`  | int    | No       | Set to `0` for summary only (no individual reviews) |
| `purchase_type` | string | No       | Filter: `all`, `steam`, `non_steam_purchase`        |
| `language`      | string | No       | Filter by language (default: all)                   |

### Response Structure (Summary)

```json
{
  "success": 1,
  "query_summary": {
    "num_reviews": 1500000,
    "review_score": 9,
    "review_score_desc": "Overwhelmingly Positive",
    "total_positive": 1400000,
    "total_negative": 100000,
    "total_reviews": 1500000
  }
}
```

### Data Captured (Summary)

| Field               | Type    | DB Column                         | Description           |
| ------------------- | ------- | --------------------------------- | --------------------- |
| `total_reviews`     | integer | `daily_metrics.total_reviews`     | Total review count    |
| `total_positive`    | integer | `daily_metrics.positive_reviews`  | Positive review count |
| `total_negative`    | integer | `daily_metrics.negative_reviews`  | Negative review count |
| `review_score`      | integer | `daily_metrics.review_score`      | Score 1-9             |
| `review_score_desc` | string  | `daily_metrics.review_score_desc` | Human-readable score  |

### Review Score Mapping

| Score | Description                    |
| ----- | ------------------------------ |
| 9     | Overwhelmingly Positive (95%+) |
| 8     | Very Positive (80-94%)         |
| 7     | Mostly Positive (70-79%)       |
| 6     | Mixed (40-69%)                 |
| 5     | Mostly Negative (20-39%)       |
| 4     | Very Negative (<20%)           |
| 3     | Overwhelmingly Negative (<10%) |
| 2     | No reviews yet                 |
| 1     | No user reviews                |

### API Details - Review Histogram

| Property           | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| **Endpoint**       | `https://store.steampowered.com/appreviewhistogram/{appid}` |
| **Authentication** | None (public API)                                           |
| **Rate Limit**     | ~60 requests per minute                                     |

### Request Parameters (Histogram)

| Parameter | Type   | Required | Description                        |
| --------- | ------ | -------- | ---------------------------------- |
| `l`       | string | No       | Language code (default: `english`) |

### Response Structure (Histogram)

```json
{
  "success": 1,
  "results": {
    "start_date": 1420070400,
    "end_date": 1704067200,
    "weeks": [],
    "rollups": [
      {
        "date": 1704067200,
        "recommendations_up": 15000,
        "recommendations_down": 1000
      }
    ],
    "rollup_type": "month"
  }
}
```

### Data Captured (Histogram)

| Field                  | Type      | DB Column                               | Description                 |
| ---------------------- | --------- | --------------------------------------- | --------------------------- |
| `date`                 | timestamp | `review_histogram.month_start`          | Month start date            |
| `recommendations_up`   | integer   | `review_histogram.recommendations_up`   | Positive reviews that month |
| `recommendations_down` | integer   | `review_histogram.recommendations_down` | Negative reviews that month |

### Worker Implementation - Reviews

**File:** `packages/ingestion/src/workers/reviews-worker.ts`

**Process:**

1. Fetch apps needing review sync based on velocity tier
2. Process concurrently (8 concurrent fetches)
3. For each app:
   - Fetch current review summary
   - Calculate delta from last known values
   - Determine velocity tier based on reviews/day
   - Calculate next sync time
4. Upsert to `daily_metrics` and `review_deltas`
5. Update `sync_status` with velocity tier and next sync time

### Velocity Tier System (v2.1+)

| Tier      | Reviews/Day | Sync Interval | Description         |
| --------- | ----------- | ------------- | ------------------- |
| `high`    | ≥ 5         | 4 hours       | High activity games |
| `medium`  | 1-5         | 12 hours      | Moderate activity   |
| `low`     | 0.1-1       | 24 hours      | Low activity        |
| `dormant` | < 0.1       | 72 hours      | Minimal activity    |

**Velocity Calculation:**

```
daily_velocity = (reviews_added * 24) / hours_since_last_sync
```

### Database Operations - Reviews

| Table           | Operation | Fields                                                                                                                                                                           |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily_metrics` | UPSERT    | total_reviews, positive_reviews, negative_reviews, review_score, review_score_desc                                                                                               |
| `review_deltas` | INSERT    | appid, delta_date, total_reviews, positive_reviews, review_score, review_score_desc, reviews_added, positive_added, negative_added, hours_since_last_sync, is_interpolated=false |
| `sync_status`   | UPDATE    | last_reviews_sync, next_reviews_sync, reviews_interval_hours, review_velocity_tier, last_known_total_reviews, last_activity_at                                                   |

### Worker Implementation - Histogram

**File:** `packages/ingestion/src/workers/histogram-worker.ts`

**Process:**

1. Fetch apps needing histogram sync (priority-based)
2. Process concurrently (15 concurrent fetches)
3. Parse monthly rollup data
4. Upsert to `review_histogram` table
5. Update `sync_status.last_histogram_sync`

### Database Operations - Histogram

| Table              | Operation | Fields                                                                   |
| ------------------ | --------- | ------------------------------------------------------------------------ |
| `review_histogram` | UPSERT    | appid, month_start, recommendations_up, recommendations_down, fetched_at |
| `sync_status`      | UPDATE    | last_histogram_sync                                                      |

---

## 4. Steam CCU API

### Overview

Provides **exact** concurrent player counts directly from Valve. Added in v2.2 to replace SteamSpy estimates for active games.

### API Details

| Property           | Value                                                                        |
| ------------------ | ---------------------------------------------------------------------------- |
| **Endpoint**       | `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/` |
| **Authentication** | Steam Web API Key (required)                                                 |
| **Rate Limit**     | 1 request per second (conservative)                                          |

### Request Parameters

| Parameter | Type    | Required | Description          |
| --------- | ------- | -------- | -------------------- |
| `key`     | string  | Yes      | Steam Web API key    |
| `appid`   | integer | Yes      | Steam application ID |

### Response Structure

```json
{
  "response": {
    "player_count": 45678,
    "result": 1
  }
}
```

### Result Codes

| Code  | Meaning       | Action                                       |
| ----- | ------------- | -------------------------------------------- |
| `1`   | Success       | Store player_count                           |
| `42`  | Invalid appid | Mark `ccu_skip_until` = 30 days, don't retry |
| Other | Error         | Retry next run                               |

### Data Captured

| Field          | Type    | DB Column                                              | Description                |
| -------------- | ------- | ------------------------------------------------------ | -------------------------- |
| `player_count` | integer | `ccu_snapshots.player_count`, `daily_metrics.ccu_peak` | Exact concurrent players   |
| `result`       | integer | `ccu_tier_assignments.ccu_fetch_status`                | Result code for skip logic |

### Tier System (v2.2)

| Tier       | Criteria                             | Polling Frequency   | Games     |
| ---------- | ------------------------------------ | ------------------- | --------- |
| **Tier 1** | Top 500 by 7-day peak CCU            | Hourly              | ~500      |
| **Tier 2** | Top 1000 newest releases (past year) | Every 2 hours       | ~1000     |
| **Tier 3** | All other released games             | 3x daily (rotation) | ~120,000+ |

### Worker Implementation - Tiered (Tier 1 + 2)

**File:** `packages/ingestion/src/workers/ccu-tiered-worker.ts`

**Process:**

1. Check current hour (UTC)
2. At hour 0: Trigger tier recalculation via `recalculate_ccu_tiers()` RPC
3. Tier 1: Process every hour
4. Tier 2: Process at even hours only (0, 2, 4, 6, ...)
5. For each tier:
   - Fetch app IDs from `ccu_tier_assignments`
   - Batch fetch CCU from Steam API
   - Insert `ccu_snapshots` records
   - Update `daily_metrics.ccu_peak` (MAX logic)

### Worker Implementation - Daily (Tier 3)

**File:** `packages/ingestion/src/workers/ccu-daily-worker.ts`

**Process:**

1. Fetch Tier 3 apps from `ccu_tier_assignments`
2. Exclude apps where `ccu_skip_until > NOW()`
3. Order by `last_ccu_synced ASC NULLS FIRST` (rotation)
4. Batch fetch with status tracking
5. For valid results:
   - Insert `ccu_snapshots`
   - Update `daily_metrics.ccu_peak`
   - Set `ccu_fetch_status='valid'`
6. For invalid results (code 42):
   - Set `ccu_skip_until` = NOW() + 30 days
   - Set `ccu_fetch_status='invalid'`
7. Update `last_ccu_synced` for all processed apps

**Rotation Logic:** By ordering by `last_ccu_synced ASC NULLS FIRST`, the worker ensures complete coverage of all Tier 3 apps every ~2 days.

### Database Operations

| Table                  | Operation | Fields                                                    |
| ---------------------- | --------- | --------------------------------------------------------- |
| `ccu_snapshots`        | INSERT    | appid, snapshot_time, player_count, ccu_tier              |
| `daily_metrics`        | UPSERT    | ccu_peak (only if new > existing), ccu_source='steam_api' |
| `ccu_tier_assignments` | UPDATE    | ccu_fetch_status, ccu_skip_until, last_ccu_synced         |

### Tier Recalculation RPC

The `recalculate_ccu_tiers()` RPC:

1. Gets top 500 apps by 7-day peak CCU → Tier 1
2. Gets top 1000 newest releases (past year) → Tier 2
3. All others → Tier 3
4. Updates `ccu_tier_assignments` table
5. Returns tier counts for logging

---

## 5. SteamSpy API

### Overview

Third-party API providing estimated owner counts, playtime statistics, and user-voted tags. **NOT authoritative for developer/publisher names.**

### API Details

| Property           | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| **Base URL**       | `https://steamspy.com/api.php`                               |
| **Authentication** | None (public API)                                            |
| **Rate Limit**     | 1 request per second (general), 1 per 60 seconds (paginated) |

### Endpoints

| Endpoint                            | Rate Limit | Description             |
| ----------------------------------- | ---------- | ----------------------- |
| `?request=appdetails&appid={appid}` | 1/sec      | Individual app details  |
| `?request=all&page={page}`          | 1/60sec    | Paginated full catalog  |
| `?request=genre&genre={genre}`      | 1/sec      | Apps by genre           |
| `?request=tag&tag={tag}`            | 1/sec      | Apps by tag             |
| `?request=top100in2weeks`           | 1/sec      | Popular games (2 weeks) |
| `?request=top100forever`            | 1/sec      | All-time popular        |

### Response Structure (App Details)

```json
{
  "appid": 730,
  "name": "Counter-Strike 2",
  "developer": "Valve",
  "publisher": "Valve",
  "score_rank": "",
  "positive": 7000000,
  "negative": 500000,
  "userscore": 0,
  "owners": "50,000,000 .. 100,000,000",
  "average_forever": 12000,
  "average_2weeks": 900,
  "median_forever": 5000,
  "median_2weeks": 300,
  "price": "0",
  "initialprice": "0",
  "discount": "0",
  "ccu": 1200000,
  "languages": "English, French, German, ...",
  "genre": "Action, Free to Play",
  "tags": {
    "FPS": 45000,
    "Shooter": 42000,
    "Competitive": 38000,
    "Action": 35000
  }
}
```

### Data Captured

| Field             | Type    | DB Column                                              | Description                 |
| ----------------- | ------- | ------------------------------------------------------ | --------------------------- |
| `owners`          | string  | `daily_metrics.owners_min`, `daily_metrics.owners_max` | Owner range estimate        |
| `ccu`             | integer | `daily_metrics.ccu_peak` (fallback)                    | CCU estimate (SteamSpy)     |
| `average_forever` | integer | `daily_metrics.average_playtime_forever`               | Avg playtime (minutes)      |
| `average_2weeks`  | integer | `daily_metrics.average_playtime_2weeks`                | Recent playtime (minutes)   |
| `median_forever`  | integer | `daily_metrics.median_playtime_forever`                | Median playtime (minutes)   |
| `median_2weeks`   | integer | `daily_metrics.median_playtime_2weeks`                 | Recent median (minutes)     |
| `positive`        | integer | (informational)                                        | Positive reviews            |
| `negative`        | integer | (informational)                                        | Negative reviews            |
| `price`           | string  | `apps.current_price_cents`                             | Current price (cents)       |
| `discount`        | string  | `apps.current_discount_percent`                        | Discount percentage         |
| `tags`            | object  | `app_tags`                                             | User-voted tags with counts |

### Owner Range Parsing

```
Input: "50,000,000 .. 100,000,000"
Output: { min: 50000000, max: 100000000 }
```

### Important Notes

1. **Developer/Publisher fields are NOT used** - SteamSpy has gaps and inconsistencies
2. **CCU is an estimate** - Use Steam CCU API for exact counts
3. **Tags are user-voted** - Different from official PICS tags
4. **Paginated endpoint is SLOW** - 1 request per 60 seconds

### Worker Implementation

**File:** `packages/ingestion/src/workers/steamspy-worker.ts`

**Process:**

1. Fetch paginated catalog (100 pages × 60 sec = ~1.67 hours)
2. For each page:
   - Process all apps in batch
   - Parse owner ranges
   - Extract tags
3. Supplementary fetches for high-review apps not in pagination:
   - RPC `get_steamspy_individual_fetch_candidates(limit, min_reviews)`
   - Individual fetches for apps with 1000+ reviews
4. Batch upsert to database

### Database Operations

| Table           | Operation       | Fields                                                                                                                                                                                                                                        |
| --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps`          | UPSERT          | name, is_free, current_price_cents, current_discount_percent                                                                                                                                                                                  |
| `daily_metrics` | UPSERT          | owners_min, owners_max, ccu_peak (if no Steam API data), average_playtime_forever, average_playtime_2weeks, median_playtime_forever, median_playtime_2weeks, positive_reviews, negative_reviews, total_reviews, price_cents, discount_percent |
| `app_tags`      | DELETE + INSERT | appid, tag_name, vote_count                                                                                                                                                                                                                   |
| `sync_status`   | UPDATE          | last_steamspy_sync, is_syncable, steamspy_available, last_steamspy_individual_fetch                                                                                                                                                           |

---

## 6. PICS Service (Python Microservice)

### Overview

The Product Information Cache Service (PICS) provides direct access to Steam's internal product database via SteamKit2. This Python microservice extracts official metadata not available through public APIs.

### Architecture

| Component        | Technology                          |
| ---------------- | ----------------------------------- |
| **Runtime**      | Python 3.11+                        |
| **Steam Client** | `steam` library (SteamKit2 wrapper) |
| **Database**     | Supabase (PostgreSQL)               |
| **Hosting**      | Railway                             |
| **Connection**   | Anonymous Steam login               |

### Connection Details

| Property         | Value                                  |
| ---------------- | -------------------------------------- |
| **Login Type**   | Anonymous (no credentials)             |
| **Heartbeat**    | Every 5 minutes (configurable 60-600s) |
| **Reconnection** | Exponential backoff, max 5 minutes     |
| **Batch Size**   | ~200 apps per request (configurable)   |
| **Timeout**      | 60 seconds per batch                   |

### Operating Modes

#### Bulk Sync Mode

**Purpose:** Initial one-time load of all PICS data

**Configuration:**
| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `bulk_sync` | Operating mode |
| `BULK_BATCH_SIZE` | 200 | Apps per request |
| `BULK_REQUEST_DELAY` | 0.5s | Delay between batches |

**Process:**

1. Connect to Steam anonymously
2. Fetch unsynced apps from `sync_status` (WHERE `last_pics_sync IS NULL`)
3. Batch fetch PICS data (200 apps/request)
4. Extract and upsert to database
5. Update `sync_status.last_pics_sync`

**Performance:** ~70,000 apps in ~3 minutes

#### Change Monitor Mode

**Purpose:** Continuous real-time updates

**Configuration:**
| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `change_monitor` | Operating mode |
| `POLL_INTERVAL` | 30s | Seconds between polls |
| `PROCESS_BATCH_SIZE` | 100 | Apps per processing batch |
| `MAX_QUEUE_SIZE` | 10,000 | Max queued changes |

**Process:**

1. Connect to Steam anonymously
2. Load `last_change_number` from `pics_sync_state`
3. Poll `get_changes_since(change_number)` every 30s
4. Queue changed app IDs (circular buffer, max 10,000)
5. Process queued apps in batches of 100
6. Update `pics_sync_state.last_change_number`

### PICS Response Structure

```python
raw_data = {
    "appinfo": {
        "common": {
            "name": "Counter-Strike 2",
            "type": "game",
            "releasestate": "released",
            "oslist": "windows,macos,linux",
            "controller_support": "full",
            "review_score": 9,
            "review_percentage": 93,
            "metacritic_score": 83,
            "metacritic_url": "https://...",
            "steam_release_date": 1690000000,
            "store_asset_mtime": 1690000000,
            "primary_genre": 1,
            "genres": {"0": "1", "1": "25"},
            "store_tags": {"0": "19", "1": "597", "2": "3859"},
            "category": {
                "category_1": "1",
                "category_2": "1",
                "category_9": "1"
            },
            "steam_deck_compatibility": {
                "category": 3,
                "test_timestamp": 1690000000,
                "tested_build_id": "12345678",
                "tests": { ... }
            },
            "associations": {
                "0": {"type": "developer", "name": "Valve"},
                "1": {"type": "publisher", "name": "Valve"},
                "2": {"type": "franchise", "name": "Counter-Strike"}
            },
            "content_descriptors": { ... },
            "languages": { ... }
        },
        "extended": {
            "developer": "Valve",
            "publisher": "Valve",
            "homepage": "https://...",
            "state": "eStateAvailable",
            "listofdlc": "123456,234567"
        },
        "config": {
            "workshop": "1"
        },
        "depots": {
            "branches": {
                "public": {
                    "buildid": "15123456",
                    "timeupdated": 1705000000
                }
            }
        }
    }
}
```

### Complete Field Extraction Mapping

#### Basic Information

| PICS Path             | DB Table | DB Column       | Type    | Notes                                                                                         |
| --------------------- | -------- | --------------- | ------- | --------------------------------------------------------------------------------------------- |
| `common.name`         | `apps`   | `name`          | TEXT    | Display name                                                                                  |
| `common.type`         | `apps`   | `type`          | ENUM    | game, dlc, demo, mod, video, tool, application, hardware, music, episode, series, advertising |
| `common.releasestate` | `apps`   | `release_state` | TEXT    | released, prerelease, unavailable, preloadonly                                                |
| `common.isfreeapp`    | `apps`   | `is_free`       | BOOLEAN | Free-to-play flag                                                                             |

#### Dates & Timestamps

| PICS Path                            | DB Table | DB Column             | Type        | Notes                                            |
| ------------------------------------ | -------- | --------------------- | ----------- | ------------------------------------------------ |
| `common.steam_release_date`          | `apps`   | `release_date`        | DATE        | **Only written if Storefront doesn't have data** |
| `common.store_asset_mtime`           | `apps`   | `store_asset_mtime`   | TIMESTAMPTZ | Store page creation date                         |
| `depots.branches.public.timeupdated` | `apps`   | `last_content_update` | TIMESTAMPTZ | Last content patch                               |

#### Review & Metacritic

| PICS Path                  | DB Table | DB Column                | Type     | Notes            |
| -------------------------- | -------- | ------------------------ | -------- | ---------------- |
| `common.review_score`      | `apps`   | `pics_review_score`      | SMALLINT | 1-9 scale        |
| `common.review_percentage` | `apps`   | `pics_review_percentage` | SMALLINT | 0-100            |
| `common.metacritic_score`  | `apps`   | `metacritic_score`       | SMALLINT | Metacritic score |
| `common.metacritic_url`    | `apps`   | `metacritic_url`         | TEXT     | Metacritic link  |

#### Platforms & Compatibility

| PICS Path                   | DB Table | DB Column            | Type | Notes                      |
| --------------------------- | -------- | -------------------- | ---- | -------------------------- |
| `common.oslist`             | `apps`   | `platforms`          | TEXT | CSV: "windows,macos,linux" |
| `common.controller_support` | `apps`   | `controller_support` | TEXT | "full", "partial", NULL    |

#### Steam Deck Compatibility

| PICS Path                                         | DB Table         | DB Column         | Type        | Notes                                    |
| ------------------------------------------------- | ---------------- | ----------------- | ----------- | ---------------------------------------- |
| `common.steam_deck_compatibility.category`        | `app_steam_deck` | `category`        | ENUM        | unknown, unsupported, playable, verified |
| `common.steam_deck_compatibility.test_timestamp`  | `app_steam_deck` | `test_timestamp`  | TIMESTAMPTZ | When tested                              |
| `common.steam_deck_compatibility.tested_build_id` | `app_steam_deck` | `tested_build_id` | TEXT        | Build ID tested                          |
| `common.steam_deck_compatibility.tests`           | `app_steam_deck` | `tests`           | JSONB       | Full test results                        |

**Steam Deck Category Mapping:**
| Code | Database Value |
|------|----------------|
| 0 | `unknown` |
| 1 | `unsupported` |
| 2 | `playable` |
| 3 | `verified` |

#### Content Metadata

| PICS Path                    | DB Table | DB Column             | Type  | Notes                |
| ---------------------------- | -------- | --------------------- | ----- | -------------------- |
| `common.content_descriptors` | `apps`   | `content_descriptors` | JSONB | Mature content flags |
| `common.languages`           | `apps`   | `languages`           | JSONB | Supported languages  |

#### URLs & Identifiers

| PICS Path                                       | DB Table | DB Column          | Type | Notes                   |
| ----------------------------------------------- | -------- | ------------------ | ---- | ----------------------- |
| `extended.homepage` OR `extended.developer_url` | `apps`   | `homepage_url`     | TEXT | Developer/publisher URL |
| `extended.state`                                | `apps`   | `app_state`        | TEXT | Extended state flag     |
| `depots.branches.public.buildid`                | `apps`   | `current_build_id` | TEXT | Current build ID        |

#### Tags (Official Store Tags)

**Source:** `common.store_tags` (numbered dict of tag IDs)

**Format:**

```python
{"0": "19", "1": "597", "2": "3859"}  # Tag IDs, not names
```

**Database Storage:**

| Table            | Columns                   | Notes                        |
| ---------------- | ------------------------- | ---------------------------- |
| `steam_tags`     | `tag_id`, `name`          | Reference table              |
| `app_steam_tags` | `appid`, `tag_id`, `rank` | Junction table with position |

**Tag Name Resolution:**

- Fetched from `https://store.steampowered.com/tagdata/populartags/english` on startup
- Cached class-level for all extractions
- Fallback: "Tag {id}" if not found

**Key Distinction:** These are **official PICS tags** stored in `app_steam_tags`, NOT user-voted SteamSpy tags (stored in `app_tags`).

#### Genres

**Source:** `common.genres` (numbered dict of genre IDs)

**Format:**

```python
{"0": "1", "1": "25"}  # Genre IDs
```

**Primary Genre:** `common.primary_genre` (single ID)

**Database Storage:**

| Table          | Columns                           | Notes           |
| -------------- | --------------------------------- | --------------- |
| `steam_genres` | `genre_id`, `name`                | Reference table |
| `app_genres`   | `appid`, `genre_id`, `is_primary` | Junction table  |

**Hardcoded Genre Mapping (32 genres):**

| ID  | Name                  | ID  | Name                  |
| --- | --------------------- | --- | --------------------- |
| 1   | Action                | 37  | Free to Play          |
| 2   | Strategy              | 51  | Animation & Modeling  |
| 3   | RPG                   | 53  | Design & Illustration |
| 4   | Casual                | 54  | Education             |
| 5   | Racing                | 55  | Software Training     |
| 9   | Racing                | 56  | Utilities             |
| 12  | Sports                | 57  | Video Production      |
| 18  | Sports                | 58  | Web Publishing        |
| 23  | Indie                 | 59  | Game Development      |
| 25  | Adventure             | 60  | Photo Editing         |
| 28  | Simulation            | 70  | Early Access          |
| 29  | Massively Multiplayer | 71  | Audio Production      |
| 72  | Accounting            | 81  | Documentary           |
| 82  | Episodic              | 83  | Feature Film          |
| 84  | Short                 | 85  | Benchmark             |
| 86  | VR                    | 87  | 360 Video             |

#### Categories (Feature Flags)

**Source:** `common.category` (numbered dict format)

**Format:**

```python
{
    "category_1": "1",   # Multi-player enabled
    "category_2": "1",   # Single-player enabled
    "category_9": "1"    # Co-op enabled
}
```

**Database Storage:**

| Table              | Columns                              | Notes                         |
| ------------------ | ------------------------------------ | ----------------------------- |
| `steam_categories` | `category_id`, `name`, `description` | Reference table               |
| `app_categories`   | `appid`, `category_id`               | Junction table (enabled only) |

**Hardcoded Category Mapping (70+ categories):**

| ID  | Name                       | Description                  |
| --- | -------------------------- | ---------------------------- |
| 1   | Multi-player               | Supports multiple players    |
| 2   | Single-player              | Solo play available          |
| 9   | Co-op                      | Cooperative gameplay         |
| 18  | Partial Controller Support | Basic controller             |
| 20  | MMO                        | Massively Multiplayer Online |
| 22  | Steam Achievements         | Has achievements             |
| 23  | Steam Cloud                | Cloud saves                  |
| 27  | Cross-Platform Multiplayer | Cross-platform play          |
| 28  | Full Controller Support    | Full controller              |
| 29  | Steam Trading Cards        | Has trading cards            |
| 30  | Steam Workshop             | Workshop support             |
| 31  | VR Support                 | VR compatible                |
| 35  | In-App Purchases           | Has microtransactions        |
| 36  | Online PvP                 | Online versus                |
| 37  | Shared/Split Screen PvP    | Local versus                 |
| 38  | Online Co-op               | Online cooperative           |
| 39  | Shared/Split Screen Co-op  | Local cooperative            |
| 40  | SteamVR Collectibles       | VR collectibles              |
| 41  | Remote Play on Phone       | Phone streaming              |
| 42  | Remote Play on Tablet      | Tablet streaming             |
| 43  | Remote Play on TV          | TV streaming                 |
| 44  | Remote Play Together       | Shared streaming             |
| 47  | LAN PvP                    | Local network versus         |
| 48  | LAN Co-op                  | Local network cooperative    |
| 49  | PvP                        | Player vs Player             |
| 50  | VR Only                    | Requires VR                  |
| 51  | Tracked Controller Support | Motion controllers           |
| 52  | VR Supported               | VR optional                  |
| 53  | VR Standing                | Standing VR                  |
| 54  | VR Seated                  | Seated VR                    |
| 55  | VR Room-Scale              | Room-scale VR                |
| 56  | Commentary available       | Developer commentary         |
| 61  | HDR available              | HDR support                  |
| 62  | Family Sharing             | Family library sharing       |
| 63  | Valve Anti-Cheat enabled   | VAC protected                |
| 64  | Adjustable Text            | Accessibility                |
| 65  | Subtitles                  | Accessibility                |
| 66  | Color Alternatives         | Accessibility                |
| 67  | Camera Comfort             | Accessibility                |
| 68  | Volume Controls            | Accessibility                |
| 69  | Interact Without Clicking  | Accessibility                |
| 70  | Text-to-Speech             | Accessibility                |
| 71  | Menu Narration             | Accessibility                |
| 72  | Speech-to-Text             | Accessibility                |
| 73  | Audio Description          | Accessibility                |
| 74  | Timeline Support           | Steam Timeline               |

#### Franchises

**Source:** `common.associations` where `type == "franchise"`

**Format:**

```python
{
    "0": {"type": "developer", "name": "Valve"},
    "1": {"type": "publisher", "name": "Valve"},
    "2": {"type": "franchise", "name": "Counter-Strike"}
}
```

**Database Storage:**

| Table            | Columns                         | Notes           |
| ---------------- | ------------------------------- | --------------- |
| `franchises`     | `id`, `name`, `normalized_name` | Reference table |
| `app_franchises` | `appid`, `franchise_id`         | Junction table  |

**Normalization:** Franchise names are normalized to lowercase for deduplication.

#### DLC Relationships

**Source:** `extended.listofdlc` (comma-separated app IDs)

**Format:**

```python
"123456,234567,345678"
```

**Database Storage:** `app_dlc` table (no FK constraints, allows orphaned DLC)

#### Intentionally Skipped Fields

| PICS Path                               | Reason                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `common.parent`                         | Unreliable data (contains garbage); DLC type set via Storefront's `fullgame` field |
| `common.original_release_date`          | Not persisted, for reference only                                                  |
| `common.developer` / `common.publisher` | Only used for associations; Storefront is authoritative                            |

### Database Operations Summary

| Table              | Operation       | Fields                                                                                                                                                                                                                                                                                          |
| ------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps`             | UPSERT          | name, type, is_free, release_state, platforms, controller_support, pics_review_score, pics_review_percentage, metacritic_score, metacritic_url, homepage_url, app_state, current_build_id, last_content_update, store_asset_mtime, content_descriptors, languages, release_date (fallback only) |
| `steam_tags`       | UPSERT          | tag_id, name                                                                                                                                                                                                                                                                                    |
| `steam_genres`     | UPSERT          | genre_id, name                                                                                                                                                                                                                                                                                  |
| `steam_categories` | UPSERT          | category_id, name                                                                                                                                                                                                                                                                               |
| `franchises`       | UPSERT          | name, normalized_name                                                                                                                                                                                                                                                                           |
| `app_steam_tags`   | DELETE + INSERT | appid, tag_id, rank                                                                                                                                                                                                                                                                             |
| `app_genres`       | DELETE + INSERT | appid, genre_id, is_primary                                                                                                                                                                                                                                                                     |
| `app_categories`   | DELETE + INSERT | appid, category_id                                                                                                                                                                                                                                                                              |
| `app_franchises`   | DELETE + INSERT | appid, franchise_id                                                                                                                                                                                                                                                                             |
| `app_steam_deck`   | UPSERT          | appid, category, test_timestamp, tested_build_id, tests                                                                                                                                                                                                                                         |
| `sync_status`      | UPDATE          | last_pics_sync                                                                                                                                                                                                                                                                                  |
| `pics_sync_state`  | UPDATE          | last_change_number                                                                                                                                                                                                                                                                              |

### Health Endpoints

| Endpoint      | Response                                             |
| ------------- | ---------------------------------------------------- |
| `GET /`       | `"OK"` (200)                                         |
| `GET /health` | `"OK"` (200)                                         |
| `GET /status` | JSON with mode, progress, connection age, queue size |

---

## 7. Computed Data Workers

These workers don't fetch external data but compute derived metrics from existing database records.

### Trends Worker

**File:** `packages/ingestion/src/workers/trends-worker.ts`

**Purpose:** Calculate 30-day and 90-day review sentiment trends

**Input:** `review_histogram` table

**Output:** `app_trends` table

**Calculations:**

| Metric                 | Formula                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `trend_30d_direction`  | Compare positive ratio (past 30d vs prior 30d); >2% = 'up', <-2% = 'down', else 'stable' |
| `trend_30d_change_pct` | Percentage change in positive ratio                                                      |
| `trend_90d_direction`  | Compare positive ratio (past 90d vs prior 90d)                                           |
| `trend_90d_change_pct` | Percentage change in positive ratio                                                      |
| `review_velocity_7d`   | total_reviews_past_7d / 7                                                                |
| `review_velocity_30d`  | total_reviews_past_30d / 30                                                              |

**Requirements:** Minimum 2 histogram entries to calculate trends

### Priority Worker

**File:** `packages/ingestion/src/workers/priority-worker.ts`

**Purpose:** Assign sync priority scores for intelligent scheduling

**Input:** Various metrics (CCU, reviews, trends)

**Output:** `sync_status` table

**Scoring Rules:**

| Factor             | Points | Condition                                    |
| ------------------ | ------ | -------------------------------------------- |
| Never-synced base  | +25    | App has never been synced                    |
| CCU > 10,000       | +100   | High concurrent players                      |
| CCU > 1,000        | +50    | Moderate concurrent players                  |
| CCU > 100          | +25    | Some concurrent players                      |
| Velocity > 10/day  | +40    | High review velocity                         |
| Velocity > 5/day   | +20    | Moderate review velocity                     |
| Velocity > 1/day   | +10    | Some review velocity                         |
| Trend change > 10% | +25    | Significant trend                            |
| Trend change > 5%  | +15    | Moderate trend                               |
| Reviews > 10,000   | +20    | High review volume                           |
| Reviews > 1,000    | +10    | Moderate review volume                       |
| Reviews > 100      | +5     | Some reviews                                 |
| Dead game          | -50    | Previously synced + 0 CCU + <0.1 reviews/day |

**Final score:** `MAX(0, calculated_score)`

**Sync Interval Mapping:**

| Score | Interval           | Tier     |
| ----- | ------------------ | -------- |
| ≥ 150 | 6 hours            | active   |
| ≥ 100 | 12 hours           | active   |
| ≥ 50  | 24 hours           | moderate |
| ≥ 25  | 48 hours           | moderate |
| > 0   | 168 hours (weekly) | dormant  |
| 0     | monthly            | dead     |

### Velocity Calculator Worker

**File:** `packages/ingestion/src/workers/velocity-calculator-worker.ts`

**Purpose:** Refresh velocity statistics and update velocity tiers

**Process:**

1. Call RPC `refresh_review_velocity_stats()` to refresh materialized view
2. Call RPC `update_review_velocity_tiers()` to recalculate tiers

**Output:** Updates `sync_status.review_velocity_tier`

### Interpolation Worker

**File:** `packages/ingestion/src/workers/interpolation-worker.ts`

**Purpose:** Fill gaps in daily review data for continuous visualization

**Process:**

1. Loop over RPC `interpolate_review_deltas_batch(start_date, end_date, after_appid, app_limit)`
2. Default window: 30 days back
3. Advance `after_appid` until `has_more = false`

**Output:** `review_deltas` records with `is_interpolated=true`

### Refresh Views Worker

**File:** `packages/ingestion/src/workers/refresh-views-worker.ts`

**Purpose:** Refresh materialized views in dependency order

**Refresh Order:**

1. **Level 1:** `latest_daily_metrics`
2. **Level 2:** `publisher_metrics`, `developer_metrics`
3. **Level 3:** `publisher_year_metrics`, `developer_year_metrics`, `publisher_game_metrics`, `developer_game_metrics`
4. **Level 4:** `monthly_game_metrics`

**Method:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` (no locks)

---

## 8. Embedding Generation

### Overview

Generates vector embeddings for semantic similarity search across games, publishers, and developers.

### Technology Stack

| Component            | Technology                      |
| -------------------- | ------------------------------- |
| **Model**            | OpenAI `text-embedding-3-small` |
| **Dimensions**       | 1536                            |
| **Vector DB**        | Qdrant Cloud                    |
| **Change Detection** | SHA-256 hash comparison         |

### Worker Implementation

**File:** `packages/ingestion/src/workers/embedding-worker.ts`

**Process:**

1. Fetch entities needing embedding:
   - Games: RPC `get_apps_for_embedding()` (100 per batch)
   - Publishers: RPC `get_publishers_needing_embedding()` (200 per batch)
   - Developers: RPC `get_developers_needing_embedding()` (200 per batch)
2. Filter games using `isWorthEmbedding()`:
   - Games: need name + (3+ tags OR 1+ genre)
   - Non-games: need name + (1+ tag OR 1+ genre)
3. Build embedding text for each entity
4. Generate embeddings via OpenAI API
5. Upsert to Qdrant (100 points per batch)
6. Mark as embedded via RPC

### Qdrant Collections

| Collection                         | Entity     | Purpose                 |
| ---------------------------------- | ---------- | ----------------------- |
| `publisheriq_games`                | Games      | Find similar games      |
| `publisheriq_publishers_portfolio` | Publishers | Match by entire catalog |
| `publisheriq_publishers_identity`  | Publishers | Match by top games      |
| `publisheriq_developers_portfolio` | Developers | Match by entire catalog |
| `publisheriq_developers_identity`  | Developers | Match by top games      |

### Embedding Text Construction

**Games (`buildGameEmbeddingText`):**

```
Name: Counter-Strike 2
Type: game
Developers: Valve
Publishers: Valve
Genres: Action, Free to Play
Tags: FPS, Shooter, Competitive, Multiplayer, ... (top 15)
Categories: Multi-player, Co-op, Steam Achievements, ...
Platforms: Windows, macOS, Linux
Release Date: 2012-08-21
Price: Free
Controller: Full Support
Steam Deck: Verified
Reviews: Overwhelmingly Positive (93%)
```

**Publishers/Developers:**

- **Portfolio text:** catalog size, year active, genres, tags, platforms, review percentage
- **Identity text:** known-for games, specializations, tags

### Qdrant Payload Structure

**Game Payload:**
| Field | Type | Source |
|-------|------|--------|
| `appid` | int | apps.appid |
| `name` | string | apps.name |
| `type` | string | apps.type |
| `genres` | string[] | app_genres |
| `tags` | string[] | app_steam_tags |
| `categories` | string[] | app_categories |
| `platforms` | string[] | apps.platforms |
| `steam_deck` | string | app_steam_deck.category |
| `controller_support` | string | apps.controller_support |
| `is_free` | bool | apps.is_free |
| `price_tier` | string | Derived from price |
| `review_score` | int | daily_metrics.review_score |
| `review_percentage` | int | daily_metrics.review_percentage |
| `total_reviews` | int | daily_metrics.total_reviews |
| `ccu_tier` | string | Derived from CCU |
| `release_year` | int | apps.release_date |
| `developer_ids` | int[] | app_developers |
| `publisher_ids` | int[] | app_publishers |
| `franchise_ids` | int[] | app_franchises |
| `is_released` | bool | apps.is_released |
| `is_delisted` | bool | apps.is_delisted |
| `embedding_hash` | string | SHA-256 (16 chars) |
| `updated_at` | timestamp | System |

**Publisher/Developer Payload:**
| Field | Type | Source |
|-------|------|--------|
| `id` | int | publishers/developers.id |
| `name` | string | publishers/developers.name |
| `game_count` | int | publishers/developers.game_count |
| `first_release_year` | int | Derived from earliest game |
| `top_genres` | string[] | Aggregated from games |
| `top_tags` | string[] | Aggregated from games |
| `platforms_supported` | string[] | Aggregated from games |
| `avg_review_percentage` | float | Aggregated from games |
| `total_reviews` | int | Aggregated from games |
| `is_major` | bool | game_count > threshold |
| `top_game_names` | string[] | Top games by reviews |
| `top_game_appids` | int[] | Top game IDs |
| `flagship_game` | string | Top game name |
| `is_indie` | bool | Developers only |
| `embedding_hash` | string | SHA-256 (16 chars) |
| `updated_at` | timestamp | System |

### Cost Estimation

~$0.02 per 1M tokens (text-embedding-3-small pricing)

---

## 9. Database Schema Mapping

### Complete Worker → Table Mapping

| Worker                       | Tables Modified                                                                                                                                                        | Operation            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `applist-worker`             | apps, sync_status                                                                                                                                                      | UPSERT               |
| `storefront-worker`          | apps, developers, publishers, app_developers, app_publishers, sync_status                                                                                              | UPSERT/DELETE+INSERT |
| `steamspy-worker`            | apps, daily_metrics, app_tags, sync_status                                                                                                                             | UPSERT/DELETE+INSERT |
| `reviews-worker`             | daily_metrics, review_deltas, sync_status                                                                                                                              | UPSERT/INSERT        |
| `histogram-worker`           | review_histogram, sync_status                                                                                                                                          | UPSERT               |
| `ccu-tiered-worker`          | ccu_snapshots, daily_metrics, ccu_tier_assignments                                                                                                                     | INSERT/UPSERT        |
| `ccu-daily-worker`           | ccu_snapshots, daily_metrics, ccu_tier_assignments                                                                                                                     | INSERT/UPSERT/UPDATE |
| `trends-worker`              | app_trends                                                                                                                                                             | UPSERT               |
| `priority-worker`            | sync_status                                                                                                                                                            | UPDATE               |
| `velocity-calculator-worker` | sync_status, review_velocity_stats (view)                                                                                                                              | UPDATE/REFRESH       |
| `interpolation-worker`       | review_deltas                                                                                                                                                          | INSERT               |
| `refresh-views-worker`       | All materialized views                                                                                                                                                 | REFRESH              |
| `price-sync-worker`          | apps, sync_status                                                                                                                                                      | UPDATE               |
| `embedding-worker`           | Qdrant collections, sync_status                                                                                                                                        | UPSERT               |
| **PICS Service**             | apps, steam_tags, steam_genres, steam_categories, franchises, app_steam_tags, app_genres, app_categories, app_franchises, app_steam_deck, sync_status, pics_sync_state | UPSERT/DELETE+INSERT |

### Column Source Matrix

#### `apps` Table

| Column                     | Storefront | SteamSpy | PICS     | Reviews | Notes                    |
| -------------------------- | ---------- | -------- | -------- | ------- | ------------------------ |
| `appid`                    | -          | -        | -        | -       | From App List            |
| `name`                     | ✓          | ✓        | ✓        | -       | Storefront preferred     |
| `type`                     | ✓          | -        | ✓        | -       | PICS preferred           |
| `is_free`                  | ✓          | ✓        | ✓        | -       | Any source               |
| `release_date`             | ✓          | -        | Fallback | -       | Storefront AUTHORITATIVE |
| `release_date_raw`         | ✓          | -        | -        | -       | Storefront only          |
| `is_released`              | ✓          | -        | ✓        | -       | Either source            |
| `current_price_cents`      | ✓          | ✓        | -        | -       | Either source            |
| `current_discount_percent` | ✓          | ✓        | -        | -       | Either source            |
| `has_developer_info`       | ✓          | -        | -        | -       | Storefront only          |
| `platforms`                | -          | -        | ✓        | -       | PICS only                |
| `controller_support`       | -          | -        | ✓        | -       | PICS only                |
| `pics_review_score`        | -          | -        | ✓        | -       | PICS only                |
| `pics_review_percentage`   | -          | -        | ✓        | -       | PICS only                |
| `metacritic_score`         | ✓          | -        | ✓        | -       | Either source            |
| `release_state`            | -          | -        | ✓        | -       | PICS only                |
| `parent_appid`             | ✓          | -        | -        | -       | Storefront only          |
| `homepage_url`             | -          | -        | ✓        | -       | PICS only                |
| `app_state`                | -          | -        | ✓        | -       | PICS only                |
| `current_build_id`         | -          | -        | ✓        | -       | PICS only                |
| `last_content_update`      | -          | -        | ✓        | -       | PICS only                |
| `store_asset_mtime`        | -          | -        | ✓        | -       | PICS only                |
| `content_descriptors`      | -          | -        | ✓        | -       | PICS only                |
| `languages`                | -          | -        | ✓        | -       | PICS only                |

#### `daily_metrics` Table

| Column                     | SteamSpy   | Steam CCU   | Reviews | Notes               |
| -------------------------- | ---------- | ----------- | ------- | ------------------- |
| `owners_min`               | ✓          | -           | -       | SteamSpy only       |
| `owners_max`               | ✓          | -           | -       | SteamSpy only       |
| `ccu_peak`                 | Fallback   | ✓           | -       | Steam CCU preferred |
| `ccu_source`               | 'steamspy' | 'steam_api' | -       | Tracks provenance   |
| `average_playtime_forever` | ✓          | -           | -       | SteamSpy only       |
| `average_playtime_2weeks`  | ✓          | -           | -       | SteamSpy only       |
| `median_playtime_forever`  | ✓          | -           | -       | SteamSpy only       |
| `median_playtime_2weeks`   | ✓          | -           | -       | SteamSpy only       |
| `total_reviews`            | ✓          | -           | ✓       | Reviews preferred   |
| `positive_reviews`         | ✓          | -           | ✓       | Reviews preferred   |
| `negative_reviews`         | ✓          | -           | ✓       | Reviews preferred   |
| `review_score`             | -          | -           | ✓       | Reviews only        |
| `review_score_desc`        | -          | -           | ✓       | Reviews only        |
| `price_cents`              | ✓          | -           | -       | SteamSpy            |
| `discount_percent`         | ✓          | -           | -       | SteamSpy            |

---

## 10. Rate Limits Reference

| API                    | Limit         | Implementation        | Notes                                |
| ---------------------- | ------------- | --------------------- | ------------------------------------ |
| **Steam App List**     | Unlimited     | None                  | Respect Steam's servers              |
| **Steam Storefront**   | ~200/5min     | Token bucket          | Cookie bypass for age gates          |
| **Steam Reviews**      | ~60/min       | Token bucket          | Summary + histogram                  |
| **Steam Histogram**    | ~60/min       | Token bucket          | Same as reviews                      |
| **Steam CCU**          | 1/sec         | Sequential with delay | Conservative estimate                |
| **SteamSpy Details**   | 1/sec         | Token bucket          | Individual app fetches               |
| **SteamSpy Paginated** | 1/60sec       | Token bucket          | **SEVERE** - ~1.67h for full catalog |
| **PICS Service**       | ~200 apps/req | Batch + delay         | 0.5s delay between batches           |
| **OpenAI Embeddings**  | Tier-based    | Batch                 | ~$0.02/1M tokens                     |

### Token Bucket Implementation

**File:** `packages/ingestion/src/utils/rate-limiter.ts`

| API        | Tokens | Refill Rate     |
| ---------- | ------ | --------------- |
| Storefront | 40     | 40/5min (8/min) |
| Reviews    | 60     | 60/min          |
| SteamSpy   | 60     | 1/sec           |

---

## 11. Sync Schedules (GitHub Actions)

### Daily Schedule (UTC)

| Time  | Workflow               | Purpose                     |
| ----- | ---------------------- | --------------------------- |
| 00:15 | `applist-sync`         | Master app list             |
| 02:15 | `steamspy-sync`        | CCU, owners, playtime, tags |
| 03:00 | `embedding-sync`       | Vector embeddings           |
| 04:23, 16:23 | `histogram-sync` | Monthly review trends       |
| 04:30 | `ccu-daily-sync`       | Tier 3 CCU (1st rotation)   |
| 05:00 | `interpolation`        | Review delta interpolation  |
| 05:00 | `refresh-views`        | Materialized view refresh   |
| 06:00 | `storefront-sync`      | Game metadata (1st run)     |
| 06:30 | `reviews-sync`         | Review counts (1st run)     |
| 08:00 | `velocity-calculation` | Velocity tiers (1st run)    |
| 10:00 | `storefront-sync`      | Game metadata (2nd run)     |
| 10:30 | `reviews-sync`         | Review counts (2nd run)     |
| 12:30 | `ccu-daily-sync`       | Tier 3 CCU (2nd rotation)   |
| 14:00 | `storefront-sync`      | Game metadata (3rd run)     |
| 14:30 | `reviews-sync`         | Review counts (3rd run)     |
| 16:00 | `velocity-calculation` | Velocity tiers (2nd run)    |
| 18:00 | `storefront-sync`      | Game metadata (4th run)     |
| 18:30 | `reviews-sync`         | Review counts (4th run)     |
| 20:30 | `ccu-daily-sync`       | Tier 3 CCU (3rd rotation)   |
| 22:00 | `storefront-sync`      | Game metadata (5th run)     |
| 22:00 | `trends-calculation`   | 30d/90d trends              |
| 22:30 | `reviews-sync`         | Review counts (5th run)     |
| 22:30 | `priority-calculation` | Priority scores             |
| 00:00 | `velocity-calculation` | Velocity tiers (3rd run)    |

### Hourly Schedule

| Schedule | Workflow               | Purpose                          |
| -------- | ---------------------- | -------------------------------- |
| `:00`    | `ccu-sync`             | Tier 1+2 CCU polling             |
| `:00`    | `cleanup-reservations` | Stale credit reservation cleanup |

### Weekly Schedule

| Day    | Time  | Workflow            | Purpose                        |
| ------ | ----- | ------------------- | ------------------------------ |
| Sunday | 03:00 | `ccu-cleanup`       | Snapshot cleanup + aggregation |
| Daily  | 03:00 | `cleanup-chat-logs` | 7-day log retention            |

### Continuous

| Service      | Mode             | Schedule         |
| ------------ | ---------------- | ---------------- |
| PICS Service | `change_monitor` | Every 30 seconds |

---

## Appendix: Complete Field Reference

### All Database Tables by Data Source

**Tables populated by App List API:**

- `apps` (appid, name)
- `sync_status` (appid)

**Tables populated by Storefront API:**

- `apps` (metadata fields)
- `developers`
- `publishers`
- `app_developers`
- `app_publishers`
- `sync_status`

**Tables populated by Reviews API:**

- `daily_metrics` (review fields)
- `review_deltas`
- `review_histogram`
- `sync_status`

**Tables populated by Steam CCU API:**

- `ccu_snapshots`
- `daily_metrics` (ccu_peak, ccu_source)
- `ccu_tier_assignments`

**Tables populated by SteamSpy API:**

- `apps` (price fields)
- `daily_metrics` (owners, playtime, CCU fallback)
- `app_tags`
- `sync_status`

**Tables populated by PICS Service:**

- `apps` (PICS-specific columns)
- `steam_tags`
- `steam_genres`
- `steam_categories`
- `franchises`
- `app_steam_tags`
- `app_genres`
- `app_categories`
- `app_franchises`
- `app_steam_deck`
- `sync_status`
- `pics_sync_state`

**Tables populated by Computed Workers:**

- `app_trends` (trends-worker)
- `sync_status` (priority-worker, velocity-calculator)
- `review_deltas` (interpolation-worker with is_interpolated=true)

**Tables populated by Embedding Worker:**

- Qdrant collections (external)
- `sync_status` (embedding metadata)

### Materialized Views

| View                     | Source Tables                                   | Refreshed By               |
| ------------------------ | ----------------------------------------------- | -------------------------- |
| `latest_daily_metrics`   | daily_metrics                                   | refresh-views-worker       |
| `publisher_metrics`      | daily_metrics, app_publishers, publishers       | refresh-views-worker       |
| `developer_metrics`      | daily_metrics, app_developers, developers       | refresh-views-worker       |
| `publisher_year_metrics` | daily_metrics, app_publishers, publishers, apps | refresh-views-worker       |
| `developer_year_metrics` | daily_metrics, app_developers, developers, apps | refresh-views-worker       |
| `publisher_game_metrics` | daily_metrics, app_publishers, publishers, apps | refresh-views-worker       |
| `developer_game_metrics` | daily_metrics, app_developers, developers, apps | refresh-views-worker       |
| `review_velocity_stats`  | review_deltas                                   | velocity-calculator-worker |

---

_Document generated: January 10, 2026_
_Version: 2.2 (CCU Tiers + SteamSpy Improvements)_
