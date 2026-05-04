'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Command } from 'lucide-react';
import { ToastProvider, useToastActions } from '@/components/ui/Toast';
import { CompanyTypeToggle } from './CompanyTypeToggle';
import { CompaniesTable } from './CompaniesTable';
import { SearchBar } from './SearchBar';
import { UnifiedFilterBar } from './UnifiedFilterBar';
import { ContextBar } from './ContextBar';
import { ActiveFilterBar } from './ActiveFilterBar';
import { CommandPalette } from './command-palette';
import { BulkActionsBar } from './BulkActionsBar';
import { CompareMode } from './CompareMode';
import { ExportDialog } from './ExportDialog';
import { EmptyState } from './EmptyState';
import { useCompaniesFilters, type AdvancedFiltersState } from '../hooks/useCompaniesFilters';
import { useSparklineLoader } from '../hooks/useSparklineLoader';
import { useCompaniesSelection } from '../hooks/useCompaniesSelection';
import { useCompaniesCompare } from '../hooks/useCompaniesCompare';
import { useCommandPalette, useCommandPaletteShortcut } from '../hooks/useCommandPalette';
import { useFilterCounts } from '../hooks/useFilterCounts';
import type { AggregateStats, Company, CompanyType, SortField, SortOrder, SavedView, PresetId, QuickFilterId } from '../lib/companies-types';

interface CompaniesPageClientProps {
  initialData: Company[];
  initialType: CompanyType;
  initialSort: SortField;
  initialOrder: SortOrder;
  initialSearch: string;
  initialPreset: string | null;
  aggregateStats: AggregateStats;
  // initialColumns is parsed from URL in useCompaniesFilters hook
  // M6a: Compare companies (fetched server-side based on URL param)
  compareCompanies: Company[];
}

export function CompaniesPageClient(props: CompaniesPageClientProps) {
  return (
    <ToastProvider>
      <CompaniesPageClientInner {...props} />
    </ToastProvider>
  );
}

function CompaniesPageClientInner({
  initialData,
  initialType,
  initialSort,
  initialOrder,
  initialSearch,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initialPreset,
  aggregateStats,
  compareCompanies,
}: CompaniesPageClientProps) {
  const router = useRouter();
  const toast = useToastActions();

  // M6b: Export dialog state
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'filtered' | 'selected'>('filtered');
  const [isPinning, setIsPinning] = useState(false);

  const {
    isPending,
    activePreset,
    activeQuickFilters,
    advancedFilters,
    advancedFilterCount,
    visibleColumns,
    setType,
    setSort,
    setSearch,
    toggleQuickFilter,
    applyPreset,
    clearPreset,
    clearAllFilters,
    // M4a
    setAdvancedFilter,
    // M4b
    setGenresWithMode,
    setTags,
    setCategories,
    // M5
    setColumns,
  } = useCompaniesFilters();

  // Sparkline lazy loader
  const sparklineLoader = useSparklineLoader();

  // Filter counts for command palette content views
  const filterCounts = useFilterCounts();

  // Command palette state
  const commandPalette = useCommandPalette({
    initialTags: advancedFilters.tags,
    initialTagMode: advancedFilters.genreMode ?? 'any', // Reuse genre mode for tags
    initialGenres: advancedFilters.genres,
    initialGenreMode: advancedFilters.genreMode ?? 'all',
    initialCategories: advancedFilters.categories,
    onApplyTags: setTags,
    onApplyGenres: (genres, mode) => {
      setGenresWithMode(genres, mode);
    },
    onApplyCategories: setCategories,
  });

  // Global keyboard shortcut for command palette
  useCommandPaletteShortcut(commandPalette.toggle);

  // M6a: Selection state
  const selection = useCompaniesSelection();

  // M6a: Compare state (URL-persisted)
  const compare = useCompaniesCompare();

  // M6b: Get selected companies from data
  const getSelectedCompanies = useCallback((): Company[] => {
    return initialData.filter((company) =>
      selection.selectedIds.has(
        `${company.type === 'publisher' ? 'pub' : 'dev'}:${company.id}`
      )
    );
  }, [initialData, selection.selectedIds]);

  // M6b: Bulk pin handler
  const handleBulkPin = useCallback(async () => {
    const selectedIdentifiers = selection.getSelectedIdentifiers();
    if (selectedIdentifiers.length === 0) return;

    setIsPinning(true);

    try {
      const results = await Promise.allSettled(
        selectedIdentifiers.map(async (identifier) => {
          const company = initialData.find(
            (c) => c.id === identifier.id && c.type === identifier.type
          );
          if (!company) throw new Error('Company not found');

          const response = await fetch('/api/pins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entityType: identifier.type,
              entityId: identifier.id,
              displayName: company.name,
            }),
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            // Ignore already pinned errors
            if (error.error?.includes('already pinned')) {
              return { alreadyPinned: true };
            }
            throw new Error(error.error || 'Failed to pin');
          }

          return response.json();
        })
      );

      const successCount = results.filter(
        (r) => r.status === 'fulfilled'
      ).length;
      const failedCount = results.filter(
        (r) => r.status === 'rejected'
      ).length;

      if (failedCount === 0) {
        toast.success(`Pinned ${successCount} companies to dashboard`);
      } else if (successCount > 0) {
        toast.info(`Pinned ${successCount} companies, ${failedCount} failed`);
      } else {
        toast.error('Failed to pin companies');
      }

      selection.clearSelection();
    } catch (error) {
      console.error('Bulk pin error:', error);
      toast.error('Failed to pin companies');
    } finally {
      setIsPinning(false);
    }
  }, [selection, initialData, toast]);

  // Check if any filters are active (for clear button)
  const hasActiveFilters =
    !!initialSearch ||
    !!activePreset ||
    activeQuickFilters.length > 0 ||
    advancedFilterCount > 0;

  // Handler for clearing individual advanced filter fields from ActiveFilterBar
  const handleClearAdvancedFilter = useCallback(
    (field: keyof AdvancedFiltersState) => {
      setAdvancedFilter(field, undefined);
    },
    [setAdvancedFilter]
  );

  /**
   * Apply a saved view by building and navigating to the URL
   */
  const handleApplyView = useCallback(
    (view: SavedView) => {
      const params = new URLSearchParams();

      // Core params
      if (view.type !== 'all') params.set('type', view.type);
      params.set('sort', view.sort);
      params.set('order', view.order);

      // Metric filters
      const f = view.filters;
      if (f.minGames !== undefined) params.set('minGames', String(f.minGames));
      if (f.maxGames !== undefined) params.set('maxGames', String(f.maxGames));
      if (f.minOwners !== undefined) params.set('minOwners', String(f.minOwners));
      if (f.maxOwners !== undefined) params.set('maxOwners', String(f.maxOwners));
      if (f.minCcu !== undefined) params.set('minCcu', String(f.minCcu));
      if (f.maxCcu !== undefined) params.set('maxCcu', String(f.maxCcu));
      if (f.minHours !== undefined) params.set('minHours', String(f.minHours));
      if (f.maxHours !== undefined) params.set('maxHours', String(f.maxHours));
      if (f.minRevenue !== undefined) params.set('minRevenue', String(f.minRevenue));
      if (f.maxRevenue !== undefined) params.set('maxRevenue', String(f.maxRevenue));
      if (f.minScore !== undefined) params.set('minScore', String(f.minScore));
      if (f.maxScore !== undefined) params.set('maxScore', String(f.maxScore));
      if (f.minReviews !== undefined) params.set('minReviews', String(f.minReviews));
      if (f.maxReviews !== undefined) params.set('maxReviews', String(f.maxReviews));

      // Growth filters
      if (f.minGrowth7d !== undefined) params.set('minGrowth7d', String(f.minGrowth7d));
      if (f.maxGrowth7d !== undefined) params.set('maxGrowth7d', String(f.maxGrowth7d));
      if (f.minGrowth30d !== undefined) params.set('minGrowth30d', String(f.minGrowth30d));
      if (f.maxGrowth30d !== undefined) params.set('maxGrowth30d', String(f.maxGrowth30d));

      // Time period
      if (f.period && f.period !== 'all') params.set('period', f.period);

      // Content filters
      if (f.genres && f.genres.length > 0) params.set('genres', f.genres.join(','));
      if (f.genreMode) params.set('genreMode', f.genreMode);
      if (f.tags && f.tags.length > 0) params.set('tags', f.tags.join(','));
      if (f.categories && f.categories.length > 0) params.set('categories', f.categories.join(','));
      if (f.steamDeck) params.set('steamDeck', f.steamDeck);
      if (f.platforms && f.platforms.length > 0) params.set('platforms', f.platforms.join(','));
      if (f.platformMode) params.set('platformMode', f.platformMode);

      // Status & Relationship
      if (f.status) params.set('status', f.status);
      if (f.relationship) params.set('relationship', f.relationship);

      // M5: Columns
      if (view.columns && view.columns.length > 0) {
        params.set('columns', view.columns.join(','));
      }

      router.push(`/companies?${params.toString()}`);
    },
    [router]
  );

  return (
    <div className={`space-y-3 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Row 1: Type Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <CompanyTypeToggle value={initialType} onChange={setType} disabled={isPending} />
      </div>

      {/* Row 2: Search Bar with Filters button */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchBar
            initialValue={initialSearch}
            onSearch={setSearch}
            isPending={isPending}
            placeholder="Search companies by name..."
          />
        </div>
        <button
          onClick={commandPalette.open}
          className="flex items-center gap-2 px-4 py-2 rounded-md
                     bg-accent-primary text-white font-medium
                     shadow-[0_2px_8px_rgba(212,113,106,0.3)]
                     hover:bg-accent-primary-hover hover:shadow-[0_4px_12px_rgba(212,113,106,0.4)]
                     active:shadow-[0_1px_4px_rgba(212,113,106,0.3)]
                     transition-all duration-150
                     text-body-sm"
          title="Open filter palette (⌘K)"
          disabled={isPending}
        >
          <Command className="w-4 h-4" />
          <span>Filters</span>
          <kbd className="px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-medium">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Row 2: Unified Filter Bar (Presets + Quick Filters + Tools) */}
      <UnifiedFilterBar
        activePreset={activePreset}
        activeQuickFilters={activeQuickFilters}
        onSelectPreset={applyPreset}
        onClearPreset={clearPreset}
        onToggleQuickFilter={toggleQuickFilter}
        onClearAll={clearAllFilters}
        visibleColumns={visibleColumns}
        onColumnsChange={setColumns}
        companyType={initialType}
        currentFilters={advancedFilters}
        currentSort={initialSort}
        currentOrder={initialOrder}
        onApplyView={handleApplyView}
        onExport={() => {
          setExportScope('filtered');
          setIsExportDialogOpen(true);
        }}
        canExport={initialData.length > 0}
        hasActiveFilters={hasActiveFilters}
        disabled={isPending}
      />

      {/* Row 3: Active Filter Bar (shows when filters are active) */}
      {hasActiveFilters && (
        <ActiveFilterBar
          activePreset={activePreset}
          activeQuickFilters={activeQuickFilters}
          advancedFilters={advancedFilters}
          genreOptions={filterCounts.data.genre}
          tagOptions={filterCounts.data.tag}
          categoryOptions={filterCounts.data.category}
          resultCount={aggregateStats.total_companies}
          onClearPreset={clearPreset}
          onToggleQuickFilter={toggleQuickFilter}
          onClearAdvancedFilter={handleClearAdvancedFilter}
          onClearAll={clearAllFilters}
          onOpenPalette={commandPalette.open}
        />
      )}

      {/* Row 4: Context Bar (conditional - shows stats when filters active) */}
      {advancedFilterCount > 0 && (
        <ContextBar
          stats={aggregateStats}
          isLoading={isPending}
        />
      )}

      {/* Companies Table (M5: dynamic columns + sparklines) */}
      {initialData.length > 0 ? (
        <CompaniesTable
          companies={initialData}
          sortField={initialSort}
          sortOrder={initialOrder}
          onSort={setSort}
          visibleColumns={visibleColumns}
          sparklineLoader={sparklineLoader}
          companyType={initialType}
          // M6a: Selection props
          selectionEnabled
          selectedIds={selection.selectedIds}
          onToggleSelection={selection.toggleSelection}
          onToggleAllVisible={selection.toggleAllVisible}
          isAllVisibleSelected={selection.isAllVisibleSelected(initialData)}
          isIndeterminate={selection.isIndeterminate(initialData)}
        />
      ) : (
        <EmptyState
          hasSearch={!!initialSearch}
          hasFilters={advancedFilterCount > 0 || activeQuickFilters.length > 0}
          hasPreset={activePreset}
          onClearFilters={clearAllFilters}
        />
      )}

      {/* M6a: Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selection.selectedCount}
        canCompare={selection.selectedCount >= 2 && selection.selectedCount <= 5}
        onCompare={() => {
          compare.openCompare(selection.getSelectedIdentifiers());
        }}
        onPinAll={handleBulkPin}
        onExport={() => {
          setExportScope('selected');
          setIsExportDialogOpen(true);
        }}
        onClear={selection.clearSelection}
        isPinning={isPinning}
      />

      {/* M6a: Compare Mode Modal */}
      {compare.isCompareOpen && compareCompanies.length >= 2 && (
        <CompareMode
          companies={compareCompanies}
          aggregateStats={aggregateStats}
          onClose={compare.closeCompare}
          onRemove={compare.removeFromCompare}
          sparklineLoader={sparklineLoader}
        />
      )}

      {/* M6b: Export Dialog */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        companies={initialData}
        selectedCompanies={getSelectedCompanies()}
        visibleColumns={visibleColumns}
        filterDescription={{
          type: initialType !== 'all' ? initialType : undefined,
          search: initialSearch || undefined,
          minRevenue: advancedFilters.minRevenue,
          minGames: advancedFilters.minGames,
        }}
        defaultScope={exportScope}
      />

      {/* Command Palette Modal */}
      <CommandPalette
        palette={commandPalette}
        tagOptions={filterCounts.data.tag}
        genreOptions={filterCounts.data.genre}
        categoryOptions={filterCounts.data.category}
        tagsLoading={filterCounts.loading.tag}
        genresLoading={filterCounts.loading.genre}
        categoriesLoading={filterCounts.loading.category}
        onTagsOpen={() => filterCounts.fetchCounts('tag', initialType)}
        onGenresOpen={() => filterCounts.fetchCounts('genre', initialType)}
        onCategoriesOpen={() => filterCounts.fetchCounts('category', initialType)}
        activePreset={activePreset}
        activeQuickFilters={activeQuickFilters}
        onApplyPreset={(id) => applyPreset(id as PresetId)}
        onToggleQuickFilter={(id) => toggleQuickFilter(id as QuickFilterId)}
      />
    </div>
  );
}
