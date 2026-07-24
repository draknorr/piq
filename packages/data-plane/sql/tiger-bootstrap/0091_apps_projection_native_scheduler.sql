-- Register the Apps projection refresh as a Tiger-native Timescale background
-- job. The job is installed disabled and stays disabled until a separately
-- approved production-write change enables it through alter_job.
--
-- The v2 Apps views added by 0090 read through these two materialized views, so
-- one refresh maintains both legacy and v2 readers without duplicate storage.
-- The GitHub workflow remains available as a manual recovery path only.
--
-- Applying this file changes production Tiger schema/runtime metadata and
-- requires a separately approved write window. Do not run it automatically.

SET statement_timeout = '5min';
SET lock_timeout = '15s';

CREATE OR REPLACE FUNCTION ops.check_apps_projection_refresh_job_config(config jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF config IS DISTINCT FROM
    '{"contract_version":"apps-projection-refresh/v1"}'::jsonb
  THEN
    RAISE EXCEPTION
      'apps projection refresh config must exactly match contract apps-projection-refresh/v1';
  END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE ops.refresh_apps_page_projections_job(
  job_id integer,
  config jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  source_rows bigint;
  projection_rows bigint;
  v2_rows bigint;
  id_mismatch boolean;
  filter_mismatch boolean;
BEGIN
  PERFORM ops.check_apps_projection_refresh_job_config(config);

  -- Timescale prevents one scheduled instance of this job from overlapping
  -- itself. This transaction-scoped lock also rejects an accidental second
  -- registration using the same PublisherIQ refresh contract.
  IF NOT pg_try_advisory_xact_lock(1886417008, 1) THEN
    RAISE EXCEPTION 'apps projection refresh contract is already running';
  END IF;

  PERFORM set_config('lock_timeout', '15s', true);
  PERFORM set_config('statement_timeout', '30min', true);
  REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_projection;

  PERFORM set_config('statement_timeout', '10min', true);
  REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_filter_counts;

  PERFORM set_config('statement_timeout', '2min', true);

  SELECT count(*)::bigint
  INTO source_rows
  FROM legacy.apps
  WHERE COALESCE(is_released, false) = true
    AND COALESCE(is_delisted, false) = false;

  SELECT count(*)::bigint
  INTO projection_rows
  FROM metrics.apps_page_projection;

  IF projection_rows IS DISTINCT FROM source_rows THEN
    RAISE EXCEPTION
      'apps projection/source row parity failed: projection=%, source=%',
      projection_rows,
      source_rows;
  END IF;

  SELECT
    EXISTS (
      SELECT appid
      FROM legacy.apps
      WHERE COALESCE(is_released, false) = true
        AND COALESCE(is_delisted, false) = false
      EXCEPT
      SELECT appid
      FROM metrics.apps_page_projection
    )
    OR EXISTS (
      SELECT appid
      FROM metrics.apps_page_projection
      EXCEPT
      SELECT appid
      FROM legacy.apps
      WHERE COALESCE(is_released, false) = true
        AND COALESCE(is_delisted, false) = false
    )
  INTO id_mismatch;

  IF id_mismatch THEN
    RAISE EXCEPTION 'apps projection/source app ID parity failed';
  END IF;

  SELECT count(*)::bigint
  INTO v2_rows
  FROM metrics.apps_page_projection_v2;

  IF v2_rows IS DISTINCT FROM projection_rows THEN
    RAISE EXCEPTION
      'apps v2/legacy row parity failed: v2=%, legacy=%',
      v2_rows,
      projection_rows;
  END IF;

  WITH expected AS (
    SELECT
      'genre'::text AS filter_type,
      genre_id AS option_id,
      count(*)::integer AS app_count
    FROM metrics.apps_page_projection projection
    CROSS JOIN LATERAL unnest(projection.genre_ids) genre_id
    WHERE projection.type = 'game'
    GROUP BY genre_id

    UNION ALL

    SELECT
      'tag'::text AS filter_type,
      tag_id AS option_id,
      count(*)::integer AS app_count
    FROM metrics.apps_page_projection projection
    CROSS JOIN LATERAL unnest(projection.tag_ids) tag_id
    WHERE projection.type = 'game'
    GROUP BY tag_id

    UNION ALL

    SELECT
      'category'::text AS filter_type,
      category_id AS option_id,
      count(*)::integer AS app_count
    FROM metrics.apps_page_projection projection
    CROSS JOIN LATERAL unnest(projection.category_ids) category_id
    WHERE projection.type = 'game'
    GROUP BY category_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM expected
    FULL OUTER JOIN metrics.apps_page_filter_counts actual
      USING (filter_type, option_id)
    WHERE expected.filter_type IS NULL
      OR actual.filter_type IS NULL
      OR expected.app_count IS DISTINCT FROM actual.app_count
  )
  INTO filter_mismatch;

  IF filter_mismatch THEN
    RAISE EXCEPTION 'apps projection filter-count parity failed';
  END IF;
END;
$$;

DO $$
DECLARE
  matching_jobs integer;
  projection_job_id integer;
BEGIN
  SELECT count(*)::integer, min(job_id)
  INTO matching_jobs, projection_job_id
  FROM timescaledb_information.jobs
  WHERE proc_schema = 'ops'
    AND proc_name = 'refresh_apps_page_projections_job';

  IF matching_jobs > 1 THEN
    RAISE EXCEPTION
      'expected at most one apps projection refresh job, found %',
      matching_jobs;
  END IF;

  IF matching_jobs = 0 THEN
    SELECT public.add_job(
      'ops.refresh_apps_page_projections_job'::regproc,
      interval '4 hours',
      config => '{"contract_version":"apps-projection-refresh/v1"}'::jsonb,
      initial_start => timestamptz '2000-01-01 00:47:00+00',
      scheduled => false,
      check_config => 'ops.check_apps_projection_refresh_job_config'::regproc,
      fixed_schedule => true,
      timezone => 'UTC',
      job_name => 'apps-projection-refresh-v1'
    )
    INTO projection_job_id;
  END IF;

  PERFORM public.alter_job(
    job_id => projection_job_id,
    schedule_interval => interval '4 hours',
    max_runtime => interval '45 minutes',
    max_retries => 3,
    retry_period => interval '15 minutes',
    scheduled => false,
    config => '{"contract_version":"apps-projection-refresh/v1"}'::jsonb,
    check_config => 'ops.check_apps_projection_refresh_job_config'::regproc,
    fixed_schedule => true,
    initial_start => timestamptz '2000-01-01 00:47:00+00',
    timezone => 'UTC',
    job_name => 'apps-projection-refresh-v1'
  );
END;
$$;

COMMENT ON FUNCTION ops.check_apps_projection_refresh_job_config(jsonb) IS
  'Fail-closed validator for the versioned Apps projection refresh job config.';

COMMENT ON PROCEDURE ops.refresh_apps_page_projections_job(integer, jsonb) IS
  'Refreshes legacy Apps materializations concurrently, then proves source, v2, and filter parity. Registered disabled at a fixed four-hour UTC cadence.';
