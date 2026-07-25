import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RECONCILIATION_SQL_URL = new URL(
  "../sql/tiger-bootstrap/0092_pics_cursor_checkpoint_reconciliation.sql",
  import.meta.url,
);

test("PICS cursor checkpoint requires forced-full gap and complete shadow-head evidence", async () => {
  const sql = await readFile(RECONCILIATION_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION ops\.apply_pics_reconciliation_checkpoint\(/,
  );
  assert.match(
    sql,
    /v_gap\.status <> 'source_blocked'[\s\S]*v_gap\.force_full_update OR v_gap\.force_full_app_update/,
  );
  assert.match(
    sql,
    /v_head\.to_change_number <> p_target_cursor[\s\S]*NOT v_head\.source_complete/,
  );
  assert.match(sql, /v_head\.source_app_count <> v_head\.durable_app_count/);
  assert.doesNotMatch(sql, /\bsupabase\b/i);
});

test("PICS checkpoint persists and verifies the full app manifest before advancing the cursor", async () => {
  const sql = await readFile(RECONCILIATION_SQL_URL, "utf8");
  const stageIndex = sql.indexOf(
    "CREATE TEMP TABLE pics_reconciliation_manifest_stage",
  );
  const itemInsertIndex = sql.indexOf(
    "INSERT INTO ops.pics_reconciliation_items",
  );
  const hashMismatchIndex = sql.indexOf(
    "durable PICS reconciliation item hash mismatch",
  );
  const workInsertIndex = sql.indexOf("INSERT INTO ops.pics_work_state");
  const cursorUpdateIndex = sql.indexOf("UPDATE ops.pics_sync_state");

  assert.ok(stageIndex >= 0);
  assert.ok(stageIndex < itemInsertIndex);
  assert.ok(itemInsertIndex < hashMismatchIndex);
  assert.ok(hashMismatchIndex < workInsertIndex);
  assert.ok(workInsertIndex < cursorUpdateIndex);
  assert.match(sql, /source_index::text \|\| ':' \|\| appid::text \|\| E'\\n'/);
  assert.match(
    sql,
    /IF v_work_rows <> v_manifest_count THEN[\s\S]*RAISE EXCEPTION/,
  );
});

test("Full-state work uses a neutral watermark and remains lower priority than live work", async () => {
  const sql = await readFile(RECONCILIATION_SQL_URL, "utf8");

  assert.match(
    sql,
    /'primary',\s+'durable',\s+'catchup',\s+100,\s+'pending',\s+NULL,\s+NULL,\s+v_run\.id,\s+0,\s+0/s,
  );
  assert.match(
    sql,
    /pics_work_state_source_provenance_check[\s\S]*reconciliation_run_id IS NOT NULL/,
  );
});

test("Checkpoint rollback fails closed after primary intake or processing starts", async () => {
  const sql = await readFile(RECONCILIATION_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION ops\.rollback_unstarted_pics_reconciliation_checkpoint\(/,
  );
  assert.match(
    sql,
    /cannot roll back after durable primary intake has started/,
  );
  assert.match(
    sql,
    /cannot roll back after reconciliation processing has started/,
  );
  assert.match(sql, /last_change_number = v_checkpoint\.from_change_number/);
});

test("Long reconciliations can append newly discovered apps without moving the cursor", async () => {
  const sql = await readFile(RECONCILIATION_SQL_URL, "utf8");
  const extensionStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION ops.extend_pics_reconciliation_run",
  );
  const rollbackStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION ops.rollback_unstarted_pics_reconciliation_checkpoint",
  );
  const extensionSql = sql.slice(extensionStart, rollbackStart);

  assert.ok(extensionStart >= 0);
  assert.ok(rollbackStart > extensionStart);
  assert.match(
    extensionSql,
    /NOT EXISTS \([\s\S]*FROM ops\.pics_reconciliation_items existing/,
  );
  assert.match(
    extensionSql,
    /sync\.last_pics_sync >= v_run\.started_at[\s\S]*snapshot\.observed_at >= v_run\.started_at[\s\S]*readiness\.provenance->>'streamKey' = 'primary'/,
  );
  assert.doesNotMatch(extensionSql, /UPDATE ops\.pics_sync_state/);
});

test("Reviewed terminal items can be requeued without losing audit identity", async () => {
  const sql = await readFile(RECONCILIATION_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION ops\.requeue_pics_reconciliation_item\(/,
  );
  assert.match(
    sql,
    /v_item\.status NOT IN \('source_blocked', 'dead_letter'\)/,
  );
  assert.match(sql, /requeue_count = requeue_count \+ 1/);
  assert.match(sql, /last_requeued_by = btrim\(p_requested_by\)/);
  assert.match(sql, /last_requeue_reason = btrim\(p_reason\)/);
  assert.match(sql, /blocking_reason = 'awaiting_reconciliation_retry'/);
});

test("Reconciliation finalization requires exact parity and zero unresolved or dead-letter work", async () => {
  const sql = await readFile(RECONCILIATION_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION ops\.finalize_pics_reconciliation_run\(/,
  );
  assert.match(sql, /PICS reconciliation durable manifest mismatch/);
  assert.match(sql, /PICS reconciliation still has % pending items/);
  assert.match(sql, /PICS reconciliation has % dead-letter items/);
  assert.match(sql, /source-blocked count is %, expected reviewed count %/);
  assert.match(sql, /PICS reconciliation completed_by is required/);
  assert.match(sql, /PICS reconciliation completion note is required/);
  assert.match(
    sql,
    /state IN \('pending', 'claimed', 'retrying', 'dead_letter'\)/,
  );
  assert.match(sql, /LOCK TABLE legacy\.apps IN SHARE MODE/);
  assert.match(sql, /newly discovered apps; extend the run before finalizing/);
});
