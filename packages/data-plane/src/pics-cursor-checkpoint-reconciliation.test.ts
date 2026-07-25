import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RECONCILIATION_SQL_URL = new URL(
  "../sql/tiger-bootstrap/0092_pics_cursor_checkpoint_reconciliation.sql",
  import.meta.url,
);
const REPAIR_SQL_URL = new URL(
  "../sql/tiger-bootstrap/0093_fix_pics_reconciliation_function_ambiguity.sql",
  import.meta.url,
);

function extractFunctionBody(sql: string, signature: string): string {
  const functionStart = sql.indexOf(signature);
  assert.ok(functionStart >= 0, `missing function signature: ${signature}`);
  const bodyStart = sql.indexOf("AS $$", functionStart);
  assert.ok(bodyStart >= 0, `missing function body: ${signature}`);
  const bodyEnd = sql.indexOf("$$;", bodyStart + 5);
  assert.ok(bodyEnd >= 0, `missing function body terminator: ${signature}`);
  return sql.slice(bodyStart + 5, bodyEnd);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function applyMigrationRepairs(
  sourceBody: string,
  repairSql: string,
  variablePrefix: "apply" | "requeue" | "rollback",
  expectedRepairCount: number,
): string {
  const assignment = `v_${variablePrefix}_repaired`;
  const input = `v_${variablePrefix}_(?:source|repaired)`;
  const replacementPattern = new RegExp(
    `${assignment} := replace\\(\\s*${input},\\s*\\$old\\$([\\s\\S]*?)\\$old\\$,\\s*\\$new\\$([\\s\\S]*?)\\$new\\$\\s*\\);`,
    "g",
  );
  const replacements = [...repairSql.matchAll(replacementPattern)];

  assert.equal(
    replacements.length,
    expectedRepairCount,
    `unexpected ${variablePrefix} repair count`,
  );

  return replacements.reduce((body, replacement) => {
    const oldFragment = replacement[1];
    const newFragment = replacement[2];
    assert.ok(
      body.includes(oldFragment),
      `missing ${variablePrefix} source fragment: ${oldFragment}`,
    );
    return body.replace(oldFragment, newFragment);
  }, sourceBody);
}

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

test("PICS reconciliation ambiguity repair is pinned to 0092 and explicitly qualifies collisions", async () => {
  const sourceSql = await readFile(RECONCILIATION_SQL_URL, "utf8");
  const repairSql = await readFile(REPAIR_SQL_URL, "utf8");

  const applyBody = extractFunctionBody(
    sourceSql,
    "CREATE OR REPLACE FUNCTION ops.apply_pics_reconciliation_checkpoint",
  );
  const requeueBody = extractFunctionBody(
    sourceSql,
    "CREATE OR REPLACE FUNCTION ops.requeue_pics_reconciliation_item",
  );
  const rollbackBody = extractFunctionBody(
    sourceSql,
    "CREATE OR REPLACE FUNCTION ops.rollback_unstarted_pics_reconciliation_checkpoint",
  );

  assert.equal(
    sha256(applyBody),
    "eb1393fdb0a02e5730dd408e1c0bd6f50fd5a13a0d146663db113c2b8d335969",
  );
  assert.equal(
    sha256(requeueBody),
    "e7ef5dc4c4a7454d0ff6d257812025958d5d70ae17d4ec396372ac5d257c3a41",
  );
  assert.equal(
    sha256(rollbackBody),
    "2c33a13cc98fe22f4869e2f8cdab94c114310aafa1a931362ec50f2df08e2177",
  );

  const repairedApply = applyMigrationRepairs(applyBody, repairSql, "apply", 2);
  const repairedRequeue = applyMigrationRepairs(
    requeueBody,
    repairSql,
    "requeue",
    7,
  );
  const repairedRollback = applyMigrationRepairs(
    rollbackBody,
    repairSql,
    "rollback",
    3,
  );

  assert.notEqual(repairedApply, applyBody);
  assert.notEqual(repairedRequeue, requeueBody);
  assert.notEqual(repairedRollback, rollbackBody);
  assert.equal(
    sha256(repairedApply),
    "9858f651739b591a9fd5d63ff8ba42ae6f6d0e3c523ff1c819fd346218ebd85d",
  );
  assert.equal(
    sha256(repairedRequeue),
    "ab6ab462582368468e549493cffd4e84700fdd0d8115ca5121394a63e36073e9",
  );
  assert.equal(
    sha256(repairedRollback),
    "6ad2c3f9e7b9dfdd90191fac35a2940040f9137aa03386208a515fee5c479ea1",
  );

  assert.doesNotMatch(
    repairedApply,
    /WHERE from_change_number = p_expected_cursor/,
  );
  assert.doesNotMatch(repairedApply, /WHERE checkpoint_id = v_checkpoint\.id/);
  assert.doesNotMatch(repairedRequeue, /AND appid = p_appid/);
  assert.doesNotMatch(repairedRequeue, /requeue_count = requeue_count \+ 1/);
  assert.doesNotMatch(
    repairedRollback,
    /WHERE checkpoint_id = v_checkpoint\.id/,
  );
  assert.doesNotMatch(
    repairedRollback,
    /WHERE reconciliation_run_id = v_run\.id/,
  );

  assert.match(
    repairSql,
    /unexpected apply_pics_reconciliation_checkpoint source body; refusing repair/,
  );
  assert.match(
    repairSql,
    /unexpected requeue_pics_reconciliation_item source body; refusing repair/,
  );
  assert.match(
    repairSql,
    /unexpected rollback_unstarted_pics_reconciliation_checkpoint source body; refusing repair/,
  );
  assert.match(
    repairSql,
    /CREATE OR REPLACE FUNCTION ops\.apply_pics_reconciliation_checkpoint\(/,
  );
  assert.match(
    repairSql,
    /CREATE OR REPLACE FUNCTION ops\.requeue_pics_reconciliation_item\(/,
  );
  assert.match(
    repairSql,
    /CREATE OR REPLACE FUNCTION ops\.rollback_unstarted_pics_reconciliation_checkpoint\(/,
  );
});
