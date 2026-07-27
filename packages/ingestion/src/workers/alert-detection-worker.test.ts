import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { AlertSourceEvent } from '@publisheriq/database';

import {
  createSourceEventDetection,
  generateDedupKey,
  isSourceEventEnabled,
  mergePinnedEntitiesWithTigerMetrics,
  readAlertWorkerConfig,
  type PinnedEntity,
} from './alert-detection-worker.js';

function pinnedEntity(overrides: Partial<PinnedEntity> = {}): PinnedEntity {
  return {
    alert_ccu_drop: true,
    alert_ccu_spike: true,
    alert_milestone: true,
    alert_new_release: true,
    alert_price_change: true,
    alert_review_surge: true,
    alert_sentiment_shift: true,
    alert_trend_reversal: true,
    alerts_enabled: true,
    ccu_7d_avg: 1,
    ccu_current: 1,
    discount_percent: 1,
    display_name: 'Pinned Game',
    entity_id: 10,
    entity_type: 'game',
    pin_id: 'pin-1',
    positive_ratio: 0.1,
    price_cents: 1,
    review_velocity: 1,
    sensitivity_ccu: 1,
    sensitivity_review: 1,
    sensitivity_sentiment: 1,
    total_reviews: 1,
    trend_30d_direction: 'flat',
    user_id: 'user-1',
    ...overrides,
  };
}

test('readAlertWorkerConfig requires the approved hybrid boundary', () => {
  assert.deepEqual(
    readAlertWorkerConfig({
      ALERT_DELIVERY_WRITE_TARGET: 'supabase',
      ALERT_METRICS_READ_TARGET: 'tiger',
      ALERT_STATE_WRITE_TARGET: 'tiger',
    }),
    {
      deliveryWriteTarget: 'supabase',
      eventLookbackMinutes: 120,
      metricsReadTarget: 'tiger',
      stateWriteTarget: 'tiger',
    }
  );

  assert.throws(
    () =>
      readAlertWorkerConfig({
        ALERT_DELIVERY_WRITE_TARGET: 'supabase',
        ALERT_METRICS_READ_TARGET: 'supabase',
        ALERT_STATE_WRITE_TARGET: 'tiger',
      }),
    /ALERT_METRICS_READ_TARGET=tiger/
  );
});

test('mergePinnedEntitiesWithTigerMetrics discards stale Supabase product metrics', () => {
  const [mergedGame, mergedPublisher] = mergePinnedEntitiesWithTigerMetrics(
    [
      pinnedEntity(),
      pinnedEntity({
        display_name: 'Publisher',
        entity_id: 20,
        entity_type: 'publisher',
      }),
    ],
    [
      {
        ccu_7d_avg: 120,
        ccu_current: 250,
        discount_percent: 20,
        entity_id: 10,
        positive_ratio: 0.91,
        price_cents: 1999,
        review_velocity: 4.5,
        total_reviews: 5000,
        trend_30d_direction: 'up',
      },
    ]
  );

  assert.equal(mergedGame?.ccu_current, 250);
  assert.equal(mergedGame?.price_cents, 1999);
  assert.equal(mergedPublisher?.ccu_current, null);
  assert.equal(mergedPublisher?.total_reviews, null);
});

test('source event detections preserve price and publisher release semantics', () => {
  const priceEvent: AlertSourceEvent = {
    alert_type: 'price_change',
    appid: 10,
    app_name: 'Pinned Game',
    current_value: 1999,
    entity_id: 10,
    entity_type: 'game',
    event_key: 'change:1',
    occurred_at: '2026-07-26T20:00:00.000Z',
    previous_value: 2499,
    source_data: null,
  };
  const releaseEvent: AlertSourceEvent = {
    alert_type: 'new_release',
    appid: 30,
    app_name: 'New Game',
    current_value: 1,
    entity_id: 20,
    entity_type: 'publisher',
    event_key: 'release:1',
    occurred_at: '2026-07-26T21:00:00.000Z',
    previous_value: 0,
    source_data: null,
  };

  const price = createSourceEventDetection(pinnedEntity(), priceEvent);
  const release = createSourceEventDetection(
    pinnedEntity({ display_name: 'Publisher', entity_id: 20, entity_type: 'publisher' }),
    releaseEvent
  );

  assert.equal(price.title, 'Price Decreased');
  assert.equal(price.alertType, 'price_change');
  assert.equal(release.title, 'New Release: New Game');
  assert.equal(release.alertType, 'new_release');
  assert.equal(
    isSourceEventEnabled(pinnedEntity({ alert_price_change: false }), priceEvent),
    false
  );
  assert.equal(
    isSourceEventEnabled(
      pinnedEntity({
        alert_new_release: false,
        entity_id: 20,
        entity_type: 'publisher',
      }),
      releaseEvent
    ),
    false
  );
  assert.equal(
    generateDedupKey('user-1', 'publisher', 20, 'new_release', releaseEvent.occurred_at),
    'user-1:publisher:20:new_release:2026-07-26'
  );
});
