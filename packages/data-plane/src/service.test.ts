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

function createEntityRow(params: {
  ccu_peak: number | null;
  display_name: string;
  entity_id: number;
  match_quality: 'exact' | 'prefix' | 'substring' | 'fuzzy';
  match_rank?: number | null;
  match_source?: string | null;
  matched_name?: string;
  owners_midpoint: number | null;
  resolution_tier?: string | null;
  review_score: number | null;
  total_reviews: number | null;
  game_count?: number | null;
  release_year?: number | null;
}): Record<string, unknown> {
  return {
    ccu_peak: params.ccu_peak,
    display_name: params.display_name,
    entity_id: params.entity_id,
    game_count: params.game_count ?? null,
    match_quality: params.match_quality,
    match_rank: params.match_rank ?? null,
    match_source: params.match_source ?? 'legacy_name',
    matched_name: params.matched_name ?? params.display_name,
    owners_midpoint: params.owners_midpoint,
    release_year: params.release_year ?? null,
    resolution_tier: params.resolution_tier ?? null,
    review_score: params.review_score,
    similarity_score: 0.9,
    total_reviews: params.total_reviews,
  };
}

function createSearchDocumentRow(params: {
  appName: string;
  appid: number;
  content_preview: string | null;
  excerpt: string | null;
  feed_scope: string;
  feedlabel: string | null;
  feedname: string | null;
  first_seen_at: string;
  gid: string;
  match_reason:
    | 'matched_app_name'
    | 'matched_exact_title'
    | 'matched_title_phrase'
    | 'matched_topic_terms'
    | 'recent_entity_news';
  published_at: string | null;
  rank: number;
  ranking_reason: string | null;
  sort_time: string;
  title: string | null;
  title_exact_hit: boolean;
  title_phrase_hit: boolean;
  url: string;
}): Record<string, unknown> {
  return {
    app_name: params.appName,
    appid: params.appid,
    app_name_hit: false,
    body_preview: null,
    content_preview: params.content_preview,
    excerpt: params.excerpt,
    feed_scope: params.feed_scope,
    feedlabel: params.feedlabel,
    feedname: params.feedname,
    first_seen_at: params.first_seen_at,
    gid: params.gid,
    match_reason: params.match_reason,
    published_at: params.published_at,
    rank: params.rank,
    ranking_reason: params.ranking_reason,
    sort_time: params.sort_time,
    title: params.title,
    title_exact_hit: params.title_exact_hit,
    title_phrase_hit: params.title_phrase_hit,
    url: params.url,
  };
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
      ccu_growth_30d_percent: '12',
      ccu_growth_7d_percent: '8',
      ccu_peak: '1500000',
      developer_name: 'Valve',
      discount_percent: '0',
      is_free: true,
      is_self_published: true,
      name: 'Counter-Strike 2',
      owners_midpoint: 100000000,
      platforms: 'windows',
      positive_percentage: '88.4',
      price_cents: '0',
      publisher_name: 'Valve',
      release_date: '2023-09-27',
      release_year: '2023',
      reviews_added_30d: '42000',
      reviews_added_7d: '9000',
      sentiment_delta: '1.4',
      total_reviews: '9000000',
      trend_direction: 'up',
      velocity_30d: '1400',
      velocity_7d: '1285',
      velocity_acceleration: '12',
    },
  ];
  (service as any).queryMomentumSparklineData = async () => new Map();
  const result = await service.discoverMomentum({
    filters: { isFree: true },
    sortBy: 'ccu_peak',
    timeframe: 'current',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.appid, 730);
  assert.equal(typeof result.items[0]?.reviewPercentage, 'number');
  assert.equal(result.items[0]?.reviewPercentage, 88.4);
  assert.equal(result.items[0]?.momentumScore, 9006);
  assert.equal(result.rankingLabel, 'Peak CCU');
  assert.equal(result.timeframe, 'current');
});

test('discoverMomentum attaches CCU sparkline data for current-player answers', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryMomentumRows = async () => [
    {
      appid: 730,
      ccu_growth_30d_percent: '12',
      ccu_growth_7d_percent: '8',
      ccu_peak: '1500000',
      developer_name: 'Valve',
      discount_percent: '0',
      is_free: true,
      is_self_published: true,
      name: 'Counter-Strike 2',
      owners_midpoint: 100000000,
      platforms: 'windows',
      positive_percentage: '88.4',
      price_cents: '0',
      publisher_name: 'Valve',
      release_date: '2023-09-27',
      release_year: '2023',
      reviews_added_30d: '42000',
      reviews_added_7d: '9000',
      sentiment_delta: '1.4',
      total_reviews: '9000000',
      trend_direction: 'up',
      velocity_30d: '1400',
      velocity_7d: '1285',
      velocity_acceleration: '12',
    },
  ];
  (service as any).queryMomentumSparklineData = async () => new Map([
    [730, [1200000, 1275000, 1310000, 1404982]],
  ]);

  const result = await service.discoverMomentum({
    sortBy: 'ccu_peak',
    timeframe: 'current',
  });

  assert.deepEqual(result.items[0]?.ccuSparkline, [1200000, 1275000, 1310000, 1404982]);
});

test('discoverMomentum skips sparkline enrichment for non-current windows', async () => {
  const service = createService();
  let sparklineCalled = false;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryMomentumRows = async () => [
    {
      appid: 1145360,
      ccu_growth_30d_percent: 30,
      ccu_growth_7d_percent: 18,
      ccu_peak: 50000,
      developer_name: 'Supergiant Games',
      discount_percent: 0,
      is_free: false,
      is_self_published: true,
      name: 'Hades II',
      owners_midpoint: 5000000,
      platforms: 'windows',
      positive_percentage: 96,
      price_cents: 2999,
      publisher_name: 'Supergiant Games',
      release_date: '2024-05-06',
      release_year: 2024,
      reviews_added_30d: 5200,
      reviews_added_7d: 2400,
      sentiment_delta: 2.2,
      total_reviews: 75000,
      trend_direction: 'up',
      velocity_30d: 173,
      velocity_7d: 342,
      velocity_acceleration: 40,
    },
  ];
  (service as any).queryMomentumSparklineData = async () => {
    sparklineCalled = true;
    return new Map();
  };

  const result = await service.discoverMomentum({
    sortBy: 'reviews_added_7d',
    timeframe: '7d',
  });

  assert.equal(sparklineCalled, false);
  assert.equal(result.items[0]?.ccuSparkline, undefined);
});

test('discoverMomentum aligns support reasons with the visible review window and drops zero-ccu evidence', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryMomentumRows = async () => [
    {
      appid: 777,
      ccu_growth_30d_percent: '0',
      ccu_growth_7d_percent: '0',
      ccu_peak: '0',
      developer_name: 'Example Studio',
      discount_percent: '0',
      is_free: false,
      is_self_published: true,
      name: 'Example Horror',
      owners_midpoint: 100000,
      platforms: 'windows',
      positive_percentage: '81.2',
      price_cents: '1999',
      publisher_name: 'Example Studio',
      release_date: '2025-10-10',
      release_year: '2025',
      reviews_added_30d: '102',
      reviews_added_7d: '6',
      sentiment_delta: '0.4',
      total_reviews: '3200',
      trend_direction: 'up',
      velocity_30d: '3.4',
      velocity_7d: '0.9',
      velocity_acceleration: '14',
    },
  ];

  const result = await service.discoverMomentum({
    sortBy: 'reviews_added_30d',
    timeframe: '30d',
  });

  assert.equal(result.items[0]?.ccuPeak, null);
  assert.match(result.items[0]?.supportReasons[0] ?? '', /102 reviews added over 30d/i);
  assert.doesNotMatch((result.items[0]?.supportReasons ?? []).join(' '), /Peak CCU/i);
});

test('semantic similarity broadens retrieval windows when prompts add narrowing filters', () => {
  const service = createService() as any;

  assert.equal(
    service.resolveSemanticGameSearchLimit(undefined, 0, 6),
    30
  );
  assert.equal(
    service.resolveSemanticGameSearchLimit({
      review_comparison: 'better_only',
      steam_deck: ['verified'],
    }, 0, 6),
    72
  );
  assert.equal(service.resolveSemanticSimilarityThreshold(undefined), 0.16);
  assert.equal(
    service.resolveSemanticSimilarityThreshold({
      review_comparison: 'better_only',
      steam_deck: ['verified'],
    }),
    0.08
  );
});

test('semantic similarity returns close alternatives when strict comparison filters leave too few exact matches', async () => {
  const service = createService() as any;

  service.queryTigerSemanticGameProfile = async () => ({
    appid: 1145360,
    developerIds: [1],
    genres: ['Action', 'RPG'],
    isFree: false,
    name: 'Hades',
    platforms: ['windows'],
    priceCents: 2499,
    publisherIds: [2],
    reviewPercentage: 97,
    tags: ['Action', 'Roguelike', 'Indie', 'Singleplayer'],
    totalReviews: 250000,
    type: 'game',
  });
  service.queryTigerSemanticGameCandidates = async () => [
    {
      appid: 413150,
      current_price_cents: 1499,
      developer_ids: [11],
      genres: ['Indie', 'RPG', 'Simulation'],
      is_free: false,
      name: 'Stardew Valley',
      platforms: 'windows,macos,linux',
      positive_percentage: 98.5,
      publisher_ids: [12],
      steam_deck_category: 'verified',
      tags: ['Great Soundtrack', 'Indie', 'RPG', 'Singleplayer'],
      total_reviews: 990611,
      type: 'game',
    },
    {
      appid: 367520,
      current_price_cents: 1499,
      developer_ids: [21],
      genres: ['Action', 'RPG'],
      is_free: false,
      name: 'Hollow Knight',
      platforms: 'windows,macos,linux',
      positive_percentage: 96.9,
      publisher_ids: [22],
      steam_deck_category: 'verified',
      tags: ['Action', 'Indie', 'Metroidvania', 'Singleplayer'],
      total_reviews: 355000,
      type: 'game',
    },
    {
      appid: 588650,
      current_price_cents: 2499,
      developer_ids: [31],
      genres: ['Action', 'RPG'],
      is_free: false,
      name: 'Dead Cells',
      platforms: 'windows,macos,linux',
      positive_percentage: 96.4,
      publisher_ids: [32],
      steam_deck_category: 'verified',
      tags: ['Action', 'Indie', 'Roguelike', 'Singleplayer'],
      total_reviews: 145000,
      type: 'game',
    },
  ];

  const result = await service.runTigerGameSimilaritySearch(
    {
      entityKind: 'game',
      filters: {
        review_comparison: 'better_only',
      },
      limit: 8,
      mode: 'similarity',
      referenceQuery: 'Hades',
    },
    {
      id: 1145360,
      metrics: {
        developer_ids: [1],
        price_cents: 2499,
        publisher_ids: [2],
        review_percentage: 97,
        total_reviews: 250000,
      },
      name: 'Hades',
      type: 'game',
    }
  );

  assert.deepEqual(
    result.results?.map((item: { name: string }) => item.name),
    ['Stardew Valley']
  );
  assert.deepEqual(
    result.close_alternatives?.map((item: { name: string }) => item.name),
    ['Hollow Knight', 'Dead Cells']
  );
  assert.match(result.close_alternatives_reason ?? '', /stricter higher-review cutoff/i);
  assert.equal(result.sufficient_to_answer, true);
});

test('semantic similarity keeps adding close alternatives when exact matches stay thin relative to the requested list', async () => {
  const service = createService() as any;

  service.queryTigerSemanticGameProfile = async () => ({
    appid: 1145360,
    developerIds: [1],
    genres: ['Action', 'RPG'],
    isFree: false,
    name: 'Hades',
    platforms: ['windows'],
    priceCents: 2499,
    publisherIds: [2],
    reviewPercentage: 97,
    tags: ['Action', 'Roguelike', 'Indie', 'Singleplayer'],
    totalReviews: 250000,
    type: 'game',
  });
  service.queryTigerSemanticGameCandidates = async () => [
    {
      appid: 413150,
      current_price_cents: 1499,
      developer_ids: [11],
      genres: ['Indie', 'RPG', 'Simulation'],
      is_free: false,
      name: 'Stardew Valley',
      platforms: 'windows,macos,linux',
      positive_percentage: 98.5,
      publisher_ids: [12],
      steam_deck_category: 'verified',
      tags: ['Great Soundtrack', 'Indie', 'RPG', 'Singleplayer'],
      total_reviews: 990611,
      type: 'game',
    },
    {
      appid: 1118200,
      current_price_cents: 999,
      developer_ids: [13],
      genres: ['Action', 'Indie', 'Sandbox'],
      is_free: false,
      name: 'People Playground',
      platforms: 'windows',
      positive_percentage: 98.5,
      publisher_ids: [14],
      steam_deck_category: 'playable',
      tags: ['Action', 'Indie', 'Singleplayer', 'Sandbox'],
      total_reviews: 308115,
      type: 'game',
    },
    {
      appid: 620,
      current_price_cents: 999,
      developer_ids: [15],
      genres: ['Action', 'Adventure'],
      is_free: false,
      name: 'Portal 2',
      platforms: 'windows,macos,linux',
      positive_percentage: 98.7,
      publisher_ids: [16],
      steam_deck_category: 'verified',
      tags: ['Action', 'Atmospheric', 'Singleplayer', 'Story Rich'],
      total_reviews: 456304,
      type: 'game',
    },
    {
      appid: 367520,
      current_price_cents: 1499,
      developer_ids: [21],
      genres: ['Action', 'RPG'],
      is_free: false,
      name: 'Hollow Knight',
      platforms: 'windows,macos,linux',
      positive_percentage: 96.9,
      publisher_ids: [22],
      steam_deck_category: 'verified',
      tags: ['Action', 'Indie', 'Metroidvania', 'Singleplayer'],
      total_reviews: 355000,
      type: 'game',
    },
    {
      appid: 588650,
      current_price_cents: 2499,
      developer_ids: [31],
      genres: ['Action', 'RPG'],
      is_free: false,
      name: 'Dead Cells',
      platforms: 'windows,macos,linux',
      positive_percentage: 96.4,
      publisher_ids: [32],
      steam_deck_category: 'verified',
      tags: ['Action', 'Indie', 'Roguelike', 'Singleplayer'],
      total_reviews: 145000,
      type: 'game',
    },
  ];

  const result = await service.runTigerGameSimilaritySearch(
    {
      entityKind: 'game',
      filters: {
        review_comparison: 'better_only',
      },
      limit: 8,
      mode: 'similarity',
      referenceQuery: 'Hades',
    },
    {
      id: 1145360,
      metrics: {
        developer_ids: [1],
        price_cents: 2499,
        publisher_ids: [2],
        review_percentage: 97,
        total_reviews: 250000,
      },
      name: 'Hades',
      type: 'game',
    }
  );

  assert.deepEqual(
    result.results?.map((item: { name: string }) => item.name),
    ['People Playground', 'Stardew Valley', 'Portal 2']
  );
  assert.deepEqual(
    result.close_alternatives?.map((item: { name: string }) => item.name),
    ['Hollow Knight', 'Dead Cells']
  );
});

test('discoverMomentum forwards similarity seed appids to queryMomentumRows', async () => {
  const service = createService();
  let receivedArgs: Record<string, unknown> | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryMomentumRows = async (args: Record<string, unknown>) => {
    receivedArgs = args;
    return [];
  };

  await service.discoverMomentum({
    appids: [1145360, 774361, 632360],
    limit: 5,
    sortBy: 'reviews_added_7d',
    timeframe: '7d',
  });

  assert.deepEqual((receivedArgs as { appids?: number[] } | null)?.appids, [1145360, 774361, 632360]);
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
  (service as any).queryMomentumSparklineData = async () => new Map();
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
    tags: ['Base Building', 'Resource Management'],
  });

  const result = await service.searchCatalog({
    facetQuery: 'colony sim',
    includeFacets: ['tags'],
    limit: 5,
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.facets?.tags[0], 'Base Building');
  assert.equal(result.interpretedFilters.facetQuery, 'colony sim');
  assert.deepEqual(result.interpretedFilters.includeFacets, ['tags']);
  assert.equal(result.sufficientToAnswer, true);
});

test('getRelatedEntities returns DLC rows with source context', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).getBlockingTables = async () => [];
  (service as any).queryGameOverview = async () => ({
    display_name: 'ELDEN RING',
    review_score: 95,
    total_reviews: 820000,
  });
  (service as any).queryRelatedDlcRows = async () => [
    {
      appid: 2778580,
      franchise_name: null,
      name: 'ELDEN RING Shadow of the Erdtree',
      positive_percentage: 94,
      review_score: 94,
      steam_deck_category: 'verified',
      total_reviews: 54000,
      release_date: '2024-06-20',
      release_year: 2024,
    },
  ];
  (service as any).queryFranchiseNamesByApp = async () => [];
  (service as any).querySteamDeckCategoryByApp = async () => 'verified';

  const result = await service.getRelatedEntities({
    limit: 10,
    relationKind: 'dlc',
    sourceAppid: 1245620,
  });

  assert.equal(result.source.displayName, 'ELDEN RING');
  assert.equal(result.source.appid, 1245620);
  assert.equal(result.matchMode, 'structured_relation');
  assert.equal(result.items[0]?.appid, 2778580);
  assert.equal(result.items[0]?.name, 'ELDEN RING Shadow of the Erdtree');
  assert.equal(result.sufficientToAnswer, true);
});

test('getRelatedEntities falls back to apps.parent_appid when DLC tables are unavailable', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).getBlockingTables = async (relations: string[]) =>
    relations.includes('app_dlc') ? ['legacy.app_dlc'] : [];
  (service as any).queryGameOverview = async () => ({
    developer_ids: [1],
    display_name: 'ELDEN RING',
    publisher_ids: [10],
    review_score: 95,
    total_reviews: 820000,
  });
  (service as any).queryRelatedDlcRowsFromApps = async () => [
    {
      appid: 2778580,
      franchise_name: null,
      name: 'ELDEN RING Shadow of the Erdtree',
      positive_percentage: 94,
      review_score: 94,
      steam_deck_category: 'verified',
      total_reviews: 54000,
      release_date: '2024-06-20',
      release_year: 2024,
    },
  ];
  (service as any).querySteamDeckCategoryByApp = async () => 'verified';

  const result = await service.getRelatedEntities({
    limit: 10,
    relationKind: 'dlc',
    sourceAppid: 1245620,
  });

  assert.equal(result.matchMode, 'parent_appid');
  assert.deepEqual(result.provenance.tables, [
    'legacy.apps',
    'legacy.latest_daily_metrics',
    'legacy.app_steam_deck',
  ]);
  assert.equal(result.items[0]?.appid, 2778580);
});

test('getRelatedEntities returns a safe empty DLC response when relation ids are unavailable on the active source', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).getBlockingTables = async (relations: string[]) =>
    relations.includes('app_dlc') ? ['legacy.app_dlc'] : [];
  (service as any).queryGameOverview = async () => ({
    developer_ids: [1],
    display_name: 'ELDEN RING',
    publisher_ids: [10],
    review_score: 95,
    total_reviews: 820000,
  });
  (service as any).queryRelatedDlcRowsFromApps = async () => [];
  (service as any).queryRelatedDlcAppids = async () => {
    throw new Error('queryRelatedDlcAppids should not be called when app_dlc is unavailable');
  };
  (service as any).querySteamDeckCategoryByApp = async () => 'verified';

  const result = await service.getRelatedEntities({
    limit: 10,
    relationKind: 'dlc',
    sourceAppid: 1245620,
  });

  assert.equal(result.matchMode, 'parent_appid');
  assert.equal(result.items.length, 0);
  assert.equal(result.sufficientToAnswer, false);
  assert.deepEqual(result.provenance.tables, [
    'legacy.apps',
    'legacy.latest_daily_metrics',
    'legacy.app_steam_deck',
  ]);
});

test('getRelatedEntities falls back to title-family matches when franchise tables are unavailable', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).getBlockingTables = async (relations: string[]) =>
    relations.includes('app_franchises') ? ['legacy.app_franchises'] : [];
  (service as any).queryGameOverview = async () => ({
    developer_ids: [77],
    display_name: 'Hades II',
    publisher_ids: [77],
    review_score: 94,
    total_reviews: 54000,
  });
  (service as any).queryRelatedTitleFamilyRows = async () => [
    {
      appid: 1145360,
      franchise_name: null,
      name: 'Hades',
      positive_percentage: 98,
      review_score: 98,
      steam_deck_category: 'verified',
      total_reviews: 275000,
      release_date: '2020-09-17',
      release_year: 2020,
    },
  ];
  (service as any).querySteamDeckCategoryByApp = async () => 'playable';

  const result = await service.getRelatedEntities({
    filters: { steamDeck: ['verified'] },
    limit: 10,
    relationKind: 'franchise_games',
    sourceAppid: 1145350,
  });

  assert.equal(result.matchMode, 'title_family');
  assert.deepEqual(result.provenance.tables, [
    'legacy.apps',
    'legacy.latest_daily_metrics',
    'legacy.app_publishers',
    'legacy.app_developers',
    'legacy.app_steam_deck',
  ]);
  assert.equal(result.items[0]?.name, 'Hades');
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
    allHistory: false,
    appids: [],
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

test('searchChangeActivity passes app filters and all-history mode to raw event queries', async () => {
  const service = createService();
  let receivedParams: Record<string, unknown> | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).querySearchChangeEventRows = async (params: Record<string, unknown>) => {
    receivedParams = params;
    return [];
  };
  (service as any).queryNewsRowsByGids = async () => [];

  const result = await service.searchChangeActivity({
    allHistory: true,
    appids: [730, 730, -1, 440],
    days: 30,
    view: 'all-activity',
  });

  assert.deepEqual(receivedParams, {
    allHistory: true,
    appids: [730, 440],
    appTypes: [],
    changeTypes: [],
    days: 30,
    limit: 800,
    query: null,
  });
  assert.deepEqual(result.interpretedFilters.appids, [730, 440]);
  assert.equal(result.interpretedFilters.allHistory, true);
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

test('searchDocuments uses lexical fallback when topic search returns no rows', async () => {
  const service = createService();

  (service as any).getBlockingTables = async () => [];
  (service as any).querySearchDocumentRows = async () => [];
  (service as any).querySearchDocumentRowsLexicalFallback = async () => [
    createSearchDocumentRow({
      appName: 'Primeval',
      appid: 1234,
      content_preview: 'Primeval roadmap update — Community Announcements — Primeval',
      excerpt: 'Primeval roadmap update',
      feed_scope: 'community_announcements',
      feedlabel: 'Community Announcements',
      feedname: 'Steam News',
      first_seen_at: '2026-04-02T12:00:00.000Z',
      gid: 'gid-lex-1',
      match_reason: 'matched_title_phrase',
      published_at: '2026-04-02T12:00:00.000Z',
      rank: 0.35,
      ranking_reason: 'lexical title fallback',
      sort_time: '2026-04-02T12:00:00.000Z',
      title: 'Primeval roadmap update',
      title_exact_hit: false,
      title_phrase_hit: true,
      url: 'https://store.steampowered.com/news/app/1234/view/1',
    }),
  ];

  const result = await service.searchDocuments({
    mode: 'topic_search',
    query: 'Primeval roadmap update',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.matchReason, 'matched_title_phrase');
  assert.equal(result.items[0]?.rankingReason, 'lexical title fallback');
  assert.equal(result.items[0]?.appName, 'Primeval');
  assert.equal(result.sufficientToAnswer, true);
});

test('resolveEntities prefers lexical exact hits and deduplicates duplicate entity rows', async () => {
  const service = createService();
  const receivedCalls: string[] = [];

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async () => {
    receivedCalls.push('queryCanonicalEntities');
    return [];
  };
  (service as any).queryGames = async () => {
    receivedCalls.push('queryGames');
    return [
      createEntityRow({
        ccu_peak: 22000,
        display_name: 'Assetto Corsa',
        entity_id: 201,
        match_quality: 'fuzzy',
        owners_midpoint: 1250000,
        release_year: 2014,
        review_score: 91,
        total_reviews: 120000,
      }),
      createEntityRow({
        ccu_peak: 8000,
        display_name: 'RaceRoom Racing Experience',
        entity_id: 202,
        match_quality: 'fuzzy',
        owners_midpoint: 300000,
        release_year: 2013,
        review_score: 87,
        total_reviews: 50000,
      }),
    ];
  };
  (service as any).queryGamesLexical = async () => {
    receivedCalls.push('queryGamesLexical');
    return [
      createEntityRow({
        ccu_peak: 22000,
        display_name: 'Assetto Corsa',
        entity_id: 201,
        match_quality: 'exact',
        owners_midpoint: 1250000,
        release_year: 2014,
        review_score: 91,
        total_reviews: 120000,
      }),
    ];
  };
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  const result = await service.resolveEntities({
    entityKinds: ['game'],
    query: 'assetto corsa',
  });

  assert.deepEqual(receivedCalls, ['queryCanonicalEntities', 'queryGames', 'queryGamesLexical']);
  assert.equal(result.entities.length, 2);
  assert.equal(result.entities[0]?.displayName, 'Assetto Corsa');
  assert.equal(result.entities[0]?.matchQuality, 'exact');
  assert.equal(result.entities[0]?.confidence, 0.99);
  assert.equal(result.entities[1]?.displayName, 'RaceRoom Racing Experience');
  assert.equal(result.ambiguity.requiresClarification, false);
});

test('resolveEntities prefers canonical alias matches before fuzzy legacy rows and preserves game clarification', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async () => [
    createEntityRow({
      ccu_peak: 112000,
      display_name: 'Counter-Strike 2',
      entity_id: 730,
      match_quality: 'exact',
      match_rank: 1,
      matched_name: 'Counter Strike 2',
      owners_midpoint: 25000000,
      release_year: 2023,
      review_score: 88,
      total_reviews: 2200000,
    }),
    createEntityRow({
      ccu_peak: 1200,
      display_name: 'Counter-Strike Nexon',
      entity_id: 273110,
      match_quality: 'fuzzy',
      match_rank: 5,
      matched_name: 'Counter-Strike Nexon',
      owners_midpoint: 250000,
      release_year: 2014,
      review_score: 65,
      total_reviews: 15000,
    }),
  ];
  (service as any).queryGames = async () => [
    createEntityRow({
      ccu_peak: 98000,
      display_name: 'Counter-Strike: Global Offensive',
      entity_id: 740,
      match_quality: 'fuzzy',
      owners_midpoint: 40000000,
      release_year: 2012,
      review_score: 86,
      total_reviews: 9000000,
    }),
  ];
  (service as any).queryGamesLexical = async () => [];
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  const result = await service.resolveEntities({
    entityKinds: ['game'],
    query: 'counter strike 2',
  });

  assert.equal(result.entities[0]?.displayName, 'Counter-Strike 2');
  assert.equal(result.entities[0]?.matchedName, 'Counter Strike 2');
  assert.equal(result.entities[0]?.matchQuality, 'exact');
  assert.ok(result.entities[0]?.confidence && result.entities[0].confidence > 0.99);
  assert.equal(result.ambiguity.requiresClarification, false);
});

test('resolveEntities chat_strict keeps clarification when multiple games survive in the best lexical tier', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async () => [
    createEntityRow({
      ccu_peak: 42000,
      display_name: 'Prey',
      entity_id: 480490,
      match_quality: 'exact',
      match_rank: 0,
      match_source: 'canonical_name',
      owners_midpoint: 2500000,
      release_year: 2017,
      resolution_tier: 'canonical_exact',
      review_score: 82,
      total_reviews: 41000,
    }),
    createEntityRow({
      ccu_peak: 1200,
      display_name: 'Prey',
      entity_id: 3970,
      match_quality: 'exact',
      match_rank: 0,
      match_source: 'canonical_name',
      owners_midpoint: 350000,
      release_year: 2006,
      resolution_tier: 'canonical_exact',
      review_score: 90,
      total_reviews: 7000,
    }),
  ];
  (service as any).queryGames = async () => [];
  (service as any).queryGamesLexical = async () => [];
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  const result = await service.resolveEntities({
    entityKinds: ['game'],
    query: 'Prey',
    resolutionMode: 'chat_strict',
  });

  assert.equal(result.entities.length, 2);
  assert.equal(result.ambiguity.bestTier, 'canonical_exact');
  assert.equal(result.ambiguity.bestTierCount, 2);
  assert.equal(result.ambiguity.requiresClarification, true);
  assert.equal(result.entities[0]?.matchSource, 'canonical_name');
  assert.equal(result.entities[0]?.resolutionTier, 'canonical_exact');
});

test('resolveEntities chat_strict paginates ranked game candidates without reordering tiers', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async () => [
    createEntityRow({
      ccu_peak: 9000,
      display_name: 'Warframe',
      entity_id: 230410,
      match_quality: 'prefix',
      match_rank: 3,
      match_source: 'canonical_name',
      owners_midpoint: 10000000,
      release_year: 2013,
      resolution_tier: 'canonical_prefix',
      review_score: 87,
      total_reviews: 580000,
    }),
    createEntityRow({
      ccu_peak: 3200,
      display_name: 'Wargroove',
      entity_id: 607050,
      match_quality: 'prefix',
      match_rank: 3,
      match_source: 'canonical_name',
      owners_midpoint: 750000,
      release_year: 2019,
      resolution_tier: 'canonical_prefix',
      review_score: 84,
      total_reviews: 18000,
    }),
    createEntityRow({
      ccu_peak: 1100,
      display_name: 'Warpips',
      entity_id: 1291010,
      match_quality: 'prefix',
      match_rank: 3,
      match_source: 'canonical_name',
      owners_midpoint: 400000,
      release_year: 2022,
      resolution_tier: 'canonical_prefix',
      review_score: 78,
      total_reviews: 9000,
    }),
    createEntityRow({
      ccu_peak: 250,
      display_name: 'Warhammer Quest',
      entity_id: 326670,
      match_quality: 'prefix',
      match_rank: 3,
      match_source: 'canonical_name',
      owners_midpoint: 120000,
      release_year: 2015,
      resolution_tier: 'canonical_prefix',
      review_score: 72,
      total_reviews: 2500,
    }),
  ];
  (service as any).queryGames = async () => [];
  (service as any).queryGamesLexical = async () => [];
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  const firstPage = await service.resolveEntities({
    entityKinds: ['game'],
    limit: 2,
    query: 'war',
    resolutionMode: 'chat_strict',
  });

  assert.deepEqual(
    firstPage.entities.map((entity) => entity.displayName),
    ['Warframe', 'Wargroove']
  );
  assert.equal(firstPage.totalCandidates, 4);
  assert.ok(firstPage.continuationToken);

  const secondPage = await service.resolveEntities({
    continuationToken: firstPage.continuationToken,
    entityKinds: ['game'],
    limit: 2,
    query: 'war',
    resolutionMode: 'chat_strict',
  });

  assert.deepEqual(
    secondPage.entities.map((entity) => entity.displayName),
    ['Warpips', 'Warhammer Quest']
  );
  assert.equal(secondPage.continuationToken, null);
});

test('resolveEntities autocomplete prefers games for generic overview-style lookups', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async (kind: string) => {
    if (kind === 'game') {
      return [
        createEntityRow({
          ccu_peak: 0,
          display_name: 'Crimson Hotel',
          entity_id: 1682280,
          match_quality: 'prefix',
          match_rank: 1,
          match_source: 'canonical_name',
          matched_name: 'Crimson Hotel',
          owners_midpoint: 35000,
          release_year: 2019,
          resolution_tier: 'canonical_prefix',
          review_score: 72,
          total_reviews: 50,
        }),
        createEntityRow({
          ccu_peak: 116701,
          display_name: 'Crimson Desert',
          entity_id: 3321460,
          match_quality: 'prefix',
          match_rank: 2,
          match_source: 'alias',
          matched_name: 'crimson desert',
          owners_midpoint: 10000,
          release_year: 2026,
          resolution_tier: 'alias_prefix',
          review_score: 83,
          total_reviews: 116572,
        }),
      ];
    }

    if (kind === 'publisher') {
      return [
        createEntityRow({
          ccu_peak: null,
          display_name: 'Crimson',
          entity_id: 200771,
          game_count: 1,
          match_quality: 'exact',
          match_rank: 0,
          match_source: 'canonical_name',
          matched_name: 'Crimson',
          owners_midpoint: null,
          resolution_tier: 'canonical_exact',
          review_score: null,
          total_reviews: null,
        }),
      ];
    }

    if (kind === 'developer') {
      return [
        createEntityRow({
          ccu_peak: null,
          display_name: 'Crimson',
          entity_id: 211121,
          game_count: 2,
          match_quality: 'exact',
          match_rank: 0,
          match_source: 'canonical_name',
          matched_name: 'Crimson',
          owners_midpoint: null,
          resolution_tier: 'canonical_exact',
          review_score: null,
          total_reviews: null,
        }),
      ];
    }

    return [];
  };
  (service as any).queryGames = async () => [];
  (service as any).queryGamesLexical = async () => [];
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  const result = await service.resolveEntities({
    entityKinds: ['game', 'publisher', 'developer'],
    query: 'crimson',
    resolutionMode: 'autocomplete',
    resolutionPreference: 'game',
  });

  assert.equal(result.entities[0]?.displayName, 'Crimson Desert');
  assert.equal(result.entities[0]?.entityKind, 'game');
});

test('resolveEntities autocomplete scans beyond the requested page size before reranking', async () => {
  const service = createService();
  let requestedLimit: number | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async (_kind: string, _query: string, limit: number) => {
    requestedLimit = limit;
    return [];
  };
  (service as any).queryGames = async () => [];
  (service as any).queryGamesLexical = async () => [];
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  await service.resolveEntities({
    entityKinds: ['game'],
    limit: 5,
    query: 'crimson',
    resolutionMode: 'autocomplete',
    resolutionPreference: 'game',
  });

  assert.equal(requestedLimit, 30);
});

test('resolveEntities autocomplete stays on the canonical fast path when lexical results are empty', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async () => [];
  (service as any).queryGames = async () => {
    throw new Error('autocomplete should not fall back to legacy game lookup');
  };
  (service as any).queryGamesLexical = async () => {
    throw new Error('autocomplete should not fall back to legacy lexical lookup');
  };
  (service as any).queryCompanies = async () => {
    throw new Error('autocomplete should not fall back to legacy company lookup');
  };
  (service as any).queryCompaniesLexical = async () => {
    throw new Error('autocomplete should not fall back to legacy company lexical lookup');
  };

  const result = await service.resolveEntities({
    entityKinds: ['game'],
    query: 'crimson',
    resolutionMode: 'autocomplete',
    resolutionPreference: 'game',
  });

  assert.equal(result.entities.length, 0);
  assert.equal(result.totalCandidates, 0);
});

test('resolveEntities autocomplete keeps companies first when company preference is explicit', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async (kind: string) => {
    if (kind === 'game') {
      return [
        createEntityRow({
          ccu_peak: 116701,
          display_name: 'Crimson Desert',
          entity_id: 3321460,
          match_quality: 'prefix',
          match_rank: 3,
          match_source: 'alias',
          matched_name: 'crimson desert',
          owners_midpoint: 10000,
          release_year: 2026,
          resolution_tier: 'alias_prefix',
          review_score: 83,
          total_reviews: 116572,
        }),
      ];
    }

    if (kind === 'publisher') {
      return [
        createEntityRow({
          ccu_peak: null,
          display_name: 'Crimson',
          entity_id: 200771,
          game_count: 1,
          match_quality: 'exact',
          match_rank: 0,
          match_source: 'canonical_name',
          matched_name: 'Crimson',
          owners_midpoint: null,
          resolution_tier: 'canonical_exact',
          review_score: null,
          total_reviews: null,
        }),
      ];
    }

    if (kind === 'developer') {
      return [
        createEntityRow({
          ccu_peak: null,
          display_name: 'Crimson',
          entity_id: 211121,
          game_count: 2,
          match_quality: 'exact',
          match_rank: 0,
          match_source: 'canonical_name',
          matched_name: 'Crimson',
          owners_midpoint: null,
          resolution_tier: 'canonical_exact',
          review_score: null,
          total_reviews: null,
        }),
      ];
    }

    return [];
  };
  (service as any).queryGames = async () => [];
  (service as any).queryGamesLexical = async () => [];
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  const result = await service.resolveEntities({
    entityKinds: ['game', 'publisher', 'developer'],
    query: 'crimson',
    resolutionMode: 'autocomplete',
    resolutionPreference: 'company',
  });

  assert.notEqual(result.entities[0]?.entityKind, 'game');
  assert.equal(result.entities[0]?.displayName, 'Crimson');
});

test('resolveEntities keeps clarification for ambiguous fuzzy-only game lookups', async () => {
  const service = createService();

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).queryCanonicalEntities = async () => [
    createEntityRow({
      ccu_peak: 1200,
      display_name: 'Mysterious Game',
      entity_id: 9001,
      match_quality: 'fuzzy',
      match_rank: 5,
      matched_name: 'Mysterious Game',
      owners_midpoint: 100000,
      release_year: 2024,
      review_score: 60,
      total_reviews: 800,
    }),
    createEntityRow({
      ccu_peak: 1100,
      display_name: 'Mystery Game 2',
      entity_id: 9002,
      match_quality: 'fuzzy',
      match_rank: 5,
      matched_name: 'Mystery Game 2',
      owners_midpoint: 90000,
      release_year: 2023,
      review_score: 58,
      total_reviews: 700,
    }),
  ];
  (service as any).queryGames = async () => [];
  (service as any).queryGamesLexical = async () => [];
  (service as any).queryCompanies = async () => [];
  (service as any).queryCompaniesLexical = async () => [];

  const result = await service.resolveEntities({
    entityKinds: ['game'],
    query: 'mystery',
  });

  assert.equal(result.ambiguity.requiresClarification, true);
  assert.match(result.ambiguity.message ?? '', /could not confidently resolve/i);
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
    allHistory: false,
    appids: [],
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

test('getEntityOverview prefers entityUid when a canonical binding is provided', async () => {
  const service = createService();
  let resolvedEntityUid: string | null = null;
  let queriedEntityId: number | null = null;

  (service as any).assertContractRuntime = async () => undefined;
  (service as any).resolveCoreEntity = async (entityUid: string) => {
    resolvedEntityUid = entityUid;
    return {
      canonical_name: 'Counter-Strike 2',
      entity_kind: 'game',
      entity_uid: entityUid,
      platform: 'steam',
      platform_entity_id: '730',
    };
  };
  (service as any).queryGameOverview = async (entityId: number) => {
    queriedEntityId = entityId;
    return {
      app_type: 'game',
      appid: 730,
      ccu_peak: 1810000,
      developer_ids: [],
      developers: ['Valve'],
      discount_percent: null,
      display_name: 'Counter-Strike 2',
      entity_id: 730,
      game_count: null,
      is_free: true,
      is_released: true,
      owners_midpoint: 45000000,
      parent_appid: null,
      platforms: 'windows',
      price_cents: 0,
      publisher_ids: [],
      publishers: ['Valve'],
      release_date: '2023-09-27',
      release_state: 'released',
      release_year: 2023,
      review_score: 87,
      total_reviews: 9000000,
    };
  };

  const result = await service.getEntityOverview({
    entityKind: 'publisher',
    entityUid: '11111111-1111-4111-8111-111111111111',
    gamesLimit: 5,
    gamesSortBy: 'reviews',
  });

  assert.equal(resolvedEntityUid, '11111111-1111-4111-8111-111111111111');
  assert.equal(queriedEntityId, 730);
  assert.equal(result.entity.entityKind, 'game');
  assert.equal(result.entity.platformEntityId, '730');
  assert.equal(result.entity.entityUid, '11111111-1111-4111-8111-111111111111');
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

test('getYoutubeGameCoverage returns an unavailable response when YouTube tables are not mirrored yet', async () => {
  const service = createService();

  (service as any).getBlockingTables = async () => ['docs.youtube_videos', 'metrics.youtube_video_snapshots'];
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'ARC Raiders',
    entity_kind: 'game',
    entity_uid: '11111111-1111-4111-8111-111111111111',
    platform: 'steam',
    platform_entity_id: '1149460',
  });

  const result = await service.getYoutubeGameCoverage({
    entityUid: '11111111-1111-4111-8111-111111111111',
    view: 'latest_videos',
  });

  assert.equal(result.availability.state, 'unavailable');
  assert.equal(result.sufficientToAnswer, false);
  assert.deepEqual(result.availability.blockingTables, [
    'docs.youtube_videos',
    'metrics.youtube_video_snapshots',
  ]);
  assert.equal(result.items.length, 0);
});

test('getYoutubeGameCoverage blocks noisy generic-title games before querying YouTube data', async () => {
  const service = createService();
  let summaryCalled = false;

  (service as any).getBlockingTables = async () => [];
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'MENACE',
    entity_kind: 'game',
    entity_uid: '11111111-1111-4111-8111-111111111111',
    platform: 'steam',
    platform_entity_id: '2436120',
  });
  (service as any).queryYoutubeCoverageSummary = async () => {
    summaryCalled = true;
    return null;
  };

  const result = await service.getYoutubeGameCoverage({
    entityUid: '11111111-1111-4111-8111-111111111111',
    view: 'latest_videos',
  });

  assert.equal(result.availability.state, 'blocked');
  assert.equal(result.sufficientToAnswer, false);
  assert.match(result.availability.reason ?? '', /precision is not reliable enough/i);
  assert.equal(summaryCalled, false);
});

test('getYoutubeGameCoverage returns latest matched videos for a supported title', async () => {
  const service = createService();

  (service as any).getBlockingTables = async () => [];
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'ARC Raiders',
    entity_kind: 'game',
    entity_uid: '11111111-1111-4111-8111-111111111111',
    platform: 'steam',
    platform_entity_id: '1149460',
  });
  (service as any).queryYoutubeGameOverrideState = async () => null;
  (service as any).queryYoutubeCoverageSummary = async () => ({
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
  });
  (service as any).queryYoutubeLatestVideoRows = async () => ({
    rows: [{
      channelCountry: 'US',
      channelId: 'channel-1',
      channelSubscriberCount: 240000,
      channelTitle: 'Creator One',
      commentCount: 44,
      confidenceScore: 0.99,
      contentClass: 'standard_video',
      firstSnapshotAt: null,
      growthPct: null,
      lastSnapshotAt: null,
      likeCount: 550,
      matchedAlias: 'ARC Raiders',
      publishedAt: '2026-04-07T07:56:34.000Z',
      title: 'ARC Raiders Just Buffed This Key Room',
      url: 'https://www.youtube.com/watch?v=video-1',
      videoId: 'video-1',
      viewCount: 32037,
      viewDelta: null,
    }],
    totalRows: 27,
  });

  const result = await service.getYoutubeGameCoverage({
    entityUid: '11111111-1111-4111-8111-111111111111',
    view: 'latest_videos',
  });

  assert.equal(result.availability.state, 'ready');
  assert.equal(result.sufficientToAnswer, true);
  assert.equal(result.entity.displayName, 'ARC Raiders');
  assert.equal(result.items[0]?.title, 'ARC Raiders Just Buffed This Key Room');
  assert.deepEqual(result.pagination, {
    hasNextPage: true,
    hasPreviousPage: false,
    limit: 10,
    offset: 0,
    totalRows: 27,
  });
  assert.equal(result.summary.matchedPrimaryVideoCount, 100);
});

test('getYoutubeGameCoverage supports expanded windows for latest-video answers', async () => {
  const service = createService();
  let receivedWindow: string | null = null;

  (service as any).getBlockingTables = async () => [];
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'ARC Raiders',
    entity_kind: 'game',
    entity_uid: '11111111-1111-4111-8111-111111111111',
    platform: 'steam',
    platform_entity_id: '1149460',
  });
  (service as any).queryYoutubeGameOverrideState = async () => null;
  (service as any).queryYoutubeCoverageSummary = async () => ({
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
  });
  (service as any).queryYoutubeLatestVideoRows = async (params: { window: string }) => {
    receivedWindow = params.window;
    return {
      rows: [{
        channelCountry: 'US',
        channelId: 'channel-1',
        channelSubscriberCount: 240000,
        channelTitle: 'Creator One',
        commentCount: 44,
        confidenceScore: 0.99,
        contentClass: 'standard_video',
        firstSnapshotAt: null,
        growthPct: null,
        lastSnapshotAt: null,
        likeCount: 550,
        matchedAlias: 'ARC Raiders',
        publishedAt: '2026-04-07T07:56:34.000Z',
        title: 'ARC Raiders Just Buffed This Key Room',
        url: 'https://www.youtube.com/watch?v=video-1',
        videoId: 'video-1',
        viewCount: 32037,
        viewDelta: null,
      }],
      totalRows: 1,
    };
  };

  const result = await service.getYoutubeGameCoverage({
    entityUid: '11111111-1111-4111-8111-111111111111',
    view: 'latest_videos',
    window: '2d',
  });

  assert.equal(result.availability.state, 'ready');
  assert.equal(result.resolvedWindow, '2d');
  assert.equal(receivedWindow, '2d');
  assert.equal(result.items[0]?.title, 'ARC Raiders Just Buffed This Key Room');
  assert.equal(result.pagination?.totalRows, 1);
});

test('getYoutubeGameCoverage forwards row pagination for latest-video answers', async () => {
  const service = createService();
  let receivedLimit: number | null = null;
  let receivedOffset: number | null = null;

  (service as any).getBlockingTables = async () => [];
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'ARC Raiders',
    entity_kind: 'game',
    entity_uid: '11111111-1111-4111-8111-111111111111',
    platform: 'steam',
    platform_entity_id: '1149460',
  });
  (service as any).queryYoutubeGameOverrideState = async () => null;
  (service as any).queryYoutubeCoverageSummary = async () => ({
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
  });
  (service as any).queryYoutubeLatestVideoRows = async (params: { limit: number; offset: number }) => {
    receivedLimit = params.limit;
    receivedOffset = params.offset;
    return {
      rows: [{
        channelCountry: 'US',
        channelId: 'channel-2',
        channelSubscriberCount: 140000,
        channelTitle: 'Creator Two',
        commentCount: 12,
        confidenceScore: 0.98,
        contentClass: 'short',
        firstSnapshotAt: null,
        growthPct: null,
        lastSnapshotAt: null,
        likeCount: 88,
        matchedAlias: 'ARC Raiders',
        publishedAt: '2026-04-06T07:56:34.000Z',
        title: 'ARC Raiders Clip',
        url: 'https://www.youtube.com/watch?v=video-2',
        videoId: 'video-2',
        viewCount: 12000,
        viewDelta: null,
      }],
      totalRows: 24,
    };
  };

  const result = await service.getYoutubeGameCoverage({
    entityUid: '11111111-1111-4111-8111-111111111111',
    limit: 10,
    offset: 10,
    view: 'latest_videos',
  });

  assert.equal(receivedLimit, 10);
  assert.equal(receivedOffset, 10);
  assert.deepEqual(result.pagination, {
    hasNextPage: true,
    hasPreviousPage: true,
    limit: 10,
    offset: 10,
    totalRows: 24,
  });
  assert.equal(result.items[0]?.videoId, 'video-2');
});

test('getYoutubeGameCoverage supports expanded windows for cadence answers', async () => {
  const service = createService();
  let receivedWindow: string | null = null;

  (service as any).getBlockingTables = async () => [];
  (service as any).resolveCoreEntity = async () => ({
    canonical_name: 'ARC Raiders',
    entity_kind: 'game',
    entity_uid: '11111111-1111-4111-8111-111111111111',
    platform: 'steam',
    platform_entity_id: '1149460',
  });
  (service as any).queryYoutubeGameOverrideState = async () => null;
  (service as any).queryYoutubeCoverageSummary = async () => ({
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
  });
  (service as any).queryYoutubeCadenceRow = async (params: { window: string }) => {
    receivedWindow = params.window;
    return {
      distinctUploadChannels: 23,
      matchedVideoViewDelta: 145000,
      newMatchedVideos: 31,
      viewsOnNewVideos: 420000,
      window: params.window,
    };
  };

  const result = await service.getYoutubeGameCoverage({
    entityUid: '11111111-1111-4111-8111-111111111111',
    view: 'cadence',
    window: '14d',
  });

  assert.equal(result.availability.state, 'ready');
  assert.equal(result.resolvedWindow, '14d');
  assert.equal(receivedWindow, '14d');
  assert.equal(result.cadence?.window, '14d');
  assert.equal(result.cadence?.newMatchedVideos, 31);
});
