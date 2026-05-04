'use client';

import { useState, useCallback, useRef } from 'react';
import type { FilterOption, CompanyType, StatusFilterValue } from '../lib/companies-types';

export type FilterType = 'genre' | 'tag' | 'category' | 'steam_deck';

interface CacheEntry {
  data: FilterOption[];
  timestamp: number;
}

interface ContextFilters {
  minGames?: number;
  minRevenue?: number;
  status?: StatusFilterValue;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Hook for lazy-loading filter option counts with caching.
 * Calls the Tiger-backed filter-count API when dropdowns open.
 */
export function useFilterCounts() {
  const [loading, setLoading] = useState<Record<FilterType, boolean>>({
    genre: false,
    tag: false,
    category: false,
    steam_deck: false,
  });

  const [data, setData] = useState<Record<FilterType, FilterOption[]>>({
    genre: [],
    tag: [],
    category: [],
    steam_deck: [],
  });

  const cache = useRef<Record<string, CacheEntry>>({});

  // Track in-flight requests to prevent duplicate concurrent calls
  const inFlight = useRef<Record<FilterType, boolean>>({
    genre: false,
    tag: false,
    category: false,
    steam_deck: false,
  });

  /**
   * Build a cache key from filter type and context
   */
  const buildCacheKey = (
    filterType: FilterType,
    companyType: CompanyType,
    context?: ContextFilters
  ): string => {
    return `${filterType}-${companyType}-${JSON.stringify(context ?? {})}`;
  };

  /**
   * Fetch counts for a filter type with optional contextual filters.
   * Results are cached for 5 minutes.
   */
  const fetchCounts = useCallback(
    async (
      filterType: FilterType,
      companyType: CompanyType = 'all',
      contextFilters?: ContextFilters
    ): Promise<FilterOption[]> => {
      const cacheKey = buildCacheKey(filterType, companyType, contextFilters);

      // Check cache first
      const cached = cache.current[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setData((prev) => ({ ...prev, [filterType]: cached.data }));
        return cached.data;
      }

      // Prevent duplicate concurrent requests
      if (inFlight.current[filterType]) {
        return data[filterType];
      }
      inFlight.current[filterType] = true;

      // Set loading state
      setLoading((prev) => ({ ...prev, [filterType]: true }));

      try {
        const params = new URLSearchParams({
          filterType,
          type: companyType,
        });
        if (contextFilters?.minGames !== undefined) params.set('minGames', String(contextFilters.minGames));
        if (contextFilters?.minRevenue !== undefined) params.set('minRevenue', String(contextFilters.minRevenue));
        if (contextFilters?.status) params.set('status', contextFilters.status);

        const response = await fetch(`/api/companies/filter-counts?${params.toString()}`);
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          console.error(`Error fetching ${filterType} counts:`, error);
          throw new Error(error.error || `Failed to fetch ${filterType} counts`);
        }

        const result = await response.json() as { data?: FilterOption[] };
        const options = result.data ?? [];

        // Cache the result
        cache.current[cacheKey] = { data: options, timestamp: Date.now() };

        // Update state
        setData((prev) => ({ ...prev, [filterType]: options }));

        return options;
      } finally {
        inFlight.current[filterType] = false;
        setLoading((prev) => ({ ...prev, [filterType]: false }));
      }
    },
    []
  );

  /**
   * Clear the cache (useful when filters change significantly)
   */
  const clearCache = useCallback(() => {
    cache.current = {};
  }, []);

  /**
   * Invalidate cache for a specific filter type
   */
  const invalidateFilter = useCallback((filterType: FilterType) => {
    // Remove all entries for this filter type
    Object.keys(cache.current).forEach((key) => {
      if (key.startsWith(filterType)) {
        delete cache.current[key];
      }
    });
  }, []);

  return {
    data,
    loading,
    fetchCounts,
    clearCache,
    invalidateFilter,
  };
}
