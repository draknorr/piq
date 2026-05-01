// Client
export {
  createServiceClient,
  createBrowserClient,
  getServiceClient,
  type TypedSupabaseClient,
} from './client.js';

// Operational helpers used by ingestion workers
export {
  getCcuProvenanceRepairCandidates,
  getCcuValidationBackfillCandidates,
  listHotNewsRefreshCandidates,
  listNewsCatchupCandidates,
  recalculateCcuTiers,
  refreshCcuQualityStats,
  refreshMaterializedView,
  type CcuProvenanceRepairCandidate,
  type CcuValidationBackfillCandidate,
  type HotNewsRefreshCandidate,
  type NewsCatchupCandidate,
  type RecalculateCcuTiersResult,
  type RefreshCcuQualityStatsOptions,
  type RefreshMaterializedViewOptions,
} from './ingestion.js';

export {
  getTigerPool,
  requireTigerPrimaryUrl,
  runTigerQuery,
  shutdownTigerPool,
  withTigerClient,
  withTigerTransaction,
} from './tiger.js';

export {
  assertSupabaseServiceClientAllowed,
  isSupabaseServiceClientAllowedWithTiger,
  readDataWriteTarget,
  readSupabaseServiceClientPurpose,
  type DataWriteTarget,
  type SupabaseServiceClientPurpose,
} from './write-target.js';

export {
  createTigerWriterForPool,
  getTigerWriter,
  shutdownTigerWriter,
  TigerWriter,
  TigerWriterError,
  type AlertPreferencesRow,
  type AlertPreferencesUpsert,
  type AlertDetectionState,
  type AlertDetectionStateUpsert,
  type AlertEntityType,
  type AlertInsert,
  type AppSyncCandidate,
  type AppTrendUpsert,
  type CatalogAppUpsert,
  type CcuTierAssignment,
  type CcuSnapshotInsert,
  type CcuTierAssignmentUpsert,
  type DailyCcuPeakUpsert,
  type DailyMetricUpsert,
  type DeveloperEmbeddingCandidate,
  type EmbeddingCandidate,
  type GameEmbeddingCandidate,
  type PersistReviewSummaryParams,
  type PinAlertSettingsRow,
  type PinAlertSettingsUpsert,
  type PinnedAlertEntity,
  type PreviousReviewSyncData,
  type PriorityInput,
  type PublisherEmbeddingCandidate,
  type ReviewDeltaUpsert,
  type ReviewHistogramUpsert,
  type ReviewHistogramAppidPage,
  type ReviewHistogramEntry,
  type ReviewHistogramSyncStatus,
  type ReviewPromotion,
  type ReviewSummaryForPersistence,
  type StorefrontAppUpsertArgs,
  type StorefrontSyncStatus,
  type SyncJobCreateParams,
  type SyncJobStatus,
  type SyncJobUpdate,
  type SyncStatusUpsert,
  type Tier3CcuCandidateResult,
  type TigerQueryClient,
  type TigerWriterPool,
  type UserAlertPinSummary,
  type UserAlertWithPin,
  type UserPinRow,
  type UserPinUpsert,
  type UserPinWithMetrics,
} from './tiger-writer.js';

// Types
export type { Database } from './types.js';

// Re-export commonly used types from the Database type
import type { Database } from './types.js';

export type Tables = Database['public']['Tables'];
export type Enums = Database['public']['Enums'];

// Table row types
export type Publisher = Tables['publishers']['Row'];
export type Developer = Tables['developers']['Row'];
export type App = Tables['apps']['Row'];
export type AppDeveloper = Tables['app_developers']['Row'];
export type AppPublisher = Tables['app_publishers']['Row'];
export type AppTag = Tables['app_tags']['Row'];
export type DailyMetric = Tables['daily_metrics']['Row'];
export type ReviewHistogram = Tables['review_histogram']['Row'];
export type AppTrend = Tables['app_trends']['Row'];
export type SyncStatus = Tables['sync_status']['Row'];
export type SyncJob = Tables['sync_jobs']['Row'];

// Insert types
export type PublisherInsert = Tables['publishers']['Insert'];
export type DeveloperInsert = Tables['developers']['Insert'];
export type AppInsert = Tables['apps']['Insert'];
export type DailyMetricInsert = Tables['daily_metrics']['Insert'];
export type ReviewHistogramInsert = Tables['review_histogram']['Insert'];
export type SyncStatusInsert = Tables['sync_status']['Insert'];
export type SyncJobInsert = Tables['sync_jobs']['Insert'];

// User system row types
export type UserProfile = Tables['user_profiles']['Row'];
export type CreditTransaction = Tables['credit_transactions']['Row'];
export type CreditReservation = Tables['credit_reservations']['Row'];
export type Waitlist = Tables['waitlist']['Row'];
export type RateLimitState = Tables['rate_limit_state']['Row'];

// User system insert types
export type UserProfileInsert = Tables['user_profiles']['Insert'];
export type CreditTransactionInsert = Tables['credit_transactions']['Insert'];
export type CreditReservationInsert = Tables['credit_reservations']['Insert'];
export type WaitlistInsert = Tables['waitlist']['Insert'];

// Enum types
export type AppType = Enums['app_type'];
export type SyncSource = Enums['sync_source'];
export type TrendDirection = Enums['trend_direction'];

// User system enum types
export type UserRole = Enums['user_role'];
export type WaitlistStatus = Enums['waitlist_status'];
export type CreditTransactionType = Enums['credit_transaction_type'];
export type CreditReservationStatus = Enums['credit_reservation_status'];
