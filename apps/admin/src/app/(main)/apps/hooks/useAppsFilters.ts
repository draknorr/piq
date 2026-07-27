'use client';

/**
 * URL state hook for Apps page filters, presets, and quick filters
 * Milestone 3: Unified filter management
 * Milestone 4a: Advanced filters (metrics, growth, sentiment, engagement)
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition, useCallback, useMemo, useRef, useState } from 'react';
import type {
  AppType,
  SortField,
  SortOrder,
  PresetId,
  QuickFilterId,
  PublisherSize,
  VelocityTier,
  CcuTier,
  FilterMode,
} from '../lib/apps-types';
import {
  getPresetById,
  isValidPresetId,
  isValidQuickFilterId,
  buildQuickFilterParams,
} from '../lib/apps-presets';
import {
  type AppColumnId,
  parseColumnsParam,
  serializeColumnsParam,
} from '../lib/apps-columns';
import type { AppsAdvancedFiltersState } from '../components/AdvancedFiltersPanel';
import type { GrowthPreset, SentimentPreset } from '../components/filters';

/**
 * Return type for useAppsFilters hook
 */
export interface UseAppsFiltersReturn {
  // Loading state
  isPending: boolean;

  // Current state from URL
  type: AppType;
  sort: SortField;
  order: SortOrder;
  search: string;
  activePreset: PresetId | null;
  activeQuickFilters: QuickFilterId[];

  // Current filter values (derived from URL)
  minCcu?: number;
  maxCcu?: number;
  minOwners?: number;
  maxOwners?: number;
  minReviews?: number;
  maxReviews?: number;
  minScore?: number;
  maxScore?: number;
  minPrice?: number;
  maxPrice?: number;
  minPlaytime?: number;
  maxPlaytime?: number;
  minGrowth7d?: number;
  maxGrowth7d?: number;
  minGrowth30d?: number;
  maxGrowth30d?: number;
  minMomentum?: number;
  maxMomentum?: number;
  minSentimentDelta?: number;
  maxSentimentDelta?: number;
  velocityTier?: VelocityTier;
  minActivePct?: number;
  minReviewRate?: number;
  minValueScore?: number;
  minVsPublisher?: number;
  minAge?: number;
  maxAge?: number;
  isFree?: boolean;
  steamDeck?: string;
  hasWorkshop?: boolean;
  earlyAccess?: boolean;
  minDiscount?: number;
  publisherSize?: PublisherSize;

  // M4b: Content filters
  genres: number[];
  genreMode: FilterMode;
  tags: number[];
  tagMode: FilterMode;
  categories: number[];
  // M4b: Platform filters
  platforms: string[];
  platformMode: FilterMode;
  controller?: string;
  // M4b: Release filters
  releaseYear?: number;
  minHype?: number;
  maxHype?: number;
  // M4b: Relationship filters
  publisherSearch?: string;
  developerSearch?: string;
  selfPublished?: boolean;
  // M4b: Activity filters
  ccuTier?: CcuTier;

  // Advanced filters aggregated state
  advancedFilters: AppsAdvancedFiltersState;
  advancedFilterCount: number;
  isAdvancedOpen: boolean;

  // Actions
  setType: (type: AppType) => void;
  setSort: (field: SortField) => void;
  setSearch: (search: string) => void;
  toggleQuickFilter: (filterId: QuickFilterId) => void;
  applyPreset: (presetId: PresetId) => void;
  clearPreset: () => void;
  clearAllFilters: () => void;
  hasActiveFilters: boolean;

  // M4a: Advanced filter actions
  setAdvancedFilter: (field: keyof AppsAdvancedFiltersState, value: number | string | undefined) => void;
  clearAdvancedFilters: () => void;
  applyGrowthPreset: (preset: GrowthPreset, period: '7d' | '30d') => void;
  applySentimentPreset: (preset: SentimentPreset) => void;
  toggleAdvanced: () => void;

  // M4b: Content filter actions
  setGenres: (ids: number[]) => void;
  setGenreMode: (mode: FilterMode) => void;
  setGenresWithMode: (ids: number[], mode: FilterMode) => void;
  setTags: (ids: number[]) => void;
  setTagMode: (mode: FilterMode) => void;
  setTagsWithMode: (ids: number[], mode: FilterMode) => void;
  setCategories: (ids: number[]) => void;
  setHasWorkshop: (value: boolean | undefined) => void;
  // M4b: Platform filter actions
  setPlatforms: (platforms: string[]) => void;
  setPlatformMode: (mode: FilterMode) => void;
  setSteamDeck: (value: string | undefined) => void;
  setController: (value: string | undefined) => void;
  // M4b: Release filter actions
  setReleaseYear: (year: number | undefined) => void;
  setMinAge: (value: number | undefined) => void;
  setMaxAge: (value: number | undefined) => void;
  setEarlyAccess: (value: boolean | undefined) => void;
  setMinHype: (value: number | undefined) => void;
  setMaxHype: (value: number | undefined) => void;
  // M4b: Relationship filter actions
  setPublisherSearch: (value: string | undefined) => void;
  setDeveloperSearch: (value: string | undefined) => void;
  setSelfPublished: (value: boolean | undefined) => void;
  setPublisherSize: (value: PublisherSize | undefined) => void;
  setVsPublisher: (value: number | undefined) => void;
  // M4b: Activity filter actions
  setCcuTier: (tier: CcuTier | undefined) => void;

  // M5a: Column customization
  visibleColumns: AppColumnId[];
  setVisibleColumns: (columns: AppColumnId[]) => void;
}

/**
 * Parse a numeric URL param
 */
function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

/**
 * Parse a boolean URL param
 */
function parseBoolean(value: string | null): boolean | undefined {
  if (!value) return undefined;
  return value === 'true';
}

/**
 * Parse velocity tier URL param
 */
function parseVelocityTier(value: string | null): VelocityTier | undefined {
  if (!value) return undefined;
  if (value === 'high' || value === 'medium' || value === 'low' || value === 'dormant') {
    return value;
  }
  return undefined;
}

/**
 * Parse comma-separated number array from URL
 */
function parseNumberArray(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

/**
 * Parse comma-separated string array from URL
 */
function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse CcuTier from URL param
 */
function parseCcuTier(value: string | null): 1 | 2 | 3 | undefined {
  if (!value) return undefined;
  const num = parseInt(value, 10);
  if (num === 1 || num === 2 || num === 3) return num;
  return undefined;
}

/**
 * Parse FilterMode from URL param
 * Default is 'all' so adding more tags/genres narrows results (intuitive behavior)
 */
function parseFilterMode(value: string | null): 'any' | 'all' {
  return value === 'any' ? 'any' : 'all';
}

/**
 * Hook for managing Apps page filter state via URL params
 */
export function useAppsFilters(): UseAppsFiltersReturn {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Parse current state from URL
  const type = (searchParams.get('type') as AppType) || 'game';
  const sort = (searchParams.get('sort') as SortField) || 'ccu_peak';
  const order = (searchParams.get('order') as SortOrder) || 'desc';
  const search = searchParams.get('search') || '';

  // Parse preset
  const presetParam = searchParams.get('preset');
  const activePreset: PresetId | null =
    presetParam && isValidPresetId(presetParam) ? presetParam : null;

  // Parse quick filters
  const filtersParam = searchParams.get('filters') || '';
  const activeQuickFilters: QuickFilterId[] = useMemo(() => {
    if (!filtersParam) return [];
    return filtersParam
      .split(',')
      .filter(isValidQuickFilterId) as QuickFilterId[];
  }, [filtersParam]);

  // Parse filter values from URL
  const minCcu = parseNumber(searchParams.get('minCcu'));
  const maxCcu = parseNumber(searchParams.get('maxCcu'));
  const minOwners = parseNumber(searchParams.get('minOwners'));
  const maxOwners = parseNumber(searchParams.get('maxOwners'));
  const minReviews = parseNumber(searchParams.get('minReviews'));
  const maxReviews = parseNumber(searchParams.get('maxReviews'));
  const minScore = parseNumber(searchParams.get('minScore'));
  const maxScore = parseNumber(searchParams.get('maxScore'));
  const minPrice = parseNumber(searchParams.get('minPrice'));
  const maxPrice = parseNumber(searchParams.get('maxPrice'));
  const minPlaytime = parseNumber(searchParams.get('minPlaytime'));
  const maxPlaytime = parseNumber(searchParams.get('maxPlaytime'));
  const minGrowth7d = parseNumber(searchParams.get('minGrowth7d'));
  const maxGrowth7d = parseNumber(searchParams.get('maxGrowth7d'));
  const minGrowth30d = parseNumber(searchParams.get('minGrowth30d'));
  const maxGrowth30d = parseNumber(searchParams.get('maxGrowth30d'));
  const minMomentum = parseNumber(searchParams.get('minMomentum'));
  const maxMomentum = parseNumber(searchParams.get('maxMomentum'));
  const minSentimentDelta = parseNumber(searchParams.get('minSentimentDelta'));
  const maxSentimentDelta = parseNumber(searchParams.get('maxSentimentDelta'));
  const velocityTier = parseVelocityTier(searchParams.get('velocityTier'));
  const minActivePct = parseNumber(searchParams.get('minActivePct'));
  const minReviewRate = parseNumber(searchParams.get('minReviewRate'));
  const minValueScore = parseNumber(searchParams.get('minValueScore'));
  const minVsPublisher = parseNumber(searchParams.get('minVsPublisher'));
  const minAge = parseNumber(searchParams.get('minAge'));
  const maxAge = parseNumber(searchParams.get('maxAge'));
  const isFree = parseBoolean(searchParams.get('isFree'));
  const steamDeck = searchParams.get('steamDeck') || undefined;
  const hasWorkshop = parseBoolean(searchParams.get('hasWorkshop'));
  const earlyAccess = parseBoolean(searchParams.get('earlyAccess'));
  const minDiscount = parseNumber(searchParams.get('minDiscount'));
  const publisherSizeParam = searchParams.get('publisherSize');
  const publisherSize =
    publisherSizeParam === 'indie' || publisherSizeParam === 'mid' || publisherSizeParam === 'major'
      ? (publisherSizeParam as PublisherSize)
      : undefined;

  // M4b: Parse content filters
  const genres = useMemo(() => parseNumberArray(searchParams.get('genres')), [searchParams]);
  const genreMode = parseFilterMode(searchParams.get('genreMode'));
  const tags = useMemo(() => parseNumberArray(searchParams.get('tags')), [searchParams]);
  const tagMode = parseFilterMode(searchParams.get('tagMode'));
  const categories = useMemo(() => parseNumberArray(searchParams.get('categories')), [searchParams]);

  // M4b: Parse platform filters
  const platforms = useMemo(() => parseStringArray(searchParams.get('platforms')), [searchParams]);
  const platformMode = parseFilterMode(searchParams.get('platformMode'));
  const controller = searchParams.get('controller') || undefined;

  // M4b: Parse release filters
  const releaseYear = parseNumber(searchParams.get('releaseYear'));
  const minHype = parseNumber(searchParams.get('minHype'));
  const maxHype = parseNumber(searchParams.get('maxHype'));

  // M4b: Parse relationship filters
  const publisherSearch = searchParams.get('publisherSearch') || undefined;
  const developerSearch = searchParams.get('developerSearch') || undefined;
  const selfPublished = parseBoolean(searchParams.get('selfPublished'));

  // M4b: Parse activity filters
  const ccuTier = parseCcuTier(searchParams.get('ccuTier'));

  // M5a: Parse visible columns
  const visibleColumns = useMemo(
    () => parseColumnsParam(searchParams.get('columns')),
    [searchParams]
  );

  // M4a: Local state for advanced filters panel visibility
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Check if any filters are active
  // Note: Boolean filters must use !== undefined check to detect false values
  const hasActiveFilters = useMemo(() => {
    return !!(
      search ||
      activePreset ||
      activeQuickFilters.length > 0 ||
      minCcu !== undefined ||
      maxCcu !== undefined ||
      minOwners !== undefined ||
      maxOwners !== undefined ||
      minReviews !== undefined ||
      maxReviews !== undefined ||
      minScore !== undefined ||
      maxScore !== undefined ||
      minPrice !== undefined ||
      maxPrice !== undefined ||
      minPlaytime !== undefined ||
      maxPlaytime !== undefined ||
      minGrowth7d !== undefined ||
      maxGrowth7d !== undefined ||
      minGrowth30d !== undefined ||
      maxGrowth30d !== undefined ||
      minMomentum !== undefined ||
      maxMomentum !== undefined ||
      minSentimentDelta !== undefined ||
      maxSentimentDelta !== undefined ||
      velocityTier !== undefined ||
      minActivePct !== undefined ||
      minReviewRate !== undefined ||
      minValueScore !== undefined ||
      minVsPublisher !== undefined ||
      minAge !== undefined ||
      maxAge !== undefined ||
      isFree !== undefined ||
      steamDeck !== undefined ||
      hasWorkshop !== undefined ||
      earlyAccess !== undefined ||
      minDiscount !== undefined ||
      publisherSize !== undefined ||
      // M4b filters
      genres.length > 0 ||
      tags.length > 0 ||
      categories.length > 0 ||
      platforms.length > 0 ||
      controller !== undefined ||
      releaseYear !== undefined ||
      minHype !== undefined ||
      maxHype !== undefined ||
      publisherSearch !== undefined ||
      developerSearch !== undefined ||
      selfPublished !== undefined ||
      ccuTier !== undefined
    );
  }, [
    search,
    activePreset,
    activeQuickFilters.length,
    minCcu,
    maxCcu,
    minOwners,
    maxOwners,
    minReviews,
    maxReviews,
    minScore,
    maxScore,
    minPrice,
    maxPrice,
    minPlaytime,
    maxPlaytime,
    minGrowth7d,
    maxGrowth7d,
    minGrowth30d,
    maxGrowth30d,
    minMomentum,
    maxMomentum,
    minSentimentDelta,
    maxSentimentDelta,
    velocityTier,
    minActivePct,
    minReviewRate,
    minValueScore,
    minVsPublisher,
    minAge,
    maxAge,
    isFree,
    steamDeck,
    hasWorkshop,
    earlyAccess,
    minDiscount,
    publisherSize,
    // M4b deps
    genres.length,
    tags.length,
    categories.length,
    platforms.length,
    controller,
    releaseYear,
    minHype,
    maxHype,
    publisherSearch,
    developerSearch,
    selfPublished,
    ccuTier,
  ]);

  // M4a: Aggregated advanced filters state
  const advancedFilters: AppsAdvancedFiltersState = useMemo(() => ({
    minCcu,
    maxCcu,
    minOwners,
    maxOwners,
    minReviews,
    maxReviews,
    minScore,
    maxScore,
    minPrice,
    maxPrice,
    minPlaytime,
    maxPlaytime,
    minGrowth7d,
    maxGrowth7d,
    minGrowth30d,
    maxGrowth30d,
    minMomentum,
    maxMomentum,
    minSentimentDelta,
    maxSentimentDelta,
    velocityTier,
    minActivePct,
    minReviewRate,
    minValueScore,
    // M4b filters
    genres,
    genreMode,
    tags,
    tagMode,
    categories,
    hasWorkshop,
    platforms,
    platformMode,
    steamDeck,
    controller,
    minAge,
    maxAge,
    releaseYear,
    earlyAccess,
    minHype,
    maxHype,
    publisherSearch,
    developerSearch,
    selfPublished,
    publisherSize,
    minVsPublisher,
    ccuTier,
  }), [
    minCcu, maxCcu, minOwners, maxOwners, minReviews, maxReviews,
    minScore, maxScore, minPrice, maxPrice, minPlaytime, maxPlaytime,
    minGrowth7d, maxGrowth7d, minGrowth30d, maxGrowth30d,
    minMomentum, maxMomentum, minSentimentDelta, maxSentimentDelta,
    velocityTier, minActivePct, minReviewRate, minValueScore,
    // M4b deps
    genres, genreMode, tags, tagMode, categories, hasWorkshop,
    platforms, platformMode, steamDeck, controller,
    minAge, maxAge, releaseYear, earlyAccess, minHype, maxHype,
    publisherSearch, developerSearch, selfPublished, publisherSize, minVsPublisher, ccuTier,
  ]);

  // M4a: Count of active advanced filters
  const advancedFilterCount = useMemo(() => {
    let count = 0;
    if (minCcu !== undefined) count++;
    if (maxCcu !== undefined) count++;
    if (minOwners !== undefined) count++;
    if (maxOwners !== undefined) count++;
    if (minReviews !== undefined) count++;
    if (maxReviews !== undefined) count++;
    if (minScore !== undefined) count++;
    if (maxScore !== undefined) count++;
    if (minPrice !== undefined) count++;
    if (maxPrice !== undefined) count++;
    if (minPlaytime !== undefined) count++;
    if (maxPlaytime !== undefined) count++;
    if (minGrowth7d !== undefined) count++;
    if (maxGrowth7d !== undefined) count++;
    if (minGrowth30d !== undefined) count++;
    if (maxGrowth30d !== undefined) count++;
    if (minMomentum !== undefined) count++;
    if (maxMomentum !== undefined) count++;
    if (minSentimentDelta !== undefined) count++;
    if (maxSentimentDelta !== undefined) count++;
    if (velocityTier !== undefined) count++;
    if (minActivePct !== undefined) count++;
    if (minReviewRate !== undefined) count++;
    if (minValueScore !== undefined) count++;
    // M4b counts
    if (genres.length > 0) count++;
    if (tags.length > 0) count++;
    if (categories.length > 0) count++;
    if (hasWorkshop !== undefined) count++;
    if (platforms.length > 0) count++;
    if (steamDeck !== undefined) count++;
    if (controller !== undefined) count++;
    if (minAge !== undefined) count++;
    if (maxAge !== undefined) count++;
    if (releaseYear !== undefined) count++;
    if (earlyAccess !== undefined) count++;
    if (minHype !== undefined) count++;
    if (maxHype !== undefined) count++;
    if (publisherSearch !== undefined) count++;
    if (developerSearch !== undefined) count++;
    if (selfPublished !== undefined) count++;
    if (publisherSize !== undefined) count++;
    if (minVsPublisher !== undefined) count++;
    if (ccuTier !== undefined) count++;
    return count;
  }, [
    minCcu, maxCcu, minOwners, maxOwners, minReviews, maxReviews,
    minScore, maxScore, minPrice, maxPrice, minPlaytime, maxPlaytime,
    minGrowth7d, maxGrowth7d, minGrowth30d, maxGrowth30d,
    minMomentum, maxMomentum, minSentimentDelta, maxSentimentDelta,
    velocityTier, minActivePct, minReviewRate, minValueScore,
    // M4b deps
    genres.length, tags.length, categories.length, hasWorkshop,
    platforms.length, steamDeck, controller,
    minAge, maxAge, releaseYear, earlyAccess, minHype, maxHype,
    publisherSearch, developerSearch, selfPublished, publisherSize, minVsPublisher, ccuTier,
  ]);

  // Ref for debouncing URL updates
  const urlUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdatesRef = useRef<Record<string, string | null>>({});

  /**
   * Update URL with new params (immediate)
   */
  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      // A changed filter or sort invalidates the current result-page offset.
      params.delete('offset');

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '' || value === undefined) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      // Clean up defaults to keep URL minimal
      if (params.get('type') === 'game') params.delete('type');
      if (params.get('sort') === 'ccu_peak') params.delete('sort');
      if (params.get('order') === 'desc') params.delete('order');

      const queryString = params.toString();
      const url = queryString ? `/apps?${queryString}` : '/apps';

      startTransition(() => {
        router.push(url, { scroll: false });
      });
    },
    [router, searchParams]
  );

  /**
   * Update URL with debouncing (for search input to batch rapid typing)
   */
  const updateUrlDebounced = useCallback(
    (updates: Record<string, string | null>) => {
      // Merge with any pending updates
      pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };

      // Clear existing timeout
      if (urlUpdateTimeoutRef.current) {
        clearTimeout(urlUpdateTimeoutRef.current);
      }

      // Set new debounced update (300ms per spec)
      urlUpdateTimeoutRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());

        // A changed filter or search invalidates the current result-page offset.
        params.delete('offset');

        Object.entries(pendingUpdatesRef.current).forEach(([key, value]) => {
          if (value === null || value === '' || value === undefined) {
            params.delete(key);
          } else {
            params.set(key, value);
          }
        });

        // Clean up defaults
        if (params.get('type') === 'game') params.delete('type');
        if (params.get('sort') === 'ccu_peak') params.delete('sort');
        if (params.get('order') === 'desc') params.delete('order');

        // Clear pending updates
        pendingUpdatesRef.current = {};

        const queryString = params.toString();
        const url = queryString ? `/apps?${queryString}` : '/apps';

        startTransition(() => {
          router.push(url, { scroll: false });
        });
      }, 700); // 700ms debounce - gives medium-paced typers time to finish
    },
    [router, searchParams]
  );

  /**
   * Set app type filter
   */
  const setType = useCallback(
    (newType: AppType) => {
      updateUrl({
        type: newType === 'game' ? null : newType,
        preset: null, // Clear preset when type changes
      });
    },
    [updateUrl]
  );

  /**
   * Set sort field (toggles order if same field)
   */
  const setSort = useCallback(
    (field: SortField) => {
      const newOrder = sort === field && order === 'desc' ? 'asc' : 'desc';
      updateUrl({
        sort: field === 'ccu_peak' ? null : field,
        order: newOrder === 'desc' ? null : newOrder,
      });
    },
    [sort, order, updateUrl]
  );

  /**
   * Set search query (debounced)
   * Requires minimum 3 characters to prevent overwhelming queries
   * (e.g., "s" matches ~180K+ apps and crashes the server)
   */
  const setSearch = useCallback(
    (query: string) => {
      // Allow clearing (0 chars) or full searches (3+ chars)
      // Ignore 1-2 char queries entirely to prevent:
      // 1. Overwhelming database queries
      // 2. Unnecessary URL transitions that cause spinner/focus issues
      if (query.length > 0 && query.length < 3) {
        return; // Do nothing for partial queries
      }
      updateUrlDebounced({
        search: query || null,
        preset: null, // Clear preset when search changes
      });
    },
    [updateUrlDebounced]
  );

  /**
   * Toggle a quick filter on/off
   * Quick filters STACK with existing filters (including presets) using AND logic
   */
  const toggleQuickFilter = useCallback(
    (filterId: QuickFilterId) => {
      const isActive = activeQuickFilters.includes(filterId);
      let newFilters: QuickFilterId[];

      if (isActive) {
        newFilters = activeQuickFilters.filter((f) => f !== filterId);
      } else {
        newFilters = [...activeQuickFilters, filterId];
      }

      // Build filter params from all active quick filters
      const filterParams = buildQuickFilterParams(newFilters);

      // Build URL updates - preserve preset and existing filters!
      const updates: Record<string, string | null> = {
        filters: newFilters.length > 0 ? newFilters.join(',') : null,
        // Don't clear preset - quick filters stack with presets
      };

      // For quick filter values, merge with existing values using MAX for mins, MIN for maxes
      // This allows stacking of multiple quick filters AND preset filters

      // minCcu: take max of existing and quick filter (more restrictive)
      if (filterParams.minCcu !== undefined) {
        const existingMinCcu = minCcu ?? 0;
        updates.minCcu = String(Math.max(existingMinCcu, filterParams.minCcu));
      } else if (newFilters.length === 0) {
        // Only clear if no quick filters active
        updates.minCcu = minCcu !== undefined ? String(minCcu) : null;
      }

      // minGrowth7d: take max (more restrictive)
      if (filterParams.minGrowth7d !== undefined) {
        const existingMinGrowth7d = minGrowth7d ?? -Infinity;
        updates.minGrowth7d = String(Math.max(existingMinGrowth7d, filterParams.minGrowth7d));
      } else if (newFilters.length === 0) {
        updates.minGrowth7d = minGrowth7d !== undefined ? String(minGrowth7d) : null;
      }

      // minScore: take max (more restrictive)
      if (filterParams.minScore !== undefined) {
        const existingMinScore = minScore ?? 0;
        updates.minScore = String(Math.max(existingMinScore, filterParams.minScore));
      } else if (newFilters.length === 0) {
        updates.minScore = minScore !== undefined ? String(minScore) : null;
      }

      // minMomentum: take max (more restrictive)
      if (filterParams.minMomentum !== undefined) {
        const existingMinMomentum = minMomentum ?? -Infinity;
        updates.minMomentum = String(Math.max(existingMinMomentum, filterParams.minMomentum));
      } else if (newFilters.length === 0) {
        updates.minMomentum = minMomentum !== undefined ? String(minMomentum) : null;
      }

      // minSentimentDelta: take max (more restrictive)
      if (filterParams.minSentimentDelta !== undefined) {
        const existingMinSentimentDelta = minSentimentDelta ?? -Infinity;
        updates.minSentimentDelta = String(Math.max(existingMinSentimentDelta, filterParams.minSentimentDelta));
      } else if (newFilters.length === 0) {
        updates.minSentimentDelta = minSentimentDelta !== undefined ? String(minSentimentDelta) : null;
      }

      // minDiscount: take max (more restrictive)
      if (filterParams.minDiscount !== undefined) {
        const existingMinDiscount = minDiscount ?? 0;
        updates.minDiscount = String(Math.max(existingMinDiscount, filterParams.minDiscount));
      } else if (newFilters.length === 0) {
        updates.minDiscount = minDiscount !== undefined ? String(minDiscount) : null;
      }

      // maxAge: take min (more restrictive)
      if (filterParams.maxAge !== undefined) {
        const existingMaxAge = maxAge ?? Infinity;
        updates.maxAge = String(Math.min(existingMaxAge, filterParams.maxAge));
      } else if (newFilters.length === 0) {
        updates.maxAge = maxAge !== undefined ? String(maxAge) : null;
      }

      // Boolean filters: OR logic (if any quick filter wants true, set true)
      // But preserve existing value if quick filter doesn't specify
      updates.isFree = filterParams.isFree ? 'true' : (isFree ? 'true' : null);
      updates.hasWorkshop = filterParams.hasWorkshop ? 'true' : (hasWorkshop ? 'true' : null);
      updates.earlyAccess = filterParams.earlyAccess ? 'true' : (earlyAccess ? 'true' : null);

      // String filters: quick filter takes precedence, otherwise preserve existing
      updates.publisherSize = filterParams.publisherSize || publisherSize || null;
      updates.steamDeck = filterParams.steamDeck || steamDeck || null;

      updateUrl(updates);
    },
    [activeQuickFilters, updateUrl, minCcu, minGrowth7d, minScore, minMomentum, minSentimentDelta, minDiscount, maxAge, isFree, hasWorkshop, earlyAccess, publisherSize, steamDeck]
  );

  /**
   * Apply a preset (clears all other filters)
   */
  const applyPreset = useCallback(
    (presetId: PresetId) => {
      const preset = getPresetById(presetId);
      if (!preset) return;

      // Build updates - clear all filters first
      const updates: Record<string, string | null> = {
        preset: presetId,
        sort: preset.sort === 'ccu_peak' ? null : preset.sort,
        order: preset.order === 'desc' ? null : preset.order,
        // Clear all other filters
        search: null,
        filters: null,
        minCcu: null,
        maxCcu: null,
        minOwners: null,
        maxOwners: null,
        minReviews: null,
        minScore: null,
        minGrowth7d: null,
        maxGrowth7d: null,
        minMomentum: null,
        minSentimentDelta: null,
        minReviewRate: null,
        minValueScore: null,
        minVsPublisher: null,
        minAge: null,
        maxAge: null,
        isFree: null,
        steamDeck: null,
        hasWorkshop: null,
        earlyAccess: null,
        minDiscount: null,
        publisherSize: null,
      };

      // Apply preset filter values
      const { filters } = preset;
      if (filters.minCcu !== undefined) updates.minCcu = String(filters.minCcu);
      if (filters.maxCcu !== undefined) updates.maxCcu = String(filters.maxCcu);
      if (filters.minOwners !== undefined) updates.minOwners = String(filters.minOwners);
      if (filters.maxOwners !== undefined) updates.maxOwners = String(filters.maxOwners);
      if (filters.minReviews !== undefined) updates.minReviews = String(filters.minReviews);
      if (filters.minScore !== undefined) updates.minScore = String(filters.minScore);
      if (filters.minGrowth7d !== undefined) updates.minGrowth7d = String(filters.minGrowth7d);
      if (filters.maxGrowth7d !== undefined) updates.maxGrowth7d = String(filters.maxGrowth7d);
      if (filters.minMomentum !== undefined) updates.minMomentum = String(filters.minMomentum);
      if (filters.minSentimentDelta !== undefined)
        updates.minSentimentDelta = String(filters.minSentimentDelta);
      if (filters.minReviewRate !== undefined)
        updates.minReviewRate = String(filters.minReviewRate);
      if (filters.minValueScore !== undefined)
        updates.minValueScore = String(filters.minValueScore);
      if (filters.minVsPublisher !== undefined)
        updates.minVsPublisher = String(filters.minVsPublisher);
      if (filters.minAge !== undefined) updates.minAge = String(filters.minAge);
      if (filters.maxAge !== undefined) updates.maxAge = String(filters.maxAge);
      if (filters.isFree !== undefined) updates.isFree = 'true';

      updateUrl(updates);
    },
    [updateUrl]
  );

  /**
   * Clear active preset (keep other filters)
   */
  const clearPreset = useCallback(() => {
    updateUrl({ preset: null });
  }, [updateUrl]);

  /**
   * Clear all filters and reset to defaults
   */
  const clearAllFilters = useCallback(() => {
    router.push('/apps');
  }, [router]);

  /**
   * M4a: Set a single advanced filter value (debounced)
   */
  const setAdvancedFilter = useCallback(
    (field: keyof AppsAdvancedFiltersState, value: number | string | undefined) => {
      const stringValue = value !== undefined ? String(value) : null;
      updateUrlDebounced({
        [field]: stringValue,
        preset: null, // Clear preset when advanced filters change
      });
    },
    [updateUrlDebounced]
  );

  /**
   * M4a: Clear all advanced filters
   */
  const clearAdvancedFilters = useCallback(() => {
    updateUrl({
      // Metric filters
      minCcu: null,
      maxCcu: null,
      minOwners: null,
      maxOwners: null,
      minReviews: null,
      maxReviews: null,
      minScore: null,
      maxScore: null,
      minPrice: null,
      maxPrice: null,
      minPlaytime: null,
      maxPlaytime: null,
      // Growth filters
      minGrowth7d: null,
      maxGrowth7d: null,
      minGrowth30d: null,
      maxGrowth30d: null,
      minMomentum: null,
      maxMomentum: null,
      // Sentiment filters
      minSentimentDelta: null,
      maxSentimentDelta: null,
      velocityTier: null,
      // Engagement filters
      minActivePct: null,
      minReviewRate: null,
      minValueScore: null,
      // M4b: Content filters
      genres: null,
      genreMode: null,
      tags: null,
      tagMode: null,
      categories: null,
      hasWorkshop: null,
      // M4b: Platform filters
      platforms: null,
      platformMode: null,
      steamDeck: null,
      controller: null,
      // M4b: Release filters
      minAge: null,
      maxAge: null,
      releaseYear: null,
      earlyAccess: null,
      minHype: null,
      maxHype: null,
      // M4b: Relationship filters
      publisherSearch: null,
      developerSearch: null,
      selfPublished: null,
      publisherSize: null,
      minVsPublisher: null,
      // M4b: Activity filters
      ccuTier: null,
      // Clear preset as well
      preset: null,
    });
  }, [updateUrl]);

  /**
   * M4a: Apply a growth preset (Growing/Stable/Declining)
   */
  const applyGrowthPreset = useCallback(
    (preset: GrowthPreset, period: '7d' | '30d') => {
      const minKey = period === '7d' ? 'minGrowth7d' : 'minGrowth30d';
      const maxKey = period === '7d' ? 'maxGrowth7d' : 'maxGrowth30d';

      const updates: Record<string, string | null> = {
        [minKey]: null,
        [maxKey]: null,
        preset: null, // Clear preset
      };

      switch (preset) {
        case 'growing':
          updates[minKey] = '10';
          break;
        case 'declining':
          updates[maxKey] = '-10';
          break;
        case 'stable':
          updates[minKey] = '-10';
          updates[maxKey] = '10';
          break;
      }

      updateUrl(updates);
    },
    [updateUrl]
  );

  /**
   * M4a: Apply a sentiment preset (Improving/Stable/Declining/Bombing)
   */
  const applySentimentPreset = useCallback(
    (preset: SentimentPreset) => {
      const updates: Record<string, string | null> = {
        minSentimentDelta: null,
        maxSentimentDelta: null,
        preset: null, // Clear preset
      };

      switch (preset) {
        case 'improving':
          updates.minSentimentDelta = '3';
          break;
        case 'stable':
          updates.minSentimentDelta = '-3';
          updates.maxSentimentDelta = '3';
          break;
        case 'declining':
          updates.maxSentimentDelta = '-3';
          break;
        case 'bombing':
          updates.maxSentimentDelta = '-10';
          break;
      }

      updateUrl(updates);
    },
    [updateUrl]
  );

  /**
   * M4a: Toggle advanced filters panel visibility
   */
  const toggleAdvanced = useCallback(() => {
    setIsAdvancedOpen((prev) => !prev);
  }, []);

  // ========================================
  // M4b: Content filter actions
  // ========================================

  const setGenres = useCallback(
    (ids: number[]) => {
      updateUrl({
        genres: ids.length > 0 ? ids.join(',') : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setGenreMode = useCallback(
    (mode: FilterMode) => {
      updateUrl({
        genreMode: mode === 'any' ? 'any' : null, // 'all' is default, only save 'any' to URL
        preset: null,
      });
    },
    [updateUrl]
  );

  /**
   * Set genres and mode in a single URL update to avoid race condition
   * Used by command palette which sets both values at once
   */
  const setGenresWithMode = useCallback(
    (ids: number[], mode: FilterMode) => {
      updateUrl({
        genres: ids.length > 0 ? ids.join(',') : null,
        genreMode: mode === 'any' ? 'any' : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setTags = useCallback(
    (ids: number[]) => {
      updateUrl({
        tags: ids.length > 0 ? ids.join(',') : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setTagMode = useCallback(
    (mode: FilterMode) => {
      updateUrl({
        tagMode: mode === 'any' ? 'any' : null, // 'all' is default, only save 'any' to URL
        preset: null,
      });
    },
    [updateUrl]
  );

  /**
   * Set tags and mode in a single URL update to avoid race condition
   * Used by command palette which sets both values at once
   */
  const setTagsWithMode = useCallback(
    (ids: number[], mode: FilterMode) => {
      updateUrl({
        tags: ids.length > 0 ? ids.join(',') : null,
        tagMode: mode === 'any' ? 'any' : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setCategories = useCallback(
    (ids: number[]) => {
      updateUrl({
        categories: ids.length > 0 ? ids.join(',') : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setHasWorkshop = useCallback(
    (value: boolean | undefined) => {
      updateUrl({
        hasWorkshop: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  // ========================================
  // M4b: Platform filter actions
  // ========================================

  const setPlatforms = useCallback(
    (values: string[]) => {
      updateUrl({
        platforms: values.length > 0 ? values.join(',') : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setPlatformMode = useCallback(
    (mode: FilterMode) => {
      updateUrl({
        platformMode: mode === 'any' ? 'any' : null, // 'all' is default, only save 'any' to URL
        preset: null,
      });
    },
    [updateUrl]
  );

  const setSteamDeck = useCallback(
    (value: string | undefined) => {
      updateUrl({
        steamDeck: value || null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setController = useCallback(
    (value: string | undefined) => {
      updateUrl({
        controller: value || null,
        preset: null,
      });
    },
    [updateUrl]
  );

  // ========================================
  // M4b: Release filter actions
  // ========================================

  const setReleaseYear = useCallback(
    (year: number | undefined) => {
      updateUrl({
        releaseYear: year !== undefined ? String(year) : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setMinAge = useCallback(
    (value: number | undefined) => {
      updateUrlDebounced({
        minAge: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrlDebounced]
  );

  const setMaxAge = useCallback(
    (value: number | undefined) => {
      updateUrlDebounced({
        maxAge: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrlDebounced]
  );

  const setEarlyAccess = useCallback(
    (value: boolean | undefined) => {
      updateUrl({
        earlyAccess: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setMinHype = useCallback(
    (value: number | undefined) => {
      updateUrlDebounced({
        minHype: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrlDebounced]
  );

  const setMaxHype = useCallback(
    (value: number | undefined) => {
      updateUrlDebounced({
        maxHype: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrlDebounced]
  );

  // ========================================
  // M4b: Relationship filter actions
  // ========================================

  const setPublisherSearch = useCallback(
    (value: string | undefined) => {
      updateUrlDebounced({
        publisherSearch: value || null,
        preset: null,
      });
    },
    [updateUrlDebounced]
  );

  const setDeveloperSearch = useCallback(
    (value: string | undefined) => {
      updateUrlDebounced({
        developerSearch: value || null,
        preset: null,
      });
    },
    [updateUrlDebounced]
  );

  const setSelfPublished = useCallback(
    (value: boolean | undefined) => {
      updateUrl({
        selfPublished: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setPublisherSize = useCallback(
    (value: PublisherSize | undefined) => {
      updateUrl({
        publisherSize: value || null,
        preset: null,
      });
    },
    [updateUrl]
  );

  const setVsPublisher = useCallback(
    (value: number | undefined) => {
      updateUrl({
        minVsPublisher: value !== undefined ? String(value) : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  // ========================================
  // M4b: Activity filter actions
  // ========================================

  const setCcuTier = useCallback(
    (tier: CcuTier | undefined) => {
      updateUrl({
        ccuTier: tier !== undefined ? String(tier) : null,
        preset: null,
      });
    },
    [updateUrl]
  );

  // ========================================
  // M5a: Column customization
  // ========================================

  const setVisibleColumns = useCallback(
    (columns: AppColumnId[]) => {
      const serialized = serializeColumnsParam(columns);
      updateUrl({
        columns: serialized,
      });
    },
    [updateUrl]
  );

  return {
    isPending,
    type,
    sort,
    order,
    search,
    activePreset,
    activeQuickFilters,
    // Filter values
    minCcu,
    maxCcu,
    minOwners,
    maxOwners,
    minReviews,
    maxReviews,
    minScore,
    maxScore,
    minPrice,
    maxPrice,
    minPlaytime,
    maxPlaytime,
    minGrowth7d,
    maxGrowth7d,
    minGrowth30d,
    maxGrowth30d,
    minMomentum,
    maxMomentum,
    minSentimentDelta,
    maxSentimentDelta,
    velocityTier,
    minActivePct,
    minReviewRate,
    minValueScore,
    minVsPublisher,
    minAge,
    maxAge,
    isFree,
    steamDeck,
    hasWorkshop,
    earlyAccess,
    minDiscount,
    publisherSize,
    // M4b: Content filter values
    genres,
    genreMode,
    tags,
    tagMode,
    categories,
    // M4b: Platform filter values
    platforms,
    platformMode,
    controller,
    // M4b: Release filter values
    releaseYear,
    minHype,
    maxHype,
    // M4b: Relationship filter values
    publisherSearch,
    developerSearch,
    selfPublished,
    // M4b: Activity filter values
    ccuTier,
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
    hasActiveFilters,
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
  };
}
