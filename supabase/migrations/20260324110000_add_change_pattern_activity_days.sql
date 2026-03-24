-- Migration: Add an app-day pattern projection for fast change-pattern chat queries
-- Purpose:
--   1. Replace request-time pattern regrouping over change_activity_bursts with a smaller daily rollup.
--   2. Keep the existing chat RPC shape for change-pattern candidates.
--   3. Let the existing projection_refresh worker maintain both burst and pattern read models.

CREATE TABLE IF NOT EXISTS public.change_pattern_activity_days (
  appid INTEGER NOT NULL REFERENCES public.apps(appid) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  app_name TEXT NOT NULL,
  app_type public.app_type,
  is_released BOOLEAN,
  release_date DATE,
  latest_occurred_at TIMESTAMPTZ NOT NULL,
  burst_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  signal_families TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  story_kinds TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  announcement_count INTEGER NOT NULL DEFAULT 0,
  total_bursts INTEGER NOT NULL DEFAULT 0,
  release_count INTEGER NOT NULL DEFAULT 0,
  pricing_count INTEGER NOT NULL DEFAULT 0,
  store_page_count INTEGER NOT NULL DEFAULT 0,
  media_count INTEGER NOT NULL DEFAULT 0,
  taxonomy_count INTEGER NOT NULL DEFAULT 0,
  platform_count INTEGER NOT NULL DEFAULT 0,
  build_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (appid, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_change_pattern_activity_days_activity_date
  ON public.change_pattern_activity_days(activity_date DESC, app_type, latest_occurred_at DESC, appid DESC);

CREATE INDEX IF NOT EXISTS idx_change_pattern_activity_days_appid_activity_date
  ON public.change_pattern_activity_days(appid, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_change_pattern_activity_days_app_name_trgm
  ON public.change_pattern_activity_days USING GIN (app_name gin_trgm_ops);

COMMENT ON TABLE public.change_pattern_activity_days IS
  'App-day rollup of grouped change activity used for fast pattern/prospecting chat queries.';

CREATE OR REPLACE FUNCTION public.refresh_change_pattern_activity_days_for_app(
  p_appid INTEGER,
  p_lookback_days INTEGER DEFAULT 180
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ := NOW() - make_interval(days => GREATEST(COALESCE(p_lookback_days, 180), 1));
  v_inserted INTEGER := 0;
BEGIN
  IF p_appid IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.change_pattern_activity_days
  WHERE appid = p_appid
    AND activity_date >= (v_window_start AT TIME ZONE 'UTC')::DATE;

  WITH burst_window AS (
    SELECT
      cab.appid,
      cab.app_name,
      cab.app_type,
      cab.is_released,
      cab.release_date,
      cab.effective_at,
      cab.burst_id,
      cab.signal_families,
      cab.story_kind,
      cab.related_news_count
    FROM public.change_activity_bursts cab
    WHERE cab.appid = p_appid
      AND cab.effective_at >= v_window_start
  ),
  daily_base AS (
    SELECT
      bw.appid,
      (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
      MAX(bw.app_name) AS app_name,
      MAX(bw.app_type) AS app_type,
      BOOL_OR(COALESCE(bw.is_released, FALSE)) AS is_released,
      MAX(bw.release_date) AS release_date,
      MAX(bw.effective_at) AS latest_occurred_at,
      SUM(COALESCE(bw.related_news_count, 0))::INTEGER AS announcement_count,
      COUNT(*)::INTEGER AS total_bursts,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['release']::TEXT[])::INTEGER AS release_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['pricing']::TEXT[])::INTEGER AS pricing_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['store-page']::TEXT[])::INTEGER AS store_page_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['media']::TEXT[])::INTEGER AS media_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['taxonomy']::TEXT[])::INTEGER AS taxonomy_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['platform']::TEXT[])::INTEGER AS platform_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['build']::TEXT[])::INTEGER AS build_count
    FROM burst_window bw
    GROUP BY bw.appid, (bw.effective_at AT TIME ZONE 'UTC')::DATE
  ),
  daily_burst_ids AS (
    SELECT
      bw.appid,
      (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
      (ARRAY_AGG(bw.burst_id ORDER BY bw.effective_at DESC, bw.burst_id DESC))[1:8] AS burst_ids
    FROM burst_window bw
    GROUP BY bw.appid, (bw.effective_at AT TIME ZONE 'UTC')::DATE
  ),
  daily_signal_families AS (
    SELECT
      ranked.appid,
      ranked.activity_date,
      ARRAY_AGG(
        ranked.signal_family
        ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
      ) AS signal_families
    FROM (
      SELECT DISTINCT
        bw.appid,
        (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
        signal_family
      FROM burst_window bw
      CROSS JOIN LATERAL UNNEST(bw.signal_families) AS signal_family
    ) AS ranked
    GROUP BY ranked.appid, ranked.activity_date
  ),
  daily_story_kinds AS (
    SELECT
      ranked.appid,
      ranked.activity_date,
      ARRAY_AGG(ranked.story_kind ORDER BY ranked.story_kind) AS story_kinds
    FROM (
      SELECT DISTINCT
        bw.appid,
        (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
        bw.story_kind
      FROM burst_window bw
    ) AS ranked
    GROUP BY ranked.appid, ranked.activity_date
  ),
  upserted AS (
    INSERT INTO public.change_pattern_activity_days (
      appid,
      activity_date,
      app_name,
      app_type,
      is_released,
      release_date,
      latest_occurred_at,
      burst_ids,
      signal_families,
      story_kinds,
      announcement_count,
      total_bursts,
      release_count,
      pricing_count,
      store_page_count,
      media_count,
      taxonomy_count,
      platform_count,
      build_count
    )
    SELECT
      db.appid,
      db.activity_date,
      db.app_name,
      db.app_type,
      db.is_released,
      db.release_date,
      db.latest_occurred_at,
      COALESCE(dbi.burst_ids, ARRAY[]::TEXT[]),
      COALESCE(dsf.signal_families, ARRAY[]::TEXT[]),
      COALESCE(dst.story_kinds, ARRAY[]::TEXT[]),
      db.announcement_count,
      db.total_bursts,
      db.release_count,
      db.pricing_count,
      db.store_page_count,
      db.media_count,
      db.taxonomy_count,
      db.platform_count,
      db.build_count
    FROM daily_base db
    LEFT JOIN daily_burst_ids dbi
      ON dbi.appid = db.appid
     AND dbi.activity_date = db.activity_date
    LEFT JOIN daily_signal_families dsf
      ON dsf.appid = db.appid
     AND dsf.activity_date = db.activity_date
    LEFT JOIN daily_story_kinds dst
      ON dst.appid = db.appid
     AND dst.activity_date = db.activity_date
    ON CONFLICT (appid, activity_date) DO UPDATE
    SET
      app_name = EXCLUDED.app_name,
      app_type = EXCLUDED.app_type,
      is_released = EXCLUDED.is_released,
      release_date = EXCLUDED.release_date,
      latest_occurred_at = EXCLUDED.latest_occurred_at,
      burst_ids = EXCLUDED.burst_ids,
      signal_families = EXCLUDED.signal_families,
      story_kinds = EXCLUDED.story_kinds,
      announcement_count = EXCLUDED.announcement_count,
      total_bursts = EXCLUDED.total_bursts,
      release_count = EXCLUDED.release_count,
      pricing_count = EXCLUDED.pricing_count,
      store_page_count = EXCLUDED.store_page_count,
      media_count = EXCLUDED.media_count,
      taxonomy_count = EXCLUDED.taxonomy_count,
      platform_count = EXCLUDED.platform_count,
      build_count = EXCLUDED.build_count,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted
  FROM upserted;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_change_pattern_candidates(
  p_pattern TEXT,
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
  positive_percentage DOUBLE PRECISION,
  total_reviews INTEGER,
  ccu_peak INTEGER,
  price_cents INTEGER,
  discount_percent INTEGER,
  review_velocity_7d DOUBLE PRECISION,
  review_velocity_30d DOUBLE PRECISION,
  trend_30d_direction TEXT,
  ccu_trend_7d_pct DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH request_config AS (
    SELECT
      COALESCE(NULLIF(BTRIM(p_pattern), ''), 'generic') AS requested_pattern,
      GREATEST(COALESCE(p_days, 30), 1) AS days,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN NULL::TEXT[]
        ELSE p_app_types
      END AS requested_app_types,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1), 120) AS requested_limit
  ),
  window_rows AS (
    SELECT
      cpad.*
    FROM public.change_pattern_activity_days cpad
    CROSS JOIN request_config rc
    WHERE cpad.activity_date >= CURRENT_DATE - GREATEST(rc.days - 1, 0)
      AND (
        rc.requested_app_types IS NULL
        OR cpad.app_type::TEXT = ANY (rc.requested_app_types)
      )
      AND (
        rc.requested_search IS NULL
        OR cpad.app_name ILIKE '%' || rc.requested_search || '%'
      )
  ),
  ranked_bursts AS (
    SELECT
      wr.appid,
      burst.burst_id,
      ROW_NUMBER() OVER (
        PARTITION BY wr.appid
        ORDER BY wr.latest_occurred_at DESC, burst.ordinality
      ) AS burst_rank
    FROM window_rows wr
    CROSS JOIN LATERAL UNNEST(wr.burst_ids) WITH ORDINALITY AS burst(burst_id, ordinality)
  ),
  grouped_activity_ids AS (
    SELECT
      rb.appid,
      ARRAY_AGG(rb.burst_id ORDER BY rb.burst_rank) FILTER (WHERE rb.burst_rank <= 3) AS activity_ids
    FROM ranked_bursts rb
    GROUP BY rb.appid
  ),
  grouped_signal_families AS (
    SELECT
      ranked.appid,
      ARRAY_AGG(
        ranked.signal_family
        ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
      ) AS signal_families
    FROM (
      SELECT DISTINCT
        wr.appid,
        signal_family
      FROM window_rows wr
      CROSS JOIN LATERAL UNNEST(wr.signal_families) AS signal_family
    ) AS ranked
    GROUP BY ranked.appid
  ),
  grouped_story_kinds AS (
    SELECT
      ranked.appid,
      ARRAY_AGG(ranked.story_kind ORDER BY ranked.story_kind) AS story_kinds
    FROM (
      SELECT DISTINCT
        wr.appid,
        story_kind
      FROM window_rows wr
      CROSS JOIN LATERAL UNNEST(wr.story_kinds) AS story_kind
    ) AS ranked
    GROUP BY ranked.appid
  ),
  grouped_base AS (
    SELECT
      wr.appid,
      MAX(wr.app_name) AS app_name,
      MAX(wr.app_type) AS app_type,
      BOOL_OR(COALESCE(wr.is_released, FALSE)) AS is_released,
      MAX(wr.release_date) AS release_date,
      MAX(wr.latest_occurred_at) AS latest_occurred_at,
      SUM(wr.announcement_count)::INTEGER AS announcement_count,
      SUM(wr.total_bursts)::INTEGER AS change_count,
      SUM(wr.release_count)::INTEGER AS release_count,
      SUM(wr.pricing_count)::INTEGER AS pricing_count,
      SUM(wr.store_page_count)::INTEGER AS store_page_count,
      SUM(wr.media_count)::INTEGER AS media_count,
      SUM(wr.taxonomy_count)::INTEGER AS taxonomy_count,
      SUM(wr.platform_count)::INTEGER AS platform_count,
      SUM(wr.build_count)::INTEGER AS build_count
    FROM window_rows wr
    GROUP BY wr.appid
  ),
  grouped AS (
    SELECT
      gb.appid,
      gb.app_name,
      gb.app_type::TEXT AS app_type,
      gb.is_released,
      gb.release_date,
      gb.latest_occurred_at,
      COALESCE(gai.activity_ids, ARRAY[]::TEXT[]) AS activity_ids,
      COALESCE(gsf.signal_families, ARRAY[]::TEXT[]) AS signal_families,
      COALESCE(gsk.story_kinds, ARRAY[]::TEXT[]) AS story_kinds,
      gb.announcement_count,
      gb.change_count,
      gb.release_count,
      gb.pricing_count,
      gb.store_page_count,
      gb.media_count,
      gb.taxonomy_count,
      gb.platform_count,
      gb.build_count
    FROM grouped_base gb
    LEFT JOIN grouped_activity_ids gai ON gai.appid = gb.appid
    LEFT JOIN grouped_signal_families gsf ON gsf.appid = gb.appid
    LEFT JOIN grouped_story_kinds gsk ON gsk.appid = gb.appid
  ),
  joined AS (
    SELECT
      g.*,
      ldm.positive_percentage,
      ldm.total_reviews,
      ldm.ccu_peak,
      ldm.price_cents,
      ldm.discount_percent,
      trends.review_velocity_7d,
      trends.review_velocity_30d,
      trends.trend_30d_direction,
      trends.ccu_trend_7d_pct
    FROM grouped g
    LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = g.appid
    LEFT JOIN public.app_trends trends ON trends.appid = g.appid
  ),
  scored AS (
    SELECT
      j.*,
      CASE rc.requested_pattern
        WHEN 'marketing_push' THEN
          CASE
            WHEN j.pricing_count > 0
              AND (j.store_page_count + j.media_count) > 0
              AND j.announcement_count > 0
              THEN 170
                + LEAST(j.change_count, 6) * 6
                + LEAST(j.announcement_count, 6) * 8
                + LEAST(j.store_page_count + j.media_count, 6) * 6
            ELSE 0
          END
        WHEN 'relaunch_pattern' THEN
          CASE
            WHEN j.pricing_count > 0
              AND (j.store_page_count + j.media_count) > 0
              AND (j.release_count > 0 OR j.announcement_count > 0)
              THEN 175
                + LEAST(j.change_count, 6) * 6
                + LEAST(j.announcement_count, 6) * 8
                + LEAST(j.release_count, 4) * 10
            ELSE 0
          END
        WHEN 'update_tease' THEN
          CASE
            WHEN j.announcement_count > 0
              AND (j.store_page_count + j.media_count) > 0
              AND j.build_count = 0
              THEN 160
                + LEAST(j.announcement_count, 6) * 8
                + LEAST(j.store_page_count + j.media_count, 6) * 6
            ELSE 0
          END
        WHEN 'under_marketed' THEN
          CASE
            WHEN j.build_count > 0
              AND (j.store_page_count + j.media_count) = 0
              AND j.announcement_count = 0
              THEN 150
                + CASE WHEN COALESCE(j.positive_percentage, 0) >= 80 THEN 20 ELSE 0 END
                + CASE WHEN COALESCE(j.total_reviews, 0) >= 200 THEN 15 ELSE 0 END
                + CASE WHEN COALESCE(j.review_velocity_30d, 0) >= 1 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'signable_candidate' THEN
          CASE
            WHEN j.build_count > 0
              AND (j.store_page_count + j.media_count) = 0
              THEN 145
                + CASE WHEN COALESCE(j.positive_percentage, 0) >= 85 THEN 25 ELSE 0 END
                + CASE WHEN COALESCE(j.total_reviews, 0) >= 300 THEN 20 ELSE 0 END
                + CASE WHEN COALESCE(j.review_velocity_30d, 0) >= 1 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'rescue_candidate' THEN
          CASE
            WHEN j.pricing_count > 0
              AND (
                j.trend_30d_direction = 'down'
                OR COALESCE(j.ccu_trend_7d_pct, 0) < 0
              )
              THEN 145
                + CASE WHEN COALESCE(j.total_reviews, 0) >= 100 THEN 15 ELSE 0 END
                + CASE WHEN COALESCE(j.positive_percentage, 0) >= 70 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'sustained_response' THEN
          CASE
            WHEN j.announcement_count > 0 OR j.change_count >= 2
              THEN 135
                + LEAST(j.announcement_count, 6) * 8
                + LEAST(j.change_count, 6) * 6
            ELSE 0
          END
        ELSE 100 + LEAST(j.change_count, 8) * 5
      END AS pattern_score
    FROM joined j
    CROSS JOIN request_config rc
  )
  SELECT
    s.appid,
    s.app_name,
    s.app_type,
    s.is_released,
    s.release_date,
    s.latest_occurred_at,
    s.activity_ids,
    s.signal_families,
    s.story_kinds,
    s.announcement_count,
    s.change_count,
    s.positive_percentage,
    s.total_reviews,
    s.ccu_peak,
    s.price_cents,
    s.discount_percent,
    s.review_velocity_7d,
    s.review_velocity_30d,
    s.trend_30d_direction,
    s.ccu_trend_7d_pct
  FROM scored s
  WHERE s.pattern_score > 0
  ORDER BY s.pattern_score DESC, s.latest_occurred_at DESC, COALESCE(s.total_reviews, 0) DESC, s.appid DESC
  LIMIT (SELECT requested_limit FROM request_config);
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_change_pattern_activity_days_for_app(INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_chat_change_pattern_candidates(TEXT, INTEGER, TEXT[], TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_chat_change_pattern_candidates(TEXT, INTEGER, TEXT[], TEXT, INTEGER) FROM anon;

GRANT EXECUTE ON FUNCTION public.refresh_change_pattern_activity_days_for_app(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_change_pattern_candidates(TEXT, INTEGER, TEXT[], TEXT, INTEGER) TO authenticated, service_role;
