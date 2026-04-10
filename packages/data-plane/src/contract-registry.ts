import type { QueryContractDescriptor } from './contracts.js';

export const CONTRACT_REGISTRY: QueryContractDescriptor[] = [
  {
    name: 'resolveEntities',
    endpoint: '/v1/contracts/resolve-entities',
    status: 'ready',
    requiredRelations: ['apps', 'latest_daily_metrics', 'publishers', 'developers'],
    description:
      'Resolve fuzzy game, publisher, and developer references into typed entities with ambiguity metadata.',
    naturalLanguageStrength: [
      'specific game questions',
      'ambiguous company names',
      'follow-up pronoun resolution'
    ],
  },
  {
    name: 'getEntityOverview',
    endpoint: '/v1/contracts/get-entity-overview',
    status: 'ready',
    requiredRelations: [
      'core_entities',
      'apps',
      'latest_daily_metrics',
      'app_publishers',
      'publishers',
      'app_developers',
      'developers',
    ],
    description:
      'Return a current overview for one game, publisher, or developer plus optional related game rows.',
    naturalLanguageStrength: [
      'tell me about X',
      'games by a company',
      'how many games has this company published'
    ],
  },
  {
    name: 'getRelatedEntities',
    endpoint: '/v1/contracts/get-related-entities',
    status: 'ready',
    requiredRelations: [
      'apps',
      'latest_daily_metrics',
      'app_dlc',
      'app_franchises',
      'franchises',
      'app_steam_deck',
    ],
    description:
      'Expand a resolved game into typed relation sets such as DLC and same-franchise games with optional quality and Steam Deck filters.',
    naturalLanguageStrength: [
      'show me all DLC for a game',
      'games in the same series',
      'same-franchise follow-ups with quality or platform filters'
    ],
  },
  {
    name: 'searchCatalog',
    endpoint: '/v1/contracts/search-catalog',
    status: 'ready',
    requiredRelations: [
      'apps',
      'latest_daily_metrics',
      'app_publishers',
      'publishers',
      'app_developers',
      'developers',
    ],
    description:
      'Search the live catalog with broad free-form constraints while keeping typed filters and continuation tokens.',
    naturalLanguageStrength: [
      'broad discovery questions',
      'mixed constraints like price plus reviews plus platform',
      'result-set continuation'
    ],
  },
  {
    name: 'discoverMomentum',
    endpoint: '/v1/contracts/discover-momentum',
    status: 'ready',
    requiredRelations: [
      'apps',
      'latest_daily_metrics',
      'metrics_daily_metrics',
      'app_publishers',
      'publishers',
      'app_developers',
      'developers',
    ],
    description:
      'Find games by current player strength, review-velocity momentum, and breakout-style trend signals with typed filters.',
    naturalLanguageStrength: [
      'what is gaining momentum',
      'what has the most players right now',
      'breaking out genre screens'
    ],
  },
  {
    name: 'searchChangeActivity',
    endpoint: '/v1/contracts/search-change-activity',
    status: 'ready',
    requiredRelations: [
      'apps',
      'events_app_change_events',
      'docs_steam_news_items',
      'docs_steam_news_search_projection',
    ],
    description:
      'Return a ranked cross-game stream of recent Steam change activity and related announcements.',
    naturalLanguageStrength: [
      'biggest page refreshes',
      'release timing changes',
      'cross-game change discovery'
    ],
  },
  {
    name: 'discoverChangePatterns',
    endpoint: '/v1/contracts/discover-change-patterns',
    status: 'ready',
    requiredRelations: [
      'apps',
      'latest_daily_metrics',
      'metrics_daily_metrics',
      'events_app_change_events',
      'docs_steam_news_items',
      'docs_steam_news_search_projection',
    ],
    description:
      'Find higher-level marketing, relaunch, teaser, and response patterns across recent Steam change activity.',
    naturalLanguageStrength: [
      'marketing push prompts',
      'under-marketed or signable candidates',
      'sustained or weak-response patterns'
    ],
  },
  {
    name: 'rankEntities',
    endpoint: '/v1/contracts/rank-entities',
    status: 'ready',
    requiredRelations: [
      'apps',
      'latest_daily_metrics',
      'app_publishers',
      'publishers',
      'app_developers',
      'developers',
    ],
    description:
      'Rank games or companies by metric and explain the scoring surface used.',
    naturalLanguageStrength: ['top/best/fastest questions', 'ranking follow-ups'],
  },
  {
    name: 'compareEntities',
    endpoint: '/v1/contracts/compare-entities',
    status: 'ready',
    requiredRelations: [
      'core_entities',
      'apps',
      'latest_daily_metrics',
      'app_publishers',
      'publishers',
      'app_developers',
      'developers',
    ],
    description:
      'Compare entities across a fixed set of metrics and derived narrative hints.',
    naturalLanguageStrength: ['A vs B questions', 'peer-set comparison'],
  },
  {
    name: 'traceMetricHistory',
    endpoint: '/v1/contracts/trace-metric-history',
    status: 'ready',
    requiredRelations: ['core_entities', 'metrics_daily_metrics'],
    description:
      'Return historical metric traces for a resolved game entity.',
    naturalLanguageStrength: ['trend questions', 'what changed over time'],
  },
  {
    name: 'explainChanges',
    endpoint: '/v1/contracts/explain-changes',
    status: 'ready',
    requiredRelations: [
      'core_entities',
      'events_app_change_events',
      'docs_steam_news_items',
      'docs_steam_news_search_projection',
    ],
    description:
      'Combine event and recent-news surfaces into a single change-intel explanation contract.',
    naturalLanguageStrength: ['why did this spike', 'what changed recently'],
  },
  {
    name: 'searchDocuments',
    endpoint: '/v1/contracts/search-documents',
    status: 'ready',
    requiredRelations: ['docs_steam_news_items', 'docs_steam_news_search_projection'],
    description:
      'Search news and archived document metadata with topic-aware ranking.',
    naturalLanguageStrength: ['news questions', 'topic and theme lookups'],
  },
  {
    name: 'semanticSearch',
    endpoint: '/v1/contracts/semantic-search',
    status: 'ready',
    requiredRelations: [
      'apps',
      'latest_daily_metrics',
      'publishers',
      'developers',
      'app_publishers',
      'app_developers',
      'app_genres',
      'steam_genres',
      'app_steam_tags',
      'steam_tags',
    ],
    description:
      'Resolve concept- and similarity-driven prompts against entity-linked embeddings.',
    naturalLanguageStrength: ['games like X', 'concept search'],
  },
  {
    name: 'getUserContext',
    endpoint: '/v1/contracts/get-user-context',
    status: 'ready',
    requiredRelations: [
      'user_pins',
      'user_alerts',
      'user_alert_preferences',
      'user_pin_alert_settings',
      'apps',
      'latest_daily_metrics',
      'publishers',
      'developers',
    ],
    description:
      'Return the user context needed for portfolio, pin, and alert-aware chat.',
    naturalLanguageStrength: ['my portfolio', 'games I pinned'],
  },
  {
    name: 'continueResultSet',
    endpoint: '/v1/contracts/continue-result-set',
    status: 'ready',
    requiredRelations: [
      'apps',
      'latest_daily_metrics',
      'app_publishers',
      'publishers',
      'app_developers',
      'developers',
    ],
    description:
      'Resume a prior result set with offsets, exclusions, and conversational refinements.',
    naturalLanguageStrength: ['show me more', 'same set but only co-op'],
  },
  {
    name: 'getYoutubeGameCoverage',
    endpoint: '/v1/contracts/get-youtube-game-coverage',
    status: 'ready',
    requiredRelations: [
      'core_entities',
      'docs_youtube_videos',
      'docs_youtube_channels',
      'docs_youtube_video_matches',
      'metrics_youtube_video_snapshots',
      'metrics_youtube_game_daily',
    ],
    description:
      'Return current per-game YouTube coverage for the strongest v1 views: latest videos, creator coverage, top videos, growth, content mix, and cadence.',
    naturalLanguageStrength: [
      'explicit YouTube questions for one game',
      'creator coverage for a tracked title',
      'latest or fastest-growing matched videos',
    ],
  },
];
