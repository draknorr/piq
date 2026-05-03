'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Check, Minus, Pin, ExternalLink } from 'lucide-react';
import {
  ReviewScoreBadge,
  SteamDeckBadge,
  VelocityTierBadge,
  PlatformIcons,
} from '@/components/data-display/TrendIndicator';
import { GrowthCell } from './GrowthCell';
import { MomentumCell } from './MomentumCell';
import { MethodologyTooltip } from './MethodologyTooltip';
import { EmptyState } from './EmptyState';
import {
  SentimentCell,
  ValueScoreCell,
  VsPublisherCell,
  VelocityCell,
  ControllerCell,
  CCUTierCell,
  AccelerationCell,
  SparklineCell,
} from './cells';
import type { UseSparklineLoaderReturn } from '../hooks/useSparklineLoader';
import {
  APP_COLUMN_DEFINITIONS,
  DEFAULT_APP_COLUMNS,
  type AppColumnId,
} from '../lib/apps-columns';
import { formatCompactNumber, formatPrice } from '../lib/apps-format';
import type { App, SortField, SortOrder } from '../lib/apps-types';

interface AppsTableProps {
  apps: App[];
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  visibleColumns?: AppColumnId[];
  isLoading?: boolean;
  sparklineLoader?: UseSparklineLoaderReturn;
  // Selection props
  isSelected?: (appid: number) => boolean;
  isAllSelected?: boolean;
  isIndeterminate?: boolean;
  onSelectApp?: (appid: number, index: number, shiftKey: boolean) => void;
  onSelectAll?: () => void;
  // M6b: Empty state props
  hasSearch?: boolean;
  hasFilters?: boolean;
  hasPreset?: string | null;
  onClearFilters?: () => void;
}

interface SortHeaderProps {
  field: SortField | null;
  label: string;
  currentSort: SortField;
  currentOrder: SortOrder;
  onSort: (field: SortField) => void;
  tooltipField?: string;
  className?: string;
  isDisabled?: boolean;
}

function SortHeader({
  field,
  label,
  currentSort,
  currentOrder,
  onSort,
  tooltipField,
  className = '',
  isDisabled = false,
}: SortHeaderProps) {
  const isActive = field !== null && currentSort === field;
  const arrow = isActive ? (currentOrder === 'asc' ? ' \u2191' : ' \u2193') : '';

  const handleClick = () => {
    if (!isDisabled && field) {
      onSort(field);
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
        } ${isDisabled ? 'cursor-default hover:text-text-tertiary' : ''}`}
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

/**
 * Format a date string to a readable format
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '\u2014';
  }
}

/**
 * Discount badge for price display
 */
function DiscountBadge({ percent }: { percent: number }) {
  if (percent <= 0) return null;
  return (
    <span className="ml-1 px-1 py-0.5 text-[10px] font-medium bg-accent-green/20 text-accent-green rounded">
      -{percent}%
    </span>
  );
}

/**
 * Free badge for free games
 */
function FreeBadge() {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent-green/15 text-accent-green rounded">
      Free
    </span>
  );
}

/**
 * Delisted badge for games no longer sold on Steam
 */
function DelistedBadge() {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-text-muted/15 text-text-muted rounded">
      Delisted
    </span>
  );
}

/**
 * Varies badge for games with variable pricing (bundles only, no base price)
 */
function VariesBadge() {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent-primary/15 text-accent-primary rounded">
      Varies
    </span>
  );
}

/**
 * Mobile card view for a single app
 */
function MobileAppCard({
  app,
  rank,
  isPinned,
  onPin,
  isPinning,
}: {
  app: App;
  rank: number;
  isPinned: boolean;
  onPin: () => void;
  isPinning: boolean;
}) {
  return (
    <Card variant="interactive" padding="sm">
      {/* Header: Rank + Name + Actions */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-text-muted text-caption">#{rank}</span>
        <Link
          href={`/apps/${app.appid}`}
          className="text-body font-medium text-text-primary hover:text-accent-primary truncate flex-1"
        >
          {app.name}
        </Link>
        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onPin}
            disabled={isPinning}
            className={`p-1.5 rounded transition-colors ${
              isPinned
                ? 'text-accent-primary bg-accent-primary/10'
                : 'text-text-muted hover:text-accent-primary'
            } ${isPinning ? 'opacity-50 cursor-wait' : ''}`}
            title={isPinned ? 'Pinned' : 'Pin'}
          >
            <Pin className={`w-4 h-4 ${isPinned ? 'fill-current' : ''}`} />
          </button>
          <a
            href={`https://store.steampowered.com/app/${app.appid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded text-text-muted hover:text-accent-primary transition-colors"
            title="Open on Steam"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* 2-column metrics grid */}
      <Link href={`/apps/${app.appid}`} className="block">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm">
          <div className="flex justify-between">
            <span className="text-text-tertiary">Peak CCU</span>
            <span className="text-text-secondary">
              {formatCompactNumber(app.ccu_peak)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Growth 7d</span>
            <GrowthCell value={app.ccu_growth_7d_percent} />
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Momentum</span>
            <MomentumCell value={app.momentum_score} />
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Owners</span>
            <span className="text-text-secondary">
              {formatCompactNumber(app.owners_midpoint)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Reviews</span>
            <span className="text-text-secondary">
              {formatCompactNumber(app.total_reviews)}
              {app.positive_percentage !== null && (
                <span className="ml-1">
                  <ReviewScoreBadge score={app.positive_percentage} />
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Price</span>
            <span className="text-text-secondary">
              {app.is_free ? (
                <FreeBadge />
              ) : app.is_delisted ? (
                <DelistedBadge />
              ) : app.price_cents === null ? (
                <VariesBadge />
              ) : (
                <>
                  {formatPrice(app.price_cents)}
                  {app.current_discount_percent > 0 && (
                    <DiscountBadge percent={app.current_discount_percent} />
                  )}
                </>
              )}
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}

/**
 * Format playtime in hours
 */
function formatPlaytime(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '\u2014';
  const hours = minutes / 60;
  if (hours < 1) return `${minutes}m`;
  return `${hours.toFixed(1)}h`;
}

/**
 * Format days as human readable
 */
function formatDays(days: number | null): string {
  if (days === null || days === undefined) return '\u2014';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * Render cell content based on column ID
 */
function renderCell(
  columnId: AppColumnId,
  app: App,
  rank: number,
  sparklineLoader?: UseSparklineLoaderReturn
): React.ReactNode {
  switch (columnId) {
    // ═══════════════════════════════════════════════════════════════════
    // CORE
    // ═══════════════════════════════════════════════════════════════════
    case 'rank':
      return rank;
    case 'name':
      return (
        <Link
          href={`/apps/${app.appid}`}
          className="text-body font-medium text-text-primary hover:text-accent-primary transition-colors"
        >
          {app.name}
        </Link>
      );

    // ═══════════════════════════════════════════════════════════════════
    // ENGAGEMENT
    // ═══════════════════════════════════════════════════════════════════
    case 'avg_playtime_forever':
      return formatPlaytime(app.average_playtime_forever);
    case 'avg_playtime_2weeks':
      return formatPlaytime(app.average_playtime_2weeks);
    case 'active_player_pct':
      return app.active_player_pct !== null
        ? `${app.active_player_pct.toFixed(1)}%`
        : '\u2014';

    // ═══════════════════════════════════════════════════════════════════
    // REVIEWS
    // ═══════════════════════════════════════════════════════════════════
    case 'reviews':
      return (
        <>
          <span>{formatCompactNumber(app.total_reviews)}</span>
          {app.positive_percentage !== null && (
            <span className="ml-1">
              <ReviewScoreBadge score={app.positive_percentage} />
            </span>
          )}
        </>
      );
    case 'positive_percentage':
      return app.positive_percentage !== null
        ? <ReviewScoreBadge score={app.positive_percentage} />
        : '\u2014';
    case 'velocity_7d':
      return <VelocityCell value={app.velocity_7d} />;
    case 'velocity_30d':
      return <VelocityCell value={app.velocity_30d} />;
    case 'velocity_tier':
      return app.velocity_tier
        ? <VelocityTierBadge tier={app.velocity_tier} />
        : '\u2014';
    case 'sentiment_delta':
      return <SentimentCell value={app.sentiment_delta} />;
    case 'review_rate':
      return app.review_rate !== null
        ? `${app.review_rate.toFixed(1)}`
        : '\u2014';

    // ═══════════════════════════════════════════════════════════════════
    // GROWTH
    // ═══════════════════════════════════════════════════════════════════
    case 'ccu_peak':
      return formatCompactNumber(app.ccu_peak);
    case 'ccu_growth_7d':
      return <GrowthCell value={app.ccu_growth_7d_percent} />;
    case 'ccu_growth_30d':
      return <GrowthCell value={app.ccu_growth_30d_percent} />;
    case 'momentum_score':
      return <MomentumCell value={app.momentum_score} />;
    case 'velocity_acceleration':
      return <AccelerationCell value={app.velocity_acceleration} />;
    case 'sparkline':
      // M5b: Lazy-loaded sparkline visualization
      if (sparklineLoader) {
        return (
          <SparklineCell
            appid={app.appid}
            growthPercent={app.ccu_growth_7d_percent}
            registerRow={sparklineLoader.registerRow}
            getSparklineData={sparklineLoader.getSparklineData}
            isLoading={sparklineLoader.isLoading}
          />
        );
      }
      return <span className="text-text-muted">{'\u2014'}</span>;

    // ═══════════════════════════════════════════════════════════════════
    // FINANCIAL
    // ═══════════════════════════════════════════════════════════════════
    case 'price':
      if (app.is_free) {
        return <FreeBadge />;
      }
      if (app.is_delisted) {
        return <DelistedBadge />;
      }
      // Null price but not free = variable pricing (bundles only, no base price)
      if (app.price_cents === null) {
        return <VariesBadge />;
      }
      return (
        <>
          <span>{formatPrice(app.price_cents)}</span>
          {app.current_discount_percent > 0 && (
            <DiscountBadge percent={app.current_discount_percent} />
          )}
        </>
      );
    case 'discount':
      return app.current_discount_percent > 0
        ? <DiscountBadge percent={app.current_discount_percent} />
        : '\u2014';
    case 'owners':
      return formatCompactNumber(app.owners_midpoint);
    case 'value_score':
      return <ValueScoreCell value={app.value_score} isFree={app.is_free} />;

    // ═══════════════════════════════════════════════════════════════════
    // CONTEXT
    // ═══════════════════════════════════════════════════════════════════
    case 'publisher':
      return app.publisher_name && app.publisher_id ? (
        <Link
          href={`/publishers/${app.publisher_id}`}
          className="text-text-secondary hover:text-accent-primary transition-colors truncate block max-w-[140px]"
          title={app.publisher_name}
        >
          {app.publisher_name}
        </Link>
      ) : (
        '\u2014'
      );
    case 'developer':
      return app.developer_name && app.developer_id ? (
        <Link
          href={`/developers/${app.developer_id}`}
          className="text-text-secondary hover:text-accent-primary transition-colors truncate block max-w-[140px]"
          title={app.developer_name}
        >
          {app.developer_name}
        </Link>
      ) : (
        '\u2014'
      );
    case 'vs_publisher_avg':
      return <VsPublisherCell value={app.vs_publisher_avg} />;
    case 'publisher_game_count':
      return app.publisher_game_count !== null
        ? app.publisher_game_count
        : '\u2014';

    // ═══════════════════════════════════════════════════════════════════
    // TIMELINE
    // ═══════════════════════════════════════════════════════════════════
    case 'release_date':
      return formatDate(app.release_date);
    case 'days_live':
      return formatDays(app.days_live);
    case 'hype_duration':
      return app.hype_duration !== null
        ? `${app.hype_duration}d`
        : '\u2014';

    // ═══════════════════════════════════════════════════════════════════
    // PLATFORM
    // ═══════════════════════════════════════════════════════════════════
    case 'steam_deck':
      return app.steam_deck_category
        ? <SteamDeckBadge category={app.steam_deck_category} showLabel />
        : '\u2014';
    case 'platforms':
      return <PlatformIcons platforms={app.platforms} />;
    case 'controller_support':
      return <ControllerCell support={app.controller_support} />;

    // ═══════════════════════════════════════════════════════════════════
    // ACTIVITY
    // ═══════════════════════════════════════════════════════════════════
    case 'ccu_tier':
      return <CCUTierCell tier={app.ccu_tier} />;

    default:
      return '\u2014';
  }
}

/**
 * Checkbox cell for row selection
 * Uses custom button with Lucide icons to match /companies design
 */
function SelectionCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      onClick={onChange}
      className="flex items-center justify-center w-4 h-4 rounded-sm border transition-colors hover:border-accent-primary"
      style={{
        backgroundColor: checked || indeterminate ? 'var(--accent-primary)' : 'var(--input-bg)',
        borderColor: checked || indeterminate ? 'var(--accent-primary)' : 'var(--input-border)',
      }}
      aria-label={ariaLabel}
      title={checked ? 'Deselect' : 'Select'}
    >
      {checked && !indeterminate && <Check className="w-3 h-3 text-white" />}
      {indeterminate && <Minus className="w-3 h-3 text-white" />}
    </button>
  );
}

/**
 * Row actions for pin and external link
 */
function RowActions({
  app,
  isPinned,
  onPin,
  isPinning,
}: {
  app: App;
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
        href={`https://store.steampowered.com/app/${app.appid}`}
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

/**
 * Desktop table row for a single app
 */
function AppRow({
  app,
  rank,
  columns,
  sparklineLoader,
  isSelected,
  onSelect,
  isPinned,
  onPin,
  isPinning,
}: {
  app: App;
  rank: number;
  columns: AppColumnId[];
  sparklineLoader?: UseSparklineLoaderReturn;
  isSelected?: boolean;
  onSelect?: (shiftKey: boolean) => void;
  isPinned: boolean;
  onPin: () => void;
  isPinning: boolean;
}) {
  const handleRowClick = (e: React.MouseEvent) => {
    // Only handle clicks on the row itself, not on links or other interactive elements
    if (
      e.target instanceof HTMLAnchorElement ||
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLButtonElement
    ) {
      return;
    }
    // Only toggle selection if clicking on non-interactive area
    if (onSelect && (e.target as HTMLElement).closest('td')?.classList.contains('select-cell')) {
      return; // Already handled by checkbox
    }
  };

  return (
    <tr
      className={`hover:bg-surface-overlay transition-colors ${
        isSelected ? 'bg-accent-primary/5' : ''
      }`}
      onClick={handleRowClick}
    >
      {/* Selection checkbox cell */}
      {onSelect && (
        <td
          className="select-cell px-3 py-2 w-10"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(e.shiftKey);
          }}
        >
          <SelectionCheckbox
            checked={isSelected ?? false}
            onChange={() => {}}
            ariaLabel={`Select ${app.name}`}
          />
        </td>
      )}
      {columns.map((columnId) => (
        <td
          key={columnId}
          className={`px-3 py-2 text-body-sm text-text-secondary ${
            columnId === 'name' ? 'min-w-[200px]' : ''
          } ${columnId === 'rank' ? 'text-text-muted w-12' : ''}`}
        >
          {renderCell(columnId, app, rank, sparklineLoader)}
        </td>
      ))}
      {/* Actions column */}
      <td className="px-3 py-2">
        <RowActions
          app={app}
          isPinned={isPinned}
          onPin={onPin}
          isPinning={isPinning}
        />
      </td>
    </tr>
  );
}

export function AppsTable({
  apps,
  sortField,
  sortOrder,
  onSort,
  visibleColumns,
  isLoading = false,
  sparklineLoader,
  isSelected,
  isAllSelected = false,
  isIndeterminate = false,
  onSelectApp,
  onSelectAll,
  // M6b: Empty state props
  hasSearch = false,
  hasFilters = false,
  hasPreset = null,
  onClearFilters,
}: AppsTableProps) {
  const columns = visibleColumns ?? DEFAULT_APP_COLUMNS;
  const hasSelection = !!onSelectApp;

  // Pin state management
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [pinningIds, setPinningIds] = useState<Set<number>>(new Set());

  const handlePin = useCallback(async (app: App) => {
    const wasPinned = pinnedIds.has(app.appid);

    // Optimistic update
    setPinningIds((prev) => new Set(prev).add(app.appid));

    try {
      if (wasPinned) {
        // Unpin
        setPinnedIds((prev) => {
          const next = new Set(prev);
          next.delete(app.appid);
          return next;
        });
      } else {
        // Pin
        const response = await fetch('/api/pins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity_type: 'game',
            entity_id: app.appid,
          }),
        });

        if (response.ok) {
          setPinnedIds((prev) => new Set(prev).add(app.appid));
        } else {
          const error = await response.json().catch(() => ({}));
          // If already pinned, mark as pinned
          if (error.error?.includes('already pinned')) {
            setPinnedIds((prev) => new Set(prev).add(app.appid));
          }
        }
      }
    } finally {
      setPinningIds((prev) => {
        const next = new Set(prev);
        next.delete(app.appid);
        return next;
      });
    }
  }, [pinnedIds]);

  if (isLoading) {
    return (
      <Card className="p-8">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin mb-4" />
          <p className="text-body text-text-secondary">Loading games...</p>
        </div>
      </Card>
    );
  }

  if (apps.length === 0) {
    // M6b: Use EmptyState component if clear filters handler is provided
    if (onClearFilters) {
      return (
        <Card>
          <EmptyState
            hasSearch={hasSearch}
            hasFilters={hasFilters}
            hasPreset={hasPreset}
            onClearFilters={onClearFilters}
          />
        </Card>
      );
    }
    // Fallback simple empty state
    return (
      <Card className="p-8 text-center">
        <p className="text-text-secondary">No games found</p>
        <p className="text-caption text-text-muted mt-1">
          Try adjusting your filters
        </p>
      </Card>
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-2">
        {apps.map((app, index) => (
          <MobileAppCard
            key={app.appid}
            app={app}
            rank={index + 1}
            isPinned={pinnedIds.has(app.appid)}
            onPin={() => handlePin(app)}
            isPinning={pinningIds.has(app.appid)}
          />
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto scrollbar-thin rounded-lg border border-border-subtle">
        <table className="w-full">
          <thead className="bg-surface-elevated sticky top-0 z-10">
            <tr>
              {/* Select-all checkbox header */}
              {hasSelection && (
                <th className="px-3 py-2 w-10">
                  <SelectionCheckbox
                    checked={isAllSelected}
                    indeterminate={isIndeterminate}
                    onChange={() => onSelectAll?.()}
                    ariaLabel="Select all visible games"
                  />
                </th>
              )}
              {columns.map((columnId) => {
                const column = APP_COLUMN_DEFINITIONS[columnId];
                if (!column) return null;

                return (
                  <SortHeader
                    key={columnId}
                    field={column.sortField ?? null}
                    label={column.shortLabel || column.label}
                    currentSort={sortField}
                    currentOrder={sortOrder}
                    onSort={onSort}
                    tooltipField={column.methodology ? columnId : undefined}
                    isDisabled={!column.sortable}
                    className={columnId === 'name' ? 'min-w-[200px]' : ''}
                  />
                );
              })}
              {/* Actions column header */}
              <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {apps.map((app, index) => (
              <AppRow
                key={app.appid}
                app={app}
                rank={index + 1}
                columns={columns}
                sparklineLoader={sparklineLoader}
                isSelected={isSelected?.(app.appid)}
                onSelect={
                  onSelectApp
                    ? (shiftKey) => onSelectApp(app.appid, index, shiftKey)
                    : undefined
                }
                isPinned={pinnedIds.has(app.appid)}
                onPin={() => handlePin(app)}
                isPinning={pinningIds.has(app.appid)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
