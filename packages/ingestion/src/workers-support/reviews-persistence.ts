import {
  getTigerWriter,
  readDataWriteTarget,
  type TigerWriter,
  type TypedSupabaseClient,
} from '@publisheriq/database';
import type { ReviewSummary } from '../apis/reviews.js';

export interface PreviousReviewSyncData {
  consecutiveErrors: number;
  intervalHours: number;
  lastSync: Date | null;
  positiveReviews: number;
  totalReviews: number;
}

interface PersistReviewSummaryParams {
  appid: number;
  env?: NodeJS.ProcessEnv;
  previous: PreviousReviewSyncData | undefined;
  summary: ReviewSummary;
  supabase?: TypedSupabaseClient | null;
  tiger?: TigerWriter;
  today: string;
  velocityTier?: string | null;
}

interface ReviewPersistenceOptions {
  env?: NodeJS.ProcessEnv;
  tiger?: TigerWriter;
}

// The generated DB types lag the review-claim columns used by workers.
// Keep the loose cast scoped to the persistence boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDb(supabase: TypedSupabaseClient): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any;
}

function requireSupabase(
  supabase: TypedSupabaseClient | null | undefined
): TypedSupabaseClient {
  if (!supabase) {
    throw new Error('Supabase client is required for legacy review persistence');
  }

  return supabase;
}

function shouldUseTiger(options: ReviewPersistenceOptions = {}): boolean {
  return readDataWriteTarget(options.env) === 'tiger';
}

export function getIntervalHoursForVelocityTier(velocityTier: string | null | undefined): number {
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

export function normalizeIntervalHours(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 24;
  }

  return Math.max(1, Math.round(value));
}

export async function loadPreviousReviewSyncData(
  supabase: TypedSupabaseClient | null | undefined,
  appIds: number[],
  options: ReviewPersistenceOptions = {}
): Promise<{ previousSyncData: Map<number, PreviousReviewSyncData>; neverSyncedSet: Set<number> }> {
  if (shouldUseTiger(options)) {
    return (options.tiger ?? getTigerWriter(options.env)).reviews.loadPreviousSyncData(appIds);
  }

  if (appIds.length === 0) {
    return {
      neverSyncedSet: new Set<number>(),
      previousSyncData: new Map<number, PreviousReviewSyncData>(),
    };
  }

  const legacySupabase = requireSupabase(supabase);
  const { data: syncStatuses, error: syncError } = await getDb(legacySupabase)
    .from('sync_status')
    .select(
      'appid, last_reviews_sync, last_known_total_reviews, consecutive_errors, reviews_interval_hours'
    )
    .in('appid', appIds);

  if (syncError) {
    throw new Error(`Failed to load sync status rows: ${syncError.message}`);
  }

  const { data: previousMetrics, error: metricsError } = await getDb(legacySupabase)
    .from('daily_metrics')
    .select('appid, total_reviews, positive_reviews')
    .in('appid', appIds)
    .order('metric_date', { ascending: false });

  if (metricsError) {
    throw new Error(`Failed to load previous daily metrics: ${metricsError.message}`);
  }

  const previousSyncData = new Map<number, PreviousReviewSyncData>();

  for (const status of syncStatuses ?? []) {
    previousSyncData.set(status.appid, {
      consecutiveErrors: status.consecutive_errors ?? 0,
      intervalHours: normalizeIntervalHours(status.reviews_interval_hours),
      lastSync: status.last_reviews_sync ? new Date(status.last_reviews_sync) : null,
      positiveReviews: 0,
      totalReviews: status.last_known_total_reviews ?? 0,
    });
  }

  for (const metric of previousMetrics ?? []) {
    const existing = previousSyncData.get(metric.appid);
    if (!existing) {
      continue;
    }

    if (existing.positiveReviews === 0) {
      existing.positiveReviews = metric.positive_reviews ?? 0;
      if (existing.totalReviews === 0) {
        existing.totalReviews = metric.total_reviews ?? 0;
      }
    }
  }

  const neverSyncedSet = new Set<number>();
  for (const status of syncStatuses ?? []) {
    if (status.last_reviews_sync === null) {
      neverSyncedSet.add(status.appid);
    }
  }

  return { previousSyncData, neverSyncedSet };
}

export async function persistReviewSummary({
  appid,
  env,
  previous,
  summary,
  supabase,
  tiger,
  today,
  velocityTier,
}: PersistReviewSummaryParams): Promise<{
  negativeAdded: number;
  nextSyncAt: string;
  nowIso: string;
  positiveAdded: number;
  reviewsAdded: number;
}> {
  if (shouldUseTiger({ env, tiger })) {
    return (tiger ?? getTigerWriter(env)).reviews.persistReviewSummary({
      appid,
      previous,
      summary,
      today,
      velocityTier,
    });
  }

  const previousTotal = previous?.totalReviews ?? 0;
  const previousPositive = previous?.positiveReviews ?? 0;
  const lastSyncTime = previous?.lastSync;

  const reviewsAdded = Math.max(0, summary.totalReviews - previousTotal);
  const positiveAdded = Math.max(0, summary.positiveReviews - previousPositive);
  const negativeAdded = Math.max(0, reviewsAdded - positiveAdded);

  const hoursSinceLastSync = lastSyncTime
    ? (Date.now() - lastSyncTime.getTime()) / (1000 * 60 * 60)
    : null;

  const intervalHours =
    previous?.intervalHours ?? getIntervalHoursForVelocityTier(velocityTier);
  const nextSync = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
  const nowIso = new Date().toISOString();
  const legacySupabase = requireSupabase(supabase);

  const { error: deltaError } = await getDb(legacySupabase).from('review_deltas').upsert(
    {
      appid,
      delta_date: today,
      hours_since_last_sync: hoursSinceLastSync,
      is_interpolated: false,
      negative_added: negativeAdded,
      positive_added: positiveAdded,
      positive_reviews: summary.positiveReviews,
      review_score: summary.reviewScore,
      review_score_desc: summary.reviewScoreDesc,
      reviews_added: reviewsAdded,
      total_reviews: summary.totalReviews,
    },
    { onConflict: 'appid,delta_date' }
  );

  if (deltaError) {
    throw new Error(`Failed to upsert review_deltas row: ${deltaError.message}`);
  }

  const { error: metricsError } = await getDb(legacySupabase).from('daily_metrics').upsert(
    {
      appid,
      metric_date: today,
      negative_reviews: summary.negativeReviews,
      positive_reviews: summary.positiveReviews,
      review_score: summary.reviewScore,
      review_score_desc: summary.reviewScoreDesc,
      total_reviews: summary.totalReviews,
    },
    { onConflict: 'appid,metric_date' }
  );

  if (metricsError) {
    throw new Error(`Failed to upsert daily_metrics row: ${metricsError.message}`);
  }

  const syncUpdate: Record<string, unknown> = {
    consecutive_errors: 0,
    last_error_at: null,
    last_error_message: null,
    last_error_source: null,
    last_known_total_reviews: summary.totalReviews,
    last_reviews_sync: nowIso,
    next_reviews_sync: nextSync.toISOString(),
    reviews_claimed_at: null,
    reviews_claim_expires_at: null,
    reviews_claimed_by: null,
    reviews_priority_override_bucket: null,
    reviews_priority_override_reason: null,
    reviews_priority_override_score: null,
    reviews_priority_override_until: null,
  };

  if (reviewsAdded > 0) {
    syncUpdate.last_activity_at = nowIso;
  }

  const { error: syncError } = await getDb(legacySupabase)
    .from('sync_status')
    .update(syncUpdate)
    .eq('appid', appid);

  if (syncError) {
    throw new Error(`Failed to update sync_status row: ${syncError.message}`);
  }

  return {
    negativeAdded,
    nextSyncAt: nextSync.toISOString(),
    nowIso,
    positiveAdded,
    reviewsAdded,
  };
}
