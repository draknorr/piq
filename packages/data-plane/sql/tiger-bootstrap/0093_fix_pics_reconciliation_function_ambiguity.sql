-- Repair PL/pgSQL output-variable/column ambiguity in the audited PICS
-- checkpoint helpers installed by 0092.
--
-- RETURNS TABLE output names are variables inside a PL/pgSQL function. The
-- original helpers used a few identical table-column names without aliases,
-- so PostgreSQL rejected the checkpoint before its first write. Preserve the
-- immutable 0092 source and repair only the exact installed function bodies.
--
-- This migration is fail-closed:
--   1. every source body must match its reviewed 0092 SHA-256;
--   2. every known ambiguous fragment must be present;
--   3. every replacement must remove the old fragment and add the qualified
--      fragment; and
--   4. CREATE OR REPLACE preserves function identity, ownership, and grants;
--      the function comments are refreshed to record this repair.

SET statement_timeout = '2min';
SET lock_timeout = '15s';

DO $repair$
DECLARE
  v_apply_source text;
  v_apply_repaired text;
  v_requeue_source text;
  v_requeue_repaired text;
  v_rollback_source text;
  v_rollback_repaired text;
BEGIN
  SELECT procedures.prosrc
  INTO STRICT v_apply_source
  FROM pg_proc procedures
  JOIN pg_namespace namespaces
    ON namespaces.oid = procedures.pronamespace
  WHERE namespaces.nspname = 'ops'
    AND procedures.oid =
      'ops.apply_pics_reconciliation_checkpoint(bigint,bigint,uuid,uuid,text,text)'::regprocedure;

  IF encode(digest(v_apply_source, 'sha256'), 'hex') <>
    'eb1393fdb0a02e5730dd408e1c0bd6f50fd5a13a0d146663db113c2b8d335969'
  THEN
    RAISE EXCEPTION
      'unexpected apply_pics_reconciliation_checkpoint source body; refusing repair';
  END IF;

  v_apply_repaired := replace(
    v_apply_source,
    $old$
  FROM ops.pics_cursor_checkpoints
  WHERE from_change_number = p_expected_cursor
    AND to_change_number = p_target_cursor
  FOR UPDATE;$old$,
    $new$
  FROM ops.pics_cursor_checkpoints checkpoints
  WHERE checkpoints.from_change_number = p_expected_cursor
    AND checkpoints.to_change_number = p_target_cursor
  FOR UPDATE;$new$
  );

  v_apply_repaired := replace(
    v_apply_repaired,
    $old$
    FROM ops.pics_reconciliation_runs
    WHERE checkpoint_id = v_checkpoint.id;$old$,
    $new$
    FROM ops.pics_reconciliation_runs runs
    WHERE runs.checkpoint_id = v_checkpoint.id;$new$
  );

  IF v_apply_repaired = v_apply_source
    OR position(
      $old$WHERE from_change_number = p_expected_cursor$old$
      IN v_apply_repaired
    ) > 0
    OR position(
      $old$WHERE checkpoint_id = v_checkpoint.id;$old$
      IN v_apply_repaired
    ) > 0
    OR position(
      $new$WHERE checkpoints.from_change_number = p_expected_cursor$new$
      IN v_apply_repaired
    ) = 0
    OR position(
      $new$WHERE runs.checkpoint_id = v_checkpoint.id;$new$
      IN v_apply_repaired
    ) = 0
  THEN
    RAISE EXCEPTION
      'apply_pics_reconciliation_checkpoint repair did not reconcile exactly';
  END IF;

  EXECUTE format(
    $ddl$
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
AS %L
$ddl$,
    v_apply_repaired
  );

  SELECT procedures.prosrc
  INTO STRICT v_apply_repaired
  FROM pg_proc procedures
  WHERE procedures.oid =
    'ops.apply_pics_reconciliation_checkpoint(bigint,bigint,uuid,uuid,text,text)'::regprocedure;

  IF encode(digest(v_apply_repaired, 'sha256'), 'hex') <>
    '9858f651739b591a9fd5d63ff8ba42ae6f6d0e3c523ff1c819fd346218ebd85d'
  THEN
    RAISE EXCEPTION
      'apply_pics_reconciliation_checkpoint repaired body hash mismatch';
  END IF;

  SELECT procedures.prosrc
  INTO STRICT v_requeue_source
  FROM pg_proc procedures
  JOIN pg_namespace namespaces
    ON namespaces.oid = procedures.pronamespace
  WHERE namespaces.nspname = 'ops'
    AND procedures.oid =
      'ops.requeue_pics_reconciliation_item(uuid,integer,text,text)'::regprocedure;

  IF encode(digest(v_requeue_source, 'sha256'), 'hex') <>
    'e7ef5dc4c4a7454d0ff6d257812025958d5d70ae17d4ec396372ac5d257c3a41'
  THEN
    RAISE EXCEPTION
      'unexpected requeue_pics_reconciliation_item source body; refusing repair';
  END IF;

  v_requeue_repaired := replace(
    v_requeue_source,
    $old$
  FROM ops.pics_reconciliation_items
  WHERE run_id = p_run_id
    AND appid = p_appid
  FOR UPDATE;$old$,
    $new$
  FROM ops.pics_reconciliation_items items
  WHERE items.run_id = p_run_id
    AND items.appid = p_appid
  FOR UPDATE;$new$
  );

  v_requeue_repaired := replace(
    v_requeue_repaired,
    $old$
  FROM ops.pics_work_state
  WHERE id = v_item.work_id
    AND reconciliation_run_id = p_run_id
    AND appid = p_appid
  FOR UPDATE;$old$,
    $new$
  FROM ops.pics_work_state work
  WHERE work.id = v_item.work_id
    AND work.reconciliation_run_id = p_run_id
    AND work.appid = p_appid
  FOR UPDATE;$new$
  );

  v_requeue_repaired := replace(
    v_requeue_repaired,
    $old$
  UPDATE ops.pics_reconciliation_items
  SET status = 'pending',$old$,
    $new$
  UPDATE ops.pics_reconciliation_items AS items
  SET status = 'pending',$new$
  );

  v_requeue_repaired := replace(
    v_requeue_repaired,
    $old$      requeue_count = requeue_count + 1,$old$,
    $new$      requeue_count = items.requeue_count + 1,$new$
  );

  v_requeue_repaired := replace(
    v_requeue_repaired,
    $old$  WHERE run_id = p_run_id
    AND appid = p_appid
  RETURNING * INTO v_item;$old$,
    $new$  WHERE items.run_id = p_run_id
    AND items.appid = p_appid
  RETURNING * INTO v_item;$new$
  );

  v_requeue_repaired := replace(
    v_requeue_repaired,
    $old$
  UPDATE ops.app_data_readiness
  SET status = 'pending',$old$,
    $new$
  UPDATE ops.app_data_readiness AS readiness
  SET status = 'pending',$new$
  );

  v_requeue_repaired := replace(
    v_requeue_repaired,
    $old$  WHERE appid = p_appid
    AND source = 'pics';$old$,
    $new$  WHERE readiness.appid = p_appid
    AND readiness.source = 'pics';$new$
  );

  IF v_requeue_repaired = v_requeue_source
    OR position($old$AND appid = p_appid$old$ IN v_requeue_repaired) > 0
    OR position(
      $old$requeue_count = requeue_count + 1$old$
      IN v_requeue_repaired
    ) > 0
    OR position($new$AND items.appid = p_appid$new$ IN v_requeue_repaired) = 0
    OR position($new$AND work.appid = p_appid$new$ IN v_requeue_repaired) = 0
    OR position(
      $new$requeue_count = items.requeue_count + 1$new$
      IN v_requeue_repaired
    ) = 0
    OR position(
      $new$WHERE readiness.appid = p_appid$new$
      IN v_requeue_repaired
    ) = 0
  THEN
    RAISE EXCEPTION
      'requeue_pics_reconciliation_item repair did not reconcile exactly';
  END IF;

  EXECUTE format(
    $ddl$
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
AS %L
$ddl$,
    v_requeue_repaired
  );

  SELECT procedures.prosrc
  INTO STRICT v_requeue_repaired
  FROM pg_proc procedures
  WHERE procedures.oid =
    'ops.requeue_pics_reconciliation_item(uuid,integer,text,text)'::regprocedure;

  IF encode(digest(v_requeue_repaired, 'sha256'), 'hex') <>
    'ab6ab462582368468e549493cffd4e84700fdd0d8115ca5121394a63e36073e9'
  THEN
    RAISE EXCEPTION
      'requeue_pics_reconciliation_item repaired body hash mismatch';
  END IF;

  SELECT procedures.prosrc
  INTO STRICT v_rollback_source
  FROM pg_proc procedures
  JOIN pg_namespace namespaces
    ON namespaces.oid = procedures.pronamespace
  WHERE namespaces.nspname = 'ops'
    AND procedures.oid =
      'ops.rollback_unstarted_pics_reconciliation_checkpoint(uuid,text)'::regprocedure;

  IF encode(digest(v_rollback_source, 'sha256'), 'hex') <>
    '2c33a13cc98fe22f4869e2f8cdab94c114310aafa1a931362ec50f2df08e2177'
  THEN
    RAISE EXCEPTION
      'unexpected rollback_unstarted_pics_reconciliation_checkpoint source body; refusing repair';
  END IF;

  v_rollback_repaired := replace(
    v_rollback_source,
    $old$
  FROM ops.pics_reconciliation_runs
  WHERE checkpoint_id = v_checkpoint.id
  FOR UPDATE;$old$,
    $new$
  FROM ops.pics_reconciliation_runs runs
  WHERE runs.checkpoint_id = v_checkpoint.id
  FOR UPDATE;$new$
  );

  v_rollback_repaired := replace(
    v_rollback_repaired,
    $old$
    FROM ops.pics_work_state
    WHERE reconciliation_run_id = v_run.id
      AND (
        state <> 'pending'
        OR attempts <> 0
        OR last_completed_at IS NOT NULL
      )
$old$,
    $new$
    FROM ops.pics_work_state work
    WHERE work.reconciliation_run_id = v_run.id
      AND (
        work.state <> 'pending'
        OR work.attempts <> 0
        OR work.last_completed_at IS NOT NULL
      )
$new$
  );

  v_rollback_repaired := replace(
    v_rollback_repaired,
    $old$  DELETE FROM ops.pics_work_state
  WHERE reconciliation_run_id = v_run.id;$old$,
    $new$  DELETE FROM ops.pics_work_state AS work
  WHERE work.reconciliation_run_id = v_run.id;$new$
  );

  IF v_rollback_repaired = v_rollback_source
    OR position(
      $old$WHERE checkpoint_id = v_checkpoint.id$old$
      IN v_rollback_repaired
    ) > 0
    OR position(
      $old$WHERE reconciliation_run_id = v_run.id$old$
      IN v_rollback_repaired
    ) > 0
    OR position(
      $new$WHERE runs.checkpoint_id = v_checkpoint.id$new$
      IN v_rollback_repaired
    ) = 0
    OR position(
      $new$WHERE work.reconciliation_run_id = v_run.id$new$
      IN v_rollback_repaired
    ) = 0
  THEN
    RAISE EXCEPTION
      'rollback_unstarted_pics_reconciliation_checkpoint repair did not reconcile exactly';
  END IF;

  EXECUTE format(
    $ddl$
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
AS %L
$ddl$,
    v_rollback_repaired
  );

  SELECT procedures.prosrc
  INTO STRICT v_rollback_repaired
  FROM pg_proc procedures
  WHERE procedures.oid =
    'ops.rollback_unstarted_pics_reconciliation_checkpoint(uuid,text)'::regprocedure;

  IF encode(digest(v_rollback_repaired, 'sha256'), 'hex') <>
    '6ad2c3f9e7b9dfdd90191fac35a2940040f9137aa03386208a515fee5c479ea1'
  THEN
    RAISE EXCEPTION
      'rollback_unstarted_pics_reconciliation_checkpoint repaired body hash mismatch';
  END IF;
END;
$repair$;

COMMENT ON FUNCTION ops.apply_pics_reconciliation_checkpoint(
  bigint,
  bigint,
  uuid,
  uuid,
  text,
  text
) IS
  'Atomically verifies forced-full gap evidence and a healthy shadow head, persists the complete legacy app manifest, enqueues isolated primary catch-up work with neutral watermarks, marks PICS readiness pending, and only then advances the canonical cursor. Column references are explicitly qualified by 0093.';

COMMENT ON FUNCTION ops.requeue_pics_reconciliation_item(
  uuid,
  integer,
  text,
  text
) IS
  'Manually requeues one reviewed source-blocked or dead-letter reconciliation item while preserving immutable run identity and recording operator intent. Column references are explicitly qualified by 0093.';

COMMENT ON FUNCTION ops.rollback_unstarted_pics_reconciliation_checkpoint(
  uuid,
  text
) IS
  'Restores the pre-checkpoint cursor, readiness, and empty primary work state only before durable intake or reconciliation processing has begun. Column references are explicitly qualified by 0093.';
