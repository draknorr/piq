-- Tiger read accelerators for the admin /apps page.
--
-- The /apps UI needs fast full-catalog counts, computed metric sorts, taxonomy
-- filters, and publisher-relative review deltas. Querying those directly from
-- the normalized legacy/metrics tables requires repeated catalog-wide joins.
-- This projection precomputes the stable per-app row shape used by the page so
-- reads can filter/sort/aggregate over one indexed relation.
--
-- Apply only during an approved Tiger maintenance window. The initial refresh
-- scans legacy.apps, legacy.latest_daily_metrics, taxonomy tables, and
-- publisher/developer relationships.

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.apps_page_projection AS
WITH publisher_primary AS (
  SELECT DISTINCT ON (ap.appid)
    ap.appid,
    ap.publisher_id,
    p.name AS publisher_name,
    p.game_count AS publisher_game_count
  FROM legacy.app_publishers ap
  JOIN legacy.publishers p ON p.id = ap.publisher_id
  ORDER BY ap.appid, p.game_count DESC NULLS LAST, p.name
),
developer_primary AS (
  SELECT DISTINCT ON (ad.appid)
    ad.appid,
    ad.developer_id,
    d.name AS developer_name
  FROM legacy.app_developers ad
  JOIN legacy.developers d ON d.id = ad.developer_id
  ORDER BY ad.appid, d.game_count DESC NULLS LAST, d.name
),
publisher_score_avgs AS (
  SELECT
    ap.publisher_id,
    AVG(ldm.review_score)::numeric AS publisher_avg_score
  FROM legacy.app_publishers ap
  JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ap.appid
  WHERE ldm.review_score IS NOT NULL
  GROUP BY ap.publisher_id
),
taxonomy AS (
  SELECT
    a.appid,
    COALESCE(g.genre_ids, ARRAY[]::integer[]) AS genre_ids,
    COALESCE(t.tag_ids, ARRAY[]::integer[]) AS tag_ids,
    COALESCE(c.category_ids, ARRAY[]::integer[]) AS category_ids
  FROM legacy.apps a
  LEFT JOIN LATERAL (
    SELECT array_agg(ag.genre_id ORDER BY ag.genre_id) AS genre_ids
    FROM legacy.app_genres ag
    WHERE ag.appid = a.appid
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(ast.tag_id ORDER BY ast.tag_id) AS tag_ids
    FROM legacy.app_steam_tags ast
    WHERE ast.appid = a.appid
  ) t ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(ac.category_id ORDER BY ac.category_id) AS category_ids
    FROM legacy.app_categories ac
    WHERE ac.appid = a.appid
  ) c ON true
)
SELECT
  a.appid,
  a.name,
  lower(a.name) AS name_lower,
  COALESCE(a.type, 'game') AS type,
  COALESCE(a.is_free, false) AS is_free,
  COALESCE(a.is_delisted, false) AS is_delisted,
  COALESCE(a.has_workshop, false) AS has_workshop,
  COALESCE(a.is_released, true) AS is_released,
  COALESCE(ldm.ccu_peak, 0) AS ccu_peak,
  COALESCE(ldm.owners_min, 0) AS owners_min,
  COALESCE(ldm.owners_max, 0) AS owners_max,
  COALESCE(ldm.owners_midpoint, 0) AS owners_midpoint,
  COALESCE(ldm.total_reviews, 0) AS total_reviews,
  COALESCE(ldm.positive_reviews, 0) AS positive_reviews,
  ldm.review_score,
  ldm.positive_percentage,
  COALESCE(ldm.price_cents, a.current_price_cents) AS price_cents,
  COALESCE(ldm.discount_percent, a.current_discount_percent, 0) AS current_discount_percent,
  ldm.average_playtime_forever,
  ldm.average_playtime_2weeks,
  cta.ccu_growth_7d_percent AS ccu_growth_7d_percent,
  cta.ccu_growth_30d_percent AS ccu_growth_30d_percent,
  cta.ccu_tier,
  rvs.velocity_7d,
  rvs.velocity_30d,
  rvs.velocity_tier,
  CASE
    WHEN trends.current_positive_ratio IS NOT NULL AND trends.previous_positive_ratio IS NOT NULL
      THEN ROUND((trends.current_positive_ratio - trends.previous_positive_ratio) * 100, 2)
    ELSE NULL
  END AS sentiment_delta,
  CASE
    WHEN cta.ccu_growth_7d_percent IS NOT NULL
      THEN ROUND((cta.ccu_growth_7d_percent + COALESCE(
        CASE
          WHEN rvs.velocity_30d IS NOT NULL AND rvs.velocity_30d > 0
            THEN ((rvs.velocity_7d - rvs.velocity_30d) / rvs.velocity_30d) * 100
          ELSE 0
        END,
        0
      )) / 2, 2)
    ELSE NULL
  END AS momentum_score,
  CASE
    WHEN rvs.velocity_7d IS NOT NULL AND rvs.velocity_30d IS NOT NULL
      THEN ROUND(rvs.velocity_7d - rvs.velocity_30d, 4)
    ELSE NULL
  END AS velocity_acceleration,
  CASE
    WHEN ldm.owners_midpoint IS NOT NULL AND ldm.owners_midpoint > 0 AND ldm.ccu_peak IS NOT NULL
      THEN ROUND((ldm.ccu_peak::numeric / ldm.owners_midpoint) * 100, 4)
    ELSE NULL
  END AS active_player_pct,
  CASE
    WHEN a.release_date IS NOT NULL AND a.release_date < CURRENT_DATE AND ldm.total_reviews IS NOT NULL
      THEN ROUND(ldm.total_reviews::numeric / GREATEST(CURRENT_DATE - a.release_date, 1), 4)
    ELSE NULL
  END AS review_rate,
  CASE
    WHEN COALESCE(ldm.price_cents, a.current_price_cents, 0) > 0 AND ldm.review_score IS NOT NULL
      THEN ROUND(((ldm.review_score::numeric * LN(GREATEST(ldm.total_reviews, 1) + 1)) / (COALESCE(ldm.price_cents, a.current_price_cents)::numeric / 100))::numeric, 2)
    ELSE NULL
  END AS value_score,
  CASE
    WHEN ldm.review_score IS NOT NULL AND psa.publisher_avg_score IS NOT NULL
      THEN ROUND((ldm.review_score - psa.publisher_avg_score)::numeric, 2)
    ELSE NULL
  END AS vs_publisher_avg,
  a.release_date,
  CASE WHEN a.release_date IS NOT NULL THEN CURRENT_DATE - a.release_date ELSE NULL END AS days_live,
  NULL::integer AS hype_duration,
  a.release_state,
  a.platforms,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN a.platforms ILIKE '%windows%' THEN 'windows' END,
    CASE WHEN a.platforms ILIKE '%mac%' THEN 'mac' END,
    CASE WHEN a.platforms ILIKE '%linux%' THEN 'linux' END
  ], NULL) AS platform_array,
  sd.category AS steam_deck_category,
  a.controller_support,
  publisher.publisher_id,
  publisher.publisher_name,
  publisher.publisher_game_count,
  developer.developer_id,
  developer.developer_name,
  taxonomy.genre_ids,
  taxonomy.tag_ids,
  taxonomy.category_ids,
  ldm.metric_date,
  GREATEST(a.updated_at, COALESCE(sync.updated_at, a.updated_at)) AS data_updated_at
FROM legacy.apps a
LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
LEFT JOIN metrics.review_velocity_stats rvs ON rvs.appid = a.appid
LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = a.appid
LEFT JOIN ops.sync_status sync ON sync.appid = a.appid
LEFT JOIN legacy.app_steam_deck sd ON sd.appid = a.appid
LEFT JOIN publisher_primary publisher ON publisher.appid = a.appid
LEFT JOIN developer_primary developer ON developer.appid = a.appid
LEFT JOIN publisher_score_avgs psa ON psa.publisher_id = publisher.publisher_id
LEFT JOIN taxonomy ON taxonomy.appid = a.appid
WHERE COALESCE(a.is_released, false) = true
  AND COALESCE(a.is_delisted, false) = false
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_appid
  ON metrics.apps_page_projection (appid);

CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_type_ccu
  ON metrics.apps_page_projection (type, ccu_peak DESC NULLS LAST, appid);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_type_reviews
  ON metrics.apps_page_projection (type, total_reviews DESC NULLS LAST, appid);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_type_value
  ON metrics.apps_page_projection (type, value_score DESC NULLS LAST, appid);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_type_momentum
  ON metrics.apps_page_projection (type, momentum_score DESC NULLS LAST, appid);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_type_vs_publisher
  ON metrics.apps_page_projection (type, vs_publisher_avg DESC NULLS LAST, appid);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_type_release_date
  ON metrics.apps_page_projection (type, release_date DESC NULLS LAST, appid);

CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_genres
  ON metrics.apps_page_projection USING gin (genre_ids);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_tags
  ON metrics.apps_page_projection USING gin (tag_ids);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_categories
  ON metrics.apps_page_projection USING gin (category_ids);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_platforms
  ON metrics.apps_page_projection USING gin (platform_array);

CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_publisher_name
  ON metrics.apps_page_projection USING gin (publisher_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_developer_name
  ON metrics.apps_page_projection USING gin (developer_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_projection_name
  ON metrics.apps_page_projection USING gin (name_lower public.gin_trgm_ops);

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.apps_page_filter_counts AS
SELECT 'genre'::text AS filter_type, genre_id AS option_id, COUNT(*)::integer AS app_count
FROM metrics.apps_page_projection p
CROSS JOIN LATERAL unnest(p.genre_ids) genre_id
WHERE p.type = 'game'
GROUP BY genre_id
UNION ALL
SELECT 'tag'::text AS filter_type, tag_id AS option_id, COUNT(*)::integer AS app_count
FROM metrics.apps_page_projection p
CROSS JOIN LATERAL unnest(p.tag_ids) tag_id
WHERE p.type = 'game'
GROUP BY tag_id
UNION ALL
SELECT 'category'::text AS filter_type, category_id AS option_id, COUNT(*)::integer AS app_count
FROM metrics.apps_page_projection p
CROSS JOIN LATERAL unnest(p.category_ids) category_id
WHERE p.type = 'game'
GROUP BY category_id
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_apps_page_filter_counts_type_option
  ON metrics.apps_page_filter_counts (filter_type, option_id);
CREATE INDEX IF NOT EXISTS idx_metrics_apps_page_filter_counts_type_count
  ON metrics.apps_page_filter_counts (filter_type, app_count DESC);

COMMENT ON MATERIALIZED VIEW metrics.apps_page_projection IS
  'Precomputed per-app projection for the admin /apps page. Refresh after Tiger legacy/metrics sync batches.';
COMMENT ON MATERIALIZED VIEW metrics.apps_page_filter_counts IS
  'Precomputed default taxonomy option counts for the admin /apps filter UI.';

-- Initial population. This can be slow; run off peak if applying manually.
REFRESH MATERIALIZED VIEW metrics.apps_page_projection;
REFRESH MATERIALIZED VIEW metrics.apps_page_filter_counts;

-- Follow-up refreshes may use CONCURRENTLY after the initial population:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_projection;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_filter_counts;
