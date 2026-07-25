import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FINALIZATION_SQL_URL = new URL(
  '../sql/tiger-bootstrap/0094_catalog_bounded_finalization.sql',
  import.meta.url
);

test('catalog finalization has a durable resumable state machine', async () => {
  const sql = await readFile(FINALIZATION_SQL_URL, 'utf8');

  assert.match(
    sql,
    /status = ANY \([\s\S]*'running'::text,[\s\S]*'finalizing'::text,[\s\S]*'completed'::text,[\s\S]*'failed'::text/
  );
  assert.match(sql, /finalization_state_cursor_appid integer/);
  assert.match(sql, /finalization_readiness_cursor_appid integer/);
  assert.match(sql, /finalization_state_rows integer/);
  assert.match(sql, /finalization_readiness_rows integer/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX idx_ops_catalog_scan_runs_one_running_per_source[\s\S]*WHERE status IN \('running', 'finalizing'\)/
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION ops\.begin_catalog_scan_finalization\(/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION ops\.advance_catalog_scan_finalization\(/);
  assert.doesNotMatch(sql, /\bsupabase\b/i);
});

test('each catalog finalization statement has a hard app bound', async () => {
  const sql = await readFile(FINALIZATION_SQL_URL, 'utf8');

  assert.match(sql, /p_batch_size < 1 OR p_batch_size > 5000/);
  assert.equal((sql.match(/LIMIT p_batch_size/g) ?? []).length, 4);
  assert.match(
    sql,
    /WITH candidate_ids AS MATERIALIZED \([\s\S]*last_observed_scan_id = v_run\.id[\s\S]*LIMIT p_batch_size[\s\S]*UNION ALL[\s\S]*last_full_observed_scan_id = v_run\.id[\s\S]*LIMIT p_batch_size[\s\S]*bounded AS MATERIALIZED \([\s\S]*SELECT DISTINCT candidate\.appid[\s\S]*LIMIT p_batch_size[\s\S]*UPDATE ops\.app_catalog_state/
  );
  assert.match(
    sql,
    /WITH candidates AS MATERIALIZED \([\s\S]*LIMIT p_batch_size[\s\S]*INSERT INTO ops\.app_data_readiness/
  );
});

test('catalog readiness avoids per-row cascades and refreshes overall readiness once per chunk', async () => {
  const sql = await readFile(FINALIZATION_SQL_URL, 'utf8');

  assert.match(
    sql,
    /DROP TRIGGER IF EXISTS capture_catalog_readiness_v1 ON ops\.app_catalog_state/
  );
  assert.match(sql, /current_setting\('publisheriq\.skip_readiness_cascade', true\)/);
  assert.match(
    sql,
    /set_config\('publisheriq\.skip_readiness_cascade', 'on', true\)[\s\S]*INSERT INTO ops\.app_data_readiness[\s\S]*set_config\('publisheriq\.skip_readiness_cascade', 'off', true\)[\s\S]*refresh_overall_readiness_v1\(v_appids\)/
  );
  assert.match(sql, /'catalog-readiness\/v2'/);
  assert.match(sql, /'catalog_finalization', 'bounded\/v1'/);
});

test('cursor advancement and work settlement share each function transaction', async () => {
  const sql = await readFile(FINALIZATION_SQL_URL, 'utf8');
  const advanceStart = sql.indexOf(
    'CREATE OR REPLACE FUNCTION ops.advance_catalog_scan_finalization'
  );
  const legacyStart = sql.indexOf('CREATE OR REPLACE FUNCTION ops.complete_catalog_scan');
  const advanceSql = sql.slice(advanceStart, legacyStart);

  assert.ok(advanceStart >= 0);
  assert.ok(legacyStart > advanceStart);
  assert.match(
    advanceSql,
    /UPDATE ops\.app_catalog_state[\s\S]*UPDATE ops\.catalog_scan_runs scan[\s\S]*finalization_state_cursor_appid = v_last_appid/
  );
  assert.match(
    advanceSql,
    /INSERT INTO ops\.app_data_readiness[\s\S]*refresh_overall_readiness_v1\(v_appids\)[\s\S]*finalization_readiness_cursor_appid = v_last_appid/
  );
  assert.match(
    advanceSql,
    /still has unfinalized catalog-state rows[\s\S]*still has unfinalized readiness rows[\s\S]*status = 'completed'/
  );
});

test('legacy completion fails closed and chunk failures remain resumable', async () => {
  const sql = await readFile(FINALIZATION_SQL_URL, 'utf8');

  assert.match(sql, /ops\.complete_catalog_scan is disabled; use bounded catalog finalization/);
  assert.match(
    sql,
    /SET status = CASE[\s\S]*WHEN status = 'running' THEN 'failed'[\s\S]*WHERE id = p_scan_id[\s\S]*status IN \('running', 'finalizing'\)/
  );
  assert.match(
    sql,
    /WHEN status = 'finalizing' THEN clock_timestamp\(\)[\s\S]*ELSE finalization_heartbeat_at/
  );
});
