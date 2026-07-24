-- Durable Steam catalog observation records and transactional batch RPCs.
-- This file is intentionally not applied by scheduled workflows. Apply it only
-- during an approved Tiger write window after backup/PITR evidence is current.

CREATE TABLE IF NOT EXISTS ops.catalog_scan_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_key text NOT NULL UNIQUE,
    source text NOT NULL,
    mode text NOT NULL,
    scan_kind text NOT NULL,
    status text NOT NULL DEFAULT 'running',
    source_started_at timestamp with time zone NOT NULL,
    requested_if_modified_since bigint,
    committed_through bigint,
    last_committed_batch integer NOT NULL DEFAULT -1,
    source_rows_committed integer NOT NULL DEFAULT 0,
    accepted_rows integer NOT NULL DEFAULT 0,
    rejected_rows integer NOT NULL DEFAULT 0,
    known_rows integer NOT NULL DEFAULT 0,
    unknown_rows integer NOT NULL DEFAULT 0,
    changed_known_rows integer NOT NULL DEFAULT 0,
    unchanged_known_rows integer NOT NULL DEFAULT 0,
    seeded_rows integer NOT NULL DEFAULT 0,
    enqueued_rows integer NOT NULL DEFAULT 0,
    event_rows integer NOT NULL DEFAULT 0,
    batch_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
    reconciliation_outcome jsonb,
    input_hash text,
    error_message text,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT catalog_scan_runs_source_check CHECK (
      source = ANY (ARRAY['steam_change_hints'::text, 'steam_applist'::text])
    ),
    CONSTRAINT catalog_scan_runs_mode_check CHECK (
      mode = ANY (ARRAY['shadow'::text, 'primary'::text])
    ),
    CONSTRAINT catalog_scan_runs_kind_check CHECK (
      scan_kind = ANY (ARRAY['incremental'::text, 'full'::text])
    ),
    CONSTRAINT catalog_scan_runs_status_check CHECK (
      status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])
    ),
    CONSTRAINT catalog_scan_runs_nonnegative_counts_check CHECK (
      source_rows_committed >= 0
      AND accepted_rows >= 0
      AND rejected_rows >= 0
      AND known_rows >= 0
      AND unknown_rows >= 0
      AND changed_known_rows >= 0
      AND unchanged_known_rows >= 0
      AND seeded_rows >= 0
      AND enqueued_rows >= 0
      AND event_rows >= 0
    ),
    CONSTRAINT catalog_scan_runs_disposition_counts_check CHECK (
      source_rows_committed = accepted_rows + rejected_rows
      AND accepted_rows = known_rows + unknown_rows
      AND known_rows = changed_known_rows + unchanged_known_rows
      AND seeded_rows <= unknown_rows
      AND event_rows <= accepted_rows
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_catalog_scan_runs_source_completed
  ON ops.catalog_scan_runs (source, completed_at DESC)
  WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_ops_catalog_scan_runs_running
  ON ops.catalog_scan_runs (started_at ASC)
  WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_catalog_scan_runs_one_running_per_source
  ON ops.catalog_scan_runs (source)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS ops.app_catalog_state (
    appid integer PRIMARY KEY REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    first_observed_at timestamp with time zone NOT NULL,
    first_observed_source text NOT NULL,
    first_observed_scan_id uuid NOT NULL REFERENCES ops.catalog_scan_runs(id) ON DELETE RESTRICT,
    first_observation_kind text NOT NULL,
    last_observed_at timestamp with time zone NOT NULL,
    last_observed_source text NOT NULL,
    last_observed_scan_id uuid NOT NULL REFERENCES ops.catalog_scan_runs(id) ON DELETE RESTRICT,
    last_full_observed_at timestamp with time zone,
    last_full_observed_scan_id uuid REFERENCES ops.catalog_scan_runs(id) ON DELETE RESTRICT,
    last_successful_scan_id uuid REFERENCES ops.catalog_scan_runs(id) ON DELETE RESTRICT,
    last_full_reconciliation_scan_id uuid REFERENCES ops.catalog_scan_runs(id) ON DELETE RESTRICT,
    last_full_reconciled_at timestamp with time zone,
    latest_name text NOT NULL,
    latest_steam_last_modified bigint,
    latest_steam_price_change_number bigint,
    observation_count bigint NOT NULL DEFAULT 1,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_catalog_state_source_check CHECK (
      first_observed_source = ANY (ARRAY['steam_change_hints'::text, 'steam_applist'::text])
      AND last_observed_source = ANY (ARRAY['steam_change_hints'::text, 'steam_applist'::text])
    ),
    CONSTRAINT app_catalog_state_kind_check CHECK (
      first_observation_kind = ANY (ARRAY['new'::text, 'baseline'::text])
    ),
    CONSTRAINT app_catalog_state_time_order_check CHECK (
      first_observed_at <= last_observed_at
    ),
    CONSTRAINT app_catalog_state_observation_count_check CHECK (observation_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_ops_app_catalog_state_first_observed
  ON ops.app_catalog_state (first_observed_at DESC, appid DESC);
CREATE INDEX IF NOT EXISTS idx_ops_app_catalog_state_last_observed
  ON ops.app_catalog_state (last_observed_at DESC, appid DESC);
CREATE INDEX IF NOT EXISTS idx_ops_app_catalog_state_full_reconciled
  ON ops.app_catalog_state (last_full_reconciled_at ASC NULLS FIRST, appid ASC);

CREATE TABLE IF NOT EXISTS events.app_catalog_events (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    event_type text NOT NULL,
    source text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    scan_run_id uuid NOT NULL REFERENCES ops.catalog_scan_runs(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL UNIQUE,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_catalog_events_type_check CHECK (
      event_type = ANY (ARRAY['first_observed'::text, 'baseline_observed'::text])
    ),
    CONSTRAINT app_catalog_events_source_check CHECK (
      source = ANY (ARRAY['steam_change_hints'::text, 'steam_applist'::text])
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_app_catalog_events_one_first_observed
  ON events.app_catalog_events (appid)
  WHERE event_type = 'first_observed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_app_catalog_events_one_baseline_observed
  ON events.app_catalog_events (appid)
  WHERE event_type = 'baseline_observed';
CREATE INDEX IF NOT EXISTS idx_events_app_catalog_events_observed
  ON events.app_catalog_events (observed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION ops.begin_catalog_scan(
  p_run_key text,
  p_source text,
  p_mode text,
  p_force_full boolean,
  p_source_started_at timestamp with time zone,
  p_overlap_seconds integer DEFAULT 300
)
RETURNS TABLE (
  id uuid,
  status text,
  scan_kind text,
  source_started_at timestamp with time zone,
  requested_if_modified_since bigint,
  committed_through bigint,
  last_committed_batch integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing ops.catalog_scan_runs%ROWTYPE;
  v_previous_cursor bigint;
  v_requested_cursor bigint;
  v_scan_kind text;
  v_started_at timestamp with time zone := coalesce(p_source_started_at, clock_timestamp());
BEGIN
  IF nullif(btrim(p_run_key), '') IS NULL THEN
    RAISE EXCEPTION 'catalog scan run key is required';
  END IF;
  IF p_source IS NULL
    OR p_source NOT IN ('steam_change_hints', 'steam_applist')
  THEN
    RAISE EXCEPTION 'unsupported catalog scan source: %', p_source;
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('shadow', 'primary') THEN
    RAISE EXCEPTION 'unsupported catalog observation mode: %', p_mode;
  END IF;
  IF p_force_full IS NULL THEN
    RAISE EXCEPTION 'catalog scan force-full flag is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('catalog_scan:' || p_source));

  SELECT r.*
  INTO v_existing
  FROM ops.catalog_scan_runs r
  WHERE r.run_key = p_run_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.source <> p_source OR v_existing.mode <> p_mode THEN
      RAISE EXCEPTION
        'catalog scan run key % already belongs to source % in mode %',
        p_run_key,
        v_existing.source,
        v_existing.mode;
    END IF;

    IF v_existing.status = 'failed' THEN
      UPDATE ops.catalog_scan_runs r
      SET status = 'running',
          completed_at = NULL,
          error_message = NULL,
          updated_at = clock_timestamp()
      WHERE r.id = v_existing.id
      RETURNING r.* INTO v_existing;
    END IF;

    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.status,
      v_existing.scan_kind,
      v_existing.source_started_at,
      v_existing.requested_if_modified_since,
      v_existing.committed_through,
      v_existing.last_committed_batch;
    RETURN;
  END IF;

  SELECT r.*
  INTO v_existing
  FROM ops.catalog_scan_runs r
  WHERE r.source = p_source
    AND r.status = 'running'
  ORDER BY r.started_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.mode <> p_mode THEN
      RAISE EXCEPTION
        'catalog source % already has a running % scan under run key %',
        p_source,
        v_existing.mode,
        v_existing.run_key;
    END IF;

    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.status,
      v_existing.scan_kind,
      v_existing.source_started_at,
      v_existing.requested_if_modified_since,
      v_existing.committed_through,
      v_existing.last_committed_batch;
    RETURN;
  END IF;

  IF p_force_full THEN
    v_previous_cursor := NULL;
  ELSE
    SELECT r.committed_through
    INTO v_previous_cursor
    FROM ops.catalog_scan_runs r
    WHERE r.source = p_source
      AND r.status = 'completed'
      AND r.committed_through IS NOT NULL
    ORDER BY r.completed_at DESC NULLS LAST, r.created_at DESC
    LIMIT 1;
  END IF;

  v_scan_kind := CASE
    WHEN p_force_full OR v_previous_cursor IS NULL THEN 'full'
    ELSE 'incremental'
  END;
  v_requested_cursor := CASE
    WHEN v_scan_kind = 'full' THEN NULL
    ELSE greatest(v_previous_cursor - greatest(coalesce(p_overlap_seconds, 300), 0), 0)
  END;

  INSERT INTO ops.catalog_scan_runs (
    run_key,
    source,
    mode,
    scan_kind,
    status,
    source_started_at,
    requested_if_modified_since,
    committed_through,
    started_at,
    created_at,
    updated_at
  )
  VALUES (
    p_run_key,
    p_source,
    p_mode,
    v_scan_kind,
    'running',
    v_started_at,
    v_requested_cursor,
    floor(extract(epoch FROM v_started_at))::bigint,
    clock_timestamp(),
    clock_timestamp(),
    clock_timestamp()
  )
  RETURNING * INTO v_existing;

  RETURN QUERY
  SELECT
    v_existing.id,
    v_existing.status,
    v_existing.scan_kind,
    v_existing.source_started_at,
    v_existing.requested_if_modified_since,
    v_existing.committed_through,
    v_existing.last_committed_batch;
END;
$$;

CREATE OR REPLACE FUNCTION ops.commit_catalog_scan_batch(
  p_scan_id uuid,
  p_batch_index integer,
  p_batch_hash text,
  p_rows jsonb,
  p_rejections jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run ops.catalog_scan_runs%ROWTYPE;
  v_existing_batch jsonb;
  v_observed_at timestamp with time zone;
  v_accepted integer;
  v_rejected integer;
  v_unknown integer;
  v_known integer;
  v_changed_known integer;
  v_unchanged_known integer;
  v_seeded integer;
  v_enqueued integer := 0;
  v_first_events integer;
  v_baseline_events integer;
  v_event_rows integer;
  v_first_appid integer;
  v_last_appid integer;
  v_unknown_appids integer[];
  v_changed_known_appids integer[];
  v_manifest_entry jsonb;
BEGIN
  IF p_batch_index < 0 THEN
    RAISE EXCEPTION 'catalog batch index must be nonnegative';
  END IF;
  IF nullif(btrim(p_batch_hash), '') IS NULL THEN
    RAISE EXCEPTION 'catalog batch hash is required';
  END IF;
  IF jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'catalog batch rows must be a JSON array';
  END IF;
  IF jsonb_typeof(coalesce(p_rejections, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'catalog batch rejections must be a JSON array';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(p_rejections, '[]'::jsonb)) AS rejection (
      appid integer,
      reason text,
      row_hash text,
      source_index integer
    )
    WHERE source_index IS NULL
      OR source_index < 0
      OR nullif(btrim(reason), '') IS NULL
      OR row_hash IS NULL
      OR row_hash !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'catalog batch contains invalid rejection records';
  END IF;

  SELECT r.*
  INTO v_run
  FROM ops.catalog_scan_runs r
  WHERE r.id = p_scan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog scan % does not exist', p_scan_id;
  END IF;

  SELECT batch
  INTO v_existing_batch
  FROM jsonb_array_elements(v_run.batch_manifest) AS batch
  WHERE (batch->>'batch_index')::integer = p_batch_index
  LIMIT 1;

  IF v_existing_batch IS NOT NULL THEN
    IF v_existing_batch->>'batch_hash' <> p_batch_hash
      OR (v_existing_batch->>'accepted_rows')::integer <> jsonb_array_length(coalesce(p_rows, '[]'::jsonb))
      OR (v_existing_batch->>'rejected_rows')::integer <> jsonb_array_length(coalesce(p_rejections, '[]'::jsonb))
    THEN
      RAISE EXCEPTION 'catalog batch % replay does not match its durable manifest', p_batch_index;
    END IF;
    RETURN v_existing_batch;
  END IF;

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'catalog scan % is not running (status=%)', p_scan_id, v_run.status;
  END IF;
  IF p_batch_index <> v_run.last_committed_batch + 1 THEN
    RAISE EXCEPTION
      'catalog batch % is out of sequence; expected %',
      p_batch_index,
      v_run.last_committed_batch + 1;
  END IF;

  v_observed_at := v_run.source_started_at;
  v_rejected := jsonb_array_length(coalesce(p_rejections, '[]'::jsonb));

  DROP TABLE IF EXISTS pg_temp.catalog_observation_input;
  DROP TABLE IF EXISTS pg_temp.catalog_observation_disposition;

  CREATE TEMP TABLE catalog_observation_input ON COMMIT DROP AS
  SELECT
    row.appid,
    btrim(row.name) AS name,
    row.last_modified,
    row.price_change_number
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS row (
    appid integer,
    name text,
    last_modified bigint,
    price_change_number bigint
  );

  ALTER TABLE catalog_observation_input ADD PRIMARY KEY (appid);

  IF EXISTS (
    SELECT 1
    FROM catalog_observation_input
    WHERE appid <= 0
      OR nullif(name, '') IS NULL
      OR last_modified < 0
      OR price_change_number < 0
      OR (
        v_run.source = 'steam_change_hints'
        AND (last_modified IS NULL OR price_change_number IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'catalog batch contains invalid normalized rows';
  END IF;

  -- Serialize overlapping AppList/hint batches by appid so only one source can
  -- classify a row as first-observed. Ordered acquisition avoids deadlocks.
  PERFORM pg_advisory_xact_lock(114513209, input.appid)
  FROM catalog_observation_input input
  ORDER BY input.appid;

  CREATE TEMP TABLE catalog_observation_disposition ON COMMIT DROP AS
  SELECT
    input.appid,
    input.name,
    input.last_modified,
    input.price_change_number,
    app.appid IS NULL AS is_unknown,
    sync.appid IS NULL AS needs_readiness_seed,
    state.appid IS NULL AS first_ledger_observation,
    (
      input.last_modified IS NOT NULL
      AND (
        sync.appid IS NULL
        OR sync.steam_last_modified IS DISTINCT FROM input.last_modified
        OR sync.steam_price_change_number IS DISTINCT FROM input.price_change_number
      )
    ) AS hint_changed
  FROM catalog_observation_input input
  LEFT JOIN legacy.apps app ON app.appid = input.appid
  LEFT JOIN ops.sync_status sync ON sync.appid = input.appid
  LEFT JOIN ops.app_catalog_state state ON state.appid = input.appid;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE is_unknown)::integer,
    count(*) FILTER (WHERE NOT is_unknown)::integer,
    count(*) FILTER (WHERE NOT is_unknown AND hint_changed)::integer,
    count(*) FILTER (WHERE NOT is_unknown AND NOT hint_changed)::integer,
    min(appid),
    max(appid),
    coalesce(array_agg(appid ORDER BY appid) FILTER (WHERE is_unknown), ARRAY[]::integer[]),
    coalesce(array_agg(appid ORDER BY appid) FILTER (WHERE NOT is_unknown AND hint_changed), ARRAY[]::integer[])
  INTO
    v_accepted,
    v_unknown,
    v_known,
    v_changed_known,
    v_unchanged_known,
    v_first_appid,
    v_last_appid,
    v_unknown_appids,
    v_changed_known_appids
  FROM catalog_observation_disposition;

  IF v_accepted <> jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'catalog batch normalization count mismatch';
  END IF;

  INSERT INTO legacy.apps (
    appid,
    name,
    type,
    is_released,
    is_delisted,
    catalog_seed_state,
    created_at,
    updated_at
  )
  SELECT
    appid,
    name,
    'game',
    false,
    false,
    'stub',
    v_observed_at,
    v_observed_at
  FROM catalog_observation_disposition
  WHERE is_unknown
  ON CONFLICT (appid) DO NOTHING;
  GET DIAGNOSTICS v_seeded = ROW_COUNT;

  INSERT INTO ops.sync_status (
    appid,
    steam_last_modified,
    steam_price_change_number,
    priority_score,
    refresh_tier,
    created_at,
    updated_at
  )
  SELECT
    appid,
    last_modified,
    price_change_number,
    CASE WHEN is_unknown OR needs_readiness_seed THEN 25 ELSE 0 END,
    CASE WHEN is_unknown OR needs_readiness_seed THEN 'moderate' ELSE NULL END,
    v_observed_at,
    v_observed_at
  FROM catalog_observation_disposition
  WHERE is_unknown OR hint_changed
  ON CONFLICT (appid)
  DO UPDATE SET
    steam_last_modified = coalesce(EXCLUDED.steam_last_modified, ops.sync_status.steam_last_modified),
    steam_price_change_number = coalesce(
      EXCLUDED.steam_price_change_number,
      ops.sync_status.steam_price_change_number
    ),
    priority_score = greatest(
      coalesce(ops.sync_status.priority_score, 0),
      coalesce(EXCLUDED.priority_score, 0)
    ),
    refresh_tier = coalesce(ops.sync_status.refresh_tier, EXCLUDED.refresh_tier),
    updated_at = v_observed_at;

  INSERT INTO ops.app_catalog_state (
    appid,
    first_observed_at,
    first_observed_source,
    first_observed_scan_id,
    first_observation_kind,
    last_observed_at,
    last_observed_source,
    last_observed_scan_id,
    last_full_observed_at,
    last_full_observed_scan_id,
    latest_name,
    latest_steam_last_modified,
    latest_steam_price_change_number,
    observation_count,
    created_at,
    updated_at
  )
  SELECT
    appid,
    v_observed_at,
    v_run.source,
    v_run.id,
    CASE WHEN is_unknown THEN 'new' ELSE 'baseline' END,
    v_observed_at,
    v_run.source,
    v_run.id,
    CASE WHEN v_run.source = 'steam_applist' THEN v_observed_at ELSE NULL END,
    CASE WHEN v_run.source = 'steam_applist' THEN v_run.id ELSE NULL END,
    name,
    last_modified,
    price_change_number,
    1,
    v_observed_at,
    v_observed_at
  FROM catalog_observation_disposition
  ON CONFLICT (appid)
  DO UPDATE SET
    last_observed_at = greatest(
      ops.app_catalog_state.last_observed_at,
      EXCLUDED.last_observed_at
    ),
    last_observed_source = CASE
      WHEN EXCLUDED.last_observed_at >= ops.app_catalog_state.last_observed_at
        THEN EXCLUDED.last_observed_source
      ELSE ops.app_catalog_state.last_observed_source
    END,
    last_observed_scan_id = CASE
      WHEN EXCLUDED.last_observed_at >= ops.app_catalog_state.last_observed_at
        THEN EXCLUDED.last_observed_scan_id
      ELSE ops.app_catalog_state.last_observed_scan_id
    END,
    last_full_observed_at = CASE
      WHEN EXCLUDED.last_full_observed_at IS NOT NULL
        AND (
          ops.app_catalog_state.last_full_observed_at IS NULL
          OR EXCLUDED.last_full_observed_at >= ops.app_catalog_state.last_full_observed_at
        )
        THEN EXCLUDED.last_full_observed_at
      ELSE ops.app_catalog_state.last_full_observed_at
    END,
    last_full_observed_scan_id = CASE
      WHEN EXCLUDED.last_full_observed_at IS NOT NULL
        AND (
          ops.app_catalog_state.last_full_observed_at IS NULL
          OR EXCLUDED.last_full_observed_at >= ops.app_catalog_state.last_full_observed_at
        )
        THEN EXCLUDED.last_full_observed_scan_id
      ELSE ops.app_catalog_state.last_full_observed_scan_id
    END,
    latest_name = CASE
      WHEN EXCLUDED.last_observed_at >= ops.app_catalog_state.last_observed_at
        THEN EXCLUDED.latest_name
      ELSE ops.app_catalog_state.latest_name
    END,
    latest_steam_last_modified = CASE
      WHEN EXCLUDED.latest_steam_last_modified IS NULL
        THEN ops.app_catalog_state.latest_steam_last_modified
      WHEN ops.app_catalog_state.latest_steam_last_modified IS NULL
        OR EXCLUDED.latest_steam_last_modified >= ops.app_catalog_state.latest_steam_last_modified
        THEN EXCLUDED.latest_steam_last_modified
      ELSE ops.app_catalog_state.latest_steam_last_modified
    END,
    latest_steam_price_change_number = CASE
      WHEN EXCLUDED.latest_steam_last_modified IS NULL
        THEN ops.app_catalog_state.latest_steam_price_change_number
      WHEN ops.app_catalog_state.latest_steam_last_modified IS NULL
        OR EXCLUDED.latest_steam_last_modified >= ops.app_catalog_state.latest_steam_last_modified
        THEN EXCLUDED.latest_steam_price_change_number
      ELSE ops.app_catalog_state.latest_steam_price_change_number
    END,
    observation_count = ops.app_catalog_state.observation_count + 1,
    updated_at = v_observed_at;

  INSERT INTO events.app_catalog_events (
    appid,
    event_type,
    source,
    observed_at,
    scan_run_id,
    idempotency_key,
    payload,
    created_at
  )
  SELECT
    appid,
    'first_observed',
    v_run.source,
    v_observed_at,
    v_run.id,
    'catalog:first_observed:' || appid::text,
    jsonb_build_object(
      'name', name,
      'steam_last_modified', last_modified,
      'steam_price_change_number', price_change_number
    ),
    v_observed_at
  FROM catalog_observation_disposition
  WHERE is_unknown
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_first_events = ROW_COUNT;

  INSERT INTO events.app_catalog_events (
    appid,
    event_type,
    source,
    observed_at,
    scan_run_id,
    idempotency_key,
    payload,
    created_at
  )
  SELECT
    appid,
    'baseline_observed',
    v_run.source,
    v_observed_at,
    v_run.id,
    'catalog:baseline_observed:' || appid::text,
    jsonb_build_object(
      'name', name,
      'steam_last_modified', last_modified,
      'steam_price_change_number', price_change_number
    ),
    v_observed_at
  FROM catalog_observation_disposition
  WHERE first_ledger_observation
    AND NOT is_unknown
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_baseline_events = ROW_COUNT;
  v_event_rows := v_first_events + v_baseline_events;

  SELECT ops.mark_app_capture_work_dirty(
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'appid', appid,
          'source', 'storefront',
          'priority', CASE WHEN is_unknown THEN 200 ELSE 100 END,
          'trigger_reason', CASE
            WHEN is_unknown THEN 'catalog_first_observed'
            ELSE 'steam_app_change_hint'
          END,
          'trigger_cursor', CASE
            WHEN last_modified IS NULL THEN ''
            ELSE last_modified::text || ':' || coalesce(price_change_number, 0)::text
          END,
          'payload', jsonb_build_object(
            'catalog_scan_id', v_run.id,
            'catalog_batch_index', p_batch_index
          )
        )
        ORDER BY appid
      ),
      '[]'::jsonb
    ),
    6
  )
  INTO v_enqueued
  FROM catalog_observation_disposition
  WHERE is_unknown OR hint_changed;

  v_manifest_entry := jsonb_build_object(
    'batch_index', p_batch_index,
    'batch_hash', p_batch_hash,
    'accepted_rows', v_accepted,
    'rejected_rows', v_rejected,
    'known_rows', v_known,
    'unknown_rows', v_unknown,
    'changed_known_rows', v_changed_known,
    'unchanged_known_rows', v_unchanged_known,
    'seeded_rows', v_seeded,
    'enqueued_rows', coalesce(v_enqueued, 0),
    'event_rows', v_event_rows,
    'first_appid', v_first_appid,
    'last_appid', v_last_appid,
    'unknown_appids', to_jsonb(v_unknown_appids),
    'changed_known_appids', to_jsonb(v_changed_known_appids),
    'rejections', coalesce(p_rejections, '[]'::jsonb),
    'committed_at', to_jsonb(clock_timestamp())
  );

  UPDATE ops.catalog_scan_runs r
  SET last_committed_batch = p_batch_index,
      source_rows_committed = r.source_rows_committed + v_accepted + v_rejected,
      accepted_rows = r.accepted_rows + v_accepted,
      rejected_rows = r.rejected_rows + v_rejected,
      known_rows = r.known_rows + v_known,
      unknown_rows = r.unknown_rows + v_unknown,
      changed_known_rows = r.changed_known_rows + v_changed_known,
      unchanged_known_rows = r.unchanged_known_rows + v_unchanged_known,
      seeded_rows = r.seeded_rows + v_seeded,
      enqueued_rows = r.enqueued_rows + coalesce(v_enqueued, 0),
      event_rows = r.event_rows + v_event_rows,
      batch_manifest = r.batch_manifest || jsonb_build_array(v_manifest_entry),
      updated_at = clock_timestamp()
  WHERE r.id = v_run.id;

  RETURN v_manifest_entry;
END;
$$;

CREATE OR REPLACE FUNCTION ops.complete_catalog_scan(
  p_scan_id uuid,
  p_expected_batches integer,
  p_expected_source_rows integer,
  p_input_hash text,
  p_reconciliation_outcome jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_run ops.catalog_scan_runs%ROWTYPE;
BEGIN
  SELECT r.*
  INTO v_run
  FROM ops.catalog_scan_runs r
  WHERE r.id = p_scan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog scan % does not exist', p_scan_id;
  END IF;

  IF v_run.status = 'completed' THEN
    IF v_run.input_hash IS DISTINCT FROM p_input_hash
      OR v_run.source_rows_committed <> p_expected_source_rows
    THEN
      RAISE EXCEPTION 'completed catalog scan % does not match replay input', p_scan_id;
    END IF;
    RETURN;
  END IF;

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'catalog scan % is not running (status=%)', p_scan_id, v_run.status;
  END IF;
  IF p_expected_batches < 0 OR p_expected_source_rows < 0 THEN
    RAISE EXCEPTION 'catalog scan completion counts must be nonnegative';
  END IF;
  IF v_run.last_committed_batch <> p_expected_batches - 1 THEN
    RAISE EXCEPTION
      'catalog scan % batch reconciliation failed: committed %, expected %',
      p_scan_id,
      v_run.last_committed_batch + 1,
      p_expected_batches;
  END IF;
  IF v_run.source_rows_committed <> p_expected_source_rows THEN
    RAISE EXCEPTION
      'catalog scan % row reconciliation failed: committed %, expected %',
      p_scan_id,
      v_run.source_rows_committed,
      p_expected_source_rows;
  END IF;

  UPDATE ops.catalog_scan_runs r
  SET status = 'completed',
      input_hash = p_input_hash,
      reconciliation_outcome = p_reconciliation_outcome,
      completed_at = clock_timestamp(),
      error_message = NULL,
      updated_at = clock_timestamp()
  WHERE r.id = v_run.id;

  UPDATE ops.app_catalog_state state
  SET last_successful_scan_id = CASE
        WHEN state.last_observed_scan_id = v_run.id THEN v_run.id
        ELSE state.last_successful_scan_id
      END,
      last_full_reconciliation_scan_id = CASE
        WHEN v_run.source = 'steam_applist' THEN v_run.id
        ELSE state.last_full_reconciliation_scan_id
      END,
      last_full_reconciled_at = CASE
        WHEN v_run.source = 'steam_applist' THEN clock_timestamp()
        ELSE state.last_full_reconciled_at
      END,
      updated_at = clock_timestamp()
  WHERE state.last_observed_scan_id = v_run.id
    OR state.last_full_observed_scan_id = v_run.id;
END;
$$;

CREATE OR REPLACE FUNCTION ops.fail_catalog_scan(
  p_scan_id uuid,
  p_error_message text
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE ops.catalog_scan_runs
  SET status = 'failed',
      error_message = left(coalesce(p_error_message, 'catalog_scan_failed'), 4000),
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = p_scan_id
    AND status = 'running';
$$;
