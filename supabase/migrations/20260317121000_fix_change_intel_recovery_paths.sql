-- Migration: Fix change-intel recovery paths and storefront upsert conflicts
-- Adds queue indexes for queued/claimed hot paths and hardens upsert_storefront_app
-- against unreasonable prices and duplicate normalized developer/publisher names.

CREATE INDEX IF NOT EXISTS idx_app_capture_queue_queued_source_priority
  ON app_capture_queue(source, priority DESC, available_at ASC, id ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_app_capture_queue_claimed_source_time
  ON app_capture_queue(source, claimed_at ASC, id ASC)
  WHERE status = 'claimed';

DROP FUNCTION IF EXISTS upsert_storefront_app(
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
);

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
    SELECT EXISTS(SELECT 1 FROM apps WHERE appid = p_parent_appid) INTO v_valid_parent;
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
    END
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
    ON CONFLICT (parent_appid, dlc_appid) DO UPDATE SET source = 'storefront';
  END IF;

  UPDATE sync_status SET
    storefront_accessible = TRUE,
    last_storefront_sync = NOW(),
    consecutive_errors = 0,
    last_error_source = NULL,
    last_error_message = NULL,
    last_error_at = NULL
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
) IS 'Single-call storefront upsert with null-safe price handling and normalized developer/publisher dedupe.';
