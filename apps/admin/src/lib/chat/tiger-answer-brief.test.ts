import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTigerSuccessBrief } from './tiger-answer-brief';

test('buildTigerSuccessBrief keeps current-player momentum facts player-centric', () => {
  const brief = buildTigerSuccessBrief({
    fallbackMarkdown: [
      'Counter-Strike 2 currently has the highest player count.',
      '',
      '| Game | Peak CCU | Trend | Total Reviews | Platforms |',
      '| --- | --- | --- | --- | --- |',
      '| Counter-Strike 2 | 1,404,982 | stable | 10,000,000 | windows, linux |',
    ].join('\n'),
    intent: 'momentum_discovery',
    response: {
      items: [
        {
          ccuPeak: 1404982,
          name: 'Counter-Strike 2',
          reviewPercentage: null,
          reviewsAdded7d: 0,
          supportLevel: 'low',
          supportReasons: ['Current-state momentum evidence is limited.'],
          totalReviews: 10000000,
          trendDirection: 'stable',
        },
      ],
      rankingLabel: 'Peak CCU',
      sortBy: 'ccu_peak',
      timeframe: 'current',
      timeframeLabel: 'Current snapshot',
      trendType: null,
    },
    selectionState: null,
  });

  assert.match(brief.directAnswer, /highest player count|peak concurrent users/i);
  assert.ok(brief.keyFacts.some((fact) => /peak CCU/i.test(fact)));
  assert.ok(brief.keyFacts.some((fact) => /total reviews/i.test(fact)));
  assert.ok(brief.keyFacts.every((fact) => !/recent reviews added/i.test(fact)));
});

test('buildTigerSuccessBrief keeps company overview answers explicitly portfolio-focused', () => {
  const brief = buildTigerSuccessBrief({
    fallbackMarkdown: [
      'Here are the main portfolio metrics for **FromSoftware, Inc.**.',
      '',
      '- **Game count**: 11',
      '- **Portfolio total reviews**: 2,400,000',
      '- **Portfolio owners midpoint**: 72,300,000',
      '- **Portfolio CCU peak**: 163,599',
    ].join('\n'),
    intent: 'entity_overview',
    response: {
      entity: {
        details: {
          publishers: ['Bandai Namco Entertainment'],
        },
        displayName: 'FromSoftware, Inc.',
        entityKind: 'developer',
        metrics: {
          ccuPeak: 163599,
          gameCount: 11,
          ownersMidpoint: 72300000,
          totalReviews: 2400000,
        },
      },
      games: [],
      viewMode: 'company_metrics',
    },
    selectionState: null,
  });

  assert.match(brief.directAnswer, /portfolio/i);
  assert.ok(brief.keyFacts.some((fact) => /Portfolio totals for FromSoftware/i.test(fact)));
});

test('buildTigerSuccessBrief surfaces applied Steam Deck filters in momentum answers', () => {
  const brief = buildTigerSuccessBrief({
    fallbackMarkdown: [
      'From **2026-03-29** to **2026-04-04**, **Everwind** leads this set within the **Steam Deck Verified** set by **Reviews Added (7d)** for **Last 7 days**.',
      '',
      '| Game | Reviews Added (7d) | Review % | Total Reviews | Peak CCU | Platforms |',
      '| --- | --- | --- | --- | --- | --- |',
      '| Everwind | 2,060 | n/a | 2,060 | 2,276 | windows |',
    ].join('\n'),
    intent: 'momentum_discovery',
    response: {
      filtersApplied: ['sort_by: reviews_added_7d', 'timeframe: 7d', 'steam_deck: verified'],
      items: [
        {
          ccuPeak: 2276,
          name: 'Everwind',
          reviewPercentage: null,
          reviewsAdded7d: 2060,
          supportLevel: 'high',
          supportReasons: ['2,060 reviews added over 7d.'],
          totalReviews: 2060,
          trendDirection: 'up',
        },
      ],
      rankingLabel: 'Reviews Added (7d)',
      sortBy: 'reviews_added_7d',
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: 'review_momentum',
    },
    selectionState: null,
  });

  assert.match(brief.directAnswer, /Steam Deck/i);
  assert.ok(brief.keyFacts.some((fact) => /Applied filters: Steam Deck/i.test(fact)));
});

test('buildTigerSuccessBrief keeps review-sentiment framing after reranking within the same screen', () => {
  const brief = buildTigerSuccessBrief({
    fallbackMarkdown: [
      'From **2026-03-06** to **2026-04-04**, **Example Game** leads this review sentiment decline screen by **Total Reviews** for **Last 30 days**. I screened for established titles so this stays focused on broadly played games rather than low-volume noise.',
      '',
      '| Game | Sentiment Delta | Review % | Reviews Added (30d) | Total Reviews | Platforms |',
      '| --- | --- | --- | --- | --- | --- |',
      '| Example Game | -4.2 pts | 74% | 900 | 18,000 | windows |',
    ].join('\n'),
    intent: 'momentum_discovery',
    momentumPromptFamily: 'review_sentiment_down',
    response: {
      filtersApplied: [
        'sort_by: total_reviews',
        'timeframe: 30d',
        'min_reviews: 10000',
        'min_ccu: 100',
        'min_reviews_added_30d: 25',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          ccuPeak: 4200,
          name: 'Example Game',
          reviewPercentage: 74,
          reviewsAdded30d: 900,
          sentimentDelta: -4.2,
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 4.2 points.'],
          totalReviews: 18000,
          trendDirection: 'down',
        },
      ],
      rankingLabel: 'Total Reviews',
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
      trendType: null,
    },
    selectionState: null,
  });

  assert.match(brief.directAnswer, /review sentiment decline/i);
  assert.match(brief.directAnswer, /established titles/i);
  assert.ok(brief.keyFacts.some((fact) => /Sentiment delta -4.2 pts/i.test(fact)));
});

test('buildTigerSuccessBrief handles numeric-string review percentages and weekly sparse-result broadening notes', () => {
  const brief = buildTigerSuccessBrief({
    fallbackMarkdown: [
      'From **2026-03-29** to **2026-04-04**, **Example Game** leads this review sentiment decline screen by **Total Reviews** for **Last 7 days**. I broadened this from market-leading titles to established mid-tier games because the broad weekly screen was too sparse.',
      '',
      '| Game | Sentiment Delta | Review % | Reviews Added (7d) | Total Reviews | Platforms |',
      '| --- | --- | --- | --- | --- | --- |',
      '| Example Game | -4.2 pts | 74.4% | 120 | 18,000 | windows |',
    ].join('\n'),
    intent: 'momentum_discovery',
    momentumPromptFamily: 'review_sentiment_down',
    response: {
      filtersApplied: [
        'sort_by: total_reviews',
        'timeframe: 7d',
        'min_reviews: 1000',
        'min_reviews_added_7d: 5',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          ccuPeak: 4200,
          name: 'Example Game',
          reviewPercentage: '74.4',
          reviewsAdded7d: 120,
          sentimentDelta: '-4.2',
          supportLevel: 'high',
          supportReasons: ['Sentiment fell by 4.2 points.'],
          totalReviews: 18000,
          trendDirection: 'down',
        },
      ],
      rankingLabel: 'Total Reviews',
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: null,
    },
    scopeAdjustedForSparseResults: true,
    selectionState: null,
  });

  assert.match(brief.directAnswer, /broad weekly screen was too sparse/i);
  assert.ok(brief.keyFacts.some((fact) => /74\.4% review percentage/i.test(fact)));
  assert.ok(brief.keyFacts.some((fact) => /market-leading titles to established mid-tier games/i.test(fact)));
});

test('buildTigerSuccessBrief grounds metric-history summaries with exact dates', () => {
  const brief = buildTigerSuccessBrief({
    fallbackMarkdown: [
      'Over this window, **Hades II** moved from **114,588** to **115,774** on **Total Reviews**. The window runs from **2026-03-05** through **2026-04-03**.',
      '',
      '- **Total Reviews**: 114,588 -> 115,774 (1,186, 1.0%)',
    ].join('\n'),
    intent: 'metric_history',
    response: {
      endDate: '2026-04-03',
      entity: {
        displayName: 'Hades II',
      },
      series: [
        {
          metric: 'total_reviews',
          summary: {
            deltaAbs: 1186,
            deltaPct: 1,
            latestValue: 115774,
            startValue: 114588,
          },
        },
      ],
      startDate: '2026-03-05',
    },
    selectionState: null,
  });

  assert.match(brief.directAnswer, /2026-03-05 through 2026-04-03/);
  assert.ok(brief.keyFacts.some((fact) => /Window: 2026-03-05 through 2026-04-03\./.test(fact)));
});

test('buildTigerSuccessBrief suppresses weak alternate hints after a strong exact selection', () => {
  const brief = buildTigerSuccessBrief({
    fallbackMarkdown: [
      'Here are the most relevant recent patch notes for **Primeval**.',
      '',
      '| Published | Title | Game | Source |',
      '| --- | --- | --- | --- |',
      '| 2026-03-13 | Accumulated Updates - March 13 | Primeval | Community Announcements |',
    ].join('\n'),
    intent: 'news_search',
    response: {
      entity: {
        displayName: 'Primeval',
      },
      items: [
        {
          feedLabel: 'Community Announcements',
          publishedAt: '2026-03-13T00:00:00.000Z',
          title: 'Accumulated Updates - March 13',
        },
      ],
    },
    selectionState: {
      family: 'news_search',
      slots: [
        {
          candidates: [
            {
              displayName: 'Primeval',
              entityKind: 'game',
              entityUid: 'primeval',
              matchQuality: 'exact',
              ordinal: 1,
              platform: 'steam',
              platformEntityId: '1403110',
              score: 172,
            },
            {
              displayName: 'Primeval Genesis',
              entityKind: 'game',
              entityUid: 'primeval-genesis',
              matchQuality: 'prefix',
              ordinal: 2,
              platform: 'steam',
              platformEntityId: '3785140',
              score: 139,
            },
          ],
          expectedEntityKind: 'game',
          label: 'Primeval',
          query: 'Primeval',
          requiresClarification: false,
          selectedEntityUid: 'primeval',
          slotId: 'primary',
        },
      ],
    },
  });

  assert.equal(brief.selectionNote, null);
  assert.doesNotMatch(brief.fallbackMarkdown, /Another likely match is Primeval Genesis/i);
});
