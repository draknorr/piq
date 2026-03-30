# Rate Limits Reference

Complete reference for all API rate limits in PublisherIQ.

**Last Updated:** March 30, 2026

## Summary Table

| API | Rate Limit | Effective Rate | Notes |
|-----|------------|----------------|-------|
| Steam App List | 100k/day | Unlimited | Single daily call sufficient |
| Steam Storefront | ~200/5min | 0.67/sec | Burst capacity 10 |
| Steam Reviews | ~60/min | 1/sec | Summary endpoint (v2.2) |
| Steam Histogram | ~60/min | 1/sec | Burst capacity 5 |
| Steam CCU | ~60/min | 1/sec | GetNumberOfCurrentPlayers (v2.2) |
| SteamSpy All | 1/60sec | 1/min | Paginated bulk fetch |
| SteamSpy Detail | 1/sec | 1/sec | Single app queries |

---

## Product Runtime Notes

### Chat Stream API

The authenticated chat runtime (`POST /api/chat/stream`) uses a database-backed rate-limit check before reserving credits.

- Over limit: returns HTTP `429` with JSON body `{ "error": "rate_limited" }`
- Retry guidance: includes `Retry-After` when the limiter reports a reset window
- Credit guardrail: returns HTTP `402` with `{ "error": "insufficient_credits" }` when the user cannot reserve the current default chat reservation

The current reservation default in code is `25` credits before finalize/refund billing.

For the full streaming contract, see [Streaming API](streaming-api.md).

---

## Steam Official APIs

### IStoreService API (App List)

**Rate Limit:** 100,000 requests/day

**Notes:**
- Each call returns up to 50,000 apps
- 4-5 calls fetch entire catalog
- One daily sync is sufficient

### Storefront API

**Rate Limit:** ~200 requests per 5 minutes

**Implementation:**
```typescript
const rateLimiter = new RateLimiter({
  tokensPerInterval: 10,   // Burst capacity
  interval: 30_000,        // 30 seconds
  maxTokens: 10
});
```

**Behavior:**
- Initial burst of 10 requests allowed
- Then ~0.67 requests/second
- Back off on 429 errors

### Reviews API

**Rate Limit:** ~60 requests per minute (v2.2: increased from ~20/min)

**Implementation:**
```typescript
const rateLimiter = new RateLimiter({
  tokensPerInterval: 5,
  interval: 5_000,
  maxTokens: 5
});
```

**Behavior:**
- Initial burst of 5 requests
- Then ~1 request/second
- Uses summary endpoint (`num_per_page=0`) for lightweight fetches

### Review Histogram API

**Rate Limit:** ~60 requests per minute

**Implementation:**
```typescript
const rateLimiter = new RateLimiter({
  tokensPerInterval: 5,
  interval: 5_000,
  maxTokens: 5
});
```

**Behavior:**
- Initial burst of 5 requests
- Then ~1 request/second

### CCU API (v2.2+)

**Rate Limit:** ~60 requests per minute

**Endpoint:** `ISteamUserStats/GetNumberOfCurrentPlayers/v1`

**Implementation:**
```typescript
const rateLimiter = new RateLimiter({
  tokensPerInterval: 1,
  interval: 1_000,
  maxTokens: 5
});
```

**Behavior:**
- Conservative 1 request/second
- No authentication required
- Returns exact current player count

**CCU Skip Tracking (v2.2):**
- Invalid appids (result: 42) are skipped for 30 days
- Tracked in `ccu_tier_assignments.ccu_skip_until`
- Reduces wasted API calls by 10-15%

---

## Third-Party APIs

### SteamSpy Bulk API

**Rate Limit:** 1 request per 60 seconds

**Endpoint:** `?request=all&page={n}`

**Notes:**
- Returns ~1000 apps per page
- Full catalog takes ~75 pages
- Total sync time: ~75 minutes

### SteamSpy Detail API

**Rate Limit:** 1 request per second

**Endpoint:** `?request=appdetails&appid={id}`

**Notes:**
- For individual app lookups
- Includes tag vote counts
- Use bulk API when possible

---

## Token Bucket Algorithm

PublisherIQ uses a token bucket rate limiter:

```typescript
class RateLimiter {
  tokensPerInterval: number;  // Tokens added per interval
  interval: number;           // Milliseconds between refills
  maxTokens: number;          // Maximum bucket size

  async acquire(): Promise<void> {
    // Blocks until token available
  }

  tryAcquire(): boolean {
    // Non-blocking, returns false if no tokens
  }
}
```

**How it works:**
1. Bucket starts full (`maxTokens`)
2. Each request consumes 1 token
3. Tokens refill at `tokensPerInterval` per `interval`
4. `acquire()` blocks if bucket is empty
5. Allows burst capacity up to `maxTokens`

---

## Daily Throughput Estimates

### With Current Rate Limits

| API | Rate | 24h Capacity | Notes |
|-----|------|--------------|-------|
| Storefront | 0.67/sec | ~58,000 | 5 runs × 10k each |
| Reviews | 1/sec | ~86,400 | v2.2: 2500 apps per batch |
| Histogram | 1/sec | ~86,400 | Full daily capacity |
| Steam CCU | 1/sec | ~86,400 | Tiered: ~1500 hourly, ~50k daily |
| SteamSpy | 1/min | ~1,400 | 75 pages × ~1000 apps |

### Sync Strategy

**Priority-based scheduling reduces load:**
- Active games (5k): Sync 5x/day
- Moderate games (15k): Sync daily
- Dormant games (30k): Sync weekly
- Dead games (20k): Sync monthly

**Result:** 2,000-5,000 API calls/day instead of 70,000

---

## Handling Rate Limit Errors

### Detection

```typescript
if (response.status === 429) {
  // Rate limited
  const retryAfter = response.headers.get('Retry-After');
  await sleep(retryAfter ? parseInt(retryAfter) * 1000 : 60_000);
}
```

### Retry Strategy

```typescript
const retryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30_000,
  backoffMultiplier: 2,
  retryableStatuses: [429, 500, 502, 503, 504]
};
```

### Circuit Breaker

After consecutive failures, skip the problematic source:

```typescript
if (consecutiveErrors > 5) {
  log.warn('Circuit breaker triggered, skipping source');
  return;
}
```

---

## Monitoring Rate Limits

### Check Current Usage

```sql
-- Recent sync job stats
SELECT job_type,
       items_processed,
       items_succeeded,
       items_failed,
       EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds
FROM sync_jobs
WHERE completed_at > NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;
```

### Identify Rate Limit Issues

```sql
-- Apps with consecutive errors (often rate limited)
SELECT appid, consecutive_errors, last_error_message
FROM sync_status
WHERE consecutive_errors > 0
  AND last_error_message LIKE '%429%'
ORDER BY consecutive_errors DESC
LIMIT 20;
```

---

## Best Practices

1. **Use priority scheduling** - Don't sync every app every day
2. **Respect rate limits** - Use token bucket, don't just sleep
3. **Handle 429s gracefully** - Back off exponentially
4. **Monitor error rates** - Track consecutive failures
5. **Batch where possible** - Use bulk APIs when available
6. **Cache immutable data** - Don't re-fetch release dates

## Related Documentation

- [Steam API](./steam-api.md) - Complete API reference
- [Sync Pipeline](../developer-guide/architecture/sync-pipeline.md) - Data flow
- [Troubleshooting](../admin-guide/troubleshooting.md) - Common issues
