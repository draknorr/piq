import assert from 'node:assert/strict';
import test from 'node:test';

import { DataPlaneService } from './service.js';

function createService(): DataPlaneService {
  return new DataPlaneService({
    connectionString: 'postgres://localhost/test',
    maxPoolSize: 1,
    source: 'tiger',
    statementTimeoutMs: 1000,
  });
}

test('getUserContext returns Tiger-backed pins, alerts, and preferences', async () => {
  const service = createService();
  let receivedUserId: string | null = null;
  let receivedAlertLimit: number | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryUserContextPins = async (userId: string) => {
    receivedUserId = userId;
    return [{
      alertSettings: null,
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
    }];
  };
  (service as any).queryUserAlertPreferences = async () => ({
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
  });
  (service as any).queryUserContextAlerts = async (userId: string, limit: number) => {
    receivedUserId = userId;
    receivedAlertLimit = limit;
    return [{
      alertId: '22222222-2222-4222-8222-222222222222',
      alertType: 'review_surge',
      changePercent: 18.2,
      createdAt: '2026-04-03T01:00:00.000Z',
      currentValue: 155,
      description: 'Daily review velocity is materially above baseline.',
      entity: {
        displayName: 'Hades II',
        entityKind: 'game',
        entityUid: 'steam:game:1145350',
        platform: 'steam',
        platformEntityId: '1145350',
      },
      isRead: false,
      metricName: 'review_velocity',
      pinId: '11111111-1111-4111-8111-111111111111',
      previousValue: 96,
      readAt: null,
      severity: 'medium',
      title: 'Reviews accelerated for Hades II',
    }];
  };
  (service as any).queryUnreadAlertCount = async () => 1;

  const result = await service.getUserContext({
    includeAlertPreferences: true,
    includeAlerts: true,
    includePins: true,
    limitAlerts: 5,
    userId: '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(receivedUserId, '11111111-1111-4111-8111-111111111111');
  assert.equal(receivedAlertLimit, 5);
  assert.equal(result.totalPins, 1);
  assert.equal(result.totalAlerts, 1);
  assert.equal(result.unreadAlertCount, 1);
  assert.equal(result.pins[0]?.displayName, 'Hades II');
  assert.equal(result.alertPreferences?.source, 'stored');
  assert.deepEqual(result.provenance.tables.slice(0, 4), [
    'legacy.user_pins',
    'legacy.user_alerts',
    'legacy.user_alert_preferences',
    'legacy.user_pin_alert_settings',
  ]);
});

test('continueResultSet forwards searchCatalog continuations through the catalog contract', async () => {
  const service = createService();
  let receivedArgs: Record<string, unknown> | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).searchCatalog = async (args: Record<string, unknown>) => {
    receivedArgs = args;
    return {
      continuationToken: 'cursor-2',
      interpretedFilters: {
        developerQuery: null,
        genres: [],
        isFree: null,
        minCcu: null,
        minOwners: null,
        minReviewScore: null,
        minReviews: null,
        platforms: [],
        publisherQuery: null,
        query: 'roguelike',
        releaseYear: null,
        sortBy: 'relevance',
        sortDirection: 'desc',
        tags: [],
      },
      items: [{ appid: 367520, entityUid: 'game:steam:367520', isFree: false, name: 'Hollow Knight', ccuPeak: null, developers: [], ownersMidpoint: null, platforms: [], publishers: [], releaseDate: null, releaseYear: null, reviewScore: null, totalReviews: null }],
      provenance: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        source: 'tiger',
        tables: ['legacy.apps'],
      },
      sufficientToAnswer: true,
    };
  };

  const result = await service.continueResultSet({
    continuationToken: 'cursor-1',
    requestedCount: 3,
    sourceArgs: { query: 'roguelike' },
    sourceContract: 'searchCatalog',
  });

  assert.deepEqual(receivedArgs, {
    continuationToken: 'cursor-1',
    limit: 3,
    query: 'roguelike',
  });
  assert.equal(result.sourceContract, 'searchCatalog');
  assert.equal(result.continuationToken, 'cursor-2');
});

test('continueResultSet narrows semantic game continuations with bounded deltas', async () => {
  const service = createService();
  let receivedArgs: Record<string, unknown> | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).semanticSearch = async (args: Record<string, unknown>) => {
    receivedArgs = args;
    return {
      continuation_token: null,
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
  };

  const result = await service.continueResultSet({
    continuationToken: 'cursor-9',
    delta: {
      maxPriceCents: 2000,
      steamDeck: ['verified'],
    },
    requestedCount: 4,
    sourceArgs: {
      entityKind: 'game',
      filters: {
        max_price_cents: 4000,
      },
      mode: 'similarity',
      referenceQuery: 'Hades',
    },
    sourceContract: 'semanticSearch',
  });

  assert.deepEqual(receivedArgs, {
    continuationToken: 'cursor-9',
    entityKind: 'game',
    filters: {
      max_price_cents: 2000,
      steam_deck: ['verified'],
    },
    limit: 4,
    mode: 'similarity',
    referenceQuery: 'Hades',
  });
  assert.equal(result.sourceContract, 'semanticSearch');
  assert.equal(result.exhausted, true);
});

test('continueResultSet forwards discoverMomentum continuations with excludes and bounded deltas', async () => {
  const service = createService();
  let receivedArgs: Record<string, unknown> | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).discoverMomentum = async (args: Record<string, unknown>) => {
    receivedArgs = args;
    return {
      filtersApplied: ['sort_by: ccu_peak', 'timeframe: current', 'steam_deck: verified'],
      items: [
        {
          appid: 578080,
          ccuPeak: 880000,
          developerName: 'KRAFTON',
          entityUid: 'steam:game:578080',
          isFree: false,
          isSelfPublished: false,
          momentumScore: 92,
          name: 'PUBG: BATTLEGROUNDS',
          platformSupport: ['windows'],
          publisherName: 'KRAFTON',
          supportLevel: 'high',
          supportReasons: ['High active-player baseline remains intact.'],
          totalReviews: 2400000,
        },
      ],
      provenance: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        source: 'tiger',
        tables: ['legacy.apps', 'legacy.latest_daily_metrics'],
      },
      rankingDefinition: 'Peak CCU uses the latest 24-hour concurrent-player snapshot.',
      rankingLabel: 'Peak CCU',
      sufficientToAnswer: true,
      timeframe: 'current',
      timeframeLabel: 'Current snapshot',
    };
  };

  const result = await service.continueResultSet({
    delta: {
      maxPriceCents: 3000,
      steamDeck: ['verified'],
    },
    requestedCount: 2,
    sourceArgs: {
      excludeAppIds: [730, 570, 1091500],
      filters: {
        maxPriceCents: 5000,
      },
      sortBy: 'ccu_peak',
      timeframe: 'current',
    },
    sourceContract: 'discoverMomentum',
  });

  assert.deepEqual(receivedArgs, {
    excludeAppIds: [730, 570, 1091500],
    filters: {
      maxPriceCents: 3000,
      steamDeck: ['verified'],
    },
    limit: 2,
    sortBy: 'ccu_peak',
    timeframe: 'current',
  });
  assert.equal(result.sourceContract, 'discoverMomentum');
  assert.equal(result.exhausted, true);
});

test('discoverMomentum returns Tiger momentum rows as typed items', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryMomentumRows = async () => [
    {
      appid: 730,
      ccu_growth_30d_percent: 12,
      ccu_growth_7d_percent: 8,
      ccu_peak: 1500000,
      developer_name: 'Valve',
      discount_percent: 0,
      is_free: true,
      is_self_published: true,
      name: 'Counter-Strike 2',
      owners_midpoint: 100000000,
      platforms: 'windows',
      positive_percentage: 88,
      price_cents: 0,
      publisher_name: 'Valve',
      release_date: '2023-09-27',
      release_year: 2023,
      reviews_added_30d: 42000,
      reviews_added_7d: 9000,
      sentiment_delta: 1.4,
      total_reviews: 9000000,
      trend_direction: 'up',
      velocity_30d: 1400,
      velocity_7d: 1285,
      velocity_acceleration: 12,
    },
  ];
  const result = await service.discoverMomentum({
    filters: { isFree: true },
    sortBy: 'ccu_peak',
    timeframe: 'current',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.appid, 730);
  assert.equal(result.items[0]?.momentumScore, 9006);
  assert.equal(result.rankingLabel, 'Peak CCU');
  assert.equal(result.timeframe, 'current');
});

test('discoverMomentum returns sortDirection and 7d sentiment ranking details', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryMomentumRows = async () => [
    {
      appid: 2668510,
      ccu_growth_30d_percent: -12,
      ccu_growth_7d_percent: -6,
      ccu_peak: 4200,
      developer_name: 'Example Studio',
      discount_percent: 0,
      is_free: false,
      is_self_published: true,
      name: 'Example Game',
      owners_midpoint: 500000,
      platforms: 'windows',
      positive_percentage: 74,
      price_cents: 1999,
      publisher_name: 'Example Studio',
      release_date: '2025-01-15',
      release_year: 2025,
      reviews_added_30d: 900,
      reviews_added_7d: 240,
      sentiment_delta: -4.2,
      total_reviews: 18000,
      trend_direction: 'down',
      velocity_30d: 30,
      velocity_7d: 34,
      velocity_acceleration: -28,
    },
  ];

  const result = await service.discoverMomentum({
    filters: {
      maxSentimentDelta: -3,
      minReviewsAdded7d: 25,
    },
    sortBy: 'sentiment_delta',
    sortDirection: 'asc',
    timeframe: '7d',
  });

  assert.equal(result.sortDirection, 'asc');
  assert.match(result.rankingDefinition, /7-day baseline/i);
  assert.ok(result.filtersApplied.includes('max_sentiment_delta: -3'));
  assert.ok(result.filtersApplied.includes('min_reviews_added_7d: 25'));
});

test('buildSentimentDeltaExpression switches baselines with the requested window', () => {
  const service = createService();

  assert.match((service as any).buildSentimentDeltaExpression('7d'), /baseline7/);
  assert.match((service as any).buildSentimentDeltaExpression('30d'), /baseline30/);
  assert.match((service as any).buildSentimentDeltaExpression('current'), /baseline30/);
});

test('discoverMomentum excludes previously shown appids before slicing the next page', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryMomentumRows = async () => [
    {
      appid: 730,
      ccu_growth_30d_percent: 12,
      ccu_growth_7d_percent: 8,
      ccu_peak: 1500000,
      developer_name: 'Valve',
      discount_percent: 0,
      is_free: true,
      is_self_published: true,
      name: 'Counter-Strike 2',
      owners_midpoint: 100000000,
      platforms: 'windows,linux',
      positive_percentage: 88,
      price_cents: 0,
      publisher_name: 'Valve',
      release_date: '2023-09-27',
      release_year: 2023,
      reviews_added_30d: 42000,
      reviews_added_7d: 9000,
      sentiment_delta: 1.4,
      total_reviews: 9000000,
      trend_direction: 'up',
      velocity_30d: 1400,
      velocity_7d: 1285,
      velocity_acceleration: 12,
    },
    {
      appid: 570,
      ccu_growth_30d_percent: 4,
      ccu_growth_7d_percent: 2,
      ccu_peak: 600000,
      developer_name: 'Valve',
      discount_percent: 0,
      is_free: true,
      is_self_published: true,
      name: 'Dota 2',
      owners_midpoint: 80000000,
      platforms: 'windows,linux',
      positive_percentage: 82,
      price_cents: 0,
      publisher_name: 'Valve',
      release_date: '2013-07-09',
      release_year: 2013,
      reviews_added_30d: 14000,
      reviews_added_7d: 3200,
      sentiment_delta: 0.4,
      total_reviews: 2500000,
      trend_direction: 'stable',
      velocity_30d: 466,
      velocity_7d: 457,
      velocity_acceleration: 1,
    },
    {
      appid: 440,
      ccu_growth_30d_percent: 3,
      ccu_growth_7d_percent: 1,
      ccu_peak: 82000,
      developer_name: 'Valve',
      discount_percent: 0,
      is_free: true,
      is_self_published: true,
      name: 'Team Fortress 2',
      owners_midpoint: 50000000,
      platforms: 'windows,linux',
      positive_percentage: 84,
      price_cents: 0,
      publisher_name: 'Valve',
      release_date: '2007-10-10',
      release_year: 2007,
      reviews_added_30d: 2200,
      reviews_added_7d: 500,
      sentiment_delta: 0.2,
      total_reviews: 1100000,
      trend_direction: 'stable',
      velocity_30d: 73,
      velocity_7d: 71,
      velocity_acceleration: 0.5,
    },
  ];
  const result = await service.discoverMomentum({
    excludeAppIds: [730],
    limit: 2,
    sortBy: 'ccu_peak',
    timeframe: 'current',
  });

  assert.deepEqual(
    result.items.map((item) => item.appid),
    [570, 440]
  );
});

test('searchCatalog can answer facet-only taxonomy lookups without querying items', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).assertTigerSearchFiltersSupported = async () => undefined;
  (service as any).lookupCatalogFacets = async () => ({
    canonicalMatch: {
      name: 'Colony Sim',
      type: 'tags',
    },
    categories: [],
    genres: [],
    tags: ['Colony Sim', 'Base Building'],
  });

  const result = await service.searchCatalog({
    facetQuery: 'colony sim',
    includeFacets: ['tags'],
    limit: 5,
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.facets?.tags[0], 'Colony Sim');
  assert.equal(result.interpretedFilters.facetQuery, 'colony sim');
  assert.deepEqual(result.interpretedFilters.includeFacets, ['tags']);
  assert.equal(result.sufficientToAnswer, true);
});

test('discoverMomentum only checks Tiger tag backfill when tag filters are requested', async () => {
  const service = createService();
  let requiredRelations: string[] | null = null;

  (service as any).getBlockingTables = async (relations: string[]) => {
    requiredRelations = relations;
    return [];
  };

  await (service as any).assertTigerMomentumFiltersSupported({
    filters: { isFree: true },
    sortBy: 'ccu_peak',
  });
  assert.equal(requiredRelations, null);

  await (service as any).assertTigerMomentumFiltersSupported({
    filters: { tags: ['Horror'] },
    sortBy: 'reviews_added_30d',
  });
  assert.deepEqual(requiredRelations, ['app_steam_tags', 'steam_tags']);
});

test('searchChangeActivity narrows raw event queries by requested signal families', async () => {
  const service = createService();
  let receivedParams: Record<string, unknown> | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).querySearchChangeEventRows = async (params: Record<string, unknown>) => {
    receivedParams = params;
    return [];
  };
  (service as any).queryNewsRowsByGids = async () => [];

  const result = await service.searchChangeActivity({
    appTypes: ['game'],
    days: 30,
    signalFamilies: ['store-page', 'media'],
    sort: 'biggest-change',
    view: 'store-refreshes',
  });

  assert.deepEqual(receivedParams, {
    appTypes: ['game'],
    changeTypes: [
      'description_rewrite',
      'short_description_rewrite',
      'capsule_url_changed',
      'header_url_changed',
      'background_url_changed',
      'screenshot_added',
      'screenshot_removed',
      'screenshot_reordered',
      'trailer_added',
      'trailer_removed',
      'trailer_reordered',
      'trailer_thumbnail_changed',
    ],
    days: 30,
    limit: 800,
    query: null,
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.sufficientToAnswer, false);
});

test('searchDocuments returns explicit ranking reasons and usable previews', async () => {
  const service = createService();

  (service as any).getBlockingTables = async () => [];
  (service as any).querySearchDocumentRows = async () => [
    {
      app_name: 'Primeval',
      appid: 1234,
      app_name_hit: false,
      body_preview: null,
      content_preview: 'Primeval roadmap update — Community Announcements — Primeval',
      excerpt: 'Primeval roadmap update',
      feed_scope: 'community_announcements',
      feedlabel: 'Community Announcements',
      feedname: 'Steam News',
      first_seen_at: '2026-04-02T12:00:00.000Z',
      gid: 'gid-1',
      match_reason: 'matched_exact_title',
      published_at: '2026-04-02T12:00:00.000Z',
      rank: 0.92,
      ranking_reason: 'exact title match',
      sort_time: '2026-04-02T12:00:00.000Z',
      title: 'Primeval roadmap update',
      title_exact_hit: true,
      title_phrase_hit: true,
      url: 'https://store.steampowered.com/news/app/1234/view/1',
    },
  ];

  const result = await service.searchDocuments({
    mode: 'topic_search',
    query: 'Primeval roadmap update',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.matchReason, 'matched_exact_title');
  assert.equal(result.items[0]?.rankingReason, 'exact title match');
  assert.equal(result.items[0]?.excerpt, 'Primeval roadmap update');
  assert.equal(result.items[0]?.bodyPreview, 'Primeval roadmap update — Community Announcements — Primeval');
});

test('searchChangeActivity annotates strong commercial bursts with relevance evidence', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).querySearchChangeEventRows = async () => [
    {
      app_name: 'Primeval',
      app_type: 'game',
      appid: 1234,
      after_value: '1999',
      before_value: '2499',
      change_type: 'price_change',
      context: null,
      is_released: true,
      news_item_gid: 'gid-1',
      occurred_at: '2026-04-02T12:00:00.000Z',
      release_date: '2025-09-12',
      source: 'storefront',
    },
    {
      app_name: 'Primeval',
      app_type: 'game',
      appid: 1234,
      after_value: 'new capsule',
      before_value: 'old capsule',
      change_type: 'capsule_url_changed',
      context: null,
      is_released: true,
      news_item_gid: null,
      occurred_at: '2026-04-02T11:30:00.000Z',
      release_date: '2025-09-12',
      source: 'storefront',
    },
  ];
  (service as any).queryNewsRowsByGids = async () => [
    {
      feed_scope: 'community_announcements',
      feedlabel: 'Community Announcements',
      feedname: 'Steam News',
      first_seen_at: '2026-04-02T12:05:00.000Z',
      gid: 'gid-1',
      published_at: '2026-04-02T12:00:00.000Z',
      sort_time: '2026-04-02T12:00:00.000Z',
      title: 'Primeval storefront update',
      url: 'https://store.steampowered.com/news/app/1234/view/1',
    },
  ];

  const result = await service.searchChangeActivity({
    appTypes: ['game'],
    days: 30,
    sort: 'relevant',
    view: 'overview',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.burstStrength, 'high');
  assert.equal(result.items[0]?.strongestSignal, 'pricing');
  assert.equal(result.items[0]?.relevanceReason, 'an announcement-linked commercial or marketing update');
});

test('discoverChangePatterns narrows candidate activity reads to pattern-relevant signal families', async () => {
  const service = createService();
  let receivedParams: Record<string, unknown> | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).querySearchChangeEventRows = async (params: Record<string, unknown>) => {
    receivedParams = params;
    return [];
  };
  (service as any).queryNewsRowsByGids = async () => [];

  const result = await service.discoverChangePatterns({
    appTypes: ['game'],
    days: 30,
    limit: 8,
    pattern: 'marketing_push',
  });

  assert.deepEqual(receivedParams, {
    appTypes: ['game'],
    changeTypes: [
      'price_change',
      'discount_start',
      'discount_end',
      'dlc_references_changed',
      'package_references_changed',
      'news_published',
      'news_edited',
      'capsule_url_changed',
      'header_url_changed',
      'background_url_changed',
      'screenshot_added',
      'screenshot_removed',
      'screenshot_reordered',
      'trailer_added',
      'trailer_removed',
      'trailer_reordered',
      'trailer_thumbnail_changed',
      'description_rewrite',
      'short_description_rewrite',
    ],
    days: 30,
    limit: 800,
    query: null,
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.sufficientToAnswer, false);
});

test('compareEntities rejects fewer than two unique entities', async () => {
  const service = createService();
  (service as any).assertContractRuntime = async () => undefined;

  await assert.rejects(
    () =>
      service.compareEntities({
        entityUids: ['game:steam:1', 'game:steam:1'],
      }),
    /between 2 and 5 unique entityUids/
  );
});

test('rankEntities forwards expanded company ranking requests to the company ranking query', async () => {
  const service = createService();
  let receivedRequest: unknown = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryRankedCompanies = async (
    entityKind: string,
    request: unknown,
    limit: number,
    direction: string
  ) => {
    receivedRequest = { direction, entityKind, limit, request };
    return [];
  };

  await service.rankEntities({
    aggregateFilters: {
      minAverageReviewScore: 85,
      minGameCount: 5,
    },
    catalogFilters: {
      onSale: true,
      tags: ['Roguelike'],
    },
    entityKind: 'publisher',
    metric: 'game_count',
    releaseDays: 180,
  });

  assert.deepEqual(receivedRequest, {
    direction: 'DESC',
    entityKind: 'publisher',
    limit: 10,
    request: {
      aggregateFilters: {
        minAverageReviewScore: 85,
        minGameCount: 5,
      },
      catalogFilters: {
        onSale: true,
        tags: ['Roguelike'],
      },
      entityKind: 'publisher',
      metric: 'game_count',
      releaseDays: 180,
    },
  });
});

test('compareEntities rejects more than five unique entities', async () => {
  const service = createService();
  (service as any).assertContractRuntime = async () => undefined;

  await assert.rejects(
    () =>
      service.compareEntities({
        entityUids: [
          'game:steam:1',
          'game:steam:2',
          'game:steam:3',
          'game:steam:4',
          'game:steam:5',
          'game:steam:6',
        ],
      }),
    /between 2 and 5 unique entityUids/
  );
});

test('compareEntities returns current-state metrics, preserves requested metric order, and supports five peers', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).resolveCoreEntity = async (entityUid: string) => ({
    canonical_name:
      entityUid === 'game:steam:1'
        ? 'Hades'
        : entityUid === 'game:steam:2'
          ? 'Dead Cells'
          : entityUid === 'game:steam:3'
            ? 'Slay the Spire'
            : entityUid === 'game:steam:4'
              ? 'Risk of Rain 2'
              : 'Rogue Legacy 2',
    entity_kind: 'game',
    entity_uid: entityUid,
    platform: 'steam',
    platform_entity_id: entityUid.split(':').at(-1) ?? '0',
  });
  (service as any).queryComparedGames = async () =>
    new Map([
      [
        1,
        {
          ccu_peak: 25000,
          display_name: 'Hades',
          entity_id: 1,
          game_count: null,
          owners_midpoint: 1500000,
          release_year: 2020,
          review_score: 98,
          total_reviews: 250000,
        },
      ],
      [
        2,
        {
          ccu_peak: 18000,
          display_name: 'Dead Cells',
          entity_id: 2,
          game_count: null,
          owners_midpoint: 1200000,
          release_year: 2018,
          review_score: 97,
          total_reviews: 140000,
        },
      ],
      [
        3,
        {
          ccu_peak: 16000,
          display_name: 'Slay the Spire',
          entity_id: 3,
          game_count: null,
          owners_midpoint: 1800000,
          release_year: 2019,
          review_score: 97,
          total_reviews: 150000,
        },
      ],
      [
        4,
        {
          ccu_peak: 42000,
          display_name: 'Risk of Rain 2',
          entity_id: 4,
          game_count: null,
          owners_midpoint: 3000000,
          release_year: 2020,
          review_score: 93,
          total_reviews: 190000,
        },
      ],
      [
        5,
        {
          ccu_peak: 9000,
          display_name: 'Rogue Legacy 2',
          entity_id: 5,
          game_count: null,
          owners_midpoint: 700000,
          release_year: 2022,
          review_score: 90,
          total_reviews: 28000,
        },
      ],
    ]);

  const result = await service.compareEntities({
    entityUids: [
      'game:steam:1',
      'game:steam:2',
      'game:steam:3',
      'game:steam:4',
      'game:steam:5',
    ],
    metrics: ['total_reviews', 'review_score', 'ccu_peak'],
  });

  assert.equal(result.entityKind, 'game');
  assert.equal(result.platform, 'steam');
  assert.deepEqual(result.metrics, ['total_reviews', 'review_score', 'ccu_peak']);
  assert.deepEqual(
    result.highlights.map((item) => [item.metric, item.displayName]),
    [
      ['total_reviews', 'Hades'],
      ['review_score', 'Hades'],
      ['ccu_peak', 'Risk of Rain 2'],
    ]
  );
  assert.equal(result.items[0]?.displayName, 'Hades');
  assert.equal(result.items[1]?.displayName, 'Dead Cells');
  assert.equal(result.items[4]?.displayName, 'Rogue Legacy 2');
});

test('getEntityOverview returns company metrics and related games', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCompanyOverview = async () => ({
    app_type: null,
    appid: null,
    ccu_peak: 12000,
    developer_ids: [],
    developers: [],
    discount_percent: null,
    display_name: 'FromSoftware',
    entity_id: 3005,
    game_count: 7,
    is_free: null,
    is_released: null,
    owners_midpoint: 4000000,
    parent_appid: null,
    platforms: null,
    price_cents: null,
    publisher_ids: [],
    publishers: [],
    release_date: null,
    release_state: null,
    release_year: null,
    review_score: 94,
    total_reviews: 600000,
  });
  (service as any).queryEntityOverviewGames = async () => ([
    {
      appid: 1245620,
      name: 'ELDEN RING',
      owners_midpoint: 2500000,
      release_date: '2022-02-25',
      release_year: 2022,
      review_score: 94,
      total_reviews: 700000,
    },
  ]);

  const result = await service.getEntityOverview({
    entityKind: 'developer',
    gamesLimit: 5,
    gamesSortBy: 'reviews',
    platformEntityId: '3005',
  });

  assert.equal(result.entity.displayName, 'FromSoftware');
  assert.equal(result.entity.metrics.gameCount, 7);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0]?.name, 'ELDEN RING');
});

test('explainChanges before_after mode includes the selected moment and comparison windows', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'Hades',
    entity_kind: 'game',
    entity_uid: 'steam:game:1145360',
    platform: 'steam',
    platform_entity_id: '1145360',
  });
  (service as any).queryChangeEvents = async () => [
    {
      after_value: 'New trailer',
      before_value: null,
      change_type: 'trailer_added',
      context: null,
      id: 'event-1',
      news_item_gid: null,
      occurred_at: '2026-03-20T12:00:00.000Z',
      source: 'storefront',
    },
  ];
  (service as any).buildExplainMoments = () => [
    {
      directNewsGids: new Set<string>(),
      events: [
        {
          after_value: 'New trailer',
          before_value: null,
          change_type: 'trailer_added',
          context: null,
          id: 'event-1',
          news_item_gid: null,
          occurred_at: '2026-03-20T12:00:00.000Z',
          source: 'storefront',
        },
      ],
      linkedNews: [],
      windowEnd: new Date('2026-03-20T18:00:00.000Z'),
      windowStart: new Date('2026-03-20T12:00:00.000Z'),
    },
  ];
  (service as any).buildExplainComparisonWindows = async () => ({
    baseline30d: { ccuPeak: 100, discountPercent: 0, negativeReviews: 10, positiveReviews: 90, priceCents: 1999, reviewScore: 90, reviewScoreLabel: 'Very Positive', totalReviews: 100 },
    baseline7d: null,
    response1d: null,
    response30d: null,
    response7d: null,
  });

  const result = await service.explainChanges({
    entityUid: 'steam:game:1145360',
    includeNews: false,
    mode: 'before_after',
  });

  assert.equal(result.mode, 'before_after');
  assert.equal(result.selectedMoment?.eventCount, 1);
  assert.equal(result.comparisonWindows?.baseline30d?.reviewScoreLabel, 'Very Positive');
});

test('explainChanges before_after mode prefers the strongest change moment over the newest weak one', async () => {
  const service = createService();
  let selectedWindowStart: string | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'Primeval',
    entity_kind: 'game',
    entity_uid: 'steam:game:1234',
    platform: 'steam',
    platform_entity_id: '1234',
  });
  (service as any).queryChangeEvents = async () => [];
  (service as any).buildExplainMoments = () => [
    {
      directNewsGids: new Set<string>(),
      events: [
        {
          after_value: 'description updated',
          before_value: null,
          change_type: 'description_rewrite',
          context: null,
          id: 'weak-1',
          news_item_gid: null,
          occurred_at: '2026-04-02T15:00:00.000Z',
          source: 'storefront',
        },
      ],
      linkedNews: [],
      windowEnd: new Date('2026-04-02T15:00:00.000Z'),
      windowStart: new Date('2026-04-02T15:00:00.000Z'),
    },
    {
      directNewsGids: new Set<string>(),
      events: [
        {
          after_value: '1999',
          before_value: '2499',
          change_type: 'price_change',
          context: null,
          id: 'strong-1',
          news_item_gid: null,
          occurred_at: '2026-03-28T13:00:00.000Z',
          source: 'storefront',
        },
        {
          after_value: 'new trailer',
          before_value: null,
          change_type: 'trailer_added',
          context: null,
          id: 'strong-2',
          news_item_gid: null,
          occurred_at: '2026-03-28T12:30:00.000Z',
          source: 'storefront',
        },
        {
          after_value: 'header',
          before_value: 'old header',
          change_type: 'header_url_changed',
          context: null,
          id: 'strong-3',
          news_item_gid: null,
          occurred_at: '2026-03-28T12:10:00.000Z',
          source: 'storefront',
        },
        {
          after_value: 'background',
          before_value: 'old background',
          change_type: 'background_url_changed',
          context: null,
          id: 'strong-4',
          news_item_gid: null,
          occurred_at: '2026-03-28T12:00:00.000Z',
          source: 'storefront',
        },
      ],
      linkedNews: [],
      windowEnd: new Date('2026-03-28T13:00:00.000Z'),
      windowStart: new Date('2026-03-28T12:00:00.000Z'),
    },
  ];
  (service as any).buildExplainComparisonWindows = async (_appid: number, startTime: Date) => {
    selectedWindowStart = startTime.toISOString();
    return {
      baseline30d: null,
      baseline7d: null,
      response1d: null,
      response30d: null,
      response7d: null,
    };
  };

  const result = await service.explainChanges({
    entityUid: 'steam:game:1234',
    includeNews: false,
    mode: 'before_after',
  });

  assert.equal(result.selectedMoment?.eventCount, 4);
  assert.equal(selectedWindowStart, '2026-03-28T12:00:00.000Z');
  assert.equal(result.summary.strongestMomentStrength, 'high');
});
