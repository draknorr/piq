'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

interface SparklineData {
  dataPoints: number[];
  trend: 'up' | 'down' | 'stable';
}

interface UseSparklineLoaderReturn {
  registerRow: (
    companyId: number,
    companyType: 'publisher' | 'developer',
    element: HTMLElement | null
  ) => void;
  getSparklineData: (companyId: number, companyType: string) => SparklineData | null;
  isLoading: (companyId: number, companyType: string) => boolean;
}

/**
 * Hook for lazy-loading sparkline data using IntersectionObserver
 */
export function useSparklineLoader(): UseSparklineLoaderReturn {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadedRef = useRef<Map<string, SparklineData>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const elementsRef = useRef<Map<string, { companyId: number; companyType: 'publisher' | 'developer' }>>(new Map());
  const [, forceUpdate] = useState(0);

  // Create key for company
  const getKey = useCallback(
    (companyId: number, companyType: string) => `${companyType}-${companyId}`,
    []
  );

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

  // Load sparkline data for a company
  const loadSparkline = useCallback(
    async (companyId: number, companyType: 'publisher' | 'developer') => {
      const key = getKey(companyId, companyType);
      if (loadedRef.current.has(key) || loadingRef.current.has(key)) return;

      loadingRef.current.add(key);
      forceUpdate((n) => n + 1);

      try {
        const response = await fetch('/api/companies/sparklines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companies: [{ id: companyId, type: companyType }],
            days: 7,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch sparkline data');
        }

        const result = await response.json() as {
          data?: Array<{ sparkline_data?: Array<{ total_ccu: number }> | null }>;
        };
        const data = result.data?.[0]?.sparkline_data;

        if (data && Array.isArray(data) && data.length > 0) {
          // Extract CCU values for sparkline
          const dataPoints = data.map((d: { total_ccu: number }) => Number(d.total_ccu) || 0);
          const trend = calculateTrend(dataPoints);

          loadedRef.current.set(key, { dataPoints, trend });
        } else {
          // Store empty result to prevent retry
          loadedRef.current.set(key, { dataPoints: [], trend: 'stable' });
        }
      } catch {
        // Store empty result on error to prevent retry loops
        loadedRef.current.set(key, { dataPoints: [], trend: 'stable' });
      } finally {
        loadingRef.current.delete(key);
        forceUpdate((n) => n + 1);
      }
    },
    [getKey, calculateTrend]
  );

  // Initialize IntersectionObserver
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const elementId = entry.target.getAttribute('data-sparkline-id');
            if (elementId) {
              const info = elementsRef.current.get(elementId);
              if (info) {
                loadSparkline(info.companyId, info.companyType);
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
    };
  }, [loadSparkline]);

  // Register a row element for observation
  const registerRow = useCallback(
    (
      companyId: number,
      companyType: 'publisher' | 'developer',
      element: HTMLElement | null
    ) => {
      const key = getKey(companyId, companyType);

      if (element) {
        element.setAttribute('data-sparkline-id', key);
        elementsRef.current.set(key, { companyId, companyType });
        observerRef.current?.observe(element);
      } else {
        // Cleanup on unmount
        const existingEl = document.querySelector(`[data-sparkline-id="${key}"]`);
        if (existingEl) {
          observerRef.current?.unobserve(existingEl);
        }
        elementsRef.current.delete(key);
      }
    },
    [getKey]
  );

  const getSparklineData = useCallback(
    (companyId: number, companyType: string) => {
      return loadedRef.current.get(getKey(companyId, companyType)) ?? null;
    },
    [getKey]
  );

  const isLoading = useCallback(
    (companyId: number, companyType: string) => {
      return loadingRef.current.has(getKey(companyId, companyType));
    },
    [getKey]
  );

  return { registerRow, getSparklineData, isLoading };
}
