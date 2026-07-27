'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Command } from 'lucide-react';
import { ToastProvider } from '@/components/ui/Toast';
import { AppTypeToggle } from './AppTypeToggle';
import { AppsTable } from './AppsTable';
import { AppsPagination } from './AppsPagination';
import { SearchBar } from './SearchBar';
import { UnifiedFilterBar } from './UnifiedFilterBar';
import { ContextBar } from './ContextBar';
import { AdvancedFiltersPanel } from './AdvancedFiltersPanel';
import { ActiveFilterBar } from './ActiveFilterBar';
import { DataFreshnessFooter } from './DataFreshnessFooter';
import { BulkActionsBar } from './BulkActionsBar';
import { CompareMode } from './CompareMode';
import { ExportDialog } from './ExportDialog';
import { CommandPalette } from './command-palette';
import { useAppsFilters } from '../hooks/useAppsFilters';
import { useFilterCounts } from '../hooks/useFilterCounts';
import { useSavedViews, type SavedView } from '../hooks/useSavedViews';
import { useSparklineLoader } from '../hooks/useSparklineLoader';
import { useAppsSelection } from '../hooks/useAppsSelection';
import { useAppsCompare } from '../hooks/useAppsCompare';
import { useAppsQuery, buildFilterParamsFromUrl } from '../hooks/useAppsQuery';
import {
  buildAppsPageUrl,
  getAppsPaginationState,
} from '../lib/apps-pagination';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useCommandPalette } from '../hooks/useCommandPalette';
import { useCommandPaletteShortcut } from '../hooks/useKeyboardShortcut';
import type { App, AppType, SortField, SortOrder, AggregateStats, QuickFilterId } from '../lib/apps-types';
import type { FilterDescription } from '../lib/apps-export';
import type { FilterMode } from '../lib/apps-types';

interface AppsPageClientProps {
  initialData: App[];
  initialType: AppType;
  initialSort: SortField;
  initialOrder: SortOrder;
  initialSearch: string;
  aggregateStats: AggregateStats;
  // M6a: Compare mode
  compareApps?: App[];
}

export function AppsPageClient(props: AppsPageClientProps) {
  return (
    <ToastProvider>
      <AppsPageClientInner {...props} />
    </ToastProvider>
  );
}

function AppsPageClientInner({
  initialData,
  aggregateStats: serverAggregateStats,
  compareApps = [],
}: AppsPageClientProps) {
  // Router for client-side navigation
  const router = useRouter();
  const searchParams = useSearchParams();

  // Build filter params from current URL for React Query
  const filterParams = useMemo(
    () => buildFilterParamsFromUrl(searchParams),
    [searchParams]
  );

  // Wait for auth to be ready before making API calls
  // This prevents 401 errors on cold page load when cookies haven't been parsed yet
  const authReady = useAuthReady();

  // Fetch apps data using React Query with client-side caching
  // Deferred until auth is ready to prevent 401 errors on initial load
  const {
    apps: queryApps,
    stats: queryStats,
    isLoading,
    isFetching,
  } = useAppsQuery(filterParams, { enabled: authReady });

  // Use React Query data if available, otherwise fall back to server data
  const apps = queryApps ?? initialData;
  const aggregateStats = queryStats ?? serverAggregateStats;
  const pagination = useMemo(
    () =>
      getAppsPaginationState(
        aggregateStats.total_games,
        filterParams.limit,
        filterParams.offset,
        apps.length
      ),
    [
      aggregateStats.total_games,
      filterParams.limit,
      filterParams.offset,
      apps.length,
    ]
  );

  const handlePageChange = useCallback(
    (nextOffset: number) => {
      router.push(buildAppsPageUrl(searchParams, nextOffset), { scroll: false });
    },
    [router, searchParams]
  );

  // M6a: Selection state management
  const selection = useAppsSelection();

  // M6a: Compare state management (URL-persisted)
  const compare = useAppsCompare();

  // M6a: Check if compare is valid (2-5 selected)
  const canCompare = selection.selectedCount >= 2 && selection.selectedCount <= 5;

  // M6b: Export dialog state
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'filtered' | 'selected'>('filtered');

  // M6a: Handle opening compare mode
  const handleCompare = useCallback(() => {
    if (canCompare) {
      compare.openCompare(selection.getSelectedAppIds());
    }
  }, [canCompare, compare, selection]);

  // M6b: Handle opening export dialog
  const handleExport = useCallback(() => {
    setExportScope(selection.selectedCount > 0 ? 'selected' : 'filtered');
    setIsExportDialogOpen(true);
  }, [selection.selectedCount]);

  // M6b: Get selected apps for export
  const selectedApps = useMemo(() => {
    const selectedIds = selection.getSelectedAppIds();
    return apps.filter((app) => selectedIds.includes(app.appid));
  }, [apps, selection]);

  // Unified filter state management
  const {
    isPending,
    type,
    sort,
    order,
    search,
    activePreset,
    activeQuickFilters,
    hasActiveFilters,
    // M4a: Advanced filters state
    advancedFilters,
    advancedFilterCount,
    isAdvancedOpen,
    // Actions
    setType,
    setSort,
    setSearch,
    toggleQuickFilter,
    applyPreset,
    clearPreset,
    clearAllFilters,
    // M4a: Advanced filter actions
    setAdvancedFilter,
    clearAdvancedFilters,
    applyGrowthPreset,
    applySentimentPreset,
    toggleAdvanced,
    // M4b: Content filter actions
    setGenres,
    setGenreMode,
    setGenresWithMode,
    setTags,
    setTagMode,
    setTagsWithMode,
    setCategories,
    setHasWorkshop,
    // M4b: Platform filter actions
    setPlatforms,
    setPlatformMode,
    setSteamDeck,
    setController,
    // M4b: Release filter actions
    setReleaseYear,
    setMinAge,
    setMaxAge,
    setEarlyAccess,
    setMinHype,
    setMaxHype,
    // M4b: Relationship filter actions
    setPublisherSearch,
    setDeveloperSearch,
    setSelfPublished,
    setPublisherSize,
    setVsPublisher,
    // M4b: Activity filter actions
    setCcuTier,
    // M5a: Column customization
    visibleColumns,
    setVisibleColumns,
  } = useAppsFilters();

  // M6b: Build filter description for export metadata
  const filterDescription: FilterDescription = useMemo(() => ({
    type: type !== 'game' ? type : undefined,
    search: search || undefined,
    preset: activePreset || undefined,
    quickFilters: activeQuickFilters.length > 0 ? activeQuickFilters : undefined,
    minCcu: advancedFilters.minCcu,
    minScore: advancedFilters.minScore,
    minOwners: advancedFilters.minOwners,
    minGrowth7d: advancedFilters.minGrowth7d,
    minMomentum: advancedFilters.minMomentum,
  }), [type, search, activePreset, activeQuickFilters, advancedFilters]);

  // M4b: Filter counts for lazy-loading dropdowns
  const {
    data: filterOptions,
    loading: filterLoading,
    fetchCounts,
  } = useFilterCounts();

  // M4b: Saved views
  const {
    views: savedViews,
    isLoaded: savedViewsLoaded,
    saveView,
    deleteView,
    renameView,
  } = useSavedViews();

  // M5b: Sparkline lazy-loading
  const sparklineLoader = useSparklineLoader();

  // Command Palette state management
  const commandPalette = useCommandPalette({
    initialTags: advancedFilters.tags || [],
    initialTagMode: advancedFilters.tagMode || 'any',
    initialGenres: advancedFilters.genres || [],
    initialGenreMode: advancedFilters.genreMode || 'all',
    initialCategories: advancedFilters.categories || [],
    onApplyFilter: useCallback((params: Record<string, string>) => {
      // Apply parsed filter from syntax (e.g., "ccu > 1000")
      Object.entries(params).forEach(([key, value]) => {
        setAdvancedFilter(key as keyof typeof advancedFilters, value);
      });
    }, [setAdvancedFilter]),
    onApplyTags: useCallback((tags: number[], mode: 'any' | 'all') => {
      // Use combined setter to avoid race condition with separate updateUrl calls
      setTagsWithMode(tags, mode as FilterMode);
    }, [setTagsWithMode]),
    onApplyGenres: useCallback((genres: number[], mode: 'any' | 'all') => {
      // Use combined setter to avoid race condition with separate updateUrl calls
      setGenresWithMode(genres, mode as FilterMode);
    }, [setGenresWithMode]),
    onApplyCategories: useCallback((categories: number[]) => {
      setCategories(categories);
    }, [setCategories]),
  });

  // Global keyboard shortcut for command palette (⌘K / Ctrl+K)
  useCommandPaletteShortcut(commandPalette.toggle);

  // M4b: Memoize context filter object to prevent callback recreation
  const filterCountContext = useMemo(() => ({
    minCcu: advancedFilters.minCcu,
    minReviews: advancedFilters.minReviews,
    minScore: advancedFilters.minScore,
    minOwners: advancedFilters.minOwners,
  }), [
    advancedFilters.minCcu,
    advancedFilters.minReviews,
    advancedFilters.minScore,
    advancedFilters.minOwners,
  ]);

  // M4b: Lazy-load handlers for filter dropdowns
  // BUG-005: Expanded context filters for more accurate counts
  const handleGenreOpen = useCallback(() => {
    fetchCounts('genre', type, filterCountContext);
  }, [fetchCounts, type, filterCountContext]);

  const handleTagOpen = useCallback(() => {
    fetchCounts('tag', type, filterCountContext);
  }, [fetchCounts, type, filterCountContext]);

  const handleCategoryOpen = useCallback(() => {
    fetchCounts('category', type, filterCountContext);
  }, [fetchCounts, type, filterCountContext]);

  // M4b: Save current view handler (M5a: includes columns)
  const handleSaveView = useCallback(
    (name: string) => {
      saveView(name, advancedFilters, visibleColumns, sort, order, type);
    },
    [saveView, advancedFilters, visibleColumns, sort, order, type]
  );

  // M4b: Load saved view handler - reconstructs URL and navigates
  const handleLoadView = useCallback(
    (view: SavedView) => {
      // Build URL params from saved view
      const params = new URLSearchParams();

      if (view.type !== 'game') params.set('type', view.type);
      params.set('sort', view.sort);
      if (view.order !== 'desc') params.set('order', view.order);

      // Apply filter values from saved view
      const f = view.filters;
      if (f.minCcu !== undefined) params.set('minCcu', String(f.minCcu));
      if (f.maxCcu !== undefined) params.set('maxCcu', String(f.maxCcu));
      if (f.minOwners !== undefined) params.set('minOwners', String(f.minOwners));
      if (f.maxOwners !== undefined) params.set('maxOwners', String(f.maxOwners));
      if (f.minReviews !== undefined) params.set('minReviews', String(f.minReviews));
      if (f.maxReviews !== undefined) params.set('maxReviews', String(f.maxReviews));
      if (f.minScore !== undefined) params.set('minScore', String(f.minScore));
      if (f.maxScore !== undefined) params.set('maxScore', String(f.maxScore));
      if (f.minPrice !== undefined) params.set('minPrice', String(f.minPrice));
      if (f.maxPrice !== undefined) params.set('maxPrice', String(f.maxPrice));
      if (f.minPlaytime !== undefined) params.set('minPlaytime', String(f.minPlaytime));
      if (f.maxPlaytime !== undefined) params.set('maxPlaytime', String(f.maxPlaytime));
      if (f.minGrowth7d !== undefined) params.set('minGrowth7d', String(f.minGrowth7d));
      if (f.maxGrowth7d !== undefined) params.set('maxGrowth7d', String(f.maxGrowth7d));
      if (f.minGrowth30d !== undefined) params.set('minGrowth30d', String(f.minGrowth30d));
      if (f.maxGrowth30d !== undefined) params.set('maxGrowth30d', String(f.maxGrowth30d));
      if (f.minMomentum !== undefined) params.set('minMomentum', String(f.minMomentum));
      if (f.maxMomentum !== undefined) params.set('maxMomentum', String(f.maxMomentum));
      if (f.minSentimentDelta !== undefined) params.set('minSentimentDelta', String(f.minSentimentDelta));
      if (f.maxSentimentDelta !== undefined) params.set('maxSentimentDelta', String(f.maxSentimentDelta));
      if (f.velocityTier !== undefined) params.set('velocityTier', f.velocityTier);
      if (f.minActivePct !== undefined) params.set('minActivePct', String(f.minActivePct));
      if (f.minReviewRate !== undefined) params.set('minReviewRate', String(f.minReviewRate));
      if (f.minValueScore !== undefined) params.set('minValueScore', String(f.minValueScore));
      // M4b filters
      if (f.genres && f.genres.length > 0) params.set('genres', f.genres.join(','));
      if (f.genreMode === 'all') params.set('genreMode', 'all');
      if (f.tags && f.tags.length > 0) params.set('tags', f.tags.join(','));
      if (f.tagMode === 'all') params.set('tagMode', 'all');
      if (f.categories && f.categories.length > 0) params.set('categories', f.categories.join(','));
      if (f.hasWorkshop !== undefined) params.set('hasWorkshop', String(f.hasWorkshop));
      if (f.platforms && f.platforms.length > 0) params.set('platforms', f.platforms.join(','));
      if (f.platformMode === 'all') params.set('platformMode', 'all');
      if (f.steamDeck !== undefined) params.set('steamDeck', f.steamDeck);
      if (f.controller !== undefined) params.set('controller', f.controller);
      if (f.minAge !== undefined) params.set('minAge', String(f.minAge));
      if (f.maxAge !== undefined) params.set('maxAge', String(f.maxAge));
      if (f.releaseYear !== undefined) params.set('releaseYear', String(f.releaseYear));
      if (f.earlyAccess !== undefined) params.set('earlyAccess', String(f.earlyAccess));
      if (f.minHype !== undefined) params.set('minHype', String(f.minHype));
      if (f.maxHype !== undefined) params.set('maxHype', String(f.maxHype));
      if (f.publisherSearch !== undefined) params.set('publisherSearch', f.publisherSearch);
      if (f.developerSearch !== undefined) params.set('developerSearch', f.developerSearch);
      if (f.selfPublished !== undefined) params.set('selfPublished', String(f.selfPublished));
      if (f.publisherSize !== undefined) params.set('publisherSize', f.publisherSize);
      if (f.minVsPublisher !== undefined) params.set('minVsPublisher', String(f.minVsPublisher));
      if (f.ccuTier !== undefined) params.set('ccuTier', String(f.ccuTier));

      // M5a: Restore columns from saved view
      if (view.columns && view.columns.length > 0) {
        params.set('columns', view.columns.join(','));
      }

      // Navigate to the constructed URL using client-side routing
      const queryString = params.toString();
      router.push(queryString ? `/apps?${queryString}` : '/apps');
    },
    [router]
  );

  // Combined loading state: URL transition OR React Query fetching
  const isLoadingData = isPending || isFetching;

  // Handler for removing individual filters from ActiveFilterBar
  const handleRemoveFilter = useCallback((filterKey: string, value?: number | string) => {
    if (filterKey === 'preset') {
      clearPreset();
    } else if (filterKey === 'quickFilter' && typeof value === 'string') {
      // Remove specific quick filter by ID
      toggleQuickFilter(value as QuickFilterId);
    } else if (filterKey === 'genre' && typeof value === 'number') {
      // Remove specific genre by ID
      const newGenres = (advancedFilters.genres || []).filter((id) => id !== value);
      setGenres(newGenres);
    } else if (filterKey === 'tag' && typeof value === 'number') {
      // Remove specific tag by ID
      const newTags = (advancedFilters.tags || []).filter((id) => id !== value);
      setTags(newTags);
    } else if (filterKey === 'category' && typeof value === 'number') {
      // Remove specific category by ID
      const newCategories = (advancedFilters.categories || []).filter((id) => id !== value);
      setCategories(newCategories);
    } else {
      // Clear the filter by setting it to undefined
      setAdvancedFilter(filterKey as keyof typeof advancedFilters, undefined);
    }
  }, [
    clearPreset,
    toggleQuickFilter,
    advancedFilters,
    setGenres,
    setTags,
    setCategories,
    setAdvancedFilter,
  ]);

  return (
    <div className={`space-y-4 ${isLoadingData ? 'opacity-60' : ''}`}>
      {/* Row 1: Type Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <AppTypeToggle
          value={type}
          onChange={setType}
          disabled={isLoadingData}
        />
      </div>

      {/* Row 2: Search Bar with Filters button */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchBar
            initialValue={search}
            onSearch={setSearch}
            isPending={isPending}
            disabled={isPending}
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
        >
          <Command className="w-4 h-4" />
          <span>Filters</span>
          <kbd className="px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-medium">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Unified Filter Bar (presets, quick filters, tools) */}
      <UnifiedFilterBar
        activePreset={activePreset}
        activeQuickFilters={activeQuickFilters}
        onSelectPreset={applyPreset}
        onClearPreset={clearPreset}
        onToggleQuickFilter={toggleQuickFilter}
        onClearAll={clearAllFilters}
        isAdvancedOpen={isAdvancedOpen}
        advancedFilterCount={advancedFilterCount}
        onToggleAdvanced={toggleAdvanced}
        visibleColumns={visibleColumns}
        onColumnsChange={setVisibleColumns}
        savedViews={savedViews}
        savedViewsLoaded={savedViewsLoaded}
        onSaveView={handleSaveView}
        onLoadView={handleLoadView}
        onDeleteView={deleteView}
        onRenameView={renameView}
        onResetView={clearAllFilters}
        onExport={handleExport}
        canExport={apps.length > 0}
        hasActiveFilters={hasActiveFilters}
        disabled={isLoadingData}
      />

      {/* Context Bar (always visible stats) */}
      <ContextBar stats={aggregateStats} isLoading={isFetching} />

      {/* Active Filter Bar (shows current filters as chips) */}
      {(advancedFilterCount > 0 || activePreset || activeQuickFilters.length > 0) && (
        <ActiveFilterBar
          filters={advancedFilters}
          activePreset={activePreset}
          activeQuickFilters={activeQuickFilters}
          genreOptions={filterOptions.genre}
          tagOptions={filterOptions.tag}
          categoryOptions={filterOptions.category}
          resultCount={aggregateStats.total_games}
          onRemoveFilter={handleRemoveFilter}
          onClearAll={clearAllFilters}
          onOpenPalette={commandPalette.open}
        />
      )}

      {/* Advanced Filters Panel (collapsible) */}
      {isAdvancedOpen && (
        <AdvancedFiltersPanel
          filters={advancedFilters}
          activeCount={advancedFilterCount}
          onFilterChange={setAdvancedFilter}
          onClearAll={clearAdvancedFilters}
          onGrowthPreset={applyGrowthPreset}
          onSentimentPreset={applySentimentPreset}
          disabled={isLoadingData}
          // M4b: Content filter props
          genreOptions={filterOptions.genre}
          genreLoading={filterLoading.genre}
          onGenreOpen={handleGenreOpen}
          onGenresChange={setGenres}
          onGenreModeChange={setGenreMode}
          tagOptions={filterOptions.tag}
          tagLoading={filterLoading.tag}
          onTagOpen={handleTagOpen}
          onTagsChange={setTags}
          onTagModeChange={setTagMode}
          categoryOptions={filterOptions.category}
          categoryLoading={filterLoading.category}
          onCategoryOpen={handleCategoryOpen}
          onCategoriesChange={setCategories}
          onWorkshopChange={setHasWorkshop}
          // M4b: Platform filter props
          onPlatformsChange={setPlatforms}
          onPlatformModeChange={setPlatformMode}
          onSteamDeckChange={setSteamDeck}
          onControllerChange={setController}
          // M4b: Release filter props
          onMinAgeChange={setMinAge}
          onMaxAgeChange={setMaxAge}
          onReleaseYearChange={setReleaseYear}
          onEarlyAccessChange={setEarlyAccess}
          onMinHypeChange={setMinHype}
          onMaxHypeChange={setMaxHype}
          // M4b: Relationship filter props
          onPublisherSearchChange={setPublisherSearch}
          onDeveloperSearchChange={setDeveloperSearch}
          onSelfPublishedChange={setSelfPublished}
          onPublisherSizeChange={setPublisherSize}
          onVsPublisherChange={setVsPublisher}
          // M4b: Activity filter props
          onCcuTierChange={setCcuTier}
        />
      )}

      {/* Apps Table */}
      <AppsTable
        apps={apps}
        rankOffset={pagination.offset}
        sortField={sort}
        sortOrder={order}
        onSort={setSort}
        visibleColumns={visibleColumns}
        isLoading={isLoading && !apps.length}
        sparklineLoader={sparklineLoader}
        // M6a: Selection props
        isSelected={selection.isSelected}
        isAllSelected={selection.isAllVisibleSelected(apps)}
        isIndeterminate={selection.isIndeterminate(apps)}
        onSelectApp={(appid, index, shiftKey) =>
          selection.toggleSelection(appid, index, apps, shiftKey)
        }
        onSelectAll={() => selection.toggleAllVisible(apps)}
        // M6b: Empty state props
        hasSearch={!!search}
        hasFilters={advancedFilterCount > 0}
        hasPreset={activePreset}
        onClearFilters={clearAllFilters}
      />

      <AppsPagination
        pagination={pagination}
        totalItems={aggregateStats.total_games}
        disabled={isLoadingData}
        onPageChange={handlePageChange}
      />

      {/* M5b: Data Freshness Footer */}
      <DataFreshnessFooter
        lastUpdated={apps.length > 0 ? apps[0].data_updated_at : null}
      />

      {/* M6a: Bulk Actions Bar (appears when items are selected) */}
      <BulkActionsBar
        selectedCount={selection.selectedCount}
        canCompare={canCompare}
        onCompare={handleCompare}
        onExport={handleExport}
        onClear={selection.clearSelection}
      />

      {/* M6a: Compare Mode Modal */}
      {compare.isCompareOpen && compareApps.length >= 2 && (
        <CompareMode
          apps={compareApps}
          aggregateStats={aggregateStats}
          onClose={compare.closeCompare}
          onRemove={compare.removeFromCompare}
        />
      )}

      {/* M6b: Export Dialog */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        apps={apps}
        selectedApps={selectedApps}
        visibleColumns={visibleColumns}
        filterDescription={filterDescription}
        defaultScope={exportScope}
      />

      {/* Command Palette */}
      <CommandPalette
        palette={commandPalette}
        tagOptions={filterOptions.tag}
        genreOptions={filterOptions.genre}
        categoryOptions={filterOptions.category}
        tagsLoading={filterLoading.tag}
        genresLoading={filterLoading.genre}
        categoriesLoading={filterLoading.category}
        onTagsOpen={handleTagOpen}
        onGenresOpen={handleGenreOpen}
        onCategoriesOpen={handleCategoryOpen}
        activePreset={activePreset}
        activeQuickFilters={activeQuickFilters}
        onApplyPreset={applyPreset}
        onToggleQuickFilter={toggleQuickFilter}
      />
    </div>
  );
}
