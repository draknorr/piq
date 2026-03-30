# Troubleshooting Guide

Common issues and solutions for PublisherIQ.

**Last Updated:** March 30, 2026

## Database Connection Issues

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

### "Invalid API key"

**Cause:** Using wrong key type or malformed key.

**Solution:**

1. Use the **service_role** key, not anon key
2. Copy the complete key (starts with `eyJ`)
3. No extra whitespace or quotes

### "Connection refused"

**Cause:** Supabase project paused or URL incorrect.

**Solution:**

1. Check project is not paused in Supabase dashboard
2. Verify URL format: `https://xxx.supabase.co` (no trailing slash)
3. Check network connectivity

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

**Cause:** Cube.js schema mismatch or invalid filter.

**Solution:**

1. Expand Query Details panel to see the actual query
2. Check filter operators are valid (use `gte` not `>=`)
3. Verify cube names match schema (e.g., `Discovery`, not `discovery`)
4. Check Cube.js logs for detailed error

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

**Cause:** LLM API issues.

**Solution:**

1. Verify `LLM_PROVIDER` is set (`anthropic` or `openai`)
2. Check API key is valid
3. Check browser console for errors
4. Verify API has credit/quota

### "Query failed"

**Cause:** SQL validation blocked the query.

**Explanation:** The raw SQL tool path blocks certain operations for security:

- Only SELECT queries allowed
- Maximum 50 rows returned
- Maximum 5000 character query
- Blocked: INSERT, UPDATE, DELETE, DROP, etc.

**Solution:** Rephrase your question to use read-only operations, or use a structured chat prompt instead of forcing a raw SQL shape. Inspect `/admin` chat logs for the exact tool route and guardrail trace.

### "No results found"

**Cause:** Query returned empty results.

**Solution:**

1. Check if data exists for the query
2. Try broader search terms (ILIKE instead of exact match)
3. Verify table has data:
   ```sql
   SELECT COUNT(*) FROM apps;
   ```

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

---

## Qdrant / Similarity Search Issues

### "No similar games found"

**Cause:** Embeddings not synced or Qdrant connection issue.

**Solution:**

1. Check if embeddings have been generated:
   ```sql
   SELECT COUNT(*) FROM sync_status WHERE last_embedding_sync IS NOT NULL;
   ```
2. Verify Qdrant credentials in environment
3. Run embedding sync manually:
   ```bash
   pnpm --filter @publisheriq/ingestion embedding-sync
   ```

### Similarity Search Slow

**Cause:** Large Qdrant collection or complex filters.

**Solution:**

1. Ensure Qdrant collection has proper indexes
2. Reduce the `limit` parameter in queries
3. Use more specific filters to narrow search space

### "Embedding sync failed"

**Cause:** OpenAI API rate limit or Qdrant write error.

**Solution:**

1. Check OpenAI API quota
2. Verify Qdrant cluster is online
3. Check batch size in embedding worker
4. Review logs for specific error

---

## PICS Service Issues

### Service Keeps Restarting

**Cause:** Connection or configuration errors.

**Solution:**

1. Check Railway logs for error messages
2. Verify Supabase credentials
3. Ensure PICS tables exist in the database
4. Confirm the service mode is one of `bulk_sync`, `first_pass`, or `change_monitor`

### "Steam connection failed"

**Cause:** Steam PICS rate limiting or network issues.

**Solution:**

- The service auto-reconnects
- Wait a few minutes
- Check Steam status at steamstat.us

### Missing PICS Data

**Cause:** Bulk sync not completed.

**Solution:**

1. Run bulk sync first:
   ```
   MODE=bulk_sync python -m src.main
   ```
2. Wait for completion (~3 minutes)
3. Switch to change monitor:
   ```
   MODE=change_monitor python -m src.main
   ```

---

## GitHub Actions Issues

### Workflow Not Running

**Cause:** Actions disabled or secrets missing.

**Solution:**

1. Go to Actions tab, enable workflows
2. Check secrets are set (Settings > Secrets)
3. Verify cron syntax is correct

### "Secret not found"

**Cause:** Missing repository secret.

**Solution:**

1. Go to Settings > Secrets and variables > Actions
2. Add required secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `STEAM_API_KEY`

### Job Cancelled

**Cause:** Exceeded timeout or resource limits.

**Solution:**

1. Increase timeout in workflow file
2. Reduce batch size
3. Check for infinite loops in code

---

## Age-Gated Content

### Missing Developer/Publisher Data

**Cause:** Steam's Storefront API returns no data for age-gated (18+) content.

**Impact:** ~40-50 adult-rated games permanently missing developer/publisher info.

**Why It Happens:**

- Steam requires cookies/authentication to view mature content
- The API returns `success: false` without auth
- There is no public API to fetch this data

**Current Behavior:**

- Apps marked as `storefront_accessible = false`
- Excluded from future storefront sync
- Developer/publisher fields remain null

**Alternative Data Sources:**

- PICS service can provide: release date, name, categories, genres
- PICS cannot provide: developer names, publisher names
- SteamSpy has incomplete developer/publisher data

**Future Solutions (if needed):**

1. PICS fallback (provides 80% of missing data)
2. Cookie bypass (risky, may violate ToS)
3. HTML scraping (very risky)

---

## Performance Issues

### Slow Queries

**Solution:**

1. Check for missing indexes
2. Use EXPLAIN ANALYZE:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM apps WHERE name ILIKE '%test%';
   ```
3. Add index if needed

### High Memory Usage

**Solution:**

1. Reduce batch sizes
2. Process in smaller chunks
3. Check for memory leaks in workers

### Dashboard Slow

**Solution:**

1. Check browser network tab for slow requests
2. Enable Supabase connection pooling
3. Add pagination to large queries

---

## Authentication Issues (v2.1+)

### "Email not approved"

**Cause:** User email not on approved waitlist.

**Solution:**

1. Check waitlist status: `SELECT status FROM waitlist WHERE email = 'user@example.com';`
2. Admin approves via `/admin/waitlist`
3. User can then sign in

### OTP Code Not Working (v2.8+)

**Cause:** Invalid or expired OTP code.

**Solution:**

1. OTP codes are 8 digits (not 6)
2. Codes expire after 10 minutes
3. Check for typos - codes are case-insensitive
4. Request a new code if expired

**Rate Limiting:**

- After 3 failed attempts, wait 15 minutes
- Check spam folder for OTP emails
- Wait 60 seconds before requesting another code

### Token Refresh Loop (v2.8+)

**Symptoms:** Login page continuously refreshing or becoming unresponsive.

**Cause:** Stale authentication tokens in browser storage.

**Solution:**

1. Clear browser cookies for the site
2. Clear localStorage:
   ```javascript
   // In browser console
   localStorage.clear();
   ```
3. Hard refresh the page (Cmd+Shift+R / Ctrl+Shift+R)
4. Try incognito/private browsing mode

### Callback Link Expired

**Cause:** A fallback callback or confirm link was opened too late, or the redirect origin is misconfigured.

**Solution:**

1. Request a fresh code from `/login`
2. Verify `NEXT_PUBLIC_SITE_URL` matches the deployment hostname
3. If testing older links, clear stale cookies/local storage and retry

### "Insufficient credits"

**Cause:** User has 0 credit balance.

**Solution:**

1. Check balance: `SELECT credit_balance FROM user_profiles WHERE email = '...';`
2. Admin grants credits via `/admin/users`

### "Rate limit exceeded"

**Cause:** Too many requests per minute/hour.

**Solution:**

1. Wait for rate limit window to reset
2. Default limits: 20/minute, 200/hour
3. Check `rate_limit_state` table for current state

---

## Velocity Sync Issues (v2.1+)

### Velocity Not Updating

**Cause:** Materialized view not refreshed.

**Solution:**

```sql
SELECT refresh_review_velocity_stats();
```

Or run worker: `pnpm --filter @publisheriq/ingestion calculate-velocity`

### Games Stuck in Wrong Tier

**Cause:** Tier update function not run.

**Solution:**

```sql
SELECT update_review_velocity_tiers();
```

### Missing Velocity Data

**Cause:** No review deltas recorded yet.

**Solution:**

1. Run review sync to populate `review_deltas`
2. Run velocity calculation
3. Verify data: `SELECT COUNT(*) FROM review_deltas;`

### Interpolation Gaps

**Cause:** Interpolation worker not run or too few data points.

**Solution:**

```bash
# Run interpolation for last 30 days
pnpm --filter @publisheriq/ingestion interpolate-reviews

# Or inspect a single interpolation batch directly
source "$(git rev-parse --show-toplevel)/.env" && /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -c "SELECT * FROM interpolate_review_deltas_batch(CURRENT_DATE - 30, CURRENT_DATE, 0, 2000);"
```

---

## Page Loading Issues (v2.8+)

### Apps Page Sparklines Show Em-Dash (---)

**Symptoms:** Sparkline column displays `---` instead of trend charts.

**Cause:** Client-side Supabase RPC failing silently due to incorrect client pattern.

**Solution:**

1. Verify deployment includes commit `3c2dda3` or later
2. Check browser DevTools Network tab for `get_app_sparkline_data` requests
3. Verify requests return 200 status with data
4. If 401/403, check authentication state

**Technical Details:**

- Sparklines are fetched client-side via IntersectionObserver
- Failed RPC calls cache empty results (sticky failure)
- Page refresh clears the cache and retries

**Verification Query:**

```sql
-- Verify sparkline data exists
SELECT COUNT(*) FROM ccu_snapshots
WHERE recorded_at > NOW() - INTERVAL '7 days';
```

### Apps/Companies Page Timeout

**Symptoms:** Page takes >30 seconds to load or times out entirely.

**Cause:** Expensive query path triggered or incorrect Supabase client.

**Solution:**

1. Check if "vs Publisher" filter is active (triggers slow path)
2. Clear filters and try default view
3. Verify Server Component uses service role client
4. Check Supabase dashboard for slow queries

**Performance Expectations:**

- Fast path: ~200ms (most filters)
- Slow path: ~4s (vs_publisher filter or sort)

### Client-Side Data Not Loading

**Symptoms:** Interactive features (sparklines, filter counts) not populating.

**Cause:** Client hooks using incorrect Supabase client pattern.

**Solution:**

1. Ensure hooks use `createBrowserClient()` from `@supabase/ssr`
2. Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set
3. Check browser console for errors

**Correct Pattern:**

```typescript
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

---

## CCU Sync Issues (v2.2+)

### CCU Not Updating for Popular Games

**Cause:** Game may not be in Tier 1 or sync workflow not running.

**Solution:**

1. Check tier assignment:
   ```sql
   SELECT appid, ccu_tier, tier_reason, recent_peak_ccu
   FROM ccu_tier_assignments
   WHERE appid = 730;  -- Replace with your appid
   ```
2. Verify ccu-sync workflow is running (hourly at :00)
3. Check for games that should be Tier 1 but aren't:
   ```sql
   SELECT a.appid, a.name, dm.ccu
   FROM apps a
   JOIN daily_metrics dm ON a.appid = dm.appid
   LEFT JOIN ccu_tier_assignments cta ON a.appid = cta.appid
   WHERE dm.ccu > 10000
     AND (cta.ccu_tier IS NULL OR cta.ccu_tier > 1)
     AND dm.metric_date = CURRENT_DATE;
   ```

### Tier 1 Games Missing CCU

**Cause:** Steam API returning result code 42 (invalid appid).

**Solution:**

1. Verify game is still available on Steam
2. Check for API errors in ccu_snapshots:
   ```sql
   SELECT snapshot_time, player_count
   FROM ccu_snapshots
   WHERE appid = 12345
   ORDER BY snapshot_time DESC
   LIMIT 10;
   ```
3. Manually test Steam API:
   ```bash
   curl "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=730"
   ```

### Old CCU Snapshots Not Cleaning Up

**Cause:** CCU cleanup workflow not running (weekly Sunday 3 AM UTC).

**Solution:**

```bash
# Run cleanup manually
source .env && psql "$DATABASE_URL" -c "SELECT cleanup_old_ccu_snapshots();"
```

### CCU Source Shows 'steamspy' Instead of 'steam_api'

**Cause:** Game not polled by tiered CCU sync yet.

**Solution:**

1. Check if game is in any tier:
   ```sql
   SELECT ccu_tier FROM ccu_tier_assignments WHERE appid = 12345;
   ```
2. Games without a tier assignment get CCU from SteamSpy during daily sync
3. Force tier recalculation (runs daily at midnight UTC):
   ```sql
   SELECT recalculate_ccu_tiers();
   ```

### Tier Assignment Incorrect

**Cause:** Tier recalculation not run recently.

**Solution:**

1. Check last tier change:
   ```sql
   SELECT appid, ccu_tier, tier_reason, last_tier_change
   FROM ccu_tier_assignments
   WHERE appid = 12345;
   ```
2. Run tier recalculation:
   ```sql
   SELECT recalculate_ccu_tiers();
   ```

---

## Getting Help

If these solutions don't resolve your issue:

1. Check GitHub Issues for similar problems
2. Review logs for specific error messages
3. Open a new issue with:
   - Error message
   - Steps to reproduce
   - Environment details (OS, Node version)
   - Relevant log output

## Related Documentation

- [Running Workers](../developer-guide/workers/running-workers.md) - Manual sync execution
- [GitHub Actions](../developer-guide/deployment/github-actions.md) - Workflow configuration
- [Database Schema](../developer-guide/architecture/database-schema.md) - Table structure
