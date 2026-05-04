-- Restore the /apps CCU growth contract on Tiger.
--
-- Supabase /apps exposed ccu_growth_7d_percent from ccu_tier_assignments,
-- where the "7d" label is a backwards-compatible name for a 3-day vs
-- prior-3-day CCU snapshot comparison. The initial Tiger tier function only
-- assigned tiers and recent peak CCU, leaving growth null after cutover.

ALTER TABLE ops.ccu_tier_assignments
  ADD COLUMN IF NOT EXISTS ccu_growth_7d_percent numeric,
  ADD COLUMN IF NOT EXISTS ccu_growth_30d_percent numeric;

COMMENT ON COLUMN ops.ccu_tier_assignments.ccu_growth_7d_percent IS
  '3-day CCU growth: ((last 3 days avg - prior 3 days avg) / prior avg) * 100. Named 7d for backwards compatibility.';
COMMENT ON COLUMN ops.ccu_tier_assignments.ccu_growth_30d_percent IS
  '30-day CCU growth: ((last 3 days avg - 30-day baseline avg) / baseline avg) * 100.';

CREATE INDEX IF NOT EXISTS idx_ops_ccu_tier_assignments_growth_7d
  ON ops.ccu_tier_assignments (ccu_growth_7d_percent DESC NULLS LAST)
  WHERE ccu_growth_7d_percent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_ccu_tier_assignments_growth_30d
  ON ops.ccu_tier_assignments (ccu_growth_30d_percent DESC NULLS LAST)
  WHERE ccu_growth_30d_percent IS NOT NULL;

CREATE OR REPLACE FUNCTION public.recalculate_ccu_tiers()
RETURNS TABLE(tier1_count integer, tier2_count integer, tier3_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier1_count integer;
  v_tier2_count integer;
  v_tier3_count integer;
BEGIN
  WITH recent_snapshot_ccu AS (
    SELECT appid, max(player_count) AS peak_ccu
    FROM metrics.ccu_snapshots
    WHERE snapshot_time > now() - INTERVAL '7 days'
    GROUP BY appid
  ),
  recent_daily_ccu AS (
    SELECT appid, max(ccu_peak) AS peak_ccu
    FROM metrics.daily_metrics
    WHERE metric_date > CURRENT_DATE - INTERVAL '7 days'
    GROUP BY appid
  ),
  recent_ccu AS (
    SELECT
      COALESCE(s.appid, d.appid) AS appid,
      GREATEST(COALESCE(s.peak_ccu, 0), COALESCE(d.peak_ccu, 0)) AS recent_peak_ccu
    FROM recent_snapshot_ccu s
    FULL OUTER JOIN recent_daily_ccu d ON d.appid = s.appid
  ),
  release_ranks AS (
    SELECT
      appid,
      (row_number() OVER (
        ORDER BY
          CASE WHEN release_date IS NULL THEN 0 ELSE 1 END,
          release_date DESC NULLS LAST,
          appid DESC
      ))::integer AS release_rank
    FROM legacy.apps
    WHERE type = 'game'
      AND COALESCE(is_released, false) = true
      AND COALESCE(is_delisted, false) = false
      AND (
        release_date >= CURRENT_DATE - INTERVAL '1 year'
        OR release_date IS NULL
      )
  ),
  tier1_games AS (
    SELECT appid
    FROM recent_ccu
    WHERE recent_peak_ccu > 0
    ORDER BY recent_peak_ccu DESC NULLS LAST, appid ASC
    LIMIT 500
  ),
  tier2_games AS (
    SELECT r.appid
    FROM release_ranks r
    WHERE NOT EXISTS (
      SELECT 1
      FROM tier1_games t1
      WHERE t1.appid = r.appid
    )
    ORDER BY r.release_rank ASC
    LIMIT 1000
  ),
  ccu_growth AS (
    SELECT
      appid,
      CASE
        WHEN prior_3d_avg IS NULL OR prior_3d_avg = 0 THEN NULL
        ELSE ROUND(((last_3d_avg - prior_3d_avg) / prior_3d_avg) * 100, 2)
      END AS ccu_growth_7d_percent,
      CASE
        WHEN baseline_30d_avg IS NULL OR baseline_30d_avg = 0 THEN NULL
        ELSE ROUND(((last_3d_avg - baseline_30d_avg) / baseline_30d_avg) * 100, 2)
      END AS ccu_growth_30d_percent
    FROM (
      SELECT
        appid,
        AVG(player_count) FILTER (WHERE snapshot_time > now() - INTERVAL '3 days') AS last_3d_avg,
        AVG(player_count) FILTER (
          WHERE snapshot_time > now() - INTERVAL '6 days'
            AND snapshot_time <= now() - INTERVAL '3 days'
        ) AS prior_3d_avg,
        AVG(player_count) FILTER (WHERE snapshot_time > now() - INTERVAL '30 days') AS baseline_30d_avg
      FROM metrics.ccu_snapshots
      WHERE snapshot_time > now() - INTERVAL '30 days'
      GROUP BY appid
    ) growth_calcs
  ),
  tier_assignments AS (
    SELECT
      a.appid,
      CASE
        WHEN t1.appid IS NOT NULL THEN 1
        WHEN t2.appid IS NOT NULL THEN 2
        ELSE 3
      END::smallint AS ccu_tier,
      CASE
        WHEN t1.appid IS NOT NULL THEN 'top_ccu'
        WHEN t2.appid IS NOT NULL THEN 'new_release'
        ELSE 'default'
      END AS tier_reason,
      rc.recent_peak_ccu,
      rr.release_rank,
      cg.ccu_growth_7d_percent,
      cg.ccu_growth_30d_percent
    FROM legacy.apps a
    LEFT JOIN tier1_games t1 ON t1.appid = a.appid
    LEFT JOIN tier2_games t2 ON t2.appid = a.appid
    LEFT JOIN recent_ccu rc ON rc.appid = a.appid
    LEFT JOIN release_ranks rr ON rr.appid = a.appid
    LEFT JOIN ccu_growth cg ON cg.appid = a.appid
    WHERE a.type = 'game'
      AND COALESCE(a.is_released, false) = true
      AND COALESCE(a.is_delisted, false) = false
  )
  INSERT INTO ops.ccu_tier_assignments AS existing (
    appid,
    ccu_tier,
    tier_reason,
    recent_peak_ccu,
    release_rank,
    ccu_growth_7d_percent,
    ccu_growth_30d_percent,
    last_tier_change,
    updated_at
  )
  SELECT
    appid,
    ccu_tier,
    tier_reason,
    recent_peak_ccu,
    release_rank,
    ccu_growth_7d_percent,
    ccu_growth_30d_percent,
    now(),
    now()
  FROM tier_assignments
  ON CONFLICT (appid)
  DO UPDATE SET
    ccu_tier = EXCLUDED.ccu_tier,
    tier_reason = EXCLUDED.tier_reason,
    recent_peak_ccu = EXCLUDED.recent_peak_ccu,
    release_rank = EXCLUDED.release_rank,
    ccu_growth_7d_percent = EXCLUDED.ccu_growth_7d_percent,
    ccu_growth_30d_percent = EXCLUDED.ccu_growth_30d_percent,
    last_tier_change = CASE
      WHEN existing.ccu_tier IS DISTINCT FROM EXCLUDED.ccu_tier THEN now()
      ELSE existing.last_tier_change
    END,
    updated_at = now();

  SELECT
    count(*) FILTER (WHERE ccu_tier = 1)::integer,
    count(*) FILTER (WHERE ccu_tier = 2)::integer,
    count(*) FILTER (WHERE ccu_tier = 3)::integer
  INTO v_tier1_count, v_tier2_count, v_tier3_count
  FROM ops.ccu_tier_assignments;

  RETURN QUERY SELECT v_tier1_count, v_tier2_count, v_tier3_count;
END;
$$;

COMMENT ON FUNCTION public.recalculate_ccu_tiers() IS
  'Recalculates Tiger CCU tier assignments and /apps CCU growth percentages. Tier 1 = top 500 by 7-day peak CCU, Tier 2 = 1000 newest releases, Tier 3 = all other released games. Growth uses 3-day comparison windows from metrics.ccu_snapshots.';

DROP MATERIALIZED VIEW IF EXISTS metrics.apps_page_filter_counts;
DROP MATERIALIZED VIEW IF EXISTS metrics.apps_page_projection;

CREATE MATERIALIZED VIEW metrics.apps_page_projection AS
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
  cta.ccu_growth_7d_percent,
  cta.ccu_growth_30d_percent,
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

CREATE UNIQUE INDEX idx_metrics_apps_page_projection_appid
  ON metrics.apps_page_projection (appid);
CREATE INDEX idx_metrics_apps_page_projection_type_ccu
  ON metrics.apps_page_projection (type, ccu_peak DESC NULLS LAST, appid);
CREATE INDEX idx_metrics_apps_page_projection_type_reviews
  ON metrics.apps_page_projection (type, total_reviews DESC NULLS LAST, appid);
CREATE INDEX idx_metrics_apps_page_projection_type_value
  ON metrics.apps_page_projection (type, value_score DESC NULLS LAST, appid);
CREATE INDEX idx_metrics_apps_page_projection_type_momentum
  ON metrics.apps_page_projection (type, momentum_score DESC NULLS LAST, appid);
CREATE INDEX idx_metrics_apps_page_projection_type_vs_publisher
  ON metrics.apps_page_projection (type, vs_publisher_avg DESC NULLS LAST, appid);
CREATE INDEX idx_metrics_apps_page_projection_type_release_date
  ON metrics.apps_page_projection (type, release_date DESC NULLS LAST, appid);
CREATE INDEX idx_metrics_apps_page_projection_genres
  ON metrics.apps_page_projection USING gin (genre_ids);
CREATE INDEX idx_metrics_apps_page_projection_tags
  ON metrics.apps_page_projection USING gin (tag_ids);
CREATE INDEX idx_metrics_apps_page_projection_categories
  ON metrics.apps_page_projection USING gin (category_ids);
CREATE INDEX idx_metrics_apps_page_projection_platforms
  ON metrics.apps_page_projection USING gin (platform_array);
CREATE INDEX idx_metrics_apps_page_projection_publisher_name
  ON metrics.apps_page_projection USING gin (publisher_name public.gin_trgm_ops);
CREATE INDEX idx_metrics_apps_page_projection_developer_name
  ON metrics.apps_page_projection USING gin (developer_name public.gin_trgm_ops);
CREATE INDEX idx_metrics_apps_page_projection_name
  ON metrics.apps_page_projection USING gin (name_lower public.gin_trgm_ops);

CREATE MATERIALIZED VIEW metrics.apps_page_filter_counts AS
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

CREATE UNIQUE INDEX idx_metrics_apps_page_filter_counts_type_option
  ON metrics.apps_page_filter_counts (filter_type, option_id);
CREATE INDEX idx_metrics_apps_page_filter_counts_type_count
  ON metrics.apps_page_filter_counts (filter_type, app_count DESC);

COMMENT ON MATERIALIZED VIEW metrics.apps_page_projection IS
  'Precomputed active-game projection for the admin /apps page. Refresh after Tiger legacy/metrics sync batches.';
COMMENT ON MATERIALIZED VIEW metrics.apps_page_filter_counts IS
  'Precomputed default taxonomy option counts for the admin /apps filter UI.';

REFRESH MATERIALIZED VIEW metrics.apps_page_projection;
REFRESH MATERIALIZED VIEW metrics.apps_page_filter_counts;
