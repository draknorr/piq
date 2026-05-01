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

interface AppIdRow extends QueryResultRow {
  appid: number;
}

interface SyncCandidateRow extends QueryResultRow {
  appid: number;
  priority_score: number | string | null;
}

interface StorefrontSyncStatusRow extends QueryResultRow {
  appid: number;
  last_storefront_sync: Date | string | null;
}

interface HistogramSyncStatusRow extends QueryResultRow {
  appid: number;
  last_histogram_sync: Date | string | null;
}

interface CcuTierAssignmentRow extends QueryResultRow {
  appid: number;
  ccu_tier: number | string | null;
}

interface TierAssignmentFreshnessRow extends QueryResultRow {
  updated_at: Date | string | null;
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

export interface AppSyncCandidate {
  appid: number;
  priorityScore: number;
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
  p_dlc_appids?: number[];
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
  previous: PreviousReviewSyncData | undefined;
  summary: ReviewSummaryForPersistence;
  today: string;
  velocityTier?: string | null;
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

function getIntervalHoursForVelocityTier(velocityTier: string | null | undefined): number {
  switch (velocityTier) {
    case 'high':
      return 4;
    case 'medium':
      return 12;
    case 'low':
      return 24;
    case 'dormant':
      return 72;
    default:
      return 24;
  }
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
    .filter((column) => !params.conflict.split(',').map((part) => part.trim()).includes(column))
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
      [params.jobType, params.githubRunId ?? null, params.startedAt ?? null, params.batchSize ?? null]
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
      params.partitionCount !== undefined && params.partitionCount > 1 && params.partitionId !== undefined;
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
          $15::integer
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
          SET catalog_seed_state = 'inaccessible',
              updated_at = $2::timestamptz
          WHERE appid = $1
            AND catalog_seed_state = 'stub'
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
    const count = await this.upsertMetricsTable('daily_metrics', rows as unknown as JsonRecord[], 'appid, metric_date');
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
        row.owners_min !== undefined && row.owners_max !== undefined && row.owners_min !== null && row.owners_max !== null
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

    const columns = formatColumns(rows as unknown as JsonRecord[], ['appid', 'player_count', 'ccu_tier']);
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

  async upsertReviewDeltas(rows: ReviewDeltaUpsert[]): Promise<number> {
    return this.upsertMetricsTable('review_deltas', rows as unknown as JsonRecord[], 'appid, delta_date');
  }

  async upsertReviewHistogram(rows: ReviewHistogramUpsert[]): Promise<number> {
    return this.upsertMetricsTable('review_histogram', rows as unknown as JsonRecord[], 'appid, month_start');
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

  async countReviewDeltas(params: {
    interpolated: boolean;
    startDate: string;
  }): Promise<number> {
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
          s.last_known_total_reviews,
          s.consecutive_errors,
          s.reviews_interval_hours,
          m.total_reviews,
          m.positive_reviews
        FROM ops.sync_status s
        LEFT JOIN metrics.daily_metrics m
          ON m.appid = s.appid
        WHERE s.appid = ANY($1::integer[])
        ORDER BY s.appid, m.metric_date DESC NULLS LAST
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
    const intervalHours =
      params.previous?.intervalHours ?? getIntervalHoursForVelocityTier(params.velocityTier);
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
    const columns = formatColumns(rows as unknown as JsonRecord[], ['user_id', 'entity_type', 'entity_id', 'display_name']);
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

export class TigerWriter {
  readonly alertsPinsChat: TigerAlertsPinsChatRepository;
  readonly catalog: TigerCatalogRepository;
  readonly embeddings: TigerEmbeddingsRepository;
  readonly metrics: TigerMetricsRepository;
  readonly ops: TigerOpsRepository;
  readonly reviews: TigerReviewsRepository;
  readonly syncStatus: TigerSyncStatusRepository;

  constructor(readonly pool: TigerWriterPool) {
    this.ops = new TigerOpsRepository(pool);
    this.syncStatus = new TigerSyncStatusRepository(pool);
    this.catalog = new TigerCatalogRepository(pool);
    this.metrics = new TigerMetricsRepository(pool);
    this.reviews = new TigerReviewsRepository(pool, this.metrics, this.syncStatus);
    this.embeddings = new TigerEmbeddingsRepository(pool);
    this.alertsPinsChat = new TigerAlertsPinsChatRepository(pool);
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
