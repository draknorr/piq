-- Migration: Add a projection-backed change activity read model
-- Purpose:
--   1. Replace request-time cross-game burst derivation with a durable projection.
--   2. Keep grouped change IDs stable while making cross-game chat and /changes reads bounded.
--   3. Maintain the projection via the existing change-intel queue worker using app-scoped refresh jobs.

ALTER TYPE public.app_capture_source ADD VALUE IF NOT EXISTS 'projection_refresh';

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.change_signal_sort_rank(
  p_signal_family TEXT
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_signal_family, '')
    WHEN 'release' THEN 1
    WHEN 'pricing' THEN 2
    WHEN 'store-page' THEN 3
    WHEN 'media' THEN 4
    WHEN 'taxonomy' THEN 5
    WHEN 'platform' THEN 6
    WHEN 'announcement' THEN 7
    WHEN 'build' THEN 8
    ELSE 99
  END;
$$;

CREATE OR REPLACE FUNCTION public.change_type_signal_family(
  p_change_type TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_change_type, '')
    WHEN 'release_date_text_change' THEN 'release'
    WHEN 'price_change' THEN 'pricing'
    WHEN 'discount_start' THEN 'pricing'
    WHEN 'discount_end' THEN 'pricing'
    WHEN 'dlc_references_changed' THEN 'pricing'
    WHEN 'package_references_changed' THEN 'pricing'
    WHEN 'description_rewrite' THEN 'store-page'
    WHEN 'short_description_rewrite' THEN 'store-page'
    WHEN 'capsule_url_changed' THEN 'media'
    WHEN 'header_url_changed' THEN 'media'
    WHEN 'background_url_changed' THEN 'media'
    WHEN 'screenshot_added' THEN 'media'
    WHEN 'screenshot_removed' THEN 'media'
    WHEN 'screenshot_reordered' THEN 'media'
    WHEN 'trailer_added' THEN 'media'
    WHEN 'trailer_removed' THEN 'media'
    WHEN 'trailer_reordered' THEN 'media'
    WHEN 'trailer_thumbnail_changed' THEN 'media'
    WHEN 'tags_added' THEN 'taxonomy'
    WHEN 'tags_removed' THEN 'taxonomy'
    WHEN 'genres_changed' THEN 'taxonomy'
    WHEN 'categories_changed' THEN 'taxonomy'
    WHEN 'publisher_association_changed' THEN 'taxonomy'
    WHEN 'developer_association_changed' THEN 'taxonomy'
    WHEN 'languages_changed' THEN 'platform'
    WHEN 'platforms_changed' THEN 'platform'
    WHEN 'controller_support_changed' THEN 'platform'
    WHEN 'steam_deck_status_changed' THEN 'platform'
    WHEN 'news_published' THEN 'announcement'
    WHEN 'news_edited' THEN 'announcement'
    WHEN 'build_id_changed' THEN 'build'
    WHEN 'last_content_update_changed' THEN 'build'
    ELSE 'store-page'
  END;
$$;

CREATE OR REPLACE FUNCTION public.change_type_label(
  p_change_type TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_change_type, '')
    WHEN 'description_rewrite' THEN 'Store description'
    WHEN 'short_description_rewrite' THEN 'Short description'
    WHEN 'release_date_text_change' THEN 'Release timing'
    WHEN 'price_change' THEN 'Price'
    WHEN 'discount_start' THEN 'Discount'
    WHEN 'discount_end' THEN 'Discount'
    WHEN 'tags_added' THEN 'Tags'
    WHEN 'tags_removed' THEN 'Tags'
    WHEN 'genres_changed' THEN 'Genres'
    WHEN 'categories_changed' THEN 'Categories'
    WHEN 'languages_changed' THEN 'Languages'
    WHEN 'platforms_changed' THEN 'Platforms'
    WHEN 'controller_support_changed' THEN 'Controller support'
    WHEN 'steam_deck_status_changed' THEN 'Steam Deck'
    WHEN 'publisher_association_changed' THEN 'Publisher'
    WHEN 'developer_association_changed' THEN 'Developer'
    WHEN 'dlc_references_changed' THEN 'DLC'
    WHEN 'package_references_changed' THEN 'Packages'
    WHEN 'build_id_changed' THEN 'Build'
    WHEN 'last_content_update_changed' THEN 'Content update'
    WHEN 'capsule_url_changed' THEN 'Capsule art'
    WHEN 'header_url_changed' THEN 'Header art'
    WHEN 'background_url_changed' THEN 'Background art'
    WHEN 'screenshot_added' THEN 'Screenshots'
    WHEN 'screenshot_removed' THEN 'Screenshots'
    WHEN 'screenshot_reordered' THEN 'Screenshots'
    WHEN 'trailer_added' THEN 'Trailer'
    WHEN 'trailer_removed' THEN 'Trailer'
    WHEN 'trailer_reordered' THEN 'Trailer'
    WHEN 'trailer_thumbnail_changed' THEN 'Trailer art'
    ELSE INITCAP(REPLACE(COALESCE(p_change_type, 'activity'), '_', ' '))
  END;
$$;

CREATE OR REPLACE FUNCTION public.change_story_kind(
  p_signal_families TEXT[],
  p_is_released BOOLEAN,
  p_release_date DATE
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['release']::TEXT[]
      OR p_is_released = FALSE
      OR (
        p_release_date IS NOT NULL
        AND p_release_date >= CURRENT_DATE - 30
      )
      THEN 'release-prep'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['pricing']::TEXT[]
      THEN 'commercial-move'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['store-page', 'media']::TEXT[]
      THEN 'store-refresh'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['taxonomy']::TEXT[]
      THEN 'positioning-shift'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['platform']::TEXT[]
      THEN 'platform-expansion'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['build']::TEXT[]
      THEN 'build-activity'
    ELSE 'general-update'
  END;
$$;

CREATE OR REPLACE FUNCTION public.change_burst_id(
  p_appid INTEGER,
  p_burst_started_at TIMESTAMPTZ,
  p_burst_ended_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT FORMAT(
    '%s:%s:%s',
    p_appid,
    TO_CHAR(p_burst_started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"'),
    TO_CHAR(p_burst_ended_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"')
  );
$$;

CREATE TABLE IF NOT EXISTS public.change_activity_bursts (
  burst_id TEXT PRIMARY KEY,
  appid INTEGER NOT NULL REFERENCES public.apps(appid) ON DELETE CASCADE,
  app_name TEXT NOT NULL,
  app_type public.app_type,
  is_released BOOLEAN,
  release_date DATE,
  effective_at TIMESTAMPTZ NOT NULL,
  burst_started_at TIMESTAMPTZ NOT NULL,
  burst_ended_at TIMESTAMPTZ NOT NULL,
  event_count INTEGER NOT NULL,
  change_type_count INTEGER NOT NULL,
  source_set TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  change_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  headline_change_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  highlight_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  signal_families TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  story_kind TEXT NOT NULL,
  has_related_news BOOLEAN NOT NULL DEFAULT FALSE,
  related_news_count INTEGER NOT NULL DEFAULT 0,
  include_in_high_signal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_effective_at
  ON public.change_activity_bursts(effective_at DESC, burst_id DESC);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_appid_effective_at
  ON public.change_activity_bursts(appid, effective_at DESC, burst_id DESC);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_story_kind_effective_at
  ON public.change_activity_bursts(story_kind, effective_at DESC, burst_id DESC);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_high_signal_effective_at
  ON public.change_activity_bursts(include_in_high_signal, effective_at DESC, burst_id DESC);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_app_type_effective_at
  ON public.change_activity_bursts(app_type, effective_at DESC, burst_id DESC);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_release_date
  ON public.change_activity_bursts(release_date DESC);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_signal_families
  ON public.change_activity_bursts USING GIN (signal_families);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_headline_change_types
  ON public.change_activity_bursts USING GIN (headline_change_types);

CREATE INDEX IF NOT EXISTS idx_change_activity_bursts_app_name_trgm
  ON public.change_activity_bursts USING GIN (app_name gin_trgm_ops);

COMMENT ON TABLE public.change_activity_bursts IS
  'Projection table containing grouped per-app change bursts with denormalized metadata for chat and the Change Feed UI.';

CREATE OR REPLACE FUNCTION public.refresh_change_activity_bursts_for_app(
  p_appid INTEGER,
  p_lookback_days INTEGER DEFAULT 180
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ := NOW() - make_interval(days => GREATEST(COALESCE(p_lookback_days, 180), 1)) - INTERVAL '90 minutes';
  v_inserted INTEGER := 0;
BEGIN
  IF p_appid IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.change_activity_bursts
  WHERE appid = p_appid
    AND burst_ended_at >= v_window_start;

  WITH app_metadata AS (
    SELECT
      a.appid,
      a.name AS app_name,
      a.type AS app_type,
      a.is_released,
      a.release_date,
      COALESCE(ldm.total_reviews, 0) AS total_reviews,
      COALESCE(ldm.ccu_peak, 0) AS ccu_peak
    FROM public.apps a
    LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
    WHERE a.appid = p_appid
  ),
  classified_events AS (
    SELECT
      e.id,
      e.appid,
      e.source::TEXT AS source,
      e.change_type::TEXT AS change_type,
      e.occurred_at,
      public.change_type_signal_family(e.change_type::TEXT) AS signal_family,
      public.change_type_label(e.change_type::TEXT) AS highlight_label
    FROM public.app_change_events e
    WHERE e.appid = p_appid
      AND e.source IN ('storefront', 'pics', 'media')
      AND e.occurred_at >= v_window_start
  ),
  sequenced AS (
    SELECT
      ce.*,
      CASE
        WHEN LAG(ce.occurred_at) OVER app_window IS NULL THEN 1
        WHEN ce.occurred_at - LAG(ce.occurred_at) OVER app_window > INTERVAL '90 minutes' THEN 1
        ELSE 0
      END AS starts_new_burst
    FROM classified_events ce
    WINDOW app_window AS (PARTITION BY ce.appid ORDER BY ce.occurred_at)
  ),
  burst_members AS (
    SELECT
      s.*,
      SUM(s.starts_new_burst) OVER (
        PARTITION BY s.appid
        ORDER BY s.occurred_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS burst_number
    FROM sequenced s
  ),
  source_stats AS (
    SELECT
      bm.appid,
      bm.burst_number,
      bm.source
    FROM burst_members bm
    GROUP BY bm.appid, bm.burst_number, bm.source
  ),
  change_type_stats AS (
    SELECT
      bm.appid,
      bm.burst_number,
      bm.change_type,
      bm.signal_family,
      bm.highlight_label,
      MAX(bm.occurred_at) AS last_seen_at
    FROM burst_members bm
    GROUP BY bm.appid, bm.burst_number, bm.change_type, bm.signal_family, bm.highlight_label
  ),
  burst_core AS (
    SELECT
      bm.appid,
      bm.burst_number,
      MIN(bm.occurred_at) AS burst_started_at,
      MAX(bm.occurred_at) AS burst_ended_at,
      COUNT(*)::INTEGER AS event_count,
      COUNT(DISTINCT bm.change_type)::INTEGER AS change_type_count,
      BOOL_OR(bm.change_type NOT IN ('build_id_changed', 'last_content_update_changed')) AS has_non_technical
    FROM burst_members bm
    GROUP BY bm.appid, bm.burst_number
  ),
  projection_rows AS (
    SELECT
      public.change_burst_id(am.appid, bc.burst_started_at, bc.burst_ended_at) AS burst_id,
      am.appid,
      am.app_name,
      am.app_type,
      am.is_released,
      am.release_date,
      bc.burst_ended_at AS effective_at,
      bc.burst_started_at,
      bc.burst_ended_at,
      bc.event_count,
      bc.change_type_count,
      ARRAY(
        SELECT ss.source
        FROM source_stats ss
        WHERE ss.appid = bc.appid
          AND ss.burst_number = bc.burst_number
        ORDER BY ss.source
      ) AS source_set,
      ARRAY(
        SELECT cts.change_type
        FROM change_type_stats cts
        WHERE cts.appid = bc.appid
          AND cts.burst_number = bc.burst_number
        ORDER BY cts.last_seen_at DESC, cts.change_type
      ) AS change_types,
      ARRAY(
        SELECT cts.change_type
        FROM change_type_stats cts
        WHERE cts.appid = bc.appid
          AND cts.burst_number = bc.burst_number
        ORDER BY public.change_signal_sort_rank(cts.signal_family), cts.last_seen_at DESC, cts.change_type
        LIMIT 3
      ) AS headline_change_types,
      ARRAY(
        SELECT cts.highlight_label
        FROM change_type_stats cts
        WHERE cts.appid = bc.appid
          AND cts.burst_number = bc.burst_number
        ORDER BY public.change_signal_sort_rank(cts.signal_family), cts.last_seen_at DESC, cts.highlight_label
        LIMIT 5
      ) AS highlight_labels,
      ARRAY(
        SELECT ranked.signal_family
        FROM (
          SELECT DISTINCT cts.signal_family
          FROM change_type_stats cts
          WHERE cts.appid = bc.appid
            AND cts.burst_number = bc.burst_number
        ) AS ranked
        ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
      ) AS signal_families,
      public.change_story_kind(
        ARRAY(
          SELECT ranked.signal_family
          FROM (
            SELECT DISTINCT cts.signal_family
            FROM change_type_stats cts
            WHERE cts.appid = bc.appid
              AND cts.burst_number = bc.burst_number
          ) AS ranked
          ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
        ),
        am.is_released,
        am.release_date
      ) AS story_kind,
      COALESCE(news_match.related_news_count, 0)::INTEGER AS related_news_count,
      COALESCE(news_match.related_news_count, 0) > 0 AS has_related_news,
      CASE
        WHEN bc.has_non_technical THEN TRUE
        WHEN am.is_released = FALSE THEN TRUE
        WHEN am.release_date IS NOT NULL AND am.release_date >= CURRENT_DATE - 30 THEN TRUE
        WHEN COALESCE(news_match.related_news_count, 0) > 0 THEN TRUE
        WHEN am.total_reviews >= 250 THEN TRUE
        WHEN am.ccu_peak >= 100 THEN TRUE
        ELSE FALSE
      END AS include_in_high_signal
    FROM burst_core bc
    JOIN app_metadata am ON am.appid = bc.appid
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS related_news_count
      FROM public.steam_news_items n
      WHERE n.appid = bc.appid
        AND COALESCE(n.published_at, n.first_seen_at) >= bc.burst_started_at - INTERVAL '24 hours'
        AND COALESCE(n.published_at, n.first_seen_at) <= bc.burst_ended_at + INTERVAL '24 hours'
    ) news_match ON TRUE
  ),
  inserted AS (
    INSERT INTO public.change_activity_bursts (
      burst_id,
      appid,
      app_name,
      app_type,
      is_released,
      release_date,
      effective_at,
      burst_started_at,
      burst_ended_at,
      event_count,
      change_type_count,
      source_set,
      change_types,
      headline_change_types,
      highlight_labels,
      signal_families,
      story_kind,
      has_related_news,
      related_news_count,
      include_in_high_signal,
      updated_at
    )
    SELECT
      pr.burst_id,
      pr.appid,
      pr.app_name,
      pr.app_type,
      pr.is_released,
      pr.release_date,
      pr.effective_at,
      pr.burst_started_at,
      pr.burst_ended_at,
      pr.event_count,
      pr.change_type_count,
      COALESCE(pr.source_set, ARRAY[]::TEXT[]),
      COALESCE(pr.change_types, ARRAY[]::TEXT[]),
      COALESCE(pr.headline_change_types, ARRAY[]::TEXT[]),
      COALESCE(pr.highlight_labels, ARRAY[]::TEXT[]),
      COALESCE(pr.signal_families, ARRAY[]::TEXT[]),
      pr.story_kind,
      pr.has_related_news,
      pr.related_news_count,
      pr.include_in_high_signal,
      NOW()
    FROM projection_rows pr
    ON CONFLICT (burst_id)
    DO UPDATE SET
      app_name = EXCLUDED.app_name,
      app_type = EXCLUDED.app_type,
      is_released = EXCLUDED.is_released,
      release_date = EXCLUDED.release_date,
      effective_at = EXCLUDED.effective_at,
      burst_started_at = EXCLUDED.burst_started_at,
      burst_ended_at = EXCLUDED.burst_ended_at,
      event_count = EXCLUDED.event_count,
      change_type_count = EXCLUDED.change_type_count,
      source_set = EXCLUDED.source_set,
      change_types = EXCLUDED.change_types,
      headline_change_types = EXCLUDED.headline_change_types,
      highlight_labels = EXCLUDED.highlight_labels,
      signal_families = EXCLUDED.signal_families,
      story_kind = EXCLUDED.story_kind,
      has_related_news = EXCLUDED.has_related_news,
      related_news_count = EXCLUDED.related_news_count,
      include_in_high_signal = EXCLUDED.include_in_high_signal,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted
  FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_recent_change_activity_appids(
  p_lookback_days INTEGER DEFAULT 180,
  p_after_appid INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 1000
)
RETURNS TABLE (
  appid INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.appid
  FROM public.app_change_events e
  WHERE e.source IN ('storefront', 'pics', 'media')
    AND e.occurred_at >= NOW() - make_interval(days => GREATEST(COALESCE(p_lookback_days, 180), 1))
    AND e.appid > GREATEST(COALESCE(p_after_appid, 0), 0)
  GROUP BY e.appid
  ORDER BY e.appid
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
$$;

CREATE OR REPLACE FUNCTION public.get_change_feed_bursts(
  p_days INTEGER DEFAULT 7,
  p_preset TEXT DEFAULT 'high_signal',
  p_app_types TEXT[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_source_filter TEXT[] DEFAULT NULL,
  p_cursor_time TIMESTAMPTZ DEFAULT NULL,
  p_cursor_burst_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
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
  related_news_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 7), 1) AS days,
      COALESCE(NULLIF(BTRIM(p_preset), ''), 'high_signal') AS requested_preset,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN NULL::TEXT[]
        ELSE p_app_types
      END AS requested_app_types,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      CASE
        WHEN p_source_filter IS NULL OR CARDINALITY(p_source_filter) = 0 THEN NULL::TEXT[]
        ELSE p_source_filter
      END AS requested_source_filter,
      LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000) AS requested_limit
  )
  SELECT
    cab.burst_id,
    cab.appid,
    cab.app_name,
    cab.app_type::TEXT,
    cab.is_released,
    cab.release_date,
    cab.effective_at,
    cab.burst_started_at,
    cab.burst_ended_at,
    cab.event_count,
    cab.source_set,
    cab.headline_change_types,
    cab.change_type_count,
    cab.has_related_news,
    cab.related_news_count
  FROM public.change_activity_bursts cab
  CROSS JOIN request_config rc
  WHERE cab.effective_at >= NOW() - make_interval(days => rc.days)
    AND (
      rc.requested_app_types IS NULL
      OR cab.app_type::TEXT = ANY (rc.requested_app_types)
    )
    AND (
      rc.requested_search IS NULL
      OR cab.app_name ILIKE '%' || rc.requested_search || '%'
    )
    AND (
      rc.requested_source_filter IS NULL
      OR cab.source_set && rc.requested_source_filter
    )
    AND CASE rc.requested_preset
      WHEN 'high_signal' THEN cab.include_in_high_signal
      WHEN 'upcoming_radar' THEN
        cab.include_in_high_signal
        AND (
          cab.is_released = FALSE
          OR (
            cab.release_date IS NOT NULL
            AND cab.release_date >= CURRENT_DATE - 30
          )
        )
      WHEN 'all_changes' THEN TRUE
      ELSE cab.include_in_high_signal
    END
    AND (
      p_cursor_time IS NULL
      OR p_cursor_burst_id IS NULL
      OR (cab.effective_at, cab.burst_id) < (p_cursor_time, p_cursor_burst_id)
    )
  ORDER BY cab.effective_at DESC, cab.burst_id DESC
  LIMIT (SELECT requested_limit FROM request_config);
$$;

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
          SELECT ranked.family
          FROM (
            SELECT DISTINCT family
            FROM unnest(p_signal_families) AS family
            WHERE family <> 'announcement'
          ) AS ranked
          ORDER BY public.change_signal_sort_rank(ranked.family), ranked.family
        )
      END AS requested_signal_families,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) AS requested_limit
  ),
  filtered AS (
    SELECT
      cab.*
    FROM public.change_activity_bursts cab
    CROSS JOIN request_config rc
    WHERE cab.effective_at >= NOW() - make_interval(days => rc.days)
      AND (
        rc.requested_app_types IS NULL
        OR cab.app_type::TEXT = ANY (rc.requested_app_types)
      )
      AND (
        rc.requested_search IS NULL
        OR cab.app_name ILIKE '%' || rc.requested_search || '%'
      )
      AND (
        rc.requested_signal_families IS NULL
        OR cab.signal_families && rc.requested_signal_families
      )
      AND CASE rc.requested_view
        WHEN 'launch-watch' THEN
          cab.is_released = FALSE
          OR (
            cab.release_date IS NOT NULL
            AND cab.release_date >= CURRENT_DATE - 30
          )
          OR cab.signal_families && ARRAY['release']::TEXT[]
        WHEN 'commercial-moves' THEN
          cab.signal_families && ARRAY['pricing']::TEXT[]
        WHEN 'store-refreshes' THEN
          cab.signal_families && ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[]
        ELSE TRUE
      END
  ),
  scored AS (
    SELECT
      f.*,
      CASE rc.requested_sort
        WHEN 'newest' THEN EXTRACT(EPOCH FROM f.effective_at)
        WHEN 'biggest-change' THEN (
          f.event_count * 6
          + f.change_type_count * 8
          + CARDINALITY(COALESCE(f.signal_families, ARRAY[]::TEXT[])) * 6
          + CASE WHEN f.has_related_news THEN 8 ELSE 0 END
        )::DOUBLE PRECISION
        WHEN 'most-commercial' THEN (
          CASE WHEN f.signal_families && ARRAY['pricing']::TEXT[] THEN 100 ELSE 0 END
          + f.related_news_count * 10
          + f.event_count * 4
          + f.change_type_count * 4
        )::DOUBLE PRECISION
        WHEN 'most-launch-relevant' THEN (
          CASE
            WHEN f.signal_families && ARRAY['release']::TEXT[]
              OR f.is_released = FALSE
              OR (
                f.release_date IS NOT NULL
                AND f.release_date >= CURRENT_DATE - 30
              )
              THEN 110
            ELSE 0
          END
          + f.related_news_count * 10
          + f.event_count * 4
        )::DOUBLE PRECISION
        ELSE (
          CASE f.story_kind
            WHEN 'release-prep' THEN 42
            WHEN 'commercial-move' THEN 38
            WHEN 'store-refresh' THEN 32
            WHEN 'positioning-shift' THEN 30
            WHEN 'platform-expansion' THEN 28
            WHEN 'build-activity' THEN 14
            ELSE 20
          END
          + f.event_count * 6
          + f.change_type_count * 4
          + f.related_news_count * 6
        )::DOUBLE PRECISION
      END AS sort_score
    FROM filtered f
    CROSS JOIN request_config rc
  )
  SELECT
    s.burst_id,
    s.appid,
    s.app_name,
    s.app_type::TEXT,
    s.is_released,
    s.release_date,
    s.effective_at,
    s.burst_started_at,
    s.burst_ended_at,
    s.event_count,
    s.source_set,
    s.headline_change_types,
    s.change_type_count,
    s.has_related_news,
    s.related_news_count,
    s.signal_families,
    s.story_kind,
    s.sort_score
  FROM scored s
  ORDER BY s.sort_score DESC, s.effective_at DESC, s.burst_id DESC
  LIMIT (SELECT requested_limit FROM request_config);
$$;

DROP FUNCTION IF EXISTS public.get_chat_change_pattern_candidates(TEXT, INTEGER, TEXT[], TEXT, INTEGER);

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
      cab.*
    FROM public.change_activity_bursts cab
    CROSS JOIN request_config rc
    WHERE cab.effective_at >= NOW() - make_interval(days => rc.days)
      AND (
        rc.requested_app_types IS NULL
        OR cab.app_type::TEXT = ANY (rc.requested_app_types)
      )
      AND (
        rc.requested_search IS NULL
        OR cab.app_name ILIKE '%' || rc.requested_search || '%'
      )
  ),
  grouped AS (
    SELECT
      wr.appid,
      MAX(wr.app_name) AS app_name,
      MAX(wr.app_type)::TEXT AS app_type,
      BOOL_OR(COALESCE(wr.is_released, FALSE)) AS is_released,
      MAX(wr.release_date) AS release_date,
      MAX(wr.effective_at) AS latest_occurred_at,
      (ARRAY_AGG(wr.burst_id ORDER BY wr.effective_at DESC, wr.burst_id DESC))[1:3] AS activity_ids,
      ARRAY(
        SELECT ranked.family
        FROM (
          SELECT DISTINCT family
          FROM window_rows wr_family
          CROSS JOIN LATERAL unnest(wr_family.signal_families) AS family
          WHERE wr_family.appid = wr.appid
        ) AS ranked
        ORDER BY public.change_signal_sort_rank(ranked.family), ranked.family
      ) AS signal_families,
      ARRAY(
        SELECT ranked.story_kind
        FROM (
          SELECT DISTINCT wr_kind.story_kind
          FROM window_rows wr_kind
          WHERE wr_kind.appid = wr.appid
        ) AS ranked
        ORDER BY ranked.story_kind
      ) AS story_kinds,
      COUNT(*) FILTER (WHERE wr.has_related_news)::INTEGER AS announcement_count,
      COUNT(*)::INTEGER AS change_count,
      BOOL_OR(wr.signal_families && ARRAY['pricing']::TEXT[]) AS has_pricing,
      BOOL_OR(wr.signal_families && ARRAY['store-page', 'media']::TEXT[]) AS has_refresh,
      BOOL_OR(wr.signal_families && ARRAY['build']::TEXT[]) AS has_build,
      BOOL_OR(wr.signal_families && ARRAY['release']::TEXT[]) AS has_release,
      BOOL_OR(wr.signal_families && ARRAY['taxonomy']::TEXT[]) AS has_taxonomy,
      BOOL_OR(wr.signal_families && ARRAY['platform']::TEXT[]) AS has_platform
    FROM window_rows wr
    GROUP BY wr.appid
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
            WHEN j.has_pricing AND j.has_refresh AND j.announcement_count > 0
              THEN 160 + j.change_count * 8 + j.announcement_count * 10
            ELSE 0
          END
        WHEN 'relaunch_pattern' THEN
          CASE
            WHEN j.has_pricing AND j.has_refresh AND (j.has_release OR j.announcement_count > 0)
              THEN 170 + j.change_count * 8 + j.announcement_count * 10
            ELSE 0
          END
        WHEN 'update_tease' THEN
          CASE
            WHEN j.announcement_count > 0 AND j.has_refresh AND NOT j.has_build
              THEN 150 + j.announcement_count * 8 + j.change_count * 6
            ELSE 0
          END
        WHEN 'under_marketed' THEN
          CASE
            WHEN j.has_build AND NOT j.has_refresh AND j.announcement_count = 0
              THEN 150
                + CASE WHEN COALESCE(j.positive_percentage, 0) >= 80 THEN 20 ELSE 0 END
                + CASE WHEN COALESCE(j.total_reviews, 0) >= 200 THEN 15 ELSE 0 END
                + CASE WHEN COALESCE(j.review_velocity_30d, 0) >= 1 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'signable_candidate' THEN
          CASE
            WHEN j.has_build AND NOT j.has_refresh
              THEN 140
                + CASE WHEN COALESCE(j.positive_percentage, 0) >= 85 THEN 25 ELSE 0 END
                + CASE WHEN COALESCE(j.total_reviews, 0) >= 300 THEN 20 ELSE 0 END
                + CASE WHEN COALESCE(j.review_velocity_30d, 0) >= 1 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'rescue_candidate' THEN
          CASE
            WHEN j.has_pricing AND (
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
              THEN 130 + j.announcement_count * 8 + j.change_count * 6
            ELSE 0
          END
        ELSE 100 + j.change_count * 5
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

REVOKE EXECUTE ON FUNCTION public.change_signal_sort_rank(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_type_signal_family(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_type_label(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_story_kind(TEXT[], BOOLEAN, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_burst_id(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_change_activity_bursts_for_app(INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_recent_change_activity_appids(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_chat_change_activity_candidates(INTEGER, TEXT, TEXT, TEXT[], TEXT[], TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_chat_change_activity_candidates(INTEGER, TEXT, TEXT, TEXT[], TEXT[], TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_chat_change_pattern_candidates(TEXT, INTEGER, TEXT[], TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_chat_change_pattern_candidates(TEXT, INTEGER, TEXT[], TEXT, INTEGER) FROM anon;

GRANT EXECUTE ON FUNCTION public.refresh_change_activity_bursts_for_app(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_recent_change_activity_appids(INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_change_activity_candidates(INTEGER, TEXT, TEXT, TEXT[], TEXT[], TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_change_pattern_candidates(TEXT, INTEGER, TEXT[], TEXT, INTEGER) TO authenticated, service_role;
