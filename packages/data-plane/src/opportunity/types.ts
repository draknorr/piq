export const OPPORTUNITY_RULE_SCHEMA_VERSION = "opportunity-rules/v1" as const;
export const OPPORTUNITY_RANKING_VERSION = "opportunity-ranking/v1" as const;
export const OPPORTUNITY_COHORT_VERSION = "opportunity-cohort/v1" as const;
export const OPPORTUNITY_MARKET_VERSION = "opportunity-market/v1" as const;
export const OPPORTUNITY_HEALTH_VERSION = "opportunity-health/v1" as const;
export const OPPORTUNITY_MATERIALITY_VERSION =
  "opportunity-materiality/v1" as const;

export type OpportunityTriState = "true" | "false" | "unknown";
export type OpportunityRuleGroupOperator = "any" | "all";
export type OpportunityPreferenceImportance = "low" | "medium" | "high";
export type OpportunityConfidence = "high" | "directional";
export type OpportunityEvidenceClass =
  | "observed_fact"
  | "derived_metric"
  | "publisheriq_interpretation";

export type OpportunityRuleField =
  | "appid"
  | "name"
  | "app_type"
  | "developer"
  | "publisher"
  | "release_state"
  | "is_released"
  | "release_date"
  | "days_until_release"
  | "tags"
  | "genres"
  | "categories"
  | "is_free"
  | "price_cents"
  | "discount_percent"
  | "has_purchase_packages"
  | "platforms"
  | "controller_support"
  | "steam_deck"
  | "languages"
  | "has_demo"
  | "no_publisher_listed"
  | "self_published"
  | "publisher_game_count"
  | "developer_game_count"
  | "content_descriptors"
  | "total_reviews"
  | "positive_percentage"
  | "reviews_added_7d"
  | "reviews_added_30d"
  | "ccu_peak"
  | "ccu_change_7d"
  | "ccu_change_30d";

export type OpportunityRuleOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "between"
  | "exists"
  | "not_exists";

export type OpportunityRuleValue =
  | boolean
  | number
  | string
  | null
  | Array<boolean | number | string>;

export interface OpportunityRuleClause {
  field: OpportunityRuleField;
  id: string;
  label?: string;
  operator: OpportunityRuleOperator;
  value?: OpportunityRuleValue;
}

export interface OpportunityRuleGroup {
  clauses: OpportunityRuleClause[];
  id: string;
  label: string;
  operator: OpportunityRuleGroupOperator;
}

export interface OpportunityPreferredRuleGroup extends OpportunityRuleGroup {
  importance: OpportunityPreferenceImportance;
}

export interface OpportunityRuleSet {
  excluded: OpportunityRuleGroup[];
  preferred: OpportunityPreferredRuleGroup[];
  required: OpportunityRuleGroup[];
  schemaVersion: typeof OPPORTUNITY_RULE_SCHEMA_VERSION;
}

export interface OpportunityFieldValue {
  calculationVersion?: string | null;
  confidence: OpportunityConfidence;
  evidenceClass: Exclude<
    OpportunityEvidenceClass,
    "publisheriq_interpretation"
  >;
  reason?: string | null;
  source: string;
  sourceAt: string | null;
  state: "known" | "unknown";
  value: unknown;
}

export interface OpportunityEvaluationInput {
  appid: number;
  fields: Partial<Record<OpportunityRuleField, OpportunityFieldValue>>;
  name: string;
}

export interface OpportunityClauseOutcome {
  actualValue: unknown;
  clauseId: string;
  comparisonValue: OpportunityRuleValue | undefined;
  confidence: OpportunityConfidence;
  evidenceClass: Exclude<
    OpportunityEvidenceClass,
    "publisheriq_interpretation"
  >;
  explanation: string;
  field: OpportunityRuleField;
  operator: OpportunityRuleOperator;
  source: string | null;
  sourceAt: string | null;
  state: OpportunityTriState;
}

export interface OpportunityGroupOutcome {
  clauseOutcomes: OpportunityClauseOutcome[];
  groupId: string;
  label: string;
  operator: OpportunityRuleGroupOperator;
  state: OpportunityTriState;
}

export interface OpportunityProfileEvaluation {
  excluded: boolean;
  excludedOutcomes: OpportunityGroupOutcome[];
  missingRequiredFields: OpportunityRuleField[];
  outcome: "eligible" | "ineligible" | "pending";
  preferenceContribution: number;
  preferredOutcomes: Array<
    OpportunityGroupOutcome & {
      contribution: number;
      importance: OpportunityPreferenceImportance;
    }
  >;
  requiredOutcomes: OpportunityGroupOutcome[];
}

export type OpportunityMaterialEventType =
  | "first_observed"
  | "released"
  | "demo_added"
  | "release_timing_changed"
  | "publisher_changed"
  | "developer_changed"
  | "taxonomy_repositioned"
  | "business_model_changed"
  | "store_readiness_improved"
  | "platform_expanded"
  | "announcement"
  | "review_breakthrough"
  | "ccu_breakthrough"
  | "material_change";

export type OpportunitySignalFamily =
  | "release"
  | "taxonomy"
  | "pricing"
  | "platform"
  | "store-page"
  | "media"
  | "build"
  | "announcement"
  | "reviews"
  | "ccu"
  | "unknown";

export interface OpportunityMaterialEvent {
  affectedRuleFields: OpportunityRuleField[];
  appid: number;
  classifierVersion: string;
  confidence: OpportunityConfidence;
  effectiveAt: string;
  eventFingerprint: string;
  eventType: OpportunityMaterialEventType;
  id: string;
  materiality: number;
  observedAt: string;
  signalFamily: OpportunitySignalFamily;
}

export interface OpportunityProfileVersion {
  calculationConfig: Record<string, unknown>;
  createdAt: string;
  eventSubscriptions: OpportunitySignalFamily[];
  id: string;
  profileId: string;
  rules: OpportunityRuleSet;
  version: number;
}

export interface OpportunityProfileSummary {
  currentVersion: number | null;
  description: string | null;
  id: string;
  immediateFullMatchEnabled: boolean;
  name: string;
  nextEvaluationAt: string | null;
  sourcePresetName: string | null;
  status: "draft" | "enabled" | "paused" | "archived";
  updatedAt: string;
}

export interface OpportunityProfileDetail extends OpportunityProfileSummary {
  currentVersionDetail: OpportunityProfileVersion;
  timezone: string;
}

export interface OpportunityPresetSummary {
  description: string | null;
  healthState: OpportunityPresetHealthState | null;
  id: string;
  name: string;
  ruleSummary: string[];
  slug: string;
  version: number;
}

export interface OpportunityPreviewRequest {
  profileId?: string;
  rules: OpportunityRuleSet;
}

export interface OpportunityPreviewRepresentative {
  appid: number;
  matchedPreferences: string[];
  name: string;
  releaseState: string | null;
  scoreHint: number;
  tags: string[];
}

export interface OpportunityPreviewResponse {
  coverage: Array<{
    field: OpportunityRuleField;
    knownCount: number;
    percentage: number;
    totalCount: number;
  }>;
  eliminationFunnel: Array<{
    eliminated: number;
    groupId: string;
    label: string;
    remaining: number;
  }>;
  estimatedDailyVolume: {
    basis: "insufficient_history" | "run_history";
    high: number | null;
    low: number | null;
  };
  evaluatedCatalogSize: number;
  representativeMatches: OpportunityPreviewRepresentative[];
  totalMatches: number;
  warnings: string[];
}

export interface OpportunityRankComponents {
  evidenceQuality: number;
  marketMomentum: number;
  peerPosition: number;
  signalStrength: number;
  userFit: number;
}

export interface OpportunityRankingEvidence {
  components: OpportunityRankComponents;
  finalScore: number;
  rankingVersion: typeof OPPORTUNITY_RANKING_VERSION;
  reasons: string[];
  weights: OpportunityRankComponents;
}

export interface OpportunityCohortMember {
  appid: number;
  ccuPeak: number | null;
  inclusionReasons: string[];
  inclusionScore: number;
  name: string;
  positivePercentage: number | null;
  priceCents: number | null;
  reviewsAdded30d: number | null;
  totalReviews: number | null;
}

export interface OpportunityCohortSnapshot {
  calculatedAt: string;
  cohortKind: "upcoming_readiness" | "released_market";
  cohortVersion: typeof OPPORTUNITY_COHORT_VERSION;
  confidence: OpportunityConfidence;
  coverage: number;
  fallbackTier: 1 | 2 | 3 | 4 | 5;
  members: OpportunityCohortMember[];
  signature: Record<string, unknown>;
  sourceAt: string | null;
}

export type OpportunityPotentialBand =
  | "insufficient_data"
  | "limited"
  | "developing"
  | "meaningful"
  | "large_but_competitive";

export interface OpportunityMarketContext {
  confidence: OpportunityConfidence;
  concentration: {
    topOneShare: number | null;
    warning: string | null;
  };
  demandDirection: "declining" | "stable" | "improving" | "unknown";
  distributions: {
    ccuPeak: OpportunityPercentileDistribution;
    reviewsAdded30d: OpportunityPercentileDistribution;
    totalReviews: OpportunityPercentileDistribution;
  };
  explanation: string[];
  marketVersion: typeof OPPORTUNITY_MARKET_VERSION;
  potentialBand: OpportunityPotentialBand;
  supply: {
    measuredGames: number;
    releasedGames: number;
  };
}

export interface OpportunityPercentileDistribution {
  measured: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

export type OpportunityPresetHealthState =
  | "insufficient_data"
  | "quiet"
  | "active"
  | "growing"
  | "surging"
  | "cooling";

export interface OpportunityPresetHealthSnapshot {
  asOfDate: string;
  consecutiveDays: number;
  coverage: number;
  explanation: string[];
  healthVersion: typeof OPPORTUNITY_HEALTH_VERSION;
  measuredGames: number;
  positiveBreadth: number | null;
  state: OpportunityPresetHealthState;
  topContributorShare: number | null;
}

export type OpportunityResultLabel =
  | "newly_discovered"
  | "newly_released"
  | "newly_qualified"
  | "materially_changed"
  | "tracked_update";

export interface OpportunityResultSummary {
  appid: number;
  confidence: OpportunityConfidence;
  createdAt: string;
  eventLabel: OpportunityResultLabel;
  eventFingerprint: string;
  id: string;
  marketPotential: OpportunityPotentialBand;
  matchedProfiles: Array<{ id: string; name: string }>;
  name: string;
  rank: number | null;
  rankComponents: OpportunityRankComponents;
  score: number | null;
  strongestEvidence: string[];
  whyNow: string;
}

export interface OpportunityDailyOverview {
  coverageWarnings: string[];
  groups: {
    materiallyChanged: OpportunityResultSummary[];
    newlyDiscovered: OpportunityResultSummary[];
    newlyQualified: OpportunityResultSummary[];
    newlyReleased: OpportunityResultSummary[];
    trackedUpdates: OpportunityResultSummary[];
  };
  matchedCount: number;
  presetHealthChanges: Array<{
    asOfDate: string;
    explanation: string[];
    name: string;
    priorState: OpportunityPresetHealthState | null;
    state: OpportunityPresetHealthState;
  }>;
  profilesEvaluated: number;
  runId: string | null;
  status: "ready" | "empty" | "not_run" | "running" | "failed";
  windowEnd: string | null;
  windowStart: string | null;
}

export interface OpportunityBootstrapResponse {
  channelPreferences: OpportunityChannelPreferenceSummary[];
  dailyOverview: OpportunityDailyOverview;
  profiles: OpportunityProfileSummary[];
  presets: OpportunityPresetSummary[];
  sourceHealth: Array<{
    label: string;
    source: string;
    state: "healthy" | "delayed" | "blocked";
    updatedAt: string | null;
  }>;
  workspace: {
    id: string;
    name: string;
    role: "owner" | "admin" | "member";
  };
}

export interface OpportunityChannelPreferenceSummary {
  channel: "website" | "email" | "slack";
  destinationLabel: string | null;
  enabled: boolean;
  id: string;
  immediateFullMatchEnabled: boolean;
  maxResults: number;
  profileId: string | null;
  quietDayBehavior: "skip" | "send_empty";
}

export interface OpportunityGameRecord {
  app: {
    appid: number;
    developers: string[];
    name: string;
    publishers: string[];
    releaseDate: string | null;
    releaseState: string | null;
    steamUrl: string;
  };
  cohort: OpportunityCohortSnapshot | null;
  currentMetrics: Record<string, number | string | null>;
  evidence: Array<{
    confidence: OpportunityConfidence;
    evidenceClass: OpportunityEvidenceClass;
    label: string;
    source: string;
    sourceAt: string | null;
    value: unknown;
  }>;
  marketContext: OpportunityMarketContext | null;
  matchedProfiles: Array<{
    id: string;
    name: string;
    ruleOutcomes: OpportunityProfileEvaluation;
  }>;
  missingEvidence: string[];
  officialNews: Array<{
    feedLabel: string | null;
    gid: string;
    publishedAt: string | null;
    title: string;
    url: string | null;
  }>;
  previousAppearances: Array<{
    createdAt: string;
    eventLabel: OpportunityResultLabel;
    resultId: string;
    whyNow: string;
  }>;
  recentChanges: Array<{
    after: unknown;
    before: unknown;
    confidence: OpportunityConfidence;
    effectiveAt: string;
    eventFingerprint: string;
    eventType: string;
    materiality: number;
    observedAt: string;
    rawEventRefs: unknown[];
    signalFamily: OpportunitySignalFamily;
  }>;
  rank: OpportunityRankingEvidence;
  result: OpportunityResultSummary;
  teamActivity: Array<{
    activityType: "viewed" | "researching_started" | "researching_cleared";
    occurredAt: string;
    userDisplay: string;
  }>;
  userState: {
    dismissedAt: string | null;
    ignoredAt: string | null;
    researching: boolean;
    trackedAt: string | null;
  };
  youtubeEvidence: {
    coverage: "partial";
    latestSnapshotAt: string | null;
    videos: Array<{
      channelTitle: string | null;
      confidenceScore: number | null;
      contentClass: string | null;
      publishedAt: string | null;
      title: string;
      url: string;
      videoId: string;
      viewCount: number | null;
    }>;
  };
}

export interface OpportunityIdentity {
  accessToken: string;
  email: string | null;
  userId: string;
}
