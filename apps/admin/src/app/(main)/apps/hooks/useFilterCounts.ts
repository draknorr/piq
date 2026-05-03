'use client';

import { useState, useCallback, useRef } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import type { AppType } from '../lib/apps-types';

/**
 * Filter option returned from the Tiger-backed filter-count endpoint.
 */
export interface FilterOption {
  option_id: number;
  option_name: string;
  app_count: number;
}

export type FilterType = 'genre' | 'tag' | 'category' | 'steam_deck' | 'platform' | 'ccu_tier';

interface CacheEntry {
  data: FilterOption[];
  timestamp: number;
}

interface ContextFilters {
  minCcu?: number;
  minReviews?: number;
  minScore?: number;
  minOwners?: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Hook for lazy-loading Tiger-backed filter option counts with caching.
 */
export function useFilterCounts() {
  const authReady = useAuthReady();
  const [loading, setLoading] = useState<Record<FilterType, boolean>>({
    genre: false,
    tag: false,
    category: false,
    steam_deck: false,
    platform: false,
    ccu_tier: false,
  });

  const [data, setData] = useState<Record<FilterType, FilterOption[]>>({
    genre: [],
    tag: [],
    category: [],
    steam_deck: [],
    platform: [],
    ccu_tier: [],
  });

  const cache = useRef<Record<string, CacheEntry>>({});

  // Track in-flight requests to prevent duplicate fetches
  const inFlight = useRef<Record<FilterType, boolean>>({
    genre: false,
    tag: false,
    category: false,
    steam_deck: false,
    platform: false,
    ccu_tier: false,
  });

  /**
   * Build a cache key from filter type and context.
   * Keys are sorted to ensure consistent cache hits regardless of property order.
   */
  const buildCacheKey = (
    filterType: FilterType,
    appType: AppType,
    context?: ContextFilters
  ): string => {
    const sortedContext = context
      ? JSON.stringify(
          Object.keys(context)
            .sort()
            .reduce((acc, key) => {
              const value = context[key as keyof ContextFilters];
              if (value !== undefined) {
                acc[key] = value;
              }
              return acc;
            }, {} as Record<string, unknown>)
        )
      : '{}';
    return `${filterType}-${appType}-${sortedContext}`;
  };

  /**
   * Fetch counts for a filter type with optional contextual filters.
   * Results are cached for 5 minutes. Prevents duplicate in-flight requests.
   */
  const fetchCounts = useCallback(
    async (
      filterType: FilterType,
      appType: AppType = 'game',
      contextFilters?: ContextFilters
    ): Promise<FilterOption[]> => {
      if (!authReady) {
        setData((prev) => (
          prev[filterType].length === 0
            ? prev
            : { ...prev, [filterType]: [] }
        ));
        return [];
      }

      const cacheKey = buildCacheKey(filterType, appType, contextFilters);

      // Check cache first
      const cached = cache.current[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        // Only update state if data actually changed (avoid re-renders)
        if (data[filterType] !== cached.data) {
          setData((prev) => ({ ...prev, [filterType]: cached.data }));
        }
        return cached.data;
      }

      // Skip if request already in-flight for this filter type
      if (inFlight.current[filterType]) {
        // Return existing data while waiting
        return data[filterType];
      }

      // Mark as in-flight
      inFlight.current[filterType] = true;

      // Set loading state
      setLoading((prev) => ({ ...prev, [filterType]: true }));

      try {
        const searchParams = new URLSearchParams({
          filterType,
          type: appType,
        });
        if (contextFilters?.minCcu !== undefined) searchParams.set('minCcu', String(contextFilters.minCcu));
        if (contextFilters?.minReviews !== undefined) searchParams.set('minReviews', String(contextFilters.minReviews));
        if (contextFilters?.minScore !== undefined) searchParams.set('minScore', String(contextFilters.minScore));
        if (contextFilters?.minOwners !== undefined) searchParams.set('minOwners', String(contextFilters.minOwners));

        const response = await fetch(`/api/apps/filter-counts?${searchParams.toString()}`);

        if (!response.ok) {
          if (response.status === 401) {
            setData((prev) => ({ ...prev, [filterType]: [] }));
            return [];
          }

          const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          console.error(`Error fetching ${filterType} counts:`, error);
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const result = await response.json() as { data?: FilterOption[] };
        const options = result.data ?? [];

        // Cache the result
        cache.current[cacheKey] = { data: options, timestamp: Date.now() };

        // Update state
        setData((prev) => ({ ...prev, [filterType]: options }));

        return options;
      } finally {
        // Clear in-flight flag
        inFlight.current[filterType] = false;
        setLoading((prev) => ({ ...prev, [filterType]: false }));
      }
    },
    [authReady, data]
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
