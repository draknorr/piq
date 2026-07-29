import { performance } from "node:perf_hooks";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  OPPORTUNITY_MARKET_VERSION,
  OPPORTUNITY_RANKING_VERSION,
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityProfileEvaluation,
  type OpportunityRuleSet,
} from "../opportunity/types.js";
import {
  type OpportunityCandidateEvaluation,
  type OpportunityEvaluatedResult,
  type OpportunityWorkerProfile,
  OpportunityWorkerRepository,
} from "../opportunity/worker-repository.js";

const PROFILE_ID = "10000000-0000-4000-8000-000000000097";
const PROFILE_VERSION_ID = "20000000-0000-4000-8000-000000000097";
const RUN_ID = "30000000-0000-4000-8000-000000000097";
const USER_ID = "40000000-0000-4000-8000-000000000097";
const WORKSPACE_ID = "50000000-0000-4000-8000-000000000097";
const RESULT_ID = "60000000-0000-4000-8000-000000000097";
const PREFERENCE_ID = "70000000-0000-4000-8000-000000000097";
const MATERIAL_EVENT_ID = "80000000-0000-4000-8000-000000000097";

interface PlanValidationReport {
  plannedStatementCount: number;
  plannedStatements: string[];
  readOnly: true;
  totalMs: number;
  transactionCommitted: boolean;
}

function requiredEnvironment(name: "TIGER_PRIMARY_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

const RULES: OpportunityRuleSet = {
  excluded: [],
  preferred: [],
  required: [],
  schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
};

const PROFILE: OpportunityWorkerProfile = {
  eventSubscriptions: ["taxonomy"],
  id: PROFILE_ID,
  immediateFullMatchEnabled: true,
  name: "Persistence plan validation",
  rules: RULES,
  versionId: PROFILE_VERSION_ID,
  versionNumber: 1,
};

function evaluation(
  outcome: OpportunityProfileEvaluation["outcome"],
  missingRequiredFields: OpportunityProfileEvaluation["missingRequiredFields"] = [],
): OpportunityProfileEvaluation {
  return {
    excluded: false,
    excludedOutcomes: [],
    missingRequiredFields,
    outcome,
    preferenceContribution: outcome === "eligible" ? 0.5 : 0,
    preferredOutcomes: [],
    requiredOutcomes: [],
  };
}

function fixture(): {
  evaluations: OpportunityCandidateEvaluation[];
  pending: OpportunityCandidateEvaluation[];
  results: OpportunityEvaluatedResult[];
} {
  const eligible = evaluation("eligible");
  const ineligible = evaluation("ineligible");
  const pending = evaluation("pending", ["is_released", "release_date"]);
  return {
    evaluations: [
      {
        appid: 97,
        evaluation: eligible,
        eventId: MATERIAL_EVENT_ID,
        profile: PROFILE,
      },
      {
        appid: 98,
        evaluation: ineligible,
        eventId: MATERIAL_EVENT_ID,
        profile: PROFILE,
      },
      {
        appid: 99,
        evaluation: pending,
        eventId: null,
        profile: PROFILE,
      },
    ],
    pending: [
      {
        appid: 99,
        evaluation: pending,
        eventId: null,
        profile: PROFILE,
      },
    ],
    results: [
      {
        appid: 97,
        cohort: {
          confidence: "high",
          coverage: 1,
          fallbackTier: 1,
          members: [
            {
              appid: 9_700,
              ccuPeak: 120,
              inclusionReasons: ["shared taxonomy"],
              inclusionScore: 0.9,
              name: "Plan validation peer",
              positivePercentage: 88,
              priceCents: 1_999,
              reviewsAdded30d: 24,
              totalReviews: 3_400,
            },
          ],
          signature: {
            businessModel: "premium",
            genres: [1],
            price: 1_999,
            tags: [492],
          },
          sourceAt: "2026-07-28T18:30:00.000Z",
        },
        confidence: "high",
        event: {
          appid: 97,
          createsDailyResult: true,
          effectiveAt: "2026-07-28T18:45:00.000Z",
          eligibleForImmediate: true,
          eventFingerprint: "persistence-plan-event-97",
          eventType: "material_change",
          id: MATERIAL_EVENT_ID,
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
            value: 88,
          },
        ],
        market: {
          confidence: "high",
          concentration: { topOneShare: 1, warning: null },
          demandDirection: "improving",
          distributions: {
            ccuPeak: {
              measured: 1,
              p25: 120,
              p50: 120,
              p75: 120,
              p90: 120,
            },
            reviewsAdded30d: {
              measured: 1,
              p25: 24,
              p50: 24,
              p75: 24,
              p90: 24,
            },
            totalReviews: {
              measured: 1,
              p25: 3_400,
              p50: 3_400,
              p75: 3_400,
              p90: 3_400,
            },
          },
          explanation: ["Read-only SQL plan validation fixture."],
          marketVersion: OPPORTUNITY_MARKET_VERSION,
          potentialBand: "meaningful",
          supply: { measuredGames: 1, releasedGames: 1 },
        },
        matches: [{ evaluation: eligible, profile: PROFILE }],
        missingEvidence: [],
        profileVersionSetFingerprint: "persistence-plan-profile-set",
        rank: {
          components: {
            evidenceQuality: 0.9,
            marketMomentum: 0.8,
            peerPosition: 0.7,
            signalStrength: 0.85,
            userFit: 0.75,
          },
          finalScore: 0.83,
          rankingVersion: OPPORTUNITY_RANKING_VERSION,
          reasons: ["Read-only SQL plan validation"],
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
          "metrics.apps_page_projection": "2026-07-28T18:30:00.000Z",
        },
        strongestEvidence: ["Review score"],
        whyNow: "The read-only publication plan must remain valid.",
      },
    ],
  };
}

function statementName(sql: string): string {
  if (sql.startsWith("WITH payload AS MATERIALIZED")) {
    return "result/cohort/market/profile-match publication";
  }
  if (sql.startsWith("INSERT INTO opportunity.candidate_state")) {
    return "candidate-state publication";
  }
  if (sql.startsWith("WITH ranked AS")) {
    return "result ranking";
  }
  if (
    sql.startsWith("SELECT result.id") &&
    sql.includes("LEFT JOIN opportunity.result_profile_matches")
  ) {
    return "delivery result selection";
  }
  if (sql.includes("FROM opportunity.channel_preferences")) {
    return "delivery preference selection";
  }
  if (sql.startsWith("INSERT INTO opportunity.deliveries")) {
    return "delivery publication";
  }
  if (sql.startsWith("WITH personal_schedule AS")) {
    return "profile schedule advancement";
  }
  if (sql.startsWith("UPDATE opportunity.work_queue")) {
    return "work completion";
  }
  if (sql.startsWith("UPDATE opportunity.runs")) {
    return "run completion";
  }
  throw new Error(`Unexpected Opportunity persistence statement: ${sql}`);
}

class PlanOnlyClient {
  readonly plannedStatements: string[] = [];
  transactionCommitted = false;

  constructor(private readonly client: PoolClient) {}

  release(): void {
    this.client.release();
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql === "BEGIN") {
      await this.client.query("BEGIN TRANSACTION READ ONLY");
      const mode = await this.client.query<{ transaction_read_only: string }>(
        "SHOW transaction_read_only",
      );
      if (mode.rows[0]?.transaction_read_only !== "on") {
        throw new Error(
          "Opportunity persistence plan validation did not enter a read-only transaction.",
        );
      }
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      await this.client.query("COMMIT");
      this.transactionCommitted = true;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      await this.client.query("ROLLBACK");
      return { rows: [] };
    }

    const name = statementName(sql);
    await this.client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${text}`, values);
    this.plannedStatements.push(name);

    if (name === "result/cohort/market/profile-match publication") {
      return { rows: [{ created_count: 1 } as unknown as Row] };
    }
    if (name === "delivery result selection") {
      return {
        rows: [
          {
            id: RESULT_ID,
            profile_ids: [PROFILE_ID],
          } as unknown as Row,
        ],
      };
    }
    if (name === "delivery preference selection") {
      return {
        rows: [
          {
            channel: "email",
            id: PREFERENCE_ID,
            max_results: 1,
            profile_id: PROFILE_ID,
            quiet_day_behavior: "skip",
          } as unknown as Row,
        ],
      };
    }
    return { rows: [] };
  }
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  const pool = new Pool({
    connectionString: requiredEnvironment("TIGER_PRIMARY_URL"),
    max: 1,
    options:
      "-c default_transaction_read_only=on -c lock_timeout=3000 -c statement_timeout=30000",
    statement_timeout: 30_000,
  });
  let planningClient: PlanOnlyClient | null = null;
  try {
    const planningPool = {
      async connect(): Promise<PoolClient> {
        planningClient = new PlanOnlyClient(await pool.connect());
        return planningClient as unknown as PoolClient;
      },
    } as unknown as Pool;
    const repository = new OpportunityWorkerRepository(planningPool);
    const persistenceFixture = fixture();
    await repository.persistRunOutcome({
      ...persistenceFixture,
      phaseTimings: {
        cohortResolutionMs: 1,
        inputPreparationMs: 1,
        marketCalculationMs: 1,
        profileEvaluationMs: 1,
      },
      run: {
        id: RUN_ID,
        kind: "daily",
        windowEnd: "2026-07-29T00:00:00.000Z",
        windowStart: "2026-07-28T00:00:00.000Z",
      },
      userId: USER_ID,
      websiteBaseUrl: "https://publisheriq.com",
      workId: 97,
      workerId: "opportunity-persistence-plan-validation",
      workspaceId: WORKSPACE_ID,
    });
    const validatedClient = planningClient as PlanOnlyClient | null;
    if (!validatedClient) {
      throw new Error(
        "Opportunity persistence plan validation did not acquire a client.",
      );
    }
    const expectedStatements = [
      "result/cohort/market/profile-match publication",
      "candidate-state publication",
      "result ranking",
      "delivery result selection",
      "delivery preference selection",
      "delivery publication",
      "profile schedule advancement",
      "work completion",
      "run completion",
    ];
    if (
      JSON.stringify(validatedClient.plannedStatements) !==
      JSON.stringify(expectedStatements)
    ) {
      throw new Error(
        `Opportunity persistence plan coverage changed: ${JSON.stringify(validatedClient.plannedStatements)}.`,
      );
    }
    const report: PlanValidationReport = {
      plannedStatementCount: validatedClient.plannedStatements.length,
      plannedStatements: validatedClient.plannedStatements,
      readOnly: true,
      totalMs: performance.now() - startedAt,
      transactionCommitted: validatedClient.transactionCommitted,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

await main();
