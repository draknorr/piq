/**
 * DailyMetrics Cube - Time-series game metrics
 *
 * Provides historical metrics including owners, CCU, reviews,
 * and pricing data with rollup pre-aggregations.
 */

cube('DailyMetrics', {
  sql: `SELECT * FROM daily_metrics`,

  joins: {
    Apps: {
      relationship: 'many_to_one',
      sql: `${CUBE}.appid = ${Apps}.appid`,
    },
  },

  dimensions: {
    id: {
      sql: `id`,
      type: 'number',
      primaryKey: true,
    },
    appid: {
      sql: `appid`,
      type: 'number',
    },
    metricDate: {
      sql: `metric_date`,
      type: 'time',
    },
    // Owner estimates
    ownersMin: {
      sql: `owners_min`,
      type: 'number',
    },
    ownersMax: {
      sql: `owners_max`,
      type: 'number',
    },
    ownersMidpoint: {
      sql: `(owners_min + owners_max) / 2`,
      type: 'number',
      description: 'Midpoint of owner estimate range',
    },
    // Activity
    ccuPeak: {
      sql: `ccu_peak`,
      type: 'number',
    },
    avgPlaytimeForever: {
      sql: `average_playtime_forever`,
      type: 'number',
      description: 'Average playtime in minutes',
    },
    avgPlaytime2Weeks: {
      sql: `average_playtime_2weeks`,
      type: 'number',
    },
    // Reviews
    totalReviews: {
      sql: `total_reviews`,
      type: 'number',
    },
    positiveReviews: {
      sql: `positive_reviews`,
      type: 'number',
    },
    negativeReviews: {
      sql: `negative_reviews`,
      type: 'number',
    },
    reviewScore: {
      sql: `review_score`,
      type: 'number',
      description: 'Review score 1-9',
    },
    reviewScoreDesc: {
      sql: `review_score_desc`,
      type: 'string',
    },
    positivePercentage: {
      sql: `CASE WHEN total_reviews > 0 THEN ROUND(positive_reviews * 100.0 / total_reviews, 1) ELSE NULL END`,
      type: 'number',
    },
    // Pricing
    priceCents: {
      sql: `price_cents`,
      type: 'number',
    },
    discountPercent: {
      sql: `discount_percent`,
      type: 'number',
    },
  },

  measures: {
    count: {
      type: 'count',
      description: 'Number of metric records',
    },
    // Owners
    sumOwners: {
      sql: `(owners_min + owners_max) / 2`,
      type: 'sum',
    },
    avgOwners: {
      sql: `(owners_min + owners_max) / 2`,
      type: 'avg',
    },
    maxOwners: {
      sql: `owners_max`,
      type: 'max',
    },
    // CCU
    sumCcu: {
      sql: `ccu_peak`,
      type: 'sum',
    },
    avgCcu: {
      sql: `ccu_peak`,
      type: 'avg',
    },
    maxCcu: {
      sql: `ccu_peak`,
      type: 'max',
    },
    // Reviews
    sumTotalReviews: {
      sql: `total_reviews`,
      type: 'sum',
    },
    sumPositiveReviews: {
      sql: `positive_reviews`,
      type: 'sum',
    },
    sumNegativeReviews: {
      sql: `negative_reviews`,
      type: 'sum',
    },
    avgReviewScore: {
      sql: `review_score`,
      type: 'avg',
    },
    // Playtime
    avgPlaytime: {
      sql: `average_playtime_forever`,
      type: 'avg',
    },
    // Latest values (for most recent snapshot)
    latestTotalReviews: {
      sql: `total_reviews`,
      type: 'max',
      description: 'Most recent total review count',
    },
    latestCcu: {
      sql: `ccu_peak`,
      type: 'max',
    },
  },

  preAggregations: {
    // Daily rollup by app (for individual game charts)
    dailyByApp: {
      measures: [sumCcu, sumTotalReviews, sumPositiveReviews, avgReviewScore],
      dimensions: [appid],
      timeDimension: metricDate,
      granularity: 'day',
      partitionGranularity: 'month',
      refreshKey: {
        every: '1 hour',
        incremental: true,
        updateWindow: '30 days',
      },
    },
    // Weekly aggregate across all games (for dashboard)
    weeklyAggregate: {
      measures: [sumOwners, sumCcu, sumTotalReviews, avgReviewScore, count],
      timeDimension: metricDate,
      granularity: 'week',
      refreshKey: {
        every: '6 hours',
        incremental: true,
        updateWindow: '90 days',
      },
    },
    // Monthly trends (for long-term analysis)
    monthlyTrends: {
      measures: [sumOwners, sumCcu, sumTotalReviews, avgReviewScore],
      timeDimension: metricDate,
      granularity: 'month',
      refreshKey: {
        every: '24 hours',
        incremental: true,
        updateWindow: '12 months',
      },
    },
  },
});

/**
 * LatestMetrics View - Most recent metrics per app
 *
 * Uses the latest_daily_metrics materialized view for fast queries.
 * The materialized view is pre-computed and indexed.
 */
cube('LatestMetrics', {
  sql: `SELECT * FROM latest_daily_metrics`,

  dimensions: {
    appid: {
      sql: `appid`,
      type: 'number',
      primaryKey: true,
    },
    metricDate: {
      sql: `metric_date`,
      type: 'time',
    },
    ownersMin: {
      sql: `owners_min`,
      type: 'number',
    },
    ownersMax: {
      sql: `owners_max`,
      type: 'number',
    },
    ownersMidpoint: {
      sql: `(owners_min + owners_max) / 2`,
      type: 'number',
    },
    ccuPeak: {
      sql: `ccu_peak`,
      type: 'number',
    },
    totalReviews: {
      sql: `total_reviews`,
      type: 'number',
    },
    positiveReviews: {
      sql: `positive_reviews`,
      type: 'number',
    },
    reviewScore: {
      sql: `review_score`,
      type: 'number',
    },
    positivePercentage: {
      sql: `CASE WHEN total_reviews > 0 THEN ROUND(positive_reviews * 100.0 / total_reviews, 1) ELSE NULL END`,
      type: 'number',
    },
    priceCents: {
      sql: `price_cents`,
      type: 'number',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
    sumOwners: {
      sql: `(owners_min + owners_max) / 2`,
      type: 'sum',
    },
    sumCcu: {
      sql: `ccu_peak`,
      type: 'sum',
    },
    avgReviewScore: {
      sql: `review_score`,
      type: 'avg',
    },
  },

  preAggregations: {
    // Cache latest metrics for all apps
    latestSnapshot: {
      dimensions: [appid, ownersMidpoint, ccuPeak, totalReviews, positivePercentage, reviewScore],
      refreshKey: {
        every: '6 hours',
      },
    },
  },
});
