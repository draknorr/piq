import type { TigerShadowAttempt, TigerShadowContractName } from './tiger-shadow-types';

export type ChatExecutionBackendKind =
  | 'tiger_query_api'
  | 'cube'
  | 'supabase_sql'
  | 'supabase_rpc'
  | 'supabase_table';

export type ChatExecutionStage =
  | 'tiger_primary'
  | 'tiger_shadow'
  | 'tool'
  | 'continuation';

export type ChatExecutionStatus = 'success' | 'error' | 'skipped';

export type ChatMigrationDisposition =
  | 'already_tiger'
  | 'cut_over_now'
  | 'needs_tiger_contract'
  | 'disable_instead_of_port'
  | 'keep_legacy_temporarily';

export interface ChatExecutionTraceEntry {
  backendKinds: ChatExecutionBackendKind[];
  dataSources: string[];
  fallbackReason: string | null;
  kind: 'tool' | 'contract';
  latencyMs: number | null;
  migrationDisposition: ChatMigrationDisposition;
  migrationNotes: string | null;
  name: string;
  readOccurred: boolean;
  recommendedTigerContracts: string[];
  stage: ChatExecutionStage;
  status: ChatExecutionStatus;
}

export interface ChatExecutionProvenanceOverride {
  backendKinds: ChatExecutionBackendKind[];
  dataSources: string[];
  migrationDisposition: ChatMigrationDisposition;
  migrationNotes: string | null;
  recommendedTigerContracts: string[];
}

interface ChatExecutionProvenanceDefinition {
  backendKinds: ChatExecutionBackendKind[];
  dataSources: string[];
  migrationDisposition: ChatMigrationDisposition;
  migrationNotes: string | null;
  recommendedTigerContracts: string[];
}

export type AuditedTigerContractName = TigerShadowContractName | 'continueResultSet';

const EXECUTION_PROVENANCE_OVERRIDE = Symbol('chat-execution-provenance-override');

const SHARED_CATALOG_RELATIONS = [
  'relation:apps',
  'relation:latest_daily_metrics',
  'relation:app_publishers',
  'relation:publishers',
  'relation:app_developers',
  'relation:developers',
] as const;

const TOOL_PROVENANCE: Record<string, ChatExecutionProvenanceDefinition> = {
  compare_change_before_after: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:explainChanges',
      'relation:core_entities',
      'relation:events_app_change_events',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Before/after change comparisons now run through system explain-changes.',
    recommendedTigerContracts: ['explainChanges'],
  },
  discover_trending: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:discoverMomentum',
      ...SHARED_CATALOG_RELATIONS,
      'relation:metrics_daily_metrics',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Trend-discovery prompts now run through system discover-momentum.',
    recommendedTigerContracts: ['discoverMomentum'],
  },
  find_change_patterns: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:discoverChangePatterns',
      'relation:apps',
      'relation:latest_daily_metrics',
      'relation:metrics_daily_metrics',
      'relation:events_app_change_events',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Cross-game change-pattern discovery now runs through system discover-change-patterns.',
    recommendedTigerContracts: ['discoverChangePatterns'],
  },
  find_similar: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:semanticSearch', 'relation:apps', 'relation:latest_daily_metrics'],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Semantic similarity already runs through query-api.',
    recommendedTigerContracts: ['semanticSearch'],
  },
  get_change_activity_detail: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:explainChanges',
      'relation:core_entities',
      'relation:events_app_change_events',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Change drilldown now runs through system explain-changes.',
    recommendedTigerContracts: ['explainChanges'],
  },
  get_game_change_timeline: {
    backendKinds: ['supabase_rpc', 'supabase_table'],
    dataSources: ['rpc:get_app_change_feed', 'table:apps'],
    migrationDisposition: 'cut_over_now',
    migrationNotes:
      'Single-title change timelines should be absorbed by system explain-changes routing instead of staying on direct Supabase reads.',
    recommendedTigerContracts: ['explainChanges'],
  },
  get_recent_news_detail: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:searchDocuments',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
      'relation:apps',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Recent-news detail now runs through system search-documents.',
    recommendedTigerContracts: ['searchDocuments'],
  },
  get_recent_news_digest: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:searchDocuments',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
      'relation:apps',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Recent-news digests now run through system search-documents.',
    recommendedTigerContracts: ['searchDocuments'],
  },
  lookup_developers: {
    backendKinds: ['supabase_rpc', 'supabase_table'],
    dataSources: ['rpc:search_developers_fuzzy', 'table:developers', 'table:developer_metrics'],
    migrationDisposition: 'cut_over_now',
    migrationNotes:
      'Developer identity resolution should route through system resolve-entities instead of the legacy Supabase resolver.',
    recommendedTigerContracts: ['resolveEntities'],
  },
  lookup_games: {
    backendKinds: ['supabase_rpc', 'supabase_table'],
    dataSources: ['rpc:search_games_fuzzy', 'table:apps'],
    migrationDisposition: 'cut_over_now',
    migrationNotes:
      'Game identity resolution should route through system resolve-entities instead of the legacy lookup surface.',
    recommendedTigerContracts: ['resolveEntities'],
  },
  lookup_publishers: {
    backendKinds: ['supabase_rpc', 'supabase_table'],
    dataSources: ['rpc:search_publishers_fuzzy', 'table:publishers', 'table:publisher_metrics'],
    migrationDisposition: 'cut_over_now',
    migrationNotes:
      'Publisher identity resolution should route through system resolve-entities instead of the legacy Supabase resolver.',
    recommendedTigerContracts: ['resolveEntities'],
  },
  lookup_tags: {
    backendKinds: ['supabase_table'],
    dataSources: [
      'table:steam_tags',
      'table:steam_genres',
      'table:steam_categories',
      'table:app_filter_data',
    ],
    migrationDisposition: 'disable_instead_of_port',
    migrationNotes:
      'Tag lookup should disappear from chat. Replace it with typed prompt parsing plus system catalog filters instead of porting the tool as-is.',
    recommendedTigerContracts: ['searchCatalog'],
  },
  query_analytics: {
    backendKinds: ['cube'],
    dataSources: ['cube:semantic_layer'],
    migrationDisposition: 'needs_tiger_contract',
    migrationNotes:
      'Generic Cube analytics should not remain in chat. Split prompts onto typed system contracts instead of keeping a generic analytics tool.',
    recommendedTigerContracts: ['resolveEntities', 'getEntityOverview', 'searchCatalog', 'rankEntities', 'traceMetricHistory'],
  },
  query_change_activity: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:searchChangeActivity',
      'relation:apps',
      'relation:events_app_change_events',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Cross-game change discovery now runs through system search-change-activity.',
    recommendedTigerContracts: ['searchChangeActivity'],
  },
  query_database: {
    backendKinds: ['supabase_sql'],
    dataSources: ['rpc:execute_readonly_query'],
    migrationDisposition: 'disable_instead_of_port',
    migrationNotes:
      'Raw SQL should be removed from chat entirely. Replace each prompt family with a typed system contract instead of carrying this tool forward.',
    recommendedTigerContracts: [],
  },
  screen_games: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:discoverMomentum',
      ...SHARED_CATALOG_RELATIONS,
      'relation:metrics_daily_metrics',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Momentum and screening prompts now execute through system discover-momentum.',
    recommendedTigerContracts: ['discoverMomentum'],
  },
  search_by_concept: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:semanticSearch', 'relation:apps', 'relation:latest_daily_metrics'],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Concept search already runs through query-api.',
    recommendedTigerContracts: ['semanticSearch'],
  },
  search_games: {
    backendKinds: ['supabase_table'],
    dataSources: [
      'table:app_filter_data',
      'table:apps',
      'table:latest_daily_metrics',
      'table:app_publishers',
      'table:publishers',
      'table:app_developers',
      'table:developers',
    ],
    migrationDisposition: 'cut_over_now',
    migrationNotes:
      'Broad catalog discovery should move to system search-catalog instead of reading Supabase tables directly from chat.',
    recommendedTigerContracts: ['searchCatalog'],
  },
  search_recent_news_topics: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:searchDocuments',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
      'relation:apps',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Cross-game recent-news topic search now runs through system search-documents.',
    recommendedTigerContracts: ['searchDocuments'],
  },
};

const CONTRACT_PROVENANCE: Record<AuditedTigerContractName, ChatExecutionProvenanceDefinition> = {
  compareEntities: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:compareEntities', 'relation:core_entities', ...SHARED_CATALOG_RELATIONS],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Entity compare already runs through the system.',
    recommendedTigerContracts: ['compareEntities'],
  },
  continueResultSet: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:continueResultSet', ...SHARED_CATALOG_RELATIONS],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'System-owned continuation already runs through query-api.',
    recommendedTigerContracts: ['continueResultSet'],
  },
  explainChanges: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:explainChanges',
      'relation:core_entities',
      'relation:events_app_change_events',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Single-entity change explanation already runs through the system.',
    recommendedTigerContracts: ['explainChanges'],
  },
  discoverMomentum: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:discoverMomentum',
      ...SHARED_CATALOG_RELATIONS,
      'relation:metrics_daily_metrics',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Momentum discovery already runs through the system.',
    recommendedTigerContracts: ['discoverMomentum'],
  },
  getEntityOverview: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:getEntityOverview', ...SHARED_CATALOG_RELATIONS],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Entity overview and company portfolio snapshots already run through the system.',
    recommendedTigerContracts: ['getEntityOverview'],
  },
  getRelatedEntities: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:getRelatedEntities',
      'relation:apps',
      'relation:latest_daily_metrics',
      'relation:app_dlc',
      'relation:app_franchises',
      'relation:franchises',
      'relation:app_steam_deck',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'DLC and franchise relation lookups already run through the system.',
    recommendedTigerContracts: ['getRelatedEntities'],
  },
  getUserContext: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:getUserContext',
      'relation:user_pins',
      'relation:user_alerts',
      'relation:user_alert_preferences',
      'relation:user_pin_alert_settings',
      ...SHARED_CATALOG_RELATIONS,
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Pinned items, alert preferences, and unread alert context now run through the system.',
    recommendedTigerContracts: ['getUserContext'],
  },
  getYoutubeGameCoverage: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:getYoutubeGameCoverage',
      'relation:core_entities',
      'relation:docs_youtube_videos',
      'relation:docs_youtube_channels',
      'relation:docs_youtube_video_matches',
      'relation:metrics_youtube_video_snapshots',
      'relation:metrics_youtube_game_daily',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes:
      'Explicit single-game YouTube coverage now runs through the system-owned query-api contract.',
    recommendedTigerContracts: ['getYoutubeGameCoverage'],
  },
  rankEntities: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:rankEntities', ...SHARED_CATALOG_RELATIONS],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Ranking already runs through the system.',
    recommendedTigerContracts: ['rankEntities'],
  },
  discoverChangePatterns: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:discoverChangePatterns',
      'relation:apps',
      'relation:latest_daily_metrics',
      'relation:metrics_daily_metrics',
      'relation:events_app_change_events',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Cross-game change-pattern discovery already runs through the system.',
    recommendedTigerContracts: ['discoverChangePatterns'],
  },
  resolveEntities: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:resolveEntities', 'relation:apps', 'relation:latest_daily_metrics', 'relation:publishers', 'relation:developers'],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Entity resolution already runs through the system.',
    recommendedTigerContracts: ['resolveEntities'],
  },
  searchCatalog: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:searchCatalog', ...SHARED_CATALOG_RELATIONS],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Catalog search already runs through the system.',
    recommendedTigerContracts: ['searchCatalog'],
  },
  searchChangeActivity: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:searchChangeActivity',
      'relation:apps',
      'relation:events_app_change_events',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Cross-game change activity search already runs through the system.',
    recommendedTigerContracts: ['searchChangeActivity'],
  },
  searchDocuments: {
    backendKinds: ['tiger_query_api'],
    dataSources: [
      'query_api:searchDocuments',
      'relation:docs_steam_news_items',
      'relation:docs_steam_news_search_projection',
    ],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Document/news search already runs through the system.',
    recommendedTigerContracts: ['searchDocuments'],
  },
  semanticSearch: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:semanticSearch', ...SHARED_CATALOG_RELATIONS],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Semantic search already runs through the system.',
    recommendedTigerContracts: ['semanticSearch'],
  },
  traceMetricHistory: {
    backendKinds: ['tiger_query_api'],
    dataSources: ['query_api:traceMetricHistory', 'relation:core_entities', 'relation:metrics_daily_metrics'],
    migrationDisposition: 'already_tiger',
    migrationNotes: 'Metric history already runs through the system.',
    recommendedTigerContracts: ['traceMetricHistory'],
  },
};

export function getAuditedToolNames(): string[] {
  return Object.keys(TOOL_PROVENANCE).sort();
}

export function getAuditedTigerContractNames(): AuditedTigerContractName[] {
  return Object.keys(CONTRACT_PROVENANCE).sort() as AuditedTigerContractName[];
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function getTraceFallbackReason(result: Record<string, unknown> | null | undefined): string | null {
  if (!result) {
    return null;
  }

  if (typeof result.error === 'string' && result.error.trim()) {
    return result.error.trim();
  }

  if (typeof result.failure_kind === 'string' && result.failure_kind.trim()) {
    return result.failure_kind.trim();
  }

  if (typeof result.sufficiency_reason === 'string' && result.sufficiency_reason.trim()) {
    return result.sufficiency_reason.trim();
  }

  return null;
}

function getToolProvenanceDefinition(
  toolName: string,
  toolArguments?: Record<string, unknown>
): ChatExecutionProvenanceDefinition {
  const definition = TOOL_PROVENANCE[toolName];
  if (!definition) {
    throw new Error(`Missing chat execution provenance mapping for tool: ${toolName}`);
  }

  if (toolName !== 'query_analytics') {
    return definition;
  }

  const cubeName =
    toolArguments && typeof toolArguments.cube === 'string' && toolArguments.cube.trim().length > 0
      ? toolArguments.cube.trim()
      : null;

  return {
    ...definition,
    dataSources: dedupeStrings([
      ...(cubeName ? [`cube:${cubeName}`] : []),
      ...definition.dataSources,
    ]),
  };
}

function getContractProvenanceDefinition(
  contractName: AuditedTigerContractName
): ChatExecutionProvenanceDefinition {
  const definition = CONTRACT_PROVENANCE[contractName];
  if (!definition) {
    throw new Error(`Missing chat execution provenance mapping for system contract: ${contractName}`);
  }
  return definition;
}

export function buildToolExecutionTraceEntry(params: {
  fallbackReason?: string | null;
  latencyMs?: number | null;
  provenanceOverride?: ChatExecutionProvenanceOverride;
  readOccurred?: boolean;
  result?: Record<string, unknown> | null;
  stage?: Extract<ChatExecutionStage, 'tool' | 'continuation'>;
  status?: ChatExecutionStatus;
  toolArguments?: Record<string, unknown>;
  toolName: string;
}): ChatExecutionTraceEntry {
  const {
    fallbackReason,
    latencyMs = null,
    provenanceOverride,
    readOccurred,
    result,
    stage = 'tool',
    status,
    toolArguments,
    toolName,
  } = params;
  const provenance = provenanceOverride ?? getToolProvenanceDefinition(toolName, toolArguments);
  const traceStatus =
    status ?? (result && result.success === false ? 'error' : 'success');

  return {
    backendKinds: provenance.backendKinds,
    dataSources: provenance.dataSources,
    fallbackReason: fallbackReason ?? getTraceFallbackReason(result),
    kind: 'tool',
    latencyMs,
    migrationDisposition: provenance.migrationDisposition,
    migrationNotes: provenance.migrationNotes,
    name: toolName,
    readOccurred: readOccurred ?? traceStatus !== 'skipped',
    recommendedTigerContracts: provenance.recommendedTigerContracts,
    stage,
    status: traceStatus,
  };
}

export function attachToolExecutionProvenance<T extends Record<string, unknown>>(
  result: T,
  provenance: ChatExecutionProvenanceOverride
): T {
  Object.defineProperty(result, EXECUTION_PROVENANCE_OVERRIDE, {
    configurable: false,
    enumerable: false,
    value: provenance,
    writable: false,
  });

  return result;
}

export function extractToolExecutionProvenance(
  result: unknown
): ChatExecutionProvenanceOverride | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return null;
  }

  const provenance = (result as Record<PropertyKey, unknown>)[EXECUTION_PROVENANCE_OVERRIDE];
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return null;
  }

  const candidate = provenance as Partial<ChatExecutionProvenanceOverride>;
  if (
    !Array.isArray(candidate.backendKinds) ||
    !Array.isArray(candidate.dataSources) ||
    !Array.isArray(candidate.recommendedTigerContracts)
  ) {
    return null;
  }

  return {
    backendKinds: candidate.backendKinds as ChatExecutionBackendKind[],
    dataSources: candidate.dataSources.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    ),
    migrationDisposition:
      candidate.migrationDisposition ?? 'already_tiger',
    migrationNotes:
      typeof candidate.migrationNotes === 'string' ? candidate.migrationNotes : null,
    recommendedTigerContracts: candidate.recommendedTigerContracts.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    ),
  };
}

export function buildTigerContractTraceEntry(params: {
  contractName: AuditedTigerContractName;
  fallbackReason?: string | null;
  latencyMs?: number | null;
  stage: Extract<ChatExecutionStage, 'tiger_primary' | 'tiger_shadow' | 'continuation'>;
  status: ChatExecutionStatus;
}): ChatExecutionTraceEntry {
  const { contractName, fallbackReason, latencyMs = null, stage, status } = params;
  const provenance = getContractProvenanceDefinition(contractName);

  return {
    backendKinds: provenance.backendKinds,
    dataSources: provenance.dataSources,
    fallbackReason: fallbackReason ?? null,
    kind: 'contract',
    latencyMs,
    migrationDisposition: provenance.migrationDisposition,
    migrationNotes: provenance.migrationNotes,
    name: contractName,
    readOccurred: status !== 'skipped',
    recommendedTigerContracts: provenance.recommendedTigerContracts,
    stage,
    status,
  };
}

export function buildTigerAttemptTraceEntries(params: {
  attempts: TigerShadowAttempt[];
  stage: Extract<ChatExecutionStage, 'tiger_primary' | 'tiger_shadow'>;
}): ChatExecutionTraceEntry[] {
  return params.attempts.map((attempt) =>
    buildTigerContractTraceEntry({
      contractName: attempt.contractName,
      fallbackReason: attempt.reason ?? attempt.errorCode ?? null,
      latencyMs: attempt.timingMs ?? null,
      stage: params.stage,
      status: attempt.status,
    })
  );
}
