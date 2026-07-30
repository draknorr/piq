import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import { getTigerPool, shutdownTigerPool } from './tiger.js';

type JsonRecord = Record<string, unknown>;
type QueryValues = readonly unknown[];

export interface TigerQueryClient {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: QueryValues
  ): Promise<QueryResult<T>>;
  release?: () => void;
}

export interface TigerWriterPool {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: QueryValues
  ): Promise<QueryResult<T>>;
  connect(): Promise<TigerQueryClient>;
}

interface CountRow extends QueryResultRow {
  count: number | string | null;
}

interface IdRow extends QueryResultRow {
  id: string | number | null;
}

interface CatalogScanStartQueryRow extends QueryResultRow {
  committed_through: number | string | null;
  id: string;
  last_committed_batch: number | string;
  requested_if_modified_since: number | string | null;
  scan_kind: CatalogScanKind;
  source_started_at: Date | string;
  status: CatalogScanStatus;
}

interface JsonResultRow extends QueryResultRow {
  result: unknown;
}

interface AppIdRow extends QueryResultRow {
  appid: number;
}

interface SyncCandidateRow extends QueryResultRow {
  appid: number;
  priority_score: number | string | null;
}

interface SyncJobTypeCountRow extends QueryResultRow {
  count: number | string | null;
  job_type: string;
}

interface StorefrontSyncStatusRow extends QueryResultRow {
  appid: number;
  last_storefront_sync: Date | string | null;
}

interface HistogramSyncStatusRow extends QueryResultRow {
  appid: number;
  last_histogram_sync: Date | string | null;
}

interface HistogramSyncCandidateRow extends QueryResultRow {
  appid: number;
  has_histogram: boolean;
  lane: string;
  last_histogram_sync: Date | string | null;
  priority_score: number | string | null;
  service_tier: string;
  total_reviews: number | string | null;
}

interface HistogramBacklogTierRow extends QueryResultRow {
  captured_at: Date | string;
  due_apps: number | string | null;
  never_synced: number | string | null;
  oldest_waiting_at: Date | string | null;
  service_tier: string;
  stale_30_days: number | string | null;
  stale_90_days: number | string | null;
  total_apps: number | string | null;
  with_histogram: number | string | null;
}

interface CcuTierAssignmentRow extends QueryResultRow {
  appid: number;
  ccu_tier: number | string | null;
}

interface TierAssignmentFreshnessRow extends QueryResultRow {
  updated_at: Date | string | null;
}

interface DemoCcuTierCountsRow extends QueryResultRow {
  tier1_count: number | string | null;
  tier2_count: number | string | null;
}

interface DemoCcuAdaptiveCandidateRow extends QueryResultRow {
  appid: number;
  bucket: DemoCcuAdaptiveCandidateBucket;
  demo_ccu_tier: number | string | null;
}

interface DemoCcuAdaptiveBreakdownRow extends QueryResultRow {
  bucket: DemoCcuAdaptiveCandidateBucket;
  count: number | string | null;
}

interface SuspiciousZeroRow extends QueryResultRow {
  appids: number[] | null;
}

interface HistogramAppidRow extends QueryResultRow {
  appid: number;
}

interface ReviewHistogramEntryRow extends QueryResultRow {
  appid: number;
  month_start: Date | string;
  recommendations_down: number | string;
  recommendations_up: number | string;
}

interface PriorityInputRow extends QueryResultRow {
  appid: number;
  ccu_peak: number | string | null;
  is_released: boolean | null;
  last_reviews_sync: Date | string | null;
  last_steamspy_sync: Date | string | null;
  release_date: Date | string | null;
  review_velocity_30d: number | string | null;
  review_velocity_7d: number | string | null;
  total_reviews: number | string | null;
  trend_30d_change_pct: number | string | null;
}

interface PreviousReviewSyncRow extends QueryResultRow {
  appid: number;
  consecutive_errors: number | string | null;
  is_pinned: boolean | string | null;
  last_activity_at: Date | string | null;
  last_known_total_reviews: number | string | null;
  last_reviews_sync: Date | string | null;
  positive_reviews: number | string | null;
  reviews_interval_hours: number | string | null;
  total_reviews: number | string | null;
}

interface GameEmbeddingCandidateRow extends QueryResultRow {
  appid: number;
  average_playtime_forever: number | string | null;
  categories: unknown;
  ccu_growth_30d: number | string | null;
  ccu_growth_7d: number | string | null;
  ccu_peak: number | string | null;
  content_descriptors: unknown;
  controller_support: string | null;
  current_price_cents: number | string | null;
  developer_ids: unknown;
  developers: unknown;
  franchise_ids: unknown;
  franchise_names: unknown;
  genres: unknown;
  historical_review_pct: number | string | null;
  is_delisted: boolean | string | null;
  is_free: boolean | string | null;
  is_released: boolean | string | null;
  language_count: number | string | null;
  metacritic_score: number | string | null;
  name: string;
  owners_min: number | string | null;
  pics_review_percentage: number | string | null;
  pics_review_score: number | string | null;
  platforms: string | null;
  primary_genre: string | null;
  publisher_ids: unknown;
  publishers: unknown;
  recent_review_pct: number | string | null;
  release_date: Date | string | null;
  sentiment_delta: number | string | null;
  steam_deck_category: string | null;
  steamspy_tags: unknown;
  tags: unknown;
  total_reviews: number | string | null;
  trend_30d_direction: string | null;
  type: string | null;
  updated_at: Date | string | null;
  velocity_7d: number | string | null;
  velocity_acceleration: number | string | null;
  velocity_tier: string | null;
}

interface CompanyEmbeddingCandidateRow extends QueryResultRow {
  avg_review_percentage: number | string | null;
  first_game_release_date: Date | string | null;
  game_count: number | string | null;
  id: number;
  is_indie?: boolean | string | null;
  name: string;
  platforms_supported: unknown;
  top_game_appids: unknown;
  top_game_names: unknown;
  top_genres: unknown;
  top_tags: unknown;
  total_reviews: number | string | null;
}

interface PinnedAlertEntityRow extends QueryResultRow {
  alert_ccu_drop: boolean | string | null;
  alert_ccu_spike: boolean | string | null;
  alert_milestone: boolean | string | null;
  alert_new_release: boolean | string | null;
  alert_price_change: boolean | string | null;
  alert_review_surge: boolean | string | null;
  alert_sentiment_shift: boolean | string | null;
  alert_trend_reversal: boolean | string | null;
  alerts_enabled: boolean | string | null;
  ccu_7d_avg: number | string | null;
  ccu_current: number | string | null;
  discount_percent: number | string | null;
  display_name: string;
  entity_id: number;
  entity_type: string;
  pin_id: string;
  positive_ratio: number | string | null;
  price_cents: number | string | null;
  review_velocity: number | string | null;
  sensitivity_ccu: number | string | null;
  sensitivity_review: number | string | null;
  sensitivity_sentiment: number | string | null;
  total_reviews: number | string | null;
  trend_30d_direction: string | null;
  user_id: string;
}

interface UserPinQueryRow extends QueryResultRow {
  display_name: string;
  entity_id: number;
  entity_type: string;
  id: string;
  pin_order: number | string | null;
  pinned_at: Date | string | null;
  user_id: string;
}

interface UserPinMetricRow extends QueryResultRow {
  ccu_change_pct: number | string | null;
  ccu_current: number | string | null;
  discount_percent: number | string | null;
  display_name: string;
  entity_id: number;
  entity_type: string;
  pin_id: string;
  pin_order: number | string | null;
  pinned_at: Date | string | null;
  positive_pct: number | string | null;
  price_cents: number | string | null;
  review_velocity: number | string | null;
  total_reviews: number | string | null;
  trend_direction: string | null;
}

interface UserAlertQueryRow extends QueryResultRow {
  alert_type: string;
  change_percent: number | string | null;
  created_at: Date | string | null;
  current_value: number | string | null;
  dedup_key: string;
  description: string;
  id: string;
  is_read: boolean | string | null;
  metric_name: string | null;
  pin_display_name: string | null;
  pin_entity_id: number | null;
  pin_entity_type: string | null;
  pin_id: string;
  previous_value: number | string | null;
  read_at: Date | string | null;
  severity: string;
  source_data: unknown;
  title: string;
  user_id: string;
}

interface AlertPreferencesQueryRow extends QueryResultRow {
  alert_ccu_drop: boolean | string | null;
  alert_ccu_spike: boolean | string | null;
  alert_milestone: boolean | string | null;
  alert_new_release: boolean | string | null;
  alert_price_change: boolean | string | null;
  alert_review_surge: boolean | string | null;
  alert_sentiment_shift: boolean | string | null;
  alert_trend_reversal: boolean | string | null;
  alerts_enabled: boolean | string | null;
  ccu_sensitivity: number | string | null;
  created_at: Date | string | null;
  review_sensitivity: number | string | null;
  sentiment_sensitivity: number | string | null;
  updated_at: Date | string | null;
  user_id: string;
}

interface PinAlertSettingsQueryRow extends QueryResultRow {
  alert_ccu_drop: boolean | string | null;
  alert_ccu_spike: boolean | string | null;
  alert_milestone: boolean | string | null;
  alert_new_release: boolean | string | null;
  alert_price_change: boolean | string | null;
  alert_review_surge: boolean | string | null;
  alert_sentiment_shift: boolean | string | null;
  alert_trend_reversal: boolean | string | null;
  alerts_enabled: boolean | string | null;
  ccu_sensitivity: number | string | null;
  created_at: Date | string | null;
  pin_id: string;
  review_sensitivity: number | string | null;
  sentiment_sensitivity: number | string | null;
  updated_at: Date | string | null;
  use_custom_settings: boolean | string | null;
}

interface AlertDetectionStateRow extends QueryResultRow {
  ccu_7d_avg: number | string | null;
  ccu_prev_value: number | string | null;
  entity_id: number;
  entity_type: string;
  positive_ratio_prev: number | string | null;
  review_velocity_7d_avg: number | string | null;
  total_reviews_prev: number | string | null;
  trend_30d_direction_prev: string | null;
}

interface AlertEntityMetricsRow extends QueryResultRow {
  ccu_7d_avg: number | string | null;
  ccu_current: number | string | null;
  discount_percent: number | string | null;
  entity_id: number;
  positive_ratio: number | string | null;
  price_cents: number | string | null;
  review_velocity: number | string | null;
  total_reviews: number | string | null;
  trend_30d_direction: string | null;
}

interface AlertSourceEventRow extends QueryResultRow {
  alert_type: 'new_release' | 'price_change';
  appid: number;
  app_name: string | null;
  current_value: number | string | null;
  entity_id: number;
  entity_type: string;
  event_key: string;
  occurred_at: Date | string;
  previous_value: number | string | null;
  source_data: unknown;
}

interface CreditResultRow extends QueryResultRow {
  new_balance: number | string;
  refunded?: number | string | null;
  success: boolean;
}

export class TigerWriterError extends Error {
  readonly code?: string;
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Tiger writer operation failed (${operation}): ${message}`);
    this.name = 'TigerWriterError';
    this.operation = operation;
    this.cause = cause;

    if (typeof cause === 'object' && cause !== null && 'code' in cause) {
      const code = (cause as { code?: unknown }).code;
      this.code = typeof code === 'string' ? code : undefined;
    }
  }
}

export type SyncJobStatus = 'running' | 'completed' | 'failed';

export interface SyncJobCreateParams {
  batchSize?: number | null;
  githubRunId?: string | null;
  jobType: string;
  startedAt?: string | null;
}

export interface SyncJobUpdate {
  completed_at?: string | null;
  error_message?: string | null;
  items_created?: number | null;
  items_failed?: number | null;
  items_processed?: number | null;
  items_skipped?: number | null;
  items_succeeded?: number | null;
  items_updated?: number | null;
  metadata?: JsonRecord | null;
  status?: SyncJobStatus;
}

export interface SyncJobTypeCount {
  count: number;
  jobType: string;
}

export interface SyncStatusUpsert {
  appid: number;
  consecutive_errors?: number | null;
  embedding_hash?: string | null;
  is_syncable?: boolean | null;
  last_activity_at?: string | null;
  last_embedding_sync?: string | null;
  last_error_at?: string | null;
  last_error_message?: string | null;
  last_error_source?: string | null;
  last_histogram_sync?: string | null;
  last_known_total_reviews?: number | null;
  last_media_sync?: string | null;
  last_news_sync?: string | null;
  last_pics_sync?: string | null;
  last_price_sync?: string | null;
  last_reviews_sync?: string | null;
  last_steamspy_individual_fetch?: string | null;
  last_steamspy_sync?: string | null;
  last_storefront_sync?: string | null;
  next_reviews_sync?: string | null;
  next_sync_after?: string | null;
  pics_change_number?: number | null;
  priority_calculated_at?: string | null;
  priority_score?: number | null;
  refresh_tier?: string | null;
  reviews_interval_hours?: number | null;
  steam_last_modified?: number | null;
  steam_price_change_number?: number | null;
  steamspy_available?: boolean | null;
  storefront_accessible?: boolean | null;
  sync_interval_hours?: number | null;
  updated_at?: string | null;
  velocity_7d?: number | null;
  velocity_calculated_at?: string | null;
}

export interface CatalogAppUpsert {
  appid: number;
  catalog_seed_state?: string | null;
  current_discount_percent?: number | null;
  current_price_cents?: number | null;
  has_workshop?: boolean | null;
  is_delisted?: boolean | null;
  is_free?: boolean | null;
  is_released?: boolean | null;
  last_seen_in_steam_applist_at?: string | null;
  name: string;
  parent_appid?: number | null;
  release_date?: string | null;
  release_date_raw?: string | null;
  type?: string | null;
  updated_at?: string | null;
}

export type CatalogObservationWriteMode = 'shadow' | 'primary';
export type CatalogScanFinalizationPhase =
  | 'not_started'
  | 'catalog_state'
  | 'catalog_readiness'
  | 'ready_to_complete'
  | 'completed';
export type CatalogScanKind = 'incremental' | 'full';
export type CatalogScanSource = 'steam_change_hints' | 'steam_applist';
export type CatalogScanStatus = 'running' | 'finalizing' | 'completed' | 'failed';

export interface CatalogObservationRow {
  appid: number;
  last_modified?: number | null;
  name: string;
  price_change_number?: number | null;
}

export interface CatalogObservationRejection {
  appid?: number | null;
  reason: string;
  row_hash: string;
  source_index: number;
}

export interface CatalogScanStart {
  committedThrough: number | null;
  id: string;
  lastCommittedBatch: number;
  requestedIfModifiedSince: number | null;
  scanKind: CatalogScanKind;
  sourceStartedAt: string;
  status: CatalogScanStatus;
}

export interface CatalogScanBatchResult {
  acceptedRows: number;
  batchHash: string;
  batchIndex: number;
  changedKnownAppids: number[];
  changedKnownRows: number;
  enqueuedRows: number;
  eventRows: number;
  knownRows: number;
  rejectedRows: number;
  seededRows: number;
  unchangedKnownRows: number;
  unknownAppids: number[];
  unknownRows: number;
}

export interface CatalogScanFinalizationProgress {
  done: boolean;
  phase: CatalogScanFinalizationPhase;
  processedRows: number;
  readinessRows: number;
  stateRows: number;
  status: CatalogScanStatus;
}

export interface AppSyncCandidate {
  appid: number;
  priorityScore: number;
}

export type HistogramServiceTier = 'active_daily' | 'medium_weekly' | 'long_tail_monthly';

export type HistogramSelectionLane = 'coverage_oldest' | HistogramServiceTier | 'reallocated';

export interface HistogramSyncCandidate {
  appid: number;
  hasHistogram: boolean;
  lane: HistogramSelectionLane;
  lastHistogramSync: string | null;
  priorityScore: number;
  serviceTier: HistogramServiceTier;
  totalReviews: number;
}

export interface HistogramBacklogTierSnapshot {
  dueApps: number;
  neverSynced: number;
  oldestWaitingAt: string | null;
  stale30Days: number;
  stale90Days: number;
  totalApps: number;
  withHistogram: number;
}

export interface HistogramBacklogSnapshot {
  capturedAt: string;
  dueApps: number;
  neverSynced: number;
  oldestWaitingAt: string | null;
  stale30Days: number;
  stale90Days: number;
  tiers: Record<HistogramServiceTier, HistogramBacklogTierSnapshot>;
  totalApps: number;
  withHistogram: number;
}

export interface StorefrontSyncStatus {
  appid: number;
  lastStorefrontSync: string | null;
}

export interface StorefrontAppUpsertArgs {
  p_appid: number;
  p_current_discount_percent: number;
  p_current_price_cents: number | null;
  p_developers: string[];
  p_demo_appids?: number[];
  p_dlc_appids?: number[];
  p_has_purchase_packages?: boolean | null;
  p_has_workshop: boolean;
  p_is_delisted: boolean;
  p_is_free: boolean;
  p_is_released: boolean;
  p_name: string;
  p_parent_appid?: number | null;
  p_publishers: string[];
  p_release_date: string | null;
  p_release_date_raw: string;
  p_type: string;
}

export interface DailyMetricUpsert {
  appid: number;
  average_playtime_2weeks?: number | null;
  average_playtime_forever?: number | null;
  ccu_peak?: number | null;
  ccu_source?: 'steam_api' | 'steamspy' | null;
  discount_percent?: number | null;
  metric_date: string;
  negative_reviews?: number | null;
  owners_max?: number | null;
  owners_min?: number | null;
  positive_reviews?: number | null;
  price_cents?: number | null;
  review_score?: number | null;
  review_score_desc?: string | null;
  total_reviews?: number | null;
}

export interface CcuSnapshotInsert {
  appid: number;
  ccu_tier: number;
  player_count: number;
  snapshot_time?: string | null;
}

export interface CcuTierAssignmentUpsert {
  appid: number;
  ccu_fetch_status?: string | null;
  ccu_skip_until?: string | null;
  ccu_tier?: number | null;
  last_ccu_synced?: string | null;
  last_ccu_validation_at?: string | null;
  last_ccu_validation_state?: string | null;
  last_tier_change?: string | null;
  recent_peak_ccu?: number | null;
  release_rank?: number | null;
  tier_reason?: string | null;
  updated_at?: string | null;
}

export interface CcuTierAssignment {
  appid: number;
  ccuTier: number;
}

export interface DemoCcuTierCounts {
  tier1Count: number;
  tier2Count: number;
}

export interface DemoCcuTierCandidateResult {
  appids: number[];
  skippedCount: number;
}

export type DemoCcuAdaptiveCandidateBucket =
  | 'p0_new_positive'
  | 'p0_positive'
  | 'p1_new_never_synced'
  | 'p1_new_zero'
  | 'p2_never_synced'
  | 'p3_zero_refresh';

export type DemoCcuAdaptiveCandidateBreakdown = Record<DemoCcuAdaptiveCandidateBucket, number>;

export interface DemoCcuAdaptiveCandidate {
  appid: number;
  bucket: DemoCcuAdaptiveCandidateBucket;
  demoCcuTier: number;
}

export interface DemoCcuAdaptiveCandidateResult {
  breakdown: DemoCcuAdaptiveCandidateBreakdown;
  candidates: DemoCcuAdaptiveCandidate[];
  skippedCount: number;
}

export interface Tier3CcuCandidateResult {
  appids: number[];
  skippedCount: number;
}

export interface DailyCcuPeakUpsert {
  appid: number;
  ccu_peak: number;
  ccu_source: 'steam_api' | 'steamspy';
  metric_date: string;
}

export interface ReviewDeltaUpsert {
  appid: number;
  delta_date: string;
  hours_since_last_sync?: number | null;
  is_interpolated?: boolean;
  negative_added?: number;
  positive_added?: number;
  positive_reviews: number;
  review_score?: number | null;
  review_score_desc?: string | null;
  reviews_added?: number;
  total_reviews: number;
}

export interface ReviewHistogramUpsert {
  appid: number;
  fetched_at?: string | null;
  month_start: string;
  recommendations_down: number;
  recommendations_up: number;
}

export interface AppTrendUpsert {
  appid: number;
  ccu_trend_7d_pct?: number | null;
  current_positive_ratio?: number | null;
  previous_positive_ratio?: number | null;
  review_velocity_30d?: number | null;
  review_velocity_7d?: number | null;
  trend_30d_change_pct?: number | null;
  trend_30d_direction?: string | null;
  trend_90d_change_pct?: number | null;
  trend_90d_direction?: string | null;
  updated_at?: string | null;
}

export interface ReviewHistogramSyncStatus {
  appid: number;
  lastHistogramSync: string | null;
}

export interface ReviewHistogramEntry {
  appid: number;
  month_start: string;
  recommendations_down: number;
  recommendations_up: number;
}

export interface ReviewHistogramAppidPage {
  appids: number[];
  hasMore: boolean;
  nextCursor: number;
  rowsFetched: number;
}

export interface PriorityInput {
  appid: number;
  ccu_peak: number | null;
  is_released: boolean;
  last_reviews_sync: string | null;
  last_steamspy_sync: string | null;
  release_date: string | null;
  review_velocity_30d: number | null;
  review_velocity_7d: number | null;
  total_reviews: number | null;
  trend_30d_change_pct: number | null;
}

export interface ReviewPromotion {
  appid: number;
  bucket: string;
  reason: string;
  score: number;
  until: string;
}

export interface PreviousReviewSyncData {
  consecutiveErrors: number;
  intervalHours: number;
  isPinned: boolean;
  lastActivityAt: Date | null;
  lastSync: Date | null;
  positiveReviews: number;
  totalReviews: number;
}

export interface ReviewSummaryForPersistence {
  negativeReviews: number;
  positiveReviews: number;
  reviewScore: number | null;
  reviewScoreDesc: string | null;
  totalReviews: number;
}

export interface PersistReviewSummaryParams {
  appid: number;
  lane?: string | null;
  previous: PreviousReviewSyncData | undefined;
  priorityScore?: number | null;
  summary: ReviewSummaryForPersistence;
  today: string;
  velocityTier?: string | null;
}

export interface PersistReviewSummaryBatchParams {
  items: PersistReviewSummaryParams[];
  persistedAt?: string;
  workerId: string;
}

export interface PersistReviewSummaryResult {
  appid: number;
  intervalHours: number;
  negativeAdded: number;
  nextSyncAt: string;
  nowIso: string;
  positiveAdded: number;
  reviewsAdded: number;
}

export interface PersistReviewFailureBatchParams {
  failedAt?: string;
  failures: Array<{
    appid: number;
    errorMessage: string;
    previousConsecutiveErrors: number;
  }>;
  workerId: string;
}

export interface EmbeddingCandidate {
  appid?: number;
  entityId?: number;
  embeddingText: string;
  name: string;
}

export interface GameEmbeddingCandidate {
  appid: number;
  average_playtime_forever: number | null;
  categories: string[];
  ccu_growth_30d: number | null;
  ccu_growth_7d: number | null;
  ccu_peak: number | null;
  content_descriptors: JsonRecord | null;
  controller_support: string | null;
  current_price_cents: number | null;
  developer_ids: number[];
  developers: string[];
  franchise_ids: number[];
  franchise_names: string[];
  genres: string[];
  historical_review_pct: number | null;
  is_delisted: boolean;
  is_free: boolean;
  is_released: boolean;
  language_count: number | null;
  metacritic_score: number | null;
  name: string;
  owners_min: number | null;
  pics_review_percentage: number | null;
  pics_review_score: number | null;
  platforms: string | null;
  primary_genre: string | null;
  publisher_ids: number[];
  publishers: string[];
  recent_review_pct: number | null;
  release_date: string | null;
  sentiment_delta: number | null;
  steam_deck_category: string | null;
  steamspy_tags: string[];
  tags: string[];
  total_reviews: number | null;
  trend_30d_direction: string | null;
  type: string;
  updated_at: string;
  velocity_7d: number | null;
  velocity_acceleration: number | null;
  velocity_tier: string | null;
}

export interface PublisherEmbeddingCandidate {
  avg_review_percentage: number | null;
  first_game_release_date: string | null;
  game_count: number;
  id: number;
  name: string;
  platforms_supported: string[];
  top_game_appids: number[];
  top_game_names: string[];
  top_genres: string[];
  top_tags: string[];
  total_reviews: number;
}

export interface DeveloperEmbeddingCandidate extends PublisherEmbeddingCandidate {
  is_indie: boolean;
}

export type AlertEntityType = 'game' | 'publisher' | 'developer';

export interface PinnedAlertEntity {
  alert_ccu_drop: boolean;
  alert_ccu_spike: boolean;
  alert_milestone: boolean;
  alert_new_release: boolean;
  alert_price_change: boolean;
  alert_review_surge: boolean;
  alert_sentiment_shift: boolean;
  alert_trend_reversal: boolean;
  alerts_enabled: boolean;
  ccu_7d_avg: number | null;
  ccu_current: number | null;
  discount_percent: number | null;
  display_name: string;
  entity_id: number;
  entity_type: AlertEntityType;
  pin_id: string;
  positive_ratio: number | null;
  price_cents: number | null;
  review_velocity: number | null;
  sensitivity_ccu: number;
  sensitivity_review: number;
  sensitivity_sentiment: number;
  total_reviews: number | null;
  trend_30d_direction: string | null;
  user_id: string;
}

export interface AlertEntityMetrics {
  ccu_7d_avg: number | null;
  ccu_current: number | null;
  discount_percent: number | null;
  entity_id: number;
  positive_ratio: number | null;
  price_cents: number | null;
  review_velocity: number | null;
  total_reviews: number | null;
  trend_30d_direction: string | null;
}

export interface AlertEntityKey {
  entity_id: number;
  entity_type: AlertEntityType;
}

export interface AlertSourceEvent {
  alert_type: 'new_release' | 'price_change';
  appid: number;
  app_name: string | null;
  current_value: number | null;
  entity_id: number;
  entity_type: AlertEntityType;
  event_key: string;
  occurred_at: string;
  previous_value: number | null;
  source_data: JsonRecord | null;
}

export interface UserPinRow {
  display_name: string;
  entity_id: number;
  entity_type: AlertEntityType;
  id: string;
  pin_order: number;
  pinned_at: string | null;
  user_id: string;
}

export interface UserPinWithMetrics {
  ccu_change_pct: number | null;
  ccu_current: number | null;
  discount_percent: number | null;
  display_name: string;
  entity_id: number;
  entity_type: AlertEntityType;
  pin_id: string;
  pin_order: number;
  pinned_at: string | null;
  positive_pct: number | null;
  price_cents: number | null;
  review_velocity: number | null;
  total_reviews: number | null;
  trend_direction: string | null;
}

export interface UserAlertPinSummary {
  display_name: string;
  entity_id: number;
  entity_type: AlertEntityType;
}

export interface UserAlertWithPin {
  alert_type: string;
  change_percent: number | null;
  created_at: string | null;
  current_value: number | null;
  dedup_key: string;
  description: string;
  id: string;
  is_read: boolean;
  metric_name: string | null;
  pin_id: string;
  previous_value: number | null;
  read_at: string | null;
  severity: string;
  source_data: JsonRecord | null;
  title: string;
  user_id: string;
  user_pins: UserAlertPinSummary | null;
}

export interface AlertPreferencesRow {
  alert_ccu_drop: boolean;
  alert_ccu_spike: boolean;
  alert_milestone: boolean;
  alert_new_release: boolean;
  alert_price_change: boolean;
  alert_review_surge: boolean;
  alert_sentiment_shift: boolean;
  alert_trend_reversal: boolean;
  alerts_enabled: boolean;
  ccu_sensitivity: number;
  created_at: string | null;
  review_sensitivity: number;
  sentiment_sensitivity: number;
  updated_at: string | null;
  user_id: string;
}

export interface AlertPreferencesUpsert {
  alert_ccu_drop?: boolean;
  alert_ccu_spike?: boolean;
  alert_milestone?: boolean;
  alert_new_release?: boolean;
  alert_price_change?: boolean;
  alert_review_surge?: boolean;
  alert_sentiment_shift?: boolean;
  alert_trend_reversal?: boolean;
  alerts_enabled?: boolean;
  ccu_sensitivity?: number;
  review_sensitivity?: number;
  sentiment_sensitivity?: number;
  updated_at?: string | null;
  user_id: string;
}

export interface PinAlertSettingsRow {
  alert_ccu_drop: boolean | null;
  alert_ccu_spike: boolean | null;
  alert_milestone: boolean | null;
  alert_new_release: boolean | null;
  alert_price_change: boolean | null;
  alert_review_surge: boolean | null;
  alert_sentiment_shift: boolean | null;
  alert_trend_reversal: boolean | null;
  alerts_enabled: boolean;
  ccu_sensitivity: number | null;
  created_at: string | null;
  pin_id: string;
  review_sensitivity: number | null;
  sentiment_sensitivity: number | null;
  updated_at: string | null;
  use_custom_settings: boolean;
}

export interface PinAlertSettingsUpsert {
  alert_ccu_drop?: boolean | null;
  alert_ccu_spike?: boolean | null;
  alert_milestone?: boolean | null;
  alert_new_release?: boolean | null;
  alert_price_change?: boolean | null;
  alert_review_surge?: boolean | null;
  alert_sentiment_shift?: boolean | null;
  alert_trend_reversal?: boolean | null;
  alerts_enabled?: boolean;
  ccu_sensitivity?: number | null;
  pin_id: string;
  review_sensitivity?: number | null;
  sentiment_sensitivity?: number | null;
  updated_at?: string | null;
  use_custom_settings?: boolean;
}

export interface AlertDetectionState {
  ccu_7d_avg: number | null;
  ccu_prev_value: number | null;
  entity_id: number;
  entity_type: AlertEntityType;
  positive_ratio_prev: number | null;
  review_velocity_7d_avg: number | null;
  total_reviews_prev: number | null;
  trend_30d_direction_prev: string | null;
}

export interface AlertDetectionStateUpsert extends AlertDetectionState {
  updated_at?: string | null;
}

export interface AlertInsert {
  alert_type: string;
  change_percent?: number | null;
  created_at?: string | null;
  current_value?: number | null;
  dedup_key: string;
  description: string;
  id?: string;
  metric_name?: string | null;
  pin_id: string;
  previous_value?: number | null;
  severity: string;
  source_data?: JsonRecord | null;
  title: string;
  user_id: string;
}

export interface IssueReportInsert extends JsonRecord {
  app_context: JsonRecord;
  app_environment?: string | null;
  app_release?: string | null;
  app_version?: string | null;
  browser_context: JsonRecord;
  chat_preview?: JsonRecord | null;
  debug_context: JsonRecord;
  id: string;
  include_chat_preview: boolean;
  issue_type: string;
  note?: string | null;
  organization?: string | null;
  page_context: JsonRecord;
  route_context: JsonRecord;
  route_pathname?: string | null;
  route_url?: string | null;
  sentry_server_event_id?: string | null;
  status?: string;
  user_email?: string | null;
  user_id?: string | null;
  user_role?: string | null;
}

export interface IssueReportSentryIds extends JsonRecord {
  sentry_client_event_id?: string | null;
  sentry_feedback_id?: string | null;
  sentry_replay_id?: string | null;
  sentry_server_event_id?: string | null;
  sentry_trace_id?: string | null;
}

export interface UserPinUpsert {
  display_name: string;
  entity_id: number;
  entity_type: string;
  id?: string;
  pin_order?: number | null;
  pinned_at?: string | null;
  user_id: string;
}

function parseNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: boolean | string | null | undefined, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function parseNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function parseAlertEntityType(value: string): AlertEntityType {
  return value === 'publisher' || value === 'developer' ? value : 'game';
}

function normalizeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function parseCatalogScanBatchResult(value: unknown): CatalogScanBatchResult {
  const record = parseJsonRecord(value);
  if (!record) {
    throw new Error('Tiger catalog observation batch returned an invalid result');
  }

  const readCount = (key: string): number => {
    const raw = record[key];
    const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`Tiger catalog observation batch result has invalid ${key}`);
    }
    return parsed;
  };
  const readAppids = (key: string): number[] => {
    const raw = record[key];
    const appids = parseNumberArray(raw);
    if (
      !Array.isArray(raw) ||
      appids.length !== raw.length ||
      appids.some((appid) => !Number.isSafeInteger(appid) || appid <= 0) ||
      new Set(appids).size !== appids.length
    ) {
      throw new Error(`Tiger catalog observation batch result has invalid ${key}`);
    }
    return appids;
  };
  const batchHash = typeof record.batch_hash === 'string' ? record.batch_hash : null;
  if (!batchHash) {
    throw new Error('Tiger catalog observation batch result is missing batch_hash');
  }

  return {
    acceptedRows: readCount('accepted_rows'),
    batchHash,
    batchIndex: readCount('batch_index'),
    changedKnownAppids: readAppids('changed_known_appids'),
    changedKnownRows: readCount('changed_known_rows'),
    enqueuedRows: readCount('enqueued_rows'),
    eventRows: readCount('event_rows'),
    knownRows: readCount('known_rows'),
    rejectedRows: readCount('rejected_rows'),
    seededRows: readCount('seeded_rows'),
    unchangedKnownRows: readCount('unchanged_known_rows'),
    unknownAppids: readAppids('unknown_appids'),
    unknownRows: readCount('unknown_rows'),
  };
}

function parseCatalogScanFinalizationProgress(value: unknown): CatalogScanFinalizationProgress {
  const record = parseJsonRecord(value);
  if (!record) {
    throw new Error('Tiger catalog finalization returned an invalid result');
  }

  const phases = new Set<CatalogScanFinalizationPhase>([
    'not_started',
    'catalog_state',
    'catalog_readiness',
    'ready_to_complete',
    'completed',
  ]);
  const statuses = new Set<CatalogScanStatus>(['running', 'finalizing', 'completed', 'failed']);
  const phase =
    typeof record.phase === 'string' && phases.has(record.phase as CatalogScanFinalizationPhase)
      ? (record.phase as CatalogScanFinalizationPhase)
      : null;
  const status =
    typeof record.status === 'string' && statuses.has(record.status as CatalogScanStatus)
      ? (record.status as CatalogScanStatus)
      : null;
  const readCount = (key: string): number => {
    const raw = record[key];
    const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`Tiger catalog finalization result has invalid ${key}`);
    }
    return parsed;
  };

  if (!phase || !status || typeof record.done !== 'boolean') {
    throw new Error('Tiger catalog finalization result has invalid state');
  }
  if (record.done !== (status === 'completed' && phase === 'completed')) {
    throw new Error('Tiger catalog finalization result has inconsistent completion state');
  }

  return {
    done: record.done,
    phase,
    processedRows: readCount('processed_rows'),
    readinessRows: readCount('readiness_rows'),
    stateRows: readCount('state_rows'),
    status,
  };
}

function normalizeDate(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const raw = value instanceof Date ? value.toISOString() : value;
  return raw.slice(0, 10);
}

function normalizeIntervalHours(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 24;
  }

  return Math.max(1, Math.round(value));
}

export function getReviewCadenceHours(params: {
  lane?: string | null;
  nowMs?: number;
  previous?: PreviousReviewSyncData;
  priorityScore?: number | null;
  summaryTotalReviews: number;
  velocityTier?: string | null;
}): number {
  switch (params.velocityTier) {
    case 'high':
      return 4;
    case 'medium':
      return 12;
    case 'low':
      return 24;
  }

  if (params.lane === 'launch_critical' || params.lane === 'change_critical' || params.lane === 'active_reviews') {
    return 24;
  }

  if ((params.priorityScore ?? 0) >= 50 || params.previous?.isPinned) {
    return 7 * 24;
  }

  if (params.summaryTotalReviews > 0) {
    return 30 * 24;
  }

  const nowMs = params.nowMs ?? Date.now();
  const lastActivityAtMs = params.previous?.lastActivityAt?.getTime();
  if (
    lastActivityAtMs !== undefined &&
    Number.isFinite(lastActivityAtMs) &&
    lastActivityAtMs >= nowMs - 90 * 24 * 60 * 60 * 1000
  ) {
    return 7 * 24;
  }

  return 90 * 24;
}

function calculateReviewFailureBackoffMinutes(consecutiveErrors: number): number {
  const cappedErrors = Math.max(1, Math.min(consecutiveErrors, 6));
  return Math.min(15 * 2 ** (cappedErrors - 1), 360);
}

function jsonRows(rows: unknown[]): string {
  return JSON.stringify(
    rows.map((row) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        return row;
      }

      return Object.fromEntries(
        Object.entries(row as JsonRecord).filter(([, value]) => value !== undefined)
      );
    })
  );
}

function formatColumns(values: JsonRecord[], required: string[] = []): string[] {
  const columns = new Set(required);
  for (const value of values) {
    for (const key of Object.keys(value)) {
      columns.add(key);
    }
  }

  return Array.from(columns);
}

function buildUpsertSql(params: {
  columns: string[];
  conflict: string;
  schema: string;
  table: string;
  updateColumns?: string[];
}): string {
  const updateColumns = params.updateColumns ?? params.columns.filter((column) => column !== 'id');
  const updateSet = updateColumns
    .filter(
      (column) =>
        !params.conflict
          .split(',')
          .map((part) => part.trim())
          .includes(column)
    )
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');
  const doUpdate = updateSet.length > 0 ? `DO UPDATE SET ${updateSet}` : 'DO NOTHING';

  return `
    INSERT INTO ${params.schema}.${params.table} (${params.columns.join(', ')})
    SELECT ${params.columns.join(', ')}
    FROM jsonb_populate_recordset(NULL::${params.schema}.${params.table}, $1::jsonb) AS rows
    ON CONFLICT (${params.conflict}) ${doUpdate}
  `;
}

function allowedEntries(
  values: JsonRecord,
  allowedColumns: ReadonlySet<string>
): Array<[string, unknown]> {
  return Object.entries(values).filter(
    ([key, value]) => value !== undefined && allowedColumns.has(key)
  );
}

interface AppRelationTableConfig {
  conflict: string;
  ownerColumn: string;
}

const APP_RELATION_TABLES = new Map<string, AppRelationTableConfig>([
  ['app_categories', { conflict: 'appid, category_id', ownerColumn: 'appid' }],
  ['app_developers', { conflict: 'appid, developer_id', ownerColumn: 'appid' }],
  ['app_dlc', { conflict: 'parent_appid, dlc_appid', ownerColumn: 'parent_appid' }],
  ['app_franchises', { conflict: 'appid, franchise_id', ownerColumn: 'appid' }],
  ['app_genres', { conflict: 'appid, genre_id', ownerColumn: 'appid' }],
  ['app_publishers', { conflict: 'appid, publisher_id', ownerColumn: 'appid' }],
  ['app_steam_tags', { conflict: 'appid, tag_id', ownerColumn: 'appid' }],
]);

async function runQuery<T extends QueryResultRow>(
  client: TigerQueryClient | TigerWriterPool,
  operation: string,
  sql: string,
  values: QueryValues = []
): Promise<QueryResult<T>> {
  try {
    return await client.query<T>(sql, values);
  } catch (error) {
    throw new TigerWriterError(operation, error);
  }
}

export class TigerOpsRepository {
  constructor(private readonly pool: TigerWriterPool) {}

  async createSyncJob(params: SyncJobCreateParams): Promise<string | null> {
    const { rows } = await runQuery<IdRow>(
      this.pool,
      'ops.createSyncJob',
      `
        INSERT INTO ops.sync_jobs (
          job_type, github_run_id, status, started_at, batch_size
        )
        VALUES ($1, $2, 'running', COALESCE($3::timestamptz, now()), $4)
        RETURNING id
      `,
      [
        params.jobType,
        params.githubRunId ?? null,
        params.startedAt ?? null,
        params.batchSize ?? null,
      ]
    );

    return rows[0]?.id ? String(rows[0].id) : null;
  }

  async tryCreateSyncJobIfIdle(
    params: SyncJobCreateParams & {
      freshAfterIso: string;
      lockKey: string;
    }
  ): Promise<string | null> {
    const { rows } = await runQuery<IdRow>(
      this.pool,
      'ops.tryCreateSyncJobIfIdle',
      `
        WITH lock_attempt AS MATERIALIZED (
          SELECT pg_try_advisory_xact_lock(
            hashtextextended($1::text, 0)
          ) AS acquired
        ),
        inserted AS (
          INSERT INTO ops.sync_jobs (
            job_type, github_run_id, status, started_at, batch_size
          )
          SELECT
            $2,
            $3,
            'running',
            COALESCE($4::timestamptz, now()),
            $5
          FROM lock_attempt
          WHERE acquired
            AND NOT EXISTS (
              SELECT 1
              FROM ops.sync_jobs
              WHERE job_type = $2
                AND status = 'running'
                AND GREATEST(COALESCE(updated_at, started_at), started_at)
                  >= $6::timestamptz
            )
          RETURNING id
        )
        SELECT id
        FROM inserted
      `,
      [
        params.lockKey,
        params.jobType,
        params.githubRunId ?? null,
        params.startedAt ?? null,
        params.batchSize ?? null,
        params.freshAfterIso,
      ]
    );

    return rows[0]?.id ? String(rows[0].id) : null;
  }

  async updateSyncJob(id: string, values: SyncJobUpdate): Promise<number> {
    const allowed = new Set([
      'completed_at',
      'error_message',
      'items_created',
      'items_failed',
      'items_processed',
      'items_skipped',
      'items_succeeded',
      'items_updated',
      'metadata',
      'status',
    ]);
    const entries = allowedEntries(values as JsonRecord, allowed);
    if (entries.length === 0) {
      return 0;
    }

    const setClauses = entries.map(([column], index) => `${column} = $${index + 2}`);
    setClauses.push('updated_at = now()');

    const result = await runQuery(
      this.pool,
      'ops.updateSyncJob',
      `UPDATE ops.sync_jobs SET ${setClauses.join(', ')} WHERE id = $1::uuid`,
      [id, ...entries.map(([, value]) => value)]
    );

    return result.rowCount ?? 0;
  }

  async heartbeatSyncJob(id: string): Promise<number> {
    const result = await runQuery(
      this.pool,
      'ops.heartbeatSyncJob',
      `
        UPDATE ops.sync_jobs
        SET updated_at = now()
        WHERE id = $1::uuid
          AND status = 'running'
      `,
      [id]
    );

    return result.rowCount ?? 0;
  }

  async abandonStaleSyncJobs(params: {
    errorMessage?: string;
    jobTypes: string[];
    startedBeforeIso: string;
  }): Promise<number> {
    if (params.jobTypes.length === 0) {
      return 0;
    }

    const result = await runQuery(
      this.pool,
      'ops.abandonStaleSyncJobs',
      `
        UPDATE ops.sync_jobs
        SET status = 'failed',
            completed_at = now(),
            error_message = $3,
            updated_at = now()
        WHERE job_type = ANY($1::text[])
          AND status = 'running'
          AND started_at < $2::timestamptz
      `,
      [params.jobTypes, params.startedBeforeIso, params.errorMessage ?? 'worker_abandoned']
    );

    return result.rowCount ?? 0;
  }

  async abandonStaleRunningSyncJobsByTypes(params: {
    errorMessage?: string;
    jobTypes: string[];
    staleBeforeIso: string;
  }): Promise<number> {
    if (params.jobTypes.length === 0) {
      return 0;
    }

    const result = await runQuery(
      this.pool,
      'ops.abandonStaleRunningSyncJobsByTypes',
      `
        UPDATE ops.sync_jobs
        SET status = 'failed',
            completed_at = now(),
            error_message = $3,
            updated_at = now()
        WHERE job_type = ANY($1::text[])
          AND status = 'running'
          AND GREATEST(COALESCE(updated_at, started_at), started_at) < $2::timestamptz
      `,
      [params.jobTypes, params.staleBeforeIso, params.errorMessage ?? 'worker_abandoned']
    );

    return result.rowCount ?? 0;
  }

  async countRunningSyncJobs(jobType: string, startedAfterIso: string): Promise<number> {
    const { rows } = await runQuery<CountRow>(
      this.pool,
      'ops.countRunningSyncJobs',
      `
        SELECT count(*)::integer AS count
        FROM ops.sync_jobs
        WHERE job_type = $1
          AND status = 'running'
          AND started_at >= $2::timestamptz
      `,
      [jobType, startedAfterIso]
    );

    return parseNumber(rows[0]?.count);
  }

  async countRunningSyncJobsByTypes(jobTypes: string[], startedAfterIso: string): Promise<number> {
    if (jobTypes.length === 0) {
      return 0;
    }

    const { rows } = await runQuery<CountRow>(
      this.pool,
      'ops.countRunningSyncJobsByTypes',
      `
        SELECT count(*)::integer AS count
        FROM ops.sync_jobs
        WHERE job_type = ANY($1::text[])
          AND status = 'running'
          AND started_at >= $2::timestamptz
      `,
      [jobTypes, startedAfterIso]
    );

    return parseNumber(rows[0]?.count);
  }

  async countFreshRunningSyncJobsByTypes(
    jobTypes: string[],
    freshAfterIso: string
  ): Promise<SyncJobTypeCount[]> {
    if (jobTypes.length === 0) {
      return [];
    }

    const { rows } = await runQuery<SyncJobTypeCountRow>(
      this.pool,
      'ops.countFreshRunningSyncJobsByTypes',
      `
        SELECT job_type, count(*)::integer AS count
        FROM ops.sync_jobs
        WHERE job_type = ANY($1::text[])
          AND status = 'running'
          AND GREATEST(COALESCE(updated_at, started_at), started_at) >= $2::timestamptz
        GROUP BY job_type
        ORDER BY job_type ASC
      `,
      [jobTypes, freshAfterIso]
    );

    return rows.map((row) => ({
      count: parseNumber(row.count),
      jobType: row.job_type,
    }));
  }

  async countSyncJobMetadataNumberSince(params: {
    jobType: string;
    metadataKey: string;
    startedAfterIso: string;
  }): Promise<number> {
    const { rows } = await runQuery<CountRow>(
      this.pool,
      'ops.countSyncJobMetadataNumberSince',
      `
        SELECT COALESCE(sum((metadata ->> $2)::integer), 0)::integer AS count
        FROM ops.sync_jobs
        WHERE job_type = $1
          AND started_at >= $3::timestamptz
          AND metadata ? $2
      `,
      [params.jobType, params.metadataKey, params.startedAfterIso]
    );

    return parseNumber(rows[0]?.count);
  }

  async refreshDashboardStats(): Promise<void> {
    await runQuery(this.pool, 'ops.refreshDashboardStats', 'SELECT ops.refresh_dashboard_stats()');
  }
}

export class TigerSyncStatusRepository {
  private readonly updateColumns = new Set([
    'consecutive_errors',
    'embedding_hash',
    'is_syncable',
    'last_activity_at',
    'last_embedding_sync',
    'last_error_at',
    'last_error_message',
    'last_error_source',
    'last_histogram_sync',
    'last_known_total_reviews',
    'last_media_sync',
    'last_news_sync',
    'last_pics_sync',
    'last_price_sync',
    'last_reviews_sync',
    'last_steamspy_individual_fetch',
    'last_steamspy_sync',
    'last_storefront_sync',
    'next_reviews_sync',
    'next_sync_after',
    'pics_change_number',
    'priority_calculated_at',
    'priority_score',
    'refresh_tier',
    'reviews_claimed_at',
    'reviews_claim_expires_at',
    'reviews_claimed_by',
    'reviews_interval_hours',
    'reviews_priority_override_bucket',
    'reviews_priority_override_reason',
    'reviews_priority_override_score',
    'reviews_priority_override_until',
    'steam_last_modified',
    'steam_price_change_number',
    'steamspy_available',
    'storefront_accessible',
    'sync_interval_hours',
    'updated_at',
    'velocity_7d',
    'velocity_calculated_at',
  ]);

  constructor(private readonly pool: TigerWriterPool) {}

  async upsertRows(rows: SyncStatusUpsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const columns = formatColumns(rows as unknown as JsonRecord[], ['appid']);
    const result = await runQuery(
      this.pool,
      'syncStatus.upsertRows',
      buildUpsertSql({
        columns,
        conflict: 'appid',
        schema: 'ops',
        table: 'sync_status',
      }),
      [jsonRows(rows)]
    );

    return result.rowCount ?? 0;
  }

  async updateFields(appid: number, values: JsonRecord): Promise<number> {
    const entries = allowedEntries(values, this.updateColumns);
    if (entries.length === 0) {
      return 0;
    }

    const setClauses = entries.map(([column], index) => `${column} = $${index + 2}`);
    setClauses.push('updated_at = now()');
    const result = await runQuery(
      this.pool,
      'syncStatus.updateFields',
      `UPDATE ops.sync_status SET ${setClauses.join(', ')} WHERE appid = $1`,
      [appid, ...entries.map(([, value]) => value)]
    );

    return result.rowCount ?? 0;
  }

  async updateMany(appids: number[], values: JsonRecord): Promise<number> {
    if (appids.length === 0) {
      return 0;
    }

    const entries = allowedEntries(values, this.updateColumns);
    if (entries.length === 0) {
      return 0;
    }

    const setClauses = entries.map(([column], index) => `${column} = $${index + 2}`);
    setClauses.push('updated_at = now()');
    const result = await runQuery(
      this.pool,
      'syncStatus.updateMany',
      `UPDATE ops.sync_status SET ${setClauses.join(', ')} WHERE appid = ANY($1::integer[])`,
      [appids, ...entries.map(([, value]) => value)]
    );

    return result.rowCount ?? 0;
  }

  async listHistogramStatuses(appids: number[]): Promise<ReviewHistogramSyncStatus[]> {
    if (appids.length === 0) {
      return [];
    }

    const { rows } = await runQuery<HistogramSyncStatusRow>(
      this.pool,
      'syncStatus.listHistogramStatuses',
      `
        SELECT appid, last_histogram_sync
        FROM ops.sync_status
        WHERE appid = ANY($1::integer[])
      `,
      [appids]
    );

    return rows.map((row) => ({
      appid: row.appid,
      lastHistogramSync: normalizeTimestamp(row.last_histogram_sync),
    }));
  }
}

export class TigerCatalogRepository {
  constructor(private readonly pool: TigerWriterPool) {}

  async listAppsForSync(params: {
    limit: number;
    partitionCount?: number;
    partitionId?: number;
    source: string;
  }): Promise<AppSyncCandidate[]> {
    const isPartitioned =
      params.partitionCount !== undefined &&
      params.partitionCount > 1 &&
      params.partitionId !== undefined;
    const { rows } = await runQuery<SyncCandidateRow>(
      this.pool,
      'catalog.listAppsForSync',
      isPartitioned
        ? `
          SELECT appid, priority_score
          FROM ops.get_apps_for_sync_partitioned(
            $1::text,
            $2::integer,
            $3::integer,
            $4::integer
          )
        `
        : `
          SELECT appid, priority_score
          FROM ops.get_apps_for_sync($1::text, $2::integer)
        `,
      isPartitioned
        ? [params.source, params.limit, params.partitionCount, params.partitionId]
        : [params.source, params.limit]
    );

    return rows.map((row) => ({
      appid: row.appid,
      priorityScore: parseNumber(row.priority_score),
    }));
  }

  async listHistogramSyncCandidates(params: {
    activeQuota: number;
    coverageQuota: number;
    limit: number;
    longTailQuota: number;
    mediumQuota: number;
  }): Promise<HistogramSyncCandidate[]> {
    const { rows } = await runQuery<HistogramSyncCandidateRow>(
      this.pool,
      'catalog.listHistogramSyncCandidates',
      `
        WITH base AS (
          SELECT
            s.appid,
            s.created_at,
            s.last_histogram_sync,
            COALESCE(s.priority_score, 0)::integer AS priority_score,
            COALESCE(s.review_velocity_tier, 'unknown') AS review_velocity_tier,
            COALESCE(s.velocity_7d, 0)::numeric AS velocity_7d,
            COALESCE(
              ldm.total_reviews,
              s.last_known_total_reviews,
              0
            )::integer AS total_reviews,
            EXISTS (
              SELECT 1
              FROM metrics.review_histogram h
              WHERE h.appid = s.appid
            ) AS has_histogram
          FROM ops.sync_status s
          JOIN legacy.apps a ON a.appid = s.appid
          LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = s.appid
          WHERE COALESCE(s.is_syncable, true) = true
            AND a.type = 'game'
            AND COALESCE(a.is_released, false) = true
            AND COALESCE(a.is_delisted, false) = false
            AND COALESCE(
              ldm.total_reviews,
              s.last_known_total_reviews,
              0
            ) > 0
            AND NOT (
              COALESCE(s.last_error_source, '') = 'histogram'
              AND COALESCE(s.last_error_at, '-infinity'::timestamptz)
                > now() - INTERVAL '6 hours'
            )
        ),
        classified AS (
          SELECT
            base.*,
            CASE
              WHEN review_velocity_tier IN ('high', 'medium')
                OR velocity_7d >= 1
                OR priority_score >= 100
                OR total_reviews >= 10000
                THEN 'active_daily'
              WHEN priority_score >= 25
                OR total_reviews >= 1000
                THEN 'medium_weekly'
              ELSE 'long_tail_monthly'
            END::text AS service_tier
          FROM base
        ),
        due AS (
          SELECT
            classified.*,
            CASE service_tier
              WHEN 'active_daily' THEN INTERVAL '24 hours'
              WHEN 'medium_weekly' THEN INTERVAL '7 days'
              ELSE INTERVAL '30 days'
            END AS target_interval
          FROM classified
          WHERE COALESCE(
            last_histogram_sync,
            '-infinity'::timestamptz
          ) <= now() - CASE service_tier
            WHEN 'active_daily' THEN INTERVAL '24 hours'
            WHEN 'medium_weekly' THEN INTERVAL '7 days'
            ELSE INTERVAL '30 days'
          END
        ),
        coverage_ranked AS (
          SELECT
            due.*,
            row_number() OVER (
              ORDER BY
                CASE WHEN last_histogram_sync IS NULL THEN 0 ELSE 1 END,
                CASE WHEN has_histogram THEN 1 ELSE 0 END,
                COALESCE(last_histogram_sync, created_at) ASC,
                total_reviews DESC,
                priority_score DESC,
                appid ASC
            ) AS lane_rank
          FROM due
        ),
        coverage_claims AS (
          SELECT *
          FROM coverage_ranked
          ORDER BY lane_rank
          LIMIT GREATEST($5::integer, 0)
        ),
        tier_ranked AS (
          SELECT
            due.*,
            row_number() OVER (
              PARTITION BY service_tier
              ORDER BY
                COALESCE(last_histogram_sync, created_at) ASC,
                priority_score DESC,
                total_reviews DESC,
                appid ASC
            ) AS lane_rank
          FROM due
          WHERE NOT EXISTS (
            SELECT 1
            FROM coverage_claims coverage
            WHERE coverage.appid = due.appid
          )
        ),
        tier_claims AS (
          SELECT *
          FROM tier_ranked
          WHERE (service_tier = 'active_daily' AND lane_rank <= GREATEST($2::integer, 0))
             OR (service_tier = 'medium_weekly' AND lane_rank <= GREATEST($3::integer, 0))
             OR (service_tier = 'long_tail_monthly' AND lane_rank <= GREATEST($4::integer, 0))
        ),
        primary_claims AS (
          SELECT
            coverage.appid,
            coverage.has_histogram,
            coverage.last_histogram_sync,
            coverage.priority_score,
            coverage.service_tier,
            coverage.total_reviews,
            'coverage_oldest'::text AS lane,
            0 AS lane_order,
            coverage.lane_rank
          FROM coverage_claims coverage

          UNION ALL

          SELECT
            tier.appid,
            tier.has_histogram,
            tier.last_histogram_sync,
            tier.priority_score,
            tier.service_tier,
            tier.total_reviews,
            tier.service_tier AS lane,
            CASE tier.service_tier
              WHEN 'active_daily' THEN 1
              WHEN 'medium_weekly' THEN 2
              ELSE 3
            END AS lane_order,
            tier.lane_rank
          FROM tier_claims tier
        ),
        reallocated AS (
          SELECT
            due.appid,
            due.has_histogram,
            due.last_histogram_sync,
            due.priority_score,
            due.service_tier,
            due.total_reviews,
            'reallocated'::text AS lane,
            4 AS lane_order,
            row_number() OVER (
              ORDER BY
                CASE WHEN due.last_histogram_sync IS NULL THEN 0 ELSE 1 END,
                (
                  EXTRACT(EPOCH FROM (
                    now() - COALESCE(due.last_histogram_sync, due.created_at)
                  ))
                  / NULLIF(EXTRACT(EPOCH FROM due.target_interval), 0)
                ) DESC NULLS FIRST,
                CASE due.service_tier
                  WHEN 'active_daily' THEN 0
                  WHEN 'medium_weekly' THEN 1
                  ELSE 2
                END,
                due.priority_score DESC,
                due.total_reviews DESC,
                due.appid ASC
            ) AS lane_rank
          FROM due
          WHERE NOT EXISTS (
            SELECT 1
            FROM primary_claims selected
            WHERE selected.appid = due.appid
          )
          ORDER BY
            CASE WHEN due.last_histogram_sync IS NULL THEN 0 ELSE 1 END,
            (
              EXTRACT(EPOCH FROM (
                now() - COALESCE(due.last_histogram_sync, due.created_at)
              ))
              / NULLIF(EXTRACT(EPOCH FROM due.target_interval), 0)
            ) DESC NULLS FIRST,
            due.appid ASC
          LIMIT GREATEST(
            $1::integer - (SELECT count(*)::integer FROM primary_claims),
            0
          )
        ),
        selected AS (
          SELECT * FROM primary_claims
          UNION ALL
          SELECT * FROM reallocated
        )
        SELECT
          appid,
          has_histogram,
          lane,
          last_histogram_sync,
          priority_score,
          service_tier,
          total_reviews
        FROM selected
        ORDER BY lane_order, lane_rank, appid
        LIMIT GREATEST($1::integer, 0)
      `,
      [
        params.limit,
        params.activeQuota,
        params.mediumQuota,
        params.longTailQuota,
        params.coverageQuota,
      ]
    );

    return rows.map((row) => ({
      appid: row.appid,
      hasHistogram: row.has_histogram,
      lane: row.lane as HistogramSelectionLane,
      lastHistogramSync: normalizeTimestamp(row.last_histogram_sync),
      priorityScore: parseNumber(row.priority_score),
      serviceTier: row.service_tier as HistogramServiceTier,
      totalReviews: parseNumber(row.total_reviews),
    }));
  }

  async getHistogramBacklogSnapshot(): Promise<HistogramBacklogSnapshot> {
    const { rows } = await runQuery<HistogramBacklogTierRow>(
      this.pool,
      'catalog.getHistogramBacklogSnapshot',
      `
        WITH base AS (
          SELECT
            s.appid,
            s.created_at,
            s.last_histogram_sync,
            COALESCE(s.priority_score, 0)::integer AS priority_score,
            COALESCE(s.review_velocity_tier, 'unknown') AS review_velocity_tier,
            COALESCE(s.velocity_7d, 0)::numeric AS velocity_7d,
            COALESCE(
              ldm.total_reviews,
              s.last_known_total_reviews,
              0
            )::integer AS total_reviews,
            EXISTS (
              SELECT 1
              FROM metrics.review_histogram h
              WHERE h.appid = s.appid
            ) AS has_histogram
          FROM ops.sync_status s
          JOIN legacy.apps a ON a.appid = s.appid
          LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = s.appid
          WHERE COALESCE(s.is_syncable, true) = true
            AND a.type = 'game'
            AND COALESCE(a.is_released, false) = true
            AND COALESCE(a.is_delisted, false) = false
            AND COALESCE(
              ldm.total_reviews,
              s.last_known_total_reviews,
              0
            ) > 0
        ),
        classified AS (
          SELECT
            base.*,
            CASE
              WHEN review_velocity_tier IN ('high', 'medium')
                OR velocity_7d >= 1
                OR priority_score >= 100
                OR total_reviews >= 10000
                THEN 'active_daily'
              WHEN priority_score >= 25
                OR total_reviews >= 1000
                THEN 'medium_weekly'
              ELSE 'long_tail_monthly'
            END::text AS service_tier
          FROM base
        ),
        due AS (
          SELECT *
          FROM classified
          WHERE COALESCE(
            last_histogram_sync,
            '-infinity'::timestamptz
          ) <= now() - CASE service_tier
            WHEN 'active_daily' THEN INTERVAL '24 hours'
            WHEN 'medium_weekly' THEN INTERVAL '7 days'
            ELSE INTERVAL '30 days'
          END
        )
        SELECT
          now() AS captured_at,
          classified.service_tier,
          count(*)::integer AS total_apps,
          count(*) FILTER (
            WHERE classified.last_histogram_sync IS NULL
          )::integer AS never_synced,
          count(*) FILTER (
            WHERE classified.has_histogram
          )::integer AS with_histogram,
          count(*) FILTER (
            WHERE classified.last_histogram_sync <= now() - INTERVAL '30 days'
          )::integer AS stale_30_days,
          count(*) FILTER (
            WHERE classified.last_histogram_sync <= now() - INTERVAL '90 days'
          )::integer AS stale_90_days,
          count(due.appid)::integer AS due_apps,
          min(COALESCE(due.last_histogram_sync, due.created_at)) AS oldest_waiting_at
        FROM classified
        LEFT JOIN due ON due.appid = classified.appid
        GROUP BY classified.service_tier
        ORDER BY classified.service_tier
        LIMIT 3
      `
    );

    const emptyTier = (): HistogramBacklogTierSnapshot => ({
      dueApps: 0,
      neverSynced: 0,
      oldestWaitingAt: null,
      stale30Days: 0,
      stale90Days: 0,
      totalApps: 0,
      withHistogram: 0,
    });
    const tiers: Record<HistogramServiceTier, HistogramBacklogTierSnapshot> = {
      active_daily: emptyTier(),
      long_tail_monthly: emptyTier(),
      medium_weekly: emptyTier(),
    };

    for (const row of rows) {
      tiers[row.service_tier as HistogramServiceTier] = {
        dueApps: parseNumber(row.due_apps),
        neverSynced: parseNumber(row.never_synced),
        oldestWaitingAt: normalizeTimestamp(row.oldest_waiting_at),
        stale30Days: parseNumber(row.stale_30_days),
        stale90Days: parseNumber(row.stale_90_days),
        totalApps: parseNumber(row.total_apps),
        withHistogram: parseNumber(row.with_histogram),
      };
    }

    const tierValues = Object.values(tiers);
    const oldestWaitingAt =
      tierValues
        .map((tier) => tier.oldestWaitingAt)
        .filter((value): value is string => value !== null)
        .sort()[0] ?? null;

    return {
      capturedAt: normalizeTimestamp(rows[0]?.captured_at) ?? new Date().toISOString(),
      dueApps: tierValues.reduce((sum, tier) => sum + tier.dueApps, 0),
      neverSynced: tierValues.reduce((sum, tier) => sum + tier.neverSynced, 0),
      oldestWaitingAt,
      stale30Days: tierValues.reduce((sum, tier) => sum + tier.stale30Days, 0),
      stale90Days: tierValues.reduce((sum, tier) => sum + tier.stale90Days, 0),
      tiers,
      totalApps: tierValues.reduce((sum, tier) => sum + tier.totalApps, 0),
      withHistogram: tierValues.reduce((sum, tier) => sum + tier.withHistogram, 0),
    };
  }

  async listExistingAppids(params: { afterAppid?: number; limit: number }): Promise<number[]> {
    const { rows } = await runQuery<AppIdRow>(
      this.pool,
      'catalog.listExistingAppids',
      `
        SELECT appid
        FROM legacy.apps
        WHERE appid > $1
        ORDER BY appid ASC
        LIMIT $2
      `,
      [params.afterAppid ?? 0, params.limit]
    );

    return rows.map((row) => row.appid);
  }

  async listStorefrontSyncStatuses(appids: number[]): Promise<StorefrontSyncStatus[]> {
    if (appids.length === 0) {
      return [];
    }

    const { rows } = await runQuery<StorefrontSyncStatusRow>(
      this.pool,
      'catalog.listStorefrontSyncStatuses',
      `
        SELECT appid, last_storefront_sync
        FROM ops.sync_status
        WHERE appid = ANY($1::integer[])
      `,
      [appids]
    );

    return rows.map((row) => ({
      appid: row.appid,
      lastStorefrontSync: normalizeTimestamp(row.last_storefront_sync),
    }));
  }

  async upsertApps(rows: CatalogAppUpsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const columns = formatColumns(rows as unknown as JsonRecord[], ['appid', 'name']);
    const result = await runQuery(
      this.pool,
      'catalog.upsertApps',
      buildUpsertSql({
        columns,
        conflict: 'appid',
        schema: 'legacy',
        table: 'apps',
      }),
      [jsonRows(rows)]
    );

    return result.rowCount ?? 0;
  }

  async upsertStorefrontApp(args: StorefrontAppUpsertArgs): Promise<void> {
    await runQuery(
      this.pool,
      'catalog.upsertStorefrontApp',
      `
        SELECT legacy.upsert_storefront_app(
          $1::integer,
          $2::text,
          $3::text,
          $4::boolean,
          $5::boolean,
          $6::date,
          $7::text,
          $8::boolean,
          $9::integer,
          $10::integer,
          $11::boolean,
          $12::text[],
          $13::text[],
          $14::integer[],
          $15::integer,
          $16::integer[],
          $17::boolean
        )
      `,
      [
        args.p_appid,
        args.p_name,
        args.p_type,
        args.p_is_free,
        args.p_is_delisted,
        args.p_release_date,
        args.p_release_date_raw,
        args.p_has_workshop,
        args.p_current_price_cents,
        args.p_current_discount_percent,
        args.p_is_released,
        args.p_developers,
        args.p_publishers,
        args.p_dlc_appids ?? [],
        args.p_parent_appid ?? null,
        args.p_demo_appids ?? [],
        args.p_has_purchase_packages ?? null,
      ]
    );
  }

  async markStorefrontInaccessible(appid: number, observedAt: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await runQuery(client, 'catalog.markStorefrontInaccessible.begin', 'BEGIN');
      const appsResult = await runQuery(
        client,
        'catalog.markStorefrontInaccessible.apps',
        `
          UPDATE legacy.apps
          SET catalog_seed_state = CASE
                WHEN catalog_seed_state = 'stub' THEN 'inaccessible'
                ELSE catalog_seed_state
              END,
              is_delisted = true,
              has_purchase_packages = NULL,
              updated_at = $2::timestamptz
          WHERE appid = $1
        `,
        [appid, observedAt]
      );

      await runQuery(
        client,
        'catalog.markStorefrontInaccessible.status',
        `
          INSERT INTO ops.sync_status (
            appid, storefront_accessible, last_storefront_sync, updated_at
          )
          VALUES ($1, false, $2::timestamptz, now())
          ON CONFLICT (appid)
          DO UPDATE SET
            storefront_accessible = EXCLUDED.storefront_accessible,
            last_storefront_sync = EXCLUDED.last_storefront_sync,
            updated_at = now()
        `,
        [appid, observedAt]
      );

      await runQuery(client, 'catalog.markStorefrontInaccessible.commit', 'COMMIT');
      return appsResult.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async upsertSteamCategories(rows: Array<{ category_id: number; name: string }>): Promise<number> {
    return this.upsertGeneric('legacy', 'steam_categories', rows, 'category_id');
  }

  async upsertSteamGenres(rows: Array<{ genre_id: number; name: string }>): Promise<number> {
    return this.upsertGeneric('legacy', 'steam_genres', rows, 'genre_id');
  }

  async upsertSteamTags(rows: Array<{ name: string; tag_id: number }>): Promise<number> {
    return this.upsertGeneric('legacy', 'steam_tags', rows, 'tag_id');
  }

  async replaceAppRelations(params: {
    appid: number;
    conflict: string;
    rows: JsonRecord[];
    table: string;
  }): Promise<number> {
    const tableConfig = APP_RELATION_TABLES.get(params.table);
    if (!tableConfig || tableConfig.conflict !== params.conflict) {
      throw new Error(`Unsupported legacy app relation table: ${params.table}`);
    }

    const client = await this.pool.connect();
    try {
      await runQuery(client, 'catalog.replaceAppRelations.begin', 'BEGIN');
      await runQuery(
        client,
        'catalog.replaceAppRelations.delete',
        `DELETE FROM legacy.${params.table} WHERE ${tableConfig.ownerColumn} = $1`,
        [params.appid]
      );

      let inserted = 0;
      if (params.rows.length > 0) {
        const relationRows = params.rows.map((row) => ({
          ...row,
          [tableConfig.ownerColumn]: row[tableConfig.ownerColumn] ?? params.appid,
        }));
        const columns = formatColumns(relationRows, [tableConfig.ownerColumn]);
        const result = await runQuery(
          client,
          'catalog.replaceAppRelations.insert',
          buildUpsertSql({
            columns,
            conflict: params.conflict,
            schema: 'legacy',
            table: params.table,
          }),
          [jsonRows(relationRows)]
        );
        inserted = result.rowCount ?? 0;
      }

      await runQuery(client, 'catalog.replaceAppRelations.commit', 'COMMIT');
      return inserted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  private async upsertGeneric(
    schema: string,
    table: string,
    rows: JsonRecord[],
    conflict: string
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const columns = formatColumns(rows);
    const result = await runQuery(
      this.pool,
      `catalog.upsertGeneric.${table}`,
      buildUpsertSql({ columns, conflict, schema, table }),
      [jsonRows(rows)]
    );

    return result.rowCount ?? 0;
  }
}

export class TigerCatalogObservationRepository {
  private static readonly DEFAULT_FINALIZATION_BATCH_SIZE = 1000;
  private static readonly MAX_FINALIZATION_STEPS = 10000;

  constructor(private readonly pool: TigerWriterPool) {}

  async beginScan(params: {
    forceFull: boolean;
    mode: CatalogObservationWriteMode;
    overlapSeconds?: number;
    runKey: string;
    source: CatalogScanSource;
    sourceStartedAt: string;
  }): Promise<CatalogScanStart> {
    const { rows } = await runQuery<CatalogScanStartQueryRow>(
      this.pool,
      'catalogObservation.beginScan',
      `
        SELECT
          id,
          status,
          scan_kind,
          source_started_at,
          requested_if_modified_since,
          committed_through,
          last_committed_batch
        FROM ops.begin_catalog_scan(
          $1::text,
          $2::text,
          $3::text,
          $4::boolean,
          $5::timestamptz,
          $6::integer
        )
      `,
      [
        params.runKey,
        params.source,
        params.mode,
        params.forceFull,
        params.sourceStartedAt,
        params.overlapSeconds ?? 300,
      ]
    );

    const row = rows[0];
    if (!row) {
      throw new Error('Tiger catalog observation scan did not return a run');
    }

    return {
      committedThrough: row.committed_through === null ? null : parseNumber(row.committed_through),
      id: row.id,
      lastCommittedBatch: parseNumber(row.last_committed_batch),
      requestedIfModifiedSince:
        row.requested_if_modified_since === null
          ? null
          : parseNumber(row.requested_if_modified_since),
      scanKind: row.scan_kind,
      sourceStartedAt: normalizeTimestamp(row.source_started_at) ?? params.sourceStartedAt,
      status: row.status,
    };
  }

  async commitBatch(params: {
    batchHash: string;
    batchIndex: number;
    rejections?: CatalogObservationRejection[];
    rows: CatalogObservationRow[];
    scanId: string;
  }): Promise<CatalogScanBatchResult> {
    const { rows } = await runQuery<JsonResultRow>(
      this.pool,
      'catalogObservation.commitBatch',
      `
        SELECT ops.commit_catalog_scan_batch(
          $1::uuid,
          $2::integer,
          $3::text,
          $4::jsonb,
          $5::jsonb
        ) AS result
      `,
      [
        params.scanId,
        params.batchIndex,
        params.batchHash,
        jsonRows(params.rows),
        jsonRows(params.rejections ?? []),
      ]
    );

    return parseCatalogScanBatchResult(rows[0]?.result);
  }

  async completeScan(params: {
    expectedBatches: number;
    expectedSourceRows: number;
    finalizationBatchSize?: number;
    inputHash: string;
    reconciliationOutcome?: JsonRecord | null;
    scanId: string;
  }): Promise<CatalogScanFinalizationProgress> {
    const { rows } = await runQuery<JsonResultRow>(
      this.pool,
      'catalogObservation.beginFinalization',
      `
        SELECT ops.begin_catalog_scan_finalization(
          $1::uuid,
          $2::integer,
          $3::integer,
          $4::text,
          $5::jsonb
        ) AS result
      `,
      [
        params.scanId,
        params.expectedBatches,
        params.expectedSourceRows,
        params.inputHash,
        params.reconciliationOutcome ?? null,
      ]
    );

    const initial = parseCatalogScanFinalizationProgress(rows[0]?.result);
    if (initial.done) {
      return initial;
    }

    return this.resumeScanFinalization({
      batchSize: params.finalizationBatchSize,
      scanId: params.scanId,
    });
  }

  async resumeScanFinalization(params: {
    batchSize?: number;
    scanId: string;
  }): Promise<CatalogScanFinalizationProgress> {
    const batchSize =
      params.batchSize ?? TigerCatalogObservationRepository.DEFAULT_FINALIZATION_BATCH_SIZE;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
      throw new Error('Catalog finalization batch size must be between 1 and 5000');
    }

    for (let step = 0; step < TigerCatalogObservationRepository.MAX_FINALIZATION_STEPS; step += 1) {
      const { rows } = await runQuery<JsonResultRow>(
        this.pool,
        'catalogObservation.advanceFinalization',
        `
          SELECT ops.advance_catalog_scan_finalization(
            $1::uuid,
            $2::integer
          ) AS result
        `,
        [params.scanId, batchSize]
      );
      const progress = parseCatalogScanFinalizationProgress(rows[0]?.result);
      if (progress.done) {
        return progress;
      }
    }

    throw new Error(`Catalog scan ${params.scanId} exceeded the bounded finalization step limit`);
  }

  async failScan(scanId: string, errorMessage: string): Promise<void> {
    await runQuery(
      this.pool,
      'catalogObservation.failScan',
      'SELECT ops.fail_catalog_scan($1::uuid, $2::text)',
      [scanId, errorMessage]
    );
  }
}

export class TigerMetricsRepository {
  constructor(private readonly pool: TigerWriterPool) {}

  async listPriceSyncAppids(limit: number, staleBeforeIso: string): Promise<number[]> {
    const { rows } = await runQuery<AppIdRow>(
      this.pool,
      'metrics.listPriceSyncAppids',
      `
        SELECT appid
        FROM ops.sync_status
        WHERE COALESCE(is_syncable, true) = true
          AND COALESCE(storefront_accessible, true) = true
          AND (
            last_price_sync IS NULL
            OR last_price_sync < $2::timestamptz
          )
        ORDER BY COALESCE(priority_score, 0) DESC,
                 last_price_sync ASC NULLS FIRST,
                 appid ASC
        LIMIT $1
      `,
      [limit, staleBeforeIso]
    );

    return rows.map((row) => row.appid);
  }

  async batchUpdatePrices(params: {
    appids: number[];
    discounts: number[];
    prices: number[];
  }): Promise<number> {
    if (params.appids.length === 0) {
      return 0;
    }

    const { rows } = await runQuery<CountRow>(
      this.pool,
      'metrics.batchUpdatePrices',
      `
        SELECT ops.batch_update_prices(
          $1::integer[],
          $2::integer[],
          $3::integer[]
        ) AS count
      `,
      [params.appids, params.prices, params.discounts]
    );

    return parseNumber(rows[0]?.count);
  }

  async listCcuSyncCandidates(limit: number): Promise<number[]> {
    const { rows } = await runQuery<AppIdRow>(
      this.pool,
      'metrics.listCcuSyncCandidates',
      `
        SELECT a.appid
        FROM legacy.apps a
        LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
        WHERE a.type = 'game'
          AND COALESCE(a.is_released, false) = true
          AND COALESCE(a.is_delisted, false) = false
        ORDER BY COALESCE(ldm.total_reviews, 0) DESC, a.appid ASC
        LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => row.appid);
  }

  async listCcuTierAssignments(tiers: number[]): Promise<CcuTierAssignment[]> {
    if (tiers.length === 0) {
      return [];
    }

    const { rows } = await runQuery<CcuTierAssignmentRow>(
      this.pool,
      'metrics.listCcuTierAssignments',
      `
        SELECT appid, ccu_tier
        FROM ops.ccu_tier_assignments
        WHERE ccu_tier = ANY($1::integer[])
        ORDER BY ccu_tier ASC, appid ASC
      `,
      [tiers]
    );

    return rows.map((row) => ({
      appid: row.appid,
      ccuTier: parseNumber(row.ccu_tier),
    }));
  }

  async recalculateDemoCcuTiers(params: {
    hotLimit: number;
    newDemoWindowDays: number;
  }): Promise<DemoCcuTierCounts> {
    const { rows } = await runQuery<DemoCcuTierCountsRow>(
      this.pool,
      'metrics.recalculateDemoCcuTiers',
      `
        WITH active_demos AS (
          SELECT
            a.appid,
            a.release_date,
            a.created_at,
            COALESCE(ldm.total_reviews, 0)::integer AS total_reviews
          FROM legacy.apps a
          LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
          WHERE a.type = 'demo'
            AND COALESCE(a.is_released, false) = true
            AND COALESCE(a.is_delisted, false) = false
        ),
        recent_snapshot_ccu AS (
          SELECT cs.appid, max(cs.player_count)::integer AS snapshot_peak_ccu
          FROM metrics.ccu_snapshots cs
          JOIN active_demos ad ON ad.appid = cs.appid
          WHERE cs.snapshot_time >= now() - INTERVAL '7 days'
          GROUP BY cs.appid
        ),
        recent_daily_ccu AS (
          SELECT dm.appid, max(dm.ccu_peak)::integer AS daily_peak_ccu
          FROM metrics.daily_metrics dm
          JOIN active_demos ad ON ad.appid = dm.appid
          WHERE dm.metric_date >= CURRENT_DATE - 7
            AND dm.ccu_source = 'steam_api'
          GROUP BY dm.appid
        ),
        ranked AS (
          SELECT
            ad.appid,
            GREATEST(
              COALESCE(rsc.snapshot_peak_ccu, 0),
              COALESCE(rdc.daily_peak_ccu, 0)
            )::integer AS recent_peak_ccu,
            ad.total_reviews,
            ad.release_date,
            COALESCE(ad.release_date >= CURRENT_DATE - $2::integer, false) AS is_new_demo,
            row_number() OVER (
              ORDER BY
                COALESCE(ad.release_date >= CURRENT_DATE - $2::integer, false) DESC,
                GREATEST(
                  COALESCE(rsc.snapshot_peak_ccu, 0),
                  COALESCE(rdc.daily_peak_ccu, 0)
                ) DESC,
                ad.total_reviews DESC NULLS LAST,
                ad.release_date DESC NULLS LAST,
                ad.appid ASC
            ) AS rank_position
          FROM active_demos ad
          LEFT JOIN recent_snapshot_ccu rsc ON rsc.appid = ad.appid
          LEFT JOIN recent_daily_ccu rdc ON rdc.appid = ad.appid
        ),
        assignments AS (
          SELECT
            appid,
            CASE WHEN rank_position <= $1::integer THEN 1 ELSE 2 END AS demo_ccu_tier,
            CASE
              WHEN rank_position <= $1::integer AND is_new_demo THEN 'new_demo'
              WHEN rank_position <= $1::integer AND recent_peak_ccu > 0 THEN 'top_demo_ccu'
              WHEN rank_position <= $1::integer THEN 'bootstrap_demo'
              ELSE 'demo_tail'
            END AS tier_reason,
            rank_position::integer,
            recent_peak_ccu,
            total_reviews,
            release_date,
            is_new_demo
          FROM ranked
        ),
        upserted AS (
          INSERT INTO ops.demo_ccu_tier_assignments AS existing (
            appid,
            demo_ccu_tier,
            tier_reason,
            rank_position,
            recent_peak_ccu,
            total_reviews,
            release_date,
            is_new_demo,
            last_tier_change,
            updated_at
          )
          SELECT
            appid,
            demo_ccu_tier,
            tier_reason,
            rank_position,
            recent_peak_ccu,
            total_reviews,
            release_date,
            is_new_demo,
            now(),
            now()
          FROM assignments
          ON CONFLICT (appid)
          DO UPDATE SET
            demo_ccu_tier = EXCLUDED.demo_ccu_tier,
            tier_reason = EXCLUDED.tier_reason,
            rank_position = EXCLUDED.rank_position,
            recent_peak_ccu = EXCLUDED.recent_peak_ccu,
            total_reviews = EXCLUDED.total_reviews,
            release_date = EXCLUDED.release_date,
            is_new_demo = EXCLUDED.is_new_demo,
            last_tier_change = CASE
              WHEN existing.demo_ccu_tier IS DISTINCT FROM EXCLUDED.demo_ccu_tier THEN now()
              ELSE existing.last_tier_change
            END,
            updated_at = now()
          RETURNING appid
        ),
        upserted_count AS (
          SELECT count(*)::integer AS count FROM upserted
        )
        SELECT
          count(*) FILTER (WHERE demo_ccu_tier = 1)::integer AS tier1_count,
          count(*) FILTER (WHERE demo_ccu_tier = 2)::integer AS tier2_count
        FROM assignments, upserted_count
      `,
      [params.hotLimit, params.newDemoWindowDays]
    );

    return {
      tier1Count: parseNumber(rows[0]?.tier1_count),
      tier2Count: parseNumber(rows[0]?.tier2_count),
    };
  }

  async listDemoCcuTierAppids(params: {
    limit: number;
    nowIso: string;
    tier: number;
  }): Promise<DemoCcuTierCandidateResult> {
    if (params.limit <= 0) {
      return { appids: [], skippedCount: 0 };
    }

    const orderBy =
      params.tier === 1
        ? 'dcta.rank_position ASC NULLS LAST, dcta.appid ASC'
        : 'dcta.last_ccu_synced ASC NULLS FIRST, dcta.rank_position ASC NULLS LAST, dcta.appid ASC';

    const [{ rows: skippedRows }, { rows }] = await Promise.all([
      runQuery<CountRow>(
        this.pool,
        'metrics.countSkippedDemoCcuTierAppids',
        `
          SELECT count(*)::integer AS count
          FROM ops.demo_ccu_tier_assignments dcta
          JOIN legacy.apps a ON a.appid = dcta.appid
          WHERE dcta.demo_ccu_tier = $1::integer
            AND a.type = 'demo'
            AND COALESCE(a.is_released, false) = true
            AND COALESCE(a.is_delisted, false) = false
            AND dcta.ccu_skip_until > $2::timestamptz
        `,
        [params.tier, params.nowIso]
      ),
      runQuery<AppIdRow>(
        this.pool,
        'metrics.listDemoCcuTierAppids',
        `
          SELECT dcta.appid
          FROM ops.demo_ccu_tier_assignments dcta
          JOIN legacy.apps a ON a.appid = dcta.appid
          WHERE dcta.demo_ccu_tier = $2::integer
            AND a.type = 'demo'
            AND COALESCE(a.is_released, false) = true
            AND COALESCE(a.is_delisted, false) = false
            AND (
              dcta.ccu_skip_until IS NULL
              OR dcta.ccu_skip_until < $3::timestamptz
            )
          ORDER BY ${orderBy}
          LIMIT $1
        `,
        [params.limit, params.tier, params.nowIso]
      ),
    ]);

    return {
      appids: rows.map((row) => row.appid),
      skippedCount: parseNumber(skippedRows[0]?.count),
    };
  }

  async listAdaptiveDemoCcuCandidates(params: {
    limit: number;
    newDemoWindowDays: number;
    newPositiveRefreshMinutes: number;
    newZeroRefreshHours: number;
    nowIso: string;
    positiveRefreshMinutes: number;
    zeroRefreshDays: number;
  }): Promise<DemoCcuAdaptiveCandidateResult> {
    const emptyBreakdown: DemoCcuAdaptiveCandidateBreakdown = {
      p0_new_positive: 0,
      p0_positive: 0,
      p1_new_never_synced: 0,
      p1_new_zero: 0,
      p2_never_synced: 0,
      p3_zero_refresh: 0,
    };

    if (params.limit <= 0) {
      return {
        breakdown: emptyBreakdown,
        candidates: [],
        skippedCount: 0,
      };
    }

    const eligibleCte = `
      WITH active_demos AS (
        SELECT
          dcta.appid,
          dcta.ccu_fetch_status,
          dcta.ccu_skip_until,
          dcta.demo_ccu_tier,
          dcta.last_ccu_synced,
          dcta.last_ccu_validation_state,
          dcta.rank_position,
          dcta.recent_peak_ccu,
          dcta.total_reviews,
          a.created_at,
          a.release_date,
          COALESCE(a.release_date >= (($1::timestamptz AT TIME ZONE 'UTC')::date - $2::integer), false) AS is_recent_release
        FROM ops.demo_ccu_tier_assignments dcta
        JOIN legacy.apps a ON a.appid = dcta.appid
        WHERE a.type = 'demo'
          AND COALESCE(a.is_released, false) = true
          AND COALESCE(a.is_delisted, false) = false
      ),
      classified AS (
        SELECT
          *,
          CASE
            WHEN ccu_skip_until > $1::timestamptz THEN NULL
            WHEN last_ccu_validation_state = 'invalid' THEN NULL
            WHEN (last_ccu_validation_state = 'confirmed_positive' OR COALESCE(recent_peak_ccu, 0) > 0)
              AND is_recent_release
              AND (
                last_ccu_synced IS NULL
                OR last_ccu_synced <= $1::timestamptz - ($3::integer * INTERVAL '1 minute')
              )
            THEN 'p0_new_positive'
            WHEN (last_ccu_validation_state = 'confirmed_positive' OR COALESCE(recent_peak_ccu, 0) > 0)
              AND (
                last_ccu_synced IS NULL
                OR last_ccu_synced <= $1::timestamptz - ($4::integer * INTERVAL '1 minute')
              )
            THEN 'p0_positive'
            WHEN is_recent_release
              AND last_ccu_synced IS NULL
            THEN 'p1_new_never_synced'
            WHEN is_recent_release
              AND last_ccu_validation_state = 'confirmed_zero'
              AND last_ccu_synced <= $1::timestamptz - ($5::integer * INTERVAL '1 hour')
            THEN 'p1_new_zero'
            WHEN last_ccu_synced IS NULL
            THEN 'p2_never_synced'
            WHEN last_ccu_validation_state = 'confirmed_zero'
              AND last_ccu_synced <= $1::timestamptz - ($6::integer * INTERVAL '1 day')
            THEN 'p3_zero_refresh'
            ELSE NULL
          END AS bucket
        FROM active_demos
      ),
      eligible AS (
        SELECT *
        FROM classified
        WHERE bucket IS NOT NULL
      )
    `;

    const eligibilityValues = [
      params.nowIso,
      params.newDemoWindowDays,
      params.newPositiveRefreshMinutes,
      params.positiveRefreshMinutes,
      params.newZeroRefreshHours,
      params.zeroRefreshDays,
    ];

    const [{ rows: skippedRows }, { rows: breakdownRows }, { rows: candidateRows }] =
      await Promise.all([
        runQuery<CountRow>(
          this.pool,
          'metrics.countSkippedAdaptiveDemoCcuCandidates',
          `
            SELECT count(*)::integer AS count
            FROM ops.demo_ccu_tier_assignments dcta
            JOIN legacy.apps a ON a.appid = dcta.appid
            WHERE a.type = 'demo'
              AND COALESCE(a.is_released, false) = true
              AND COALESCE(a.is_delisted, false) = false
              AND dcta.ccu_skip_until > $1::timestamptz
          `,
          [params.nowIso]
        ),
        runQuery<DemoCcuAdaptiveBreakdownRow>(
          this.pool,
          'metrics.countAdaptiveDemoCcuCandidatesByBucket',
          `
            ${eligibleCte}
            SELECT bucket, count(*)::integer AS count
            FROM eligible
            GROUP BY bucket
            ORDER BY bucket ASC
          `,
          eligibilityValues
        ),
        runQuery<DemoCcuAdaptiveCandidateRow>(
          this.pool,
          'metrics.listAdaptiveDemoCcuCandidates',
          `
            ${eligibleCte}
            SELECT appid, demo_ccu_tier, bucket
            FROM eligible
            ORDER BY
              CASE bucket
                WHEN 'p0_new_positive' THEN 0
                WHEN 'p0_positive' THEN 1
                WHEN 'p1_new_never_synced' THEN 2
                WHEN 'p1_new_zero' THEN 3
                WHEN 'p2_never_synced' THEN 4
                WHEN 'p3_zero_refresh' THEN 5
                ELSE 99
              END ASC,
              COALESCE(recent_peak_ccu, 0) DESC,
              total_reviews DESC NULLS LAST,
              release_date DESC NULLS LAST,
              created_at DESC NULLS LAST,
              rank_position ASC NULLS LAST,
              appid ASC
            LIMIT $7::integer
          `,
          [...eligibilityValues, params.limit]
        ),
      ]);

    const breakdown = { ...emptyBreakdown };
    for (const row of breakdownRows) {
      breakdown[row.bucket] = parseNumber(row.count);
    }

    return {
      breakdown,
      candidates: candidateRows.map((row) => ({
        appid: row.appid,
        bucket: row.bucket,
        demoCcuTier: parseNumber(row.demo_ccu_tier),
      })),
      skippedCount: parseNumber(skippedRows[0]?.count),
    };
  }

  async isCcuTierAssignmentsStale(staleCutoffIso: string): Promise<boolean> {
    const { rows } = await runQuery<TierAssignmentFreshnessRow>(
      this.pool,
      'metrics.isCcuTierAssignmentsStale',
      'SELECT max(updated_at) AS updated_at FROM ops.ccu_tier_assignments'
    );
    const updatedAt = normalizeTimestamp(rows[0]?.updated_at);
    return !updatedAt || updatedAt < staleCutoffIso;
  }

  async listTier3CcuAppids(params: {
    limit: number;
    nowIso: string;
    partitionCount?: number;
    partitionId?: number;
  }): Promise<Tier3CcuCandidateResult> {
    const partitionCount = Math.max(1, params.partitionCount ?? 1);
    const partitionId = Math.max(0, params.partitionId ?? 0);
    const [{ rows: skippedRows }, { rows }] = await Promise.all([
      runQuery<CountRow>(
        this.pool,
        'metrics.countSkippedTier3CcuAppids',
        `
          SELECT count(*)::integer AS count
          FROM ops.ccu_tier_assignments
          WHERE ccu_tier = 3
            AND ccu_skip_until > $1::timestamptz
        `,
        [params.nowIso]
      ),
      runQuery<AppIdRow>(
        this.pool,
        'metrics.listTier3CcuAppids',
        `
          WITH ranked AS (
            SELECT
              appid,
              row_number() OVER (
                ORDER BY last_ccu_synced ASC NULLS FIRST, appid ASC
              ) - 1 AS row_index
            FROM ops.ccu_tier_assignments
            WHERE ccu_tier = 3
              AND (
                ccu_skip_until IS NULL
                OR ccu_skip_until < $2::timestamptz
              )
          )
          SELECT appid
          FROM ranked
          WHERE $3::integer <= 1 OR mod(row_index, $3::integer) = $4::integer
          ORDER BY row_index ASC
          LIMIT $1
        `,
        [params.limit, params.nowIso, partitionCount, partitionId]
      ),
    ]);

    return {
      appids: rows.map((row) => row.appid),
      skippedCount: parseNumber(skippedRows[0]?.count),
    };
  }

  async listFallbackTier3CcuAppids(params: {
    limit: number;
    partitionCount?: number;
    partitionId?: number;
  }): Promise<number[]> {
    const partitionCount = Math.max(1, params.partitionCount ?? 1);
    const partitionId = Math.max(0, params.partitionId ?? 0);
    const { rows } = await runQuery<AppIdRow>(
      this.pool,
      'metrics.listFallbackTier3CcuAppids',
      `
        WITH ranked AS (
          SELECT
            a.appid,
            row_number() OVER (ORDER BY a.appid ASC) - 1 AS row_index
          FROM legacy.apps a
          WHERE a.type = 'game'
            AND COALESCE(a.is_released, false) = true
            AND COALESCE(a.is_delisted, false) = false
            AND NOT EXISTS (
              SELECT 1
              FROM ops.ccu_tier_assignments cta
              WHERE cta.appid = a.appid
                AND cta.ccu_tier = ANY(ARRAY[1, 2])
            )
        )
        SELECT appid
        FROM ranked
        WHERE $2::integer <= 1 OR mod(row_index, $2::integer) = $3::integer
        ORDER BY row_index ASC
        LIMIT $1
      `,
      [params.limit, partitionCount, partitionId]
    );

    return rows.map((row) => row.appid);
  }

  async listSuspiciousZeroAppids(appids: number[]): Promise<Set<number>> {
    if (appids.length === 0) {
      return new Set<number>();
    }

    const { rows } = await runQuery<SuspiciousZeroRow>(
      this.pool,
      'metrics.listSuspiciousZeroAppids',
      'SELECT ops.get_suspicious_zero_appids($1::integer[]) AS appids',
      [appids]
    );

    return new Set(rows[0]?.appids ?? []);
  }

  async upsertDailyMetrics(rows: DailyMetricUpsert[]): Promise<number> {
    const count = await this.upsertMetricsTable(
      'daily_metrics',
      rows as unknown as JsonRecord[],
      'appid, metric_date'
    );
    if (rows.length > 0) {
      await this.upsertLatestDailyMetrics(rows);
    }
    return count;
  }

  async upsertDailyCcuPeaks(rows: DailyCcuPeakUpsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const client = await this.pool.connect();
    try {
      await runQuery(client, 'metrics.upsertDailyCcuPeaks.begin', 'BEGIN');
      const result = await runQuery(
        client,
        'metrics.upsertDailyCcuPeaks.dailyMetrics',
        `
          INSERT INTO metrics.daily_metrics (
            appid, metric_date, ccu_peak, ccu_source
          )
          SELECT appid, metric_date, ccu_peak, ccu_source
          FROM jsonb_populate_recordset(NULL::metrics.daily_metrics, $1::jsonb) AS rows
          ON CONFLICT (appid, metric_date)
          DO UPDATE SET
            ccu_peak = GREATEST(
              COALESCE(metrics.daily_metrics.ccu_peak, 0),
              EXCLUDED.ccu_peak
            ),
            ccu_source = CASE
              WHEN EXCLUDED.ccu_peak >= COALESCE(metrics.daily_metrics.ccu_peak, 0)
              THEN EXCLUDED.ccu_source
              ELSE metrics.daily_metrics.ccu_source
            END
        `,
        [jsonRows(rows)]
      );

      await runQuery(
        client,
        'metrics.upsertDailyCcuPeaks.latestDailyMetrics',
        `
          INSERT INTO legacy.latest_daily_metrics (
            appid, metric_date, ccu_peak, ccu_source
          )
          SELECT appid, metric_date, ccu_peak, ccu_source
          FROM jsonb_populate_recordset(NULL::legacy.latest_daily_metrics, $1::jsonb) AS rows
          ON CONFLICT (appid)
          DO UPDATE SET
            metric_date = GREATEST(
              COALESCE(legacy.latest_daily_metrics.metric_date, EXCLUDED.metric_date),
              EXCLUDED.metric_date
            ),
            ccu_peak = GREATEST(
              COALESCE(legacy.latest_daily_metrics.ccu_peak, 0),
              EXCLUDED.ccu_peak
            ),
            ccu_source = CASE
              WHEN EXCLUDED.ccu_peak >= COALESCE(legacy.latest_daily_metrics.ccu_peak, 0)
              THEN EXCLUDED.ccu_source
              ELSE legacy.latest_daily_metrics.ccu_source
            END
        `,
        [jsonRows(rows)]
      );

      await runQuery(client, 'metrics.upsertDailyCcuPeaks.commit', 'COMMIT');
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async upsertLatestDailyMetrics(rows: DailyMetricUpsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const latestRows = rows.map((row) => ({
      ...row,
      owners_midpoint:
        row.owners_min !== undefined &&
        row.owners_max !== undefined &&
        row.owners_min !== null &&
        row.owners_max !== null
          ? Math.round((row.owners_min + row.owners_max) / 2)
          : undefined,
    }));

    const columns = formatColumns(latestRows as unknown as JsonRecord[], ['appid']);
    const result = await runQuery(
      this.pool,
      'metrics.upsertLatestDailyMetrics',
      buildUpsertSql({
        columns,
        conflict: 'appid',
        schema: 'legacy',
        table: 'latest_daily_metrics',
      }),
      [jsonRows(latestRows)]
    );

    return result.rowCount ?? 0;
  }

  async insertCcuSnapshots(rows: CcuSnapshotInsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const columns = formatColumns(rows as unknown as JsonRecord[], [
      'appid',
      'player_count',
      'ccu_tier',
    ]);
    const result = await runQuery(
      this.pool,
      'metrics.insertCcuSnapshots',
      `
        INSERT INTO metrics.ccu_snapshots (${columns.join(', ')})
        SELECT ${columns.join(', ')}
        FROM jsonb_populate_recordset(NULL::metrics.ccu_snapshots, $1::jsonb) AS rows
        ON CONFLICT (appid, snapshot_time) DO NOTHING
      `,
      [jsonRows(rows)]
    );

    return result.rowCount ?? 0;
  }

  async upsertCcuTierAssignments(rows: CcuTierAssignmentUpsert[]): Promise<number> {
    return this.upsertOpsTable('ccu_tier_assignments', rows as unknown as JsonRecord[], 'appid');
  }

  async updateCcuTierAssignments(appids: number[], values: JsonRecord): Promise<number> {
    if (appids.length === 0) {
      return 0;
    }

    const allowed = new Set([
      'ccu_fetch_status',
      'ccu_skip_until',
      'ccu_tier',
      'last_ccu_synced',
      'last_ccu_validation_at',
      'last_ccu_validation_state',
      'last_tier_change',
      'recent_peak_ccu',
      'release_rank',
      'tier_reason',
      'updated_at',
    ]);
    const entries = allowedEntries(values, allowed);
    if (entries.length === 0) {
      return 0;
    }

    const setClauses = entries.map(([column], index) => `${column} = $${index + 2}`);
    setClauses.push('updated_at = now()');
    const result = await runQuery(
      this.pool,
      'metrics.updateCcuTierAssignments',
      `UPDATE ops.ccu_tier_assignments SET ${setClauses.join(', ')} WHERE appid = ANY($1::integer[])`,
      [appids, ...entries.map(([, value]) => value)]
    );

    return result.rowCount ?? 0;
  }

  async updateDemoCcuTierAssignments(appids: number[], values: JsonRecord): Promise<number> {
    if (appids.length === 0) {
      return 0;
    }

    const allowed = new Set([
      'ccu_fetch_status',
      'ccu_skip_until',
      'demo_ccu_tier',
      'is_new_demo',
      'last_ccu_synced',
      'last_ccu_validation_at',
      'last_ccu_validation_state',
      'last_tier_change',
      'rank_position',
      'recent_peak_ccu',
      'release_date',
      'tier_reason',
      'total_reviews',
      'updated_at',
    ]);
    const entries = allowedEntries(values, allowed);
    if (entries.length === 0) {
      return 0;
    }

    const setClauses = entries.map(([column], index) => `${column} = $${index + 2}`);
    setClauses.push('updated_at = now()');
    const result = await runQuery(
      this.pool,
      'metrics.updateDemoCcuTierAssignments',
      `UPDATE ops.demo_ccu_tier_assignments SET ${setClauses.join(', ')} WHERE appid = ANY($1::integer[])`,
      [appids, ...entries.map(([, value]) => value)]
    );

    return result.rowCount ?? 0;
  }

  async upsertReviewDeltas(rows: ReviewDeltaUpsert[]): Promise<number> {
    return this.upsertMetricsTable(
      'review_deltas',
      rows as unknown as JsonRecord[],
      'appid, delta_date'
    );
  }

  async upsertReviewHistogram(rows: ReviewHistogramUpsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const result = await runQuery(
      this.pool,
      'metrics.upsert.review_histogram',
      `
        INSERT INTO metrics.review_histogram (
          appid,
          month_start,
          recommendations_up,
          recommendations_down,
          fetched_at
        )
        SELECT
          appid,
          month_start,
          recommendations_up,
          recommendations_down,
          COALESCE(fetched_at, now()) AS fetched_at
        FROM jsonb_populate_recordset(NULL::metrics.review_histogram, $1::jsonb) AS rows
        ON CONFLICT (appid, month_start)
        DO UPDATE SET
          recommendations_up = EXCLUDED.recommendations_up,
          recommendations_down = EXCLUDED.recommendations_down,
          fetched_at = EXCLUDED.fetched_at
      `,
      [jsonRows(rows)]
    );

    return result.rowCount ?? 0;
  }

  async upsertAppTrends(rows: AppTrendUpsert[]): Promise<number> {
    return this.upsertMetricsTable('app_trends', rows as unknown as JsonRecord[], 'appid');
  }

  async listReviewHistogramAppidPage(
    lastAppid: number,
    limit: number
  ): Promise<ReviewHistogramAppidPage> {
    const { rows } = await runQuery<HistogramAppidRow>(
      this.pool,
      'metrics.listReviewHistogramAppidPage',
      `
        SELECT appid
        FROM metrics.review_histogram
        WHERE appid > $1
        ORDER BY appid ASC
        LIMIT $2
      `,
      [lastAppid, limit]
    );

    const appids: number[] = [];
    let previousAppid = lastAppid;
    for (const row of rows) {
      if (row.appid !== previousAppid) {
        appids.push(row.appid);
        previousAppid = row.appid;
      }
    }

    return {
      appids,
      hasMore: rows.length === limit,
      nextCursor: rows.at(-1)?.appid ?? lastAppid,
      rowsFetched: rows.length,
    };
  }

  async listReviewHistogramEntries(appids: number[]): Promise<ReviewHistogramEntry[]> {
    if (appids.length === 0) {
      return [];
    }

    const { rows } = await runQuery<ReviewHistogramEntryRow>(
      this.pool,
      'metrics.listReviewHistogramEntries',
      `
        SELECT appid, month_start, recommendations_up, recommendations_down
        FROM metrics.review_histogram
        WHERE appid = ANY($1::integer[])
        ORDER BY appid ASC, month_start DESC
      `,
      [appids]
    );

    return rows.map((row) => ({
      appid: row.appid,
      month_start: normalizeDate(row.month_start) ?? '',
      recommendations_down: parseNumber(row.recommendations_down),
      recommendations_up: parseNumber(row.recommendations_up),
    }));
  }

  async countReviewDeltas(params: { interpolated: boolean; startDate: string }): Promise<number> {
    const { rows } = await runQuery<CountRow>(
      this.pool,
      'metrics.countReviewDeltas',
      `
        SELECT count(*)::integer AS count
        FROM metrics.review_deltas
        WHERE delta_date >= $1::date
          AND is_interpolated = $2
      `,
      [params.startDate, params.interpolated]
    );

    return parseNumber(rows[0]?.count);
  }

  async countPriorityInputs(): Promise<number> {
    const { rows } = await runQuery<CountRow>(
      this.pool,
      'metrics.countPriorityInputs',
      'SELECT count(*)::integer AS count FROM ops.sync_status'
    );

    return parseNumber(rows[0]?.count);
  }

  async listPriorityInputs(offset: number, limit: number): Promise<PriorityInput[]> {
    const { rows } = await runQuery<PriorityInputRow>(
      this.pool,
      'metrics.listPriorityInputs',
      `
        WITH status_page AS (
          SELECT
            appid,
            last_reviews_sync,
            last_steamspy_sync
          FROM ops.sync_status
          ORDER BY appid ASC
          OFFSET $1
          LIMIT $2
        ),
        latest_metrics AS (
          SELECT DISTINCT ON (appid)
            appid,
            ccu_peak,
            total_reviews
          FROM metrics.daily_metrics
          WHERE appid IN (SELECT appid FROM status_page)
          ORDER BY appid, metric_date DESC
        )
        SELECT
          s.appid,
          s.last_reviews_sync,
          s.last_steamspy_sync,
          lm.ccu_peak,
          COALESCE(lm.total_reviews, ldm.total_reviews) AS total_reviews,
          t.review_velocity_7d,
          t.review_velocity_30d,
          t.trend_30d_change_pct,
          a.is_released,
          a.release_date
        FROM status_page s
        LEFT JOIN latest_metrics lm ON lm.appid = s.appid
        LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = s.appid
        LEFT JOIN metrics.app_trends t ON t.appid = s.appid
        LEFT JOIN legacy.apps a ON a.appid = s.appid
        ORDER BY s.appid ASC
      `,
      [offset, limit]
    );

    return rows.map((row) => ({
      appid: row.appid,
      ccu_peak: row.ccu_peak === null ? null : parseNumber(row.ccu_peak),
      is_released: Boolean(row.is_released),
      last_reviews_sync: normalizeTimestamp(row.last_reviews_sync),
      last_steamspy_sync: normalizeTimestamp(row.last_steamspy_sync),
      release_date: normalizeDate(row.release_date),
      review_velocity_30d:
        row.review_velocity_30d === null ? null : parseNumber(row.review_velocity_30d),
      review_velocity_7d:
        row.review_velocity_7d === null ? null : parseNumber(row.review_velocity_7d),
      total_reviews: row.total_reviews === null ? null : parseNumber(row.total_reviews),
      trend_30d_change_pct:
        row.trend_30d_change_pct === null ? null : parseNumber(row.trend_30d_change_pct),
    }));
  }

  async listPriorityInputsAfter(afterAppid: number, limit: number): Promise<PriorityInput[]> {
    const { rows } = await runQuery<PriorityInputRow>(
      this.pool,
      'metrics.listPriorityInputsAfter',
      `
        WITH status_page AS (
          SELECT
            appid,
            last_reviews_sync,
            last_steamspy_sync
          FROM ops.sync_status
          WHERE appid > $1
          ORDER BY appid ASC
          LIMIT $2
        )
        SELECT
          s.appid,
          s.last_reviews_sync,
          s.last_steamspy_sync,
          ldm.ccu_peak,
          ldm.total_reviews,
          t.review_velocity_7d,
          t.review_velocity_30d,
          t.trend_30d_change_pct,
          a.is_released,
          a.release_date
        FROM status_page s
        LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = s.appid
        LEFT JOIN metrics.app_trends t ON t.appid = s.appid
        LEFT JOIN legacy.apps a ON a.appid = s.appid
        ORDER BY s.appid ASC
      `,
      [afterAppid, limit]
    );

    return rows.map((row) => ({
      appid: row.appid,
      ccu_peak: row.ccu_peak === null ? null : parseNumber(row.ccu_peak),
      is_released: Boolean(row.is_released),
      last_reviews_sync: normalizeTimestamp(row.last_reviews_sync),
      last_steamspy_sync: normalizeTimestamp(row.last_steamspy_sync),
      release_date: normalizeDate(row.release_date),
      review_velocity_30d:
        row.review_velocity_30d === null ? null : parseNumber(row.review_velocity_30d),
      review_velocity_7d:
        row.review_velocity_7d === null ? null : parseNumber(row.review_velocity_7d),
      total_reviews: row.total_reviews === null ? null : parseNumber(row.total_reviews),
      trend_30d_change_pct:
        row.trend_30d_change_pct === null ? null : parseNumber(row.trend_30d_change_pct),
    }));
  }

  private async upsertMetricsTable(
    table: string,
    rows: JsonRecord[],
    conflict: string
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const columns = formatColumns(rows);
    const result = await runQuery(
      this.pool,
      `metrics.upsert.${table}`,
      buildUpsertSql({ columns, conflict, schema: 'metrics', table }),
      [jsonRows(rows)]
    );

    return result.rowCount ?? 0;
  }

  private async upsertOpsTable(
    table: string,
    rows: JsonRecord[],
    conflict: string
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const columns = formatColumns(rows, ['appid']);
    const result = await runQuery(
      this.pool,
      `metrics.upsertOps.${table}`,
      buildUpsertSql({ columns, conflict, schema: 'ops', table }),
      [jsonRows(rows)]
    );

    return result.rowCount ?? 0;
  }
}

export class TigerReviewsRepository {
  constructor(
    private readonly pool: TigerWriterPool,
    private readonly metrics: TigerMetricsRepository,
    private readonly syncStatus: TigerSyncStatusRepository
  ) {}

  async promoteReviewsSyncBatch(promotions: ReviewPromotion[]): Promise<number> {
    if (promotions.length === 0) {
      return 0;
    }

    const { rows } = await runQuery<CountRow>(
      this.pool,
      'reviews.promoteReviewsSyncBatch',
      `
        SELECT count(*)::integer AS count
        FROM jsonb_to_recordset($1::jsonb) AS rows (
          appid integer,
          bucket text,
          score integer,
          reason text,
          until_at timestamptz
        )
        CROSS JOIN LATERAL ops.promote_reviews_sync(
          rows.appid,
          rows.bucket,
          rows.score,
          rows.reason,
          rows.until_at
        )
      `,
      [
        jsonRows(
          promotions.map((promotion) => ({
            appid: promotion.appid,
            bucket: promotion.bucket,
            reason: promotion.reason,
            score: promotion.score,
            until_at: promotion.until,
          }))
        ),
      ]
    );

    return parseNumber(rows[0]?.count);
  }

  async loadPreviousSyncData(appIds: number[]): Promise<{
    neverSyncedSet: Set<number>;
    previousSyncData: Map<number, PreviousReviewSyncData>;
  }> {
    if (appIds.length === 0) {
      return {
        neverSyncedSet: new Set<number>(),
        previousSyncData: new Map<number, PreviousReviewSyncData>(),
      };
    }

    const { rows } = await runQuery<PreviousReviewSyncRow>(
      this.pool,
      'reviews.loadPreviousSyncData',
      `
        SELECT DISTINCT ON (s.appid)
          s.appid,
          s.last_reviews_sync,
          s.last_activity_at,
          s.last_known_total_reviews,
          s.consecutive_errors,
          s.reviews_interval_hours,
          EXISTS (
            SELECT 1
            FROM legacy.user_pins pin
            WHERE pin.entity_type = 'game'
              AND pin.entity_id = s.appid
          ) AS is_pinned,
          COALESCE(m.total_reviews, rd.total_reviews) AS total_reviews,
          COALESCE(m.positive_reviews, rd.positive_reviews) AS positive_reviews
        FROM ops.sync_status s
        LEFT JOIN LATERAL (
          SELECT m.total_reviews, m.positive_reviews
          FROM metrics.daily_metrics m
          WHERE m.appid = s.appid
            AND (
              m.total_reviews IS NOT NULL
              OR m.positive_reviews IS NOT NULL
            )
          ORDER BY m.metric_date DESC
          LIMIT 1
        ) m ON true
        LEFT JOIN LATERAL (
          SELECT rd.total_reviews, rd.positive_reviews
          FROM metrics.review_deltas rd
          WHERE rd.appid = s.appid
            AND rd.is_interpolated = false
          ORDER BY rd.delta_date DESC
          LIMIT 1
        ) rd ON true
        WHERE s.appid = ANY($1::integer[])
        ORDER BY s.appid
      `,
      [appIds]
    );

    const previousSyncData = new Map<number, PreviousReviewSyncData>();
    const neverSyncedSet = new Set<number>();

    for (const row of rows) {
      const lastSync = normalizeTimestamp(row.last_reviews_sync);
      if (!lastSync) {
        neverSyncedSet.add(row.appid);
      }

      previousSyncData.set(row.appid, {
        consecutiveErrors: parseNumber(row.consecutive_errors),
        intervalHours: normalizeIntervalHours(parseNumber(row.reviews_interval_hours)),
        isPinned: parseBoolean(row.is_pinned),
        lastActivityAt: normalizeTimestamp(row.last_activity_at)
          ? new Date(normalizeTimestamp(row.last_activity_at)!)
          : null,
        lastSync: lastSync ? new Date(lastSync) : null,
        positiveReviews: parseNumber(row.positive_reviews),
        totalReviews: parseNumber(row.total_reviews ?? row.last_known_total_reviews),
      });
    }

    return { neverSyncedSet, previousSyncData };
  }

  async persistReviewSummary(params: PersistReviewSummaryParams): Promise<{
    negativeAdded: number;
    nextSyncAt: string;
    nowIso: string;
    positiveAdded: number;
    reviewsAdded: number;
  }> {
    const previousTotal = params.previous?.totalReviews ?? 0;
    const previousPositive = params.previous?.positiveReviews ?? 0;
    const lastSyncTime = params.previous?.lastSync;
    const reviewsAdded = Math.max(0, params.summary.totalReviews - previousTotal);
    const positiveAdded = Math.max(0, params.summary.positiveReviews - previousPositive);
    const negativeAdded = Math.max(0, reviewsAdded - positiveAdded);
    const hoursSinceLastSync = lastSyncTime
      ? (Date.now() - lastSyncTime.getTime()) / (1000 * 60 * 60)
      : null;
    const intervalHours = getReviewCadenceHours({
      lane: params.lane,
      previous: params.previous,
      priorityScore: params.priorityScore,
      summaryTotalReviews: params.summary.totalReviews,
      velocityTier: params.velocityTier,
    });
    const nextSyncAt = new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    await this.metrics.upsertReviewDeltas([
      {
        appid: params.appid,
        delta_date: params.today,
        hours_since_last_sync: hoursSinceLastSync,
        is_interpolated: false,
        negative_added: negativeAdded,
        positive_added: positiveAdded,
        positive_reviews: params.summary.positiveReviews,
        review_score: params.summary.reviewScore,
        review_score_desc: params.summary.reviewScoreDesc,
        reviews_added: reviewsAdded,
        total_reviews: params.summary.totalReviews,
      },
    ]);

    await this.metrics.upsertDailyMetrics([
      {
        appid: params.appid,
        metric_date: params.today,
        negative_reviews: params.summary.negativeReviews,
        positive_reviews: params.summary.positiveReviews,
        review_score: params.summary.reviewScore,
        review_score_desc: params.summary.reviewScoreDesc,
        total_reviews: params.summary.totalReviews,
      },
    ]);

    await this.syncStatus.updateFields(params.appid, {
      consecutive_errors: 0,
      last_error_at: null,
      last_error_message: null,
      last_error_source: null,
      last_known_total_reviews: params.summary.totalReviews,
      last_reviews_sync: nowIso,
      next_reviews_sync: nextSyncAt,
      reviews_interval_hours: intervalHours,
      reviews_claimed_at: null,
      reviews_claim_expires_at: null,
      reviews_claimed_by: null,
      reviews_priority_override_bucket: null,
      reviews_priority_override_reason: null,
      reviews_priority_override_score: null,
      reviews_priority_override_until: null,
      ...(reviewsAdded > 0 ? { last_activity_at: nowIso } : {}),
    });

    return { negativeAdded, nextSyncAt, nowIso, positiveAdded, reviewsAdded };
  }

  async persistReviewSummaryBatch(params: PersistReviewSummaryBatchParams): Promise<PersistReviewSummaryResult[]> {
    if (params.items.length === 0) {
      return [];
    }

    const nowIso = params.persistedAt ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    if (Number.isNaN(nowMs)) {
      throw new Error('persistedAt must be a valid timestamp');
    }

    const results: Array<PersistReviewSummaryResult & { hoursSinceLastSync: number | null }> = params.items.map(
      (item) => {
        const previousTotal = item.previous?.totalReviews ?? 0;
        const previousPositive = item.previous?.positiveReviews ?? 0;
        const reviewsAdded = Math.max(0, item.summary.totalReviews - previousTotal);
        const positiveAdded = Math.max(0, item.summary.positiveReviews - previousPositive);
        const negativeAdded = Math.max(0, reviewsAdded - positiveAdded);
        const hoursSinceLastSync = item.previous?.lastSync
          ? (nowMs - item.previous.lastSync.getTime()) / (1000 * 60 * 60)
          : null;
        const intervalHours = getReviewCadenceHours({
          lane: item.lane,
          nowMs,
          previous: item.previous,
          priorityScore: item.priorityScore,
          summaryTotalReviews: item.summary.totalReviews,
          velocityTier: item.velocityTier
        });
        const nextSyncAt = new Date(nowMs + intervalHours * 60 * 60 * 1000).toISOString();

        return {
          appid: item.appid,
          hoursSinceLastSync,
          intervalHours,
          negativeAdded,
          nextSyncAt,
          nowIso,
          positiveAdded,
          reviewsAdded
        };
      }
    );
    const resultByAppid = new Map(results.map((result) => [result.appid, result]));
    const itemByAppid = new Map(params.items.map((item) => [item.appid, item]));

    const deltaRows = results.map((result) => {
      const item = itemByAppid.get(result.appid)!;
      return {
        appid: item.appid,
        delta_date: item.today,
        hours_since_last_sync: result.hoursSinceLastSync,
        is_interpolated: false,
        negative_added: result.negativeAdded,
        positive_added: result.positiveAdded,
        positive_reviews: item.summary.positiveReviews,
        review_score: item.summary.reviewScore,
        review_score_desc: item.summary.reviewScoreDesc,
        reviews_added: result.reviewsAdded,
        total_reviews: item.summary.totalReviews
      };
    });
    const metricRows = params.items.map((item) => ({
      appid: item.appid,
      metric_date: item.today,
      negative_reviews: item.summary.negativeReviews,
      positive_reviews: item.summary.positiveReviews,
      review_score: item.summary.reviewScore,
      review_score_desc: item.summary.reviewScoreDesc,
      total_reviews: item.summary.totalReviews
    }));
    const statusRows = params.items.map((item) => {
      const result = resultByAppid.get(item.appid)!;
      return {
        appid: item.appid,
        last_activity_at: result.reviewsAdded > 0 ? nowIso : null,
        last_known_total_reviews: item.summary.totalReviews,
        last_reviews_sync: nowIso,
        next_reviews_sync: result.nextSyncAt,
        reviews_interval_hours: result.intervalHours
      };
    });

    const client = await this.pool.connect();
    try {
      await runQuery(client, 'reviews.persistReviewSummaryBatch.begin', 'BEGIN');
      await runQuery(
        client,
        'reviews.persistReviewSummaryBatch.reviewDeltas',
        `
          INSERT INTO metrics.review_deltas (
            appid,
            delta_date,
            hours_since_last_sync,
            is_interpolated,
            negative_added,
            positive_added,
            positive_reviews,
            review_score,
            review_score_desc,
            reviews_added,
            total_reviews
          )
          SELECT
            appid,
            delta_date,
            hours_since_last_sync,
            is_interpolated,
            negative_added,
            positive_added,
            positive_reviews,
            review_score,
            review_score_desc,
            reviews_added,
            total_reviews
          FROM jsonb_populate_recordset(
            NULL::metrics.review_deltas,
            $1::jsonb
          ) AS rows
          ON CONFLICT (appid, delta_date)
          DO UPDATE SET
            hours_since_last_sync = EXCLUDED.hours_since_last_sync,
            is_interpolated = EXCLUDED.is_interpolated,
            negative_added = EXCLUDED.negative_added,
            positive_added = EXCLUDED.positive_added,
            positive_reviews = EXCLUDED.positive_reviews,
            review_score = EXCLUDED.review_score,
            review_score_desc = EXCLUDED.review_score_desc,
            reviews_added = EXCLUDED.reviews_added,
            total_reviews = EXCLUDED.total_reviews
        `,
        [jsonRows(deltaRows)]
      );
      await runQuery(
        client,
        'reviews.persistReviewSummaryBatch.dailyMetrics',
        `
          WITH input_rows AS MATERIALIZED (
            SELECT
              appid,
              metric_date,
              negative_reviews,
              positive_reviews,
              review_score,
              review_score_desc,
              total_reviews
            FROM jsonb_populate_recordset(
              NULL::metrics.daily_metrics,
              $1::jsonb
            ) AS rows
          ),
          daily_upsert AS (
            INSERT INTO metrics.daily_metrics (
              appid,
              metric_date,
              negative_reviews,
              positive_reviews,
              review_score,
              review_score_desc,
              total_reviews
            )
            SELECT
              appid,
              metric_date,
              negative_reviews,
              positive_reviews,
              review_score,
              review_score_desc,
              total_reviews
            FROM input_rows
            ON CONFLICT (appid, metric_date)
            DO UPDATE SET
              negative_reviews = EXCLUDED.negative_reviews,
              positive_reviews = EXCLUDED.positive_reviews,
              review_score = EXCLUDED.review_score,
              review_score_desc = EXCLUDED.review_score_desc,
              total_reviews = EXCLUDED.total_reviews
            RETURNING appid
          )
          INSERT INTO legacy.latest_daily_metrics (
            appid,
            metric_date,
            negative_reviews,
            positive_reviews,
            review_score,
            review_score_desc,
            total_reviews
          )
          SELECT
            appid,
            metric_date,
            negative_reviews,
            positive_reviews,
            review_score,
            review_score_desc,
            total_reviews
          FROM input_rows
          ON CONFLICT (appid)
          DO UPDATE SET
            metric_date = EXCLUDED.metric_date,
            negative_reviews = EXCLUDED.negative_reviews,
            positive_reviews = EXCLUDED.positive_reviews,
            review_score = EXCLUDED.review_score,
            review_score_desc = EXCLUDED.review_score_desc,
            total_reviews = EXCLUDED.total_reviews
        `,
        [jsonRows(metricRows)]
      );
      const statusResult = await runQuery(
        client,
        'reviews.persistReviewSummaryBatch.syncStatus',
        `
          UPDATE ops.sync_status AS status
          SET
            consecutive_errors = 0,
            last_error_at = NULL,
            last_error_message = NULL,
            last_error_source = NULL,
            last_known_total_reviews = rows.last_known_total_reviews,
            last_reviews_sync = rows.last_reviews_sync,
            next_reviews_sync = rows.next_reviews_sync,
            reviews_interval_hours = rows.reviews_interval_hours,
            reviews_claimed_at = NULL,
            reviews_claim_expires_at = NULL,
            reviews_claimed_by = NULL,
            reviews_priority_override_bucket = NULL,
            reviews_priority_override_reason = NULL,
            reviews_priority_override_score = NULL,
            reviews_priority_override_until = NULL,
            last_activity_at = COALESCE(rows.last_activity_at, status.last_activity_at),
            updated_at = now()
          FROM jsonb_to_recordset($1::jsonb) AS rows (
            appid integer,
            last_activity_at timestamptz,
            last_known_total_reviews integer,
            last_reviews_sync timestamptz,
            next_reviews_sync timestamptz,
            reviews_interval_hours integer
          )
          WHERE status.appid = rows.appid
            AND status.reviews_claimed_by = $2
        `,
        [jsonRows(statusRows), params.workerId]
      );

      if ((statusResult.rowCount ?? 0) !== params.items.length) {
        throw new Error(
          `Reviews batch claim ownership mismatch: updated ${statusResult.rowCount ?? 0} of ${params.items.length}`
        );
      }

      await runQuery(client, 'reviews.persistReviewSummaryBatch.commit', 'COMMIT');
      return results.map(({ hoursSinceLastSync: _hoursSinceLastSync, ...result }) => result);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async persistReviewFailuresBatch(params: PersistReviewFailureBatchParams): Promise<number> {
    if (params.failures.length === 0) {
      return 0;
    }

    const failedAt = params.failedAt ?? new Date().toISOString();
    const failedAtMs = Date.parse(failedAt);
    if (Number.isNaN(failedAtMs)) {
      throw new Error('failedAt must be a valid timestamp');
    }
    const rows = params.failures.map((failure) => {
      const consecutiveErrors = failure.previousConsecutiveErrors + 1;
      return {
        appid: failure.appid,
        consecutive_errors: consecutiveErrors,
        error_message: failure.errorMessage.slice(0, 1000),
        failed_at: failedAt,
        next_reviews_sync: new Date(
          failedAtMs + calculateReviewFailureBackoffMinutes(consecutiveErrors) * 60 * 1000
        ).toISOString()
      };
    });
    const result = await runQuery(
      this.pool,
      'reviews.persistReviewFailuresBatch',
      `
        UPDATE ops.sync_status AS status
        SET
          consecutive_errors = rows.consecutive_errors,
          last_error_source = 'reviews',
          last_error_message = rows.error_message,
          last_error_at = rows.failed_at,
          next_reviews_sync = rows.next_reviews_sync,
          reviews_claimed_by = NULL,
          reviews_claimed_at = NULL,
          reviews_claim_expires_at = NULL,
          updated_at = now()
        FROM jsonb_to_recordset($1::jsonb) AS rows (
          appid integer,
          consecutive_errors integer,
          error_message text,
          failed_at timestamptz,
          next_reviews_sync timestamptz
        )
        WHERE status.appid = rows.appid
          AND status.reviews_claimed_by = $2
      `,
      [jsonRows(rows), params.workerId]
    );

    return result.rowCount ?? 0;
  }
}

export class TigerEmbeddingsRepository {
  constructor(private readonly pool: TigerWriterPool) {}

  async listGameCandidates(limit: number): Promise<GameEmbeddingCandidate[]> {
    const { rows } = await runQuery<GameEmbeddingCandidateRow>(
      this.pool,
      'embeddings.listGameCandidates',
      `
        SELECT *
        FROM ops.get_apps_for_embedding($1::integer)
      `,
      [limit]
    );

    return rows.map((row) => this.mapGameCandidate(row));
  }

  async markGamesEmbedded(appids: number[], hashes: string[], syncedAt: string): Promise<number> {
    if (appids.length === 0) {
      return 0;
    }
    if (appids.length !== hashes.length) {
      throw new Error('Embedding appids and hashes must have the same length');
    }

    const result = await runQuery(
      this.pool,
      'embeddings.markGamesEmbedded',
      `
        INSERT INTO ops.sync_status (appid, last_embedding_sync, embedding_hash, updated_at)
        SELECT appid, $3::timestamptz, embedding_hash, now()
        FROM unnest($1::integer[], $2::text[]) AS rows(appid, embedding_hash)
        ON CONFLICT (appid)
        DO UPDATE SET
          last_embedding_sync = EXCLUDED.last_embedding_sync,
          embedding_hash = EXCLUDED.embedding_hash,
          updated_at = now()
      `,
      [appids, hashes, syncedAt]
    );

    return result.rowCount ?? 0;
  }

  async listPublishersNeedingEmbedding(limit: number): Promise<PublisherEmbeddingCandidate[]> {
    const rows = await this.listCompanyCandidates('publishers', limit);
    return rows.map((row) => this.mapPublisherCandidate(row));
  }

  async listDevelopersNeedingEmbedding(limit: number): Promise<DeveloperEmbeddingCandidate[]> {
    const rows = await this.listCompanyCandidates('developers', limit);
    return rows.map((row) => this.mapDeveloperCandidate(row));
  }

  async markPublishersEmbedded(ids: number[], hashes: string[], syncedAt: string): Promise<number> {
    return this.markCompaniesEmbedded('publishers', ids, hashes, syncedAt);
  }

  async markDevelopersEmbedded(ids: number[], hashes: string[], syncedAt: string): Promise<number> {
    return this.markCompaniesEmbedded('developers', ids, hashes, syncedAt);
  }

  private async listCompanyCandidates(
    table: 'developers' | 'publishers',
    limit: number
  ): Promise<CompanyEmbeddingCandidateRow[]> {
    const functionName =
      table === 'developers'
        ? 'ops.get_developers_needing_embedding'
        : 'ops.get_publishers_needing_embedding';
    const { rows } = await runQuery<CompanyEmbeddingCandidateRow>(
      this.pool,
      `embeddings.listCompanyCandidates.${table}`,
      `
        SELECT *
        FROM ${functionName}($1::integer)
      `,
      [limit]
    );

    return rows;
  }

  private async markCompaniesEmbedded(
    table: 'developers' | 'publishers',
    ids: number[],
    hashes: string[],
    syncedAt: string
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    if (ids.length !== hashes.length) {
      throw new Error('Embedding ids and hashes must have the same length');
    }

    const result = await runQuery(
      this.pool,
      `embeddings.markCompaniesEmbedded.${table}`,
      `
        UPDATE legacy.${table} AS company
        SET last_embedding_sync = $3::timestamptz,
            embedding_hash = rows.embedding_hash,
            updated_at = now()
        FROM unnest($1::integer[], $2::text[]) AS rows(id, embedding_hash)
        WHERE company.id = rows.id
      `,
      [ids, hashes, syncedAt]
    );

    return result.rowCount ?? 0;
  }

  private mapGameCandidate(row: GameEmbeddingCandidateRow): GameEmbeddingCandidate {
    return {
      appid: row.appid,
      average_playtime_forever: parseNullableNumber(row.average_playtime_forever),
      categories: parseStringArray(row.categories),
      ccu_growth_30d: parseNullableNumber(row.ccu_growth_30d),
      ccu_growth_7d: parseNullableNumber(row.ccu_growth_7d),
      ccu_peak: parseNullableNumber(row.ccu_peak),
      content_descriptors: parseJsonRecord(row.content_descriptors),
      controller_support: row.controller_support,
      current_price_cents: parseNullableNumber(row.current_price_cents),
      developer_ids: parseNumberArray(row.developer_ids),
      developers: parseStringArray(row.developers),
      franchise_ids: parseNumberArray(row.franchise_ids),
      franchise_names: parseStringArray(row.franchise_names),
      genres: parseStringArray(row.genres),
      historical_review_pct: parseNullableNumber(row.historical_review_pct),
      is_delisted: parseBoolean(row.is_delisted),
      is_free: parseBoolean(row.is_free),
      is_released: parseBoolean(row.is_released),
      language_count: parseNullableNumber(row.language_count),
      metacritic_score: parseNullableNumber(row.metacritic_score),
      name: row.name,
      owners_min: parseNullableNumber(row.owners_min),
      pics_review_percentage: parseNullableNumber(row.pics_review_percentage),
      pics_review_score: parseNullableNumber(row.pics_review_score),
      platforms: row.platforms,
      primary_genre: row.primary_genre,
      publisher_ids: parseNumberArray(row.publisher_ids),
      publishers: parseStringArray(row.publishers),
      recent_review_pct: parseNullableNumber(row.recent_review_pct),
      release_date: normalizeDate(row.release_date),
      sentiment_delta: parseNullableNumber(row.sentiment_delta),
      steam_deck_category: row.steam_deck_category,
      steamspy_tags: parseStringArray(row.steamspy_tags),
      tags: parseStringArray(row.tags),
      total_reviews: parseNullableNumber(row.total_reviews),
      trend_30d_direction: row.trend_30d_direction,
      type: row.type ?? 'game',
      updated_at: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString(),
      velocity_7d: parseNullableNumber(row.velocity_7d),
      velocity_acceleration: parseNullableNumber(row.velocity_acceleration),
      velocity_tier: row.velocity_tier,
    };
  }

  private mapPublisherCandidate(row: CompanyEmbeddingCandidateRow): PublisherEmbeddingCandidate {
    return {
      avg_review_percentage: parseNullableNumber(row.avg_review_percentage),
      first_game_release_date: normalizeDate(row.first_game_release_date),
      game_count: parseNumber(row.game_count),
      id: row.id,
      name: row.name,
      platforms_supported: parseStringArray(row.platforms_supported),
      top_game_appids: parseNumberArray(row.top_game_appids),
      top_game_names: parseStringArray(row.top_game_names),
      top_genres: parseStringArray(row.top_genres),
      top_tags: parseStringArray(row.top_tags),
      total_reviews: parseNumber(row.total_reviews),
    };
  }

  private mapDeveloperCandidate(row: CompanyEmbeddingCandidateRow): DeveloperEmbeddingCandidate {
    return {
      ...this.mapPublisherCandidate(row),
      is_indie: parseBoolean(row.is_indie),
    };
  }
}

export class TigerAlertsPinsChatRepository {
  constructor(private readonly pool: TigerWriterPool) {}

  async listUserPinsWithMetrics(userId: string): Promise<UserPinWithMetrics[]> {
    const { rows } = await runQuery<UserPinMetricRow>(
      this.pool,
      'alertsPinsChat.listUserPinsWithMetrics',
      `
        SELECT
          p.id::text AS pin_id,
          p.entity_type,
          p.entity_id,
          p.display_name,
          p.pin_order,
          p.pinned_at,
          ldm.ccu_peak AS ccu_current,
          trends.trend_30d_change_pct AS ccu_change_pct,
          ldm.total_reviews,
          CASE
            WHEN ldm.total_reviews > 0
              THEN (ldm.positive_reviews::numeric / ldm.total_reviews::numeric * 100)::numeric(5,2)
            ELSE NULL
          END AS positive_pct,
          trends.review_velocity_7d AS review_velocity,
          trends.trend_30d_direction::text AS trend_direction,
          a.current_price_cents AS price_cents,
          a.current_discount_percent AS discount_percent
        FROM legacy.user_pins p
        LEFT JOIN legacy.apps a ON p.entity_type = 'game' AND p.entity_id = a.appid
        LEFT JOIN legacy.latest_daily_metrics ldm
          ON p.entity_type = 'game' AND p.entity_id = ldm.appid
        LEFT JOIN metrics.app_trends trends
          ON p.entity_type = 'game' AND p.entity_id = trends.appid
        WHERE p.user_id = $1::uuid
        ORDER BY p.pin_order ASC, p.pinned_at DESC
      `,
      [userId]
    );

    return rows.map((row) => ({
      ccu_change_pct: parseNullableNumber(row.ccu_change_pct),
      ccu_current: parseNullableNumber(row.ccu_current),
      discount_percent: parseNullableNumber(row.discount_percent),
      display_name: row.display_name,
      entity_id: row.entity_id,
      entity_type: parseAlertEntityType(row.entity_type),
      pin_id: row.pin_id,
      pin_order: parseNumber(row.pin_order),
      pinned_at: normalizeTimestamp(row.pinned_at),
      positive_pct: parseNullableNumber(row.positive_pct),
      price_cents: parseNullableNumber(row.price_cents),
      review_velocity: parseNullableNumber(row.review_velocity),
      total_reviews: parseNullableNumber(row.total_reviews),
      trend_direction: row.trend_direction,
    }));
  }

  async checkUserPin(
    userId: string,
    entityType: string,
    entityId: number
  ): Promise<{ id: string } | null> {
    const { rows } = await runQuery<IdRow>(
      this.pool,
      'alertsPinsChat.checkUserPin',
      `
        SELECT id::text AS id
        FROM legacy.user_pins
        WHERE user_id = $1::uuid
          AND entity_type = $2::text
          AND entity_id = $3::integer
        LIMIT 1
      `,
      [userId, entityType, entityId]
    );

    return rows[0]?.id ? { id: String(rows[0].id) } : null;
  }

  async createUserPin(pin: UserPinUpsert): Promise<UserPinRow> {
    const { rows } = await runQuery<UserPinQueryRow>(
      this.pool,
      'alertsPinsChat.createUserPin',
      `
        INSERT INTO legacy.user_pins (
          id, user_id, entity_type, entity_id, display_name, pin_order, pinned_at
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2::uuid,
          $3::text,
          $4::integer,
          $5::text,
          COALESCE($6::integer, 0),
          COALESCE($7::timestamptz, now())
        )
        RETURNING
          id::text,
          user_id::text,
          entity_type,
          entity_id,
          display_name,
          pin_order,
          pinned_at
      `,
      [
        pin.id ?? null,
        pin.user_id,
        pin.entity_type,
        pin.entity_id,
        pin.display_name,
        pin.pin_order ?? null,
        pin.pinned_at ?? null,
      ]
    );

    return this.mapUserPin(rows[0]);
  }

  async upsertUserPin(pin: UserPinUpsert): Promise<number> {
    const rows = [pin];
    const columns = formatColumns(rows as unknown as JsonRecord[], [
      'user_id',
      'entity_type',
      'entity_id',
      'display_name',
    ]);
    const result = await runQuery(
      this.pool,
      'alertsPinsChat.upsertUserPin',
      buildUpsertSql({
        columns,
        conflict: 'user_id, entity_type, entity_id',
        schema: 'legacy',
        table: 'user_pins',
      }),
      [jsonRows(rows)]
    );
    return result.rowCount ?? 0;
  }

  async getUserPin(userId: string, pinId: string): Promise<UserPinRow | null> {
    const { rows } = await runQuery<UserPinQueryRow>(
      this.pool,
      'alertsPinsChat.getUserPin',
      `
        SELECT
          id::text,
          user_id::text,
          entity_type,
          entity_id,
          display_name,
          pin_order,
          pinned_at
        FROM legacy.user_pins
        WHERE user_id = $1::uuid AND id = $2::uuid
        LIMIT 1
      `,
      [userId, pinId]
    );

    return rows[0] ? this.mapUserPin(rows[0]) : null;
  }

  async deleteUserPin(userId: string, pinId: string): Promise<number> {
    const result = await runQuery(
      this.pool,
      'alertsPinsChat.deleteUserPin',
      'DELETE FROM legacy.user_pins WHERE user_id = $1::uuid AND id = $2::uuid',
      [userId, pinId]
    );
    return result.rowCount ?? 0;
  }

  async listUserAlerts(params: {
    limit: number;
    unreadOnly: boolean;
    userId: string;
  }): Promise<UserAlertWithPin[]> {
    const limit = Math.max(1, Math.min(params.limit, 100));
    const { rows } = await runQuery<UserAlertQueryRow>(
      this.pool,
      'alertsPinsChat.listUserAlerts',
      `
        SELECT
          ua.id::text,
          ua.user_id::text,
          ua.pin_id::text,
          ua.alert_type,
          ua.severity,
          ua.title,
          ua.description,
          ua.metric_name,
          ua.previous_value,
          ua.current_value,
          ua.change_percent,
          ua.dedup_key,
          ua.is_read,
          ua.read_at,
          ua.created_at,
          ua.source_data,
          p.display_name AS pin_display_name,
          p.entity_type AS pin_entity_type,
          p.entity_id AS pin_entity_id
        FROM legacy.user_alerts ua
        LEFT JOIN legacy.user_pins p ON ua.pin_id = p.id AND p.user_id = ua.user_id
        WHERE ua.user_id = $1::uuid
          AND ($2::boolean = false OR ua.is_read = false)
        ORDER BY ua.created_at DESC
        LIMIT $3::integer
      `,
      [params.userId, params.unreadOnly, limit]
    );

    return rows.map((row) => ({
      alert_type: row.alert_type,
      change_percent: parseNullableNumber(row.change_percent),
      created_at: normalizeTimestamp(row.created_at),
      current_value: parseNullableNumber(row.current_value),
      dedup_key: row.dedup_key,
      description: row.description,
      id: row.id,
      is_read: parseBoolean(row.is_read),
      metric_name: row.metric_name,
      pin_id: row.pin_id,
      previous_value: parseNullableNumber(row.previous_value),
      read_at: normalizeTimestamp(row.read_at),
      severity: row.severity,
      source_data: parseJsonRecord(row.source_data),
      title: row.title,
      user_id: row.user_id,
      user_pins:
        row.pin_display_name && row.pin_entity_id !== null && row.pin_entity_type
          ? {
              display_name: row.pin_display_name,
              entity_id: row.pin_entity_id,
              entity_type: parseAlertEntityType(row.pin_entity_type),
            }
          : null,
    }));
  }

  async countUnreadAlerts(userId: string): Promise<number> {
    const { rows } = await runQuery<CountRow>(
      this.pool,
      'alertsPinsChat.countUnreadAlerts',
      `
        SELECT COUNT(*)::integer AS count
        FROM legacy.user_alerts
        WHERE user_id = $1::uuid AND is_read = false
      `,
      [userId]
    );

    return parseNumber(rows[0]?.count);
  }

  async markAlertRead(userId: string, alertId: string, readAt: string): Promise<number> {
    const result = await runQuery(
      this.pool,
      'alertsPinsChat.markAlertRead',
      `
        UPDATE legacy.user_alerts
        SET is_read = true, read_at = $3::timestamptz
        WHERE user_id = $1::uuid AND id = $2::uuid
      `,
      [userId, alertId, readAt]
    );

    return result.rowCount ?? 0;
  }

  async deleteUserAlert(userId: string, alertId: string): Promise<number> {
    const result = await runQuery(
      this.pool,
      'alertsPinsChat.deleteUserAlert',
      'DELETE FROM legacy.user_alerts WHERE user_id = $1::uuid AND id = $2::uuid',
      [userId, alertId]
    );

    return result.rowCount ?? 0;
  }

  async insertAlerts(alerts: AlertInsert[]): Promise<number> {
    if (alerts.length === 0) {
      return 0;
    }

    const columns = formatColumns(alerts as unknown as JsonRecord[], [
      'user_id',
      'pin_id',
      'alert_type',
      'severity',
      'title',
      'description',
      'dedup_key',
    ]);
    const result = await runQuery(
      this.pool,
      'alertsPinsChat.insertAlerts',
      `
        INSERT INTO legacy.user_alerts (${columns.join(', ')})
        SELECT ${columns.join(', ')}
        FROM jsonb_populate_recordset(NULL::legacy.user_alerts, $1::jsonb) AS rows
        ON CONFLICT (dedup_key) DO NOTHING
      `,
      [jsonRows(alerts)]
    );

    return result.rowCount ?? 0;
  }

  async getAlertPreferences(userId: string): Promise<AlertPreferencesRow | null> {
    const { rows } = await runQuery<AlertPreferencesQueryRow>(
      this.pool,
      'alertsPinsChat.getAlertPreferences',
      `
        SELECT
          user_id::text,
          alerts_enabled,
          ccu_sensitivity,
          review_sensitivity,
          sentiment_sensitivity,
          alert_ccu_spike,
          alert_ccu_drop,
          alert_trend_reversal,
          alert_review_surge,
          alert_sentiment_shift,
          alert_price_change,
          alert_new_release,
          alert_milestone,
          created_at,
          updated_at
        FROM legacy.user_alert_preferences
        WHERE user_id = $1::uuid
        LIMIT 1
      `,
      [userId]
    );

    return rows[0] ? this.mapAlertPreferences(rows[0]) : null;
  }

  async getOrCreateAlertPreferences(
    preferences: AlertPreferencesUpsert
  ): Promise<AlertPreferencesRow> {
    const rows = [preferences];
    const columns = formatColumns(rows as unknown as JsonRecord[], ['user_id']);
    const { rows: resultRows } = await runQuery<AlertPreferencesQueryRow>(
      this.pool,
      'alertsPinsChat.getOrCreateAlertPreferences',
      `
        WITH inserted AS (
          INSERT INTO legacy.user_alert_preferences (${columns.join(', ')})
          SELECT ${columns.join(', ')}
          FROM jsonb_populate_recordset(NULL::legacy.user_alert_preferences, $1::jsonb) AS rows
          ON CONFLICT (user_id) DO NOTHING
          RETURNING
            user_id::text,
            alerts_enabled,
            ccu_sensitivity,
            review_sensitivity,
            sentiment_sensitivity,
            alert_ccu_spike,
            alert_ccu_drop,
            alert_trend_reversal,
            alert_review_surge,
            alert_sentiment_shift,
            alert_price_change,
            alert_new_release,
            alert_milestone,
            created_at,
            updated_at
        )
        SELECT *
        FROM inserted
        UNION ALL
        SELECT
          user_id::text,
          alerts_enabled,
          ccu_sensitivity,
          review_sensitivity,
          sentiment_sensitivity,
          alert_ccu_spike,
          alert_ccu_drop,
          alert_trend_reversal,
          alert_review_surge,
          alert_sentiment_shift,
          alert_price_change,
          alert_new_release,
          alert_milestone,
          created_at,
          updated_at
        FROM legacy.user_alert_preferences
        WHERE user_id = $2::uuid
          AND NOT EXISTS (SELECT 1 FROM inserted)
        LIMIT 1
      `,
      [jsonRows(rows), preferences.user_id]
    );

    return this.mapAlertPreferences(resultRows[0]);
  }

  async upsertAlertPreferences(preferences: AlertPreferencesUpsert): Promise<AlertPreferencesRow> {
    const rows = [preferences];
    const columns = formatColumns(rows as unknown as JsonRecord[], ['user_id']);
    const updateColumns = columns.filter((column) => column !== 'user_id');
    const updateSet = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ');
    const { rows: resultRows } = await runQuery<AlertPreferencesQueryRow>(
      this.pool,
      'alertsPinsChat.upsertAlertPreferences',
      `
        INSERT INTO legacy.user_alert_preferences (${columns.join(', ')})
        SELECT ${columns.join(', ')}
        FROM jsonb_populate_recordset(NULL::legacy.user_alert_preferences, $1::jsonb) AS rows
        ON CONFLICT (user_id) DO UPDATE SET ${updateSet}
        RETURNING
          user_id::text,
          alerts_enabled,
          ccu_sensitivity,
          review_sensitivity,
          sentiment_sensitivity,
          alert_ccu_spike,
          alert_ccu_drop,
          alert_trend_reversal,
          alert_review_surge,
          alert_sentiment_shift,
          alert_price_change,
          alert_new_release,
          alert_milestone,
          created_at,
          updated_at
      `,
      [jsonRows(rows)]
    );

    return this.mapAlertPreferences(resultRows[0]);
  }

  async getPinAlertSettings(pinId: string): Promise<PinAlertSettingsRow | null> {
    const { rows } = await runQuery<PinAlertSettingsQueryRow>(
      this.pool,
      'alertsPinsChat.getPinAlertSettings',
      `
        SELECT
          pin_id::text,
          use_custom_settings,
          alerts_enabled,
          ccu_sensitivity,
          review_sensitivity,
          sentiment_sensitivity,
          alert_ccu_spike,
          alert_ccu_drop,
          alert_trend_reversal,
          alert_review_surge,
          alert_sentiment_shift,
          alert_price_change,
          alert_new_release,
          alert_milestone,
          created_at,
          updated_at
        FROM legacy.user_pin_alert_settings
        WHERE pin_id = $1::uuid
        LIMIT 1
      `,
      [pinId]
    );

    return rows[0] ? this.mapPinAlertSettings(rows[0]) : null;
  }

  async upsertPinAlertSettings(settings: PinAlertSettingsUpsert): Promise<PinAlertSettingsRow> {
    const rows = [settings];
    const columns = formatColumns(rows as unknown as JsonRecord[], ['pin_id']);
    const updateColumns = columns.filter((column) => column !== 'pin_id');
    const updateSet = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ');
    const { rows: resultRows } = await runQuery<PinAlertSettingsQueryRow>(
      this.pool,
      'alertsPinsChat.upsertPinAlertSettings',
      `
        INSERT INTO legacy.user_pin_alert_settings (${columns.join(', ')})
        SELECT ${columns.join(', ')}
        FROM jsonb_populate_recordset(NULL::legacy.user_pin_alert_settings, $1::jsonb) AS rows
        ON CONFLICT (pin_id) DO UPDATE SET ${updateSet}
        RETURNING
          pin_id::text,
          use_custom_settings,
          alerts_enabled,
          ccu_sensitivity,
          review_sensitivity,
          sentiment_sensitivity,
          alert_ccu_spike,
          alert_ccu_drop,
          alert_trend_reversal,
          alert_review_surge,
          alert_sentiment_shift,
          alert_price_change,
          alert_new_release,
          alert_milestone,
          created_at,
          updated_at
      `,
      [jsonRows(rows)]
    );

    return this.mapPinAlertSettings(resultRows[0]);
  }

  async deletePinAlertSettings(pinId: string): Promise<number> {
    const result = await runQuery(
      this.pool,
      'alertsPinsChat.deletePinAlertSettings',
      'DELETE FROM legacy.user_pin_alert_settings WHERE pin_id = $1::uuid',
      [pinId]
    );

    return result.rowCount ?? 0;
  }

  private mapUserPin(row: UserPinQueryRow): UserPinRow {
    return {
      display_name: row.display_name,
      entity_id: row.entity_id,
      entity_type: parseAlertEntityType(row.entity_type),
      id: row.id,
      pin_order: parseNumber(row.pin_order),
      pinned_at: normalizeTimestamp(row.pinned_at),
      user_id: row.user_id,
    };
  }

  private mapAlertPreferences(row: AlertPreferencesQueryRow): AlertPreferencesRow {
    return {
      alert_ccu_drop: parseBoolean(row.alert_ccu_drop, true),
      alert_ccu_spike: parseBoolean(row.alert_ccu_spike, true),
      alert_milestone: parseBoolean(row.alert_milestone, true),
      alert_new_release: parseBoolean(row.alert_new_release, true),
      alert_price_change: parseBoolean(row.alert_price_change, true),
      alert_review_surge: parseBoolean(row.alert_review_surge, true),
      alert_sentiment_shift: parseBoolean(row.alert_sentiment_shift, true),
      alert_trend_reversal: parseBoolean(row.alert_trend_reversal, true),
      alerts_enabled: parseBoolean(row.alerts_enabled, true),
      ccu_sensitivity: parseNullableNumber(row.ccu_sensitivity) ?? 1,
      created_at: normalizeTimestamp(row.created_at),
      review_sensitivity: parseNullableNumber(row.review_sensitivity) ?? 1,
      sentiment_sensitivity: parseNullableNumber(row.sentiment_sensitivity) ?? 1,
      updated_at: normalizeTimestamp(row.updated_at),
      user_id: row.user_id,
    };
  }

  private mapPinAlertSettings(row: PinAlertSettingsQueryRow): PinAlertSettingsRow {
    return {
      alert_ccu_drop:
        row.alert_ccu_drop === null || row.alert_ccu_drop === undefined
          ? null
          : parseBoolean(row.alert_ccu_drop),
      alert_ccu_spike:
        row.alert_ccu_spike === null || row.alert_ccu_spike === undefined
          ? null
          : parseBoolean(row.alert_ccu_spike),
      alert_milestone:
        row.alert_milestone === null || row.alert_milestone === undefined
          ? null
          : parseBoolean(row.alert_milestone),
      alert_new_release:
        row.alert_new_release === null || row.alert_new_release === undefined
          ? null
          : parseBoolean(row.alert_new_release),
      alert_price_change:
        row.alert_price_change === null || row.alert_price_change === undefined
          ? null
          : parseBoolean(row.alert_price_change),
      alert_review_surge:
        row.alert_review_surge === null || row.alert_review_surge === undefined
          ? null
          : parseBoolean(row.alert_review_surge),
      alert_sentiment_shift:
        row.alert_sentiment_shift === null || row.alert_sentiment_shift === undefined
          ? null
          : parseBoolean(row.alert_sentiment_shift),
      alert_trend_reversal:
        row.alert_trend_reversal === null || row.alert_trend_reversal === undefined
          ? null
          : parseBoolean(row.alert_trend_reversal),
      alerts_enabled: parseBoolean(row.alerts_enabled, true),
      ccu_sensitivity: parseNullableNumber(row.ccu_sensitivity),
      created_at: normalizeTimestamp(row.created_at),
      pin_id: row.pin_id,
      review_sensitivity: parseNullableNumber(row.review_sensitivity),
      sentiment_sensitivity: parseNullableNumber(row.sentiment_sensitivity),
      updated_at: normalizeTimestamp(row.updated_at),
      use_custom_settings: parseBoolean(row.use_custom_settings, true),
    };
  }

  async listPinnedEntitiesWithMetrics(): Promise<PinnedAlertEntity[]> {
    const { rows } = await runQuery<PinnedAlertEntityRow>(
      this.pool,
      'alertsPinsChat.listPinnedEntitiesWithMetrics',
      `
        SELECT
          p.user_id::text,
          p.id::text AS pin_id,
          p.entity_type,
          p.entity_id,
          p.display_name,
          CASE WHEN p.entity_type = 'game' THEN ldm.ccu_peak END AS ccu_current,
          CASE WHEN p.entity_type = 'game' THEN ads.ccu_7d_avg END AS ccu_7d_avg,
          CASE WHEN p.entity_type = 'game' THEN trends.review_velocity_7d END AS review_velocity,
          CASE
            WHEN p.entity_type = 'game' AND ldm.total_reviews > 0
              THEN ldm.positive_reviews::numeric / ldm.total_reviews::numeric
            ELSE NULL
          END AS positive_ratio,
          CASE WHEN p.entity_type = 'game' THEN ldm.total_reviews END AS total_reviews,
          CASE WHEN p.entity_type = 'game' THEN a.current_price_cents END AS price_cents,
          CASE WHEN p.entity_type = 'game' THEN a.current_discount_percent END AS discount_percent,
          CASE WHEN p.entity_type = 'game' THEN trends.trend_30d_direction END AS trend_30d_direction,
          CASE
            WHEN ps.use_custom_settings = true AND ps.ccu_sensitivity IS NOT NULL
              THEN ps.ccu_sensitivity
            ELSE COALESCE(pref.ccu_sensitivity, 1.0)
          END AS sensitivity_ccu,
          CASE
            WHEN ps.use_custom_settings = true AND ps.review_sensitivity IS NOT NULL
              THEN ps.review_sensitivity
            ELSE COALESCE(pref.review_sensitivity, 1.0)
          END AS sensitivity_review,
          CASE
            WHEN ps.use_custom_settings = true AND ps.sentiment_sensitivity IS NOT NULL
              THEN ps.sentiment_sensitivity
            ELSE COALESCE(pref.sentiment_sensitivity, 1.0)
          END AS sensitivity_sentiment,
          CASE
            WHEN COALESCE(pref.alerts_enabled, true) = false THEN false
            WHEN ps.use_custom_settings = true THEN COALESCE(ps.alerts_enabled, true)
            ELSE true
          END AS alerts_enabled,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_ccu_spike IS NOT NULL
              THEN ps.alert_ccu_spike
            ELSE COALESCE(pref.alert_ccu_spike, true)
          END AS alert_ccu_spike,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_ccu_drop IS NOT NULL
              THEN ps.alert_ccu_drop
            ELSE COALESCE(pref.alert_ccu_drop, true)
          END AS alert_ccu_drop,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_trend_reversal IS NOT NULL
              THEN ps.alert_trend_reversal
            ELSE COALESCE(pref.alert_trend_reversal, true)
          END AS alert_trend_reversal,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_review_surge IS NOT NULL
              THEN ps.alert_review_surge
            ELSE COALESCE(pref.alert_review_surge, true)
          END AS alert_review_surge,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_sentiment_shift IS NOT NULL
              THEN ps.alert_sentiment_shift
            ELSE COALESCE(pref.alert_sentiment_shift, true)
          END AS alert_sentiment_shift,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_price_change IS NOT NULL
              THEN ps.alert_price_change
            ELSE COALESCE(pref.alert_price_change, true)
          END AS alert_price_change,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_new_release IS NOT NULL
              THEN ps.alert_new_release
            ELSE COALESCE(pref.alert_new_release, true)
          END AS alert_new_release,
          CASE
            WHEN ps.use_custom_settings = true AND ps.alert_milestone IS NOT NULL
              THEN ps.alert_milestone
            ELSE COALESCE(pref.alert_milestone, true)
          END AS alert_milestone
        FROM legacy.user_pins p
        LEFT JOIN legacy.apps a ON p.entity_type = 'game' AND p.entity_id = a.appid
        LEFT JOIN legacy.latest_daily_metrics ldm
          ON p.entity_type = 'game' AND p.entity_id = ldm.appid
        LEFT JOIN metrics.app_trends trends
          ON p.entity_type = 'game' AND p.entity_id = trends.appid
        LEFT JOIN ops.alert_detection_state ads
          ON p.entity_type = ads.entity_type AND p.entity_id = ads.entity_id
        LEFT JOIN legacy.user_alert_preferences pref ON p.user_id = pref.user_id
        LEFT JOIN legacy.user_pin_alert_settings ps ON p.id = ps.pin_id
        WHERE COALESCE(pref.alerts_enabled, true) = true
      `
    );

    return rows.map((row) => ({
      alert_ccu_drop: parseBoolean(row.alert_ccu_drop, true),
      alert_ccu_spike: parseBoolean(row.alert_ccu_spike, true),
      alert_milestone: parseBoolean(row.alert_milestone, true),
      alert_new_release: parseBoolean(row.alert_new_release, true),
      alert_price_change: parseBoolean(row.alert_price_change, true),
      alert_review_surge: parseBoolean(row.alert_review_surge, true),
      alert_sentiment_shift: parseBoolean(row.alert_sentiment_shift, true),
      alert_trend_reversal: parseBoolean(row.alert_trend_reversal, true),
      alerts_enabled: parseBoolean(row.alerts_enabled, true),
      ccu_7d_avg: parseNullableNumber(row.ccu_7d_avg),
      ccu_current: parseNullableNumber(row.ccu_current),
      discount_percent: parseNullableNumber(row.discount_percent),
      display_name: row.display_name,
      entity_id: row.entity_id,
      entity_type: parseAlertEntityType(row.entity_type),
      pin_id: row.pin_id,
      positive_ratio: parseNullableNumber(row.positive_ratio),
      price_cents: parseNullableNumber(row.price_cents),
      review_velocity: parseNullableNumber(row.review_velocity),
      sensitivity_ccu: parseNullableNumber(row.sensitivity_ccu) ?? 1,
      sensitivity_review: parseNullableNumber(row.sensitivity_review) ?? 1,
      sensitivity_sentiment: parseNullableNumber(row.sensitivity_sentiment) ?? 1,
      total_reviews: parseNullableNumber(row.total_reviews),
      trend_30d_direction: row.trend_30d_direction,
      user_id: row.user_id,
    }));
  }

  async listAlertEntityMetrics(entityIds: number[]): Promise<AlertEntityMetrics[]> {
    if (entityIds.length === 0) {
      return [];
    }

    const { rows } = await runQuery<AlertEntityMetricsRow>(
      this.pool,
      'alertsPinsChat.listAlertEntityMetrics',
      `
        WITH requested AS (
          SELECT DISTINCT unnest($1::integer[]) AS appid
        ),
        ccu_7d AS (
          SELECT
            metrics.appid,
            round(avg(metrics.ccu_peak))::integer AS ccu_7d_avg
          FROM metrics.daily_metrics metrics
          JOIN requested ON requested.appid = metrics.appid
          WHERE metrics.metric_date BETWEEN current_date - 6 AND current_date
            AND metrics.ccu_peak IS NOT NULL
          GROUP BY metrics.appid
        )
        SELECT
          requested.appid AS entity_id,
          latest.ccu_peak AS ccu_current,
          ccu_7d.ccu_7d_avg,
          trends.review_velocity_7d AS review_velocity,
          CASE
            WHEN latest.total_reviews > 0
              THEN latest.positive_reviews::numeric / latest.total_reviews::numeric
            ELSE NULL
          END AS positive_ratio,
          latest.total_reviews,
          apps.current_price_cents AS price_cents,
          apps.current_discount_percent AS discount_percent,
          trends.trend_30d_direction
        FROM requested
        LEFT JOIN legacy.apps apps ON apps.appid = requested.appid
        LEFT JOIN legacy.latest_daily_metrics latest ON latest.appid = requested.appid
        LEFT JOIN metrics.app_trends trends ON trends.appid = requested.appid
        LEFT JOIN ccu_7d ON ccu_7d.appid = requested.appid
        ORDER BY requested.appid
      `,
      [entityIds]
    );

    return rows.map((row) => ({
      ccu_7d_avg: parseNullableNumber(row.ccu_7d_avg),
      ccu_current: parseNullableNumber(row.ccu_current),
      discount_percent: parseNullableNumber(row.discount_percent),
      entity_id: row.entity_id,
      positive_ratio: parseNullableNumber(row.positive_ratio),
      price_cents: parseNullableNumber(row.price_cents),
      review_velocity: parseNullableNumber(row.review_velocity),
      total_reviews: parseNullableNumber(row.total_reviews),
      trend_30d_direction: row.trend_30d_direction,
    }));
  }

  async listRecentAlertSourceEvents(
    entities: AlertEntityKey[],
    since: string
  ): Promise<AlertSourceEvent[]> {
    if (entities.length === 0) {
      return [];
    }

    const { rows } = await runQuery<AlertSourceEventRow>(
      this.pool,
      'alertsPinsChat.listRecentAlertSourceEvents',
      `
        WITH requested AS (
          SELECT DISTINCT entity_type, entity_id
          FROM jsonb_to_recordset($1::jsonb) AS rows (
            entity_type text,
            entity_id integer
          )
        ),
        source_events AS (
          SELECT
            requested.entity_type,
            requested.entity_id,
            changes.appid,
            apps.name AS app_name,
            'price_change'::text AS alert_type,
            changes.occurred_at,
            'app_change_event:' || changes.id::text || ':' ||
              changes.occurred_at::text AS event_key,
            CASE
              WHEN jsonb_typeof(changes.before_value) IN ('number', 'string')
                AND (changes.before_value #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN (changes.before_value #>> '{}')::numeric
              ELSE NULL
            END AS previous_value,
            CASE
              WHEN jsonb_typeof(changes.after_value) IN ('number', 'string')
                AND (changes.after_value #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN (changes.after_value #>> '{}')::numeric
              ELSE NULL
            END AS current_value,
            jsonb_build_object(
              'source', changes.source,
              'changeType', changes.change_type,
              'eventId', changes.id,
              'occurredAt', changes.occurred_at,
              'sourceSnapshotId', changes.source_snapshot_id
            ) AS source_data
          FROM events.app_change_events changes
          JOIN requested
            ON requested.entity_type = 'game'
           AND requested.entity_id = changes.appid
          LEFT JOIN legacy.apps apps ON apps.appid = changes.appid
          WHERE changes.change_type = 'price_change'
            AND changes.occurred_at >= $2::timestamptz

          UNION ALL

          SELECT
            requested.entity_type,
            requested.entity_id,
            lifecycle.appid,
            apps.name AS app_name,
            'new_release'::text AS alert_type,
            lifecycle.occurred_at,
            lifecycle.idempotency_key AS event_key,
            0::numeric AS previous_value,
            1::numeric AS current_value,
            jsonb_build_object(
              'source', lifecycle.source,
              'eventType', lifecycle.event_type,
              'lifecycleEventId', lifecycle.id,
              'occurredAt', lifecycle.occurred_at,
              'sourceEventId', lifecycle.source_event_id
            ) AS source_data
          FROM events.app_lifecycle_events lifecycle
          JOIN legacy.app_publishers relations ON relations.appid = lifecycle.appid
          JOIN requested
            ON requested.entity_type = 'publisher'
           AND requested.entity_id = relations.publisher_id
          LEFT JOIN legacy.apps apps ON apps.appid = lifecycle.appid
          WHERE lifecycle.event_type = 'release_state_changed'
            AND lifecycle.after_state @> '{"is_released": true}'::jsonb
            AND lifecycle.occurred_at >= $2::timestamptz

          UNION ALL

          SELECT
            requested.entity_type,
            requested.entity_id,
            lifecycle.appid,
            apps.name AS app_name,
            'new_release'::text AS alert_type,
            lifecycle.occurred_at,
            lifecycle.idempotency_key AS event_key,
            0::numeric AS previous_value,
            1::numeric AS current_value,
            jsonb_build_object(
              'source', lifecycle.source,
              'eventType', lifecycle.event_type,
              'lifecycleEventId', lifecycle.id,
              'occurredAt', lifecycle.occurred_at,
              'sourceEventId', lifecycle.source_event_id
            ) AS source_data
          FROM events.app_lifecycle_events lifecycle
          JOIN legacy.app_developers relations ON relations.appid = lifecycle.appid
          JOIN requested
            ON requested.entity_type = 'developer'
           AND requested.entity_id = relations.developer_id
          LEFT JOIN legacy.apps apps ON apps.appid = lifecycle.appid
          WHERE lifecycle.event_type = 'release_state_changed'
            AND lifecycle.after_state @> '{"is_released": true}'::jsonb
            AND lifecycle.occurred_at >= $2::timestamptz
        )
        SELECT DISTINCT ON (entity_type, entity_id, alert_type)
          entity_type,
          entity_id,
          appid,
          app_name,
          alert_type,
          occurred_at,
          event_key,
          previous_value,
          current_value,
          source_data
        FROM source_events
        ORDER BY
          entity_type,
          entity_id,
          alert_type,
          occurred_at DESC,
          event_key DESC
      `,
      [jsonRows(entities as unknown as JsonRecord[]), since]
    );

    return rows.map((row) => ({
      alert_type: row.alert_type,
      appid: row.appid,
      app_name: row.app_name,
      current_value: parseNullableNumber(row.current_value),
      entity_id: row.entity_id,
      entity_type: parseAlertEntityType(row.entity_type),
      event_key: row.event_key,
      occurred_at: normalizeTimestamp(row.occurred_at) ?? new Date(0).toISOString(),
      previous_value: parseNullableNumber(row.previous_value),
      source_data: parseJsonRecord(row.source_data),
    }));
  }

  async listAlertDetectionStates(entityIds: number[]): Promise<AlertDetectionState[]> {
    if (entityIds.length === 0) {
      return [];
    }

    const { rows } = await runQuery<AlertDetectionStateRow>(
      this.pool,
      'alertsPinsChat.listAlertDetectionStates',
      `
        SELECT
          entity_type,
          entity_id,
          ccu_7d_avg,
          ccu_prev_value,
          review_velocity_7d_avg,
          positive_ratio_prev,
          total_reviews_prev,
          trend_30d_direction_prev
        FROM ops.alert_detection_state
        WHERE entity_id = ANY($1::integer[])
      `,
      [entityIds]
    );

    return rows.map((row) => ({
      ccu_7d_avg: parseNullableNumber(row.ccu_7d_avg),
      ccu_prev_value: parseNullableNumber(row.ccu_prev_value),
      entity_id: row.entity_id,
      entity_type: parseAlertEntityType(row.entity_type),
      positive_ratio_prev: parseNullableNumber(row.positive_ratio_prev),
      review_velocity_7d_avg: parseNullableNumber(row.review_velocity_7d_avg),
      total_reviews_prev: parseNullableNumber(row.total_reviews_prev),
      trend_30d_direction_prev: row.trend_30d_direction_prev,
    }));
  }

  async upsertAlertDetectionStates(states: AlertDetectionStateUpsert[]): Promise<number> {
    if (states.length === 0) {
      return 0;
    }

    const columns = formatColumns(states as unknown as JsonRecord[], ['entity_type', 'entity_id']);
    const result = await runQuery(
      this.pool,
      'alertsPinsChat.upsertAlertDetectionStates',
      buildUpsertSql({
        columns,
        conflict: 'entity_type, entity_id',
        schema: 'ops',
        table: 'alert_detection_state',
      }),
      [jsonRows(states)]
    );

    return result.rowCount ?? 0;
  }

  async logChatQuery(entry: JsonRecord): Promise<string | null> {
    const columns = formatColumns([entry], ['query_text']);
    const { rows } = await runQuery<IdRow>(
      this.pool,
      'alertsPinsChat.logChatQuery',
      `
        INSERT INTO chat.chat_query_logs (${columns.join(', ')})
        SELECT ${columns.join(', ')}
        FROM jsonb_populate_recordset(NULL::chat.chat_query_logs, $1::jsonb) AS rows
        RETURNING id
      `,
      [jsonRows([entry])]
    );

    return rows[0]?.id ? String(rows[0].id) : null;
  }

  async reserveCredits(userId: string, amount: number): Promise<string | null> {
    const { rows } = await runQuery<IdRow>(
      this.pool,
      'alertsPinsChat.reserveCredits',
      'SELECT chat.reserve_credits($1::uuid, $2::integer) AS id',
      [userId, amount]
    );

    return rows[0]?.id ? String(rows[0].id) : null;
  }

  async finalizeCredits(params: {
    actualAmount: number;
    description?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    reservationId: string;
    toolCredits?: number | null;
  }): Promise<{ newBalance: number; refunded: number; success: boolean }> {
    const { rows } = await runQuery<CreditResultRow>(
      this.pool,
      'alertsPinsChat.finalizeCredits',
      `
        SELECT success, refunded, new_balance
        FROM chat.finalize_credits($1::uuid, $2::integer, $3::text, $4::integer, $5::integer, $6::integer)
      `,
      [
        params.reservationId,
        params.actualAmount,
        params.description ?? null,
        params.inputTokens ?? null,
        params.outputTokens ?? null,
        params.toolCredits ?? null,
      ]
    );

    const row = rows[0];
    return {
      newBalance: parseNumber(row?.new_balance),
      refunded: parseNumber(row?.refunded),
      success: Boolean(row?.success),
    };
  }
}

export class TigerIssueReportsRepository {
  private readonly sentryColumns = new Set([
    'sentry_client_event_id',
    'sentry_feedback_id',
    'sentry_replay_id',
    'sentry_server_event_id',
    'sentry_trace_id',
  ]);

  constructor(private readonly pool: TigerWriterPool) {}

  async createIssueReport(report: IssueReportInsert): Promise<string | null> {
    const rows = [report];
    const columns = formatColumns(rows, ['id', 'issue_type', 'status']);
    const { rows: resultRows } = await runQuery<IdRow>(
      this.pool,
      'issueReports.createIssueReport',
      `
        INSERT INTO chat.issue_reports (${columns.join(', ')})
        SELECT ${columns.join(', ')}
        FROM jsonb_populate_recordset(NULL::chat.issue_reports, $1::jsonb) AS rows
        RETURNING id::text AS id
      `,
      [jsonRows(rows)]
    );

    return resultRows[0]?.id ? String(resultRows[0].id) : null;
  }

  async attachSentryIds(params: {
    ids: IssueReportSentryIds;
    reportId: string;
    userId: string;
  }): Promise<number> {
    const entries = allowedEntries(params.ids, this.sentryColumns);
    if (entries.length === 0) {
      return 0;
    }

    const setClauses = entries.map(([column], index) => `${column} = $${index + 3}`);
    setClauses.push('updated_at = now()');
    const result = await runQuery(
      this.pool,
      'issueReports.attachSentryIds',
      `
        UPDATE chat.issue_reports
        SET ${setClauses.join(', ')}
        WHERE id = $1::uuid
          AND user_id = $2::uuid
      `,
      [params.reportId, params.userId, ...entries.map(([, value]) => value)]
    );

    return result.rowCount ?? 0;
  }
}

export class TigerWriter {
  readonly alertsPinsChat: TigerAlertsPinsChatRepository;
  readonly catalog: TigerCatalogRepository;
  readonly catalogObservation: TigerCatalogObservationRepository;
  readonly embeddings: TigerEmbeddingsRepository;
  readonly issueReports: TigerIssueReportsRepository;
  readonly metrics: TigerMetricsRepository;
  readonly ops: TigerOpsRepository;
  readonly reviews: TigerReviewsRepository;
  readonly syncStatus: TigerSyncStatusRepository;

  constructor(readonly pool: TigerWriterPool) {
    this.ops = new TigerOpsRepository(pool);
    this.syncStatus = new TigerSyncStatusRepository(pool);
    this.catalog = new TigerCatalogRepository(pool);
    this.catalogObservation = new TigerCatalogObservationRepository(pool);
    this.metrics = new TigerMetricsRepository(pool);
    this.reviews = new TigerReviewsRepository(pool, this.metrics, this.syncStatus);
    this.embeddings = new TigerEmbeddingsRepository(pool);
    this.alertsPinsChat = new TigerAlertsPinsChatRepository(pool);
    this.issueReports = new TigerIssueReportsRepository(pool);
  }
}

let tigerWriter: TigerWriter | null = null;

export function getTigerWriter(env: NodeJS.ProcessEnv = process.env): TigerWriter {
  if (!tigerWriter) {
    tigerWriter = new TigerWriter(getTigerPool(env) as unknown as TigerWriterPool);
  }

  return tigerWriter;
}

export function createTigerWriterForPool(pool: TigerWriterPool): TigerWriter {
  return new TigerWriter(pool);
}

export async function shutdownTigerWriter(): Promise<void> {
  tigerWriter = null;
  await shutdownTigerPool();
}

export type { PoolClient as TigerPoolClient };
