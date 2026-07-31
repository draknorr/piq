-- Add field-level Steam evidence and token-aware durable PICS work routing.
--
-- Applying this file is a production Tiger schema/data write. It must not be
-- applied without a separately approved write window and rollback plan.

SET statement_timeout = '15min';
SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS ops.app_field_evidence (
    appid integer NOT NULL,
    field_name text NOT NULL,
    source text NOT NULL,
    evidence_state text NOT NULL,
    value jsonb,
    source_at timestamp with time zone NOT NULL,
    version text NOT NULL,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (appid, field_name, source),
    CHECK (appid > 0),
    CHECK (field_name = ANY (ARRAY[
      'genres'::text,
      'categories'::text,
      'platforms'::text,
      'languages'::text,
      'tags'::text,
      'controller_support'::text,
      'steam_deck'::text,
      'content_descriptors'::text
    ])),
    CHECK (source = ANY (ARRAY['storefront'::text, 'pics'::text])),
    CHECK (evidence_state = ANY (ARRAY['known'::text, 'missing'::text])),
    CHECK (
      (evidence_state = 'known' AND value IS NOT NULL)
      OR (evidence_state = 'missing' AND value IS NULL)
    ),
    CHECK (nullif(btrim(version), '') IS NOT NULL),
    CHECK (jsonb_typeof(provenance) = 'object')
);

COMMENT ON TABLE ops.app_field_evidence IS
  'Source-specific latest evidence for Steam fields. Known empty values are retained as JSON empty arrays/objects; missing source fields remain distinct NULL evidence rows.';

CREATE INDEX IF NOT EXISTS idx_ops_app_field_evidence_resolution
  ON ops.app_field_evidence (
    appid,
    field_name,
    evidence_state,
    source_at DESC,
    source
  );

CREATE INDEX IF NOT EXISTS idx_ops_app_field_evidence_source
  ON ops.app_field_evidence (source, field_name, source_at DESC, appid);

ALTER TABLE ops.pics_work_state
  ADD COLUMN IF NOT EXISTS needs_token boolean NOT NULL DEFAULT false;

ALTER TABLE ops.pics_work_state
  ADD COLUMN IF NOT EXISTS claimed_needs_token boolean;

-- Recover the latest item-level routing bit that intake already archived.
UPDATE ops.pics_work_state work
SET needs_token = COALESCE((
  SELECT batch_app.needs_token
  FROM ops.pics_change_batch_apps batch_app
  WHERE batch_app.batch_id = work.latest_batch_id
    AND batch_app.appid = work.appid
  ORDER BY
    batch_app.source_change_number DESC,
    batch_app.source_index DESC
  LIMIT 1
), false),
claimed_needs_token = CASE
  WHEN work.state = 'claimed' THEN COALESCE((
    SELECT batch_app.needs_token
    FROM ops.pics_change_batch_apps batch_app
    JOIN ops.pics_change_batches batch
      ON batch.id = batch_app.batch_id
    WHERE batch_app.appid = work.appid
      AND batch.stream_key = work.stream_key
      AND batch.work_mode = work.work_mode
      AND batch_app.source_change_number
        <= work.claimed_through_change_number
    ORDER BY
      batch_app.source_change_number DESC,
      batch.received_at DESC,
      batch_app.source_index DESC
    LIMIT 1
  ), false)
  ELSE NULL
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ops.pics_work_state'::regclass
      AND conname = 'pics_work_state_claimed_needs_token_check'
  ) THEN
    -- Expansion-compatible with the previous worker: old claim SQL may leave
    -- this NULL, while new workers always snapshot it for claimed work.
    ALTER TABLE ops.pics_work_state
      ADD CONSTRAINT pics_work_state_claimed_needs_token_check CHECK (
        state = 'claimed' OR claimed_needs_token IS NULL
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ops_pics_work_state_token_claimable
  ON ops.pics_work_state (
    work_mode,
    stream_key,
    needs_token,
    next_attempt_at,
    id
  )
  WHERE state IN ('pending', 'retrying');

CREATE TABLE IF NOT EXISTS ops.pics_token_replay_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appid integer NOT NULL,
    work_id bigint NOT NULL REFERENCES ops.pics_work_state(id) ON DELETE RESTRICT,
    prior_state text NOT NULL,
    prior_error_code text,
    requested_by text NOT NULL,
    reason text NOT NULL,
    archive_bucket text NOT NULL,
    archive_key text NOT NULL,
    archive_content_hash text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CHECK (appid > 0),
    CHECK (nullif(btrim(requested_by), '') IS NOT NULL),
    CHECK (nullif(btrim(reason), '') IS NOT NULL),
    CHECK (archive_content_hash ~ '^[0-9a-f]{64}$'),
    UNIQUE (work_id, archive_content_hash)
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_token_replay_audit_app
  ON ops.pics_token_replay_audit (appid, created_at DESC);

CREATE OR REPLACE FUNCTION legacy.upsert_storefront_app_evidence_v1(
    p_appid integer,
    p_name text,
    p_type text,
    p_is_free boolean,
    p_is_delisted boolean,
    p_release_date date,
    p_release_date_raw text,
    p_has_workshop boolean,
    p_current_price_cents integer,
    p_current_discount_percent integer,
    p_is_released boolean,
    p_developers text[],
    p_publishers text[],
    p_dlc_appids integer[] DEFAULT ARRAY[]::integer[],
    p_parent_appid integer DEFAULT NULL,
    p_demo_appids integer[] DEFAULT ARRAY[]::integer[],
    p_has_purchase_packages boolean DEFAULT NULL,
    p_genres jsonb DEFAULT NULL,
    p_categories jsonb DEFAULT NULL,
    p_platforms jsonb DEFAULT NULL,
    p_languages jsonb DEFAULT NULL,
    p_observed_at timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_field record;
BEGIN
  PERFORM legacy.upsert_storefront_app(
    p_appid,
    p_name,
    p_type,
    p_is_free,
    p_is_delisted,
    p_release_date,
    p_release_date_raw,
    p_has_workshop,
    p_current_price_cents,
    p_current_discount_percent,
    p_is_released,
    p_developers,
    p_publishers,
    p_dlc_appids,
    p_parent_appid,
    p_demo_appids,
    p_has_purchase_packages
  );

  IF p_genres IS NOT NULL THEN
    INSERT INTO legacy.steam_genres (genre_id, name)
    SELECT DISTINCT item.id::integer, item.name
    FROM jsonb_to_recordset(p_genres) AS item(id text, name text)
    WHERE item.id ~ '^[0-9]+$'
      AND item.id::bigint BETWEEN 1 AND 2147483647
      AND nullif(btrim(item.name), '') IS NOT NULL
    ON CONFLICT (genre_id) DO UPDATE SET name = EXCLUDED.name;

    DELETE FROM legacy.app_genres WHERE appid = p_appid;
    INSERT INTO legacy.app_genres (appid, genre_id, is_primary)
    SELECT
      p_appid,
      item.id::integer,
      row_number() OVER (ORDER BY item.ordinality) = 1
    FROM ROWS FROM (
      jsonb_to_recordset(p_genres) AS (id text, name text)
    ) WITH ORDINALITY AS item(id, name, ordinality)
    WHERE item.id ~ '^[0-9]+$'
      AND item.id::bigint BETWEEN 1 AND 2147483647
    ON CONFLICT (appid, genre_id)
    DO UPDATE SET is_primary = EXCLUDED.is_primary;
  END IF;

  IF p_categories IS NOT NULL THEN
    INSERT INTO legacy.steam_categories (category_id, name)
    SELECT DISTINCT item.id, item.name
    FROM jsonb_to_recordset(p_categories) AS item(id integer, name text)
    WHERE item.id > 0
      AND nullif(btrim(item.name), '') IS NOT NULL
    ON CONFLICT (category_id) DO UPDATE SET name = EXCLUDED.name;

    DELETE FROM legacy.app_categories WHERE appid = p_appid;
    INSERT INTO legacy.app_categories (appid, category_id)
    SELECT DISTINCT p_appid, item.id
    FROM jsonb_to_recordset(p_categories) AS item(id integer, name text)
    WHERE item.id > 0
    ON CONFLICT DO NOTHING;
  END IF;

  IF p_platforms IS NOT NULL THEN
    UPDATE legacy.apps
    SET platforms = (
      SELECT string_agg(value, ',' ORDER BY ordinality)
      FROM jsonb_array_elements_text(p_platforms)
        WITH ORDINALITY AS platform(value, ordinality)
    ),
    updated_at = clock_timestamp()
    WHERE appid = p_appid;
  END IF;

  IF p_languages IS NOT NULL THEN
    UPDATE legacy.apps
    SET languages = p_languages,
        updated_at = clock_timestamp()
    WHERE appid = p_appid;
  END IF;

  -- Historical normalized snapshots predate field-presence metadata. A NULL
  -- observation timestamp intentionally skips evidence mutation after the
  -- legacy latest-state upsert so replay cannot erase newer live evidence.
  IF p_observed_at IS NULL THEN
    RETURN;
  END IF;

  FOR v_field IN
    SELECT *
    FROM (VALUES
      (
        'genres'::text,
        CASE WHEN p_genres IS NULL THEN 'missing' ELSE 'known' END,
        CASE WHEN p_genres IS NULL THEN NULL ELSE COALESCE((
          SELECT jsonb_agg(item.name ORDER BY item.ordinality)
          FROM ROWS FROM (
            jsonb_to_recordset(p_genres) AS (id text, name text)
          ) WITH ORDINALITY AS item(id, name, ordinality)
        ), '[]'::jsonb) END,
        jsonb_build_object('items', COALESCE(p_genres, '[]'::jsonb))
      ),
      (
        'categories'::text,
        CASE WHEN p_categories IS NULL THEN 'missing' ELSE 'known' END,
        CASE WHEN p_categories IS NULL THEN NULL ELSE COALESCE((
          SELECT jsonb_agg(item.name ORDER BY item.name)
          FROM jsonb_to_recordset(p_categories) AS item(id integer, name text)
        ), '[]'::jsonb) END,
        jsonb_build_object('items', COALESCE(p_categories, '[]'::jsonb))
      ),
      (
        'platforms'::text,
        CASE WHEN p_platforms IS NULL THEN 'missing' ELSE 'known' END,
        p_platforms,
        '{}'::jsonb
      ),
      (
        'languages'::text,
        CASE WHEN p_languages IS NULL THEN 'missing' ELSE 'known' END,
        p_languages,
        '{}'::jsonb
      )
    ) AS fields(field_name, evidence_state, value, provenance)
  LOOP
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
    VALUES (
      p_appid,
      v_field.field_name,
      'storefront',
      v_field.evidence_state,
      v_field.value,
      p_observed_at,
      'steam-field-evidence/v1',
      jsonb_build_object(
        'authority', 'steam_storefront',
        'missingVersusEmptyPreserved', true
      ) || v_field.provenance,
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT (appid, field_name, source)
    DO UPDATE SET
      evidence_state = EXCLUDED.evidence_state,
      value = EXCLUDED.value,
      source_at = EXCLUDED.source_at,
      version = EXCLUDED.version,
      provenance = EXCLUDED.provenance,
      updated_at = clock_timestamp()
    WHERE EXCLUDED.source_at >= ops.app_field_evidence.source_at;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION legacy.upsert_storefront_app_evidence_v1(
  integer, text, text, boolean, boolean, date, text, boolean, integer,
  integer, boolean, text[], text[], integer[], integer, integer[], boolean,
  jsonb, jsonb, jsonb, jsonb, timestamp with time zone
) IS
  'Atomically promotes Storefront app state plus source-specific genre, category, platform, and language evidence without claiming PICS readiness.';
