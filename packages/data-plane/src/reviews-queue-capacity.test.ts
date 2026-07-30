import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const REVIEWS_CAPACITY_SQL_URL = new URL('../sql/tiger-bootstrap/0099_reviews_queue_capacity.sql', import.meta.url);

test('Reviews capacity patch is function-only and makes promotions immediately due', async () => {
  const sql = await readFile(REVIEWS_CAPACITY_SQL_URL, 'utf8');

  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 2);
  assert.equal((sql.match(/\bCREATE\b/g) ?? []).length, 2);
  assert.match(sql, /CREATE OR REPLACE FUNCTION ops\.promote_reviews_sync\(/);
  assert.match(sql, /next_reviews_sync = LEAST\(/);
  assert.match(sql, /VALUES \(\$1, now\(\), \$2, \$3, \$4, \$5, now\(\)\)/);
  assert.doesNotMatch(sql, /\bCREATE TABLE\b/i);
  assert.doesNotMatch(sql, /\bCREATE (?:UNIQUE )?INDEX\b/i);
  assert.doesNotMatch(sql, /\bALTER TABLE\b/i);
  assert.doesNotMatch(sql, /\b(?:add_job|alter_job|run_job)\s*\(/i);
});

test('Reviews cadence preserves active tiers and segments dormant apps', async () => {
  const sql = await readFile(REVIEWS_CAPACITY_SQL_URL, 'utf8');

  assert.match(sql, /desired_review_velocity_tier = 'high' THEN 4[\s\S]*'medium' THEN 12[\s\S]*'low' THEN 24/);
  assert.match(
    sql,
    /reviews_priority_override_bucket IN \([\s\S]*'launch_critical'[\s\S]*'change_critical'[\s\S]*'active_reviews'/
  );
  assert.match(sql, /has_active_review_promotion[\s\S]*THEN 24/);
  assert.match(sql, /is_current_launch_window[\s\S]*THEN 24/);
  assert.match(sql, /is_pinned_game[\s\S]*current_priority_score >= 50[\s\S]*THEN 168/);
  assert.match(sql, /current_total_reviews = 0[\s\S]*last_activity_at >= now\(\) - INTERVAL '90 days'[\s\S]*THEN 168/);
  assert.match(sql, /current_total_reviews > 0 THEN 720/);
  assert.match(sql, /ELSE 2160/);
  assert.match(sql, /FROM legacy\.user_pins pin/);
});

test('Velocity recalculation changes interval policy without normalizing due timestamps', async () => {
  const sql = await readFile(REVIEWS_CAPACITY_SQL_URL, 'utf8');
  const velocityStart = sql.indexOf('CREATE OR REPLACE FUNCTION ops.update_review_velocity_tiers_batch');
  const velocitySql = sql.slice(velocityStart);

  assert.ok(velocityStart >= 0);
  assert.match(velocitySql, /reviews_interval_hours = candidate\.desired_reviews_interval_hours/);
  assert.doesNotMatch(velocitySql, /next_reviews_sync\s*=/);
});
