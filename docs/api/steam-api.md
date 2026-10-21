# Steam API Endpoints Reference

Complete reference for all Steam APIs used by PublisherIQ.

## Official Steam APIs

### Steam IStoreService API (App List)

**Purpose:** Get complete list of all Steam apps

**Endpoint:**
```
GET https://api.steampowered.com/IStoreService/GetAppList/v1/
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | Steam API key |
| `include_games` | boolean | No | Include games (default: false) |
| `include_dlc` | boolean | No | Include DLC (default: false) |
| `include_software` | boolean | No | Include software (default: false) |
| `include_videos` | boolean | No | Include videos (default: false) |
| `include_hardware` | boolean | No | Include hardware (default: false) |
| `max_results` | int | No | Max items per page (up to 50,000) |
| `last_appid` | int | No | Pagination cursor |

**Example Request:**
```
https://api.steampowered.com/IStoreService/GetAppList/v1/?key=YOUR_KEY&include_games=true&max_results=50000
```

**Response:**
```json
{
  "response": {
    "apps": [
      {
        "appid": 730,
        "name": "Counter-Strike 2",
        "last_modified": 1703980800,
        "price_change_number": 12345
      }
    ],
    "have_more_results": true,
    "last_appid": 12345
  }
}
```

**Rate Limit:** 100,000 requests/day

---

### Steam Storefront API

**Purpose:** Get detailed app metadata

**Endpoint:**
```
GET https://store.steampowered.com/api/appdetails/
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appids` | string | Yes | App ID(s), comma-separated |
| `cc` | string | No | Country code (default: US) |
| `l` | string | No | Language (default: english) |

**Example Request:**
```
https://store.steampowered.com/api/appdetails/?appids=730
```

**Response:**
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
      "developers": ["Valve"],
      "publishers": ["Valve"],
      "price_overview": {
        "currency": "USD",
        "initial": 0,
        "final": 0,
        "discount_percent": 0,
        "initial_formatted": "",
        "final_formatted": "Free"
      },
      "platforms": {
        "windows": true,
        "mac": true,
        "linux": true
      },
      "categories": [
        {"id": 1, "description": "Multi-player"},
        {"id": 30, "description": "Steam Workshop"}
      ],
      "genres": [
        {"id": "1", "description": "Action"},
        {"id": "37", "description": "Free to Play"}
      ],
      "release_date": {
        "coming_soon": false,
        "date": "Aug 21, 2012"
      }
    }
  }
}
```

**Rate Limit:** ~200 requests per 5 minutes

**Notes:**
- Returns `success: false` for age-gated, private, or removed apps
- Developers/publishers arrays are AUTHORITATIVE source
- Check `categories` for Workshop support (id: 30)

---

### Steam Reviews API

**Purpose:** Get lifetime review counts and sentiment.

Valve [announced](https://steamcommunity.com/groups/steamworks/announcements/detail/676258795703241581) retirement of `/appreviews` on October 22, 2026. The replacement is documented in [IUserReviewsService](https://partner.steamgames.com/doc/webapi/IUserReviewsService).

**Endpoint:**
```text
GET https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/
```

Send the following object as the URL-encoded `input_json` query parameter:

```json
{
  "appid": 730,
  "filter": 0,
  "languages": ["all"],
  "review_type": 0,
  "purchase_type": 1,
  "num_per_page": 1
}
```

`filter=0` (Helpful) preserves the old `filter=all`. Review type 0 and purchase type 1 include both vote types and all purchase types. The first page supplies lifetime summary counts. The existing defaults remain: off-topic activity excluded, English score description, Helpful day range 30, and no date/playtime/hardware restriction. Zero page size returns the default 20 reviews in live probes; one minimizes the payload. Review text is discarded.

**Response fields used by the collector:**
```json
{
  "response": {
    "query_summary": {
      "num_reviews": 1,
      "review_score": 8,
      "review_score_desc": "Very Positive",
      "total_positive": 4500000,
      "total_negative": 500000,
      "total_reviews": 5000000
    }
  }
}
```

The replacement has no `success` field: check HTTP status and validate the wrapped summary. Read counts from `query_summary`, not page size or `total_matching`. Missing, null, inconsistent, negative, or noninteger counts and missing/invalid scores are failed observations. Explicit zero counts and score zero are valid. Failures retain successful metrics and `last_reviews_sync`; existing failure metadata and retry scheduling still update.

**Production callers:** `packages/ingestion/src/workers/reviews-worker.ts` via `.github/workflows/reviews-sync.yml`, plus the operator-only `repair-review-truth` script. Both call `fetchReviewSummary`. Histogram collection uses a separate Store endpoint and is unchanged.

**Authentication and capacity:** No key is required. Valve documents a lower shared rate limit for requests without an app-associated publisher key, but publishes no numeric threshold; anonymous results may be cached for ten minutes. A generic `STEAM_API_KEY` does not establish higher access across the catalog. The adapter adds no credential requirement. Existing local/shared one-attempt-per-second limits, retries, Retry-After handling, 403 stop, 429 circuit, and timeouts remain.

The [Web API terms](https://steamcommunity.com/dev/apiterms) specify 100,000 calls/day. A read-only production audit at 2026-10-21 00:35 UTC found 106,502 successful CCU observations and 9,198 review attempts across five completed review jobs in the preceding 24 hours; running jobs and CCU retries are excluded. The user confirmed no known higher allowance. This is a concrete application-wide capacity risk: changing hosts or adding an unassociated key does not resolve it. Preserving all existing workload requires a verified larger allowance or a separately approved allocation plan. This compatibility release does not alter other collectors or reduce review coverage/freshness.

**Compatibility release and rollback (prepared, not deployed):**

- Baseline: `27bea88dac3d85fa7aa95a46befe705754b645b8` on `main`. Release only the review adapter, its API/worker tests, the persistence failure regression, and this documentation. Keep the dirty workspace's workflow, UI, schema, and other changes out.
- Preserve the hourly `37 * * * *` schedule, 3,000-app cap, 50-minute runtime, single concurrency, shared token bucket, claim lanes, and Tiger storage. Actual GitHub dispatches were delayed to roughly 3–5-hour intervals in the baseline; this change does not repair scheduler delays.
- Before any production run, obtain the explicit production-write approval required by `CLAUDE.md` and record the capacity decision. The bounded canary is the existing workflow on the release branch with `batch_size=10`. It writes normal claim/rate-token/job state in `ops`, review deltas and daily metrics in `metrics`, and `legacy.latest_daily_metrics`. Risk: medium, because provider limits remain unquantified and valid summaries update current review truth. There is no migration, replay, new collector, or repair-script invocation.
- Canary acceptance: all attempted observations persist successfully, no 403/429/invalid summaries, coherent totals/votes/scores in the existing tables, advancing successful timestamps, no abandoned claims. Use the exact GitHub run ID to correlate `ops.sync_jobs`, workflow logs, and bounded row reads. On a failed response, verify prior successful values/timestamps are retained rather than replaced with zero.
- After approval and successful canary/required checks, merge only the scoped release. Observe a naturally scheduled run at the merged SHA, correlate its completed job and persisted rows, and compare throughput/failure telemetry with the baseline (1,579–2,280 successes/run, 0.526–0.760 attempts/second, no 403/429). A manual run alone does not verify scheduled operation. Continued capacity/freshness acceptance needs the normal observation window; a handful of successful probes is insufficient.
- Roll back by reverting the scoped commit or running the baseline revision before October 22, only if the old endpoint still responds. After retirement, the old endpoint is not a viable fallback: disable only `reviews-sync.yml` and stop an affected in-flight review run if necessary, retaining collected data and allowing normal claim expiry. Do not disable the shared metrics gate, delete observations, or silently fall back to zero. Resume after the forward fix and explicit approval. No database rollback/migration is needed; correcting any proven bad observations would require a separately reviewed repair.

Local verification on October 20: build, type checks, lint (existing warnings), 23 API/worker tests and six review-persistence tests passed. Six paced read-only endpoint probes covered a large game, demo, and genuine zero-review app. Counts were coherent and scores agreed; active counts differed slightly across cached/live responses, so this is contract compatibility evidence, not exact simultaneous equality or sustained-capacity proof. Production persistence and replacement-endpoint scheduled operation remain unverified until rollout.

---

### Steam Review Histogram API

**Purpose:** Get monthly review aggregates

**Endpoint:**
```
GET https://store.steampowered.com/appreviewhistogram/{appid}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `l` | string | No | Language (default: english) |

**Example Request:**
```
https://store.steampowered.com/appreviewhistogram/730?l=english
```

**Response:**
```json
{
  "success": 1,
  "results": {
    "start_date": 1577836800,
    "end_date": 1703980800,
    "weeks": [],
    "recent_events": [],
    "rollups": [
      {
        "date": 1577836800,
        "recommendations_up": 125000,
        "recommendations_down": 8500
      },
      {
        "date": 1580515200,
        "recommendations_up": 98000,
        "recommendations_down": 6200
      }
    ],
    "rollup_type": "month"
  }
}
```

**Rate Limit:** ~60 requests per minute

---

## Third-Party APIs

### SteamSpy API

**Purpose:** Get player counts, owner estimates, tags

**Base URL:** `https://steamspy.com/api.php`

#### All Apps (Paginated)

**Endpoint:**
```
GET https://steamspy.com/api.php?request=all&page={page}
```

**Response:**
```json
{
  "730": {
    "appid": 730,
    "name": "Counter-Strike 2",
    "developer": "Valve",
    "publisher": "Valve",
    "score_rank": "",
    "positive": 4500000,
    "negative": 500000,
    "userscore": 0,
    "owners": "50,000,000 .. 100,000,000",
    "average_forever": 35000,
    "average_2weeks": 1200,
    "median_forever": 15000,
    "median_2weeks": 800,
    "ccu": 850000,
    "price": "0"
  }
}
```

**Rate Limit:** 1 request per 60 seconds

#### App Details

**Endpoint:**
```
GET https://steamspy.com/api.php?request=appdetails&appid={appid}
```

**Response:**
```json
{
  "appid": 730,
  "name": "Counter-Strike 2",
  "developer": "Valve",
  "publisher": "Valve",
  "owners": "50,000,000 .. 100,000,000",
  "ccu": 850000,
  "average_forever": 35000,
  "average_2weeks": 1200,
  "tags": {
    "FPS": 12000,
    "Shooter": 11500,
    "Multiplayer": 10000,
    "Action": 9500,
    "Competitive": 8000
  }
}
```

**Rate Limit:** 1 request per second

**Notes:**
- Developer/publisher fields have gaps - use Steam Storefront API instead
- Owner estimates are ranges, not exact numbers
- Tags include vote counts

---

## Error Handling

### Common HTTP Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad request | Check parameters |
| 401 | Unauthorized | Check API key |
| 403 | Forbidden | Rate limited or blocked |
| 404 | Not found | App doesn't exist |
| 429 | Too many requests | Wait and retry |
| 500 | Server error | Retry with backoff |
| 503 | Service unavailable | Wait and retry |

### Retry Strategy

```typescript
const retryConfig = {
  maxRetries: 3,
  initialDelay: 1000,     // 1 second
  maxDelay: 30000,        // 30 seconds
  backoffMultiplier: 2    // Exponential backoff
};
```

## Related Documentation

- [Rate Limits](./rate-limits.md) - Detailed rate limit reference
- [Data Sources](../developer-guide/architecture/data-sources.md) - Source hierarchy
- [Sync Pipeline](../developer-guide/architecture/sync-pipeline.md) - How data flows
