import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../sql/tiger-bootstrap/0097_opportunity_mvp.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const presets = readFileSync(
  fileURLToPath(
    new URL(
      "../../sql/tiger-bootstrap/0098_opportunity_preset_seed.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("opportunity Tiger migration", () => {
  it("is additive and contains no destructive data operation", () => {
    assert.doesNotMatch(
      migration,
      /\bDROP\s+(?:TABLE|SCHEMA|COLUMN|CONSTRAINT)\b/i,
    );
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(migration, /\bUPDATE\s+legacy\./i);
  });

  it("keeps canonical runs, evidence, personal state, team state, and delivery in Tiger", () => {
    for (const table of [
      "opportunity.runs",
      "opportunity.results",
      "opportunity.candidate_state",
      "opportunity.user_game_state",
      "opportunity.team_activity",
      "opportunity.deliveries",
    ]) {
      assert.match(
        migration,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`),
      );
    }
    assert.match(
      migration,
      /UNIQUE\s*\(\s*user_id,\s*appid,\s*event_fingerprint,\s*profile_version_set_fingerprint\s*\)/s,
    );
    assert.match(migration, /idempotency_key text NOT NULL UNIQUE/);
  });

  it("seeds immutable versions for every launch preset", () => {
    for (const slug of [
      "roguelike-deckbuilder",
      "cozy-sim",
      "extraction-shooter",
      "narrative-horror",
      "colony-sim-survival",
      "new-self-published-indie-releases",
      "upcoming-games-with-demos",
      "recently-released-early-traction",
    ]) {
      assert.match(presets, new RegExp(`'${slug}'`));
    }
    assert.match(presets, /ON CONFLICT \(preset_id, version\) DO NOTHING/);
  });
});
