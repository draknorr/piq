-- Released opportunity candidates
-- Study question:
-- Which underappreciated released Steam games are showing the earliest signs
-- of a coordinated go-to-market push, and which are the best signing
-- opportunities before breakout is obvious?
--
-- Data windows used:
-- - daily_metrics: 2025-12-28 to 2026-03-26
-- - review_deltas: 2026-01-09 to 2026-03-26
-- - change_activity_bursts: 2026-03-14 to 2026-03-26
--
-- Candidate filters:
-- - released, non-delisted games only
-- - released before the recent change window starts, to avoid pure launch-week noise
-- - at least 25 total reviews
-- - at least 69.8% positive (25th percentile of released titles with review depth)
-- - below 7,154 total reviews (95th percentile)
-- - below 750,000 midpoint owners (95th percentile)
-- - at least one recent change burst

WITH recent_bursts_base AS (
  SELECT *
  FROM change_activity_bursts
  WHERE effective_at >= '2026-03-14'::timestamptz
    AND effective_at < '2026-03-27'::timestamptz
),
recent_burst_rollup AS (
  SELECT
    appid,
    COUNT(*) AS burst_count,
    COUNT(*) FILTER (WHERE include_in_high_signal) AS high_signal_bursts,
    COUNT(*) FILTER (WHERE has_related_news) AS related_news_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'commercial-move') AS commercial_move_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'release-prep') AS release_prep_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'store-refresh') AS store_refresh_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'build-activity') AS build_activity_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'platform-expansion') AS platform_expansion_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'positioning-shift') AS positioning_shift_bursts,
    SUM(event_count) AS burst_events,
    MAX(COALESCE(cardinality(source_set), 0)) AS max_sources_in_burst,
    STRING_AGG(DISTINCT story_kind, ', ' ORDER BY story_kind) AS story_kinds
  FROM recent_bursts_base
  GROUP BY appid
),
recent_source_rollup AS (
  SELECT
    rbb.appid,
    COUNT(DISTINCT src) AS distinct_sources_seen
  FROM recent_bursts_base rbb
  CROSS JOIN LATERAL unnest(rbb.source_set) AS src
  GROUP BY rbb.appid
),
publisher_support AS (
  SELECT
    ap.appid,
    COUNT(*) AS publisher_count,
    STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS publisher_names,
    MAX(COALESCE(pm.total_owners, 0)) AS strongest_publisher_owners,
    MAX(COALESCE(pm.game_count, 0)) AS strongest_publisher_game_count
  FROM app_publishers ap
  JOIN publishers p ON p.id = ap.publisher_id
  LEFT JOIN publisher_metrics pm ON pm.publisher_id = ap.publisher_id
  GROUP BY ap.appid
),
developer_rollup AS (
  SELECT
    ad.appid,
    STRING_AGG(DISTINCT d.name, ', ' ORDER BY d.name) AS developer_names
  FROM app_developers ad
  JOIN developers d ON d.id = ad.developer_id
  GROUP BY ad.appid
),
tag_rollup AS (
  SELECT
    x.appid,
    STRING_AGG(x.tag_name, ', ' ORDER BY x.rn) AS top_tags
  FROM (
    SELECT
      ast.appid,
      st.name AS tag_name,
      ROW_NUMBER() OVER (PARTITION BY ast.appid ORDER BY ast.rank NULLS LAST, st.name) AS rn
    FROM app_steam_tags ast
    JOIN steam_tags st ON st.tag_id = ast.tag_id
  ) x
  WHERE x.rn <= 5
  GROUP BY x.appid
),
genre_rollup AS (
  SELECT
    x.appid,
    STRING_AGG(x.genre_name, ', ' ORDER BY x.rn) AS genres
  FROM (
    SELECT
      ag.appid,
      sg.name AS genre_name,
      ROW_NUMBER() OVER (PARTITION BY ag.appid ORDER BY sg.name) AS rn
    FROM app_genres ag
    JOIN steam_genres sg ON sg.genre_id = ag.genre_id
  ) x
  WHERE x.rn <= 4
  GROUP BY x.appid
),
base AS (
  SELECT
    a.appid,
    a.name,
    a.release_date,
    COALESCE(ldm.price_cents, a.current_price_cents) AS price_cents,
    COALESCE(ldm.discount_percent, a.current_discount_percent) AS discount_percent,
    a.platforms,
    CASE
      WHEN jsonb_typeof(a.languages) = 'object' THEN (
        SELECT COUNT(*) FROM jsonb_object_keys(a.languages)
      )
      ELSE 0
    END AS language_count,
    CASE
      WHEN a.platforms IS NULL OR a.platforms = '' THEN 0
      ELSE cardinality(string_to_array(a.platforms, ','))
    END AS platform_count,
    COALESCE(asd.category::text, 'unknown') AS steam_deck_category,
    ldm.owners_midpoint,
    ldm.ccu_peak,
    ldm.total_reviews,
    ldm.positive_percentage,
    ldm.estimated_weekly_hours,
    COALESCE(rvs.velocity_7d, 0) AS velocity_7d,
    COALESCE(rvs.velocity_30d, 0) AS velocity_30d,
    COALESCE(rvs.reviews_added_30d, 0) AS reviews_added_30d,
    COALESCE(at.trend_30d_direction::text, 'stable') AS trend_30d_direction,
    COALESCE(at.trend_30d_change_pct, 0) AS trend_30d_change_pct,
    COALESCE(at.ccu_trend_7d_pct, 0) AS ccu_trend_7d_pct,
    rb.burst_count,
    rb.high_signal_bursts,
    rb.related_news_bursts,
    rb.commercial_move_bursts,
    rb.release_prep_bursts,
    rb.store_refresh_bursts,
    rb.build_activity_bursts,
    rb.platform_expansion_bursts,
    rb.positioning_shift_bursts,
    rb.burst_events,
    rb.max_sources_in_burst,
    rb.story_kinds,
    COALESCE(rs.distinct_sources_seen, 0) AS distinct_sources_seen,
    COALESCE(ps.publisher_count, 0) AS publisher_count,
    COALESCE(ps.publisher_names, '[no publisher linked]') AS publisher_names,
    COALESCE(ps.strongest_publisher_owners, 0) AS strongest_publisher_owners,
    COALESCE(ps.strongest_publisher_game_count, 0) AS strongest_publisher_game_count,
    COALESCE(dr.developer_names, '[no developer linked]') AS developer_names,
    COALESCE(tr.top_tags, '[no tags]') AS top_tags,
    COALESCE(gr.genres, '[no genres]') AS genres
  FROM apps a
  JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
  JOIN recent_burst_rollup rb ON rb.appid = a.appid
  LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
  LEFT JOIN app_trends at ON at.appid = a.appid
  LEFT JOIN recent_source_rollup rs ON rs.appid = a.appid
  LEFT JOIN app_steam_deck asd ON asd.appid = a.appid
  LEFT JOIN publisher_support ps ON ps.appid = a.appid
  LEFT JOIN developer_rollup dr ON dr.appid = a.appid
  LEFT JOIN tag_rollup tr ON tr.appid = a.appid
  LEFT JOIN genre_rollup gr ON gr.appid = a.appid
  WHERE a.type = 'game'
    AND a.is_released = true
    AND a.is_delisted = false
    AND COALESCE(a.release_date, DATE '1900-01-01') < DATE '2026-03-14'
    AND COALESCE(ldm.total_reviews, 0) >= 25
    AND COALESCE(ldm.positive_percentage, 0) >= 69.8
    AND COALESCE(ldm.total_reviews, 0) < 7154
    AND COALESCE(ldm.owners_midpoint, 0) < 750000
),
ranked AS (
  SELECT
    base.*,
    percent_rank() OVER (ORDER BY positive_percentage) AS pr_positive,
    percent_rank() OVER (ORDER BY total_reviews) AS pr_reviews,
    percent_rank() OVER (ORDER BY owners_midpoint) AS pr_owners,
    percent_rank() OVER (ORDER BY velocity_30d) AS pr_velocity30,
    percent_rank() OVER (ORDER BY trend_30d_change_pct) AS pr_trend30,
    percent_rank() OVER (ORDER BY strongest_publisher_owners) AS pr_publisher_strength,
    percent_rank() OVER (ORDER BY strongest_publisher_game_count) AS pr_publisher_game_count,
    percent_rank() OVER (ORDER BY burst_count) AS pr_burst_count,
    percent_rank() OVER (ORDER BY related_news_bursts) AS pr_related_news,
    percent_rank() OVER (ORDER BY distinct_sources_seen) AS pr_source_diversity,
    percent_rank() OVER (
      ORDER BY (release_prep_bursts + store_refresh_bursts + build_activity_bursts + platform_expansion_bursts + positioning_shift_bursts)
    ) AS pr_nonpricing_gtm
  FROM base
)
SELECT
  name AS game_name,
  appid,
  publisher_names,
  developer_names,
  release_date,
  total_reviews,
  ROUND(positive_percentage::numeric, 1) AS positive_pct,
  owners_midpoint,
  ccu_peak,
  ROUND(estimated_weekly_hours::numeric, 1) AS estimated_weekly_hours,
  ROUND(velocity_7d::numeric, 2) AS review_velocity_7d,
  ROUND(velocity_30d::numeric, 2) AS review_velocity_30d,
  ROUND(trend_30d_change_pct::numeric, 2) AS trend_30d_change_pct,
  ROUND(ccu_trend_7d_pct::numeric, 2) AS ccu_trend_7d_pct,
  price_cents,
  discount_percent,
  language_count,
  platform_count,
  steam_deck_category,
  burst_count,
  high_signal_bursts,
  related_news_bursts,
  distinct_sources_seen,
  commercial_move_bursts,
  release_prep_bursts,
  store_refresh_bursts,
  build_activity_bursts,
  platform_expansion_bursts,
  positioning_shift_bursts,
  burst_events,
  max_sources_in_burst,
  story_kinds,
  top_tags,
  genres,
  strongest_publisher_owners,
  strongest_publisher_game_count,
  ROUND((100 * (0.35 * pr_positive + 0.20 * pr_reviews + 0.25 * pr_velocity30 + 0.20 * pr_trend30))::numeric, 1) AS product_strength_score,
  ROUND((100 * (0.30 * pr_burst_count + 0.25 * pr_related_news + 0.20 * pr_source_diversity + 0.25 * pr_nonpricing_gtm))::numeric, 1) AS coordination_score,
  ROUND((100 * (1 - (0.70 * pr_publisher_strength + 0.30 * pr_publisher_game_count)))::numeric, 1) AS support_gap_score,
  ROUND((
    100 * (
      CASE
        WHEN owners_midpoint > 0 THEN 1 - (0.60 * pr_owners + 0.40 * pr_reviews)
        ELSE 1 - pr_reviews
      END
    )
  )::numeric, 1) AS underappreciated_score,
  ROUND((
    100 * (
      0.35 * (0.35 * pr_positive + 0.20 * pr_reviews + 0.25 * pr_velocity30 + 0.20 * pr_trend30) +
      0.30 * (0.30 * pr_burst_count + 0.25 * pr_related_news + 0.20 * pr_source_diversity + 0.25 * pr_nonpricing_gtm) +
      0.20 * (1 - (0.70 * pr_publisher_strength + 0.30 * pr_publisher_game_count)) +
      0.15 * (
        CASE
          WHEN owners_midpoint > 0 THEN 1 - (0.60 * pr_owners + 0.40 * pr_reviews)
          ELSE 1 - pr_reviews
        END
      )
    )
  )::numeric, 1) AS final_score
FROM ranked
ORDER BY final_score DESC, burst_count DESC, velocity_30d DESC;
