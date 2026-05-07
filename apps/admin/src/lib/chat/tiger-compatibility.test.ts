import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { getGameChangeTimeline } from './change-intel-service';
import { extractToolExecutionProvenance } from './execution-trace';
import { tryTigerQueryAnalyticsCompat } from './query-analytics-tiger-compat';
import { runTigerPrimaryEvaluation } from './tiger-shadow';
import { lookupGames } from '@/lib/search/game-lookup';
import { searchGames } from '@/lib/search/game-search';
import { screenGames } from '@/lib/search/screen-games';
import { discoverTrending } from '@/lib/search/trend-discovery';
import { lookupTags } from '@/lib/search/tag-lookup';
import { lookupPublishers } from '@/lib/search/publisher-lookup';

function setScopedEnv(
  t: TestContext,
  key: string,
  value: string | undefined
): void {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  t.after(() => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  });
}

function setScopedFetch(
  t: TestContext,
  handler: (input: URL, init?: RequestInit) => Response | Promise<Response>
): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
    return handler(url, init);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });
}

test('lookupGames uses Tiger resolve-entities when query-api returns a match', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url) => {
    assert.equal(url.pathname, '/v1/contracts/resolve-entities');
    return jsonResponse({
      ambiguity: {
        candidateNames: ['Hades'],
        message: null,
        requiresClarification: false,
      },
      entities: [
        {
          confidence: 0.99,
          displayName: 'Hades',
          entityKind: 'game',
          matchQuality: 'exact',
          matchSource: 'canonical_name',
          platformEntityId: '1145360',
          releaseYear: 2020,
          resolutionTier: 'canonical_exact',
        },
      ],
      totalCandidates: 1,
    });
  });

  const result = await lookupGames({ query: 'Hades' });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(result.success, true);
  assert.deepEqual(result.results, [
    {
      appid: 1145360,
      isExactMatch: true,
      name: 'Hades',
      matchQuality: 'exact',
      matchSource: 'canonical_name',
      releaseYear: 2020,
      similarityScore: 0.99,
      resolutionTier: 'canonical_exact',
    },
  ]);
  assert.deepEqual(result.ambiguity, {
    candidateNames: ['Hades'],
    continuationToken: null,
    message: null,
    requiresClarification: false,
    totalCandidates: 1,
  });
  assert.equal(result.needsDisambiguation, false);
  assert.equal(result.resolutionConfidence, 'high');
  assert.equal(result.matchSource, 'canonical_name');
  assert.equal(result.resolutionTier, 'canonical_exact');
  assert.ok(provenance);
  assert.ok(provenance.dataSources.includes('query_api:resolveEntities'));
});

test('lookupGames preserves Tiger ambiguity metadata for strict game resolution', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/resolve-entities');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.resolutionMode, 'chat_strict');

    return jsonResponse({
      ambiguity: {
        candidateNames: ['Counter-Strike 2', 'Counter Strike 2'],
        message: 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.',
        requiresClarification: true,
        totalCandidates: 2,
      },
      entities: [
        {
          confidence: 0.98,
          displayName: 'Counter-Strike 2',
          entityKind: 'game',
          matchQuality: 'exact',
          matchSource: 'canonical_name',
          platformEntityId: '730',
          releaseYear: 2023,
          resolutionTier: 'canonical_exact',
        },
        {
          confidence: 0.96,
          displayName: 'Counter Strike 2',
          entityKind: 'game',
          matchQuality: 'prefix',
          matchSource: 'normalized_name',
          platformEntityId: '730',
          releaseYear: 2023,
          resolutionTier: 'normalized_exact',
        },
      ],
      totalCandidates: 2,
    });
    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await lookupGames({ query: 'Counter Strike 2' });

  assert.equal(result.success, true);
  assert.equal(result.needsDisambiguation, true);
  assert.deepEqual(result.ambiguity, {
    candidateNames: ['Counter-Strike 2', 'Counter Strike 2'],
    continuationToken: null,
    message: 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.',
    requiresClarification: true,
    totalCandidates: 2,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.results[0]?.name, 'Counter-Strike 2');
  assert.equal(result.canonicalResult?.name, 'Counter-Strike 2');
});

test('lookupPublishers uses Tiger resolve-entities when query-api returns a canonical company', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url) => {
    assert.equal(url.pathname, '/v1/contracts/resolve-entities');
    return jsonResponse({
      ambiguity: {
        message: null,
        requiresClarification: false,
      },
      entities: [
        {
          confidence: 0.94,
          displayName: 'Devolver Digital',
          entityKind: 'publisher',
          latestMetrics: {
            reviewScore: 91,
            totalReviews: 220000,
          },
          matchQuality: 'exact',
          platformEntityId: '501',
          signals: {
            gameCount: 87,
          },
        },
      ],
    });
  });

  const result = await lookupPublishers({ query: 'Devolver Digital' });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(result.success, true);
  assert.deepEqual(result.canonicalResult, {
    confidence: 'high',
    id: 501,
    name: 'Devolver Digital',
  });
  assert.deepEqual(result.summary, {
    avgReviewScore: 91,
    gameCount: 87,
    totalReviews: 220000,
  });
  assert.ok(provenance);
  assert.ok(provenance.dataSources.includes('query_api:resolveEntities'));
});

test('searchGames uses Tiger search-catalog for supported discovery filters', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-catalog');
    assert.ok(init?.body);

    return jsonResponse({
      continuationToken: 'cursor-2',
      items: [
        {
          appid: 367520,
          developers: ['Team Cherry'],
          isFree: false,
          name: 'Hollow Knight',
          platforms: ['windows'],
          publishers: ['Team Cherry'],
          releaseDate: '2017-02-24',
          releaseYear: 2017,
          reviewScore: 97,
          totalReviews: 330000,
        },
        {
          appid: 774361,
          developers: ['The Game Kitchen'],
          isFree: false,
          name: 'Blasphemous',
          platforms: ['windows'],
          publishers: ['Team17'],
          releaseDate: '2019-09-10',
          releaseYear: 2019,
          reviewScore: 90,
          totalReviews: 42000,
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await searchGames({
    limit: 2,
    min_reviews: 100,
    order_by: 'reviews',
    tags: ['Roguelike'],
  });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(result.success, true);
  assert.equal(result.results?.length, 2);
  assert.equal(result.coverage_complete, false);
  assert.equal(result.continuation_meta?.resultSet?.sourceContract, 'searchCatalog');
  assert.ok(provenance);
  assert.ok(provenance.dataSources.includes('query_api:searchCatalog'));
});

test('screenGames uses Tiger discover-momentum for supported momentum filters', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    return jsonResponse({
      filtersApplied: ['sort_by: ccu_peak', 'timeframe: current', 'is_free: true'],
      items: [
        {
          appid: 730,
          ccuPeak: 1500000,
          developerName: 'Valve',
          entityUid: 'steam:game:730',
          isFree: true,
          isSelfPublished: true,
          momentumScore: 100,
          name: 'Counter-Strike 2',
          platformSupport: ['windows'],
          publisherName: 'Valve',
          supportLevel: 'high',
          supportReasons: ['Peak CCU remains dominant.'],
          totalReviews: 9000000,
        },
      ],
      rankingDefinition: 'Peak CCU uses the latest 24-hour concurrent-player snapshot.',
      rankingLabel: 'Peak CCU',
      sufficientToAnswer: true,
      timeframe: 'current',
      timeframeLabel: 'Current snapshot',
    });
  });

  const result = await screenGames({
    filters: { is_free: true },
    sort_by: 'ccu_peak',
    timeframe: 'current',
  });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(result.success, true);
  assert.equal(result.results?.[0]?.appid, 730);
  assert.equal(result.results?.[0]?.publisherName, 'Valve');
  assert.ok(provenance?.dataSources.includes('query_api:discoverMomentum'));
});

test('screenGames folds verified_tags_any into Tiger momentum tag filters', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as {
      filters?: {
        tags?: string[];
      };
    };
    assert.deepEqual(body.filters?.tags, ['Roguelite']);

    return jsonResponse({
      items: [
        {
          appid: 1145360,
          isFree: false,
          name: 'Hades',
          totalReviews: 250000,
        },
      ],
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
    });
  });

  const result = await screenGames({
    filters: { verified_tags_any: ['Roguelite'] },
    sort_by: 'reviews_added_7d',
    timeframe: '7d',
  });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(result.success, true);
  assert.deepEqual(result.results?.[0]?.matchedVerifiedTags, ['Roguelite']);
  assert.ok(provenance?.dataSources.includes('query_api:discoverMomentum'));
});

test('discoverTrending uses Tiger discover-momentum for supported trend filters', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    return jsonResponse({
      filtersApplied: ['sort_by: reviews_added_30d', 'timeframe: 30d', 'tags: Horror'],
      items: [
        {
          appid: 123,
          name: 'Rising Horror',
          reviewPercentage: 89,
          reviewsAdded30d: 120,
          reviewsAdded7d: 40,
          totalReviews: 1800,
          velocity30d: 4,
          velocity7d: 5.7,
        },
      ],
      rankingDefinition: 'Breakout candidates are ranked by recent review pickup and supporting CCU acceleration while keeping the set constrained to smaller-but-rising titles.',
      rankingLabel: 'Reviews Added (30d)',
      sufficientToAnswer: true,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
    });
  });

  const result = await discoverTrending({
    filters: { tags: ['Horror'] },
    trend_type: 'breaking_out',
    timeframe: '30d',
  });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(result.success, true);
  assert.equal(result.results?.[0]?.appid, 123);
  assert.ok(provenance?.dataSources.includes('query_api:discoverMomentum'));
});

test('discoverTrending forwards max price filters to Tiger discover-momentum', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as {
      filters?: {
        maxPriceCents?: number;
      };
    };
    assert.equal(body.filters?.maxPriceCents, 2500);

    return jsonResponse({
      items: [],
      sufficientToAnswer: false,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
    });
  });

  const result = await discoverTrending({
    filters: { max_price_cents: 2500 },
    trend_type: 'breaking_out',
    timeframe: '30d',
  });

  assert.equal(result.success, true);
});

test('lookupTags uses Tiger search-catalog facet lookup for taxonomy prompts', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-catalog');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as {
      facetQuery?: string;
      includeFacets?: string[];
    };
    assert.equal(body.facetQuery, 'colony sim');
    assert.deepEqual(body.includeFacets, ['tags']);

    return jsonResponse({
      facets: {
        canonicalMatch: {
          name: 'Colony Sim',
          type: 'tags',
        },
        categories: [],
        genres: [],
        tags: ['Colony Sim', 'Base Building'],
      },
    });
  });

  const result = await lookupTags({ query: 'colony sim', type: 'tags' });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(result.success, true);
  assert.equal(result.canonicalMatch?.type, 'tag');
  assert.deepEqual(result.results.tags, ['Colony Sim', 'Base Building']);
  assert.ok(provenance?.dataSources.includes('query_api:searchCatalog'));
});

test('getGameChangeTimeline uses Tiger explain-changes when the title resolves cleanly', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  let callCount = 0;
  setScopedFetch(t, async (url, init) => {
    callCount += 1;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body)) as {
        entityKinds?: string[];
        includeMetrics?: boolean;
        limit?: number;
        query?: string;
        resolutionMode?: string;
      };
      assert.deepEqual(body, {
        entityKinds: ['game'],
        includeMetrics: false,
        limit: 5,
        query: 'Hades',
        resolutionMode: 'chat_strict',
      });

      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Hades',
            entityKind: 'game',
            platform: 'steam',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            platformEntityId: '1145360',
            releaseYear: 2020,
            resolutionTier: 'canonical_exact',
          },
        ],
      });
    }

    if (url.pathname === '/v1/contracts/explain-changes') {
      return jsonResponse({
        entity: {
          displayName: 'Hades',
          entityUid: 'steam:game:1145360',
          platformEntityId: '1145360',
        },
        moments: [
          {
            events: [
              {
                afterValue: 'New trailer',
                beforeValue: null,
                changeType: 'media_gallery',
                context: null,
                id: 'event-1',
                occurredAt: '2026-03-15T12:00:00.000Z',
                source: 'storefront',
              },
            ],
          },
        ],
        sufficientToAnswer: true,
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await getGameChangeTimeline({ app_name: 'Hades', limit: 5 });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(callCount, 2);
  assert.equal(result.success, true);
  assert.equal(result.app?.appid, 1145360);
  assert.equal(result.events?.length, 1);
  assert.equal(result.events?.[0]?.label, 'Media Gallery');
  assert.ok(provenance);
  assert.ok(provenance.dataSources.includes('query_api:explainChanges'));
});

test('getGameChangeTimeline uses Tiger get-entity-overview when only appid is provided', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  let callCount = 0;
  setScopedFetch(t, async (url, init) => {
    callCount += 1;

    if (url.pathname === '/v1/contracts/get-entity-overview') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body)) as {
        entityKind?: string;
        platformEntityId?: string;
      };
      assert.equal(body.entityKind, 'game');
      assert.equal(body.platformEntityId, '1145360');
      return jsonResponse({
        entity: {
          displayName: 'Hades',
          entityKind: 'game',
          entityUid: 'steam:game:1145360',
          platformEntityId: '1145360',
        },
      });
    }

    if (url.pathname === '/v1/contracts/explain-changes') {
      return jsonResponse({
        entity: {
          displayName: 'Hades',
          entityUid: 'steam:game:1145360',
          platformEntityId: '1145360',
        },
        moments: [
          {
            events: [
              {
                afterValue: 'New trailer',
                beforeValue: null,
                changeType: 'media_gallery',
                context: null,
                id: 'event-1',
                occurredAt: '2026-03-15T12:00:00.000Z',
                source: 'storefront',
              },
            ],
          },
        ],
        sufficientToAnswer: true,
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await getGameChangeTimeline({ appid: 1145360, limit: 5 });
  const provenance = extractToolExecutionProvenance(result);

  assert.equal(callCount, 2);
  assert.equal(result.success, true);
  assert.equal(result.app?.appid, 1145360);
  assert.equal(result.events?.length, 1);
  assert.ok(provenance?.dataSources.includes('query_api:explainChanges'));
});

test('query_analytics uses Tiger get-entity-overview for developer metrics patterns', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);

    return jsonResponse({
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
        metrics: {
          ccuPeak: 12000,
          gameCount: 7,
          ownersMidpoint: 4000000,
          reviewScore: 94,
          totalReviews: 600000,
        },
        platformEntityId: '3005',
      },
      games: [],
      sufficientToAnswer: true,
    });
  });

  const result = await tryTigerQueryAnalyticsCompat({
    cube: 'DeveloperMetrics',
    dimensions: [
      'DeveloperMetrics.developerId',
      'DeveloperMetrics.developerName',
      'DeveloperMetrics.gameCount',
      'DeveloperMetrics.totalReviews',
      'DeveloperMetrics.avgReviewScore',
    ],
    filters: [
      {
        member: 'DeveloperMetrics.developerId',
        operator: 'equals',
        values: [3005],
      },
    ],
    limit: 1,
  });

  const provenance = result ? extractToolExecutionProvenance(result) : null;

  assert.ok(result);
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data[0], {
    avgReviewScore: 94,
    developerId: 3005,
    developerName: 'FromSoftware',
    gameCount: 7,
    totalOwners: 4000000,
    totalReviews: 600000,
  });
  assert.ok(provenance);
  assert.ok(provenance.dataSources.includes('query_api:getEntityOverview'));
});

test('query_analytics uses Tiger search-catalog for DLC relation prompts', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  const paths: string[] = [];
  setScopedFetch(t, async (url) => {
    paths.push(url.pathname);

    if (url.pathname === '/v1/contracts/get-entity-overview') {
      return jsonResponse({
        entity: {
          displayName: 'ELDEN RING',
        },
      });
    }

    if (url.pathname === '/v1/contracts/search-catalog') {
      return jsonResponse({
        items: [
          {
            appType: 'dlc',
            appid: 2778580,
            name: 'ELDEN RING Shadow of the Erdtree',
            releaseDate: '2024-06-20',
            releaseState: 'released',
          },
        ],
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await tryTigerQueryAnalyticsCompat({
    cube: 'DlcRelations',
    dimensions: ['DlcRelations.parentAppid', 'DlcRelations.dlcAppid'],
    filters: [
      { member: 'DlcRelations.parentAppid', operator: 'equals', values: [1245620] },
    ],
    limit: 50,
  });

  assert.ok(result);
  assert.equal(paths[0], '/v1/contracts/get-entity-overview');
  assert.equal(paths[1], '/v1/contracts/search-catalog');
  assert.equal(result?.success, true);
  assert.equal(result?.data[0]?.parentName, 'ELDEN RING');
  assert.equal(result?.data[0]?.dlcAppid, 2778580);
});

test('query_analytics uses Tiger rank-entities for company window ranking prompts', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/rank-entities');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.entityKind, 'publisher');
    assert.equal(body.metric, 'game_count');
    assert.equal(body.releaseDays, 180);

    return jsonResponse({
      items: [
        {
          displayName: 'Devolver Digital',
          metrics: {
            gameCount: 6,
            reviewScore: 88,
            totalReviews: 55000,
          },
          platformEntityId: '501',
        },
      ],
    });
  });

  const result = await tryTigerQueryAnalyticsCompat({
    cube: 'PublisherChatWindowMetrics',
    dimensions: ['PublisherChatWindowMetrics.publisherId'],
    filters: [
      {
        member: 'PublisherChatWindowMetrics.meaningfulGamesReleasedLast6Months',
        operator: 'gte',
        values: [1],
      },
    ],
    limit: 25,
    order: {
      'PublisherChatWindowMetrics.meaningfulGamesReleasedLast6Months': 'desc',
    },
    segments: ['PublisherChatWindowMetrics.last6Months'],
  });

  const provenance = result ? extractToolExecutionProvenance(result) : null;

  assert.ok(result);
  assert.equal(result?.success, true);
  assert.equal(result?.data[0]?.publisherName, 'Devolver Digital');
  assert.equal(result?.data[0]?.gamesReleasedLast6Months, 6);
  assert.ok(provenance?.dataSources.includes('query_api:rankEntities'));
});

test('query_analytics uses Tiger monthly playtime contract for monthly game rankings', async (t) => {
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/query-monthly-playtime');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.entityKind, 'game');
    assert.equal(body.startMonth, '2025-12-01');
    assert.equal(body.endMonth, '2025-12-01');

    return jsonResponse({
      items: [
        {
          entityId: 730,
          estimatedMonthlyHours: 123456,
          month: '2025-12-01',
          monthNum: 12,
          monthlyCcuSum: 987654,
          name: 'Counter-Strike 2',
          year: 2025,
        },
      ],
    });
  });

  const result = await tryTigerQueryAnalyticsCompat({
    cube: 'MonthlyGameMetrics',
    dimensions: [
      'MonthlyGameMetrics.appid',
      'MonthlyGameMetrics.gameName',
      'MonthlyGameMetrics.estimatedMonthlyHours',
    ],
    filters: [
      { member: 'MonthlyGameMetrics.year', operator: 'equals', values: [2025] },
      { member: 'MonthlyGameMetrics.monthNum', operator: 'equals', values: [12] },
    ],
    limit: 10,
    order: {
      'MonthlyGameMetrics.estimatedMonthlyHours': 'desc',
    },
  });

  const provenance = result ? extractToolExecutionProvenance(result) : null;

  assert.ok(result);
  assert.equal(result?.success, true);
  assert.equal(result?.data[0]?.appid, 730);
  assert.equal(result?.data[0]?.gameName, 'Counter-Strike 2');
  assert.equal(result?.data[0]?.estimatedMonthlyHours, 123456);
  assert.ok(provenance?.dataSources.includes('query_api:queryMonthlyPlaytime'));
});

test('Tiger primary routes monthly playtime prompts through Tiger monthly aggregates', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/query-monthly-playtime');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.entityKind, 'game');
    assert.equal(body.startMonth, '2026-04-01');
    assert.equal(body.endMonth, '2026-04-01');

    return jsonResponse({
      endMonth: '2026-04-01',
      entityKind: 'game',
      items: [
        {
          entityId: 730,
          entityKind: 'game',
          estimatedMonthlyHours: 144977576,
          month: '2026-04-01',
          monthNum: 4,
          monthlyCcuSum: 41906267,
          name: 'Counter-Strike 2',
          rank: 1,
          year: 2026,
        },
      ],
      startMonth: '2026-04-01',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What were the top games by playtime in April 2026?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.enabled, true);
  assert.equal(result.info.matchedIntent, 'monthly_playtime');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'queryMonthlyPlaytime');
  assert.match(result.renderedText ?? '', /Counter-Strike 2/);
});

test('Tiger primary routes marketing-push prompts through Tiger change discovery', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-change-patterns');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.pattern, 'marketing_push');
    return jsonResponse({
      interpretedFilters: {
        days: 30,
        pattern: 'marketing_push',
        query: null,
      },
      items: [
        {
          activityIds: ['change:1'],
          appid: 1145350,
          confidence: 'high',
          name: 'Hades II',
          occurredAt: '2026-03-30T12:00:00.000Z',
          primaryProof: {
            headline: 'Store refresh paired with announcement activity',
            summary: 'Tiger detected a coordinated store and announcement beat.',
          },
          reasons: ['Announcement activity landed alongside store-page updates.'],
          signalFamilies: ['announcement', 'store-page'],
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Which games look like they started a new marketing push recently?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.enabled, true);
  assert.equal(result.info.matchedIntent, 'change_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /strongest recent change-pattern matches/);
});

test('Tiger primary routes developer-diary news prompts through Tiger search-documents', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-documents');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.mode, 'topic_search');
    assert.equal(body.query, 'developer diary');

    return jsonResponse({
      entity: null,
      interpretedFilters: {
        mode: 'topic_search',
        query: 'developer diary',
      },
      items: [
        {
          appName: 'Hades II',
          appid: 1145350,
          feedLabel: 'Steam News',
          feedScope: 'community_announcements',
          publishedAt: '2026-03-30T12:00:00.000Z',
          sortTime: '2026-03-30T12:00:00.000Z',
          title: 'Developer Diary #7',
          url: 'https://store.steampowered.com/news/app/1145350/view/1',
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What games have released developer diaries lately?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'news_search');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /developer diary/i);
});

test('Tiger primary keeps entity-scoped developer-diary prompts filtered to the named game', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let searchDocumentsCalls = 0;

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'hades ii');

      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'game:steam:1145350',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            platform: 'steam',
            platformEntityId: '1145350',
            releaseYear: 2025,
            resolutionTier: 'canonical_exact',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/search-documents');
    searchDocumentsCalls += 1;
    assert.equal(searchDocumentsCalls, 1);
    assert.deepEqual(body.entityUids, ['game:steam:1145350']);
    assert.equal(body.mode, 'topic_search');
    assert.equal(body.query, 'developer diary');

    return jsonResponse({
      entity: {
        displayName: 'Hades II',
        entityKind: 'game',
        entityUid: 'game:steam:1145350',
        platform: 'steam',
        platformEntityId: '1145350',
      },
      interpretedFilters: {
        endTime: '2026-04-04T00:00:00.000Z',
        entityUids: ['game:steam:1145350'],
        feedScopes: [],
        mode: 'topic_search',
        query: 'developer diary',
        startTime: '2026-01-04T00:00:00.000Z',
      },
      items: [
        {
          appName: 'Hades II',
          appid: 1145350,
          feedLabel: 'Steam News',
          feedScope: 'community_announcements',
          publishedAt: '2026-03-30T12:00:00.000Z',
          sortTime: '2026-03-30T12:00:00.000Z',
          title: 'Developer Diary #7',
          url: 'https://store.steampowered.com/news/app/1145350/view/1',
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'any recent developer diaries for hades ii?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'news_search');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Hades II/);
  assert.match(result.renderedText ?? '', /Developer Diary #7/);
});

test('Tiger primary does not broaden entity-scoped topic news searches to unrelated games when the result set is sparse', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let searchDocumentsCalls = 0;

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'hades ii');

      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'game:steam:1145350',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            platform: 'steam',
            platformEntityId: '1145350',
            releaseYear: 2025,
            resolutionTier: 'canonical_exact',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/search-documents');
    searchDocumentsCalls += 1;
    assert.equal(searchDocumentsCalls, 1);
    assert.deepEqual(body.entityUids, ['game:steam:1145350']);
    assert.equal(body.mode, 'topic_search');
    assert.equal(body.query, 'developer diary');

    return jsonResponse({
      entity: {
        displayName: 'Hades II',
        entityKind: 'game',
        entityUid: 'game:steam:1145350',
        platform: 'steam',
        platformEntityId: '1145350',
      },
      interpretedFilters: {
        endTime: '2026-04-04T00:00:00.000Z',
        entityUids: ['game:steam:1145350'],
        feedScopes: [],
        mode: 'topic_search',
        query: 'developer diary',
        startTime: '2026-01-04T00:00:00.000Z',
      },
      items: [],
      sufficientToAnswer: false,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'any recent developer diaries for hades ii?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(searchDocumentsCalls, 1);
  assert.equal(result.info.matchedIntent, 'news_search');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /could not find relevant hades ii documents/i);
});

test('Tiger primary returns clarification from a low-confidence interpreted intent before guessing', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedFetch(t, async () => {
    throw new Error('Tiger primary should not call query-api for clarification-only interpretations');
  });

  const result = await runTigerPrimaryEvaluation({
    interpretation: {
      clarificationQuestion: 'Which game or company do you want to focus on?',
      confidence: 'low',
      continuationAction: 'none',
      contractCandidates: ['resolveEntities', 'getEntityOverview'],
      entities: [],
      intent: 'entity_overview',
    },
    isEvalRequest: true,
    prompt: 'tell me more',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Which game or company do you want to focus on\?/);
});

test('Tiger primary routes "what do you know about" prompts into entity-overview handling', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      assert.equal(String(body.query).toLowerCase(), 'hades ii');

      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'game:steam:1145350',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            platform: 'steam',
            platformEntityId: '1145350',
            releaseYear: 2025,
            resolutionTier: 'canonical_exact',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'game',
      entityUid: 'game:steam:1145350',
      gamesLimit: 0,
      gamesSortBy: 'release_date',
      platformEntityId: '1145350',
    });

    return jsonResponse({
      entity: {
        details: {
          developers: ['Supergiant Games'],
          discountPercent: 0,
          isFree: false,
          isReleased: true,
          platforms: ['windows', 'macos'],
          priceCents: 2999,
          publishers: ['Supergiant Games'],
          releaseDate: '2025-09-25',
          releaseState: 'released',
          releaseYear: 2025,
        },
        displayName: 'Hades II',
        entityKind: 'game',
        metrics: {
          ccuPeak: 6736,
          gameCount: null,
          ownersMidpoint: 3500000,
          reviewScore: 90,
          totalReviews: 115774,
        },
      },
      games: [],
      sufficientToAnswer: true,
      viewMode: 'single_game',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what do you know about hades ii',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.contractName, 'resolveEntities');
  assert.doesNotMatch(result.renderedText ?? '', /I couldn't route that prompt cleanly/i);
  assert.match(result.renderedText ?? '', /Hades II|likely matches/i);
});

test('Tiger primary gives entity resolution more timeout budget than the default shadow timeout', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  const abortSignalWithTimeout = AbortSignal as typeof AbortSignal & {
    timeout: typeof AbortSignal.timeout;
  };
  const originalAbortSignalTimeout = abortSignalWithTimeout.timeout;
  const timeoutCalls: number[] = [];
  abortSignalWithTimeout.timeout = ((delay: number) => {
    timeoutCalls.push(delay);
    return new AbortController().signal;
  }) as typeof AbortSignal.timeout;

  t.after(() => {
    abortSignalWithTimeout.timeout = originalAbortSignalTimeout;
  });

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      assert.equal(body.query, 'Counter Strike 2');
      assert.equal(body.includeMetrics, false);
      assert.equal(body.limit, 25);
      assert.equal(body.resolutionMode, 'chat_strict');
      assert.deepEqual(body.entityKinds, ['game']);

      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Counter-Strike 2',
            entityKind: 'game',
            entityUid: 'game:steam:730',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '730',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'game',
      entityUid: 'game:steam:730',
      gamesLimit: 0,
      gamesSortBy: 'release_date',
      platformEntityId: '730',
    });
    return jsonResponse({
      entity: {
        details: {
          developers: ['Valve'],
          discountPercent: 0,
          isFree: true,
          isReleased: true,
          platforms: ['windows', 'linux'],
          priceCents: 0,
          publishers: ['Valve'],
          releaseDate: '2023-09-27',
          releaseState: 'released',
          releaseYear: 2023,
        },
        displayName: 'Counter-Strike 2',
        entityKind: 'game',
        metrics: {
          ccuPeak: 1818625,
          gameCount: null,
          ownersMidpoint: 150000000,
          reviewScore: 87,
          totalReviews: 9000000,
        },
      },
      games: [],
      sufficientToAnswer: true,
      viewMode: 'single_game',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what CCU is Counter Strike 2?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(timeoutCalls.length, 2);
  assert.ok(timeoutCalls[0] >= 12000);
  assert.ok(timeoutCalls[0] > timeoutCalls[1]);
});

test('Tiger primary routes "what CCU is <title>" prompts into entity-overview handling even with stale clarification state', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      assert.equal(body.query, 'Counter Strike 2');
      assert.equal(body.includeMetrics, false);
      assert.equal(body.limit, 25);
      assert.equal(body.resolutionMode, 'chat_strict');
      assert.deepEqual(body.entityKinds, ['game']);

      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Counter-Strike 2',
            entityKind: 'game',
            entityUid: 'game:steam:730',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '730',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'game',
      entityUid: 'game:steam:730',
      gamesLimit: 0,
      gamesSortBy: 'release_date',
      platformEntityId: '730',
    });

    return jsonResponse({
      entity: {
        details: {
          developers: ['Valve'],
          discountPercent: 0,
          isFree: true,
          isReleased: true,
          platforms: ['windows', 'linux'],
          priceCents: 0,
          publishers: ['Valve'],
          releaseDate: '2023-09-27',
          releaseState: 'released',
          releaseYear: 2023,
        },
        displayName: 'Counter-Strike 2',
        entityKind: 'game',
        metrics: {
          ccuPeak: 1818625,
          gameCount: null,
          ownersMidpoint: 150000000,
          reviewScore: 87,
          totalReviews: 9000000,
        },
      },
      games: [],
      sufficientToAnswer: true,
      viewMode: 'single_game',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what CCU is Counter Strike 2?',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        clarificationNeeded: true,
        family: 'entity_overview',
        summary: 'System needs clarification for entity_overview.',
      },
      selectionState: {
        family: 'entity_overview',
        slots: [{
          candidates: [],
          continuationToken: null,
          expectedEntityKind: null,
          label: 'Counter-Strike 2',
          query: 'Counter-Strike 2',
          requiresClarification: true,
          selectedEntityUid: null,
          slotId: 'primary',
          totalCandidates: 0,
        }],
      },
      requestState: null,
      resultSet: null,
      updatedAt: '2026-04-09T06:26:00.390Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.contractName, 'resolveEntities');
  assert.equal(result.info.attempts[1]?.contractName, 'getEntityOverview');
  assert.match(result.renderedText ?? '', /Counter-Strike 2/);
  assert.doesNotMatch(result.renderedText ?? '', /stable momentum screen/i);
});

test('Tiger primary stops strict game resolution before downstream execution when clarification is still required', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/resolve-entities');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as { query?: string };
    assert.equal(body.query, 'Counter Strike 2');

    return jsonResponse({
      ambiguity: {
        candidateNames: ['Counter-Strike 2', 'Counter Strike 2'],
        message: 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.',
        requiresClarification: true,
        totalCandidates: 2,
      },
      entities: [
        {
          confidence: 0.97,
          displayName: 'Counter-Strike 2',
          entityKind: 'game',
          entityUid: 'game:steam:730',
          matchQuality: 'exact',
          matchSource: 'canonical_name',
          platform: 'steam',
          platformEntityId: '730',
          resolutionTier: 'canonical_exact',
        },
        {
          confidence: 0.96,
          displayName: 'Counter Strike 2',
          entityKind: 'game',
          entityUid: 'game:steam:731',
          matchQuality: 'exact',
          matchSource: 'canonical_name',
          platform: 'steam',
          platformEntityId: '731',
          releaseYear: 2023,
          resolutionTier: 'canonical_exact',
        },
      ],
    });
    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what CCU is Counter Strike 2?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.contractName, 'resolveEntities');
  assert.equal(result.info.attempts[1]?.contractName, 'getEntityOverview');
  assert.equal(result.info.attempts[1]?.status, 'skipped');
  assert.match(result.renderedText ?? '', /multiple likely matches|choose the exact one below/i);
  assert.equal(result.sessionState?.selectionState?.slots[0]?.requiresClarification, true);
  assert.equal(result.sessionState?.selectionState?.slots[0]?.selectedEntityUid, null);
});

test('Tiger primary routes overview prompts through get-entity-overview', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      assert.deepEqual(JSON.parse(String(init.body)), {
        entityKinds: ['game'],
        includeMetrics: false,
        limit: 25,
        query: 'Hades II',
        resolutionMode: 'chat_strict',
        resolutionPreference: 'game',
      });
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'game:steam:1145350',
            platform: 'steam',
            platformEntityId: '1145350',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'game',
      entityUid: 'game:steam:1145350',
      gamesLimit: 0,
      gamesSortBy: 'release_date',
      platformEntityId: '1145350',
    });

    return jsonResponse({
      entity: {
        details: {
          developers: ['Supergiant Games'],
          discountPercent: 0,
          isFree: false,
          isReleased: true,
          platforms: ['windows', 'macos'],
          priceCents: 2999,
          publishers: ['Supergiant Games'],
          releaseDate: '2025-09-25',
          releaseState: 'released',
          releaseYear: 2025,
        },
        displayName: 'Hades II',
        entityKind: 'game',
        metrics: {
          ccuPeak: 6736,
          gameCount: null,
          ownersMidpoint: 3500000,
          reviewScore: 90,
          totalReviews: 115774,
        },
        platformEntityId: '1145350',
      },
      games: [],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'tell me about Hades II',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /latest snapshot for \*\*Hades II\*\*/);
  assert.match(result.renderedText ?? '', /\*\*Release status\*\*: released/);
  assert.equal(result.contractResult?.contractName, 'getEntityOverview');
});

test('Tiger primary broadens plain overview prompts to company kinds only after a zero-hit game pass', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  const resolveBodies: unknown[] = [];

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      resolveBodies.push(body);

      if (resolveBodies.length === 1) {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [],
          provenance: {
            capturedAt: '2026-04-09T00:00:00.000Z',
            source: 'tiger',
            tables: ['core.entities'],
          },
          totalCandidates: 0,
        });
      }

      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            displayName: 'Crimson',
            entityKind: 'publisher',
            entityUid: 'publisher:publisheriq:200771',
            platform: 'publisheriq',
            platformEntityId: '200771',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    return jsonResponse({
      entity: {
        details: {
          topGames: ['Crimson Frontier'],
        },
        displayName: 'Crimson',
        entityKind: 'publisher',
        metrics: {
          ccuPeak: null,
          gameCount: 12,
          ownersMidpoint: null,
          reviewScore: null,
          totalReviews: null,
        },
        platformEntityId: '200771',
      },
      games: [],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'tell me about crimson',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.deepEqual(resolveBodies, [
    {
      entityKinds: ['game'],
      includeMetrics: false,
      limit: 25,
      query: 'crimson',
      resolutionMode: 'chat_strict',
      resolutionPreference: 'game',
    },
    {
      entityKinds: ['publisher', 'developer'],
      includeMetrics: false,
      limit: 6,
      query: 'crimson',
      resolutionMode: 'autocomplete',
      resolutionPreference: 'company',
    },
  ]);
  assert.equal(result.contractResult?.contractName, 'getEntityOverview');
});

test('Tiger primary routes company count prompts through get-entity-overview', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.entityKinds, ['publisher']);
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            displayName: 'Valve',
            entityKind: 'publisher',
            entityUid: 'publisher:steam:42',
            platform: 'steam',
            platformEntityId: '42',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    return jsonResponse({
      entity: {
        details: {
          developers: [],
          discountPercent: null,
          isFree: null,
          isReleased: null,
          platforms: [],
          priceCents: null,
          publishers: [],
          releaseDate: null,
          releaseState: null,
          releaseYear: null,
        },
        displayName: 'Valve',
        entityKind: 'publisher',
        metrics: {
          ccuPeak: 1200000,
          gameCount: 18,
          ownersMidpoint: 50000000,
          reviewScore: 92,
          totalReviews: 1800000,
        },
        platformEntityId: '42',
      },
      games: [
        {
          appid: 570,
          name: 'Dota 2',
          ownersMidpoint: 20000000,
          releaseDate: '2013-07-09',
          releaseYear: 2013,
          reviewScore: 81,
          totalReviews: 2400000,
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'How many games has Valve published?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /\*\*Valve\*\* currently has \*\*18\*\* games/);
});

test('Tiger primary routes company portfolio metric prompts through get-entity-overview', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      assert.equal(body.query, 'FromSoftware');
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            displayName: 'FromSoftware',
            entityKind: 'developer',
            entityUid: 'developer:publisheriq:3005',
            platform: 'publisheriq',
            platformEntityId: '3005',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'developer',
      entityUid: 'developer:publisheriq:3005',
      gamesLimit: 5,
      gamesSortBy: 'release_date',
      platformEntityId: '3005',
    });

    return jsonResponse({
      entity: {
        details: {
          developers: [],
          discountPercent: null,
          isFree: null,
          isReleased: null,
          platforms: [],
          priceCents: null,
          publishers: [],
          releaseDate: null,
          releaseState: null,
          releaseYear: null,
        },
        displayName: 'FromSoftware',
        entityKind: 'developer',
        metrics: {
          ccuPeak: 12000,
          gameCount: 7,
          ownersMidpoint: 4000000,
          reviewScore: 94,
          totalReviews: 600000,
        },
        platformEntityId: '3005',
      },
      games: [
        {
          appid: 1245620,
          name: 'ELDEN RING',
          ownersMidpoint: 2500000,
          releaseDate: '2022-02-25',
          releaseYear: 2022,
          reviewScore: 94,
          totalReviews: 700000,
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'How many players do FromSoftware games have?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getEntityOverview');
  assert.match(result.renderedText ?? '', /main portfolio metrics for \*\*FromSoftware\*\*/);
  assert.match(result.renderedText ?? '', /Portfolio owners midpoint/);
  assert.doesNotMatch(result.renderedText ?? '', /likely matches/i);
});

test('Tiger primary auto-selects the dominant company candidate when resolver ambiguity is only alias noise', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'FromSoftware');
      return jsonResponse({
        ambiguity: {
          candidateNames: ['FromSoftware', 'FromSoftware, Inc', 'FromSoftware, Inc.'],
          message: 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.',
          requiresClarification: true,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'FromSoftware',
            entityKind: 'developer',
            entityUid: 'developer:publisheriq:285932',
            matchQuality: 'exact',
            matchedName: 'FromSoftware',
            platform: 'publisheriq',
            platformEntityId: '285932',
            signals: {
              gameCount: 1,
            },
          },
          {
            confidence: 0.92,
            displayName: 'FromSoftware, Inc',
            entityKind: 'developer',
            entityUid: 'developer:publisheriq:332003',
            matchQuality: 'prefix',
            matchedName: 'FromSoftware, Inc',
            platform: 'publisheriq',
            platformEntityId: '332003',
            signals: {
              gameCount: 1,
            },
          },
          {
            confidence: 0.92,
            displayName: 'FromSoftware, Inc.',
            entityKind: 'publisher',
            entityUid: 'publisher:publisheriq:2949',
            matchQuality: 'prefix',
            matchedName: 'FromSoftware, Inc.',
            platform: 'publisheriq',
            platformEntityId: '2949',
            signals: {
              gameCount: 7,
            },
          },
          {
            confidence: 0.92,
            displayName: 'FromSoftware, Inc.',
            entityKind: 'developer',
            entityUid: 'developer:publisheriq:3005',
            matchQuality: 'prefix',
            matchedName: 'FromSoftware, Inc.',
            platform: 'publisheriq',
            platformEntityId: '3005',
            signals: {
              gameCount: 12,
            },
          },
          {
            confidence: 0.92,
            displayName: 'FromSoftware, Inc. (Japan)',
            entityKind: 'publisher',
            entityUid: 'publisher:publisheriq:194127',
            matchQuality: 'prefix',
            matchedName: 'FromSoftware, Inc. (Japan)',
            platform: 'publisheriq',
            platformEntityId: '194127',
            signals: {
              gameCount: 1,
            },
          },
          {
            confidence: 0.72,
            displayName: 'Freed Software',
            entityKind: 'game',
            entityUid: 'game:steam:2082960',
            matchQuality: 'fuzzy',
            matchedName: 'Freed Software',
            platform: 'steam',
            platformEntityId: '2082960',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.deepEqual(body, {
      entityKind: 'developer',
      entityUid: 'developer:publisheriq:3005',
      gamesLimit: 5,
      gamesSortBy: 'release_date',
      platformEntityId: '3005',
    });

    return jsonResponse({
      entity: {
        details: {
          developers: [],
          discountPercent: null,
          isFree: null,
          isReleased: null,
          platforms: [],
          priceCents: null,
          publishers: [],
          releaseDate: null,
          releaseState: null,
          releaseYear: null,
        },
        displayName: 'FromSoftware, Inc.',
        entityKind: 'developer',
        metrics: {
          ccuPeak: 12000,
          gameCount: 12,
          ownersMidpoint: 4000000,
          reviewScore: 94,
          totalReviews: 600000,
        },
        platformEntityId: '3005',
      },
      games: [],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'How many players do FromSoftware games have?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts.at(-1)?.contractName, 'getEntityOverview');
  assert.match(result.renderedText ?? '', /portfolio metrics/i);
  assert.doesNotMatch(result.renderedText ?? '', /Which one did you mean|I found a few likely matches/i);
});

test('Tiger primary routes company game-list prompts through Tiger catalog search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-catalog');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.developerQuery, 'FromSoftware');
    assert.equal(body.sortBy, 'reviews');

    return jsonResponse({
      continuationToken: null,
      interpretedFilters: {
        appids: [],
        developerIds: [],
        developerQuery: 'FromSoftware',
        genres: [],
        includeAppTypes: [],
        isFree: null,
        isReleased: null,
        minCcu: null,
        minDiscountPercent: null,
        minPriceCents: null,
        minOwners: null,
        minReviewScore: null,
        minReviews: null,
        onSale: null,
        platforms: [],
        publisherIds: [],
        publisherQuery: null,
        query: null,
        releaseYear: null,
        sortBy: 'reviews',
        sortDirection: 'desc',
        tags: [],
        maxPriceCents: null,
      },
      items: [
        {
          appid: 1245620,
          developers: ['FromSoftware'],
          developerIds: [3005],
          isFree: false,
          isReleased: true,
          name: 'ELDEN RING',
          platforms: ['windows'],
          priceCents: 5999,
          publishers: ['FromSoftware'],
          publisherIds: [3005],
          releaseDate: '2022-02-25',
          releaseState: 'released',
          releaseYear: 2022,
          reviewScore: 94,
          totalReviews: 700000,
          ownersMidpoint: 2500000,
          appType: 'game',
          ccuPeak: 953426,
          discountPercent: 0,
          parentAppid: null,
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'top games from FromSoftware',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'catalog_search');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /ELDEN RING/);
});

test('Tiger primary routes review-ranking prompts through Tiger rankEntities instead of catalog search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/rank-entities');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'game',
      limit: 10,
      metric: 'total_reviews',
      sortDirection: 'desc',
    });

    return jsonResponse({
      entityKind: 'game',
      items: [
        {
          displayName: 'Counter-Strike 2',
          entityKind: 'game',
          entityUid: 'game:steam:730',
          metrics: {
            ccuPeak: 1404982,
            ownersMidpoint: 0,
            reviewScore: 88,
            totalReviews: 9495164,
          },
          platformEntityId: '730',
        },
        {
          displayName: 'Dota 2',
          entityKind: 'game',
          entityUid: 'game:steam:570',
          metrics: {
            ccuPeak: 601576,
            ownersMidpoint: 0,
            reviewScore: 84,
            totalReviews: 2684906,
          },
          platformEntityId: '570',
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What are the top games by reviews?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_ranking');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.contractName, 'rankEntities');
  assert.match(result.renderedText ?? '', /Counter-Strike 2/);
  assert.match(result.renderedText ?? '', /Dota 2/);
});

test('Tiger primary routes concept prompts through Tiger semanticSearch instead of catalog search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/semantic-search');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.mode, 'concept');
    assert.equal(body.entityKind, 'game');
    assert.equal(body.description, 'cozy farming games under $20');
    assert.equal(body.filters?.max_price_cents, 2000);
    assert.ok(Array.isArray(body.filters?.tags));
    assert.ok(body.filters.tags.includes('Cozy'));
    assert.ok(Array.isArray(body.filters?.top_tags));
    assert.ok(body.filters.top_tags.includes('Cozy'));

    return jsonResponse({
      mode: 'semantic',
      query_description: body.description,
      results: [
        {
          genres: ['Farming Sim', 'RPG'],
          id: 413150,
          matchReasons: ['Cozy farming loop with strong player sentiment.'],
          name: 'Stardew Valley',
          price_cents: 1499,
          review_percentage: 98,
          score: 0.91,
          steam_deck: 'verified',
          tags: ['Cozy', 'Farming Sim'],
          total_reviews: 990611,
          type: 'game',
        },
      ],
      sufficient_to_answer: true,
      success: true,
      total_found: 1,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Find cozy farming games under $20',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'semantic_search');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'semanticSearch');
  assert.match(result.renderedText ?? '', /Stardew Valley/);
});

test('Tiger primary keeps better-review similarity prompts on Tiger semanticSearch', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/semantic-search');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.mode, 'similarity');
    assert.equal(body.referenceQuery, 'Hades');
    assert.equal(body.filters?.review_comparison, 'better_only');

    return jsonResponse({
      close_alternatives: [
        {
          id: 588650,
          matchReasons: ['Action roguelike that stays very close on similarity.'],
          name: 'Dead Cells',
          review_percentage: 96.4,
          score: 0.88,
          total_reviews: 145000,
          type: 'game',
        },
      ],
      close_alternatives_reason:
        'These stay highly similar, but they miss the stricter higher-review cutoff from the original request.',
      reference: {
        id: 1145360,
        name: 'Hades',
        type: 'game',
      },
      results: [
        {
          id: 367520,
          matchReasons: ['Action roguelike with stronger review sentiment.'],
          name: 'Hollow Knight',
          review_percentage: 97,
          score: 0.92,
          total_reviews: 355000,
          type: 'game',
        },
      ],
      sufficient_to_answer: true,
      total_found: 1,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Games like Hades with better reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'semantic_search');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'semanticSearch');
  assert.equal(result.answerBrief?.allowNarration, true);
  assert.equal(result.answerBrief?.narrationConfidence, 'high');
  assert.match(result.renderedText ?? '', /Hollow Knight/);
  assert.match(result.renderedText ?? '', /Close alternatives/);
  assert.match(result.renderedText ?? '', /Dead Cells/);
});

test('Tiger primary preserves semantic max-review ceilings from prompt text', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/semantic-search');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.mode, 'similarity');
    assert.equal(body.referenceQuery, 'Hollow Knight');
    assert.equal(body.filters?.max_reviews, 10000);

    return jsonResponse({
      mode: 'semantic',
      reference: {
        id: 367520,
        name: 'Hollow Knight',
        type: 'game',
      },
      results: [
        {
          id: 1296830,
          matchReasons: ['Metroidvania and action-platformer fit.'],
          name: 'Warm Snow',
          review_percentage: 94,
          score: 0.82,
          total_reviews: 9540,
          type: 'game',
        },
      ],
      sufficient_to_answer: true,
      success: true,
      total_found: 1,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Games similar to Hollow Knight with fewer than 10K reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'semantic_search');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'semanticSearch');
  assert.match(result.renderedText ?? '', /Warm Snow/);
});

test('Tiger primary routes on-sale discovery prompts through Tiger catalog search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-catalog');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.onSale, true);

    return jsonResponse({
      continuationToken: null,
      interpretedFilters: {
        appids: [],
        developerIds: [],
        developerQuery: null,
        genres: [],
        includeAppTypes: [],
        isFree: null,
        isReleased: null,
        minCcu: null,
        minDiscountPercent: null,
        minPriceCents: null,
        minOwners: null,
        minReviewScore: null,
        minReviews: null,
        onSale: true,
        platforms: [],
        publisherIds: [],
        publisherQuery: null,
        query: null,
        releaseYear: null,
        sortBy: 'reviews',
        sortDirection: 'desc',
        tags: [],
        maxPriceCents: null,
      },
      items: [
        {
          appid: 1245620,
          developers: ['FromSoftware'],
          developerIds: [3005],
          isFree: false,
          isReleased: true,
          name: 'ELDEN RING',
          platforms: ['windows'],
          priceCents: 4199,
          publishers: ['Bandai Namco'],
          publisherIds: [101],
          releaseDate: '2022-02-25',
          releaseState: 'released',
          releaseYear: 2022,
          reviewScore: 94,
          totalReviews: 700000,
          ownersMidpoint: 2500000,
          appType: 'game',
          ccuPeak: 953426,
          discountPercent: 30,
          parentAppid: null,
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Games currently on sale',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'catalog_search');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /ELDEN RING/);
});

test('Tiger primary routes price-and-review discovery prompts through Tiger catalog search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-catalog');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));
    assert.equal(body.isFree, false);
    assert.equal(body.minPriceCents, 4000);
    assert.equal(body.minReviewScore, 80);

    return jsonResponse({
      continuationToken: null,
      interpretedFilters: {
        appids: [],
        developerIds: [],
        developerQuery: null,
        genres: [],
        includeAppTypes: [],
        isFree: false,
        isReleased: null,
        minCcu: null,
        minDiscountPercent: null,
        minPriceCents: 4000,
        minOwners: null,
        minReviewScore: 80,
        minReviews: 1000,
        onSale: null,
        platforms: [],
        publisherIds: [],
        publisherQuery: null,
        query: null,
        releaseYear: null,
        sortBy: 'reviews',
        sortDirection: 'desc',
        tags: [],
        maxPriceCents: null,
      },
      items: [
        {
          appid: 1888930,
          developers: ['Larian Studios'],
          developerIds: [1],
          isFree: false,
          isReleased: true,
          name: "Baldur's Gate 3",
          platforms: ['windows'],
          priceCents: 5999,
          publishers: ['Larian Studios'],
          publisherIds: [1],
          releaseDate: '2023-08-03',
          releaseState: 'released',
          releaseYear: 2023,
          reviewScore: 96,
          totalReviews: 680000,
          ownersMidpoint: 12000000,
          appType: 'game',
          ccuPeak: 875343,
          discountPercent: 0,
          parentAppid: null,
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Premium games over $40 with great reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'catalog_search');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Baldur's Gate 3/);
});

test('Tiger primary clears stale entity switch hints on unrelated discovery prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url) => {
    if (url.pathname !== '/v1/contracts/semantic-search' && url.pathname !== '/v1/contracts/search-catalog') {
      throw new Error(`Unexpected query-api path: ${url.pathname}`);
    }

    if (url.pathname === '/v1/contracts/semantic-search') {
      return jsonResponse({
        query_description: 'what are the top indie games currently',
        results: [
          {
            id: 413150,
            matchReasons: ['Indie hit with enduring player sentiment.'],
            name: 'Stardew Valley',
            review_percentage: 98,
            score: 0.91,
            total_reviews: 990611,
          },
        ],
        sufficient_to_answer: true,
      });
    }

    return jsonResponse({
      interpretedFilters: {
        appids: [],
        developerIds: [],
        developerQuery: null,
        genres: [],
        includeAppTypes: [],
        isFree: null,
        isReleased: null,
        maxPriceCents: null,
        minCcu: null,
        minDiscountPercent: null,
        minOwners: null,
        minPriceCents: null,
        minReviewScore: null,
        minReviews: null,
        onSale: null,
        platforms: [],
        publisherIds: [],
        publisherQuery: null,
        query: null,
        releaseYear: null,
        sortBy: 'reviews',
        sortDirection: 'desc',
        tags: ['Indie'],
      },
      items: [
        {
          appid: 413150,
          appType: 'game',
          ccuPeak: 875343,
          developers: ['ConcernedApe'],
          developerIds: [123],
          discountPercent: 0,
          isFree: false,
          isReleased: true,
          name: 'Stardew Valley',
          ownersMidpoint: 15000000,
          parentAppid: null,
          platforms: ['windows', 'macos', 'linux'],
          priceCents: 1499,
          publishers: ['ConcernedApe'],
          publisherIds: [123],
          releaseDate: '2016-02-26',
          releaseState: 'released',
          releaseYear: 2016,
          reviewScore: 98,
          totalReviews: 990611,
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what are the top indie games currently?',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'change_explanation',
        summary: 'Tiger answered change_explanation.',
      },
      selectionState: {
        family: 'change_explanation',
        slots: [{
          candidates: [
            {
              displayName: 'Hades II',
              entityKind: 'game',
              entityUid: 'game:steam:1145350',
              matchQuality: 'exact',
              ordinal: 1,
              platform: 'steam',
              platformEntityId: '1145350',
              score: 108,
            },
            {
              displayName: 'Hades',
              entityKind: 'game',
              entityUid: 'game:steam:1145360',
              matchQuality: 'fuzzy',
              ordinal: 2,
              platform: 'steam',
              platformEntityId: '1145360',
              score: 88,
            },
          ],
          label: 'Hades II',
          query: 'Hades II',
          requiresClarification: false,
          selectedEntityUid: 'game:steam:1145350',
          slotId: 'primary',
        }],
      },
      resultSet: null,
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.route, 'primary_success');
  assert.notEqual(result.info.matchedIntent, 'change_explanation');
  assert.doesNotMatch(result.renderedText ?? '', /Using Hades/i);
  assert.equal(result.sessionState?.selectionState, null);
});

test('Tiger primary routes current-player prompts through discoverMomentum', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        isFree: true,
      },
      limit: 10,
      sortBy: 'ccu_peak',
      sortDirection: 'desc',
      timeframe: 'current',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: ['is_free: true', 'sort_by: ccu_peak', 'timeframe: current'],
      items: [
        {
          appid: 730,
          ccuPeak: 1825000,
          isFree: true,
          momentumScore: 98,
          name: 'Counter-Strike 2',
          platformSupport: ['windows'],
          reviewPercentage: 87,
          reviewsAdded7d: 42000,
          supportLevel: 'high',
          supportReasons: ['Peak CCU remains dominant in the latest snapshot.'],
          totalReviews: 9300000,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Peak CCU uses the latest 24-hour concurrent-player snapshot.',
      rankingLabel: 'Peak CCU',
      sufficientToAnswer: true,
      timeframe: 'current',
      timeframeLabel: 'Current snapshot',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Show free-to-play games with the most players',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Counter-Strike 2/);
  assert.ok(result.followUpSuggestions?.some((suggestion) => suggestion.query.includes('Counter-Strike 2')));
});

test('Tiger primary routes breakout prompts through discoverMomentum', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        minReviewsAdded7d: 5,
      },
      limit: 10,
      sortBy: 'momentum_score',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: 'breaking_out',
    });

    return jsonResponse({
      filtersApplied: [
        'min_reviews_added_7d: 5',
        'sort_by: momentum_score',
        'trend_type: breaking_out',
        'timeframe: 7d',
      ],
      items: [
        {
          appid: 123,
          ccuPeak: 8200,
          isFree: false,
          momentumScore: 91,
          name: 'Breakout Hit',
          platformSupport: ['windows', 'linux'],
          reviewPercentage: 90,
          reviewsAdded7d: 1800,
          supportLevel: 'high',
          supportReasons: ['Review pickup accelerated sharply over the last week.'],
          totalReviews: 22000,
          trendDirection: 'up',
          velocityAcceleration: 38,
        },
      ],
      rankingDefinition: 'Momentum score blends review pickup and CCU acceleration.',
      rankingLabel: 'Momentum Score',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What games are breaking out this week?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Breakout Hit/);
});

test('Tiger primary routes recent concept-ranking prompts through discoverMomentum', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        minReviewsAdded30d: 5,
        tags: ['Indie'],
      },
      indieHeuristic: true,
      limit: 10,
      sortBy: 'momentum_score',
      sortDirection: 'desc',
      timeframe: '30d',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: [
        'indie_heuristic: true',
        'tags: Indie',
        'min_reviews_added_30d: 5',
        'sort_by: momentum_score',
        'timeframe: 30d',
      ],
      items: [
        {
          appid: 413150,
          ccuPeak: 82541,
          isFree: false,
          momentumScore: 86,
          name: 'Stardew Valley',
          platformSupport: ['windows', 'macos', 'linux'],
          reviewPercentage: 98.5,
          reviewsAdded30d: 4200,
          supportLevel: 'high',
          supportReasons: ['Indie release with strong recent review pickup over the last month.'],
          totalReviews: 990611,
          trendDirection: 'up',
          velocityAcceleration: 18,
        },
      ],
      rankingDefinition: 'Momentum blends review pickup, acceleration, and player growth over the selected window.',
      rankingLabel: 'Momentum Score',
      sufficientToAnswer: true,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What are the top indie games of the past month?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Stardew Valley/);
});

test('Tiger primary routes review-momentum filters through discoverMomentum', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        minReviewsAdded7d: 2,
        steamDeck: ['verified'],
      },
      limit: 10,
      sortBy: 'reviews_added_7d',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: 'review_momentum',
    });

    return jsonResponse({
      filtersApplied: [
        'steam_deck: verified',
        'min_reviews_added_7d: 2',
        'sort_by: reviews_added_7d',
        'trend_type: review_momentum',
      ],
      items: [
        {
          appid: 1245620,
          ccuPeak: 21000,
          isFree: false,
          matchedSteamDeck: 'verified',
          momentumScore: 84,
          name: 'ELDEN RING NIGHTREIGN',
          platformSupport: ['windows'],
          reviewPercentage: 82,
          reviewsAdded7d: 6400,
          supportLevel: 'high',
          supportReasons: ['Review momentum is running well above the trailing baseline.'],
          totalReviews: 48000,
          trendDirection: 'up',
        },
        {
          appid: 440,
          ccuPeak: 8300,
          isFree: false,
          matchedSteamDeck: 'verified',
          momentumScore: 72,
          name: 'Deck Momentum 2',
          platformSupport: ['windows'],
          reviewPercentage: 79,
          reviewsAdded7d: 420,
          supportLevel: 'medium',
          supportReasons: ['Recent review activity remains elevated.'],
          totalReviews: 21000,
          trendDirection: 'up',
        },
        {
          appid: 620,
          ccuPeak: 6400,
          isFree: false,
          matchedSteamDeck: 'verified',
          momentumScore: 69,
          name: 'Deck Momentum 3',
          platformSupport: ['windows'],
          reviewPercentage: 81,
          reviewsAdded7d: 310,
          supportLevel: 'medium',
          supportReasons: ['Recent review activity remains above the trailing baseline.'],
          totalReviews: 18400,
          trendDirection: 'up',
        },
        {
          appid: 730,
          ccuPeak: 5100,
          isFree: true,
          matchedSteamDeck: 'verified',
          momentumScore: 66,
          name: 'Deck Momentum 4',
          platformSupport: ['windows'],
          reviewPercentage: 78,
          reviewsAdded7d: 240,
          supportLevel: 'medium',
          supportReasons: ['Review volume is still moving higher this week.'],
          totalReviews: 14200,
          trendDirection: 'up',
        },
        {
          appid: 570,
          ccuPeak: 4700,
          isFree: true,
          matchedSteamDeck: 'verified',
          momentumScore: 62,
          name: 'Deck Momentum 5',
          platformSupport: ['windows'],
          reviewPercentage: 77,
          reviewsAdded7d: 180,
          supportLevel: 'medium',
          supportReasons: ['Review pickup remains solid on the current window.'],
          totalReviews: 12300,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Review momentum highlights titles adding reviews quickly over the selected window.',
      rankingLabel: 'Reviews Added (7d)',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Show Steam Deck verified games with review momentum',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
});

test('Tiger primary routes worsening-review prompts through sentiment discovery defaults', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        maxSentimentDelta: -3,
        minReviews: 1000,
        minReviewsAdded30d: 5,
      },
      limit: 10,
      sortBy: 'sentiment_delta',
      sortDirection: 'asc',
      timeframe: '30d',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: [
        'sort_by: sentiment_delta',
        'timeframe: 30d',
        'min_reviews: 1000',
        'min_reviews_added_30d: 5',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          appid: 2668510,
          ccuPeak: 4200,
          entityUid: 'game:steam:2668510',
          isFree: false,
          name: 'Example Game',
          platformSupport: ['windows'],
          reviewPercentage: 74,
          reviewsAdded30d: 900,
          sentimentDelta: -4.2,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 4.2 points.'],
          totalReviews: 18000,
          trendDirection: 'down',
          velocityAcceleration: -28,
        },
        {
          appid: 2668511,
          ccuPeak: 3600,
          entityUid: 'game:steam:2668511',
          isFree: false,
          name: 'Example Game 2',
          platformSupport: ['windows'],
          reviewPercentage: 72,
          reviewsAdded30d: 640,
          sentimentDelta: -3.8,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 3.8 points.'],
          totalReviews: 16500,
          trendDirection: 'down',
          velocityAcceleration: -21,
        },
        {
          appid: 2668512,
          ccuPeak: 2900,
          entityUid: 'game:steam:2668512',
          isFree: false,
          name: 'Example Game 3',
          platformSupport: ['windows'],
          reviewPercentage: 71,
          reviewsAdded30d: 510,
          sentimentDelta: -3.6,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.6 points.'],
          totalReviews: 14100,
          trendDirection: 'down',
          velocityAcceleration: -18,
        },
        {
          appid: 2668513,
          ccuPeak: 2400,
          entityUid: 'game:steam:2668513',
          isFree: false,
          name: 'Example Game 4',
          platformSupport: ['windows'],
          reviewPercentage: 70,
          reviewsAdded30d: 460,
          sentimentDelta: -3.3,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.3 points.'],
          totalReviews: 12800,
          trendDirection: 'down',
          velocityAcceleration: -15,
        },
        {
          appid: 2668514,
          ccuPeak: 2100,
          entityUid: 'game:steam:2668514',
          isFree: false,
          name: 'Example Game 5',
          platformSupport: ['windows'],
          reviewPercentage: 69,
          reviewsAdded30d: 410,
          sentimentDelta: -3.1,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.1 points.'],
          totalReviews: 11800,
          trendDirection: 'down',
          velocityAcceleration: -12,
        },
      ],
      rankingDefinition: 'Sentiment delta measures the change in positive-review rate versus the trailing 30-day baseline.',
      rankingLabel: 'Sentiment Delta',
      sortBy: 'sentiment_delta',
      sortDirection: 'asc',
      sufficientToAnswer: true,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Which popular games are getting worse reviews lately?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /review sentiment decline/i);
  assert.equal(result.contractResult?.contractName, 'discoverMomentum');
  assert.equal(result.sessionState?.requestState?.momentumPromptFamily, 'review_sentiment_down');
});

test('Tiger primary relaxes broad review-sentiment defaults when the user narrows to indie', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        maxSentimentDelta: -3,
        minReviews: 1000,
        minReviewsAdded30d: 5,
      },
      indieHeuristic: true,
      limit: 10,
      sortBy: 'sentiment_delta',
      sortDirection: 'asc',
      timeframe: '30d',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: [
        'sort_by: sentiment_delta',
        'timeframe: 30d',
        'indie_heuristic: true',
        'min_reviews: 1000',
        'min_reviews_added_30d: 5',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          appid: 2668510,
          ccuPeak: 4200,
          isFree: false,
          name: 'Example Indie',
          platformSupport: ['windows'],
          reviewPercentage: 74,
          reviewsAdded30d: 120,
          sentimentDelta: -4.2,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 4.2 points.'],
          totalReviews: 4200,
          trendDirection: 'down',
          velocityAcceleration: -28,
        },
        {
          appid: 2668511,
          ccuPeak: 3100,
          isFree: false,
          name: 'Example Indie 2',
          platformSupport: ['windows'],
          reviewPercentage: 73,
          reviewsAdded30d: 98,
          sentimentDelta: -3.9,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 3.9 points.'],
          totalReviews: 3900,
          trendDirection: 'down',
          velocityAcceleration: -22,
        },
        {
          appid: 2668512,
          ccuPeak: 2600,
          isFree: false,
          name: 'Example Indie 3',
          platformSupport: ['windows'],
          reviewPercentage: 72,
          reviewsAdded30d: 84,
          sentimentDelta: -3.7,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.7 points.'],
          totalReviews: 3600,
          trendDirection: 'down',
          velocityAcceleration: -19,
        },
        {
          appid: 2668513,
          ccuPeak: 2300,
          isFree: false,
          name: 'Example Indie 4',
          platformSupport: ['windows'],
          reviewPercentage: 71,
          reviewsAdded30d: 76,
          sentimentDelta: -3.5,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.5 points.'],
          totalReviews: 3300,
          trendDirection: 'down',
          velocityAcceleration: -17,
        },
        {
          appid: 2668514,
          ccuPeak: 2100,
          isFree: false,
          name: 'Example Indie 5',
          platformSupport: ['windows'],
          reviewPercentage: 70,
          reviewsAdded30d: 69,
          sentimentDelta: -3.2,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.2 points.'],
          totalReviews: 3050,
          trendDirection: 'down',
          velocityAcceleration: -14,
        },
      ],
      rankingDefinition: 'Sentiment delta measures the change in positive-review rate versus the trailing 30-day baseline.',
      rankingLabel: 'Sentiment Delta',
      sortBy: 'sentiment_delta',
      sortDirection: 'asc',
      sufficientToAnswer: true,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Which popular indie games are getting worse reviews lately?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.sessionState?.requestState?.momentumPromptFamily, 'review_sentiment_down');
});

test('Tiger primary routes review-activity prompts through review-momentum semantics', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        minReviews: 1000,
        minReviewsAdded7d: 5,
      },
      limit: 10,
      sortBy: 'reviews_added_7d',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: 'review_momentum',
    });

    return jsonResponse({
      filtersApplied: [
        'sort_by: reviews_added_7d',
        'timeframe: 7d',
        'trend_type: review_momentum',
        'min_reviews: 1000',
        'min_reviews_added_7d: 5',
      ],
      items: [
        {
          appid: 1245620,
          ccuPeak: 21000,
          isFree: false,
          name: 'Momentum Game',
          platformSupport: ['windows'],
          reviewPercentage: 82,
          reviewsAdded7d: 6400,
          supportLevel: 'high',
          supportReasons: ['Review momentum is running well above the trailing baseline.'],
          totalReviews: 48000,
          trendDirection: 'up',
        },
        {
          appid: 440,
          ccuPeak: 8200,
          isFree: false,
          name: 'Momentum Game 2',
          platformSupport: ['windows'],
          reviewPercentage: 78,
          reviewsAdded7d: 950,
          supportLevel: 'high',
          supportReasons: ['Review momentum is running ahead of the trailing baseline.'],
          totalReviews: 15000,
          trendDirection: 'up',
        },
        {
          appid: 620,
          ccuPeak: 6400,
          isFree: false,
          name: 'Momentum Game 3',
          platformSupport: ['windows'],
          reviewPercentage: 84,
          reviewsAdded7d: 720,
          supportLevel: 'medium',
          supportReasons: ['Review activity remains elevated this week.'],
          totalReviews: 9400,
          trendDirection: 'up',
        },
        {
          appid: 730,
          ccuPeak: 5100,
          isFree: true,
          name: 'Momentum Game 4',
          platformSupport: ['windows'],
          reviewPercentage: 80,
          reviewsAdded7d: 540,
          supportLevel: 'medium',
          supportReasons: ['Review activity remains elevated versus the trailing baseline.'],
          totalReviews: 12400,
          trendDirection: 'up',
        },
        {
          appid: 570,
          ccuPeak: 4700,
          isFree: true,
          name: 'Momentum Game 5',
          platformSupport: ['windows'],
          reviewPercentage: 79,
          reviewsAdded7d: 410,
          supportLevel: 'medium',
          supportReasons: ['Recent review volume remains above the recent baseline.'],
          totalReviews: 11300,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Review momentum highlights titles adding reviews quickly over the selected window.',
      rankingLabel: 'Reviews Added (7d)',
      sortBy: 'reviews_added_7d',
      sortDirection: 'desc',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: 'review_momentum',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What games are trending up in reviews right now?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.sessionState?.requestState?.momentumPromptFamily, 'review_activity_up');
});

test('Tiger primary broadens low-count review-activity discovery and explains the shortfall', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let callCount = 0;
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);

    callCount += 1;
    if (callCount === 1) {
      assert.deepEqual(JSON.parse(String(init.body)), {
        filters: {
          minReviews: 1000,
          minReviewsAdded7d: 5,
        },
        limit: 10,
        sortBy: 'reviews_added_7d',
        sortDirection: 'desc',
        timeframe: '7d',
        trendType: 'review_momentum',
      });

      return jsonResponse({
        filtersApplied: [
          'sort_by: reviews_added_7d',
          'timeframe: 7d',
          'trend_type: review_momentum',
          'min_reviews: 1000',
          'min_reviews_added_7d: 5',
        ],
        items: [
          {
            appid: 1245620,
            ccuPeak: 923,
            entityUid: 'game:steam:1245620',
            isFree: false,
            name: 'Assassin’s Creed IV Black Flag',
            platformSupport: ['windows'],
            reviewPercentage: 88.4,
            reviewsAdded7d: 25,
            supportLevel: 'high',
            supportReasons: ['25 reviews added over 7d.'],
            totalReviews: 76582,
            trendDirection: 'up',
          },
        ],
        rankingDefinition: 'Reviews added (7d) counts net new reviews in the last 7 days.',
        rankingLabel: 'Reviews Added (7d)',
        sortBy: 'reviews_added_7d',
        sortDirection: 'desc',
        sufficientToAnswer: true,
        timeframe: '7d',
        timeframeLabel: 'Last 7 days',
        trendType: 'review_momentum',
      });
    }

    assert.equal(callCount, 2);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        minReviews: 250,
        minReviewsAdded7d: 2,
      },
      limit: 10,
      sortBy: 'reviews_added_7d',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: 'review_momentum',
    });

    return jsonResponse({
      filtersApplied: [
        'sort_by: reviews_added_7d',
        'timeframe: 7d',
        'trend_type: review_momentum',
        'min_reviews: 250',
        'min_reviews_added_7d: 2',
      ],
      items: [
        {
          appid: 1245620,
          ccuPeak: 923,
          entityUid: 'game:steam:1245620',
          isFree: false,
          name: 'Assassin’s Creed IV Black Flag',
          platformSupport: ['windows'],
          reviewPercentage: 88.4,
          reviewsAdded7d: 25,
          supportLevel: 'high',
          supportReasons: ['25 reviews added over 7d.'],
          totalReviews: 76582,
          trendDirection: 'up',
        },
        {
          appid: 777777,
          ccuPeak: 612,
          entityUid: 'game:steam:777777',
          isFree: false,
          name: 'Momentum Game 2',
          platformSupport: ['windows'],
          reviewPercentage: 84.1,
          reviewsAdded7d: 11,
          supportLevel: 'medium',
          supportReasons: ['11 reviews added over 7d.'],
          totalReviews: 9420,
          trendDirection: 'up',
        },
        {
          appid: 888888,
          ccuPeak: 481,
          entityUid: 'game:steam:888888',
          isFree: false,
          name: 'Momentum Game 3',
          platformSupport: ['windows'],
          reviewPercentage: 81.2,
          reviewsAdded7d: 7,
          supportLevel: 'medium',
          supportReasons: ['7 reviews added over 7d.'],
          totalReviews: 5120,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Reviews added (7d) counts net new reviews in the last 7 days.',
      rankingLabel: 'Reviews Added (7d)',
      sortBy: 'reviews_added_7d',
      sortDirection: 'desc',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: 'review_momentum',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What games are trending up in reviews right now?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(callCount, 2);
  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.status, 'skipped');
  assert.equal(result.info.attempts[1]?.status, 'success');
  assert.match(result.renderedText ?? '', /Only 3 titles qualified even after relaxing the default popularity floor/i);
  assert.deepEqual(result.sessionState?.requestState?.canonicalArgs, {
    filters: {
      minReviews: 250,
      minReviewsAdded7d: 2,
    },
    limit: 10,
    sortBy: 'reviews_added_7d',
    sortDirection: 'desc',
    timeframe: '7d',
    trendType: 'review_momentum',
  });
  assert.equal(result.sessionState?.requestState?.momentumPromptFamily, 'review_activity_up');
});

test('Tiger primary composes similarity seeds with momentum discovery for mixed similarity-plus-momentum prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  const paths: string[] = [];
  setScopedFetch(t, async (url, init) => {
    paths.push(url.pathname);

    if (url.pathname === '/v1/contracts/semantic-search') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body)) as {
        mode?: string;
        referenceQuery?: string;
      };
      assert.equal(body.mode, 'similarity');
      assert.equal(body.referenceQuery, 'Hades');

      return jsonResponse({
        reference: {
          id: 1145360,
          name: 'Hades',
          type: 'game',
        },
        results: [
          { id: 632360, matchReasons: ['Roguelite'], name: 'Risk of Rain 2', score: 92 },
          { id: 1794680, matchReasons: ['Action Roguelike'], name: 'Vampire Survivors', score: 88 },
        ],
        sufficient_to_answer: true,
      });
    }

    if (url.pathname === '/v1/contracts/discover-momentum') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body)) as {
        appids?: number[];
        trendType?: string | null;
      };
      assert.deepEqual(body.appids, [632360, 1794680]);
      assert.equal(body.trendType, 'breaking_out');

      return jsonResponse({
        filtersApplied: ['sort_by: momentum_score', 'timeframe: 7d'],
        items: [
          {
            appid: 632360,
            ccuPeak: 118000,
            isFree: false,
            name: 'Risk of Rain 2',
            platformSupport: ['windows'],
            reviewPercentage: 94,
            reviewsAdded30d: 1500,
            reviewsAdded7d: 420,
            supportLevel: 'high',
            supportReasons: ['Recent review pickup and player traction both accelerated.'],
            totalReviews: 220000,
            trendDirection: 'up',
            velocityAcceleration: 18,
          },
        ],
        rankingDefinition: 'Momentum score blends review velocity and player traction.',
        rankingLabel: 'Momentum Score',
        sufficientToAnswer: true,
        timeframe: '7d',
        timeframeLabel: 'Last 7 days',
        trendType: 'breaking_out',
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Games like Hades that are breaking out this week',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.deepEqual(paths, ['/v1/contracts/semantic-search', '/v1/contracts/discover-momentum']);
  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'discoverMomentum');
  assert.match(result.renderedText ?? '', /similar to \*\*Hades\*\*/);
});

for (const prompt of [
  'Compare FromSoftware and Team Cherry by reviews',
  'Compare FromSoftware to Team Cherry by reviews',
  'How do FromSoftware and Team Cherry stack up on reviews?',
]) {
  test(`Tiger primary routes explicit compare prompts through Tiger compareEntities: ${prompt}`, async (t) => {
    setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
    setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
    const resolutionBodiesByQuery = new Map<string, Array<Record<string, unknown>>>();

    setScopedFetch(t, async (url, init) => {
      if (url.pathname === '/v1/contracts/resolve-entities') {
        assert.ok(init?.body);
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const recordedBodies = resolutionBodiesByQuery.get(String(body.query)) ?? [];
        recordedBodies.push(body);
        resolutionBodiesByQuery.set(String(body.query), recordedBodies);
        const entityKinds = Array.isArray(body.entityKinds) ? body.entityKinds : [];

        if (entityKinds.length === 1 && entityKinds[0] === 'game') {
          return jsonResponse({
            ambiguity: {
              requiresClarification: false,
            },
            entities: [],
          });
        }

        if (body.query === 'FromSoftware') {
          return jsonResponse({
            ambiguity: {
              requiresClarification: false,
            },
            entities: [
              {
                confidence: 0.99,
                displayName: 'FromSoftware',
                entityKind: 'developer',
                entityUid: 'developer:publisheriq:285932',
                platform: 'publisheriq',
                platformEntityId: '285932',
                signals: {
                  gameCount: 1,
                },
              },
              {
                confidence: 0.92,
                displayName: 'FromSoftware, Inc.',
                entityKind: 'developer',
                entityUid: 'developer:publisheriq:3005',
                platform: 'publisheriq',
                platformEntityId: '3005',
                signals: {
                  gameCount: 12,
                },
              },
            ],
          });
        }

        if (body.query === 'Team Cherry') {
          return jsonResponse({
            ambiguity: {
              requiresClarification: false,
            },
            entities: [
              {
                confidence: 0.98,
                displayName: 'Team Cherry',
                entityKind: 'publisher',
                entityUid: 'publisher:publisheriq:2963',
                platform: 'publisheriq',
                platformEntityId: '2963',
                signals: {
                  gameCount: 2,
                },
              },
              {
                confidence: 0.98,
                displayName: 'Team Cherry',
                entityKind: 'developer',
                entityUid: 'developer:publisheriq:3019',
                platform: 'publisheriq',
                platformEntityId: '3019',
                signals: {
                  gameCount: 2,
                },
              },
            ],
          });
        }
      }

      assert.equal(url.pathname, '/v1/contracts/compare-entities');
      assert.ok(init?.body);
      assert.deepEqual(JSON.parse(String(init.body)), {
        entityUids: ['developer:publisheriq:3005', 'developer:publisheriq:3019'],
        metrics: ['total_reviews'],
      });

      return jsonResponse({
        entityKind: 'developer',
        highlights: [
          {
            displayName: 'FromSoftware',
            entityUid: 'developer:publisheriq:3005',
            metric: 'total_reviews',
            value: 600000,
          },
        ],
        items: [
          {
            displayName: 'FromSoftware',
            entityKind: 'developer',
            entityUid: 'developer:publisheriq:3005',
            metrics: {
              ccuPeak: 12000,
              gameCount: 7,
              ownersMidpoint: 4000000,
              reviewScore: 94,
              totalReviews: 600000,
            },
            platformEntityId: '3005',
          },
          {
            displayName: 'Team Cherry',
            entityKind: 'developer',
            entityUid: 'developer:publisheriq:3006',
            metrics: {
              ccuPeak: 8000,
              gameCount: 2,
              ownersMidpoint: 2500000,
              reviewScore: 96,
              totalReviews: 380000,
            },
            platformEntityId: '3006',
          },
        ],
        metrics: ['total_reviews'],
        platform: 'publisheriq',
        sufficientToAnswer: true,
      });
    });

    const result = await runTigerPrimaryEvaluation({
      isEvalRequest: true,
      prompt,
      sessionContext: null,
      userId: 'user-1',
    });

    assert.equal(result.info.matchedIntent, 'entity_compare');
    assert.equal(result.info.route, 'primary_success');
    assert.equal(result.contractResult?.contractName, 'compareEntities');
    assert.match(result.renderedText ?? '', /FromSoftware/);
    assert.match(result.renderedText ?? '', /Team Cherry/);
    assert.match(result.renderedText ?? '', /Total Reviews/);
    assert.deepEqual(resolutionBodiesByQuery.get('FromSoftware'), [
      {
        entityKinds: ['publisher', 'developer', 'game'],
        includeMetrics: false,
        limit: 6,
        query: 'FromSoftware',
        resolutionMode: 'autocomplete',
        resolutionPreference: 'company',
      },
    ]);
    assert.deepEqual(resolutionBodiesByQuery.get('Team Cherry'), [
      {
        entityKinds: ['publisher', 'developer', 'game'],
        includeMetrics: false,
        limit: 6,
        query: 'Team Cherry',
        resolutionMode: 'autocomplete',
        resolutionPreference: 'company',
      },
    ]);
  });
}

test('Tiger primary retries transient compare failures once before returning the Tiger comparison', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let compareCallCount = 0;
  const resolutionBodiesByQuery = new Map<string, Array<Record<string, unknown>>>();

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      const recordedBodies = resolutionBodiesByQuery.get(String(body.query)) ?? [];
      recordedBodies.push(body);
      resolutionBodiesByQuery.set(String(body.query), recordedBodies);

      if (body.query === 'Hades') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Hades',
              entityKind: 'game',
              entityUid: 'game:steam:1145360',
              platform: 'steam',
              platformEntityId: '1145360',
            },
          ],
        });
      }

      if (body.query === 'Dead Cells') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Dead Cells',
              entityKind: 'game',
              entityUid: 'game:steam:588650',
              platform: 'steam',
              platformEntityId: '588650',
            },
          ],
        });
      }
    }

    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.deepEqual(body, {
      entityUids: ['game:steam:1145360', 'game:steam:588650'],
      metrics: ['total_reviews'],
    });

    compareCallCount += 1;
    if (compareCallCount === 1) {
      return jsonResponse({
        error: 'Internal Server Error',
      }, 503);
    }

    return jsonResponse({
      entityKind: 'game',
      highlights: [
        {
          displayName: 'Hades',
          entityUid: 'game:steam:1145360',
          metric: 'total_reviews',
          value: 250000,
        },
      ],
      items: [
        {
          displayName: 'Hades',
          entityKind: 'game',
          entityUid: 'game:steam:1145360',
          metrics: {
            ccuPeak: 38000,
            gameCount: null,
            ownersMidpoint: 4500000,
            reviewScore: 98,
            totalReviews: 250000,
          },
          platform: 'steam',
          platformEntityId: '1145360',
        },
        {
          displayName: 'Dead Cells',
          entityKind: 'game',
          entityUid: 'game:steam:588650',
          metrics: {
            ccuPeak: 12000,
            gameCount: null,
            ownersMidpoint: 3200000,
            reviewScore: 97,
            totalReviews: 140000,
          },
          platform: 'steam',
          platformEntityId: '588650',
        },
      ],
      metrics: ['total_reviews'],
      platform: 'steam',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare Hades and Dead Cells by reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  const compareAttempts = result.info.attempts.filter((attempt) => attempt.contractName === 'compareEntities');

  assert.equal(compareCallCount, 2);
  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'compareEntities');
  assert.deepEqual(compareAttempts.map((attempt) => attempt.status), ['error', 'success']);
  assert.match(result.renderedText ?? '', /Hades/);
  assert.match(result.renderedText ?? '', /Dead Cells/);
  assert.match(result.renderedText ?? '', /Total Reviews/);
  assert.deepEqual(resolutionBodiesByQuery.get('Hades'), [
    {
      entityKinds: ['game'],
      includeMetrics: false,
      limit: 25,
      query: 'Hades',
      resolutionMode: 'chat_strict',
      resolutionPreference: null,
    },
  ]);
  assert.deepEqual(resolutionBodiesByQuery.get('Dead Cells'), [
    {
      entityKinds: ['game'],
      includeMetrics: false,
      limit: 25,
      query: 'Dead Cells',
      resolutionMode: 'chat_strict',
      resolutionPreference: null,
    },
  ]);
});

test('Tiger primary resolves explicit Marathon comparisons through the strict game resolver before compareEntities', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  const resolutionBodiesByQuery = new Map<string, Array<Record<string, unknown>>>();

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      const recordedBodies = resolutionBodiesByQuery.get(String(body.query)) ?? [];
      recordedBodies.push(body);
      resolutionBodiesByQuery.set(String(body.query), recordedBodies);

      if (body.query === 'Marathon') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Marathon',
              entityKind: 'game',
              entityUid: 'game:steam:3065800',
              platform: 'steam',
              platformEntityId: '3065800',
            },
          ],
        });
      }

      if (body.query === 'Destiny 2') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Destiny 2',
              entityKind: 'game',
              entityUid: 'game:steam:1085660',
              platform: 'steam',
              platformEntityId: '1085660',
            },
          ],
        });
      }
    }

    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.deepEqual(body, {
      entityUids: ['game:steam:3065800', 'game:steam:1085660'],
    });

    return jsonResponse({
      entityKind: 'game',
      highlights: [
        {
          displayName: 'Destiny 2',
          entityUid: 'game:steam:1085660',
          metric: 'total_reviews',
          value: 645091,
        },
      ],
      items: [
        {
          displayName: 'Marathon',
          entityKind: 'game',
          entityUid: 'game:steam:3065800',
          metrics: {
            ccuPeak: 27817,
            gameCount: null,
            ownersMidpoint: 10000,
            reviewScore: 86.3,
            totalReviews: 42501,
          },
          platform: 'steam',
          platformEntityId: '3065800',
        },
        {
          displayName: 'Destiny 2',
          entityKind: 'game',
          entityUid: 'game:steam:1085660',
          metrics: {
            ccuPeak: 24619,
            gameCount: null,
            ownersMidpoint: 35000000,
            reviewScore: 77.3,
            totalReviews: 645091,
          },
          platform: 'steam',
          platformEntityId: '1085660',
        },
      ],
      metrics: ['total_reviews'],
      platform: 'steam',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'compare Marathon to Destiny 2',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'compareEntities');
  assert.match(result.renderedText ?? '', /Marathon/);
  assert.match(result.renderedText ?? '', /Destiny 2/);
  assert.deepEqual(resolutionBodiesByQuery.get('Marathon'), [
    {
      entityKinds: ['game'],
      includeMetrics: false,
      limit: 25,
      query: 'Marathon',
      resolutionMode: 'chat_strict',
      resolutionPreference: null,
    },
  ]);
  assert.deepEqual(resolutionBodiesByQuery.get('Destiny 2'), [
    {
      entityKinds: ['game'],
      includeMetrics: false,
      limit: 25,
      query: 'Destiny 2',
      resolutionMode: 'chat_strict',
      resolutionPreference: null,
    },
  ]);
});

test('Tiger primary does not retry compare when Tiger reports the contract runtime is blocked', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let compareCallCount = 0;

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      if (body.query === 'Hades') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Hades',
              entityKind: 'game',
              entityUid: 'game:steam:1145360',
              platform: 'steam',
              platformEntityId: '1145360',
            },
          ],
        });
      }

      if (body.query === 'Dead Cells') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Dead Cells',
              entityKind: 'game',
              entityUid: 'game:steam:588650',
              platform: 'steam',
              platformEntityId: '588650',
            },
          ],
        });
      }
    }

    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.deepEqual(body, {
      entityUids: ['game:steam:1145360', 'game:steam:588650'],
      metrics: ['total_reviews'],
    });

    compareCallCount += 1;

    return jsonResponse({
      blockingTables: ['legacy.publishers'],
      code: 'CONTRACT_RUNTIME_UNAVAILABLE',
      error: 'compareEntities is not ready on tiger until the required tables are present and backfilled.',
    }, 503);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare Hades and Dead Cells by reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  const compareAttempts = result.info.attempts.filter((attempt) => attempt.contractName === 'compareEntities');

  assert.equal(compareCallCount, 1);
  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult, null);
  assert.deepEqual(compareAttempts.map((attempt) => attempt.status), ['error']);
  assert.match(result.renderedText ?? '', /current structured data yet/i);
  assert.match(result.renderedText ?? '', /compare surface is not fully ready/i);
});

test('Tiger primary returns compare-specific Tiger copy after the transient retry also fails', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let compareCallCount = 0;

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      if (body.query === 'Hades') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Hades',
              entityKind: 'game',
              entityUid: 'game:steam:1145360',
              platform: 'steam',
              platformEntityId: '1145360',
            },
          ],
        });
      }

      if (body.query === 'Dead Cells') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.99,
              displayName: 'Dead Cells',
              entityKind: 'game',
              entityUid: 'game:steam:588650',
              platform: 'steam',
              platformEntityId: '588650',
            },
          ],
        });
      }
    }

    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.deepEqual(body, {
      entityUids: ['game:steam:1145360', 'game:steam:588650'],
      metrics: ['total_reviews'],
    });

    compareCallCount += 1;

    return jsonResponse({
      error: 'Internal Server Error',
    }, 503);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare Hades and Dead Cells by reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  const compareAttempts = result.info.attempts.filter((attempt) => attempt.contractName === 'compareEntities');

  assert.equal(compareCallCount, 2);
  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult, null);
  assert.deepEqual(compareAttempts.map((attempt) => attempt.status), ['error', 'error']);
  assert.match(result.renderedText ?? '', /complete that comparison from PublisherIQ data right now/i);
  assert.doesNotMatch(result.renderedText ?? '', /structured lookup right now/i);
});

test('Tiger primary routes compare follow-ups through compareEntities using the carried candidate set', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityUids: [
        'd58d0f16-7f35-5ca8-b5f5-0f4d6e86e9e5',
        '727bceb0-35f2-530c-8b9a-a6af5f7ae7a6',
        '53f92ec8-c2a1-5f35-99d0-e6f1c309dd4f',
      ],
      metrics: ['total_reviews'],
    });

    return jsonResponse({
      entityKind: 'game',
      highlights: [
        {
          displayName: 'Hades',
          entityUid: 'd58d0f16-7f35-5ca8-b5f5-0f4d6e86e9e5',
          metric: 'total_reviews',
          value: 250000,
        },
      ],
      items: [
        {
          displayName: 'Hades',
          entityKind: 'game',
          entityUid: 'd58d0f16-7f35-5ca8-b5f5-0f4d6e86e9e5',
          metrics: {
            ccuPeak: 38000,
            gameCount: null,
            ownersMidpoint: 4500000,
            reviewScore: 98,
            totalReviews: 250000,
          },
          platform: 'steam',
          platformEntityId: '1145360',
        },
        {
          displayName: 'Dead Cells',
          entityKind: 'game',
          entityUid: '727bceb0-35f2-530c-8b9a-a6af5f7ae7a6',
          metrics: {
            ccuPeak: 12000,
            gameCount: null,
            ownersMidpoint: 3200000,
            reviewScore: 97,
            totalReviews: 140000,
          },
          platform: 'steam',
          platformEntityId: '588650',
        },
        {
          displayName: 'Risk of Rain 2',
          entityKind: 'game',
          entityUid: '53f92ec8-c2a1-5f35-99d0-e6f1c309dd4f',
          metrics: {
            ccuPeak: 54000,
            gameCount: null,
            ownersMidpoint: 5100000,
            reviewScore: 94,
            totalReviews: 180000,
          },
          platform: 'steam',
          platformEntityId: '632360',
        },
      ],
      metrics: ['total_reviews'],
      platform: 'steam',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare those by reviews',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      candidateSet: {
        entityUids: [
          'd58d0f16-7f35-5ca8-b5f5-0f4d6e86e9e5',
          '727bceb0-35f2-530c-8b9a-a6af5f7ae7a6',
          '53f92ec8-c2a1-5f35-99d0-e6f1c309dd4f',
        ],
        ids: [1145360, 588650, 632360],
        kind: 'games',
        names: ['Hades', 'Dead Cells', 'Risk of Rain 2'],
        sourceTool: 'search_games',
      },
      lastAnswer: {
        summary: 'Compared the carried game set.',
      },
      resultSet: null,
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'compareEntities');
  assert.match(result.renderedText ?? '', /Hades/);
  assert.match(result.renderedText ?? '', /Total Reviews/);
});

test('Tiger primary prefers company candidates over fuzzy game matches for organization-like compare prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let resolveCalls = 0;
  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      resolveCalls += 1;
      assert.equal(body.resolutionMode, 'autocomplete');
      assert.equal(body.resolutionPreference, 'company');
      assert.deepEqual(body.entityKinds, ['publisher', 'developer', 'game']);

      if (body.query === 'FromSoftware') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.72,
              displayName: 'Freed Software',
              entityKind: 'game',
              entityUid: 'game:steam:111',
              matchQuality: 'fuzzy',
              platform: 'steam',
              platformEntityId: '111',
            },
            {
              confidence: 0.72,
              displayName: 'FromSoftware',
              entityKind: 'developer',
              entityUid: 'developer:publisheriq:285932',
              matchQuality: 'fuzzy',
              platform: 'publisheriq',
              platformEntityId: '285932',
              signals: {
                gameCount: 12,
              },
            },
            {
              confidence: 0.72,
              displayName: 'FromSoftware, Inc.',
              entityKind: 'publisher',
              entityUid: 'publisher:publisheriq:3005',
              matchQuality: 'fuzzy',
              platform: 'publisheriq',
              platformEntityId: '3005',
              signals: {
                gameCount: 12,
              },
            },
          ],
        });
      }

      if (body.query === 'Rockstar Games') {
        return jsonResponse({
          ambiguity: {
            requiresClarification: false,
          },
          entities: [
            {
              confidence: 0.72,
              displayName: 'Rockstar Life',
              entityKind: 'game',
              entityUid: 'game:steam:222',
              matchQuality: 'fuzzy',
              platform: 'steam',
              platformEntityId: '222',
            },
            {
              confidence: 0.99,
              displayName: 'Rockstar Games',
              entityKind: 'developer',
              entityUid: 'developer:publisheriq:4001',
              matchQuality: 'exact',
              platform: 'publisheriq',
              platformEntityId: '4001',
              signals: {
                gameCount: 18,
              },
            },
            {
              confidence: 0.95,
              displayName: 'Rockstar Games',
              entityKind: 'publisher',
              entityUid: 'publisher:publisheriq:4002',
              matchQuality: 'exact',
              platform: 'publisheriq',
              platformEntityId: '4002',
              signals: {
                gameCount: 18,
              },
            },
          ],
        });
      }
    }

    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.deepEqual(body, {
      entityUids: ['developer:publisheriq:285932', 'developer:publisheriq:4001'],
      metrics: ['total_reviews'],
    });

    return jsonResponse({
      entityKind: 'developer',
      highlights: [
        {
          displayName: 'Rockstar Games',
          entityUid: 'developer:publisheriq:4001',
          metric: 'total_reviews',
          value: 2400000,
        },
      ],
      items: [
        {
          displayName: 'FromSoftware',
          entityKind: 'developer',
          entityUid: 'developer:publisheriq:285932',
          metrics: {
            ccuPeak: 12000,
            gameCount: 12,
            ownersMidpoint: 4000000,
            reviewScore: 94,
            totalReviews: 600000,
          },
          platformEntityId: '285932',
        },
        {
          displayName: 'Rockstar Games',
          entityKind: 'developer',
          entityUid: 'developer:publisheriq:4001',
          metrics: {
            ccuPeak: 64000,
            gameCount: 18,
            ownersMidpoint: 12000000,
            reviewScore: 91,
            totalReviews: 2400000,
          },
          platformEntityId: '4001',
        },
      ],
      metrics: ['total_reviews'],
      platform: 'publisheriq',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'compare FromSoftwere to Rockstar Games by reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'compareEntities');
  assert.match(result.renderedText ?? '', /FromSoftware/);
  assert.match(result.renderedText ?? '', /Rockstar Games/);
  assert.equal(resolveCalls, 2);
});

test('Tiger primary reuses the prior family for "what about" single-entity follow-ups', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'DVD Survivors');
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'DVD Survivors',
            entityKind: 'game',
            entityUid: 'game:steam:9876',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '9876',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/explain-changes');
    assert.deepEqual(body, {
      entityUid: 'game:steam:9876',
      includeNews: true,
      limit: 10,
    });

    return jsonResponse({
      moments: [
        {
          changeTypes: ['build'],
          eventCount: 1,
          events: [],
          linkedNews: [],
          sources: ['steam'],
          windowStart: '2026-03-28T00:00:00.000Z',
        },
      ],
      sufficientToAnswer: true,
      summary: {
        eventCount: 1,
      },
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what about DVD Survivors',
    sessionContext: {
      version: 1,
      entities: [{
        kind: 'game',
        name: 'Hades II',
        id: 'game:steam:1145350',
        sourceTool: 'tigerPrimarySelection',
      }],
      constraints: [],
      lastAnswer: {
        family: 'change_explanation',
        summary: 'Tiger answered change_explanation.',
      },
      selectionState: {
        family: 'change_explanation',
        slots: [{
          candidates: [{
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'game:steam:1145350',
            matchQuality: 'exact',
            ordinal: 1,
            platform: 'steam',
            platformEntityId: '1145350',
            score: 108,
          }],
          label: 'Hades II',
          query: 'Hades II',
          requiresClarification: false,
          selectedEntityUid: 'game:steam:1145350',
          slotId: 'primary',
        }],
      },
      resultSet: null,
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'change_explanation');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /DVD Survivors/);
});

test('Tiger primary reuses a bound request selection for single-entity overview prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let getEntityOverviewCalls = 0;
  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.fail(`expected request binding reuse, but resolve-entities was called with ${JSON.stringify(body)}`);
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    getEntityOverviewCalls += 1;
    assert.deepEqual(body, {
      entityKind: 'game',
      entityUid: 'game:steam:3321460',
      gamesLimit: 0,
      gamesSortBy: 'release_date',
      platformEntityId: '3321460',
    });

    return jsonResponse({
      entity: {
        details: {
          developers: ['Pearl Abyss'],
          platforms: ['windows', 'macos'],
          priceCents: 6999,
          publishers: ['Pearl Abyss'],
          releaseDate: '2026-03-19',
          releaseState: 'released',
          releaseYear: 2026,
        },
        displayName: 'Crimson Desert',
        entityKind: 'game',
        metrics: {
          ccuPeak: 16701,
          gameCount: null,
          ownersMidpoint: 10000,
          reviewScore: 83.4,
          totalReviews: 16572,
        },
        platformEntityId: '3321460',
      },
      games: [],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'show Crimson Desert ccu',
    sessionContext: {
      version: 1,
      entities: [{
        kind: 'game',
        name: 'Crimson Desert',
        id: 'game:steam:3321460',
        platform: 'steam',
        platformEntityId: '3321460',
        sourceTool: 'tigerPrimarySelection',
      }],
      constraints: [],
      candidateSet: null,
      requestState: null,
      selectionState: {
        family: 'request_binding',
        slots: [{
          candidates: [{
            displayName: 'Crimson Desert',
            entityKind: 'game',
            entityUid: 'game:steam:3321460',
            matchQuality: 'exact',
            ordinal: 1,
            platform: 'steam',
            platformEntityId: '3321460',
            score: 100,
          }],
          expectedEntityKind: 'game',
          label: 'Crimson Desert',
          query: 'Crimson Desert',
          requiresClarification: false,
          selectedEntityUid: 'game:steam:3321460',
          slotId: 'bound-1',
        }],
      },
      resultSet: null,
      lastAnswer: {
        family: 'entity_overview',
        summary: 'Tiger answered entity_overview.',
      },
      updatedAt: '2026-04-09T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(getEntityOverviewCalls, 1);
  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.reason, 'Reused the current entity selection from session context.');
  assert.equal(result.contractResult?.contractName, 'getEntityOverview');
  assert.match(result.renderedText ?? '', /Crimson Desert/);
});

test('Tiger primary reuses a bound request selection for metric history prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.fail(`expected request binding reuse, but resolve-entities was called with ${JSON.stringify(body)}`);
    }

    assert.equal(url.pathname, '/v1/contracts/trace-metric-history');
    assert.equal(body.entityUid, 'game:steam:3321460');
    assert.deepEqual(body.metrics, ['ccu_peak']);
    assert.equal(typeof body.startDate, 'string');
    assert.equal(typeof body.endDate, 'string');

    return jsonResponse({
      endDate: body.endDate,
      entity: {
        displayName: 'Crimson Desert',
        entityKind: 'game',
        entityUid: 'game:steam:3321460',
        platform: 'steam',
        platformEntityId: '3321460',
      },
      metrics: ['ccu_peak'],
      series: [
        {
          metric: 'ccu_peak',
          points: [
            { date: body.startDate, value: 12000 },
            { date: body.endDate, value: 16701 },
          ],
          summary: {
            deltaAbs: 4701,
            deltaPct: 39.18,
            firstDate: body.startDate,
            lastDate: body.endDate,
            latestValue: 16701,
            pointCount: 2,
            startValue: 12000,
          },
        },
      ],
      startDate: body.startDate,
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'show Crimson Desert ccu over the last 30 days',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      candidateSet: null,
      requestState: null,
      selectionState: {
        family: 'request_binding',
        slots: [{
          candidates: [{
            displayName: 'Crimson Desert',
            entityKind: 'game',
            entityUid: 'game:steam:3321460',
            matchQuality: 'exact',
            ordinal: 1,
            platform: 'steam',
            platformEntityId: '3321460',
            score: 100,
          }],
          expectedEntityKind: 'game',
          label: 'Crimson Desert',
          query: 'Crimson Desert',
          requiresClarification: false,
          selectedEntityUid: 'game:steam:3321460',
          slotId: 'bound-1',
        }],
      },
      resultSet: null,
      lastAnswer: {
        family: 'metric_history',
        summary: 'Tiger answered metric_history.',
      },
      updatedAt: '2026-04-09T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'metric_history');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.reason, 'Reused the current entity selection from session context.');
  assert.equal(result.contractResult?.contractName, 'traceMetricHistory');
  assert.match(result.renderedText ?? '', /Crimson Desert/);
});

test('Tiger primary does not let a bound request selection override a different named game', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let resolveEntitiesCalls = 0;
  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      resolveEntitiesCalls += 1;
      assert.equal(body.query, 'Hades');
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Hades',
            entityKind: 'game',
            entityUid: 'game:steam:1145360',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '1145360',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.deepEqual(body, {
      entityKind: 'game',
      entityUid: 'game:steam:1145360',
      gamesLimit: 0,
      gamesSortBy: 'release_date',
      platformEntityId: '1145360',
    });
    return jsonResponse({
      entity: {
        details: {
          developers: ['Supergiant Games'],
          platforms: ['windows', 'macos'],
          publishers: ['Supergiant Games'],
          releaseDate: '2020-09-17',
          releaseState: 'released',
          releaseYear: 2020,
        },
        displayName: 'Hades',
        entityKind: 'game',
        metrics: {
          ccuPeak: 37600,
          gameCount: null,
          ownersMidpoint: 9000000,
          reviewScore: 98,
          totalReviews: 260000,
        },
        platformEntityId: '1145360',
      },
      games: [],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'tell me about Hades',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      candidateSet: null,
      requestState: null,
      selectionState: {
        family: 'request_binding',
        slots: [{
          candidates: [{
            displayName: 'Crimson Desert',
            entityKind: 'game',
            entityUid: 'game:steam:3321460',
            matchQuality: 'exact',
            ordinal: 1,
            platform: 'steam',
            platformEntityId: '3321460',
            score: 100,
          }],
          expectedEntityKind: 'game',
          label: 'Crimson Desert',
          query: 'Crimson Desert',
          requiresClarification: false,
          selectedEntityUid: 'game:steam:3321460',
          slotId: 'bound-1',
        }],
      },
      resultSet: null,
      lastAnswer: {
        family: 'entity_overview',
        summary: 'Tiger answered entity_overview.',
      },
      updatedAt: '2026-04-09T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(resolveEntitiesCalls, 1);
  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getEntityOverview');
  assert.match(result.renderedText ?? '', /Hades/);
});

test('Tiger primary routes recent Steam change prompts through explainChanges', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'Hades II');
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'game:steam:1145350',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            platform: 'steam',
            platformEntityId: '1145350',
            releaseYear: 2025,
            resolutionTier: 'canonical_exact',
          },
        ],
      });
    }

    if (url.pathname === '/v1/contracts/explain-changes') {
      assert.deepEqual(body, {
        entityUid: 'game:steam:1145350',
        includeNews: true,
        limit: 10,
      });

      return jsonResponse({
        entity: {
          displayName: 'Hades II',
          entityKind: 'game',
          entityUid: 'game:steam:1145350',
          platform: 'steam',
          platformEntityId: '1145350',
        },
        moments: [
          {
            changeTypes: ['build'],
            eventCount: 2,
            events: [],
            linkedNews: [],
            sources: ['steam'],
            windowEnd: '2026-04-03T00:00:00.000Z',
            windowStart: '2026-04-01T00:00:00.000Z',
          },
        ],
        sufficientToAnswer: true,
        summary: {
          eventCount: 2,
          momentCount: 1,
          newsCount: 0,
        },
        timeWindow: {
          endTime: '2026-04-04T00:00:00.000Z',
          startTime: '2026-03-28T00:00:00.000Z',
        },
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Show me the recent Steam changes for Hades II',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'change_explanation');
  assert.equal(result.info.route, 'primary_success');
  assert.ok(result.info.attempts.some((attempt) => attempt.contractName === 'explainChanges'));
  assert.match(result.renderedText ?? '', /Hades II/);
});

test('Tiger primary uses candidate-specific switch hints for single-entity answers', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'Hades II');
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'game:steam:1145350',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '1145350',
          },
          {
            confidence: 0.71,
            displayName: 'Hades',
            entityKind: 'game',
            entityUid: 'game:steam:1145360',
            matchQuality: 'fuzzy',
            platform: 'steam',
            platformEntityId: '1145360',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/explain-changes');
    assert.deepEqual(body, {
      entityUid: 'game:steam:1145350',
      includeNews: true,
      limit: 10,
    });

    return jsonResponse({
      entity: {
        displayName: 'Hades II',
        entityKind: 'game',
        entityUid: 'game:steam:1145350',
        platform: 'steam',
        platformEntityId: '1145350',
      },
      moments: [
        {
          changeTypes: ['build'],
          eventCount: 1,
          events: [],
          linkedNews: [],
          sources: ['steam'],
          windowEnd: '2026-03-29T00:00:00.000Z',
          windowStart: '2026-03-28T00:00:00.000Z',
        },
      ],
      sufficientToAnswer: true,
      summary: {
        eventCount: 1,
        momentCount: 1,
        newsCount: 0,
      },
      timeWindow: {
        endTime: '2026-04-02T00:00:00.000Z',
        startTime: '2026-03-20T00:00:00.000Z',
      },
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What changed on Hades II before and after its last big update?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'change_explanation');
  assert.equal(result.info.route, 'primary_success');
  assert.doesNotMatch(result.renderedText ?? '', /I treated this as Hades II \(game\)\./);
  assert.doesNotMatch(result.renderedText ?? '', /Another likely match is Hades \(game\)\./);
  assert.doesNotMatch(result.renderedText ?? '', /publisher one/);
  assert.ok(result.followUpSuggestions?.some((suggestion) => suggestion.label.includes('Switch to Hades')));
});

test('Tiger primary lets users switch by explicit alternate name', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/explain-changes');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityUid: 'game:steam:1145360',
      includeNews: true,
      limit: 10,
    });

    return jsonResponse({
      entity: {
        displayName: 'Hades',
        entityKind: 'game',
        entityUid: 'game:steam:1145360',
        platform: 'steam',
        platformEntityId: '1145360',
      },
      moments: [
        {
          changeTypes: ['pricing'],
          eventCount: 1,
          events: [],
          linkedNews: [],
          sources: ['steam'],
          windowEnd: '2026-03-28T00:00:00.000Z',
          windowStart: '2026-03-27T00:00:00.000Z',
        },
      ],
      sufficientToAnswer: true,
      summary: {
        eventCount: 1,
        momentCount: 1,
        newsCount: 0,
      },
      timeWindow: {
        endTime: '2026-04-02T00:00:00.000Z',
        startTime: '2026-03-20T00:00:00.000Z',
      },
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'use Hades instead',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'change_explanation',
        summary: 'Tiger answered change_explanation.',
      },
      selectionState: {
        family: 'change_explanation',
        slots: [{
          candidates: [
            {
              displayName: 'Hades II',
              entityKind: 'game',
              entityUid: 'game:steam:1145350',
              matchQuality: 'exact',
              ordinal: 1,
              platform: 'steam',
              platformEntityId: '1145350',
              score: 108,
            },
            {
              displayName: 'Hades',
              entityKind: 'game',
              entityUid: 'game:steam:1145360',
              matchQuality: 'fuzzy',
              ordinal: 2,
              platform: 'steam',
              platformEntityId: '1145360',
              score: 88,
            },
          ],
          label: 'Hades II',
          query: 'Hades II',
          requiresClarification: false,
          selectedEntityUid: 'game:steam:1145350',
          slotId: 'primary',
        }],
      },
      resultSet: null,
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'change_explanation');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Hades/);
});

test('Tiger primary prefers exact title matches for news prompts before clarifying', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'Primeval');
      return jsonResponse({
        ambiguity: {
          candidateNames: ['Primeval', 'Primeval Genesis', 'Primeval Planet: Angimanation'],
          message: 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.',
          requiresClarification: true,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Primeval',
            entityKind: 'game',
            entityUid: 'game:steam:101',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '101',
          },
          {
            confidence: 0.84,
            displayName: 'Primeval Genesis',
            entityKind: 'game',
            entityUid: 'game:steam:102',
            matchQuality: 'fuzzy',
            platform: 'steam',
            platformEntityId: '102',
          },
        ],
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Any recent announcements about Primeval?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'news_search');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.contractName, 'resolveEntities');
  assert.equal(result.info.attempts.length, 1);
  assert.match(result.renderedText ?? '', /multiple likely matches|choose the exact one below/i);
  assert.ok(result.followUpSuggestions?.some((suggestion) => suggestion.label.includes('Primeval Genesis')));
});

test('Tiger primary retries sparse entity-scoped news lookups with broader topic search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let searchDocumentsCalls = 0;

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Deadlock',
            entityKind: 'game',
            entityUid: 'game:steam:1422450',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '1422450',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/search-documents');
    searchDocumentsCalls += 1;

    if (searchDocumentsCalls === 1) {
      assert.deepEqual(body.entityUids, ['game:steam:1422450']);
      assert.equal(body.mode, 'latest_item');
      assert.equal(body.query, undefined);

      return jsonResponse({
        entity: {
          displayName: 'Deadlock',
          entityKind: 'game',
          entityUid: 'game:steam:1422450',
          platform: 'steam',
          platformEntityId: '1422450',
        },
        interpretedFilters: {
          entityUids: ['game:steam:1422450'],
          mode: 'latest_item',
          query: '',
        },
        items: [],
        sufficientToAnswer: false,
      });
    }

    assert.equal(searchDocumentsCalls, 2);
    assert.equal(body.mode, 'topic_search');
    assert.equal(body.query, 'Deadlock');
    assert.equal(body.entityUids, undefined);

    return jsonResponse({
      entity: null,
      interpretedFilters: {
        mode: 'topic_search',
        query: 'Deadlock',
      },
      items: [
        {
          appName: 'Deadlock',
          appid: 1422450,
          bodyPreview: 'Valve opened another public test window and posted updated hero notes.',
          excerpt: 'Public test window opened alongside a new hero update.',
          feedLabel: 'Steam News',
          feedName: 'Steam',
          feedScope: 'steam_news',
          publishedAt: '2026-04-01T12:00:00.000Z',
          sortTime: '2026-04-01T12:00:00.000Z',
          title: 'Deadlock opens a new public test window',
          url: 'https://example.com/deadlock-news',
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Any recent announcements about Deadlock?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(searchDocumentsCalls, 2);
  assert.equal(result.info.matchedIntent, 'news_search');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Deadlock opens a new public test window/);
});

test('Tiger primary adds a nonzero recent-activity floor for generic momentum discovery prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as {
      filters?: {
        minReviewsAdded7d?: number;
        tags?: string[];
      };
      sortBy?: string;
      timeframe?: string;
    };

    assert.equal(body.sortBy, 'momentum_score');
    assert.equal(body.timeframe, '7d');
    assert.equal(body.filters?.minReviewsAdded7d, 2);
    assert.deepEqual(body.filters?.tags, ['Horror']);

    return jsonResponse({
      filtersApplied: ['sort_by: momentum_score', 'timeframe: 7d', 'tags: Horror', 'min_reviews_added_7d: 2'],
      items: [
        {
          appid: 777,
          entityUid: 'game:steam:777',
          name: 'Example Horror',
          platformSupport: ['windows'],
          reviewsAdded7d: 12,
          supportLevel: 'medium',
          supportReasons: ['12 reviews added over 7d.'],
          totalReviews: 1200,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Momentum blends review pickup, velocity acceleration, and player growth over the 7d window.',
      rankingLabel: 'Momentum Score',
      sortBy: 'momentum_score',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What horror games are gaining momentum?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.contractResult?.contractName, 'discoverMomentum');
  assert.match(result.renderedText ?? '', /12 reviews added over 7d/i);
});

test('Tiger primary prefers exact title matches for change prompts before clarifying', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(body.query, 'Primeval');
      return jsonResponse({
        ambiguity: {
          candidateNames: ['Primeval', 'Primeval Genesis', 'Primeval Planet: Angimanation'],
          message: 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.',
          requiresClarification: true,
        },
        entities: [
          {
            confidence: 0.99,
            displayName: 'Primeval',
            entityKind: 'game',
            entityUid: 'game:steam:101',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '101',
          },
          {
            confidence: 0.82,
            displayName: 'Primeval Genesis',
            entityKind: 'game',
            entityUid: 'game:steam:102',
            matchQuality: 'fuzzy',
            platform: 'steam',
            platformEntityId: '102',
          },
        ],
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What changed for Primeval this week?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'change_explanation');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.contractName, 'resolveEntities');
  assert.equal(result.info.attempts.length, 1);
  assert.match(result.renderedText ?? '', /multiple likely matches|choose the exact one below/i);
  assert.ok(result.followUpSuggestions?.some((suggestion) => suggestion.label.includes('Primeval Genesis')));
});

test('Tiger primary lets users switch to the publisher alternative after an auto-selected company overview', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'publisher',
      entityUid: 'publisher:publisheriq:3005',
      gamesLimit: 5,
      gamesSortBy: 'release_date',
      platformEntityId: '3005',
    });

    return jsonResponse({
      entity: {
        details: {
          appType: null,
          developers: [],
          discountPercent: null,
          isFree: null,
          isReleased: null,
          platforms: [],
          priceCents: null,
          publishers: [],
          releaseDate: null,
          releaseState: null,
          releaseYear: null,
        },
        displayName: 'FromSoftware, Inc.',
        entityKind: 'publisher',
        metrics: {
          ccuPeak: 12000,
          gameCount: 12,
          ownersMidpoint: 4000000,
          reviewScore: 94,
          totalReviews: 600000,
        },
      },
      games: [],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'use the publisher one',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'entity_overview',
        summary: 'Tiger answered entity_overview.',
      },
      selectionState: {
        family: 'entity_overview',
        slots: [{
          candidates: [
            {
              displayName: 'FromSoftware',
              entityKind: 'developer',
              entityUid: 'developer:publisheriq:285932',
              matchQuality: 'exact',
              ordinal: 1,
              platform: 'publisheriq',
              platformEntityId: '285932',
              score: 104,
            },
            {
              displayName: 'FromSoftware, Inc.',
              entityKind: 'publisher',
              entityUid: 'publisher:publisheriq:3005',
              matchQuality: 'exact',
              ordinal: 2,
              platform: 'publisheriq',
              platformEntityId: '3005',
              score: 98,
            },
          ],
          label: 'FromSoftware',
          query: 'FromSoftware',
          requiresClarification: false,
          selectedEntityUid: 'developer:publisheriq:285932',
          slotId: 'primary',
        }],
      },
      resultSet: null,
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_overview');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getEntityOverview');
  assert.match(result.renderedText ?? '', /FromSoftware, Inc\./);
});

test('Tiger primary routes derived catalog compare prompts through searchCatalog and compareEntities', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/search-catalog') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      assert.equal(body.isFree, false);
      assert.equal(body.minPriceCents, 4000);
      assert.equal(body.minReviewScore, 80);
      assert.equal(body.limit, 5);

      return jsonResponse({
        continuationToken: null,
        items: [
          { appid: 1, entityUid: 'game:steam:1', name: "Baldur's Gate 3" },
          { appid: 2, entityUid: 'game:steam:2', name: 'ELDEN RING' },
          { appid: 3, entityUid: 'game:steam:3', name: 'Cyberpunk 2077' },
          { appid: 4, entityUid: 'game:steam:4', name: 'Persona 3 Reload' },
          { appid: 5, entityUid: 'game:steam:5', name: 'Dragon Quest XI S' },
        ],
        sufficientToAnswer: true,
      });
    }

    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityUids: [
        'game:steam:1',
        'game:steam:2',
        'game:steam:3',
        'game:steam:4',
        'game:steam:5',
      ],
    });

    return jsonResponse({
      entityKind: 'game',
      highlights: [
        {
          displayName: "Baldur's Gate 3",
          entityUid: 'game:steam:1',
          metric: 'review_score',
          value: 96,
        },
      ],
      items: [
        {
          displayName: "Baldur's Gate 3",
          entityKind: 'game',
          entityUid: 'game:steam:1',
          metrics: {
            ccuPeak: 875343,
            gameCount: null,
            ownersMidpoint: 12000000,
            reviewScore: 96,
            totalReviews: 680000,
          },
          platformEntityId: '1',
        },
        {
          displayName: 'ELDEN RING',
          entityKind: 'game',
          entityUid: 'game:steam:2',
          metrics: {
            ccuPeak: 953426,
            gameCount: null,
            ownersMidpoint: 11000000,
            reviewScore: 94,
            totalReviews: 700000,
          },
          platformEntityId: '2',
        },
      ],
      metrics: ['review_score', 'total_reviews', 'owners_midpoint', 'ccu_peak'],
      platform: 'steam',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare top 5 premium games over $40 with great reviews',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'compareEntities');
  assert.match(result.renderedText ?? '', /Baldur's Gate 3/);
  assert.match(result.renderedText ?? '', /ELDEN RING/);
});

test('Tiger primary routes derived ranking compare prompts through rankEntities and compareEntities', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/rank-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body));
      assert.equal(body.entityKind, 'publisher');
      assert.equal(body.metric, 'game_count');
      assert.equal(body.limit, 5);

      return jsonResponse({
        entityKind: 'publisher',
        items: [
          { displayName: 'Valve', entityUid: 'publisher:publisheriq:1' },
          { displayName: 'Devolver Digital', entityUid: 'publisher:publisheriq:2' },
          { displayName: 'Annapurna Interactive', entityUid: 'publisher:publisheriq:3' },
          { displayName: 'Team17', entityUid: 'publisher:publisheriq:4' },
          { displayName: 'Raw Fury', entityUid: 'publisher:publisheriq:5' },
        ],
        sufficientToAnswer: true,
      });
    }

    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityUids: [
        'publisher:publisheriq:1',
        'publisher:publisheriq:2',
        'publisher:publisheriq:3',
        'publisher:publisheriq:4',
        'publisher:publisheriq:5',
      ],
      metrics: ['game_count'],
    });

    return jsonResponse({
      entityKind: 'publisher',
      highlights: [
        {
          displayName: 'Valve',
          entityUid: 'publisher:publisheriq:1',
          metric: 'game_count',
          value: 18,
        },
      ],
      items: [
        {
          displayName: 'Valve',
          entityKind: 'publisher',
          entityUid: 'publisher:publisheriq:1',
          metrics: {
            ccuPeak: 1200000,
            gameCount: 18,
            ownersMidpoint: 50000000,
            reviewScore: 92,
            totalReviews: 1800000,
          },
          platformEntityId: '1',
        },
        {
          displayName: 'Devolver Digital',
          entityKind: 'publisher',
          entityUid: 'publisher:publisheriq:2',
          metrics: {
            ccuPeak: 120000,
            gameCount: 17,
            ownersMidpoint: 6000000,
            reviewScore: 90,
            totalReviews: 350000,
          },
          platformEntityId: '2',
        },
      ],
      metrics: ['game_count'],
      platform: 'publisheriq',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare top 5 publishers by game count',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'compareEntities');
  assert.match(result.renderedText ?? '', /Game Count/);
});

test('Tiger primary routes compare-top review-velocity prompts through momentum discovery', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as {
      filters?: {
        tags?: string[];
      };
      limit?: number;
      sortBy?: string;
      timeframe?: string;
    };
    assert.deepEqual(body.filters?.tags, ['Roguelike']);
    assert.equal(body.limit, 5);
    assert.equal(body.sortBy, 'reviews_added_7d');
    assert.equal(body.timeframe, '7d');

    return jsonResponse({
      filtersApplied: ['sort_by: reviews_added_7d', 'timeframe: 7d', 'tags: Roguelike'],
      items: [
        {
          appid: 1145360,
          ccuPeak: 42000,
          isFree: false,
          name: 'Hades',
          platformSupport: ['windows'],
          reviewPercentage: 98,
          reviewsAdded30d: 1300,
          reviewsAdded7d: 360,
          supportLevel: 'high',
          supportReasons: ['Review velocity remains well above the recent roguelite baseline.'],
          totalReviews: 275000,
          trendDirection: 'up',
          velocityAcceleration: 9,
        },
      ],
      rankingDefinition: 'Recent reviews added ranks titles by the latest review-velocity window.',
      rankingLabel: 'Reviews Added (7d)',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare top 5 roguelites by review velocity and CCU',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'discoverMomentum');
  assert.match(result.renderedText ?? '', /Reviews Added \(7d\)/);
});

test('Tiger primary routes same-franchise prompts through relation lookup', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  const paths: string[] = [];
  setScopedFetch(t, async (url, init) => {
    paths.push(url.pathname);

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body)) as { query?: string };
      assert.equal(body.query, 'Hades II');

      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            displayName: 'Hades II',
            entityKind: 'game',
            entityUid: 'steam:game:1145350',
            matchQuality: 'exact',
            platform: 'steam',
            platformEntityId: '1145350',
          },
        ],
      });
    }

    if (url.pathname === '/v1/contracts/get-related-entities') {
      assert.ok(init?.body);
      const body = JSON.parse(String(init.body)) as {
        filters?: {
          steamDeck?: string[];
        };
        relationKind?: string;
        sourceAppid?: number;
      };
      assert.equal(body.relationKind, 'franchise_games');
      assert.equal(body.sourceAppid, 1145350);
      assert.deepEqual(body.filters?.steamDeck, ['verified', 'playable']);

      return jsonResponse({
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
        relationKind: 'franchise_games',
        source: {
          appid: 1145350,
          displayName: 'Hades II',
          entityUid: 'steam:game:1145350',
        },
        sufficientToAnswer: true,
      });
    }

    throw new Error(`Unexpected query-api path: ${url.pathname}`);
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Steam Deck games similar to Hades II from the same franchise',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.deepEqual(paths, ['/v1/contracts/resolve-entities', '/v1/contracts/get-related-entities']);
  assert.equal(result.info.matchedIntent, 'relation_lookup');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getRelatedEntities');
  assert.match(result.renderedText ?? '', /only current same-franchise title/i);
  assert.match(result.renderedText ?? '', /Steam Deck/i);
});

test('Tiger primary answers facet-only taxonomy prompts through Tiger catalog search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-catalog');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as {
      facetQuery?: string;
      includeFacets?: string[];
    };
    assert.equal(body.facetQuery, 'colony sim');
    assert.deepEqual(body.includeFacets, ['tags']);

    return jsonResponse({
      facets: {
        canonicalMatch: {
          name: 'Colony Sim',
          type: 'tags',
        },
        categories: [],
        genres: [],
        tags: ['Base Building', 'Resource Management', 'Simulation'],
      },
      interpretedFilters: {
        facetQuery: 'colony sim',
        includeFacets: ['tags'],
        query: null,
      },
      items: [],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What tags exist for colony sim games?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'catalog_search');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'searchCatalog');
  assert.match(result.renderedText ?? '', /most commonly paired with \*\*Colony Sim\*\*/i);
  assert.doesNotMatch(result.renderedText ?? '', /closest matching tags/i);
});

test('Tiger primary composes multi-pattern prospect ranking for agency-style prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  const seenPatterns: string[] = [];
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-change-patterns');
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body)) as { pattern?: string };
    seenPatterns.push(body.pattern ?? 'unknown');

    if (body.pattern === 'under_marketed') {
      return jsonResponse({
        items: [
          {
            activityIds: ['change:1'],
            appid: 101,
            confidence: 'medium',
            name: 'Signal Void',
            occurredAt: '2026-04-03T12:00:00.000Z',
            primaryProof: {
              headline: 'Signal Void matched the under-marketed pattern.',
            },
            reasons: ['Review quality is strong while recent marketing proof stays thin.'],
          },
        ],
        sufficientToAnswer: true,
      });
    }

    return jsonResponse({
      items: [
        {
          activityIds: ['change:2'],
          appid: 101,
          confidence: 'high',
          name: 'Signal Void',
          occurredAt: '2026-04-04T08:00:00.000Z',
          primaryProof: {
            headline: 'Signal Void matched the update-tease pattern.',
          },
          reasons: ['Recent update-adjacent activity creates a timely outreach window.'],
        },
      ],
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Rank possible marketing-agency leads by need, timing, and evidence quality.',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.ok(seenPatterns.includes('under_marketed'));
  assert.ok(seenPatterns.includes('announcement_weak_response'));
  assert.equal(result.info.matchedIntent, 'change_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /need, timing, and evidence quality/i);
});

test('Tiger primary answers portfolio prompts from Tiger user context', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/get-user-context');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      includeAlertPreferences: true,
      includeAlerts: false,
      includePins: true,
      limitAlerts: 5,
      userId: 'user-portfolio',
    });

    return jsonResponse({
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
      pins: [
        {
          alertSettings: null,
          displayName: 'Hades II',
          entityKind: 'game',
          entityUid: 'game:steam:1145350',
          metrics: {
            ccuPeak: 48213,
            gameCount: null,
            ownersMidpoint: 1200000,
            reviewScore: 94,
            totalReviews: 45211,
          },
          pinId: 'pin-1',
          pinOrder: 1,
          pinnedAt: '2026-04-02T00:00:00.000Z',
          platform: 'steam',
          platformEntityId: '1145350',
          summary: {
            appType: 'game',
            isFree: false,
            platforms: ['windows', 'macos'],
            releaseYear: 2026,
          },
        },
        {
          alertSettings: null,
          displayName: 'Supergiant Games',
          entityKind: 'developer',
          entityUid: 'developer:steam:999',
          metrics: {
            ccuPeak: 48213,
            gameCount: 5,
            ownersMidpoint: 2600000,
            reviewScore: 93,
            totalReviews: 125411,
          },
          pinId: 'pin-2',
          pinOrder: 2,
          pinnedAt: '2026-04-02T00:00:00.000Z',
          platform: 'steam',
          platformEntityId: '999',
          summary: {
            appType: null,
            isFree: null,
            platforms: [],
            releaseYear: null,
          },
        },
      ],
      provenance: {
        capturedAt: '2026-04-03T00:00:00.000Z',
        source: 'tiger',
        tables: ['legacy.user_pins', 'legacy.user_alerts', 'legacy.user_alert_preferences'],
      },
      sufficientToAnswer: true,
      totalAlerts: 1,
      totalPins: 2,
      unreadAlertCount: 1,
      userId: 'user-portfolio',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Show me my portfolio',
    sessionContext: null,
    userId: 'user-portfolio',
  });

  assert.equal(result.info.matchedIntent, 'user_context');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /You currently have \*\*1 unread alerts\*\* across \*\*2 pinned items\*\*\./);
  assert.match(result.renderedText ?? '', /Pinned items:/);
  assert.ok(result.followUpSuggestions?.some((suggestion) => suggestion.query.includes('Hades II')));
});

test('Tiger primary reuses ranking request state for metric pivots like "what abt by ccu"', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/rank-entities');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'game',
      limit: 10,
      metric: 'ccu_peak',
      sortDirection: 'desc',
    });

    return jsonResponse({
      entityKind: 'game',
      items: [
        {
          displayName: 'Counter-Strike 2',
          entityKind: 'game',
          entityUid: 'game:steam:730',
          metricValue: 1404982,
          metrics: {
            ccuPeak: 1404982,
            gameCount: null,
            ownersMidpoint: 150000000,
            reviewScore: 88,
            totalReviews: 9000000,
          },
          platform: 'steam',
          platformEntityId: '730',
          rank: 1,
          releaseYear: 2012,
        },
      ],
      metric: 'ccu_peak',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what abt by ccu?',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'entity_ranking',
        summary: 'System answered entity_ranking.',
      },
      requestState: {
        canonicalArgs: {
          entityKind: 'game',
          limit: 10,
          metric: 'owners_midpoint',
          sortDirection: 'desc',
        },
        contractName: 'rankEntities',
        entityKind: 'game',
        family: 'entity_ranking',
        metric: 'owners_midpoint',
        previewItems: [
          {
            entityUid: 'game:steam:730',
            label: 'Counter-Strike 2',
            ordinal: 1,
            platformEntityId: '730',
          },
        ],
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_ranking');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'rankEntities');
  assert.equal((result.contractResult?.request as { metric?: string } | undefined)?.metric, 'ccu_peak');
  assert.equal(result.sessionState?.requestState?.metric, 'ccu_peak');
});

test('Tiger primary applies typo-tolerant momentum filter pivots from request state', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        steamDeck: ['verified'],
      },
      limit: 10,
      sortBy: 'momentum_score',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: ['steam_deck:verified'],
      items: [
        {
          appid: 1145360,
          ccuPeak: 18000,
          entityUid: 'game:steam:1145360',
          isFree: false,
          matchedSteamDeck: 'verified',
          momentumScore: 82,
          name: 'Hades II',
          platformSupport: ['windows'],
          reviewPercentage: 95,
          reviewsAdded7d: 2000,
          supportLevel: 'high',
          supportReasons: ['Verified on Steam Deck.'],
          totalReviews: 42000,
          trendDirection: 'up',
        },
      ],
      provenance: {
        capturedAt: '2026-04-04T00:00:00.000Z',
        source: 'tiger',
        tables: ['legacy.apps'],
      },
      rankingDefinition: 'Momentum score blends review velocity and player traction.',
      rankingLabel: 'Momentum Score',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'This week',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'same but deck verifed',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'momentum_discovery',
        summary: 'System answered momentum_discovery.',
      },
      requestState: {
        canonicalArgs: {
          limit: 10,
          sortBy: 'momentum_score',
          sortDirection: 'desc',
          timeframe: '7d',
          trendType: null,
        },
        contractName: 'discoverMomentum',
        entityKind: 'game',
        family: 'momentum_discovery',
        metric: 'momentum_score',
        previewItems: [
          {
            entityUid: 'game:steam:1145360',
            label: 'Hades II',
            ordinal: 1,
            platformEntityId: 1145360,
          },
        ],
        timeframe: '7d',
        trendType: null,
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'discoverMomentum');
  assert.deepEqual(
    (result.contractResult?.request as { filters?: { steamDeck?: string[] } } | undefined)?.filters?.steamDeck,
    ['verified']
  );
});

test('Tiger primary preserves review-sentiment semantics when narrowing follow-ups to indie', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        maxSentimentDelta: -3,
        minReviews: 1000,
        minReviewsAdded30d: 5,
      },
      indieHeuristic: true,
      limit: 10,
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      timeframe: '30d',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: [
        'sort_by: total_reviews',
        'timeframe: 30d',
        'indie_heuristic: true',
        'min_reviews: 1000',
        'min_reviews_added_30d: 5',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          appid: 2668510,
          ccuPeak: 4200,
          entityUid: 'game:steam:2668510',
          isFree: false,
          name: 'Example Indie',
          platformSupport: ['windows'],
          reviewPercentage: 74,
          reviewsAdded30d: 120,
          sentimentDelta: -4.2,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 4.2 points.'],
          totalReviews: 4200,
          trendDirection: 'down',
          velocityAcceleration: -28,
        },
        {
          appid: 2668511,
          ccuPeak: 3100,
          isFree: false,
          name: 'Example Indie 2',
          platformSupport: ['windows'],
          reviewPercentage: 73,
          reviewsAdded30d: 98,
          sentimentDelta: -3.9,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 3.9 points.'],
          totalReviews: 3900,
          trendDirection: 'down',
          velocityAcceleration: -22,
        },
        {
          appid: 2668512,
          ccuPeak: 2600,
          isFree: false,
          name: 'Example Indie 3',
          platformSupport: ['windows'],
          reviewPercentage: 72,
          reviewsAdded30d: 84,
          sentimentDelta: -3.7,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.7 points.'],
          totalReviews: 3600,
          trendDirection: 'down',
          velocityAcceleration: -19,
        },
        {
          appid: 2668513,
          ccuPeak: 2300,
          isFree: false,
          name: 'Example Indie 4',
          platformSupport: ['windows'],
          reviewPercentage: 71,
          reviewsAdded30d: 76,
          sentimentDelta: -3.5,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.5 points.'],
          totalReviews: 3300,
          trendDirection: 'down',
          velocityAcceleration: -17,
        },
        {
          appid: 2668514,
          ccuPeak: 2100,
          isFree: false,
          name: 'Example Indie 5',
          platformSupport: ['windows'],
          reviewPercentage: 70,
          reviewsAdded30d: 69,
          sentimentDelta: -3.2,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.2 points.'],
          totalReviews: 3050,
          trendDirection: 'down',
          velocityAcceleration: -14,
        },
      ],
      rankingDefinition: 'Total reviews ranks titles by lifetime Steam review volume.',
      rankingLabel: 'Total Reviews',
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      sufficientToAnswer: true,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what about indie ones?',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'momentum_discovery',
        summary: 'System answered momentum_discovery.',
      },
      requestState: {
        canonicalArgs: {
          filters: {
            maxSentimentDelta: -3,
            minCcu: 100,
            minReviews: 10000,
            minReviewsAdded30d: 25,
          },
          limit: 10,
          sortBy: 'total_reviews',
          sortDirection: 'desc',
          timeframe: '30d',
          trendType: null,
        },
        contractName: 'discoverMomentum',
        entityKind: 'game',
        family: 'momentum_discovery',
        metric: 'total_reviews',
        momentumPromptFamily: 'review_sentiment_down',
        previewItems: [
          {
            entityUid: 'game:steam:2668510',
            label: 'Example Game',
            ordinal: 1,
            platformEntityId: 2668510,
          },
        ],
        timeframe: '30d',
        trendType: null,
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /review sentiment decline/i);
  assert.equal(result.sessionState?.requestState?.momentumPromptFamily, 'review_sentiment_down');
});

test('Tiger primary moves review-sentiment activity floors to the requested week on timeframe pivots', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        maxSentimentDelta: -3,
        minReviews: 1000,
        minReviewsAdded7d: 5,
      },
      limit: 10,
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: [
        'sort_by: total_reviews',
        'timeframe: 7d',
        'min_reviews: 1000',
        'min_reviews_added_7d: 5',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          appid: 2668510,
          ccuPeak: 4200,
          entityUid: 'game:steam:2668510',
          isFree: false,
          name: 'Example Game',
          platformSupport: ['windows'],
          reviewPercentage: 74,
          reviewsAdded7d: 240,
          sentimentDelta: -4.2,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 4.2 points.'],
          totalReviews: 18000,
          trendDirection: 'down',
          velocityAcceleration: -28,
        },
        {
          appid: 2668511,
          ccuPeak: 3600,
          entityUid: 'game:steam:2668511',
          isFree: false,
          name: 'Example Game 2',
          platformSupport: ['windows'],
          reviewPercentage: 72,
          reviewsAdded7d: 180,
          sentimentDelta: -3.8,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 3.8 points.'],
          totalReviews: 16500,
          trendDirection: 'down',
          velocityAcceleration: -21,
        },
        {
          appid: 2668512,
          ccuPeak: 2900,
          entityUid: 'game:steam:2668512',
          isFree: false,
          name: 'Example Game 3',
          platformSupport: ['windows'],
          reviewPercentage: 71,
          reviewsAdded7d: 140,
          sentimentDelta: -3.6,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.6 points.'],
          totalReviews: 14100,
          trendDirection: 'down',
          velocityAcceleration: -18,
        },
        {
          appid: 2668513,
          ccuPeak: 2400,
          entityUid: 'game:steam:2668513',
          isFree: false,
          name: 'Example Game 4',
          platformSupport: ['windows'],
          reviewPercentage: 70,
          reviewsAdded7d: 118,
          sentimentDelta: -3.3,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.3 points.'],
          totalReviews: 12800,
          trendDirection: 'down',
          velocityAcceleration: -15,
        },
        {
          appid: 2668514,
          ccuPeak: 2100,
          entityUid: 'game:steam:2668514',
          isFree: false,
          name: 'Example Game 5',
          platformSupport: ['windows'],
          reviewPercentage: 69,
          reviewsAdded7d: 101,
          sentimentDelta: -3.1,
          supportLevel: 'medium',
          supportReasons: ['Sentiment fell by 3.1 points.'],
          totalReviews: 11800,
          trendDirection: 'down',
          velocityAcceleration: -12,
        },
      ],
      rankingDefinition: 'Total reviews ranks titles by lifetime Steam review volume.',
      rankingLabel: 'Total Reviews',
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'this week instead',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'momentum_discovery',
        summary: 'System answered momentum_discovery.',
      },
      requestState: {
        canonicalArgs: {
          filters: {
            maxSentimentDelta: -3,
            minCcu: 100,
            minReviews: 10000,
            minReviewsAdded30d: 25,
          },
          limit: 10,
          sortBy: 'total_reviews',
          sortDirection: 'desc',
          timeframe: '30d',
          trendType: null,
        },
        contractName: 'discoverMomentum',
        entityKind: 'game',
        family: 'momentum_discovery',
        metric: 'total_reviews',
        momentumPromptFamily: 'review_sentiment_down',
        previewItems: [
          {
            entityUid: 'game:steam:2668510',
            label: 'Example Game',
            ordinal: 1,
            platformEntityId: 2668510,
          },
        ],
        timeframe: '30d',
        trendType: null,
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /review sentiment decline/i);
  assert.equal(result.sessionState?.requestState?.momentumPromptFamily, 'review_sentiment_down');
  assert.equal(result.sessionState?.requestState?.timeframe, '7d');
});

test('Tiger primary retries sparse weekly review-sentiment pivots and explains remaining shortfall', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let callCount = 0;
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);

    callCount += 1;
    if (callCount === 1) {
      assert.deepEqual(JSON.parse(String(init.body)), {
        filters: {
          maxSentimentDelta: -3,
          minReviews: 1000,
          minReviewsAdded7d: 5,
        },
        limit: 10,
        sortBy: 'total_reviews',
        sortDirection: 'desc',
        timeframe: '7d',
        trendType: null,
      });

      return jsonResponse({
        filtersApplied: [
          'sort_by: total_reviews',
          'timeframe: 7d',
          'min_reviews: 1000',
          'min_reviews_added_7d: 5',
          'max_sentiment_delta: -3',
        ],
        items: [],
        rankingDefinition: 'Total reviews ranks titles by lifetime Steam review volume.',
        rankingLabel: 'Total Reviews',
        sortBy: 'total_reviews',
        sortDirection: 'desc',
        sufficientToAnswer: false,
        timeframe: '7d',
        timeframeLabel: 'Last 7 days',
        trendType: null,
      });
    }

    assert.equal(callCount, 2);
    assert.deepEqual(JSON.parse(String(init.body)), {
      filters: {
        maxSentimentDelta: -3,
        minReviews: 250,
        minReviewsAdded7d: 2,
      },
      limit: 10,
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: null,
    });

    return jsonResponse({
      filtersApplied: [
        'sort_by: total_reviews',
        'timeframe: 7d',
        'min_reviews: 250',
        'min_reviews_added_7d: 2',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          appid: 2668510,
          ccuPeak: 4200,
          entityUid: 'game:steam:2668510',
          isFree: false,
          name: 'Example Game',
          platformSupport: ['windows'],
          reviewPercentage: '74.4',
          reviewsAdded7d: 120,
          sentimentDelta: '-4.2',
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 4.2 points.'],
          totalReviews: 18000,
          trendDirection: 'down',
        },
      ],
      rankingDefinition: 'Total reviews ranks titles by lifetime Steam review volume.',
      rankingLabel: 'Total Reviews',
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'this week instead',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'momentum_discovery',
        summary: 'System answered momentum_discovery.',
      },
      requestState: {
        canonicalArgs: {
          filters: {
            maxSentimentDelta: -3,
            minCcu: 100,
            minReviews: 10000,
            minReviewsAdded30d: 25,
          },
          limit: 10,
          sortBy: 'total_reviews',
          sortDirection: 'desc',
          timeframe: '30d',
          trendType: null,
        },
        contractName: 'discoverMomentum',
        entityKind: 'game',
        family: 'momentum_discovery',
        metric: 'total_reviews',
        momentumPromptFamily: 'review_sentiment_down',
        previewItems: [
          {
            entityUid: 'game:steam:2668510',
            label: 'Example Game',
            ordinal: 1,
            platformEntityId: 2668510,
          },
        ],
        timeframe: '30d',
        trendType: null,
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(callCount, 2);
  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /Only 1 title qualified even after relaxing the default popularity floor/i);
  assert.match(result.renderedText ?? '', /74\.4%/);
  assert.equal(result.info.attempts[0]?.status, 'skipped');
  assert.equal(result.info.attempts[1]?.status, 'success');
  assert.deepEqual(result.sessionState?.requestState?.canonicalArgs, {
    filters: {
      maxSentimentDelta: -3,
      minReviews: 250,
      minReviewsAdded7d: 2,
    },
    limit: 10,
    sortBy: 'total_reviews',
    sortDirection: 'desc',
    timeframe: '7d',
    trendType: null,
  });
  assert.equal(result.sessionState?.requestState?.momentumPromptFamily, 'review_sentiment_down');
  assert.equal(result.sessionState?.requestState?.timeframe, '7d');
});

test('Tiger primary reports review-trend-aware weekly no-results after the relaxed retry also comes back empty', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  let callCount = 0;
  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/discover-momentum');
    assert.ok(init?.body);

    callCount += 1;
    if (callCount === 1) {
      return jsonResponse({
        filtersApplied: [
          'sort_by: total_reviews',
          'timeframe: 7d',
          'min_reviews: 1000',
          'min_reviews_added_7d: 5',
          'max_sentiment_delta: -3',
        ],
        items: [],
        rankingDefinition: 'Total reviews ranks titles by lifetime Steam review volume.',
        rankingLabel: 'Total Reviews',
        sortBy: 'total_reviews',
        sortDirection: 'desc',
        sufficientToAnswer: false,
        timeframe: '7d',
        timeframeLabel: 'Last 7 days',
        trendType: null,
      });
    }

    return jsonResponse({
      filtersApplied: [
        'sort_by: total_reviews',
        'timeframe: 7d',
        'min_reviews: 250',
        'min_reviews_added_7d: 2',
        'max_sentiment_delta: -3',
      ],
      items: [],
      rankingDefinition: 'Total reviews ranks titles by lifetime Steam review volume.',
      rankingLabel: 'Total Reviews',
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      sufficientToAnswer: false,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: null,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'this week instead',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'momentum_discovery',
        summary: 'System answered momentum_discovery.',
      },
      requestState: {
        canonicalArgs: {
          filters: {
            maxSentimentDelta: -3,
            minCcu: 100,
            minReviews: 10000,
            minReviewsAdded30d: 25,
          },
          limit: 10,
          sortBy: 'total_reviews',
          sortDirection: 'desc',
          timeframe: '30d',
          trendType: null,
        },
        contractName: 'discoverMomentum',
        entityKind: 'game',
        family: 'momentum_discovery',
        metric: 'total_reviews',
        momentumPromptFamily: 'review_sentiment_down',
        previewItems: [],
        timeframe: '30d',
        trendType: null,
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(callCount, 2);
  assert.equal(result.info.matchedIntent, 'momentum_discovery');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /stable momentum screen/i);
  assert.match(result.info.attempts[1]?.reason ?? '', /stable result set/i);
});

test('Tiger primary can drill from ranked results into change lookups for the top item', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      assert.match(String(init.body), /Counter-Strike 2/);
      return jsonResponse({
        ambiguity: {
          requiresClarification: false,
        },
        entities: [
          {
            displayName: 'Counter-Strike 2',
            entityKind: 'game',
            entityUid: 'game:steam:730',
            confidence: 0.99,
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            platform: 'steam',
            platformEntityId: '730',
            releaseYear: 2023,
            resolutionTier: 'canonical_exact',
          },
        ],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/explain-changes');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityUid: 'game:steam:730',
      includeNews: true,
      limit: 10,
    });

    return jsonResponse({
      comparisonWindows: null,
      entity: {
        displayName: 'Counter-Strike 2',
        entityKind: 'game',
        entityUid: 'game:steam:730',
        platform: 'steam',
        platformEntityId: '730',
      },
      mode: 'timeline',
      moments: [
        {
          changeTypes: ['price_change'],
          eventCount: 1,
          events: [],
          linkedNews: [],
          sources: ['storefront'],
          windowEnd: '2026-04-04T00:00:00.000Z',
          windowStart: '2026-04-04T00:00:00.000Z',
        },
      ],
      provenance: {
        capturedAt: '2026-04-04T00:00:00.000Z',
        source: 'tiger',
        tables: ['legacy.latest_activities'],
      },
      sufficientToAnswer: true,
      summary: {
        countsByChangeType: { price_change: 1 },
        countsBySource: { storefront: 1 },
        eventCount: 1,
        momentCount: 1,
        newsCount: 0,
      },
      timeWindow: {
        endTime: '2026-04-04T00:00:00.000Z',
        startTime: '2026-03-28T00:00:00.000Z',
      },
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'what changed for the top one?',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'entity_ranking',
        summary: 'System answered entity_ranking.',
      },
      requestState: {
        canonicalArgs: {
          entityKind: 'game',
          limit: 10,
          metric: 'owners_midpoint',
          sortDirection: 'desc',
        },
        contractName: 'rankEntities',
        entityKind: 'game',
        family: 'entity_ranking',
        metric: 'owners_midpoint',
        previewItems: [
          {
            entityUid: 'game:steam:730',
            label: 'Counter-Strike 2',
            ordinal: 1,
            platformEntityId: '730',
          },
          {
            entityUid: 'game:steam:570',
            label: 'Dota 2',
            ordinal: 2,
            platformEntityId: '570',
          },
        ],
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'change_explanation');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.contractName, 'resolveEntities');
  assert.equal(result.info.attempts.at(-1)?.contractName, 'explainChanges');
  assert.match(result.renderedText ?? '', /Counter-Strike 2/);
});

test('Tiger primary can compare the top two visible results from ranking request state', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/compare-entities');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityUids: ['game:steam:730', 'game:steam:570'],
      metrics: ['total_reviews'],
    });

    return jsonResponse({
      entityKind: 'game',
      highlights: [
        {
          displayName: 'Counter-Strike 2',
          entityUid: 'game:steam:730',
          metric: 'total_reviews',
          value: 9000000,
        },
      ],
      items: [
        {
          displayName: 'Counter-Strike 2',
          entityKind: 'game',
          entityUid: 'game:steam:730',
          metrics: {
            ccuPeak: 1404982,
            gameCount: null,
            ownersMidpoint: 150000000,
            reviewScore: 88,
            totalReviews: 9000000,
          },
          platformEntityId: '730',
        },
        {
          displayName: 'Dota 2',
          entityKind: 'game',
          entityUid: 'game:steam:570',
          metrics: {
            ccuPeak: 601576,
            gameCount: null,
            ownersMidpoint: 150000000,
            reviewScore: 82,
            totalReviews: 2500000,
          },
          platformEntityId: '570',
        },
      ],
      metrics: ['total_reviews'],
      platform: 'steam',
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'compare the top two by reviews',
    sessionContext: {
      version: 1,
      entities: [],
      constraints: [],
      lastAnswer: {
        family: 'entity_ranking',
        summary: 'System answered entity_ranking.',
      },
      requestState: {
        canonicalArgs: {
          entityKind: 'game',
          limit: 10,
          metric: 'owners_midpoint',
          sortDirection: 'desc',
        },
        contractName: 'rankEntities',
        entityKind: 'game',
        family: 'entity_ranking',
        metric: 'owners_midpoint',
        previewItems: [
          {
            entityUid: 'game:steam:730',
            label: 'Counter-Strike 2',
            ordinal: 1,
            platformEntityId: '730',
          },
          {
            entityUid: 'game:steam:570',
            label: 'Dota 2',
            ordinal: 2,
            platformEntityId: '570',
          },
        ],
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      selectionState: null,
      resultSet: null,
      updatedAt: '2026-04-04T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'compareEntities');
  assert.match(result.renderedText ?? '', /Counter-Strike 2/);
  assert.match(result.renderedText ?? '', /Dota 2/);
});

test('Tiger primary routes explicit YouTube latest-video prompts through get-youtube-game-coverage', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'ARC Raiders',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1149460',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      contentClass: null,
      entityUid: '11111111-1111-4111-8111-111111111111',
      limit: 10,
      view: 'latest_videos',
      window: null,
    });

    return jsonResponse({
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
        channelId: 'channel-1',
        channelTitle: 'Creator One',
        contentClass: 'standard_video',
        publishedAt: '2026-04-07T07:56:34.000Z',
        title: 'ARC Raiders Just Buffed This Key Room',
        url: 'https://www.youtube.com/watch?v=video-1',
        viewCount: 32037,
      }, {
        channelTitle: 'Creator [Two]\nDaily',
        contentClass: 'short',
        publishedAt: '2026-04-06T06:00:00.000Z',
        title: 'ARC Raiders [Guide] | Fast Route\nLine 2',
        viewCount: null,
      }],
      limit: 10,
      resolvedWindow: 'current',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 32,
        distinctUploadChannels7d: 18,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 100,
        matchedVideoViewDelta1d: 258971,
        matchedVideoViewDelta7d: 258971,
        newMatchedVideos1d: 51,
        newMatchedVideos30d: 100,
        newMatchedVideos7d: 88,
      },
      view: 'latest_videos',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What are the latest YouTube videos for ARC Raiders?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.equal(result.info.attempts.at(-1)?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /Latest YouTube videos for ARC Raiders/);
  assert.match(result.renderedText ?? '', /ARC Raiders currently has 100 tracked YouTube videos\./);
  assert.match(result.renderedText ?? '', /In the last 7 days, there were 88 new videos from 18 channels\./);
  assert.match(result.renderedText ?? '', /ARC Raiders Just Buffed This Key Room/);
  assert.match(result.renderedText ?? '', /\| Video \| Channel \| Published \| Views \| Format \|/);
  assert.match(result.renderedText ?? '', /\[ARC Raiders Just Buffed This Key Room\]\(<https:\/\/www\.youtube\.com\/watch\?v=video-1>\)/);
  assert.match(result.renderedText ?? '', /\[Creator One\]\(<https:\/\/www\.youtube\.com\/channel\/channel-1>\)/);
  assert.match(result.renderedText ?? '', /ARC Raiders \[Guide\] \\| Fast Route Line 2/);
  assert.match(result.renderedText ?? '', /Creator \[Two\] Daily/);
  assert.doesNotMatch(result.renderedText ?? '', /matched set/i);
  assert.doesNotMatch(result.renderedText ?? '', /creator breadth/i);
  assert.doesNotMatch(result.renderedText ?? '', /latest snapshot/i);
});

test('Tiger primary resolves creator coverage prompts phrased as creator coverage', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(request.query, 'Palworld');
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'Palworld',
          entityKind: 'game',
          entityUid: '22222222-2222-4222-8222-222222222222',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1623730',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.equal(request.entityUid, '22222222-2222-4222-8222-222222222222');
    assert.equal(request.view, 'creator_coverage');
    assert.equal(request.window, null);
    return jsonResponse({
      availability: {
        blockingTables: [],
        reason: null,
        state: 'ready',
      },
      cadence: null,
      contentClass: null,
      contentMix: [],
      creators: [{
        channelId: 'channel-pocketpair',
        channelSubscriberCount: 512000,
        channelTitle: 'Pocketpair Clips',
        latestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        matchedVideoCount: 12,
        totalMatchedViews: 845000,
      }],
      entity: {
        displayName: 'Palworld',
        entityKind: 'game',
        entityUid: '22222222-2222-4222-8222-222222222222',
        platform: 'steam',
        platformEntityId: '1623730',
      },
      items: [],
      limit: 10,
      resolvedWindow: 'current',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 96,
        distinctUploadChannels7d: 37,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 144,
        matchedVideoViewDelta1d: 984221,
        matchedVideoViewDelta7d: 3221991,
        newMatchedVideos1d: 19,
        newMatchedVideos30d: 144,
        newMatchedVideos7d: 62,
      },
      view: 'creator_coverage',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Which creators are covering Palworld on YouTube right now?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /YouTube creator coverage for Palworld/);
  assert.match(result.renderedText ?? '', /Pocketpair Clips/);
  assert.match(result.renderedText ?? '', /\| Channel \| Videos \| Views \| Subscribers \| Latest Upload \|/);
  assert.match(result.renderedText ?? '', /\[Pocketpair Clips\]\(<https:\/\/www\.youtube\.com\/channel\/channel-pocketpair>\)/);
});

test('Tiger primary resolves YouTube growth prompts and maps last 1 day to the 1d window', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(request.query, 'Hollow Knight');
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'Hollow Knight',
          entityKind: 'game',
          entityUid: '33333333-3333-4333-8333-333333333333',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '367520',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.equal(request.entityUid, '33333333-3333-4333-8333-333333333333');
    assert.equal(request.view, 'video_growth');
    assert.equal(request.window, '1d');
    return jsonResponse({
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
        displayName: 'Hollow Knight',
        entityKind: 'game',
        entityUid: '33333333-3333-4333-8333-333333333333',
        platform: 'steam',
        platformEntityId: '367520',
      },
      items: [{
        channelId: 'channel-silksong',
        channelTitle: 'Silksong Watch',
        contentClass: 'standard_video',
        growthPct: 0.41,
        publishedAt: '2026-04-07T05:14:00.000Z',
        title: 'Hollow Knight Lore Theory Just Exploded',
        url: 'https://www.youtube.com/watch?v=video-growth-1',
        viewCount: 145000,
        viewDelta: 42000,
      }],
      limit: 10,
      resolvedWindow: '1d',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 58,
        distinctUploadChannels7d: 21,
        freshestMatchedUploadAt: '2026-04-07T05:14:00.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 73,
        matchedVideoViewDelta1d: 621104,
        matchedVideoViewDelta7d: 1112120,
        newMatchedVideos1d: 9,
        newMatchedVideos30d: 73,
        newMatchedVideos7d: 28,
      },
      view: 'video_growth',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Which Hollow Knight YouTube videos are growing fastest in the last 1 day?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /Fastest-growing YouTube videos for Hollow Knight/);
  assert.match(result.renderedText ?? '', /Hollow Knight Lore Theory Just Exploded/);
  assert.match(result.renderedText ?? '', /\| Video \| Channel \| Published \| View Delta \| Growth \| Views \| Format \|/);
  assert.match(result.renderedText ?? '', /\[Hollow Knight Lore Theory Just Exploded\]\(<https:\/\/www\.youtube\.com\/watch\?v=video-growth-1>\)/);
  assert.match(result.renderedText ?? '', /\[Silksong Watch\]\(<https:\/\/www\.youtube\.com\/channel\/channel-silksong>\)/);
});

test('Tiger primary routes generic latest-video prompts to YouTube when they clearly target one game', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(request.query, 'ARC Raiders');
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'ARC Raiders',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1149460',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.deepEqual(request, {
      contentClass: null,
      entityUid: '11111111-1111-4111-8111-111111111111',
      limit: 10,
      view: 'latest_videos',
      window: null,
    });

    return jsonResponse({
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
        channelTitle: 'Creator One',
        contentClass: 'standard_video',
        publishedAt: '2026-04-07T07:56:34.000Z',
        title: 'ARC Raiders Just Buffed This Key Room',
        viewCount: null,
      }],
      limit: 10,
      resolvedWindow: 'current',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 32,
        distinctUploadChannels7d: 18,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 100,
        matchedVideoViewDelta1d: 258971,
        matchedVideoViewDelta7d: 258971,
        newMatchedVideos1d: 51,
        newMatchedVideos30d: 100,
        newMatchedVideos7d: 88,
      },
      view: 'latest_videos',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What are the latest videos for ARC Raiders?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /Latest YouTube videos for ARC Raiders/);
  assert.match(result.renderedText ?? '', /\| Video \| Channel \| Published \| Views \| Format \|/);
  assert.match(result.renderedText ?? '', /\| n\/a \| Standard video \|/);
});

test('Tiger primary routes generic creator-coverage prompts to YouTube with a weekly window', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(request.query, 'ARC Raiders');
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'ARC Raiders',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1149460',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.deepEqual(request, {
      contentClass: null,
      entityUid: '11111111-1111-4111-8111-111111111111',
      limit: 10,
      view: 'creator_coverage',
      window: '7d',
    });

    return jsonResponse({
      availability: {
        blockingTables: [],
        reason: null,
        state: 'ready',
      },
      cadence: null,
      contentClass: null,
      contentMix: [],
      creators: [{
        channelSubscriberCount: 120000,
        channelTitle: 'Creator One',
        latestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        matchedVideoCount: 4,
        totalMatchedViews: null,
      }],
      entity: {
        displayName: 'ARC Raiders',
        entityKind: 'game',
        entityUid: '11111111-1111-4111-8111-111111111111',
        platform: 'steam',
        platformEntityId: '1149460',
      },
      items: [],
      limit: 10,
      resolvedWindow: '7d',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 32,
        distinctUploadChannels7d: 18,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 100,
        matchedVideoViewDelta1d: 258971,
        matchedVideoViewDelta7d: 258971,
        newMatchedVideos1d: 51,
        newMatchedVideos30d: 100,
        newMatchedVideos7d: 88,
      },
      view: 'creator_coverage',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Who is covering ARC Raiders this week?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /YouTube creator coverage for ARC Raiders in the last 7 days/);
  assert.match(result.renderedText ?? '', /\| Channel \| Videos \| Views \| Subscribers \| Latest Upload \|/);
  assert.match(result.renderedText ?? '', /\| Creator One \| 4 \| n\/a \| 120K \|/);
});

test('Tiger primary routes cadence prompts to YouTube with a 14-day window', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(request.query, 'ARC Raiders');
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'ARC Raiders',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1149460',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.deepEqual(request, {
      contentClass: null,
      entityUid: '11111111-1111-4111-8111-111111111111',
      limit: 10,
      view: 'cadence',
      window: '14d',
    });

    return jsonResponse({
      availability: {
        blockingTables: [],
        reason: null,
        state: 'ready',
      },
      cadence: {
        distinctUploadChannels: 23,
        matchedVideoViewDelta: 145000,
        newMatchedVideos: 31,
        viewsOnNewVideos: 420000,
        window: '14d',
      },
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
      items: [],
      limit: 10,
      resolvedWindow: '14d',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 32,
        distinctUploadChannels7d: 18,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 100,
        matchedVideoViewDelta1d: 258971,
        matchedVideoViewDelta7d: 258971,
        newMatchedVideos1d: 51,
        newMatchedVideos30d: 100,
        newMatchedVideos7d: 88,
      },
      view: 'cadence',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'How many upload channels posted about ARC Raiders in the last 14 days?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /YouTube activity for ARC Raiders in the last 14 days/);
  assert.match(result.renderedText ?? '', /In the last 14 days, 23 channels posted 31 new videos about ARC Raiders\./);
  assert.match(result.renderedText ?? '', /\| Metric \| Value \|/);
  assert.match(result.renderedText ?? '', /\| Upload channels \| 23 \|/);
  assert.match(result.renderedText ?? '', /\| New videos \| 31 \|/);
  assert.match(result.renderedText ?? '', /\| Current views \| 420K \|/);
  assert.match(result.renderedText ?? '', /\| View delta \| 145K \|/);
  assert.doesNotMatch(result.renderedText ?? '', /latest snapshot/i);
});

test('Tiger primary routes generic content-mix prompts to YouTube with a monthly window', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(request.query, 'ARC Raiders');
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'ARC Raiders',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1149460',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.deepEqual(request, {
      contentClass: null,
      entityUid: '11111111-1111-4111-8111-111111111111',
      limit: 10,
      view: 'content_mix',
      window: '30d',
    });

    return jsonResponse({
      availability: {
        blockingTables: [],
        reason: null,
        state: 'ready',
      },
      cadence: null,
      contentClass: null,
      contentMix: [{
        contentClass: 'standard_video',
        currentViews: 880000,
        distinctUploadChannels: 12,
        matchedPrimaryVideoCount: 44,
        matchedVideoViewDelta: 120000,
        newMatchedVideos: 18,
      }, {
        contentClass: 'short',
        currentViews: 1200000,
        distinctUploadChannels: 19,
        matchedPrimaryVideoCount: 31,
        matchedVideoViewDelta: 240000,
        newMatchedVideos: 26,
      }],
      creators: [],
      entity: {
        displayName: 'ARC Raiders',
        entityKind: 'game',
        entityUid: '11111111-1111-4111-8111-111111111111',
        platform: 'steam',
        platformEntityId: '1149460',
      },
      items: [],
      limit: 10,
      resolvedWindow: '30d',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 32,
        distinctUploadChannels7d: 18,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 100,
        matchedVideoViewDelta1d: 258971,
        matchedVideoViewDelta7d: 258971,
        newMatchedVideos1d: 51,
        newMatchedVideos30d: 100,
        newMatchedVideos7d: 88,
      },
      view: 'content_mix',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What content mix does ARC Raiders have this month?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /YouTube content mix for ARC Raiders in the last 30 days/);
  assert.match(result.renderedText ?? '', /\| Format \| Videos \| New Videos \| Channels \| Views \| View Delta \|/);
  assert.match(result.renderedText ?? '', /\| Standard video \| 44 \| 18 \| 12 \| 880K \| 120K \|/);
  assert.match(result.renderedText ?? '', /\| Shorts \| 31 \| 26 \| 19 \| 1M \| 240K \|/);
});

test('Tiger primary routes generic most-viewed prompts to YouTube top videos with a 3-day window', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.equal(request.query, 'ARC Raiders');
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'ARC Raiders',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1149460',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.deepEqual(request, {
      contentClass: null,
      entityUid: '11111111-1111-4111-8111-111111111111',
      limit: 10,
      view: 'top_videos',
      window: '3d',
    });

    return jsonResponse({
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
        channelId: 'channel-1',
        channelTitle: 'Creator One',
        contentClass: 'standard_video',
        publishedAt: '2026-04-07T07:56:34.000Z',
        title: 'ARC Raiders Just Buffed This Key Room',
        url: 'https://www.youtube.com/watch?v=video-top-1',
        viewCount: 32037,
      }],
      limit: 10,
      resolvedWindow: '3d',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 32,
        distinctUploadChannels7d: 18,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 100,
        matchedVideoViewDelta1d: 258971,
        matchedVideoViewDelta7d: 258971,
        newMatchedVideos1d: 51,
        newMatchedVideos30d: 100,
        newMatchedVideos7d: 88,
      },
      view: 'top_videos',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What are the most-viewed videos for ARC Raiders in the last 72 hours?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /Top YouTube videos for ARC Raiders in the last 3 days/);
  assert.match(result.renderedText ?? '', /\| Video \| Channel \| Published \| Views \| Format \|/);
  assert.match(result.renderedText ?? '', /\[ARC Raiders Just Buffed This Key Room\]\(<https:\/\/www\.youtube\.com\/watch\?v=video-top-1>\)/);
  assert.match(result.renderedText ?? '', /\[Creator One\]\(<https:\/\/www\.youtube\.com\/channel\/channel-1>\)/);
});

test('Tiger primary renders a blocked explanation for noisy YouTube titles', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'MENACE',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '2436120',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    return jsonResponse({
      availability: {
        blockingTables: [],
        reason: 'This title is blocked for YouTube answers right now because the current match precision is not reliable enough.',
        state: 'blocked',
      },
      cadence: null,
      contentClass: null,
      contentMix: [],
      creators: [],
      entity: {
        displayName: 'MENACE',
        entityKind: 'game',
        entityUid: '11111111-1111-4111-8111-111111111111',
        platform: 'steam',
        platformEntityId: '2436120',
      },
      items: [],
      limit: 10,
      resolvedWindow: 'current',
      sufficientToAnswer: false,
      summary: {
        distinctUploadChannels30d: 0,
        distinctUploadChannels7d: 0,
        freshestMatchedUploadAt: null,
        latestSnapshotAt: null,
        matchedPrimaryVideoCount: 0,
        matchedVideoViewDelta1d: 0,
        matchedVideoViewDelta7d: 0,
        newMatchedVideos1d: 0,
        newMatchedVideos30d: 0,
        newMatchedVideos7d: 0,
      },
      view: 'latest_videos',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What are the latest YouTube videos for MENACE?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /not returning a YouTube answer for MENACE/i);
});

test('Tiger primary returns a deterministic unavailable message when mirrored YouTube data is not ready', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [{
          confidence: 0.99,
          displayName: 'ARC Raiders',
          entityKind: 'game',
          entityUid: '11111111-1111-4111-8111-111111111111',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '1149460',
        }],
      });
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    return jsonResponse({
      availability: {
        blockingTables: ['docs.youtube_videos', 'metrics.youtube_video_snapshots'],
        reason: 'YouTube coverage is not available on this data environment yet because the mirrored tables are still empty or missing.',
        state: 'unavailable',
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
      items: [],
      limit: 10,
      resolvedWindow: 'current',
      sufficientToAnswer: false,
      summary: {
        distinctUploadChannels30d: 0,
        distinctUploadChannels7d: 0,
        freshestMatchedUploadAt: null,
        latestSnapshotAt: null,
        matchedPrimaryVideoCount: 0,
        matchedVideoViewDelta1d: 0,
        matchedVideoViewDelta7d: 0,
        newMatchedVideos1d: 0,
        newMatchedVideos30d: 0,
        newMatchedVideos7d: 0,
      },
      view: 'latest_videos',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'What are the latest YouTube videos for ARC Raiders?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.match(result.renderedText ?? '', /data environment does not have mirrored YouTube data ready yet/i);
  assert.match(result.renderedText ?? '', /docs\.youtube_videos/);
});

test('Tiger primary reuses a bound request selection for YouTube follow-up prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'CHAT_TIGER_YOUTUBE_ENABLED', 'true');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.fail(`expected request binding reuse, but resolve-entities was called with ${JSON.stringify(body)}`);
    }

    assert.equal(url.pathname, '/v1/contracts/get-youtube-game-coverage');
    assert.deepEqual(body, {
      contentClass: null,
      entityUid: 'game:steam:1623730',
      limit: 10,
      view: 'creator_coverage',
      window: null,
    });

    return jsonResponse({
      availability: {
        blockingTables: [],
        reason: null,
        state: 'ready',
      },
      cadence: null,
      contentClass: null,
      contentMix: [],
      creators: [{
        channelSubscriberCount: 512000,
        channelTitle: 'Pocketpair Clips',
        latestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        matchedVideoCount: 12,
        totalMatchedViews: 845000,
      }],
      entity: {
        displayName: 'Palworld',
        entityKind: 'game',
        entityUid: 'game:steam:1623730',
        platform: 'steam',
        platformEntityId: '1623730',
      },
      items: [],
      limit: 10,
      resolvedWindow: 'current',
      sufficientToAnswer: true,
      summary: {
        distinctUploadChannels30d: 96,
        distinctUploadChannels7d: 37,
        freshestMatchedUploadAt: '2026-04-07T07:56:34.000Z',
        latestSnapshotAt: '2026-04-07T08:00:32.000Z',
        matchedPrimaryVideoCount: 144,
        matchedVideoViewDelta1d: 984221,
        matchedVideoViewDelta7d: 3221991,
        newMatchedVideos1d: 19,
        newMatchedVideos30d: 144,
        newMatchedVideos7d: 62,
      },
      view: 'creator_coverage',
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Which creators are covering it on YouTube right now?',
    sessionContext: {
      version: 1,
      entities: [{
        id: 'game:steam:1623730',
        kind: 'game',
        name: 'Palworld',
        platform: 'steam',
        platformEntityId: '1623730',
        sourceTool: 'tigerPrimarySelection',
      }],
      constraints: [],
      candidateSet: null,
      requestState: null,
      selectionState: {
        family: 'request_binding',
        slots: [{
          candidates: [{
            displayName: 'Palworld',
            entityKind: 'game',
            entityUid: 'game:steam:1623730',
            matchQuality: 'exact',
            ordinal: 1,
            platform: 'steam',
            platformEntityId: '1623730',
            score: 100,
          }],
          expectedEntityKind: 'game',
          label: 'Palworld',
          query: 'Palworld',
          requiresClarification: false,
          selectedEntityUid: 'game:steam:1623730',
          slotId: 'bound-1',
        }],
      },
      resultSet: null,
      lastAnswer: {
        family: 'entity_overview',
        summary: 'Tiger answered entity_overview.',
      },
      updatedAt: '2026-04-09T00:00:00.000Z',
    },
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'youtube_game_activity');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts[0]?.reason, 'Reused the current entity selection from session context.');
  assert.equal(result.contractResult?.contractName, 'getYoutubeGameCoverage');
  assert.match(result.renderedText ?? '', /YouTube creator coverage for Palworld/);
});
