-- Add a narrow public-Store tag queue source and idempotent evidence writer.
--
-- Applying this file changes the production Tiger queue constraint and creates
-- three functions. It must only be applied during an approved write window.

SET statement_timeout = '5min';
SET lock_timeout = '5s';

BEGIN;

ALTER TABLE ops.app_capture_work_state
  DROP CONSTRAINT app_capture_work_state_source_check;

ALTER TABLE ops.app_capture_work_state
  ADD CONSTRAINT app_capture_work_state_source_check CHECK (
    source = ANY (ARRAY[
      'storefront'::text,
      'storefront_tags'::text,
      'news'::text,
      'hero_asset'::text,
      'projection_refresh'::text
    ])
  );

CREATE OR REPLACE FUNCTION ops.claim_app_capture_work_v2(
  p_sources text[],
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_min_priority integer DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  appid integer,
  source text,
  priority integer,
  trigger_reason text,
  trigger_cursor text,
  payload jsonb,
  attempts integer,
  available_at timestamp with time zone
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT work.id
    FROM ops.app_capture_work_state work
    WHERE work.source = ANY (p_sources)
      AND work.dirty_since IS NOT NULL
      AND work.claimed_at IS NULL
      AND work.dead_lettered_at IS NULL
      AND work.next_available_at <= now()
      AND (p_min_priority IS NULL OR work.priority >= p_min_priority)
    ORDER BY
      work.priority DESC,
      work.dirty_since ASC,
      work.last_dirty_at ASC,
      work.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 500)
  )
  UPDATE ops.app_capture_work_state work
  SET claimed_at = now(),
      worker_id = p_worker_id,
      attempts = work.attempts + 1,
      updated_at = now()
  FROM candidates
  WHERE work.id = candidates.id
  RETURNING
    work.id,
    work.appid,
    work.source,
    work.priority,
    work.latest_trigger_reason,
    work.latest_trigger_cursor,
    work.payload,
    work.attempts,
    work.next_available_at;
END;
$$;

CREATE OR REPLACE FUNCTION ops.defer_app_capture_work_v1(
  p_ids bigint[],
  p_delay_seconds integer,
  p_error text
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE ops.app_capture_work_state
  SET worker_id = NULL,
      claimed_at = NULL,
      next_available_at = now()
        + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 60), 1), 86400)),
      last_error = left(coalesce(p_error, 'deferred'), 2000),
      updated_at = now()
  WHERE id = ANY (p_ids)
    AND dirty_since IS NOT NULL
    AND dead_lettered_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION ops.upsert_storefront_tag_evidence_v1(
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_changed integer := 0;
  v_distinct_appids integer := 0;
  v_input_count integer := 0;
  v_valid_count integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Storefront tag evidence payload must be a JSON array';
  END IF;

  SELECT
    count(*),
    count(DISTINCT row.appid),
    count(*) FILTER (
      WHERE row.appid > 0
        AND row.source_at IS NOT NULL
        AND nullif(btrim(row.version), '') IS NOT NULL
        AND jsonb_typeof(row.value) = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(row.value) = 'array' THEN row.value
              ELSE '[]'::jsonb
            END
          ) AS tag(value)
          WHERE jsonb_typeof(tag.value) <> 'string'
        )
        AND jsonb_typeof(row.provenance) = 'object'
        AND jsonb_typeof(row.provenance->'items') = 'array'
    )
  INTO v_input_count, v_distinct_appids, v_valid_count
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS row(
    appid integer,
    value jsonb,
    source_at timestamp with time zone,
    version text,
    provenance jsonb
  );

  IF v_input_count <> v_valid_count OR v_input_count <> v_distinct_appids THEN
    RAISE EXCEPTION 'Storefront tag evidence payload contains invalid or duplicate app rows';
  END IF;

  INSERT INTO ops.app_field_evidence (
    appid,
    field_name,
    source,
    evidence_state,
    value,
    source_at,
    version,
    provenance,
    created_at,
    updated_at
  )
  SELECT
    row.appid,
    'tags',
    'storefront',
    'known',
    row.value,
    row.source_at,
    row.version,
    row.provenance,
    clock_timestamp(),
    clock_timestamp()
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS row(
    appid integer,
    value jsonb,
    source_at timestamp with time zone,
    version text,
    provenance jsonb
  )
  ON CONFLICT (appid, field_name, source)
  DO UPDATE SET
    evidence_state = EXCLUDED.evidence_state,
    value = EXCLUDED.value,
    source_at = EXCLUDED.source_at,
    version = EXCLUDED.version,
    provenance = EXCLUDED.provenance,
    updated_at = clock_timestamp()
  WHERE EXCLUDED.source_at > ops.app_field_evidence.source_at
    AND (
      ops.app_field_evidence.evidence_state IS DISTINCT FROM EXCLUDED.evidence_state
      OR ops.app_field_evidence.value IS DISTINCT FROM EXCLUDED.value
      OR ops.app_field_evidence.version IS DISTINCT FROM EXCLUDED.version
      OR ops.app_field_evidence.provenance->'items'
        IS DISTINCT FROM EXCLUDED.provenance->'items'
    );

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

COMMENT ON FUNCTION ops.upsert_storefront_tag_evidence_v1(jsonb) IS
  'Batch-upserts complete public Steam Store tag profiles as source-aware field evidence. Identical normalized tags and counts cause no relational write.';

COMMENT ON FUNCTION ops.claim_app_capture_work_v2(text[], text, integer, integer) IS
  'Claims capture work with the existing indexed ordering and an optional minimum priority for overlap-safe urgent lanes.';

COMMENT ON FUNCTION ops.defer_app_capture_work_v1(bigint[], integer, text) IS
  'Releases claimed capture work with a bounded retry delay instead of immediate re-poll churn.';

COMMIT;
