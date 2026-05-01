# GitHub Actions Configuration

PublisherIQ uses GitHub Actions for scheduled data sync jobs. This guide covers setup and configuration.

Current state: accepted incoming ingestion and product-data writer paths use Tiger/R2 where the workflow sets `DATA_WRITE_TARGET=tiger`, `CHANGE_INTEL_WRITE_TARGET=tiger`, or a PICS Tiger target. Supabase is still retained for auth/session/reference data, legacy reads, and product surfaces that have not been proven Tiger-backed.

## Prerequisites

- Repository pushed to GitHub
- Tiger production/preview connection strings
- Supabase source/reference credentials for retained legacy or parity workflows
- Steam API key

## Quick Start

### 1. Add Repository Secrets

Go to **Settings > Secrets and variables > Actions > New repository secret**:

| Secret                                    | Value                                              |
| ----------------------------------------- | -------------------------------------------------- |
| `STEAM_API_KEY`                           | Your Steam API key                                 |
| `YOUTUBE_API_KEY`                         | YouTube Data API key for the YouTube collector     |
| `DATABASE_URL`                            | Live Supabase Postgres source/reference URL        |
| `TIGER_PRODUCTION_URL`                    | Production TigerData / Timescale connection string |
| `TIGER_PREVIEW_URL`                       | Preview TigerData / Timescale connection string    |
| `QDRANT_URL`                              | Qdrant URL for embedding sync                      |
| `QDRANT_API_KEY`                          | Qdrant API key for embedding sync                  |
| `OPENAI_API_KEY`                          | OpenAI key for embedding generation                |
| `CHANGE_INTEL_ARCHIVE_ENDPOINT`           | Cloudflare R2/S3-compatible endpoint               |
| `CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID`      | R2/S3 access key                                   |
| `CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY`  | R2/S3 secret key                                   |

Only keep `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` on workflows that are still explicitly legacy Supabase writers or approved auth/reference paths. Tiger writer workflows should not hold Supabase service-role credentials unless `SUPABASE_SERVICE_CLIENT_PURPOSE` is set to an approved non-product-write purpose.

Repository variables gate scheduled writers:

| Variable | Meaning |
| -------- | ------- |
| `ENABLE_TIGER_CATALOG_WRITERS=true` | Allows scheduled catalog/storefront/app-list Tiger writers. Manual dispatch still works without this variable. |
| `ENABLE_TIGER_METRICS_WRITERS=true` | Allows scheduled reviews, price, SteamSpy, CCU, trends, velocity, interpolation, and priority Tiger writers. |
| `ENABLE_TIGER_EMBEDDING_WRITER=true` | Allows scheduled embedding writer. Manual dispatch is the preferred smoke path. |
| `ENABLE_LEGACY_SUPABASE_WRITERS=true` | Allows explicitly legacy Supabase writer workflows such as old view refresh/cleanup repair jobs. Keep off unless there is an approved legacy operation. |

### 2. Enable Actions

1. Go to **Actions** tab
2. Click **I understand my workflows, go ahead and enable them**

### 3. Verify Workflows

Workflows should appear in the Actions tab. You can manually trigger any workflow to test.

## Workflow Schedule

All times are UTC:

| Workflow                | File                          | Schedule                       | Purpose                                    |
| ----------------------- | ----------------------------- | ------------------------------ | ------------------------------------------ |
| App List Sync           | `applist-sync.yml`            | 00:15 daily                    | Master app list, Tiger writer gated by `ENABLE_TIGER_CATALOG_WRITERS` |
| App Change Hints        | `app-change-hints.yml`        | :10 hourly                     | Steam changed-app hints into Tiger queue state |
| Storefront Sync         | `storefront-sync.yml`         | :00 every 2h                   | Storefront latest state and change-intel archives into Tiger/R2, gated by `ENABLE_TIGER_CATALOG_WRITERS` |
| Steam News Hot Refresh  | `news-hot-refresh.yml`        | every 10 minutes               | Hot news queue refresh into Tiger/R2 |
| SteamSpy Sync           | `steamspy-sync.yml`           | 02:15 daily                    | Owners, playtime, tags, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Embedding Sync          | `embedding-sync.yml`          | 03:00 daily                    | Embeddings, Tiger status writer gated by `ENABLE_TIGER_EMBEDDING_WRITER` |
| Histogram Sync          | `histogram-sync.yml`          | 04:15 daily                    | Monthly reviews, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Reviews Sync            | `reviews-sync.yml`            | :15 every 2h                   | Review counts, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Price Sync              | `price-sync.yml`              | 00:15, 06:15, 12:15, 18:15     | Price tracking, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Trends Calculation      | `trends-calculation.yml`      | 22:00 daily                    | Trend metrics, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Priority Calculation    | `priority-calculation.yml`    | 22:30 daily                    | Priority scores, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Velocity Calculation    | `velocity-calculation.yml`    | 08,16,00:00                    | Velocity stats, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Interpolation           | `interpolation.yml`           | 05:00 daily                    | Fill metric gaps, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| Refresh Views           | `refresh-views.yml`           | 05:00 daily                    | Legacy Supabase materialized view refresh, gated by `ENABLE_LEGACY_SUPABASE_WRITERS` |
| Refresh App Filter Data | `refresh-app-filter-data.yml` | 00,06,12,18:00                 | Legacy `app_filter_data` refresh, gated by `ENABLE_LEGACY_SUPABASE_WRITERS` |
| CCU Sync                | `ccu-sync.yml`                | :00 hourly                     | Tier 1+2 CCU, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| CCU Daily Sync          | `ccu-daily-sync.yml`          | 04:30, 12:30, 20:30            | Tier 3 CCU rotation, Tiger writer gated by `ENABLE_TIGER_METRICS_WRITERS` |
| CCU Cleanup             | `ccu-cleanup.yml`             | Sun 03:00                      | Legacy cleanup, gated by `ENABLE_LEGACY_SUPABASE_WRITERS` |
| Cleanup Reservations    | `cleanup-reservations.yml`    | :00 hourly                     | Stale credit reservation cleanup in Tiger ops |
| Cleanup Chat Logs       | `cleanup-chat-logs.yml`       | 03:00 daily                    | 7-day chat log cleanup in Tiger ops         |
| YouTube Production Bootstrap | `youtube-production-bootstrap.yml` | Manual                    | Bootstrap YouTube routing, discovery, refresh, and rollups |
| YouTube Production Sync | `youtube-production-sync.yml` | 15 */6 * * *                   | Steady-state YouTube discovery, refresh, and rollups |
| YouTube Preview Mirror  | `youtube-preview-mirror.yml`  | Manual                         | Mirror production YouTube slices into preview Tiger |
| Tiger Production Sync   | `tiger-production-sync.yml`   | Manual                         | Retained Tiger validation/reporting; not a scheduled Supabase source ingest |
| Tiger Preview Sync      | `tiger-preview-sync.yml`      | Manual                         | Refresh preview Tiger chat-serving data    |
| CI                      | `ci.yml`                      | On push/PR                     | Type checking                              |

Games page filter-count views are not GitHub-owned. `mv_tag_counts`, `mv_genre_counts`, `mv_category_counts`, `mv_steam_deck_counts`, `mv_ccu_tier_counts`, and `mv_velocity_tier_counts` refresh every 4 hours via `pg_cron` and `refresh_filter_count_views()`.

## Workflow Structure

Tiger writer workflows follow this pattern:

```yaml
name: Storefront Details Sync

on:
  schedule:
    - cron: "0 */2 * * *"
  workflow_dispatch:
    inputs:
      batch_size:
        description: "Number of apps to process per partition"
        required: false
        default: "50"

env:
  DATA_READ_TARGET: tiger
  DATA_WRITE_TARGET: tiger
  CHANGE_INTEL_READ_TARGET: tiger
  CHANGE_INTEL_WRITE_TARGET: tiger
  CHANGE_INTEL_ARCHIVE_TARGET: object_storage
  TIGER_PRIMARY_URL: ${{ secrets.TIGER_PRODUCTION_URL }}

jobs:
  sync:
    if: ${{ github.event_name == 'workflow_dispatch' || vars.ENABLE_TIGER_CATALOG_WRITERS == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm build

      - name: Run sync
        run: pnpm --filter @publisheriq/ingestion storefront-sync
        env:
          GITHUB_RUN_ID: ${{ github.run_id }}
          BATCH_SIZE: ${{ github.event.inputs.batch_size || '800' }}
```

## Manual Triggers

All workflows support manual triggering with optional inputs.

Writer smoke rules:

- Use manual dispatch before enabling any scheduled writer gate.
- For `embedding-sync.yml`, set `max_batches=1` for a bounded smoke. The workflow passes this through as `MAX_BATCHES`; leave it blank only for the full embedding sweep.
- For app-list, storefront, reviews, price, and metrics workflows, use the smallest exposed `batch_size`/limit inputs that still exercise the path.
- After a smoke, inspect logs for `DATA_WRITE_TARGET=tiger` and the expected Tiger connection, then run `scripts/ops/audit-supabase-writers.mjs --fail-on-supabase-writers` locally or in CI before turning on a scheduled gate.

Tiger-specific workflows:

- `tiger-production-sync.yml`
  - also runs on a daily schedule
  - assumes the Tiger target is already bootstrapped before the refresh job starts
  - refreshes `legacy`, the trailing `metrics.daily_metrics` window, and the
    events/news reconcile surfaces for the production TigerData target
  - automatically retries one `app_change_events`-only reconcile/validate pass
    when the initial reconcile fails only because `app_change_events` still
    has count-only drift and integrity checks remain zero
  - starts with `recent_window` projection repair by default
  - automatically retries a projection-only `exact_parity` reconcile when the
    initial reconcile fails only because historical projection month drift
    remains in `docs.steam_news_search_projection`
  - still fails immediately for non-projection parity failures, integrity
    validation failures, or missing/malformed reconcile manifests
- `tiger-preview-sync.yml`
  - manual only
  - assumes the preview Tiger target is already bootstrapped
  - runs the same sync path against the preview TigerData target
  - uses the same app-change retry, recent-window-first, and projection-only
    exact-parity fallback behavior as production
  - supports the same `projection_repair_scope` input to force exact parity on
    the first reconcile pass
- `tiger-preview-events-news.yml`
  - manual only
  - builds the sync packages and runs only the events/news reconcile,
    recovery, and validate path against preview
  - supports optional table narrowing and custom lookbacks for fast workflow
    verification without legacy or metrics backfills
  - supports `stop_after_classification=true` when you only want the initial
    reconcile classification and recovery routing decision

All Tiger workflows upload the generated Tiger manifest directory as a workflow
artifact so you can inspect parity output after each run.

Incoming product-data writer workflows:

- `applist-sync.yml`, `storefront-sync.yml`, and `app-change-hints.yml` are Tiger/R2-first for accepted catalog/change-intel paths.
- `news-hot-refresh.yml` and `news-catchup.yml` write change-intel news state to Tiger and raw/archive payloads to R2.
- `reviews-sync.yml`, `price-sync.yml`, `steamspy-sync.yml`, `histogram-sync.yml`, `ccu-sync.yml`, `ccu-daily-sync.yml`, `trends-calculation.yml`, `velocity-calculation.yml`, `interpolation.yml`, and `priority-calculation.yml` write metric/product-derived state to Tiger when their gate is enabled.
- Legacy Supabase workflows are intentionally retained for surfaces that still read or operate there. Do not delete them just because Tiger writers are enabled.

YouTube workflows:

- `youtube-production-bootstrap.yml`
  - manual only
  - seeds the routing cohort, runs the bootstrap backfill, refreshes bootstrap-era coverage, and rebuilds daily rollups
  - accepts `bootstrap_lookback_days`, `discovery_limit`, and `refresh_limit`
  - writes directly to the production Tiger YouTube slice through `pnpm youtube:seed-routing`, `pnpm youtube:bootstrap-backfill`, `pnpm youtube:sync-refresh`, and `pnpm youtube:rollup-daily`
- `youtube-production-sync.yml`
  - runs every 6 hours and also supports manual dispatch
  - runs the same seed-routing, discovery, refresh, and rollup scripts in steady state
  - accepts the same YouTube bootstrap/discovery/refresh limit inputs
- `youtube-preview-mirror.yml`
  - manual only
  - mirrors production Tiger YouTube slices into preview Tiger
  - accepts `bootstrap_lookback_days`
  - runs `pnpm youtube:mirror-preview`

### From GitHub UI

1. Go to **Actions** tab
2. Select workflow (e.g., "SteamSpy Sync")
3. Click **Run workflow**
4. Optionally set input parameters
5. Click **Run workflow**

### From GitHub CLI

```bash
# Run with defaults
gh workflow run steamspy-sync.yml

# Run with inputs
gh workflow run steamspy-sync.yml -f max_pages=10
```

## Workflow Inputs

### SteamSpy Sync

| Input       | Default | Description              |
| ----------- | ------- | ------------------------ |
| `max_pages` | `0`     | Pages to fetch (0 = all) |

### Storefront Sync

| Input        | Default | Description    |
| ------------ | ------- | -------------- |
| `batch_size` | `200`   | Apps per batch |

### Reviews Sync

| Input        | Default | Description                               |
| ------------ | ------- | ----------------------------------------- |
| `batch_size` | `2500`  | Apps per batch (v2.2: increased from 200) |

### CCU Daily Sync (v2.2)

| Input   | Default  | Description                                         |
| ------- | -------- | --------------------------------------------------- |
| `limit` | `150000` | Maximum apps to sync (rotation covers ~21k per run) |

### Tiger Production / Preview Sync

| Input                     | Default         | Description                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `metrics_lookback_days`   | `7`             | Trailing UTC days to replay into `metrics.daily_metrics`                                                                                                                                                                                                                       |
| `projection_day_lookback` | `7`             | Trailing UTC days of projection churn to consider when selecting recent-window replay months                                                                                                                                                                                   |
| `projection_repair_scope` | `recent_window` | First-pass projection repair scope; `recent_window` auto-retries recoverable `app_change_events` count-only drift, auto-falls back to projection-only `exact_parity` for historical projection drift, and `exact_parity` forces historical projection repair on the first pass |
| `legacy_tables`           | empty           | Optional comma-separated override for the legacy compatibility slice                                                                                                                                                                                                           |

### Embedding Sync

| Input             | Default | Description |
| ----------------- | ------- | ----------- |
| `batch_size`      | `500`   | Rows per embedding batch |
| `sync_collection` | `all`   | `games`, `publishers`, `developers`, or `all` |
| `max_batches`     | empty   | Manual smoke cap. Use `1` before enabling `ENABLE_TIGER_EMBEDDING_WRITER`; blank means full sync. |

### Tiger Preview Events/News

| Input                       | Default         | Description                                                                                                                        |
| --------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `events_news_tables`        | empty           | Optional comma-separated `EVENTS_NEWS_SYNC_TABLES` override; empty runs all three events/news tables                               |
| `event_day_lookback`        | `3`             | Trailing UTC days to reconcile for `app_change_events`                                                                             |
| `news_day_lookback`         | `7`             | Trailing UTC days to reconcile for `steam_news_items`                                                                              |
| `projection_day_lookback`   | `7`             | Trailing UTC days of projection churn to consider during reconcile and validate                                                    |
| `projection_repair_scope`   | `recent_window` | First-pass projection repair scope; uses the same app-change retry and projection fallback recovery rules                          |
| `stop_after_classification` | `false`         | Smoke-test mode; runs the initial reconcile and classification only, then skips retries, exact-parity fallback, and final validate |

### YouTube Workflows

| Input                    | Default | Description                                                               |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| `bootstrap_lookback_days` | `30`    | Historical window to backfill or mirror before steady-state sync starts   |
| `discovery_limit`        | `25`    | Maximum number of games to process during discovery sync                  |
| `refresh_limit`          | `500`   | Maximum number of matched videos to refresh during YouTube sync            |

## Related Operator Scripts

- `pnpm youtube:seed-routing`
- `pnpm youtube:bootstrap-backfill`
- `pnpm youtube:sync-discovery`
- `pnpm youtube:sync-refresh`
- `pnpm youtube:rollup-daily`
- `pnpm youtube:mirror-preview`
- `pnpm --filter @publisheriq/ingestion repair-storefront-authority`
- `pnpm --filter @publisheriq/ingestion change-intel-tiger-parity`
- `pnpm --filter @publisheriq/ingestion change-intel-copy-hero-assets-to-r2`
- `node scripts/ops/audit-supabase-writers.mjs --fail-on-supabase-writers`

Use the YouTube scripts when you need to bootstrap, refresh, or mirror the coverage slice outside the GitHub Actions jobs. Use `repair-storefront-authority` when storefront fields such as `is_free`, `is_released`, or `release_date` need to be repaired before downstream refreshes.

## Monitoring

### View Run History

1. Go to **Actions** tab
2. Click on a workflow
3. View recent runs with status

### View Logs

1. Click on a workflow run
2. Click on the job name
3. Expand steps to see logs

### Job Status Indicators

| Status         | Meaning                  |
| -------------- | ------------------------ |
| ✅ Success     | Completed without errors |
| ❌ Failure     | Encountered an error     |
| 🟡 In progress | Currently running        |
| ⏭️ Skipped     | Workflow was skipped     |
| ⚪ Queued      | Waiting to run           |

## Error Handling

### Automatic Retries

Workflows can be configured to retry on failure:

```yaml
jobs:
  sync:
    runs-on: ubuntu-latest
    # Retry up to 3 times
    strategy:
      max-parallel: 1
      fail-fast: false
```

### Common Failures

| Error                  | Cause                | Solution                         |
| ---------------------- | -------------------- | -------------------------------- |
| `SUPABASE_URL not set` | Missing secret       | Add repository secret            |
| `Rate limited`         | API quota exceeded   | Wait and retry                   |
| `Timeout`              | Sync taking too long | Increase timeout or reduce batch |

### Timeout Configuration

Workflows have a default 6-hour timeout:

```yaml
jobs:
  sync:
    timeout-minutes: 360
```

For longer syncs, increase the timeout (max 72 hours for private repos).

## Cost Considerations

GitHub Actions provides free minutes for public repos. For private repos:

| Plan       | Minutes/month |
| ---------- | ------------- |
| Free       | 2,000         |
| Team       | 3,000         |
| Enterprise | 50,000        |

### Optimizing Usage

1. **Schedule efficiently**: Avoid overlapping sync times
2. **Use caching**: pnpm cache reduces install time
3. **Batch processing**: Larger batches = fewer runs

## Disabling Workflows

### Temporary Disable

1. Go to **Actions** tab
2. Click workflow name
3. Click **...** menu
4. Select **Disable workflow**

### Permanent Disable

Delete or rename the workflow file:

```bash
git rm .github/workflows/steamspy-sync.yml
git commit -m "Disable steamspy sync"
```

## Custom Schedules

Modify the cron expression in any workflow:

```yaml
on:
  schedule:
    # Every 6 hours
    - cron: "0 */6 * * *"

    # Every Monday at 9 AM UTC
    - cron: "0 9 * * 1"

    # First day of month
    - cron: "0 0 1 * *"
```

Use [crontab.guru](https://crontab.guru) to build expressions.

## Notifications

### Email Notifications

Configure in **Settings > Notifications**:

- Notify on workflow failures
- Notify on workflow success

### Slack Integration

Add Slack notification step:

```yaml
- name: Notify Slack
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

## Related Documentation

- [Environment Setup](../setup.md) - All variables
- [Sync Pipeline](../architecture/sync-pipeline.md) - Data flow
- [Running Workers](../workers/running-workers.md) - Manual execution
