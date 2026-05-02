CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.monthly_game_metrics AS
WITH monthly_data AS (
  SELECT
    dm.appid,
    date_trunc('month', dm.metric_date)::date AS month,
    sum(dm.ccu_peak) AS monthly_ccu_sum,
    avg(dm.average_playtime_2weeks) AS avg_playtime_2weeks
  FROM metrics.daily_metrics dm
  WHERE dm.metric_date >= DATE '2024-01-01'
  GROUP BY dm.appid, date_trunc('month', dm.metric_date)
)
SELECT
  md.appid,
  a.name AS game_name,
  md.month,
  extract(year FROM md.month)::integer AS year,
  extract(month FROM md.month)::integer AS month_num,
  md.monthly_ccu_sum,
  coalesce(
    round(md.monthly_ccu_sum * coalesce(md.avg_playtime_2weeks, 0) / 2.0 / 60.0),
    0
  )::bigint AS estimated_monthly_hours
FROM monthly_data md
JOIN legacy.apps a ON a.appid = md.appid
WHERE a.type = 'game'
  AND a.is_delisted = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_monthly_game_metrics_pk
  ON metrics.monthly_game_metrics (appid, month);
CREATE INDEX IF NOT EXISTS idx_metrics_monthly_game_metrics_month
  ON metrics.monthly_game_metrics (month DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_monthly_game_metrics_hours
  ON metrics.monthly_game_metrics (estimated_monthly_hours DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_monthly_game_metrics_year_month
  ON metrics.monthly_game_metrics (year, month_num);

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.monthly_publisher_metrics AS
SELECT
  p.id AS publisher_id,
  p.name AS publisher_name,
  mgm.month,
  mgm.year,
  mgm.month_num,
  count(DISTINCT ap.appid)::integer AS game_count,
  sum(mgm.estimated_monthly_hours)::bigint AS estimated_monthly_hours
FROM legacy.publishers p
JOIN legacy.app_publishers ap ON ap.publisher_id = p.id
JOIN metrics.monthly_game_metrics mgm ON mgm.appid = ap.appid
GROUP BY p.id, p.name, mgm.month, mgm.year, mgm.month_num;

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_monthly_publisher_metrics_pk
  ON metrics.monthly_publisher_metrics (publisher_id, month);
CREATE INDEX IF NOT EXISTS idx_metrics_monthly_publisher_metrics_month
  ON metrics.monthly_publisher_metrics (month DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_monthly_publisher_metrics_hours
  ON metrics.monthly_publisher_metrics (estimated_monthly_hours DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_monthly_publisher_metrics_year_month
  ON metrics.monthly_publisher_metrics (year, month_num);

CREATE OR REPLACE FUNCTION metrics.refresh_monthly_playtime_metrics()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.monthly_game_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.monthly_publisher_metrics;
END;
$$;

COMMENT ON MATERIALIZED VIEW metrics.monthly_game_metrics IS
  'Pre-computed monthly game playtime estimates based on monthly CCU sum and average two-week playtime.';
COMMENT ON MATERIALIZED VIEW metrics.monthly_publisher_metrics IS
  'Pre-computed monthly publisher playtime estimates aggregated from metrics.monthly_game_metrics.';
