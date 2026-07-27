import type { HistogramServiceTier } from '@publisheriq/database';

export const HISTOGRAM_POLICY_VERSION = '2026-07-27.v1';
export const HISTOGRAM_MAX_BATCH_SIZE = 1200;
export const HISTOGRAM_DEFAULT_MAX_RUNTIME_MINUTES = 22;
export const HISTOGRAM_MAX_RUNTIME_MINUTES = 22;
export const HISTOGRAM_DEFAULT_REQUEST_TIMEOUT_MS = 15000;
export const HISTOGRAM_MAX_REQUEST_TIMEOUT_MS = 30000;
export const HISTOGRAM_DEFAULT_STALE_JOB_MINUTES = 45;
export const HISTOGRAM_DEFAULT_FRESH_JOB_MINUTES = 30;
export const HISTOGRAM_DEFAULT_HEARTBEAT_MINUTES = 5;

const LANE_WEIGHTS = {
  active: 40,
  medium: 19,
  longTail: 27,
  coverage: 14,
} as const;

export interface HistogramLaneQuotas {
  active: number;
  coverage: number;
  longTail: number;
  medium: number;
}

export interface HistogramRuntimeConfig {
  batchSize: number;
  freshJobMinutes: number;
  heartbeatMinutes: number;
  laneQuotas: HistogramLaneQuotas;
  maxRuntimeMs: number;
  requestTimeoutMs: number;
  staleJobMinutes: number;
}

export interface HistogramTierSignals {
  priorityScore: number;
  reviewVelocityTier?: string | null;
  totalReviews: number;
  velocity7d: number;
}

function parseBoundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

export function createHistogramLaneQuotas(limit: number): HistogramLaneQuotas {
  const boundedLimit = Math.max(0, Math.floor(limit));
  const weighted = [
    { key: 'active' as const, weight: LANE_WEIGHTS.active },
    { key: 'medium' as const, weight: LANE_WEIGHTS.medium },
    { key: 'longTail' as const, weight: LANE_WEIGHTS.longTail },
    { key: 'coverage' as const, weight: LANE_WEIGHTS.coverage },
  ];
  const quotas: HistogramLaneQuotas = {
    active: 0,
    coverage: 0,
    longTail: 0,
    medium: 0,
  };

  let assigned = 0;
  const remainders = weighted.map(({ key, weight }) => {
    const exact = (boundedLimit * weight) / 100;
    const base = Math.floor(exact);
    quotas[key] = base;
    assigned += base;
    return { key, remainder: exact - base };
  });

  remainders.sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return (
      weighted.findIndex((entry) => entry.key === left.key) -
      weighted.findIndex((entry) => entry.key === right.key)
    );
  });

  for (let index = 0; assigned < boundedLimit; index++) {
    const target = remainders[index % remainders.length];
    if (!target) {
      break;
    }
    quotas[target.key]++;
    assigned++;
  }

  return quotas;
}

export function classifyHistogramServiceTier(signals: HistogramTierSignals): HistogramServiceTier {
  if (
    signals.reviewVelocityTier === 'high' ||
    signals.reviewVelocityTier === 'medium' ||
    signals.velocity7d >= 1 ||
    signals.priorityScore >= 100 ||
    signals.totalReviews >= 10000
  ) {
    return 'active_daily';
  }

  if (signals.priorityScore >= 25 || signals.totalReviews >= 1000) {
    return 'medium_weekly';
  }

  return 'long_tail_monthly';
}

export function getHistogramTargetHours(tier: HistogramServiceTier): number {
  switch (tier) {
    case 'active_daily':
      return 24;
    case 'medium_weekly':
      return 7 * 24;
    case 'long_tail_monthly':
      return 30 * 24;
  }
}

export function readHistogramRuntimeConfig(
  env: NodeJS.ProcessEnv,
  defaultBatchSize: number
): HistogramRuntimeConfig {
  const batchSize = parseBoundedPositiveInteger(
    env.BATCH_SIZE,
    defaultBatchSize,
    HISTOGRAM_MAX_BATCH_SIZE
  );
  const maxRuntimeMinutes = parseBoundedPositiveInteger(
    env.HISTOGRAM_MAX_RUNTIME_MINUTES,
    HISTOGRAM_DEFAULT_MAX_RUNTIME_MINUTES,
    HISTOGRAM_MAX_RUNTIME_MINUTES
  );
  const requestTimeoutMs = parseBoundedPositiveInteger(
    env.HISTOGRAM_REQUEST_TIMEOUT_MS,
    HISTOGRAM_DEFAULT_REQUEST_TIMEOUT_MS,
    HISTOGRAM_MAX_REQUEST_TIMEOUT_MS
  );

  return {
    batchSize,
    freshJobMinutes: parseBoundedPositiveInteger(
      env.HISTOGRAM_FRESH_JOB_MINUTES,
      HISTOGRAM_DEFAULT_FRESH_JOB_MINUTES,
      HISTOGRAM_DEFAULT_STALE_JOB_MINUTES
    ),
    heartbeatMinutes: parseBoundedPositiveInteger(
      env.HISTOGRAM_HEARTBEAT_MINUTES,
      HISTOGRAM_DEFAULT_HEARTBEAT_MINUTES,
      HISTOGRAM_DEFAULT_MAX_RUNTIME_MINUTES
    ),
    laneQuotas: createHistogramLaneQuotas(batchSize),
    maxRuntimeMs: maxRuntimeMinutes * 60 * 1000,
    requestTimeoutMs,
    staleJobMinutes: parseBoundedPositiveInteger(
      env.HISTOGRAM_STALE_JOB_MINUTES,
      HISTOGRAM_DEFAULT_STALE_JOB_MINUTES,
      24 * 60
    ),
  };
}
