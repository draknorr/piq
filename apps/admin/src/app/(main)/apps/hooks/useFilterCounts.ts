'use client';

import { useState, useCallback, useRef } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { createBrowserClient } from '@/lib/supabase/client';
import type { AppType } from '../lib/apps-types';

/**
 * Filter option returned from get_apps_filter_option_counts RPC
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
 * Hook for lazy-loading filter option counts with caching.
 * Calls get_apps_filter_option_counts RPC when dropdowns open.
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
        const supabase = createBrowserClient();

        const rpcParams = {
          p_filter_type: filterType,
          p_type: appType,
          p_min_ccu: contextFilters?.minCcu,
          p_min_reviews: contextFilters?.minReviews,
          p_min_score: contextFilters?.minScore,
          p_min_owners: contextFilters?.minOwners,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (supabase.rpc as any)('get_apps_filter_option_counts', rpcParams);

        const { data: result, error } = response;

        if (error) {
          const errorMessage = error.message.toLowerCase();
          const isUnauthorized =
            errorMessage.includes('authentication required') ||
            errorMessage.includes('jwt') ||
            errorMessage.includes('unauthorized');

          if (isUnauthorized) {
            setData((prev) => ({ ...prev, [filterType]: [] }));
            return [];
          }

          console.error(`Error fetching ${filterType} counts:`, error);
          throw error;
        }

        const options = (result ?? []) as FilterOption[];

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
