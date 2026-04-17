# Tiger Source-of-Truth Checks

## Production Scale

Query:

```sql
SELECT
  (SELECT count(*) FROM docs.youtube_video_matches WHERE match_state IN ('matched_primary','matched_secondary')) AS matched_videos,
  (SELECT count(*) FROM metrics.youtube_video_snapshots) AS snapshots,
  (SELECT count(*) FROM metrics.youtube_game_daily WHERE metric_date >= current_date - 29) AS rollup_rows_30d,
  (SELECT count(*) FROM events.youtube_search_hits WHERE captured_at >= current_date - INTERVAL '30 days') AS search_hits_30d;
```

Result summary:

- `matched_videos = 30969`
- `snapshots = 46960`
- `rollup_rows_30d = 5112`
- `search_hits_30d = 36614`

## Rollup Staleness Versus Raw Data Freshness

Queries:

```sql
SELECT
  max(metric_date) AS latest_metric_date,
  count(*) FILTER (WHERE metric_date = current_date) AS rows_today,
  count(*) FILTER (WHERE metric_date = current_date - 1) AS rows_yesterday
FROM metrics.youtube_game_daily;
```

```sql
SELECT
  to_char(max(snapshot_time), 'YYYY-MM-DD HH24:MI:SS TZ') AS latest_snapshot_at,
  count(*) FILTER (WHERE snapshot_time >= now() - interval '24 hours') AS snapshots_last_24h
FROM metrics.youtube_video_snapshots;
```

Result summary:

- latest rollup date: `2026-04-14`
- current-day rollup rows: `0`
- previous-day rollup rows: `0`
- latest snapshot timestamp: `2026-04-17 03:45:48 UTC`
- snapshots in the last 24 hours: `4048`

## Index Presence

Query:

```sql
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname IN ('docs','metrics')
  AND tablename IN ('youtube_video_snapshots','youtube_video_matches','youtube_videos','youtube_game_daily')
ORDER BY schemaname, tablename, indexname
LIMIT 50;
```

Result summary:

Production had the expected indexes, including:

- `idx_docs_youtube_video_matches_state`
- `idx_docs_youtube_video_matches_video`
- `idx_docs_youtube_videos_published`
- `idx_metrics_youtube_video_snapshots_video_time`
- `idx_metrics_youtube_game_daily_appid_class_date`

This ruled out missing-index schema drift as the primary cause.
