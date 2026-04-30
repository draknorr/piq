-- Tiger change-intel write-authority surfaces.
-- This file is intentionally not applied by scheduled sync workflows. Apply it
-- only during an approved Tiger write window.

CREATE TABLE IF NOT EXISTS ops.change_intel_app_status (
    appid integer PRIMARY KEY,
    storefront_accessible boolean,
    last_storefront_sync timestamp with time zone,
    last_news_sync timestamp with time zone,
    last_media_sync timestamp with time zone,
    last_error_source text,
    last_error_message text,
    last_error_at timestamp with time zone,
    steam_last_modified bigint,
    steam_price_change_number bigint,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.change_intel_sync_jobs (
    id bigserial PRIMARY KEY,
    job_type text NOT NULL,
    status text NOT NULL DEFAULT 'running',
    batch_size integer,
    items_processed integer NOT NULL DEFAULT 0,
    items_succeeded integer NOT NULL DEFAULT 0,
    items_failed integer NOT NULL DEFAULT 0,
    items_created integer NOT NULL DEFAULT 0,
    items_updated integer NOT NULL DEFAULT 0,
    items_skipped integer NOT NULL DEFAULT 0,
    error_message text,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT change_intel_sync_jobs_status_check CHECK (
      status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_change_intel_sync_jobs_type_started
  ON ops.change_intel_sync_jobs (job_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_change_intel_sync_jobs_running
  ON ops.change_intel_sync_jobs (started_at ASC)
  WHERE status = 'running';

SELECT setval(
  pg_get_serial_sequence('ops.change_intel_sync_jobs', 'id'),
  GREATEST(
    COALESCE((SELECT MAX(id) + 1 FROM ops.change_intel_sync_jobs), 1000000000000),
    1000000000000
  ),
  false
);

CREATE TABLE IF NOT EXISTS ops.app_capture_work_state (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    source text NOT NULL,
    priority integer NOT NULL DEFAULT 100,
    latest_trigger_reason text NOT NULL,
    latest_trigger_cursor text NOT NULL DEFAULT '',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    dirty_since timestamp with time zone,
    last_dirty_at timestamp with time zone,
    claimed_at timestamp with time zone,
    worker_id text,
    attempts integer NOT NULL DEFAULT 0,
    next_available_at timestamp with time zone NOT NULL DEFAULT now(),
    last_completed_at timestamp with time zone,
    last_error text,
    dead_lettered_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_capture_work_state_source_check CHECK (
      source = ANY (ARRAY['storefront'::text, 'news'::text, 'hero_asset'::text, 'projection_refresh'::text])
    ),
    CONSTRAINT app_capture_work_state_appid_source_key UNIQUE (appid, source)
);

CREATE INDEX IF NOT EXISTS idx_ops_app_capture_work_state_claimable
  ON ops.app_capture_work_state(source, priority DESC, next_available_at ASC, dirty_since ASC, id ASC)
  WHERE dirty_since IS NOT NULL
    AND claimed_at IS NULL
    AND dead_lettered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ops_app_capture_work_state_claimed
  ON ops.app_capture_work_state(source, claimed_at ASC, id ASC)
  WHERE claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_app_capture_work_state_dirty
  ON ops.app_capture_work_state(source, dirty_since ASC, id ASC)
  WHERE dirty_since IS NOT NULL
    AND dead_lettered_at IS NULL;

CREATE TABLE IF NOT EXISTS docs.app_source_snapshots (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    source text NOT NULL,
    observed_at timestamp with time zone NOT NULL DEFAULT now(),
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    content_hash text NOT NULL,
    previous_snapshot_id bigint,
    trigger_reason text NOT NULL,
    trigger_cursor text,
    snapshot_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    archive_bucket text,
    archive_key text,
    archive_content_hash text,
    archive_byte_size bigint,
    archive_content_type text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_source_snapshots_source_check CHECK (
      source = ANY (ARRAY['storefront'::text, 'pics'::text])
    )
);

CREATE INDEX IF NOT EXISTS idx_docs_app_source_snapshots_app_source_time
  ON docs.app_source_snapshots(appid, source, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_app_source_snapshots_archive_key
  ON docs.app_source_snapshots(archive_bucket, archive_key)
  WHERE archive_key IS NOT NULL;

SELECT setval(
  pg_get_serial_sequence('docs.app_source_snapshots', 'id'),
  GREATEST(
    COALESCE((SELECT MAX(id) + 1 FROM docs.app_source_snapshots), 1000000000000),
    1000000000000
  ),
  false
);

CREATE TABLE IF NOT EXISTS docs.steam_news_versions (
    id bigserial PRIMARY KEY,
    gid text NOT NULL REFERENCES docs.steam_news_items(gid) ON DELETE CASCADE,
    content_hash text NOT NULL,
    title text,
    contents_excerpt text,
    url text NOT NULL,
    previous_version_id bigint,
    archive_bucket text,
    archive_key text,
    archive_content_hash text,
    archive_byte_size bigint,
    archive_content_type text,
    archived_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_steam_news_versions_gid_time
  ON docs.steam_news_versions(gid, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_steam_news_versions_archive_key
  ON docs.steam_news_versions(archive_bucket, archive_key)
  WHERE archive_key IS NOT NULL;

SELECT setval(
  pg_get_serial_sequence('docs.steam_news_versions', 'id'),
  GREATEST(
    COALESCE((SELECT MAX(id) + 1 FROM docs.steam_news_versions), 1000000000000),
    1000000000000
  ),
  false
);

CREATE TABLE IF NOT EXISTS docs.app_media_versions (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    storefront_snapshot_id bigint,
    content_hash text NOT NULL,
    hero_assets jsonb NOT NULL DEFAULT '{}'::jsonb,
    screenshots jsonb NOT NULL DEFAULT '[]'::jsonb,
    trailers jsonb NOT NULL DEFAULT '[]'::jsonb,
    previous_version_id bigint,
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_app_media_versions_appid_time
  ON docs.app_media_versions(appid, first_seen_at DESC);

SELECT setval(
  pg_get_serial_sequence('docs.app_media_versions', 'id'),
  GREATEST(
    COALESCE((SELECT MAX(id) + 1 FROM docs.app_media_versions), 1000000000000),
    1000000000000
  ),
  false
);

CREATE TABLE IF NOT EXISTS docs.app_hero_asset_versions (
    id uuid PRIMARY KEY,
    appid integer NOT NULL,
    asset_kind text NOT NULL,
    source_url text NOT NULL,
    object_bucket text NOT NULL,
    object_key text NOT NULL,
    content_hash text NOT NULL,
    mime_type text,
    content_length integer NOT NULL,
    width integer,
    height integer,
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_hero_asset_versions_kind_check CHECK (
      asset_kind = ANY (ARRAY['header'::text, 'capsule'::text, 'background'::text])
    )
);

CREATE INDEX IF NOT EXISTS idx_docs_app_hero_asset_versions_appid_time
  ON docs.app_hero_asset_versions(appid, first_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_app_hero_asset_versions_unique_content
  ON docs.app_hero_asset_versions(appid, asset_kind, content_hash);

ALTER TABLE events.app_change_events
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD COLUMN IF NOT EXISTS evidence_archive_bucket text,
  ADD COLUMN IF NOT EXISTS evidence_archive_key text,
  ADD COLUMN IF NOT EXISTS evidence_archive_content_hash text,
  ADD COLUMN IF NOT EXISTS evidence_archive_byte_size bigint,
  ADD COLUMN IF NOT EXISTS evidence_archive_content_type text,
  ADD COLUMN IF NOT EXISTS evidence_archived_at timestamp with time zone;

CREATE SEQUENCE IF NOT EXISTS events.app_change_events_tiger_id_seq
  AS bigint
  START WITH 1000000000000
  INCREMENT BY 1;

ALTER TABLE events.app_change_events
  ALTER COLUMN id SET DEFAULT nextval('events.app_change_events_tiger_id_seq');

SELECT setval(
  'events.app_change_events_tiger_id_seq',
  GREATEST(
    COALESCE((SELECT MAX(id) + 1 FROM events.app_change_events), 1000000000000),
    1000000000000
  ),
  false
);

CREATE INDEX IF NOT EXISTS idx_events_app_change_events_evidence_archive_key
  ON events.app_change_events(evidence_archive_bucket, evidence_archive_key)
  WHERE evidence_archive_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS events.change_activity_bursts (
    burst_id text PRIMARY KEY,
    appid integer NOT NULL,
    app_name text NOT NULL,
    app_type text,
    is_released boolean,
    release_date date,
    effective_at timestamp with time zone NOT NULL,
    burst_started_at timestamp with time zone NOT NULL,
    burst_ended_at timestamp with time zone NOT NULL,
    event_count integer NOT NULL,
    change_type_count integer NOT NULL,
    source_set text[] NOT NULL DEFAULT ARRAY[]::text[],
    change_types text[] NOT NULL DEFAULT ARRAY[]::text[],
    headline_change_types text[] NOT NULL DEFAULT ARRAY[]::text[],
    highlight_labels text[] NOT NULL DEFAULT ARRAY[]::text[],
    signal_families text[] NOT NULL DEFAULT ARRAY[]::text[],
    story_kind text NOT NULL,
    has_related_news boolean NOT NULL DEFAULT false,
    related_news_count integer NOT NULL DEFAULT 0,
    include_in_high_signal boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_change_activity_bursts_effective_at
  ON events.change_activity_bursts(effective_at DESC, burst_id DESC);
CREATE INDEX IF NOT EXISTS idx_events_change_activity_bursts_appid_effective_at
  ON events.change_activity_bursts(appid, effective_at DESC, burst_id DESC);
CREATE INDEX IF NOT EXISTS idx_events_change_activity_bursts_signal_families
  ON events.change_activity_bursts USING gin (signal_families);

CREATE TABLE IF NOT EXISTS events.change_pattern_activity_days (
    appid integer NOT NULL,
    activity_date date NOT NULL,
    app_name text NOT NULL,
    app_type text,
    is_released boolean,
    release_date date,
    latest_occurred_at timestamp with time zone NOT NULL,
    burst_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    signal_families text[] NOT NULL DEFAULT ARRAY[]::text[],
    story_kinds text[] NOT NULL DEFAULT ARRAY[]::text[],
    announcement_count integer NOT NULL DEFAULT 0,
    total_bursts integer NOT NULL DEFAULT 0,
    release_count integer NOT NULL DEFAULT 0,
    pricing_count integer NOT NULL DEFAULT 0,
    store_page_count integer NOT NULL DEFAULT 0,
    media_count integer NOT NULL DEFAULT 0,
    taxonomy_count integer NOT NULL DEFAULT 0,
    platform_count integer NOT NULL DEFAULT 0,
    build_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (appid, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_events_change_pattern_activity_days_date
  ON events.change_pattern_activity_days(activity_date DESC, app_type, latest_occurred_at DESC, appid DESC);

CREATE TABLE IF NOT EXISTS events.change_pattern_app_windows (
    appid integer NOT NULL,
    window_days integer NOT NULL CHECK (window_days IN (7, 30, 90, 180)),
    app_name text NOT NULL,
    app_type text,
    is_released boolean,
    release_date date,
    latest_occurred_at timestamp with time zone NOT NULL,
    activity_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    signal_families text[] NOT NULL DEFAULT ARRAY[]::text[],
    story_kinds text[] NOT NULL DEFAULT ARRAY[]::text[],
    announcement_count integer NOT NULL DEFAULT 0,
    change_count integer NOT NULL DEFAULT 0,
    release_count integer NOT NULL DEFAULT 0,
    pricing_count integer NOT NULL DEFAULT 0,
    store_page_count integer NOT NULL DEFAULT 0,
    media_count integer NOT NULL DEFAULT 0,
    taxonomy_count integer NOT NULL DEFAULT 0,
    platform_count integer NOT NULL DEFAULT 0,
    build_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (appid, window_days)
);

CREATE INDEX IF NOT EXISTS idx_events_change_pattern_app_windows_latest
  ON events.change_pattern_app_windows(window_days, app_type, latest_occurred_at DESC, appid DESC);

CREATE OR REPLACE FUNCTION ops.mark_app_capture_work_dirty(
  p_jobs jsonb DEFAULT '[]'::jsonb,
  p_cooldown_hours integer DEFAULT 6
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp with time zone := now();
  v_cooldown interval := make_interval(hours => greatest(coalesce(p_cooldown_hours, 6), 1));
  v_affected integer;
BEGIN
  WITH normalized_jobs AS (
    SELECT
      (job->>'appid')::integer AS appid,
      job->>'source' AS source,
      job->>'trigger_reason' AS trigger_reason,
      coalesce(job->>'trigger_cursor', '') AS trigger_cursor,
      coalesce((job->>'priority')::integer, 100) AS priority,
      coalesce(job->'payload', '{}'::jsonb) AS payload
    FROM jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) AS job
  ),
  upserted AS (
    INSERT INTO ops.app_capture_work_state (
      appid, source, priority, latest_trigger_reason, latest_trigger_cursor,
      payload, dirty_since, last_dirty_at, next_available_at, dead_lettered_at,
      last_error, created_at, updated_at
    )
    SELECT
      appid, source, priority, trigger_reason, trigger_cursor,
      payload, v_now, v_now, v_now, NULL, NULL, v_now, v_now
    FROM normalized_jobs
    WHERE appid IS NOT NULL
      AND source IS NOT NULL
      AND trigger_reason IS NOT NULL
    ON CONFLICT (appid, source)
    DO UPDATE
    SET priority = greatest(ops.app_capture_work_state.priority, EXCLUDED.priority),
        latest_trigger_reason = EXCLUDED.latest_trigger_reason,
        latest_trigger_cursor = EXCLUDED.latest_trigger_cursor,
        payload = EXCLUDED.payload,
        dirty_since = coalesce(ops.app_capture_work_state.dirty_since, v_now),
        last_dirty_at = v_now,
        next_available_at = CASE
          WHEN ops.app_capture_work_state.dirty_since IS NULL THEN greatest(
            v_now,
            coalesce(ops.app_capture_work_state.last_completed_at + v_cooldown, v_now)
          )
          ELSE ops.app_capture_work_state.next_available_at
        END,
        dead_lettered_at = NULL,
        last_error = NULL,
        attempts = CASE
          WHEN ops.app_capture_work_state.dead_lettered_at IS NOT NULL THEN 0
          ELSE ops.app_capture_work_state.attempts
        END,
        worker_id = CASE
          WHEN ops.app_capture_work_state.dead_lettered_at IS NOT NULL THEN NULL
          ELSE ops.app_capture_work_state.worker_id
        END,
        claimed_at = CASE
          WHEN ops.app_capture_work_state.dead_lettered_at IS NOT NULL THEN NULL
          ELSE ops.app_capture_work_state.claimed_at
        END,
        updated_at = v_now
    RETURNING 1
  )
  SELECT count(*) INTO v_affected FROM upserted;

  RETURN coalesce(v_affected, 0);
END;
$$;

CREATE OR REPLACE FUNCTION ops.claim_app_capture_work(
  p_sources text[],
  p_worker_id text,
  p_limit integer DEFAULT 50
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
    SELECT w.id
    FROM ops.app_capture_work_state w
    WHERE w.source = ANY (p_sources)
      AND w.dirty_since IS NOT NULL
      AND w.claimed_at IS NULL
      AND w.dead_lettered_at IS NULL
      AND w.next_available_at <= now()
    ORDER BY w.priority DESC, w.dirty_since ASC, w.last_dirty_at ASC, w.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT least(coalesce(p_limit, 50), 500)
  )
  UPDATE ops.app_capture_work_state w
  SET claimed_at = now(),
      worker_id = p_worker_id,
      attempts = w.attempts + 1,
      updated_at = now()
  FROM candidates c
  WHERE w.id = c.id
  RETURNING
    w.id,
    w.appid,
    w.source,
    w.priority,
    w.latest_trigger_reason,
    w.latest_trigger_cursor,
    w.payload,
    w.attempts,
    w.next_available_at;
END;
$$;

CREATE OR REPLACE FUNCTION ops.complete_app_capture_work(
  p_ids bigint[],
  p_status text DEFAULT 'completed',
  p_error text DEFAULT NULL,
  p_cooldown_hours integer DEFAULT 6
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp with time zone := now();
  v_cooldown interval := make_interval(hours => greatest(coalesce(p_cooldown_hours, 6), 1));
  v_updated integer;
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'queued', 'dead_letter') THEN
    RAISE EXCEPTION 'Unsupported work completion status: %', p_status;
  END IF;

  UPDATE ops.app_capture_work_state
  SET last_error = CASE WHEN p_status = 'completed' THEN NULL ELSE p_error END,
      worker_id = NULL,
      claimed_at = NULL,
      dead_lettered_at = CASE
        WHEN p_status = 'dead_letter' THEN v_now
        WHEN p_status IN ('completed', 'queued') THEN NULL
        ELSE dead_lettered_at
      END,
      last_completed_at = CASE WHEN p_status = 'completed' THEN v_now ELSE last_completed_at END,
      next_available_at = CASE
        WHEN p_status = 'completed' THEN v_now + v_cooldown
        WHEN p_status = 'queued' THEN v_now
        ELSE next_available_at
      END,
      dirty_since = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at THEN last_dirty_at
        WHEN p_status IN ('completed', 'dead_letter', 'failed') THEN NULL
        ELSE dirty_since
      END,
      last_dirty_at = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at THEN last_dirty_at
        WHEN p_status IN ('completed', 'dead_letter', 'failed') THEN NULL
        ELSE last_dirty_at
      END,
      attempts = CASE WHEN p_status = 'completed' THEN 0 ELSE attempts END,
      updated_at = v_now
  WHERE id = ANY (p_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION ops.requeue_stale_app_capture_work(
  p_sources text[],
  p_claimed_before timestamp with time zone,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  WITH stale AS (
    SELECT w.id
    FROM ops.app_capture_work_state w
    WHERE w.source = ANY (p_sources)
      AND w.claimed_at IS NOT NULL
      AND w.dead_lettered_at IS NULL
      AND w.claimed_at < p_claimed_before
    ORDER BY w.claimed_at ASC, w.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT least(coalesce(p_limit, 500), 500)
  )
  UPDATE ops.app_capture_work_state w
  SET claimed_at = NULL,
      worker_id = NULL,
      next_available_at = now(),
      last_error = 'stale_claim_requeued',
      updated_at = now()
  FROM stale s
  WHERE w.id = s.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN coalesce(v_updated, 0);
END;
$$;
