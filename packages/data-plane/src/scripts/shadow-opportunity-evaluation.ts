import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  calculateOpportunityMarketContext,
  calculateOpportunityRanking,
} from "../opportunity/intelligence.js";
import { OpportunityRepository } from "../opportunity/repository.js";
import { evaluateOpportunityProfile } from "../opportunity/rules.js";
import type {
  OpportunityRuleSet,
  OpportunityWorkerPhaseTimings,
} from "../opportunity/types.js";
import { OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION } from "../opportunity/types.js";
import {
  OpportunityWorkerRepository,
  type OpportunityReleasedCohort,
} from "../opportunity/worker-repository.js";

interface RunRow extends QueryResultRow {
  active_profile_versions: string[];
  candidate_count: number;
  completed_at: Date | string;
  evaluated_count: number;
  id: string;
  pending_count: number;
  result_count: number;
  started_at: Date | string;
  window_end: Date | string;
  window_start: Date | string;
}

interface ProfileRow extends QueryResultRow {
  id: string;
  rules: OpportunityRuleSet;
  version_id: string;
}

interface StoredCohortRow extends QueryResultRow {
  appid: number;
  coverage: number | string;
  fallback_tier: number;
  members: OpportunityReleasedCohort["members"] | string;
  signature: Record<string, unknown> | string;
  source_at: Date | string | null;
}

const COLD_TARGET_MS = 3 * 60 * 1000;
const WARM_TARGET_MS = 60 * 1000;

function requiredEnvironment(name: "TIGER_PRIMARY_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function resultLimit(): number {
  const parsed = Number(process.env.OPPORTUNITY_SHADOW_RESULT_LIMIT ?? "100");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5_000) {
    throw new Error(
      "OPPORTUNITY_SHADOW_RESULT_LIMIT must be an integer from 1 to 5000.",
    );
  }
  return parsed;
}

async function captureSourceRevisions(
  client: PoolClient,
): Promise<Record<string, string>> {
  const result = await client.query<{ revision: string; source_key: string }>(`
    WITH expected(source_key) AS (
      VALUES
        ('legacy.apps'),
        ('legacy.app_steam_tags'),
        ('legacy.steam_tags'),
        ('legacy.app_genres'),
        ('legacy.steam_genres'),
        ('legacy.latest_daily_metrics'),
        ('metrics.app_signal_windows_v1'),
        ('ops.app_data_readiness')
    )
    SELECT
      expected.source_key,
      revision.revision::text
    FROM expected
    LEFT JOIN opportunity.cohort_source_revisions_v1 revision
      USING (source_key)
    ORDER BY expected.source_key
  `);
  if (
    result.rows.length !== 8 ||
    result.rows.some((row) => !/^\d+$/.test(row.revision))
  ) {
    throw new Error(
      "Opportunity shadow source revisions are incomplete; refusing an ambiguous comparison.",
    );
  }
  return Object.fromEntries(
    result.rows.map((row) => [row.source_key, row.revision]),
  );
}

async function featureProjectionReady(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ ready: boolean }>(
    `
      WITH current_revisions AS (
        SELECT jsonb_object_agg(
          source_key,
          revision
          ORDER BY source_key
        ) AS value
        FROM opportunity.cohort_source_revisions_v1
        WHERE source_key IN (
          'legacy.apps',
          'legacy.app_steam_tags',
          'legacy.steam_tags',
          'legacy.app_genres',
          'legacy.steam_genres',
          'legacy.latest_daily_metrics'
        )
      )
      SELECT EXISTS (
        SELECT 1
        FROM opportunity.cohort_feature_projection_state_v1 state
        CROSS JOIN current_revisions
        JOIN pg_class relation
          ON relation.oid =
            'opportunity.released_cohort_features_v2'::regclass
        WHERE state.singleton
          AND relation.relispopulated
          AND state.row_count > 0
          AND state.feature_projection_version = $1
          AND state.source_revisions = current_revisions.value
      ) AS ready
    `,
    [OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION],
  );
  return result.rows[0]?.ready === true;
}

async function refreshFeatureProjection(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query(
      "CALL opportunity.refresh_released_cohort_features_v2()",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function acquireFeatureSourceFence(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query("SET LOCAL lock_timeout = '2min'");
    await client.query(`
      LOCK TABLE
        legacy.apps,
        legacy.steam_genres,
        legacy.app_genres,
        legacy.steam_tags,
        legacy.app_steam_tags,
        legacy.latest_daily_metrics
      IN SHARE MODE
    `);
    return client;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
}

async function selectRun(client: PoolClient): Promise<RunRow> {
  const explicitRunId = process.env.OPPORTUNITY_SHADOW_RUN_ID?.trim() ?? null;
  const result = await client.query<RunRow>(
    `
      SELECT
        id,
        active_profile_versions,
        window_start,
        window_end,
        candidate_count,
        evaluated_count,
        result_count,
        pending_count,
        started_at,
        completed_at
      FROM opportunity.runs
      WHERE status = 'completed'
        AND run_kind = 'daily'
        AND ($1::uuid IS NULL OR id = $1)
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [explicitRunId],
  );
  const run = result.rows[0];
  if (!run) {
    throw new Error("No completed daily Opportunity run matched the shadow.");
  }
  return run;
}

async function runShadow(
  client: PoolClient,
  readOnlyPool: Pool,
  snapshotId: string,
  cachePool: Pool | null,
): Promise<Record<string, unknown>> {
  const limit = resultLimit();
  const inputStartedAt = performance.now();
  const run = await selectRun(client);
  const [eventRows, resultRows, profileRows] = await Promise.all([
    client.query<{ appid: number }>(
      `
        SELECT DISTINCT ON (appid) appid
        FROM opportunity.material_events
        WHERE observed_at >= $1
          AND observed_at < $2
        ORDER BY appid, observed_at DESC, id
        LIMIT 10000
      `,
      [run.window_start, run.window_end],
    ),
    client.query<{ appid: number }>(
      `
        SELECT appid
        FROM opportunity.results
        WHERE run_id = $1
        ORDER BY score DESC NULLS LAST, appid, id
        LIMIT $2
      `,
      [run.id, limit],
    ),
    client.query<ProfileRow>(
      `
        SELECT
          profile.id,
          version.id AS version_id,
          version.rules
        FROM opportunity.profile_versions version
        JOIN opportunity.profiles profile
          ON profile.id = version.profile_id
        WHERE version.id = ANY($1::uuid[])
        ORDER BY profile.id, version.version
        LIMIT 100
      `,
      [run.active_profile_versions],
    ),
  ]);
  const appids = eventRows.rows.map((row) => row.appid);
  const resultAppids = resultRows.rows.map((row) => row.appid);
  const productRepository = new OpportunityRepository(readOnlyPool);
  const workerRepository = new OpportunityWorkerRepository(readOnlyPool);
  const inputs = await productRepository.getRuleInputsShadow(appids, client);
  const inputPreparationMs = performance.now() - inputStartedAt;

  const inputParityStartedAt = performance.now();
  const legacyInputs = await productRepository.getRuleInputsLegacy(
    appids,
    client,
  );
  const legacyInputByAppid = new Map(
    legacyInputs.map((input) => [input.appid, input]),
  );
  const exactInputMatches = inputs.filter(
    (input) => digest(input) === digest(legacyInputByAppid.get(input.appid)),
  ).length;
  if (
    legacyInputs.length !== inputs.length ||
    exactInputMatches !== inputs.length
  ) {
    throw new Error(
      `Opportunity rule-input parity failed: ${exactInputMatches}/${inputs.length} exact matches against ${legacyInputs.length} legacy inputs.`,
    );
  }
  const inputParityMs = performance.now() - inputParityStartedAt;

  const profileStartedAt = performance.now();
  const candidateEvaluations = inputs.flatMap((input) =>
    profileRows.rows.map((profile) => ({
      appid: input.appid,
      evaluation: evaluateOpportunityProfile(profile.rules, input),
      profileId: profile.id,
      profileVersionId: profile.version_id,
    })),
  );
  const outcomeCounts = candidateEvaluations.reduce<
    Record<"eligible" | "ineligible" | "pending", number>
  >(
    (counts, candidate) => {
      counts[candidate.evaluation.outcome] += 1;
      return counts;
    },
    { eligible: 0, ineligible: 0, pending: 0 },
  );
  const profileEvaluationMs = performance.now() - profileStartedAt;

  const profileParityStartedAt = performance.now();
  const legacyEvaluations = legacyInputs.flatMap((input) =>
    profileRows.rows.map((profile) => ({
      appid: input.appid,
      evaluation: evaluateOpportunityProfile(profile.rules, input),
      profileId: profile.id,
      profileVersionId: profile.version_id,
    })),
  );
  const legacyEvaluationByKey = new Map(
    legacyEvaluations.map((candidate) => [
      `${candidate.appid}:${candidate.profileVersionId}`,
      candidate,
    ]),
  );
  const exactProfileEvaluationMatches = candidateEvaluations.filter(
    (candidate) =>
      digest(candidate) ===
      digest(
        legacyEvaluationByKey.get(
          `${candidate.appid}:${candidate.profileVersionId}`,
        ),
      ),
  ).length;
  if (
    legacyEvaluations.length !== candidateEvaluations.length ||
    exactProfileEvaluationMatches !== candidateEvaluations.length
  ) {
    throw new Error(
      `Opportunity profile-evaluation parity failed: ${exactProfileEvaluationMatches}/${candidateEvaluations.length} exact matches against ${legacyEvaluations.length} legacy evaluations.`,
    );
  }
  const profileParityMs = performance.now() - profileParityStartedAt;

  const inputByAppid = new Map(inputs.map((input) => [input.appid, input]));
  const resultInputs = resultAppids.flatMap((appid) => {
    const input = inputByAppid.get(appid);
    return input ? [input] : [];
  });
  const cohortStartedAt = performance.now();
  const cohorts = await workerRepository.getReleasedCohortsShadow(
    resultInputs,
    snapshotId,
  );
  const cohortResolutionMs = performance.now() - cohortStartedAt;
  const cacheValidation = cachePool
    ? await new OpportunityWorkerRepository(
        cachePool,
      ).roundTripReleasedCohortCacheShadow(resultInputs, cohorts, client)
    : null;

  const goldenSample = resultInputs.slice(0, Math.min(10, resultInputs.length));
  let legacySampleMatches = 0;
  for (const input of goldenSample) {
    const legacy = await workerRepository.getReleasedCohortShadow(
      input,
      snapshotId,
    );
    if (digest(legacy) === digest(cohorts.get(input.appid))) {
      legacySampleMatches += 1;
    }
  }

  const stored = await client.query<StoredCohortRow>(
    `
      SELECT
        appid,
        signature,
        fallback_tier,
        coverage,
        members,
        source_at
      FROM opportunity.cohort_snapshots
      WHERE run_id = $1
        AND appid = ANY($2::integer[])
        AND cohort_kind = 'released_market'
      ORDER BY appid
      LIMIT 5000
    `,
    [run.id, resultAppids],
  );
  let storedSnapshotMatches = 0;
  for (const row of stored.rows) {
    const generated = cohorts.get(row.appid);
    if (!generated) {
      continue;
    }
    const historical = {
      coverage: Number(row.coverage),
      fallbackTier: Number(row.fallback_tier),
      members: parseJson(row.members),
      signature: parseJson(row.signature),
      sourceAt: row.source_at ? iso(row.source_at) : null,
    };
    const current = {
      coverage: generated.coverage,
      fallbackTier: generated.fallbackTier,
      members: generated.members,
      signature: generated.signature,
      sourceAt: generated.sourceAt,
    };
    if (digest(historical) === digest(current)) {
      storedSnapshotMatches += 1;
    }
  }

  const marketStartedAt = performance.now();
  const marketResults = Array.from(cohorts, ([appid, cohort]) => {
    const market = calculateOpportunityMarketContext(cohort.members);
    const rank = calculateOpportunityRanking({
      components: {
        evidenceQuality: market.confidence === "high" ? 1 : 0.5,
        marketMomentum: market.demandDirection === "improving" ? 1 : 0.5,
        peerPosition: 0.5,
        signalStrength: 0.75,
        userFit: 0.8,
      },
      reasons: ["read-only production shadow"],
    });
    return { appid, market, rank };
  });
  const marketCalculationMs = performance.now() - marketStartedAt;

  const persistenceStartedAt = performance.now();
  const resultPayloads: unknown[] = [];
  for (let offset = 0; offset < marketResults.length; offset += 100) {
    resultPayloads.push(
      JSON.parse(JSON.stringify(marketResults.slice(offset, offset + 100))),
    );
  }
  const candidatePayloads: unknown[] = [];
  for (let offset = 0; offset < candidateEvaluations.length; offset += 500) {
    candidatePayloads.push(
      JSON.parse(
        JSON.stringify(candidateEvaluations.slice(offset, offset + 500)),
      ),
    );
  }
  const persistenceMs = performance.now() - persistenceStartedAt;
  const timings: OpportunityWorkerPhaseTimings = {
    cohortResolutionMs,
    inputPreparationMs,
    marketCalculationMs,
    persistenceMs,
    profileEvaluationMs,
    totalMs:
      inputPreparationMs +
      profileEvaluationMs +
      cohortResolutionMs +
      marketCalculationMs +
      persistenceMs,
  };
  const coldCacheFillTimings = cacheValidation
    ? {
        ...timings,
        cohortResolutionMs:
          cohortResolutionMs + cacheValidation.persistenceMs,
        totalMs: timings.totalMs + cacheValidation.persistenceMs,
      }
    : null;
  const warmCacheTimings = cacheValidation
    ? {
        ...timings,
        cohortResolutionMs: cacheValidation.readMs,
        totalMs:
          inputPreparationMs +
          profileEvaluationMs +
          cacheValidation.readMs +
          marketCalculationMs +
          persistenceMs,
      }
    : null;
  const measuredColdMs = coldCacheFillTimings?.totalMs ?? timings.totalMs;
  if (measuredColdMs > COLD_TARGET_MS) {
    throw new Error(
      `Opportunity cold shadow exceeded ${COLD_TARGET_MS}ms: ${measuredColdMs}ms.`,
    );
  }
  if (warmCacheTimings && warmCacheTimings.totalMs > WARM_TARGET_MS) {
    throw new Error(
      `Opportunity warm shadow exceeded ${WARM_TARGET_MS}ms: ${warmCacheTimings.totalMs}ms.`,
    );
  }

  return {
    candidateEvaluations: candidateEvaluations.length,
    cohortCount: cohorts.size,
    eventCandidateCount: appids.length,
    goldenLegacySample: {
      compared: goldenSample.length,
      exactMatches: legacySampleMatches,
    },
    outcomeCounts,
    profileCount: profileRows.rowCount,
    parity: {
      profileEvaluations: {
        compared: candidateEvaluations.length,
        exactMatches: exactProfileEvaluationMatches,
      },
      ruleInputs: {
        compared: inputs.length,
        exactMatches: exactInputMatches,
      },
      validationOverheadMs: {
        profileEvaluation: profileParityMs,
        ruleInput: inputParityMs,
      },
    },
    performanceTargets: {
      cold: {
        measuredMs: measuredColdMs,
        passed: true,
        targetMs: COLD_TARGET_MS,
      },
      warm: warmCacheTimings
        ? {
            measuredMs: warmCacheTimings.totalMs,
            passed: true,
            targetMs: WARM_TARGET_MS,
          }
        : null,
    },
    readOnly: cachePool === null,
    resultLimit: limit,
    run: {
      candidateCount: run.candidate_count,
      durationMs:
        new Date(run.completed_at).getTime() -
        new Date(run.started_at).getTime(),
      evaluatedCount: run.evaluated_count,
      pendingCount: run.pending_count,
      resultCount: run.result_count,
    },
    shadowPayloadDigest: digest({
      candidatePayloads,
      resultPayloads,
    }),
    ...(cacheValidation ? { cacheValidation } : {}),
    storedSnapshotParity: {
      compared: stored.rowCount,
      exactMatches: storedSnapshotMatches,
      note: "Historical snapshots can differ when cohort sources changed after the run.",
    },
    ...(coldCacheFillTimings ? { coldCacheFillTimings } : {}),
    timings,
    ...(warmCacheTimings ? { warmCacheTimings } : {}),
  };
}

async function main(): Promise<void> {
  const connectionString = requiredEnvironment("TIGER_PRIMARY_URL");
  const pool = new Pool({
    connectionString,
    max: 11,
    options: "-c default_transaction_read_only=on",
    statement_timeout: 120_000,
  });
  const refreshApproved =
    process.env.OPPORTUNITY_SHADOW_REFRESH_PROJECTION === "1";
  const validateCache = process.env.OPPORTUNITY_SHADOW_VALIDATE_CACHE === "1";
  if (validateCache && !refreshApproved) {
    throw new Error(
      "OPPORTUNITY_SHADOW_VALIDATE_CACHE=1 requires the separately approved projection refresh/write mode.",
    );
  }
  const refreshPool = refreshApproved
    ? new Pool({
        connectionString,
        max: 2,
        statement_timeout: 300_000,
      })
    : null;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let fenceClient: PoolClient | null = null;
      const client = await pool.connect();
      try {
        if (refreshPool) {
          fenceClient = await acquireFeatureSourceFence(refreshPool);
          await refreshFeatureProjection(refreshPool);
        }
        await client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        await client.query("SET LOCAL statement_timeout = '120s'");
        if (!(await featureProjectionReady(client))) {
          await client.query("ROLLBACK");
          if (attempt >= (refreshApproved ? 3 : 1)) {
            throw new Error(
              "Opportunity cohort feature projection is not current; rerun with OPPORTUNITY_SHADOW_REFRESH_PROJECTION=1 in an approved write window.",
            );
          }
          continue;
        }
        const beforeRevisions = await captureSourceRevisions(client);
        const snapshot = await client.query<{ snapshot_id: string }>(
          "SELECT pg_export_snapshot() AS snapshot_id",
        );
        const snapshotId = snapshot.rows[0]?.snapshot_id;
        if (!snapshotId) {
          throw new Error(
            "Tiger did not return an exported snapshot for the Opportunity shadow.",
          );
        }
        if (fenceClient) {
          await fenceClient.query("COMMIT");
          fenceClient.release();
          fenceClient = null;
        }
        const report = await runShadow(
          client,
          pool,
          snapshotId,
          validateCache ? refreshPool : null,
        );
        const afterRevisions = await captureSourceRevisions(client);
        if (digest(beforeRevisions) !== digest(afterRevisions)) {
          throw new Error(
            "Opportunity exported snapshot revisions changed unexpectedly.",
          );
        }
        await client.query("COMMIT");
        process.stdout.write(
          `${JSON.stringify(
            {
              ...report,
              projectionRefreshedForShadow: refreshApproved,
              sourceRevisionDigest: digest(beforeRevisions),
              sourceRevisionsStable: true,
            },
            null,
            2,
          )}\n`,
        );
        return;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        if (fenceClient) {
          await fenceClient.query("ROLLBACK").catch(() => undefined);
          fenceClient.release();
        }
        client.release();
      }
    }
    throw new Error(
      "Opportunity shadow did not obtain a current exported snapshot.",
    );
  } finally {
    await refreshPool?.end();
    await pool.end();
  }
}

await main();
