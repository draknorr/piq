/**
 * Utilities for company comparison calculations
 */

import type { AggregateStats, Company, CompareMetricRow } from './companies-types';
import {
  formatCompactNumber,
  formatRevenue,
  formatHours,
  getReviewPercentage,
} from './companies-format';

/**
 * Metric definition for comparison
 */
interface MetricDefinition {
  id: string;
  label: string;
  category: CompareMetricRow['category'];
  getValue: (company: Company) => number | null;
  format: (value: number | null) => string;
  higherIsBetter: boolean;
  getAvgFromStats?: (stats: AggregateStats, totalCompanies: number) => number | null;
}

/**
 * All metrics available for comparison
 */
export const COMPARE_METRICS: MetricDefinition[] = [
  // Engagement
  {
    id: 'hours',
    label: 'Weekly Hours',
    category: 'engagement',
    getValue: (c) => c.estimated_weekly_hours,
    format: formatHours,
    higherIsBetter: true,
  },
  {
    id: 'owners',
    label: 'Total Owners',
    category: 'engagement',
    getValue: (c) => c.total_owners,
    format: formatCompactNumber,
    higherIsBetter: true,
    getAvgFromStats: (stats, count) => count > 0 ? stats.total_owners / count : null,
  },
  {
    id: 'ccu',
    label: 'Peak CCU',
    category: 'engagement',
    getValue: (c) => c.total_ccu,
    format: formatCompactNumber,
    higherIsBetter: true,
    getAvgFromStats: (stats, count) => count > 0 ? stats.total_ccu / count : null,
  },
  // Content
  {
    id: 'games',
    label: 'Games',
    category: 'content',
    getValue: (c) => c.game_count,
    format: (v) => v?.toString() ?? '—',
    higherIsBetter: true,
    getAvgFromStats: (stats, count) => count > 0 ? stats.total_games / count : null,
  },
  {
    id: 'unique_developers',
    label: 'Unique Developers',
    category: 'content',
    getValue: (c) => c.unique_developers,
    format: (v) => v?.toString() ?? '—',
    higherIsBetter: true,
  },
  // Reviews
  {
    id: 'reviews',
    label: 'Total Reviews',
    category: 'reviews',
    getValue: (c) => c.total_reviews,
    format: formatCompactNumber,
    higherIsBetter: true,
  },
  {
    id: 'avg_score',
    label: 'Avg Review Score',
    category: 'reviews',
    getValue: (c) => c.avg_review_score,
    format: (v) => v !== null ? `${Math.round(v)}%` : '—',
    higherIsBetter: true,
    getAvgFromStats: (stats) => stats.avg_review_score,
  },
  {
    id: 'review_percentage',
    label: 'Positive Reviews',
    category: 'reviews',
    getValue: (c) => getReviewPercentage(c.positive_reviews, c.total_reviews),
    format: (v) => v !== null ? `${v}%` : '—',
    higherIsBetter: true,
  },
  {
    id: 'review_velocity',
    label: 'Review Velocity',
    category: 'reviews',
    getValue: (c) => c.review_velocity_7d,
    format: (v) => v !== null ? `${v.toFixed(1)}/day` : '—',
    higherIsBetter: true,
  },
  // Financial
  {
    id: 'revenue',
    label: 'Est. Revenue',
    category: 'financial',
    getValue: (c) => c.revenue_estimate_cents,
    format: formatRevenue,
    higherIsBetter: true,
    getAvgFromStats: (stats, count) => count > 0 ? stats.total_revenue / count : null,
  },
  // Growth
  {
    id: 'growth_7d',
    label: 'CCU Growth (7d)',
    category: 'growth',
    getValue: (c) => c.ccu_growth_7d_percent,
    format: (v) => v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—',
    higherIsBetter: true,
  },
  {
    id: 'growth_30d',
    label: 'CCU Growth (30d)',
    category: 'growth',
    getValue: (c) => c.ccu_growth_30d_percent,
    format: (v) => v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—',
    higherIsBetter: true,
  },
  {
    id: 'trending_up',
    label: 'Trending Up',
    category: 'growth',
    getValue: (c) => c.games_trending_up,
    format: (v) => v?.toString() ?? '—',
    higherIsBetter: true,
  },
  {
    id: 'trending_down',
    label: 'Trending Down',
    category: 'growth',
    getValue: (c) => c.games_trending_down,
    format: (v) => v?.toString() ?? '—',
    higherIsBetter: false,
  },
  // Ratios
  {
    id: 'revenue_per_game',
    label: 'Revenue/Game',
    category: 'ratios',
    getValue: (c) => c.game_count > 0 ? c.revenue_estimate_cents / c.game_count : null,
    format: formatRevenue,
    higherIsBetter: true,
  },
  {
    id: 'owners_per_game',
    label: 'Owners/Game',
    category: 'ratios',
    getValue: (c) => c.game_count > 0 ? c.total_owners / c.game_count : null,
    format: formatCompactNumber,
    higherIsBetter: true,
  },
  {
    id: 'reviews_per_1k_owners',
    label: 'Reviews/1K Owners',
    category: 'ratios',
    getValue: (c) => c.total_owners > 0 ? (c.total_reviews / c.total_owners) * 1000 : null,
    format: (v) => v !== null ? v.toFixed(1) : '—',
    higherIsBetter: true,
  },
];

/**
 * Calculate percentage difference from baseline
 * @returns null if baseline is 0 or values are null
 */
export function calculatePercentDiff(
  value: number | null,
  baseline: number | null
): number | null {
  if (baseline === null || baseline === 0 || value === null) return null;
  return ((value - baseline) / Math.abs(baseline)) * 100;
}

/**
 * Find best and worst indices for a metric
 */
export function findBestWorstIndices(
  values: (number | null)[],
  higherIsBetter: boolean
): { bestIndex: number | null; worstIndex: number | null } {
  const validEntries = values
    .map((v, i) => ({ value: v, index: i }))
    .filter((e) => e.value !== null);

  if (validEntries.length === 0) {
    return { bestIndex: null, worstIndex: null };
  }

  // Sort to find best/worst
  const sorted = [...validEntries].sort((a, b) => {
    const aVal = a.value!;
    const bVal = b.value!;
    return higherIsBetter ? bVal - aVal : aVal - bVal;
  });

  return {
    bestIndex: sorted[0].index,
    worstIndex: sorted[sorted.length - 1].index,
  };
}

/**
 * Build comparison metric rows from companies and aggregate stats
 */
export function buildCompareMetricRows(
  companies: Company[],
  aggregateStats: AggregateStats
): CompareMetricRow[] {
  if (companies.length === 0) return [];

  const totalCompanies = aggregateStats.total_companies;
  // First company is baseline for comparisons

  return COMPARE_METRICS.map((metric) => {
    // Get raw values for all companies
    const values = companies.map((c) => metric.getValue(c));
    const formattedValues = values.map((v) => metric.format(v));

    // Calculate % diff from baseline (first company)
    const baselineValue = values[0];
    const percentDiffs = values.map((v, i) =>
      i === 0 ? null : calculatePercentDiff(v, baselineValue)
    );

    // Calculate "vs Avg" if we have the aggregate function
    let vsAvgValue: number | null = null;
    let vsAvgDiff: number | null = null;
    if (metric.getAvgFromStats && totalCompanies > 0) {
      vsAvgValue = metric.getAvgFromStats(aggregateStats, totalCompanies);
      if (vsAvgValue !== null) {
        // Calculate average of selected companies
        const validValues = values.filter((v): v is number => v !== null);
        if (validValues.length > 0) {
          const selectedAvg = validValues.reduce((a, b) => a + b, 0) / validValues.length;
          vsAvgDiff = calculatePercentDiff(selectedAvg, vsAvgValue);
        }
      }
    }

    // Find best/worst
    const { bestIndex, worstIndex } = findBestWorstIndices(values, metric.higherIsBetter);

    return {
      metricId: metric.id,
      label: metric.label,
      category: metric.category,
      values,
      formattedValues,
      percentDiffs,
      vsAvgValue,
      vsAvgDiff,
      bestIndex,
      worstIndex,
      higherIsBetter: metric.higherIsBetter,
    };
  });
}

/**
 * Group metrics by category for display
 */
export function groupMetricsByCategory(
  rows: CompareMetricRow[]
): Record<string, CompareMetricRow[]> {
  const groups: Record<string, CompareMetricRow[]> = {
    engagement: [],
    content: [],
    reviews: [],
    financial: [],
    growth: [],
    ratios: [],
  };

  for (const row of rows) {
    if (groups[row.category]) {
      groups[row.category].push(row);
    }
  }

  return groups;
}

/**
 * Category labels for display
 */
export const CATEGORY_LABELS: Record<string, string> = {
  engagement: 'Engagement',
  content: 'Content',
  reviews: 'Reviews',
  financial: 'Financial',
  growth: 'Growth',
  ratios: 'Efficiency Ratios',
};

/**
 * Format percent diff for display
 */
export function formatPercentDiff(diff: number | null): string {
  if (diff === null) return '—';
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(0)}%`;
}
