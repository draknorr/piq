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
const performanceMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../sql/tiger-bootstrap/0099_opportunity_evaluation_performance_v1.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const evidenceMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../sql/tiger-bootstrap/0100_opportunity_field_sources_token_pics.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const storefrontTagMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../sql/tiger-bootstrap/0101_public_storefront_tag_evidence.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const reviewPriorityMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../sql/tiger-bootstrap/0102_opportunity_review_priority_v2.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const teamsMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../sql/tiger-bootstrap/0103_opportunity_teams.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const workerRepository = readFileSync(
  fileURLToPath(new URL("./worker-repository.ts", import.meta.url)),
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

  it("schedules profiles at a timezone-aware local delivery time", () => {
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION opportunity\.next_profile_evaluation_v1/,
    );
    assert.match(migration, /p_after AT TIME ZONE p_timezone/);
    assert.match(migration, /p_local_delivery_time/);
  });
});

describe("opportunity review priority v2 migration", () => {
  it("only replaces the bounded readiness capture function", () => {
    assert.match(
      reviewPriorityMigration,
      /CREATE OR REPLACE FUNCTION ops\.capture_storefront_sync_readiness_v1\(\)/,
    );
    assert.match(
      reviewPriorityMigration,
      /snapshot_summary->'opportunityDescription'/,
    );
    assert.match(reviewPriorityMigration, /'description', v_description/);
    assert.match(reviewPriorityMigration, /'storefront-readiness\/v2'/);
    assert.doesNotMatch(reviewPriorityMigration, /\bCREATE TABLE\b/i);
    assert.doesNotMatch(reviewPriorityMigration, /\bALTER TABLE\b/i);
    assert.doesNotMatch(reviewPriorityMigration, /\bCREATE INDEX\b/i);
    assert.doesNotMatch(reviewPriorityMigration, /^\s*UPDATE\s/gim);
    assert.doesNotMatch(reviewPriorityMigration, /\b(?:DELETE|TRUNCATE)\b/i);
  });
});

describe("opportunity teams migration", () => {
  it("adds collaboration state without rewriting personal opportunity data", () => {
    assert.match(
      teamsMigration,
      /CREATE TABLE IF NOT EXISTS opportunity\.teams/,
    );
    assert.match(
      teamsMigration,
      /CREATE TABLE IF NOT EXISTS opportunity\.team_memberships/,
    );
    assert.match(
      teamsMigration,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_teams_name_unique\s+ON opportunity\.teams \(lower\(name\)\)/s,
    );
    assert.match(
      teamsMigration,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_team_memberships_one_active\s+ON opportunity\.team_memberships \(user_id\)\s+WHERE status = 'active'/s,
    );
    for (const table of ["team_activity", "team_research_state", "audit_log"]) {
      assert.match(
        teamsMigration,
        new RegExp(
          `ALTER TABLE opportunity\\.${table}\\s+ADD COLUMN IF NOT EXISTS team_id uuid`,
          "s",
        ),
      );
    }
    assert.doesNotMatch(teamsMigration, /^\s*(?:DELETE\s+FROM|TRUNCATE\b)/gim);
    assert.doesNotMatch(
      teamsMigration,
      /\bDROP\s+(?:TABLE|SCHEMA|COLUMN|CONSTRAINT)\b/i,
    );
    assert.doesNotMatch(teamsMigration, /^\s*(?:INSERT|UPDATE)\s/gim);
  });

  it("retains soft-removal attribution and team audit history", () => {
    assert.match(teamsMigration, /status IN \('active', 'removed'\)/);
    assert.match(teamsMigration, /identity_email text NOT NULL/);
    assert.match(teamsMigration, /display_name text/);
    assert.match(
      teamsMigration,
      /CREATE INDEX IF NOT EXISTS idx_opportunity_audit_team/,
    );
  });
});

describe("opportunity evaluation performance migration", () => {
  it("adds only versioned Opportunity state and bounded cleanup", () => {
    assert.doesNotMatch(
      performanceMigration,
      /\bDROP\s+(?:TABLE|SCHEMA|COLUMN|CONSTRAINT)\b/i,
    );
    assert.doesNotMatch(performanceMigration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(
      performanceMigration,
      /\b(?:UPDATE|DELETE\s+FROM)\s+(?:legacy|metrics|ops)\./i,
    );
    for (const table of [
      "opportunity.rule_input_projection_v1",
      "opportunity.released_cohort_cache_v1",
      "opportunity.cohort_source_revisions_v1",
      "opportunity.cohort_taxonomy_positions_v1",
      "opportunity.cohort_feature_projection_state_v1",
    ]) {
      assert.match(
        performanceMigration,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`),
      );
    }
    assert.match(
      performanceMigration,
      /ADD COLUMN IF NOT EXISTS phase_timings jsonb/,
    );
    assert.match(
      performanceMigration,
      /CREATE MATERIALIZED VIEW IF NOT EXISTS\s+opportunity\.released_cohort_features_v1/s,
    );
    assert.match(
      performanceMigration,
      /CREATE MATERIALIZED VIEW IF NOT EXISTS\s+opportunity\.released_cohort_features_v2/s,
    );
    assert.match(
      performanceMigration,
      /released_cohort_features_tags_v2[\s\S]*USING gin \(tag_ids\)/,
    );
    assert.match(
      performanceMigration,
      /released_cohort_features_genres_v2[\s\S]*USING gin \(genre_ids\)/,
    );
    assert.doesNotMatch(performanceMigration, /CREATE EXTENSION/i);
    assert.doesNotMatch(performanceMigration, /jsonb_object_length/i);
    assert.match(
      performanceMigration,
      /LOCK TABLE[\s\S]*legacy\.apps[\s\S]*legacy\.latest_daily_metrics[\s\S]*IN SHARE MODE/,
    );
    assert.match(
      performanceMigration,
      /LIMIT v_cache_limit[\s\S]*LIMIT v_projection_limit/,
    );
  });

  it("invalidates exact cohort cache entries transactionally for every source", () => {
    for (const source of [
      "legacy', 'apps",
      "legacy', 'app_steam_tags",
      "legacy', 'steam_tags",
      "legacy', 'app_genres",
      "legacy', 'steam_genres",
      "legacy', 'latest_daily_metrics",
      "metrics', 'app_signal_windows_v1",
      "ops', 'app_data_readiness",
    ]) {
      assert.match(performanceMigration, new RegExp(`\\('${source}'\\)`));
    }
    assert.match(
      performanceMigration,
      /AFTER INSERT OR UPDATE OR DELETE[\s\S]*FOR EACH STATEMENT/,
    );
    assert.match(
      performanceMigration,
      /ON CONFLICT \(source_key\)[\s\S]*revision \+ 1/,
    );
    assert.match(performanceMigration, /B'0'::bit\(1024\)/);
    assert.match(performanceMigration, /B'0'::bit\(128\)/);
    assert.match(
      performanceMigration,
      /REFRESH MATERIALIZED VIEW CONCURRENTLY\s+opportunity\.released_cohort_features_v2/s,
    );
    assert.match(
      performanceMigration,
      /v_before_revisions IS DISTINCT FROM v_after_revisions/,
    );
    const featureWatermark = performanceMigration.match(
      /SELECT jsonb_object_agg\(source_key, revision ORDER BY source_key\)[\s\S]*?WITH missing AS \([\s\S]*?SELECT tag\.tag_id/,
    )?.[0];
    assert.ok(featureWatermark);
    for (const source of [
      "legacy.apps",
      "legacy.app_steam_tags",
      "legacy.steam_tags",
      "legacy.app_genres",
      "legacy.steam_genres",
      "legacy.latest_daily_metrics",
    ]) {
      assert.match(featureWatermark, new RegExp(`'${source}'`));
    }
    assert.match(
      workerRepository,
      /cohort_feature_projection_state_v1[\s\S]*'legacy\.steam_tags'[\s\S]*'legacy\.steam_genres'/,
    );
    assert.match(workerRepository, /sourceRevisions/);
    assert.match(
      workerRepository,
      /SELECT pg_export_snapshot\(\) AS snapshot_id/,
    );
    assert.match(workerRepository, /SET TRANSACTION SNAPSHOT/);
    assert.match(
      workerRepository,
      /did not match the fenced exported source snapshot/,
    );
  });

  it("uses bounded set-based resolution and persistence contracts", () => {
    assert.match(workerRepository, /COHORT_FEATURE_PAGE_SIZE = 5_000/);
    assert.match(workerRepository, /COHORT_FEATURE_MAX_ROWS = 250_000/);
    assert.match(workerRepository, /RESULT_PERSISTENCE_BATCH_SIZE = 100/);
    assert.match(workerRepository, /CANDIDATE_PERSISTENCE_BATCH_SIZE = 500/);
    assert.match(
      workerRepository,
      /FROM opportunity\.released_cohort_features_v2 feature[\s\S]*WHERE feature\.appid > \$1[\s\S]*LIMIT \$2/,
    );
    assert.match(
      workerRepository,
      /INSERT INTO opportunity\.released_cohort_cache_v1/,
    );
  });
});

describe("public Storefront tag evidence migration", () => {
  it("widens only the existing queue source constraint and adds a batch writer", () => {
    assert.match(
      storefrontTagMigration,
      /ADD CONSTRAINT app_capture_work_state_source_check[\s\S]*'storefront_tags'/,
    );
    assert.match(
      storefrontTagMigration,
      /CREATE OR REPLACE FUNCTION ops\.upsert_storefront_tag_evidence_v1/,
    );
    assert.match(
      storefrontTagMigration,
      /ON CONFLICT \(appid, field_name, source\)/,
    );
    assert.doesNotMatch(storefrontTagMigration, /\bDROP\s+(?:TABLE|COLUMN)\b/i);
    assert.doesNotMatch(storefrontTagMigration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(storefrontTagMigration, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(storefrontTagMigration, /\bUPDATE\s+legacy\./i);
  });

  it("does not rewrite unchanged normalized tag evidence", () => {
    assert.match(
      storefrontTagMigration,
      /app_field_evidence\.value IS DISTINCT FROM EXCLUDED\.value/,
    );
    assert.match(
      storefrontTagMigration,
      /provenance->'items'[\s\S]*IS DISTINCT FROM EXCLUDED\.provenance->'items'/,
    );
  });
});

describe("opportunity field evidence migration", () => {
  it("adds source-specific evidence without mutating opportunity result history", () => {
    assert.match(
      evidenceMigration,
      /CREATE TABLE IF NOT EXISTS ops\.app_field_evidence/,
    );
    assert.match(evidenceMigration, /missingVersusEmptyPreserved/);
    assert.match(evidenceMigration, /upsert_storefront_app_evidence_v1/);
    assert.match(evidenceMigration, /IF p_observed_at IS NULL THEN\s+RETURN/s);
    assert.doesNotMatch(evidenceMigration, /ops\.app_data_readiness/);
    assert.doesNotMatch(evidenceMigration, /source_name\s*=\s*'pics'/);
    assert.doesNotMatch(evidenceMigration, /UPDATE opportunity\.results/);
    assert.doesNotMatch(evidenceMigration, /DELETE FROM opportunity\.results/);
    assert.doesNotMatch(
      evidenceMigration,
      /jsonb_to_recordset\([^\n]+\) WITH ORDINALITY/,
    );
  });

  it("makes token replays explicit and audited", () => {
    assert.match(
      evidenceMigration,
      /ADD COLUMN IF NOT EXISTS needs_token boolean/,
    );
    assert.match(
      evidenceMigration,
      /batch\.stream_key = work\.stream_key[\s\S]*batch\.work_mode = work\.work_mode/,
    );
    assert.match(
      evidenceMigration,
      /CREATE TABLE IF NOT EXISTS ops\.pics_token_replay_audit/,
    );
    assert.match(evidenceMigration, /archive_content_hash/);
    assert.match(evidenceMigration, /requested_by/);
  });
});
