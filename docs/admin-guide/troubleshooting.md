# Troubleshooting Guide

Common issues and solutions for PublisherIQ.

**Last Updated:** April 13, 2026

## Database and Query API Connection Issues

### "SUPABASE_URL is not defined"

**Cause:** Environment variable not set.

**Solution:**

```bash
# Check if set
echo $SUPABASE_URL

# Set in .env file
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

### "QUERY_API_BASE_URL must be set for Vercel preview and production deployments"

**Cause:** The deployed admin app is missing the explicit query-api base URL.

**Solution:**

1. Set `QUERY_API_BASE_URL` to the deployed Railway HTTPS endpoint.
2. Set `QUERY_API_BEARER_TOKEN` to the matching shared token.
3. Redeploy the admin app after updating the variables.

### "Invalid API key"

**Cause:** Using wrong key type or malformed key.

**Solution:**

1. Use the `service_role` key, not anon key
2. Copy the complete key (starts with `eyJ`)
3. No extra whitespace or quotes

### "Connection refused"

**Cause:** Supabase project paused, Tiger connection string invalid, or query-api cannot reach its Tiger target.

**Solution:**

1. Check the Supabase project is active
2. Verify the Supabase URL format: `https://xxx.supabase.co`
3. Verify the query-api has `TIGER_PRIMARY_URL` set
4. Check network connectivity and Railway logs

---

## Sync Worker Issues

### High Failure Rate

**Symptoms:** 30-50% of apps failing in storefront sync.

**Cause:** Many apps return `success: false` from Steam API.

**Explanation:** This is normal behavior. Apps return no data when:

- Age-gated (18+)
- Private or removed
- Region-locked
- Test apps

**Solution:** After first sync, the `storefront_accessible` flag prevents re-querying these apps. Future syncs should show near 0% skip rate.

### "Rate limited"

**Cause:** Too many API requests.

**Solution:**

1. Workers have built-in rate limiting - wait and retry
2. Reduce batch size if needed:
   ```bash
   BATCH_SIZE=100 pnpm --filter @publisheriq/ingestion storefront-sync
   ```
3. Check if multiple syncs running simultaneously

### Worker Timeouts

**Cause:** Operation taking longer than timeout.

**Solution:**

1. For GitHub Actions, increase timeout:
   ```yaml
   jobs:
     sync:
       timeout-minutes: 360 # 6 hours
   ```
2. Reduce batch size
3. Check for network issues

### "Consecutive errors" High

**Query to find problematic apps:**

```sql
SELECT appid, name, consecutive_errors, last_error_message
FROM sync_status s
JOIN apps a ON s.appid = a.appid
WHERE consecutive_errors > 3
ORDER BY consecutive_errors DESC
LIMIT 20;
```

**Solution:**

1. Review error messages
2. Reset error count for specific apps:
   ```sql
   UPDATE sync_status
   SET consecutive_errors = 0
   WHERE appid = 12345;
   ```

---

## Cube.js / Analytics Issues

### 502 Gateway Errors

**Cause:** Cube.js machine cold start or query timeout.

**Solution:**

1. The dashboard has built-in retry logic (3 retries with exponential backoff)
2. Ensure `min_machines_running = 1` in Fly.io config
3. Increase machine memory if queries are complex
4. Check Fly.io logs: `fly logs --app publisheriq-cube`

### "Query failed" in Chat

**Cause:** The request likely hit a query-api contract issue, a legacy fallback path, or a Cube.js schema mismatch depending on the route family.

**Solution:**

1. Expand Query Details panel to see the actual route, contract summary, and execution trace
2. Check whether the turn used the Tiger-backed query-api path or a legacy fallback
3. Verify cube names match schema when the failure is on a Cube-backed path
4. Check query-api logs and Cube logs for the corresponding backend

### Fly remote deploy fails before release

**Cause:** Fly remote builder transport regression or CLI incompatibility, not necessarily a Cube.js runtime failure.

**Symptoms:**

- `Failed to start remote builder heartbeat ... invalid port ... extendDeadline`
- `unable to upgrade to h2c, received 500`
- builder log `Handler for POST /grpc returned error: no upgrade proto in request`

**Solution:**

1. Run `scripts/ops/check-fly-cube.sh` to capture app status, checks, builder logs, and live Cube `/meta`.
2. If runtime checks pass but deploys fail, compare the active `flyctl` version against a known-good pinned version.
3. Use a pinned working CLI or `fly deploy --local-only` until Fly resolves the builder-path issue.
4. After deployment, verify live `/meta` exposes the expected cube fields before treating the rollout as complete.

See [docs/reports/fly-cube-deploy-investigation-2026-03-20.md](../reports/fly-cube-deploy-investigation-2026-03-20.md) for the March 20, 2026 incident details.

### Stale Data in Queries

**Cause:** Materialized views not refreshed.

**Solution:**

```sql
-- Refresh materialized views
REFRESH MATERIALIZED VIEW CONCURRENTLY publisher_metrics;
REFRESH MATERIALIZED VIEW CONCURRENTLY developer_metrics;
REFRESH MATERIALIZED VIEW CONCURRENTLY latest_daily_metrics;
```

---

## Chat Interface Issues

### "Chat not responding"

**Cause:** LLM API issues, missing query-api routing, or a backend contract failure.

**Solution:**

1. Verify `LLM_PROVIDER` is set (`anthropic` or `openai`)
2. Check API key is valid
3. Check browser console for errors
4. Verify `QUERY_API_BASE_URL` and `QUERY_API_BEARER_TOKEN` are set in deployed environments
5. Inspect the query details panel for the route family and execution trace

### "Query failed"

**Cause:** The active route could not satisfy the request.

**Explanation:** Some chat paths are now contract-driven rather than raw SQL, while others still use legacy Supabase or Cube paths. The failure mode depends on which path the turn used.

**Solution:** Rephrase the question to match a supported capability, or inspect `/admin` chat logs for the exact route and guardrail trace.

### "YouTube coverage is empty or unavailable"

**Cause:** The chat prompt routed to the YouTube coverage path, but the game is blocked, the Tiger data slice is not ready, or the feature flag is off in the deployed environment.

**Solution:**

1. Inspect `/admin` chat logs for `youtube_game_activity`, `getYoutubeGameCoverage`, and `/api/chat/youtube-coverage`
2. Confirm `CHAT_TIGER_YOUTUBE_ENABLED=true` where Tiger YouTube routing is expected
3. Check the query details panel for the normalized request and pagination state
4. Verify the mirrored Tiger tables have data before expecting a populated result set
5. If the route is blocked for a specific title, treat the result as an intentional guardrail rather than a failure

### "No results found"

**Cause:** Query returned empty results.

**Solution:**

1. Check if data exists for the query
2. Try broader search terms
3. Verify the relevant table or contract surface has data

---

## Build Issues

### "Module not found"

**Cause:** Packages not built or dependencies missing.

**Solution:**

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Or build specific package
pnpm --filter @publisheriq/database build
```

### Type Errors

**Cause:** Database types out of sync.

**Solution:**

```bash
# Regenerate types from Supabase
pnpm --filter @publisheriq/database generate-types

# Rebuild
pnpm build
```

### "Cannot find module @publisheriq/..."

**Cause:** Workspace packages not linked.

**Solution:**

```bash
# Clean install
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm build
```
