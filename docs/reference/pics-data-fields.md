# PICS Data Fields Reference

Complete reference for data available from Steam's PICS (Product Info Cache Server).

## Authority Rules

PICS is an enrichment and fallback source in PublisherIQ.

- Storefront is authoritative for parsed `release_date` and `is_free`
- PICS release metadata should not overwrite a valid Storefront-derived `release_date`
- when Storefront only exposes non-parseable release text, preserve the raw text instead of forcing a typed date
- PICS fields are enrichment and fallback inputs; the `first_pass` mode uses them to bootstrap prioritized coverage, but it does not override Storefront source-of-truth fields

## Data Structure

```
appinfo
├── appid
├── common          ← Main metadata (name, type, developer, etc.)
├── extended        ← Additional metadata (homepage, state)
├── config          ← Technical config (install dir, launch options)
├── depots          ← Download/update information
├── ufs             ← Cloud save configuration
└── localization    ← Language-specific data
```

---

## Common Section

The `common` section contains the most relevant metadata.

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Game/app name |
| `type` | string | "game", "dlc", "demo", "mod", "video", "hardware", "music", "episode", "tool", "application", "series", "advertising" |
| `developer` | string | Developer name |
| `publisher` | string | Publisher name |
| `gameid` | int | Steam game ID (usually same as appid) |
| `steam_release_date` | timestamp | PICS-side Steam release timestamp; useful as enrichment or fallback, not the primary Storefront authority |
| `original_release_date` | timestamp | Original release date (if released elsewhere first) |
| `releasestate` | string | "released", "prerelease", "unavailable", "preloadonly" |
| `store_asset_mtime` | timestamp | Store page creation time (v2.2: replaces page scraping) |

### Review Data

| Field | Type | Description |
|-------|------|-------------|
| `review_score` | int | Review score (1-9 scale) |
| `review_percentage` | int | Percentage of positive reviews (0-100) |

**Review Score Scale:**

| Score | Description | Positive % |
|-------|-------------|------------|
| 9 | Overwhelmingly Positive | 95%+ |
| 8 | Very Positive | 80-94% |
| 7 | Positive | 70-79% |
| 6 | Mostly Positive | 40-69% |
| 5 | Mixed | 40-69% |
| 4 | Mostly Negative | 20-39% |
| 3 | Negative | 10-19% |
| 2 | Very Negative | 0-9% |
| 1 | Overwhelmingly Negative | 0-9% (many reviews) |

### Platform & Controller

| Field | Type | Description |
|-------|------|-------------|
| `oslist` | string | Platforms: "windows", "macos", "linux" (comma-separated) |
| `controller_support` | string | "full", "partial", or absent |
| `isfreeapp` | string | PICS-side free flag; Storefront remains authoritative for `is_free` |

### Store Metadata

| Field | Type | Description |
|-------|------|-------------|
| `store_tags` | dict | User-defined tags as IDs |
| `category` | dict | Feature categories (Steam Workshop, Achievements, etc.) |
| `genres` | dict | Genre IDs |
| `primary_genre` | int | Primary genre ID |
| `metacritic_score` | int | Metacritic score (0-100) |
| `metacritic_url` | string | URL to Metacritic page |

### Relationships

| Field | Type | Description |
|-------|------|-------------|
| `parent` | int | Parent appid (for DLC, demos) |
| `associations` | dict | Franchise/developer/publisher associations |

---

## Category IDs (Feature Flags)

The `category` field indicates supported Steam features:

| ID | Feature |
|----|---------|
| 1 | Multi-player |
| 2 | Single-player |
| 9 | Co-op |
| 20 | MMO |
| 22 | Steam Achievements |
| 23 | Steam Cloud |
| 27 | Cross-Platform Multiplayer |
| 28 | Full Controller Support |
| 29 | Steam Trading Cards |
| 30 | Steam Workshop |
| 35 | In-App Purchases |
| 36 | Online PvP |
| 37 | Online Co-op |
| 38 | Local Co-op |
| 43 | Remote Play on TV |
| 44 | Remote Play Together |
| 45 | Captions Available |
| 46 | LAN PvP |
| 47 | LAN Co-op |
| 48 | HDR |
| 49 | VR Supported |
| 50 | VR Only |
| 51 | Steam China Workshop |
| 52 | Tracked Controller Support |
| 53 | Family Sharing |
| 55 | Timeline Support |
| 56 | GPU Recording |
| 57 | Cloud Gaming (NVIDIA/Xbox) |
| 59 | Co-op Campaigns |
| 60 | Steam Overlay Support |
| 61 | Remote Play on Phone |
| 62 | Remote Play on Tablet |

---

## Genre IDs

Common genre ID mappings:

| ID | Genre |
|----|-------|
| 1 | Action |
| 2 | Strategy |
| 3 | RPG |
| 4 | Casual |
| 5 | Racing |
| 12 | Sports |
| 23 | Indie |
| 25 | Adventure |
| 28 | Simulation |
| 29 | Massively Multiplayer |
| 37 | Free to Play |
| 51 | Animation & Modeling |
| 53 | Design & Illustration |
| 54 | Education |
| 55 | Software Training |
| 56 | Utilities |
| 57 | Video Production |
| 58 | Web Publishing |
| 59 | Game Development |
| 60 | Photo Editing |
| 70 | Early Access |
| 71 | Audio Production |
| 81 | Documentary |
| 82 | Episodic |
| 83 | Feature Film |
| 84 | Short |
| 85 | Benchmark |
| 86 | VR |
| 87 | 360 Video |

---

## Associations

The `associations` field contains related entities:

```json
{
  "0": {
    "type": "developer",
    "name": "Valve"
  },
  "1": {
    "type": "publisher",
    "name": "Valve"
  },
  "2": {
    "type": "franchise",
    "name": "Counter-Strike"
  }
}
```

**Association Types:**

| Type | Description |
|------|-------------|
| `developer` | Developer company |
| `publisher` | Publisher company |
| `franchise` | Game franchise/series |
| `award` | Awards won |

---

## Steam Deck Compatibility

```json
{
  "category": "2",
  "steamos_compatibility": "2",
  "test_timestamp": "1748044800",
  "tested_build_id": "18537564",
  "tests": {
    "0": {
      "display": "3",
      "token": "#SteamDeckVerified_TestResult_ControllerGlyphsDoNotMatchDeckDevice"
    }
  }
}
```

**Category Values:**

| Value | Status |
|-------|--------|
| 0 | Unknown |
| 1 | Unsupported |
| 2 | Playable |
| 3 | Verified |

**Test Display Values:**

| Value | Meaning |
|-------|---------|
| 1 | Fail |
| 2 | Info |
| 3 | Warn |
| 4 | Pass |

---

## Extended Section

Additional metadata in the `extended` section:

| Field | Type | Description |
|-------|------|-------------|
| `developer` | string | Developer (override) |
| `publisher` | string | Publisher (override) |
| `homepage` | string | Homepage URL |
| `developer_url` | string | Developer website |
| `gamemanualurl` | string | Game manual link |
| `state` | string | "eStateAvailable", "eStateUnpublished", etc. |

---

## Store Tags

Tags are stored as ID references:

```json
{
  "store_tags": {
    "0": "493",   // Early Access
    "1": "599",   // Atmospheric
    "2": "122"    // RPG
  }
}
```

Tag IDs map to names via the Steam API or can be looked up in the `steam_tags` table after PICS sync.

## Runtime Modes

The PICS service supports three modes:

| Mode | Purpose |
|------|---------|
| `bulk_sync` | Full bulk capture over the configured app set |
| `first_pass` | Prioritized bootstrap of unsynced apps using the backlog selector |
| `change_monitor` | Ongoing capture path for new or dirty apps |

`first_pass` is the preferred mode when you want to seed the highest-value unsynced apps before continuing with normal monitoring.

---

## Data Extraction Example

```python
from steam.client import SteamClient

client = SteamClient()
client.anonymous_login()

# Fetch PICS data
info = client.get_product_info(apps=[730])

app_info = info['apps'][730]
common = app_info.get('common', {})

# Extract fields
name = common.get('name')
developer = common.get('developer')
review_score = common.get('review_score')
categories = common.get('category', {})

# Check for Steam Workshop
has_workshop = 'category_30' in categories
```

---

## Database Tables

PICS data is stored in these tables:

| Table | Data |
|-------|------|
| `steam_tags` | Tag ID → name mapping |
| `steam_genres` | Genre reference |
| `steam_categories` | Category reference |
| `franchises` | Franchise names |
| `app_steam_tags` | App-tag relationships |
| `app_genres` | App-genre relationships |
| `app_categories` | App-category relationships |
| `app_franchises` | App-franchise relationships |
| `app_steam_deck` | Steam Deck compatibility |

## Related Documentation

- [Data Sources](../developer-guide/architecture/data-sources.md) - Source hierarchy
- [Railway Deployment](../developer-guide/deployment/railway.md) - PICS service setup
- [Database Schema](../developer-guide/architecture/database-schema.md) - Full schema
