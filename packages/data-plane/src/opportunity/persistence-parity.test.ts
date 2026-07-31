import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  OPPORTUNITY_BULK_PERSISTENCE_VERSION,
  OPPORTUNITY_COHORT_CACHE_VERSION,
  OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
  OPPORTUNITY_COHORT_RESOLVER_VERSION,
  OPPORTUNITY_COHORT_VERSION,
  OPPORTUNITY_MARKET_VERSION,
  OPPORTUNITY_RANKING_VERSION,
  OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityProfileEvaluation,
  type OpportunityRuleSet,
} from "./types.js";
import {
  type OpportunityCandidateEvaluation,
  type OpportunityEvaluatedResult,
  type OpportunityRunContext,
  type OpportunityWorkerProfile,
  OpportunityWorkerRepository,
} from "./worker-repository.js";

interface RecordedPersistence {
  candidateContracts: string[];
  candidates: Array<Record<string, unknown>>;
  cohorts: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  dismissalResets: number[];
  markets: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  queries: string[];
  rankingUpdates: number;
  results: Array<Record<string, unknown>>;
  runSummary: Record<string, unknown> | null;
  scheduleUpdates: number;
  transaction: "open" | "committed" | "rolled_back" | null;
  workCompletions: number;
}

const PROFILE_A_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_A_VERSION_ID = "20000000-0000-4000-8000-000000000001";
const PROFILE_B_ID = "10000000-0000-4000-8000-000000000002";
const PROFILE_B_VERSION_ID = "20000000-0000-4000-8000-000000000002";
const RUN_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "50000000-0000-4000-8000-000000000001";

const RULES: OpportunityRuleSet = {
  excluded: [],
  preferred: [],
  required: [],
  schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
};

const PROFILE_A: OpportunityWorkerProfile = {
  eventSubscriptions: ["release", "taxonomy"],
  id: PROFILE_A_ID,
  immediateFullMatchEnabled: false,
  name: "Daily profile",
  rules: RULES,
  timezone: "UTC",
  versionId: PROFILE_A_VERSION_ID,
  versionNumber: 4,
};

const PROFILE_B: OpportunityWorkerProfile = {
  eventSubscriptions: ["reviews"],
  id: PROFILE_B_ID,
  immediateFullMatchEnabled: true,
  name: "Immediate profile",
  rules: RULES,
  timezone: "UTC",
  versionId: PROFILE_B_VERSION_ID,
  versionNumber: 7,
};

const CHANNEL_PREFERENCES = [
  {
    channel: "email" as const,
    id: "60000000-0000-4000-8000-000000000001",
    max_results: 1,
    profile_id: PROFILE_A_ID,
    quiet_day_behavior: "skip" as const,
  },
  {
    channel: "email" as const,
    id: "60000000-0000-4000-8000-000000000002",
    max_results: 2,
    profile_id: null,
    quiet_day_behavior: "send_empty" as const,
  },
  {
    channel: "slack" as const,
    id: "60000000-0000-4000-8000-000000000003",
    max_results: 1,
    profile_id: "10000000-0000-4000-8000-000000000099",
    quiet_day_behavior: "skip" as const,
  },
];

const BASE_CALCULATION_VERSIONS = {
  cohort: OPPORTUNITY_COHORT_VERSION,
  market: OPPORTUNITY_MARKET_VERSION,
  materiality: "opportunity-materiality/v1",
  ranking: OPPORTUNITY_RANKING_VERSION,
  rules: OPPORTUNITY_RULE_SCHEMA_VERSION,
  signals: "signal-windows/v1",
};

function parseJson(value: unknown): unknown {
  assert.equal(typeof value, "string");
  return JSON.parse(value as string);
}

function evaluation(
  outcome: OpportunityProfileEvaluation["outcome"],
  preferenceContribution: number,
  missingRequiredFields: OpportunityProfileEvaluation["missingRequiredFields"] = [],
): OpportunityProfileEvaluation {
  const state =
    outcome === "pending"
      ? "unknown"
      : outcome === "eligible"
        ? "true"
        : "false";
  return {
    excluded: false,
    excludedOutcomes: [],
    missingRequiredFields,
    outcome,
    preferenceContribution,
    preferredOutcomes: [
      {
        clauseOutcomes: [
          {
            actualValue: 84,
            clauseId: "preferred-review-score",
            comparisonValue: 80,
            confidence: "high",
            evidenceClass: "observed_fact",
            explanation: "Review score is above the preferred threshold.",
            field: "positive_percentage",
            operator: "greater_than_or_equal",
            source: "metrics.apps_page_projection",
            sourceAt: "2026-07-28T18:00:00.000Z",
            state: "true",
          },
        ],
        contribution: preferenceContribution,
        groupId: "preferred-quality",
        importance: "high",
        label: "Quality",
        operator: "all",
        state: "true",
      },
    ],
    requiredOutcomes: [
      {
        clauseOutcomes: [
          {
            actualValue: outcome === "pending" ? null : true,
            clauseId: "required-released",
            comparisonValue: true,
            confidence: outcome === "pending" ? "directional" : "high",
            evidenceClass: "observed_fact",
            explanation:
              outcome === "pending"
                ? "Release state is not ready."
                : "Release state is known.",
            field: "is_released",
            operator: "equals",
            source: outcome === "pending" ? null : "steam_storefront",
            sourceAt: outcome === "pending" ? null : "2026-07-28T17:00:00.000Z",
            state,
          },
        ],
        groupId: "required-release",
        label: "Released",
        operator: "all",
        state,
      },
    ],
  };
}

function result(
  appid: number,
  score: number,
  profiles: OpportunityWorkerProfile[],
): OpportunityEvaluatedResult {
  const evaluations = new Map<
    OpportunityWorkerProfile,
    OpportunityProfileEvaluation
  >(
    profiles.map((profile, index) => [
      profile,
      evaluation("eligible", 0.25 + index * 0.1),
    ]),
  );
  return {
    appid,
    cohort: {
      confidence: "high",
      coverage: 0.75,
      fallbackTier: 2,
      members: [
        {
          appid: appid + 1000,
          ccuPeak: 120,
          inclusionReasons: ["shared genre", "price band"],
          inclusionScore: 0.91,
          name: `Peer ${appid}`,
          positivePercentage: 88,
          priceCents: 1_999,
          reviewsAdded30d: 24,
          totalReviews: 3_400,
        },
        {
          appid: appid + 2000,
          ccuPeak: null,
          inclusionReasons: ["shared tags"],
          inclusionScore: 0.78,
          name: `Directional peer ${appid}`,
          positivePercentage: null,
          priceCents: 2_499,
          reviewsAdded30d: null,
          totalReviews: null,
        },
      ],
      signature: {
        businessModel: "premium",
        genres: [1, 23],
        priceBand: "mid",
        tags: [492, 1667],
      },
      sourceAt: "2026-07-28T18:30:00.000Z",
    },
    confidence: "high",
    event: {
      appid,
      createsDailyResult: true,
      effectiveAt: "2026-07-28T18:45:00.000Z",
      eligibleForImmediate: true,
      eventFingerprint: `event-fingerprint-${appid}`,
      eventType: "material_change",
      id: `70000000-0000-4000-8000-${String(appid).padStart(12, "0")}`,
      materiality: 0.84,
      observedAt: "2026-07-28T18:50:00.000Z",
      reevaluateEligibility: true,
      signalFamily: "taxonomy",
    },
    eventLabel: "materially_changed",
    evidenceItems: [
      {
        label: "Review score",
        source: "metrics.apps_page_projection",
        value: 84,
      },
      { label: "CCU peak", source: "metrics.apps_page_projection", value: 120 },
    ],
    market: {
      confidence: "high",
      concentration: { topOneShare: 0.31, warning: null },
      demandDirection: "improving",
      distributions: {
        ccuPeak: { measured: 1, p25: 90, p50: 120, p75: 150, p90: 180 },
        reviewsAdded30d: {
          measured: 1,
          p25: 18,
          p50: 24,
          p75: 30,
          p90: 36,
        },
        totalReviews: {
          measured: 1,
          p25: 2_500,
          p50: 3_400,
          p75: 4_300,
          p90: 5_200,
        },
      },
      explanation: ["Demand is improving with moderate concentration."],
      marketVersion: OPPORTUNITY_MARKET_VERSION,
      potentialBand: "meaningful",
      supply: { measuredGames: 1, releasedGames: 2 },
    },
    matches: profiles.map((profile) => ({
      evaluation: evaluations.get(profile)!,
      profile,
    })),
    missingEvidence: ["reviews_added_7d"],
    profileVersionSetFingerprint: "profile-version-set-v1",
    rank: {
      components: {
        evidenceQuality: 0.9,
        marketMomentum: 0.8,
        peerPosition: 0.7,
        signalStrength: 0.85,
        userFit: 0.75,
      },
      finalScore: score,
      rankingVersion: OPPORTUNITY_RANKING_VERSION,
      reasons: ["Strong evidence", "Improving market"],
      weights: {
        evidenceQuality: 0.2,
        marketMomentum: 0.2,
        peerPosition: 0.15,
        signalStrength: 0.2,
        userFit: 0.25,
      },
    },
    reappearedAfterResultId: null,
    sourceTimestamps: {
      "metrics.apps_page_projection": "2026-07-28T18:00:00.000Z",
      steam_storefront: "2026-07-28T17:00:00.000Z",
    },
    strongestEvidence: ["Strong evidence", "Improving market"],
    whyNow: `App ${appid} materially changed.`,
  };
}

function emptyRecording(): RecordedPersistence {
  return {
    candidateContracts: [],
    candidates: [],
    cohorts: [],
    deliveries: [],
    dismissalResets: [],
    markets: [],
    matches: [],
    queries: [],
    rankingUpdates: 0,
    results: [],
    runSummary: null,
    scheduleUpdates: 0,
    transaction: null,
    workCompletions: 0,
  };
}

function candidateContract(sql: string): string {
  return [
    sql.includes("first_pending_at"),
    sql.includes("interval '72 hours'"),
    sql.includes("interval '30 minutes'"),
    sql.includes("readiness_deadline <= now()"),
    sql.includes("COALESCE("),
    sql.includes("THEN 'readiness_expired'"),
  ].join(":");
}

class RecordingDatabase {
  readonly state = emptyRecording();

  readonly client = {
    query: this.query.bind(this),
    release() {},
  } as unknown as PoolClient;

  readonly pool = {
    connect: async () => this.client,
  } as unknown as Pool;

  private resultId(appid: number): string {
    return `80000000-0000-4000-8000-${String(appid).padStart(12, "0")}`;
  }

  private recordBulkResultPayload(
    payload: Array<Record<string, unknown>>,
    cohortVersion: unknown,
    marketVersion: unknown,
  ): void {
    for (const row of payload) {
      const appid = Number(row.appid);
      const cohort = row.cohort as Record<string, unknown>;
      const market = row.market as Record<string, unknown>;
      const resultId = this.resultId(appid);
      this.state.cohorts.push({
        appid,
        cohort_version: cohortVersion,
        coverage: cohort.coverage,
        fallback_tier: cohort.fallbackTier,
        measured_count: cohort.measuredCount,
        member_count: (cohort.members as unknown[]).length,
        members: cohort.members,
        signature: cohort.signature,
        source_at: cohort.sourceAt,
      });
      this.state.markets.push({
        appid,
        calculation_version: marketVersion,
        concentration: market.concentration,
        confidence: market.confidence,
        demand_direction: { state: market.demandDirection },
        distributions: market.distributions,
        explanation: market.explanation,
        potential_band: market.potentialBand,
        source_at: cohort.sourceAt,
        supply: market.supply,
      });
      this.state.results.push({
        appid,
        calculation_versions: row.calculation_versions,
        confidence: row.confidence,
        event_fingerprint: row.event_fingerprint,
        event_label: row.event_label,
        evidence_summary: row.evidence_summary,
        material_event_id: row.material_event_id,
        missing_evidence: row.missing_evidence,
        profile_version_set_fingerprint: row.profile_version_set_fingerprint,
        rank_components: row.rank_components,
        reappeared_after_result_id: row.reappeared_after_result_id,
        rule_evidence: row.rule_evidence,
        score: row.score,
        source_timestamps: row.source_timestamps,
        why_now: row.why_now,
      });
      for (const match of row.matches as Array<Record<string, unknown>>) {
        this.state.matches.push({
          ...match,
          eligibility_outcome: "eligible",
          result_id: resultId,
        });
      }
      this.state.dismissalResets.push(appid);
    }
  }

  private resultRows(): Array<{ id: string; profile_ids: string[] }> {
    return [...this.state.results]
      .sort(
        (left, right) =>
          Number(right.score) - Number(left.score) ||
          Number(left.appid) - Number(right.appid),
      )
      .map((result) => {
        const id = this.resultId(Number(result.appid));
        return {
          id,
          profile_ids: [
            ...new Set(
              this.state.matches
                .filter((match) => match.result_id === id)
                .map((match) => String(match.profile_id)),
            ),
          ],
        };
      });
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    const sql = text.replace(/\s+/g, " ").trim();
    this.state.queries.push(sql);
    if (sql === "BEGIN") {
      this.state.transaction = "open";
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      this.state.transaction = "committed";
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      this.state.transaction = "rolled_back";
      return { rows: [] };
    }

    if (sql.startsWith("WITH payload AS MATERIALIZED")) {
      const payload = parseJson(values[3]) as Array<Record<string, unknown>>;
      this.recordBulkResultPayload(payload, values[4], values[5]);
      return {
        rows: [{ created_count: payload.length } as unknown as Row],
      };
    }

    if (
      sql.startsWith("INSERT INTO opportunity.cohort_snapshots") &&
      sql.includes("VALUES")
    ) {
      this.state.cohorts.push({
        appid: values[1],
        cohort_version: OPPORTUNITY_COHORT_VERSION,
        coverage: values[6],
        fallback_tier: values[3],
        measured_count: values[5],
        member_count: values[4],
        members: parseJson(values[7]),
        signature: parseJson(values[2]),
        source_at: values[8],
      });
      return {
        rows: [{ id: `cohort-${String(values[1])}` } as unknown as Row],
      };
    }

    if (sql.startsWith("INSERT INTO opportunity.market_context_snapshots")) {
      this.state.markets.push({
        appid: values[1],
        calculation_version: OPPORTUNITY_MARKET_VERSION,
        concentration: parseJson(values[6]),
        confidence: values[8],
        demand_direction: parseJson(values[4]),
        distributions: parseJson(values[3]),
        explanation: parseJson(values[9]),
        potential_band: values[7],
        source_at: values[10],
        supply: parseJson(values[5]),
      });
      return {
        rows: [{ id: `market-${String(values[1])}` } as unknown as Row],
      };
    }

    if (sql.startsWith("INSERT INTO opportunity.results")) {
      this.state.results.push({
        appid: values[3],
        calculation_versions: parseJson(values[14]),
        confidence: values[16],
        event_fingerprint: values[6],
        event_label: values[5],
        evidence_summary: parseJson(values[12]),
        material_event_id: values[4],
        missing_evidence: parseJson(values[15]),
        profile_version_set_fingerprint: values[7],
        rank_components: parseJson(values[9]),
        reappeared_after_result_id: values[19],
        rule_evidence: parseJson(values[10]),
        score: values[8],
        source_timestamps: parseJson(values[13]),
        why_now: parseJson(values[11]),
      });
      return {
        rows: [{ id: this.resultId(Number(values[3])) } as unknown as Row],
      };
    }

    if (sql.startsWith("UPDATE opportunity.user_game_state")) {
      this.state.dismissalResets.push(Number(values[2]));
      return { rows: [] };
    }

    if (sql.startsWith("INSERT INTO opportunity.result_profile_matches")) {
      this.state.matches.push({
        delivery_urgency: values[5],
        eligibility_outcome: "eligible",
        preference_score: values[4],
        profile_id: values[1],
        profile_version_id: values[2],
        result_id: values[0],
        rule_outcomes: parseJson(values[3]),
      });
      return { rows: [] };
    }

    if (sql.startsWith("INSERT INTO opportunity.candidate_state")) {
      this.state.candidateContracts.push(candidateContract(sql));
      if (sql.includes("jsonb_to_recordset")) {
        const payload = parseJson(values[2]) as Array<Record<string, unknown>>;
        this.state.candidates.push(...payload);
      } else {
        this.state.candidates.push({
          appid: values[2],
          last_outcome: parseJson(values[7]),
          material_event_id: values[4],
          missing_fields: values[6],
          profile_version_id: values[3],
          state: values[5],
        });
      }
      return { rows: [] };
    }

    if (sql.startsWith("WITH ranked AS")) {
      this.state.rankingUpdates += 1;
      return { rows: [] };
    }

    if (
      sql.startsWith("SELECT result.id") &&
      sql.includes("LEFT JOIN opportunity.result_profile_matches")
    ) {
      return { rows: this.resultRows() as unknown as Row[] };
    }

    if (sql.includes("FROM opportunity.channel_preferences")) {
      return { rows: CHANNEL_PREFERENCES as unknown as Row[] };
    }

    if (sql.startsWith("INSERT INTO opportunity.deliveries")) {
      if (sql.includes("jsonb_to_recordset")) {
        const deliveries = parseJson(values[3]) as Array<
          Record<string, unknown>
        >;
        this.state.deliveries.push(...deliveries);
      } else {
        this.state.deliveries.push({
          channel: values[3],
          delivery_kind: values[4],
          idempotency_key: values[9],
          preference_id: values[7],
          rendered_payload: parseJson(values[8]),
          result_ids: values[6],
          status: values[5],
        });
      }
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE opportunity.runs")) {
      this.state.runSummary = {
        candidate_count: values[1],
        coverage_warnings: parseJson(values[5]),
        evaluated_count: values[2],
        pending_count: values[4],
        result_count: values[3],
      };
      if (values.length > 6) {
        this.state.runSummary.phase_timings = parseJson(values[6]);
      }
      return { rows: [] };
    }

    if (sql.startsWith("WITH personal_schedule AS")) {
      this.state.scheduleUpdates += 1;
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE opportunity.work_queue")) {
      this.state.workCompletions += 1;
      return { rows: [] };
    }

    throw new Error(`Unhandled persistence query: ${sql}`);
  }
}

function sortRecords(
  records: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [...records].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

function commonCalculationVersions(
  versions: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(BASE_CALCULATION_VERSIONS).map((key) => [key, versions[key]]),
  );
}

function canonicalState(state: RecordedPersistence): Record<string, unknown> {
  return {
    candidateContracts: [...new Set(state.candidateContracts)],
    candidates: sortRecords(state.candidates),
    cohorts: sortRecords(state.cohorts),
    deliveries: sortRecords(state.deliveries),
    dismissalResets: [...state.dismissalResets].sort(
      (left, right) => left - right,
    ),
    markets: sortRecords(state.markets),
    matches: sortRecords(state.matches),
    rankingUpdates: state.rankingUpdates,
    results: sortRecords(
      state.results.map((result) => ({
        ...result,
        calculation_versions: commonCalculationVersions(
          result.calculation_versions as Record<string, unknown>,
        ),
      })),
    ),
    runSummary:
      state.runSummary === null
        ? null
        : {
            candidate_count: state.runSummary.candidate_count,
            coverage_warnings: state.runSummary.coverage_warnings,
            evaluated_count: state.runSummary.evaluated_count,
            pending_count: state.runSummary.pending_count,
            result_count: state.runSummary.result_count,
          },
    scheduleUpdates: state.scheduleUpdates,
    transaction: state.transaction,
    workCompletions: state.workCompletions,
  };
}

function fixture(kind: OpportunityRunContext["kind"]): {
  evaluations: OpportunityCandidateEvaluation[];
  pending: OpportunityCandidateEvaluation[];
  results: OpportunityEvaluatedResult[];
  run: OpportunityRunContext;
} {
  const eligibleA = evaluation("eligible", 0.25);
  const eligibleB = evaluation("eligible", 0.35);
  const pending = evaluation("pending", 0, ["release_date", "is_released"]);
  const ineligible = evaluation("ineligible", 0);
  return {
    evaluations: [
      {
        appid: 101,
        evaluation: eligibleA,
        eventId: "70000000-0000-4000-8000-000000000101",
        profile: PROFILE_A,
      },
      {
        appid: 101,
        evaluation: eligibleB,
        eventId: "70000000-0000-4000-8000-000000000101",
        profile: PROFILE_B,
      },
      {
        appid: 202,
        evaluation: ineligible,
        eventId: "70000000-0000-4000-8000-000000000202",
        profile: PROFILE_A,
      },
      {
        appid: 303,
        evaluation: pending,
        eventId: null,
        profile: PROFILE_B,
      },
    ],
    pending: [
      {
        appid: 303,
        evaluation: pending,
        eventId: null,
        profile: PROFILE_B,
      },
    ],
    results: [
      result(101, 0.93, [PROFILE_A, PROFILE_B]),
      result(202, 0.81, [PROFILE_B]),
    ],
    run: {
      id: RUN_ID,
      kind,
      windowEnd: "2026-07-29T00:00:00.000Z",
      windowStart: "2026-07-28T00:00:00.000Z",
    },
  };
}

describe("opportunity bulk persistence golden parity", () => {
  for (const kind of ["daily", "immediate"] as const) {
    it(`preserves canonical ${kind} publication semantics`, async () => {
      const legacyDatabase = new RecordingDatabase();
      const bulkDatabase = new RecordingDatabase();
      const legacyRepository = new OpportunityWorkerRepository(
        legacyDatabase.pool,
      );
      const bulkRepository = new OpportunityWorkerRepository(bulkDatabase.pool);
      const params = {
        ...fixture(kind),
        userId: USER_ID,
        websiteBaseUrl: "https://publisheriq.example/",
        workId: 97,
        workerId: "opportunity-worker-parity",
        workspaceId: WORKSPACE_ID,
      };

      await legacyRepository.persistRunOutcomeLegacy(params);
      const timings = await bulkRepository.persistRunOutcome({
        ...params,
        phaseTimings: {
          cohortResolutionMs: 12,
          inputPreparationMs: 11,
          marketCalculationMs: 14,
          profileEvaluationMs: 13,
        },
      });

      assert.deepEqual(
        canonicalState(bulkDatabase.state),
        canonicalState(legacyDatabase.state),
      );
      assert.deepEqual(
        commonCalculationVersions(
          bulkDatabase.state.results[0]!.calculation_versions as Record<
            string,
            unknown
          >,
        ),
        BASE_CALCULATION_VERSIONS,
      );
      assert.deepEqual(bulkDatabase.state.results[0]!.calculation_versions, {
        ...BASE_CALCULATION_VERSIONS,
        bulkPersistence: OPPORTUNITY_BULK_PERSISTENCE_VERSION,
        cohortCache: OPPORTUNITY_COHORT_CACHE_VERSION,
        cohortFeatureProjection: OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
        cohortResolver: OPPORTUNITY_COHORT_RESOLVER_VERSION,
        ruleInputProjection: OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
      });
      assert.equal(timings.inputPreparationMs, 11);
      assert.equal(timings.profileEvaluationMs, 13);
      assert.equal(timings.cohortResolutionMs, 12);
      assert.equal(timings.marketCalculationMs, 14);
      assert.ok(timings.persistenceMs >= 0);
      assert.equal(timings.totalMs, 50 + timings.persistenceMs);
      assert.deepEqual(bulkDatabase.state.runSummary?.phase_timings, timings);

      const legacyWriteCount = legacyDatabase.state.queries.filter((query) =>
        /^(INSERT|UPDATE|WITH ranked|WITH personal_schedule)/.test(query),
      ).length;
      const bulkWriteCount = bulkDatabase.state.queries.filter((query) =>
        /^(INSERT|UPDATE|WITH payload|WITH ranked|WITH personal_schedule)/.test(
          query,
        ),
      ).length;
      assert.ok(
        bulkWriteCount < legacyWriteCount,
        `expected bulk writes (${bulkWriteCount}) below legacy writes (${legacyWriteCount})`,
      );
    });
  }
});
