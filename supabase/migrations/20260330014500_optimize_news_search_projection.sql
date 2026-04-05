-- Migration: Replace full-body latest-news projection with lean search projection
-- Purpose:
--   1. Remove duplicated large text from the news topic-search projection
--   2. Switch recent topic search to shortlist gids first, then load body text
--   3. Support gid-level projection maintenance so news changes do not rewrite an app's whole history

CREATE TABLE IF NOT EXISTS public.steam_news_search_projection (
  gid TEXT PRIMARY KEY REFERENCES public.steam_news_items(gid) ON DELETE CASCADE,
  appid INTEGER NOT NULL REFERENCES public.apps(appid) ON DELETE CASCADE,
  published_at TIMESTAMPTZ NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  sort_time TIMESTAMPTZ NOT NULL,
  feed_scope TEXT NOT NULL,
  title TEXT NULL,
  search_document tsvector NOT NULL
);

COMMENT ON TABLE public.steam_news_search_projection IS
  'Lean recent-news topic-search projection. Stores only the fields needed for filtering and ranking; body text is loaded from source tables only for shortlisted gids.';

CREATE INDEX IF NOT EXISTS idx_steam_news_search_projection_search_document
  ON public.steam_news_search_projection USING GIN(search_document);

CREATE INDEX IF NOT EXISTS idx_steam_news_search_projection_feed_scope_sort_time_gid
  ON public.steam_news_search_projection(feed_scope, sort_time DESC, gid DESC);

CREATE INDEX IF NOT EXISTS idx_steam_news_search_projection_appid_sort_time
  ON public.steam_news_search_projection(appid, sort_time DESC);

CREATE OR REPLACE FUNCTION public.merge_projection_refresh_payload(
  p_existing JSONB,
  p_incoming JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  merged_payload JSONB := COALESCE(p_existing, '{}'::JSONB) || COALESCE(p_incoming, '{}'::JSONB);
  merged_news_gids TEXT[];
  merged_deleted_gids TEXT[];
BEGIN
  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO merged_news_gids
  FROM (
    SELECT gid
    FROM (
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_existing, '{}'::JSONB)->'news_gids') = 'array'
            THEN COALESCE(p_existing, '{}'::JSONB)->'news_gids'
          ELSE '[]'::JSONB
        END
      )
      UNION
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_incoming, '{}'::JSONB)->'news_gids') = 'array'
            THEN COALESCE(p_incoming, '{}'::JSONB)->'news_gids'
          ELSE '[]'::JSONB
        END
      )
    ) merged
    WHERE gid IS NOT NULL
    ORDER BY gid
    LIMIT 200
  ) deduped;

  IF CARDINALITY(merged_news_gids) > 0 THEN
    merged_payload := jsonb_set(merged_payload, '{news_gids}', to_jsonb(merged_news_gids), true);
  ELSE
    merged_payload := merged_payload - 'news_gids';
  END IF;

  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO merged_deleted_gids
  FROM (
    SELECT gid
    FROM (
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_existing, '{}'::JSONB)->'deleted_news_gids') = 'array'
            THEN COALESCE(p_existing, '{}'::JSONB)->'deleted_news_gids'
          ELSE '[]'::JSONB
        END
      )
      UNION
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_incoming, '{}'::JSONB)->'deleted_news_gids') = 'array'
            THEN COALESCE(p_incoming, '{}'::JSONB)->'deleted_news_gids'
          ELSE '[]'::JSONB
        END
      )
    ) merged
    WHERE gid IS NOT NULL
    ORDER BY gid
    LIMIT 200
  ) deduped;

  IF CARDINALITY(merged_deleted_gids) > 0 THEN
    merged_payload := jsonb_set(merged_payload, '{deleted_news_gids}', to_jsonb(merged_deleted_gids), true);
  ELSE
    merged_payload := merged_payload - 'deleted_news_gids';
  END IF;

  RETURN merged_payload;
END;
$$;

COMMENT ON FUNCTION public.merge_projection_refresh_payload(JSONB, JSONB) IS
  'Merges gid batches for coalesced projection_refresh work-state rows so repeated news changes do not overwrite pending gid payloads.';

CREATE OR REPLACE FUNCTION public.upsert_steam_news_search_projection_for_gids(
  p_gids TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_gids TEXT[];
  upserted_count INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO normalized_gids
  FROM (
    SELECT DISTINCT NULLIF(BTRIM(gid), '') AS gid
    FROM unnest(COALESCE(p_gids, ARRAY[]::TEXT[])) AS gid
    WHERE NULLIF(BTRIM(gid), '') IS NOT NULL
  ) deduped;

  IF CARDINALITY(normalized_gids) = 0 THEN
    RETURN 0;
  END IF;

  WITH latest_news AS (
    SELECT
      n.gid,
      n.appid,
      n.published_at,
      n.first_seen_at,
      COALESCE(n.published_at, n.first_seen_at) AS sort_time,
      CASE
        WHEN COALESCE(n.feedlabel, '') = 'Community Announcements' THEN 'community_announcements'
        ELSE 'external_coverage'
      END AS feed_scope,
      NULLIF(BTRIM(lv.title), '') AS title,
      setweight(to_tsvector('english', COALESCE(public.normalize_steam_news_search_text(lv.title), '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(public.normalize_steam_news_search_text(lv.contents), '')), 'B') AS search_document
    FROM unnest(normalized_gids) AS requested_gid
    JOIN public.steam_news_items n ON n.gid = requested_gid
    LEFT JOIN LATERAL (
      SELECT
        v.title,
        v.contents
      FROM public.steam_news_versions v
      WHERE v.gid = n.gid
      ORDER BY v.first_seen_at DESC, v.id DESC
      LIMIT 1
    ) lv ON TRUE
  )
  INSERT INTO public.steam_news_search_projection (
    gid,
    appid,
    published_at,
    first_seen_at,
    sort_time,
    feed_scope,
    title,
    search_document
  )
  SELECT
    gid,
    appid,
    published_at,
    first_seen_at,
    sort_time,
    feed_scope,
    title,
    search_document
  FROM latest_news
  ON CONFLICT (gid) DO UPDATE
  SET
    appid = EXCLUDED.appid,
    published_at = EXCLUDED.published_at,
    first_seen_at = EXCLUDED.first_seen_at,
    sort_time = EXCLUDED.sort_time,
    feed_scope = EXCLUDED.feed_scope,
    title = EXCLUDED.title,
    search_document = EXCLUDED.search_document;

  GET DIAGNOSTICS upserted_count = ROW_COUNT;

  DELETE FROM public.steam_news_search_projection projection
  WHERE projection.gid = ANY (normalized_gids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.steam_news_items n
      WHERE n.gid = projection.gid
    );

  RETURN upserted_count;
END;
$$;

COMMENT ON FUNCTION public.upsert_steam_news_search_projection_for_gids(TEXT[]) IS
  'Upserts lean news topic-search projection rows for the provided gids.';

CREATE OR REPLACE FUNCTION public.delete_steam_news_search_projection_for_gids(
  p_gids TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_gids TEXT[];
  deleted_count INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO normalized_gids
  FROM (
    SELECT DISTINCT NULLIF(BTRIM(gid), '') AS gid
    FROM unnest(COALESCE(p_gids, ARRAY[]::TEXT[])) AS gid
    WHERE NULLIF(BTRIM(gid), '') IS NOT NULL
  ) deduped;

  IF CARDINALITY(normalized_gids) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.steam_news_search_projection
  WHERE gid = ANY (normalized_gids);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.delete_steam_news_search_projection_for_gids(TEXT[]) IS
  'Deletes lean news topic-search projection rows for the provided gids.';

CREATE OR REPLACE FUNCTION public.refresh_steam_news_search_projection_for_app(
  p_appid INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_gids TEXT[];
  refreshed_count INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(n.gid ORDER BY n.gid), ARRAY[]::TEXT[])
  INTO app_gids
  FROM public.steam_news_items n
  WHERE n.appid = p_appid;

  IF CARDINALITY(app_gids) = 0 THEN
    DELETE FROM public.steam_news_search_projection
    WHERE appid = p_appid;
    RETURN 0;
  END IF;

  refreshed_count := public.upsert_steam_news_search_projection_for_gids(app_gids);

  DELETE FROM public.steam_news_search_projection projection
  WHERE projection.appid = p_appid
    AND NOT (projection.gid = ANY (app_gids));

  RETURN refreshed_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_steam_news_search_projection_for_app(INTEGER) IS
  'Rare full refresh path for one app''s lean news topic-search projection rows.';

CREATE OR REPLACE FUNCTION public.refresh_steam_news_latest_projection_for_app(
  p_appid INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.refresh_steam_news_search_projection_for_app(p_appid);
END;
$$;

COMMENT ON FUNCTION public.refresh_steam_news_latest_projection_for_app(INTEGER) IS
  'Compatibility wrapper that now refreshes the lean steam_news_search_projection for a single app.';

DO $$
BEGIN
  IF to_regclass('public.steam_news_latest_projection') IS NOT NULL THEN
    INSERT INTO public.steam_news_search_projection (
      gid,
      appid,
      published_at,
      first_seen_at,
      sort_time,
      feed_scope,
      title,
      search_document
    )
    SELECT
      gid,
      appid,
      published_at,
      first_seen_at,
      sort_time,
      feed_scope,
      title,
      search_document
    FROM public.steam_news_latest_projection
    ON CONFLICT (gid) DO UPDATE
    SET
      appid = EXCLUDED.appid,
      published_at = EXCLUDED.published_at,
      first_seen_at = EXCLUDED.first_seen_at,
      sort_time = EXCLUDED.sort_time,
      feed_scope = EXCLUDED.feed_scope,
      title = EXCLUDED.title,
      search_document = EXCLUDED.search_document;
  ELSE
    INSERT INTO public.steam_news_search_projection (
      gid,
      appid,
      published_at,
      first_seen_at,
      sort_time,
      feed_scope,
      title,
      search_document
    )
    SELECT
      n.gid,
      n.appid,
      n.published_at,
      n.first_seen_at,
      COALESCE(n.published_at, n.first_seen_at) AS sort_time,
      CASE
        WHEN COALESCE(n.feedlabel, '') = 'Community Announcements' THEN 'community_announcements'
        ELSE 'external_coverage'
      END AS feed_scope,
      NULLIF(BTRIM(lv.title), '') AS title,
      setweight(to_tsvector('english', COALESCE(public.normalize_steam_news_search_text(lv.title), '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(public.normalize_steam_news_search_text(lv.contents), '')), 'B') AS search_document
    FROM public.steam_news_items n
    LEFT JOIN LATERAL (
      SELECT
        v.title,
        v.contents
      FROM public.steam_news_versions v
      WHERE v.gid = n.gid
      ORDER BY v.first_seen_at DESC, v.id DESC
      LIMIT 1
    ) lv ON TRUE
    ON CONFLICT (gid) DO UPDATE
    SET
      appid = EXCLUDED.appid,
      published_at = EXCLUDED.published_at,
      first_seen_at = EXCLUDED.first_seen_at,
      sort_time = EXCLUDED.sort_time,
      feed_scope = EXCLUDED.feed_scope,
      title = EXCLUDED.title,
      search_document = EXCLUDED.search_document;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_app_capture_work_dirty(
  p_jobs JSONB DEFAULT '[]'::jsonb,
  p_cooldown_hours INTEGER DEFAULT 6
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_cooldown INTERVAL := make_interval(hours => GREATEST(COALESCE(p_cooldown_hours, 6), 1));
  v_affected INTEGER;
BEGIN
  WITH normalized_jobs AS (
    SELECT
      (job->>'appid')::INTEGER AS appid,
      (job->>'source')::app_capture_source AS source,
      job->>'trigger_reason' AS trigger_reason,
      COALESCE(job->>'trigger_cursor', '') AS trigger_cursor,
      COALESCE((job->>'priority')::INTEGER, 100) AS priority,
      COALESCE(job->'payload', '{}'::jsonb) AS payload
    FROM jsonb_array_elements(COALESCE(p_jobs, '[]'::jsonb)) AS job
  ),
  upserted AS (
    INSERT INTO app_capture_work_state (
      appid,
      source,
      priority,
      latest_trigger_reason,
      latest_trigger_cursor,
      payload,
      dirty_since,
      last_dirty_at,
      next_available_at,
      dead_lettered_at,
      last_error,
      created_at,
      updated_at
    )
    SELECT
      appid,
      source,
      priority,
      trigger_reason,
      trigger_cursor,
      payload,
      v_now,
      v_now,
      v_now,
      NULL,
      NULL,
      v_now,
      v_now
    FROM normalized_jobs
    WHERE appid IS NOT NULL
      AND source IS NOT NULL
      AND trigger_reason IS NOT NULL
    ON CONFLICT (appid, source)
    DO UPDATE
    SET priority = GREATEST(app_capture_work_state.priority, EXCLUDED.priority),
        latest_trigger_reason = EXCLUDED.latest_trigger_reason,
        latest_trigger_cursor = EXCLUDED.latest_trigger_cursor,
        payload = CASE
          WHEN app_capture_work_state.source = 'projection_refresh'
            AND app_capture_work_state.dirty_since IS NOT NULL
            THEN public.merge_projection_refresh_payload(app_capture_work_state.payload, EXCLUDED.payload)
          ELSE EXCLUDED.payload
        END,
        dirty_since = COALESCE(app_capture_work_state.dirty_since, v_now),
        last_dirty_at = v_now,
        next_available_at = CASE
          WHEN app_capture_work_state.dirty_since IS NULL THEN GREATEST(
            v_now,
            COALESCE(app_capture_work_state.last_completed_at + v_cooldown, v_now)
          )
          ELSE app_capture_work_state.next_available_at
        END,
        dead_lettered_at = NULL,
        last_error = NULL,
        attempts = CASE
          WHEN app_capture_work_state.dead_lettered_at IS NOT NULL THEN 0
          ELSE app_capture_work_state.attempts
        END,
        worker_id = CASE
          WHEN app_capture_work_state.dead_lettered_at IS NOT NULL THEN NULL
          ELSE app_capture_work_state.worker_id
        END,
        claimed_at = CASE
          WHEN app_capture_work_state.dead_lettered_at IS NOT NULL THEN NULL
          ELSE app_capture_work_state.claimed_at
        END,
        updated_at = v_now
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_affected
  FROM upserted;

  RETURN COALESCE(v_affected, 0);
END;
$$;

CREATE OR REPLACE FUNCTION complete_app_capture_work(
  p_ids BIGINT[],
  p_status app_capture_status DEFAULT 'completed',
  p_error TEXT DEFAULT NULL,
  p_cooldown_hours INTEGER DEFAULT 6
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_cooldown INTERVAL := make_interval(hours => GREATEST(COALESCE(p_cooldown_hours, 6), 1));
  v_updated INTEGER;
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'queued', 'dead_letter') THEN
    RAISE EXCEPTION 'Unsupported work completion status: %', p_status;
  END IF;

  UPDATE app_capture_work_state
  SET last_error = CASE WHEN p_status = 'completed' THEN NULL ELSE p_error END,
      worker_id = NULL,
      claimed_at = NULL,
      dead_lettered_at = CASE
        WHEN p_status = 'dead_letter' THEN v_now
        WHEN p_status IN ('completed', 'queued') THEN NULL
        ELSE dead_lettered_at
      END,
      last_completed_at = CASE
        WHEN p_status = 'completed' THEN v_now
        ELSE last_completed_at
      END,
      next_available_at = CASE
        WHEN p_status = 'completed' THEN v_now + v_cooldown
        WHEN p_status = 'queued' THEN v_now
        ELSE next_available_at
      END,
      dirty_since = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at
          THEN last_dirty_at
        WHEN p_status IN ('completed', 'dead_letter', 'failed')
          THEN NULL
        ELSE dirty_since
      END,
      last_dirty_at = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at
          THEN last_dirty_at
        WHEN p_status IN ('completed', 'dead_letter', 'failed')
          THEN NULL
        ELSE last_dirty_at
      END,
      payload = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at
          THEN payload
        WHEN p_status IN ('completed', 'dead_letter', 'failed')
          THEN '{}'::JSONB
        ELSE payload
      END,
      attempts = CASE
        WHEN p_status = 'completed' THEN 0
        ELSE attempts
      END,
      updated_at = v_now
  WHERE id = ANY (p_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_recent_news_topics(
  p_query TEXT,
  p_days INTEGER DEFAULT 30,
  p_limit INTEGER DEFAULT 10,
  p_feed_scope TEXT DEFAULT 'community_announcements',
  p_app_types TEXT[] DEFAULT ARRAY['game'],
  p_appids INTEGER[] DEFAULT NULL,
  p_aliases TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  gid TEXT,
  appid INTEGER,
  app_name TEXT,
  app_type TEXT,
  published_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ,
  sort_time TIMESTAMPTZ,
  feed_scope TEXT,
  feedlabel TEXT,
  feedname TEXT,
  title TEXT,
  url TEXT,
  excerpt TEXT,
  content_preview TEXT,
  match_reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_aliases TEXT[];
  query_text TEXT;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_query, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A recent news topic query is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.steam_news_search_projection
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'news topic projection is not available yet. Backfill the search projection first.';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT LOWER(BTRIM(term))
    FROM unnest(COALESCE(p_aliases, ARRAY[]::TEXT[]) || ARRAY[p_query]) AS term
    WHERE NULLIF(BTRIM(term), '') IS NOT NULL
    ORDER BY 1
  )
  INTO normalized_aliases;

  SELECT string_agg(format('"%s"', replace(alias, '"', '')), ' OR ')
  INTO query_text
  FROM unnest(normalized_aliases) AS alias;

  RETURN QUERY
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 30), 1) AS days,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1), 10) AS row_limit,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1) * 10, 100) AS shortlist_limit,
      CASE
        WHEN COALESCE(p_feed_scope, 'community_announcements') IN ('community_announcements', 'external_coverage', 'all')
          THEN COALESCE(p_feed_scope, 'community_announcements')
        ELSE 'community_announcements'
      END AS feed_scope,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN ARRAY['game']::TEXT[]
        ELSE p_app_types
      END AS app_types,
      normalized_aliases AS aliases,
      websearch_to_tsquery('english', COALESCE(query_text, format('"%s"', replace(BTRIM(p_query), '"', '')))) AS topic_query
  ),
  shortlisted_matches AS (
    SELECT
      projection.gid,
      projection.appid,
      current_app.type::TEXT AS app_type,
      projection.published_at,
      projection.first_seen_at,
      projection.sort_time,
      projection.feed_scope,
      projection.title,
      rc.aliases,
      rc.topic_query,
      ts_rank_cd(projection.search_document, rc.topic_query) AS ts_rank,
      EXISTS (
        SELECT 1
        FROM unnest(rc.aliases) AS alias
        WHERE LOWER(COALESCE(projection.title, '')) LIKE '%' || alias || '%'
      ) AS title_phrase_hit
    FROM public.steam_news_search_projection projection
    JOIN public.apps current_app ON current_app.appid = projection.appid
    CROSS JOIN request_config rc
    WHERE projection.sort_time >= NOW() - make_interval(days => rc.days)
      AND (
        rc.feed_scope = 'all'
        OR projection.feed_scope = rc.feed_scope
      )
      AND (
        rc.app_types IS NULL
        OR current_app.type::TEXT = ANY (rc.app_types)
      )
      AND (
        p_appids IS NULL
        OR projection.appid = ANY (p_appids)
      )
      AND projection.search_document @@ rc.topic_query
    ORDER BY
      title_phrase_hit DESC,
      ts_rank DESC,
      projection.sort_time DESC,
      projection.gid DESC
    LIMIT (SELECT shortlist_limit FROM request_config)
  ),
  enriched_matches AS (
    SELECT
      shortlist.gid,
      shortlist.appid,
      shortlist.app_type,
      shortlist.published_at,
      shortlist.first_seen_at,
      shortlist.sort_time,
      shortlist.feed_scope,
      shortlist.title,
      shortlist.aliases,
      shortlist.topic_query,
      shortlist.ts_rank,
      shortlist.title_phrase_hit,
      a.name AS app_name,
      n.feedlabel,
      n.feedname,
      COALESCE(lv.url, n.url) AS url,
      public.normalize_steam_news_search_text(lv.contents) AS body_text
    FROM shortlisted_matches shortlist
    JOIN public.apps a ON a.appid = shortlist.appid
    JOIN public.steam_news_items n ON n.gid = shortlist.gid
    LEFT JOIN LATERAL (
      SELECT
        v.contents,
        v.url
      FROM public.steam_news_versions v
      WHERE v.gid = shortlist.gid
      ORDER BY v.first_seen_at DESC, v.id DESC
      LIMIT 1
    ) lv ON TRUE
  ),
  ranked_matches AS (
    SELECT
      enriched.*,
      CONCAT_WS(' ', public.normalize_steam_news_search_text(enriched.title), enriched.body_text) AS excerpt_source,
      EXISTS (
        SELECT 1
        FROM unnest(enriched.aliases) AS alias
        WHERE LOWER(COALESCE(enriched.body_text, '')) LIKE '%' || alias || '%'
      ) AS body_phrase_hit
    FROM enriched_matches enriched
  )
  SELECT
    rm.gid,
    rm.appid,
    rm.app_name,
    rm.app_type,
    rm.published_at,
    rm.first_seen_at,
    rm.sort_time,
    rm.feed_scope,
    rm.feedlabel,
    rm.feedname,
    rm.title,
    rm.url,
    COALESCE(
      NULLIF(
        BTRIM(
          ts_headline(
            'english',
            COALESCE(rm.excerpt_source, ''),
            rm.topic_query,
            'StartSel=, StopSel=, MaxWords=24, MinWords=10, MaxFragments=2, FragmentDelimiter= … '
          )
        ),
        ''
      ),
      NULLIF(BTRIM(LEFT(COALESCE(rm.excerpt_source, ''), 260)), '')
    ) AS excerpt,
    NULLIF(BTRIM(LEFT(COALESCE(rm.excerpt_source, ''), 420)), '') AS content_preview,
    CASE
      WHEN rm.title_phrase_hit THEN 'matched title phrase'
      WHEN rm.body_phrase_hit THEN 'matched body phrase'
      ELSE 'matched topic terms'
    END AS match_reason
  FROM ranked_matches rm
  ORDER BY
    rm.title_phrase_hit DESC,
    rm.body_phrase_hit DESC,
    rm.ts_rank DESC,
    rm.sort_time DESC,
    rm.gid DESC
  LIMIT (SELECT row_limit FROM request_config);
END;
$$;

COMMENT ON FUNCTION public.search_recent_news_topics(TEXT, INTEGER, INTEGER, TEXT, TEXT[], INTEGER[], TEXT[]) IS
  'Searches recent stored Steam news text across many games for chat topic prompts using a lean gid-level search projection and body joins only for shortlisted rows.';

REVOKE EXECUTE ON FUNCTION public.merge_projection_refresh_payload(JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_projection_refresh_payload(JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_projection_refresh_payload(JSONB, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_steam_news_search_projection_for_gids(TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_steam_news_search_projection_for_gids(TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_steam_news_search_projection_for_gids(TEXT[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_steam_news_search_projection_for_gids(TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_steam_news_search_projection_for_gids(TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_steam_news_search_projection_for_gids(TEXT[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refresh_steam_news_search_projection_for_app(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_steam_news_search_projection_for_app(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_steam_news_search_projection_for_app(INTEGER) TO service_role;
