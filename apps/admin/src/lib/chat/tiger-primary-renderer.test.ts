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
