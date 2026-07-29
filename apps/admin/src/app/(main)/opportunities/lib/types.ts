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

export interface OpportunityRuleClause {
  field: OpportunityRuleField;
  id: string;
  label?: string;
  operator: OpportunityRuleOperator;
  value?: boolean | number | string | null | Array<boolean | number | string>;
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
  schemaVersion: "opportunity-rules/v1";
}

export interface OpportunityResultSummary {
  appid: number;
  change: OpportunityObservedChange | null;
  confidence: "high" | "directional";
  createdAt: string;
  eventFingerprint: string;
  eventLabel:
    | "newly_discovered"
    | "newly_released"
    | "newly_qualified"
    | "materially_changed"
    | "tracked_update";
  id: string;
  marketPotential:
    | "insufficient_data"
    | "limited"
    | "developing"
    | "meaningful"
    | "large_but_competitive";
  matchedProfiles: Array<{ id: string; name: string }>;
  name: string;
  rank: number | null;
  rankComponents: Record<string, number>;
  score: number | null;
  strongestEvidence: string[];
  whyNow: string;
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
    | "material_change";
  observedAt: string;
  signalFamily: OpportunitySignalFamily;
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
