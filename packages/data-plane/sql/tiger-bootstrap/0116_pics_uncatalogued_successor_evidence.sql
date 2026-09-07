-- Approved successor extension: preserve uncatalogued source positions outside
-- the known-catalog manifest. These are unresolved source-blocked audit records,
-- never successful app observations or synthetic catalog entries.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL work_mem = '16MB';

CREATE TABLE ops.pics_successor_source_blocks (
  run_id uuid NOT NULL REFERENCES ops.pics_reconciliation_successors(run_id),
  batch_id uuid NOT NULL,
  source_index integer NOT NULL,
  appid integer NOT NULL CHECK (appid > 0),
  source_change_number bigint NOT NULL CHECK (source_change_number >= 0),
  needs_token boolean NOT NULL,
  status text NOT NULL DEFAULT 'source_blocked' CHECK (status = 'source_blocked'),
  reason text NOT NULL DEFAULT 'uncatalogued_app' CHECK (reason = 'uncatalogued_app'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id,batch_id,source_index),
  FOREIGN KEY (batch_id,source_index) REFERENCES ops.pics_change_batch_apps(batch_id,source_index)
);
COMMENT ON TABLE ops.pics_successor_source_blocks IS
  'Unresolved source evidence outside the known-catalog recovery manifest. Exact duplicate positions and token bits retained, including superseded proposed heads. No automatic resolution or history recovery is asserted.';

CREATE FUNCTION ops.retain_pics_successor_source_blocks(p_run_id uuid,p_batch_id uuid)
RETURNS integer LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM 1 FROM ops.pics_reconciliation_successors successor
    JOIN ops.pics_reconciliation_runs run ON run.id=successor.run_id
    JOIN ops.pics_cursor_checkpoints checkpoint ON checkpoint.id=run.checkpoint_id
    WHERE successor.run_id=p_run_id AND successor.phase IN ('staging','sealed')
      AND checkpoint.status='preparing' AND checkpoint.head_evidence_batch_id=p_batch_id
    FOR UPDATE OF successor;
  IF NOT FOUND THEN RAISE EXCEPTION 'source blocks require the current unapplied successor head'; END IF;
  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM ops.pics_change_batch_apps child WHERE child.batch_id=p_batch_id
      AND NOT EXISTS(SELECT 1 FROM legacy.apps app WHERE app.appid=child.appid) LIMIT 1001
  ) bounded;
  IF v_count>1000 THEN RAISE EXCEPTION 'head exceeds the 1000-position source-block cap; choose a smaller fresh head'; END IF;
  INSERT INTO ops.pics_successor_source_blocks(run_id,batch_id,source_index,appid,source_change_number,needs_token)
    SELECT p_run_id,child.batch_id,child.source_index,child.appid,child.source_change_number,child.needs_token
    FROM ops.pics_change_batch_apps child WHERE child.batch_id=p_batch_id
      AND NOT EXISTS(SELECT 1 FROM legacy.apps app WHERE app.appid=child.appid)
    ORDER BY child.source_index LIMIT 1001
    ON CONFLICT (run_id,batch_id,source_index) DO NOTHING;
  IF (SELECT count(*) FROM ops.pics_successor_source_blocks WHERE run_id=p_run_id AND batch_id=p_batch_id)>1000 THEN
    RAISE EXCEPTION 'head exceeds the 1000-position source-block cap; choose a smaller fresh head'; END IF;
  IF EXISTS(SELECT 1 FROM ops.pics_successor_source_blocks block
    JOIN ops.pics_change_batch_apps child USING(batch_id,source_index)
    WHERE block.run_id=p_run_id AND block.batch_id=p_batch_id
      AND (block.appid,block.source_change_number,block.needs_token)
          IS DISTINCT FROM (child.appid,child.source_change_number,child.needs_token) LIMIT 1) THEN
    RAISE EXCEPTION 'retained source-block evidence differs from the archived head'; END IF;
  RETURN v_count;
END;
$$;
CREATE OR REPLACE FUNCTION ops.prepare_pics_successor_checkpoint(
  p_previous_run_id uuid, p_expected_cursor bigint, p_target_cursor bigint,
  p_gap_batch_id uuid, p_head_batch_id uuid, p_review jsonb,
  p_requested_by text, p_reason text, p_review_note text
) RETURNS uuid LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
DECLARE
  v_run_id uuid; v_checkpoint_id uuid; v_existing ops.pics_cursor_checkpoints%ROWTYPE;
  v_previous ops.pics_reconciliation_runs%ROWTYPE;
  v_gap ops.pics_change_batches%ROWTYPE; v_head ops.pics_change_batches%ROWTYPE;
  v_cutoff timestamptz := clock_timestamp(); v_max integer;
BEGIN
  IF p_expected_cursor IS NULL OR p_expected_cursor < 0
     OR p_target_cursor IS NULL OR p_target_cursor <= p_expected_cursor THEN
    RAISE EXCEPTION 'invalid successor cursor boundary';
  END IF;
  IF length(btrim(coalesce(p_requested_by,''))) NOT BETWEEN 1 AND 200
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000
     OR length(btrim(coalesce(p_review_note,''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'requester, reason and previous-run review note are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pics-intake:primary',0));
  IF (SELECT last_change_number FROM ops.pics_sync_state WHERE id=1 FOR UPDATE)
      IS DISTINCT FROM p_expected_cursor THEN
    RAISE EXCEPTION 'canonical cursor changed';
  END IF;
  SELECT * INTO v_existing FROM ops.pics_cursor_checkpoints checkpoint
    WHERE checkpoint.from_change_number=p_expected_cursor
      AND checkpoint.to_change_number=p_target_cursor;
  IF FOUND THEN
    SELECT run.id INTO v_run_id FROM ops.pics_reconciliation_runs run
      JOIN ops.pics_reconciliation_successors successor ON successor.run_id=run.id
      WHERE run.checkpoint_id=v_existing.id
        AND successor.previous_run_id=p_previous_run_id
        AND successor.previous_review=p_review AND successor.review_note=btrim(p_review_note)
        AND successor.phase IN ('staging','sealed');
    IF v_run_id IS NULL OR v_existing.gap_evidence_batch_id<>p_gap_batch_id
       OR v_existing.head_evidence_batch_id<>p_head_batch_id
       OR v_existing.requested_by<>btrim(p_requested_by) OR v_existing.reason<>btrim(p_reason) THEN
      RAISE EXCEPTION 'existing boundary differs from the requested successor';
    END IF;
    PERFORM ops.retain_pics_successor_source_blocks(v_run_id,p_head_batch_id);
    RETURN v_run_id;
  END IF;
  SELECT * INTO STRICT v_previous FROM ops.pics_reconciliation_runs
    WHERE id=p_previous_run_id FOR UPDATE;
  IF v_previous.status NOT IN ('active','completed')
     OR ops.pics_successor_review_state(p_previous_run_id) IS DISTINCT FROM p_review THEN
    RAISE EXCEPTION 'previous-run review is missing or stale';
  END IF;
  IF EXISTS (SELECT 1 FROM ops.pics_reconciliation_items
             WHERE run_id=p_previous_run_id AND status='pending' LIMIT 1)
     OR EXISTS (SELECT 1 FROM ops.pics_work_state
             WHERE stream_key='primary' AND state IN ('claimed','pending','retrying') LIMIT 1) THEN
    RAISE EXCEPTION 'dispose existing runnable work before preparing a successor';
  END IF;
  IF EXISTS (SELECT 1 FROM ops.pics_reconciliation_runs
             WHERE status='active' AND id<>p_previous_run_id LIMIT 1) THEN
    RAISE EXCEPTION 'another active reconciliation must be reviewed first';
  END IF;
  SELECT * INTO STRICT v_gap FROM ops.pics_change_batches WHERE id=p_gap_batch_id FOR SHARE;
  SELECT * INTO STRICT v_head FROM ops.pics_change_batches WHERE id=p_head_batch_id FOR SHARE;
  IF v_gap.from_change_number<>p_expected_cursor OR v_gap.response_since_change_number<>p_expected_cursor
     OR v_gap.status<>'source_blocked' OR v_gap.source_complete
     OR NOT (v_gap.force_full_update OR v_gap.force_full_app_update)
     OR v_gap.primary_cursor_advanced OR v_gap.archive_content_hash IS NULL THEN
    RAISE EXCEPTION 'gap batch does not prove an archived unavailable interval';
  END IF;
  IF v_head.work_mode<>'shadow' OR v_head.stream_key='primary'
     OR NOT v_head.source_complete OR v_head.status NOT IN ('committed','reconciled')
     OR v_head.to_change_number<>p_target_cursor OR v_head.primary_cursor_advanced
     OR v_head.source_app_count<>v_head.durable_app_count OR v_head.archive_content_hash IS NULL
     OR v_head.received_at<clock_timestamp()-interval '30 minutes'
     OR v_head.received_at>clock_timestamp()+interval '1 minute' THEN
    RAISE EXCEPTION 'head batch does not prove an archived complete shadow response';
  END IF;
  IF EXISTS(SELECT 1 FROM ops.pics_work_state work WHERE work.stream_key='primary'
    AND work.state<>'source_blocked' AND NOT EXISTS(SELECT 1 FROM legacy.apps app WHERE app.appid=work.appid) LIMIT 1) THEN
    RAISE EXCEPTION 'uncatalogued work needs explicit disposition before successor preparation'; END IF;
  SELECT max(appid) INTO v_max FROM legacy.apps WHERE appid>0;
  IF v_max IS NULL THEN RAISE EXCEPTION 'catalog is empty'; END IF;
  INSERT INTO ops.pics_cursor_checkpoints(
    from_change_number,to_change_number,gap_evidence_batch_id,head_evidence_batch_id,
    evidence_stream_key,reason,requested_by)
  VALUES(p_expected_cursor,p_target_cursor,p_gap_batch_id,p_head_batch_id,
    v_head.stream_key,btrim(p_reason),btrim(p_requested_by)) RETURNING id INTO v_checkpoint_id;
  INSERT INTO ops.pics_reconciliation_runs(checkpoint_id,coverage_cutoff)
    VALUES(v_checkpoint_id,v_cutoff) RETURNING id INTO v_run_id;
  INSERT INTO ops.pics_reconciliation_successors(
    run_id,previous_run_id,catalog_cutoff,catalog_max_appid,previous_review,review_note)
    VALUES(v_run_id,p_previous_run_id,v_cutoff,v_max,p_review,btrim(p_review_note));
  PERFORM ops.retain_pics_successor_source_blocks(v_run_id,p_head_batch_id);
  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION ops.retarget_pics_successor_head(
  p_run_id uuid,p_head_batch_id uuid,p_requested_by text,p_reason text
) RETURNS bigint LANGUAGE plpgsql SET lock_timeout='3s' AS $$
DECLARE v_stage ops.pics_reconciliation_successors%ROWTYPE;
  v_checkpoint ops.pics_cursor_checkpoints%ROWTYPE; v_head ops.pics_change_batches%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_requested_by,''))) NOT BETWEEN 1 AND 200
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'requester and retarget reason are required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pics-intake:primary',0));
  SELECT * INTO STRICT v_stage FROM ops.pics_reconciliation_successors WHERE run_id=p_run_id FOR UPDATE;
  SELECT checkpoint.* INTO STRICT v_checkpoint FROM ops.pics_cursor_checkpoints checkpoint
    JOIN ops.pics_reconciliation_runs run ON run.checkpoint_id=checkpoint.id WHERE run.id=p_run_id FOR UPDATE OF checkpoint;
  IF v_stage.phase NOT IN ('staging','sealed') OR v_checkpoint.status<>'preparing'
    OR (SELECT last_change_number FROM ops.pics_sync_state WHERE id=1 FOR UPDATE)
       IS DISTINCT FROM v_checkpoint.from_change_number THEN
    RAISE EXCEPTION 'only an unapplied staged successor can be retargeted'; END IF;
  SELECT * INTO STRICT v_head FROM ops.pics_change_batches WHERE id=p_head_batch_id FOR SHARE;
  IF v_head.work_mode<>'shadow' OR v_head.stream_key='primary' OR NOT v_head.source_complete
    OR v_head.primary_cursor_advanced OR v_head.status NOT IN ('committed','reconciled')
    OR v_head.archive_content_hash IS NULL OR v_head.to_change_number<v_checkpoint.to_change_number
    OR v_head.received_at<clock_timestamp()-interval '30 minutes'
    OR v_head.received_at>clock_timestamp()+interval '1 minute' THEN
    RAISE EXCEPTION 'replacement head is not a recent complete shadow boundary'; END IF;
  IF v_checkpoint.head_evidence_batch_id=p_head_batch_id THEN
    PERFORM ops.retain_pics_successor_source_blocks(p_run_id,p_head_batch_id);
    RETURN v_head.to_change_number; END IF;
  UPDATE ops.pics_reconciliation_successors SET operator_actions=operator_actions||jsonb_build_array(jsonb_build_object(
    'action','retarget_unapplied_head','previousHeadBatchId',v_checkpoint.head_evidence_batch_id,
    'previousTarget',v_checkpoint.to_change_number,'headBatchId',p_head_batch_id,'target',v_head.to_change_number,
    'requestedBy',btrim(p_requested_by),'reason',btrim(p_reason),'at',clock_timestamp())) WHERE run_id=p_run_id;
  UPDATE ops.pics_cursor_checkpoints SET head_evidence_batch_id=p_head_batch_id,
    to_change_number=v_head.to_change_number,evidence_stream_key=v_head.stream_key,updated_at=clock_timestamp()
    WHERE id=v_checkpoint.id;
  PERFORM ops.retain_pics_successor_source_blocks(p_run_id,p_head_batch_id);
  RETURN v_head.to_change_number;
END;
$$;

CREATE OR REPLACE FUNCTION ops.activate_pics_successor_checkpoint(
  p_run_id uuid, p_manifest_count bigint, p_manifest_sha256 text, p_archive_verification jsonb
) RETURNS jsonb LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
DECLARE v_stage ops.pics_reconciliation_successors%ROWTYPE;
  v_run ops.pics_reconciliation_runs%ROWTYPE; v_checkpoint ops.pics_cursor_checkpoints%ROWTYPE;
  v_batch ops.pics_change_batches%ROWTYPE; v_label text; v_report jsonb;
  v_count bigint; v_hash text;
BEGIN
  PERFORM ops.acquire_heavy_phase_gate(120);
  PERFORM pg_advisory_xact_lock(hashtextextended('pics-intake:primary',0));
  SELECT * INTO STRICT v_stage FROM ops.pics_reconciliation_successors WHERE run_id=p_run_id FOR UPDATE;
  SELECT * INTO STRICT v_run FROM ops.pics_reconciliation_runs WHERE id=p_run_id FOR UPDATE;
  SELECT * INTO STRICT v_checkpoint FROM ops.pics_cursor_checkpoints WHERE id=v_run.checkpoint_id FOR UPDATE;
  IF v_stage.phase='active' AND v_checkpoint.status='applied'
     AND v_run.item_manifest_count=p_manifest_count AND v_run.item_manifest_sha256=p_manifest_sha256
     AND v_stage.archive_verification=p_archive_verification THEN
    RETURN jsonb_build_object('runId',p_run_id,'alreadyApplied',true); END IF;
  IF v_stage.phase<>'sealed' OR v_checkpoint.status<>'preparing' OR v_run.status<>'active' THEN
    RAISE EXCEPTION 'successor is not sealed and awaiting activation'; END IF;
  IF (SELECT last_change_number FROM ops.pics_sync_state WHERE id=1 FOR UPDATE)
     IS DISTINCT FROM v_checkpoint.from_change_number THEN RAISE EXCEPTION 'canonical cursor changed'; END IF;
  PERFORM 1 FROM ops.pics_reconciliation_runs WHERE id=v_stage.previous_run_id FOR UPDATE;
  IF ops.pics_successor_review_state(v_stage.previous_run_id) IS DISTINCT FROM v_stage.previous_review THEN
    RAISE EXCEPTION 'previous-run review changed; review again before activation'; END IF;
  IF EXISTS (SELECT 1 FROM ops.pics_work_state WHERE stream_key='primary'
             AND state IN ('claimed','pending','retrying') LIMIT 1) THEN
    RAISE EXCEPTION 'primary work became runnable during staging'; END IF;
  LOCK TABLE legacy.apps IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM legacy.apps app WHERE app.appid>0 AND NOT EXISTS(
    SELECT 1 FROM ops.pics_reconciliation_items item WHERE item.run_id=p_run_id AND item.appid=app.appid) LIMIT 1) THEN
    RAISE EXCEPTION 'catalog changed after staging; restart staging scan and seal again'; END IF;
  SELECT count(*),encode(digest(coalesce(string_agg(source_index::text||':'||appid::text||E'\n',
    '' ORDER BY source_index),''),'sha256'),'hex') INTO v_count,v_hash
    FROM ops.pics_reconciliation_items WHERE run_id=p_run_id;
  IF v_count IS DISTINCT FROM p_manifest_count OR v_hash IS DISTINCT FROM p_manifest_sha256
     OR v_run.item_manifest_count<>v_count OR v_run.item_manifest_sha256<>v_hash THEN
    RAISE EXCEPTION 'reviewed manifest count/hash mismatch'; END IF;
  IF jsonb_typeof(p_archive_verification) IS DISTINCT FROM 'object'
     OR p_archive_verification->>'version' IS DISTINCT FROM 'pics-successor-evidence/v1'
     OR (p_archive_verification->>'verifiedAt')::timestamptz < clock_timestamp()-interval '15 minutes'
     OR (p_archive_verification->>'verifiedAt')::timestamptz > clock_timestamp()+interval '1 minute'
     OR p_archive_verification->>'verifiedAt' IS NULL THEN
    RAISE EXCEPTION 'fresh archive verification report is required'; END IF;
  FOREACH v_label IN ARRAY ARRAY['gap','head'] LOOP
    SELECT * INTO STRICT v_batch FROM ops.pics_change_batches WHERE id=CASE WHEN v_label='gap'
      THEN v_checkpoint.gap_evidence_batch_id ELSE v_checkpoint.head_evidence_batch_id END FOR SHARE;
    IF v_label='gap' AND (v_batch.from_change_number<>v_checkpoint.from_change_number
      OR v_batch.response_since_change_number<>v_checkpoint.from_change_number
      OR v_batch.source_complete OR v_batch.status<>'source_blocked'
      OR NOT(v_batch.force_full_update OR v_batch.force_full_app_update)
      OR v_batch.primary_cursor_advanced) THEN RAISE EXCEPTION 'gap evidence changed'; END IF;
    IF v_label='head' AND (v_batch.work_mode<>'shadow' OR v_batch.stream_key='primary'
      OR NOT v_batch.source_complete OR v_batch.status NOT IN ('committed','reconciled')
      OR v_batch.to_change_number<>v_checkpoint.to_change_number OR v_batch.primary_cursor_advanced) THEN
      RAISE EXCEPTION 'head evidence changed'; END IF;
    IF v_label='head' AND (v_batch.received_at<clock_timestamp()-interval '30 minutes'
      OR v_batch.received_at>clock_timestamp()+interval '1 minute') THEN
      RAISE EXCEPTION 'head evidence is no longer recent'; END IF;
    v_report:=p_archive_verification->v_label;
    IF v_report IS NULL OR v_report->>'batchId' IS DISTINCT FROM v_batch.id::text
       OR v_report->>'archiveHash' IS DISTINCT FROM v_batch.archive_content_hash
       OR v_report->>'manifestSha256' IS DISTINCT FROM v_batch.app_changes_sha256
       OR (v_report->>'count')::integer IS DISTINCT FROM v_batch.source_app_count
       OR v_report->'verified' IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_report->'count') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION '% archive verification does not match retained batch',v_label; END IF;
  END LOOP;
  -- Recheck exact source-block coverage after the complete R2 evidence report
  -- and while catalog writes are fenced. All primary work remains untouched.
  IF EXISTS(SELECT 1 FROM ops.pics_change_batch_apps child
    WHERE child.batch_id=v_checkpoint.head_evidence_batch_id
      AND NOT EXISTS(SELECT 1 FROM legacy.apps app WHERE app.appid=child.appid)
      AND NOT EXISTS(SELECT 1 FROM ops.pics_successor_source_blocks block
        WHERE block.run_id=p_run_id AND block.batch_id=child.batch_id
          AND block.source_index=child.source_index AND block.appid=child.appid
          AND block.source_change_number=child.source_change_number AND block.needs_token=child.needs_token)
    LIMIT 1) OR EXISTS(SELECT 1 FROM ops.pics_successor_source_blocks block
      JOIN ops.pics_change_batch_apps child USING(batch_id,source_index)
      WHERE block.run_id=p_run_id AND block.batch_id=v_checkpoint.head_evidence_batch_id
        AND (block.appid,block.source_change_number,block.needs_token)
            IS DISTINCT FROM (child.appid,child.source_change_number,child.needs_token) LIMIT 1) THEN
    RAISE EXCEPTION 'uncatalogued head source-block audit is missing or differs'; END IF;
  -- Record the unfinished old run honestly. Its three dead letters (or any
  -- reviewed terminal failures) stay dead letters in their original items.
  UPDATE ops.pics_reconciliation_runs SET status='cancelled',cancelled_at=clock_timestamp(),
    outcome=jsonb_build_object('status','superseded_after_review','successorRunId',p_run_id,
      'review',v_stage.previous_review,'reviewNote',v_stage.review_note,'requestedBy',v_checkpoint.requested_by),
    updated_at=clock_timestamp() WHERE id=v_stage.previous_run_id AND status='active';
  UPDATE ops.pics_cursor_checkpoints SET status='applied',applied_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=v_checkpoint.id;
  UPDATE ops.pics_sync_state SET last_change_number=v_checkpoint.to_change_number,updated_at=clock_timestamp()
    WHERE id=1 AND last_change_number=v_checkpoint.from_change_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'cursor changed during activation'; END IF;
  UPDATE ops.pics_reconciliation_successors SET phase='active',archive_verification=p_archive_verification,
    activated_at=clock_timestamp() WHERE run_id=p_run_id;
  RETURN jsonb_build_object('runId',p_run_id,'from',v_checkpoint.from_change_number,
    'to',v_checkpoint.to_change_number,'manifestCount',v_count,'manifestSha256',v_hash,
    'retainedSourceBlockedPositions',(SELECT count(*) FROM ops.pics_successor_source_blocks WHERE run_id=p_run_id));
END;
$$;
COMMIT;
