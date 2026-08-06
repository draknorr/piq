import {
  OPPORTUNITY_CONFIDENCE_VERSION,
  OPPORTUNITY_REVIEW_PRIORITY_VERSION,
  type OpportunityInputAssessment,
  type OpportunityInputAvailability,
  type OpportunityReviewPriorityComponent,
  type OpportunityReviewPriorityDecision,
  type OpportunityReviewPriorityInput,
} from "./types.js";

export const OPPORTUNITY_REVIEW_PRIORITY_STORAGE_VERSION =
  "opportunity-review-priority-storage/v1" as const;

const COMPONENT_KEYS = [
  "preferred_profile_match",
  "publishing_openness",
  "comparable_market_attractiveness",
  "product_store_readiness",
  "freshness_launch_timing",
  "traction_level",
  "traction_acceleration",
  "peer_position",
  "market_context",
  "profile_relevance",
  "event_significance",
  "event_recency",
  "corroboration_consistency",
] as const;

const INPUT_KEYS = [
  "eligibility",
  "publishing_openness",
  "comparable_market_attractiveness",
  "first_observed_at",
  "total_reviews",
  "ccu_peak",
  "reviews_added_7d",
  "reviews_added_30d",
  "ccu_change_7d",
  "ccu_change_30d",
  "review_rate_delta",
  "current_traction_level",
  "traction_acceleration_signal",
  "event_materiality",
] as const;

const INPUT_REASON_CODES = [
  "eligible_after_required_and_excluded_rules",
  "publishing_openness_unknown",
  "no_publisher_listed",
  "self_published",
  "market_large_but_competitive",
  "market_meaningful",
  "market_developing",
  "market_limited",
  "market_insufficient_data",
  "readiness_unavailable",
  "readiness_present",
  "readiness_missing",
  "first_observation_unavailable",
  "immutable_first_observation",
  "not_applicable_for_lane",
  "source_unavailable",
  "known_non_positive",
  "observed",
  "cohort_review_rate_distribution_unavailable",
  "at_least_one_current_level_required",
  "at_least_one_acceleration_input_required",
  "first_observation_suppressed",
  "material_event",
] as const;

const AVAILABILITIES: OpportunityInputAvailability[] = [
  "available",
  "unavailable",
  "not_applicable",
];
const ASSESSMENTS: OpportunityInputAssessment[] = [
  "positive",
  "neutral",
  "negative",
  "mixed",
  "not_assessed",
];
const CONFIDENCE_LABELS = ["high", "directional", "limited"] as const;
const CONFIDENCE_REASONS = [
  "critical_input_unavailable",
  "critical_input_stale",
  "post_release_traction_not_applicable",
  "cohort_coverage_limited",
] as const;
const LANES = ["new_game", "traction", "material_change"] as const;
const POLICIES = [
  "discover_new_games",
  "find_emerging_traction",
  "monitor_material_changes",
] as const;
const PRIORITY_BANDS = ["review_now", "review_soon", "monitor"] as const;
const SELECTION_SOURCES = ["explicit", "legacy_inference"] as const;
const DECISION_REASONS = [
  "New on Steam",
  "Early traction is moving",
  "Material Steam change",
  "Self-published",
  "Large, competitive market",
  "Positive reception",
] as const;
const COMPONENT_BASE_WEIGHTS: Record<string, number> = {
  comparable_market_attractiveness: 0.2,
  corroboration_consistency: 0.15,
  event_recency: 0.25,
  event_significance: 0.35,
  freshness_launch_timing: 0.1,
  market_context: 0.1,
  peer_position: 0.15,
  product_store_readiness: 0.1,
  profile_relevance: 0.25,
  publishing_openness: 0.25,
  traction_acceleration: 0.3,
  traction_level: 0.25,
};
const POLICY_COMPONENT_KEYS: Record<
  OpportunityReviewPriorityDecision["policy"],
  readonly string[]
> = {
  discover_new_games: [
    "preferred_profile_match",
    "publishing_openness",
    "comparable_market_attractiveness",
    "product_store_readiness",
    "freshness_launch_timing",
  ],
  find_emerging_traction: [
    "preferred_profile_match",
    "traction_level",
    "traction_acceleration",
    "peer_position",
    "market_context",
  ],
  monitor_material_changes: [
    "preferred_profile_match",
    "profile_relevance",
    "event_significance",
    "event_recency",
    "corroboration_consistency",
  ],
};
const INPUT_SOURCES = [
  "profile_evaluation",
  "profile_rule_outcome",
  "steam_storefront",
  "opportunity.market_context_snapshots",
  "ops.app_data_readiness",
  "metrics.app_signal_windows_v1",
  "opportunity.released_cohort_features_v2",
  "opportunity.material_events",
  "opportunity-ranking/v2",
  "production-scale-fixture",
] as const;
const CALCULATION_VERSIONS = [
  null,
  "opportunity-ranking/v2",
  "signal-windows/v1",
  "opportunity-cohort-features/v2",
] as const;

type EncodedText = number | string | [number, string];

function codeIndexes(
  values: readonly string[],
): Readonly<Record<string, number>> {
  const indexes: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (let index = 0; index < values.length; index += 1) {
    indexes[values[index]!] = index;
  }
  return indexes;
}

const COMPONENT_KEY_INDEXES = codeIndexes(COMPONENT_KEYS);
const DECISION_REASON_INDEXES = codeIndexes(DECISION_REASONS);
const CONFIDENCE_LABEL_INDEXES = codeIndexes(CONFIDENCE_LABELS);
const CONFIDENCE_REASON_INDEXES = codeIndexes(CONFIDENCE_REASONS);
const LANE_INDEXES = codeIndexes(LANES);
const POLICY_INDEXES = codeIndexes(POLICIES);
const PRIORITY_BAND_INDEXES = codeIndexes(PRIORITY_BANDS);
const SELECTION_SOURCE_INDEXES = codeIndexes(SELECTION_SOURCES);

export interface OpportunityReviewPriorityStorageV1 {
  a: string[];
  b: number;
  c: unknown[];
  e: typeof OPPORTUNITY_REVIEW_PRIORITY_STORAGE_VERSION;
  f: unknown[];
  h?: string[];
  i: unknown[][];
  l: number;
  p: number;
  q?: number;
  r: EncodedText[];
  s?: number | null;
  t: OpportunityReviewPriorityDecision["sortTuple"];
  w?: string;
  y: Array<string | null>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function encodeCode(
  indexes: Readonly<Record<string, number>>,
  value: string,
): number | string {
  return indexes[value] ?? value;
}

function decodeOpenCode(
  values: readonly string[],
  value: unknown,
): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) < values.length
    ? values[Number(value)]!
    : null;
}

function encodeNullableCode(
  values: readonly (string | null)[],
  value: string | null,
): number | string {
  const index = values.indexOf(value);
  return index === -1 ? (value ?? 0) : index;
}

function decodeNullableOpenCode(
  values: readonly (string | null)[],
  value: unknown,
): string | null | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) < values.length
    ? values[Number(value)]
    : undefined;
}

function decodeClosedCode<T extends string>(
  values: readonly T[],
  value: unknown,
): T | null {
  return Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) < values.length
    ? values[Number(value)]!
    : null;
}

function encodeInputKey(value: string): EncodedText {
  switch (value) {
    case "eligibility":
      return 0;
    case "publishing_openness":
      return 1;
    case "comparable_market_attractiveness":
      return 2;
    case "first_observed_at":
      return 3;
    case "total_reviews":
      return 4;
    case "ccu_peak":
      return 5;
    case "reviews_added_7d":
      return 6;
    case "reviews_added_30d":
      return 7;
    case "ccu_change_7d":
      return 8;
    case "ccu_change_30d":
      return 9;
    case "review_rate_delta":
      return 10;
    case "current_traction_level":
      return 11;
    case "traction_acceleration_signal":
      return 12;
    case "event_materiality":
      return 13;
  }
  if (value[0] === "p" && value.startsWith("preferred:")) {
    return [0, value.slice(10)];
  }
  if (value[0] === "r" && value.startsWith("readiness:")) {
    return [1, value.slice(10)];
  }
  return value;
}

function decodeInputKey(value: unknown): string | null {
  if (Array.isArray(value) && value.length === 2) {
    const [prefix, suffix] = value;
    if (
      (prefix === 0 || prefix === 1) &&
      typeof suffix === "string" &&
      suffix
    ) {
      return `${prefix === 0 ? "preferred:" : "readiness:"}${suffix}`;
    }
    return null;
  }
  return decodeOpenCode(INPUT_KEYS, value);
}

function encodeReasonCode(value: string): EncodedText {
  switch (value) {
    case "eligible_after_required_and_excluded_rules":
      return 0;
    case "publishing_openness_unknown":
      return 1;
    case "no_publisher_listed":
      return 2;
    case "self_published":
      return 3;
    case "market_large_but_competitive":
      return 4;
    case "market_meaningful":
      return 5;
    case "market_developing":
      return 6;
    case "market_limited":
      return 7;
    case "market_insufficient_data":
      return 8;
    case "readiness_unavailable":
      return 9;
    case "readiness_present":
      return 10;
    case "readiness_missing":
      return 11;
    case "first_observation_unavailable":
      return 12;
    case "immutable_first_observation":
      return 13;
    case "not_applicable_for_lane":
      return 14;
    case "source_unavailable":
      return 15;
    case "known_non_positive":
      return 16;
    case "observed":
      return 17;
    case "cohort_review_rate_distribution_unavailable":
      return 18;
    case "at_least_one_current_level_required":
      return 19;
    case "at_least_one_acceleration_input_required":
      return 20;
    case "first_observation_suppressed":
      return 21;
    case "material_event":
      return 22;
  }
  return value[0] === "p" && value.startsWith("preferred_")
    ? [0, value.slice(10)]
    : value;
}

function encodeInputSource(value: string): number | string {
  switch (value) {
    case "profile_evaluation":
      return 0;
    case "profile_rule_outcome":
      return 1;
    case "steam_storefront":
      return 2;
    case "opportunity.market_context_snapshots":
      return 3;
    case "ops.app_data_readiness":
      return 4;
    case "metrics.app_signal_windows_v1":
      return 5;
    case "opportunity.released_cohort_features_v2":
      return 6;
    case "opportunity.material_events":
      return 7;
    case "opportunity-ranking/v2":
      return 8;
    case "production-scale-fixture":
      return 9;
    default:
      return value;
  }
}

function decodeReasonCode(value: unknown): string | null {
  if (Array.isArray(value) && value.length === 2) {
    const [prefix, suffix] = value;
    return prefix === 0 && typeof suffix === "string" && suffix
      ? `preferred_${suffix}`
      : null;
  }
  return decodeOpenCode(INPUT_REASON_CODES, value);
}

function indexValue<T>(values: T[], value: T): number {
  const existing = values.indexOf(value);
  if (existing !== -1) return existing;
  values.push(value);
  return values.length - 1;
}

function componentBaseWeight(
  key: string,
  policy: OpportunityReviewPriorityDecision["policy"],
): number | null {
  if (key === "preferred_profile_match") {
    return policy === "discover_new_games"
      ? 0.35
      : policy === "find_emerging_traction"
        ? 0.2
        : 0.25;
  }
  return COMPONENT_BASE_WEIGHTS[key] ?? null;
}

function encodeComponent(
  component: OpportunityReviewPriorityComponent,
  policy: OpportunityReviewPriorityDecision["policy"],
): unknown[] {
  const encodedKey = encodeCode(COMPONENT_KEY_INDEXES, component.key);
  const baseWeight = componentBaseWeight(component.key, policy);
  if (
    baseWeight !== null &&
    component.baseWeight === baseWeight &&
    component.effectiveWeight === (component.value === null ? 0 : baseWeight) &&
    component.contribution ===
      (component.value === null ? null : component.value * baseWeight)
  ) {
    return [encodedKey, component.value];
  }
  return [
    encodedKey,
    component.baseWeight,
    component.contribution,
    component.effectiveWeight,
    component.value,
  ];
}

export function encodeOpportunityReviewPriorityDecision(
  decision: OpportunityReviewPriorityDecision,
): OpportunityReviewPriorityStorageV1 {
  const sourceAts: Array<string | null> = [];
  const components: unknown[] = new Array(decision.components.length);
  const standardKeys = POLICY_COMPONENT_KEYS[decision.policy];
  let standardComponents = decision.components.length === standardKeys.length;
  for (let offset = 0; offset < decision.components.length; offset += 1) {
    const component = decision.components[offset]!;
    const baseWeight = componentBaseWeight(component.key, decision.policy);
    if (
      standardComponents &&
      (component.key !== standardKeys[offset] ||
        baseWeight === null ||
        component.baseWeight !== baseWeight ||
        component.effectiveWeight !==
          (component.value === null ? 0 : baseWeight) ||
        component.contribution !==
          (component.value === null ? null : component.value * baseWeight))
    ) {
      standardComponents = false;
    }
    components[offset] = component.value;
  }
  if (!standardComponents) {
    for (let offset = 0; offset < decision.components.length; offset += 1) {
      components[offset] = encodeComponent(
        decision.components[offset]!,
        decision.policy,
      );
    }
  }
  const inputs: unknown[][] = new Array(decision.inputs.length);
  for (let offset = 0; offset < decision.inputs.length; offset += 1) {
    const input = decision.inputs[offset]!;
    const sameRawValue = Object.is(input.rawValue, input.normalizedValue);
    const availability = AVAILABILITIES.indexOf(input.availability);
    const encoded: unknown[] = sameRawValue
      ? [
          encodeInputKey(input.key),
          encodeInputSource(input.source),
          indexValue(sourceAts, input.sourceAt),
          encodeNullableCode(CALCULATION_VERSIONS, input.calculationVersion),
          -availability - 1,
          ASSESSMENTS.indexOf(input.assessment),
          input.normalizedValue,
          encodeReasonCode(input.reasonCode),
        ]
      : [
          encodeInputKey(input.key),
          encodeInputSource(input.source),
          indexValue(sourceAts, input.sourceAt),
          encodeNullableCode(CALCULATION_VERSIONS, input.calculationVersion),
          availability,
          ASSESSMENTS.indexOf(input.assessment),
          input.rawValue,
          input.normalizedValue,
          encodeReasonCode(input.reasonCode),
        ];
    if (input.confidenceWeight !== 1 || input.criticalForConfidence) {
      encoded.push(input.confidenceWeight, input.criticalForConfidence ? 1 : 0);
    }
    inputs[offset] = encoded;
  }
  const reasons: EncodedText[] = new Array(decision.reasons.length);
  for (let offset = 0; offset < decision.reasons.length; offset += 1) {
    reasons[offset] = encodeCode(
      DECISION_REASON_INDEXES,
      decision.reasons[offset]!,
    );
  }
  return {
    a: decision.allMatchedProfileIds,
    b: PRIORITY_BAND_INDEXES[decision.priorityBand]!,
    c: components,
    e: OPPORTUNITY_REVIEW_PRIORITY_STORAGE_VERSION,
    f: [
      CONFIDENCE_LABEL_INDEXES[decision.confidence.label]!,
      decision.confidence.score,
      decision.confidence.reasons.map((reason) =>
        encodeCode(CONFIDENCE_REASON_INDEXES, reason),
      ),
      decision.confidence.applicableCount,
      decision.confidence.presentCount,
      decision.confidence.staleCount,
      decision.confidence.conflictingCount,
    ],
    h:
      decision.eligibilityReasonCodes.length > 0
        ? decision.eligibilityReasonCodes
        : undefined,
    i: inputs,
    l: LANE_INDEXES[decision.lane]!,
    p: POLICY_INDEXES[decision.policy]!,
    q:
      decision.selectionSource === "explicit"
        ? undefined
        : SELECTION_SOURCE_INDEXES[decision.selectionSource]!,
    r: reasons,
    s:
      decision.internalScore === decision.sortTuple[2]
        ? undefined
        : decision.internalScore,
    t: decision.sortTuple,
    w:
      decision.winningProfileId === decision.sortTuple[5]
        ? undefined
        : decision.winningProfileId,
    y: sourceAts,
  };
}

function decodeComponent(
  value: unknown,
  policy: OpportunityReviewPriorityDecision["policy"],
): OpportunityReviewPriorityComponent | null {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 5)) {
    return null;
  }
  const key = decodeOpenCode(COMPONENT_KEYS, value[0]);
  if (!key) return null;
  if (value.length === 2) {
    const componentValue = value[1];
    const baseWeight = componentBaseWeight(key, policy);
    if (
      baseWeight === null ||
      !(componentValue === null || typeof componentValue === "number")
    ) {
      return null;
    }
    return {
      baseWeight,
      contribution:
        componentValue === null ? null : componentValue * baseWeight,
      effectiveWeight: componentValue === null ? 0 : baseWeight,
      key,
      value: componentValue,
    };
  }
  const [baseWeight, contribution, effectiveWeight, componentValue] =
    value.slice(1);
  if (
    typeof baseWeight !== "number" ||
    !(contribution === null || typeof contribution === "number") ||
    typeof effectiveWeight !== "number" ||
    !(componentValue === null || typeof componentValue === "number")
  ) {
    return null;
  }
  return {
    baseWeight,
    contribution,
    effectiveWeight,
    key,
    value: componentValue,
  };
}

function decodeDictionaryValue<T>(values: T[], index: unknown): T | undefined {
  return Number.isInteger(index) &&
    Number(index) >= 0 &&
    Number(index) < values.length
    ? values[Number(index)]
    : undefined;
}

function decodeInput(params: {
  sourceAts: Array<string | null>;
  value: unknown;
}): OpportunityReviewPriorityInput | null {
  const { value } = params;
  if (!Array.isArray(value) || ![8, 9, 10, 11].includes(value.length)) {
    return null;
  }
  const sameRawValue = value.length === 8 || value.length === 10;
  const key = decodeInputKey(value[0]);
  const source = decodeOpenCode(INPUT_SOURCES, value[1]);
  const sourceAt = decodeDictionaryValue(params.sourceAts, value[2]);
  const calculationVersion = decodeNullableOpenCode(
    CALCULATION_VERSIONS,
    value[3],
  );
  const availability = decodeClosedCode(
    AVAILABILITIES,
    sameRawValue ? -Number(value[4]) - 1 : value[4],
  );
  const assessment = decodeClosedCode(ASSESSMENTS, value[5]);
  const normalizedValue = sameRawValue ? value[6] : value[7];
  const reasonCode = decodeReasonCode(sameRawValue ? value[7] : value[8]);
  const confidenceWeight =
    value.length === 10 ? value[8] : value.length === 11 ? value[9] : 1;
  const critical =
    value.length === 10 ? value[9] : value.length === 11 ? value[10] : 0;
  if (
    !key ||
    !source ||
    sourceAt === undefined ||
    calculationVersion === undefined ||
    !availability ||
    !assessment ||
    !(normalizedValue === null || typeof normalizedValue === "number") ||
    !reasonCode ||
    typeof confidenceWeight !== "number" ||
    (critical !== 0 && critical !== 1)
  ) {
    return null;
  }
  return {
    assessment,
    availability,
    calculationVersion,
    confidenceWeight,
    criticalForConfidence: critical === 1,
    key,
    normalizedValue,
    rawValue: sameRawValue ? normalizedValue : value[6],
    reasonCode,
    source,
    sourceAt,
  };
}

function decodeStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function decodeNullableStringArray(
  value: unknown,
): Array<string | null> | null {
  return Array.isArray(value) &&
    value.every((item) => item === null || typeof item === "string")
    ? value
    : null;
}

export function decodeOpportunityReviewPriorityDecision(
  value: unknown,
): unknown {
  const row = record(value);
  if (!row || row.e !== OPPORTUNITY_REVIEW_PRIORITY_STORAGE_VERSION) {
    return value;
  }
  const allMatchedProfileIds = decodeStringArray(row.a);
  const reasons = Array.isArray(row.r)
    ? row.r.map((reason) => decodeOpenCode(DECISION_REASONS, reason))
    : null;
  const eligibilityReasonCodes =
    row.h === undefined ? [] : decodeStringArray(row.h);
  const sourceAts = decodeNullableStringArray(row.y);
  const lane = decodeClosedCode(LANES, row.l);
  const policy = decodeClosedCode(POLICIES, row.p);
  const priorityBand = decodeClosedCode(PRIORITY_BANDS, row.b);
  const selectionSource = decodeClosedCode(
    SELECTION_SOURCES,
    row.q === undefined ? 0 : row.q,
  );
  if (
    !allMatchedProfileIds ||
    !reasons ||
    reasons.some((reason) => reason === null) ||
    !eligibilityReasonCodes ||
    !sourceAts ||
    !lane ||
    !policy ||
    !priorityBand ||
    !selectionSource ||
    !Array.isArray(row.c) ||
    !Array.isArray(row.i) ||
    !Array.isArray(row.f) ||
    row.f.length !== 7 ||
    !Array.isArray(row.t) ||
    !(row.s === undefined || row.s === null || typeof row.s === "number") ||
    !(row.w === undefined || typeof row.w === "string")
  ) {
    return null;
  }
  const standardComponentKeys = POLICY_COMPONENT_KEYS[policy];
  const standardComponents =
    row.c.length === standardComponentKeys.length &&
    row.c.every(
      (component) => component === null || typeof component === "number",
    );
  const components: Array<OpportunityReviewPriorityComponent | null> =
    new Array(row.c.length);
  for (let offset = 0; offset < row.c.length; offset += 1) {
    if (!standardComponents) {
      components[offset] = decodeComponent(row.c[offset], policy);
      continue;
    }
    const key = standardComponentKeys[offset]!;
    const baseWeight = componentBaseWeight(key, policy)!;
    const componentValue = row.c[offset] as number | null;
    components[offset] = {
      baseWeight,
      contribution:
        componentValue === null ? null : componentValue * baseWeight,
      effectiveWeight: componentValue === null ? 0 : baseWeight,
      key,
      value: componentValue,
    };
  }
  const inputs = row.i.map((input) => decodeInput({ sourceAts, value: input }));
  const confidenceLabel = decodeClosedCode(CONFIDENCE_LABELS, row.f[0]);
  const confidenceReasons = Array.isArray(row.f[2])
    ? row.f[2].map((reason) => decodeOpenCode(CONFIDENCE_REASONS, reason))
    : null;
  if (
    components.some((component) => component === null) ||
    inputs.some((input) => input === null) ||
    !confidenceLabel ||
    !confidenceReasons ||
    confidenceReasons.some((reason) => reason === null)
  ) {
    return null;
  }
  return {
    allMatchedProfileIds,
    components,
    confidence: {
      applicableCount: row.f[3],
      conflictingCount: row.f[6],
      label: confidenceLabel,
      presentCount: row.f[4],
      reasons: confidenceReasons as string[],
      score: row.f[1],
      staleCount: row.f[5],
      version: OPPORTUNITY_CONFIDENCE_VERSION,
    },
    eligibility: "eligible",
    eligibilityReasonCodes,
    inputs,
    internalScore: row.s === undefined ? row.t[2] : row.s,
    lane,
    policy,
    priorityBand,
    reasons: reasons as string[],
    selectionSource,
    sortTuple: row.t,
    version: OPPORTUNITY_REVIEW_PRIORITY_VERSION,
    winningProfileId: row.w === undefined ? row.t[5] : row.w,
  };
}
