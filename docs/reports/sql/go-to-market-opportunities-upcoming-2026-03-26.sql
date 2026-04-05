-- Prerelease-state watchlist candidates
-- Study question:
-- Which Steam titles still marked as prerelease are showing early signs of a
-- coordinated go-to-market push, while still looking signable rather than
-- already fully commercialized by a major publisher?
--
-- Data windows used:
-- - change_activity_bursts: 2026-03-14 to 2026-03-26
-- - released market reference: 2025-12-28 to 2026-03-26 via latest_daily_metrics
--
-- Candidate filters:
-- - Steam prerelease-state games only
-- - recent change activity required
-- - strongest linked publisher capped at 200,000 total owners to avoid obvious
--   major-publisher titles in the first-pass signing watchlist

WITH released_market AS (
  SELECT
    a.appid,
    ldm.owners_midpoint,
    ldm.total_reviews,
    COALESCE(rvs.velocity_30d, 0) AS velocity_30d
  FROM apps a
  JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
  WHERE a.type = 'game'
    AND a.is_released = true
    AND a.is_delisted = false
    AND COALESCE(ldm.total_reviews, 0) >= 25
),
genre_market_reference AS (
  SELECT
    ag.genre_id,
    AVG(rm.owners_midpoint) AS avg_owners,
    AVG(rm.total_reviews) AS avg_reviews,
    AVG(rm.velocity_30d) AS avg_velocity_30d
  FROM app_genres ag
  JOIN released_market rm ON rm.appid = ag.appid
  GROUP BY ag.genre_id
),
app_genre_market AS (
  SELECT
    ag.appid,
    AVG(gmr.avg_owners) AS genre_market_owners,
    AVG(gmr.avg_reviews) AS genre_market_reviews,
    AVG(gmr.avg_velocity_30d) AS genre_market_velocity
  FROM app_genres ag
  JOIN genre_market_reference gmr ON gmr.genre_id = ag.genre_id
  GROUP BY ag.appid
),
recent_bursts AS (
  SELECT
    appid,
    COUNT(*) AS burst_count,
    COUNT(*) FILTER (WHERE has_related_news) AS related_news_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'release-prep') AS release_prep_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'store-refresh') AS store_refresh_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'build-activity') AS build_activity_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'platform-expansion') AS platform_expansion_bursts,
    COUNT(*) FILTER (WHERE story_kind = 'positioning-shift') AS positioning_shift_bursts,
    COUNT(DISTINCT source) AS distinct_sources_seen
  FROM change_activity_bursts cab
  CROSS JOIN LATERAL unnest(cab.source_set) AS source
  WHERE cab.effective_at >= '2026-03-14'::timestamptz
    AND cab.effective_at < '2026-03-27'::timestamptz
  GROUP BY appid
),
publisher_support AS (
  SELECT
    ap.appid,
    MAX(COALESCE(pm.total_owners, 0)) AS strongest_publisher_owners,
    MAX(COALESCE(pm.game_count, 0)) AS strongest_publisher_game_count,
    STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS publisher_names
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
    a.release_date_raw,
    COALESCE(a.release_state, '[null]') AS release_state,
    CASE
      WHEN a.release_date > CURRENT_DATE THEN 'future-dated prerelease'
      WHEN a.release_date IS NULL THEN 'prerelease with no date'
      ELSE 'past-date prerelease'
    END AS state_bucket,
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
    rb.burst_count,
    rb.related_news_bursts,
    rb.release_prep_bursts,
    rb.store_refresh_bursts,
    rb.build_activity_bursts,
    rb.platform_expansion_bursts,
    rb.positioning_shift_bursts,
    rb.distinct_sources_seen,
    COALESCE(agm.genre_market_owners, 0) AS genre_market_owners,
    COALESCE(agm.genre_market_reviews, 0) AS genre_market_reviews,
    COALESCE(agm.genre_market_velocity, 0) AS genre_market_velocity,
    COALESCE(ps.strongest_publisher_owners, 0) AS strongest_publisher_owners,
    COALESCE(ps.strongest_publisher_game_count, 0) AS strongest_publisher_game_count,
    COALESCE(ps.publisher_names, '[no publisher linked]') AS publisher_names,
    COALESCE(dr.developer_names, '[no developer linked]') AS developer_names,
    COALESCE(tr.top_tags, '[no tags]') AS top_tags,
    COALESCE(gr.genres, '[no genres]') AS genres
  FROM apps a
  JOIN recent_bursts rb ON rb.appid = a.appid
  LEFT JOIN app_genre_market agm ON agm.appid = a.appid
  LEFT JOIN publisher_support ps ON ps.appid = a.appid
  LEFT JOIN developer_rollup dr ON dr.appid = a.appid
  LEFT JOIN tag_rollup tr ON tr.appid = a.appid
  LEFT JOIN genre_rollup gr ON gr.appid = a.appid
  WHERE a.type = 'game'
    AND a.is_delisted = false
    AND COALESCE(a.release_state, '') = 'prerelease'
    AND COALESCE(ps.strongest_publisher_owners, 0) <= 200000
),
ranked AS (
  SELECT
    base.*,
    percent_rank() OVER (ORDER BY burst_count) AS pr_bursts,
    percent_rank() OVER (ORDER BY related_news_bursts) AS pr_news,
    percent_rank() OVER (ORDER BY distinct_sources_seen) AS pr_sources,
    percent_rank() OVER (
      ORDER BY (release_prep_bursts + store_refresh_bursts + build_activity_bursts + platform_expansion_bursts + positioning_shift_bursts)
    ) AS pr_coordination,
    percent_rank() OVER (ORDER BY genre_market_owners) AS pr_market_owners,
    percent_rank() OVER (ORDER BY genre_market_reviews) AS pr_market_reviews,
    percent_rank() OVER (ORDER BY genre_market_velocity) AS pr_market_velocity,
    percent_rank() OVER (ORDER BY strongest_publisher_owners) AS pr_publisher_strength,
    percent_rank() OVER (ORDER BY strongest_publisher_game_count) AS pr_publisher_game_count,
    percent_rank() OVER (ORDER BY language_count) AS pr_languages,
    percent_rank() OVER (ORDER BY platform_count) AS pr_platforms
  FROM base
)
SELECT
  name AS game_name,
  appid,
  release_date,
  release_date_raw,
  release_state,
  state_bucket,
  publisher_names,
  developer_names,
  burst_count,
  related_news_bursts,
  distinct_sources_seen,
  release_prep_bursts,
  store_refresh_bursts,
  build_activity_bursts,
  platform_expansion_bursts,
  positioning_shift_bursts,
  language_count,
  platform_count,
  genre_market_owners,
  genre_market_reviews,
  ROUND(genre_market_velocity::numeric, 2) AS genre_market_velocity,
  strongest_publisher_owners,
  strongest_publisher_game_count,
  genres,
  top_tags,
  ROUND((100 * (0.25 * pr_bursts + 0.20 * pr_news + 0.20 * pr_sources + 0.35 * pr_coordination))::numeric, 1) AS coordination_score,
  ROUND((100 * (0.40 * pr_market_owners + 0.30 * pr_market_reviews + 0.30 * pr_market_velocity))::numeric, 1) AS market_attractiveness_score,
  ROUND((100 * (1 - (0.70 * pr_publisher_strength + 0.30 * pr_publisher_game_count)))::numeric, 1) AS support_gap_score,
  ROUND((100 * (0.60 * pr_languages + 0.40 * pr_platforms))::numeric, 1) AS readiness_score,
  ROUND((
    100 * (
      0.45 * (0.25 * pr_bursts + 0.20 * pr_news + 0.20 * pr_sources + 0.35 * pr_coordination) +
      0.30 * (0.40 * pr_market_owners + 0.30 * pr_market_reviews + 0.30 * pr_market_velocity) +
      0.15 * (1 - (0.70 * pr_publisher_strength + 0.30 * pr_publisher_game_count)) +
      0.10 * (0.60 * pr_languages + 0.40 * pr_platforms)
    )
  )::numeric, 1) AS final_score
FROM ranked
ORDER BY final_score DESC, burst_count DESC, related_news_bursts DESC;
