import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyHistogramServiceTier,
  createHistogramLaneQuotas,
  getHistogramTargetHours,
  HISTOGRAM_MAX_BATCH_SIZE,
  readHistogramRuntimeConfig,
} from './histogram-policy.js';

test('histogram policy reserves enough daily capacity for active freshness', () => {
  const quotas = createHistogramLaneQuotas(1200);

  assert.deepEqual(quotas, {
    active: 480,
    coverage: 168,
    longTail: 324,
    medium: 228,
  });
  assert.equal(quotas.active * 8, 3840);
  assert.ok(quotas.active * 8 >= 3716);
  assert.equal(getHistogramTargetHours('active_daily'), 24);
});

test('histogram policy always reserves eventual-processing capacity for low-priority work', () => {
  const quotas = createHistogramLaneQuotas(1200);
  let lowPriorityBacklog = 984;
  let runs = 0;

  while (lowPriorityBacklog > 0 && runs < 10) {
    lowPriorityBacklog -= quotas.longTail + quotas.coverage;
    runs++;
  }

  assert.equal(runs, 2);
  assert.ok(lowPriorityBacklog <= 0);
  assert.ok(quotas.longTail > 0);
  assert.ok(quotas.coverage > 0);
});

test('histogram service-tier classification is deterministic at boundaries', () => {
  assert.equal(
    classifyHistogramServiceTier({
      priorityScore: 0,
      reviewVelocityTier: 'high',
      totalReviews: 1,
      velocity7d: 0,
    }),
    'active_daily'
  );
  assert.equal(
    classifyHistogramServiceTier({
      priorityScore: 25,
      totalReviews: 1,
      velocity7d: 0,
    }),
    'medium_weekly'
  );
  assert.equal(
    classifyHistogramServiceTier({
      priorityScore: 0,
      totalReviews: 999,
      velocity7d: 0,
    }),
    'long_tail_monthly'
  );
});

test('histogram runtime config caps manual batch and runtime overrides', () => {
  const config = readHistogramRuntimeConfig(
    {
      BATCH_SIZE: '9000',
      HISTOGRAM_MAX_RUNTIME_MINUTES: '90',
      HISTOGRAM_REQUEST_TIMEOUT_MS: '90000',
    } as NodeJS.ProcessEnv,
    1200
  );

  assert.equal(config.batchSize, HISTOGRAM_MAX_BATCH_SIZE);
  assert.equal(config.maxRuntimeMs, 22 * 60 * 1000);
  assert.equal(config.requestTimeoutMs, 30000);
  assert.equal(
    Object.values(config.laneQuotas).reduce((sum, quota) => sum + quota, 0),
    HISTOGRAM_MAX_BATCH_SIZE
  );
});
