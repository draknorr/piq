-- Phase 4A: CCU confidence and provenance
-- - Add additive latest validation state fields for official Steam CCU polling
-- - Expose resolved latest CCU confidence status for internal/admin use
-- - Expose current-catalog CCU quality diagnostics without changing app/search semantics

ALTER TABLE public.ccu_tier_assignments
  ADD COLUMN IF NOT EXISTS last_ccu_validation_state TEXT,
  ADD COLUMN IF NOT EXISTS last_ccu_validation_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ccu_tier_assignments_last_ccu_validation_state'
  ) THEN
    ALTER TABLE public.ccu_tier_assignments
      ADD CONSTRAINT chk_ccu_tier_assignments_last_ccu_validation_state
      CHECK (
        last_ccu_validation_state IS NULL
        OR last_ccu_validation_state IN (
          'confirmed_positive',
          'confirmed_zero',
          'suspect_zero',
          'invalid',
          'error'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.ccu_tier_assignments.last_ccu_validation_state IS
  'Latest official Steam CCU validation outcome: confirmed_positive, confirmed_zero, suspect_zero, invalid, or error.';

COMMENT ON COLUMN public.ccu_tier_assignments.last_ccu_validation_at IS
  'Timestamp of the latest official Steam CCU validation outcome persisted for this app.';

CREATE INDEX IF NOT EXISTS idx_ccu_tier_assignments_last_ccu_validation_state
  ON public.ccu_tier_assignments(last_ccu_validation_state)
  WHERE last_ccu_validation_state IS NOT NULL;

CREATE OR REPLACE VIEW public.latest_ccu_status AS
SELECT
  a.appid,
  CASE
    WHEN ct.last_ccu_validation_state = 'confirmed_positive' THEN 'confirmed_positive'
    WHEN ct.last_ccu_validation_state = 'confirmed_zero' THEN 'confirmed_zero'
    WHEN ct.last_ccu_validation_state = 'suspect_zero' THEN 'suspect_zero'
    WHEN ct.ccu_fetch_status = 'invalid' AND ct.ccu_skip_until > NOW() THEN 'skipped'
    WHEN ct.ccu_fetch_status = 'invalid' THEN 'invalid'
    ELSE 'unavailable'
  END::TEXT AS ccu_confidence_state,
  ldm.ccu_source,
  ct.last_ccu_validation_state,
  ct.last_ccu_validation_at,
  ct.ccu_fetch_status,
  ct.ccu_skip_until,
  ct.last_ccu_synced,
  (ct.appid IS NOT NULL) AS has_tier_assignment
FROM public.apps a
LEFT JOIN public.ccu_tier_assignments ct
  ON ct.appid = a.appid
LEFT JOIN public.latest_daily_metrics ldm
  ON ldm.appid = a.appid;

COMMENT ON VIEW public.latest_ccu_status IS
  'Resolved latest/current CCU confidence state for each app, combining official validation outcome, fetch status, skip state, and CCU provenance.';

GRANT SELECT ON public.latest_ccu_status TO service_role;

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
  legacy_unknown BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_catalog AS (
    SELECT appid
    FROM public.get_current_catalog_appids()
  ),
  ccu_status AS (
    SELECT lcs.*
    FROM public.latest_ccu_status lcs
    JOIN current_catalog c ON c.appid = lcs.appid
  ),
  source_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE ldm.ccu_peak IS NOT NULL AND ldm.ccu_source = 'steam_api')::BIGINT AS steam_api,
      COUNT(*) FILTER (WHERE ldm.ccu_peak IS NOT NULL AND ldm.ccu_source = 'steamspy')::BIGINT AS steamspy,
      COUNT(*) FILTER (WHERE ldm.ccu_peak IS NOT NULL AND ldm.ccu_source IS NULL)::BIGINT AS legacy_unknown
    FROM current_catalog c
    LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = c.appid
  )
  SELECT
    (SELECT COUNT(*)::BIGINT FROM current_catalog) AS current_catalog_apps,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE has_tier_assignment) AS tier_assigned,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE NOT has_tier_assignment) AS no_tier_assignment,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE ccu_confidence_state = 'confirmed_positive') AS confirmed_positive,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE ccu_confidence_state = 'confirmed_zero') AS confirmed_zero,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE ccu_confidence_state = 'suspect_zero') AS suspect_zero,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE ccu_confidence_state = 'skipped') AS skipped,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE ccu_confidence_state = 'invalid') AS invalid,
    (SELECT COUNT(*)::BIGINT FROM ccu_status WHERE ccu_confidence_state = 'unavailable') AS unavailable,
    source_counts.steam_api,
    source_counts.steamspy,
    source_counts.legacy_unknown
  FROM source_counts;
$$;

COMMENT ON FUNCTION public.get_ccu_quality_stats() IS
  'Returns current-catalog CCU quality counts: tier coverage, resolved confidence-state distribution, and latest CCU provenance mix.';

REVOKE EXECUTE ON FUNCTION public.get_ccu_quality_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ccu_quality_stats() TO service_role;
