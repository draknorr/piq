import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const repositorySource = readFileSync(
  new URL("./worker-repository.ts", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("./worker.ts", import.meta.url),
  "utf8",
);
const productRepositorySource = readFileSync(
  new URL("./repository.ts", import.meta.url),
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
    assert.match(
      repositorySource,
      /WHEN work\.kind = 'materialize_events' THEN 1/,
    );
    assert.match(
      repositorySource,
      /ELSE GREATEST\(1, CEIL\(\$2::numeric \/ 4\)\)/,
    );
  });

  test("materialization batches stay bounded and renew their active lease", () => {
    const materialization = repositorySource.match(
      /async materializeEvents\([\s\S]*?return moments\.length;\s+\}/,
    )?.[0];
    assert.ok(materialization);
    assert.equal(materialization.match(/LIMIT 100/g)?.length, 2);
    assert.match(materialization, /LIMIT 500/);
    assert.match(
      materialization,
      /processedMoments % 50 === 0[\s\S]*?await onProgress\(\)/,
    );
    assert.match(
      workerSource,
      /materializeEvents\(\(\) =>[\s\S]*?heartbeatWork\(item\.id, this\.workerId\)/,
    );
  });

  test("daily evaluation renews its lease and bounds repeated cohort work", () => {
    assert.match(
      workerSource,
      /refreshSignalWindows\(\s*appids,\s*\{[\s\S]*?batchSize: EVALUATION_SIGNAL_REFRESH_BATCH_SIZE,[\s\S]*?heartbeatWork\(item\.id, this\.workerId\)/,
    );
    assert.match(
      workerSource,
      /index % EVALUATION_HEARTBEAT_GAME_INTERVAL === 0[\s\S]*?heartbeatWork\(item\.id, this\.workerId\)/,
    );
    assert.match(repositorySource, /tag_matches AS MATERIALIZED/);
    assert.match(repositorySource, /genre_matches AS MATERIALIZED/);
    assert.match(repositorySource, /LIMIT 51/);
    assert.match(
      repositorySource,
      /\.filter\(\(row\) => row\.appid !== subject\.appid\)[\s\S]*?\.slice\(0, 50\)/,
    );
    assert.match(workerSource, /getReleasedCohorts\(/);
    assert.match(
      repositorySource,
      /opportunity\.released_cohort_features_v2 feature/,
    );
    assert.match(repositorySource, /const tagPostings = new Map/);
    assert.match(repositorySource, /const genrePostings = new Map/);
    assert.match(repositorySource, /rows\.slice\(0, 51\)/);
    assert.match(repositorySource, /opportunity\.released_cohort_cache_v1/);
    assert.match(repositorySource, /attempt <= 2/);
    assert.match(repositorySource, /isStatementTimeout\(error\)/);
    assert.match(repositorySource, /signal\.as_of_date < CURRENT_DATE - 1/);
    assert.match(
      repositorySource,
      /signal\.calculation_version IS DISTINCT FROM 'signal-windows\/v1'/,
    );
    assert.match(
      repositorySource,
      /readiness\.version IS DISTINCT FROM 'signal-windows\/v1'/,
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

  test("scheduled readiness rechecks retain the triggering material event", () => {
    const scheduledReadiness = repositorySource.match(
      /const readiness = await client\.query\([\s\S]*?RETURNING id[\s\S]*?\);/,
    )?.[0];
    assert.ok(scheduledReadiness);
    assert.match(scheduledReadiness, /material_event_id/);
    assert.match(scheduledReadiness, /pending\.material_event_id/);
  });

  test("material-event fan-out binds queue parameters with their target types", () => {
    const immediateFanOut = repositorySource.match(
      /if \(inserted && moment\.eligibleForImmediate\) \{[\s\S]*?\} else if \(inserted && moment\.reevaluateEligibility\)/,
    )?.[0];
    const readinessFanOut = repositorySource.match(
      /else if \(inserted && moment\.reevaluateEligibility\) \{[\s\S]*?ON CONFLICT \(idempotency_key\) DO NOTHING[\s\S]*?\);/,
    )?.[0];

    assert.ok(immediateFanOut);
    assert.match(
      immediateFanOut,
      /profile\.owner_user_id,\s+\$1::integer,\s+\$2::uuid,/,
    );
    assert.match(immediateFanOut, /'event:' \|\| \$2::text \|\| ':user:'/);
    assert.match(
      immediateFanOut,
      /jsonb_build_object\('eventFingerprint', \$3::text\)/,
    );

    assert.ok(readinessFanOut);
    assert.match(
      readinessFanOut,
      /candidate\.user_id,\s+\$1::integer,\s+\$2::uuid,/,
    );
    assert.match(readinessFanOut, /'event:' \|\| \$2::text \|\| ':readiness:'/);
    assert.match(
      readinessFanOut,
      /jsonb_build_object\('eventFingerprint', \$3::text\)/,
    );
    assert.match(readinessFanOut, /candidate\.appid = \$1::integer/);
  });

  test("completed daily runs return profiles to their local schedule", () => {
    assert.match(
      repositorySource,
      /next_evaluation_at = opportunity\.next_profile_evaluation_v1\(/,
    );
    assert.doesNotMatch(
      repositorySource,
      /next_evaluation_at = now\(\) \+ interval '24 hours'/,
    );
    assert.match(
      repositorySource,
      /\["daily", "manual", "replay"\]\.includes\(params\.run\.kind\)/,
    );
    assert.match(repositorySource, /WITH personal_schedule AS/);
    assert.match(
      repositorySource,
      /SET timezone = personal_schedule\.timezone/,
    );
  });

  test("readiness rechecks cannot advance the durable daily cursor", () => {
    assert.match(migration, /'replay', 'readiness'/);
    assert.match(
      repositorySource,
      /run_kind IN \('daily', 'manual', 'replay'\)/,
    );
    assert.match(
      workerSource,
      /item\.kind === "daily_evaluation"[\s\S]*?"daily"[\s\S]*?: "readiness"/,
    );
    assert.match(repositorySource, /params\.run\.kind !== "readiness"/);
  });

  test("the next daily brief absorbs qualifications completed by readiness runs", () => {
    assert.match(repositorySource, /\$3::text = 'daily'/);
    assert.match(repositorySource, /result\.created_at >= \$4/);
    assert.match(repositorySource, /result\.created_at < \$5/);
    assert.match(productRepositorySource, /\$5::text = 'daily'/);
    assert.match(productRepositorySource, /result\.created_at >= \$3/);
    assert.match(productRepositorySource, /result\.created_at < \$4/);
  });

  test("delivery selection honors profile-scoped preferences", () => {
    assert.match(repositorySource, /array_agg\(DISTINCT match\.profile_id\)/);
    assert.match(repositorySource, /profile_id NULLS LAST/);
    assert.doesNotMatch(repositorySource, /AND profile_id IS NULL/);
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

  test("unsafe historical results are not reused by new evaluations", () => {
    const priorStateLookup = repositorySource.match(
      /async getPriorUserStates\([\s\S]*?return new Map\(/,
    )?.[0];
    assert.ok(priorStateLookup);
    assert.equal(
      priorStateLookup.match(
        /opportunityPersistedResultContentSafetySql\("result"\)/g,
      )?.length,
      2,
    );
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

  test("the canonical record exposes the versions and timestamps needed to reproduce it", () => {
    for (const field of [
      "'calculationVersions'",
      "'sourceTimestamps'",
      "'activeProfileVersions'",
      "'triggeringEvent'",
      "'profileVersionId'",
      "'profileVersion'",
      "'deliveries'",
    ]) {
      assert.match(productRepositorySource, new RegExp(field));
    }
    assert.match(workerSource, /materialEventEffectiveAt/);
    assert.match(workerSource, /materialEventObservedAt/);
    assert.match(workerSource, /profileEvaluationAt/);
  });

  test("shared viewed activity is bounded and does not flood on page reload", () => {
    assert.match(
      productRepositorySource,
      /FROM opportunity\.team_activity recent[\s\S]*?LIMIT 100/,
    );
    assert.match(
      productRepositorySource,
      /recent\.activity_type = 'viewed'[\s\S]*?interval '1 hour'/,
    );
  });

  test("source health keeps missing expected sources visible", () => {
    assert.match(productRepositorySource, /WITH expected\(source\) AS/);
    assert.match(
      productRepositorySource,
      /LEFT JOIN prepared ON prepared\.source = expected\.source/,
    );
  });
});
