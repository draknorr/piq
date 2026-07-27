import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCHEDULER_SQL_URL = new URL(
  "../sql/tiger-bootstrap/0091_apps_projection_native_scheduler.sql",
  import.meta.url,
);
const SNAPSHOT_AWARE_PARITY_SQL_URL = new URL(
  "../sql/tiger-bootstrap/0096_apps_projection_snapshot_aware_parity.sql",
  import.meta.url,
);
const FALLBACK_WORKFLOW_URL = new URL(
  "../../../.github/workflows/apps-projection-refresh.yml",
  import.meta.url,
);

test("Apps projection native scheduler is fixed, versioned, and installed disabled", async () => {
  const sql = await readFile(SCHEDULER_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE OR REPLACE PROCEDURE ops\.refresh_apps_page_projections_job\s*\(\s*job_id integer,\s*config jsonb\s*\)/s,
  );
  assert.match(sql, /"contract_version":"apps-projection-refresh\/v1"/);
  assert.match(sql, /interval '4 hours'/);
  assert.match(sql, /fixed_schedule => true/);
  assert.match(sql, /timezone => 'UTC'/);
  assert.match(sql, /scheduled => false/);
  assert.doesNotMatch(sql, /scheduled => true/);
  assert.match(sql, /max_runtime => interval '45 minutes'/);
  assert.match(sql, /max_retries => 3/);
  assert.match(sql, /retry_period => interval '15 minutes'/);
});

test("Apps projection job uses allowlisted concurrent refreshes and parity gates", async () => {
  const sql = await readFile(SCHEDULER_SQL_URL, "utf8");

  assert.match(
    sql,
    /REFRESH MATERIALIZED VIEW CONCURRENTLY metrics\.apps_page_projection;/,
  );
  assert.match(
    sql,
    /REFRESH MATERIALIZED VIEW CONCURRENTLY metrics\.apps_page_filter_counts;/,
  );
  assert.doesNotMatch(sql, /\bEXECUTE\b/i);
  assert.match(sql, /apps projection\/source row parity failed/);
  assert.match(sql, /apps projection\/source app ID parity failed/);
  assert.match(sql, /apps v2\/legacy row parity failed/);
  assert.match(sql, /apps projection filter-count parity failed/);
});

test("GitHub Apps projection workflow is an approval-gated manual fallback only", async () => {
  const workflow = await readFile(FALLBACK_WORKFLOW_URL, "utf8");

  assert.match(workflow, /\n {2}workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n {2}schedule:\n/);
  assert.match(workflow, /inputs\.backup_pitr_verified == true/);
  assert.match(workflow, /inputs\.approval_reference != ''/);
  assert.doesNotMatch(workflow, /ENABLE_TIGER_APPS_PROJECTION_REFRESH/);
});

test("forward Apps projection migration changes procedure code without changing job metadata", async () => {
  const sql = await readFile(SNAPSHOT_AWARE_PARITY_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE OR REPLACE PROCEDURE ops\.refresh_apps_page_projections_job\s*\(\s*job_id integer,\s*config jsonb\s*\)/s,
  );
  assert.doesNotMatch(sql, /\b(?:add_job|alter_job|run_job)\s*\(/i);
  assert.doesNotMatch(sql, /scheduled\s*=>/i);
  assert.doesNotMatch(sql, /\bEXECUTE\b/i);
  assert.equal(
    sql.match(
      /REFRESH MATERIALIZED VIEW CONCURRENTLY metrics\.apps_page_projection;/g,
    )?.length,
    1,
  );
  assert.equal(
    sql.match(
      /REFRESH MATERIALIZED VIEW CONCURRENTLY metrics\.apps_page_filter_counts;/g,
    )?.length,
    1,
  );
});

test("forward Apps projection migration gates exact source parity on a stable source snapshot", async () => {
  const sql = await readFile(SNAPSHOT_AWARE_PARITY_SQL_URL, "utf8");

  assert.match(sql, /source_rows_before bigint/);
  assert.match(sql, /source_rows_after bigint/);
  assert.match(sql, /source_fingerprint_before text/);
  assert.match(sql, /source_fingerprint_after text/);
  assert.equal(
    sql.match(
      /md5\(\s*coalesce\(string_agg\(appid::text, ',' ORDER BY appid\), ''\)\s*\)/g,
    )?.length,
    2,
  );
  assert.match(sql, /WITH eligible_source AS MATERIALIZED/);
  assert.match(sql, /projection_ids AS MATERIALIZED/);
  assert.match(
    sql,
    /source_changed :=\s*source_rows_before IS DISTINCT FROM source_rows_after\s*OR source_fingerprint_before IS DISTINCT FROM source_fingerprint_after;/s,
  );
  assert.match(
    sql,
    /IF NOT source_changed THEN[\s\S]*apps projection\/source row parity failed[\s\S]*apps projection\/source app ID parity failed[\s\S]*ELSE[\s\S]*exact source parity deferred[\s\S]*END IF;/,
  );

  const stableSourceGate = sql.indexOf("IF NOT source_changed THEN");
  const v2Gate = sql.indexOf("apps v2/legacy row parity failed");
  const filterGate = sql.indexOf("apps projection filter-count parity failed");
  assert.ok(stableSourceGate >= 0);
  assert.ok(v2Gate > stableSourceGate);
  assert.ok(filterGate > v2Gate);
});
