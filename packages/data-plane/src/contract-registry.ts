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
    status: 'planned',
    requiredRelations: [],
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
    ],
    description:
      'Resolve concept- and similarity-driven prompts against entity-linked embeddings.',
    naturalLanguageStrength: ['games like X', 'concept search'],
  },
  {
    name: 'getUserContext',
    endpoint: '/v1/contracts/get-user-context',
    status: 'planned',
    requiredRelations: [],
    description:
      'Return the user context needed for portfolio, pin, and alert-aware chat.',
    naturalLanguageStrength: ['my portfolio', 'games I pinned'],
  },
  {
    name: 'continueResultSet',
    endpoint: '/v1/contracts/continue-result-set',
    status: 'planned',
    requiredRelations: [],
    description:
      'Resume a prior result set with offsets, exclusions, and conversational refinements.',
    naturalLanguageStrength: ['show me more', 'same set but only co-op'],
  },
];
