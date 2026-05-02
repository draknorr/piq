/**
 * ReviewDeltas Cube - Daily review changes
 *
 * Time-series data for per-game review trend charts.
 * Includes both actual API syncs and interpolated data points.
 */

cube('ReviewDeltas', {
  sql: `SELECT * FROM review_deltas`,

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
    deltaDate: {
      sql: `delta_date`,
      type: 'time',
    },
    // Absolute values at sync time
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
      description: 'Review score 1-9',
    },
    reviewScoreDesc: {
      sql: `review_score_desc`,
      type: 'string',
    },
    // Deltas from previous sync
    reviewsAdded: {
      sql: `reviews_added`,
      type: 'number',
      description: 'Reviews added since last sync',
    },
    positiveAdded: {
      sql: `positive_added`,
      type: 'number',
    },
    negativeAdded: {
      sql: `negative_added`,
      type: 'number',
    },
    // Velocity
    dailyVelocity: {
      sql: `daily_velocity`,
      type: 'number',
      description: 'Reviews per day (normalized to 24h)',
    },
    hoursSinceLastSync: {
      sql: `hours_since_last_sync`,
      type: 'number',
    },
    // Data quality
    isInterpolated: {
      sql: `is_interpolated`,
      type: 'boolean',
      description: 'TRUE if estimated, FALSE if from API',
    },
    // Calculated fields
    positivePercentage: {
      sql: `CASE WHEN total_reviews > 0
            THEN ROUND(positive_reviews * 100.0 / total_reviews, 1)
            ELSE NULL END`,
      type: 'number',
    },
    dataSource: {
      sql: `CASE WHEN is_interpolated THEN 'interpolated' ELSE 'actual' END`,
      type: 'string',
      description: 'Whether this is actual or interpolated data',
    },
  },

  measures: {
    count: {
      type: 'count',
      description: 'Number of delta records',
    },
    // Reviews added
    sumReviewsAdded: {
      sql: `reviews_added`,
      type: 'sum',
    },
    sumPositiveAdded: {
      sql: `positive_added`,
      type: 'sum',
    },
    sumNegativeAdded: {
      sql: `negative_added`,
      type: 'sum',
    },
    // Velocity
    avgDailyVelocity: {
      sql: `daily_velocity`,
      type: 'avg',
      description: 'Average reviews per day',
    },
    maxDailyVelocity: {
      sql: `daily_velocity`,
      type: 'max',
    },
    // Latest snapshot
    latestTotalReviews: {
      sql: `total_reviews`,
      type: 'max',
      description: 'Most recent total review count',
    },
    // Data quality
    actualSyncCount: {
      sql: `CASE WHEN NOT is_interpolated THEN 1 ELSE 0 END`,
      type: 'sum',
      description: 'Number of actual API syncs',
    },
    interpolatedCount: {
      sql: `CASE WHEN is_interpolated THEN 1 ELSE 0 END`,
      type: 'sum',
      description: 'Number of interpolated records',
    },
  },

  segments: {
    // Only actual API sync data
    actualOnly: {
      sql: `${CUBE}.is_interpolated = FALSE`,
    },
    // Only interpolated data
    interpolatedOnly: {
      sql: `${CUBE}.is_interpolated = TRUE`,
    },
    // Active games (non-zero velocity)
    hasActivity: {
      sql: `${CUBE}.reviews_added > 0`,
    },
    // High velocity games
    highVelocity: {
      sql: `${CUBE}.daily_velocity >= 5`,
    },
  },

  preAggregations: {
    // Daily rollup for individual game charts
    dailyByApp: {
      measures: [sumReviewsAdded, avgDailyVelocity, latestTotalReviews],
      dimensions: [appid, isInterpolated],
      timeDimension: deltaDate,
      granularity: 'day',
      partitionGranularity: 'month',
      refreshKey: {
        every: '1 hour',
        incremental: true,
        updateWindow: '30 days',
      },
    },
    // Weekly aggregate for dashboard
    weeklyAggregate: {
      measures: [sumReviewsAdded, avgDailyVelocity, actualSyncCount, count],
      timeDimension: deltaDate,
      granularity: 'week',
      refreshKey: {
        every: '6 hours',
        incremental: true,
        updateWindow: '90 days',
      },
    },
  },
});
