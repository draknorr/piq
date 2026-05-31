import assert from 'node:assert/strict';
import test from 'node:test';

import { ContractRuntimeUnavailableError } from '@publisheriq/data-plane';

import { createQueryApiServer } from './server.js';

function createDataPlaneStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    compareEntities: async () => ({ ok: true }),
    discoverChangePatterns: async () => ({ ok: true }),
    discoverMomentum: async () => ({ ok: true }),
    continueResultSet: async () => ({ ok: true }),
    describeContracts: async () => ({ contracts: [], source: 'tiger' }),
    explainChanges: async () => ({ ok: true }),
    getChangeActivityDetail: async () => ({ ok: true }),
    getChangeFeedStatus: async () => ({ ok: true }),
    getEntityOverview: async () => ({ ok: true }),
    getRelatedEntities: async () => ({ ok: true }),
    getUserContext: async () => ({ ok: true }),
    getYoutubeGameCoverage: async () => ({ ok: true }),
    getYoutubeMarketPulse: async () => ({ ok: true }),
    healthCheck: async () => ({
      capturedAt: '2026-04-01T00:00:00.000Z',
      source: 'tiger',
      tables: [],
    }),
    queryMonthlyPlaytime: async () => ({ ok: true }),
    rankEntities: async () => ({ ok: true }),
    readinessCheck: async () => ({
      blockedContracts: [],
      provenance: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        source: 'tiger',
        tables: [],
      },
      ready: true,
    }),
    resolveEntities: async () => ({ ok: true }),
    searchCatalog: async () => ({ ok: true }),
    searchChangeActivity: async () => ({ ok: true }),
    searchDocuments: async () => ({ ok: true }),
    semanticSearch: async () => ({ ok: true }),
    traceMetricHistory: async () => ({ ok: true }),
    ...overrides,
  };
}

async function withServer(
  dataPlane: Record<string, unknown>,
  bearerToken: string | null,
  callback: (origin: string) => Promise<void>,
  params?: {
    relatedEntitiesFallback?: Record<string, unknown> | null;
    sourceFallback?: Record<string, unknown> | null;
  }
): Promise<void> {
  const server = createQueryApiServer({
    bearerToken,
    dataPlane: dataPlane as any,
    ...(params?.relatedEntitiesFallback
      ? { relatedEntitiesFallback: params.relatedEntitiesFallback as any }
      : {}),
    ...(params?.sourceFallback
      ? { sourceFallback: params.sourceFallback as any }
      : {}),
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP address');
  }

  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error?: Error) => (error ? reject(error) : resolve()))
    );
  }
}

test('query-api keeps /healthz public but protects contract routes with bearer auth', async () => {
  await withServer(createDataPlaneStub(), 'secret-token', async (origin) => {
    const healthResponse = await fetch(`${origin}/healthz`);
    assert.equal(healthResponse.status, 200);

    const protectedResponse = await fetch(`${origin}/v1/contracts`);
    assert.equal(protectedResponse.status, 401);
    assert.deepEqual(await protectedResponse.json(), { error: 'Unauthorized' });
  });
});

test('query-api falls back to the source service for /healthz when the Tiger primary throws', async () => {
  await withServer(
    createDataPlaneStub({
      healthCheck: async () => {
        throw new Error('Tiger primary is unavailable');
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/healthz`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        provenance: {
          capturedAt: '2026-04-01T00:00:00.000Z',
          source: 'supabase-postgres',
          tables: [],
        },
      });
    },
    {
      sourceFallback: createDataPlaneStub({
        healthCheck: async () => ({
          capturedAt: '2026-04-01T00:00:00.000Z',
          source: 'supabase-postgres',
          tables: [],
        }),
      }),
    }
  );
});

test('query-api routes semantic-search requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      semanticSearch: async (body: unknown) => {
        receivedBody = body;
        return {
          provenance: {
            capturedAt: '2026-04-01T00:00:00.000Z',
            source: 'tiger',
            tables: [
              'legacy.apps',
              'legacy.latest_daily_metrics',
              'legacy.app_publishers',
              'legacy.app_developers',
              'legacy.app_genres',
              'legacy.steam_genres',
              'legacy.app_steam_tags',
              'legacy.steam_tags',
            ],
          },
          results: [{ id: 367520, name: 'Hollow Knight', score: 0.94 }],
          sufficient_to_answer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/semantic-search`, {
        body: JSON.stringify({
          entityKind: 'game',
          mode: 'similarity',
          referenceQuery: 'Hades',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        entityKind: 'game',
        mode: 'similarity',
        referenceQuery: 'Hades',
      });
      assert.deepEqual(await response.json(), {
        provenance: {
          capturedAt: '2026-04-01T00:00:00.000Z',
          source: 'tiger',
          tables: [
            'legacy.apps',
            'legacy.latest_daily_metrics',
            'legacy.app_publishers',
            'legacy.app_developers',
            'legacy.app_genres',
            'legacy.steam_genres',
            'legacy.app_steam_tags',
            'legacy.steam_tags',
          ],
        },
        results: [{ id: 367520, name: 'Hollow Knight', score: 0.94 }],
        sufficient_to_answer: true,
      });
    }
  );
});

test('query-api exposes optional research archive search behind existing auth', async () => {
  const previousArchiveScan = process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM;
  delete process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM;
  try {
    await withServer(createDataPlaneStub(), 'secret-token', async (origin) => {
      const unauthorized = await fetch(`${origin}/v1/research/report-archive/search`, {
        body: JSON.stringify({ query: 'tag genre market shifts' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      assert.equal(unauthorized.status, 401);

      const response = await fetch(`${origin}/v1/research/report-archive/search`, {
        body: JSON.stringify({ query: 'tag genre market shifts', limit: 2 }),
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      const payload = await response.json() as {
        items: Array<{ artifactCount: number }>;
        totalMatches: number;
      };
      assert.equal(payload.totalMatches, 0);
      assert.deepEqual(payload.items, []);
    });
  } finally {
    if (previousArchiveScan === undefined) {
      delete process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM;
    } else {
      process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM = previousArchiveScan;
    }
  }
});

test('query-api keeps readonly research SQL disabled unless explicitly enabled', async () => {
  await withServer(createDataPlaneStub(), null, async (origin) => {
    const response = await fetch(`${origin}/v1/research/readonly-analysis`, {
      body: JSON.stringify({
        expectedRows: 10,
        purpose: 'test',
        sql: 'SELECT appid FROM legacy.apps LIMIT 10',
      }),
      headers: {
        'content-type': 'application/json',
        'x-publisheriq-research-role': 'researcher',
      },
      method: 'POST',
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      code: 'RESEARCH_SQL_SANDBOX_DISABLED',
      error: 'Read-only research SQL sandbox is disabled for this environment.',
    });
  });
});

test('query-api falls back to the source service for resolve-entities when the Tiger primary throws', async () => {
  await withServer(
    createDataPlaneStub({
      resolveEntities: async () => {
        throw new Error('Tiger primary is unavailable');
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/resolve-entities`, {
        body: JSON.stringify({
          entityKinds: ['game'],
          includeMetrics: false,
          query: 'Counter-Strike 2',
          resolutionMode: 'chat_strict',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'Counter-Strike 2',
          entityKind: 'game',
          entityUid: 'steam:game:730',
          matchQuality: 'exact',
          matchedName: 'Counter-Strike 2',
          platform: 'steam',
          platformEntityId: '730',
        }],
        provenance: {
          capturedAt: '2026-04-01T00:00:00.000Z',
          source: 'supabase-postgres',
          tables: ['public.apps'],
        },
        totalCandidates: 1,
      });
    },
    {
      sourceFallback: createDataPlaneStub({
        resolveEntities: async () => ({
          ambiguity: {
            message: null,
            requiresClarification: false,
          },
          entities: [{
            confidence: 0.99,
            displayName: 'Counter-Strike 2',
            entityKind: 'game',
            entityUid: 'steam:game:730',
            matchQuality: 'exact',
            matchedName: 'Counter-Strike 2',
            platform: 'steam',
            platformEntityId: '730',
          }],
          provenance: {
            capturedAt: '2026-04-01T00:00:00.000Z',
            source: 'supabase-postgres',
            tables: ['public.apps'],
          },
          totalCandidates: 1,
        }),
      }),
    }
  );
});

test('query-api surfaces Tiger resolve-entities statement timeouts as 504 when no source fallback is available', async () => {
  await withServer(
    createDataPlaneStub({
      resolveEntities: async () => {
        const error = new Error('canceling statement due to statement timeout') as Error & {
          code?: string;
        };
        error.code = '57014';
        throw error;
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/resolve-entities`, {
        body: JSON.stringify({
          entityKinds: ['game'],
          includeMetrics: false,
          query: 'Crimson Desert',
          resolutionMode: 'chat_strict',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 504);
      assert.deepEqual(await response.json(), {
        code: 'QUERY_TIMEOUT',
        error: 'Tiger primary resolveEntities timed out before source fallback was available.',
      });
    }
  );
});

test('query-api preserves Tiger resolve-entities timeouts as 504 when source fallback also fails', async () => {
  await withServer(
    createDataPlaneStub({
      resolveEntities: async () => {
        const error = new Error('canceling statement due to statement timeout') as Error & {
          code?: string;
        };
        error.code = '57014';
        throw error;
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/resolve-entities`, {
        body: JSON.stringify({
          entityKinds: ['game'],
          includeMetrics: false,
          query: 'Crimson Desert',
          resolutionMode: 'chat_strict',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 504);
      assert.deepEqual(await response.json(), {
        code: 'QUERY_TIMEOUT',
        error: 'Tiger primary resolveEntities timed out and source fallback did not recover the request.',
      });
    },
    {
      sourceFallback: createDataPlaneStub({
        resolveEntities: async () => {
          throw new Error('Source fallback is unavailable');
        },
      }),
    }
  );
});

test('query-api routes get-user-context requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getUserContext: async (body: unknown) => {
        receivedBody = body;
        return {
          alertPreferences: {
            alertCcuDrop: true,
            alertCcuSpike: true,
            alertMilestone: true,
            alertNewRelease: true,
            alertPriceChange: true,
            alertReviewSurge: true,
            alertSentimentShift: true,
            alertTrendReversal: true,
            alertsEnabled: true,
            ccuSensitivity: 1,
            emailDigestEnabled: false,
            emailDigestFrequency: 'daily',
            reviewSensitivity: 1,
            sentimentSensitivity: 1,
            source: 'stored',
          },
          alerts: [],
          pins: [{
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'steam:game:1145350',
            metrics: {
              ccuPeak: 42000,
              gameCount: null,
              ownersMidpoint: 1200000,
              reviewScore: 95,
              totalReviews: 54000,
            },
            pinId: '11111111-1111-4111-8111-111111111111',
            pinOrder: 0,
            pinnedAt: '2026-04-03T00:00:00.000Z',
            platform: 'steam',
            platformEntityId: '1145350',
            summary: {
              appType: 'game',
              isFree: false,
              platforms: ['windows'],
              releaseYear: 2024,
            },
            alertSettings: null,
          }],
          provenance: {
            capturedAt: '2026-04-03T00:00:00.000Z',
            source: 'tiger',
            tables: ['legacy.user_pins', 'legacy.user_alerts'],
          },
          sufficientToAnswer: true,
          totalAlerts: 0,
          totalPins: 1,
          unreadAlertCount: 0,
          userId: '11111111-1111-4111-8111-111111111111',
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-user-context`, {
        body: JSON.stringify({
          includeAlerts: true,
          includePins: true,
          limitAlerts: 5,
          userId: '11111111-1111-4111-8111-111111111111',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        includeAlerts: true,
        includePins: true,
        limitAlerts: 5,
        userId: '11111111-1111-4111-8111-111111111111',
      });
      const payload = await response.json() as { totalPins: number; unreadAlertCount: number };
      assert.equal(payload.totalPins, 1);
      assert.equal(payload.unreadAlertCount, 0);
    }
  );
});

test('query-api routes get-youtube-game-coverage requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getYoutubeGameCoverage: async (body: unknown) => {
        receivedBody = body;
        return {
          availability: {
            blockingTables: [],
            reason: null,
            state: 'ready',
          },
          cadence: null,
          contentClass: null,
          contentMix: [],
          creators: [],
          entity: {
            displayName: 'ARC Raiders',
            entityKind: 'game',
            entityUid: '11111111-1111-4111-8111-111111111111',
            platform: 'steam',
            platformEntityId: '1149460',
          },
          items: [{
            channelCountry: 'US',
            channelId: 'channel-1',
            channelSubscriberCount: 120000,
            channelTitle: 'Creator One',
            commentCount: 40,
            confidenceScore: 0.98,
            contentClass: 'standard_video',
            defaultAudioLanguage: 'en',
            defaultLanguage: 'en',
            firstSnapshotAt: null,
            growthPct: null,
            languageCode: 'en',
            lastSnapshotAt: null,
            likeCount: 320,
            matchedAlias: 'ARC Raiders',
            publishedAt: '2026-04-01T00:00:00.000Z',
            thumbnailUrl: 'https://i.ytimg.com/vi/video-1/mqdefault.jpg',
            title: 'ARC Raiders preview',
            url: 'https://www.youtube.com/watch?v=video-1',
            videoId: 'video-1',
            viewCount: 12000,
            viewDelta: null,
          }],
          languageOptions: [{ code: 'en', label: 'English', videoCount: 42 }],
          limit: 10,
          provenance: {
            capturedAt: '2026-04-01T00:00:00.000Z',
            source: 'tiger',
            tables: [
              'core.entities',
              'docs.youtube_videos',
              'docs.youtube_channels',
              'docs.youtube_video_matches',
              'metrics.youtube_video_snapshots',
              'metrics.youtube_game_daily',
            ],
          },
          resolvedWindow: 'current',
          sufficientToAnswer: true,
          summary: {
            distinctUploadChannels30d: 18,
            distinctUploadChannels7d: 12,
            freshestMatchedUploadAt: '2026-04-01T00:00:00.000Z',
            latestSnapshotAt: '2026-04-01T01:00:00.000Z',
            matchedPrimaryVideoCount: 42,
            matchedVideoViewDelta1d: 9000,
            matchedVideoViewDelta7d: 15000,
            newMatchedVideos1d: 4,
            newMatchedVideos30d: 42,
            newMatchedVideos7d: 18,
          },
          view: 'latest_videos',
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-youtube-game-coverage`, {
        body: JSON.stringify({
          entityUid: '11111111-1111-4111-8111-111111111111',
          limit: 10,
          view: 'latest_videos',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        entityUid: '11111111-1111-4111-8111-111111111111',
        limit: 10,
        view: 'latest_videos',
      });
      const payload = await response.json() as { items: Array<{ title: string }> };
      assert.equal(payload.items[0]?.title, 'ARC Raiders preview');
    }
  );
});

test('query-api routes get-youtube-market-pulse requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getYoutubeMarketPulse: async (body: unknown) => {
        receivedBody = body;
        return {
          availability: { blockingTables: [], reason: null, state: 'ready' },
          contentClass: 'short',
          items: [{
            appid: 1149460,
            ccuPeak: 10000,
            contentMix: [],
            coverageQuality: 'strong',
            currentViews: 120000,
            dominantContentClass: 'short',
            entityUid: 'steam:game:1149460',
            latestSnapshotAt: '2026-05-05T03:49:57.000Z',
            latestVideos: [],
            matchedPrimaryVideoCount: 42,
            name: 'ARC Raiders',
            newMatchedVideos: 8,
            reviewScore: 85,
            steamRank: 1,
            totalReviews: 12000,
            uploadChannels: 7,
            viewDelta: 50000,
          }],
          limit: 50,
          offset: 0,
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            limit: 50,
            offset: 0,
            totalRows: 1,
          },
          provenance: {
            capturedAt: '2026-05-05T00:00:00.000Z',
            source: 'tiger',
            tables: ['metrics.youtube_game_daily'],
          },
          sort: 'youtube_velocity',
          sufficientToAnswer: true,
          summary: {
            currentViews: 120000,
            gamesAnalyzed: 1,
            gamesWithCoverage: 1,
            latestSnapshotAt: '2026-05-05T03:49:57.000Z',
            newMatchedVideos: 8,
            uploadChannels: 7,
            viewDelta: 50000,
          },
          window: '7d',
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-youtube-market-pulse`, {
        body: JSON.stringify({
          contentClass: 'short',
          sort: 'youtube_velocity',
          window: '7d',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        contentClass: 'short',
        sort: 'youtube_velocity',
        window: '7d',
      });
      const payload = await response.json() as { items: Array<{ name: string }> };
      assert.equal(payload.items[0]?.name, 'ARC Raiders');
    }
  );
});

test('query-api routes discover-momentum requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      discoverMomentum: async (body: unknown) => {
        receivedBody = body;
        return {
          filtersApplied: ['sort_by: ccu_peak', 'timeframe: current'],
          items: [
            {
              appid: 730,
              ccuPeak: 1500000,
              entityUid: 'steam:game:730',
              isFree: true,
              matchedSteamDeck: null,
              momentumScore: 100,
              name: 'Counter-Strike 2',
              platformSupport: ['windows'],
              supportLevel: 'high',
              supportReasons: ['Peak CCU remains dominant.'],
            },
          ],
          provenance: {
            capturedAt: '2026-04-02T00:00:00.000Z',
            source: 'tiger',
            tables: ['legacy.apps', 'legacy.latest_daily_metrics'],
          },
          rankingDefinition: 'Peak CCU uses the latest 24-hour concurrent-player snapshot.',
          rankingLabel: 'Peak CCU',
          sufficientToAnswer: true,
          timeframe: 'current',
          timeframeLabel: 'Current snapshot',
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/discover-momentum`, {
        body: JSON.stringify({
          filters: { isFree: true },
          sortBy: 'ccu_peak',
          timeframe: 'current',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        filters: { isFree: true },
        sortBy: 'ccu_peak',
        timeframe: 'current',
      });
      const payload = await response.json() as { rankingLabel: string };
      assert.equal(payload.rankingLabel, 'Peak CCU');
    }
  );
});

test('query-api routes monthly playtime requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      queryMonthlyPlaytime: async (body: unknown) => {
        receivedBody = body;
        return {
          endMonth: '2025-12-01',
          entityKind: 'game',
          items: [
            {
              entityId: 730,
              entityKind: 'game',
              estimatedMonthlyHours: 123456,
              month: '2025-12-01',
              monthNum: 12,
              name: 'Counter-Strike 2',
              rank: 1,
              year: 2025,
            },
          ],
          provenance: {
            capturedAt: '2026-04-02T00:00:00.000Z',
            source: 'tiger',
            tables: ['metrics.monthly_game_metrics'],
          },
          startMonth: '2025-12-01',
          sufficientToAnswer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/query-monthly-playtime`, {
        body: JSON.stringify({
          endMonth: '2025-12-01',
          entityKind: 'game',
          limit: 10,
          startMonth: '2025-12-01',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        endMonth: '2025-12-01',
        entityKind: 'game',
        limit: 10,
        startMonth: '2025-12-01',
      });
      const payload = await response.json() as { items: Array<{ name: string }> };
      assert.equal(payload.items[0]?.name, 'Counter-Strike 2');
    }
  );
});

test('query-api routes search-change-activity requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      searchChangeActivity: async (body: unknown) => {
        receivedBody = body;
        return {
          continuationToken: null,
          interpretedFilters: {
            allHistory: false,
            appids: [],
            appTypes: ['game'],
            days: 14,
            mode: 'all',
            query: 'refresh',
            signalFamilies: ['media'],
            sort: 'relevant',
            view: 'store-refreshes',
          },
          items: [
            {
              activityId: 'change:730:1:2',
              activityKind: 'change',
              appType: 'game',
              appid: 730,
              externalUrl: null,
              facts: ['2 tracked change events in this activity window.'],
              hasBeforeAfter: true,
              headline: 'Counter-Strike 2 refreshed its Steam page presentation.',
              highlightLabels: ['store refresh', 'media'],
              isReleased: true,
              name: 'Counter-Strike 2',
              occurredAt: '2026-04-02T00:00:00.000Z',
              relatedAnnouncementCount: 0,
              releaseDate: '2023-09-27',
              signalFamilies: ['media'],
              storyKind: 'store-refresh',
              summary: 'Counter-Strike 2 showed media changes without a linked announcement.',
            },
          ],
          provenance: {
            capturedAt: '2026-04-02T00:00:00.000Z',
            source: 'tiger',
            tables: ['events.app_change_events'],
          },
          sufficientToAnswer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/search-change-activity`, {
        body: JSON.stringify({
          allHistory: true,
          appids: [730],
          appTypes: ['game'],
          days: 14,
          query: 'refresh',
          signalFamilies: ['media'],
          view: 'store-refreshes',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        allHistory: true,
        appids: [730],
        appTypes: ['game'],
        days: 14,
        query: 'refresh',
        signalFamilies: ['media'],
        view: 'store-refreshes',
      });
      const payload = await response.json() as { items: Array<{ activityId: string }> };
      assert.equal(payload.items[0]?.activityId, 'change:730:1:2');
    }
  );
});

test('query-api routes get-change-activity-detail requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getChangeActivityDetail: async (body: unknown) => {
        receivedBody = body;
        return {
          item: null,
          provenance: {
            capturedAt: '2026-04-02T00:00:00.000Z',
            source: 'tiger',
            tables: ['events.app_change_events'],
          },
          sufficientToAnswer: false,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-change-activity-detail`, {
        body: JSON.stringify({
          activityId: 'change:730:1:2',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        activityId: 'change:730:1:2',
      });
      const payload = await response.json() as { sufficientToAnswer: boolean };
      assert.equal(payload.sufficientToAnswer, false);
    }
  );
});

test('query-api routes get-change-feed-status requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getChangeFeedStatus: async (body: unknown) => {
        receivedBody = body;
        return {
          latestNewsEventAt: '2026-04-02T00:00:00.000Z',
          latestProjectionRefreshAt: '2026-04-02T00:01:00.000Z',
          latestStorefrontEventAt: '2026-04-02T00:00:00.000Z',
          oldestProjectionQueuedAt: null,
          oldestQueuedAt: null,
          projectionQueuedJobs: 0,
          provenance: {
            capturedAt: '2026-04-02T00:00:00.000Z',
            source: 'tiger',
            tables: ['events.app_change_events'],
          },
          queuedJobs: 0,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-change-feed-status`, {
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {});
      const payload = await response.json() as { queuedJobs: number };
      assert.equal(payload.queuedJobs, 0);
    }
  );
});

test('query-api routes discover-change-patterns requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      discoverChangePatterns: async (body: unknown) => {
        receivedBody = body;
        return {
          continuationToken: null,
          interpretedFilters: {
            appTypes: ['game'],
            days: 30,
            pattern: 'marketing_push',
            query: null,
          },
          items: [
            {
              activityIds: ['change:730:1:2'],
              appType: 'game',
              appid: 730,
              confidence: 'high',
              metrics: {
                ccuPeak: 1500000,
                ccuTrend7dPct: 8,
                discountPercent: 0,
                positivePercentage: 88,
                priceCents: 0,
                reviewVelocity30d: 1400,
                reviewVelocity7d: 1285,
                totalReviews: 9000000,
                trend30dDirection: 'up',
              },
              name: 'Counter-Strike 2',
              occurredAt: '2026-04-02T00:00:00.000Z',
              primaryProof: {
                activityId: 'change:730:1:2',
                facts: ['Announcement activity landed in the same recent window.'],
                headline: 'Counter-Strike 2 matched the marketing push pattern.',
                occurredAt: '2026-04-02T00:00:00.000Z',
                signalFamilies: ['announcement', 'media', 'pricing'],
                summary: 'Counter-Strike 2 showed recent change activity that fits the marketing push pattern.',
              },
              reasons: ['Announcement activity landed in the same recent window.'],
              signalFamilies: ['announcement', 'media', 'pricing'],
              storyKinds: ['commercial-move'],
            },
          ],
          provenance: {
            capturedAt: '2026-04-02T00:00:00.000Z',
            source: 'tiger',
            tables: ['events.app_change_events', 'legacy.latest_daily_metrics'],
          },
          sufficientToAnswer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/discover-change-patterns`, {
        body: JSON.stringify({
          appTypes: ['game'],
          days: 30,
          pattern: 'marketing_push',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        appTypes: ['game'],
        days: 30,
        pattern: 'marketing_push',
      });
      const payload = await response.json() as { items: Array<{ confidence: string }> };
      assert.equal(payload.items[0]?.confidence, 'high');
    }
  );
});

test('query-api routes get-entity-overview requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getEntityOverview: async (body: unknown) => {
        receivedBody = body;
        return {
          entity: {
            details: {
              appType: null,
              developerIds: [],
              developers: [],
              discountPercent: null,
              isFree: null,
              isReleased: null,
              parentAppid: null,
              platforms: [],
              priceCents: null,
              publisherIds: [],
              publishers: [],
              releaseDate: null,
              releaseState: null,
              releaseYear: null,
            },
            displayName: 'FromSoftware',
            entityKind: 'developer',
            entityUid: 'entity-1',
            metrics: {
              ccuPeak: 12345,
              gameCount: 7,
              ownersMidpoint: 4000000,
              reviewScore: 94,
              totalReviews: 600000,
            },
            platform: 'publisheriq',
            platformEntityId: '3005',
          },
          games: [],
          provenance: {
            capturedAt: '2026-04-01T00:00:00.000Z',
            source: 'tiger',
            tables: ['legacy.developers'],
          },
          sufficientToAnswer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-entity-overview`, {
        body: JSON.stringify({
          entityKind: 'developer',
          gamesLimit: 5,
          gamesSortBy: 'reviews',
          platformEntityId: '3005',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        entityKind: 'developer',
        gamesLimit: 5,
        gamesSortBy: 'reviews',
        platformEntityId: '3005',
      });
      const payload = await response.json() as {
        entity: {
          displayName: string;
        };
      };
      assert.equal(payload.entity.displayName, 'FromSoftware');
    }
  );
});

test('query-api routes get-related-entities requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getRelatedEntities: async (body: unknown) => {
        receivedBody = body;
        return {
          items: [
            {
              appid: 1145360,
              entityUid: 'steam:game:1145360',
              name: 'Hades',
              releaseDate: '2020-09-17',
              releaseYear: 2020,
              reviewScore: 98,
              steamDeckCategory: 'verified',
              totalReviews: 275000,
            },
          ],
          provenance: {
            capturedAt: '2026-04-04T00:00:00.000Z',
            source: 'tiger',
            tables: ['legacy.app_franchises', 'legacy.apps'],
          },
          relationKind: 'franchise_games',
          source: {
            appid: 1145350,
            displayName: 'Hades II',
            entityUid: 'steam:game:1145350',
          },
          sufficientToAnswer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-related-entities`, {
        body: JSON.stringify({
          filters: { steamDeck: ['verified'] },
          limit: 10,
          relationKind: 'franchise_games',
          sourceAppid: 1145350,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        filters: { steamDeck: ['verified'] },
        limit: 10,
        relationKind: 'franchise_games',
        sourceAppid: 1145350,
      });
      const payload = await response.json() as { items: Array<{ name: string }> };
      assert.equal(payload.items[0]?.name, 'Hades');
    }
  );
});

test('query-api uses the related-entities fallback service when Tiger returns an empty relation set', async () => {
  await withServer(
    createDataPlaneStub({
      getRelatedEntities: async () => ({
        items: [],
        provenance: {
          capturedAt: '2026-04-04T00:00:00.000Z',
          source: 'tiger',
          tables: ['legacy.apps'],
        },
        relationKind: 'dlc',
        source: {
          appid: 1245620,
          displayName: 'ELDEN RING',
          entityUid: 'steam:game:1245620',
          reviewScore: 93,
          steamDeckCategory: 'verified',
          totalReviews: 1000000,
        },
        sufficientToAnswer: false,
      }),
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-related-entities`, {
        body: JSON.stringify({
          limit: 10,
          relationKind: 'dlc',
          sourceAppid: 1245620,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      const payload = await response.json() as {
        items: Array<{ name: string }>;
        provenance: { source: string };
      };
      assert.equal(payload.provenance.source, 'supabase-postgres');
      assert.equal(payload.items[0]?.name, 'ELDEN RING Shadow of the Erdtree');
    },
    {
      relatedEntitiesFallback: createDataPlaneStub({
        getRelatedEntities: async () => ({
          items: [
            {
              appid: 2778580,
              entityUid: 'steam:game:2778580',
              name: 'ELDEN RING Shadow of the Erdtree',
              releaseDate: '2024-06-20',
              releaseYear: 2024,
              reviewScore: 94,
              steamDeckCategory: 'verified',
              totalReviews: 54000,
            },
          ],
          provenance: {
            capturedAt: '2026-04-04T00:00:00.000Z',
            source: 'supabase-postgres',
            tables: ['public.app_dlc', 'public.apps'],
          },
          relationKind: 'dlc',
          source: {
            appid: 1245620,
            displayName: 'ELDEN RING',
            entityUid: 'steam:game:1245620',
            reviewScore: 93,
            steamDeckCategory: 'verified',
            totalReviews: 1000000,
          },
          sufficientToAnswer: true,
        }),
      }),
    }
  );
});

test('query-api maps blocked contracts to HTTP 503', async () => {
  await withServer(
    createDataPlaneStub({
      compareEntities: async () => {
        throw new ContractRuntimeUnavailableError(
          'Contract compareEntities is not ready at runtime.',
          'compareEntities',
          ['legacy.publishers']
        );
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/compare-entities`, {
        body: JSON.stringify({ entityUids: ['publisher:publisheriq:1', 'publisher:publisheriq:2'] }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        blockingTables: ['legacy.publishers'],
        code: 'CONTRACT_RUNTIME_UNAVAILABLE',
        contractName: 'compareEntities',
        error: 'Contract compareEntities is not ready at runtime.',
      });
    }
  );
});
