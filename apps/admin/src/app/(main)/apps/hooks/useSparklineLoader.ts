'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { createBrowserClient } from '@/lib/supabase/client';

export interface SparklineData {
  dataPoints: number[];
  trend: 'up' | 'down' | 'stable';
}

interface SparklineRpcResponse {
  appid: number;
  sparkline_data: Array<{ date: string; ccu: number }>;
}

export interface UseSparklineLoaderReturn {
  registerRow: (appid: number, element: HTMLElement | null) => void;
  getSparklineData: (appid: number) => SparklineData | null;
  isLoading: (appid: number) => boolean;
}

/**
 * Hook for lazy-loading sparkline data using IntersectionObserver
 * Batches multiple visible rows into a single RPC call for efficiency
 */
export function useSparklineLoader(): UseSparklineLoaderReturn {
  const authReady = useAuthReady();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadedRef = useRef<Map<number, SparklineData>>(new Map());
  const loadingRef = useRef<Set<number>>(new Set());
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const pendingBatchRef = useRef<Set<number>>(new Set());
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [, forceUpdate] = useState(0);

  // Calculate trend from data points
  const calculateTrend = useCallback((dataPoints: number[]): 'up' | 'down' | 'stable' => {
    if (dataPoints.length < 2) return 'stable';

    const midpoint = Math.floor(dataPoints.length / 2);
    const firstHalf = dataPoints.slice(0, midpoint);
    const secondHalf = dataPoints.slice(midpoint);

    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

    if (avgFirst === 0) return 'stable';
    const changePercent = ((avgSecond - avgFirst) / avgFirst) * 100;

    if (changePercent > 5) return 'up';
    if (changePercent < -5) return 'down';
    return 'stable';
  }, []);

  // Process a batch of appids
  const processBatch = useCallback(async () => {
    const appids = Array.from(pendingBatchRef.current);
    pendingBatchRef.current.clear();

    if (appids.length === 0) return;

    if (!authReady) {
      forceUpdate((n) => n + 1);
      return;
    }

    // Mark all as loading
    appids.forEach(appid => loadingRef.current.add(appid));
    forceUpdate((n) => n + 1);

    try {
      const supabase = createBrowserClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('get_app_sparkline_data', {
        p_appids: appids,
        p_days: 7,
      });

      if (!error && data) {
        const responseData = data as SparklineRpcResponse[];

        // Process each app's sparkline data
        const receivedAppids = new Set<number>();
        responseData.forEach((row) => {
          receivedAppids.add(row.appid);
          const sparklineData = row.sparkline_data || [];
          const dataPoints = sparklineData.map((d) => Number(d.ccu) || 0);
          const trend = calculateTrend(dataPoints);
          loadedRef.current.set(row.appid, { dataPoints, trend });
        });

        // Mark apps with no data as empty (to prevent retry)
        appids.forEach(appid => {
          if (!receivedAppids.has(appid)) {
            loadedRef.current.set(appid, { dataPoints: [], trend: 'stable' });
          }
        });
      } else {
        // Store empty result for all on error
        appids.forEach(appid => {
          loadedRef.current.set(appid, { dataPoints: [], trend: 'stable' });
        });
      }
    } catch {
      // Store empty result on error to prevent retry loops
      appids.forEach(appid => {
        loadedRef.current.set(appid, { dataPoints: [], trend: 'stable' });
      });
    } finally {
      // Remove all from loading
      appids.forEach(appid => loadingRef.current.delete(appid));
      forceUpdate((n) => n + 1);
    }
  }, [authReady, calculateTrend]);

  // Queue an appid for batch loading
  const queueForLoading = useCallback(
    (appid: number) => {
      if (loadedRef.current.has(appid) || loadingRef.current.has(appid) || pendingBatchRef.current.has(appid)) {
        return;
      }

      pendingBatchRef.current.add(appid);

      // Debounce batch processing (collect all visible rows before fetching)
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
      batchTimeoutRef.current = setTimeout(() => {
        processBatch();
      }, 50); // 50ms debounce to collect multiple visible rows
    },
    [processBatch]
  );

  // Initialize IntersectionObserver
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const appidStr = entry.target.getAttribute('data-sparkline-appid');
            if (appidStr) {
              const appid = parseInt(appidStr, 10);
              if (!isNaN(appid)) {
                queueForLoading(appid);
              }
            }
          }
        });
      },
      {
        root: null,
        rootMargin: '100px', // Load slightly before visible
        threshold: 0,
      }
    );

    return () => {
      observerRef.current?.disconnect();
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, [queueForLoading]);

  useEffect(() => {
    if (!authReady) {
      loadedRef.current.clear();
      loadingRef.current.clear();
      pendingBatchRef.current.clear();
      forceUpdate((n) => n + 1);
      return;
    }

    elementsRef.current.forEach((_element, appid) => {
      queueForLoading(appid);
    });
  }, [authReady, queueForLoading]);

  // Register a row element for observation
  const registerRow = useCallback(
    (appid: number, element: HTMLElement | null) => {
      if (element) {
        element.setAttribute('data-sparkline-appid', String(appid));
        elementsRef.current.set(appid, element);
        observerRef.current?.observe(element);
      } else {
        // Cleanup on unmount
        const existingEl = elementsRef.current.get(appid);
        if (existingEl) {
          observerRef.current?.unobserve(existingEl);
        }
        elementsRef.current.delete(appid);
      }
    },
    []
  );

  const getSparklineData = useCallback(
    (appid: number) => {
      return loadedRef.current.get(appid) ?? null;
    },
    []
  );

  const isLoading = useCallback(
    (appid: number) => {
      return loadingRef.current.has(appid) || pendingBatchRef.current.has(appid);
    },
    []
  );

  return { registerRow, getSparklineData, isLoading };
}
