'use client';

import { formatCompactNumber, formatRevenue } from '../lib/companies-format';
import type { AggregateStats } from '../lib/companies-types';

interface ContextBarProps {
  stats: AggregateStats;
  isLoading?: boolean;
}

/**
 * Context bar showing inline aggregate stats.
 * Only visible when filters are active.
 */
export function ContextBar({
  stats,
  isLoading,
}: ContextBarProps) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-surface-elevated/50 rounded-lg border border-border-subtle text-body-sm text-text-tertiary">
      {isLoading ? (
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 w-20 bg-surface-overlay rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <span className="whitespace-nowrap">
            <span className="font-medium text-text-secondary">
              {formatCompactNumber(stats.total_companies)}
            </span>{' '}
            companies
          </span>
          <span className="text-border-muted">·</span>
          <span className="whitespace-nowrap">
            <span className="font-medium text-text-secondary">
              {formatRevenue(stats.total_revenue)}
            </span>{' '}
            revenue
          </span>
          <span className="text-border-muted">·</span>
          <span className="whitespace-nowrap">
            <span className="font-medium text-text-secondary">
              {formatCompactNumber(stats.total_ccu)}
            </span>{' '}
            CCU
          </span>
          <span className="text-border-muted hidden sm:inline">·</span>
          <span className="whitespace-nowrap hidden sm:inline">
            <span className="font-medium text-text-secondary">
              {formatCompactNumber(stats.total_games)}
            </span>{' '}
            games
          </span>
        </>
      )}
    </div>
  );
}
