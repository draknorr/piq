export type TigerShadowMode = 'off' | 'eval' | 'canary' | 'all';
export type TigerPrimaryMode = 'off' | 'eval' | 'canary' | 'all';
export type TigerRolloutCohort = 'canary' | 'default';
export type TigerShadowMatchedIntent =
  | 'catalog_search'
  | 'change_explanation'
  | 'entity_ranking'
  | 'metric_history'
  | 'news_search'
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
  | 'rankEntities'
  | 'searchCatalog'
  | 'searchDocuments'
  | 'explainChanges'
  | 'traceMetricHistory';
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
  renderMode: 'deterministic';
  route: TigerPrimaryRoute;
}
