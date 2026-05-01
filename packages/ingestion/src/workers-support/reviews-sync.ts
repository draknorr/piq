import { getTigerWriter, readDataWriteTarget, type TypedSupabaseClient } from '@publisheriq/database';
import pLimit from 'p-limit';

export type ReviewPromotionBucket =
  | 'launch_critical'
  | 'change_critical'
  | 'active_reviews'
  | 'important_backfill'
  | 'unknown_sweep';

export interface ReviewPromotion {
  appid: number;
  bucket: ReviewPromotionBucket;
  score: number;
  reason: string;
  until: string;
}

const DEFAULT_PROMOTION_CONCURRENCY = 8;

function shouldUseTigerReviews(): boolean {
  return readDataWriteTarget() === 'tiger';
}

interface ReviewPromotionRpcClient {
  rpc(
    fn: 'promote_reviews_sync',
    args: {
      p_appid: number;
      p_bucket: ReviewPromotionBucket;
      p_score: number;
      p_reason: string;
      p_until: string;
    }
  ): Promise<{ error: { message?: string | null } | null }>;
}

function getReviewPromotionRpcClient(
  supabase: TypedSupabaseClient
): ReviewPromotionRpcClient {
  return supabase as unknown as ReviewPromotionRpcClient;
}

function getBucketPriority(bucket: ReviewPromotionBucket): number {
  switch (bucket) {
    case 'launch_critical':
      return 5;
    case 'change_critical':
      return 4;
    case 'active_reviews':
      return 3;
    case 'important_backfill':
      return 2;
    case 'unknown_sweep':
    default:
      return 1;
  }
}

export function isRecentReleaseDate(releaseDate: string | null, days = 7): boolean {
  if (!releaseDate) {
    return false;
  }

  const releaseAt = Date.parse(releaseDate);
  if (Number.isNaN(releaseAt)) {
    return false;
  }

  return releaseAt >= Date.now() - days * 24 * 60 * 60 * 1000;
}

export function isLaunchWindowRelease(
  isReleased: boolean | null | undefined,
  releaseDate: string | null,
  days = 7
): boolean {
  return Boolean(isReleased) && (!releaseDate || isRecentReleaseDate(releaseDate, days));
}

export async function promoteReviewsSync(
  supabase: TypedSupabaseClient,
  promotion: ReviewPromotion
): Promise<void> {
  if (shouldUseTigerReviews()) {
    await getTigerWriter().reviews.promoteReviewsSyncBatch([promotion]);
    return;
  }

  const { error } = await getReviewPromotionRpcClient(supabase).rpc('promote_reviews_sync', {
    p_appid: promotion.appid,
    p_bucket: promotion.bucket,
    p_score: promotion.score,
    p_reason: promotion.reason,
    p_until: promotion.until,
  });

  if (error) {
    throw new Error(`Failed to promote reviews sync for ${promotion.appid}: ${error.message}`);
  }
}

function dedupePromotions(promotions: ReviewPromotion[]): ReviewPromotion[] {
  const byAppid = new Map<number, ReviewPromotion>();

  for (const promotion of promotions) {
    const existing = byAppid.get(promotion.appid);
    if (!existing) {
      byAppid.set(promotion.appid, promotion);
      continue;
    }

    const keepIncoming =
      promotion.score > existing.score ||
      (promotion.score === existing.score &&
        getBucketPriority(promotion.bucket) > getBucketPriority(existing.bucket)) ||
      (promotion.score === existing.score &&
        promotion.bucket === existing.bucket &&
        Date.parse(promotion.until) > Date.parse(existing.until));

    if (keepIncoming) {
      byAppid.set(promotion.appid, promotion);
    }
  }

  return Array.from(byAppid.values());
}

export async function promoteReviewsSyncBatch(
  supabase: TypedSupabaseClient,
  promotions: ReviewPromotion[],
  concurrency = DEFAULT_PROMOTION_CONCURRENCY
): Promise<number> {
  const deduped = dedupePromotions(promotions);
  if (deduped.length === 0) {
    return 0;
  }

  if (shouldUseTigerReviews()) {
    return getTigerWriter().reviews.promoteReviewsSyncBatch(deduped);
  }

  const limit = pLimit(Math.max(1, concurrency));
  await Promise.all(
    deduped.map((promotion) => limit(() => promoteReviewsSync(supabase, promotion)))
  );

  return deduped.length;
}
