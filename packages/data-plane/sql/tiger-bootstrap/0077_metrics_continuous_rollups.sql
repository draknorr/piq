-- Tiger-owned rollups for Cube/query-api analytical read paths.
--
-- These continuous aggregates move the stable metrics rollup work into
-- Timescale background policies so Cube does not need to rebuild the same
-- daily/weekly/monthly time-series summaries from Fly.
--
-- Apply only after the TimescaleDB extension is enabled on the target and
-- metrics.daily_metrics has been created as a hypertable.
--
-- Initial historical population is intentionally not forced here. Run bounded
-- refresh_continuous_aggregate calls off peak after creating the views, then
-- let the policies maintain the hot windows.

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.daily_metrics_app_day_rollup
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 day', metric_date) AS bucket,
  appid,
  sum(ccu_peak)::bigint AS sum_ccu,
  sum(total_reviews)::bigint AS sum_total_reviews,
  sum(positive_reviews)::bigint AS sum_positive_reviews,
  avg(review_score::double precision) AS avg_review_score,
  count(*)::bigint AS metric_count
FROM metrics.daily_metrics
GROUP BY bucket, appid
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_metrics_daily_app_day_rollup_app_bucket
  ON metrics.daily_metrics_app_day_rollup (appid, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_app_day_rollup_bucket
  ON metrics.daily_metrics_app_day_rollup (bucket DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.daily_metrics_week_rollup
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 week', metric_date) AS bucket,
  sum((owners_min + owners_max) / 2)::bigint AS sum_owners,
  sum(ccu_peak)::bigint AS sum_ccu,
  sum(total_reviews)::bigint AS sum_total_reviews,
  avg(review_score::double precision) AS avg_review_score,
  count(*)::bigint AS metric_count
FROM metrics.daily_metrics
GROUP BY bucket
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_metrics_daily_week_rollup_bucket
  ON metrics.daily_metrics_week_rollup (bucket DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.daily_metrics_month_rollup
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 month', metric_date) AS bucket,
  sum((owners_min + owners_max) / 2)::bigint AS sum_owners,
  sum(ccu_peak)::bigint AS sum_ccu,
  sum(total_reviews)::bigint AS sum_total_reviews,
  avg(review_score::double precision) AS avg_review_score,
  count(*)::bigint AS metric_count
FROM metrics.daily_metrics
GROUP BY bucket
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_metrics_daily_month_rollup_bucket
  ON metrics.daily_metrics_month_rollup (bucket DESC);

SELECT add_continuous_aggregate_policy(
  'metrics.daily_metrics_app_day_rollup',
  start_offset => INTERVAL '180 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => true
);

SELECT add_continuous_aggregate_policy(
  'metrics.daily_metrics_week_rollup',
  start_offset => INTERVAL '1 year',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '6 hours',
  if_not_exists => true
);

SELECT add_continuous_aggregate_policy(
  'metrics.daily_metrics_month_rollup',
  start_offset => INTERVAL '3 years',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '24 hours',
  if_not_exists => true
);

COMMENT ON VIEW metrics.daily_metrics_app_day_rollup IS
  'Tiger continuous aggregate for per-app daily metrics used by Cube-compatible analytical reads.';
COMMENT ON VIEW metrics.daily_metrics_week_rollup IS
  'Tiger continuous aggregate for weekly platform metrics used by Cube-compatible analytical reads.';
COMMENT ON VIEW metrics.daily_metrics_month_rollup IS
  'Tiger continuous aggregate for monthly platform metrics used by Cube-compatible analytical reads.';

-- Suggested off-peak backfill commands after apply:
-- CALL refresh_continuous_aggregate('metrics.daily_metrics_app_day_rollup', NULL, now() - INTERVAL '1 hour');
-- CALL refresh_continuous_aggregate('metrics.daily_metrics_week_rollup', NULL, now() - INTERVAL '1 hour');
-- CALL refresh_continuous_aggregate('metrics.daily_metrics_month_rollup', NULL, now() - INTERVAL '1 hour');
