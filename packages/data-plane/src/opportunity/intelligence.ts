import {
  OPPORTUNITY_HEALTH_VERSION,
  OPPORTUNITY_MARKET_VERSION,
  OPPORTUNITY_RANKING_VERSION,
  OPPORTUNITY_CONFIDENCE_VERSION,
  OPPORTUNITY_REVIEW_PRIORITY_VERSION,
  type OpportunityCohortMember,
  type OpportunityEvaluationInput,
  type OpportunityMarketContext,
  type OpportunityObservedChange,
  type OpportunityPercentileDistribution,
  type OpportunityPresetHealthSnapshot,
  type OpportunityPresetHealthState,
  type OpportunityRankComponents,
  type OpportunityRankingEvidence,
  type OpportunityRankingPolicy,
  type OpportunityPriorityLane,
  type OpportunityProfileEvaluation,
  type OpportunityReviewPriorityComponent,
  type OpportunityReviewPriorityDecision,
  type OpportunityReviewPriorityInput,
  type OpportunityResultLabel,
  type OpportunityRuleSet,
  type OpportunityRuleField,
} from "./types.js";

const TRACTION_RULE_FIELDS = new Set<OpportunityRuleField>([
  "total_reviews",
  "positive_percentage",
  "reviews_added_7d",
  "reviews_added_30d",
  "ccu_peak",
  "ccu_change_7d",
  "ccu_change_30d",
]);

const POLICY_LANE_ORDER: Record<
  OpportunityRankingPolicy,
  Record<OpportunityPriorityLane, number>
> = {
  discover_new_games: { material_change: 2, new_game: 0, traction: 1 },
  find_emerging_traction: { material_change: 2, new_game: 1, traction: 0 },
  monitor_material_changes: { material_change: 0, new_game: 2, traction: 1 },
};

const CONFIDENCE_TIER_MULTIPLIERS = [1, 0.9, 0.75, 0.6, 0.4] as const;
const PREFERRED_IMPORTANCE = { high: 1, low: 0.3, medium: 0.6 } as const;
const REVIEW_MARKET_VALUES: Record<string, number | null> = {
  developing: 0.5,
  insufficient_data: null,
  large_but_competitive: 0.8,
  limited: 0.25,
  meaningful: 0.7,
};

export function resolveOpportunityRankingPolicy(params: {
  calculationConfig?: Record<string, unknown>;
  rules: OpportunityRuleSet;
}): {
  policy: OpportunityRankingPolicy;
  selectionSource: "explicit" | "legacy_inference";
} {
  const configured = params.calculationConfig?.rankingPolicy;
  if (
    configured === "discover_new_games" ||
    configured === "find_emerging_traction" ||
    configured === "monitor_material_changes"
  ) {
    return { policy: configured, selectionSource: "explicit" };
  }
  const required = params.rules.required.flatMap((group) => group.clauses);
  if (
    required.some(
      (clause) =>
        clause.field === "publisheriq_added_at" ||
        (clause.field === "is_released" &&
          clause.operator === "equals" &&
          clause.value === false) ||
        (clause.field === "release_date" && clause.operator === "in_window"),
    )
  ) {
    return {
      policy: "discover_new_games",
      selectionSource: "legacy_inference",
    };
  }
  if (
    [...params.rules.required, ...params.rules.preferred].some((group) =>
      group.clauses.some((clause) => TRACTION_RULE_FIELDS.has(clause.field)),
    )
  ) {
    return {
      policy: "find_emerging_traction",
      selectionSource: "legacy_inference",
    };
  }
  return {
    policy: "monitor_material_changes",
    selectionSource: "legacy_inference",
  };
}

export function resolveOpportunityPriorityLane(params: {
  effectiveAt: string;
  eventType: string;
  firstObservedAt: string | null;
  hasApplicableTraction: boolean;
  isReleased: boolean | null;
  signalFamily: string;
}): OpportunityPriorityLane {
  if (
    params.eventType === "first_observed" ||
    params.eventType === "released"
  ) {
    return "new_game";
  }
  const effectiveAtMs = Date.parse(params.effectiveAt);
  const firstObservedAtMs = params.firstObservedAt
    ? Date.parse(params.firstObservedAt)
    : Number.NaN;
  const firstObservedAgeMs = effectiveAtMs - firstObservedAtMs;
  if (
    Number.isFinite(firstObservedAgeMs) &&
    firstObservedAgeMs >= 0 &&
    firstObservedAgeMs <= 72 * 3_600_000
  ) {
    return "new_game";
  }
  if (
    params.eventType === "store_readiness_improved" &&
    Number.isFinite(firstObservedAgeMs) &&
    firstObservedAgeMs >= 0 &&
    firstObservedAgeMs <= 30 * 86_400_000
  ) {
    return "new_game";
  }
  if (
    params.isReleased === true &&
    params.hasApplicableTraction &&
    (params.eventType === "review_breakthrough" ||
      params.eventType === "ccu_breakthrough" ||
      params.signalFamily === "reviews" ||
      params.signalFamily === "ccu")
  ) {
    return "traction";
  }
  return "material_change";
}

function fieldInput(
  input: OpportunityEvaluationInput,
  field: OpportunityRuleField,
  options?: {
    critical?: boolean;
    normalizedValue?: number | null;
    notApplicable?: boolean;
  },
): OpportunityReviewPriorityInput {
  const evidence = input.fields[field];
  if (options?.notApplicable) {
    return {
      assessment: "not_assessed",
      availability: "not_applicable",
      calculationVersion: null,
      confidenceWeight: 1,
      criticalForConfidence: options.critical ?? false,
      key: field,
      normalizedValue: null,
      rawValue: null,
      reasonCode: "not_applicable_for_lane",
      source: evidence?.source ?? "opportunity-ranking/v2",
      sourceAt: evidence?.sourceAt ?? null,
    };
  }
  if (!evidence || evidence.state === "unknown") {
    return {
      assessment: "not_assessed",
      availability: "unavailable",
      calculationVersion: evidence?.calculationVersion ?? null,
      confidenceWeight: 1,
      criticalForConfidence: options?.critical ?? false,
      key: field,
      normalizedValue: null,
      rawValue: evidence?.value ?? null,
      reasonCode: evidence?.reason ?? "source_unavailable",
      source: evidence?.source ?? "opportunity-ranking/v2",
      sourceAt: evidence?.sourceAt ?? null,
    };
  }
  const numeric =
    typeof evidence.value === "number" && Number.isFinite(evidence.value)
      ? evidence.value
      : null;
  return {
    assessment: numeric !== null && numeric <= 0 ? "negative" : "neutral",
    availability: "available",
    calculationVersion: evidence.calculationVersion ?? null,
    confidenceWeight: 1,
    criticalForConfidence: options?.critical ?? false,
    key: field,
    normalizedValue: options?.normalizedValue ?? null,
    rawValue: evidence.value ?? null,
    reasonCode:
      numeric !== null && numeric <= 0 ? "known_non_positive" : "observed",
    source: evidence.source,
    sourceAt: evidence.sourceAt ?? null,
  };
}

function numericReviewField(
  input: OpportunityEvaluationInput,
  field: OpportunityRuleField,
): number | null {
  const evidence = input.fields[field];
  return evidence?.state === "known" && typeof evidence.value === "number"
    ? evidence.value
    : null;
}

function weightedComponent(
  key: string,
  baseWeight: number,
  values: Array<{ value: number | null; weight: number }>,
): OpportunityReviewPriorityComponent {
  let denominator = 0;
  let numerator = 0;
  for (const item of values) {
    if (item.value === null) continue;
    denominator += item.weight;
    numerator += item.value * item.weight;
  }
  const value = denominator > 0 ? numerator / denominator : null;
  return {
    baseWeight,
    contribution: value === null ? null : value * baseWeight,
    effectiveWeight: value === null ? 0 : baseWeight,
    key,
    value,
  };
}

function singleValueComponent(
  key: string,
  baseWeight: number,
  value: number | null,
): OpportunityReviewPriorityComponent {
  return {
    baseWeight,
    contribution: value === null ? null : value * baseWeight,
    effectiveWeight: value === null ? 0 : baseWeight,
    key,
    value,
  };
}

function peerMidranks(
  reviews: number | null,
  ccu: number | null,
  cohort: OpportunityCohortMember[],
): [number | null, number | null] {
  let reviewEqual = 0;
  let reviewLower = 0;
  let reviewMeasured = 0;
  let ccuEqual = 0;
  let ccuLower = 0;
  let ccuMeasured = 0;
  for (const member of cohort) {
    if (
      reviews !== null &&
      member.totalReviews !== null &&
      Number.isFinite(member.totalReviews)
    ) {
      reviewMeasured += 1;
      if (member.totalReviews < reviews) reviewLower += 1;
      else if (member.totalReviews === reviews) reviewEqual += 1;
    }
    if (
      ccu !== null &&
      member.ccuPeak !== null &&
      Number.isFinite(member.ccuPeak)
    ) {
      ccuMeasured += 1;
      if (member.ccuPeak < ccu) ccuLower += 1;
      else if (member.ccuPeak === ccu) ccuEqual += 1;
    }
  }
  return [
    reviews === null || reviewMeasured < 10
      ? null
      : clamp((reviewLower + reviewEqual * 0.5) / reviewMeasured),
    ccu === null || ccuMeasured < 10
      ? null
      : clamp((ccuLower + ccuEqual * 0.5) / ccuMeasured),
  ];
}

function logP90(value: number | null, p90: number | null): number | null {
  if (value === null || p90 === null) return null;
  return clamp(Math.log1p(Math.max(0, value)) / Math.log1p(Math.max(1, p90)));
}

function confidenceForDecision(params: {
  cohort: {
    coverage: number;
    fallbackTier: 1 | 2 | 3 | 4 | 5;
    members: OpportunityCohortMember[];
  };
  inputs: OpportunityReviewPriorityInput[];
  lane: OpportunityPriorityLane;
  marketApplicable: boolean;
  measuredCount?: number;
  nowMs: number;
}): OpportunityReviewPriorityDecision["confidence"] {
  let applicableCount = 0;
  let applicableWeight = 0;
  let criticalStale = false;
  let criticalUnavailable = false;
  let presentCount = 0;
  let presentWeight = 0;
  let staleCount = 0;
  let staleWeight = 0;
  let cachedSourceAt: string | null = null;
  let cachedSourceAtMs = Number.NaN;
  for (const input of params.inputs) {
    if (input.availability === "not_applicable") continue;
    applicableCount += 1;
    applicableWeight += input.confidenceWeight;
    if (input.availability !== "available") {
      if (input.criticalForConfidence) criticalUnavailable = true;
      continue;
    }
    presentCount += 1;
    presentWeight += input.confidenceWeight;
    const neverStale =
      input.source === "profile_rule_outcome" ||
      input.source === "profile_evaluation" ||
      input.source === "opportunity.market_context_snapshots" ||
      input.source === "opportunity.material_events";
    if (neverStale) continue;
    if (input.sourceAt !== cachedSourceAt) {
      cachedSourceAt = input.sourceAt;
      cachedSourceAtMs = input.sourceAt ? Date.parse(input.sourceAt) : NaN;
    }
    const age = params.nowMs - cachedSourceAtMs;
    const sla = input.source.includes("cohort")
      ? 7 * 86_400_000
      : 48 * 3_600_000;
    if (Number.isFinite(age) && age <= sla) continue;
    staleCount += 1;
    staleWeight += input.confidenceWeight;
    if (input.criticalForConfidence) criticalStale = true;
  }
  const completeness =
    applicableWeight > 0 ? presentWeight / applicableWeight : 0;
  const freshness =
    presentWeight > 0 ? (presentWeight - staleWeight) / presentWeight : 0;
  const tierMultiplier =
    CONFIDENCE_TIER_MULTIPLIERS[params.cohort.fallbackTier - 1] ?? 0.4;
  let measured = 0;
  if (params.marketApplicable) {
    if (params.measuredCount !== undefined) {
      measured = params.measuredCount;
    } else {
      for (const member of params.cohort.members) {
        if (member.totalReviews !== null || member.ccuPeak !== null) {
          measured += 1;
        }
      }
    }
  }
  const cohortQuality = params.marketApplicable
    ? params.cohort.coverage * Math.min(1, measured / 10) * tierMultiplier
    : 1;
  const denominator = params.marketApplicable ? 1 : 0.8;
  const score = clamp(
    (0.45 * completeness +
      0.25 * freshness +
      (params.marketApplicable ? 0.2 * cohortQuality : 0) +
      0.1) /
      denominator,
  );
  let label: OpportunityReviewPriorityDecision["confidence"]["label"];
  if (score >= 0.8 && !criticalUnavailable && !criticalStale) {
    label = "high";
  } else if (
    criticalUnavailable ||
    criticalStale ||
    (score < 0.5 && params.lane !== "new_game")
  ) {
    label = "limited";
  } else {
    label = "directional";
  }
  const reasons: string[] = [];
  if (criticalUnavailable) reasons.push("critical_input_unavailable");
  if (criticalStale) reasons.push("critical_input_stale");
  if (params.lane === "new_game") {
    reasons.push("post_release_traction_not_applicable");
  }
  if (params.marketApplicable && cohortQuality < 0.6) {
    reasons.push("cohort_coverage_limited");
  }
  return {
    applicableCount,
    conflictingCount: 0,
    label,
    presentCount,
    reasons,
    score,
    staleCount,
    version: OPPORTUNITY_CONFIDENCE_VERSION,
  };
}

export function calculateOpportunityReviewPriority(params: {
  affectedRuleFields: OpportunityRuleField[];
  allMatchedProfileIds: string[];
  allMatchedProfileIdsSorted?: boolean;
  cohort: {
    coverage: number;
    fallbackTier: 1 | 2 | 3 | 4 | 5;
    members: OpportunityCohortMember[];
  };
  cohortMeasuredCount?: number;
  effectiveAt: string;
  effectiveAtMs?: number;
  evaluation: OpportunityProfileEvaluation;
  eventMateriality: number;
  eventSubscribed: boolean;
  eventType: string;
  input: OpportunityEvaluationInput;
  lane: OpportunityPriorityLane;
  market: OpportunityMarketContext;
  now: string;
  nowMs?: number;
  policy: OpportunityRankingPolicy;
  profileId: string;
  selectionSource: "explicit" | "legacy_inference";
}): OpportunityReviewPriorityDecision {
  const inputs: OpportunityReviewPriorityInput[] = [];
  const components: OpportunityReviewPriorityComponent[] = [];
  const nowMs = params.nowMs ?? Date.parse(params.now);
  inputs.push({
    assessment: "neutral",
    availability: "available",
    calculationVersion: null,
    confidenceWeight: 1,
    criticalForConfidence: true,
    key: "eligibility",
    normalizedValue: 1,
    rawValue: params.evaluation.outcome,
    reasonCode: "eligible_after_required_and_excluded_rules",
    source: "profile_evaluation",
    sourceAt: params.now,
  });
  let preferredDenominator = 0;
  let preferredNumerator = 0;
  for (const outcome of params.evaluation.preferredOutcomes) {
    const preferredWeight = PREFERRED_IMPORTANCE[outcome.importance];
    if (outcome.state !== "unknown") {
      preferredDenominator += preferredWeight;
      if (outcome.state === "true") preferredNumerator += preferredWeight;
    }
    inputs.push({
      assessment:
        outcome.state === "true"
          ? "positive"
          : outcome.state === "false"
            ? "negative"
            : "not_assessed",
      availability: outcome.state === "unknown" ? "unavailable" : "available",
      calculationVersion: null,
      confidenceWeight: preferredWeight,
      criticalForConfidence: false,
      key: `preferred:${outcome.groupId}`,
      normalizedValue:
        outcome.state === "unknown" ? null : outcome.state === "true" ? 1 : 0,
      rawValue: outcome.state,
      reasonCode: `preferred_${outcome.state}`,
      source: "profile_rule_outcome",
      sourceAt: null,
    });
  }
  const preferredBaseWeight =
    params.policy === "discover_new_games"
      ? 0.35
      : params.policy === "find_emerging_traction"
        ? 0.2
        : 0.25;
  const preferredValue =
    preferredDenominator > 0 ? preferredNumerator / preferredDenominator : null;
  components.push({
    baseWeight: preferredBaseWeight,
    contribution:
      preferredValue === null ? null : preferredValue * preferredBaseWeight,
    effectiveWeight: preferredValue === null ? 0 : preferredBaseWeight,
    key: "preferred_profile_match",
    value: preferredValue,
  });

  if (params.policy === "discover_new_games") {
    const noPublisher = params.input.fields.no_publisher_listed;
    const selfPublished = params.input.fields.self_published;
    let openness: number | null = null;
    if (noPublisher?.state === "known" && noPublisher.value === true)
      openness = 1;
    else if (selfPublished?.state === "known" && selfPublished.value === true)
      openness = 0.8;
    components.push(
      singleValueComponent("publishing_openness", 0.25, openness),
    );
    inputs.push({
      assessment: openness === null ? "not_assessed" : "positive",
      availability: openness === null ? "unavailable" : "available",
      calculationVersion: null,
      confidenceWeight: 1,
      criticalForConfidence: false,
      key: "publishing_openness",
      normalizedValue: openness,
      rawValue: {
        noPublisher: noPublisher?.value,
        selfPublished: selfPublished?.value,
      },
      reasonCode:
        openness === 1
          ? "no_publisher_listed"
          : openness === 0.8
            ? "self_published"
            : "publishing_openness_unknown",
      source: "steam_storefront",
      sourceAt: noPublisher?.sourceAt ?? selfPublished?.sourceAt ?? null,
    });
    const marketScore =
      REVIEW_MARKET_VALUES[params.market.potentialBand] ?? null;
    components.push(
      singleValueComponent(
        "comparable_market_attractiveness",
        0.2,
        marketScore,
      ),
    );
    inputs.push({
      assessment:
        marketScore === null
          ? "not_assessed"
          : marketScore >= 0.7
            ? "positive"
            : "neutral",
      availability: marketScore === null ? "unavailable" : "available",
      calculationVersion: null,
      confidenceWeight: 1,
      criticalForConfidence: false,
      key: "comparable_market_attractiveness",
      normalizedValue: marketScore,
      rawValue: params.market.potentialBand,
      reasonCode: `market_${params.market.potentialBand}`,
      source: "opportunity.market_context_snapshots",
      sourceAt: null,
    });
    const description = params.input.description;
    const readinessValues = [
      {
        key: "useful_description",
        value:
          description && description.kind !== "unavailable"
            ? 1
            : description
              ? 0
              : null,
        weight: 0.3,
      },
      {
        key: "header_art",
        value: description ? (description.hasHeaderImage ? 1 : 0) : null,
        weight: 0.2,
      },
      {
        key: "screenshots",
        value: description ? (description.screenshotCount >= 3 ? 1 : 0) : null,
        weight: 0.15,
      },
      {
        key: "trailer",
        value: description ? (description.trailerCount >= 1 ? 1 : 0) : null,
        weight: 0.1,
      },
      {
        key: "languages",
        value: description ? (description.hasSupportedLanguages ? 1 : 0) : null,
        weight: 0.15,
      },
      {
        key: "release_path",
        value: description ? (description.hasReleasePath ? 1 : 0) : null,
        weight: 0.1,
      },
    ];
    components.push(
      weightedComponent("product_store_readiness", 0.1, readinessValues),
    );
    for (const readiness of readinessValues) {
      inputs.push({
        assessment:
          readiness.value === null
            ? "not_assessed"
            : readiness.value > 0
              ? "positive"
              : "negative",
        availability: readiness.value === null ? "unavailable" : "available",
        calculationVersion: null,
        confidenceWeight: readiness.weight,
        criticalForConfidence: false,
        key: `readiness:${readiness.key}`,
        normalizedValue: readiness.value,
        rawValue: readiness.value,
        reasonCode:
          readiness.value === null
            ? "readiness_unavailable"
            : readiness.value > 0
              ? "readiness_present"
              : "readiness_missing",
        source: "ops.app_data_readiness",
        sourceAt: description?.sourceAt ?? null,
      });
    }
    const firstObserved = params.input.fields.publisheriq_added_at;
    const age =
      firstObserved?.state === "known" &&
      typeof firstObserved.value === "string"
        ? Math.max(0, nowMs - Date.parse(firstObserved.value))
        : Number.NaN;
    const freshness = Number.isFinite(age)
      ? age <= 72 * 3_600_000
        ? 1
        : clamp(1 - (age - 72 * 3_600_000) / (27 * 86_400_000))
      : null;
    components.push(
      singleValueComponent("freshness_launch_timing", 0.1, freshness),
    );
    inputs.push({
      assessment:
        freshness === null
          ? "not_assessed"
          : freshness > 0.5
            ? "positive"
            : "neutral",
      availability: freshness === null ? "unavailable" : "available",
      calculationVersion: null,
      confidenceWeight: 1,
      criticalForConfidence: true,
      key: "first_observed_at",
      normalizedValue: freshness,
      rawValue: firstObserved?.value ?? null,
      reasonCode:
        freshness === null
          ? "first_observation_unavailable"
          : "immutable_first_observation",
      source: firstObserved?.source ?? "opportunity-ranking/v2",
      sourceAt: firstObserved?.sourceAt ?? null,
    });
    for (const field of [
      "total_reviews",
      "ccu_peak",
      "reviews_added_7d",
      "reviews_added_30d",
      "ccu_change_7d",
      "ccu_change_30d",
    ] as const) {
      inputs.push(fieldInput(params.input, field, { notApplicable: true }));
    }
  } else if (params.policy === "find_emerging_traction") {
    const reviews = numericReviewField(params.input, "total_reviews");
    const ccu = numericReviewField(params.input, "ccu_peak");
    const levelReviews = logP90(
      reviews,
      params.market.distributions.totalReviews.p90,
    );
    const levelCcu = logP90(ccu, params.market.distributions.ccuPeak.p90);
    components.push(
      weightedComponent("traction_level", 0.25, [
        { value: levelReviews, weight: 1 },
        { value: levelCcu, weight: 1 },
      ]),
    );
    const reviews7d = numericReviewField(params.input, "reviews_added_7d");
    const reviews30d = numericReviewField(params.input, "reviews_added_30d");
    const reviewRateDelta =
      reviews7d === null || reviews30d === null
        ? null
        : reviews7d / 7 - Math.max(0, reviews30d - reviews7d) / 23;
    // Current cohort rows do not carry historical 7/30-day rate distributions.
    // Preserve those raw observations, but fail their normalized inputs closed
    // until the bounded calibration artifact can supply like-for-like peers.
    const reviewRateRank = null;
    const reviews30dRank = logP90(
      reviews30d,
      params.market.distributions.reviewsAdded30d.p90,
    );
    const ccu7dRank = null;
    const ccu30dRank = null;
    const [reviewsPeerRank, ccuPeerRank] = peerMidranks(
      reviews,
      ccu,
      params.cohort.members,
    );
    const accelerationValues = [
      reviewRateRank,
      reviews30dRank,
      ccu7dRank,
      ccu30dRank,
    ];
    const hasAcceleration = accelerationValues.some((value) => value !== null);
    components.push(
      weightedComponent(
        "traction_acceleration",
        0.3,
        accelerationValues.map((value) => ({ value, weight: 1 })),
      ),
    );
    components.push(
      weightedComponent("peer_position", 0.15, [
        {
          value: reviewsPeerRank,
          weight: 1,
        },
        {
          value: ccuPeerRank,
          weight: 1,
        },
      ]),
    );
    const marketScore =
      REVIEW_MARKET_VALUES[params.market.potentialBand] ?? null;
    components.push(singleValueComponent("market_context", 0.1, marketScore));
    const levelCount =
      (levelReviews === null ? 0 : 1) + (levelCcu === null ? 0 : 1);
    const levelAverage =
      levelCount > 0
        ? ((levelReviews ?? 0) + (levelCcu ?? 0)) / levelCount
        : null;
    inputs.push(
      fieldInput(params.input, "total_reviews", {
        normalizedValue: levelReviews,
      }),
      fieldInput(params.input, "ccu_peak", { normalizedValue: levelCcu }),
      {
        assessment:
          reviewRateDelta === null
            ? "not_assessed"
            : reviewRateDelta <= 0
              ? "negative"
              : "positive",
        availability: reviewRateRank === null ? "unavailable" : "available",
        calculationVersion: null,
        confidenceWeight: 1,
        criticalForConfidence: false,
        key: "review_rate_delta",
        normalizedValue: reviewRateRank,
        rawValue: reviewRateDelta,
        reasonCode: "cohort_review_rate_distribution_unavailable",
        source: "opportunity.released_cohort_features_v2",
        sourceAt: null,
      },
      fieldInput(params.input, "reviews_added_30d", {
        normalizedValue: reviews30dRank,
      }),
      fieldInput(params.input, "ccu_change_7d", {
        normalizedValue: ccu7dRank,
      }),
      fieldInput(params.input, "ccu_change_30d", {
        normalizedValue: ccu30dRank,
      }),
      {
        assessment: levelCount > 0 ? "neutral" : "not_assessed",
        availability: levelCount > 0 ? "available" : "unavailable",
        calculationVersion: null,
        confidenceWeight: 1,
        criticalForConfidence: true,
        key: "current_traction_level",
        normalizedValue: levelAverage,
        rawValue: null,
        reasonCode: "at_least_one_current_level_required",
        source: "metrics.app_signal_windows_v1",
        sourceAt: null,
      },
      {
        assessment: hasAcceleration ? "neutral" : "not_assessed",
        availability: hasAcceleration ? "available" : "unavailable",
        calculationVersion: null,
        confidenceWeight: 1,
        criticalForConfidence: true,
        key: "traction_acceleration_signal",
        normalizedValue: reviews30dRank,
        rawValue: null,
        reasonCode: "at_least_one_acceleration_input_required",
        source: "opportunity.released_cohort_features_v2",
        sourceAt: null,
      },
    );
  } else {
    const affected = new Set(params.affectedRuleFields);
    let requiredOrExcludedAffected = false;
    for (const outcomes of [
      params.evaluation.requiredOutcomes,
      params.evaluation.excludedOutcomes,
    ]) {
      for (const outcome of outcomes) {
        if (
          outcome.clauseOutcomes.some((clause) => affected.has(clause.field))
        ) {
          requiredOrExcludedAffected = true;
          break;
        }
      }
      if (requiredOrExcludedAffected) break;
    }
    let preferredAffected = false;
    if (!requiredOrExcludedAffected) {
      for (const outcome of params.evaluation.preferredOutcomes) {
        if (
          outcome.clauseOutcomes.some((clause) => affected.has(clause.field))
        ) {
          preferredAffected = true;
          break;
        }
      }
    }
    const relevance = requiredOrExcludedAffected
      ? 1
      : preferredAffected
        ? 0.7
        : params.eventSubscribed
          ? 0.4
          : 0;
    const recencyAge = Math.max(
      0,
      nowMs - (params.effectiveAtMs ?? Date.parse(params.effectiveAt)),
    );
    const recency =
      recencyAge <= 24 * 3_600_000
        ? 1
        : clamp(1 - (recencyAge - 24 * 3_600_000) / (29 * 86_400_000));
    components.push(singleValueComponent("profile_relevance", 0.25, relevance));
    components.push(
      singleValueComponent(
        "event_significance",
        0.35,
        params.eventType === "first_observed"
          ? null
          : clamp(params.eventMateriality),
      ),
    );
    components.push(singleValueComponent("event_recency", 0.25, recency));
    components.push(
      singleValueComponent("corroboration_consistency", 0.15, 0.7),
    );
    inputs.push({
      assessment:
        params.eventType === "first_observed" ? "not_assessed" : "positive",
      availability:
        params.eventType === "first_observed" ? "not_applicable" : "available",
      calculationVersion: null,
      confidenceWeight: 1,
      criticalForConfidence: true,
      key: "event_materiality",
      normalizedValue:
        params.eventType === "first_observed"
          ? null
          : clamp(params.eventMateriality),
      rawValue: params.eventMateriality,
      reasonCode:
        params.eventType === "first_observed"
          ? "first_observation_suppressed"
          : "material_event",
      source: "opportunity.material_events",
      sourceAt: params.effectiveAt,
    });
  }

  let denominator = 0;
  let numerator = 0;
  for (const component of components) {
    if (component.value === null) continue;
    denominator += component.baseWeight;
    numerator += component.value * component.baseWeight;
  }
  const internalScore = denominator > 0 ? numerator / denominator : null;
  const priorityBand =
    internalScore === null || internalScore < 0.55
      ? "monitor"
      : internalScore >= 0.75
        ? "review_now"
        : "review_soon";
  const reasons: string[] = [
    params.lane === "new_game"
      ? "New on Steam"
      : params.lane === "traction"
        ? "Early traction is moving"
        : "Material Steam change",
  ];
  const preferredReason = params.evaluation.preferredOutcomes.find(
    (outcome) => outcome.state === "true",
  )?.label;
  if (preferredReason) reasons.push(preferredReason);
  if (
    reasons.length < 3 &&
    params.policy === "discover_new_games" &&
    params.input.fields.self_published?.value === true
  ) {
    reasons.push("Self-published");
  }
  if (
    reasons.length < 3 &&
    params.market.potentialBand === "large_but_competitive"
  ) {
    reasons.push("Large, competitive market");
  }
  const confidence = confidenceForDecision({
    cohort: params.cohort,
    inputs,
    lane: params.lane,
    marketApplicable: params.policy !== "monitor_material_changes",
    measuredCount: params.cohortMeasuredCount,
    nowMs,
  });
  return {
    allMatchedProfileIds: params.allMatchedProfileIdsSorted
      ? params.allMatchedProfileIds
      : [...params.allMatchedProfileIds].sort(),
    components,
    confidence,
    eligibility: "eligible",
    eligibilityReasonCodes: [],
    inputs,
    internalScore,
    lane: params.lane,
    policy: params.policy,
    priorityBand,
    reasons,
    selectionSource: params.selectionSource,
    sortTuple: [
      POLICY_LANE_ORDER[params.policy][params.lane],
      priorityBand === "review_now"
        ? 0
        : priorityBand === "review_soon"
          ? 1
          : 2,
      internalScore,
      params.effectiveAt,
      params.input.appid,
      params.profileId,
    ],
    version: OPPORTUNITY_REVIEW_PRIORITY_VERSION,
    winningProfileId: params.profileId,
  };
}

export function compareOpportunityReviewPriority(
  left: OpportunityReviewPriorityDecision,
  right: OpportunityReviewPriorityDecision,
): number {
  const [leftLane, leftBand, leftScore, leftAt, leftAppid, leftProfile] =
    left.sortTuple;
  const [rightLane, rightBand, rightScore, rightAt, rightAppid, rightProfile] =
    right.sortTuple;
  return (
    leftLane - rightLane ||
    leftBand - rightBand ||
    (rightScore ?? -1) - (leftScore ?? -1) ||
    rightAt.localeCompare(leftAt) ||
    leftAppid - rightAppid ||
    leftProfile.localeCompare(rightProfile)
  );
}

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

export interface OpportunityTaxonomyNames {
  categories: ReadonlyMap<string, string>;
  genres: ReadonlyMap<string, string>;
  tags: ReadonlyMap<string, string>;
}

export const EMPTY_OPPORTUNITY_TAXONOMY_NAMES: OpportunityTaxonomyNames = {
  categories: new Map<string, string>(),
  genres: new Map<string, string>(),
  tags: new Map<string, string>(),
};

type OpportunityChangeInput = Omit<OpportunityObservedChange, "summary"> & {
  summary?: string;
};

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: '"',
};

export function decodeOpportunityText(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded.replace(
      /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
      (entity, decimal: string, hexadecimal: string, named: string) => {
        if (named) {
          return HTML_ENTITIES[named.toLocaleLowerCase()] ?? entity;
        }
        const codePoint = Number.parseInt(
          decimal || hexadecimal,
          decimal ? 10 : 16,
        );
        if (
          !Number.isInteger(codePoint) ||
          codePoint <= 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return entity;
        }
        return String.fromCodePoint(codePoint);
      },
    );
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return decoded;
}

export function decodeOpportunityValue<T>(value: T): T {
  if (typeof value === "string") {
    return decodeOpportunityText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeOpportunityValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        decodeOpportunityValue(nested),
      ]),
    ) as T;
  }
  return value;
}

export function cleanOpportunityProfileName(value: string): string {
  const decoded = decodeOpportunityText(value).trim();
  const segments = decoded
    .split(/\s+(?:—|–|-)\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const cleaned = segments.filter(
    (segment) =>
      !/^(?:(?:production|prod)\s+)?smoke(?:[- ]test)?$/i.test(segment) &&
      !/^\d{4}-\d{2}-\d{2}$/.test(segment),
  );
  return cleaned.join(" — ") || "Custom sourcing profile";
}

export function cleanOpportunityUserText(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const decoded = decodeOpportunityText(value).trim();
  return /\b(?:production\s+smoke|smoke[- ]test)\b/i.test(decoded)
    ? null
    : decoded;
}

export function cleanOpportunityCoverageWarning(value: string): string {
  const token = value.toLocaleLowerCase();
  if (token.includes("youtube") || token.includes("creator")) {
    return "Creator coverage is still growing for some games.";
  }
  if (
    token.includes("pics") ||
    token.includes("taxonomy") ||
    token.includes("tag") ||
    token.includes("categor")
  ) {
    return "Some games are missing current Steam positioning details.";
  }
  if (
    token.includes("metric") ||
    token.includes("review") ||
    token.includes("ccu")
  ) {
    return "Some player and review activity is delayed.";
  }
  if (token.includes("storefront") || token.includes("catalog")) {
    return "Some Steam store details are delayed.";
  }
  return "Some supporting game information is delayed.";
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return decodeOpportunityText(value);
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return decodeOpportunityText(value);
  }
}

function keyToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase();
}

function primitiveLeaves(value: unknown, depth = 0): unknown[] {
  if (depth > 6) {
    return [];
  }
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => primitiveLeaves(item, depth + 1));
  }
  if (parsed && typeof parsed === "object") {
    return Object.values(parsed).flatMap((item) =>
      primitiveLeaves(item, depth + 1),
    );
  }
  return parsed === null || parsed === undefined ? [] : [parsed];
}

function findNestedValue(
  input: unknown,
  aliases: string[],
  depth = 0,
): unknown {
  if (depth > 6) {
    return undefined;
  }
  const value = parseMaybeJson(input);
  const aliasTokens = new Set(aliases.map(keyToken));
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const match = findNestedValue(item, aliases, depth + 1);
        if (match !== undefined) {
          return match;
        }
      }
    }
    if (value.length === 1) {
      return parseMaybeJson(value[0]);
    }
    if (
      value.length > 0 &&
      value.every(
        (item) =>
          item === null ||
          ["boolean", "number", "string"].includes(typeof item),
      )
    ) {
      return value;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const direct = entries.find(([key]) => aliasTokens.has(keyToken(key)));
    if (direct) {
      return parseMaybeJson(direct[1]);
    }
    for (const [, nested] of entries) {
      if (nested && typeof nested === "object") {
        const match = findNestedValue(nested, aliases, depth + 1);
        if (match !== undefined) {
          return match;
        }
      }
    }
  }
  return undefined;
}

const LIST_FIELDS = new Set<OpportunityRuleField>([
  "categories",
  "content_descriptors",
  "developer",
  "genres",
  "languages",
  "platforms",
  "publisher",
  "tags",
]);

function fieldValue(
  change: OpportunityChangeInput,
  side: "after" | "before",
  field: OpportunityRuleField,
  aliases: string[] = [],
): unknown {
  const source = change[side];
  const parsedSource = parseMaybeJson(source);
  if (
    Array.isArray(parsedSource) &&
    change.affectedRuleFields.includes("price_cents") &&
    change.affectedRuleFields.includes("discount_percent")
  ) {
    const groupedPricingIndex =
      field === "price_cents" ? 0 : field === "discount_percent" ? 1 : -1;
    const groupedPricingValue = parsedSource[groupedPricingIndex];
    if (
      groupedPricingIndex >= 0 &&
      groupedPricingValue !== undefined &&
      (groupedPricingValue === null ||
        ["boolean", "number", "string"].includes(typeof groupedPricingValue))
    ) {
      return parseMaybeJson(groupedPricingValue);
    }
  }
  const found = findNestedValue(source, [field, ...aliases]);
  if (found !== undefined) {
    if (Array.isArray(found) && !LIST_FIELDS.has(field)) {
      // Grouped pricing moments store price and discount as ordered scalar
      // summaries: [price_cents, discount_percent, ...optional package refs].
      // Do not treat the trailing discount as a cent-denominated price.
      if (
        change.affectedRuleFields.includes("price_cents") &&
        change.affectedRuleFields.includes("discount_percent")
      ) {
        if (field === "price_cents") {
          return found[0];
        }
        if (field === "discount_percent") {
          return found[1];
        }
      }
      return side === "before" ? found[0] : found.at(-1);
    }
    return found;
  }
  const leaves = primitiveLeaves(source);
  if (change.affectedRuleFields.length === 1) {
    return LIST_FIELDS.has(field)
      ? leaves
      : side === "before"
        ? leaves[0]
        : leaves.at(-1);
  }
  return undefined;
}

function asStringList(value: unknown): string[] {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined) {
    return [];
  }
  if (Array.isArray(parsed)) {
    return Array.from(
      new Set(
        parsed
          .flatMap((item) => asStringList(item))
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, state]) => state === true || state === 1 || state === "true")
      .map(([key]) => decodeOpportunityText(key));
  }
  if (typeof parsed === "string") {
    return parsed
      .split(/\s*[,|]\s*/)
      .map((item) => decodeOpportunityText(item).trim())
      .filter(Boolean);
  }
  return [String(parsed)];
}

function listDifference(left: string[], right: string[]): string[] {
  const rightValues = new Set(right.map((item) => item.toLocaleLowerCase()));
  return left.filter((item) => !rightValues.has(item.toLocaleLowerCase()));
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function formatDay(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone:
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? "UTC"
        : undefined,
  }).format(date);
}

function formatCurrency(value: unknown): string | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount / 100);
}

function booleanValue(value: unknown): boolean | null {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === 0 || value === "0") {
    return false;
  }
  return null;
}

function readableValue(value: unknown): string | null {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined || parsed === "") {
    return null;
  }
  if (typeof parsed === "boolean") {
    return parsed ? "Yes" : "No";
  }
  if (typeof parsed === "number") {
    return parsed.toLocaleString();
  }
  if (typeof parsed === "string") {
    return decodeOpportunityText(parsed);
  }
  const items = asStringList(parsed).filter((item) => !/^\d+$/.test(item));
  return items.length > 0 ? joinNatural(items) : null;
}

function describePartyChange(
  change: OpportunityChangeInput,
  kind: "developer" | "publisher",
): string {
  const label = kind === "developer" ? "Developer" : "Publisher";
  const aliases =
    kind === "developer"
      ? ["developers", "developer_names", "developerName"]
      : ["publishers", "publisher_names", "publisherName"];
  const before = asStringList(fieldValue(change, "before", kind, aliases));
  const after = asStringList(fieldValue(change, "after", kind, aliases));
  const added = listDifference(after, before);
  const removed = listDifference(before, after);

  if (
    before.length > 0 &&
    after.length > 0 &&
    (added.length > 0 || removed.length > 0)
  ) {
    return `${label} changed from ${joinNatural(before)} to ${joinNatural(after)}.`;
  }
  if (added.length > 0) {
    return `${label} ${joinNatural(added)} ${added.length === 1 ? "was" : "were"} added.`;
  }
  if (removed.length > 0) {
    return `${label} ${joinNatural(removed)} ${removed.length === 1 ? "was" : "were"} removed.`;
  }
  if (after.length > 0) {
    return `${label} changed to ${joinNatural(after)}; the previous ${kind} name is unavailable.`;
  }
  return `The listed ${kind} changed, but the before-and-after names are unavailable.`;
}

function taxonomyLabel(field: "categories" | "genres" | "tags"): string {
  return {
    categories: "Steam features",
    genres: "Genres",
    tags: "Tags",
  }[field];
}

function readableTaxonomyToken(value: string): string {
  if (value.startsWith("#category_")) {
    return value
      .slice("#category_".length)
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
  }
  return decodeOpportunityText(value);
}

function resolveTaxonomyList(
  value: unknown,
  names: ReadonlyMap<string, string>,
): string[] {
  return Array.from(
    new Set(
      asStringList(value)
        .map((item) => {
          if (/^\d+$/.test(item)) {
            return names.get(item) ?? null;
          }
          return readableTaxonomyToken(item);
        })
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

function describeTaxonomyChange(
  change: OpportunityChangeInput,
  taxonomy: OpportunityTaxonomyNames,
): string {
  const fields = change.affectedRuleFields.filter(
    (field): field is "categories" | "genres" | "tags" =>
      field === "categories" || field === "genres" || field === "tags",
  );
  const selected = fields.length > 0 ? fields : (["tags"] as const);
  const summaries: string[] = [];

  for (const field of selected) {
    const before = resolveTaxonomyList(
      fieldValue(change, "before", field),
      taxonomy[field],
    );
    const after = resolveTaxonomyList(
      fieldValue(change, "after", field),
      taxonomy[field],
    );
    const added = listDifference(after, before);
    const removed = listDifference(before, after);
    const label = taxonomyLabel(field);
    if (added.length > 0 && removed.length > 0) {
      summaries.push(
        `${label} added: ${joinNatural(added)}. ${label} removed: ${joinNatural(removed)}.`,
      );
    } else if (added.length > 0) {
      summaries.push(`${label} added: ${joinNatural(added)}.`);
    } else if (removed.length > 0) {
      summaries.push(`${label} removed: ${joinNatural(removed)}.`);
    }
  }
  if (summaries.length > 0) {
    return summaries.join(" ");
  }
  const label =
    selected.length === 1
      ? taxonomyLabel(selected[0]!).toLocaleLowerCase()
      : "Steam tags and genres";
  return `The ${label} changed, but the added and removed names are unavailable.`;
}

function readablePlatform(value: string): string {
  const token = keyToken(value);
  if (["mac", "macos", "osx"].includes(token)) return "macOS";
  if (["win", "windows"].includes(token)) return "Windows";
  if (token === "linux") return "Linux";
  return decodeOpportunityText(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function describePlatformChange(change: OpportunityChangeInput): string {
  if (change.affectedRuleFields.includes("steam_deck")) {
    const after = readableValue(fieldValue(change, "after", "steam_deck"));
    return after
      ? `Steam Deck support changed to ${readablePlatform(after)}.`
      : "Steam Deck support changed, but the new rating is unavailable.";
  }
  if (change.affectedRuleFields.includes("controller_support")) {
    const before = readableValue(
      fieldValue(change, "before", "controller_support"),
    );
    const after = readableValue(
      fieldValue(change, "after", "controller_support"),
    );
    if (before && after && before !== after) {
      return `Controller support changed from ${readablePlatform(before)} to ${readablePlatform(after)}.`;
    }
    return after
      ? `Controller support changed to ${readablePlatform(after)}.`
      : "Controller support changed, but the new setting is unavailable.";
  }
  if (change.affectedRuleFields.includes("languages")) {
    const before = asStringList(fieldValue(change, "before", "languages"));
    const after = asStringList(fieldValue(change, "after", "languages"));
    const added = listDifference(after, before);
    const removed = listDifference(before, after);
    if (added.length > 0 && removed.length === 0) {
      return `Language support added: ${joinNatural(added)}.`;
    }
    if (removed.length > 0 && added.length === 0) {
      return `Language support removed: ${joinNatural(removed)}.`;
    }
  }

  const before = asStringList(
    fieldValue(change, "before", "platforms", [
      "supported_platforms",
      "platform",
    ]),
  );
  const after = asStringList(
    fieldValue(change, "after", "platforms", [
      "supported_platforms",
      "platform",
    ]),
  );
  const added = listDifference(after, before).map(readablePlatform);
  const removed = listDifference(before, after).map(readablePlatform);
  if (added.length > 0 && removed.length === 0) {
    return `${joinNatural(added)} support ${added.length === 1 ? "was" : "were"} added.`;
  }
  if (removed.length > 0 && added.length === 0) {
    return `${joinNatural(removed)} support ${removed.length === 1 ? "was" : "were"} removed.`;
  }
  if (added.length > 0 || removed.length > 0) {
    return `Platform support added: ${joinNatural(added)}. Platform support removed: ${joinNatural(removed)}.`;
  }
  return "Platform support changed, but the affected platform is unavailable.";
}

function describePriceChange(change: OpportunityChangeInput): string {
  if (
    change.affectedRuleFields.includes("discount_percent") &&
    !change.affectedRuleFields.includes("price_cents") &&
    !change.affectedRuleFields.includes("is_free") &&
    !change.affectedRuleFields.includes("has_purchase_packages")
  ) {
    return describeDiscountChange(change);
  }

  const wasFree = booleanValue(fieldValue(change, "before", "is_free"));
  const isFree = booleanValue(fieldValue(change, "after", "is_free"));
  if (wasFree === false && isFree === true) {
    return "The game became free to play.";
  }
  if (wasFree === true && isFree === false) {
    return "The game changed from free to play to a paid release.";
  }

  const beforePrice = fieldValue(change, "before", "price_cents", [
    "current_price_cents",
    "price",
  ]);
  const afterPrice = fieldValue(change, "after", "price_cents", [
    "current_price_cents",
    "price",
  ]);
  const beforeAmount = Number(beforePrice);
  const afterAmount = Number(afterPrice);
  const previous = formatCurrency(beforePrice);
  const next = formatCurrency(afterPrice);
  const afterDiscount = discountValue(
    fieldValue(change, "after", "discount_percent"),
  );
  const discountSuffix =
    afterDiscount !== null && afterDiscount > 0
      ? ` (${formatDiscount(afterDiscount)} off)`
      : "";
  if (
    previous &&
    next &&
    Number.isFinite(beforeAmount) &&
    Number.isFinite(afterAmount) &&
    beforeAmount !== afterAmount
  ) {
    return `Price ${afterAmount < beforeAmount ? "lowered" : "raised"} from ${previous} to ${next}${discountSuffix}.`;
  }

  const hadPackage = booleanValue(
    fieldValue(change, "before", "has_purchase_packages"),
  );
  const hasPackage = booleanValue(
    fieldValue(change, "after", "has_purchase_packages"),
  );
  if (hadPackage === false && hasPackage === true) {
    return "A purchase option was added.";
  }
  if (hadPackage === true && hasPackage === false) {
    return "A purchase option was removed.";
  }
  if (next && !previous) {
    return `The Steam price is now ${next}; the previous price is unavailable.`;
  }
  if (previous && !next) {
    return `The previous Steam price was ${previous}; the new price is unavailable.`;
  }
  if (change.affectedRuleFields.includes("discount_percent")) {
    return describeDiscountChange(change);
  }
  return "Steam pricing changed, but the before-and-after prices are unavailable.";
}

function discountValue(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? number
    : null;
}

function formatDiscount(value: number): string {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}%`;
}

function describeDiscountChange(change: OpportunityChangeInput): string {
  const before = discountValue(
    fieldValue(change, "before", "discount_percent"),
  );
  const after = discountValue(fieldValue(change, "after", "discount_percent"));
  if (before !== null && after !== null && before !== after) {
    if (before === 0 && after > 0) {
      return `A Steam discount started at ${formatDiscount(after)} off.`;
    }
    if (before > 0 && after === 0) {
      return `The ${formatDiscount(before)} Steam discount ended.`;
    }
    return `Steam discount ${after > before ? "increased" : "decreased"} from ${formatDiscount(before)} to ${formatDiscount(after)} off.`;
  }
  if (after !== null && after > 0) {
    return `The Steam discount is now ${formatDiscount(after)} off.`;
  }
  return "The Steam discount changed, but the before-and-after percentages are unavailable.";
}

function describeReleaseDateChange(change: OpportunityChangeInput): string {
  const before = fieldValue(change, "before", "release_date", [
    "release_date_raw",
    "releaseDate",
  ]);
  const after = fieldValue(change, "after", "release_date", [
    "release_date_raw",
    "releaseDate",
  ]);
  const previous = formatDay(before);
  const next = formatDay(after);
  if (previous && next) {
    return `Release date moved from ${previous} to ${next}.`;
  }
  if (next) {
    return `Release date moved to ${next}; the previous date is unavailable.`;
  }
  return "The release date changed, but the before-and-after dates are unavailable.";
}

function describeMetricChange(
  change: OpportunityChangeInput,
  field: "ccu_peak" | "total_reviews",
): string {
  const before = Number(fieldValue(change, "before", field));
  const after = Number(fieldValue(change, "after", field));
  const label =
    field === "ccu_peak" ? "Peak concurrent players" : "Total Steam reviews";
  if (Number.isFinite(before) && Number.isFinite(after)) {
    return `${label} ${after >= before ? "increased" : "decreased"} from ${before.toLocaleString()} to ${after.toLocaleString()}.`;
  }
  if (Number.isFinite(after)) {
    return `${label} reached ${after.toLocaleString()}.`;
  }
  return `${label} crossed a new milestone; the exact count is unavailable.`;
}

function describeBuildChange(change: OpportunityChangeInput): string {
  const afterLeaves = primitiveLeaves(change.after);
  const publishedAt = afterLeaves
    .map((value) => formatDay(value))
    .filter((value): value is string => Boolean(value))
    .at(-1);
  if (publishedAt) {
    return `A new Steam build was published on ${publishedAt}.`;
  }
  const beforeBuild = primitiveLeaves(change.before).find((value) =>
    /^\d{5,}$/.test(String(value)),
  );
  const afterBuild = afterLeaves.find((value) =>
    /^\d{5,}$/.test(String(value)),
  );
  if (beforeBuild && afterBuild && beforeBuild !== afterBuild) {
    return `Steam build ${afterBuild} replaced build ${beforeBuild}.`;
  }
  return "A new Steam build was published; the build date is unavailable.";
}

function describeStoreChange(change: OpportunityChangeInput): string {
  const serialized = JSON.stringify([change.before, change.after])
    .toLocaleLowerCase()
    .replaceAll("_", "");
  if (serialized.includes("trailer") || serialized.includes("movie")) {
    return "The trailer lineup was updated.";
  }
  if (serialized.includes("screenshot")) {
    return "The Steam screenshots were updated.";
  }
  if (
    serialized.includes("purchase") ||
    serialized.includes("package") ||
    change.affectedRuleFields.includes("has_purchase_packages")
  ) {
    return describePriceChange(change);
  }
  if (
    serialized.includes("demo") ||
    change.affectedRuleFields.includes("has_demo")
  ) {
    return "A playable demo was added.";
  }
  if (
    serialized.includes("capsule") ||
    serialized.includes("headerimage") ||
    serialized.includes("storeart")
  ) {
    return "The Steam store artwork was updated.";
  }
  return "Steam store content changed, but the affected section is unavailable.";
}

function describeKnownFieldChange(
  change: OpportunityChangeInput,
  taxonomy: OpportunityTaxonomyNames,
): string | null {
  const field = change.affectedRuleFields[0];
  if (!field) {
    return null;
  }
  if (field === "developer") return describePartyChange(change, "developer");
  if (field === "publisher") return describePartyChange(change, "publisher");
  if (field === "release_date" || field === "days_until_release") {
    return describeReleaseDateChange(change);
  }
  if (
    field === "price_cents" ||
    field === "is_free" ||
    field === "has_purchase_packages"
  ) {
    return describePriceChange(change);
  }
  if (field === "discount_percent") {
    return describeDiscountChange(change);
  }
  if (field === "tags" || field === "genres" || field === "categories") {
    return describeTaxonomyChange(change, taxonomy);
  }
  if (
    field === "platforms" ||
    field === "controller_support" ||
    field === "steam_deck" ||
    field === "languages"
  ) {
    return describePlatformChange(change);
  }
  if (field === "has_demo") {
    const after = booleanValue(fieldValue(change, "after", "has_demo"));
    return after === false
      ? "The playable demo was removed."
      : "A playable demo was added.";
  }
  if (field === "total_reviews" || field === "ccu_peak") {
    return describeMetricChange(change, field);
  }
  const before = readableValue(fieldValue(change, "before", field));
  const after = readableValue(fieldValue(change, "after", field));
  const label = field
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
  if (before && after && before !== after) {
    return `${label} changed from ${before} to ${after}.`;
  }
  if (after) {
    return `${label} changed to ${after}; the previous value is unavailable.`;
  }
  return `${label} changed, but the before-and-after values are unavailable.`;
}

export function describeOpportunityChange(
  change: OpportunityChangeInput | null,
  fallbackLabel: OpportunityResultLabel = "newly_qualified",
  taxonomy: OpportunityTaxonomyNames = EMPTY_OPPORTUNITY_TAXONOMY_NAMES,
): string {
  if (!change) {
    return {
      materially_changed:
        "Steam activity made this game relevant, but the affected field is unavailable.",
      newly_discovered: "PublisherIQ identified this game on Steam.",
      newly_qualified: "The game now matches your sourcing criteria.",
      newly_released: "The game was released on Steam.",
      tracked_update:
        "A tracked game changed, but the affected field is unavailable.",
    }[fallbackLabel];
  }
  switch (change.eventType) {
    case "developer_changed":
      return describePartyChange(change, "developer");
    case "publisher_changed":
      return describePartyChange(change, "publisher");
    case "demo_added":
      return "A playable demo was added.";
    case "release_timing_changed":
      return describeReleaseDateChange(change);
    case "business_model_changed":
      return describePriceChange(change);
    case "platform_expanded":
      return describePlatformChange(change);
    case "taxonomy_repositioned":
      return describeTaxonomyChange(change, taxonomy);
    case "released":
      return "The game was released on Steam.";
    case "first_observed":
      return "PublisherIQ identified this game on Steam.";
    case "date_window_changed":
      return "The game entered or left a saved calendar-date window.";
    case "announcement": {
      const title = findNestedValue(change.after, [
        "title",
        "headline",
        "announcement_title",
      ]);
      return typeof title === "string" && title.trim()
        ? `“${decodeOpportunityText(title.trim())}” was announced on Steam.`
        : "A new official Steam announcement was published.";
    }
    case "review_breakthrough":
      return describeMetricChange(change, "total_reviews");
    case "ccu_breakthrough":
      return describeMetricChange(change, "ccu_peak");
    case "store_readiness_improved":
      return describeStoreChange(change);
    case "material_change":
      if (change.signalFamily === "build") {
        return describeBuildChange(change);
      }
      return (
        describeKnownFieldChange(change, taxonomy) ??
        (change.signalFamily === "media"
          ? "The Steam media lineup changed, but the affected asset is unavailable."
          : change.signalFamily === "store-page"
            ? describeStoreChange(change)
            : "Steam recorded a change, but the affected field is unavailable.")
      );
  }
}

export function presentOpportunityChange(
  change: OpportunityChangeInput | null,
  fallbackLabel: OpportunityResultLabel,
  taxonomy: OpportunityTaxonomyNames = EMPTY_OPPORTUNITY_TAXONOMY_NAMES,
): OpportunityObservedChange | null {
  if (!change) {
    return null;
  }
  const decoded = decodeOpportunityValue(change);
  return {
    ...decoded,
    summary: describeOpportunityChange(decoded, fallbackLabel, taxonomy),
  };
}

export function opportunityChangeSummary(
  change: OpportunityObservedChange | null,
  fallbackLabel: OpportunityResultLabel,
): string {
  return change?.summary ?? describeOpportunityChange(null, fallbackLabel);
}

export function cleanOpportunityEvidence(
  evidence: string[],
  changeSummary: string,
): string[] {
  return Array.from(
    new Set(
      [changeSummary, ...evidence.map(decodeOpportunityText)].filter(
        (item) =>
          !/\b(?:production smoke|an important steam detail changed|subscribed material steam signal|price changed from)\b/i.test(
            item,
          ),
      ),
    ),
  ).slice(0, 4);
}

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
