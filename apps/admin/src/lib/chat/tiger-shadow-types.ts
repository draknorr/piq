export type TigerShadowMode = 'off' | 'eval' | 'canary' | 'all';
export type TigerPrimaryMode = 'off' | 'eval' | 'canary' | 'all';
export type TigerRolloutCohort = 'canary' | 'default';
export type TigerShadowMatchedIntent =
  | 'catalog_search'
  | 'change_discovery'
  | 'change_explanation'
  | 'entity_overview'
  | 'entity_ranking'
  | 'entity_compare'
  | 'metric_history'
  | 'momentum_discovery'
  | 'news_search'
  | 'relation_lookup'
  | 'semantic_search'
  | 'user_context'
  | 'youtube_game_activity'
  | null;
export type TigerShadowRoute =
  | 'disabled'
  | 'unmatched'
  | 'skipped'
  | 'shadow_success_legacy_answer'
  | 'shadow_failed_legacy_answer';
export type TigerPrimaryRoute =
  | 'disabled'
  | 'unmatched'
  | 'primary_success'
  | 'fallback_to_legacy'
  | 'error';
export type TigerShadowContractName =
  | 'resolveEntities'
  | 'getEntityOverview'
  | 'discoverMomentum'
  | 'rankEntities'
  | 'compareEntities'
  | 'searchCatalog'
  | 'searchChangeActivity'
  | 'searchDocuments'
  | 'discoverChangePatterns'
  | 'explainChanges'
  | 'getRelatedEntities'
  | 'getUserContext'
  | 'semanticSearch'
  | 'traceMetricHistory'
  | 'getYoutubeGameCoverage';
export type TigerShadowAttemptStatus = 'success' | 'error' | 'skipped';

export interface TigerShadowAttempt {
  contractName: TigerShadowContractName;
  errorCode?: string | null;
  httpStatus?: number | null;
  reason?: string | null;
  resultCount?: number | null;
  status: TigerShadowAttemptStatus;
  sufficientToAnswer?: boolean | null;
  timingMs?: number | null;
}

export interface TigerShadowInfo {
  attempts: TigerShadowAttempt[];
  cohort: TigerRolloutCohort;
  enabled: boolean;
  matchedIntent: TigerShadowMatchedIntent;
  mode: TigerShadowMode;
  route: TigerShadowRoute;
}

export interface TigerPrimaryInfo {
  attempts: TigerShadowAttempt[];
  cohort: TigerRolloutCohort;
  enabled: boolean;
  matchedIntent: TigerShadowMatchedIntent;
  mode: TigerPrimaryMode;
  renderMode: 'deterministic' | 'hybrid_narrator';
  route: TigerPrimaryRoute;
}
