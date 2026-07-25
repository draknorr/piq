-- Audited recovery from a PICS retention gap.
--
-- Steam can answer an old get_changes_since request with
-- force_full_app_update=true and no item-level app list. That response proves
-- the incremental interval is unavailable; it does not authorize silently
-- advancing ops.pics_sync_state. This migration adds an explicit checkpoint
-- record plus a durable full-state reconciliation manifest.
--
-- Applying this file changes production Tiger schema and requires a separately
-- approved write window. Applying a checkpoint with
-- ops.apply_pics_reconciliation_checkpoint is a second, separately approved
-- production-data mutation.

SET statement_timeout = '10min';
SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS ops.pics_cursor_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_change_number bigint NOT NULL,
    to_change_number bigint NOT NULL,
    gap_evidence_batch_id uuid NOT NULL
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    head_evidence_batch_id uuid NOT NULL
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    evidence_stream_key text NOT NULL,
    reason text NOT NULL,
    requested_by text NOT NULL,
    app_manifest_count bigint NOT NULL DEFAULT 0,
    app_manifest_sha256 text NOT NULL DEFAULT repeat('0', 64),
    status text NOT NULL DEFAULT 'preparing',
    prepared_at timestamp with time zone NOT NULL DEFAULT now(),
    applied_at timestamp with time zone,
    rolled_back_at timestamp with time zone,
    rollback_reason text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pics_cursor_checkpoints_cursor_check CHECK (
      from_change_number >= 0
      AND to_change_number > from_change_number
    ),
    CONSTRAINT pics_cursor_checkpoints_stream_check CHECK (
      nullif(btrim(evidence_stream_key), '') IS NOT NULL
      AND length(evidence_stream_key) <= 128
      AND evidence_stream_key <> 'primary'
    ),
    CONSTRAINT pics_cursor_checkpoints_reason_check CHECK (
      nullif(btrim(reason), '') IS NOT NULL
      AND length(reason) <= 2000
    ),
    CONSTRAINT pics_cursor_checkpoints_requested_by_check CHECK (
      nullif(btrim(requested_by), '') IS NOT NULL
      AND length(requested_by) <= 200
    ),
    CONSTRAINT pics_cursor_checkpoints_manifest_check CHECK (
      app_manifest_count >= 0
      AND app_manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT pics_cursor_checkpoints_status_check CHECK (
      status = ANY (
        ARRAY[
          'preparing'::text,
          'applied'::text,
          'rolled_back'::text
        ]
      )
    ),
    CONSTRAINT pics_cursor_checkpoints_status_time_check CHECK (
      (
        status = 'preparing'
        AND applied_at IS NULL
        AND rolled_back_at IS NULL
      )
      OR (
        status = 'applied'
        AND applied_at IS NOT NULL
        AND rolled_back_at IS NULL
      )
      OR (
        status = 'rolled_back'
        AND applied_at IS NOT NULL
        AND rolled_back_at IS NOT NULL
        AND nullif(btrim(rollback_reason), '') IS NOT NULL
      )
    ),
    CONSTRAINT pics_cursor_checkpoints_boundary_key UNIQUE (
      from_change_number,
      to_change_number
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_cursor_checkpoints_applied
  ON ops.pics_cursor_checkpoints (applied_at DESC, id)
  WHERE status = 'applied';

CREATE TABLE IF NOT EXISTS ops.pics_reconciliation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_id uuid NOT NULL UNIQUE
      REFERENCES ops.pics_cursor_checkpoints(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    coverage_cutoff timestamp with time zone NOT NULL,
    item_manifest_count bigint NOT NULL DEFAULT 0,
    item_manifest_sha256 text NOT NULL DEFAULT repeat('0', 64),
    outcome jsonb,
    verified_source_blocked_count bigint,
    completed_by text,
    completion_note text,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pics_reconciliation_runs_status_check CHECK (
      status = ANY (
        ARRAY['active'::text, 'completed'::text, 'cancelled'::text]
      )
    ),
    CONSTRAINT pics_reconciliation_runs_manifest_check CHECK (
      item_manifest_count >= 0
      AND item_manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT pics_reconciliation_runs_completion_audit_check CHECK (
      (
        status <> 'completed'
        AND verified_source_blocked_count IS NULL
        AND completed_by IS NULL
        AND completion_note IS NULL
      )
      OR (
        status = 'completed'
        AND verified_source_blocked_count >= 0
        AND nullif(btrim(completed_by), '') IS NOT NULL
        AND length(completed_by) <= 200
        AND nullif(btrim(completion_note), '') IS NOT NULL
        AND length(completion_note) <= 2000
      )
    ),
    CONSTRAINT pics_reconciliation_runs_status_time_check CHECK (
      (
        status = 'active'
        AND completed_at IS NULL
        AND cancelled_at IS NULL
      )
      OR (
        status = 'completed'
        AND completed_at IS NOT NULL
        AND cancelled_at IS NULL
      )
      OR (
        status = 'cancelled'
        AND completed_at IS NULL
        AND cancelled_at IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_reconciliation_runs_active
  ON ops.pics_reconciliation_runs (started_at ASC, id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ops.pics_reconciliation_items (
    run_id uuid NOT NULL
      REFERENCES ops.pics_reconciliation_runs(id) ON DELETE RESTRICT,
    appid integer NOT NULL REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    source_index bigint NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    work_id bigint,
    completed_snapshot_id bigint
      REFERENCES docs.app_source_snapshots(id) ON DELETE RESTRICT,
    source_change_number bigint,
    baseline_last_pics_sync timestamp with time zone,
    baseline_pics_change_number bigint,
    baseline_readiness jsonb,
    last_error_code text,
    last_error_message text,
    disposition jsonb,
    requeue_count integer NOT NULL DEFAULT 0,
    last_requeued_at timestamp with time zone,
    last_requeued_by text,
    last_requeue_reason text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pics_reconciliation_items_pkey PRIMARY KEY (run_id, appid),
    CONSTRAINT pics_reconciliation_items_source_index_key UNIQUE (
      run_id,
      source_index
    ),
    CONSTRAINT pics_reconciliation_items_appid_check CHECK (appid > 0),
    CONSTRAINT pics_reconciliation_items_source_index_check CHECK (
      source_index >= 0
    ),
    CONSTRAINT pics_reconciliation_items_status_check CHECK (
      status = ANY (
        ARRAY[
          'pending'::text,
          'completed'::text,
          'source_blocked'::text,
          'dead_letter'::text
        ]
      )
    ),
    CONSTRAINT pics_reconciliation_items_change_number_check CHECK (
      source_change_number IS NULL OR source_change_number >= 0
    ),
    CONSTRAINT pics_reconciliation_items_baseline_readiness_check CHECK (
      baseline_readiness IS NULL
      OR jsonb_typeof(baseline_readiness) = 'object'
    ),
    CONSTRAINT pics_reconciliation_items_disposition_check CHECK (
      disposition IS NULL OR jsonb_typeof(disposition) = 'object'
    ),
    CONSTRAINT pics_reconciliation_items_requeue_check CHECK (
      requeue_count >= 0
      AND (
        (
          requeue_count = 0
          AND last_requeued_at IS NULL
          AND last_requeued_by IS NULL
          AND last_requeue_reason IS NULL
        )
        OR (
          requeue_count > 0
          AND last_requeued_at IS NOT NULL
          AND nullif(btrim(last_requeued_by), '') IS NOT NULL
          AND length(last_requeued_by) <= 200
          AND nullif(btrim(last_requeue_reason), '') IS NOT NULL
          AND length(last_requeue_reason) <= 2000
        )
      )
    ),
    CONSTRAINT pics_reconciliation_items_status_completion_check CHECK (
      (status = 'pending' AND completed_at IS NULL)
      OR (status <> 'pending' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_reconciliation_items_status
  ON ops.pics_reconciliation_items (run_id, status, source_index);

ALTER TABLE ops.pics_work_state
  ALTER COLUMN first_batch_id DROP NOT NULL,
  ALTER COLUMN latest_batch_id DROP NOT NULL;

ALTER TABLE ops.pics_work_state
  ADD COLUMN IF NOT EXISTS reconciliation_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ops.pics_work_state'::regclass
      AND conname = 'pics_work_state_reconciliation_run_fkey'
  ) THEN
    ALTER TABLE ops.pics_work_state
      ADD CONSTRAINT pics_work_state_reconciliation_run_fkey
      FOREIGN KEY (reconciliation_run_id)
      REFERENCES ops.pics_reconciliation_runs(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ops.pics_reconciliation_items'::regclass
      AND conname = 'pics_reconciliation_items_work_fkey'
  ) THEN
    ALTER TABLE ops.pics_reconciliation_items
      ADD CONSTRAINT pics_reconciliation_items_work_fkey
      FOREIGN KEY (work_id)
      REFERENCES ops.pics_work_state(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ops.pics_work_state'::regclass
      AND conname = 'pics_work_state_reconciliation_item_fkey'
  ) THEN
    ALTER TABLE ops.pics_work_state
      ADD CONSTRAINT pics_work_state_reconciliation_item_fkey
      FOREIGN KEY (reconciliation_run_id, appid)
      REFERENCES ops.pics_reconciliation_items(run_id, appid)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ops.pics_work_state'::regclass
      AND conname = 'pics_work_state_source_provenance_check'
  ) THEN
    ALTER TABLE ops.pics_work_state
      ADD CONSTRAINT pics_work_state_source_provenance_check CHECK (
        (
          first_batch_id IS NOT NULL
          AND latest_batch_id IS NOT NULL
        )
        OR reconciliation_run_id IS NOT NULL
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ops_pics_work_state_reconciliation
  ON ops.pics_work_state (reconciliation_run_id, state, id)
  WHERE reconciliation_run_id IS NOT NULL;

CREATE OR REPLACE VIEW ops.pics_reconciliation_progress AS
SELECT
  runs.id AS run_id,
  runs.checkpoint_id,
  runs.status,
  checkpoints.from_change_number,
  checkpoints.to_change_number,
  runs.coverage_cutoff,
  runs.item_manifest_count,
  runs.item_manifest_sha256,
  count(items.appid)::bigint AS durable_item_count,
  count(*) FILTER (WHERE items.status = 'pending')::bigint AS pending_count,
  count(*) FILTER (WHERE items.status = 'completed')::bigint AS completed_count,
  count(*) FILTER (WHERE items.status = 'source_blocked')::bigint
    AS source_blocked_count,
  count(*) FILTER (WHERE items.status = 'dead_letter')::bigint
    AS dead_letter_count,
  min(items.source_index) FILTER (WHERE items.status = 'pending')
    AS oldest_pending_source_index,
  count(*) FILTER (
    WHERE work.state = 'claimed'
      AND work.claim_expires_at > clock_timestamp()
  )::bigint AS active_claim_count,
  count(*) FILTER (
    WHERE work.state = 'claimed'
      AND work.claim_expires_at <= clock_timestamp()
  )::bigint AS expired_claim_count,
  runs.started_at,
  runs.completed_at,
  runs.cancelled_at,
  runs.updated_at
FROM ops.pics_reconciliation_runs runs
JOIN ops.pics_cursor_checkpoints checkpoints
  ON checkpoints.id = runs.checkpoint_id
LEFT JOIN ops.pics_reconciliation_items items
  ON items.run_id = runs.id
LEFT JOIN ops.pics_work_state work
  ON work.reconciliation_run_id = items.run_id
 AND work.appid = items.appid
GROUP BY
  runs.id,
  checkpoints.from_change_number,
  checkpoints.to_change_number;

CREATE OR REPLACE FUNCTION ops.apply_pics_reconciliation_checkpoint(
  p_expected_cursor bigint,
  p_target_cursor bigint,
  p_gap_evidence_batch_id uuid,
  p_head_evidence_batch_id uuid,
  p_reason text,
  p_requested_by text
)
RETURNS TABLE (
  checkpoint_id uuid,
  reconciliation_run_id uuid,
  from_change_number bigint,
  to_change_number bigint,
  item_manifest_count bigint,
  item_manifest_sha256 text,
  work_rows bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_current_cursor bigint;
  v_gap ops.pics_change_batches%ROWTYPE;
  v_head ops.pics_change_batches%ROWTYPE;
  v_checkpoint ops.pics_cursor_checkpoints%ROWTYPE;
  v_run ops.pics_reconciliation_runs%ROWTYPE;
  v_manifest_count bigint;
  v_manifest_sha256 text;
  v_work_rows bigint;
BEGIN
  PERFORM set_config('statement_timeout', '10min', true);
  PERFORM set_config('lock_timeout', '15s', true);

  IF p_expected_cursor IS NULL OR p_expected_cursor < 0 THEN
    RAISE EXCEPTION 'expected PICS cursor must be nonnegative';
  END IF;
  IF p_target_cursor IS NULL OR p_target_cursor <= p_expected_cursor THEN
    RAISE EXCEPTION 'target PICS cursor must be greater than expected cursor';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'PICS checkpoint reason is required';
  END IF;
  IF nullif(btrim(p_requested_by), '') IS NULL THEN
    RAISE EXCEPTION 'PICS checkpoint requested_by is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pics-intake:primary', 0));

  SELECT last_change_number
  INTO v_current_cursor
  FROM ops.pics_sync_state
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ops.pics_sync_state row id=1 is missing';
  END IF;

  SELECT *
  INTO v_checkpoint
  FROM ops.pics_cursor_checkpoints
  WHERE from_change_number = p_expected_cursor
    AND to_change_number = p_target_cursor
  FOR UPDATE;

  IF FOUND THEN
    IF v_checkpoint.status <> 'applied'
      OR v_current_cursor <> p_target_cursor
      OR v_checkpoint.gap_evidence_batch_id <> p_gap_evidence_batch_id
      OR v_checkpoint.head_evidence_batch_id <> p_head_evidence_batch_id
      OR v_checkpoint.reason <> btrim(p_reason)
      OR v_checkpoint.requested_by <> btrim(p_requested_by)
    THEN
      RAISE EXCEPTION
        'existing PICS checkpoint does not match the requested applied state';
    END IF;

    SELECT *
    INTO STRICT v_run
    FROM ops.pics_reconciliation_runs
    WHERE checkpoint_id = v_checkpoint.id;

    RETURN QUERY
    SELECT
      v_checkpoint.id,
      v_run.id,
      v_checkpoint.from_change_number,
      v_checkpoint.to_change_number,
      v_run.item_manifest_count,
      v_run.item_manifest_sha256,
      (
        SELECT count(*)::bigint
        FROM ops.pics_work_state work
        WHERE work.reconciliation_run_id = v_run.id
      );
    RETURN;
  END IF;

  IF v_current_cursor <> p_expected_cursor THEN
    RAISE EXCEPTION
      'canonical PICS cursor is %, expected %',
      v_current_cursor,
      p_expected_cursor;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ops.pics_work_state
    WHERE stream_key = 'primary'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'primary PICS work already exists; checkpoint requires a clean primary stream';
  END IF;

  SELECT *
  INTO v_gap
  FROM ops.pics_change_batches
  WHERE id = p_gap_evidence_batch_id
  FOR SHARE;

  IF NOT FOUND
    OR v_gap.work_mode <> 'shadow'
    OR v_gap.stream_key = 'primary'
    OR v_gap.from_change_number <> p_expected_cursor
    OR v_gap.response_since_change_number <> p_expected_cursor
    OR v_gap.status <> 'source_blocked'
    OR v_gap.source_complete
    OR NOT (v_gap.force_full_update OR v_gap.force_full_app_update)
    OR v_gap.primary_cursor_advanced
  THEN
    RAISE EXCEPTION
      'gap evidence batch does not prove an unavailable incremental interval';
  END IF;

  SELECT *
  INTO v_head
  FROM ops.pics_change_batches
  WHERE id = p_head_evidence_batch_id
  FOR SHARE;

  IF NOT FOUND
    OR v_head.work_mode <> 'shadow'
    OR v_head.stream_key = 'primary'
    OR v_head.to_change_number <> p_target_cursor
    OR NOT v_head.source_complete
    OR v_head.status NOT IN ('committed', 'reconciled')
    OR v_head.source_app_count <> v_head.durable_app_count
    OR v_head.primary_cursor_advanced
  THEN
    RAISE EXCEPTION
      'head evidence batch does not prove a complete durable shadow cursor';
  END IF;

  CREATE TEMP TABLE pics_reconciliation_manifest_stage (
    source_index bigint PRIMARY KEY,
    appid integer NOT NULL UNIQUE,
    baseline_last_pics_sync timestamp with time zone,
    baseline_pics_change_number bigint,
    baseline_readiness jsonb
  ) ON COMMIT DROP;

  INSERT INTO pics_reconciliation_manifest_stage (
    source_index,
    appid,
    baseline_last_pics_sync,
    baseline_pics_change_number,
    baseline_readiness
  )
  SELECT
    row_number() OVER (ORDER BY apps.appid) - 1,
    apps.appid,
    sync.last_pics_sync,
    sync.pics_change_number,
    CASE
      WHEN readiness.appid IS NULL THEN NULL
      ELSE jsonb_build_object(
        'status', readiness.status,
        'source_at', readiness.source_at,
        'processed_at', readiness.processed_at,
        'version', readiness.version,
        'blocking_reason', readiness.blocking_reason,
        'retryable', readiness.retryable,
        'provenance', readiness.provenance,
        'created_at', readiness.created_at,
        'updated_at', readiness.updated_at
      )
    END
  FROM legacy.apps apps
  LEFT JOIN ops.sync_status sync ON sync.appid = apps.appid
  LEFT JOIN ops.app_data_readiness readiness
    ON readiness.appid = apps.appid
   AND readiness.source = 'pics'
  WHERE apps.appid > 0
  ORDER BY apps.appid;

  SELECT
    count(*)::bigint,
    encode(
      digest(
        coalesce(
          string_agg(
            source_index::text || ':' || appid::text || E'\n',
            ''
            ORDER BY source_index
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
  INTO v_manifest_count, v_manifest_sha256
  FROM pics_reconciliation_manifest_stage;

  IF v_manifest_count = 0 THEN
    RAISE EXCEPTION 'PICS reconciliation manifest cannot be empty';
  END IF;

  INSERT INTO ops.pics_cursor_checkpoints (
    from_change_number,
    to_change_number,
    gap_evidence_batch_id,
    head_evidence_batch_id,
    evidence_stream_key,
    reason,
    requested_by,
    app_manifest_count,
    app_manifest_sha256,
    status,
    prepared_at,
    created_at,
    updated_at
  )
  VALUES (
    p_expected_cursor,
    p_target_cursor,
    p_gap_evidence_batch_id,
    p_head_evidence_batch_id,
    v_head.stream_key,
    btrim(p_reason),
    btrim(p_requested_by),
    v_manifest_count,
    v_manifest_sha256,
    'preparing',
    v_now,
    v_now,
    v_now
  )
  RETURNING * INTO v_checkpoint;

  INSERT INTO ops.pics_reconciliation_runs (
    checkpoint_id,
    status,
    coverage_cutoff,
    item_manifest_count,
    item_manifest_sha256,
    started_at,
    created_at,
    updated_at
  )
  VALUES (
    v_checkpoint.id,
    'active',
    v_now,
    v_manifest_count,
    v_manifest_sha256,
    v_now,
    v_now,
    v_now
  )
  RETURNING * INTO v_run;

  INSERT INTO ops.pics_reconciliation_items (
    run_id,
    appid,
    source_index,
    status,
    baseline_last_pics_sync,
    baseline_pics_change_number,
    baseline_readiness,
    created_at,
    updated_at
  )
  SELECT
    v_run.id,
    stage.appid,
    stage.source_index,
    'pending',
    stage.baseline_last_pics_sync,
    stage.baseline_pics_change_number,
    stage.baseline_readiness,
    v_now,
    v_now
  FROM pics_reconciliation_manifest_stage stage
  ORDER BY stage.source_index;

  IF (
    SELECT count(*)::bigint
    FROM ops.pics_reconciliation_items
    WHERE run_id = v_run.id
  ) <> v_manifest_count THEN
    RAISE EXCEPTION 'durable PICS reconciliation item count mismatch';
  END IF;

  IF (
    SELECT encode(
      digest(
        coalesce(
          string_agg(
            source_index::text || ':' || appid::text || E'\n',
            ''
            ORDER BY source_index
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
    FROM ops.pics_reconciliation_items
    WHERE run_id = v_run.id
  ) <> v_manifest_sha256 THEN
    RAISE EXCEPTION 'durable PICS reconciliation item hash mismatch';
  END IF;

  INSERT INTO ops.pics_work_state (
    appid,
    stream_key,
    work_mode,
    lane,
    priority,
    state,
    first_batch_id,
    latest_batch_id,
    reconciliation_run_id,
    first_change_number,
    latest_change_number,
    dirty_since,
    last_dirty_at,
    attempts,
    max_attempts,
    next_attempt_at,
    created_at,
    updated_at
  )
  SELECT
    stage.appid,
    'primary',
    'durable',
    'catchup',
    100,
    'pending',
    NULL,
    NULL,
    v_run.id,
    0,
    0,
    v_now,
    v_now,
    0,
    8,
    v_now,
    v_now,
    v_now
  FROM pics_reconciliation_manifest_stage stage
  ORDER BY stage.source_index;
  GET DIAGNOSTICS v_work_rows = ROW_COUNT;

  IF v_work_rows <> v_manifest_count THEN
    RAISE EXCEPTION
      'PICS reconciliation work count % does not match manifest %',
      v_work_rows,
      v_manifest_count;
  END IF;

  UPDATE ops.pics_reconciliation_items items
  SET work_id = work.id,
      updated_at = v_now
  FROM ops.pics_work_state work
  WHERE items.run_id = v_run.id
    AND work.reconciliation_run_id = v_run.id
    AND work.appid = items.appid;

  IF EXISTS (
    SELECT 1
    FROM ops.pics_reconciliation_items
    WHERE run_id = v_run.id
      AND work_id IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'PICS reconciliation item is missing durable work';
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
  SELECT
    stage.appid,
    'pics',
    'pending',
    v_now,
    NULL,
    'pics-readiness/v1',
    'awaiting_full_state_reconciliation',
    true,
    jsonb_build_object(
      'reconciliationRunId', v_run.id,
      'checkpointId', v_checkpoint.id,
      'checkpointChangeNumber', p_target_cursor
    ),
    v_now,
    v_now
  FROM pics_reconciliation_manifest_stage stage
  ON CONFLICT (appid, source)
  DO UPDATE SET
    status = 'pending',
    source_at = EXCLUDED.source_at,
    processed_at = NULL,
    version = EXCLUDED.version,
    blocking_reason = EXCLUDED.blocking_reason,
    retryable = true,
    provenance = EXCLUDED.provenance,
    updated_at = EXCLUDED.updated_at;

  UPDATE ops.pics_sync_state
  SET last_change_number = p_target_cursor,
      updated_at = v_now
  WHERE id = 1
    AND last_change_number = p_expected_cursor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical PICS cursor changed before checkpoint commit';
  END IF;

  UPDATE ops.pics_cursor_checkpoints
  SET status = 'applied',
      applied_at = v_now,
      updated_at = v_now
  WHERE id = v_checkpoint.id
  RETURNING * INTO v_checkpoint;

  RETURN QUERY
  SELECT
    v_checkpoint.id,
    v_run.id,
    v_checkpoint.from_change_number,
    v_checkpoint.to_change_number,
    v_run.item_manifest_count,
    v_run.item_manifest_sha256,
    v_work_rows;
END;
$$;

CREATE OR REPLACE FUNCTION ops.extend_pics_reconciliation_run(
  p_run_id uuid
)
RETURNS TABLE (
  reconciliation_run_id uuid,
  added_items bigint,
  newly_enqueued_work bigint,
  item_manifest_count bigint,
  item_manifest_sha256 text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_run ops.pics_reconciliation_runs%ROWTYPE;
  v_checkpoint ops.pics_cursor_checkpoints%ROWTYPE;
  v_next_index bigint;
  v_added bigint;
  v_enqueued bigint;
  v_count bigint;
  v_hash text;
BEGIN
  PERFORM set_config('statement_timeout', '10min', true);
  PERFORM set_config('lock_timeout', '15s', true);

  PERFORM pg_advisory_xact_lock(
    hashtextextended('pics-reconciliation:' || p_run_id::text, 0)
  );

  SELECT *
  INTO STRICT v_run
  FROM ops.pics_reconciliation_runs
  WHERE id = p_run_id
  FOR UPDATE;

  SELECT *
  INTO STRICT v_checkpoint
  FROM ops.pics_cursor_checkpoints
  WHERE id = v_run.checkpoint_id
  FOR SHARE;

  IF v_run.status <> 'active' OR v_checkpoint.status <> 'applied' THEN
    RAISE EXCEPTION 'PICS reconciliation run is not active and applied';
  END IF;

  SELECT coalesce(max(source_index) + 1, 0)
  INTO v_next_index
  FROM ops.pics_reconciliation_items
  WHERE run_id = p_run_id;

  CREATE TEMP TABLE pics_reconciliation_extension_stage (
    source_index bigint PRIMARY KEY,
    appid integer NOT NULL UNIQUE,
    initial_status text NOT NULL,
    completed_snapshot_id bigint,
    source_change_number bigint,
    baseline_last_pics_sync timestamp with time zone,
    baseline_pics_change_number bigint,
    baseline_readiness jsonb
  ) ON COMMIT DROP;

  INSERT INTO pics_reconciliation_extension_stage (
    source_index,
    appid,
    initial_status,
    completed_snapshot_id,
    source_change_number,
    baseline_last_pics_sync,
    baseline_pics_change_number,
    baseline_readiness
  )
  SELECT
    v_next_index + row_number() OVER (ORDER BY apps.appid) - 1,
    apps.appid,
    CASE
      WHEN completion.is_durable_live_completion
        THEN 'completed'
      ELSE 'pending'
    END,
    CASE
      WHEN completion.is_durable_live_completion
        THEN snapshot.id
      ELSE NULL
    END,
    CASE
      WHEN completion.is_durable_live_completion
        THEN sync.pics_change_number
      ELSE NULL
    END,
    sync.last_pics_sync,
    sync.pics_change_number,
    CASE
      WHEN readiness.appid IS NULL THEN NULL
      ELSE jsonb_build_object(
        'status', readiness.status,
        'source_at', readiness.source_at,
        'processed_at', readiness.processed_at,
        'version', readiness.version,
        'blocking_reason', readiness.blocking_reason,
        'retryable', readiness.retryable,
        'provenance', readiness.provenance,
        'created_at', readiness.created_at,
        'updated_at', readiness.updated_at
      )
    END
  FROM legacy.apps apps
  LEFT JOIN ops.sync_status sync ON sync.appid = apps.appid
  LEFT JOIN LATERAL (
    SELECT source_snapshot.id, source_snapshot.observed_at
    FROM docs.app_source_snapshots source_snapshot
    WHERE source_snapshot.source = 'pics'
      AND source_snapshot.appid = apps.appid
    ORDER BY source_snapshot.first_seen_at DESC, source_snapshot.id DESC
    LIMIT 1
  ) snapshot ON true
  LEFT JOIN ops.app_data_readiness readiness
    ON readiness.appid = apps.appid
   AND readiness.source = 'pics'
  LEFT JOIN LATERAL (
    SELECT (
      sync.last_pics_sync >= v_run.started_at
      AND sync.pics_change_number IS NOT NULL
      AND snapshot.observed_at >= v_run.started_at
      AND readiness.status = 'ready'
      AND readiness.processed_at >= v_run.started_at
      AND readiness.provenance->>'streamKey' = 'primary'
      AND readiness.provenance->>'snapshotId' = snapshot.id::text
      AND readiness.provenance->>'sourceChangeNumber' =
        sync.pics_change_number::text
    ) AS is_durable_live_completion
  ) completion ON true
  WHERE apps.appid > 0
    AND NOT EXISTS (
      SELECT 1
      FROM ops.pics_reconciliation_items existing
      WHERE existing.run_id = p_run_id
        AND existing.appid = apps.appid
    )
  ORDER BY apps.appid;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  IF v_added = 0 THEN
    RETURN QUERY
    SELECT
      v_run.id,
      0::bigint,
      0::bigint,
      v_run.item_manifest_count,
      v_run.item_manifest_sha256;
    RETURN;
  END IF;

  INSERT INTO ops.pics_reconciliation_items (
    run_id,
    appid,
    source_index,
    status,
    completed_snapshot_id,
    source_change_number,
    baseline_last_pics_sync,
    baseline_pics_change_number,
    baseline_readiness,
    disposition,
    completed_at,
    created_at,
    updated_at
  )
  SELECT
    v_run.id,
    stage.appid,
    stage.source_index,
    stage.initial_status,
    stage.completed_snapshot_id,
    stage.source_change_number,
    stage.baseline_last_pics_sync,
    stage.baseline_pics_change_number,
    stage.baseline_readiness,
    CASE
      WHEN stage.initial_status = 'completed' THEN jsonb_build_object(
        'reason', 'durable_live_completed_during_reconciliation',
        'snapshotId', stage.completed_snapshot_id,
        'sourceChangeNumber', stage.source_change_number
      )
      ELSE NULL
    END,
    CASE
      WHEN stage.initial_status = 'completed' THEN v_now
      ELSE NULL
    END,
    v_now,
    v_now
  FROM pics_reconciliation_extension_stage stage
  ORDER BY stage.source_index;

  INSERT INTO ops.pics_work_state (
    appid,
    stream_key,
    work_mode,
    lane,
    priority,
    state,
    first_batch_id,
    latest_batch_id,
    reconciliation_run_id,
    first_change_number,
    latest_change_number,
    dirty_since,
    last_dirty_at,
    attempts,
    max_attempts,
    next_attempt_at,
    created_at,
    updated_at
  )
  SELECT
    stage.appid,
    'primary',
    'durable',
    'catchup',
    100,
    'pending',
    NULL,
    NULL,
    v_run.id,
    0,
    0,
    v_now,
    v_now,
    0,
    8,
    v_now,
    v_now,
    v_now
  FROM pics_reconciliation_extension_stage stage
  WHERE stage.initial_status = 'pending'
  ON CONFLICT (appid, stream_key)
  DO UPDATE SET
    reconciliation_run_id = v_run.id,
    lane = CASE
      WHEN ops.pics_work_state.lane IN ('new', 'live')
        THEN ops.pics_work_state.lane
      ELSE 'catchup'
    END,
    priority = greatest(ops.pics_work_state.priority, 100),
    state = CASE
      WHEN ops.pics_work_state.state = 'claimed' THEN 'claimed'
      ELSE 'pending'
    END,
    claimed_through_change_number = CASE
      WHEN ops.pics_work_state.state = 'claimed'
        THEN ops.pics_work_state.claimed_through_change_number
      ELSE NULL
    END,
    claimed_at = CASE
      WHEN ops.pics_work_state.state = 'claimed'
        THEN ops.pics_work_state.claimed_at
      ELSE NULL
    END,
    claim_expires_at = CASE
      WHEN ops.pics_work_state.state = 'claimed'
        THEN ops.pics_work_state.claim_expires_at
      ELSE NULL
    END,
    heartbeat_at = CASE
      WHEN ops.pics_work_state.state = 'claimed'
        THEN ops.pics_work_state.heartbeat_at
      ELSE NULL
    END,
    worker_id = CASE
      WHEN ops.pics_work_state.state = 'claimed'
        THEN ops.pics_work_state.worker_id
      ELSE NULL
    END,
    attempts = CASE
      WHEN ops.pics_work_state.state = 'claimed'
        THEN ops.pics_work_state.attempts
      ELSE 0
    END,
    next_attempt_at = CASE
      WHEN ops.pics_work_state.state = 'claimed'
        THEN ops.pics_work_state.next_attempt_at
      ELSE v_now
    END,
    last_error_code = NULL,
    last_error_message = NULL,
    dead_lettered_at = NULL,
    updated_at = v_now;
  GET DIAGNOSTICS v_enqueued = ROW_COUNT;

  UPDATE ops.pics_reconciliation_items items
  SET work_id = work.id,
      updated_at = v_now
  FROM ops.pics_work_state work
  WHERE items.run_id = v_run.id
    AND items.status = 'pending'
    AND work.reconciliation_run_id = v_run.id
    AND work.appid = items.appid;

  IF EXISTS (
    SELECT 1
    FROM ops.pics_reconciliation_items
    WHERE run_id = v_run.id
      AND status = 'pending'
      AND work_id IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'extended PICS reconciliation item is missing durable work';
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
  SELECT
    stage.appid,
    'pics',
    'pending',
    v_now,
    NULL,
    'pics-readiness/v1',
    'awaiting_full_state_reconciliation',
    true,
    jsonb_build_object(
      'reconciliationRunId', v_run.id,
      'checkpointId', v_checkpoint.id,
      'checkpointChangeNumber', v_checkpoint.to_change_number
    ),
    v_now,
    v_now
  FROM pics_reconciliation_extension_stage stage
  WHERE stage.initial_status = 'pending'
  ON CONFLICT (appid, source)
  DO UPDATE SET
    status = 'pending',
    source_at = EXCLUDED.source_at,
    processed_at = NULL,
    version = EXCLUDED.version,
    blocking_reason = EXCLUDED.blocking_reason,
    retryable = true,
    provenance = EXCLUDED.provenance,
    updated_at = EXCLUDED.updated_at;

  SELECT
    count(*)::bigint,
    encode(
      digest(
        coalesce(
          string_agg(
            source_index::text || ':' || appid::text || E'\n',
            ''
            ORDER BY source_index
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
  INTO v_count, v_hash
  FROM ops.pics_reconciliation_items
  WHERE run_id = v_run.id;

  UPDATE ops.pics_reconciliation_runs
  SET coverage_cutoff = v_now,
      item_manifest_count = v_count,
      item_manifest_sha256 = v_hash,
      updated_at = v_now
  WHERE id = v_run.id;

  UPDATE ops.pics_cursor_checkpoints
  SET app_manifest_count = v_count,
      app_manifest_sha256 = v_hash,
      updated_at = v_now
  WHERE id = v_checkpoint.id;

  RETURN QUERY
  SELECT v_run.id, v_added, v_enqueued, v_count, v_hash;
END;
$$;

CREATE OR REPLACE FUNCTION ops.requeue_pics_reconciliation_item(
  p_run_id uuid,
  p_appid integer,
  p_requested_by text,
  p_reason text
)
RETURNS TABLE (
  reconciliation_run_id uuid,
  appid integer,
  work_id bigint,
  work_state text,
  requeue_count integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_run ops.pics_reconciliation_runs%ROWTYPE;
  v_item ops.pics_reconciliation_items%ROWTYPE;
  v_work ops.pics_work_state%ROWTYPE;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);
  PERFORM set_config('lock_timeout', '15s', true);

  IF p_appid IS NULL OR p_appid <= 0 THEN
    RAISE EXCEPTION 'PICS reconciliation requeue appid must be positive';
  END IF;
  IF nullif(btrim(p_requested_by), '') IS NULL THEN
    RAISE EXCEPTION 'PICS reconciliation requeue requested_by is required';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'PICS reconciliation requeue reason is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('pics-reconciliation:' || p_run_id::text, 0)
  );

  SELECT *
  INTO STRICT v_run
  FROM ops.pics_reconciliation_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.status <> 'active' THEN
    RAISE EXCEPTION 'PICS reconciliation run is not active';
  END IF;

  SELECT *
  INTO STRICT v_item
  FROM ops.pics_reconciliation_items
  WHERE run_id = p_run_id
    AND appid = p_appid
  FOR UPDATE;

  IF v_item.status NOT IN ('source_blocked', 'dead_letter') THEN
    RAISE EXCEPTION
      'PICS reconciliation item status % is not manually requeueable',
      v_item.status;
  END IF;
  IF v_item.work_id IS NULL THEN
    RAISE EXCEPTION 'PICS reconciliation item has no durable work row';
  END IF;

  SELECT *
  INTO STRICT v_work
  FROM ops.pics_work_state
  WHERE id = v_item.work_id
    AND reconciliation_run_id = p_run_id
    AND appid = p_appid
  FOR UPDATE;

  IF v_work.state NOT IN ('source_blocked', 'dead_letter') THEN
    RAISE EXCEPTION
      'PICS reconciliation work state % is not manually requeueable',
      v_work.state;
  END IF;

  UPDATE ops.pics_reconciliation_items
  SET status = 'pending',
      completed_snapshot_id = NULL,
      source_change_number = NULL,
      last_error_code = NULL,
      last_error_message = NULL,
      disposition = NULL,
      requeue_count = requeue_count + 1,
      last_requeued_at = clock_timestamp(),
      last_requeued_by = btrim(p_requested_by),
      last_requeue_reason = btrim(p_reason),
      completed_at = NULL,
      updated_at = clock_timestamp()
  WHERE run_id = p_run_id
    AND appid = p_appid
  RETURNING * INTO v_item;

  UPDATE ops.pics_work_state
  SET state = 'pending',
      claimed_through_change_number = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      heartbeat_at = NULL,
      worker_id = NULL,
      attempts = 0,
      next_attempt_at = clock_timestamp(),
      last_error_code = NULL,
      last_error_message = NULL,
      dead_lettered_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_item.work_id
  RETURNING * INTO v_work;

  UPDATE ops.app_data_readiness
  SET status = 'pending',
      source_at = clock_timestamp(),
      processed_at = NULL,
      version = 'pics-readiness/v1',
      blocking_reason = 'awaiting_reconciliation_retry',
      retryable = true,
      provenance = jsonb_build_object(
        'reconciliationRunId', p_run_id,
        'workId', v_work.id,
        'requeueCount', v_item.requeue_count,
        'requeuedBy', btrim(p_requested_by),
        'requeueReason', btrim(p_reason)
      ),
      updated_at = clock_timestamp()
  WHERE appid = p_appid
    AND source = 'pics';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PICS reconciliation readiness row is missing';
  END IF;

  RETURN QUERY
  SELECT v_run.id, v_item.appid, v_work.id, v_work.state, v_item.requeue_count;
END;
$$;

CREATE OR REPLACE FUNCTION ops.rollback_unstarted_pics_reconciliation_checkpoint(
  p_checkpoint_id uuid,
  p_reason text
)
RETURNS TABLE (
  checkpoint_id uuid,
  reconciliation_run_id uuid,
  restored_cursor bigint,
  removed_work_rows bigint,
  restored_readiness_rows bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_checkpoint ops.pics_cursor_checkpoints%ROWTYPE;
  v_run ops.pics_reconciliation_runs%ROWTYPE;
  v_cursor bigint;
  v_removed_work bigint;
  v_restored_readiness bigint := 0;
  v_upserted_readiness bigint := 0;
BEGIN
  PERFORM set_config('statement_timeout', '10min', true);
  PERFORM set_config('lock_timeout', '15s', true);

  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'PICS checkpoint rollback reason is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pics-intake:primary', 0));

  SELECT *
  INTO STRICT v_checkpoint
  FROM ops.pics_cursor_checkpoints
  WHERE id = p_checkpoint_id
  FOR UPDATE;

  SELECT *
  INTO STRICT v_run
  FROM ops.pics_reconciliation_runs
  WHERE checkpoint_id = v_checkpoint.id
  FOR UPDATE;

  SELECT last_change_number
  INTO STRICT v_cursor
  FROM ops.pics_sync_state
  WHERE id = 1
  FOR UPDATE;

  IF v_checkpoint.status <> 'applied'
    OR v_run.status <> 'active'
    OR v_cursor <> v_checkpoint.to_change_number
  THEN
    RAISE EXCEPTION 'PICS checkpoint is not in an unmodified applied state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ops.pics_change_batches
    WHERE stream_key = 'primary'
      AND primary_cursor_advanced
      AND from_change_number >= v_checkpoint.to_change_number
      AND created_at >= v_checkpoint.applied_at
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'cannot roll back after durable primary intake has started';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ops.pics_work_state
    WHERE reconciliation_run_id = v_run.id
      AND (
        state <> 'pending'
        OR attempts <> 0
        OR last_completed_at IS NOT NULL
      )
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'cannot roll back after reconciliation processing has started';
  END IF;

  UPDATE ops.pics_reconciliation_items
  SET work_id = NULL,
      updated_at = clock_timestamp()
  WHERE run_id = v_run.id;

  DELETE FROM ops.pics_work_state
  WHERE reconciliation_run_id = v_run.id;
  GET DIAGNOSTICS v_removed_work = ROW_COUNT;

  DELETE FROM ops.app_data_readiness readiness
  USING ops.pics_reconciliation_items items
  WHERE items.run_id = v_run.id
    AND items.baseline_readiness IS NULL
    AND readiness.appid = items.appid
    AND readiness.source = 'pics'
    AND readiness.provenance->>'reconciliationRunId' = v_run.id::text;
  GET DIAGNOSTICS v_restored_readiness = ROW_COUNT;

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
    items.appid,
    'pics',
    items.baseline_readiness->>'status',
    (items.baseline_readiness->>'source_at')::timestamp with time zone,
    (items.baseline_readiness->>'processed_at')::timestamp with time zone,
    items.baseline_readiness->>'version',
    items.baseline_readiness->>'blocking_reason',
    (items.baseline_readiness->>'retryable')::boolean,
    coalesce(items.baseline_readiness->'provenance', '{}'::jsonb),
    (items.baseline_readiness->>'created_at')::timestamp with time zone,
    (items.baseline_readiness->>'updated_at')::timestamp with time zone
  FROM ops.pics_reconciliation_items items
  WHERE items.run_id = v_run.id
    AND items.baseline_readiness IS NOT NULL
  ON CONFLICT (appid, source)
  DO UPDATE SET
    status = EXCLUDED.status,
    source_at = EXCLUDED.source_at,
    processed_at = EXCLUDED.processed_at,
    version = EXCLUDED.version,
    blocking_reason = EXCLUDED.blocking_reason,
    retryable = EXCLUDED.retryable,
    provenance = EXCLUDED.provenance,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS v_upserted_readiness = ROW_COUNT;
  v_restored_readiness := v_restored_readiness + v_upserted_readiness;

  UPDATE ops.pics_sync_state
  SET last_change_number = v_checkpoint.from_change_number,
      updated_at = clock_timestamp()
  WHERE id = 1
    AND last_change_number = v_checkpoint.to_change_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical PICS cursor changed before rollback commit';
  END IF;

  UPDATE ops.pics_reconciliation_runs
  SET status = 'cancelled',
      cancelled_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      outcome = jsonb_build_object(
        'status', 'rolled_back_before_processing',
        'reason', btrim(p_reason)
      )
  WHERE id = v_run.id;

  UPDATE ops.pics_cursor_checkpoints
  SET status = 'rolled_back',
      rolled_back_at = clock_timestamp(),
      rollback_reason = btrim(p_reason),
      updated_at = clock_timestamp()
  WHERE id = v_checkpoint.id;

  RETURN QUERY
  SELECT
    v_checkpoint.id,
    v_run.id,
    v_checkpoint.from_change_number,
    v_removed_work,
    v_restored_readiness;
END;
$$;

CREATE OR REPLACE FUNCTION ops.finalize_pics_reconciliation_run(
  p_run_id uuid,
  p_expected_source_blocked_count bigint,
  p_completed_by text,
  p_completion_note text
)
RETURNS TABLE (
  reconciliation_run_id uuid,
  completed_count bigint,
  source_blocked_count bigint,
  dead_letter_count bigint,
  outcome jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_run ops.pics_reconciliation_runs%ROWTYPE;
  v_count bigint;
  v_hash text;
  v_pending bigint;
  v_completed bigint;
  v_blocked bigint;
  v_dead bigint;
  v_outcome jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '10min', true);
  PERFORM set_config('lock_timeout', '15s', true);

  IF p_expected_source_blocked_count IS NULL
    OR p_expected_source_blocked_count < 0
  THEN
    RAISE EXCEPTION 'expected source-blocked count must be nonnegative';
  END IF;
  IF nullif(btrim(p_completed_by), '') IS NULL THEN
    RAISE EXCEPTION 'PICS reconciliation completed_by is required';
  END IF;
  IF nullif(btrim(p_completion_note), '') IS NULL THEN
    RAISE EXCEPTION 'PICS reconciliation completion note is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('pics-reconciliation:' || p_run_id::text, 0)
  );

  SELECT *
  INTO STRICT v_run
  FROM ops.pics_reconciliation_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.status <> 'active' THEN
    RAISE EXCEPTION 'PICS reconciliation run is not active';
  END IF;

  -- Keep the final coverage check and status transition in one short window.
  -- Catalog ingestion takes ROW EXCLUSIVE, which this lock blocks until the
  -- transaction commits; no newly inserted app can escape the final manifest.
  LOCK TABLE legacy.apps IN SHARE MODE;

  IF EXISTS (
    SELECT 1
    FROM legacy.apps apps
    WHERE apps.appid > 0
      AND NOT EXISTS (
        SELECT 1
        FROM ops.pics_reconciliation_items items
        WHERE items.run_id = p_run_id
          AND items.appid = apps.appid
      )
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'PICS reconciliation has newly discovered apps; extend the run before finalizing';
  END IF;

  SELECT
    count(*)::bigint,
    encode(
      digest(
        coalesce(
          string_agg(
            source_index::text || ':' || appid::text || E'\n',
            ''
            ORDER BY source_index
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    ),
    count(*) FILTER (WHERE status = 'pending')::bigint,
    count(*) FILTER (WHERE status = 'completed')::bigint,
    count(*) FILTER (WHERE status = 'source_blocked')::bigint,
    count(*) FILTER (WHERE status = 'dead_letter')::bigint
  INTO
    v_count,
    v_hash,
    v_pending,
    v_completed,
    v_blocked,
    v_dead
  FROM ops.pics_reconciliation_items
  WHERE run_id = p_run_id;

  IF v_count <> v_run.item_manifest_count
    OR v_hash <> v_run.item_manifest_sha256
  THEN
    RAISE EXCEPTION 'PICS reconciliation durable manifest mismatch';
  END IF;
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'PICS reconciliation still has % pending items', v_pending;
  END IF;
  IF v_dead <> 0 THEN
    RAISE EXCEPTION 'PICS reconciliation has % dead-letter items', v_dead;
  END IF;
  IF v_blocked <> p_expected_source_blocked_count THEN
    RAISE EXCEPTION
      'PICS reconciliation source-blocked count is %, expected reviewed count %',
      v_blocked,
      p_expected_source_blocked_count;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ops.pics_work_state
    WHERE reconciliation_run_id = p_run_id
      AND state IN ('pending', 'claimed', 'retrying', 'dead_letter')
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'PICS reconciliation work has unresolved states';
  END IF;

  v_outcome := jsonb_build_object(
    'status', 'durably_disposed',
    'manifestCount', v_count,
    'manifestSha256', v_hash,
    'completed', v_completed,
    'sourceBlocked', v_blocked,
    'deadLetter', v_dead,
    'completedBy', btrim(p_completed_by),
    'completionNote', btrim(p_completion_note)
  );

  UPDATE ops.pics_reconciliation_runs
  SET status = 'completed',
      completed_at = clock_timestamp(),
      verified_source_blocked_count = v_blocked,
      completed_by = btrim(p_completed_by),
      completion_note = btrim(p_completion_note),
      outcome = v_outcome,
      updated_at = clock_timestamp()
  WHERE id = p_run_id;

  RETURN QUERY
  SELECT p_run_id, v_completed, v_blocked, v_dead, v_outcome;
END;
$$;

COMMENT ON TABLE ops.pics_cursor_checkpoints IS
  'Audited canonical PICS cursor advances used only when Steam proves an incremental interval is unavailable and a durable full-state manifest is created in the same transaction.';

COMMENT ON TABLE ops.pics_reconciliation_runs IS
  'One full-state PICS reconciliation run attached to an audited cursor checkpoint.';

COMMENT ON TABLE ops.pics_reconciliation_items IS
  'Immutable app manifest plus durable terminal disposition for a full-state PICS reconciliation run.';

COMMENT ON FUNCTION ops.apply_pics_reconciliation_checkpoint(
  bigint,
  bigint,
  uuid,
  uuid,
  text,
  text
) IS
  'Atomically verifies forced-full gap evidence and a healthy shadow head, persists the complete legacy app manifest, enqueues isolated primary catch-up work with neutral watermarks, marks PICS readiness pending, and only then advances the canonical cursor.';

COMMENT ON FUNCTION ops.rollback_unstarted_pics_reconciliation_checkpoint(
  uuid,
  text
) IS
  'Restores the pre-checkpoint cursor, readiness, and empty primary work state only before durable intake or reconciliation processing has begun.';

COMMENT ON FUNCTION ops.extend_pics_reconciliation_run(uuid) IS
  'Idempotently appends apps discovered during a long-running reconciliation, accepting already-promoted durable live state only when both sync and snapshot evidence postdate the run.';

COMMENT ON FUNCTION ops.requeue_pics_reconciliation_item(
  uuid,
  integer,
  text,
  text
) IS
  'Requeues one reviewed source-blocked or dead-letter reconciliation item, preserving operator identity, reason, and cumulative requeue count.';

COMMENT ON FUNCTION ops.finalize_pics_reconciliation_run(
  uuid,
  bigint,
  text,
  text
) IS
  'Marks a full-state reconciliation complete only after exact manifest parity, zero pending work, zero dead letters, an exact manually reviewed source-blocked count, and durable disposition of every item.';
