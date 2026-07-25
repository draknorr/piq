-- Replay-safe, bounded finalization for durable Steam catalog observations.
-- This file is intentionally not applied by scheduled workflows. Apply it only
-- during a separately approved Tiger write window after backup/PITR evidence
-- and a fresh read-only preflight.

ALTER TABLE ops.catalog_scan_runs
  ADD COLUMN IF NOT EXISTS finalization_phase text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS finalization_state_cursor_appid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalization_readiness_cursor_appid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalization_state_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalization_readiness_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalization_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS finalization_heartbeat_at timestamp with time zone;

ALTER TABLE ops.catalog_scan_runs
  DROP CONSTRAINT IF EXISTS catalog_scan_runs_status_check,
  DROP CONSTRAINT IF EXISTS catalog_scan_runs_finalization_phase_check,
  DROP CONSTRAINT IF EXISTS catalog_scan_runs_finalization_counts_check;

ALTER TABLE ops.catalog_scan_runs
  ADD CONSTRAINT catalog_scan_runs_status_check CHECK (
    status = ANY (
      ARRAY['running'::text, 'finalizing'::text, 'completed'::text, 'failed'::text]
    )
  ),
  ADD CONSTRAINT catalog_scan_runs_finalization_phase_check CHECK (
    finalization_phase = ANY (
      ARRAY[
        'not_started'::text,
        'catalog_state'::text,
        'catalog_readiness'::text,
        'ready_to_complete'::text,
        'completed'::text
      ]
    )
  ),
  ADD CONSTRAINT catalog_scan_runs_finalization_counts_check CHECK (
    finalization_state_cursor_appid >= 0
    AND finalization_readiness_cursor_appid >= 0
    AND finalization_state_rows >= 0
    AND finalization_readiness_rows >= 0
  );

DROP INDEX IF EXISTS ops.idx_ops_catalog_scan_runs_running;
DROP INDEX IF EXISTS ops.idx_ops_catalog_scan_runs_one_running_per_source;

CREATE INDEX idx_ops_catalog_scan_runs_running
  ON ops.catalog_scan_runs (started_at ASC)
  WHERE status IN ('running', 'finalizing');

CREATE UNIQUE INDEX idx_ops_catalog_scan_runs_one_running_per_source
  ON ops.catalog_scan_runs (source)
  WHERE status IN ('running', 'finalizing');

CREATE INDEX IF NOT EXISTS idx_ops_app_catalog_state_last_observed_scan
  ON ops.app_catalog_state (last_observed_scan_id, appid);

CREATE INDEX IF NOT EXISTS idx_ops_app_catalog_state_last_full_observed_scan
  ON ops.app_catalog_state (last_full_observed_scan_id, appid)
  WHERE last_full_observed_scan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_app_catalog_state_last_successful_scan
  ON ops.app_catalog_state (last_successful_scan_id, appid)
  WHERE last_successful_scan_id IS NOT NULL;

-- Catalog readiness is now materialized explicitly in bounded sets. Keeping the
-- old row trigger would run one nested readiness query per app and recreate the
-- statement-timeout failure that this migration removes.
DROP TRIGGER IF EXISTS capture_catalog_readiness_v1 ON ops.app_catalog_state;

CREATE OR REPLACE FUNCTION ops.refresh_overall_readiness_after_source_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(
    current_setting('publisheriq.skip_readiness_cascade', true),
    'off'
  ) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.source = ANY (ARRAY['catalog'::text, 'storefront'::text, 'pics'::text]) THEN
    PERFORM ops.refresh_overall_readiness_v1(ARRAY[NEW.appid]);
  END IF;
  RETURN NEW;
END;
$$;

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
  v_started_at timestamp with time zone := coalesce(
    p_source_started_at,
    clock_timestamp()
  );
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

  SELECT scan.*
  INTO v_existing
  FROM ops.catalog_scan_runs scan
  WHERE scan.run_key = p_run_key
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
      UPDATE ops.catalog_scan_runs scan
      SET status = 'running',
          completed_at = NULL,
          error_message = NULL,
          finalization_phase = 'not_started',
          finalization_state_cursor_appid = 0,
          finalization_readiness_cursor_appid = 0,
          finalization_state_rows = 0,
          finalization_readiness_rows = 0,
          finalization_started_at = NULL,
          finalization_heartbeat_at = NULL,
          input_hash = NULL,
          reconciliation_outcome = NULL,
          updated_at = clock_timestamp()
      WHERE scan.id = v_existing.id
      RETURNING scan.* INTO v_existing;
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

  SELECT scan.*
  INTO v_existing
  FROM ops.catalog_scan_runs scan
  WHERE scan.source = p_source
    AND scan.status IN ('running', 'finalizing')
  ORDER BY scan.started_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.mode <> p_mode THEN
      RAISE EXCEPTION
        'catalog source % already has an active % scan under run key %',
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
    SELECT scan.committed_through
    INTO v_previous_cursor
    FROM ops.catalog_scan_runs scan
    WHERE scan.source = p_source
      AND scan.status = 'completed'
      AND scan.committed_through IS NOT NULL
    ORDER BY scan.completed_at DESC NULLS LAST, scan.created_at DESC
    LIMIT 1;
  END IF;

  v_scan_kind := CASE
    WHEN p_force_full OR v_previous_cursor IS NULL THEN 'full'
    ELSE 'incremental'
  END;
  v_requested_cursor := CASE
    WHEN v_scan_kind = 'full' THEN NULL
    ELSE greatest(
      v_previous_cursor - greatest(coalesce(p_overlap_seconds, 300), 0),
      0
    )
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

CREATE OR REPLACE FUNCTION ops.begin_catalog_scan_finalization(
  p_scan_id uuid,
  p_expected_batches integer,
  p_expected_source_rows integer,
  p_input_hash text,
  p_reconciliation_outcome jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run ops.catalog_scan_runs%ROWTYPE;
BEGIN
  IF p_expected_batches IS NULL
    OR p_expected_source_rows IS NULL
    OR p_expected_batches < 0
    OR p_expected_source_rows < 0
  THEN
    RAISE EXCEPTION 'catalog scan finalization counts must be nonnegative';
  END IF;
  IF nullif(btrim(p_input_hash), '') IS NULL
    OR p_input_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'catalog scan finalization requires a SHA-256 input hash';
  END IF;
  IF p_reconciliation_outcome IS NOT NULL
    AND jsonb_typeof(p_reconciliation_outcome) <> 'object'
  THEN
    RAISE EXCEPTION 'catalog scan reconciliation outcome must be a JSON object';
  END IF;

  SELECT scan.*
  INTO v_run
  FROM ops.catalog_scan_runs scan
  WHERE scan.id = p_scan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog scan % does not exist', p_scan_id;
  END IF;

  IF v_run.status IN ('finalizing', 'completed') THEN
    IF v_run.input_hash IS DISTINCT FROM p_input_hash
      OR v_run.source_rows_committed <> p_expected_source_rows
      OR v_run.last_committed_batch <> p_expected_batches - 1
    THEN
      RAISE EXCEPTION 'catalog scan % finalization replay does not match', p_scan_id;
    END IF;

    RETURN jsonb_build_object(
      'status', v_run.status,
      'phase', v_run.finalization_phase,
      'done', v_run.status = 'completed',
      'processed_rows', 0,
      'state_rows', v_run.finalization_state_rows,
      'readiness_rows', v_run.finalization_readiness_rows
    );
  END IF;

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION
      'catalog scan % cannot begin finalization (status=%)',
      p_scan_id,
      v_run.status;
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

  UPDATE ops.catalog_scan_runs scan
  SET status = 'finalizing',
      finalization_phase = 'catalog_state',
      finalization_state_cursor_appid = 0,
      finalization_readiness_cursor_appid = 0,
      finalization_state_rows = 0,
      finalization_readiness_rows = 0,
      finalization_started_at = clock_timestamp(),
      finalization_heartbeat_at = clock_timestamp(),
      input_hash = p_input_hash,
      reconciliation_outcome = p_reconciliation_outcome,
      completed_at = NULL,
      error_message = NULL,
      updated_at = clock_timestamp()
  WHERE scan.id = v_run.id
  RETURNING scan.* INTO v_run;

  RETURN jsonb_build_object(
    'status', v_run.status,
    'phase', v_run.finalization_phase,
    'done', false,
    'processed_rows', 0,
    'state_rows', v_run.finalization_state_rows,
    'readiness_rows', v_run.finalization_readiness_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION ops.advance_catalog_scan_finalization(
  p_scan_id uuid,
  p_batch_size integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run ops.catalog_scan_runs%ROWTYPE;
  v_affected integer := 0;
  v_readiness_upserts integer := 0;
  v_last_appid integer;
  v_appids integer[];
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION
      'catalog scan finalization batch size must be between 1 and 5000';
  END IF;

  SELECT scan.*
  INTO v_run
  FROM ops.catalog_scan_runs scan
  WHERE scan.id = p_scan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog scan % does not exist', p_scan_id;
  END IF;

  IF v_run.status = 'completed' THEN
    RETURN jsonb_build_object(
      'status', v_run.status,
      'phase', v_run.finalization_phase,
      'done', true,
      'processed_rows', 0,
      'state_rows', v_run.finalization_state_rows,
      'readiness_rows', v_run.finalization_readiness_rows
    );
  END IF;
  IF v_run.status <> 'finalizing' THEN
    RAISE EXCEPTION
      'catalog scan % is not finalizing (status=%)',
      p_scan_id,
      v_run.status;
  END IF;

  IF v_run.finalization_phase = 'catalog_state' THEN
    WITH candidate_ids AS MATERIALIZED (
      (
        SELECT state.appid
        FROM ops.app_catalog_state state
        WHERE state.last_observed_scan_id = v_run.id
          AND state.appid > v_run.finalization_state_cursor_appid
        ORDER BY state.appid
        LIMIT p_batch_size
      )
      UNION ALL
      (
        SELECT state.appid
        FROM ops.app_catalog_state state
        WHERE state.last_full_observed_scan_id = v_run.id
          AND state.appid > v_run.finalization_state_cursor_appid
        ORDER BY state.appid
        LIMIT p_batch_size
      )
    ),
    bounded AS MATERIALIZED (
      SELECT DISTINCT candidate.appid
      FROM candidate_ids candidate
      ORDER BY candidate.appid
      LIMIT p_batch_size
    ),
    updated AS (
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
      FROM bounded
      WHERE state.appid = bounded.appid
      RETURNING state.appid
    )
    SELECT
      count(*)::integer,
      max(updated.appid),
      coalesce(array_agg(updated.appid ORDER BY updated.appid), ARRAY[]::integer[])
    INTO v_affected, v_last_appid, v_appids
    FROM updated;

    IF v_affected = 0 THEN
      UPDATE ops.catalog_scan_runs scan
      SET finalization_phase = CASE
            WHEN scan.mode = 'primary' THEN 'catalog_readiness'
            ELSE 'ready_to_complete'
          END,
          finalization_heartbeat_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE scan.id = v_run.id
      RETURNING scan.* INTO v_run;
    ELSE
      UPDATE ops.catalog_scan_runs scan
      SET finalization_state_cursor_appid = v_last_appid,
          finalization_state_rows = scan.finalization_state_rows + v_affected,
          finalization_heartbeat_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE scan.id = v_run.id
      RETURNING scan.* INTO v_run;
    END IF;

    RETURN jsonb_build_object(
      'status', v_run.status,
      'phase', v_run.finalization_phase,
      'done', false,
      'processed_rows', v_affected,
      'state_rows', v_run.finalization_state_rows,
      'readiness_rows', v_run.finalization_readiness_rows
    );
  END IF;

  IF v_run.finalization_phase = 'catalog_readiness' THEN
    PERFORM set_config('publisheriq.skip_readiness_cascade', 'on', true);

    WITH candidates AS MATERIALIZED (
      SELECT
        state.appid,
        state.last_observed_at,
        state.last_full_reconciled_at
      FROM ops.app_catalog_state state
      WHERE state.last_successful_scan_id = v_run.id
        AND state.appid > v_run.finalization_readiness_cursor_appid
      ORDER BY state.appid
      LIMIT p_batch_size
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
        candidate.appid,
        'catalog',
        'ready',
        candidate.last_observed_at,
        clock_timestamp(),
        'catalog-readiness/v2',
        NULL,
        true,
        jsonb_build_object(
          'catalog_scan_run_id', v_run.id,
          'catalog_source', v_run.source,
          'catalog_scan_kind', v_run.scan_kind,
          'catalog_observation_mode', v_run.mode,
          'catalog_finalization', 'bounded/v1',
          'last_full_reconciled_at', candidate.last_full_reconciled_at
        ),
        clock_timestamp(),
        clock_timestamp()
      FROM candidates candidate
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
         OR EXCLUDED.source_at >= ops.app_data_readiness.source_at
      RETURNING appid
    )
    SELECT
      count(*)::integer,
      max(candidate.appid),
      coalesce(
        array_agg(candidate.appid ORDER BY candidate.appid),
        ARRAY[]::integer[]
      ),
      (SELECT count(*)::integer FROM upserted)
    INTO v_affected, v_last_appid, v_appids, v_readiness_upserts
    FROM candidates candidate;

    PERFORM set_config('publisheriq.skip_readiness_cascade', 'off', true);

    IF v_affected = 0 THEN
      UPDATE ops.catalog_scan_runs scan
      SET finalization_phase = 'ready_to_complete',
          finalization_heartbeat_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE scan.id = v_run.id
      RETURNING scan.* INTO v_run;
    ELSE
      PERFORM ops.refresh_overall_readiness_v1(v_appids);

      UPDATE ops.catalog_scan_runs scan
      SET finalization_readiness_cursor_appid = v_last_appid,
          finalization_readiness_rows =
            scan.finalization_readiness_rows + v_affected,
          finalization_heartbeat_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE scan.id = v_run.id
      RETURNING scan.* INTO v_run;
    END IF;

    RETURN jsonb_build_object(
      'status', v_run.status,
      'phase', v_run.finalization_phase,
      'done', false,
      'processed_rows', v_affected,
      'readiness_upserts', v_readiness_upserts,
      'state_rows', v_run.finalization_state_rows,
      'readiness_rows', v_run.finalization_readiness_rows
    );
  END IF;

  IF v_run.finalization_phase <> 'ready_to_complete' THEN
    RAISE EXCEPTION
      'catalog scan % has invalid finalization phase %',
      p_scan_id,
      v_run.finalization_phase;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ops.app_catalog_state state
    WHERE (
        state.last_observed_scan_id = v_run.id
        OR state.last_full_observed_scan_id = v_run.id
      )
      AND state.appid > v_run.finalization_state_cursor_appid
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'catalog scan % still has unfinalized catalog-state rows',
      p_scan_id;
  END IF;

  IF v_run.mode = 'primary'
    AND EXISTS (
      SELECT 1
      FROM ops.app_catalog_state state
      WHERE state.last_successful_scan_id = v_run.id
        AND state.appid > v_run.finalization_readiness_cursor_appid
      LIMIT 1
    )
  THEN
    RAISE EXCEPTION
      'catalog scan % still has unfinalized readiness rows',
      p_scan_id;
  END IF;

  UPDATE ops.catalog_scan_runs scan
  SET status = 'completed',
      finalization_phase = 'completed',
      finalization_heartbeat_at = clock_timestamp(),
      completed_at = clock_timestamp(),
      error_message = NULL,
      updated_at = clock_timestamp()
  WHERE scan.id = v_run.id
  RETURNING scan.* INTO v_run;

  RETURN jsonb_build_object(
    'status', v_run.status,
    'phase', v_run.finalization_phase,
    'done', true,
    'processed_rows', 0,
    'state_rows', v_run.finalization_state_rows,
    'readiness_rows', v_run.finalization_readiness_rows
  );
END;
$$;

-- Fail closed for callers that have not been upgraded to the bounded protocol.
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
BEGIN
  RAISE EXCEPTION
    'ops.complete_catalog_scan is disabled; use bounded catalog finalization';
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
  SET status = CASE
        WHEN status = 'running' THEN 'failed'
        ELSE status
      END,
      error_message = left(
        coalesce(p_error_message, 'catalog_scan_failed'),
        4000
      ),
      completed_at = CASE
        WHEN status = 'running' THEN clock_timestamp()
        ELSE completed_at
      END,
      finalization_heartbeat_at = CASE
        WHEN status = 'finalizing' THEN clock_timestamp()
        ELSE finalization_heartbeat_at
      END,
      updated_at = clock_timestamp()
  WHERE id = p_scan_id
    AND status IN ('running', 'finalizing');
$$;
