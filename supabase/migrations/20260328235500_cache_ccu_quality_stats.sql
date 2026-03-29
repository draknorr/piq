-- Cache-backed admin CCU quality stats
-- - Reuse dashboard_stats_cache instead of introducing a second admin cache table
-- - Make get_ccu_quality_stats() fast on the service-role PostgREST path
-- - Keep live aggregation for refresh jobs, not page render

ALTER TABLE public.dashboard_stats_cache
  ADD COLUMN IF NOT EXISTS ccu_current_catalog_apps BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_tier_assigned BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_no_tier_assignment BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_confirmed_positive BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_confirmed_zero BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_suspect_zero BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_skipped BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_invalid BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_unavailable BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_steam_api BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_steamspy BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_legacy_unknown BIGINT,
  ADD COLUMN IF NOT EXISTS ccu_quality_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_current_catalog_apps IS
  'Current catalog denominator used for cached admin CCU quality metrics.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_tier_assigned IS
  'Cached current-catalog apps that currently have a CCU tier assignment.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_no_tier_assignment IS
  'Cached current-catalog apps that do not currently have a CCU tier assignment.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_confirmed_positive IS
  'Cached current-catalog apps whose latest official CCU validation is confirmed_positive.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_confirmed_zero IS
  'Cached current-catalog apps whose latest official CCU validation is confirmed_zero.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_suspect_zero IS
  'Cached current-catalog apps whose latest official CCU validation is suspect_zero.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_skipped IS
  'Cached current-catalog apps currently in the invalid-but-skipped CCU state.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_invalid IS
  'Cached current-catalog apps currently in the invalid CCU state.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_unavailable IS
  'Cached current-catalog apps whose latest CCU quality state resolves to unavailable.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_steam_api IS
  'Cached current-catalog apps whose latest non-null CCU row is sourced from Steam API.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_steamspy IS
  'Cached current-catalog apps whose latest non-null CCU row is sourced from SteamSpy.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_legacy_unknown IS
  'Cached current-catalog apps whose latest non-null CCU row has null provenance.';
COMMENT ON COLUMN public.dashboard_stats_cache.ccu_quality_updated_at IS
  'Timestamp when the cached admin CCU quality metrics were last refreshed.';

CREATE OR REPLACE FUNCTION public.refresh_ccu_quality_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
  ),
  catalog_appids AS MATERIALIZED (
    SELECT a.appid
    FROM public.apps a
    JOIN latest_successful_applist l
      ON a.last_seen_in_steam_applist_at = l.started_at
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = TRUE

    UNION ALL

    SELECT s.appid
    FROM public.sync_status s
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = FALSE
      AND s.is_syncable = TRUE
  ),
  ccu_rows AS MATERIALIZED (
    SELECT
      c.appid,
      (ct.appid IS NOT NULL) AS has_tier_assignment,
      ct.last_ccu_validation_state,
      ct.ccu_fetch_status,
      ct.ccu_skip_until,
      ldm.ccu_peak,
      ldm.ccu_source
    FROM catalog_appids c
    LEFT JOIN public.ccu_tier_assignments ct
      ON ct.appid = c.appid
    LEFT JOIN public.latest_daily_metrics ldm
      ON ldm.appid = c.appid
  ),
  resolved_rows AS MATERIALIZED (
    SELECT
      appid,
      has_tier_assignment,
      CASE
        WHEN last_ccu_validation_state = 'confirmed_positive' THEN 'confirmed_positive'
        WHEN last_ccu_validation_state = 'confirmed_zero' THEN 'confirmed_zero'
        WHEN last_ccu_validation_state = 'suspect_zero' THEN 'suspect_zero'
        WHEN ccu_fetch_status = 'invalid' AND ccu_skip_until > NOW() THEN 'skipped'
        WHEN ccu_fetch_status = 'invalid' THEN 'invalid'
        ELSE 'unavailable'
      END::TEXT AS ccu_confidence_state,
      ccu_peak,
      ccu_source
    FROM ccu_rows
  ),
  aggregated AS (
    SELECT
      COUNT(*)::BIGINT AS current_catalog_apps,
      COUNT(*) FILTER (WHERE has_tier_assignment)::BIGINT AS tier_assigned,
      COUNT(*) FILTER (WHERE NOT has_tier_assignment)::BIGINT AS no_tier_assignment,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_positive')::BIGINT AS confirmed_positive,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_zero')::BIGINT AS confirmed_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'suspect_zero')::BIGINT AS suspect_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'skipped')::BIGINT AS skipped,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'invalid')::BIGINT AS invalid,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'unavailable')::BIGINT AS unavailable,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steam_api')::BIGINT AS steam_api,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steamspy')::BIGINT AS steamspy,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source IS NULL)::BIGINT AS legacy_unknown
    FROM resolved_rows
  )
  INSERT INTO public.dashboard_stats_cache (
    id,
    ccu_current_catalog_apps,
    ccu_tier_assigned,
    ccu_no_tier_assignment,
    ccu_confirmed_positive,
    ccu_confirmed_zero,
    ccu_suspect_zero,
    ccu_skipped,
    ccu_invalid,
    ccu_unavailable,
    ccu_steam_api,
    ccu_steamspy,
    ccu_legacy_unknown,
    ccu_quality_updated_at
  )
  SELECT
    'main',
    aggregated.current_catalog_apps,
    aggregated.tier_assigned,
    aggregated.no_tier_assignment,
    aggregated.confirmed_positive,
    aggregated.confirmed_zero,
    aggregated.suspect_zero,
    aggregated.skipped,
    aggregated.invalid,
    aggregated.unavailable,
    aggregated.steam_api,
    aggregated.steamspy,
    aggregated.legacy_unknown,
    NOW()
  FROM aggregated
  ON CONFLICT (id) DO UPDATE SET
    ccu_current_catalog_apps = EXCLUDED.ccu_current_catalog_apps,
    ccu_tier_assigned = EXCLUDED.ccu_tier_assigned,
    ccu_no_tier_assignment = EXCLUDED.ccu_no_tier_assignment,
    ccu_confirmed_positive = EXCLUDED.ccu_confirmed_positive,
    ccu_confirmed_zero = EXCLUDED.ccu_confirmed_zero,
    ccu_suspect_zero = EXCLUDED.ccu_suspect_zero,
    ccu_skipped = EXCLUDED.ccu_skipped,
    ccu_invalid = EXCLUDED.ccu_invalid,
    ccu_unavailable = EXCLUDED.ccu_unavailable,
    ccu_steam_api = EXCLUDED.ccu_steam_api,
    ccu_steamspy = EXCLUDED.ccu_steamspy,
    ccu_legacy_unknown = EXCLUDED.ccu_legacy_unknown,
    ccu_quality_updated_at = EXCLUDED.ccu_quality_updated_at;
END;
$$;

COMMENT ON FUNCTION public.refresh_ccu_quality_stats() IS
  'Refreshes cached current-catalog admin CCU quality stats into dashboard_stats_cache.';

REVOKE EXECUTE ON FUNCTION public.refresh_ccu_quality_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ccu_quality_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.get_ccu_quality_stats()
RETURNS TABLE(
  current_catalog_apps BIGINT,
  tier_assigned BIGINT,
  no_tier_assignment BIGINT,
  confirmed_positive BIGINT,
  confirmed_zero BIGINT,
  suspect_zero BIGINT,
  skipped BIGINT,
  invalid BIGINT,
  unavailable BIGINT,
  steam_api BIGINT,
  steamspy BIGINT,
  legacy_unknown BIGINT,
  updated_at TIMESTAMPTZ,
  data_source TEXT,
  is_approximate BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cached_data RECORD;
BEGIN
  SELECT
    d.ccu_current_catalog_apps,
    d.ccu_tier_assigned,
    d.ccu_no_tier_assignment,
    d.ccu_confirmed_positive,
    d.ccu_confirmed_zero,
    d.ccu_suspect_zero,
    d.ccu_skipped,
    d.ccu_invalid,
    d.ccu_unavailable,
    d.ccu_steam_api,
    d.ccu_steamspy,
    d.ccu_legacy_unknown,
    d.ccu_quality_updated_at
  INTO cached_data
  FROM public.dashboard_stats_cache d
  WHERE d.id = 'main';

  IF cached_data IS NOT NULL
     AND cached_data.ccu_quality_updated_at IS NOT NULL
     AND COALESCE(cached_data.ccu_current_catalog_apps, 0) > 0 THEN
    RETURN QUERY
    SELECT
      COALESCE(cached_data.ccu_current_catalog_apps, 0)::BIGINT,
      COALESCE(cached_data.ccu_tier_assigned, 0)::BIGINT,
      COALESCE(cached_data.ccu_no_tier_assignment, 0)::BIGINT,
      COALESCE(cached_data.ccu_confirmed_positive, 0)::BIGINT,
      COALESCE(cached_data.ccu_confirmed_zero, 0)::BIGINT,
      COALESCE(cached_data.ccu_suspect_zero, 0)::BIGINT,
      COALESCE(cached_data.ccu_skipped, 0)::BIGINT,
      COALESCE(cached_data.ccu_invalid, 0)::BIGINT,
      COALESCE(cached_data.ccu_unavailable, 0)::BIGINT,
      COALESCE(cached_data.ccu_steam_api, 0)::BIGINT,
      COALESCE(cached_data.ccu_steamspy, 0)::BIGINT,
      COALESCE(cached_data.ccu_legacy_unknown, 0)::BIGINT,
      cached_data.ccu_quality_updated_at,
      'cache'::TEXT,
      FALSE;
    RETURN;
  END IF;

  RETURN QUERY
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
  ),
  catalog_appids AS MATERIALIZED (
    SELECT a.appid
    FROM public.apps a
    JOIN latest_successful_applist l
      ON a.last_seen_in_steam_applist_at = l.started_at
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = TRUE

    UNION ALL

    SELECT s.appid
    FROM public.sync_status s
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = FALSE
      AND s.is_syncable = TRUE
  ),
  ccu_rows AS MATERIALIZED (
    SELECT
      c.appid,
      (ct.appid IS NOT NULL) AS has_tier_assignment,
      ct.last_ccu_validation_state,
      ct.ccu_fetch_status,
      ct.ccu_skip_until,
      ldm.ccu_peak,
      ldm.ccu_source
    FROM catalog_appids c
    LEFT JOIN public.ccu_tier_assignments ct
      ON ct.appid = c.appid
    LEFT JOIN public.latest_daily_metrics ldm
      ON ldm.appid = c.appid
  ),
  resolved_rows AS MATERIALIZED (
    SELECT
      appid,
      has_tier_assignment,
      CASE
        WHEN last_ccu_validation_state = 'confirmed_positive' THEN 'confirmed_positive'
        WHEN last_ccu_validation_state = 'confirmed_zero' THEN 'confirmed_zero'
        WHEN last_ccu_validation_state = 'suspect_zero' THEN 'suspect_zero'
        WHEN ccu_fetch_status = 'invalid' AND ccu_skip_until > NOW() THEN 'skipped'
        WHEN ccu_fetch_status = 'invalid' THEN 'invalid'
        ELSE 'unavailable'
      END::TEXT AS ccu_confidence_state,
      ccu_peak,
      ccu_source
    FROM ccu_rows
  ),
  aggregated AS (
    SELECT
      COUNT(*)::BIGINT AS current_catalog_apps,
      COUNT(*) FILTER (WHERE has_tier_assignment)::BIGINT AS tier_assigned,
      COUNT(*) FILTER (WHERE NOT has_tier_assignment)::BIGINT AS no_tier_assignment,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_positive')::BIGINT AS confirmed_positive,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_zero')::BIGINT AS confirmed_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'suspect_zero')::BIGINT AS suspect_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'skipped')::BIGINT AS skipped,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'invalid')::BIGINT AS invalid,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'unavailable')::BIGINT AS unavailable,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steam_api')::BIGINT AS steam_api,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steamspy')::BIGINT AS steamspy,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source IS NULL)::BIGINT AS legacy_unknown
    FROM resolved_rows
  )
  SELECT
    aggregated.current_catalog_apps,
    aggregated.tier_assigned,
    aggregated.no_tier_assignment,
    aggregated.confirmed_positive,
    aggregated.confirmed_zero,
    aggregated.suspect_zero,
    aggregated.skipped,
    aggregated.invalid,
    aggregated.unavailable,
    aggregated.steam_api,
    aggregated.steamspy,
    aggregated.legacy_unknown,
    NOW() AS updated_at,
    'live'::TEXT AS data_source,
    FALSE AS is_approximate
  FROM aggregated;
END;
$$;

COMMENT ON FUNCTION public.get_ccu_quality_stats() IS
  'Returns current-catalog CCU quality counts from dashboard_stats_cache when available, otherwise computes them live using a single-pass aggregate.';

REVOKE EXECUTE ON FUNCTION public.get_ccu_quality_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ccu_quality_stats() TO service_role;
