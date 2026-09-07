-- Apply only after explicit production approval. No scheduler interval changes.
-- One global gate for heavy refreshes; PICS holds its shared counterpart only
-- while settling a bounded catch-up pass. Raw intake and live work do not wait.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION ops.acquire_heavy_phase_gate(p_wait_seconds integer DEFAULT 120)
RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF p_wait_seconds IS NULL OR p_wait_seconds < 1 OR p_wait_seconds > 300 THEN
    RAISE EXCEPTION 'Heavy phase wait must be between 1 and 300 seconds';
  END IF;
  PERFORM set_config('lock_timeout', p_wait_seconds::text || 's', true);
  PERFORM pg_advisory_xact_lock(1886417008, 3);
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
END;
$gate$;


DO $preflight$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='ops.refresh_apps_page_projections_job(integer, jsonb)'::regprocedure)) IS DISTINCT FROM '9fdc8e71ab143dcc3b148fe865fc11c3' THEN RAISE EXCEPTION 'Heavy refresh procedure changed since review: refresh_apps_page_projections_job'; END IF; END; $preflight$;

CREATE OR REPLACE PROCEDURE ops.refresh_apps_page_projections_job(IN job_id integer, IN config jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $procedure$
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
  PERFORM ops.acquire_heavy_phase_gate(120);
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
$procedure$
;

DO $preflight$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='opportunity.refresh_released_cohort_features_v2()'::regprocedure)) IS DISTINCT FROM '3a8c30d7b3705ff975b785a53a3c4aec' THEN RAISE EXCEPTION 'Heavy refresh procedure changed since review: refresh_released_cohort_features_v2'; END IF; END; $preflight$;

CREATE OR REPLACE PROCEDURE opportunity.refresh_released_cohort_features_v2()
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_after_revisions jsonb;
  v_before_revisions jsonb;
  v_genre_positions integer;
  v_is_populated boolean;
  v_row_count integer;
  v_source_revision_count integer;
  v_tag_positions integer;
BEGIN
  PERFORM ops.acquire_heavy_phase_gate(120);
  IF NOT pg_try_advisory_xact_lock(1886417008, 2) THEN
    RAISE EXCEPTION
      'Opportunity cohort feature projection refresh is already running';
  END IF;

  PERFORM set_config('lock_timeout', '15s', true);
  PERFORM set_config('statement_timeout', '5min', true);

  -- PICS promotion updates several feature sources every few seconds. Hold
  -- read-compatible SHARE locks only for the bounded refresh transaction so
  -- the projection and its revision watermark are committed atomically.
  -- Source readers continue; source writers wait for this short refresh.
  LOCK TABLE
    legacy.apps,
    legacy.steam_genres,
    legacy.app_genres,
    legacy.steam_tags,
    legacy.app_steam_tags,
    legacy.latest_daily_metrics
  IN SHARE MODE;

  -- Capture every relation used either to assign stable taxonomy positions or
  -- to build the feature rows before doing either operation. This closes the
  -- gap where a taxonomy/link transaction could commit after position seeding
  -- but before the old four-source watermark was captured.
  SELECT jsonb_object_agg(source_key, revision ORDER BY source_key)
  INTO v_before_revisions
  FROM opportunity.cohort_source_revisions_v1
  WHERE source_key IN (
    'legacy.apps',
    'legacy.app_steam_tags',
    'legacy.steam_tags',
    'legacy.app_genres',
    'legacy.steam_genres',
    'legacy.latest_daily_metrics'
  );
  SELECT count(*)::integer
  INTO v_source_revision_count
  FROM jsonb_object_keys(COALESCE(v_before_revisions, '{}'::jsonb));
  IF v_source_revision_count <> 6 THEN
    RAISE EXCEPTION
      'Opportunity cohort feature projection source revisions are incomplete';
  END IF;

  WITH missing AS (
    SELECT tag.tag_id
    FROM legacy.steam_tags tag
    LEFT JOIN opportunity.cohort_taxonomy_positions_v1 position
      ON position.taxonomy_kind = 'tag'
     AND position.taxonomy_id = tag.tag_id
    WHERE position.taxonomy_id IS NULL
  ),
  numbered AS (
    SELECT
      tag_id,
      (
        COALESCE(
          (
            SELECT max(bit_position)
            FROM opportunity.cohort_taxonomy_positions_v1
            WHERE taxonomy_kind = 'tag'
          ),
          -1
        )
        + row_number() OVER (ORDER BY tag_id)
      )::smallint AS bit_position
    FROM missing
  )
  INSERT INTO opportunity.cohort_taxonomy_positions_v1 (
    taxonomy_kind,
    taxonomy_id,
    bit_position
  )
  SELECT 'tag', tag_id, bit_position
  FROM numbered
  ON CONFLICT (taxonomy_kind, taxonomy_id) DO NOTHING;

  WITH missing AS (
    SELECT genre.genre_id
    FROM legacy.steam_genres genre
    LEFT JOIN opportunity.cohort_taxonomy_positions_v1 position
      ON position.taxonomy_kind = 'genre'
     AND position.taxonomy_id = genre.genre_id
    WHERE position.taxonomy_id IS NULL
  ),
  numbered AS (
    SELECT
      genre_id,
      (
        COALESCE(
          (
            SELECT max(bit_position)
            FROM opportunity.cohort_taxonomy_positions_v1
            WHERE taxonomy_kind = 'genre'
          ),
          -1
        )
        + row_number() OVER (ORDER BY genre_id)
      )::smallint AS bit_position
    FROM missing
  )
  INSERT INTO opportunity.cohort_taxonomy_positions_v1 (
    taxonomy_kind,
    taxonomy_id,
    bit_position
  )
  SELECT 'genre', genre_id, bit_position
  FROM numbered
  ON CONFLICT (taxonomy_kind, taxonomy_id) DO NOTHING;

  SELECT
    count(*) FILTER (WHERE taxonomy_kind = 'tag'),
    count(*) FILTER (WHERE taxonomy_kind = 'genre')
  INTO v_tag_positions, v_genre_positions
  FROM opportunity.cohort_taxonomy_positions_v1;
  IF v_tag_positions > 1024 OR v_genre_positions > 128 THEN
    RAISE EXCEPTION
      'Opportunity cohort taxonomy mask capacity exceeded: tags=%, genres=%',
      v_tag_positions,
      v_genre_positions;
  END IF;

  SELECT relispopulated
  INTO v_is_populated
  FROM pg_class
  WHERE oid =
    'opportunity.released_cohort_features_v2'::regclass;
  IF v_is_populated THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY
      opportunity.released_cohort_features_v2;
  ELSE
    REFRESH MATERIALIZED VIEW
      opportunity.released_cohort_features_v2;
  END IF;

  SELECT jsonb_object_agg(source_key, revision ORDER BY source_key)
  INTO v_after_revisions
  FROM opportunity.cohort_source_revisions_v1
  WHERE source_key IN (
    'legacy.apps',
    'legacy.app_steam_tags',
    'legacy.steam_tags',
    'legacy.app_genres',
    'legacy.steam_genres',
    'legacy.latest_daily_metrics'
  );
  IF v_before_revisions IS DISTINCT FROM v_after_revisions THEN
    RAISE EXCEPTION
      'Opportunity cohort feature sources changed during refresh';
  END IF;

  SELECT count(*)::integer
  INTO v_row_count
  FROM opportunity.released_cohort_features_v2;

  INSERT INTO opportunity.cohort_feature_projection_state_v1 (
    singleton,
    feature_projection_version,
    source_revisions,
    row_count,
    refreshed_at
  )
  VALUES (
    true,
    'opportunity-cohort-feature-projection/v2',
    v_after_revisions,
    v_row_count,
    clock_timestamp()
  )
  ON CONFLICT (singleton)
  DO UPDATE SET
    feature_projection_version = EXCLUDED.feature_projection_version,
    source_revisions = EXCLUDED.source_revisions,
    row_count = EXCLUDED.row_count,
    refreshed_at = EXCLUDED.refreshed_at;
END;
$procedure$
;

COMMIT;
