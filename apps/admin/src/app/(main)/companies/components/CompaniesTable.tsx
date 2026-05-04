'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { Check, Minus, Pin, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ReviewScoreBadge } from '@/components/data-display/TrendIndicator';
import { GrowthCell } from './GrowthCell';
import { SparklineCell } from './SparklineCell';
import { DataFreshnessFooter } from './DataFreshnessFooter';
import { MethodologyTooltip } from './MethodologyTooltip';
import {
  formatCompactNumber,
  formatRevenue,
  formatHours,
  getReviewPercentage,
} from '../lib/companies-format';
import {
  COLUMN_DEFINITIONS,
  isRatioColumn,
  type ColumnId,
} from '../lib/companies-columns';
import type { Company, CompanyType, SortField, SortOrder } from '../lib/companies-types';
import { serializeCompanyId } from '../lib/companies-types';
import type { useSparklineLoader } from '../hooks/useSparklineLoader';

interface CompaniesTableProps {
  companies: Company[];
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  visibleColumns: ColumnId[];
  sparklineLoader: ReturnType<typeof useSparklineLoader>;
  companyType: CompanyType;
  // M6a: Selection props
  selectionEnabled?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?: (
    id: number,
    type: 'publisher' | 'developer',
    index: number,
    visibleCompanies: Company[],
    shiftKey?: boolean
  ) => void;
  onToggleAllVisible?: (visibleCompanies: Company[]) => void;
  isAllVisibleSelected?: boolean;
  isIndeterminate?: boolean;
}

interface SortHeaderProps {
  field: SortField | ColumnId;
  label: string;
  currentSort: SortField;
  currentOrder: SortOrder;
  onSort: (field: SortField) => void;
  tooltipField?: string;
  isRatio?: boolean;
  className?: string;
}

function SortHeader({
  field,
  label,
  currentSort,
  currentOrder,
  onSort,
  tooltipField,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isRatio = false,
  className = '',
}: SortHeaderProps) {
  const isActive = currentSort === field;
  const arrow = isActive ? (currentOrder === 'asc' ? ' \u2191' : ' \u2193') : '';

  // Check if column is sortable - ratio columns use client-side sorting
  const column = COLUMN_DEFINITIONS[field as ColumnId];
  const isDisabled = column?.sortable === false;

  const handleClick = () => {
    if (!isDisabled && field) {
      onSort(field as SortField);
    }
  };

  return (
    <th
      className={`px-3 py-2 text-left text-caption font-medium text-text-tertiary whitespace-nowrap ${className}`}
    >
      <button
        onClick={handleClick}
        className={`hover:text-text-primary transition-colors ${
          isActive ? 'text-accent-primary' : ''
        }`}
        disabled={isDisabled}
        title={isDisabled ? 'This column cannot be sorted' : undefined}
      >
        {label}
        {arrow}
      </button>
      {tooltipField && <MethodologyTooltip field={tooltipField} />}
    </th>
  );
}

function RoleBadge({ type }: { type: 'publisher' | 'developer' }) {
  return (
    <Badge
      variant={type === 'publisher' ? 'primary' : 'purple'}
      size="sm"
    >
      {type === 'publisher' ? 'Pub' : 'Dev'}
    </Badge>
  );
}

function TrendingCell({
  up,
  down,
}: {
  up: number | null;
  down: number | null;
}) {
  const upVal = up ?? 0;
  const downVal = down ?? 0;

  if (upVal === 0 && downVal === 0) {
    return <span className="text-text-muted">&mdash;</span>;
  }

  return (
    <span className="inline-flex items-center gap-2 text-body-sm">
      {upVal > 0 && (
        <span className="text-accent-green">
          ↑{upVal}
        </span>
      )}
      {downVal > 0 && (
        <span className="text-accent-red">
          ↓{downVal}
        </span>
      )}
    </span>
  );
}

/**
 * Render a cell value based on column ID
 */
function renderCell(
  columnId: ColumnId,
  company: Company,
  sparklineLoader: ReturnType<typeof useSparklineLoader>
): React.ReactNode {
  const column = COLUMN_DEFINITIONS[columnId];
  if (!column) return null;

  switch (columnId) {
    case 'hours':
      return formatHours(company.estimated_weekly_hours);
    case 'owners':
      return formatCompactNumber(company.total_owners);
    case 'ccu':
      return formatCompactNumber(company.total_ccu);
    case 'games':
      return company.game_count;
    case 'unique_developers':
      return company.unique_developers;
    case 'role':
      return <RoleBadge type={company.type} />;
    case 'reviews': {
      const reviewPct = getReviewPercentage(
        company.positive_reviews,
        company.total_reviews
      );
      return (
        <>
          <span>{formatCompactNumber(company.total_reviews)}</span>
          {reviewPct !== null && (
            <span className="ml-1">
              <ReviewScoreBadge score={reviewPct} />
            </span>
          )}
        </>
      );
    }
    case 'avg_score':
      return company.avg_review_score !== null
        ? `${Math.round(company.avg_review_score)}%`
        : '\u2014';
    case 'review_velocity':
      return company.review_velocity_7d !== null
        ? `${company.review_velocity_7d.toFixed(1)}/day`
        : '\u2014';
    case 'revenue':
      return formatRevenue(company.revenue_estimate_cents);
    case 'growth_7d':
      return <GrowthCell value={company.ccu_growth_7d_percent} />;
    case 'growth_30d':
      return <GrowthCell value={company.ccu_growth_30d_percent} />;
    case 'trending':
      return (
        <TrendingCell
          up={company.games_trending_up}
          down={company.games_trending_down}
        />
      );
    case 'revenue_per_game': {
      const val = company.game_count > 0
        ? company.revenue_estimate_cents / company.game_count
        : null;
      return val !== null ? formatRevenue(val) : '\u2014';
    }
    case 'owners_per_game': {
      const val = company.game_count > 0
        ? company.total_owners / company.game_count
        : null;
      return val !== null ? formatCompactNumber(val) : '\u2014';
    }
    case 'reviews_per_1k_owners': {
      const val = company.total_owners > 0
        ? (company.total_reviews / company.total_owners) * 1000
        : null;
      return val !== null ? val.toFixed(1) : '\u2014';
    }
    case 'sparkline':
      return (
        <SparklineCell
          companyId={company.id}
          companyType={company.type}
          growthPercent={company.ccu_growth_7d_percent}
          registerRow={sparklineLoader.registerRow}
          getSparklineData={sparklineLoader.getSparklineData}
          isLoading={sparklineLoader.isLoading}
        />
      );
    default:
      return '\u2014';
  }
}

/**
 * Get sort field for a column (used for header click handling)
 */
function getColumnSortField(columnId: ColumnId): SortField | null {
  const column = COLUMN_DEFINITIONS[columnId];
  if (!column || column.isRatio) return null;
  return column.sortField ?? null;
}

/**
 * M6b: Build Steam URL for publisher/developer
 */
function getSteamUrl(company: Company): string {
  const vanityOrName = company.steam_vanity_url || encodeURIComponent(company.name);
  const path = company.type === 'publisher' ? 'publisher' : 'developer';
  return `https://store.steampowered.com/${path}/${vanityOrName}`;
}

/**
 * M6b: Row action buttons component
 */
function RowActions({
  company,
  isPinned,
  onPin,
  isPinning,
}: {
  company: Company;
  isPinned: boolean;
  onPin: () => void;
  isPinning: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Pin button */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPin();
        }}
        disabled={isPinning}
        className={`p-1.5 rounded transition-colors ${
          isPinned
            ? 'text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20'
            : 'text-text-muted hover:text-accent-primary hover:bg-surface-overlay'
        } ${isPinning ? 'opacity-50 cursor-wait' : ''}`}
        title={isPinned ? 'Pinned to dashboard' : 'Pin to dashboard'}
      >
        <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
      </button>

      {/* Steam link */}
      <a
        href={getSteamUrl(company)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="p-1.5 rounded text-text-muted hover:text-accent-primary hover:bg-surface-overlay transition-colors"
        title="Open on Steam"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

export function CompaniesTable({
  companies,
  sortField,
  sortOrder,
  onSort,
  visibleColumns,
  sparklineLoader,
  companyType,
  // M6a: Selection props
  selectionEnabled = false,
  selectedIds = new Set(),
  onToggleSelection,
  onToggleAllVisible,
  isAllVisibleSelected = false,
  isIndeterminate = false,
}: CompaniesTableProps) {
  // M6b: Pin state management
  // Track pinned companies and pinning in progress
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [pinningIds, setPinningIds] = useState<Set<string>>(new Set());

  const handlePin = useCallback(async (company: Company) => {
    const key = `${company.type}:${company.id}`;
    const wasPinned = pinnedIds.has(key);

    // Optimistic update
    setPinningIds((prev) => new Set(prev).add(key));

    try {
      if (wasPinned) {
        // Unpin - but we don't have the pin ID, so just update UI
        // In a real implementation, we'd need to track pin IDs
        setPinnedIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } else {
        // Pin
        const response = await fetch('/api/pins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType: company.type,
            entityId: company.id,
            displayName: company.name,
          }),
        });

        if (response.ok) {
          setPinnedIds((prev) => new Set(prev).add(key));
        } else {
          const error = await response.json().catch(() => ({}));
          // If already pinned, mark as pinned
          if (error.error?.includes('already pinned')) {
            setPinnedIds((prev) => new Set(prev).add(key));
          }
        }
      }
    } catch (error) {
      console.error('Pin error:', error);
    } finally {
      setPinningIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [pinnedIds]);

  // Client-side sorting for ratio columns
  const sortedCompanies = useMemo(() => {
    // Check if current sort is a ratio column
    const isRatio = isRatioColumn(sortField as ColumnId);
    if (!isRatio) return companies;

    const column = COLUMN_DEFINITIONS[sortField as ColumnId];
    if (!column) return companies;

    return [...companies].sort((a, b) => {
      const aVal = column.getValue(a) as number | null;
      const bVal = column.getValue(b) as number | null;

      // Handle nulls (push to end)
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [companies, sortField, sortOrder]);

  // Filter columns based on company type
  const effectiveColumns = useMemo(() => {
    let cols = visibleColumns;

    // Hide Role column when viewing specific type (redundant info)
    if (companyType !== 'all') {
      cols = cols.filter((col) => col !== 'role');
    }

    // Hide Unique Devs when viewing developers (always 0, meaningless)
    if (companyType === 'developer') {
      cols = cols.filter((col) => col !== 'unique_developers');
    }

    return cols;
  }, [visibleColumns, companyType]);

  if (companies.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-text-secondary">No companies found</p>
      </Card>
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-2">
        {sortedCompanies.map((company, index) => {
          const isSelected = selectedIds.has(serializeCompanyId(company.id, company.type));
          return (
          <div key={`${company.type}-${company.id}`} className="flex items-stretch gap-2">
            {/* M6a: Selection checkbox */}
            {selectionEnabled && (
              <button
                onClick={(e) =>
                  onToggleSelection?.(
                    company.id,
                    company.type,
                    index,
                    sortedCompanies,
                    e.shiftKey
                  )
                }
                className="flex items-center justify-center w-8 flex-shrink-0"
                aria-label={`Select ${company.name}`}
                title={isSelected ? 'Deselect' : 'Select'}
              >
                <div
                  className="w-5 h-5 rounded-sm border transition-colors flex items-center justify-center"
                  style={{
                    backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--input-bg)',
                    borderColor: isSelected ? 'var(--accent-primary)' : 'var(--input-border)',
                  }}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
              </button>
            )}
            <Link
              href={`/${company.type}s/${company.id}`}
              className="flex-1 min-w-0"
            >
              <Card
                variant="interactive"
                padding="sm"
                className={isSelected ? 'ring-2 ring-accent-primary/50' : ''}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-text-muted text-caption">
                    #{index + 1}
                  </span>
                  <span className="text-body font-medium text-text-primary">
                    {company.name}
                  </span>
                  {companyType === 'all' && <RoleBadge type={company.type} />}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm">
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Weekly Hours</span>
                    <span className="text-text-secondary">
                      {formatHours(company.estimated_weekly_hours)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Games</span>
                    <span className="text-text-secondary">
                      {company.game_count}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Owners</span>
                    <span className="text-text-secondary">
                      {formatCompactNumber(company.total_owners)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Revenue</span>
                    <span className="text-text-secondary">
                      {formatRevenue(company.revenue_estimate_cents)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Growth (7d)</span>
                    <GrowthCell value={company.ccu_growth_7d_percent} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Reviews</span>
                    <span className="text-text-secondary">
                      {formatCompactNumber(company.total_reviews)}
                      {company.avg_review_score !== null && (
                        <span className="text-text-muted ml-1">
                          ({company.avg_review_score}%)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          </div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto scrollbar-thin rounded-lg border border-border-subtle">
        <table className="w-full">
          <thead className="bg-surface-elevated sticky top-0 z-10">
            <tr>
              {/* M6a: Selection checkbox column */}
              {selectionEnabled && (
                <th className="px-3 py-2 w-10">
                  <button
                    onClick={() => onToggleAllVisible?.(sortedCompanies)}
                    className="flex items-center justify-center w-4 h-4 rounded-sm border transition-colors hover:border-accent-primary"
                    style={{
                      backgroundColor: isAllVisibleSelected || isIndeterminate ? 'var(--accent-primary)' : 'var(--input-bg)',
                      borderColor: isAllVisibleSelected || isIndeterminate ? 'var(--accent-primary)' : 'var(--input-border)',
                    }}
                    aria-label="Select all visible companies"
                    title={isAllVisibleSelected ? 'Deselect all' : 'Select all visible'}
                  >
                    {isAllVisibleSelected && <Check className="w-3 h-3 text-white" />}
                    {isIndeterminate && !isAllVisibleSelected && <Minus className="w-3 h-3 text-white" />}
                  </button>
                </th>
              )}
              {/* Fixed columns: Rank, Name */}
              <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary w-12">
                #
              </th>
              <SortHeader
                field="name"
                label="Company"
                currentSort={sortField}
                currentOrder={sortOrder}
                onSort={onSort}
                className="min-w-[200px]"
              />

              {/* Dynamic columns based on effectiveColumns (filtered by company type) */}
              {effectiveColumns.map((columnId) => {
                const column = COLUMN_DEFINITIONS[columnId];
                if (!column) return null;

                const sortFieldForColumn = getColumnSortField(columnId);

                return (
                  <SortHeader
                    key={columnId}
                    field={sortFieldForColumn || columnId}
                    label={column.shortLabel || column.label}
                    currentSort={sortField}
                    currentOrder={sortOrder}
                    onSort={onSort}
                    tooltipField={column.methodology ? columnId : undefined}
                    isRatio={column.isRatio}
                  />
                );
              })}

              {/* M6b: Actions column */}
              <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary w-20">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {sortedCompanies.map((company, index) => {
              const isSelected = selectedIds.has(serializeCompanyId(company.id, company.type));
              return (
              <tr
                key={`${company.type}-${company.id}`}
                className={`hover:bg-surface-overlay transition-colors ${
                  isSelected ? 'bg-accent-primary/5' : ''
                }`}
              >
                {/* M6a: Selection checkbox */}
                {selectionEnabled && (
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) =>
                        onToggleSelection?.(
                          company.id,
                          company.type,
                          index,
                          sortedCompanies,
                          e.shiftKey
                        )
                      }
                      className="flex items-center justify-center w-4 h-4 rounded-sm border transition-colors hover:border-accent-primary"
                      style={{
                        backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--input-bg)',
                        borderColor: isSelected ? 'var(--accent-primary)' : 'var(--input-border)',
                      }}
                      aria-label={`Select ${company.name}`}
                      title={isSelected ? 'Deselect' : 'Select'}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </button>
                  </td>
                )}
                {/* Fixed columns */}
                <td className="px-3 py-2 text-caption text-text-muted">
                  {index + 1}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/${company.type}s/${company.id}`}
                      className="text-body font-medium text-text-primary hover:text-accent-primary transition-colors"
                    >
                      {company.name}
                    </Link>
                    {companyType === 'all' && <RoleBadge type={company.type} />}
                  </div>
                </td>

                {/* Dynamic columns */}
                {effectiveColumns.map((columnId) => (
                  <td
                    key={columnId}
                    className="px-3 py-2 text-body-sm text-text-secondary"
                  >
                    {renderCell(columnId, company, sparklineLoader)}
                  </td>
                ))}

                {/* M6b: Actions column */}
                <td className="px-3 py-2">
                  <RowActions
                    company={company}
                    isPinned={pinnedIds.has(`${company.type}:${company.id}`)}
                    onPin={() => handlePin(company)}
                    isPinning={pinningIds.has(`${company.type}:${company.id}`)}
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Data Freshness Footer */}
      <DataFreshnessFooter
        companies={sortedCompanies}
        resultCount={sortedCompanies.length}
      />
    </>
  );
}
