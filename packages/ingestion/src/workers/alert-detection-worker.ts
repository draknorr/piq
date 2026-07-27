/**
 * Alert Detection Worker
 *
 * Detects anomalies in pinned entities and creates alerts for users. Supabase
 * remains authoritative for user controls and delivered alerts. Tiger provides
 * current metrics, source events, detection state, and job observability.
 *
 * Alert types detected:
 * - ccu_spike: CCU > 50% above 7-day average
 * - ccu_drop: CCU > 50% below 7-day average
 * - trend_reversal: 30-day trend direction changed
 * - review_surge: Review velocity > 3x normal
 * - sentiment_shift: Positive ratio changed > 5%
 * - price_change: Current Tiger change-intelligence price event
 * - new_release: Current Tiger lifecycle event for a pinned publisher/developer
 * - milestone: Review count crossed threshold (10K, 100K, 1M)
 *
 * Run with: pnpm --filter @publisheriq/ingestion alert-detection
 */

import { pathToFileURL } from 'node:url';

import {
  getServiceClient,
  getTigerWriter,
  type AlertDetectionState,
  type AlertDetectionStateUpsert,
  type AlertEntityKey,
  type AlertEntityMetrics,
  type AlertEntityType,
  type AlertSourceEvent,
} from '@publisheriq/database';
import { logger, ALERT_THRESHOLDS } from '@publisheriq/shared';

const log = logger.child({ worker: 'alert-detection' });
const DEFAULT_EVENT_LOOKBACK_MINUTES = 120;
const MAX_EVENT_LOOKBACK_MINUTES = 1440;

export type AlertType =
  | 'ccu_spike'
  | 'ccu_drop'
  | 'trend_reversal'
  | 'review_surge'
  | 'sentiment_shift'
  | 'price_change'
  | 'new_release'
  | 'milestone';

type AlertSeverity = 'low' | 'medium' | 'high';

export interface PinnedEntity {
  user_id: string;
  pin_id: string;
  entity_type: AlertEntityType;
  entity_id: number;
  display_name: string;
  ccu_current: number | null;
  ccu_7d_avg: number | null;
  review_velocity: number | null;
  positive_ratio: number | null;
  total_reviews: number | null;
  price_cents: number | null;
  discount_percent: number | null;
  trend_30d_direction: string | null;
  sensitivity_ccu: number;
  sensitivity_review: number;
  sensitivity_sentiment: number;
  alerts_enabled: boolean;
  // Per-alert-type toggles (merged from pin and global settings)
  alert_ccu_spike: boolean;
  alert_ccu_drop: boolean;
  alert_trend_reversal: boolean;
  alert_review_surge: boolean;
  alert_sentiment_shift: boolean;
  alert_price_change: boolean;
  alert_new_release: boolean;
  alert_milestone: boolean;
}

export interface DetectionResult {
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  metricName: string;
  previousValue: number | null;
  currentValue: number | null;
  changePercent: number | null;
}

interface AlertInsert {
  user_id: string;
  pin_id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  metric_name: string;
  previous_value: number | null;
  current_value: number | null;
  change_percent: number | null;
  dedup_key: string;
  source_data: Record<string, unknown>;
}

export interface AlertWorkerConfig {
  deliveryWriteTarget: 'supabase';
  eventLookbackMinutes: number;
  metricsReadTarget: 'tiger';
  stateWriteTarget: 'tiger';
}

function requireTarget(
  env: NodeJS.ProcessEnv,
  name: string,
  expected: string
): void {
  const actual = env[name]?.trim().toLowerCase();
  if (actual !== expected) {
    throw new Error(`Alert detection requires ${name}=${expected}; received ${actual ?? 'unset'}`);
  }
}

function parseEventLookbackMinutes(value: string | undefined): number {
  if (!value) {
    return DEFAULT_EVENT_LOOKBACK_MINUTES;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_EVENT_LOOKBACK_MINUTES) {
    throw new Error(
      `ALERT_EVENT_LOOKBACK_MINUTES must be an integer from 1 to ${MAX_EVENT_LOOKBACK_MINUTES}`
    );
  }

  return parsed;
}

export function readAlertWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): AlertWorkerConfig {
  requireTarget(env, 'ALERT_METRICS_READ_TARGET', 'tiger');
  requireTarget(env, 'ALERT_STATE_WRITE_TARGET', 'tiger');
  requireTarget(env, 'ALERT_DELIVERY_WRITE_TARGET', 'supabase');

  return {
    deliveryWriteTarget: 'supabase',
    eventLookbackMinutes: parseEventLookbackMinutes(env.ALERT_EVENT_LOOKBACK_MINUTES),
    metricsReadTarget: 'tiger',
    stateWriteTarget: 'tiger',
  };
}

export function mergePinnedEntitiesWithTigerMetrics(
  pinnedEntities: PinnedEntity[],
  metrics: AlertEntityMetrics[]
): PinnedEntity[] {
  const metricsByAppid = new Map(metrics.map((row) => [row.entity_id, row]));

  return pinnedEntities.map((entity) => {
    const current = entity.entity_type === 'game' ? metricsByAppid.get(entity.entity_id) : null;

    return {
      ...entity,
      ccu_7d_avg: current?.ccu_7d_avg ?? null,
      ccu_current: current?.ccu_current ?? null,
      discount_percent: current?.discount_percent ?? null,
      positive_ratio: current?.positive_ratio ?? null,
      price_cents: current?.price_cents ?? null,
      review_velocity: current?.review_velocity ?? null,
      total_reviews: current?.total_reviews ?? null,
      trend_30d_direction: current?.trend_30d_direction ?? null,
    };
  });
}

export function detectCcuAnomaly(
  entity: PinnedEntity,
  baseline: AlertDetectionState | null,
  sensitivity: number
): DetectionResult | null {
  const current = entity.ccu_current;

  // Skip if no current CCU or too low to matter
  if (!current || current < ALERT_THRESHOLDS.CCU_MIN_ABSOLUTE) {
    return null;
  }

  // Use baseline 7d avg if available, otherwise use entity's ccu_7d_avg, otherwise skip
  const avg = baseline?.ccu_7d_avg ?? entity.ccu_7d_avg;
  if (!avg || avg === 0) {
    return null;
  }

  const changePercent = ((current - avg) / avg) * 100;
  // Higher sensitivity = lower threshold (more alerts)
  const threshold = ALERT_THRESHOLDS.CCU_CHANGE_PERCENT / sensitivity;

  if (changePercent > threshold) {
    const severity: AlertSeverity = changePercent > 100 ? 'high' : 'medium';
    return {
      alertType: 'ccu_spike',
      severity,
      title: `CCU Spike: +${changePercent.toFixed(0)}%`,
      description: `${entity.display_name} CCU jumped from ${avg.toLocaleString()} to ${current.toLocaleString()}`,
      metricName: 'ccu',
      previousValue: avg,
      currentValue: current,
      changePercent,
    };
  } else if (changePercent < -threshold) {
    const severity: AlertSeverity = changePercent < -75 ? 'high' : 'medium';
    return {
      alertType: 'ccu_drop',
      severity,
      title: `CCU Drop: ${changePercent.toFixed(0)}%`,
      description: `${entity.display_name} CCU dropped from ${avg.toLocaleString()} to ${current.toLocaleString()}`,
      metricName: 'ccu',
      previousValue: avg,
      currentValue: current,
      changePercent,
    };
  }

  return null;
}

export function detectTrendReversal(
  entity: PinnedEntity,
  baseline: AlertDetectionState | null
): DetectionResult | null {
  const current = entity.trend_30d_direction;
  const previous = baseline?.trend_30d_direction_prev;

  // Need both current and previous to detect reversal
  if (!current || !previous) {
    return null;
  }

  // Check if direction changed (up->down, down->up)
  const isReversal =
    (previous === 'up' && current === 'down') || (previous === 'down' && current === 'up');

  if (!isReversal) {
    return null;
  }

  const direction = current === 'up' ? 'upward' : 'downward';
  return {
    alertType: 'trend_reversal',
    severity: 'medium',
    title: `Trend Reversal: Now ${direction}`,
    description: `${entity.display_name} trend changed from ${previous} to ${current}`,
    metricName: 'trend',
    previousValue: null,
    currentValue: null,
    changePercent: null,
  };
}

export function detectReviewSurge(
  entity: PinnedEntity,
  baseline: AlertDetectionState | null,
  sensitivity: number
): DetectionResult | null {
  const currentVelocity = entity.review_velocity;

  // Skip if velocity too low
  if (!currentVelocity || currentVelocity < ALERT_THRESHOLDS.REVIEW_MIN_DAILY) {
    return null;
  }

  const avgVelocity = baseline?.review_velocity_7d_avg ?? currentVelocity / 2;
  if (!avgVelocity || avgVelocity === 0) {
    return null;
  }

  // Higher sensitivity = lower multiplier threshold (more alerts)
  const threshold = ALERT_THRESHOLDS.REVIEW_VELOCITY_MULTIPLIER / sensitivity;
  const multiplier = currentVelocity / avgVelocity;

  if (multiplier >= threshold) {
    const severity: AlertSeverity = multiplier >= 5 ? 'high' : 'medium';
    return {
      alertType: 'review_surge',
      severity,
      title: `Review Surge: ${multiplier.toFixed(1)}x normal`,
      description: `${entity.display_name} is receiving ${currentVelocity.toFixed(1)} reviews/day (normally ${avgVelocity.toFixed(1)})`,
      metricName: 'review_velocity',
      previousValue: avgVelocity,
      currentValue: currentVelocity,
      changePercent: (multiplier - 1) * 100,
    };
  }

  return null;
}

export function detectSentimentShift(
  entity: PinnedEntity,
  baseline: AlertDetectionState | null,
  sensitivity: number
): DetectionResult | null {
  const currentRatio = entity.positive_ratio;
  const totalReviews = entity.total_reviews;

  // Need enough reviews for ratio to be meaningful
  if (
    !currentRatio ||
    !totalReviews ||
    totalReviews < ALERT_THRESHOLDS.SENTIMENT_MIN_REVIEWS
  ) {
    return null;
  }

  const previousRatio = baseline?.positive_ratio_prev;
  if (previousRatio === null || previousRatio === undefined) {
    return null;
  }

  // Calculate change in positive percentage points
  const changePercent = (currentRatio - previousRatio) * 100;
  // Higher sensitivity = lower threshold (more alerts)
  const threshold = ALERT_THRESHOLDS.SENTIMENT_CHANGE_PERCENT / sensitivity;

  if (Math.abs(changePercent) >= threshold) {
    const direction = changePercent > 0 ? 'improved' : 'declined';
    const severity: AlertSeverity = 'medium';
    return {
      alertType: 'sentiment_shift',
      severity,
      title: `Sentiment ${direction}: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`,
      description: `${entity.display_name} positive ratio changed from ${(previousRatio * 100).toFixed(0)}% to ${(currentRatio * 100).toFixed(0)}%`,
      metricName: 'positive_ratio',
      previousValue: previousRatio,
      currentValue: currentRatio,
      changePercent,
    };
  }

  return null;
}

export function detectMilestone(
  entity: PinnedEntity,
  baseline: AlertDetectionState | null
): DetectionResult | null {
  const currentReviews = entity.total_reviews;
  const previousReviews = baseline?.total_reviews_prev;

  if (!currentReviews || !previousReviews) {
    return null;
  }

  // Check if we crossed any milestone threshold
  for (const milestone of ALERT_THRESHOLDS.MILESTONES) {
    if (previousReviews < milestone && currentReviews >= milestone) {
      const milestoneLabel =
        milestone >= 1000000
          ? `${(milestone / 1000000).toFixed(0)}M`
          : `${(milestone / 1000).toFixed(0)}K`;

      const severity: AlertSeverity = milestone >= 100000 ? 'high' : 'medium';
      return {
        alertType: 'milestone',
        severity,
        title: `Milestone: ${milestoneLabel} reviews`,
        description: `${entity.display_name} has reached ${currentReviews.toLocaleString()} reviews`,
        metricName: 'total_reviews',
        previousValue: previousReviews,
        currentValue: currentReviews,
        changePercent: null,
      };
    }
  }

  return null;
}

export function createSourceEventDetection(
  entity: PinnedEntity,
  event: AlertSourceEvent
): DetectionResult {
  if (event.alert_type === 'new_release') {
    const appName = event.app_name ?? `Steam app ${event.appid}`;
    return {
      alertType: 'new_release',
      severity: 'high',
      title: `New Release: ${appName}`,
      description: `${entity.display_name} released: ${appName}`,
      metricName: 'appid',
      previousValue: null,
      currentValue: event.appid,
      changePercent: null,
    };
  }

  const previous = event.previous_value;
  const current = event.current_value;
  const changePercent =
    previous !== null && previous !== 0 && current !== null
      ? ((current - previous) / previous) * 100
      : null;
  const title =
    previous !== null && current !== null
      ? current > previous
        ? 'Price Increased'
        : current < previous
          ? 'Price Decreased'
          : 'Price Changed'
      : 'Price Changed';

  return {
    alertType: 'price_change',
    severity: 'low',
    title,
    description: `${entity.display_name}: ${title}`,
    metricName: 'price_cents',
    previousValue: previous,
    currentValue: current,
    changePercent,
  };
}

export function isSourceEventEnabled(
  entity: PinnedEntity,
  event: AlertSourceEvent
): boolean {
  return event.alert_type === 'price_change'
    ? entity.alert_price_change
    : entity.alert_new_release;
}

export function generateDedupKey(
  userId: string,
  entityType: string,
  entityId: number,
  alertType: AlertType,
  occurredAt = new Date().toISOString()
): string {
  return `${userId}:${entityType}:${entityId}:${alertType}:${occurredAt.slice(0, 10)}`;
}

export async function runAlertDetection(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const startTime = Date.now();
  const config = readAlertWorkerConfig(env);
  const githubRunId = env.GITHUB_RUN_ID;
  const tiger = getTigerWriter(env);
  const supabase = getServiceClient();
  // Personalization tables/RPCs are not yet present in the generated Supabase types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let jobId: string | null = null;
  let entitiesProcessed = 0;
  let alertsCreated = 0;
  let statesUpdated = 0;

  log.info('Starting hybrid alert detection', { config, githubRunId });

  try {
    jobId = await tiger.ops.createSyncJob({
      githubRunId,
      jobType: 'alert_detection',
    });

    // This RPC is intentionally retained as the Supabase user-control boundary.
    // Its stale product metric columns are discarded below.
    const { data: pinnedData, error: fetchError } = await db.rpc(
      'get_pinned_entities_with_metrics'
    );
    if (fetchError) {
      throw new Error(`Failed to fetch Supabase alert controls: ${fetchError.message}`);
    }

    const pinnedControls = (pinnedData ?? []) as PinnedEntity[];
    const gameIds = [
      ...new Set(
        pinnedControls
          .filter((entity) => entity.entity_type === 'game')
          .map((entity) => entity.entity_id)
      ),
    ];
    const metrics = await tiger.alertsPinsChat.listAlertEntityMetrics(gameIds);
    const pinnedEntities = mergePinnedEntitiesWithTigerMetrics(pinnedControls, metrics);

    const uniqueEntityMap = new Map<string, AlertEntityKey>();
    for (const entity of pinnedEntities) {
      const key = `${entity.entity_type}:${entity.entity_id}`;
      uniqueEntityMap.set(key, {
        entity_id: entity.entity_id,
        entity_type: entity.entity_type,
      });
    }
    const uniqueEntities = [...uniqueEntityMap.values()];
    const uniqueIds = [...new Set(uniqueEntities.map((entity) => entity.entity_id))];
    const states = await tiger.alertsPinsChat.listAlertDetectionStates(uniqueIds);
    const stateMap = new Map<string, AlertDetectionState>();
    for (const state of states) {
      stateMap.set(`${state.entity_type}:${state.entity_id}`, state);
    }

    const since = new Date(
      Date.now() - config.eventLookbackMinutes * 60 * 1000
    ).toISOString();
    const sourceEvents = await tiger.alertsPinsChat.listRecentAlertSourceEvents(
      uniqueEntities,
      since
    );
    const eventsByEntity = new Map<string, AlertSourceEvent[]>();
    for (const event of sourceEvents) {
      const key = `${event.entity_type}:${event.entity_id}`;
      eventsByEntity.set(key, [...(eventsByEntity.get(key) ?? []), event]);
    }

    const alertsToInsert: AlertInsert[] = [];
    const statesToUpdate: AlertDetectionStateUpsert[] = [];
    const processedEntities = new Set<string>();

    for (const entity of pinnedEntities) {
      entitiesProcessed++;
      if (!entity.alerts_enabled) {
        continue;
      }

      const stateKey = `${entity.entity_type}:${entity.entity_id}`;
      const baseline = stateMap.get(stateKey) ?? null;

      const detections: (DetectionResult | null)[] = [];
      if (entity.alert_ccu_spike || entity.alert_ccu_drop) {
        const ccuResult = detectCcuAnomaly(entity, baseline, entity.sensitivity_ccu);
        if (
          (ccuResult?.alertType === 'ccu_spike' && entity.alert_ccu_spike) ||
          (ccuResult?.alertType === 'ccu_drop' && entity.alert_ccu_drop)
        ) {
          detections.push(ccuResult);
        }
      }
      if (entity.alert_trend_reversal) {
        detections.push(detectTrendReversal(entity, baseline));
      }
      if (entity.alert_review_surge) {
        detections.push(detectReviewSurge(entity, baseline, entity.sensitivity_review));
      }
      if (entity.alert_sentiment_shift) {
        detections.push(detectSentimentShift(entity, baseline, entity.sensitivity_sentiment));
      }
      if (entity.alert_milestone) {
        detections.push(detectMilestone(entity, baseline));
      }

      for (const detection of detections) {
        if (detection) {
          alertsToInsert.push({
            user_id: entity.user_id,
            pin_id: entity.pin_id,
            alert_type: detection.alertType,
            severity: detection.severity,
            title: detection.title,
            description: detection.description,
            metric_name: detection.metricName,
            previous_value: detection.previousValue,
            current_value: detection.currentValue,
            change_percent: detection.changePercent,
            dedup_key: generateDedupKey(
              entity.user_id,
              entity.entity_type,
              entity.entity_id,
              detection.alertType
            ),
            source_data: {
              metricsReadTarget: config.metricsReadTarget,
              stateWriteTarget: config.stateWriteTarget,
            },
          });
        }
      }

      for (const event of eventsByEntity.get(stateKey) ?? []) {
        if (!isSourceEventEnabled(entity, event)) {
          continue;
        }

        const detection = createSourceEventDetection(entity, event);
        alertsToInsert.push({
          user_id: entity.user_id,
          pin_id: entity.pin_id,
          alert_type: detection.alertType,
          severity: detection.severity,
          title: detection.title,
          description: detection.description,
          metric_name: detection.metricName,
          previous_value: detection.previousValue,
          current_value: detection.currentValue,
          change_percent: detection.changePercent,
          dedup_key: generateDedupKey(
            entity.user_id,
            entity.entity_type,
            entity.entity_id,
            detection.alertType,
            event.occurred_at
          ),
          source_data: {
            ...(event.source_data ?? {}),
            appName: event.app_name,
            appid: event.appid,
            eventKey: event.event_key,
            metricsReadTarget: config.metricsReadTarget,
            occurredAt: event.occurred_at,
          },
        });
      }

      if (!processedEntities.has(stateKey)) {
        processedEntities.add(stateKey);
        statesToUpdate.push({
          entity_type: entity.entity_type,
          entity_id: entity.entity_id,
          ccu_7d_avg: entity.ccu_7d_avg ?? entity.ccu_current,
          ccu_prev_value: entity.ccu_current,
          review_velocity_7d_avg: entity.review_velocity,
          positive_ratio_prev: entity.positive_ratio,
          total_reviews_prev: entity.total_reviews,
          trend_30d_direction_prev: entity.trend_30d_direction,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (alertsToInsert.length > 0) {
      const { error: insertError, count } = await db.from('user_alerts').upsert(
        alertsToInsert,
        {
          onConflict: 'dedup_key',
          ignoreDuplicates: true,
          count: 'exact',
        }
      );
      if (insertError) {
        throw new Error(`Failed to deliver Supabase user alerts: ${insertError.message}`);
      }
      alertsCreated = count ?? 0;
    }

    statesUpdated =
      statesToUpdate.length > 0
        ? await tiger.alertsPinsChat.upsertAlertDetectionStates(statesToUpdate)
        : 0;

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: entitiesProcessed,
        items_succeeded: alertsCreated,
        items_failed: 0,
        metadata: {
          alertsConsidered: alertsToInsert.length,
          deliveryWriteTarget: config.deliveryWriteTarget,
          eventLookbackMinutes: config.eventLookbackMinutes,
          metricsReadTarget: config.metricsReadTarget,
          stateWriteTarget: config.stateWriteTarget,
          statesUpdated,
        },
      });
    }

    log.info('Hybrid alert detection completed', {
      entitiesProcessed,
      alertsConsidered: alertsToInsert.length,
      alertsCreated,
      statesUpdated,
      durationSeconds: ((Date.now() - startTime) / 1000).toFixed(2),
    });
  } catch (error) {
    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_failed: Math.max(1, entitiesProcessed),
        items_processed: entitiesProcessed,
      });
    }
    throw error;
  }
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  runAlertDetection().catch((error: unknown) => {
    log.error('Alert detection failed', { error });
    process.exitCode = 1;
  });
}
