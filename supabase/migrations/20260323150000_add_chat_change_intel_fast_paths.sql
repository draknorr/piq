-- Migration: Add chat-specific change-intelligence fast paths
-- Purpose:
--   1. Provide a bounded cross-game burst surface for chat change discovery.
--   2. Provide a bounded per-app candidate surface for pattern ranking.

CREATE OR REPLACE FUNCTION public.get_chat_change_activity_candidates(
  p_days INTEGER DEFAULT 30,
  p_view TEXT DEFAULT 'overview',
  p_sort TEXT DEFAULT 'relevant',
  p_app_types TEXT[] DEFAULT NULL,
  p_signal_families TEXT[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (
  burst_id TEXT,
  appid INTEGER,
  app_name TEXT,
  app_type TEXT,
  is_released BOOLEAN,
  release_date DATE,
  effective_at TIMESTAMPTZ,
  burst_started_at TIMESTAMPTZ,
  burst_ended_at TIMESTAMPTZ,
  event_count INTEGER,
  source_set TEXT[],
  headline_change_types TEXT[],
  change_type_count INTEGER,
  has_related_news BOOLEAN,
  related_news_count INTEGER,
  signal_families TEXT[],
  story_kind TEXT,
  sort_score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 30), 1) AS days,
      COALESCE(NULLIF(BTRIM(p_view), ''), 'overview') AS requested_view,
      COALESCE(NULLIF(BTRIM(p_sort), ''), 'relevant') AS requested_sort,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN NULL::TEXT[]
        ELSE p_app_types
      END AS requested_app_types,
      CASE
        WHEN p_signal_families IS NULL OR CARDINALITY(p_signal_families) = 0 THEN NULL::TEXT[]
        ELSE ARRAY(
          SELECT DISTINCT family
          FROM unnest(p_signal_families) AS family
          WHERE family <> 'announcement'
          ORDER BY 1
        )
      END AS requested_signal_families,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) AS requested_limit
  ),
  request_plan AS (
    SELECT
      rc.*,
      CASE
        WHEN rc.requested_view = 'launch-watch' THEN 'upcoming_radar'
        WHEN rc.requested_search IS NOT NULL THEN 'all_changes'
        WHEN rc.requested_signal_families IS NOT NULL THEN 'all_changes'
        WHEN rc.requested_view IN ('commercial-moves', 'store-refreshes', 'all-activity') THEN 'all_changes'
        ELSE 'high_signal'
      END AS burst_preset,
      LEAST(GREATEST(rc.requested_limit * 6, 50), 100) AS internal_limit
    FROM request_config rc
  ),
  base_bursts AS (
    SELECT b.*
    FROM request_plan rp
    CROSS JOIN LATERAL public.get_change_feed_bursts(
      rp.days,
      rp.burst_preset,
      rp.requested_app_types,
      rp.requested_search,
      NULL,
      NULL,
      NULL,
      rp.internal_limit
    ) AS b
  ),
  classified_bursts AS (
    SELECT
      bb.*,
      COALESCE(
        signal_match.signal_families,
        ARRAY[]::TEXT[]
      ) AS signal_families
    FROM base_bursts bb
    LEFT JOIN LATERAL (
      SELECT ARRAY(
        SELECT family
        FROM unnest(
          ARRAY['release', 'pricing', 'store-page', 'media', 'taxonomy', 'platform', 'build']::TEXT[]
        ) AS family
        WHERE EXISTS (
          SELECT 1
          FROM public.app_change_events e
          WHERE e.appid = bb.appid
            AND e.source IN ('storefront', 'pics', 'media')
            AND e.occurred_at >= bb.burst_started_at
            AND e.occurred_at <= bb.burst_ended_at
            AND CASE family
              WHEN 'release' THEN e.change_type::TEXT = 'release_date_text_change'
              WHEN 'pricing' THEN e.change_type::TEXT = ANY (
                ARRAY[
                  'price_change',
                  'discount_start',
                  'discount_end',
                  'dlc_references_changed',
                  'package_references_changed'
                ]::TEXT[]
              )
              WHEN 'store-page' THEN e.change_type::TEXT = ANY (
                ARRAY['description_rewrite', 'short_description_rewrite']::TEXT[]
              )
              WHEN 'media' THEN e.change_type::TEXT = ANY (
                ARRAY[
                  'capsule_url_changed',
                  'header_url_changed',
                  'background_url_changed',
                  'screenshot_added',
                  'screenshot_removed',
                  'screenshot_reordered',
                  'trailer_added',
                  'trailer_removed',
                  'trailer_reordered',
                  'trailer_thumbnail_changed'
                ]::TEXT[]
              )
              WHEN 'taxonomy' THEN e.change_type::TEXT = ANY (
                ARRAY[
                  'tags_added',
                  'tags_removed',
                  'genres_changed',
                  'categories_changed',
                  'publisher_association_changed',
                  'developer_association_changed'
                ]::TEXT[]
              )
              WHEN 'platform' THEN e.change_type::TEXT = ANY (
                ARRAY[
                  'languages_changed',
                  'platforms_changed',
                  'controller_support_changed',
                  'steam_deck_status_changed'
                ]::TEXT[]
              )
              WHEN 'build' THEN e.change_type::TEXT = ANY (
                ARRAY['build_id_changed', 'last_content_update_changed']::TEXT[]
              )
              ELSE FALSE
            END
        )
        ORDER BY CASE family
          WHEN 'release' THEN 1
          WHEN 'pricing' THEN 2
          WHEN 'store-page' THEN 3
          WHEN 'media' THEN 4
          WHEN 'taxonomy' THEN 5
          WHEN 'platform' THEN 6
          WHEN 'build' THEN 7
          ELSE 99
        END
      ) AS signal_families
    ) AS signal_match ON TRUE
  ),
  filtered_bursts AS (
    SELECT
      cb.*,
      CASE
        WHEN cb.signal_families && ARRAY['release']::TEXT[]
          OR cb.is_released = FALSE
          OR (cb.release_date IS NOT NULL AND cb.release_date >= CURRENT_DATE - INTERVAL '30 days')
          THEN 'release-prep'
        WHEN cb.signal_families && ARRAY['pricing']::TEXT[]
          THEN 'commercial-move'
        WHEN cb.signal_families && ARRAY['store-page', 'media']::TEXT[]
          THEN 'store-refresh'
        WHEN cb.signal_families && ARRAY['taxonomy']::TEXT[]
          THEN 'positioning-shift'
        WHEN cb.signal_families && ARRAY['platform']::TEXT[]
          THEN 'platform-expansion'
        WHEN cb.signal_families && ARRAY['build']::TEXT[]
          THEN 'build-activity'
        ELSE 'general-update'
      END AS story_kind
    FROM classified_bursts cb
    CROSS JOIN request_plan rp
    WHERE (
      rp.requested_signal_families IS NULL
      OR cb.signal_families && rp.requested_signal_families
    )
      AND CASE rp.requested_view
        WHEN 'launch-watch' THEN
          cb.is_released = FALSE
          OR (
            cb.release_date IS NOT NULL
            AND cb.release_date >= CURRENT_DATE - INTERVAL '30 days'
          )
          OR cb.signal_families && ARRAY['release']::TEXT[]
        WHEN 'commercial-moves' THEN
          cb.signal_families && ARRAY['pricing']::TEXT[]
        WHEN 'store-refreshes' THEN
          cb.signal_families && ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[]
        ELSE TRUE
      END
  ),
  scored_bursts AS (
    SELECT
      fb.*,
      CASE rp.requested_sort
        WHEN 'newest' THEN EXTRACT(EPOCH FROM fb.effective_at)
        WHEN 'biggest-change' THEN (
          fb.event_count * 6
          + fb.change_type_count * 8
          + CARDINALITY(COALESCE(fb.signal_families, ARRAY[]::TEXT[])) * 6
          + CASE WHEN fb.has_related_news THEN 8 ELSE 0 END
        )::DOUBLE PRECISION
        WHEN 'most-commercial' THEN (
          CASE WHEN fb.signal_families && ARRAY['pricing']::TEXT[] THEN 100 ELSE 0 END
          + fb.related_news_count * 10
          + fb.event_count * 4
          + fb.change_type_count * 4
        )::DOUBLE PRECISION
        WHEN 'most-launch-relevant' THEN (
          CASE
            WHEN fb.signal_families && ARRAY['release']::TEXT[]
              OR fb.is_released = FALSE
              OR (
                fb.release_date IS NOT NULL
                AND fb.release_date >= CURRENT_DATE - INTERVAL '30 days'
              )
              THEN 110
            ELSE 0
          END
          + fb.related_news_count * 10
          + fb.event_count * 4
        )::DOUBLE PRECISION
        ELSE (
          CASE fb.story_kind
            WHEN 'release-prep' THEN 42
            WHEN 'commercial-move' THEN 38
            WHEN 'store-refresh' THEN 32
            WHEN 'positioning-shift' THEN 30
            WHEN 'platform-expansion' THEN 28
            WHEN 'build-activity' THEN 14
            ELSE 20
          END
          + fb.event_count * 6
          + fb.change_type_count * 4
          + fb.related_news_count * 6
        )::DOUBLE PRECISION
      END AS sort_score
    FROM filtered_bursts fb
    CROSS JOIN request_plan rp
  )
  SELECT
    sb.burst_id,
    sb.appid,
    sb.app_name,
    sb.app_type,
    sb.is_released,
    sb.release_date,
    sb.effective_at,
    sb.burst_started_at,
    sb.burst_ended_at,
    sb.event_count,
    sb.source_set,
    sb.headline_change_types,
    sb.change_type_count,
    sb.has_related_news,
    sb.related_news_count,
    sb.signal_families,
    sb.story_kind,
    sb.sort_score
  FROM scored_bursts sb
  CROSS JOIN request_plan rp
  ORDER BY sb.sort_score DESC NULLS LAST, sb.effective_at DESC, sb.burst_id DESC
  LIMIT (SELECT requested_limit FROM request_plan);
$$;

CREATE OR REPLACE FUNCTION public.get_chat_change_pattern_candidates(
  p_pattern TEXT DEFAULT NULL,
  p_days INTEGER DEFAULT 30,
  p_app_types TEXT[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  appid INTEGER,
  app_name TEXT,
  app_type TEXT,
  is_released BOOLEAN,
  release_date DATE,
  latest_occurred_at TIMESTAMPTZ,
  activity_ids TEXT[],
  signal_families TEXT[],
  story_kinds TEXT[],
  announcement_count INTEGER,
  change_count INTEGER,
  positive_percentage INTEGER,
  total_reviews INTEGER,
  ccu_peak INTEGER,
  price_cents INTEGER,
  discount_percent INTEGER,
  review_velocity_7d NUMERIC,
  review_velocity_30d NUMERIC,
  trend_30d_direction TEXT,
  ccu_trend_7d_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 30), 1) AS days,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN NULL::TEXT[]
        ELSE p_app_types
      END AS requested_app_types,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100) AS requested_limit,
      COALESCE(NULLIF(BTRIM(p_pattern), ''), 'generic') AS requested_pattern
  ),
  request_plan AS (
    SELECT
      rc.*,
      LEAST(
        GREATEST(
          CASE
            WHEN rc.requested_pattern = 'sustained_response' THEN rc.requested_limit * 10
            ELSE rc.requested_limit * 8
          END,
          60
        ),
        100
      ) AS internal_limit
    FROM request_config rc
  ),
  candidate_bursts AS (
    SELECT
      c.*,
      'change:' || c.burst_id AS activity_id,
      ROW_NUMBER() OVER (
        PARTITION BY c.appid
        ORDER BY c.effective_at DESC, c.burst_id DESC
      ) AS app_row_num
    FROM request_plan rp
    CROSS JOIN LATERAL public.get_chat_change_activity_candidates(
      rp.days,
      'all-activity',
      'newest',
      rp.requested_app_types,
      NULL,
      rp.requested_search,
      rp.internal_limit
    ) AS c
  ),
  candidate_signal_families AS (
    SELECT
      cb.appid,
      family
    FROM candidate_bursts cb
    CROSS JOIN LATERAL unnest(cb.signal_families) AS family
  ),
  grouped_candidates AS (
    SELECT
      cb.appid,
      MAX(cb.effective_at) AS latest_occurred_at,
      ARRAY_AGG(cb.activity_id ORDER BY cb.effective_at DESC, cb.burst_id DESC)
        FILTER (WHERE cb.app_row_num <= 3) AS activity_ids,
      ARRAY_AGG(DISTINCT cb.story_kind ORDER BY cb.story_kind) AS story_kinds,
      SUM(CASE WHEN cb.has_related_news THEN 1 ELSE 0 END)::INTEGER AS announcement_count,
      COUNT(*)::INTEGER AS change_count
    FROM candidate_bursts cb
    GROUP BY cb.appid
  ),
  grouped_signal_families AS (
    SELECT
      ordered_families.appid,
      ARRAY_AGG(ordered_families.family ORDER BY ordered_families.sort_order) AS signal_families
    FROM (
      SELECT DISTINCT
        csf.appid,
        csf.family,
        CASE csf.family
          WHEN 'release' THEN 1
          WHEN 'pricing' THEN 2
          WHEN 'store-page' THEN 3
          WHEN 'media' THEN 4
          WHEN 'taxonomy' THEN 5
          WHEN 'platform' THEN 6
          WHEN 'build' THEN 7
          ELSE 99
        END AS sort_order
      FROM candidate_signal_families csf
    ) AS ordered_families
    GROUP BY ordered_families.appid
  )
  SELECT
    gc.appid,
    a.name AS app_name,
    a.type::TEXT AS app_type,
    a.is_released,
    a.release_date,
    gc.latest_occurred_at,
    COALESCE(gc.activity_ids, ARRAY[]::TEXT[]) AS activity_ids,
    COALESCE(gsf.signal_families, ARRAY[]::TEXT[]) AS signal_families,
    COALESCE(gc.story_kinds, ARRAY[]::TEXT[]) AS story_kinds,
    gc.announcement_count,
    gc.change_count,
    ldm.positive_percentage,
    ldm.total_reviews,
    ldm.ccu_peak,
    ldm.price_cents,
    ldm.discount_percent,
    at.review_velocity_7d,
    at.review_velocity_30d,
    at.trend_30d_direction::TEXT,
    at.ccu_trend_7d_pct
  FROM grouped_candidates gc
  JOIN public.apps a ON a.appid = gc.appid
  LEFT JOIN grouped_signal_families gsf ON gsf.appid = gc.appid
  LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = gc.appid
  LEFT JOIN public.app_trends at ON at.appid = gc.appid
  CROSS JOIN request_plan rp
  ORDER BY gc.latest_occurred_at DESC, gc.appid DESC
  LIMIT (SELECT requested_limit FROM request_plan);
$$;

REVOKE ALL ON FUNCTION public.get_chat_change_activity_candidates(
  INTEGER,
  TEXT,
  TEXT,
  TEXT[],
  TEXT[],
  TEXT,
  INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_change_activity_candidates(
  INTEGER,
  TEXT,
  TEXT,
  TEXT[],
  TEXT[],
  TEXT,
  INTEGER
) TO service_role;

REVOKE ALL ON FUNCTION public.get_chat_change_pattern_candidates(
  TEXT,
  INTEGER,
  TEXT[],
  TEXT,
  INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_change_pattern_candidates(
  TEXT,
  INTEGER,
  TEXT[],
  TEXT,
  INTEGER
) TO service_role;
