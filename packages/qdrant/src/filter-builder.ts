/**
 * Qdrant Filter Builder
 *
 * Translates GameFilters and EntityFilters into Qdrant filter format.
 */

import type {
  GameFilters,
  EntityFilters,
  RangeFilter,
  PopularityComparison,
  ReviewComparison,
} from './types.js';

// Qdrant filter types (defined locally since not exported by client)
export interface QdrantCondition {
  key: string;
  match?: { value: string | number | boolean } | { any: (string | number)[] };
  range?: { gte?: number; lte?: number; gt?: number; lt?: number };
}

export interface QdrantFilter {
  must?: QdrantCondition[];
  must_not?: QdrantCondition[];
  should?: QdrantCondition[];
}

/**
 * Build Qdrant filter from GameFilters
 */
export function buildGameFilter(
  filters: GameFilters,
  sourceMetrics?: {
    total_reviews?: number | null;
    review_percentage?: number;
    price_cents?: number;
    publisher_ids?: number[];
    developer_ids?: number[];
    franchise_ids?: number[];
  }
): QdrantFilter | undefined {
  const must: QdrantCondition[] = [];
  const must_not: QdrantCondition[] = [];

  // Type filter
  if (filters.types?.length) {
    must.push({
      key: 'type',
      match: { any: filters.types },
    });
  }

  // Genre/Tag/Category - any match
  if (filters.genres?.length) {
    must.push({
      key: 'genres',
      match: { any: filters.genres },
    });
  }

  if (filters.tags?.length) {
    must.push({
      key: 'tags',
      match: { any: filters.tags },
    });
  }

  if (filters.categories?.length) {
    must.push({
      key: 'categories',
      match: { any: filters.categories },
    });
  }

  // Price filters
  if (filters.is_free !== undefined) {
    must.push({
      key: 'is_free',
      match: { value: filters.is_free },
    });
  }

  if (filters.price_tiers?.length) {
    must.push({
      key: 'price_tier',
      match: { any: filters.price_tiers },
    });
  }

  if (filters.price_range) {
    const range = buildRange(filters.price_range);
    if (range) {
      must.push({ key: 'price_cents', range });
    }
  }

  // Rating filters
  if (filters.review_score) {
    const range = buildRange(filters.review_score);
    if (range) {
      must.push({ key: 'review_score', range });
    }
  }

  if (filters.review_percentage) {
    const range = buildRange(filters.review_percentage);
    if (range) {
      must.push({ key: 'review_percentage', range });
    }
  }

  if (filters.min_reviews !== undefined) {
    must.push({
      key: 'total_reviews',
      range: { gte: filters.min_reviews },
    });
  }

  if (filters.max_reviews !== undefined) {
    must.push({
      key: 'total_reviews',
      range: { lte: filters.max_reviews },
    });
  }

  // Popularity filters
  if (filters.owners_tiers?.length) {
    must.push({
      key: 'owners_tier',
      match: { any: filters.owners_tiers },
    });
  }

  if (filters.ccu_tiers?.length) {
    must.push({
      key: 'ccu_tier',
      match: { any: filters.ccu_tiers },
    });
  }

  // Date filters
  if (filters.release_year) {
    const range = buildRange(filters.release_year);
    if (range) {
      must.push({ key: 'release_year', range });
    }
  }

  // Platform filters
  if (filters.platforms?.length) {
    must.push({
      key: 'platforms',
      match: { any: filters.platforms },
    });
  }

  if (filters.steam_deck?.length) {
    must.push({
      key: 'steam_deck',
      match: { any: filters.steam_deck },
    });
  }

  if (filters.has_controller_support !== undefined) {
    if (filters.has_controller_support) {
      // Has any controller support
      must.push({
        key: 'controller_support',
        match: { any: ['full', 'partial'] },
      });
    }
  }

  // Status filters
  if (filters.is_released !== undefined) {
    must.push({
      key: 'is_released',
      match: { value: filters.is_released },
    });
  }

  if (filters.exclude_delisted) {
    must.push({
      key: 'is_delisted',
      match: { value: false },
    });
  }

  // Exclusions
  if (filters.exclude_appids?.length) {
    for (const appid of filters.exclude_appids) {
      must_not.push({
        key: 'appid',
        match: { value: appid },
      });
    }
  }

  // Relative exclusions (requires source context)
  if (sourceMetrics) {
    if (filters.exclude_same_publisher && sourceMetrics.publisher_ids?.length) {
      for (const id of sourceMetrics.publisher_ids) {
        must_not.push({
          key: 'publisher_ids',
          match: { value: id },
        });
      }
    }

    if (filters.exclude_same_developer && sourceMetrics.developer_ids?.length) {
      for (const id of sourceMetrics.developer_ids) {
        must_not.push({
          key: 'developer_ids',
          match: { value: id },
        });
      }
    }

    if (filters.exclude_same_franchise && sourceMetrics.franchise_ids?.length) {
      for (const id of sourceMetrics.franchise_ids) {
        must_not.push({
          key: 'franchise_ids',
          match: { value: id },
        });
      }
    }

    if (filters.same_franchise_only && sourceMetrics.franchise_ids?.length) {
      must.push({
        key: 'franchise_ids',
        match: { any: sourceMetrics.franchise_ids },
      });
    }

    // Popularity comparison (uses total_reviews as popularity proxy)
    if (filters.popularity_comparison) {
      const popularityFilter = buildPopularityFilter(
        filters.popularity_comparison,
        sourceMetrics.total_reviews
      );
      if (popularityFilter) {
        must.push(popularityFilter);
      }
    }

    // Review comparison
    if (filters.review_comparison && sourceMetrics.review_percentage !== undefined) {
      const reviewFilter = buildReviewFilter(
        filters.review_comparison,
        sourceMetrics.review_percentage
      );
      if (reviewFilter) {
        must.push(reviewFilter);
      }
    }
  }

  // Return undefined if no conditions
  if (must.length === 0 && must_not.length === 0) {
    return undefined;
  }

  return {
    must: must.length > 0 ? must : undefined,
    must_not: must_not.length > 0 ? must_not : undefined,
  };
}

/**
 * Build Qdrant filter from EntityFilters
 */
export function buildEntityFilter(filters: EntityFilters): QdrantFilter | undefined {
  const must: QdrantCondition[] = [];
  const must_not: QdrantCondition[] = [];

  if (filters.game_count) {
    const range = buildRange(filters.game_count);
    if (range) {
      must.push({ key: 'game_count', range });
    }
  }

  if (filters.avg_review_percentage) {
    const range = buildRange(filters.avg_review_percentage);
    if (range) {
      must.push({ key: 'avg_review_percentage', range });
    }
  }

  if (filters.first_release_year) {
    const range = buildRange(filters.first_release_year);
    if (range) {
      must.push({ key: 'first_release_year', range });
    }
  }

  if (filters.top_genres?.length) {
    must.push({
      key: 'top_genres',
      match: { any: filters.top_genres },
    });
  }

  if (filters.top_tags?.length) {
    must.push({
      key: 'top_tags',
      match: { any: filters.top_tags },
    });
  }

  if (filters.is_major !== undefined) {
    must.push({
      key: 'is_major',
      match: { value: filters.is_major },
    });
  }

  if (filters.is_indie !== undefined) {
    must.push({
      key: 'is_indie',
      match: { value: filters.is_indie },
    });
  }

  if (must.length === 0 && must_not.length === 0) {
    return undefined;
  }

  return {
    must: must.length > 0 ? must : undefined,
    must_not: must_not.length > 0 ? must_not : undefined,
  };
}

/**
 * Build range condition
 */
function buildRange(
  range: RangeFilter
): { gte?: number; lte?: number; gt?: number; lt?: number } | undefined {
  const result: { gte?: number; lte?: number; gt?: number; lt?: number } = {};

  if (range.gte !== undefined) result.gte = range.gte;
  if (range.lte !== undefined) result.lte = range.lte;
  if (range.gt !== undefined) result.gt = range.gt;
  if (range.lt !== undefined) result.lt = range.lt;

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Build popularity comparison filter using total_reviews
 * Uses ratio-based filtering since actual review counts are available
 */
function buildPopularityFilter(
  comparison: PopularityComparison,
  sourceTotalReviews: number | null | undefined
): QdrantCondition | undefined {
  // If source has no review data, can't do relative comparison
  if (sourceTotalReviews === null || sourceTotalReviews === undefined) {
    return undefined;
  }

  // Define thresholds for popularity comparison
  // less_popular: < 50% of source reviews
  // similar: 50% - 200% of source reviews
  // more_popular: > 200% of source reviews

  switch (comparison) {
    case 'less_popular':
      // Games with fewer reviews than half the source
      return {
        key: 'total_reviews',
        range: { lt: Math.floor(sourceTotalReviews * 0.5) },
      };

    case 'similar':
      // Games with similar review counts (50% to 200%)
      return {
        key: 'total_reviews',
        range: {
          gte: Math.floor(sourceTotalReviews * 0.5),
          lte: Math.ceil(sourceTotalReviews * 2),
        },
      };

    case 'more_popular':
      // Games with more than double the reviews
      return {
        key: 'total_reviews',
        range: { gt: Math.ceil(sourceTotalReviews * 2) },
      };

    case 'any':
    default:
      return undefined;
  }
}

/**
 * Build review comparison filter
 */
function buildReviewFilter(
  comparison: ReviewComparison,
  sourcePercentage: number
): QdrantCondition | undefined {
  switch (comparison) {
    case 'similar_or_better':
      // Within 5% or better
      return {
        key: 'review_percentage',
        range: { gte: Math.max(0, sourcePercentage - 5) },
      };

    case 'better_only':
      // Strictly better
      return {
        key: 'review_percentage',
        range: { gt: sourcePercentage },
      };

    case 'any':
    default:
      return undefined;
  }
}
