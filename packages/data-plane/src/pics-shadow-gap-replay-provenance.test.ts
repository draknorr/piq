import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REPLAY_SQL_URL = new URL(
  "../sql/tiger-bootstrap/0095_pics_shadow_gap_replay_provenance.sql",
  import.meta.url,
);

test("shadow-gap replay provenance is additive, immutable, and Tiger-only", async () => {
  const sql = await readFile(REPLAY_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS ops\.pics_shadow_gap_replay_provenance/,
  );
  assert.match(
    sql,
    /primary_batch_id uuid PRIMARY KEY[\s\S]*REFERENCES ops\.pics_change_batches\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    sql,
    /source_batch_id uuid NOT NULL[\s\S]*REFERENCES ops\.pics_change_batches\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    sql,
    /gap_evidence_batch_id uuid NOT NULL[\s\S]*REFERENCES ops\.pics_change_batches\(id\) ON DELETE RESTRICT/,
  );
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE)\s+ops\./i);
  assert.doesNotMatch(sql, /\bsupabase\b/i);
});

test("shadow-gap replay provenance pins exact ranges, manifests, and source archives", async () => {
  const sql = await readFile(REPLAY_SQL_URL, "utf8");

  assert.match(
    sql,
    /recovered_from_change_number >= source_from_change_number[\s\S]*recovered_to_change_number = source_to_change_number/,
  );
  assert.match(sql, /recovered_app_changes_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /plan_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /source_archive_content_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /gap_archive_content_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(
    sql,
    /UNIQUE \(\s*gap_evidence_batch_id,\s*recovered_from_change_number,\s*recovered_to_change_number\s*\)/,
  );
  assert.match(sql, /source_stream_key <> 'primary'/);
});
