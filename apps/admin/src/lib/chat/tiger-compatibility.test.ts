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
          platformEntityId: '1145360',
          releaseYear: 2020,
        },
      ],
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
      releaseYear: 2020,
      similarityScore: 0.99,
    },
  ]);
  assert.ok(provenance);
  assert.ok(provenance.dataSources.includes('query_api:resolveEntities'));
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
  setScopedFetch(t, async (url) => {
    callCount += 1;

    if (url.pathname === '/v1/contracts/resolve-entities') {
      return jsonResponse({
        ambiguity: {
          message: null,
          requiresClarification: false,
        },
        entities: [
          {
            displayName: 'Hades',
            entityKind: 'game',
            entityUid: 'steam:game:1145360',
            matchQuality: 'exact',
            platformEntityId: '1145360',
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

test('Tiger primary routes overview prompts through get-entity-overview', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
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
    assert.deepEqual(body.filters, {
      max_price_cents: 2000,
    });

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

test('Tiger primary clears stale entity switch hints on unrelated catalog prompts', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/search-catalog');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      tags: ['Indie'],
      limit: 20,
      sortBy: 'reviews',
      sortDirection: 'desc',
    });

    return jsonResponse({
      continuationToken: null,
      interpretedFilters: {
        developerQuery: null,
        minReviewScore: null,
        platforms: [],
        publisherQuery: null,
        query: null,
        releaseYear: null,
        tags: ['Indie'],
      },
      items: [
        {
          appid: 413150,
          name: 'Stardew Valley',
          platforms: ['windows', 'macos', 'linux'],
          releaseYear: 2016,
          reviewScore: 9,
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

  assert.equal(result.info.matchedIntent, 'catalog_search');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.contractResult?.contractName, 'searchCatalog');
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
      limit: 10,
      sortBy: 'momentum_score',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: 'breaking_out',
    });

    return jsonResponse({
      filtersApplied: ['sort_by: momentum_score', 'trend_type: breaking_out', 'timeframe: 7d'],
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

test('Tiger primary routes review-momentum filters through discoverMomentum', async (t) => {
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
      sortBy: 'reviews_added_7d',
      sortDirection: 'desc',
      timeframe: '7d',
      trendType: 'review_momentum',
    });

    return jsonResponse({
      filtersApplied: ['steam_deck: verified', 'sort_by: reviews_added_7d', 'trend_type: review_momentum'],
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
  assert.match(result.renderedText ?? '', /ELDEN RING NIGHTREIGN/);
});

test('Tiger primary does not misroute mixed similarity-plus-momentum prompts to discoverMomentum', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');
  setScopedFetch(t, async () => jsonResponse({ error: 'unsupported' }, 500));

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Games like Hades that are breaking out this week',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.notEqual(result.info.matchedIntent, 'momentum_discovery');
});

for (const prompt of [
  'Compare FromSoftware and Team Cherry by reviews',
  'Compare FromSoftware to Team Cherry by reviews',
  'How do FromSoftware and Team Cherry stack up on reviews?',
]) {
  test(`Tiger primary routes explicit compare prompts through Tiger compareEntities: ${prompt}`, async (t) => {
    setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
    setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

    setScopedFetch(t, async (url, init) => {
      if (url.pathname === '/v1/contracts/resolve-entities') {
        assert.ok(init?.body);
        const body = JSON.parse(String(init.body));

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
  });
}

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

  setScopedFetch(t, async (url, init) => {
    assert.ok(init?.body);
    const body = JSON.parse(String(init.body));

    if (url.pathname === '/v1/contracts/resolve-entities') {
      if (body.query === 'FromSoftwere') {
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

    assert.equal(url.pathname, '/v1/contracts/search-documents');
    assert.deepEqual(body.entityUids, ['game:steam:101']);

    return jsonResponse({
      entity: {
        displayName: 'Primeval',
        entityKind: 'game',
        entityUid: 'game:steam:101',
        platform: 'steam',
        platformEntityId: '101',
      },
      interpretedFilters: {
        endTime: '2026-04-04T00:00:00.000Z',
        entityUids: ['game:steam:101'],
        feedScopes: [],
        mode: 'topic_search',
        query: 'recent announcements Primeval',
        startTime: '2026-03-05T00:00:00.000Z',
      },
      items: [
        {
          appName: 'Primeval',
          appid: 101,
          bodyPreview: 'The team announced a closed playtest and refreshed the store page.',
          entityUid: 'game:steam:101',
          excerpt: 'Closed playtest announced alongside a store-page refresh.',
          feedLabel: 'Steam News',
          feedName: 'Steam',
          feedScope: 'steam_news',
          firstSeenAt: '2026-04-02T12:00:00.000Z',
          gid: 'news-1',
          matchReason: 'matched_exact_title',
          publishedAt: '2026-04-02T12:00:00.000Z',
          rank: 1,
          rankingReason: 'Exact title match with recent entity news.',
          sortTime: '2026-04-02T12:00:00.000Z',
          title: 'Primeval announces closed playtest',
          url: 'https://example.com/primeval-news',
        },
      ],
      latestItem: null,
      sufficientToAnswer: true,
    });
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Any recent announcements about Primeval?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'news_search');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts.at(-1)?.contractName, 'searchDocuments');
  assert.match(result.renderedText ?? '', /Primeval announces closed playtest/);
  assert.doesNotMatch(result.renderedText ?? '', /Which one did you mean/i);
  assert.doesNotMatch(result.renderedText ?? '', /Another likely match is Primeval Genesis \(game\)\./);
  assert.ok(result.followUpSuggestions?.some((suggestion) => suggestion.label.includes('Switch to Primeval Genesis')));
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

    assert.equal(url.pathname, '/v1/contracts/explain-changes');
    assert.deepEqual(body, {
      entityUid: 'game:steam:101',
      includeNews: true,
      limit: 10,
    });

    return jsonResponse({
      comparisonWindows: null,
      entity: {
        displayName: 'Primeval',
        entityKind: 'game',
        entityUid: 'game:steam:101',
        platform: 'steam',
        platformEntityId: '101',
      },
      mode: 'timeline',
      moments: [
        {
          changeTypes: ['build', 'storefront'],
          eventCount: 2,
          events: [],
          linkedNews: [],
          reasons: ['A coordinated store-page and build update landed together.'],
          sources: ['steam'],
          windowEnd: '2026-04-02T00:00:00.000Z',
          windowStart: '2026-04-01T00:00:00.000Z',
        },
      ],
      selectedMoment: null,
      sufficientToAnswer: true,
      summary: {
        countsByChangeType: {
          build: 1,
          storefront: 1,
        },
        countsBySource: {
          steam: 2,
        },
        eventCount: 2,
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
    prompt: 'What changed for Primeval this week?',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'change_explanation');
  assert.equal(result.info.route, 'primary_success');
  assert.equal(result.info.attempts.at(-1)?.contractName, 'explainChanges');
  assert.match(result.renderedText ?? '', /Primeval/);
  assert.doesNotMatch(result.renderedText ?? '', /Which one did you mean/i);
  assert.doesNotMatch(result.renderedText ?? '', /Another likely match is Primeval Genesis \(game\)\./);
  assert.ok(result.followUpSuggestions?.some((suggestion) => suggestion.label.includes('Switch to Primeval Genesis')));
});

test('Tiger primary lets users switch to the publisher alternative after an auto-selected company overview', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/v1/contracts/get-entity-overview');
    assert.ok(init?.body);
    assert.deepEqual(JSON.parse(String(init.body)), {
      entityKind: 'publisher',
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

test('Tiger primary keeps unsupported review-velocity compare prompts out of Tiger compare', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async () => {
    throw new Error('Tiger compare should not call query-api for unsupported review-velocity prompts.');
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Compare top 5 roguelites by review velocity and CCU',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'entity_compare');
  assert.equal(result.info.route, 'fallback_to_legacy');
  assert.equal(result.renderedText, null);
  assert.equal(result.info.attempts[0]?.contractName, 'compareEntities');
  assert.match(result.info.attempts[0]?.reason ?? '', /review-velocity/i);
});

test('Tiger primary keeps same-franchise semantic prompts out of Tiger semantic search', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async () => {
    throw new Error('Tiger semantic search should not run for unsupported same-franchise prompts.');
  });

  const result = await runTigerPrimaryEvaluation({
    isEvalRequest: true,
    prompt: 'Steam Deck games similar to Hades II from the same franchise',
    sessionContext: null,
    userId: 'user-1',
  });

  assert.equal(result.info.matchedIntent, 'semantic_search');
  assert.equal(result.info.route, 'fallback_to_legacy');
  assert.equal(result.renderedText, null);
  assert.equal(result.info.attempts[0]?.contractName, 'semanticSearch');
  assert.match(result.info.attempts[0]?.reason ?? '', /same-franchise/i);
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

test('Tiger primary can drill from ranked results into change lookups for the top item', async (t) => {
  setScopedEnv(t, 'CHAT_TIGER_PRIMARY_MODE', 'all');
  setScopedEnv(t, 'QUERY_API_BASE_URL', 'http://query-api.test');

  setScopedFetch(t, async (url, init) => {
    if (url.pathname === '/v1/contracts/resolve-entities') {
      assert.ok(init?.body);
      assert.match(String(init.body), /Counter-Strike 2/);
      return jsonResponse({
        items: [
          {
            displayName: 'Counter-Strike 2',
            entityKind: 'game',
            entityUid: 'game:steam:730',
            platform: 'steam',
            platformEntityId: '730',
            score: 120,
          },
        ],
        sufficientToAnswer: true,
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
