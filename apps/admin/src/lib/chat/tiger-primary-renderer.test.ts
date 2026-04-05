import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTigerPrimaryResult } from './tiger-primary-renderer';

test('renderTigerPrimaryResult uses player-centric columns for current Peak CCU momentum answers', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'momentum_discovery',
    response: {
      filtersApplied: [],
      items: [
        {
          appid: 730,
          ccuPeak: 1404982,
          name: 'Counter-Strike 2',
          platformSupport: ['windows', 'linux'],
          reviewPercentage: null,
          reviewsAdded7d: 0,
          supportLevel: 'low',
          supportReasons: ['Current-state momentum evidence is limited.'],
          totalReviews: 10000000,
          trendDirection: 'stable',
        },
      ],
      rankingDefinition: 'Peak CCU uses the latest 24-hour concurrent-player snapshot.',
      rankingLabel: 'Peak CCU',
      sortBy: 'ccu_peak',
      sufficientToAnswer: true,
      timeframe: 'current',
      timeframeLabel: 'Current snapshot',
      trendType: null,
    },
  });

  assert.match(markdown, /\| Game \| Peak CCU \| Trend \| Total Reviews \| Platforms \|/);
  assert.doesNotMatch(markdown, /Reviews Added \(7d\)/);
  assert.doesNotMatch(markdown, /Review %/);
});

test('renderTigerPrimaryResult keeps review-centric columns for review momentum answers', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'momentum_discovery',
    response: {
      filtersApplied: [],
      items: [
        {
          appid: 1145360,
          ccuPeak: 50000,
          name: 'Hades II',
          platformSupport: ['windows'],
          reviewPercentage: 96,
          reviewsAdded7d: 2400,
          reviewsAdded30d: 5200,
          supportLevel: 'high',
          supportReasons: ['2,400 reviews added over 7d.'],
          totalReviews: 75000,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Reviews added (7d) counts net new reviews in the last 7 days.',
      rankingLabel: 'Reviews Added (7d)',
      sortBy: 'reviews_added_7d',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: 'review_momentum',
    },
  });

  assert.match(markdown, /\| Game \| Reviews Added \(7d\) \| Review % \| Total Reviews \| Peak CCU \| Platforms \|/);
});

test('renderTigerPrimaryResult uses sentiment-centric columns for review-sentiment answers', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'momentum_discovery',
    momentumPromptFamily: 'review_sentiment_down',
    response: {
      filtersApplied: [
        'sort_by: sentiment_delta',
        'timeframe: 30d',
        'min_reviews: 10000',
        'min_ccu: 100',
        'min_reviews_added_30d: 25',
        'max_sentiment_delta: -3',
      ],
      items: [
        {
          appid: 2668510,
          ccuPeak: 4200,
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
      ],
      rankingDefinition: 'Sentiment delta measures the change in positive-review rate versus the trailing 30-day baseline.',
      rankingLabel: 'Sentiment Delta',
      sortBy: 'sentiment_delta',
      sortDirection: 'asc',
      sufficientToAnswer: true,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
      trendType: null,
    },
  });

  assert.match(markdown, /\| Game \| Sentiment Delta \| Review % \| Reviews Added \(30d\) \| Total Reviews \| Platforms \|/);
  assert.match(markdown, /review sentiment decline/i);
  assert.match(markdown, /established titles/i);
});

test('renderTigerPrimaryResult renders numeric-string review percentages and broadening notes', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'momentum_discovery',
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
          appid: 2668510,
          ccuPeak: 4200,
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
    },
    scopeAdjustedForSparseResults: true,
  });

  assert.match(markdown, /74\.4%/);
  assert.match(markdown, /widened the default popularity floor to fill out this list/i);
  assert.doesNotMatch(markdown, /established titles/i);
});

test('renderTigerPrimaryResult explains when broadened review discovery still cannot fill five spots', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'momentum_discovery',
    response: {
      broadeningApplied: true,
      filtersApplied: [
        'sort_by: reviews_added_7d',
        'timeframe: 7d',
        'min_reviews: 250',
        'min_reviews_added_7d: 2',
      ],
      items: [
        {
          appid: 1245620,
          ccuPeak: 923,
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
      minimumItems: 5,
      rankingDefinition: 'Reviews added (7d) counts net new reviews in the last 7 days.',
      rankingLabel: 'Reviews Added (7d)',
      resultCount: 1,
      shortfallReason:
        'Only 1 title qualified even after relaxing the default popularity floor for this 7-day review-activity screen, so I could not fill 5 spots. The current window or recent history coverage is still too thin to fill the usual list.',
      sortBy: 'reviews_added_7d',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: 'review_momentum',
    },
  });

  assert.match(markdown, /Only 1 title qualified even after relaxing the default popularity floor/i);
});

test('renderTigerPrimaryResult names applied Steam Deck filters in momentum intros', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'momentum_discovery',
    response: {
      filtersApplied: ['sort_by: reviews_added_7d', 'timeframe: 7d', 'steam_deck: verified'],
      items: [
        {
          appid: 1,
          ccuPeak: 2276,
          name: 'Everwind',
          platformSupport: ['windows'],
          reviewPercentage: null,
          reviewsAdded7d: 2060,
          supportLevel: 'high',
          supportReasons: ['2,060 reviews added over 7d.'],
          totalReviews: 2060,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Reviews added (7d) counts net new reviews in the last 7 days.',
      rankingLabel: 'Reviews Added (7d)',
      sortBy: 'reviews_added_7d',
      sufficientToAnswer: true,
      timeframe: '7d',
      timeframeLabel: 'Last 7 days',
      trendType: 'review_momentum',
    },
  });

  assert.match(markdown, /Steam Deck Verified/i);
});

test('renderTigerPrimaryResult labels patch-note document sets as patch notes', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'news_search',
    response: {
      entity: {
        displayName: 'Primeval',
      },
      interpretedFilters: {
        mode: 'topic_search',
        query: 'patch notes',
      },
      items: [
        {
          appName: 'Primeval',
          bodyPreview: 'Accumulated Updates - March 13',
          excerpt: 'Accumulated Updates - March 13',
          feedLabel: 'Community Announcements',
          feedScope: 'community_announcements',
          publishedAt: '2026-03-13T00:00:00.000Z',
          sortTime: '2026-03-13T00:00:00.000Z',
          title: 'Accumulated Updates - March 13',
          url: 'https://example.com/update',
        },
      ],
    },
  });

  assert.match(markdown, /patch notes/i);
});

test('renderTigerPrimaryResult labels semantic scores as match scores out of 100', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'semantic_search',
    response: {
      mode: 'semantic',
      reference: {
        name: 'Hades',
        type: 'game',
      },
      results: [
        {
          id: 1,
          matchReasons: ['Same developer', 'Action Roguelike'],
          name: 'Hades II',
          review_percentage: 95,
          score: 47,
          total_reviews: 54000,
          type: 'game',
        },
      ],
      sufficient_to_answer: true,
      success: true,
    },
  });

  assert.match(markdown, /\| Result \| Match Score \| Review % \| Total Reviews \|/);
  assert.match(markdown, /\| \[Hades II\]\(game:1\) \| 47\/100 \| 95% \| 54,000 \|/);
  assert.doesNotMatch(markdown, /\| Score \|/);
});

test('renderTigerPrimaryResult sanitizes news table cells so titles cannot break markdown rows', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'news_search',
    response: {
      entity: null,
      interpretedFilters: {
        mode: 'topic_search',
        query: 'developer diary',
      },
      items: [
        {
          appName: 'The Legend of Khimori',
          bodyPreview: null,
          excerpt: null,
          feedLabel: 'Community Announcements',
          feedScope: 'community_announcements',
          publishedAt: '2026-01-16T12:00:00.000Z',
          sortTime: '2026-01-16T12:00:00.000Z',
          title: 'Developer Diary #18\nTaming the Open Wilds of 13th Century Mongolia',
          url: 'https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1821922921815466',
        },
      ],
    },
  });

  assert.match(
    markdown,
    /\| 2026-01-16 \| \[Developer Diary #18 Taming the Open Wilds of 13th Century Mongolia\]\(<https:\/\/steamstore-a\.akamaihd\.net\/news\/externalpost\/steam_community_announcements\/1821922921815466>\) \| The Legend of Khimori \| Community Announcements \|/
  );
  assert.doesNotMatch(markdown, /Developer Diary #18\nTaming the Open Wilds/);
});

test('renderTigerPrimaryResult separates strict semantic matches from close alternatives', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'semantic_search',
    request: {
      entityKind: 'game',
      filters: {
        review_comparison: 'better_only',
      },
      mode: 'similarity',
      referenceQuery: 'Hades',
    },
    response: {
      close_alternatives: [
        {
          id: 367520,
          matchReasons: ['Action', 'Indie', 'Metroidvania', 'Singleplayer'],
          name: 'Hollow Knight',
          review_percentage: 96.9,
          score: 47,
          total_reviews: 355000,
          type: 'game',
        },
      ],
      close_alternatives_reason:
        'These stay highly similar, but they miss the stricter higher-review cutoff from the original request.',
      mode: 'semantic',
      reference: {
        name: 'Hades',
        type: 'game',
      },
      results: [
        {
          id: 413150,
          matchReasons: ['Great Soundtrack', 'Indie', 'RPG', 'Singleplayer'],
          name: 'Stardew Valley',
          review_percentage: 98.5,
          score: 47,
          total_reviews: 990611,
          type: 'game',
        },
      ],
      sufficient_to_answer: true,
      success: true,
    },
  });

  assert.match(markdown, /Strict matches/);
  assert.match(markdown, /Close alternatives/);
  assert.match(markdown, /higher-review cutoff/i);
  assert.match(markdown, /Stardew Valley/);
  assert.match(markdown, /Hollow Knight/);
});

test('renderTigerPrimaryResult frames canonical facet answers as paired facets', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'catalog_search',
    response: {
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
      },
      items: [],
      sufficientToAnswer: true,
    },
  });

  assert.match(markdown, /most commonly paired with \*\*Colony Sim\*\*/i);
  assert.doesNotMatch(markdown, /closest matching tags/i);
  assert.match(markdown, /Base Building/);
});

test('renderTigerPrimaryResult omits zero-signal peak ccu columns from review momentum tables', () => {
  const markdown = renderTigerPrimaryResult({
    matchedIntent: 'momentum_discovery',
    response: {
      filtersApplied: ['sort_by: reviews_added_30d', 'timeframe: 30d'],
      items: [
        {
          appid: 777,
          ccuPeak: null,
          name: 'Example Horror',
          platformSupport: ['windows'],
          reviewPercentage: 81.2,
          reviewsAdded30d: 102,
          supportLevel: 'medium',
          supportReasons: ['102 reviews added over 30d.'],
          totalReviews: 3200,
          trendDirection: 'up',
        },
      ],
      rankingDefinition: 'Reviews added (30d) counts net new reviews in the last 30 days.',
      rankingLabel: 'Reviews Added (30d)',
      sortBy: 'reviews_added_30d',
      sufficientToAnswer: true,
      timeframe: '30d',
      timeframeLabel: 'Last 30 days',
      trendType: null,
    },
  });

  assert.match(markdown, /\| Game \| Reviews Added \(30d\) \| Review % \| Total Reviews \| Platforms \|/);
  assert.doesNotMatch(markdown, /Peak CCU/);
});
