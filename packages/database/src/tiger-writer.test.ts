import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';

import { createTigerWriterForPool, type TigerQueryClient, type TigerWriterPool } from './tiger-writer.js';

interface QueryCall {
  sql: string;
  values?: readonly unknown[];
}

function result<T extends QueryResultRow>(rows: T[] = [], rowCount = rows.length): QueryResult<T> {
  return { rowCount, rows } as QueryResult<T>;
}

class CapturingClient implements TigerQueryClient {
  readonly calls: QueryCall[] = [];
  released = false;

  constructor(private readonly responses: Array<QueryResult<QueryResultRow>>) {}

  async query<T extends QueryResultRow>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push({ sql, values });
    return (this.responses.shift() ?? result()) as QueryResult<T>;
  }

  release(): void {
    this.released = true;
  }
}

class CapturingPool implements TigerWriterPool {
  readonly calls: QueryCall[] = [];
  client: CapturingClient | null = null;

  constructor(private readonly responses: Array<QueryResult<QueryResultRow>> = []) {}

  async query<T extends QueryResultRow>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push({ sql, values });
    return (this.responses.shift() ?? result()) as QueryResult<T>;
  }

  async connect(): Promise<TigerQueryClient> {
    this.client = new CapturingClient(this.responses);
    return this.client;
  }
}

test('createSyncJob inserts into ops.sync_jobs', async () => {
  const pool = new CapturingPool([result([{ id: 'job-1' }])]);
  const writer = createTigerWriterForPool(pool);

  const id = await writer.ops.createSyncJob({
    batchSize: 10,
    githubRunId: 'run-123',
    jobType: 'storefront',
  });

  assert.equal(id, 'job-1');
  assert.match(pool.calls[0]?.sql ?? '', /INSERT INTO ops\.sync_jobs/);
  assert.deepEqual(pool.calls[0]?.values, ['storefront', 'run-123', null, 10]);
});

test('updateSyncJob can persist metadata on ops.sync_jobs', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.ops.updateSyncJob('00000000-0000-0000-0000-000000000001', {
    metadata: { gracefulShutdown: true },
    status: 'completed',
  });

  assert.equal(updated, 1);
  assert.match(pool.calls[0]?.sql ?? '', /metadata = \$2/);
  assert.match(pool.calls[0]?.sql ?? '', /status = \$3/);
  assert.deepEqual(pool.calls[0]?.values, [
    '00000000-0000-0000-0000-000000000001',
    { gracefulShutdown: true },
    'completed',
  ]);
});

test('heartbeatSyncJob updates only running ops.sync_jobs rows', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.ops.heartbeatSyncJob('00000000-0000-0000-0000-000000000001');

  assert.equal(updated, 1);
  assert.match(pool.calls[0]?.sql ?? '', /UPDATE ops\.sync_jobs/);
  assert.match(pool.calls[0]?.sql ?? '', /SET updated_at = now\(\)/);
  assert.match(pool.calls[0]?.sql ?? '', /WHERE id = \$1::uuid/);
  assert.match(pool.calls[0]?.sql ?? '', /status = 'running'/);
  assert.deepEqual(pool.calls[0]?.values, ['00000000-0000-0000-0000-000000000001']);
});

test('abandonStaleSyncJobs marks old running jobs failed by job type', async () => {
  const pool = new CapturingPool([result([], 2)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.ops.abandonStaleSyncJobs({
    errorMessage: 'abandoned_as_stale_by_new_histogram_run',
    jobTypes: ['histogram'],
    startedBeforeIso: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(updated, 2);
  assert.match(pool.calls[0]?.sql ?? '', /UPDATE ops\.sync_jobs/);
  assert.match(pool.calls[0]?.sql ?? '', /job_type = ANY\(\$1::text\[\]\)/);
  assert.match(pool.calls[0]?.sql ?? '', /status = 'running'/);
  assert.match(pool.calls[0]?.sql ?? '', /started_at < \$2::timestamptz/);
  assert.deepEqual(pool.calls[0]?.values, [
    ['histogram'],
    '2026-05-10T00:00:00.000Z',
    'abandoned_as_stale_by_new_histogram_run',
  ]);
});

test('abandonStaleRunningSyncJobsByTypes uses heartbeat freshness cutoff', async () => {
  const pool = new CapturingPool([result([], 3)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.ops.abandonStaleRunningSyncJobsByTypes({
    errorMessage: 'abandoned_as_stale_before_ccu_guard',
    jobTypes: ['ccu-daily-p0', 'ccu-tiered'],
    staleBeforeIso: '2026-06-08T07:00:00.000Z',
  });

  assert.equal(updated, 3);
  assert.match(pool.calls[0]?.sql ?? '', /UPDATE ops\.sync_jobs/);
  assert.match(pool.calls[0]?.sql ?? '', /job_type = ANY\(\$1::text\[\]\)/);
  assert.match(pool.calls[0]?.sql ?? '', /status = 'running'/);
  assert.match(
    pool.calls[0]?.sql ?? '',
    /GREATEST\(COALESCE\(updated_at, started_at\), started_at\) < \$2::timestamptz/
  );
  assert.deepEqual(pool.calls[0]?.values, [
    ['ccu-daily-p0', 'ccu-tiered'],
    '2026-06-08T07:00:00.000Z',
    'abandoned_as_stale_before_ccu_guard',
  ]);
});

test('countRunningSyncJobsByTypes counts active jobs across guarded CCU lanes', async () => {
  const pool = new CapturingPool([result([{ count: '2' }])]);
  const writer = createTigerWriterForPool(pool);

  const count = await writer.ops.countRunningSyncJobsByTypes(
    ['ccu', 'ccu-tiered'],
    '2026-06-07T00:00:00.000Z'
  );

  assert.equal(count, 2);
  assert.match(pool.calls[0]?.sql ?? '', /job_type = ANY\(\$1::text\[\]\)/);
  assert.match(pool.calls[0]?.sql ?? '', /status = 'running'/);
  assert.deepEqual(pool.calls[0]?.values, [
    ['ccu', 'ccu-tiered'],
    '2026-06-07T00:00:00.000Z',
  ]);
});

test('countFreshRunningSyncJobsByTypes returns active counts grouped by job type', async () => {
  const pool = new CapturingPool([
    result([
      { job_type: 'ccu-daily-p0', count: '1' },
      { job_type: 'ccu-tiered', count: 2 },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const counts = await writer.ops.countFreshRunningSyncJobsByTypes(
    ['ccu', 'ccu-daily-p0', 'ccu-tiered'],
    '2026-06-08T07:30:00.000Z'
  );

  assert.deepEqual(counts, [
    { jobType: 'ccu-daily-p0', count: 1 },
    { jobType: 'ccu-tiered', count: 2 },
  ]);
  assert.match(pool.calls[0]?.sql ?? '', /SELECT job_type, count\(\*\)::integer AS count/);
  assert.match(pool.calls[0]?.sql ?? '', /job_type = ANY\(\$1::text\[\]\)/);
  assert.match(pool.calls[0]?.sql ?? '', /status = 'running'/);
  assert.match(
    pool.calls[0]?.sql ?? '',
    /GREATEST\(COALESCE\(updated_at, started_at\), started_at\) >= \$2::timestamptz/
  );
  assert.match(pool.calls[0]?.sql ?? '', /GROUP BY job_type/);
  assert.deepEqual(pool.calls[0]?.values, [
    ['ccu', 'ccu-daily-p0', 'ccu-tiered'],
    '2026-06-08T07:30:00.000Z',
  ]);
});

test('countSyncJobMetadataNumberSince sums numeric metadata for request budgets', async () => {
  const pool = new CapturingPool([result([{ count: '1234' }])]);
  const writer = createTigerWriterForPool(pool);

  const count = await writer.ops.countSyncJobMetadataNumberSince({
    jobType: 'ccu-demo-tiered',
    metadataKey: 'requestCount',
    startedAfterIso: '2026-06-09T00:00:00.000Z',
  });

  assert.equal(count, 1234);
  assert.match(pool.calls[0]?.sql ?? '', /metadata ->> \$2/);
  assert.match(pool.calls[0]?.sql ?? '', /metadata \? \$2/);
  assert.deepEqual(pool.calls[0]?.values, [
    'ccu-demo-tiered',
    'requestCount',
    '2026-06-09T00:00:00.000Z',
  ]);
});

test('syncStatus.updateFields only writes allowlisted defined columns', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.syncStatus.updateFields(10, {
    bad_column: 'ignored',
    last_reviews_sync: '2026-04-29T00:00:00.000Z',
    next_reviews_sync: undefined,
  });

  assert.equal(updated, 1);
  assert.match(pool.calls[0]?.sql ?? '', /last_reviews_sync = \$2/);
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /bad_column/);
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /next_reviews_sync/);
  assert.deepEqual(pool.calls[0]?.values, [10, '2026-04-29T00:00:00.000Z']);
});

test('catalog.listAppsForSync calls the non-partitioned Tiger RPC', async () => {
  const pool = new CapturingPool([
    result([
      { appid: 10, priority_score: '12.5' },
      { appid: 20, priority_score: null },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const candidates = await writer.catalog.listAppsForSync({
    source: 'storefront',
    limit: 2,
  });

  assert.deepEqual(candidates, [
    { appid: 10, priorityScore: 12.5 },
    { appid: 20, priorityScore: 0 },
  ]);
  assert.match(pool.calls[0]?.sql ?? '', /ops\.get_apps_for_sync\(\$1::text, \$2::integer\)/);
  assert.deepEqual(pool.calls[0]?.values, ['storefront', 2]);
});

test('catalog.listAppsForSync calls the partitioned Tiger RPC when partitioned', async () => {
  const pool = new CapturingPool([result([{ appid: 30, priority_score: 5 }])]);
  const writer = createTigerWriterForPool(pool);

  const candidates = await writer.catalog.listAppsForSync({
    source: 'storefront',
    limit: 10,
    partitionCount: 6,
    partitionId: 2,
  });

  assert.deepEqual(candidates, [{ appid: 30, priorityScore: 5 }]);
  assert.match(pool.calls[0]?.sql ?? '', /ops\.get_apps_for_sync_partitioned/);
  assert.deepEqual(pool.calls[0]?.values, ['storefront', 10, 6, 2]);
});

test('catalog.markStorefrontInaccessible updates apps and sync_status transactionally', async () => {
  const pool = new CapturingPool([result(), result([], 1), result([], 1), result()]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.catalog.markStorefrontInaccessible(
    123,
    '2026-04-29T00:00:00.000Z'
  );

  assert.equal(updated, 1);
  assert.equal(pool.client?.released, true);
  assert.deepEqual(
    pool.client?.calls.map((call) => call.sql.trim().split(/\s+/).slice(0, 3).join(' ')),
    ['BEGIN', 'UPDATE legacy.apps SET', 'INSERT INTO ops.sync_status', 'COMMIT']
  );
  assert.match(pool.client?.calls[1]?.sql ?? '', /is_delisted = true/);
  assert.match(pool.client?.calls[1]?.sql ?? '', /has_purchase_packages = NULL/);
  assert.deepEqual(pool.client?.calls[1]?.values, [123, '2026-04-29T00:00:00.000Z']);
  assert.deepEqual(pool.client?.calls[2]?.values, [123, '2026-04-29T00:00:00.000Z']);
});

test('catalog.upsertStorefrontApp passes demo and purchase-package args to Tiger function', async () => {
  const pool = new CapturingPool([result()]);
  const writer = createTigerWriterForPool(pool);

  await writer.catalog.upsertStorefrontApp({
    p_appid: 4615010,
    p_name: 'Kibble Cats',
    p_type: 'game',
    p_is_free: false,
    p_is_delisted: false,
    p_release_date: null,
    p_release_date_raw: 'Coming soon',
    p_has_workshop: false,
    p_current_price_cents: null,
    p_current_discount_percent: 0,
    p_is_released: false,
    p_developers: ['Mokutori'],
    p_publishers: ['Mokutori'],
    p_dlc_appids: [],
    p_parent_appid: null,
    p_demo_appids: [4707330],
    p_has_purchase_packages: false,
  });

  assert.match(pool.calls[0]?.sql ?? '', /\$16::integer\[\]/);
  assert.match(pool.calls[0]?.sql ?? '', /\$17::boolean/);
  assert.deepEqual(pool.calls[0]?.values, [
    4615010,
    'Kibble Cats',
    'game',
    false,
    false,
    null,
    'Coming soon',
    false,
    null,
    0,
    false,
    ['Mokutori'],
    ['Mokutori'],
    [],
    null,
    [4707330],
    false,
  ]);
});

test('reviews.promoteReviewsSyncBatch calls Tiger promotion RPC in bulk', async () => {
  const pool = new CapturingPool([result([{ count: 2 }])]);
  const writer = createTigerWriterForPool(pool);

  const promoted = await writer.reviews.promoteReviewsSyncBatch([
    {
      appid: 100,
      bucket: 'important_backfill',
      reason: 'new_app',
      score: 25,
      until: '2026-04-29T12:00:00.000Z',
    },
    {
      appid: 200,
      bucket: 'change_critical',
      reason: 'change',
      score: 70,
      until: '2026-04-29T13:00:00.000Z',
    },
  ]);

  assert.equal(promoted, 2);
  assert.match(pool.calls[0]?.sql ?? '', /ops\.promote_reviews_sync/);
  assert.deepEqual(JSON.parse(String(pool.calls[0]?.values?.[0])), [
    {
      appid: 100,
      bucket: 'important_backfill',
      reason: 'new_app',
      score: 25,
      until_at: '2026-04-29T12:00:00.000Z',
    },
    {
      appid: 200,
      bucket: 'change_critical',
      reason: 'change',
      score: 70,
      until_at: '2026-04-29T13:00:00.000Z',
    },
  ]);
});

test('reviews.loadPreviousSyncData ignores latest CCU-only daily metric rows', async () => {
  const pool = new CapturingPool([
    result([
      {
        appid: 2416450,
        consecutive_errors: '0',
        last_known_total_reviews: '9795',
        last_reviews_sync: new Date('2026-05-07T04:06:39.000Z'),
        positive_reviews: '7418',
        reviews_interval_hours: '4',
        total_reviews: '7794',
      },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const { neverSyncedSet, previousSyncData } = await writer.reviews.loadPreviousSyncData([
    2416450,
  ]);
  const previous = previousSyncData.get(2416450);

  assert.equal(neverSyncedSet.has(2416450), false);
  assert.equal(previous?.lastSync?.toISOString(), '2026-05-07T04:06:39.000Z');
  assert.equal(previous?.totalReviews, 7794);
  assert.equal(previous?.positiveReviews, 7418);
  assert.equal(previous?.intervalHours, 4);
  assert.match(pool.calls[0]?.sql ?? '', /LEFT JOIN LATERAL/);
  assert.match(pool.calls[0]?.sql ?? '', /metrics\.review_deltas/);
  assert.match(pool.calls[0]?.sql ?? '', /COALESCE\(m\.positive_reviews, rd\.positive_reviews\)/);
  assert.match(pool.calls[0]?.sql ?? '', /m\.total_reviews IS NOT NULL/);
  assert.match(pool.calls[0]?.sql ?? '', /m\.positive_reviews IS NOT NULL/);
  assert.match(pool.calls[0]?.sql ?? '', /ORDER BY m\.metric_date DESC/);
  assert.deepEqual(pool.calls[0]?.values, [[2416450]]);
});

test('catalog.replaceAppRelations rejects unsupported relation tables', async () => {
  const pool = new CapturingPool();
  const writer = createTigerWriterForPool(pool);

  await assert.rejects(
    () =>
      writer.catalog.replaceAppRelations({
        appid: 10,
        conflict: 'appid, tag_id',
        rows: [],
        table: 'app_tags',
      }),
    /Unsupported legacy app relation table/
  );

  assert.equal(pool.client, null);
});

test('metrics.insertCcuSnapshots uses Tiger table row typing for JSON payloads', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  await writer.metrics.insertCcuSnapshots([
    {
      appid: 10,
      ccu_tier: 1,
      player_count: 1234,
      snapshot_time: '2026-04-29T00:00:00.000Z',
    },
  ]);

  assert.match(
    pool.calls[0]?.sql ?? '',
    /jsonb_populate_recordset\(NULL::metrics\.ccu_snapshots/
  );
});

test('metrics.recalculateDemoCcuTiers ranks active demos into a demo-only table', async () => {
  const pool = new CapturingPool([result([{ tier1_count: '300', tier2_count: '10700' }])]);
  const writer = createTigerWriterForPool(pool);

  const counts = await writer.metrics.recalculateDemoCcuTiers({
    hotLimit: 300,
    newDemoWindowDays: 14,
  });

  assert.deepEqual(counts, { tier1Count: 300, tier2Count: 10700 });
  assert.match(pool.calls[0]?.sql ?? '', /INSERT INTO ops\.demo_ccu_tier_assignments/);
  assert.match(pool.calls[0]?.sql ?? '', /a\.type = 'demo'/);
  assert.match(pool.calls[0]?.sql ?? '', /is_new_demo/);
  assert.match(
    pool.calls[0]?.sql ?? '',
    /COALESCE\(ad\.release_date >= CURRENT_DATE - \$2::integer, false\)/
  );
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /created_at >= now\(\)/);
  assert.match(pool.calls[0]?.sql ?? '', /metrics\.ccu_snapshots/);
  assert.match(pool.calls[0]?.sql ?? '', /metrics\.daily_metrics/);
  assert.deepEqual(pool.calls[0]?.values, [300, 14]);
});

test('metrics.listDemoCcuTierAppids rotates tail demos by oldest sync state', async () => {
  const pool = new CapturingPool([
    result([{ count: '3' }]),
    result([{ appid: 10 }, { appid: 20 }]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const candidates = await writer.metrics.listDemoCcuTierAppids({
    limit: 2,
    nowIso: '2026-06-07T00:00:00.000Z',
    tier: 2,
  });

  assert.deepEqual(candidates, { appids: [10, 20], skippedCount: 3 });
  assert.match(pool.calls[0]?.sql ?? '', /ops\.demo_ccu_tier_assignments/);
  assert.match(pool.calls[0]?.sql ?? '', /a\.type = 'demo'/);
  assert.match(pool.calls[1]?.sql ?? '', /ORDER BY dcta\.last_ccu_synced ASC NULLS FIRST/);
  assert.deepEqual(pool.calls[0]?.values, [2, '2026-06-07T00:00:00.000Z']);
  assert.deepEqual(pool.calls[1]?.values, [2, 2, '2026-06-07T00:00:00.000Z']);
});

test('metrics.listDemoCcuTierAppids keeps hot demos in rank order', async () => {
  const pool = new CapturingPool([
    result([{ count: 0 }]),
    result([{ appid: 30 }, { appid: 40 }]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const candidates = await writer.metrics.listDemoCcuTierAppids({
    limit: 300,
    nowIso: '2026-06-07T00:00:00.000Z',
    tier: 1,
  });

  assert.deepEqual(candidates.appids, [30, 40]);
  assert.match(pool.calls[1]?.sql ?? '', /ORDER BY dcta\.rank_position ASC NULLS LAST/);
});

test('metrics.listAdaptiveDemoCcuCandidates prioritizes positive, new, unknown, and zero buckets', async () => {
  const pool = new CapturingPool([
    result([{ count: '2' }]),
    result([
      { bucket: 'p0_new_positive', count: '1' },
      { bucket: 'p2_never_synced', count: '4' },
    ]),
    result([
      { appid: 10, bucket: 'p0_new_positive', demo_ccu_tier: 1 },
      { appid: 20, bucket: 'p2_never_synced', demo_ccu_tier: 2 },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const candidates = await writer.metrics.listAdaptiveDemoCcuCandidates({
    limit: 2,
    newDemoWindowDays: 14,
    newPositiveRefreshMinutes: 30,
    newZeroRefreshHours: 6,
    nowIso: '2026-06-09T12:00:00.000Z',
    positiveRefreshMinutes: 60,
    zeroRefreshDays: 3,
  });

  assert.deepEqual(candidates.candidates, [
    { appid: 10, bucket: 'p0_new_positive', demoCcuTier: 1 },
    { appid: 20, bucket: 'p2_never_synced', demoCcuTier: 2 },
  ]);
  assert.equal(candidates.skippedCount, 2);
  assert.equal(candidates.breakdown.p0_new_positive, 1);
  assert.equal(candidates.breakdown.p2_never_synced, 4);
  assert.match(pool.calls[1]?.sql ?? '', /\$1::integer AS candidate_limit/);
  assert.match(pool.calls[1]?.sql ?? '', /last_ccu_validation_state = 'confirmed_positive'/);
  assert.match(pool.calls[1]?.sql ?? '', /last_ccu_synced IS NULL/);
  assert.match(pool.calls[1]?.sql ?? '', /last_ccu_validation_state = 'confirmed_zero'/);
  assert.match(pool.calls[2]?.sql ?? '', /WHEN 'p0_new_positive' THEN 0/);
  assert.deepEqual(pool.calls[2]?.values, [
    2,
    '2026-06-09T12:00:00.000Z',
    14,
    30,
    60,
    6,
    3,
  ]);
});

test('metrics.updateDemoCcuTierAssignments only updates demo poll-state table', async () => {
  const pool = new CapturingPool([result([], 2)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.metrics.updateDemoCcuTierAssignments([10, 20], {
    ccu_fetch_status: 'valid',
    bad_column: 'ignored',
    last_ccu_validation_state: 'confirmed_positive',
  });

  assert.equal(updated, 2);
  assert.match(pool.calls[0]?.sql ?? '', /UPDATE ops\.demo_ccu_tier_assignments/);
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /ops\.ccu_tier_assignments/);
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /bad_column/);
  assert.deepEqual(pool.calls[0]?.values, [
    [10, 20],
    'valid',
    'confirmed_positive',
  ]);
});

test('issueReports.createIssueReport inserts into chat.issue_reports with JSON row typing', async () => {
  const pool = new CapturingPool([
    result([{ id: '00000000-0000-0000-0000-000000000001' }]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const id = await writer.issueReports.createIssueReport({
    app_context: { environment: 'production' },
    browser_context: { userAgent: 'test' },
    debug_context: {},
    id: '00000000-0000-0000-0000-000000000001',
    include_chat_preview: false,
    issue_type: 'UI bug or layout issue',
    page_context: {},
    route_context: { pathname: '/apps' },
    route_pathname: '/apps',
    route_url: 'https://publisheriq.app/apps',
    status: 'open',
    user_id: '00000000-0000-0000-0000-000000000002',
  });

  assert.equal(id, '00000000-0000-0000-0000-000000000001');
  assert.match(pool.calls[0]?.sql ?? '', /INSERT INTO chat\.issue_reports/);
  assert.match(
    pool.calls[0]?.sql ?? '',
    /jsonb_populate_recordset\(NULL::chat\.issue_reports/
  );
  assert.equal(
    JSON.parse(String(pool.calls[0]?.values?.[0]))[0].issue_type,
    'UI bug or layout issue'
  );
});

test('issueReports.attachSentryIds only updates allowlisted Sentry columns for owner', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.issueReports.attachSentryIds({
    ids: {
      bad_column: 'ignored',
      sentry_client_event_id: 'client-event',
      sentry_feedback_id: 'feedback',
    },
    reportId: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000002',
  });

  assert.equal(updated, 1);
  assert.match(pool.calls[0]?.sql ?? '', /sentry_client_event_id = \$3/);
  assert.match(pool.calls[0]?.sql ?? '', /sentry_feedback_id = \$4/);
  assert.match(pool.calls[0]?.sql ?? '', /user_id = \$2::uuid/);
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /bad_column/);
  assert.deepEqual(pool.calls[0]?.values, [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'client-event',
    'feedback',
  ]);
});

test('metrics.listPriceSyncAppids reads due price candidates from ops.sync_status', async () => {
  const pool = new CapturingPool([result([{ appid: 10 }, { appid: 20 }])]);
  const writer = createTigerWriterForPool(pool);

  const appids = await writer.metrics.listPriceSyncAppids(
    25,
    '2026-04-30T00:00:00.000Z'
  );

  assert.deepEqual(appids, [10, 20]);
  assert.match(pool.calls[0]?.sql ?? '', /last_price_sync/);
  assert.match(pool.calls[0]?.sql ?? '', /storefront_accessible/);
  assert.deepEqual(pool.calls[0]?.values, [25, '2026-04-30T00:00:00.000Z']);
});

test('metrics.batchUpdatePrices calls the Tiger price RPC', async () => {
  const pool = new CapturingPool([result([{ count: '2' }])]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.metrics.batchUpdatePrices({
    appids: [10, 20],
    prices: [499, 999],
    discounts: [0, 20],
  });

  assert.equal(updated, 2);
  assert.match(pool.calls[0]?.sql ?? '', /ops\.batch_update_prices/);
  assert.deepEqual(pool.calls[0]?.values, [[10, 20], [499, 999], [0, 20]]);
});

test('metrics.listTier3CcuAppids returns partitioned candidates and skipped count', async () => {
  const pool = new CapturingPool([
    result([{ count: '7' }]),
    result([{ appid: 30 }, { appid: 40 }]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const candidates = await writer.metrics.listTier3CcuAppids({
    limit: 100,
    nowIso: '2026-04-30T01:00:00.000Z',
    partitionCount: 3,
    partitionId: 1,
  });

  assert.deepEqual(candidates, {
    appids: [30, 40],
    skippedCount: 7,
  });
  assert.match(pool.calls[0]?.sql ?? '', /ccu_skip_until > \$1::timestamptz/);
  assert.match(pool.calls[1]?.sql ?? '', /row_number\(\) OVER/);
  assert.deepEqual(pool.calls[0]?.values, ['2026-04-30T01:00:00.000Z']);
  assert.deepEqual(pool.calls[1]?.values, [
    100,
    '2026-04-30T01:00:00.000Z',
    3,
    1,
  ]);
});

test('metrics.listSuspiciousZeroAppids calls the Tiger guardrail RPC', async () => {
  const pool = new CapturingPool([result([{ appids: [10, 30] }])]);
  const writer = createTigerWriterForPool(pool);

  const suspicious = await writer.metrics.listSuspiciousZeroAppids([10, 20, 30]);

  assert.deepEqual([...suspicious], [10, 30]);
  assert.match(pool.calls[0]?.sql ?? '', /ops\.get_suspicious_zero_appids/);
  assert.deepEqual(pool.calls[0]?.values, [[10, 20, 30]]);
});

test('metrics.upsertDailyCcuPeaks preserves existing larger daily peaks transactionally', async () => {
  const pool = new CapturingPool([result(), result([], 2), result([], 2), result()]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.metrics.upsertDailyCcuPeaks([
    {
      appid: 10,
      metric_date: '2026-04-30',
      ccu_peak: 123,
      ccu_source: 'steam_api',
    },
  ]);

  assert.equal(updated, 2);
  assert.equal(pool.client?.released, true);
  assert.deepEqual(
    pool.client?.calls.map((call) => call.sql.trim().split(/\s+/).slice(0, 3).join(' ')),
    ['BEGIN', 'INSERT INTO metrics.daily_metrics', 'INSERT INTO legacy.latest_daily_metrics', 'COMMIT']
  );
  assert.match(pool.client?.calls[1]?.sql ?? '', /GREATEST/);
  assert.match(pool.client?.calls[2]?.sql ?? '', /GREATEST/);
  assert.deepEqual(JSON.parse(String(pool.client?.calls[1]?.values?.[0])), [
    {
      appid: 10,
      metric_date: '2026-04-30',
      ccu_peak: 123,
      ccu_source: 'steam_api',
    },
  ]);
});

test('ops.countRunningSyncJobs counts active duplicate-guard jobs', async () => {
  const pool = new CapturingPool([result([{ count: '3' }])]);
  const writer = createTigerWriterForPool(pool);

  const count = await writer.ops.countRunningSyncJobs(
    'velocity-calc',
    '2026-04-30T00:00:00.000Z'
  );

  assert.equal(count, 3);
  assert.match(pool.calls[0]?.sql ?? '', /FROM ops\.sync_jobs/);
  assert.match(pool.calls[0]?.sql ?? '', /status = 'running'/);
  assert.deepEqual(pool.calls[0]?.values, ['velocity-calc', '2026-04-30T00:00:00.000Z']);
});

test('syncStatus.listHistogramStatuses normalizes Tiger timestamps', async () => {
  const pool = new CapturingPool([
    result([
      { appid: 10, last_histogram_sync: new Date('2026-04-30T01:02:03.000Z') },
      { appid: 20, last_histogram_sync: null },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const statuses = await writer.syncStatus.listHistogramStatuses([10, 20]);

  assert.deepEqual(statuses, [
    { appid: 10, lastHistogramSync: '2026-04-30T01:02:03.000Z' },
    { appid: 20, lastHistogramSync: null },
  ]);
  assert.match(pool.calls[0]?.sql ?? '', /FROM ops\.sync_status/);
  assert.deepEqual(pool.calls[0]?.values, [[10, 20]]);
});

test('metrics.listReviewHistogramAppidPage returns unique appids and cursor metadata', async () => {
  const pool = new CapturingPool([
    result([{ appid: 10 }, { appid: 10 }, { appid: 20 }]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const page = await writer.metrics.listReviewHistogramAppidPage(0, 3);

  assert.deepEqual(page, {
    appids: [10, 20],
    hasMore: true,
    nextCursor: 20,
    rowsFetched: 3,
  });
  assert.match(pool.calls[0]?.sql ?? '', /FROM metrics\.review_histogram/);
  assert.deepEqual(pool.calls[0]?.values, [0, 3]);
});

test('metrics.listReviewHistogramEntries normalizes dates and numeric values', async () => {
  const pool = new CapturingPool([
    result([
      {
        appid: 10,
        month_start: new Date('2026-04-01T00:00:00.000Z'),
        recommendations_down: '2',
        recommendations_up: '20',
      },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const entries = await writer.metrics.listReviewHistogramEntries([10]);

  assert.deepEqual(entries, [
    {
      appid: 10,
      month_start: '2026-04-01',
      recommendations_down: 2,
      recommendations_up: 20,
    },
  ]);
  assert.match(pool.calls[0]?.sql ?? '', /ORDER BY appid ASC, month_start DESC/);
  assert.deepEqual(pool.calls[0]?.values, [[10]]);
});

test('metrics.upsertReviewHistogram refreshes fetched_at on conflict', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const updated = await writer.metrics.upsertReviewHistogram([
    {
      appid: 10,
      month_start: '2026-04-01',
      recommendations_down: 2,
      recommendations_up: 20,
    },
  ]);

  assert.equal(updated, 1);
  assert.match(pool.calls[0]?.sql ?? '', /INSERT INTO metrics\.review_histogram/);
  assert.match(pool.calls[0]?.sql ?? '', /COALESCE\(fetched_at, now\(\)\) AS fetched_at/);
  assert.match(pool.calls[0]?.sql ?? '', /fetched_at = EXCLUDED\.fetched_at/);
  assert.deepEqual(JSON.parse(String(pool.calls[0]?.values?.[0])), [
    {
      appid: 10,
      month_start: '2026-04-01',
      recommendations_down: 2,
      recommendations_up: 20,
    },
  ]);
});

test('metrics.countReviewDeltas counts interpolated review deltas by date', async () => {
  const pool = new CapturingPool([result([{ count: 42 }])]);
  const writer = createTigerWriterForPool(pool);

  const count = await writer.metrics.countReviewDeltas({
    startDate: '2026-04-01',
    interpolated: true,
  });

  assert.equal(count, 42);
  assert.match(pool.calls[0]?.sql ?? '', /FROM metrics\.review_deltas/);
  assert.deepEqual(pool.calls[0]?.values, ['2026-04-01', true]);
});

test('metrics.listPriorityInputs returns joined priority calculation inputs', async () => {
  const pool = new CapturingPool([
    result([
      {
        appid: 10,
        ccu_peak: '123',
        is_released: true,
        last_reviews_sync: new Date('2026-04-29T00:00:00.000Z'),
        last_steamspy_sync: null,
        release_date: '2026-04-01T00:00:00.000Z',
        review_velocity_30d: '3.5',
        review_velocity_7d: '7.25',
        total_reviews: '999',
        trend_30d_change_pct: '-2.5',
      },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const rows = await writer.metrics.listPriorityInputs(50, 100);

  assert.deepEqual(rows, [
    {
      appid: 10,
      ccu_peak: 123,
      is_released: true,
      last_reviews_sync: '2026-04-29T00:00:00.000Z',
      last_steamspy_sync: null,
      release_date: '2026-04-01',
      review_velocity_30d: 3.5,
      review_velocity_7d: 7.25,
      total_reviews: 999,
      trend_30d_change_pct: -2.5,
    },
  ]);
  assert.match(pool.calls[0]?.sql ?? '', /WITH status_page AS/);
  assert.match(pool.calls[0]?.sql ?? '', /appid IN \(SELECT appid FROM status_page\)/);
  assert.deepEqual(pool.calls[0]?.values, [50, 100]);
});

test('metrics.listPriorityInputsAfter uses keyset pagination and latest metrics table', async () => {
  const pool = new CapturingPool([
    result([
      {
        appid: 10,
        ccu_peak: '123',
        is_released: true,
        last_reviews_sync: new Date('2026-04-29T00:00:00.000Z'),
        last_steamspy_sync: null,
        release_date: '2026-04-01T00:00:00.000Z',
        review_velocity_30d: '3.5',
        review_velocity_7d: '7.25',
        total_reviews: '999',
        trend_30d_change_pct: '-2.5',
      },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const rows = await writer.metrics.listPriorityInputsAfter(5000, 100);

  assert.deepEqual(rows, [
    {
      appid: 10,
      ccu_peak: 123,
      is_released: true,
      last_reviews_sync: '2026-04-29T00:00:00.000Z',
      last_steamspy_sync: null,
      release_date: '2026-04-01',
      review_velocity_30d: 3.5,
      review_velocity_7d: 7.25,
      total_reviews: 999,
      trend_30d_change_pct: -2.5,
    },
  ]);
  assert.match(pool.calls[0]?.sql ?? '', /WHERE appid > \$1/);
  assert.match(pool.calls[0]?.sql ?? '', /LEFT JOIN legacy\.latest_daily_metrics ldm/);
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /metrics\.daily_metrics/);
  assert.deepEqual(pool.calls[0]?.values, [5000, 100]);
});

test('embeddings.listGameCandidates reads full embedding rows from Tiger RPC', async () => {
  const pool = new CapturingPool([
    result([
      {
        appid: 10,
        average_playtime_forever: '120',
        categories: ['Single-player'],
        ccu_growth_30d: null,
        ccu_growth_7d: '12.5',
        ccu_peak: '456',
        content_descriptors: { ids: [1] },
        controller_support: 'full',
        current_price_cents: '1999',
        developer_ids: ['1'],
        developers: ['Dev'],
        franchise_ids: ['5'],
        franchise_names: ['Series'],
        genres: ['Action'],
        historical_review_pct: '82.1',
        is_delisted: false,
        is_free: false,
        is_released: true,
        language_count: '4',
        metacritic_score: '88',
        name: 'Game',
        owners_min: '100000',
        pics_review_percentage: '90',
        pics_review_score: '8',
        platforms: 'windows,macos',
        primary_genre: 'Action',
        publisher_ids: ['2'],
        publishers: ['Pub'],
        recent_review_pct: '91.2',
        release_date: new Date('2026-04-01T00:00:00.000Z'),
        sentiment_delta: '3.1',
        steam_deck_category: 'verified',
        steamspy_tags: ['Roguelike'],
        tags: ['Indie'],
        total_reviews: '999',
        trend_30d_direction: 'up',
        type: 'game',
        updated_at: new Date('2026-04-30T00:00:00.000Z'),
        velocity_7d: '7.5',
        velocity_acceleration: null,
        velocity_tier: 'high',
      },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const rows = await writer.embeddings.listGameCandidates(25);

  assert.equal(rows[0]?.appid, 10);
  assert.equal(rows[0]?.release_date, '2026-04-01');
  assert.equal(rows[0]?.updated_at, '2026-04-30T00:00:00.000Z');
  assert.deepEqual(rows[0]?.developer_ids, [1]);
  assert.deepEqual(rows[0]?.steamspy_tags, ['Roguelike']);
  assert.equal(rows[0]?.ccu_growth_7d, 12.5);
  assert.match(pool.calls[0]?.sql ?? '', /ops\.get_apps_for_embedding\(\$1::integer\)/);
  assert.deepEqual(pool.calls[0]?.values, [25]);
});

test('embeddings mark-complete methods preserve per-row hashes', async () => {
  const pool = new CapturingPool([result([], 2), result([], 2)]);
  const writer = createTigerWriterForPool(pool);

  const gameCount = await writer.embeddings.markGamesEmbedded(
    [10, 20],
    ['hash-a', 'hash-b'],
    '2026-04-30T00:00:00.000Z'
  );
  const publisherCount = await writer.embeddings.markPublishersEmbedded(
    [1, 2],
    ['pub-a', 'pub-b'],
    '2026-04-30T00:00:00.000Z'
  );

  assert.equal(gameCount, 2);
  assert.equal(publisherCount, 2);
  assert.match(pool.calls[0]?.sql ?? '', /unnest\(\$1::integer\[\], \$2::text\[\]\)/);
  assert.match(pool.calls[1]?.sql ?? '', /UPDATE legacy\.publishers AS company/);
  assert.deepEqual(pool.calls[0]?.values, [
    [10, 20],
    ['hash-a', 'hash-b'],
    '2026-04-30T00:00:00.000Z',
  ]);
});

test('alertsPinsChat.listPinnedEntitiesWithMetrics maps alert detection rows', async () => {
  const pool = new CapturingPool([
    result([
      {
        alert_ccu_drop: true,
        alert_ccu_spike: true,
        alert_milestone: false,
        alert_new_release: true,
        alert_price_change: true,
        alert_review_surge: true,
        alert_sentiment_shift: true,
        alert_trend_reversal: true,
        alerts_enabled: true,
        ccu_7d_avg: '100',
        ccu_current: '250',
        discount_percent: '20',
        display_name: 'Game',
        entity_id: 10,
        entity_type: 'game',
        pin_id: '00000000-0000-0000-0000-000000000002',
        positive_ratio: '0.91',
        price_cents: '1999',
        review_velocity: '4.5',
        sensitivity_ccu: '1.25',
        sensitivity_review: '1',
        sensitivity_sentiment: '0.75',
        total_reviews: '5000',
        trend_30d_direction: 'up',
        user_id: '00000000-0000-0000-0000-000000000001',
      },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const rows = await writer.alertsPinsChat.listPinnedEntitiesWithMetrics();

  assert.equal(rows[0]?.entity_type, 'game');
  assert.equal(rows[0]?.ccu_current, 250);
  assert.equal(rows[0]?.positive_ratio, 0.91);
  assert.equal(rows[0]?.alert_milestone, false);
  assert.match(pool.calls[0]?.sql ?? '', /FROM legacy\.user_pins/);
  assert.match(pool.calls[0]?.sql ?? '', /LEFT JOIN ops\.alert_detection_state/);
});

test('alertsPinsChat inserts alerts with dedup do-nothing semantics', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const inserted = await writer.alertsPinsChat.insertAlerts([
    {
      alert_type: 'ccu_spike',
      change_percent: 150,
      current_value: 250,
      dedup_key: 'user:game:10:ccu_spike:2026-04-30',
      description: 'CCU jumped',
      metric_name: 'ccu',
      pin_id: '00000000-0000-0000-0000-000000000002',
      previous_value: 100,
      severity: 'high',
      title: 'CCU Spike',
      user_id: '00000000-0000-0000-0000-000000000001',
    },
  ]);

  assert.equal(inserted, 1);
  assert.match(pool.calls[0]?.sql ?? '', /ON CONFLICT \(dedup_key\) DO NOTHING/);
  assert.doesNotMatch(pool.calls[0]?.sql ?? '', /DO UPDATE/);
});

test('alertsPinsChat upserts alert detection state by entity', async () => {
  const pool = new CapturingPool([result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const upserted = await writer.alertsPinsChat.upsertAlertDetectionStates([
    {
      ccu_7d_avg: 100,
      ccu_prev_value: 250,
      entity_id: 10,
      entity_type: 'game',
      positive_ratio_prev: 0.91,
      review_velocity_7d_avg: 4.5,
      total_reviews_prev: 5000,
      trend_30d_direction_prev: 'up',
      updated_at: '2026-04-30T00:00:00.000Z',
    },
  ]);

  assert.equal(upserted, 1);
  assert.match(pool.calls[0]?.sql ?? '', /ops\.alert_detection_state/);
  assert.match(pool.calls[0]?.sql ?? '', /ON CONFLICT \(entity_type, entity_id\)/);
});

test('alertsPinsChat.listUserPinsWithMetrics mirrors the personalization RPC shape', async () => {
  const pool = new CapturingPool([
    result([
      {
        ccu_change_pct: '12.5',
        ccu_current: '250',
        discount_percent: '20',
        display_name: 'Game',
        entity_id: 10,
        entity_type: 'game',
        pin_id: '00000000-0000-0000-0000-000000000002',
        pin_order: '2',
        pinned_at: new Date('2026-04-30T00:00:00.000Z'),
        positive_pct: '91.25',
        price_cents: '1999',
        review_velocity: '4.5',
        total_reviews: '5000',
        trend_direction: 'up',
      },
    ]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const rows = await writer.alertsPinsChat.listUserPinsWithMetrics(
    '00000000-0000-0000-0000-000000000001'
  );

  assert.deepEqual(rows, [
    {
      ccu_change_pct: 12.5,
      ccu_current: 250,
      discount_percent: 20,
      display_name: 'Game',
      entity_id: 10,
      entity_type: 'game',
      pin_id: '00000000-0000-0000-0000-000000000002',
      pin_order: 2,
      pinned_at: '2026-04-30T00:00:00.000Z',
      positive_pct: 91.25,
      price_cents: 1999,
      review_velocity: 4.5,
      total_reviews: 5000,
      trend_direction: 'up',
    },
  ]);
  assert.match(pool.calls[0]?.sql ?? '', /WHERE p\.user_id = \$1::uuid/);
  assert.match(pool.calls[0]?.sql ?? '', /ORDER BY p\.pin_order ASC/);
});

test('alertsPinsChat creates, checks, and deletes user-scoped pins', async () => {
  const pool = new CapturingPool([
    result([
      {
        display_name: 'Game',
        entity_id: 10,
        entity_type: 'game',
        id: '00000000-0000-0000-0000-000000000002',
        pin_order: 0,
        pinned_at: '2026-04-30T00:00:00.000Z',
        user_id: '00000000-0000-0000-0000-000000000001',
      },
    ]),
    result([{ id: '00000000-0000-0000-0000-000000000002' }]),
    result([], 1),
  ]);
  const writer = createTigerWriterForPool(pool);

  const created = await writer.alertsPinsChat.createUserPin({
    display_name: 'Game',
    entity_id: 10,
    entity_type: 'game',
    user_id: '00000000-0000-0000-0000-000000000001',
  });
  const checked = await writer.alertsPinsChat.checkUserPin(
    '00000000-0000-0000-0000-000000000001',
    'game',
    10
  );
  const deleted = await writer.alertsPinsChat.deleteUserPin(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002'
  );

  assert.equal(created.id, '00000000-0000-0000-0000-000000000002');
  assert.deepEqual(checked, { id: '00000000-0000-0000-0000-000000000002' });
  assert.equal(deleted, 1);
  assert.match(pool.calls[0]?.sql ?? '', /INSERT INTO legacy\.user_pins/);
  assert.match(pool.calls[1]?.sql ?? '', /user_id = \$1::uuid/);
  assert.deepEqual(pool.calls[1]?.values, [
    '00000000-0000-0000-0000-000000000001',
    'game',
    10,
  ]);
});

test('alertsPinsChat lists alerts with nested pin metadata and unread count', async () => {
  const pool = new CapturingPool([
    result([
      {
        alert_type: 'ccu_spike',
        change_percent: '150',
        created_at: '2026-04-30T00:00:00.000Z',
        current_value: '250',
        dedup_key: 'user:game:10:ccu_spike:2026-04-30',
        description: 'CCU jumped',
        id: '00000000-0000-0000-0000-000000000003',
        is_read: false,
        metric_name: 'ccu',
        pin_display_name: 'Game',
        pin_entity_id: 10,
        pin_entity_type: 'game',
        pin_id: '00000000-0000-0000-0000-000000000002',
        previous_value: '100',
        read_at: null,
        severity: 'high',
        source_data: { source: 'test' },
        title: 'CCU Spike',
        user_id: '00000000-0000-0000-0000-000000000001',
      },
    ]),
    result([{ count: '7' }]),
  ]);
  const writer = createTigerWriterForPool(pool);

  const alerts = await writer.alertsPinsChat.listUserAlerts({
    limit: 250,
    unreadOnly: true,
    userId: '00000000-0000-0000-0000-000000000001',
  });
  const count = await writer.alertsPinsChat.countUnreadAlerts(
    '00000000-0000-0000-0000-000000000001'
  );

  assert.equal(alerts[0]?.change_percent, 150);
  assert.deepEqual(alerts[0]?.user_pins, {
    display_name: 'Game',
    entity_id: 10,
    entity_type: 'game',
  });
  assert.equal(count, 7);
  assert.match(pool.calls[0]?.sql ?? '', /LEFT JOIN legacy\.user_pins/);
  assert.deepEqual(pool.calls[0]?.values, [
    '00000000-0000-0000-0000-000000000001',
    true,
    100,
  ]);
});

test('alertsPinsChat marks and deletes user-scoped alerts', async () => {
  const pool = new CapturingPool([result([], 1), result([], 1)]);
  const writer = createTigerWriterForPool(pool);

  const marked = await writer.alertsPinsChat.markAlertRead(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003',
    '2026-04-30T00:00:00.000Z'
  );
  const deleted = await writer.alertsPinsChat.deleteUserAlert(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003'
  );

  assert.equal(marked, 1);
  assert.equal(deleted, 1);
  assert.match(pool.calls[0]?.sql ?? '', /SET is_read = true/);
  assert.match(pool.calls[1]?.sql ?? '', /DELETE FROM legacy\.user_alerts/);
});

test('alertsPinsChat get-or-creates and updates alert preferences', async () => {
  const preferencesRow = {
    alert_ccu_drop: true,
    alert_ccu_spike: true,
    alert_milestone: true,
    alert_new_release: true,
    alert_price_change: true,
    alert_review_surge: true,
    alert_sentiment_shift: true,
    alert_trend_reversal: true,
    alerts_enabled: true,
    ccu_sensitivity: '1.25',
    created_at: '2026-04-30T00:00:00.000Z',
    review_sensitivity: '1',
    sentiment_sensitivity: '0.75',
    updated_at: '2026-04-30T00:00:00.000Z',
    user_id: '00000000-0000-0000-0000-000000000001',
  };
  const pool = new CapturingPool([result([preferencesRow]), result([preferencesRow])]);
  const writer = createTigerWriterForPool(pool);

  const created = await writer.alertsPinsChat.getOrCreateAlertPreferences({
    alert_ccu_drop: true,
    alert_ccu_spike: true,
    alert_milestone: true,
    alert_new_release: true,
    alert_price_change: true,
    alert_review_surge: true,
    alert_sentiment_shift: true,
    alert_trend_reversal: true,
    alerts_enabled: true,
    ccu_sensitivity: 1,
    review_sensitivity: 1,
    sentiment_sensitivity: 1,
    user_id: '00000000-0000-0000-0000-000000000001',
  });
  const updated = await writer.alertsPinsChat.upsertAlertPreferences({
    alerts_enabled: false,
    updated_at: '2026-04-30T00:00:00.000Z',
    user_id: '00000000-0000-0000-0000-000000000001',
  });

  assert.equal(created.ccu_sensitivity, 1.25);
  assert.equal(updated.sentiment_sensitivity, 0.75);
  assert.match(pool.calls[0]?.sql ?? '', /ON CONFLICT \(user_id\) DO NOTHING/);
  assert.match(pool.calls[1]?.sql ?? '', /ON CONFLICT \(user_id\) DO UPDATE SET/);
});

test('alertsPinsChat upserts and deletes per-pin alert settings', async () => {
  const pool = new CapturingPool([
    result([
      {
        alert_ccu_drop: null,
        alert_ccu_spike: true,
        alert_milestone: null,
        alert_new_release: null,
        alert_price_change: null,
        alert_review_surge: false,
        alert_sentiment_shift: null,
        alert_trend_reversal: null,
        alerts_enabled: true,
        ccu_sensitivity: '1.5',
        created_at: '2026-04-30T00:00:00.000Z',
        pin_id: '00000000-0000-0000-0000-000000000002',
        review_sensitivity: null,
        sentiment_sensitivity: null,
        updated_at: '2026-04-30T00:00:00.000Z',
        use_custom_settings: true,
      },
    ]),
    result([], 1),
  ]);
  const writer = createTigerWriterForPool(pool);

  const settings = await writer.alertsPinsChat.upsertPinAlertSettings({
    alert_ccu_spike: true,
    alert_review_surge: false,
    ccu_sensitivity: 1.5,
    pin_id: '00000000-0000-0000-0000-000000000002',
    updated_at: '2026-04-30T00:00:00.000Z',
    use_custom_settings: true,
  });
  const deleted = await writer.alertsPinsChat.deletePinAlertSettings(
    '00000000-0000-0000-0000-000000000002'
  );

  assert.equal(settings.ccu_sensitivity, 1.5);
  assert.equal(settings.alert_review_surge, false);
  assert.equal(settings.alert_ccu_drop, null);
  assert.equal(deleted, 1);
  assert.match(pool.calls[0]?.sql ?? '', /legacy\.user_pin_alert_settings/);
  assert.match(pool.calls[0]?.sql ?? '', /ON CONFLICT \(pin_id\) DO UPDATE SET/);
});
