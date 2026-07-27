-- Make the installed Apps projection job's source parity gate snapshot-aware.
--
-- Migration 0091 refreshes the materialized views and then compares them with
-- later statement-level snapshots of mutable legacy.apps. Accepted catalog
-- writes between those statements can therefore report false source parity
-- failures even though the refreshed projection is valid for its own snapshot.
--
-- This forward-only replacement preserves the job signature, schedule, config,
-- allowlisted concurrent refreshes, advisory lock, and mandatory v2/filter
-- parity gates. It does not add, alter, enable, disable, or run a background
-- job. Applying it is still a production Tiger schema write and requires a
-- separately approved write window.

SET statement_timeout = '5min';
SET lock_timeout = '15s';

CREATE OR REPLACE PROCEDURE ops.refresh_apps_page_projections_job(
  job_id integer,
  config jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  source_rows_before bigint;
  source_rows_after bigint;
  source_fingerprint_before text;
  source_fingerprint_after text;
  source_changed boolean;
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
  PERFORM set_config('statement_timeout', '2min', true);

  SELECT
    count(*)::bigint,
    md5(coalesce(string_agg(appid::text, ',' ORDER BY appid), ''))
  INTO source_rows_before, source_fingerprint_before
  FROM legacy.apps
  WHERE COALESCE(is_released, false) = true
    AND COALESCE(is_delisted, false) = false;

  PERFORM set_config('statement_timeout', '30min', true);
  REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_projection;

  PERFORM set_config('statement_timeout', '10min', true);
  REFRESH MATERIALIZED VIEW CONCURRENTLY metrics.apps_page_filter_counts;

  PERFORM set_config('statement_timeout', '2min', true);

  -- Capture the post-refresh source fingerprint and exact source/projection ID
  -- comparison in one statement snapshot. This prevents a later source write
  -- from racing the exact comparison itself.
  WITH eligible_source AS MATERIALIZED (
    SELECT appid
    FROM legacy.apps
    WHERE COALESCE(is_released, false) = true
      AND COALESCE(is_delisted, false) = false
  ),
  projection_ids AS MATERIALIZED (
    SELECT appid
    FROM metrics.apps_page_projection
  )
  SELECT
    (SELECT count(*)::bigint FROM eligible_source),
    (
      SELECT md5(
        coalesce(string_agg(appid::text, ',' ORDER BY appid), '')
      )
      FROM eligible_source
    ),
    (SELECT count(*)::bigint FROM projection_ids),
    EXISTS (
      SELECT appid
      FROM eligible_source
      EXCEPT
      SELECT appid
      FROM projection_ids
    )
    OR EXISTS (
      SELECT appid
      FROM projection_ids
      EXCEPT
      SELECT appid
      FROM eligible_source
    )
  INTO
    source_rows_after,
    source_fingerprint_after,
    projection_rows,
    id_mismatch;

  source_changed :=
    source_rows_before IS DISTINCT FROM source_rows_after
    OR source_fingerprint_before IS DISTINCT FROM source_fingerprint_after;

  IF NOT source_changed THEN
    IF projection_rows IS DISTINCT FROM source_rows_after THEN
      RAISE EXCEPTION
        'apps projection/source row parity failed: projection=%, source=%',
        projection_rows,
        source_rows_after;
    END IF;

    IF id_mismatch THEN
      RAISE EXCEPTION 'apps projection/source app ID parity failed';
    END IF;
  ELSE
    -- Do not convert accepted concurrent catalog writes into a false failed
    -- job. Internal projection parity is still enforced below, and the next
    -- fixed-schedule run retries exact source parity against its own window.
    RAISE NOTICE
      'apps projection source changed during refresh; exact source parity deferred: before_rows=%, after_rows=%, projection_rows=%, post_snapshot_id_mismatch=%',
      source_rows_before,
      source_rows_after,
      projection_rows,
      id_mismatch;
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

COMMENT ON PROCEDURE ops.refresh_apps_page_projections_job(integer, jsonb) IS
  'Refreshes legacy Apps materializations concurrently; enforces exact source parity when the eligible source ID set is stable, always enforces v2/filter parity, and defers source parity after accepted concurrent source mutations.';
