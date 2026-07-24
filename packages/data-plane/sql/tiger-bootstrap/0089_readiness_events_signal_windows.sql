-- Additive preparation contracts for source readiness, normalized lifecycle
-- events, the change-event registry, and recomputable signal windows.
--
-- This file is intentionally not applied by scheduled workflows. Applying it
-- is a production Tiger write and requires a separately approved write window.

SET statement_timeout = '15min';

CREATE TABLE IF NOT EXISTS events.change_event_registry_versions (
    registry_version text PRIMARY KEY,
    status text NOT NULL,
    unknown_behavior text NOT NULL,
    activated_at timestamp with time zone,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT change_event_registry_versions_status_check CHECK (
      status = ANY (ARRAY['draft'::text, 'active'::text, 'deprecated'::text])
    ),
    CONSTRAINT change_event_registry_versions_unknown_check CHECK (
      unknown_behavior = 'preserve_unknown'
    ),
    CONSTRAINT change_event_registry_versions_time_check CHECK (
      deprecated_at IS NULL OR activated_at IS NULL OR deprecated_at >= activated_at
    )
);

INSERT INTO events.change_event_registry_versions (
  registry_version,
  status,
  unknown_behavior,
  activated_at,
  deprecated_at,
  updated_at
)
VALUES (
  'change-events/v1',
  'active',
  'preserve_unknown',
  TIMESTAMPTZ '2026-07-24 00:00:00+00',
  NULL,
  now()
)
ON CONFLICT (registry_version)
DO UPDATE SET
  status = EXCLUDED.status,
  unknown_behavior = EXCLUDED.unknown_behavior,
  activated_at = EXCLUDED.activated_at,
  deprecated_at = EXCLUDED.deprecated_at,
  updated_at = now();

CREATE TABLE IF NOT EXISTS events.change_event_registry (
    registry_version text NOT NULL
      REFERENCES events.change_event_registry_versions(registry_version)
      ON DELETE RESTRICT,
    source text NOT NULL,
    raw_event_type text NOT NULL,
    signal_family text NOT NULL,
    user_label text NOT NULL,
    compatibility_story_kind text NOT NULL,
    affects_readiness boolean NOT NULL DEFAULT false,
    affects_eligibility_inputs boolean NOT NULL DEFAULT false,
    default_unknown_behavior text NOT NULL DEFAULT 'preserve_unknown',
    activated_at timestamp with time zone NOT NULL,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT change_event_registry_pkey PRIMARY KEY (
      registry_version,
      source,
      raw_event_type
    ),
    CONSTRAINT change_event_registry_signal_family_check CHECK (
      signal_family = ANY (
        ARRAY[
          'announcement'::text,
          'release'::text,
          'pricing'::text,
          'store-page'::text,
          'media'::text,
          'taxonomy'::text,
          'platform'::text,
          'build'::text
        ]
      )
    ),
    CONSTRAINT change_event_registry_story_kind_check CHECK (
      compatibility_story_kind = ANY (
        ARRAY[
          'announcement'::text,
          'release-prep'::text,
          'commercial-move'::text,
          'store-refresh'::text,
          'positioning-shift'::text,
          'platform-expansion'::text,
          'build-activity'::text
        ]
      )
    ),
    CONSTRAINT change_event_registry_unknown_check CHECK (
      default_unknown_behavior = 'preserve_unknown'
    ),
    CONSTRAINT change_event_registry_time_check CHECK (
      deprecated_at IS NULL OR deprecated_at >= activated_at
    )
);

CREATE INDEX IF NOT EXISTS idx_events_change_event_registry_active_type
  ON events.change_event_registry (
    registry_version,
    raw_event_type,
    source
  )
  WHERE deprecated_at IS NULL;

INSERT INTO events.change_event_registry (
  registry_version,
  source,
  raw_event_type,
  signal_family,
  user_label,
  compatibility_story_kind,
  affects_readiness,
  affects_eligibility_inputs,
  default_unknown_behavior,
  activated_at,
  deprecated_at,
  updated_at
)
VALUES
  ('change-events/v1', 'news', 'news_published', 'announcement', 'Announcement', 'announcement', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'news', 'news_edited', 'announcement', 'Announcement edit', 'announcement', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'catalog', 'first_observed', 'release', 'First observed', 'release-prep', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'release_date_text_change', 'release', 'Release timing', 'release-prep', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'release_state_changed', 'release', 'Release state', 'release-prep', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'demo_references_changed', 'release', 'Playable demo', 'release-prep', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'price_change', 'pricing', 'Price', 'commercial-move', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'discount_start', 'pricing', 'Discount', 'commercial-move', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'discount_end', 'pricing', 'Discount', 'commercial-move', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'dlc_references_changed', 'pricing', 'DLC', 'commercial-move', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'dlc_references_changed', 'pricing', 'DLC', 'commercial-move', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'package_references_changed', 'pricing', 'Packages', 'commercial-move', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'description_rewrite', 'store-page', 'Store description', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'short_description_rewrite', 'store-page', 'Short description', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'capsule_url_changed', 'media', 'Capsule art', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'header_url_changed', 'media', 'Header art', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'background_url_changed', 'media', 'Background art', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'screenshot_added', 'media', 'Screenshots', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'screenshot_removed', 'media', 'Screenshots', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'screenshot_reordered', 'media', 'Screenshots', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'trailer_added', 'media', 'Trailer', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'trailer_removed', 'media', 'Trailer', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'trailer_reordered', 'media', 'Trailer', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'media', 'trailer_thumbnail_changed', 'media', 'Trailer art', 'store-refresh', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'genres_changed', 'taxonomy', 'Genres', 'positioning-shift', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'genres_changed', 'taxonomy', 'Genres', 'positioning-shift', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'categories_changed', 'taxonomy', 'Categories', 'positioning-shift', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'categories_changed', 'taxonomy', 'Categories', 'positioning-shift', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'tags_added', 'taxonomy', 'Tags', 'positioning-shift', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'tags_removed', 'taxonomy', 'Tags', 'positioning-shift', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'publisher_association_changed', 'taxonomy', 'Publisher', 'positioning-shift', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'publisher_association_changed', 'taxonomy', 'Publisher', 'positioning-shift', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'developer_association_changed', 'taxonomy', 'Developer', 'positioning-shift', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'developer_association_changed', 'taxonomy', 'Developer', 'positioning-shift', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'languages_changed', 'platform', 'Languages', 'platform-expansion', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'languages_changed', 'platform', 'Languages', 'platform-expansion', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'platforms_changed', 'platform', 'Platforms', 'platform-expansion', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'platforms_changed', 'platform', 'Platforms', 'platform-expansion', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'storefront', 'controller_support_changed', 'platform', 'Controller support', 'platform-expansion', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'controller_support_changed', 'platform', 'Controller support', 'platform-expansion', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'steam_deck_status_changed', 'platform', 'Steam Deck', 'platform-expansion', true, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'build_id_changed', 'build', 'Build', 'build-activity', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now()),
  ('change-events/v1', 'pics', 'last_content_update_changed', 'build', 'Content update', 'build-activity', false, true, 'preserve_unknown', TIMESTAMPTZ '2026-07-24 00:00:00+00', NULL, now())
ON CONFLICT (registry_version, source, raw_event_type)
DO UPDATE SET
  signal_family = EXCLUDED.signal_family,
  user_label = EXCLUDED.user_label,
  compatibility_story_kind = EXCLUDED.compatibility_story_kind,
  affects_readiness = EXCLUDED.affects_readiness,
  affects_eligibility_inputs = EXCLUDED.affects_eligibility_inputs,
  default_unknown_behavior = EXCLUDED.default_unknown_behavior,
  activated_at = EXCLUDED.activated_at,
  deprecated_at = EXCLUDED.deprecated_at,
  updated_at = now();

CREATE OR REPLACE FUNCTION events.resolve_change_event_v1(
  p_source text,
  p_raw_event_type text
)
RETURNS TABLE (
  registry_version text,
  signal_family text,
  user_label text,
  compatibility_story_kind text,
  affects_readiness boolean,
  affects_eligibility_inputs boolean,
  unknown_behavior text,
  is_known boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH matched AS (
    SELECT
      registry.registry_version,
      registry.signal_family,
      registry.user_label,
      registry.compatibility_story_kind,
      registry.affects_readiness,
      registry.affects_eligibility_inputs,
      registry.default_unknown_behavior AS unknown_behavior,
      true AS is_known,
      0 AS precedence
    FROM events.change_event_registry registry
    WHERE registry.registry_version = 'change-events/v1'
      AND registry.source = p_source
      AND registry.raw_event_type = p_raw_event_type
      AND registry.deprecated_at IS NULL
  ),
  unknown_fallback AS (
    SELECT
      'change-events/v1'::text AS registry_version,
      'unknown'::text AS signal_family,
      initcap(replace(replace(coalesce(nullif(btrim(p_raw_event_type), ''), 'unknown change'), '_', ' '), '-', ' ')) AS user_label,
      'general-update'::text AS compatibility_story_kind,
      false AS affects_readiness,
      false AS affects_eligibility_inputs,
      'preserve_unknown'::text AS unknown_behavior,
      false AS is_known,
      1 AS precedence
  )
  SELECT
    resolved.registry_version,
    resolved.signal_family,
    resolved.user_label,
    resolved.compatibility_story_kind,
    resolved.affects_readiness,
    resolved.affects_eligibility_inputs,
    resolved.unknown_behavior,
    resolved.is_known
  FROM (
    SELECT * FROM matched
    UNION ALL
    SELECT * FROM unknown_fallback
  ) resolved
  ORDER BY resolved.precedence
  LIMIT 1;
$$;

CREATE OR REPLACE VIEW events.app_change_events_v1 AS
SELECT
  event.*,
  resolved.registry_version,
  resolved.signal_family,
  resolved.user_label,
  resolved.compatibility_story_kind,
  resolved.affects_readiness,
  resolved.affects_eligibility_inputs,
  resolved.unknown_behavior,
  resolved.is_known AS registry_known
FROM events.app_change_events event
CROSS JOIN LATERAL events.resolve_change_event_v1(
  event.source,
  event.change_type
) resolved;

CREATE OR REPLACE VIEW ops.change_event_registry_health_v1 AS
SELECT
  'change-events/v1'::text AS registry_version,
  event.source,
  event.change_type AS raw_event_type,
  count(*)::bigint AS occurrence_count,
  min(event.occurred_at) AS first_occurred_at,
  max(event.occurred_at) AS latest_occurred_at,
  max(event.created_at) AS latest_processed_at
FROM events.app_change_events event
LEFT JOIN events.change_event_registry registry
  ON registry.registry_version = 'change-events/v1'
 AND registry.source = event.source
 AND registry.raw_event_type = event.change_type
 AND registry.deprecated_at IS NULL
WHERE registry.raw_event_type IS NULL
GROUP BY event.source, event.change_type;

CREATE TABLE IF NOT EXISTS events.app_lifecycle_events (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    event_type text NOT NULL,
    source text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    effective_at timestamp with time zone,
    source_event_id text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    before_state jsonb,
    after_state jsonb,
    registry_version text NOT NULL
      REFERENCES events.change_event_registry_versions(registry_version)
      ON DELETE RESTRICT,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_lifecycle_events_type_check CHECK (
      event_type = ANY (
        ARRAY['first_observed'::text, 'release_state_changed'::text]
      )
    ),
    CONSTRAINT app_lifecycle_events_source_check CHECK (
      source = ANY (ARRAY['catalog'::text, 'storefront'::text])
    ),
    CONSTRAINT app_lifecycle_events_before_state_check CHECK (
      before_state IS NULL OR jsonb_typeof(before_state) = 'object'
    ),
    CONSTRAINT app_lifecycle_events_after_state_check CHECK (
      after_state IS NULL OR jsonb_typeof(after_state) = 'object'
    ),
    CONSTRAINT app_lifecycle_events_provenance_check CHECK (
      jsonb_typeof(provenance) = 'object'
    )
);

CREATE INDEX IF NOT EXISTS idx_events_app_lifecycle_events_appid_time
  ON events.app_lifecycle_events (appid, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_app_lifecycle_events_type_time
  ON events.app_lifecycle_events (event_type, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION events.capture_storefront_snapshot_lifecycle_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous docs.app_source_snapshots%ROWTYPE;
  v_previous_coming_soon boolean;
  v_next_coming_soon boolean;
BEGIN
  IF NEW.source <> 'storefront' THEN
    RETURN NEW;
  END IF;

  IF NEW.previous_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_previous
  FROM docs.app_source_snapshots
  WHERE id = NEW.previous_snapshot_id
    AND appid = NEW.appid
    AND source = 'storefront';

  IF NOT FOUND
     OR v_previous.snapshot_summary->>'comingSoon' NOT IN ('true', 'false')
     OR NEW.snapshot_summary->>'comingSoon' NOT IN ('true', 'false')
  THEN
    RETURN NEW;
  END IF;

  v_previous_coming_soon := (v_previous.snapshot_summary->>'comingSoon')::boolean;
  v_next_coming_soon := (NEW.snapshot_summary->>'comingSoon')::boolean;

  IF v_previous_coming_soon IS NOT DISTINCT FROM v_next_coming_soon THEN
    RETURN NEW;
  END IF;

  INSERT INTO events.app_lifecycle_events (
    appid,
    event_type,
    source,
    occurred_at,
    effective_at,
    source_event_id,
    idempotency_key,
    before_state,
    after_state,
    registry_version,
    provenance,
    created_at
  )
  VALUES (
    NEW.appid,
    'release_state_changed',
    'storefront',
    NEW.observed_at,
    NEW.observed_at,
    'app_source_snapshot:' || NEW.id::text,
    'storefront:release_state_changed:snapshot:' || NEW.id::text,
    jsonb_build_object('is_released', NOT v_previous_coming_soon),
    jsonb_build_object('is_released', NOT v_next_coming_soon),
    'change-events/v1',
    jsonb_build_object(
      'source_snapshot_id', NEW.id,
      'previous_snapshot_id', NEW.previous_snapshot_id,
      'content_hash', NEW.content_hash,
      'archive_bucket', NEW.archive_bucket,
      'archive_key', NEW.archive_key
    ),
    clock_timestamp()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'capture_storefront_snapshot_lifecycle_v1'
      AND tgrelid = 'docs.app_source_snapshots'::regclass
  ) THEN
    CREATE TRIGGER capture_storefront_snapshot_lifecycle_v1
    AFTER INSERT ON docs.app_source_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION events.capture_storefront_snapshot_lifecycle_v1();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION events.capture_catalog_lifecycle_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_scan_mode text;
BEGIN
  IF NEW.event_type <> 'first_observed' THEN
    RETURN NEW;
  END IF;

  SELECT mode
  INTO v_scan_mode
  FROM ops.catalog_scan_runs
  WHERE id = NEW.scan_run_id;

  INSERT INTO events.app_lifecycle_events (
    appid,
    event_type,
    source,
    occurred_at,
    effective_at,
    source_event_id,
    idempotency_key,
    before_state,
    after_state,
    registry_version,
    provenance,
    created_at
  )
  VALUES (
    NEW.appid,
    'first_observed',
    'catalog',
    NEW.observed_at,
    NEW.observed_at,
    'app_catalog_event:' || NEW.id::text,
    NEW.idempotency_key,
    NULL,
    jsonb_build_object('observed', true),
    'change-events/v1',
    jsonb_build_object(
      'catalog_event_id', NEW.id,
      'catalog_source', NEW.source,
      'catalog_scan_run_id', NEW.scan_run_id,
      'catalog_observation_mode', coalesce(v_scan_mode, 'unknown'),
      'payload', NEW.payload
    ),
    clock_timestamp()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'capture_catalog_lifecycle_v1'
      AND tgrelid = 'events.app_catalog_events'::regclass
  ) THEN
    CREATE TRIGGER capture_catalog_lifecycle_v1
    AFTER INSERT ON events.app_catalog_events
    FOR EACH ROW
    EXECUTE FUNCTION events.capture_catalog_lifecycle_v1();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION events.materialize_catalog_lifecycle_events_v1(
  p_after_catalog_event_id bigint,
  p_limit integer
)
RETURNS TABLE (
  inserted_rows integer,
  last_catalog_event_id bigint
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_after_catalog_event_id IS NULL OR p_after_catalog_event_id < 0 THEN
    RAISE EXCEPTION
      'materialize_catalog_lifecycle_events_v1 requires a nonnegative cursor';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION
      'materialize_catalog_lifecycle_events_v1 limit must be between 1 and 10000';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      event.id,
      event.appid,
      event.observed_at,
      event.source,
      event.scan_run_id,
      event.idempotency_key,
      event.payload,
      scan.mode
    FROM events.app_catalog_events event
    JOIN ops.catalog_scan_runs scan ON scan.id = event.scan_run_id
    WHERE event.id > p_after_catalog_event_id
      AND event.event_type = 'first_observed'
    ORDER BY event.id
    LIMIT p_limit
  ),
  inserted AS (
    INSERT INTO events.app_lifecycle_events (
      appid,
      event_type,
      source,
      occurred_at,
      effective_at,
      source_event_id,
      idempotency_key,
      before_state,
      after_state,
      registry_version,
      provenance,
      created_at
    )
    SELECT
      candidate.appid,
      'first_observed',
      'catalog',
      candidate.observed_at,
      candidate.observed_at,
      'app_catalog_event:' || candidate.id::text,
      candidate.idempotency_key,
      NULL,
      jsonb_build_object('observed', true),
      'change-events/v1',
      jsonb_build_object(
        'catalog_event_id', candidate.id,
        'catalog_source', candidate.source,
        'catalog_scan_run_id', candidate.scan_run_id,
        'catalog_observation_mode', candidate.mode,
        'payload', candidate.payload,
        'materialized_by', 'events.materialize_catalog_lifecycle_events_v1'
      ),
      clock_timestamp()
    FROM candidates candidate
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*)::integer FROM inserted),
    coalesce(
      (SELECT max(candidate.id) FROM candidates candidate),
      p_after_catalog_event_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION ops.refresh_overall_readiness_v1(
  p_appids integer[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected integer;
BEGIN
  IF p_appids IS NULL OR coalesce(array_length(p_appids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'refresh_overall_readiness_v1 requires at least one appid';
  END IF;
  IF cardinality(p_appids) > 5000 THEN
    RAISE EXCEPTION 'refresh_overall_readiness_v1 accepts at most 5000 appids';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_appids) AS input(appid)
    WHERE input.appid IS NULL OR input.appid <= 0
  ) THEN
    RAISE EXCEPTION
      'refresh_overall_readiness_v1 requires every appid to be positive';
  END IF;

  WITH input_appids AS (
    SELECT DISTINCT input.appid
    FROM unnest(p_appids) AS input(appid)
  ),
  required_sources AS (
    SELECT unnest(ARRAY['catalog'::text, 'storefront'::text, 'pics'::text]) AS source
  ),
  source_states AS (
    SELECT
      input.appid,
      required.source,
      coalesce(readiness.status, 'unknown') AS status,
      readiness.source_at,
      readiness.processed_at,
      readiness.retryable,
      readiness.blocking_reason,
      readiness.version
    FROM input_appids input
    CROSS JOIN required_sources required
    LEFT JOIN ops.app_data_readiness readiness
      ON readiness.appid = input.appid
     AND readiness.source = required.source
  ),
  aggregated AS (
    SELECT
      appid,
      CASE
        WHEN bool_or(status = 'invalid') THEN 'invalid'
        WHEN bool_or(status = 'failed') THEN 'failed'
        WHEN bool_or(status = 'source_blocked') THEN 'source_blocked'
        WHEN bool_or(status = 'stale') THEN 'stale'
        WHEN bool_or(status = 'partial') THEN 'partial'
        WHEN bool_or(status IN ('unknown', 'pending')) THEN 'pending'
        WHEN bool_and(status = 'ready') THEN 'ready'
        ELSE 'pending'
      END AS status,
      CASE
        WHEN count(source_at) = 3 THEN min(source_at)
        ELSE NULL
      END AS source_at,
      max(processed_at) AS processed_at,
      bool_or(coalesce(retryable, true)) AS retryable,
      nullif(
        string_agg(
          source || ':' || status,
          ',' ORDER BY source
        ) FILTER (WHERE status <> 'ready'),
        ''
      ) AS blocking_reason,
      jsonb_build_object(
        'policy', 'core_sources',
        'required_sources', jsonb_build_object(
          'catalog', max(status) FILTER (WHERE source = 'catalog'),
          'storefront', max(status) FILTER (WHERE source = 'storefront'),
          'pics', max(status) FILTER (WHERE source = 'pics')
        ),
        'source_versions', jsonb_build_object(
          'catalog', max(version) FILTER (WHERE source = 'catalog'),
          'storefront', max(version) FILTER (WHERE source = 'storefront'),
          'pics', max(version) FILTER (WHERE source = 'pics')
        )
      ) AS provenance
    FROM source_states
    GROUP BY appid
  ),
  upserted AS (
    INSERT INTO ops.app_data_readiness (
      appid,
      source,
      status,
      source_at,
      processed_at,
      version,
      blocking_reason,
      retryable,
      provenance,
      created_at,
      updated_at
    )
    SELECT
      appid,
      'overall',
      status,
      source_at,
      processed_at,
      'overall-core-readiness/v1',
      blocking_reason,
      retryable,
      provenance,
      clock_timestamp(),
      clock_timestamp()
    FROM aggregated
    ON CONFLICT (appid, source)
    DO UPDATE SET
      status = EXCLUDED.status,
      source_at = EXCLUDED.source_at,
      processed_at = EXCLUDED.processed_at,
      version = EXCLUDED.version,
      blocking_reason = EXCLUDED.blocking_reason,
      retryable = EXCLUDED.retryable,
      provenance = EXCLUDED.provenance,
      updated_at = clock_timestamp()
    RETURNING 1
  )
  SELECT count(*) INTO v_affected FROM upserted;

  RETURN coalesce(v_affected, 0);
END;
$$;

CREATE OR REPLACE FUNCTION ops.refresh_overall_readiness_after_source_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = ANY (ARRAY['catalog'::text, 'storefront'::text, 'pics'::text]) THEN
    PERFORM ops.refresh_overall_readiness_v1(ARRAY[NEW.appid]);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'refresh_overall_readiness_after_source_v1'
      AND tgrelid = 'ops.app_data_readiness'::regclass
  ) THEN
    CREATE TRIGGER refresh_overall_readiness_after_source_v1
    AFTER INSERT OR UPDATE OF status, source_at, processed_at, version,
      blocking_reason, retryable, provenance
    ON ops.app_data_readiness
    FOR EACH ROW
    EXECUTE FUNCTION ops.refresh_overall_readiness_after_source_v1();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ops.capture_catalog_readiness_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_scan ops.catalog_scan_runs%ROWTYPE;
BEGIN
  IF NEW.last_successful_scan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_scan
  FROM ops.catalog_scan_runs
  WHERE id = NEW.last_successful_scan_id;

  IF NOT FOUND OR v_scan.mode <> 'primary' OR v_scan.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  INSERT INTO ops.app_data_readiness (
    appid,
    source,
    status,
    source_at,
    processed_at,
    version,
    blocking_reason,
    retryable,
    provenance,
    created_at,
    updated_at
  )
  VALUES (
    NEW.appid,
    'catalog',
    'ready',
    NEW.last_observed_at,
    coalesce(v_scan.completed_at, clock_timestamp()),
    'catalog-readiness/v1',
    NULL,
    true,
    jsonb_build_object(
      'catalog_scan_run_id', NEW.last_successful_scan_id,
      'catalog_source', v_scan.source,
      'catalog_scan_kind', v_scan.scan_kind,
      'catalog_observation_mode', v_scan.mode,
      'last_full_reconciled_at', NEW.last_full_reconciled_at
    ),
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (appid, source)
  DO UPDATE SET
    status = EXCLUDED.status,
    source_at = EXCLUDED.source_at,
    processed_at = EXCLUDED.processed_at,
    version = EXCLUDED.version,
    blocking_reason = EXCLUDED.blocking_reason,
    retryable = EXCLUDED.retryable,
    provenance = EXCLUDED.provenance,
    updated_at = clock_timestamp()
  WHERE ops.app_data_readiness.source_at IS NULL
     OR EXCLUDED.source_at >= ops.app_data_readiness.source_at;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'capture_catalog_readiness_v1'
      AND tgrelid = 'ops.app_catalog_state'::regclass
  ) THEN
    CREATE TRIGGER capture_catalog_readiness_v1
    AFTER INSERT OR UPDATE OF last_successful_scan_id
    ON ops.app_catalog_state
    FOR EACH ROW
    EXECUTE FUNCTION ops.capture_catalog_readiness_v1();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ops.capture_storefront_sync_readiness_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_snapshot docs.app_source_snapshots%ROWTYPE;
BEGIN
  IF NEW.last_storefront_sync IS NULL
     OR NEW.storefront_accessible IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_snapshot
  FROM docs.app_source_snapshots
  WHERE appid = NEW.appid
    AND source = 'storefront'
  ORDER BY observed_at DESC, id DESC
  LIMIT 1;

  INSERT INTO ops.app_data_readiness (
    appid,
    source,
    status,
    source_at,
    processed_at,
    version,
    blocking_reason,
    retryable,
    provenance,
    created_at,
    updated_at
  )
  VALUES (
    NEW.appid,
    'storefront',
    CASE
      WHEN NEW.storefront_accessible THEN 'ready'
      ELSE 'source_blocked'
    END,
    NEW.last_storefront_sync,
    clock_timestamp(),
    'storefront-readiness/v1',
    CASE
      WHEN NEW.storefront_accessible THEN NULL
      ELSE 'storefront_inaccessible'
    END,
    true,
    jsonb_build_object(
      'storefront_accessible', NEW.storefront_accessible,
      'last_error_source', NEW.last_error_source,
      'last_error_at', NEW.last_error_at,
      'source_snapshot_id', v_snapshot.id,
      'snapshot_observed_at', v_snapshot.observed_at,
      'content_hash', v_snapshot.content_hash,
      'archive_bucket', v_snapshot.archive_bucket,
      'archive_key', v_snapshot.archive_key
    ),
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (appid, source)
  DO UPDATE SET
    status = EXCLUDED.status,
    source_at = EXCLUDED.source_at,
    processed_at = EXCLUDED.processed_at,
    version = EXCLUDED.version,
    blocking_reason = EXCLUDED.blocking_reason,
    retryable = EXCLUDED.retryable,
    provenance = EXCLUDED.provenance,
    updated_at = clock_timestamp()
  WHERE ops.app_data_readiness.source_at IS NULL
     OR EXCLUDED.source_at >= ops.app_data_readiness.source_at;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'capture_storefront_sync_readiness_v1'
      AND tgrelid = 'ops.sync_status'::regclass
  ) THEN
    CREATE TRIGGER capture_storefront_sync_readiness_v1
    AFTER INSERT OR UPDATE OF last_storefront_sync, storefront_accessible
    ON ops.sync_status
    FOR EACH ROW
    EXECUTE FUNCTION ops.capture_storefront_sync_readiness_v1();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS metrics.app_signal_windows_v1 (
    appid integer PRIMARY KEY REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    as_of_date date NOT NULL,
    window_7d_start date NOT NULL,
    window_30d_start date NOT NULL,
    review_first_date_7d date,
    review_latest_date_7d date,
    review_total_start_7d bigint,
    review_total_latest_7d bigint,
    review_change_7d bigint,
    review_observed_days_7d smallint NOT NULL,
    review_missing_days_7d smallint NOT NULL,
    ccu_first_date_7d date,
    ccu_latest_date_7d date,
    ccu_peak_first_7d integer,
    ccu_peak_latest_7d integer,
    ccu_peak_max_7d integer,
    ccu_peak_avg_7d numeric(14, 2),
    ccu_peak_change_7d integer,
    ccu_observed_days_7d smallint NOT NULL,
    ccu_missing_days_7d smallint NOT NULL,
    review_first_date_30d date,
    review_latest_date_30d date,
    review_total_start_30d bigint,
    review_total_latest_30d bigint,
    review_change_30d bigint,
    review_observed_days_30d smallint NOT NULL,
    review_missing_days_30d smallint NOT NULL,
    ccu_first_date_30d date,
    ccu_latest_date_30d date,
    ccu_peak_first_30d integer,
    ccu_peak_latest_30d integer,
    ccu_peak_max_30d integer,
    ccu_peak_avg_30d numeric(14, 2),
    ccu_peak_change_30d integer,
    ccu_observed_days_30d smallint NOT NULL,
    ccu_missing_days_30d smallint NOT NULL,
    coverage_state text NOT NULL,
    incomplete_coverage boolean NOT NULL,
    source_max_metric_date date,
    source_at timestamp with time zone,
    calculated_at timestamp with time zone NOT NULL,
    calculation_version text NOT NULL,
    confidence jsonb NOT NULL,
    provenance jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_signal_windows_v1_7d_dates_check CHECK (
      window_7d_start = as_of_date - 6
    ),
    CONSTRAINT app_signal_windows_v1_30d_dates_check CHECK (
      window_30d_start = as_of_date - 29
    ),
    CONSTRAINT app_signal_windows_v1_7d_coverage_check CHECK (
      review_observed_days_7d BETWEEN 0 AND 7
      AND review_missing_days_7d = 7 - review_observed_days_7d
      AND ccu_observed_days_7d BETWEEN 0 AND 7
      AND ccu_missing_days_7d = 7 - ccu_observed_days_7d
    ),
    CONSTRAINT app_signal_windows_v1_30d_coverage_check CHECK (
      review_observed_days_30d BETWEEN 0 AND 30
      AND review_missing_days_30d = 30 - review_observed_days_30d
      AND ccu_observed_days_30d BETWEEN 0 AND 30
      AND ccu_missing_days_30d = 30 - ccu_observed_days_30d
    ),
    CONSTRAINT app_signal_windows_v1_coverage_state_check CHECK (
      coverage_state = ANY (
        ARRAY['none'::text, 'partial'::text, 'complete'::text]
      )
    ),
    CONSTRAINT app_signal_windows_v1_confidence_check CHECK (
      jsonb_typeof(confidence) = 'object'
    ),
    CONSTRAINT app_signal_windows_v1_provenance_check CHECK (
      jsonb_typeof(provenance) = 'object'
    )
);

CREATE INDEX IF NOT EXISTS idx_metrics_app_signal_windows_v1_as_of
  ON metrics.app_signal_windows_v1 (
    as_of_date DESC,
    coverage_state,
    appid
  );
CREATE INDEX IF NOT EXISTS idx_metrics_app_signal_windows_v1_source_date
  ON metrics.app_signal_windows_v1 (
    source_max_metric_date DESC NULLS LAST,
    appid
  );

CREATE OR REPLACE FUNCTION metrics.refresh_app_signal_windows_v1(
  p_as_of_date date,
  p_appids integer[],
  p_calculation_version text DEFAULT 'signal-windows/v1'
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected integer;
BEGIN
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'refresh_app_signal_windows_v1 requires p_as_of_date';
  END IF;
  IF p_appids IS NULL OR coalesce(array_length(p_appids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'refresh_app_signal_windows_v1 requires at least one appid';
  END IF;
  IF cardinality(p_appids) > 5000 THEN
    RAISE EXCEPTION 'refresh_app_signal_windows_v1 accepts at most 5000 appids';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_appids) AS input(appid)
    WHERE input.appid IS NULL OR input.appid <= 0
  ) THEN
    RAISE EXCEPTION
      'refresh_app_signal_windows_v1 requires every appid to be positive';
  END IF;
  IF nullif(btrim(p_calculation_version), '') IS NULL THEN
    RAISE EXCEPTION 'refresh_app_signal_windows_v1 requires p_calculation_version';
  END IF;

  WITH input_appids AS (
    SELECT DISTINCT input.appid
    FROM unnest(p_appids) AS input(appid)
  ),
  observations AS (
    SELECT metrics.*
    FROM metrics.daily_metrics metrics
    JOIN input_appids input ON input.appid = metrics.appid
    WHERE metrics.metric_date BETWEEN p_as_of_date - 29 AND p_as_of_date
  ),
  aggregated AS (
    SELECT
      input.appid,
      min(observations.metric_date) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
          AND observations.total_reviews IS NOT NULL
      ) AS review_first_date_7d,
      max(observations.metric_date) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
          AND observations.total_reviews IS NOT NULL
      ) AS review_latest_date_7d,
      (
        array_agg(observations.total_reviews ORDER BY observations.metric_date)
        FILTER (
          WHERE observations.metric_date >= p_as_of_date - 6
            AND observations.total_reviews IS NOT NULL
        )
      )[1]::bigint AS review_total_start_7d,
      (
        array_agg(observations.total_reviews ORDER BY observations.metric_date DESC)
        FILTER (
          WHERE observations.metric_date >= p_as_of_date - 6
            AND observations.total_reviews IS NOT NULL
        )
      )[1]::bigint AS review_total_latest_7d,
      count(DISTINCT observations.metric_date) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
          AND observations.total_reviews IS NOT NULL
      )::smallint AS review_observed_days_7d,
      min(observations.metric_date) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
          AND observations.ccu_peak IS NOT NULL
      ) AS ccu_first_date_7d,
      max(observations.metric_date) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
          AND observations.ccu_peak IS NOT NULL
      ) AS ccu_latest_date_7d,
      (
        array_agg(observations.ccu_peak ORDER BY observations.metric_date)
        FILTER (
          WHERE observations.metric_date >= p_as_of_date - 6
            AND observations.ccu_peak IS NOT NULL
        )
      )[1] AS ccu_peak_first_7d,
      (
        array_agg(observations.ccu_peak ORDER BY observations.metric_date DESC)
        FILTER (
          WHERE observations.metric_date >= p_as_of_date - 6
            AND observations.ccu_peak IS NOT NULL
        )
      )[1] AS ccu_peak_latest_7d,
      max(observations.ccu_peak) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
      ) AS ccu_peak_max_7d,
      round(avg(observations.ccu_peak) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
      ), 2) AS ccu_peak_avg_7d,
      count(DISTINCT observations.metric_date) FILTER (
        WHERE observations.metric_date >= p_as_of_date - 6
          AND observations.ccu_peak IS NOT NULL
      )::smallint AS ccu_observed_days_7d,
      min(observations.metric_date) FILTER (
        WHERE observations.total_reviews IS NOT NULL
      ) AS review_first_date_30d,
      max(observations.metric_date) FILTER (
        WHERE observations.total_reviews IS NOT NULL
      ) AS review_latest_date_30d,
      (
        array_agg(observations.total_reviews ORDER BY observations.metric_date)
        FILTER (WHERE observations.total_reviews IS NOT NULL)
      )[1]::bigint AS review_total_start_30d,
      (
        array_agg(observations.total_reviews ORDER BY observations.metric_date DESC)
        FILTER (WHERE observations.total_reviews IS NOT NULL)
      )[1]::bigint AS review_total_latest_30d,
      count(DISTINCT observations.metric_date) FILTER (
        WHERE observations.total_reviews IS NOT NULL
      )::smallint AS review_observed_days_30d,
      min(observations.metric_date) FILTER (
        WHERE observations.ccu_peak IS NOT NULL
      ) AS ccu_first_date_30d,
      max(observations.metric_date) FILTER (
        WHERE observations.ccu_peak IS NOT NULL
      ) AS ccu_latest_date_30d,
      (
        array_agg(observations.ccu_peak ORDER BY observations.metric_date)
        FILTER (WHERE observations.ccu_peak IS NOT NULL)
      )[1] AS ccu_peak_first_30d,
      (
        array_agg(observations.ccu_peak ORDER BY observations.metric_date DESC)
        FILTER (WHERE observations.ccu_peak IS NOT NULL)
      )[1] AS ccu_peak_latest_30d,
      max(observations.ccu_peak) AS ccu_peak_max_30d,
      round(avg(observations.ccu_peak), 2) AS ccu_peak_avg_30d,
      count(DISTINCT observations.metric_date) FILTER (
        WHERE observations.ccu_peak IS NOT NULL
      )::smallint AS ccu_observed_days_30d,
      max(observations.metric_date) AS source_max_metric_date
    FROM input_appids input
    LEFT JOIN observations ON observations.appid = input.appid
    GROUP BY input.appid
  ),
  calculated AS (
    SELECT
      aggregated.*,
      aggregated.review_total_latest_7d
        - aggregated.review_total_start_7d AS review_change_7d,
      aggregated.ccu_peak_latest_7d
        - aggregated.ccu_peak_first_7d AS ccu_peak_change_7d,
      aggregated.review_total_latest_30d
        - aggregated.review_total_start_30d AS review_change_30d,
      aggregated.ccu_peak_latest_30d
        - aggregated.ccu_peak_first_30d AS ccu_peak_change_30d,
      (7 - aggregated.review_observed_days_7d)::smallint AS review_missing_days_7d,
      (7 - aggregated.ccu_observed_days_7d)::smallint AS ccu_missing_days_7d,
      (30 - aggregated.review_observed_days_30d)::smallint AS review_missing_days_30d,
      (30 - aggregated.ccu_observed_days_30d)::smallint AS ccu_missing_days_30d
    FROM aggregated
  ),
  upserted AS (
    INSERT INTO metrics.app_signal_windows_v1 (
      appid,
      as_of_date,
      window_7d_start,
      window_30d_start,
      review_first_date_7d,
      review_latest_date_7d,
      review_total_start_7d,
      review_total_latest_7d,
      review_change_7d,
      review_observed_days_7d,
      review_missing_days_7d,
      ccu_first_date_7d,
      ccu_latest_date_7d,
      ccu_peak_first_7d,
      ccu_peak_latest_7d,
      ccu_peak_max_7d,
      ccu_peak_avg_7d,
      ccu_peak_change_7d,
      ccu_observed_days_7d,
      ccu_missing_days_7d,
      review_first_date_30d,
      review_latest_date_30d,
      review_total_start_30d,
      review_total_latest_30d,
      review_change_30d,
      review_observed_days_30d,
      review_missing_days_30d,
      ccu_first_date_30d,
      ccu_latest_date_30d,
      ccu_peak_first_30d,
      ccu_peak_latest_30d,
      ccu_peak_max_30d,
      ccu_peak_avg_30d,
      ccu_peak_change_30d,
      ccu_observed_days_30d,
      ccu_missing_days_30d,
      coverage_state,
      incomplete_coverage,
      source_max_metric_date,
      source_at,
      calculated_at,
      calculation_version,
      confidence,
      provenance,
      created_at,
      updated_at
    )
    SELECT
      calculated.appid,
      p_as_of_date,
      p_as_of_date - 6,
      p_as_of_date - 29,
      calculated.review_first_date_7d,
      calculated.review_latest_date_7d,
      calculated.review_total_start_7d,
      calculated.review_total_latest_7d,
      calculated.review_change_7d,
      calculated.review_observed_days_7d,
      calculated.review_missing_days_7d,
      calculated.ccu_first_date_7d,
      calculated.ccu_latest_date_7d,
      calculated.ccu_peak_first_7d,
      calculated.ccu_peak_latest_7d,
      calculated.ccu_peak_max_7d,
      calculated.ccu_peak_avg_7d,
      calculated.ccu_peak_change_7d,
      calculated.ccu_observed_days_7d,
      calculated.ccu_missing_days_7d,
      calculated.review_first_date_30d,
      calculated.review_latest_date_30d,
      calculated.review_total_start_30d,
      calculated.review_total_latest_30d,
      calculated.review_change_30d,
      calculated.review_observed_days_30d,
      calculated.review_missing_days_30d,
      calculated.ccu_first_date_30d,
      calculated.ccu_latest_date_30d,
      calculated.ccu_peak_first_30d,
      calculated.ccu_peak_latest_30d,
      calculated.ccu_peak_max_30d,
      calculated.ccu_peak_avg_30d,
      calculated.ccu_peak_change_30d,
      calculated.ccu_observed_days_30d,
      calculated.ccu_missing_days_30d,
      CASE
        WHEN calculated.review_observed_days_30d = 0
         AND calculated.ccu_observed_days_30d = 0 THEN 'none'
        WHEN calculated.review_missing_days_30d = 0
         AND calculated.ccu_missing_days_30d = 0 THEN 'complete'
        ELSE 'partial'
      END,
      calculated.review_missing_days_30d > 0
        OR calculated.ccu_missing_days_30d > 0,
      calculated.source_max_metric_date,
      calculated.source_max_metric_date::timestamp AT TIME ZONE 'UTC',
      clock_timestamp(),
      p_calculation_version,
      jsonb_build_object(
        'review_7d', round(calculated.review_observed_days_7d::numeric / 7, 4),
        'ccu_7d', round(calculated.ccu_observed_days_7d::numeric / 7, 4),
        'review_30d', round(calculated.review_observed_days_30d::numeric / 30, 4),
        'ccu_30d', round(calculated.ccu_observed_days_30d::numeric / 30, 4)
      ),
      jsonb_build_object(
        'source_relation', 'metrics.daily_metrics',
        'calendar_alignment', 'utc_date',
        'as_of_date', p_as_of_date
      ),
      clock_timestamp(),
      clock_timestamp()
    FROM calculated
    ON CONFLICT (appid)
    DO UPDATE SET
      as_of_date = EXCLUDED.as_of_date,
      window_7d_start = EXCLUDED.window_7d_start,
      window_30d_start = EXCLUDED.window_30d_start,
      review_first_date_7d = EXCLUDED.review_first_date_7d,
      review_latest_date_7d = EXCLUDED.review_latest_date_7d,
      review_total_start_7d = EXCLUDED.review_total_start_7d,
      review_total_latest_7d = EXCLUDED.review_total_latest_7d,
      review_change_7d = EXCLUDED.review_change_7d,
      review_observed_days_7d = EXCLUDED.review_observed_days_7d,
      review_missing_days_7d = EXCLUDED.review_missing_days_7d,
      ccu_first_date_7d = EXCLUDED.ccu_first_date_7d,
      ccu_latest_date_7d = EXCLUDED.ccu_latest_date_7d,
      ccu_peak_first_7d = EXCLUDED.ccu_peak_first_7d,
      ccu_peak_latest_7d = EXCLUDED.ccu_peak_latest_7d,
      ccu_peak_max_7d = EXCLUDED.ccu_peak_max_7d,
      ccu_peak_avg_7d = EXCLUDED.ccu_peak_avg_7d,
      ccu_peak_change_7d = EXCLUDED.ccu_peak_change_7d,
      ccu_observed_days_7d = EXCLUDED.ccu_observed_days_7d,
      ccu_missing_days_7d = EXCLUDED.ccu_missing_days_7d,
      review_first_date_30d = EXCLUDED.review_first_date_30d,
      review_latest_date_30d = EXCLUDED.review_latest_date_30d,
      review_total_start_30d = EXCLUDED.review_total_start_30d,
      review_total_latest_30d = EXCLUDED.review_total_latest_30d,
      review_change_30d = EXCLUDED.review_change_30d,
      review_observed_days_30d = EXCLUDED.review_observed_days_30d,
      review_missing_days_30d = EXCLUDED.review_missing_days_30d,
      ccu_first_date_30d = EXCLUDED.ccu_first_date_30d,
      ccu_latest_date_30d = EXCLUDED.ccu_latest_date_30d,
      ccu_peak_first_30d = EXCLUDED.ccu_peak_first_30d,
      ccu_peak_latest_30d = EXCLUDED.ccu_peak_latest_30d,
      ccu_peak_max_30d = EXCLUDED.ccu_peak_max_30d,
      ccu_peak_avg_30d = EXCLUDED.ccu_peak_avg_30d,
      ccu_peak_change_30d = EXCLUDED.ccu_peak_change_30d,
      ccu_observed_days_30d = EXCLUDED.ccu_observed_days_30d,
      ccu_missing_days_30d = EXCLUDED.ccu_missing_days_30d,
      coverage_state = EXCLUDED.coverage_state,
      incomplete_coverage = EXCLUDED.incomplete_coverage,
      source_max_metric_date = EXCLUDED.source_max_metric_date,
      source_at = EXCLUDED.source_at,
      calculated_at = EXCLUDED.calculated_at,
      calculation_version = EXCLUDED.calculation_version,
      confidence = EXCLUDED.confidence,
      provenance = EXCLUDED.provenance,
      updated_at = clock_timestamp()
    WHERE EXCLUDED.as_of_date >= metrics.app_signal_windows_v1.as_of_date
    RETURNING
      appid,
      source_at,
      calculated_at,
      review_observed_days_30d,
      ccu_observed_days_30d,
      coverage_state,
      calculation_version,
      confidence
  ),
  readiness AS (
    INSERT INTO ops.app_data_readiness (
      appid,
      source,
      status,
      source_at,
      processed_at,
      version,
      blocking_reason,
      retryable,
      provenance,
      created_at,
      updated_at
    )
    SELECT
      appid,
      'market_metrics',
      CASE
        WHEN review_observed_days_30d >= 2
         AND ccu_observed_days_30d >= 1 THEN 'ready'
        WHEN review_observed_days_30d = 0
         AND ccu_observed_days_30d = 0 THEN 'source_blocked'
        ELSE 'partial'
      END,
      source_at,
      calculated_at,
      calculation_version,
      CASE
        WHEN review_observed_days_30d >= 2
         AND ccu_observed_days_30d >= 1 THEN NULL
        WHEN review_observed_days_30d = 0
         AND ccu_observed_days_30d = 0 THEN 'no_market_metric_observations'
        WHEN review_observed_days_30d < 2 THEN 'insufficient_review_observations'
        ELSE 'missing_ccu_observations'
      END,
      true,
      jsonb_build_object(
        'source_relation', 'metrics.app_signal_windows_v1',
        'review_observed_days_30d', review_observed_days_30d,
        'ccu_observed_days_30d', ccu_observed_days_30d,
        'coverage_state', coverage_state,
        'confidence', confidence
      ),
      clock_timestamp(),
      clock_timestamp()
    FROM upserted
    ON CONFLICT (appid, source)
    DO UPDATE SET
      status = EXCLUDED.status,
      source_at = EXCLUDED.source_at,
      processed_at = EXCLUDED.processed_at,
      version = EXCLUDED.version,
      blocking_reason = EXCLUDED.blocking_reason,
      retryable = EXCLUDED.retryable,
      provenance = EXCLUDED.provenance,
      updated_at = clock_timestamp()
    RETURNING 1
  )
  SELECT count(*) INTO v_affected FROM readiness;

  RETURN coalesce(v_affected, 0);
END;
$$;

CREATE OR REPLACE FUNCTION ops.refresh_creator_readiness_v1(
  p_as_of_date date,
  p_appids integer[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected integer;
BEGIN
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'refresh_creator_readiness_v1 requires p_as_of_date';
  END IF;
  IF p_appids IS NULL OR coalesce(array_length(p_appids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'refresh_creator_readiness_v1 requires at least one appid';
  END IF;
  IF cardinality(p_appids) > 5000 THEN
    RAISE EXCEPTION 'refresh_creator_readiness_v1 accepts at most 5000 appids';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_appids) AS input(appid)
    WHERE input.appid IS NULL OR input.appid <= 0
  ) THEN
    RAISE EXCEPTION
      'refresh_creator_readiness_v1 requires every appid to be positive';
  END IF;

  WITH input_appids AS (
    SELECT DISTINCT input.appid
    FROM unnest(p_appids) AS input(appid)
  ),
  latest_by_class AS (
    SELECT DISTINCT ON (daily.appid, daily.content_class)
      daily.appid,
      daily.content_class,
      daily.coverage_state,
      daily.metric_date,
      daily.latest_snapshot_at,
      daily.rollup_methodology_version
    FROM metrics.youtube_game_daily daily
    JOIN input_appids input ON input.appid = daily.appid
    WHERE daily.metric_date <= p_as_of_date
    ORDER BY daily.appid, daily.content_class, daily.metric_date DESC
  ),
  aggregated AS (
    SELECT
      input.appid,
      count(latest.content_class)::integer AS content_class_count,
      count(*) FILTER (WHERE latest.coverage_state = 'full')::integer
        AS full_content_class_count,
      max(latest.metric_date) AS source_metric_date,
      max(latest.latest_snapshot_at) AS source_snapshot_at,
      max(latest.rollup_methodology_version) AS rollup_methodology_version,
      coalesce(
        jsonb_object_agg(
          latest.content_class,
          latest.coverage_state
        ) FILTER (WHERE latest.content_class IS NOT NULL),
        '{}'::jsonb
      ) AS content_class_coverage
    FROM input_appids input
    LEFT JOIN latest_by_class latest ON latest.appid = input.appid
    GROUP BY input.appid
  ),
  upserted AS (
    INSERT INTO ops.app_data_readiness (
      appid,
      source,
      status,
      source_at,
      processed_at,
      version,
      blocking_reason,
      retryable,
      provenance,
      created_at,
      updated_at
    )
    SELECT
      appid,
      'creator',
      CASE
        WHEN content_class_count = 3
         AND full_content_class_count = 3 THEN 'ready'
        WHEN content_class_count > 0 THEN 'partial'
        ELSE 'unknown'
      END,
      coalesce(
        source_snapshot_at,
        source_metric_date::timestamp AT TIME ZONE 'UTC'
      ),
      clock_timestamp(),
      coalesce(rollup_methodology_version, 'youtube-unobserved/v1'),
      CASE
        WHEN content_class_count = 3
         AND full_content_class_count = 3 THEN NULL
        WHEN content_class_count > 0 THEN 'creator_coverage_partial'
        ELSE 'creator_not_observed'
      END,
      true,
      jsonb_build_object(
        'source_relation', 'metrics.youtube_game_daily',
        'content_class_count', content_class_count,
        'full_content_class_count', full_content_class_count,
        'content_class_coverage', content_class_coverage,
        'source_metric_date', source_metric_date
      ),
      clock_timestamp(),
      clock_timestamp()
    FROM aggregated
    ON CONFLICT (appid, source)
    DO UPDATE SET
      status = EXCLUDED.status,
      source_at = EXCLUDED.source_at,
      processed_at = EXCLUDED.processed_at,
      version = EXCLUDED.version,
      blocking_reason = EXCLUDED.blocking_reason,
      retryable = EXCLUDED.retryable,
      provenance = EXCLUDED.provenance,
      updated_at = clock_timestamp()
    WHERE ops.app_data_readiness.source_at IS NULL
       OR (
         EXCLUDED.source_at IS NOT NULL
         AND EXCLUDED.source_at >= ops.app_data_readiness.source_at
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_affected FROM upserted;

  RETURN coalesce(v_affected, 0);
END;
$$;

COMMENT ON TABLE events.change_event_registry IS
  'Versioned change-event semantics mirrored by the shared runtime registry. Unknown types are preserved and exposed as unknown.';
COMMENT ON VIEW ops.change_event_registry_health_v1 IS
  'Live count and freshness telemetry for raw event source/type pairs absent from change-events/v1.';
COMMENT ON TABLE events.app_lifecycle_events IS
  'Idempotent normalized first-observed and release-state transition events. Initial snapshots never emit per-field changes.';
COMMENT ON FUNCTION events.materialize_catalog_lifecycle_events_v1(bigint, integer) IS
  'Bounded, cursor-based materialization of existing first-observed catalog events; safe to replay because idempotency keys are source-derived.';
COMMENT ON FUNCTION ops.refresh_overall_readiness_v1(integer[]) IS
  'Computes core overall readiness from catalog, Storefront, and PICS only. Market and creator readiness remain independent.';
COMMENT ON TABLE metrics.app_signal_windows_v1 IS
  'One recomputable current row per app with calendar-aligned 7/30-day review and CCU windows plus explicit source coverage.';
COMMENT ON FUNCTION metrics.refresh_app_signal_windows_v1(date, integer[], text) IS
  'Refreshes bounded app batches only; null or empty app lists fail closed to prevent accidental full-catalog writes.';
COMMENT ON FUNCTION ops.refresh_creator_readiness_v1(date, integer[]) IS
  'Refreshes bounded creator readiness from Tiger YouTube rollups without making creator evidence a core overall-readiness gate.';
