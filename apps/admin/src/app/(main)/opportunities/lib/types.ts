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

export type OpportunityRuleField =
  | "appid"
  | "name"
  | "app_type"
  | "developer"
  | "publisher"
  | "release_state"
  | "is_released"
  | "release_date"
  | "publisheriq_added_at"
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
  | "demo_only"
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
  | "in_window"
  | "exists"
  | "not_exists";

export type OpportunityRelativeDateWindow =
  | "today"
  | "this_week"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "next_7_days"
  | "next_30_days";

export type OpportunityResultLabel =
  | "newly_discovered"
  | "newly_released"
  | "newly_qualified"
  | "materially_changed"
  | "tracked_update";

export type OpportunityRankingPolicy =
  | "discover_new_games"
  | "find_emerging_traction"
  | "monitor_material_changes";

export interface OpportunityGameDescription {
  contentHash: string | null;
  hasHeaderImage: boolean;
  hasReleasePath: boolean;
  hasSupportedLanguages: boolean;
  kind:
    | "steam_short"
    | "steam_about"
    | "steam_detailed"
    | "structured"
    | "unavailable";
  sanitizerVersion: "opportunity-description/v1";
  screenshotCount: number;
  sourceAt: string | null;
  sourceSnapshotId: string | null;
  text: string;
  trailerCount: number;
}

export interface OpportunityReviewPriorityConfidence {
  applicableCount: number;
  conflictingCount: number;
  label: "high" | "directional" | "limited";
  presentCount: number;
  reasons: string[];
  score: number;
  staleCount: number;
  version: "opportunity-confidence/v2";
}

export interface OpportunityReviewPrioritySummary {
  confidence: OpportunityReviewPriorityConfidence;
  internalScore: number | null;
  lane: "new_game" | "traction" | "material_change";
  policy: OpportunityRankingPolicy;
  priorityBand: "review_now" | "review_soon" | "monitor";
  reasons: string[];
  version: "opportunity-ranking/v2";
  winningProfileId: string;
}

export interface OpportunityReviewPriorityDecision extends OpportunityReviewPrioritySummary {
  allMatchedProfileIds: string[];
  components: Array<{
    baseWeight: number;
    contribution: number | null;
    effectiveWeight: number;
    key: string;
    value: number | null;
  }>;
  eligibility: "eligible";
  eligibilityReasonCodes: string[];
  inputs: Array<{
    assessment: "positive" | "neutral" | "negative" | "mixed" | "not_assessed";
    availability: "available" | "unavailable" | "not_applicable";
    calculationVersion: string | null;
    confidenceWeight: number;
    criticalForConfidence: boolean;
    key: string;
    normalizedValue: number | null;
    rawValue: unknown;
    reasonCode: string;
    source: string;
    sourceAt: string | null;
  }>;
  selectionSource: "explicit" | "legacy_inference";
  sortTuple: [number, number, number | null, string, number, string];
}

export type OpportunityDateOperand =
  | { date: string; kind: "absolute_date" }
  | { kind: "relative_window"; window: OpportunityRelativeDateWindow };

export interface OpportunityRuleClause {
  field: OpportunityRuleField;
  id: string;
  label?: string;
  operator: OpportunityRuleOperator;
  value?:
    | boolean
    | number
    | string
    | null
    | OpportunityDateOperand
    | Array<boolean | number | string>;
}

export interface OpportunityRuleGroup {
  clauses: OpportunityRuleClause[];
  id: string;
  importance?: "low" | "medium" | "high";
  label: string;
  operator: "any" | "all";
}

export interface OpportunityRuleSet {
  excluded: OpportunityRuleGroup[];
  preferred: OpportunityRuleGroup[];
  required: OpportunityRuleGroup[];
  schemaVersion: "opportunity-rules/v1" | "opportunity-rules/v2";
}

export interface OpportunityResultSummary {
  appid: number;
  change: OpportunityObservedChange | null;
  changeSummary: string;
  confidence: "high" | "directional";
  createdAt: string;
  eventFingerprint: string;
  eventLabel: OpportunityResultLabel;
  id: string;
  headerImageUrl: string | null;
  gameDescription: OpportunityGameDescription | null;
  marketPotential:
    | "insufficient_data"
    | "limited"
    | "developing"
    | "meaningful"
    | "large_but_competitive";
  matchedProfiles: Array<{ id: string; name: string }>;
  name: string;
  rank: number | null;
  rankComponents: Record<string, unknown>;
  reviewPriority: OpportunityReviewPrioritySummary | null;
  score: number | null;
  screenshotThumbnailUrl: string | null;
  strongestEvidence: string[];
  triggeredByMediaAddition: boolean;
  whyNow: string;
}

export interface OpportunityBriefProfileDispatch {
  description: string | null;
  eventCounts: Record<OpportunityResultLabel, number>;
  highConfidenceCount: number;
  id: string;
  listUrl: string;
  name: string;
  resultCount: number;
  status: "draft" | "enabled" | "paused" | "archived";
  summary: string;
  topResult: null | {
    appid: number;
    name: string;
    resultId: string;
  };
}

export interface OpportunityDailyBriefIssue {
  availableResultCount: number;
  coverageWarnings: string[];
  dek: string;
  featuredGames: OpportunityResultSummary[];
  headline: string;
  highConfidenceCount: number;
  issueDate: string | null;
  newerRunUpdating: boolean;
  profileDispatches: OpportunityBriefProfileDispatch[];
  profilesEvaluated: number;
  runId: string | null;
  status: "ready" | "empty" | "not_run" | "running" | "failed";
  windowEnd: string | null;
  windowStart: string | null;
}

export interface OpportunityResultPage {
  hasMore: boolean;
  nextCursor: string | null;
  pageSize: 25;
  results: OpportunityResultSummary[];
  runId: string;
}

export interface OpportunityMedia {
  capturedAt: string | null;
  headerImageUrl: string | null;
  screenshots: Array<{
    fullUrl: string;
    id: number | null;
    order: number;
    thumbnailUrl: string | null;
  }>;
  trailers: Array<{
    highlight: boolean;
    hlsUrl: string | null;
    id: number | null;
    mp4Url: string | null;
    name: string | null;
    order: number;
    thumbnailUrl: string | null;
    webmUrl: string | null;
  }>;
}

export interface OpportunityObservedChange {
  affectedRuleFields: OpportunityRuleField[];
  after: unknown;
  before: unknown;
  confidence: "high" | "directional";
  effectiveAt: string;
  eventType:
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
    | "date_window_changed"
    | "material_change";
  observedAt: string;
  signalFamily: OpportunitySignalFamily;
  summary: string;
}

export interface OpportunityBootstrap {
  channelPreferences: Array<{
    channel: "website" | "email" | "slack";
    destinationLabel: string | null;
    enabled: boolean;
    id: string;
    immediateFullMatchEnabled: boolean;
    maxResults: number;
    profileId: string | null;
    quietDayBehavior: "skip" | "send_empty";
  }>;
  dailyOverview: {
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
      evaluatedGames: number;
      explanation: string[];
      maximumEvaluated: number;
      name: string;
      priorState: string | null;
      sampleCapped: boolean;
      state: string;
    }>;
    profilesEvaluated: number;
    runId: string | null;
    status: "ready" | "empty" | "not_run" | "running" | "failed";
    windowEnd: string | null;
    windowStart: string | null;
  };
  profiles: Array<{
    currentVersion: number | null;
    description: string | null;
    id: string;
    immediateFullMatchEnabled: boolean;
    localDeliveryTime: string;
    name: string;
    nextEvaluationAt: string | null;
    sourcePresetName: string | null;
    status: "draft" | "enabled" | "paused" | "archived";
    timezone: string;
    updatedAt: string;
  }>;
  presets: Array<{
    description: string | null;
    healthState:
      | "insufficient_data"
      | "quiet"
      | "active"
      | "growing"
      | "surging"
      | "cooling"
      | null;
    healthUnavailableReason: "unreleased_only" | null;
    id: string;
    name: string;
    ruleSummary: string[];
    slug: string;
    version: number;
  }>;
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

export interface OpportunityProfileDetail {
  currentVersion: number | null;
  currentVersionDetail: {
    calculationConfig: Record<string, unknown>;
    eventSubscriptions: OpportunitySignalFamily[];
    id: string;
    profileId: string;
    rules: OpportunityRuleSet;
    version: number;
  };
  description: string | null;
  id: string;
  immediateFullMatchEnabled: boolean;
  localDeliveryTime: string;
  name: string;
  nextEvaluationAt: string | null;
  sourcePresetName: string | null;
  status: "draft" | "enabled" | "paused" | "archived";
  timezone: string;
  updatedAt: string;
}

export interface OpportunityPreview {
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
  representativeMatches: Array<{
    appid: number;
    matchedPreferences: string[];
    name: string;
    releaseState: string | null;
    scoreHint: number;
    tags: string[];
  }>;
  totalMatches: number;
  warnings: string[];
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
  cohort: null | {
    confidence: "high" | "directional";
    coverage: number;
    fallbackTier: number;
    members: Array<{
      appid: number;
      ccuPeak: number | null;
      inclusionReasons: string[];
      inclusionScore: number;
      name: string;
      positivePercentage: number | null;
      priceCents: number | null;
      reviewsAdded30d: number | null;
      totalReviews: number | null;
    }>;
    signature: Record<string, unknown>;
    sourceAt: string | null;
  };
  currentMetrics: Record<string, number | string | null>;
  evidence: Array<{
    confidence: "high" | "directional";
    evidenceClass: string;
    label: string;
    source: string;
    sourceAt: string | null;
    value: unknown;
  }>;
  evidenceResolution: {
    currentResolvedAt: string;
    evaluatedAt: string;
    previouslyMissingNowAvailable: Array<{
      field: OpportunityRuleField;
      source: string;
      sourceAt: string | null;
      value: unknown;
    }>;
  };
  marketContext: null | {
    concentration: { topOneShare: number | null; warning: string | null };
    confidence: "high" | "directional";
    demandDirection: "declining" | "stable" | "improving" | "unknown";
    distributions: Record<
      string,
      {
        measured: number;
        p25: number | null;
        p50: number | null;
        p75: number | null;
        p90: number | null;
      }
    >;
    explanation: string[];
    potentialBand: string;
    supply: { measuredGames: number; releasedGames: number };
  };
  media: OpportunityMedia;
  matchedProfiles: Array<{
    id: string;
    name: string;
    profileVersion: number;
    profileVersionId: string;
    ruleOutcomes: {
      excluded: boolean;
      excludedOutcomes: RuleOutcomeGroup[];
      missingRequiredFields: string[];
      outcome: string;
      preferenceContribution: number;
      preferredOutcomes: RuleOutcomeGroup[];
      requiredOutcomes: RuleOutcomeGroup[];
    };
    reviewPriority: OpportunityReviewPriorityDecision | null;
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
    eventLabel: string;
    resultId: string;
    whyNow: string;
  }>;
  provenance: {
    calculationVersions: Record<string, string>;
    deliveries: Array<{
      channel: "email" | "slack";
      createdAt: string;
      deliveryKind: "daily_digest" | "immediate_full_match";
      sentAt: string | null;
      status: string;
    }>;
    run: {
      activeProfileVersions: string[];
      completedAt: string | null;
      id: string;
      kind: string;
      sourceWatermarks: Record<string, unknown>;
      startedAt: string;
      windowEnd: string;
      windowStart: string;
    };
    sourceTimestamps: Record<string, string | null>;
    triggeringEvent: null | {
      classifierVersion: string;
      effectiveAt: string;
      eventType: string;
      observedAt: string;
      registryVersion: string;
      signalFamily: string;
    };
  };
  recentChanges: Array<
    {
      eventFingerprint: string;
      materiality: number;
      rawEventRefs: unknown[];
    } & OpportunityObservedChange
  >;
  rank: {
    components: Record<string, number>;
    finalScore: number;
    rankingVersion: string;
    reasons: string[];
    weights: Record<string, number>;
  };
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
  workspace: {
    id: string;
    name: string;
    role: "owner" | "admin" | "member";
  };
}

interface RuleOutcomeGroup {
  clauseOutcomes: Array<{
    actualValue: unknown;
    comparisonValue?:
      | boolean
      | number
      | string
      | null
      | Array<boolean | number | string>;
    confidence: "high" | "directional";
    evidenceClass: string;
    explanation: string;
    field: OpportunityRuleField;
    operator: OpportunityRuleOperator;
    source: string | null;
    sourceAt: string | null;
    state: "true" | "false" | "unknown";
  }>;
  groupId: string;
  label: string;
  state: "true" | "false" | "unknown";
}
