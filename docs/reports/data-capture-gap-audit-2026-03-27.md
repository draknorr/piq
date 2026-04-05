# Data Capture Gap Audit

Generated: March 27, 2026

Companion execution checklist: [Data Capture Gap Remediation Checklist](./data-capture-gap-remediation-checklist-2026-03-28.md)

## Summary

This audit uses the production database as the persisted source of truth, then compares it to live Steam endpoints and the implemented ingestion code paths. The highest-risk issues are not simple freshness gaps. They are:

1. SteamSpy is overwriting official review counts in `daily_metrics`, which creates materially wrong review totals.
2. SteamSpy coverage and owner estimates are incomplete or low-fidelity for many major games.
3. PICS has a first-pass capture gap for newly discovered games, including already released titles.
4. News capture still has structural holes after the March backlog cleanup.
5. Change media tracks screenshot and trailer URL changes, but does not preserve screenshot or trailer assets.
6. Review capacity is being spent on future-dated zero-review games.
7. The master app list is drifting in both directions: stale rows retained in DB, plus a smaller set of current Steam appids missing from DB.

## Method

- Read-only SQL against production Postgres.
- Code inspection of workers, queue logic, and workflow schedules.
- Live endpoint spot checks against:
  - `IStoreService/GetAppList`
  - Storefront `appdetails`
  - Storefront `appreviews`
  - Storefront `appreviewhistogram`
  - `ISteamNews/GetNewsForApp`
  - `ISteamUserStats/GetNumberOfCurrentPlayers`
  - SteamSpy `appdetails`
- Audit date fixed at March 27, 2026.

## Source Snapshot

| Surface | Implemented cadence / limit | Current DB picture | Main issue |
| --- | --- | --- | --- |
| Master app list | Daily at `00:15 UTC` via `.github/workflows/applist-sync.yml` | `166,911` DB apps vs `150,512` live `GetAppList` appids | Bidirectional drift plus stuck applist jobs |
| Storefront | Every 30 min, 6 partitions, `800` each | `166,896 / 166,902` ever synced | Broadly healthy; downstream news/media gaps remain |
| Reviews | Hourly, `2500` apps/run with lane quotas | `166,902 / 166,902` ever synced, `40,114` in last day | Capacity is focused, but dormant titles drift badly |
| Histogram | Every 30 min, `2000` apps/run | `166,902 / 166,902` ever synced, `18,976` in last day | Much healthier than reviews; not a primary risk |
| SteamSpy | Daily, `all` endpoint plus `SUPPLEMENTARY_LIMIT=100` | `85,827 / 166,902` ever synced | Coverage and fidelity are both weak |
| PICS | Railway change monitor + bulk sync | `163,113 / 166,902` ever synced | First-pass capture gap on newly discovered games |
| News | Queue-driven from change-intel worker | `108,067 / 166,902` ever synced | Backlog and enqueue holes still exist |
| Media / hero assets | Queue-driven from change-intel worker | `166,183 / 166,902` have `last_media_sync` | URL diffs recorded; only hero assets archived |
| CCU | Hourly tier 1/2 plus 6x daily tier 3 | `69,584` appids with snapshots in last day, `121,003` in last 7 days | Zero handling and invalid-app skip logic are material |

## Confirmed Findings

### P0: SteamSpy contaminates review truth

`packages/ingestion/src/workers/steamspy-worker.ts` still writes `positive_reviews`, `negative_reviews`, and `total_reviews` into `daily_metrics`. That means any app where SteamSpy ran more recently than the official reviews worker can carry SteamSpy review counts as if they were authoritative.

Evidence:

- `34,451` appids have `last_steamspy_sync` at least 7 days newer than `last_reviews_sync`.
- `236` of those are games with `1,000+` reviews in `latest_daily_metrics`.
- Live spot checks:
  - `appid 388520` (`Call of Duty®: Black Ops III`):
    - Live Reviews API: `6,349` total reviews
    - DB latest row: `62,347`
    - SteamSpy live: `38,969 positive / 23,378 negative`
  - `appid 418500` (`Rising Storm 2: Vietnam`):
    - Live Reviews API: `12` total reviews
    - DB latest row: `27,254`
    - SteamSpy live: `21,844 positive / 5,410 negative`
- Both examples have fresh SteamSpy syncs on March 27, 2026 and stale `last_reviews_sync` values from January 2026.

Impact:

- Review totals, review sentiment, and any downstream velocity/trend work can be wrong even when `daily_metrics` looks fresh.
- The issue is systemic, not incidental.

Recommended fix:

1. Stop SteamSpy from writing official review fields at all.
2. Treat the Steam Reviews API as the only source for `positive_reviews`, `negative_reviews`, `total_reviews`, `review_score`, and `review_score_desc`.
3. Backfill the `34,451` at-risk rows, starting with the `236` games with `1,000+` reviews.

### P0: SteamSpy owner coverage is incomplete and often misleading

SteamSpy is missing many important games entirely, and for many others it returns trivial owner ranges that are not decision-useful.

Evidence:

- Only `85,827 / 166,902` apps have any SteamSpy sync.
- For games actually released in the last 30 days, only `74 / 2,516` have SteamSpy data.
- `98` games with `10,000+` reviews have `owners_min IS NULL`.
- `183` games with `10,000+` reviews have `owners_max <= 20,000`.
- Examples from `latest_daily_metrics`:
  - `Overwatch®` (`2357570`): `389,993` reviews, owners missing in DB, SteamSpy appdetails returns `0 .. 20,000`
  - `THE FINALS` (`2073850`): `263,171` reviews, owners missing in DB, SteamSpy appdetails returns `0 .. 20,000`
  - `Marvel Rivals` (`2767030`): `377,348` reviews, DB owners `0 .. 20,000`

Impact:

- Owner-based ranking, TAM sizing, and portfolio comparisons are materially wrong or absent for high-importance games.

Recommended fix:

1. Treat SteamSpy availability and quality separately.
2. Mark obviously useless owner bands like `0 .. 20,000` as low-confidence instead of first-class truth.
3. Consider a null-with-confidence model rather than writing misleading low ranges.

### P1: PICS misses first-pass capture for newly discovered games

PICS coverage is not simply “stale.” Some games never get their first PICS capture at all.

Evidence:

- `3,789` apps have `last_pics_sync IS NULL`.
- `1,015` games actually released in the last 30 days still have `last_pics_sync IS NULL`.
- `1,015 / 1,015` of those released games do have storefront sync, so the problem is not discovery in general.
- Live example: `appid 4433960` (`The Beyond`)
  - Live storefront has `11` categories, `4` genres, `6` screenshots, developer/publisher data, and a future release date.
  - DB has:
    - `last_pics_sync = NULL`
    - blank `platforms`
    - null `store_asset_mtime`
    - zero rows in `app_steam_tags`, `app_genres`, `app_categories`, and `app_steam_deck`
- PICS service design explains the gap:
  - change monitor is change-driven
  - bulk sync resumes only unsynced DB appids
  - there is no explicit “new app discovered, force PICS first pass now” queue

Impact:

- Tags, genres, categories, Steam Deck status, controller/platform metadata, and some asset timestamps are missing on a meaningful set of fresh games.

Recommended fix:

1. Add a first-pass PICS queue seeded from newly discovered appids.
2. Prioritize released or near-release games ahead of the long tail.
3. Backfill the current `3,789` unsynced rows, with the released subset first.

### P1: News capture still has structural holes

News is not just behind. There are cases where storefront capture happened and no durable news capture followed.

Evidence:

- `58,835` apps still have `last_news_sync IS NULL`.
- In the last day alone, `65` apps have fresh storefront sync but still `last_news_sync IS NULL`.
- Of those `65`, none had an active queued or claimed news job at query time.
- `27` of those `65` already had `news` dead-letter history.
- Dead-letter totals currently in `app_capture_queue`:
  - `news`: `44`
  - `storefront`: `12`
  - `hero_asset`: `30`
- Example: `appid 1695792` (`Halo 4 Mod Tools - MCC`)
  - `last_storefront_sync` is fresh
  - `last_news_sync` is null
  - queue history shows a `dead_letter` news attempt on March 26, 2026
  - live `ISteamNews/GetNewsForApp` returns HTTP `403` and `{}` for this app
- Some null-news rows are transient in-flight work, but not all:
  - `appid 1812390` had a fresh claimed news job during the audit
  - the dead-letter cases are not transient

Impact:

- News coverage is inconsistent, and `last_news_sync = NULL` mixes together migration debt, active in-flight work, and permanent source-side failures.

Recommended fix:

1. Separate “source-side permanent failure” from generic dead-letter state.
2. Add a catch-up sweep for storefront-synced apps with `last_news_sync IS NULL` and no queue history.
3. Persist a terminal “news unavailable / source rejected” state when Steam returns hard 403s.

### P1: Master app list is drifting in both directions

The master catalog is not aligned with the current live Steam app list.

Evidence:

- Live `GetAppList` total on March 27, 2026: `150,512`
- DB `apps` total: `166,911`
- Exact diff:
  - `16,694` DB appids are not in live `GetAppList`
  - `295` live appids are not in DB
- DB-only samples include old and delisted rows such as:
  - `1000040` `细胞战争`
  - `1000370` `SurReal Subway`
  - `1000800` `Beetle Elf`
- Live-only samples are valid current store rows not yet present in DB:
  - `1771320` `Project XZ`
  - `2067210` `Serious Sam: Shatterverse`
  - `2141160` `Alien Deathstorm`
- Recent applist jobs:
  - March 25 completed
  - March 26 and March 27 are both still marked `running`
  - `sync_jobs` contains `2` stuck applist runs

Impact:

- Discovery lag exists in the forward direction.
- Historical retention is also inflating the catalog and downstream queues.

Recommended fix:

1. Fix applist job completion / stale-running-job cleanup first.
2. Decide on a retention policy for DB rows no longer present in `GetAppList`.
3. Report both “current catalog” and “historical catalog” separately if retention is intentional.

### P1: Change screenshots are tracked as URLs, not preserved as assets

The media pipeline does detect screenshot and trailer changes, but it does not archive screenshot or trailer binaries.

Evidence:

- `app_media_versions` rows:
  - total: `257,347`
  - with screenshot arrays: `256,709`
  - with trailer arrays: `237,380`
- `app_change_events` counts:
  - `screenshot_added`: `15,294`
  - `screenshot_removed`: `15,270`
  - `trailer_added`: `2,162`
  - `trailer_removed`: `2,061`
  - `background_url_changed`: `14,986`
- Archived asset rows:
  - `header`: `81,983`
  - `capsule`: `81,970`
  - `background`: `169`
- Current code path:
  - `packages/ingestion/src/change-intel/storefront.ts` records screenshot and trailer diffs
  - `packages/ingestion/src/change-intel/hero-archive.ts` archives only `header` and `capsule`
  - `collectChangedHeroAssets()` ignores background-only changes

Impact:

- Historical screenshot and trailer changes can only be reconstructed from URLs while those URLs remain valid.
- Background changes are not treated consistently with header/capsule changes.

Recommended fix:

1. Decide whether screenshots and trailers need full archival or URL-only history is acceptable.
2. If archival is required, add storage policy and download budget for screenshots and trailer thumbnails.
3. Make background handling explicit: either archive it or remove the misleading partial support.

### P2: Review sync is spending capacity on future-dated zero-review games

The reviews system is effectively sweeping upcoming or placeholder-dated games even when they have no reviews.

Evidence:

- Future-dated games (`release_date > CURRENT_DATE`): `5,710`
- Future-dated games with zero reviews in `latest_daily_metrics`: `5,709`
- Future-dated zero-review games synced by reviews in the last 7 days: `5,233`
- All `5,710` future-dated games are on `review_velocity_tier = dormant` and `reviews_interval_hours = 72`
- Sample rows include absurd placeholder dates like:
  - `9998-12-31`
  - `9000-05-29`
  - `6969-06-09`

Impact:

- Official review capacity is being burned on games that are very unlikely to change.
- This directly competes with stale legacy titles and any deeper backfill work.

Recommended fix:

1. Exclude future-dated zero-review games from normal review cadence.
2. Only re-enable them near release windows or after first non-zero review evidence.
3. Clamp placeholder future dates out of “recent release” logic.

### P2: CCU coverage is broad, but zero handling drives data quality

CCU is being collected at large scale, but the meaning of a zero is often uncertain.

Evidence:

- `127,547` appids are assigned to CCU tiers.
- `69,584` appids have a CCU snapshot in the last day.
- `121,003` appids have a CCU snapshot in the last 7 days.
- Current tier-assignment state:
  - `4,415` `invalid`
  - `4,058` currently skipped via `ccu_skip_until`
  - `2,535` still `pending`
- Today’s `daily_metrics` rows:
  - `22,526` with positive `ccu_peak`
  - `77,016` with `ccu_peak = 0`
  - `10,875` with `ccu_peak IS NULL`
- Zero rows that are plausibly suspicious:
  - `4,251` are recent releases in the last 180 days
  - `637` belong to games with `1,000+` reviews
  - `20,640` belong to appids that had a positive CCU snapshot in the last 30 days

Impact:

- A large share of the “captured” CCU surface depends on whether suspicious zeros are rechecked correctly.

Recommended fix:

1. Keep suspicious-zero rechecks, but persist explicit confirmation outcomes.
2. Surface confidence state in downstream analytics instead of treating all zeros equally.
3. Review whether the 30-day suspicious-zero window is too broad for dormant titles.

### P2: Some metadata remains sparse even after PICS sync

Even among games with non-null `last_pics_sync`, several fields remain mostly empty.

Evidence for games with `last_pics_sync IS NOT NULL`:

- `118,395` still have `store_asset_mtime IS NULL`
- `17,265` still have `platforms IS NULL`
- `105,247` still have `controller_support IS NULL`

Related relationship gaps after storefront sync:

- `708` synced games still have no developer relation
- `1,195` synced games still have no publisher relation
- `612` synced games still have `has_developer_info != true`

Impact:

- Some “captured” apps still do not have useful platform/controller/relationship metadata.

Recommended fix:

1. Separate “source truly omitted the field” from “parser/upsert did not populate it.”
2. Audit platform/controller/relationship writes for synced games only.
3. Decide which fields should fall back to storefront and which should stay PICS-only.

## Priority Order

### P0

1. Stop SteamSpy from writing review totals.
2. Backfill authoritative review counts for rows where SteamSpy is newer than Reviews.
3. Reclassify low-confidence SteamSpy owner ranges instead of storing them as normal truth.

### P1

1. Add first-pass PICS capture for new appids.
2. Fix applist stale-running jobs and reconcile live-only appids.
3. Repair news enqueue / dead-letter handling for fresh storefront apps.
4. Decide whether screenshot and background asset preservation is a product requirement.

### P2

1. Remove future-dated zero-review games from routine review churn.
2. Improve CCU zero confidence modeling.
3. Clean up sparse metadata and synced-but-empty relationship gaps.

## Files and Workflows That Explain These Results

- `packages/ingestion/src/workers/steamspy-worker.ts`
- `packages/ingestion/src/workers/reviews-worker.ts`
- `packages/ingestion/src/workers/app-change-hints-worker.ts`
- `packages/ingestion/src/workers/change-intel-worker.ts`
- `packages/ingestion/src/workers-support/change-intel.ts`
- `packages/ingestion/src/change-intel/storefront.ts`
- `packages/ingestion/src/change-intel/hero-archive.ts`
- `services/pics-service/src/workers/change_monitor.py`
- `services/pics-service/src/workers/bulk_sync.py`
- `.github/workflows/applist-sync.yml`
- `.github/workflows/storefront-sync.yml`
- `.github/workflows/reviews-sync.yml`
- `.github/workflows/histogram-sync.yml`
- `.github/workflows/steamspy-sync.yml`
- `.github/workflows/ccu-sync.yml`
- `.github/workflows/ccu-daily-sync.yml`
