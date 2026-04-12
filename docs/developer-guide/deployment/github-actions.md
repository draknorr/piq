# GitHub Actions Configuration

PublisherIQ uses GitHub Actions for scheduled data sync jobs. This guide covers setup and configuration.

## Prerequisites

- Repository pushed to GitHub
- Supabase project credentials
- Steam API key

## Quick Start

### 1. Add Repository Secrets

Go to **Settings > Secrets and variables > Actions > New repository secret**:

| Secret                 | Value                                                  |
| ---------------------- | ------------------------------------------------------ |
| `SUPABASE_URL`         | `https://xxx.supabase.co`                              |
| `SUPABASE_SERVICE_KEY` | `eyJ...`                                               |
| `STEAM_API_KEY`        | Your Steam API key                                     |
| `DATABASE_URL`         | PostgreSQL connection string (for refresh-views, v2.1) |
| `TIGER_PRODUCTION_URL` | Production TigerData / Timescale connection string     |
| `TIGER_PREVIEW_URL`    | Preview TigerData / Timescale connection string        |

### 2. Enable Actions

1. Go to **Actions** tab
2. Click **I understand my workflows, go ahead and enable them**

### 3. Verify Workflows

Workflows should appear in the Actions tab. You can manually trigger any workflow to test.

## Workflow Schedule

All times are UTC:

| Workflow                | File                          | Schedule                       | Purpose                                    |
| ----------------------- | ----------------------------- | ------------------------------ | ------------------------------------------ |
| App List Sync           | `applist-sync.yml`            | 00:15 daily                    | Master app list                            |
| SteamSpy Sync           | `steamspy-sync.yml`           | 02:15 daily                    | Owners, playtime, tags                     |
| Embedding Sync          | `embedding-sync.yml`          | 03:00 daily                    | Vector embeddings                          |
| Histogram Sync          | `histogram-sync.yml`          | 04:15 daily                    | Monthly reviews                            |
| Storefront Sync         | `storefront-sync.yml`         | 06,10,14,18,22:00              | Game metadata                              |
| Reviews Sync            | `reviews-sync.yml`            | :15 every 2h                   | Review counts (batch 2500, v2.2)           |
| Trends Calculation      | `trends-calculation.yml`      | 22:00 daily                    | Trend metrics                              |
| Priority Calculation    | `priority-calculation.yml`    | 22:30 daily                    | Priority scores                            |
| Velocity Calculation    | `velocity-calculation.yml`    | 08,16,00:00                    | Velocity stats (v2.1)                      |
| Interpolation           | `interpolation.yml`           | 05:00 daily                    | Fill data gaps (v2.1)                      |
| Refresh Views           | `refresh-views.yml`           | 05:00 daily                    | Refresh heavy materialized view chain      |
| Refresh App Filter Data | `refresh-app-filter-data.yml` | 00,06,12,18:00                 | Refresh `app_filter_data` independently    |
| CCU Sync                | `ccu-sync.yml`                | :00 hourly                     | Tier 1+2 CCU (v2.2)                        |
| CCU Daily Sync          | `ccu-daily-sync.yml`          | 04:30, 12:30, 20:30 (3x daily) | Tier 3 CCU rotation (v2.2)                 |
| CCU Cleanup             | `ccu-cleanup.yml`             | Sun 03:00                      | Aggregate + cleanup snapshots (v2.2)       |
| Cleanup Reservations    | `cleanup-reservations.yml`    | :00 hourly                     | Stale credit reservation cleanup           |
| Cleanup Chat Logs       | `cleanup-chat-logs.yml`       | 03:00 daily                    | 7-day log retention                        |
| Tiger Production Sync   | `tiger-production-sync.yml`   | 07:45 daily                    | Refresh production Tiger chat-serving data |
| Tiger Preview Sync      | `tiger-preview-sync.yml`      | Manual                         | Refresh preview Tiger chat-serving data    |
| CI                      | `ci.yml`                      | On push/PR                     | Type checking                              |

Games page filter-count views are not GitHub-owned. `mv_tag_counts`, `mv_genre_counts`, `mv_category_counts`, `mv_steam_deck_counts`, `mv_ccu_tier_counts`, and `mv_velocity_tier_counts` refresh every 4 hours via `pg_cron` and `refresh_filter_count_views()`.

## Workflow Structure

Each sync workflow follows this pattern:

```yaml
name: SteamSpy Sync

on:
  schedule:
    - cron: "15 2 * * *" # 2:15 AM UTC daily
  workflow_dispatch: # Manual trigger
    inputs:
      max_pages:
        description: "Maximum pages to fetch (0 = all)"
        required: false
        default: "0"

env:
  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 360

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
        run: pnpm --filter @publisheriq/ingestion steamspy-sync
        env:
          GITHUB_RUN_ID: ${{ github.run_id }}
```

## Manual Triggers

All workflows support manual triggering with optional inputs.

Tiger-specific workflows:

- `tiger-production-sync.yml`
  - also runs on a daily schedule
  - assumes the Tiger target is already bootstrapped before the refresh job starts
  - refreshes `legacy`, the trailing `metrics.daily_metrics` window, and the
    events/news reconcile surfaces for the production TigerData target
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
  - uses the same recent-window-first and projection-only exact-parity fallback
    behavior as production
  - supports the same `projection_repair_scope` input to force exact parity on
    the first reconcile pass

Both workflows upload the generated Tiger manifest directory as a workflow
artifact so you can inspect parity output after each run.

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

| Input                     | Default         | Description                                                                                                                                                                                      |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `metrics_lookback_days`   | `7`             | Trailing UTC days to replay into `metrics.daily_metrics`                                                                                                                                         |
| `projection_day_lookback` | `7`             | Trailing UTC days of projection churn to consider when selecting recent-window replay months                                                                                                     |
| `projection_repair_scope` | `recent_window` | First-pass projection repair scope; `recent_window` auto-falls back to projection-only `exact_parity` for historical projection drift, and `exact_parity` forces that behavior on the first pass |
| `legacy_tables`           | empty           | Optional comma-separated override for the legacy compatibility slice                                                                                                                             |

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
