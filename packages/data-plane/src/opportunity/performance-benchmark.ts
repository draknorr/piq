import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  calculateOpportunityMarketContext,
  calculateOpportunityRanking,
  calculateOpportunityReviewPriority,
} from "./intelligence.js";
import { assertOpportunityRuleInputComplete } from "./repository.js";
import { evaluateOpportunityProfile } from "./rules.js";
import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityCohortMember,
  type OpportunityEvaluationInput,
  type OpportunityFieldValue,
  type OpportunityRankingPolicy,
  type OpportunityRuleField,
  type OpportunityRuleSet,
  type OpportunityWorkerPhaseTimings,
} from "./types.js";

export const OPPORTUNITY_PRODUCTION_SCALE_FIXTURE = {
  candidateCount: 3_974,
  profileCount: 3,
  surfacedResultCount: 1_245,
} as const;

export interface OpportunityPerformanceBenchmarkPass {
  cacheHits: number;
  cacheMisses: number;
  candidateEvaluations: number;
  candidatePersistenceBatches: number;
  mode: "cold" | "warm";
  outputDigest: string;
  resultPersistenceBatches: number;
  surfacedResults: number;
  timings: OpportunityWorkerPhaseTimings;
}

export interface OpportunityPerformanceBenchmarkReport {
  fixture: typeof OPPORTUNITY_PRODUCTION_SCALE_FIXTURE;
  localSyntheticOnly: true;
  outputParity: boolean;
  passes: {
    cold: OpportunityPerformanceBenchmarkPass;
    warm: OpportunityPerformanceBenchmarkPass;
  };
  thresholds: {
    coldMs: number;
    warmMs: number;
  };
}

function known(value: unknown): OpportunityFieldValue {
  return {
    confidence: "high",
    evidenceClass: "observed_fact",
    source: "production-scale-fixture",
    sourceAt: "2026-07-28T00:00:00.000Z",
    state: "known",
    value,
  };
}

const FIELD_VALUES: Record<OpportunityRuleField, (appid: number) => unknown> = {
  app_type: () => "game",
  appid: (appid) => appid,
  categories: () => ["Single-player", "Steam Achievements"],
  ccu_change_30d: (appid) => (appid % 31) / 100,
  ccu_change_7d: (appid) => (appid % 11) / 100,
  ccu_peak: (appid) => 10 + (appid % 500),
  content_descriptors: () => [],
  controller_support: () => "full",
  days_until_release: () => -120,
  demo_only: () => false,
  developer: (appid) => [`Developer ${appid % 300}`],
  developer_game_count: (appid) => 1 + (appid % 12),
  discount_percent: (appid) => (appid % 4 === 0 ? 20 : 0),
  genres: (appid) =>
    appid % 2 === 0 ? ["Indie", "Action"] : ["Indie", "Strategy"],
  has_demo: (appid) =>
    appid <= OPPORTUNITY_PRODUCTION_SCALE_FIXTURE.surfacedResultCount,
  has_purchase_packages: () => true,
  is_free: (appid) => appid % 17 === 0,
  is_released: () => true,
  languages: () => ["English", "German"],
  name: (appid) => `Fixture Game ${appid}`,
  no_publisher_listed: () => false,
  platforms: () => ["windows", "mac"],
  positive_percentage: (appid) => 65 + (appid % 35),
  price_cents: (appid) => 999 + (appid % 5) * 500,
  publisher: (appid) => [`Publisher ${appid % 180}`],
  publisher_game_count: (appid) => 1 + (appid % 20),
  publisheriq_added_at: () => "2026-03-28T12:00:00.000Z",
  release_date: () => "2026-03-28",
  release_state: () => "released",
  reviews_added_30d: (appid) => appid % 47,
  reviews_added_7d: (appid) => appid % 13,
  self_published: (appid) => appid % 7 === 0,
  steam_deck: () => "playable",
  tags: (appid) =>
    appid % 2 === 0
      ? ["Roguelike", "Deckbuilding", "Indie"]
      : ["Strategy", "Survival", "Indie"],
  total_reviews: (appid) => 50 + appid * 3,
};

function buildInput(appid: number): OpportunityEvaluationInput {
  const fields = Object.fromEntries(
    Object.entries(FIELD_VALUES).map(([field, value]) => [
      field,
      known(value(appid)),
    ]),
  ) as OpportunityEvaluationInput["fields"];
  const input = {
    appid,
    description: {
      contentHash: `description-${appid}`,
      hasHeaderImage: true,
      hasReleasePath: true,
      hasSupportedLanguages: true,
      kind: "steam_short" as const,
      sanitizerVersion: "opportunity-description/v1" as const,
      screenshotCount: 5,
      sourceAt: "2026-07-28T00:00:00.000Z",
      sourceSnapshotId: String(appid),
      text: `Fixture Game ${appid} is a benchmark game with a bounded storefront description.`,
      trailerCount: 1,
    },
    fields,
    name: `Fixture Game ${appid}`,
  };
  assertOpportunityRuleInputComplete(input);
  return input;
}

function buildProfiles(): OpportunityRuleSet[] {
  return Array.from(
    { length: OPPORTUNITY_PRODUCTION_SCALE_FIXTURE.profileCount },
    (_, profileIndex) => ({
      excluded: [
        {
          clauses: [
            {
              field: "content_descriptors",
              id: `content-${profileIndex}`,
              operator: "contains",
              value: "adult",
            },
          ],
          id: `excluded-${profileIndex}`,
          label: "Content policy",
          operator: "any",
        },
      ],
      preferred: [
        {
          clauses: [
            {
              field: "positive_percentage",
              id: `positive-${profileIndex}`,
              operator: "greater_than_or_equal",
              value: 75,
            },
          ],
          id: `preferred-${profileIndex}`,
          importance: (["low", "medium", "high"] as const)[profileIndex]!,
          label: "Positive reception",
          operator: "all",
        },
      ],
      required: [
        {
          clauses: [
            {
              field: "has_demo",
              id: `demo-${profileIndex}`,
              operator: "equals",
              value: true,
            },
          ],
          id: `required-${profileIndex}`,
          label: "Playable demo",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    }),
  );
}

function cohortMembers(appid: number): OpportunityCohortMember[] {
  return Array.from({ length: 50 }, (_, index) => {
    const peer =
      ((appid + index) % OPPORTUNITY_PRODUCTION_SCALE_FIXTURE.candidateCount) +
      1;
    return {
      appid: peer,
      ccuPeak: 15 + (peer % 600),
      inclusionReasons: ["fixture taxonomy", "compatible business model"],
      inclusionScore: 3 - index / 100,
      name: `Fixture Peer ${peer}`,
      positivePercentage: 60 + (peer % 40),
      priceCents: 999 + (peer % 5) * 500,
      reviewsAdded30d: peer % 51,
      totalReviews: 100 + peer * 2,
    };
  });
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

function normalizeDigestValue(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Object.is(value, -0)) return 0;
    return Number(value.toFixed(12));
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDigestValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeDigestValue(item),
      ]),
    );
  }
  return value;
}

export function digestOpportunityBenchmarkOutput(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeDigestValue(value)))
    .digest("hex");
}

function runPass(
  mode: "cold" | "warm",
  cohortCache: Map<number, OpportunityCohortMember[]>,
  includeReviewPriorityV2: boolean,
): OpportunityPerformanceBenchmarkPass {
  const totalStartedAt = performance.now();

  const inputStartedAt = performance.now();
  const inputs = Array.from(
    { length: OPPORTUNITY_PRODUCTION_SCALE_FIXTURE.candidateCount },
    (_, index) => buildInput(index + 1),
  );
  const inputPreparationMs = elapsed(inputStartedAt);

  const profileStartedAt = performance.now();
  const profiles = buildProfiles();
  const candidateEvaluations = inputs.flatMap((input) =>
    profiles.map((rules, profileIndex) => ({
      appid: input.appid,
      evaluation: evaluateOpportunityProfile(rules, input),
      profileIndex,
    })),
  );
  const surfacedAppids = Array.from(
    new Set(
      candidateEvaluations
        .filter((candidate) => candidate.evaluation.outcome === "eligible")
        .map((candidate) => candidate.appid),
    ),
  );
  const eligibleByAppid = new Map<
    number,
    (typeof candidateEvaluations)[number][]
  >();
  for (const candidate of candidateEvaluations) {
    if (candidate.evaluation.outcome !== "eligible") continue;
    const matches = eligibleByAppid.get(candidate.appid) ?? [];
    matches.push(candidate);
    eligibleByAppid.set(candidate.appid, matches);
  }
  const profileEvaluationMs = elapsed(profileStartedAt);

  const cohortStartedAt = performance.now();
  let cacheHits = 0;
  let cacheMisses = 0;
  const cohorts = surfacedAppids.map((appid) => {
    const cached = cohortCache.get(appid);
    if (cached) {
      cacheHits += 1;
      return { appid, members: cached };
    }
    cacheMisses += 1;
    const members = cohortMembers(appid);
    cohortCache.set(appid, members);
    return { appid, members };
  });
  const cohortResolutionMs = elapsed(cohortStartedAt);

  const marketStartedAt = performance.now();
  const results = cohorts.map(({ appid, members }) => {
    const market = calculateOpportunityMarketContext(members);
    const rank = calculateOpportunityRanking({
      components: {
        evidenceQuality: market.confidence === "high" ? 1 : 0.5,
        marketMomentum: market.demandDirection === "improving" ? 1 : 0.5,
        peerPosition: 0.5,
        signalStrength: 0.75,
        userFit: 0.8,
      },
      reasons: ["production-scale benchmark fixture"],
    });
    const matches = eligibleByAppid.get(appid) ?? [];
    const input = inputs[appid - 1]!;
    if (!includeReviewPriorityV2) {
      return { appid, market, rank };
    }
    const policies: OpportunityRankingPolicy[] = [
      "discover_new_games",
      "find_emerging_traction",
      "monitor_material_changes",
    ];
    const allMatchedProfileIds = matches.map(
      (match) => `fixture-profile-${match.profileIndex}`,
    );
    const reviewPriorities = matches.map((match) => {
      const policy = policies[match.profileIndex]!;
      return calculateOpportunityReviewPriority({
        affectedRuleFields: ["tags"],
        allMatchedProfileIds,
        cohort: { coverage: 1, fallbackTier: 1, members },
        effectiveAt: "2026-08-05T12:00:00.000Z",
        evaluation: match.evaluation,
        eventMateriality: 0.8,
        eventSubscribed: true,
        eventType:
          policy === "discover_new_games"
            ? "first_observed"
            : policy === "find_emerging_traction"
              ? "review_breakthrough"
              : "taxonomy_repositioned",
        input,
        lane:
          policy === "discover_new_games"
            ? "new_game"
            : policy === "find_emerging_traction"
              ? "traction"
              : "material_change",
        market,
        now: "2026-08-05T16:00:00.000Z",
        policy,
        profileId: `fixture-profile-${match.profileIndex}`,
        selectionSource: "explicit",
      });
    });
    return { appid, market, rank, reviewPriorities };
  });
  const marketCalculationMs = elapsed(marketStartedAt);

  const persistenceStartedAt = performance.now();
  const persistedResultBatches: unknown[][] = [];
  for (let offset = 0; offset < results.length; offset += 100) {
    persistedResultBatches.push(
      JSON.parse(
        JSON.stringify(results.slice(offset, offset + 100)),
      ) as unknown[],
    );
  }
  const persistedCandidateBatches: unknown[][] = [];
  for (let offset = 0; offset < candidateEvaluations.length; offset += 500) {
    persistedCandidateBatches.push(
      JSON.parse(
        JSON.stringify(candidateEvaluations.slice(offset, offset + 500)),
      ) as unknown[],
    );
  }
  const persistenceMs = elapsed(persistenceStartedAt);

  return {
    cacheHits,
    cacheMisses,
    candidateEvaluations: candidateEvaluations.length,
    candidatePersistenceBatches: persistedCandidateBatches.length,
    mode,
    outputDigest: digestOpportunityBenchmarkOutput({
      candidates: candidateEvaluations,
      results,
    }),
    resultPersistenceBatches: persistedResultBatches.length,
    surfacedResults: results.length,
    timings: {
      cohortResolutionMs,
      inputPreparationMs,
      marketCalculationMs,
      persistenceMs,
      profileEvaluationMs,
      totalMs: elapsed(totalStartedAt),
    },
  };
}

export function runOpportunityPerformanceBenchmark(
  options: { includeReviewPriorityV2?: boolean } = {},
): OpportunityPerformanceBenchmarkReport {
  const includeReviewPriorityV2 = options.includeReviewPriorityV2 ?? true;
  const cohortCache = new Map<number, OpportunityCohortMember[]>();
  const cold = runPass("cold", cohortCache, includeReviewPriorityV2);
  const warm = runPass("warm", cohortCache, includeReviewPriorityV2);
  return {
    fixture: OPPORTUNITY_PRODUCTION_SCALE_FIXTURE,
    localSyntheticOnly: true,
    outputParity: cold.outputDigest === warm.outputDigest,
    passes: { cold, warm },
    thresholds: {
      coldMs: 3 * 60 * 1000,
      warmMs: 60 * 1000,
    },
  };
}
