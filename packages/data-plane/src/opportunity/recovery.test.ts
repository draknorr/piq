import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const repositorySource = readFileSync(
  new URL("./worker-repository.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../sql/tiger-bootstrap/0097_opportunity_mvp.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("opportunity failure recovery and preservation contracts", () => {
  test("claims are leased fairly and abandoned work is reclaimable", () => {
    assert.match(repositorySource, /PARTITION BY work\.lane/);
    assert.match(repositorySource, /FOR UPDATE OF work SKIP LOCKED/);
    assert.match(repositorySource, /work\.claim_expires_at < now\(\)/);
    assert.match(
      repositorySource,
      /claim_expires_at = now\(\) \+ interval '5 minutes'/,
    );
  });

  test("failures back off, dead-letter, and preserve source-blocked state", () => {
    assert.match(repositorySource, /WHEN \$5 THEN 'source_blocked'/);
    assert.match(
      repositorySource,
      /WHEN attempts >= max_attempts THEN 'dead_letter'/,
    );
    assert.match(repositorySource, /POWER\(2, LEAST\(attempts, 8\)\)/);
    assert.match(repositorySource, /last_error_message = left\(\$4, 2000\)/);
  });

  test("canonical results and deliveries have database idempotency keys", () => {
    assert.match(
      migration,
      /UNIQUE \(\s*user_id,\s*appid,\s*event_fingerprint,\s*profile_version_set_fingerprint\s*\)/,
    );
    assert.match(migration, /idempotency_key text NOT NULL UNIQUE/);
    assert.match(
      repositorySource,
      /ON CONFLICT \(idempotency_key\) DO NOTHING/,
    );
  });

  test("new event reappearance clears dismissal without clearing ignore", () => {
    const reappearanceUpdate = repositorySource.match(
      /UPDATE opportunity\.user_game_state[\s\S]*?dismissed_event_fingerprint <> \$4[\s\S]*?\);/,
    )?.[0];
    assert.ok(reappearanceUpdate);
    assert.match(reappearanceUpdate, /dismissed_at = NULL/);
    assert.match(reappearanceUpdate, /dismissed_event_fingerprint = NULL/);
    assert.doesNotMatch(reappearanceUpdate, /ignored_at = NULL/);
  });

  test("the schema remains additive and evidence-preserving", () => {
    assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|SCHEMA|COLUMN)\b/i);
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
    assert.match(migration, /CREATE SCHEMA IF NOT EXISTS opportunity/);
    assert.match(migration, /calculation_versions jsonb NOT NULL/);
    assert.match(migration, /source_timestamps jsonb NOT NULL/);
    assert.match(migration, /missing_evidence jsonb NOT NULL/);
  });
});
