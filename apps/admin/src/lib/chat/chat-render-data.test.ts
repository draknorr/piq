import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTigerChatRenderData,
  buildTigerClarificationRenderData,
} from './chat-render-data';
import { removeMarkdownTables } from '@/components/chat/content/parsers';

test('buildTigerClarificationRenderData ignores clarification slots without candidates', () => {
  const renderData = buildTigerClarificationRenderData({
    originalPrompt: 'What is the CCU for Counter-Strike 2?',
    selectionState: {
      family: 'entity_overview',
      slots: [{
        candidates: [],
        label: 'Counter-Strike 2',
        query: 'Counter-Strike 2',
        requiresClarification: true,
        selectedEntityUid: null,
        slotId: 'primary',
        totalCandidates: 0,
      }],
    },
  });

  assert.equal(renderData, null);
});

test('buildTigerChatRenderData maps current-player momentum rows to render data', () => {
  const renderData = buildTigerChatRenderData({
    contractName: 'discoverMomentum',
    response: {
      items: [
        {
          appid: 730,
          ccuPeak: 1404982,
          ccuSparkline: [1200000, 1275000, 1310000, 1404982],
          name: 'Counter-Strike 2',
          platformSupport: ['windows', 'linux'],
          totalReviews: 9495164,
          trendDirection: 'up',
        },
      ],
      rankingLabel: 'Peak CCU',
      timeframe: 'current',
    },
  });

  assert.deepEqual(renderData, {
    kind: 'momentum_current_players',
    rankingLabel: 'Peak CCU',
    rows: [
      {
        appid: 730,
        ccuPeak: 1404982,
        ccuSparkline: [1200000, 1275000, 1310000, 1404982],
        name: 'Counter-Strike 2',
        platformSupport: ['windows', 'linux'],
        totalReviews: 9495164,
        trendDirection: 'up',
      },
    ],
  });
});

test('buildTigerChatRenderData ignores non-current momentum screens', () => {
  const renderData = buildTigerChatRenderData({
    contractName: 'discoverMomentum',
    response: {
      items: [
        {
          appid: 1145360,
          ccuPeak: 50000,
          ccuSparkline: [41000, 43000, 50000],
          name: 'Hades II',
        },
      ],
      rankingLabel: 'Reviews Added (7d)',
      timeframe: '7d',
    },
  });

  assert.equal(renderData, null);
});

test('buildTigerChatRenderData maps metric-history responses to chart render data', () => {
  const renderData = buildTigerChatRenderData({
    contractName: 'traceMetricHistory',
    response: {
      entity: { displayName: 'Counter-Strike 2' },
      endDate: '2026-04-05',
      series: [
        {
          metric: 'ccu_peak',
          points: [
            { date: '2026-03-30', value: 1300000 },
            { date: '2026-04-05', value: 1404982 },
          ],
          summary: {
            deltaAbs: 104982,
            deltaPct: 8.08,
            firstDate: '2026-03-30',
            lastDate: '2026-04-05',
            latestValue: 1404982,
            pointCount: 2,
            startValue: 1300000,
          },
        },
      ],
      startDate: '2026-03-30',
    },
  });

  assert.deepEqual(renderData, {
    endDate: '2026-04-05',
    entityName: 'Counter-Strike 2',
    kind: 'metric_history',
    series: [
      {
        metric: 'ccu_peak',
        points: [
          { date: '2026-03-30', value: 1300000 },
          { date: '2026-04-05', value: 1404982 },
        ],
        summary: {
          deltaAbs: 104982,
          deltaPct: 8.08,
          firstDate: '2026-03-30',
          lastDate: '2026-04-05',
          latestValue: 1404982,
          pointCount: 2,
          startValue: 1300000,
        },
      },
    ],
    startDate: '2026-03-30',
  });
});

test('buildTigerChatRenderData maps YouTube latest-video responses to structured paginated tables', () => {
  const renderData = buildTigerChatRenderData({
    contractName: 'getYoutubeGameCoverage',
    response: {
      availability: { blockingTables: [], reason: null, state: 'ready' },
      entity: {
        displayName: 'ARC Raiders',
        entityKind: 'game',
        entityUid: 'steam:game:1149460',
        platform: 'steam',
        platformEntityId: '1149460',
      },
      items: [
        {
          channelId: 'channel-1',
          channelTitle: 'Creator One',
          contentClass: 'standard_video',
          publishedAt: '2026-04-12T07:00:00.000Z',
          title: 'ARC Raiders Just Buffed This Key Room',
          url: 'https://www.youtube.com/watch?v=video-1',
          videoId: 'video-1',
          viewCount: 32037,
        },
      ],
      limit: 10,
      pagination: {
        hasNextPage: true,
        hasPreviousPage: false,
        limit: 10,
        offset: 0,
        totalRows: 12,
      },
      resolvedWindow: '7d',
      view: 'latest_videos',
    },
  });

  if (!renderData || renderData.kind !== 'youtube_game_activity') {
    assert.fail('Expected YouTube game activity render data');
  }

  assert.equal(renderData.request.entityUid, 'steam:game:1149460');
  assert.equal(renderData.request.limit, 10);
  assert.equal(renderData.request.offset, 0);
  assert.equal(renderData.request.window, '7d');
  assert.deepEqual(renderData.pagination, {
    hasNextPage: true,
    hasPreviousPage: false,
    limit: 10,
    offset: 0,
    totalRows: 12,
  });
  assert.deepEqual(renderData.table.columns.map((column) => column.label), [
    'Video',
    'Channel',
    'Published',
    'Views',
    'Format',
  ]);
  assert.equal(renderData.table.rows[0]?.cells[0]?.href, 'https://www.youtube.com/watch?v=video-1');
  assert.equal(renderData.table.rows[0]?.cells[0]?.text, 'ARC Raiders Just Buffed This Key Room');
  assert.equal(renderData.table.rows[0]?.cells[1]?.href, 'https://www.youtube.com/channel/channel-1');
  assert.equal(renderData.table.rows[0]?.cells[3]?.text, '32,037');
});

test('buildTigerChatRenderData maps YouTube content-mix responses with views', () => {
  const renderData = buildTigerChatRenderData({
    contractName: 'getYoutubeGameCoverage',
    response: {
      availability: { blockingTables: [], reason: null, state: 'ready' },
      contentMix: [
        {
          contentClass: 'short',
          currentViews: 125000,
          distinctUploadChannels: 48,
          matchedPrimaryVideoCount: 79,
          matchedVideoViewDelta: 42000,
          newMatchedVideos: 25,
        },
      ],
      entity: {
        displayName: 'ARC Raiders',
        entityKind: 'game',
        entityUid: 'steam:game:1149460',
        platform: 'steam',
        platformEntityId: '1149460',
      },
      limit: 10,
      resolvedWindow: '30d',
      view: 'content_mix',
    },
  });

  if (!renderData || renderData.kind !== 'youtube_game_activity') {
    assert.fail('Expected YouTube game activity render data');
  }

  assert.equal(renderData.pagination, null);
  assert.deepEqual(renderData.table.columns.map((column) => column.label), [
    'Format',
    'Videos',
    'New Videos',
    'Channels',
    'Views',
    'View Delta',
  ]);
  assert.deepEqual(renderData.table.rows[0]?.cells.map((cell) => cell.text), [
    'Shorts',
    '79',
    '25',
    '48',
    '125,000',
    '42,000',
  ]);
});

test('buildTigerChatRenderData maps YouTube cadence responses with current views', () => {
  const renderData = buildTigerChatRenderData({
    contractName: 'getYoutubeGameCoverage',
    response: {
      availability: { blockingTables: [], reason: null, state: 'ready' },
      cadence: {
        distinctUploadChannels: 23,
        matchedVideoViewDelta: 145000,
        newMatchedVideos: 31,
        viewsOnNewVideos: 420000,
        window: '14d',
      },
      entity: {
        displayName: 'ARC Raiders',
        entityKind: 'game',
        entityUid: 'steam:game:1149460',
        platform: 'steam',
        platformEntityId: '1149460',
      },
      limit: 10,
      resolvedWindow: '14d',
      summary: {
        freshestMatchedUploadAt: '2026-04-12T07:00:00.000Z',
      },
      view: 'cadence',
    },
  });

  if (!renderData || renderData.kind !== 'youtube_game_activity') {
    assert.fail('Expected YouTube game activity render data');
  }

  assert.equal(renderData.pagination, null);
  assert.deepEqual(renderData.table.columns.map((column) => column.label), ['Metric', 'Value']);
  assert.deepEqual(renderData.table.rows.map((row) => row.cells[0]?.text), [
    'Upload channels',
    'New videos',
    'Current views',
    'View delta',
    'Most recent upload',
  ]);
  assert.equal(renderData.table.rows[2]?.cells[1]?.text, '420,000');
});

test('buildTigerClarificationRenderData maps ambiguous selection state to clickable render data', () => {
  const renderData = buildTigerClarificationRenderData({
    originalPrompt: "What's the CCU for Counter-Strike 2?",
    selectionState: {
      family: 'entity_overview',
      slots: [
        {
          candidates: [
            {
              displayName: 'Counter-Strike 2',
              entityKind: 'game',
              entityUid: 'steam:game:730',
              matchQuality: 'exact',
              matchSource: 'canonical_name',
              ordinal: 1,
              platform: 'steam',
              platformEntityId: '730',
              releaseYear: 2023,
              resolutionTier: 'canonical_exact',
              score: 100,
              totalReviews: 2000000,
            },
            {
              displayName: 'Counter-Strike: Condition Zero',
              entityKind: 'game',
              entityUid: 'steam:game:80',
              matchQuality: 'exact',
              matchSource: 'canonical_name',
              ordinal: 2,
              platform: 'steam',
              platformEntityId: '80',
              releaseYear: 2004,
              resolutionTier: 'canonical_exact',
              score: 99,
              totalReviews: 100000,
            },
          ],
          continuationToken: null,
          expectedEntityKind: 'game',
          label: 'game',
          query: 'Counter-Strike 2',
          requiresClarification: true,
          selectedEntityUid: null,
          slotId: 'primary',
          totalCandidates: 2,
        },
      ],
    },
  });

  assert.deepEqual(renderData, {
    family: 'entity_overview',
    kind: 'entity_clarification',
    originalPrompt: "What's the CCU for Counter-Strike 2?",
    slots: [
      {
        candidates: [
          {
            displayName: 'Counter-Strike 2',
            entityKind: 'game',
            entityUid: 'steam:game:730',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            ordinal: 1,
            platform: 'steam',
            platformEntityId: '730',
            releaseYear: 2023,
            resolutionTier: 'canonical_exact',
            selectedEntity: {
              displayName: 'Counter-Strike 2',
              entityKind: 'game',
              entityUid: 'steam:game:730',
              matchQuality: 'exact',
              platform: 'steam',
              platformEntityId: '730',
            },
            totalReviews: 2000000,
          },
          {
            displayName: 'Counter-Strike: Condition Zero',
            entityKind: 'game',
            entityUid: 'steam:game:80',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            ordinal: 2,
            platform: 'steam',
            platformEntityId: '80',
            releaseYear: 2004,
            resolutionTier: 'canonical_exact',
            selectedEntity: {
              displayName: 'Counter-Strike: Condition Zero',
              entityKind: 'game',
              entityUid: 'steam:game:80',
              matchQuality: 'exact',
              platform: 'steam',
              platformEntityId: '80',
            },
            totalReviews: 100000,
          },
        ],
        continuationToken: null,
        expectedEntityKind: 'game',
        label: 'game',
        query: 'Counter-Strike 2',
        requiresClarification: true,
        slotId: 'primary',
        totalCandidates: 2,
      },
    ],
  });
});

test('buildTigerClarificationRenderData preserves candidates when platformEntityId is missing', () => {
  const renderData = buildTigerClarificationRenderData({
    originalPrompt: "What's the CCU for Counter-Strike 2?",
    selectionState: {
      family: 'entity_overview',
      slots: [
        {
          candidates: [
            {
              displayName: 'Counter-Strike 2',
              entityKind: 'game',
              entityUid: 'steam:game:730',
              matchQuality: 'exact',
              matchSource: 'canonical_name',
              ordinal: 1,
              platform: 'steam',
              platformEntityId: null,
              releaseYear: 2023,
              resolutionTier: 'canonical_exact',
              score: 100,
              totalReviews: 2000000,
            },
          ],
          continuationToken: null,
          expectedEntityKind: 'game',
          label: 'game',
          query: 'Counter-Strike 2',
          requiresClarification: true,
          selectedEntityUid: null,
          slotId: 'primary',
          totalCandidates: 1,
        },
      ],
    },
  });

  assert.deepEqual(renderData, {
    family: 'entity_overview',
    kind: 'entity_clarification',
    originalPrompt: "What's the CCU for Counter-Strike 2?",
    slots: [
      {
        candidates: [
          {
            displayName: 'Counter-Strike 2',
            entityKind: 'game',
            entityUid: 'steam:game:730',
            matchQuality: 'exact',
            matchSource: 'canonical_name',
            ordinal: 1,
            platform: 'steam',
            releaseYear: 2023,
            resolutionTier: 'canonical_exact',
            selectedEntity: {
              displayName: 'Counter-Strike 2',
              entityKind: 'game',
              entityUid: 'steam:game:730',
              matchQuality: 'exact',
              platform: 'steam',
            },
            totalReviews: 2000000,
          },
        ],
        continuationToken: null,
        expectedEntityKind: 'game',
        label: 'game',
        query: 'Counter-Strike 2',
        requiresClarification: true,
        slotId: 'primary',
        totalCandidates: 1,
      },
    ],
  });
});

test('removeMarkdownTables strips structured tables but preserves surrounding copy', () => {
  const content = [
    'Here are the current leaders.',
    '',
    '| Game | Peak CCU |',
    '| --- | --- |',
    '| Counter-Strike 2 | 1,404,982 |',
    '',
    'Snapshot date: **2026-04-05**.',
  ].join('\n');

  assert.equal(
    removeMarkdownTables(content),
    ['Here are the current leaders.', '', 'Snapshot date: **2026-04-05**.'].join('\n')
  );
});
