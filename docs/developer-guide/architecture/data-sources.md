# Data Sources

PublisherIQ combines official Steam APIs, SteamSpy, Steam news, and PICS-derived metadata, then serves those inputs through two different data planes.

**Last Updated:** May 1, 2026

## Source Hierarchy

| Tier | Source | Role |
|------|--------|------|
| 1 | Steam App List | Catalog discovery and app-list hint cursors |
| 1 | Steam Storefront | Authoritative storefront metadata |
| 1 | Steam Reviews + Histogram | Reviews, scores, and review history |
| 1 | Steam CCU API | Exact current player counts |
| 1 | Steam News | Public announcements and update posts |
| 2 | SteamSpy | Owners, playtime, and tag enrichment |
| 2 | YouTube Data API | Creator/channel/video coverage for tracked Steam games |
| 3 | PICS | Specialized metadata, relationships, Steam Deck, and PICS-side history |
| 3 | Internal projections | change bursts, pattern windows, cached admin stats, and search projections derived from the source feeds |

## Where Those Sources Land

### TigerData + R2

TigerData and R2 are primary for accepted and tested incoming ingestion/product-data paths:

- product-data writer surfaces that have been cut over
- archived normalized snapshots and evidence payloads where object storage is configured
- YouTube coverage, channel, match, and rollup tables written by `@publisheriq/youtube`
- hot contract-serving slices for chat/search/discovery

### Supabase

Supabase remains the retained target/source for:

- auth and user/session state
- credits, logs, and user-control data
- reference data and operational state not proven Tiger-backed
- legacy warehouse surfaces and compatibility reads
- page-serving RPCs and views for `/apps`, `/companies`, `/changes`, and `/admin`
- retained/default ingestion paths where Tiger/R2 has not been enabled and verified

TigerData is therefore both the contract-serving target and the primary product-data target for accepted cutover paths, but it is not a blanket replacement for Supabase.

## Authority Rules

### Storefront

Storefront is authoritative for:

- developers and publishers
- parsed `release_date`
- `is_free`
- pricing and discount state

When Storefront only exposes non-parseable text such as “Coming soon”, PublisherIQ preserves the raw text and leaves the typed `release_date` unset.

### PICS

PICS is enrichment and fallback data for:

- store tags
- genres and categories
- franchises and relationships
- Steam Deck compatibility
- release state and store-asset timestamps
- PICS-side history and diff events

PICS does not override authoritative Storefront values for `release_date` or `is_free`.

PICS latest-state writes support a Tiger target, but the service defaults to Supabase unless `PICS_LATEST_STATE_TARGET=tiger` and the Tiger URL are present in the running Railway environment. PICS change-history writes can use Tiger/R2 when `PICS_CHANGE_HISTORY_TARGET=tiger` and archive settings are configured. Do not infer deployed Railway behavior or app runtime writes from repository support alone.

### Internal projections

Projection refresh surfaces are derived views over Storefront, news, and PICS inputs. They improve read performance for `/changes`, admin operations, and chat/news contracts, but they never replace the source records they summarize.

## Change-Intelligence Sources

PublisherIQ’s change-intelligence runtime depends on five source families:

| Source | Captures |
|--------|----------|
| App List hints | `last_modified` and `price_change_number` for recapture seeding |
| Storefront | copy, languages, pricing, release text, platforms, categories, genres, media URLs |
| Steam News | announcements and post history |
| Projection refresh | change bursts, activity days, app windows, and lean news search rows |
| PICS | release state, build/update signals, tags, categories, genres, Steam Deck, relationships |

## Source Notes

### Steam App List

- endpoint: `IStoreService/GetAppList`
- used for catalog discovery and hint cursor changes
- powers `app-change-hints`

### Steam Storefront

- endpoint: `https://store.steampowered.com/api/appdetails`
- current-state source for most product-facing metadata
- storefront snapshots are part of the change-intelligence system

### Steam News

- endpoint family: `ISteamNews/GetNewsForApp`
- used for `/changes` news surfaces and the chat news/change contracts
- stored news text is projected into lean read models for both Supabase and Tiger-backed consumers

### SteamSpy

- owner estimates and playtime remain useful enrichment
- CCU is no longer authoritative here; current CCU comes from Steam’s native player-count API

### YouTube

- YouTube API data is used for tracked-game video and channel coverage only; it is not a general site-wide media crawl
- `@publisheriq/youtube` reads Steam-tracked routing state and writes the coverage, match, and rollup slices directly into TigerData
- preview environments can mirror production Tiger slices for this collector without re-running the entire discovery pass

### PICS

- direct Steam client-protocol data, not a standard public web API
- current-state enrichment, historical PICS snapshotting, and `first_pass` bootstrap mode are all implemented in this repo

## Related Documentation

- [TigerData Operating Model](./tigerdata-operating-model.md)
- [Sync Pipeline](./sync-pipeline.md)
- [PICS Data Fields](../../reference/pics-data-fields.md)
- [Steam Change Intelligence](../workers/steam-change-intelligence.md)
