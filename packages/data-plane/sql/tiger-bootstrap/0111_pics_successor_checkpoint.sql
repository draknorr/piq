-- Local candidate only. Production application and checkpoint activation each
-- require separate approval, fresh backup evidence and the rollout runbook.
-- Preserve prior items/work/archive identities. Staging does not change the
-- canonical cursor, readiness, or primary work; activation records the gap and
-- durable manifest, then bounded enqueue calls restore current-state coverage.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL work_mem = '16MB';

CREATE TABLE ops.pics_reconciliation_successors (
  run_id uuid PRIMARY KEY REFERENCES ops.pics_reconciliation_runs(id),
  previous_run_id uuid NOT NULL REFERENCES ops.pics_reconciliation_runs(id),
  phase text NOT NULL DEFAULT 'staging' CHECK (phase IN ('staging','sealed','active','abandoned')),
  catalog_cutoff timestamptz NOT NULL,
  catalog_max_appid integer NOT NULL CHECK (catalog_max_appid > 0),
  last_staged_appid integer NOT NULL DEFAULT 0,
  previous_review jsonb NOT NULL CHECK (jsonb_typeof(previous_review) = 'object'),
  review_note text NOT NULL CHECK (length(btrim(review_note)) BETWEEN 1 AND 2000),
  archive_verification jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  catchup_paused boolean NOT NULL DEFAULT true,
  operator_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (previous_run_id, run_id)
);
CREATE UNIQUE INDEX idx_pics_one_preparing_successor
  ON ops.pics_reconciliation_successors ((true)) WHERE phase IN ('staging','sealed');
ALTER TABLE ops.pics_reconciliation_items ADD COLUMN baseline_work_state jsonb;
CREATE INDEX idx_pics_reconciliation_unlinked
  ON ops.pics_reconciliation_items (run_id, source_index) WHERE work_id IS NULL;

-- A complete review includes every dead-letter identity, not only its count.
CREATE FUNCTION ops.pics_successor_review_state(p_run_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'runId', run.id, 'status', run.status,
    'uncataloguedWork', (SELECT jsonb_build_object('count',count(*),
      'sha256',encode(digest(coalesce(string_agg(work.appid::text||':'||work.state||':'||
        coalesce(work.last_error_code,'')||':'||work.latest_change_number::text||E'\n',
        '' ORDER BY work.appid),''),'sha256'),'hex'))
      FROM ops.pics_work_state work WHERE work.stream_key='primary' AND NOT EXISTS(
        SELECT 1 FROM legacy.apps app WHERE app.appid=work.appid)),
    'manifestCount', run.item_manifest_count, 'manifestSha256', run.item_manifest_sha256,
    'counts', coalesce((SELECT jsonb_object_agg(grouped.status, grouped.n)
      FROM (SELECT item.status, count(*) AS n FROM ops.pics_reconciliation_items item
            WHERE item.run_id=run.id GROUP BY item.status) grouped), '{}'::jsonb),
    'deadLetters', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'appid', item.appid, 'workId', item.work_id, 'errorCode', item.last_error_code,
      'disposition', item.disposition) ORDER BY item.appid)
      FROM ops.pics_reconciliation_items item
      WHERE item.run_id=run.id AND item.status='dead_letter'), '[]'::jsonb)
  ) FROM ops.pics_reconciliation_runs run WHERE run.id=p_run_id;
$$;

CREATE FUNCTION ops.prepare_pics_successor_checkpoint(
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
  IF EXISTS(SELECT 1 FROM ops.pics_change_batch_apps child WHERE child.batch_id=p_head_batch_id
    AND NOT EXISTS(SELECT 1 FROM legacy.apps app WHERE app.appid=child.appid) LIMIT 1) THEN
    RAISE EXCEPTION 'head contains uncatalogued apps; resolve their source evidence before selecting this boundary'; END IF;
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
  RETURN v_run_id;
END;
$$;

CREATE FUNCTION ops.review_pics_successor_predecessor(
  p_run_id uuid,p_review jsonb,p_requested_by text,p_note text
) RETURNS void LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
DECLARE v_stage ops.pics_reconciliation_successors%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_requested_by,''))) NOT BETWEEN 1 AND 200
    OR length(btrim(coalesce(p_note,''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'reviewer and review note are required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pics-intake:primary',0));
  SELECT * INTO STRICT v_stage FROM ops.pics_reconciliation_successors WHERE run_id=p_run_id FOR UPDATE;
  IF v_stage.phase NOT IN ('staging','sealed') THEN RAISE EXCEPTION 'successor has already been applied or abandoned'; END IF;
  PERFORM 1 FROM ops.pics_reconciliation_runs WHERE id=v_stage.previous_run_id FOR UPDATE;
  IF ops.pics_successor_review_state(v_stage.previous_run_id) IS DISTINCT FROM p_review
    OR p_review->>'status' NOT IN ('active','completed') THEN
    RAISE EXCEPTION 'previous-run review is missing or stale'; END IF;
  IF EXISTS(SELECT 1 FROM ops.pics_reconciliation_items WHERE run_id=v_stage.previous_run_id AND status='pending' LIMIT 1)
    OR EXISTS(SELECT 1 FROM ops.pics_work_state WHERE stream_key='primary' AND state IN ('claimed','pending','retrying') LIMIT 1) THEN
    RAISE EXCEPTION 'previous runnable work must be disposed before review'; END IF;
  UPDATE ops.pics_reconciliation_successors SET previous_review=p_review,review_note=btrim(p_note),
    operator_actions=operator_actions||jsonb_build_array(jsonb_build_object(
      'action','review_predecessor','previousReview',previous_review,'review',p_review,
      'requestedBy',btrim(p_requested_by),'note',btrim(p_note),'at',clock_timestamp())) WHERE run_id=p_run_id;
END;
$$;

-- A long staging pause may outlive the healthy head. Reuse the retained
-- manifest with a newer reviewed head, while preserving the previous proposal
-- in the operator audit. This never advances the canonical cursor.
CREATE FUNCTION ops.retarget_pics_successor_head(
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
  IF EXISTS(SELECT 1 FROM ops.pics_change_batch_apps child WHERE child.batch_id=p_head_batch_id
    AND NOT EXISTS(SELECT 1 FROM legacy.apps app WHERE app.appid=child.appid) LIMIT 1) THEN
    RAISE EXCEPTION 'replacement head has uncatalogued source IDs requiring review'; END IF;
  IF v_checkpoint.head_evidence_batch_id=p_head_batch_id THEN RETURN v_head.to_change_number; END IF;
  UPDATE ops.pics_reconciliation_successors SET operator_actions=operator_actions||jsonb_build_array(jsonb_build_object(
    'action','retarget_unapplied_head','previousHeadBatchId',v_checkpoint.head_evidence_batch_id,
    'previousTarget',v_checkpoint.to_change_number,'headBatchId',p_head_batch_id,'target',v_head.to_change_number,
    'requestedBy',btrim(p_requested_by),'reason',btrim(p_reason),'at',clock_timestamp())) WHERE run_id=p_run_id;
  UPDATE ops.pics_cursor_checkpoints SET head_evidence_batch_id=p_head_batch_id,
    to_change_number=v_head.to_change_number,evidence_stream_key=v_head.stream_key,updated_at=clock_timestamp()
    WHERE id=v_checkpoint.id;
  RETURN v_head.to_change_number;
END;
$$;

CREATE FUNCTION ops.stage_pics_successor_manifest(
  p_run_id uuid, p_limit integer DEFAULT 500, p_restart_scan boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
DECLARE v_stage ops.pics_reconciliation_successors%ROWTYPE; v_next bigint;
  v_last integer; v_added integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'manifest chunk must be between 1 and 1000'; END IF;
  IF NOT pg_try_advisory_xact_lock_shared(1886417008,3) THEN
    RAISE EXCEPTION 'heavy database phase is active' USING ERRCODE='55P03'; END IF;
  SELECT * INTO STRICT v_stage FROM ops.pics_reconciliation_successors
    WHERE run_id=p_run_id FOR UPDATE;
  IF v_stage.phase<>'staging' AND NOT (v_stage.phase='sealed' AND p_restart_scan) THEN
    RAISE EXCEPTION 'successor is not staging'; END IF;
  IF p_restart_scan THEN
    v_stage.last_staged_appid:=0;
    v_stage.catalog_cutoff:=clock_timestamp();
    SELECT max(appid) INTO v_stage.catalog_max_appid FROM legacy.apps;
    UPDATE ops.pics_reconciliation_successors SET phase='staging',
      catalog_cutoff=v_stage.catalog_cutoff,catalog_max_appid=v_stage.catalog_max_appid WHERE run_id=p_run_id;
  END IF;
  SELECT coalesce(max(source_index)+1,0) INTO v_next
    FROM ops.pics_reconciliation_items WHERE run_id=p_run_id;
  WITH page AS MATERIALIZED (
    SELECT app.appid FROM legacy.apps app
    WHERE app.appid>v_stage.last_staged_appid AND app.appid<=v_stage.catalog_max_appid
      AND app.created_at<=v_stage.catalog_cutoff ORDER BY app.appid LIMIT p_limit
  ), fresh AS MATERIALIZED (
    SELECT page.appid FROM page WHERE NOT EXISTS (
      SELECT 1 FROM ops.pics_reconciliation_items item WHERE item.run_id=p_run_id AND item.appid=page.appid)
  ), inserted AS (
    INSERT INTO ops.pics_reconciliation_items(
      run_id,appid,source_index,baseline_last_pics_sync,baseline_pics_change_number,baseline_readiness)
    SELECT p_run_id,fresh.appid,v_next+row_number() OVER(ORDER BY fresh.appid)-1,
      sync.last_pics_sync,sync.pics_change_number,to_jsonb(readiness)
    FROM fresh LEFT JOIN ops.sync_status sync ON sync.appid=fresh.appid
    LEFT JOIN ops.app_data_readiness readiness ON readiness.appid=fresh.appid AND readiness.source='pics'
    RETURNING appid
  ) SELECT (SELECT max(appid) FROM page),(SELECT count(*) FROM inserted) INTO v_last,v_added;
  UPDATE ops.pics_reconciliation_successors
    SET last_staged_appid=coalesce(v_last,v_stage.last_staged_appid) WHERE run_id=p_run_id;
  RETURN jsonb_build_object('added',v_added,'lastAppid',v_last,'scanComplete',v_last IS NULL);
END;
$$;

CREATE FUNCTION ops.seal_pics_successor_manifest(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
DECLARE v_stage ops.pics_reconciliation_successors%ROWTYPE; v_count bigint; v_hash text;
BEGIN
  IF NOT pg_try_advisory_xact_lock_shared(1886417008,3) THEN
    RAISE EXCEPTION 'heavy database phase is active' USING ERRCODE='55P03'; END IF;
  SELECT * INTO STRICT v_stage FROM ops.pics_reconciliation_successors WHERE run_id=p_run_id FOR UPDATE;
  IF v_stage.phase NOT IN ('staging','sealed') THEN RAISE EXCEPTION 'successor cannot be sealed'; END IF;
  IF EXISTS (SELECT 1 FROM legacy.apps app WHERE app.appid>0
    AND app.appid<=v_stage.catalog_max_appid AND app.created_at<=v_stage.catalog_cutoff
    AND NOT EXISTS (SELECT 1 FROM ops.pics_reconciliation_items item
                    WHERE item.run_id=p_run_id AND item.appid=app.appid) LIMIT 1) THEN
    RAISE EXCEPTION 'manifest incomplete; finish or restart the bounded staging scan'; END IF;
  SELECT count(*),encode(digest(coalesce(string_agg(source_index::text||':'||appid::text||E'\n',
    '' ORDER BY source_index),''),'sha256'),'hex') INTO v_count,v_hash
    FROM ops.pics_reconciliation_items WHERE run_id=p_run_id;
  IF v_count=0 THEN RAISE EXCEPTION 'manifest cannot be empty'; END IF;
  UPDATE ops.pics_reconciliation_runs SET item_manifest_count=v_count,item_manifest_sha256=v_hash,
    updated_at=clock_timestamp() WHERE id=p_run_id;
  UPDATE ops.pics_cursor_checkpoints SET app_manifest_count=v_count,app_manifest_sha256=v_hash,
    updated_at=clock_timestamp() WHERE id=(SELECT checkpoint_id FROM ops.pics_reconciliation_runs WHERE id=p_run_id);
  UPDATE ops.pics_reconciliation_successors SET phase='sealed' WHERE run_id=p_run_id;
  RETURN jsonb_build_object('count',v_count,'sha256',v_hash);
END;
$$;

-- Activation arguments include the reviewed manifest and a fresh read-only
-- archive verification report. SQL cannot fetch R2; the companion verifier
-- validates both objects, source positions, flags, hashes and byte sizes.
CREATE FUNCTION ops.activate_pics_successor_checkpoint(
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
    'to',v_checkpoint.to_change_number,'manifestCount',v_count,'manifestSha256',v_hash);
END;
$$;

CREATE FUNCTION ops.enqueue_pics_successor_chunk(p_run_id uuid,p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
DECLARE v_stage ops.pics_reconciliation_successors%ROWTYPE;
  v_item record; v_work ops.pics_work_state%ROWTYPE; v_found boolean; v_count integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'enqueue chunk must be 1..500'; END IF;
  IF NOT pg_try_advisory_xact_lock_shared(1886417008,3) THEN
    RAISE EXCEPTION 'heavy database phase is active' USING ERRCODE='55P03'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pics-intake:primary',0));
  SELECT * INTO STRICT v_stage FROM ops.pics_reconciliation_successors WHERE run_id=p_run_id FOR UPDATE;
  IF v_stage.phase<>'active' OR NOT EXISTS(SELECT 1 FROM ops.pics_reconciliation_runs
    WHERE id=p_run_id AND status='active') THEN RAISE EXCEPTION 'successor is not active'; END IF;
  FOR v_item IN SELECT item.* FROM ops.pics_reconciliation_items item
    WHERE item.run_id=p_run_id AND item.work_id IS NULL
    ORDER BY item.source_index LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO v_work FROM ops.pics_work_state WHERE appid=v_item.appid AND stream_key='primary'
      FOR UPDATE SKIP LOCKED;
    v_found:=FOUND;
    IF NOT v_found AND EXISTS(SELECT 1 FROM ops.pics_work_state WHERE appid=v_item.appid AND stream_key='primary') THEN
      CONTINUE; END IF;
    IF v_found AND v_work.state='claimed' THEN CONTINUE; END IF;
    IF v_found AND v_work.reconciliation_run_id IS NOT NULL AND v_work.reconciliation_run_id<>p_run_id
      AND EXISTS(SELECT 1 FROM ops.pics_reconciliation_runs WHERE id=v_work.reconciliation_run_id AND status='active') THEN
      RAISE EXCEPTION 'work belongs to another active reconciliation'; END IF;
    UPDATE ops.pics_reconciliation_items SET
      baseline_work_state=CASE WHEN v_found THEN to_jsonb(v_work) ELSE NULL END,
      baseline_readiness=(SELECT to_jsonb(readiness) FROM ops.app_data_readiness readiness
                         WHERE readiness.appid=v_item.appid AND readiness.source='pics')
      WHERE run_id=p_run_id AND appid=v_item.appid;
    IF NOT v_found THEN
      INSERT INTO ops.pics_work_state(appid,stream_key,work_mode,lane,priority,state,
        first_change_number,latest_change_number,reconciliation_run_id,dirty_since,last_dirty_at)
      VALUES(v_item.appid,'primary','durable','catchup',100,'pending',0,0,p_run_id,clock_timestamp(),clock_timestamp())
      RETURNING * INTO v_work;
    ELSE
      UPDATE ops.pics_work_state SET reconciliation_run_id=p_run_id,
        lane=CASE WHEN state IN ('pending','retrying') THEN lane ELSE 'catchup' END,
        priority=CASE WHEN state IN ('pending','retrying') THEN priority ELSE 100 END,
        state='pending',attempts=CASE WHEN state IN ('pending','retrying') THEN attempts ELSE 0 END,
        next_attempt_at=CASE WHEN state IN ('pending','retrying') THEN next_attempt_at ELSE clock_timestamp() END,
        last_error_code=NULL,last_error_message=NULL,dead_lettered_at=NULL,updated_at=clock_timestamp()
        WHERE id=v_work.id;
      -- Keep source watermarks, token requirements, batch pointers, last
      -- completion timestamps and old audit links. Never assign the global
      -- checkpoint number to an unchanged app's payload watermark.
    END IF;
    UPDATE ops.pics_reconciliation_items SET work_id=v_work.id,updated_at=clock_timestamp()
      WHERE run_id=p_run_id AND appid=v_item.appid;
    INSERT INTO ops.app_data_readiness(appid,source,status,source_at,version,blocking_reason,retryable,provenance)
    VALUES(v_item.appid,'pics','pending',clock_timestamp(),'pics-readiness/v1',
      'awaiting_full_state_reconciliation',true,jsonb_build_object('reconciliationRunId',p_run_id))
    ON CONFLICT(appid,source) DO UPDATE SET status='pending',processed_at=NULL,
      source_at=EXCLUDED.source_at,version=EXCLUDED.version,blocking_reason=EXCLUDED.blocking_reason,
      retryable=true,provenance=EXCLUDED.provenance,updated_at=clock_timestamp();
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Automatic admission uses the same lock order as manual enqueue, yields to
-- intake instead of waiting, and never activates/unpauses a checkpoint. The
-- durable item.work_id is its restart-safe progress marker.
CREATE FUNCTION ops.feed_pics_successor_backlog(p_limit integer,p_max_open integer)
RETURNS jsonb LANGUAGE plpgsql SET lock_timeout='1s' SET work_mem='16MB' AS $$
DECLARE v_stage ops.pics_reconciliation_successors%ROWTYPE;
  v_open integer; v_count integer; v_result jsonb; v_unlinked boolean;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_max_open IS NULL OR p_max_open NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'automatic admission requires limit 1..100 and open window 1..200'; END IF;
  IF NOT pg_try_advisory_xact_lock_shared(1886417008,3) THEN
    RETURN jsonb_build_object('status','heavy_phase','enqueued',0); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('pics-intake:primary',0)) THEN
    RETURN jsonb_build_object('status','intake_busy','enqueued',0); END IF;
  SELECT successor.* INTO v_stage FROM ops.pics_reconciliation_successors successor
    JOIN ops.pics_reconciliation_runs run ON run.id=successor.run_id
    WHERE successor.phase='active' AND run.status='active'
    ORDER BY successor.activated_at,successor.run_id LIMIT 1
    FOR UPDATE OF successor SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','no_active_or_locked','enqueued',0); END IF;
  v_result:=jsonb_build_object('runId',v_stage.run_id,'enqueued',0);
  IF v_stage.catchup_paused THEN
    RETURN v_result||jsonb_build_object('status','paused'); END IF;
  IF EXISTS(SELECT 1 FROM ops.pics_work_state
      WHERE work_mode='durable' AND stream_key='primary' AND lane IN ('new','live')
        AND state IN ('pending','retrying') AND next_attempt_at<=clock_timestamp() LIMIT 1)
    OR EXISTS(SELECT 1 FROM ops.pics_work_state
      WHERE work_mode='durable' AND stream_key='primary' AND lane IN ('new','live')
        AND state='claimed' AND claim_expires_at<=clock_timestamp() LIMIT 1) THEN
    RETURN v_result||jsonb_build_object('status','live_waiting'); END IF;
  -- Separate partial-index paths keep this bounded even when most retained
  -- rows are completed or source-blocked. Delayed retries still occupy space.
  SELECT count(*)::integer INTO v_open FROM (
    (SELECT id FROM ops.pics_work_state WHERE work_mode='durable' AND stream_key='primary'
      AND lane='catchup' AND state IN ('pending','retrying') LIMIT p_max_open)
    UNION ALL
    (SELECT id FROM ops.pics_work_state WHERE work_mode='durable' AND stream_key='primary'
      AND lane='catchup' AND state='claimed' LIMIT p_max_open)
    LIMIT p_max_open
  ) open_work;
  IF v_open>=p_max_open THEN
    RETURN v_result||jsonb_build_object('status','open_window_full','openBefore',v_open); END IF;
  v_count:=ops.enqueue_pics_successor_chunk(v_stage.run_id,least(p_limit,p_max_open-v_open));
  SELECT EXISTS(SELECT 1 FROM ops.pics_reconciliation_items
    WHERE run_id=v_stage.run_id AND work_id IS NULL LIMIT 1) INTO v_unlinked;
  RETURN v_result||jsonb_build_object('status',CASE WHEN v_count>0 THEN 'enqueued'
    WHEN v_unlinked THEN 'members_busy' ELSE 'manifest_admitted' END,
    'enqueued',v_count,'openBefore',v_open,'hasUnlinked',v_unlinked);
END;
$$;

CREATE FUNCTION ops.set_pics_successor_catchup_paused(
  p_run_id uuid,p_paused boolean,p_requested_by text,p_reason text
) RETURNS void LANGUAGE plpgsql SET lock_timeout='3s' AS $$
BEGIN
  IF p_paused IS NULL OR length(btrim(coalesce(p_requested_by,''))) NOT BETWEEN 1 AND 200
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'explicit pause value, requester and reason are required'; END IF;
  UPDATE ops.pics_reconciliation_successors SET catchup_paused=p_paused,
    operator_actions=operator_actions||jsonb_build_array(jsonb_build_object(
      'action',CASE WHEN p_paused THEN 'pause_catchup' ELSE 'resume_catchup' END,
      'requestedBy',btrim(p_requested_by),'reason',btrim(p_reason),'at',clock_timestamp()))
    WHERE run_id=p_run_id AND phase='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'successor is not active'; END IF;
END;
$$;

CREATE FUNCTION ops.abandon_pics_successor_staging(
  p_run_id uuid,p_requested_by text,p_reason text
) RETURNS void LANGUAGE plpgsql SET lock_timeout='3s' AS $$
BEGIN
  IF length(btrim(coalesce(p_requested_by,''))) NOT BETWEEN 1 AND 200
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'requester and abandonment reason are required'; END IF;
  UPDATE ops.pics_reconciliation_successors SET phase='abandoned',
    operator_actions=operator_actions||jsonb_build_array(jsonb_build_object(
      'action','abandon_staging','requestedBy',btrim(p_requested_by),
      'reason',btrim(p_reason),'at',clock_timestamp()))
    WHERE run_id=p_run_id AND phase IN ('staging','sealed');
  IF NOT FOUND THEN RAISE EXCEPTION 'only an unapplied staged successor can be abandoned'; END IF;
  UPDATE ops.pics_reconciliation_runs SET status='cancelled',cancelled_at=clock_timestamp(),
    outcome=jsonb_build_object('status','abandoned_before_activation','requestedBy',btrim(p_requested_by),
      'reason',btrim(p_reason)),updated_at=clock_timestamp() WHERE id=p_run_id;
END;
$$;

-- The old rollback helper deletes primary work and is only valid for the
-- original empty-queue checkpoint. Fail its whole transaction for successors.
CREATE FUNCTION ops.guard_pics_successor_checkpoint_rollback() RETURNS trigger LANGUAGE plpgsql SET lock_timeout='3s' SET work_mem='16MB' AS $$
BEGIN
  IF NEW.status='rolled_back' AND EXISTS(
    SELECT 1 FROM ops.pics_reconciliation_runs run JOIN ops.pics_reconciliation_successors successor ON successor.run_id=run.id
    WHERE run.checkpoint_id=NEW.id) THEN
    RAISE EXCEPTION 'successors require forward recovery; legacy destructive rollback is prohibited'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pics_successor_no_legacy_rollback BEFORE UPDATE OF status ON ops.pics_cursor_checkpoints
  FOR EACH ROW EXECUTE FUNCTION ops.guard_pics_successor_checkpoint_rollback();

COMMENT ON TABLE ops.pics_reconciliation_successors IS
  'Resumable current-state recovery for populated PICS queues. Prior dispositions and all archives remain retained; successor activation never asserts recovery of unobserved historical versions.';
COMMIT;
