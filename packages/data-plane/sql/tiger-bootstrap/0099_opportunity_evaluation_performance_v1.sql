-- Additive performance contracts for Opportunity evaluation.
--
-- This migration does not change profile, cohort, market, ranking, readiness,
-- result, delivery, or user-state semantics. It adds:
--   * a versioned rule-input evidence projection;
--   * an exact, short-lived released-cohort cache; and
--   * phase timings on canonical run records.
--
-- Applying this file is a production Tiger schema write. It must not be
-- applied without a separately approved write window and rollback plan.

SET statement_timeout = '5min';
SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS opportunity.rule_input_projection_v1 (
    appid integer NOT NULL,
    projection_version text NOT NULL,
    as_of_date date NOT NULL,
    input_fingerprint text NOT NULL,
    name text NOT NULL,
    fields jsonb NOT NULL,
    source_watermarks jsonb NOT NULL,
    calculated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (appid, projection_version),
    CHECK (appid > 0),
    CHECK (nullif(btrim(projection_version), '') IS NOT NULL),
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
    CHECK (jsonb_typeof(fields) = 'object'),
    CHECK (jsonb_typeof(source_watermarks) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_opportunity_rule_input_projection_as_of
    ON opportunity.rule_input_projection_v1 (
      projection_version,
      as_of_date DESC,
      appid
    );

CREATE TABLE IF NOT EXISTS opportunity.released_cohort_cache_v1 (
    cache_key text PRIMARY KEY,
    appid integer NOT NULL,
    source_date date NOT NULL,
    source_watermark_hash text NOT NULL,
    source_watermark jsonb NOT NULL,
    input_fingerprint text NOT NULL,
    projection_version text NOT NULL,
    feature_projection_version text NOT NULL,
    cohort_version text NOT NULL,
    market_version text NOT NULL,
    resolver_version text NOT NULL,
    cohort jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
        DEFAULT (now() + interval '3 days'),
    CHECK (appid > 0),
    CHECK (cache_key ~ '^[0-9a-f]{64}$'),
    CHECK (source_watermark_hash ~ '^[0-9a-f]{64}$'),
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
    CHECK (nullif(btrim(projection_version), '') IS NOT NULL),
    CHECK (nullif(btrim(feature_projection_version), '') IS NOT NULL),
    CHECK (nullif(btrim(cohort_version), '') IS NOT NULL),
    CHECK (nullif(btrim(market_version), '') IS NOT NULL),
    CHECK (nullif(btrim(resolver_version), '') IS NOT NULL),
    CHECK (jsonb_typeof(source_watermark) = 'object'),
    CHECK (jsonb_typeof(cohort) = 'object'),
    CHECK (expires_at > created_at),
    UNIQUE (
      appid,
      source_date,
      source_watermark_hash,
      input_fingerprint,
      projection_version,
      feature_projection_version,
      cohort_version,
      market_version,
      resolver_version
    )
);

CREATE INDEX IF NOT EXISTS idx_opportunity_cohort_cache_expiry
    ON opportunity.released_cohort_cache_v1 (expires_at, cache_key);
CREATE INDEX IF NOT EXISTS idx_opportunity_cohort_cache_app
    ON opportunity.released_cohort_cache_v1 (
      appid,
      source_date DESC,
      created_at DESC
    );

-- A transactional revision per cohort source makes invalidation exact for
-- inserts, updates, deletes, COPY operations, and same-timestamp mutations.
-- Statement-level triggers add one tiny revision write per source statement,
-- independent of the number of changed rows.
CREATE TABLE IF NOT EXISTS opportunity.cohort_source_revisions_v1 (
    source_key text PRIMARY KEY,
    revision bigint NOT NULL DEFAULT 0,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CHECK (nullif(btrim(source_key), '') IS NOT NULL),
    CHECK (revision >= 0)
);

INSERT INTO opportunity.cohort_source_revisions_v1 (source_key)
VALUES
  ('legacy.apps'),
  ('legacy.app_steam_tags'),
  ('legacy.steam_tags'),
  ('legacy.app_genres'),
  ('legacy.steam_genres'),
  ('legacy.latest_daily_metrics'),
  ('metrics.app_signal_windows_v1'),
  ('ops.app_data_readiness')
ON CONFLICT (source_key) DO NOTHING;

CREATE OR REPLACE FUNCTION opportunity.bump_cohort_source_revision_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_key text;
BEGIN
  v_source_key := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
  INSERT INTO opportunity.cohort_source_revisions_v1 (
    source_key,
    revision,
    updated_at
  )
  VALUES (v_source_key, 1, clock_timestamp())
  ON CONFLICT (source_key)
  DO UPDATE SET
    revision =
      opportunity.cohort_source_revisions_v1.revision + 1,
    updated_at = EXCLUDED.updated_at;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  v_source record;
  v_relation regclass;
  v_trigger_name text;
BEGIN
  FOR v_source IN
    SELECT *
    FROM (
      VALUES
        ('legacy', 'apps'),
        ('legacy', 'app_steam_tags'),
        ('legacy', 'steam_tags'),
        ('legacy', 'app_genres'),
        ('legacy', 'steam_genres'),
        ('legacy', 'latest_daily_metrics'),
        ('metrics', 'app_signal_windows_v1'),
        ('ops', 'app_data_readiness')
    ) AS sources(schema_name, table_name)
  LOOP
    v_relation := to_regclass(
      format('%I.%I', v_source.schema_name, v_source.table_name)
    );
    IF v_relation IS NULL THEN
      RAISE EXCEPTION
        'Required Opportunity cohort source %.% does not exist',
        v_source.schema_name,
        v_source.table_name;
    END IF;
    v_trigger_name := format(
      'opportunity_cohort_revision_%s_%s_v1',
      v_source.schema_name,
      v_source.table_name
    );
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = v_relation
        AND tgname = v_trigger_name
        AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I
           AFTER INSERT OR UPDATE OR DELETE ON %I.%I
           FOR EACH STATEMENT
           EXECUTE FUNCTION opportunity.bump_cohort_source_revision_v1()',
        v_trigger_name,
        v_source.schema_name,
        v_source.table_name
      );
    END IF;
  END LOOP;
END;
$$;

-- Stable dense taxonomy positions make exact overlap a native bit operation.
-- Capacities deliberately exceed the current 472 Steam tags and 42 genres;
-- refresh fails closed instead of silently truncating if either is exhausted.
CREATE TABLE IF NOT EXISTS opportunity.cohort_taxonomy_positions_v1 (
    taxonomy_kind text NOT NULL,
    taxonomy_id integer NOT NULL,
    bit_position smallint NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (taxonomy_kind, taxonomy_id),
    UNIQUE (taxonomy_kind, bit_position),
    CHECK (taxonomy_kind IN ('tag', 'genre')),
    CHECK (
      (taxonomy_kind = 'tag' AND bit_position BETWEEN 0 AND 1023)
      OR
      (taxonomy_kind = 'genre' AND bit_position BETWEEN 0 AND 127)
    )
);

CREATE MATERIALIZED VIEW IF NOT EXISTS
  opportunity.released_cohort_features_v1
AS
WITH tag_masks AS (
  SELECT
    app_tag.appid,
    bit_or(
      set_bit(
        B'0'::bit(1024),
        position.bit_position,
        1
      )
    )::bit(1024) AS tag_mask
  FROM legacy.app_steam_tags app_tag
  JOIN opportunity.cohort_taxonomy_positions_v1 position
    ON position.taxonomy_kind = 'tag'
   AND position.taxonomy_id = app_tag.tag_id
  GROUP BY app_tag.appid
),
genre_masks AS (
  SELECT
    app_genre.appid,
    bit_or(
      set_bit(
        B'0'::bit(128),
        position.bit_position,
        1
      )
    )::bit(128) AS genre_mask
  FROM legacy.app_genres app_genre
  JOIN opportunity.cohort_taxonomy_positions_v1 position
    ON position.taxonomy_kind = 'genre'
   AND position.taxonomy_id = app_genre.genre_id
  GROUP BY app_genre.appid
)
SELECT
  app.appid,
  app.is_free,
  COALESCE(app.current_price_cents, metric.price_cents)
    AS effective_price_cents,
  COALESCE(tag_masks.tag_mask, B'0'::bit(1024)) AS tag_mask,
  COALESCE(genre_masks.genre_mask, B'0'::bit(128)) AS genre_mask
FROM legacy.apps app
LEFT JOIN legacy.latest_daily_metrics metric
  ON metric.appid = app.appid
LEFT JOIN tag_masks ON tag_masks.appid = app.appid
LEFT JOIN genre_masks ON genre_masks.appid = app.appid
WHERE app.type = 'game'
  AND app.is_released = true
  AND COALESCE(app.is_delisted, false) = false
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_opportunity_released_cohort_features_app_v1
  ON opportunity.released_cohort_features_v1 (appid);
CREATE INDEX IF NOT EXISTS
  idx_opportunity_released_cohort_features_business_v1
  ON opportunity.released_cohort_features_v1 (is_free, appid);

CREATE MATERIALIZED VIEW IF NOT EXISTS
  opportunity.released_cohort_features_v2
AS
WITH tag_features AS (
  SELECT
    app_tag.appid,
    array_agg(
      position.taxonomy_id
      ORDER BY position.taxonomy_id
    )::integer[] AS tag_ids,
    bit_or(
      set_bit(
        B'0'::bit(1024),
        position.bit_position,
        1
      )
    )::bit(1024) AS tag_mask
  FROM legacy.app_steam_tags app_tag
  JOIN opportunity.cohort_taxonomy_positions_v1 position
    ON position.taxonomy_kind = 'tag'
   AND position.taxonomy_id = app_tag.tag_id
  GROUP BY app_tag.appid
),
genre_features AS (
  SELECT
    app_genre.appid,
    array_agg(
      position.taxonomy_id
      ORDER BY position.taxonomy_id
    )::integer[] AS genre_ids,
    bit_or(
      set_bit(
        B'0'::bit(128),
        position.bit_position,
        1
      )
    )::bit(128) AS genre_mask
  FROM legacy.app_genres app_genre
  JOIN opportunity.cohort_taxonomy_positions_v1 position
    ON position.taxonomy_kind = 'genre'
   AND position.taxonomy_id = app_genre.genre_id
  GROUP BY app_genre.appid
)
SELECT
  app.appid,
  app.is_free,
  COALESCE(app.current_price_cents, metric.price_cents)
    AS effective_price_cents,
  COALESCE(tag_features.tag_ids, '{}'::integer[]) AS tag_ids,
  COALESCE(tag_features.tag_mask, B'0'::bit(1024)) AS tag_mask,
  COALESCE(genre_features.genre_ids, '{}'::integer[]) AS genre_ids,
  COALESCE(genre_features.genre_mask, B'0'::bit(128)) AS genre_mask
FROM legacy.apps app
LEFT JOIN legacy.latest_daily_metrics metric
  ON metric.appid = app.appid
LEFT JOIN tag_features ON tag_features.appid = app.appid
LEFT JOIN genre_features ON genre_features.appid = app.appid
WHERE app.type = 'game'
  AND app.is_released = true
  AND COALESCE(app.is_delisted, false) = false
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_opportunity_released_cohort_features_app_v2
  ON opportunity.released_cohort_features_v2 (appid);
CREATE INDEX IF NOT EXISTS
  idx_opportunity_released_cohort_features_business_v2
  ON opportunity.released_cohort_features_v2 (is_free, appid);
CREATE INDEX IF NOT EXISTS
  idx_opportunity_released_cohort_features_tags_v2
  ON opportunity.released_cohort_features_v2 USING gin (tag_ids);
CREATE INDEX IF NOT EXISTS
  idx_opportunity_released_cohort_features_genres_v2
  ON opportunity.released_cohort_features_v2 USING gin (genre_ids);

CREATE TABLE IF NOT EXISTS opportunity.cohort_feature_projection_state_v1 (
    singleton boolean PRIMARY KEY DEFAULT true,
    feature_projection_version text NOT NULL,
    source_revisions jsonb NOT NULL,
    row_count integer NOT NULL,
    refreshed_at timestamp with time zone NOT NULL,
    CHECK (singleton),
    CHECK (nullif(btrim(feature_projection_version), '') IS NOT NULL),
    CHECK (jsonb_typeof(source_revisions) = 'object'),
    CHECK (row_count >= 0)
);

CREATE OR REPLACE PROCEDURE
  opportunity.refresh_released_cohort_features_v2()
LANGUAGE plpgsql
AS $$
DECLARE
  v_after_revisions jsonb;
  v_before_revisions jsonb;
  v_genre_positions integer;
  v_is_populated boolean;
  v_row_count integer;
  v_source_revision_count integer;
  v_tag_positions integer;
BEGIN
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
$$;

ALTER TABLE opportunity.runs
    ADD COLUMN IF NOT EXISTS phase_timings jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'opportunity_runs_phase_timings_object_check'
      AND conrelid = 'opportunity.runs'::regclass
  ) THEN
    ALTER TABLE opportunity.runs
      ADD CONSTRAINT opportunity_runs_phase_timings_object_check
      CHECK (jsonb_typeof(phase_timings) = 'object');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION opportunity.cleanup_performance_cache_v1(
  p_cache_limit integer DEFAULT 2000,
  p_projection_limit integer DEFAULT 2000
)
RETURNS TABLE (
  deleted_cohort_cache_rows integer,
  deleted_projection_rows integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cache_limit integer;
  v_projection_limit integer;
BEGIN
  v_cache_limit := greatest(1, least(coalesce(p_cache_limit, 2000), 10000));
  v_projection_limit :=
    greatest(1, least(coalesce(p_projection_limit, 2000), 10000));

  WITH expired AS (
    SELECT ctid
    FROM opportunity.released_cohort_cache_v1
    WHERE expires_at <= now()
    ORDER BY expires_at, cache_key
    LIMIT v_cache_limit
  ),
  deleted AS (
    DELETE FROM opportunity.released_cohort_cache_v1 cache
    USING expired
    WHERE cache.ctid = expired.ctid
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO deleted_cohort_cache_rows
  FROM deleted;

  WITH stale AS (
    SELECT ctid
    FROM opportunity.rule_input_projection_v1
    WHERE as_of_date < CURRENT_DATE - 90
    ORDER BY as_of_date, appid
    LIMIT v_projection_limit
  ),
  deleted AS (
    DELETE FROM opportunity.rule_input_projection_v1 projection
    USING stale
    WHERE projection.ctid = stale.ctid
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO deleted_projection_rows
  FROM deleted;

  RETURN NEXT;
END;
$$;

COMMENT ON TABLE opportunity.rule_input_projection_v1 IS
  'Versioned exact Opportunity rule-input evidence payloads. Unsupported fields fail closed in application completeness checks.';
COMMENT ON TABLE opportunity.released_cohort_cache_v1 IS
  'Short-lived exact released-cohort cache keyed by app, input fingerprint, stable source watermark/date, and calculation-contract versions.';
COMMENT ON TABLE opportunity.cohort_source_revisions_v1 IS
  'Transactional statement-level revisions for every relation that can change released-cohort membership, scoring, or evidence.';
COMMENT ON MATERIALIZED VIEW opportunity.released_cohort_features_v1 IS
  'Compact exact released-game business-model, price, tag, and genre bitsets used for native overlap scoring. Refresh is source-revision guarded.';
COMMENT ON MATERIALIZED VIEW opportunity.released_cohort_features_v2 IS
  'GIN-indexed exact released-game taxonomy arrays and bitsets used for bounded native overlap scoring. Refresh is source-revision guarded.';
COMMENT ON TABLE opportunity.cohort_feature_projection_state_v1 IS
  'Exact source revisions captured by the last stable released-cohort feature refresh.';
COMMENT ON PROCEDURE opportunity.refresh_released_cohort_features_v2() IS
  'Refreshes the GIN-indexed cohort feature projection only from a complete, stable set of transactional source revisions.';
COMMENT ON FUNCTION opportunity.bump_cohort_source_revision_v1() IS
  'Bumps one bounded source revision in the same transaction as a cohort-source insert, update, delete, or COPY statement.';
COMMENT ON COLUMN opportunity.runs.phase_timings IS
  'Measured Opportunity worker phase durations in milliseconds for the completed run.';
COMMENT ON FUNCTION opportunity.cleanup_performance_cache_v1(integer, integer)
  IS 'Deletes only expired additive cohort-cache rows and rule-input projections older than 90 days in bounded batches.';
