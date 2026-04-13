-- Migration: Fix effective current price across app surfaces
-- Risk Level: MEDIUM (recreates materialized views and updates read RPCs; no table data changes)
-- Rollback: Re-run prior app-page migrations to restore the previous view and RPC definitions
--
-- Problem:
--   App surfaces were mixing latest_daily_metrics.price_cents with apps.current_discount_percent.
--   When latest_daily_metrics.price_cents was NULL but storefront pricing was present on apps,
--   the UI could show "$0.00" or an orphaned discount badge.
--
-- Fix:
--   Prefer apps.current_price_cents for current app pricing surfaces, falling back to
--   latest_daily_metrics.price_cents only when storefront pricing is unavailable.

-- ============================================================================
-- STEP 1: Recreate app_filter_data with storefront-backed effective price
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS app_filter_data;

CREATE MATERIALIZED VIEW app_filter_data AS
WITH
publisher_data AS (
  SELECT DISTINCT ON (ap.appid)
    ap.appid,
    ap.publisher_id,
    p.name AS publisher_name,
    p.game_count AS publisher_game_count
  FROM app_publishers ap
  JOIN publishers p ON p.id = ap.publisher_id
  ORDER BY ap.appid, ap.publisher_id
),
developer_data AS (
  SELECT DISTINCT ON (ad.appid)
    ad.appid,
    ad.developer_id,
    d.name AS developer_name
  FROM app_developers ad
  JOIN developers d ON d.id = ad.developer_id
  ORDER BY ad.appid, ad.developer_id
),
content_arrays AS (
  SELECT
    a.appid,
    COALESCE(array_agg(DISTINCT ag.genre_id) FILTER (WHERE ag.genre_id IS NOT NULL), ARRAY[]::INT[]) AS genre_ids,
    COALESCE(array_agg(DISTINCT ast.tag_id) FILTER (WHERE ast.tag_id IS NOT NULL), ARRAY[]::INT[]) AS tag_ids,
    COALESCE(array_agg(DISTINCT ac.category_id) FILTER (WHERE ac.category_id IS NOT NULL), ARRAY[]::INT[]) AS category_ids,
    30 = ANY(array_agg(DISTINCT ac.category_id) FILTER (WHERE ac.category_id IS NOT NULL)) AS has_workshop,
    array_remove(ARRAY[
      CASE WHEN a.platforms LIKE '%windows%' THEN 'windows' END,
      CASE WHEN a.platforms LIKE '%macos%' THEN 'macos' END,
      CASE WHEN a.platforms LIKE '%linux%' THEN 'linux' END
    ], NULL) AS platform_array
  FROM apps a
  LEFT JOIN app_genres ag ON ag.appid = a.appid
  LEFT JOIN app_steam_tags ast ON ast.appid = a.appid
  LEFT JOIN app_categories ac ON ac.appid = a.appid
  WHERE a.is_released = TRUE AND a.is_delisted = FALSE
  GROUP BY a.appid, a.platforms
),
metrics_data AS (
  SELECT
    a.appid,
    a.is_free,
    a.release_date,
    a.store_asset_mtime,
    ldm.ccu_peak,
    ldm.owners_min,
    ldm.owners_max,
    ldm.owners_midpoint,
    ldm.total_reviews,
    ldm.positive_reviews,
    ldm.review_score,
    ldm.positive_percentage,
    COALESCE(a.current_price_cents, ldm.price_cents) AS price_cents,
    ldm.average_playtime_forever,
    ldm.average_playtime_2weeks,
    ct.ccu_growth_7d_percent,
    ct.ccu_growth_30d_percent,
    ct.ccu_tier,
    COALESCE(rvs.velocity_7d, 0) AS velocity_7d,
    COALESCE(rvs.velocity_30d, 0) AS velocity_30d,
    rvs.velocity_tier,
    atr.current_positive_ratio,
    atr.previous_positive_ratio
  FROM apps a
  LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
  LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
  LEFT JOIN app_trends atr ON atr.appid = a.appid
  WHERE a.is_released = TRUE AND a.is_delisted = FALSE
)
SELECT
  ca.appid,
  ca.genre_ids,
  ca.tag_ids,
  ca.category_ids,
  ca.has_workshop,
  ca.platform_array,
  asd.category AS steam_deck_category,
  pd.publisher_id,
  pd.publisher_name,
  pd.publisher_game_count,
  dd.developer_id,
  dd.developer_name,
  pm.avg_review_score AS publisher_avg_score,
  CASE
    WHEN md.review_score IS NOT NULL AND pm.avg_review_score IS NOT NULL
    THEN (md.review_score - pm.avg_review_score)::DECIMAL
    ELSE NULL
  END AS vs_publisher_avg,
  CASE
    WHEN md.ccu_growth_7d_percent IS NOT NULL
    THEN ROUND((md.ccu_growth_7d_percent +
      CASE
        WHEN md.velocity_30d > 0
        THEN ((md.velocity_7d - md.velocity_30d) / md.velocity_30d) * 100
        ELSE 0
      END) / 2, 2)
    ELSE NULL
  END AS momentum_score,
  CASE
    WHEN md.current_positive_ratio IS NOT NULL AND md.previous_positive_ratio IS NOT NULL
    THEN ROUND((md.current_positive_ratio - md.previous_positive_ratio) * 100, 2)
    ELSE NULL
  END AS sentiment_delta,
  CASE
    WHEN md.velocity_7d IS NOT NULL AND md.velocity_30d IS NOT NULL
    THEN ROUND(md.velocity_7d - md.velocity_30d, 4)
    ELSE NULL
  END AS velocity_acceleration,
  CASE
    WHEN md.owners_midpoint IS NULL OR md.owners_midpoint = 0 THEN NULL
    ELSE ROUND((md.ccu_peak::DECIMAL / md.owners_midpoint) * 100, 2)
  END AS active_player_pct,
  CASE
    WHEN md.owners_midpoint IS NULL OR md.owners_midpoint = 0 THEN NULL
    ELSE ROUND((md.total_reviews::DECIMAL / md.owners_midpoint) * 1000, 2)
  END AS review_rate,
  CASE
    WHEN md.is_free OR md.price_cents IS NULL OR md.price_cents = 0 THEN NULL
    WHEN md.average_playtime_forever IS NULL OR md.average_playtime_forever = 0 THEN NULL
    ELSE ROUND((md.average_playtime_forever::DECIMAL / 60) / (md.price_cents::DECIMAL / 100), 2)
  END AS value_score,
  CASE
    WHEN md.release_date IS NOT NULL
    THEN (CURRENT_DATE - md.release_date)::INT
    ELSE NULL
  END AS days_live,
  CASE
    WHEN md.release_date IS NOT NULL AND md.store_asset_mtime IS NOT NULL
    THEN (md.release_date - md.store_asset_mtime::DATE)::INT
    ELSE NULL
  END AS hype_duration
FROM content_arrays ca
LEFT JOIN app_steam_deck asd ON asd.appid = ca.appid
LEFT JOIN publisher_data pd ON pd.appid = ca.appid
LEFT JOIN developer_data dd ON dd.appid = ca.appid
LEFT JOIN metrics_data md ON md.appid = ca.appid
LEFT JOIN publisher_metrics pm ON pm.publisher_id = pd.publisher_id;

CREATE UNIQUE INDEX idx_app_filter_data_appid ON app_filter_data (appid);
CREATE INDEX idx_app_filter_data_genre_ids ON app_filter_data USING GIN (genre_ids);
CREATE INDEX idx_app_filter_data_tag_ids ON app_filter_data USING GIN (tag_ids);
CREATE INDEX idx_app_filter_data_category_ids ON app_filter_data USING GIN (category_ids);
CREATE INDEX idx_app_filter_data_platform_array ON app_filter_data USING GIN (platform_array);
CREATE INDEX idx_app_filter_data_steam_deck ON app_filter_data (steam_deck_category)
  WHERE steam_deck_category IS NOT NULL;
CREATE INDEX idx_app_filter_data_has_workshop ON app_filter_data (has_workshop)
  WHERE has_workshop = TRUE;
CREATE INDEX idx_app_filter_data_publisher_id ON app_filter_data (publisher_id)
  WHERE publisher_id IS NOT NULL;
CREATE INDEX idx_app_filter_data_vs_publisher_avg ON app_filter_data (vs_publisher_avg)
  WHERE vs_publisher_avg IS NOT NULL;
CREATE INDEX idx_app_filter_data_momentum_score ON app_filter_data (momentum_score)
  WHERE momentum_score IS NOT NULL;
CREATE INDEX idx_app_filter_data_sentiment_delta ON app_filter_data (sentiment_delta)
  WHERE sentiment_delta IS NOT NULL;
CREATE INDEX idx_app_filter_data_active_player_pct ON app_filter_data (active_player_pct)
  WHERE active_player_pct IS NOT NULL;
CREATE INDEX idx_app_filter_data_value_score ON app_filter_data (value_score)
  WHERE value_score IS NOT NULL;

GRANT SELECT ON app_filter_data TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW app_filter_data IS
'Pre-computed filter and metric data for apps page. Uses current storefront price with
latest_daily_metrics as a fallback for current app pricing surfaces.';

-- ============================================================================
-- STEP 2: Recreate mv_apps_aggregate_stats with effective current price
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_apps_aggregate_stats;

CREATE MATERIALIZED VIEW mv_apps_aggregate_stats AS
WITH base_data AS (
  SELECT
    a.type::TEXT AS app_type,
    COALESCE(ldm.ccu_peak, 0) AS ccu_peak,
    ldm.review_score,
    ct.ccu_growth_7d_percent,
    COALESCE(rvs.velocity_7d, 0) - COALESCE(rvs.velocity_30d, 0) AS velocity_acceleration,
    atr.current_positive_ratio,
    atr.previous_positive_ratio,
    a.is_free,
    COALESCE(a.current_price_cents, ldm.price_cents) AS price_cents,
    ldm.average_playtime_forever
  FROM apps a
  LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
  LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
  LEFT JOIN app_trends atr ON atr.appid = a.appid
  WHERE a.is_released = TRUE AND a.is_delisted = FALSE
),
computed AS (
  SELECT
    bd.*,
    CASE
      WHEN bd.ccu_growth_7d_percent IS NOT NULL
      THEN (bd.ccu_growth_7d_percent + COALESCE(bd.velocity_acceleration, 0)) / 2
      ELSE NULL
    END AS momentum_score,
    CASE
      WHEN bd.current_positive_ratio IS NOT NULL AND bd.previous_positive_ratio IS NOT NULL
      THEN (bd.current_positive_ratio - bd.previous_positive_ratio) * 100
      ELSE NULL
    END AS sentiment_delta,
    CASE
      WHEN bd.is_free OR bd.price_cents IS NULL OR bd.price_cents = 0 THEN NULL
      WHEN bd.average_playtime_forever IS NULL OR bd.average_playtime_forever = 0 THEN NULL
      ELSE (bd.average_playtime_forever::DECIMAL / 60) / (bd.price_cents::DECIMAL / 100)
    END AS value_score
  FROM base_data bd
)
SELECT
  c.app_type,
  COUNT(*)::BIGINT AS total_games,
  ROUND(AVG(c.ccu_peak), 0)::DECIMAL AS avg_ccu,
  ROUND(AVG(c.review_score), 1)::DECIMAL AS avg_score,
  ROUND(AVG(c.momentum_score), 2)::DECIMAL AS avg_momentum,
  COUNT(*) FILTER (WHERE c.ccu_growth_7d_percent >= 10)::INT AS trending_up_count,
  COUNT(*) FILTER (WHERE c.ccu_growth_7d_percent <= -10)::INT AS trending_down_count,
  COUNT(*) FILTER (WHERE c.sentiment_delta >= 3)::INT AS sentiment_improving_count,
  COUNT(*) FILTER (WHERE c.sentiment_delta <= -3)::INT AS sentiment_declining_count,
  ROUND(AVG(c.value_score), 2)::DECIMAL AS avg_value_score
FROM computed c
GROUP BY c.app_type;

CREATE UNIQUE INDEX idx_mv_apps_aggregate_stats_pk ON mv_apps_aggregate_stats (app_type);

GRANT SELECT ON mv_apps_aggregate_stats TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW mv_apps_aggregate_stats IS
  'Pre-computed aggregate statistics by app type. Uses effective current price for value metrics.';

-- ============================================================================
-- STEP 3: Update get_apps_with_filters to return effective current price
-- ============================================================================

CREATE OR REPLACE FUNCTION get_apps_with_filters(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_sort_field TEXT DEFAULT 'ccu_peak',
  p_sort_order TEXT DEFAULT 'desc',
  p_type TEXT DEFAULT 'game',
  p_search TEXT DEFAULT NULL,
  p_min_ccu INT DEFAULT NULL,
  p_max_ccu INT DEFAULT NULL,
  p_min_owners BIGINT DEFAULT NULL,
  p_max_owners BIGINT DEFAULT NULL,
  p_min_reviews INT DEFAULT NULL,
  p_max_reviews INT DEFAULT NULL,
  p_min_score INT DEFAULT NULL,
  p_max_score INT DEFAULT NULL,
  p_min_price INT DEFAULT NULL,
  p_max_price INT DEFAULT NULL,
  p_min_playtime INT DEFAULT NULL,
  p_max_playtime INT DEFAULT NULL,
  p_is_free BOOLEAN DEFAULT NULL,
  p_min_discount INT DEFAULT NULL,
  p_min_growth_7d DECIMAL DEFAULT NULL,
  p_max_growth_7d DECIMAL DEFAULT NULL,
  p_min_growth_30d DECIMAL DEFAULT NULL,
  p_max_growth_30d DECIMAL DEFAULT NULL,
  p_min_momentum DECIMAL DEFAULT NULL,
  p_max_momentum DECIMAL DEFAULT NULL,
  p_min_sentiment_delta DECIMAL DEFAULT NULL,
  p_max_sentiment_delta DECIMAL DEFAULT NULL,
  p_velocity_tier TEXT DEFAULT NULL,
  p_min_active_pct DECIMAL DEFAULT NULL,
  p_min_review_rate DECIMAL DEFAULT NULL,
  p_min_value_score DECIMAL DEFAULT NULL,
  p_min_vs_publisher DECIMAL DEFAULT NULL,
  p_genres INT[] DEFAULT NULL,
  p_genre_mode TEXT DEFAULT 'any',
  p_tags INT[] DEFAULT NULL,
  p_tag_mode TEXT DEFAULT 'any',
  p_categories INT[] DEFAULT NULL,
  p_has_workshop BOOLEAN DEFAULT NULL,
  p_platforms TEXT[] DEFAULT NULL,
  p_platform_mode TEXT DEFAULT 'any',
  p_steam_deck TEXT DEFAULT NULL,
  p_controller TEXT DEFAULT NULL,
  p_min_age INT DEFAULT NULL,
  p_max_age INT DEFAULT NULL,
  p_release_year INT DEFAULT NULL,
  p_early_access BOOLEAN DEFAULT NULL,
  p_min_hype INT DEFAULT NULL,
  p_max_hype INT DEFAULT NULL,
  p_publisher_search TEXT DEFAULT NULL,
  p_developer_search TEXT DEFAULT NULL,
  p_self_published BOOLEAN DEFAULT NULL,
  p_publisher_size TEXT DEFAULT NULL,
  p_ccu_tier INT DEFAULT NULL
)
RETURNS TABLE (
  appid INT,
  name TEXT,
  type TEXT,
  is_free BOOLEAN,
  ccu_peak INT,
  owners_min BIGINT,
  owners_max BIGINT,
  owners_midpoint BIGINT,
  total_reviews INT,
  positive_reviews INT,
  review_score INT,
  positive_percentage DECIMAL,
  price_cents INT,
  current_discount_percent INT,
  average_playtime_forever INT,
  average_playtime_2weeks INT,
  ccu_growth_7d_percent DECIMAL,
  ccu_growth_30d_percent DECIMAL,
  ccu_tier INT,
  velocity_7d DECIMAL,
  velocity_30d DECIMAL,
  velocity_tier TEXT,
  sentiment_delta DECIMAL,
  momentum_score DECIMAL,
  velocity_acceleration DECIMAL,
  active_player_pct DECIMAL,
  review_rate DECIMAL,
  value_score DECIMAL,
  vs_publisher_avg DECIMAL,
  release_date DATE,
  days_live INT,
  hype_duration INT,
  release_state TEXT,
  platforms TEXT,
  steam_deck_category TEXT,
  controller_support TEXT,
  publisher_id INT,
  publisher_name TEXT,
  publisher_game_count INT,
  developer_id INT,
  developer_name TEXT,
  metric_date DATE,
  data_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH base_apps AS (
    SELECT
      a.appid,
      a.name,
      a.type::TEXT,
      a.is_free,
      COALESCE(ldm.ccu_peak, 0)::INT AS ccu_peak,
      COALESCE(ldm.owners_min, 0)::BIGINT AS owners_min,
      COALESCE(ldm.owners_max, 0)::BIGINT AS owners_max,
      COALESCE(ldm.owners_midpoint, 0)::BIGINT AS owners_midpoint,
      COALESCE(ldm.total_reviews, 0)::INT AS total_reviews,
      COALESCE(ldm.positive_reviews, 0)::INT AS positive_reviews,
      ldm.review_score::INT,
      ldm.positive_percentage::DECIMAL,
      COALESCE(a.current_price_cents, ldm.price_cents)::INT AS price_cents,
      COALESCE(a.current_discount_percent, 0)::INT AS current_discount_percent,
      ldm.average_playtime_forever::INT,
      ldm.average_playtime_2weeks::INT,
      ct.ccu_growth_7d_percent::DECIMAL,
      ct.ccu_growth_30d_percent::DECIMAL,
      ct.ccu_tier::INT,
      COALESCE(rvs.velocity_7d, 0)::DECIMAL AS velocity_7d,
      COALESCE(rvs.velocity_30d, 0)::DECIMAL AS velocity_30d,
      rvs.velocity_tier::TEXT,
      a.release_date,
      a.release_state,
      a.platforms,
      a.controller_support,
      ldm.metric_date,
      ct.updated_at AS data_updated_at,
      afd.genre_ids,
      afd.tag_ids,
      afd.category_ids,
      afd.has_workshop AS afd_has_workshop,
      afd.platform_array,
      afd.steam_deck_category::TEXT,
      afd.publisher_id,
      afd.publisher_name,
      afd.publisher_game_count,
      afd.developer_id,
      afd.developer_name,
      afd.vs_publisher_avg,
      afd.momentum_score,
      afd.sentiment_delta,
      afd.velocity_acceleration,
      afd.active_player_pct,
      afd.review_rate,
      afd.value_score,
      afd.days_live,
      afd.hype_duration
    FROM apps a
    INNER JOIN app_filter_data afd ON afd.appid = a.appid
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
    LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
    WHERE a.is_released = TRUE AND a.is_delisted = FALSE
      AND (p_type = 'all' OR a.type::TEXT = p_type)
      AND (p_is_free IS NULL OR a.is_free = p_is_free)
  ),
  filtered AS (
    SELECT ba.*
    FROM base_apps ba
    WHERE
      (p_search IS NULL OR ba.name ILIKE '%' || p_search || '%')
      AND (p_min_ccu IS NULL OR ba.ccu_peak >= p_min_ccu)
      AND (p_max_ccu IS NULL OR ba.ccu_peak <= p_max_ccu)
      AND (p_min_owners IS NULL OR ba.owners_midpoint >= p_min_owners)
      AND (p_max_owners IS NULL OR ba.owners_midpoint <= p_max_owners)
      AND (p_min_reviews IS NULL OR ba.total_reviews >= p_min_reviews)
      AND (p_max_reviews IS NULL OR ba.total_reviews <= p_max_reviews)
      AND (p_min_score IS NULL OR ba.review_score >= p_min_score)
      AND (p_max_score IS NULL OR ba.review_score <= p_max_score)
      AND (p_min_price IS NULL OR ba.price_cents >= p_min_price)
      AND (p_max_price IS NULL OR ba.price_cents <= p_max_price)
      AND (p_min_playtime IS NULL OR ba.average_playtime_forever >= p_min_playtime)
      AND (p_max_playtime IS NULL OR ba.average_playtime_forever <= p_max_playtime)
      AND (p_min_discount IS NULL OR ba.current_discount_percent >= p_min_discount)
      AND (p_min_growth_7d IS NULL OR ba.ccu_growth_7d_percent >= p_min_growth_7d)
      AND (p_max_growth_7d IS NULL OR ba.ccu_growth_7d_percent <= p_max_growth_7d)
      AND (p_min_growth_30d IS NULL OR ba.ccu_growth_30d_percent >= p_min_growth_30d)
      AND (p_max_growth_30d IS NULL OR ba.ccu_growth_30d_percent <= p_max_growth_30d)
      AND (p_min_momentum IS NULL OR ba.momentum_score >= p_min_momentum)
      AND (p_max_momentum IS NULL OR ba.momentum_score <= p_max_momentum)
      AND (p_min_sentiment_delta IS NULL OR ba.sentiment_delta >= p_min_sentiment_delta)
      AND (p_max_sentiment_delta IS NULL OR ba.sentiment_delta <= p_max_sentiment_delta)
      AND (p_velocity_tier IS NULL OR ba.velocity_tier = p_velocity_tier)
      AND (p_min_active_pct IS NULL OR ba.active_player_pct >= p_min_active_pct)
      AND (p_min_review_rate IS NULL OR ba.review_rate >= p_min_review_rate)
      AND (p_min_value_score IS NULL OR ba.value_score >= p_min_value_score)
      AND (p_min_vs_publisher IS NULL OR ba.vs_publisher_avg >= p_min_vs_publisher)
      AND (p_genres IS NULL
        OR (p_genre_mode = 'any' AND ba.genre_ids && p_genres)
        OR (p_genre_mode = 'all' AND ba.genre_ids @> p_genres)
      )
      AND (p_tags IS NULL
        OR (p_tag_mode = 'any' AND ba.tag_ids && p_tags)
        OR (p_tag_mode = 'all' AND ba.tag_ids @> p_tags)
      )
      AND (p_categories IS NULL OR ba.category_ids && p_categories)
      AND (p_has_workshop IS NULL
        OR (p_has_workshop = TRUE AND ba.afd_has_workshop = TRUE)
        OR (p_has_workshop = FALSE AND (ba.afd_has_workshop = FALSE OR ba.afd_has_workshop IS NULL))
      )
      AND (p_platforms IS NULL
        OR (p_platform_mode = 'any' AND ba.platform_array && p_platforms)
        OR (p_platform_mode = 'all' AND ba.platform_array @> p_platforms)
      )
      AND (p_steam_deck IS NULL
        OR (p_steam_deck = 'verified' AND ba.steam_deck_category = 'verified')
        OR (p_steam_deck = 'playable' AND ba.steam_deck_category IN ('verified', 'playable'))
        OR (p_steam_deck = 'any' AND ba.steam_deck_category IS NOT NULL)
      )
      AND (p_controller IS NULL
        OR (p_controller = 'full' AND ba.controller_support = 'full')
        OR (p_controller = 'partial' AND ba.controller_support IN ('full', 'partial'))
        OR (p_controller = 'any' AND ba.controller_support IS NOT NULL)
      )
      AND (p_min_age IS NULL OR ba.days_live >= p_min_age)
      AND (p_max_age IS NULL OR ba.days_live <= p_max_age)
      AND (p_release_year IS NULL OR EXTRACT(YEAR FROM ba.release_date) = p_release_year)
      AND (p_early_access IS NULL
        OR (p_early_access = TRUE AND ba.release_state = 'prerelease')
        OR (p_early_access = FALSE AND ba.release_state != 'prerelease')
      )
      AND (p_min_hype IS NULL OR ba.hype_duration >= p_min_hype)
      AND (p_max_hype IS NULL OR ba.hype_duration <= p_max_hype)
      AND (p_publisher_search IS NULL OR ba.publisher_name ILIKE '%' || p_publisher_search || '%')
      AND (p_developer_search IS NULL OR ba.developer_name ILIKE '%' || p_developer_search || '%')
      AND (p_self_published IS NULL
        OR (p_self_published = TRUE AND LOWER(TRIM(ba.publisher_name)) = LOWER(TRIM(ba.developer_name)))
        OR (p_self_published = FALSE AND (
            ba.publisher_name IS NULL
            OR ba.developer_name IS NULL
            OR LOWER(TRIM(ba.publisher_name)) <> LOWER(TRIM(ba.developer_name))
        ))
      )
      AND (p_publisher_size IS NULL
        OR (p_publisher_size = 'indie' AND ba.publisher_game_count < 5)
        OR (p_publisher_size = 'mid' AND ba.publisher_game_count >= 5 AND ba.publisher_game_count < 20)
        OR (p_publisher_size = 'major' AND ba.publisher_game_count >= 20)
      )
      AND (p_ccu_tier IS NULL OR ba.ccu_tier = p_ccu_tier)
  ),
  sorted AS (
    SELECT f.*
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort_order = 'desc' THEN
        CASE p_sort_field
          WHEN 'ccu_peak' THEN f.ccu_peak
          WHEN 'owners_midpoint' THEN f.owners_midpoint
          WHEN 'total_reviews' THEN f.total_reviews
          WHEN 'review_score' THEN f.review_score
          WHEN 'price_cents' THEN f.price_cents
          WHEN 'ccu_growth_7d_percent' THEN f.ccu_growth_7d_percent
          WHEN 'ccu_growth_30d_percent' THEN f.ccu_growth_30d_percent
          WHEN 'momentum_score' THEN f.momentum_score
          WHEN 'sentiment_delta' THEN f.sentiment_delta
          WHEN 'velocity_7d' THEN f.velocity_7d
          WHEN 'active_player_pct' THEN f.active_player_pct
          WHEN 'review_rate' THEN f.review_rate
          WHEN 'value_score' THEN f.value_score
          WHEN 'vs_publisher_avg' THEN f.vs_publisher_avg
          WHEN 'days_live' THEN f.days_live
          ELSE f.ccu_peak
        END
      END DESC NULLS LAST,
      CASE WHEN p_sort_order = 'asc' THEN
        CASE p_sort_field
          WHEN 'ccu_peak' THEN f.ccu_peak
          WHEN 'owners_midpoint' THEN f.owners_midpoint
          WHEN 'total_reviews' THEN f.total_reviews
          WHEN 'review_score' THEN f.review_score
          WHEN 'price_cents' THEN f.price_cents
          WHEN 'ccu_growth_7d_percent' THEN f.ccu_growth_7d_percent
          WHEN 'ccu_growth_30d_percent' THEN f.ccu_growth_30d_percent
          WHEN 'momentum_score' THEN f.momentum_score
          WHEN 'sentiment_delta' THEN f.sentiment_delta
          WHEN 'velocity_7d' THEN f.velocity_7d
          WHEN 'active_player_pct' THEN f.active_player_pct
          WHEN 'review_rate' THEN f.review_rate
          WHEN 'value_score' THEN f.value_score
          WHEN 'vs_publisher_avg' THEN f.vs_publisher_avg
          WHEN 'days_live' THEN f.days_live
          ELSE f.ccu_peak
        END
      END ASC NULLS LAST,
      CASE WHEN p_sort_field = 'release_date' AND p_sort_order = 'desc' THEN f.release_date END DESC NULLS LAST,
      CASE WHEN p_sort_field = 'release_date' AND p_sort_order = 'asc' THEN f.release_date END ASC NULLS LAST,
      f.name ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    s.appid,
    s.name,
    s.type,
    s.is_free,
    s.ccu_peak,
    s.owners_min,
    s.owners_max,
    s.owners_midpoint,
    s.total_reviews,
    s.positive_reviews,
    s.review_score,
    s.positive_percentage,
    s.price_cents,
    s.current_discount_percent,
    s.average_playtime_forever,
    s.average_playtime_2weeks,
    s.ccu_growth_7d_percent,
    s.ccu_growth_30d_percent,
    s.ccu_tier,
    s.velocity_7d,
    s.velocity_30d,
    s.velocity_tier,
    s.sentiment_delta,
    s.momentum_score,
    s.velocity_acceleration,
    s.active_player_pct,
    s.review_rate,
    s.value_score,
    s.vs_publisher_avg,
    s.release_date,
    s.days_live,
    s.hype_duration,
    s.release_state,
    s.platforms,
    s.steam_deck_category,
    s.controller_support,
    s.publisher_id,
    s.publisher_name,
    s.publisher_game_count,
    s.developer_id,
    s.developer_name,
    s.metric_date,
    s.data_updated_at
  FROM sorted s;
END;
$$;

-- ============================================================================
-- STEP 4: Update get_apps_aggregate_stats to use effective current price
-- ============================================================================

CREATE OR REPLACE FUNCTION get_apps_aggregate_stats(
  p_type TEXT DEFAULT 'game',
  p_search TEXT DEFAULT NULL,
  p_min_ccu INT DEFAULT NULL,
  p_max_ccu INT DEFAULT NULL,
  p_min_owners BIGINT DEFAULT NULL,
  p_max_owners BIGINT DEFAULT NULL,
  p_min_reviews INT DEFAULT NULL,
  p_max_reviews INT DEFAULT NULL,
  p_min_score INT DEFAULT NULL,
  p_max_score INT DEFAULT NULL,
  p_min_price INT DEFAULT NULL,
  p_max_price INT DEFAULT NULL,
  p_min_playtime INT DEFAULT NULL,
  p_max_playtime INT DEFAULT NULL,
  p_is_free BOOLEAN DEFAULT NULL,
  p_min_discount INT DEFAULT NULL,
  p_min_growth_7d DECIMAL DEFAULT NULL,
  p_max_growth_7d DECIMAL DEFAULT NULL,
  p_min_growth_30d DECIMAL DEFAULT NULL,
  p_max_growth_30d DECIMAL DEFAULT NULL,
  p_min_momentum DECIMAL DEFAULT NULL,
  p_max_momentum DECIMAL DEFAULT NULL,
  p_min_sentiment_delta DECIMAL DEFAULT NULL,
  p_max_sentiment_delta DECIMAL DEFAULT NULL,
  p_velocity_tier TEXT DEFAULT NULL,
  p_min_active_pct DECIMAL DEFAULT NULL,
  p_min_review_rate DECIMAL DEFAULT NULL,
  p_min_value_score DECIMAL DEFAULT NULL,
  p_min_vs_publisher DECIMAL DEFAULT NULL,
  p_genres INT[] DEFAULT NULL,
  p_genre_mode TEXT DEFAULT 'any',
  p_tags INT[] DEFAULT NULL,
  p_tag_mode TEXT DEFAULT 'any',
  p_categories INT[] DEFAULT NULL,
  p_has_workshop BOOLEAN DEFAULT NULL,
  p_platforms TEXT[] DEFAULT NULL,
  p_platform_mode TEXT DEFAULT 'any',
  p_steam_deck TEXT DEFAULT NULL,
  p_controller TEXT DEFAULT NULL,
  p_min_age INT DEFAULT NULL,
  p_max_age INT DEFAULT NULL,
  p_release_year INT DEFAULT NULL,
  p_early_access BOOLEAN DEFAULT NULL,
  p_min_hype INT DEFAULT NULL,
  p_max_hype INT DEFAULT NULL,
  p_publisher_search TEXT DEFAULT NULL,
  p_developer_search TEXT DEFAULT NULL,
  p_self_published BOOLEAN DEFAULT NULL,
  p_publisher_size TEXT DEFAULT NULL,
  p_ccu_tier INT DEFAULT NULL
)
RETURNS TABLE (
  total_games BIGINT,
  avg_ccu DECIMAL,
  avg_score DECIMAL,
  avg_momentum DECIMAL,
  trending_up_count INT,
  trending_down_count INT,
  sentiment_improving_count INT,
  sentiment_declining_count INT,
  avg_value_score DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH base_apps AS (
    SELECT
      a.appid,
      COALESCE(ldm.ccu_peak, 0)::INT AS ccu_peak,
      ldm.review_score::INT,
      COALESCE(a.current_price_cents, ldm.price_cents)::INT AS price_cents,
      ldm.average_playtime_forever::INT,
      COALESCE(a.current_discount_percent, 0)::INT AS current_discount_percent,
      ct.ccu_growth_7d_percent,
      ct.ccu_growth_30d_percent,
      ct.ccu_tier,
      afd.momentum_score,
      afd.sentiment_delta,
      afd.value_score,
      afd.active_player_pct,
      afd.review_rate,
      afd.vs_publisher_avg,
      afd.days_live,
      afd.hype_duration,
      afd.genre_ids,
      afd.tag_ids,
      afd.category_ids,
      afd.has_workshop AS afd_has_workshop,
      afd.platform_array,
      afd.steam_deck_category,
      afd.publisher_name,
      afd.developer_name,
      afd.publisher_game_count,
      rvs.velocity_tier
    FROM apps a
    INNER JOIN app_filter_data afd ON afd.appid = a.appid
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
    LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
    WHERE a.is_released = TRUE AND a.is_delisted = FALSE
      AND (p_type = 'all' OR a.type::TEXT = p_type)
      AND (p_search IS NULL OR a.name ILIKE '%' || p_search || '%')
      AND (p_is_free IS NULL OR a.is_free = p_is_free)
  ),
  filtered AS (
    SELECT ba.*
    FROM base_apps ba
    WHERE
      (p_min_ccu IS NULL OR ba.ccu_peak >= p_min_ccu)
      AND (p_max_ccu IS NULL OR ba.ccu_peak <= p_max_ccu)
      AND (p_min_owners IS NULL OR ba.ccu_peak >= p_min_owners)
      AND (p_max_owners IS NULL OR ba.ccu_peak <= p_max_owners)
      AND (p_min_reviews IS NULL OR ba.review_score >= p_min_reviews)
      AND (p_max_reviews IS NULL OR ba.review_score <= p_max_reviews)
      AND (p_min_score IS NULL OR ba.review_score >= p_min_score)
      AND (p_max_score IS NULL OR ba.review_score <= p_max_score)
      AND (p_min_price IS NULL OR ba.price_cents >= p_min_price)
      AND (p_max_price IS NULL OR ba.price_cents <= p_max_price)
      AND (p_min_playtime IS NULL OR ba.average_playtime_forever >= p_min_playtime)
      AND (p_max_playtime IS NULL OR ba.average_playtime_forever <= p_max_playtime)
      AND (p_min_discount IS NULL OR ba.current_discount_percent >= p_min_discount)
      AND (p_min_growth_7d IS NULL OR ba.ccu_growth_7d_percent >= p_min_growth_7d)
      AND (p_max_growth_7d IS NULL OR ba.ccu_growth_7d_percent <= p_max_growth_7d)
      AND (p_min_growth_30d IS NULL OR ba.ccu_growth_30d_percent >= p_min_growth_30d)
      AND (p_max_growth_30d IS NULL OR ba.ccu_growth_30d_percent <= p_max_growth_30d)
      AND (p_min_momentum IS NULL OR ba.momentum_score >= p_min_momentum)
      AND (p_max_momentum IS NULL OR ba.momentum_score <= p_max_momentum)
      AND (p_min_sentiment_delta IS NULL OR ba.sentiment_delta >= p_min_sentiment_delta)
      AND (p_max_sentiment_delta IS NULL OR ba.sentiment_delta <= p_max_sentiment_delta)
      AND (p_velocity_tier IS NULL OR ba.velocity_tier = p_velocity_tier)
      AND (p_min_active_pct IS NULL OR ba.active_player_pct >= p_min_active_pct)
      AND (p_min_review_rate IS NULL OR ba.review_rate >= p_min_review_rate)
      AND (p_min_value_score IS NULL OR ba.value_score >= p_min_value_score)
      AND (p_min_vs_publisher IS NULL OR ba.vs_publisher_avg >= p_min_vs_publisher)
      AND (p_genres IS NULL
        OR (p_genre_mode = 'any' AND ba.genre_ids && p_genres)
        OR (p_genre_mode = 'all' AND ba.genre_ids @> p_genres)
      )
      AND (p_tags IS NULL
        OR (p_tag_mode = 'any' AND ba.tag_ids && p_tags)
        OR (p_tag_mode = 'all' AND ba.tag_ids @> p_tags)
      )
      AND (p_categories IS NULL OR ba.category_ids && p_categories)
      AND (p_has_workshop IS NULL
        OR (p_has_workshop = TRUE AND ba.afd_has_workshop = TRUE)
        OR (p_has_workshop = FALSE AND (ba.afd_has_workshop = FALSE OR ba.afd_has_workshop IS NULL))
      )
      AND (p_platforms IS NULL
        OR (p_platform_mode = 'any' AND ba.platform_array && p_platforms)
        OR (p_platform_mode = 'all' AND ba.platform_array @> p_platforms)
      )
      AND (p_steam_deck IS NULL
        OR (p_steam_deck = 'verified' AND ba.steam_deck_category = 'verified')
        OR (p_steam_deck = 'playable' AND ba.steam_deck_category IN ('verified', 'playable'))
        OR (p_steam_deck = 'any' AND ba.steam_deck_category IS NOT NULL)
      )
      AND (p_min_age IS NULL OR ba.days_live >= p_min_age)
      AND (p_max_age IS NULL OR ba.days_live <= p_max_age)
      AND (p_min_hype IS NULL OR ba.hype_duration >= p_min_hype)
      AND (p_max_hype IS NULL OR ba.hype_duration <= p_max_hype)
      AND (p_publisher_search IS NULL OR ba.publisher_name ILIKE '%' || p_publisher_search || '%')
      AND (p_developer_search IS NULL OR ba.developer_name ILIKE '%' || p_developer_search || '%')
      AND (p_self_published IS NULL
        OR (p_self_published = TRUE AND LOWER(TRIM(ba.publisher_name)) = LOWER(TRIM(ba.developer_name)))
        OR (p_self_published = FALSE AND (
            ba.publisher_name IS NULL
            OR ba.developer_name IS NULL
            OR LOWER(TRIM(ba.publisher_name)) <> LOWER(TRIM(ba.developer_name))
        ))
      )
      AND (p_publisher_size IS NULL
        OR (p_publisher_size = 'indie' AND ba.publisher_game_count < 5)
        OR (p_publisher_size = 'mid' AND ba.publisher_game_count >= 5 AND ba.publisher_game_count < 20)
        OR (p_publisher_size = 'major' AND ba.publisher_game_count >= 20)
      )
      AND (p_ccu_tier IS NULL OR ba.ccu_tier = p_ccu_tier)
  )
  SELECT
    COUNT(*)::BIGINT AS total_games,
    ROUND(AVG(filtered.ccu_peak), 0)::DECIMAL AS avg_ccu,
    ROUND(AVG(filtered.review_score), 1)::DECIMAL AS avg_score,
    ROUND(AVG(filtered.momentum_score), 2)::DECIMAL AS avg_momentum,
    COUNT(*) FILTER (WHERE filtered.ccu_growth_7d_percent >= 10)::INT AS trending_up_count,
    COUNT(*) FILTER (WHERE filtered.ccu_growth_7d_percent <= -10)::INT AS trending_down_count,
    COUNT(*) FILTER (WHERE filtered.sentiment_delta >= 3)::INT AS sentiment_improving_count,
    COUNT(*) FILTER (WHERE filtered.sentiment_delta <= -3)::INT AS sentiment_declining_count,
    ROUND(AVG(filtered.value_score), 2)::DECIMAL AS avg_value_score
  FROM filtered;
END;
$$;

-- ============================================================================
-- STEP 5: Update get_apps_by_ids to return effective current price
-- ============================================================================

CREATE OR REPLACE FUNCTION get_apps_by_ids(
  p_appids INT[]
)
RETURNS TABLE (
  appid INT,
  name TEXT,
  type TEXT,
  is_free BOOLEAN,
  is_delisted BOOLEAN,
  ccu_peak INT,
  owners_min BIGINT,
  owners_max BIGINT,
  owners_midpoint BIGINT,
  total_reviews INT,
  positive_reviews INT,
  review_score INT,
  positive_percentage DECIMAL,
  price_cents INT,
  current_discount_percent INT,
  average_playtime_forever INT,
  average_playtime_2weeks INT,
  ccu_growth_7d_percent DECIMAL,
  ccu_growth_30d_percent DECIMAL,
  ccu_tier INT,
  velocity_7d DECIMAL,
  velocity_30d DECIMAL,
  velocity_tier TEXT,
  sentiment_delta DECIMAL,
  momentum_score DECIMAL,
  velocity_acceleration DECIMAL,
  active_player_pct DECIMAL,
  review_rate DECIMAL,
  value_score DECIMAL,
  vs_publisher_avg DECIMAL,
  release_date DATE,
  days_live INT,
  hype_duration INT,
  release_state TEXT,
  platforms TEXT,
  steam_deck_category TEXT,
  controller_support TEXT,
  publisher_id INT,
  publisher_name TEXT,
  publisher_game_count INT,
  developer_id INT,
  developer_name TEXT,
  metric_date DATE,
  data_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.appid,
    a.name,
    a.type::TEXT,
    a.is_free,
    a.is_delisted,
    COALESCE(ldm.ccu_peak, 0)::INT AS ccu_peak,
    COALESCE(ldm.owners_min, 0)::BIGINT AS owners_min,
    COALESCE(ldm.owners_max, 0)::BIGINT AS owners_max,
    COALESCE(ldm.owners_midpoint, 0)::BIGINT AS owners_midpoint,
    COALESCE(ldm.total_reviews, 0)::INT AS total_reviews,
    COALESCE(ldm.positive_reviews, 0)::INT AS positive_reviews,
    ldm.review_score::INT,
    ldm.positive_percentage::DECIMAL,
    COALESCE(a.current_price_cents, ldm.price_cents)::INT,
    COALESCE(a.current_discount_percent, 0)::INT AS current_discount_percent,
    ldm.average_playtime_forever::INT,
    ldm.average_playtime_2weeks::INT,
    ct.ccu_growth_7d_percent::DECIMAL,
    ct.ccu_growth_30d_percent::DECIMAL,
    ct.ccu_tier::INT,
    COALESCE(rvs.velocity_7d, 0)::DECIMAL AS velocity_7d,
    COALESCE(rvs.velocity_30d, 0)::DECIMAL AS velocity_30d,
    rvs.velocity_tier::TEXT,
    afd.sentiment_delta::DECIMAL,
    afd.momentum_score::DECIMAL,
    afd.velocity_acceleration::DECIMAL,
    afd.active_player_pct::DECIMAL,
    afd.review_rate::DECIMAL,
    afd.value_score::DECIMAL,
    afd.vs_publisher_avg::DECIMAL,
    a.release_date,
    afd.days_live::INT,
    afd.hype_duration::INT,
    a.release_state,
    a.platforms,
    afd.steam_deck_category::TEXT,
    a.controller_support,
    afd.publisher_id,
    afd.publisher_name,
    afd.publisher_game_count,
    afd.developer_id,
    afd.developer_name,
    ldm.metric_date,
    ct.updated_at AS data_updated_at
  FROM apps a
  LEFT JOIN app_filter_data afd ON afd.appid = a.appid
  LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
  LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
  WHERE a.appid = ANY(p_appids);
END;
$$;
