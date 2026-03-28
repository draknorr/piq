-- Phase 3: Catalog control and reporting semantics
-- - Track latest successful applist membership without deleting historical rows
-- - Rebase admin/dashboard catalog denominators onto the current live applist
-- - Expose catalog control stats for admin visibility

ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS last_seen_in_steam_applist_at TIMESTAMPTZ;

COMMENT ON COLUMN public.apps.last_seen_in_steam_applist_at IS
  'Timestamp token from the latest applist run that observed this app in Steam IStoreService/GetAppList.';

CREATE INDEX IF NOT EXISTS idx_apps_last_seen_in_steam_applist_at
  ON public.apps(last_seen_in_steam_applist_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.get_current_catalog_appids()
RETURNS TABLE(appid INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_successful_applist AS (
    SELECT j.started_at
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'completed'
      AND COALESCE(j.items_failed, 0) = 0
    ORDER BY j.started_at DESC
    LIMIT 1
  ),
  catalog_ready AS (
    SELECT EXISTS(
      SELECT 1
      FROM public.apps a
      JOIN latest_successful_applist l
        ON a.last_seen_in_steam_applist_at = l.started_at
    ) AS ready
  )
  SELECT a.appid
  FROM public.apps a
  JOIN latest_successful_applist l
    ON a.last_seen_in_steam_applist_at = l.started_at
  CROSS JOIN catalog_ready cr
  WHERE cr.ready = TRUE

  UNION

  SELECT s.appid
  FROM public.sync_status s
  CROSS JOIN catalog_ready cr
  WHERE cr.ready = FALSE
    AND s.is_syncable = TRUE;
$$;

COMMENT ON FUNCTION public.get_current_catalog_appids() IS
  'Returns appids in the current live catalog. Falls back to syncable apps until the first clean applist snapshot exists.';

CREATE OR REPLACE FUNCTION public.get_catalog_control_stats()
RETURNS TABLE(
  current_catalog_apps BIGINT,
  historical_retained_apps BIGINT,
  latest_live_app_count BIGINT,
  live_only_missing BIGINT,
  stale_running_applist_jobs BIGINT,
  latest_applist_started_at TIMESTAMPTZ,
  latest_applist_completed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_successful_applist AS (
    SELECT
      j.started_at,
      j.completed_at,
      COALESCE(j.items_processed, 0)::BIGINT AS live_app_count
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'completed'
      AND COALESCE(j.items_failed, 0) = 0
    ORDER BY j.started_at DESC
    LIMIT 1
  )
  SELECT
    cc.current_catalog_count,
    GREATEST(dbx.db_app_count - cc.current_catalog_count, 0),
    COALESCE(latest_successful_applist.live_app_count, cc.current_catalog_count),
    GREATEST(
      COALESCE(latest_successful_applist.live_app_count, cc.current_catalog_count) - cc.current_catalog_count,
      0
    ),
    sj.stale_running_count,
    latest_successful_applist.started_at,
    latest_successful_applist.completed_at
  FROM (
    SELECT COUNT(*)::BIGINT AS current_catalog_count
    FROM public.get_current_catalog_appids()
  ) AS cc
  CROSS JOIN (
    SELECT COUNT(*)::BIGINT AS db_app_count
    FROM public.apps
  ) AS dbx
  CROSS JOIN (
    SELECT COUNT(*)::BIGINT AS stale_running_count
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'running'
      AND j.started_at < NOW() - INTERVAL '1 hour'
  ) AS sj
  LEFT JOIN latest_successful_applist ON TRUE;
$$;

COMMENT ON FUNCTION public.get_catalog_control_stats() IS
  'Returns current-vs-historical catalog counts and applist control-plane health derived from the latest successful applist snapshot.';

CREATE OR REPLACE FUNCTION public.get_fully_completed_apps_count()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::BIGINT
  FROM public.get_current_catalog_appids() c
  JOIN public.sync_status s ON s.appid = c.appid
  WHERE s.last_steamspy_sync IS NOT NULL
    AND s.last_storefront_sync IS NOT NULL
    AND s.last_reviews_sync IS NOT NULL
    AND s.last_histogram_sync IS NOT NULL;
$$;

COMMENT ON FUNCTION public.get_fully_completed_apps_count() IS
  'Returns the count of current-catalog apps that have synced all required Phase 3 admin data sources at least once.';

CREATE OR REPLACE FUNCTION public.refresh_dashboard_stats()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.dashboard_stats_cache (
    id,
    apps_count,
    publishers_count,
    developers_count,
    pics_synced,
    categories_count,
    genres_count,
    tags_count,
    franchises_count,
    parent_app_count,
    updated_at
  )
  SELECT
    'main',
    (SELECT COUNT(*) FROM public.get_current_catalog_appids()),
    (SELECT COUNT(*) FROM public.publishers),
    (SELECT COUNT(*) FROM public.developers),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_pics_sync IS NOT NULL
    ),
    (
      SELECT COUNT(DISTINCT ac.appid)
      FROM public.app_categories ac
      JOIN public.get_current_catalog_appids() c ON c.appid = ac.appid
    ),
    (
      SELECT COUNT(DISTINCT ag.appid)
      FROM public.app_genres ag
      JOIN public.get_current_catalog_appids() c ON c.appid = ag.appid
    ),
    (
      SELECT COUNT(DISTINCT ast.appid)
      FROM public.app_steam_tags ast
      JOIN public.get_current_catalog_appids() c ON c.appid = ast.appid
    ),
    (
      SELECT COUNT(DISTINCT af.appid)
      FROM public.app_franchises af
      JOIN public.get_current_catalog_appids() c ON c.appid = af.appid
    ),
    (
      SELECT COUNT(*)
      FROM public.apps a
      JOIN public.get_current_catalog_appids() c ON c.appid = a.appid
      WHERE a.parent_appid IS NOT NULL
    ),
    NOW()
  ON CONFLICT (id) DO UPDATE SET
    apps_count = EXCLUDED.apps_count,
    publishers_count = EXCLUDED.publishers_count,
    developers_count = EXCLUDED.developers_count,
    pics_synced = EXCLUDED.pics_synced,
    categories_count = EXCLUDED.categories_count,
    genres_count = EXCLUDED.genres_count,
    tags_count = EXCLUDED.tags_count,
    franchises_count = EXCLUDED.franchises_count,
    parent_app_count = EXCLUDED.parent_app_count,
    updated_at = NOW();
$$;

CREATE OR REPLACE FUNCTION public.get_pics_data_stats()
RETURNS TABLE(
  total_apps BIGINT,
  with_pics_sync BIGINT,
  with_categories BIGINT,
  with_genres BIGINT,
  with_tags BIGINT,
  with_franchises BIGINT,
  with_parent_app BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cached_data RECORD;
BEGIN
  SELECT * INTO cached_data FROM public.dashboard_stats_cache WHERE id = 'main';

  IF cached_data IS NOT NULL AND cached_data.apps_count > 0 THEN
    RETURN QUERY
    SELECT
      cached_data.apps_count,
      cached_data.pics_synced,
      cached_data.categories_count,
      cached_data.genres_count,
      cached_data.tags_count,
      cached_data.franchises_count,
      cached_data.parent_app_count;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.get_current_catalog_appids()),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_pics_sync IS NOT NULL
    ),
    (
      SELECT COUNT(DISTINCT ac.appid)
      FROM public.app_categories ac
      JOIN public.get_current_catalog_appids() c ON c.appid = ac.appid
    ),
    (
      SELECT COUNT(DISTINCT ag.appid)
      FROM public.app_genres ag
      JOIN public.get_current_catalog_appids() c ON c.appid = ag.appid
    ),
    (
      SELECT COUNT(DISTINCT ast.appid)
      FROM public.app_steam_tags ast
      JOIN public.get_current_catalog_appids() c ON c.appid = ast.appid
    ),
    (
      SELECT COUNT(DISTINCT af.appid)
      FROM public.app_franchises af
      JOIN public.get_current_catalog_appids() c ON c.appid = af.appid
    ),
    (
      SELECT COUNT(*)
      FROM public.apps a
      JOIN public.get_current_catalog_appids() c ON c.appid = a.appid
      WHERE a.parent_appid IS NOT NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_source_completion_stats()
RETURNS TABLE(
  source TEXT,
  total_apps BIGINT,
  synced_apps BIGINT,
  stale_apps BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_steamspy_total BIGINT;
  v_one_day_ago TIMESTAMPTZ := NOW() - INTERVAL '1 day';
  v_seven_days_ago TIMESTAMPTZ := NOW() - INTERVAL '7 days';
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM public.get_current_catalog_appids();

  SELECT COUNT(*) INTO v_steamspy_total
  FROM public.get_current_catalog_appids() c
  JOIN public.sync_status s ON s.appid = c.appid
  WHERE s.steamspy_available IS NULL OR s.steamspy_available = TRUE;

  RETURN QUERY
  SELECT
    'steamspy'::TEXT,
    v_steamspy_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE (s.steamspy_available IS NULL OR s.steamspy_available = TRUE)
        AND s.last_steamspy_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE (s.steamspy_available IS NULL OR s.steamspy_available = TRUE)
        AND s.last_steamspy_sync IS NOT NULL
        AND s.last_steamspy_sync < v_one_day_ago
    )
  UNION ALL
  SELECT
    'storefront'::TEXT,
    v_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_storefront_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_storefront_sync IS NOT NULL
        AND s.last_storefront_sync < v_one_day_ago
    )
  UNION ALL
  SELECT
    'reviews'::TEXT,
    v_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_reviews_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_reviews_sync IS NOT NULL
        AND s.last_reviews_sync < v_one_day_ago
    )
  UNION ALL
  SELECT
    'histogram'::TEXT,
    v_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_histogram_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_histogram_sync IS NOT NULL
        AND s.last_histogram_sync < v_seven_days_ago
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_current_catalog_appids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_catalog_appids() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_catalog_control_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_control_stats() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_fully_completed_apps_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fully_completed_apps_count() TO service_role;

REVOKE EXECUTE ON FUNCTION public.refresh_dashboard_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_dashboard_stats() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_pics_data_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pics_data_stats() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_source_completion_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_source_completion_stats() TO service_role;
