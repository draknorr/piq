-- publisheriq-wow-insight-products-2026-03-26.sql
-- Research-only validation appendix.
-- Each query is a measurability check for one proposed insight product.
-- These are not final production queries. They prove the required source tables intersect meaningfully.

-- Q01 - Multi-Signal Conviction Score
SELECT COUNT(*) AS apps_with_full_signal_stack
FROM latest_daily_metrics ldm
JOIN app_trends t ON t.appid = ldm.appid
JOIN review_velocity_stats rvs ON rvs.appid = ldm.appid
LEFT JOIN (
  SELECT appid, COUNT(*) AS recent_changes
  FROM app_change_events
  WHERE occurred_at >= '2026-03-14'
  GROUP BY 1
) ce ON ce.appid = ldm.appid
LEFT JOIN (
  SELECT appid, COUNT(*) AS recent_news
  FROM steam_news_items
  WHERE first_seen_at >= '2026-03-14'
  GROUP BY 1
) ni ON ni.appid = ldm.appid
WHERE COALESCE(ce.recent_changes, 0) > 0
   OR COALESCE(ni.recent_news, 0) > 0;

-- Q02 - Hidden Breakout Detector
SELECT COUNT(*) AS candidate_pool
FROM app_filter_data afd
JOIN latest_daily_metrics ldm ON ldm.appid = afd.appid
LEFT JOIN publisher_metrics pm ON pm.publisher_id = afd.publisher_id
WHERE ldm.total_reviews >= 50
  AND COALESCE(ldm.positive_percentage, 0) >= 80
  AND (
    COALESCE(afd.momentum_score, 0) > 0
    OR COALESCE(afd.velocity_acceleration, 0) > 0
  )
  AND COALESCE(pm.game_count, 0) <= 10;

-- Q03 - Update-to-Reacceleration Signal
SELECT COUNT(DISTINCT ace.appid) AS apps_with_updates_and_followup_reviews
FROM app_change_events ace
JOIN review_deltas rd ON rd.appid = ace.appid
WHERE ace.change_type IN ('last_content_update_changed', 'build_id_changed')
  AND ace.occurred_at >= '2026-03-14'
  AND rd.delta_date >= ace.occurred_at::date;

-- Q04 - Launch Readiness Signature
SELECT COUNT(DISTINCT a.appid) AS prerelease_apps_with_market_activity
FROM apps a
LEFT JOIN app_change_events ace ON ace.appid = a.appid AND ace.occurred_at >= '2026-03-14'
LEFT JOIN steam_news_items ni ON ni.appid = a.appid AND ni.first_seen_at >= '2026-03-14'
WHERE a.type = 'game'
  AND COALESCE(a.is_released, false) = false
  AND (ace.appid IS NOT NULL OR ni.appid IS NOT NULL);

-- Q05 - Publisher Hit-Rate Model
SELECT COUNT(*) AS publishers_with_rollups
FROM publisher_metrics
WHERE game_count >= 3
  AND total_reviews IS NOT NULL
  AND total_owners IS NOT NULL;

-- Q06 - Price-to-Engagement Frontier
SELECT COUNT(*) AS priced_games_with_engagement
FROM latest_daily_metrics ldm
JOIN apps a ON a.appid = ldm.appid
WHERE ldm.price_cents IS NOT NULL
  AND ldm.estimated_weekly_hours IS NOT NULL
  AND a.type = 'game';

-- Q07 - Genre / Theme Momentum Index
SELECT change_type, COUNT(*) AS events
FROM app_change_events
WHERE occurred_at >= '2026-03-14'
  AND change_type IN ('tags_added', 'tags_removed', 'genres_changed', 'news_published', 'news_edited')
GROUP BY 1
ORDER BY 2 DESC;

-- Q08 - Discount Elasticity Map
SELECT COUNT(DISTINCT ace.appid) AS discounted_apps_with_review_history
FROM app_change_events ace
JOIN review_deltas rd ON rd.appid = ace.appid
WHERE ace.change_type IN ('discount_start', 'discount_end', 'price_change')
  AND ace.occurred_at >= '2026-03-14'
  AND rd.delta_date >= '2026-01-09';

-- Q09 - Durable vs Spiky Demand Classifier
SELECT COUNT(*) AS apps_with_multi_surface_demand_history
FROM review_velocity_stats rvs
JOIN app_trends t ON t.appid = rvs.appid
JOIN latest_daily_metrics ldm ON ldm.appid = rvs.appid
WHERE rvs.velocity_30d IS NOT NULL
  AND t.trend_30d_direction IS NOT NULL
  AND ldm.total_reviews IS NOT NULL;

-- Q10 - Investor / Acquirer Diligence Scorecard
SELECT
  (SELECT COUNT(*) FROM publisher_metrics WHERE total_reviews IS NOT NULL) AS publisher_rows,
  (SELECT COUNT(*) FROM developer_metrics WHERE total_reviews IS NOT NULL) AS developer_rows;

-- Q11 - Live Game Risk Flags
SELECT COUNT(*) AS at_risk_games
FROM app_filter_data afd
JOIN review_velocity_stats rvs ON rvs.appid = afd.appid
JOIN app_trends t ON t.appid = afd.appid
WHERE (
    COALESCE(afd.sentiment_delta, 0) < 0
    OR t.trend_30d_direction = 'down'
    OR rvs.velocity_7d < rvs.velocity_30d * 0.8
  );

-- Q12 - Portfolio Cannibalization vs Halo Map
SELECT COUNT(*) AS multi_game_publishers
FROM publisher_metrics
WHERE game_count >= 2;

-- Q13 - Developer Graduation Curve
SELECT COUNT(*) AS repeat_developers
FROM developer_metrics
WHERE game_count >= 2
  AND total_reviews IS NOT NULL;

-- Q14 - Store Rewrite / Media Refresh Signal
SELECT change_type, COUNT(*) AS events
FROM app_change_events
WHERE occurred_at >= '2026-03-14'
  AND change_type IN (
    'description_rewrite',
    'short_description_rewrite',
    'header_url_changed',
    'capsule_url_changed',
    'background_url_changed',
    'trailer_added',
    'trailer_removed',
    'screenshot_added',
    'screenshot_removed'
  )
GROUP BY 1
ORDER BY 2 DESC;

-- Q15 - Demo-to-Demand Signal
SELECT COUNT(DISTINCT ni.appid) AS apps_with_demo_language_and_demand_history
FROM steam_news_items ni
JOIN steam_news_versions nv ON nv.gid = ni.gid
JOIN review_deltas rd ON rd.appid = ni.appid
WHERE ni.first_seen_at >= '2026-03-14'
  AND (
    COALESCE(nv.title, '') ILIKE '%demo%'
    OR COALESCE(nv.contents, '') ILIKE '%demo%'
    OR COALESCE(nv.title, '') ILIKE '%playtest%'
    OR COALESCE(nv.contents, '') ILIKE '%playtest%'
  );

-- Q16 - Content Strategy Archetypes
SELECT COUNT(DISTINCT appid) AS apps_with_both_change_and_news
FROM (
  SELECT appid FROM app_change_events WHERE occurred_at >= '2026-03-14'
  INTERSECT
  SELECT appid FROM steam_news_items WHERE first_seen_at >= '2026-03-14'
) x;

-- Q17 - Supply Shock Monitor
SELECT occurred_at::date AS day_utc, change_type, COUNT(*) AS events
FROM app_change_events
WHERE occurred_at >= '2026-03-14'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC
LIMIT 200;

-- Q18 - Platform / Steam Deck Advantage
SELECT COUNT(*) AS apps_with_platform_and_deck_and_metrics
FROM app_filter_data afd
JOIN latest_daily_metrics ldm ON ldm.appid = afd.appid
WHERE afd.platform_array IS NOT NULL
  AND afd.steam_deck_category IS NOT NULL
  AND ldm.total_reviews IS NOT NULL;

-- Q19 - Publisher / Developer White-Space Map
SELECT COUNT(DISTINCT ast.tag_id) AS tracked_tags_with_company_and_metrics
FROM app_steam_tags ast
JOIN latest_daily_metrics ldm ON ldm.appid = ast.appid
JOIN app_publishers ap ON ap.appid = ast.appid
WHERE ldm.total_reviews IS NOT NULL;

-- Q20 - Market Narrative Divergence Index
SELECT COUNT(DISTINCT ni.appid) AS apps_with_news_and_metric_signal
FROM steam_news_items ni
JOIN app_trends t ON t.appid = ni.appid
JOIN review_velocity_stats rvs ON rvs.appid = ni.appid
WHERE ni.first_seen_at >= '2026-03-14';
