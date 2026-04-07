-- =============================================================================
-- Migration: Optimize latest_daily_metrics Refresh
--
-- latest_daily_metrics currently scans daily_metrics multiple times to find the
-- latest non-NULL CCU, review, and owner rows per app. Add partial covering
-- indexes that match those branches directly so the concurrent refresh can stay
-- within the workflow timeout budget.
-- =============================================================================

-- Latest non-NULL CCU row per app
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_metrics_latest_ccu_cover
  ON daily_metrics (appid, metric_date DESC)
  INCLUDE (ccu_peak, ccu_source)
  WHERE ccu_peak IS NOT NULL;

COMMENT ON INDEX idx_daily_metrics_latest_ccu_cover IS
  'Partial covering index for latest_daily_metrics latest_ccu branch';

-- Latest non-NULL review row per app
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_metrics_latest_reviews_cover
  ON daily_metrics (appid, metric_date DESC)
  INCLUDE (total_reviews, positive_reviews, negative_reviews, review_score, review_score_desc)
  WHERE total_reviews IS NOT NULL;

COMMENT ON INDEX idx_daily_metrics_latest_reviews_cover IS
  'Partial covering index for latest_daily_metrics latest_reviews branch';

-- Latest non-NULL owner/price/playtime row per app
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_metrics_latest_owners_cover
  ON daily_metrics (appid, metric_date DESC)
  INCLUDE (
    owners_min,
    owners_max,
    price_cents,
    discount_percent,
    average_playtime_forever,
    average_playtime_2weeks
  )
  WHERE owners_min IS NOT NULL;

COMMENT ON INDEX idx_daily_metrics_latest_owners_cover IS
  'Partial covering index for latest_daily_metrics latest_owners branch';

-- Recent CCU rows used by the 7-day weekly_ccu aggregation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_metrics_weekly_ccu_cover
  ON daily_metrics (metric_date DESC, appid)
  INCLUDE (ccu_peak)
  WHERE ccu_peak IS NOT NULL;

COMMENT ON INDEX idx_daily_metrics_weekly_ccu_cover IS
  'Partial covering index for latest_daily_metrics weekly_ccu branch';

ANALYZE daily_metrics;
