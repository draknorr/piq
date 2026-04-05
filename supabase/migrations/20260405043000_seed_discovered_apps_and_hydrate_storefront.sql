-- Seed relation-discovered appids into apps/sync_status so storefront and PICS
-- can hydrate hidden DLCs that never appear in Steam's global app list.

ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS catalog_seed_state TEXT;

UPDATE apps
SET catalog_seed_state = 'hydrated'
WHERE catalog_seed_state IS NULL;

ALTER TABLE apps
  ALTER COLUMN catalog_seed_state SET DEFAULT 'hydrated';

ALTER TABLE apps
  ALTER COLUMN catalog_seed_state SET NOT NULL;

ALTER TABLE apps
  DROP CONSTRAINT IF EXISTS apps_catalog_seed_state_check;

ALTER TABLE apps
  ADD CONSTRAINT apps_catalog_seed_state_check
  CHECK (catalog_seed_state IN ('hydrated', 'stub', 'inaccessible'));

COMMENT ON COLUMN apps.catalog_seed_state IS
  'Catalog hydration state for app identity rows: hydrated, stub, or inaccessible.';

CREATE INDEX IF NOT EXISTS idx_apps_catalog_seed_state
  ON apps (catalog_seed_state)
  WHERE catalog_seed_state <> 'hydrated';

CREATE OR REPLACE FUNCTION seed_discovered_apps(p_records JSONB)
RETURNS INTEGER AS $$
DECLARE
  v_inserted_count INTEGER := 0;
BEGIN
  WITH normalized AS (
    SELECT DISTINCT
      (record->>'appid')::INTEGER AS appid,
      CASE LOWER(COALESCE(record->>'app_type', 'game'))
        WHEN 'dlc' THEN 'dlc'::app_type
        WHEN 'demo' THEN 'demo'::app_type
        WHEN 'mod' THEN 'mod'::app_type
        WHEN 'video' THEN 'video'::app_type
        WHEN 'hardware' THEN 'hardware'::app_type
        WHEN 'music' THEN 'music'::app_type
        ELSE 'game'::app_type
      END AS app_type,
      COALESCE(
        NULLIF(BTRIM(record->>'placeholder_name'), ''),
        FORMAT('Steam app %s (pending metadata)', (record->>'appid')::INTEGER)
      ) AS placeholder_name
    FROM jsonb_array_elements(COALESCE(p_records, '[]'::jsonb)) AS record
    WHERE jsonb_typeof(record) = 'object'
      AND COALESCE(record->>'appid', '') ~ '^[0-9]+$'
      AND (record->>'appid')::INTEGER > 0
  ),
  inserted_apps AS (
    INSERT INTO apps (
      appid,
      name,
      type,
      catalog_seed_state,
      created_at,
      updated_at
    )
    SELECT
      n.appid,
      n.placeholder_name,
      n.app_type,
      'stub',
      NOW(),
      NOW()
    FROM normalized n
    LEFT JOIN apps existing ON existing.appid = n.appid
    WHERE existing.appid IS NULL
    ON CONFLICT (appid) DO NOTHING
    RETURNING appid
  ),
  updated_stub_types AS (
    UPDATE apps a
    SET
      type = CASE
        WHEN n.app_type = 'dlc'::app_type THEN 'dlc'::app_type
        ELSE a.type
      END,
      updated_at = NOW()
    FROM normalized n
    WHERE a.appid = n.appid
      AND a.catalog_seed_state = 'stub'
      AND (
        (n.app_type = 'dlc'::app_type AND a.type IS DISTINCT FROM 'dlc'::app_type)
      )
    RETURNING a.appid
  ),
  inserted_sync_status AS (
    INSERT INTO sync_status (
      appid,
      priority_score,
      next_sync_after,
      is_syncable
    )
    SELECT
      n.appid,
      CASE WHEN n.app_type = 'dlc'::app_type THEN 20 ELSE 5 END,
      NOW(),
      TRUE
    FROM normalized n
    LEFT JOIN sync_status existing ON existing.appid = n.appid
    WHERE existing.appid IS NULL
    ON CONFLICT (appid) DO NOTHING
    RETURNING appid
  )
  SELECT COUNT(*) INTO v_inserted_count
  FROM inserted_apps;

  RETURN v_inserted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION seed_discovered_apps(JSONB) IS
  'Idempotently seeds relation-discovered app references into apps and sync_status as storefront-hydratable stubs.';

CREATE OR REPLACE FUNCTION upsert_storefront_app(
  p_appid INTEGER,
  p_name TEXT,
  p_type TEXT,
  p_is_free BOOLEAN,
  p_is_delisted BOOLEAN,
  p_release_date DATE,
  p_release_date_raw TEXT,
  p_has_workshop BOOLEAN,
  p_current_price_cents INTEGER,
  p_current_discount_percent INTEGER,
  p_is_released BOOLEAN,
  p_developers TEXT[],
  p_publishers TEXT[],
  p_dlc_appids INTEGER[] DEFAULT NULL,
  p_parent_appid INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_valid_parent BOOLEAN := FALSE;
  v_has_dev_or_pub BOOLEAN := FALSE;
  v_sanitized_price_cents INTEGER := CASE
    WHEN p_current_price_cents IS NULL THEN NULL
    WHEN p_current_price_cents < 0 THEN NULL
    WHEN p_current_price_cents > 50000 THEN NULL
    ELSE p_current_price_cents
  END;
BEGIN
  IF p_parent_appid IS NOT NULL THEN
    PERFORM seed_discovered_apps(
      jsonb_build_array(
        jsonb_build_object(
          'appid', p_parent_appid,
          'app_type', 'game',
          'discovery_reason', 'storefront_parent_reference'
        )
      )
    );

    SELECT EXISTS(SELECT 1 FROM apps WHERE appid = p_parent_appid) INTO v_valid_parent;
  END IF;

  IF p_dlc_appids IS NOT NULL AND array_length(p_dlc_appids, 1) > 0 THEN
    PERFORM seed_discovered_apps(
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'appid', dlc_id,
              'app_type', 'dlc',
              'discovery_reason', 'storefront_dlc_reference'
            )
          ),
          '[]'::jsonb
        )
        FROM (
          SELECT DISTINCT unnest(p_dlc_appids) AS dlc_id
        ) unique_dlc
        WHERE dlc_id IS NOT NULL AND dlc_id > 0
      )
    );
  END IF;

  UPDATE apps SET
    name = p_name,
    type = p_type::app_type,
    is_free = p_is_free,
    is_delisted = p_is_delisted,
    release_date = p_release_date,
    release_date_raw = p_release_date_raw,
    has_workshop = p_has_workshop,
    current_price_cents = v_sanitized_price_cents,
    current_discount_percent = p_current_discount_percent,
    is_released = p_is_released,
    parent_appid = CASE
      WHEN v_valid_parent THEN p_parent_appid
      ELSE parent_appid
    END,
    catalog_seed_state = 'hydrated',
    updated_at = NOW()
  WHERE appid = p_appid;

  IF p_developers IS NOT NULL AND array_length(p_developers, 1) > 0 THEN
    WITH normalized_names AS (
      SELECT
        TRIM(dev_name) AS name,
        LOWER(TRIM(dev_name)) AS normalized_name
      FROM unnest(p_developers) AS dev_name
      WHERE dev_name IS NOT NULL AND TRIM(dev_name) != ''
    ),
    canonical_names AS (
      SELECT DISTINCT ON (normalized_name)
        name,
        normalized_name
      FROM normalized_names
      ORDER BY
        normalized_name,
        CASE WHEN name = initcap(normalized_name) THEN 0 ELSE 1 END,
        LENGTH(name),
        name
    ),
    dev_upserts AS (
      INSERT INTO developers (name, normalized_name)
      SELECT name, normalized_name
      FROM canonical_names
      ON CONFLICT (normalized_name) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id
    )
    INSERT INTO app_developers (appid, developer_id)
    SELECT p_appid, id
    FROM dev_upserts
    ON CONFLICT (appid, developer_id) DO NOTHING;

    SELECT EXISTS(
      SELECT 1
      FROM unnest(p_developers) AS dev_name
      WHERE dev_name IS NOT NULL AND TRIM(dev_name) != ''
    ) INTO v_has_dev_or_pub;
  END IF;

  IF p_publishers IS NOT NULL AND array_length(p_publishers, 1) > 0 THEN
    WITH normalized_names AS (
      SELECT
        TRIM(pub_name) AS name,
        LOWER(TRIM(pub_name)) AS normalized_name
      FROM unnest(p_publishers) AS pub_name
      WHERE pub_name IS NOT NULL AND TRIM(pub_name) != ''
    ),
    canonical_names AS (
      SELECT DISTINCT ON (normalized_name)
        name,
        normalized_name
      FROM normalized_names
      ORDER BY
        normalized_name,
        CASE WHEN name = initcap(normalized_name) THEN 0 ELSE 1 END,
        LENGTH(name),
        name
    ),
    pub_upserts AS (
      INSERT INTO publishers (name, normalized_name)
      SELECT name, normalized_name
      FROM canonical_names
      ON CONFLICT (normalized_name) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id
    )
    INSERT INTO app_publishers (appid, publisher_id)
    SELECT p_appid, id
    FROM pub_upserts
    ON CONFLICT (appid, publisher_id) DO NOTHING;

    IF NOT v_has_dev_or_pub THEN
      SELECT EXISTS(
        SELECT 1
        FROM unnest(p_publishers) AS pub_name
        WHERE pub_name IS NOT NULL AND TRIM(pub_name) != ''
      ) INTO v_has_dev_or_pub;
    END IF;
  END IF;

  IF v_has_dev_or_pub THEN
    UPDATE apps SET has_developer_info = TRUE WHERE appid = p_appid;
  END IF;

  IF p_dlc_appids IS NOT NULL AND array_length(p_dlc_appids, 1) > 0 THEN
    INSERT INTO app_dlc (parent_appid, dlc_appid, source)
    SELECT DISTINCT p_appid, dlc_id, 'storefront'
    FROM unnest(p_dlc_appids) AS dlc_id
    WHERE dlc_id IS NOT NULL AND dlc_id > 0
    ON CONFLICT (parent_appid, dlc_appid) DO UPDATE SET source = 'storefront';
  END IF;

  UPDATE sync_status SET
    storefront_accessible = TRUE,
    last_storefront_sync = NOW(),
    consecutive_errors = 0,
    last_error_source = NULL,
    last_error_message = NULL,
    last_error_at = NULL,
    is_syncable = TRUE
  WHERE appid = p_appid;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_storefront_app(
  INTEGER,
  TEXT,
  TEXT,
  BOOLEAN,
  BOOLEAN,
  DATE,
  TEXT,
  BOOLEAN,
  INTEGER,
  INTEGER,
  BOOLEAN,
  TEXT[],
  TEXT[],
  INTEGER[],
  INTEGER
) IS 'Single-call storefront upsert that hydrates seeded app stubs and seeds discovered parent/DLC references before relation writes.';
