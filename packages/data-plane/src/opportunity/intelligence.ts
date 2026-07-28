import {
  OPPORTUNITY_HEALTH_VERSION,
  OPPORTUNITY_MARKET_VERSION,
  OPPORTUNITY_RANKING_VERSION,
  type OpportunityCohortMember,
  type OpportunityMarketContext,
  type OpportunityPercentileDistribution,
  type OpportunityPresetHealthSnapshot,
  type OpportunityPresetHealthState,
  type OpportunityRankComponents,
  type OpportunityRankingEvidence,
} from "./types.js";

export const OPPORTUNITY_RANK_WEIGHTS: OpportunityRankComponents = {
  evidenceQuality: 0.05,
  marketMomentum: 0.1,
  peerPosition: 0.2,
  signalStrength: 0.3,
  userFit: 0.35,
};

export interface OpportunityMarketCalibration {
  largeP90Reviews: number;
  meaningfulP75Ccu: number;
  meaningfulP75Reviews: number;
  minimumCoverage: number;
  minimumMeasuredGames: number;
}

export const DEFAULT_MARKET_CALIBRATION: OpportunityMarketCalibration = {
  largeP90Reviews: 5_000,
  meaningfulP75Ccu: 50,
  meaningfulP75Reviews: 500,
  minimumCoverage: 0.6,
  minimumMeasuredGames: 10,
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) {
    return null;
  }

  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

export function buildPercentileDistribution(
  values: Array<number | null | undefined>,
): OpportunityPercentileDistribution {
  const sorted = values
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
    .sort((left, right) => left - right);

  return {
    measured: sorted.length,
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  };
}

function topOneShare(values: Array<number | null>): number | null {
  const positive = values
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    )
    .sort((left, right) => right - left);
  const total = positive.reduce((sum, value) => sum + value, 0);

  if (positive.length === 0 || total <= 0) {
    return null;
  }

  return positive[0]! / total;
}

export function calculateOpportunityMarketContext(
  members: OpportunityCohortMember[],
  calibration: OpportunityMarketCalibration = DEFAULT_MARKET_CALIBRATION,
): OpportunityMarketContext {
  const totalReviews = buildPercentileDistribution(
    members.map((member) => member.totalReviews),
  );
  const ccuPeak = buildPercentileDistribution(
    members.map((member) => member.ccuPeak),
  );
  const reviewsAdded30d = buildPercentileDistribution(
    members.map((member) => member.reviewsAdded30d),
  );
  const measuredGames = Math.max(
    totalReviews.measured,
    ccuPeak.measured,
    reviewsAdded30d.measured,
  );
  const coverage = members.length === 0 ? 0 : measuredGames / members.length;
  const concentrationShare = topOneShare(
    members.map((member) => member.reviewsAdded30d),
  );
  const improvingGames = members.filter(
    (member) =>
      typeof member.reviewsAdded30d === "number" && member.reviewsAdded30d > 0,
  ).length;
  const improvingBreadth =
    reviewsAdded30d.measured === 0
      ? null
      : improvingGames / reviewsAdded30d.measured;
  const insufficient =
    measuredGames < calibration.minimumMeasuredGames ||
    coverage < calibration.minimumCoverage;

  let potentialBand: OpportunityMarketContext["potentialBand"];
  if (insufficient) {
    potentialBand = "insufficient_data";
  } else if (
    (totalReviews.p90 ?? 0) >= calibration.largeP90Reviews &&
    (concentrationShare ?? 0) > 0.35
  ) {
    potentialBand = "large_but_competitive";
  } else if (
    (totalReviews.p75 ?? 0) >= calibration.meaningfulP75Reviews ||
    (ccuPeak.p75 ?? 0) >= calibration.meaningfulP75Ccu
  ) {
    potentialBand = "meaningful";
  } else if ((totalReviews.p50 ?? 0) >= 100 || (ccuPeak.p75 ?? 0) >= 25) {
    potentialBand = "developing";
  } else {
    potentialBand = "limited";
  }

  const demandDirection: OpportunityMarketContext["demandDirection"] =
    reviewsAdded30d.measured < calibration.minimumMeasuredGames
      ? "unknown"
      : (reviewsAdded30d.p50 ?? 0) > 0 && (improvingBreadth ?? 0) >= 0.4
        ? "improving"
        : (reviewsAdded30d.p50 ?? 0) < 0
          ? "declining"
          : "stable";
  const explanation = [
    `${measuredGames} of ${members.length} released peers have current core measurements.`,
    demandDirection === "unknown"
      ? "Demand direction is not stated because coverage is insufficient."
      : `Recent peer demand is ${demandDirection}; ${(100 * (improvingBreadth ?? 0)).toFixed(0)}% of measured peers added reviews in the window.`,
  ];

  if (concentrationShare !== null && concentrationShare > 0.35) {
    explanation.push(
      `The strongest title accounts for ${(100 * concentrationShare).toFixed(0)}% of measured review improvement, so the market is hit-driven.`,
    );
  }

  return {
    confidence: insufficient ? "directional" : "high",
    concentration: {
      topOneShare:
        concentrationShare === null ? null : round(concentrationShare),
      warning:
        concentrationShare !== null && concentrationShare > 0.35
          ? "One title explains a large share of recent improvement."
          : null,
    },
    demandDirection,
    distributions: {
      ccuPeak,
      reviewsAdded30d,
      totalReviews,
    },
    explanation,
    marketVersion: OPPORTUNITY_MARKET_VERSION,
    potentialBand,
    supply: {
      measuredGames,
      releasedGames: members.length,
    },
  };
}

export function calculateOpportunityRanking(params: {
  components: OpportunityRankComponents;
  reasons: string[];
  weights?: OpportunityRankComponents;
}): OpportunityRankingEvidence {
  const weights = params.weights ?? OPPORTUNITY_RANK_WEIGHTS;
  const components: OpportunityRankComponents = {
    evidenceQuality: clamp(params.components.evidenceQuality),
    marketMomentum: clamp(params.components.marketMomentum),
    peerPosition: clamp(params.components.peerPosition),
    signalStrength: clamp(params.components.signalStrength),
    userFit: clamp(params.components.userFit),
  };
  const finalScore =
    (components.userFit * weights.userFit +
      components.signalStrength * weights.signalStrength +
      components.peerPosition * weights.peerPosition +
      components.marketMomentum * weights.marketMomentum +
      components.evidenceQuality * weights.evidenceQuality) *
    100;

  return {
    components,
    finalScore: round(finalScore, 2),
    rankingVersion: OPPORTUNITY_RANKING_VERSION,
    reasons: params.reasons,
    weights,
  };
}

export interface OpportunityHealthInput {
  asOfDate: string;
  ccuGrowthMedian: number | null;
  consecutiveCandidateDays: number;
  coreCoverage: number;
  evaluatedGames: number;
  measuredGames: number;
  positiveBreadth: number | null;
  priorState: OpportunityPresetHealthState | null;
  reviewAccelerationMedian: number | null;
  topContributorShare: number | null;
}

function explainOpportunityHealthState(
  state: OpportunityPresetHealthState,
): string {
  switch (state) {
    case "surging":
      return "Review and CCU demand improved broadly for two consecutive daily snapshots without one title dominating.";
    case "growing":
      return "A broad share of measured games improved in reviews or concurrent players.";
    case "cooling":
      return "Median review and concurrent-player movement both declined, with improvement limited to a narrow share of games.";
    case "quiet":
      return "Median review acceleration and concurrent-player growth were both within ±5%.";
    case "active":
      return "Movement was measurable but did not meet the growing, cooling, or quiet thresholds.";
    case "insufficient_data":
      return "At least 10 measured games and 60% coverage are required for a market-health conclusion.";
  }
}

export function calculateOpportunityPresetHealth(
  input: OpportunityHealthInput,
): OpportunityPresetHealthSnapshot {
  const enoughData = input.measuredGames >= 10 && input.coreCoverage >= 0.6;
  const reviewImproving = (input.reviewAccelerationMedian ?? 0) >= 0.25;
  const ccuImproving = (input.ccuGrowthMedian ?? 0) >= 0.2;
  const broad = (input.positiveBreadth ?? 0) >= 0.4;
  const unconcentrated =
    input.topContributorShare !== null && input.topContributorShare <= 0.5;
  const surgeCandidate =
    enoughData && reviewImproving && ccuImproving && broad && unconcentrated;
  let state: OpportunityPresetHealthState;

  if (!enoughData) {
    state = "insufficient_data";
  } else if (surgeCandidate && input.consecutiveCandidateDays >= 2) {
    state = "surging";
  } else if (surgeCandidate || (broad && (reviewImproving || ccuImproving))) {
    state = "growing";
  } else if (
    (input.reviewAccelerationMedian ?? 0) <= -0.25 &&
    (input.ccuGrowthMedian ?? 0) <= -0.2 &&
    (input.positiveBreadth ?? 1) < 0.3
  ) {
    state = "cooling";
  } else if (
    Math.abs(input.reviewAccelerationMedian ?? 0) < 0.05 &&
    Math.abs(input.ccuGrowthMedian ?? 0) < 0.05
  ) {
    state = "quiet";
  } else {
    state = "active";
  }

  const explanation = enoughData
    ? [
        `${input.measuredGames} of ${input.evaluatedGames} evaluated released games have complete review-and-CCU signals (${(100 * input.coreCoverage).toFixed(0)}% core coverage).`,
        `${(100 * (input.positiveBreadth ?? 0)).toFixed(0)}% of measured games are improving.`,
        explainOpportunityHealthState(state),
      ]
    : [
        `Only ${input.measuredGames} of ${input.evaluatedGames} evaluated released games have complete review-and-CCU signals (${(100 * input.coreCoverage).toFixed(0)}% core coverage).`,
        explainOpportunityHealthState(state),
      ];

  return {
    asOfDate: input.asOfDate,
    consecutiveDays:
      state === input.priorState ? input.consecutiveCandidateDays : 1,
    coverage: round(input.coreCoverage),
    explanation,
    healthVersion: OPPORTUNITY_HEALTH_VERSION,
    measuredGames: input.measuredGames,
    positiveBreadth:
      input.positiveBreadth === null ? null : round(input.positiveBreadth),
    state,
    topContributorShare:
      input.topContributorShare === null
        ? null
        : round(input.topContributorShare),
  };
}
