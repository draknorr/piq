import 'server-only';

type TigerPrimaryRenderableIntent =
  | 'catalog_search'
  | 'change_explanation'
  | 'entity_compare'
  | 'entity_overview'
  | 'entity_ranking'
  | 'metric_history'
  | 'news_search'
  | 'semantic_search';

interface TigerPrimaryCatalogItem {
  appid: number;
  discountPercent?: number | null;
  name: string;
  platforms: string[];
  priceCents?: number | null;
  releaseYear: number | null;
  reviewScore: number | null;
  totalReviews: number | null;
}

interface TigerPrimaryCatalogResponse {
  interpretedFilters: {
    developerQuery: string | null;
    maxPriceCents?: number | null;
    minDiscountPercent?: number | null;
    minPriceCents?: number | null;
    minReviewScore: number | null;
    onSale?: boolean | null;
    platforms: string[];
    publisherQuery: string | null;
    query: string | null;
    releaseYear: {
      gte: number | null;
      lte: number | null;
    } | null;
    tags: string[];
  };
  items: TigerPrimaryCatalogItem[];
}

interface TigerPrimaryEntityOverviewGameItem {
  appid: number;
  name: string;
  ownersMidpoint: number | null;
  releaseDate: string | null;
  releaseYear: number | null;
  reviewScore: number | null;
  totalReviews: number | null;
}

interface TigerPrimaryEntityOverviewResponse {
  entity: {
    details: {
      appType: string | null;
      developers: string[];
      discountPercent: number | null;
      isFree: boolean | null;
      isReleased: boolean | null;
      platforms: string[];
      priceCents: number | null;
      publishers: string[];
      releaseDate: string | null;
      releaseState: string | null;
      releaseYear: number | null;
    };
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
    metrics: {
      ccuPeak: number | null;
      gameCount: number | null;
      ownersMidpoint: number | null;
      reviewScore: number | null;
      totalReviews: number | null;
    };
  };
  games: TigerPrimaryEntityOverviewGameItem[];
  viewMode: 'company_count' | 'company_games' | 'game_overview';
}

interface TigerPrimaryRankedEntity {
  displayName: string;
  entityKind: 'developer' | 'game' | 'publisher';
  metricValue: number | null;
  metrics: {
    ccuPeak: number | null;
    gameCount: number | null;
    ownersMidpoint: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  };
  platformEntityId: string;
  rank: number;
  releaseYear?: number | null;
}

interface TigerPrimaryRankEntitiesResponse {
  entityKind: 'developer' | 'game' | 'publisher';
  items: TigerPrimaryRankedEntity[];
  metric: 'ccu_peak' | 'game_count' | 'owners_midpoint' | 'review_score' | 'total_reviews';
}

interface TigerPrimaryCompareEntity {
  displayName: string;
  entityKind: 'developer' | 'game' | 'publisher';
  entityUid: string;
  metrics: {
    ccuPeak: number | null;
    gameCount: number | null;
    ownersMidpoint: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  };
  platformEntityId: string;
  releaseYear?: number | null;
}

interface TigerPrimaryCompareEntitiesResponse {
  entityKind: 'developer' | 'game' | 'publisher';
  highlights: Array<{
    displayName: string;
    entityUid: string;
    metric: 'ccu_peak' | 'game_count' | 'owners_midpoint' | 'review_score' | 'total_reviews';
    value: number | null;
  }>;
  items: TigerPrimaryCompareEntity[];
  metrics: Array<'ccu_peak' | 'game_count' | 'owners_midpoint' | 'review_score' | 'total_reviews'>;
}

interface TigerPrimaryTraceMetricHistorySeries {
  metric:
    | 'average_playtime_2weeks'
    | 'average_playtime_forever'
    | 'ccu_peak'
    | 'discount_percent'
    | 'owners_midpoint'
    | 'positive_percentage'
    | 'price_cents'
    | 'review_score'
    | 'total_reviews';
  summary: {
    deltaAbs: number | null;
    deltaPct: number | null;
    latestValue: number | null;
    startValue: number | null;
  };
}

interface TigerPrimaryTraceMetricHistoryResponse {
  endDate: string;
  entity: {
    displayName: string;
  };
  series: TigerPrimaryTraceMetricHistorySeries[];
  startDate: string;
}

interface TigerPrimarySearchDocumentItem {
  appName: string;
  feedLabel: string | null;
  feedScope: string;
  publishedAt: string | null;
  sortTime: string;
  title: string | null;
  url: string;
}

interface TigerPrimarySearchDocumentsResponse {
  entity: {
    displayName: string;
  } | null;
  interpretedFilters: {
    query: string;
  };
  items: TigerPrimarySearchDocumentItem[];
}

interface TigerPrimarySemanticSearchResult {
  id: number;
  matchReasons?: string[];
  name: string;
  price_cents?: number | null;
  review_percentage?: number | null;
  score: number;
  steam_deck?: 'unknown' | 'unsupported' | 'playable' | 'verified';
  total_reviews?: number | null;
  type?: string;
}

interface TigerPrimarySemanticSearchResponse {
  continuation_token?: string | null;
  entityType?: 'developer' | 'publisher';
  mode?: 'heuristic_portfolio' | 'semantic';
  query_description?: string;
  reference?: {
    id: number;
    name: string;
    type: string;
  };
  results?: TigerPrimarySemanticSearchResult[];
}

interface TigerPrimaryExplainChangesEvent {
  afterValue: unknown | null;
  beforeValue: unknown | null;
  changeType: string;
}

interface TigerPrimaryExplainChangesMoment {
  changeTypes: string[];
  eventCount: number;
  events: TigerPrimaryExplainChangesEvent[];
  linkedNews: Array<{
    title: string | null;
    url: string;
  }>;
  sources: string[];
  windowStart: string;
}

interface TigerPrimaryExplainChangesResponse {
  entity: {
    displayName: string;
  };
  moments: TigerPrimaryExplainChangesMoment[];
  summary: {
    eventCount: number;
    momentCount: number;
    newsCount: number;
  };
  timeWindow: {
    endTime: string;
    startTime: string;
  };
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  if (!Number.isInteger(value)) {
    return value.toFixed(2);
  }

  return value.toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatCurrencyCents(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return `$${(value / 100).toFixed(2)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return value.slice(0, 10);
}

function formatGameLink(name: string, appid: number | null | undefined): string {
  return typeof appid === 'number' ? `[${name}](game:${appid})` : name;
}

function formatTitleLink(title: string | null | undefined, url: string): string {
  const label = title?.trim() || 'Untitled';
  return `[${label}](${url})`;
}

function formatUnknownValue(value: unknown): string {
  if (value == null) {
    return 'n/a';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'string') {
    return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  }

  return 'updated';
}

function humanizeChangeType(changeType: string): string {
  return changeType.replace(/_/g, ' ');
}

function buildMarkdownTable(columns: string[], rows: string[][]): string {
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function formatCatalogIntro(response: TigerPrimaryCatalogResponse): string {
  const company = response.interpretedFilters.developerQuery || response.interpretedFilters.publisherQuery;
  if (company) {
    return `Here are the matching games for **${company}** from Tiger.`;
  }

  const qualifiers: string[] = [];
  if (response.interpretedFilters.tags.includes('Indie')) {
    qualifiers.push('indie');
  }
  if (response.interpretedFilters.platforms.length > 0) {
    qualifiers.push(response.interpretedFilters.platforms.join('/'));
  }
  if (response.interpretedFilters.minReviewScore != null) {
    qualifiers.push(`review threshold ${response.interpretedFilters.minReviewScore}`);
  }
  if (response.interpretedFilters.minPriceCents != null) {
    qualifiers.push(`priced above ${formatCurrencyCents(response.interpretedFilters.minPriceCents)}`);
  }
  if (response.interpretedFilters.maxPriceCents != null) {
    qualifiers.push(`priced under ${formatCurrencyCents(response.interpretedFilters.maxPriceCents)}`);
  }
  if (response.interpretedFilters.onSale) {
    qualifiers.push('currently on sale');
  }
  if (response.interpretedFilters.releaseYear?.gte != null) {
    qualifiers.push(`released since ${response.interpretedFilters.releaseYear.gte}`);
  }

  return qualifiers.length > 0
    ? `Here are the matching ${qualifiers.join(', ')} games from Tiger.`
    : 'Here are the matching games from Tiger.';
}

function renderCatalogSearch(response: TigerPrimaryCatalogResponse): string {
  const showPrice =
    response.interpretedFilters.minPriceCents != null
    || response.interpretedFilters.maxPriceCents != null
    || response.interpretedFilters.onSale === true;
  const showDiscount =
    response.interpretedFilters.onSale === true
    || response.interpretedFilters.minDiscountPercent != null;
  const columns = ['Game', 'Review Score', 'Total Reviews'];
  if (showPrice) {
    columns.push('Price');
  }
  if (showDiscount) {
    columns.push('Discount');
  }
  columns.push('Platforms', 'Release Year');

  const rows = response.items
    .slice(0, 10)
    .map((item) => {
      const row = [
        formatGameLink(item.name, item.appid),
        item.reviewScore == null ? 'n/a' : `${formatNumber(item.reviewScore)}/10`,
        formatNumber(item.totalReviews),
      ];

      if (showPrice) {
        row.push(formatCurrencyCents(item.priceCents));
      }
      if (showDiscount) {
        row.push(item.discountPercent == null ? 'n/a' : `${formatNumber(item.discountPercent)}%`);
      }

      row.push(item.platforms.join(', ') || 'n/a');
      row.push(item.releaseYear == null ? 'n/a' : String(item.releaseYear));
      return row;
    });

  return [
    formatCatalogIntro(response),
    '',
    buildMarkdownTable(columns, rows),
  ].join('\n');
}

function metricLabel(metric: TigerPrimaryRankEntitiesResponse['metric']): string {
  switch (metric) {
    case 'ccu_peak':
      return 'Peak CCU';
    case 'game_count':
      return 'Game Count';
    case 'owners_midpoint':
      return 'Owners';
    case 'review_score':
      return 'Review Score';
    case 'total_reviews':
      return 'Total Reviews';
    default:
      return metric;
  }
}

function formatMetricValue(
  metric: TigerPrimaryRankEntitiesResponse['metric'],
  value: number | null
): string {
  if (metric === 'review_score') {
    return value == null ? 'n/a' : `${formatNumber(value)}/10`;
  }

  return formatNumber(value);
}

function renderRankEntities(response: TigerPrimaryRankEntitiesResponse): string {
  const nameColumn = response.entityKind === 'game' ? 'Game' : 'Entity';
  const secondaryColumn = response.entityKind === 'game'
    ? 'Release Year'
    : response.metric === 'game_count'
      ? 'Owners'
      : 'Total Reviews';

  const rows = response.items.slice(0, 10).map((item) => {
    const secondaryValue = response.entityKind === 'game'
      ? (item.releaseYear == null ? 'n/a' : String(item.releaseYear))
      : response.metric === 'game_count'
        ? formatNumber(item.metrics.ownersMidpoint)
        : formatNumber(item.metrics.totalReviews);

    return [
      String(item.rank),
      item.entityKind === 'game'
        ? formatGameLink(item.displayName, Number(item.platformEntityId))
        : item.displayName,
      formatMetricValue(response.metric, item.metricValue),
      secondaryValue,
    ];
  });

  return [
    `Here are the top ${response.entityKind === 'game' ? 'games' : `${response.entityKind}s`} by **${metricLabel(response.metric)}** from Tiger.`,
    '',
    buildMarkdownTable(
      ['Rank', nameColumn, metricLabel(response.metric), secondaryColumn],
      rows
    ),
  ].join('\n');
}

function renderCompareMetricValue(
  metric: TigerPrimaryCompareEntitiesResponse['metrics'][number],
  item: TigerPrimaryCompareEntity
): string {
  switch (metric) {
    case 'ccu_peak':
      return formatNumber(item.metrics.ccuPeak);
    case 'game_count':
      return formatNumber(item.metrics.gameCount);
    case 'owners_midpoint':
      return formatNumber(item.metrics.ownersMidpoint);
    case 'review_score':
      return item.metrics.reviewScore == null ? 'n/a' : `${formatNumber(item.metrics.reviewScore)}/10`;
    case 'total_reviews':
      return formatNumber(item.metrics.totalReviews);
    default:
      return 'n/a';
  }
}

function renderCompareScalarValue(
  metric: TigerPrimaryCompareEntitiesResponse['metrics'][number],
  value: number | null
): string {
  if (metric === 'review_score') {
    return value == null ? 'n/a' : `${formatNumber(value)}/10`;
  }

  return formatNumber(value);
}

function renderCompareEntities(response: TigerPrimaryCompareEntitiesResponse): string {
  const metricColumns = response.metrics.slice(0, 4);
  const namedPeers = response.items.map((item) => item.displayName);
  const compareTarget =
    namedPeers.length >= 2 && namedPeers.length <= 3
      ? namedPeers.length === 2
        ? `${namedPeers[0]} and ${namedPeers[1]}`
        : `${namedPeers.slice(0, -1).join(', ')}, and ${namedPeers[namedPeers.length - 1]}`
      : `these ${response.entityKind === 'game' ? 'games' : `${response.entityKind}s`}`;
  const columns = [
    response.entityKind === 'game' ? 'Game' : 'Entity',
    ...metricColumns.map(metricLabel),
  ];
  const rows = response.items.map((item) => [
    item.entityKind === 'game'
      ? formatGameLink(item.displayName, Number(item.platformEntityId))
      : item.displayName,
    ...metricColumns.map((metric) => renderCompareMetricValue(metric, item)),
  ]);
  const highlights = response.highlights
    .slice(0, 3)
    .map((highlight) => `- **${metricLabel(highlight.metric)}** leader: ${highlight.displayName} (${renderCompareScalarValue(highlight.metric, highlight.value)})`);

  return [
    `Here is the Tiger comparison for ${compareTarget}.`,
    '',
    buildMarkdownTable(columns, rows),
    ...(highlights.length > 0 ? ['', ...highlights] : []),
  ].join('\n');
}

function historyMetricLabel(metric: TigerPrimaryTraceMetricHistorySeries['metric']): string {
  switch (metric) {
    case 'average_playtime_2weeks':
      return 'Average Playtime (2 weeks)';
    case 'average_playtime_forever':
      return 'Average Playtime (Forever)';
    case 'ccu_peak':
      return 'Peak CCU';
    case 'discount_percent':
      return 'Discount';
    case 'owners_midpoint':
      return 'Owners';
    case 'positive_percentage':
      return 'Positive %';
    case 'price_cents':
      return 'Price';
    case 'review_score':
      return 'Review Score';
    case 'total_reviews':
      return 'Total Reviews';
    default:
      return metric;
  }
}

function formatHistoryValue(
  metric: TigerPrimaryTraceMetricHistorySeries['metric'],
  value: number | null
): string {
  if (metric === 'price_cents') {
    return formatCurrencyCents(value);
  }

  if (metric === 'discount_percent' || metric === 'positive_percentage') {
    return formatPercent(value);
  }

  if (metric === 'review_score') {
    return value == null ? 'n/a' : `${formatNumber(value)}/10`;
  }

  return formatNumber(value);
}

function renderMetricHistory(response: TigerPrimaryTraceMetricHistoryResponse): string {
  const bullets = response.series.map((series) => {
    const summary = series.summary;
    const startValue = formatHistoryValue(series.metric, summary.startValue);
    const latestValue = formatHistoryValue(series.metric, summary.latestValue);
    const deltaAbs = formatHistoryValue(series.metric, summary.deltaAbs);
    const deltaPct = summary.deltaPct == null ? null : formatPercent(summary.deltaPct);

    return `- **${historyMetricLabel(series.metric)}**: ${startValue} -> ${latestValue} (${deltaAbs}${deltaPct ? `, ${deltaPct}` : ''})`;
  });

  return [
    `Here is the Tiger metric history for **${response.entity.displayName}** from **${response.startDate}** through **${response.endDate}**.`,
    '',
    ...bullets,
  ].join('\n');
}

function renderSearchDocuments(response: TigerPrimarySearchDocumentsResponse): string {
  const intro = response.entity
    ? `Here are the most relevant recent documents for **${response.entity.displayName}** from Tiger.`
    : `Here are the most relevant recent documents for **${response.interpretedFilters.query}** from Tiger.`;

  const rows = response.items.slice(0, 8).map((item) => [
    formatDate(item.publishedAt || item.sortTime),
    formatTitleLink(item.title, item.url),
    item.appName,
    item.feedLabel || item.feedScope,
  ]);

  return [
    intro,
    '',
    buildMarkdownTable(
      ['Published', 'Title', 'Game', 'Source'],
      rows
    ),
  ].join('\n');
}

function joinLabels(values: string[] | null | undefined): string {
  if (!Array.isArray(values) || values.length === 0) {
    return 'n/a';
  }

  return values.join(', ');
}

function formatReleaseStatus(details: TigerPrimaryEntityOverviewResponse['entity']['details']): string {
  if (details.releaseState?.trim()) {
    return details.releaseState.trim();
  }

  if (details.isReleased === true) {
    return 'released';
  }

  if (details.isReleased === false) {
    return 'unreleased';
  }

  return 'n/a';
}

function renderEntityOverview(response: TigerPrimaryEntityOverviewResponse): string {
  const entity = response.entity;
  const details = entity.details;

  if (entity.entityKind === 'game') {
    return [
      `Here is the Tiger overview for **${entity.displayName}**.`,
      '',
      `- **Release date**: ${formatDate(details.releaseDate)}`,
      `- **Release status**: ${formatReleaseStatus(details)}`,
      `- **Price**: ${details.isFree ? 'Free' : formatCurrencyCents(details.priceCents)}`,
      `- **Review score**: ${formatPercent(entity.metrics.reviewScore)}`,
      `- **Total reviews**: ${formatNumber(entity.metrics.totalReviews)}`,
      `- **Owners midpoint**: ${formatNumber(entity.metrics.ownersMidpoint)}`,
      `- **CCU peak**: ${formatNumber(entity.metrics.ccuPeak)}`,
      `- **Publishers**: ${joinLabels(details.publishers)}`,
      `- **Developers**: ${joinLabels(details.developers)}`,
      `- **Platforms**: ${joinLabels(details.platforms)}`,
    ].join('\n');
  }

  const intro =
    response.viewMode === 'company_count'
      ? `**${entity.displayName}** currently has **${formatNumber(entity.metrics.gameCount)}** games in the Tiger catalog.`
      : `Here is the Tiger overview for **${entity.displayName}**.`;

  const games = response.games.slice(0, 5).map((game) => [
    formatGameLink(game.name, game.appid),
    game.releaseYear == null ? 'n/a' : String(game.releaseYear),
    game.reviewScore == null ? 'n/a' : formatPercent(game.reviewScore),
    game.totalReviews == null ? 'n/a' : formatNumber(game.totalReviews),
    game.ownersMidpoint == null ? 'n/a' : formatNumber(game.ownersMidpoint),
  ]);

  const sections = [
    intro,
    '',
    `- **Game count**: ${formatNumber(entity.metrics.gameCount)}`,
    `- **Portfolio review score**: ${formatPercent(entity.metrics.reviewScore)}`,
    `- **Portfolio total reviews**: ${formatNumber(entity.metrics.totalReviews)}`,
    `- **Portfolio owners midpoint**: ${formatNumber(entity.metrics.ownersMidpoint)}`,
    `- **Portfolio CCU peak**: ${formatNumber(entity.metrics.ccuPeak)}`,
  ];

  if (games.length > 0) {
    sections.push(
      '',
      response.viewMode === 'company_count' ? 'Sample titles:' : 'Top titles:',
      '',
      buildMarkdownTable(['Game', 'Year', 'Review %', 'Total Reviews', 'Owners'], games)
    );
  }

  return sections.join('\n');
}

function renderSemanticSearch(response: TigerPrimarySemanticSearchResponse): string {
  const rows = (response.results ?? []).slice(0, 10).map((item) => [
    item.type === 'game' || !response.entityType
      ? formatGameLink(item.name, item.id)
      : item.name,
    formatNumber(item.score),
    item.review_percentage == null ? 'n/a' : formatPercent(item.review_percentage),
    formatNumber(item.total_reviews),
    item.price_cents == null ? 'n/a' : formatCurrencyCents(item.price_cents),
    item.matchReasons?.join(', ') || 'semantic match',
  ]);

  const intro = response.reference
    ? `Here are the closest Tiger matches for **${response.reference.name}**.`
    : response.query_description
      ? `Here are the closest Tiger matches for **${response.query_description}**.`
      : 'Here are the closest Tiger matches.';

  return [
    intro,
    '',
    buildMarkdownTable(['Result', 'Score', 'Review %', 'Total Reviews', 'Price', 'Why It Matched'], rows),
  ].join('\n');
}

function renderExplainChangesEvent(event: TigerPrimaryExplainChangesEvent): string {
  const beforeValue = formatUnknownValue(event.beforeValue);
  const afterValue = formatUnknownValue(event.afterValue);

  if (beforeValue !== 'n/a' || afterValue !== 'n/a') {
    return `${humanizeChangeType(event.changeType)} (${beforeValue} -> ${afterValue})`;
  }

  return humanizeChangeType(event.changeType);
}

function renderExplainChanges(response: TigerPrimaryExplainChangesResponse): string {
  const bullets = response.moments.slice(0, 5).map((moment) => {
    const changeSummary = moment.changeTypes
      .slice(0, 3)
      .map(humanizeChangeType)
      .join(', ');
    const eventSummary = moment.events
      .slice(0, 2)
      .map(renderExplainChangesEvent)
      .join('; ');
    const newsSummary = moment.linkedNews
      .slice(0, 1)
      .map((item) => `News: ${formatTitleLink(item.title, item.url)}`)
      .join(' ');

    const detailParts = [
      `${moment.eventCount} event${moment.eventCount === 1 ? '' : 's'} from ${moment.sources.join(', ')}`,
      changeSummary ? `(${changeSummary})` : '',
      eventSummary ? `${eventSummary}.` : '',
      newsSummary,
    ].filter(Boolean);

    return `- **${formatDate(moment.windowStart)}**: ${detailParts.join(' ')}`;
  });

  return [
    `Here are the main Tiger change moments for **${response.entity.displayName}** from **${formatDate(response.timeWindow.startTime)}** through **${formatDate(response.timeWindow.endTime)}**.`,
    '',
    `Summary: ${formatNumber(response.summary.eventCount)} events across ${formatNumber(response.summary.momentCount)} moments and ${formatNumber(response.summary.newsCount)} linked news items.`,
    '',
    ...bullets,
  ].join('\n');
}

export function renderTigerPrimaryResult(params: {
  matchedIntent: TigerPrimaryRenderableIntent;
  response: unknown;
}): string {
  if (params.matchedIntent === 'catalog_search') {
    return renderCatalogSearch(params.response as TigerPrimaryCatalogResponse);
  }

  if (params.matchedIntent === 'entity_overview') {
    return renderEntityOverview(params.response as TigerPrimaryEntityOverviewResponse);
  }

  if (params.matchedIntent === 'entity_ranking') {
    return renderRankEntities(params.response as TigerPrimaryRankEntitiesResponse);
  }

  if (params.matchedIntent === 'entity_compare') {
    return renderCompareEntities(params.response as TigerPrimaryCompareEntitiesResponse);
  }

  if (params.matchedIntent === 'metric_history') {
    return renderMetricHistory(params.response as TigerPrimaryTraceMetricHistoryResponse);
  }

  if (params.matchedIntent === 'news_search') {
    return renderSearchDocuments(params.response as TigerPrimarySearchDocumentsResponse);
  }

  if (params.matchedIntent === 'semantic_search') {
    return renderSemanticSearch(params.response as TigerPrimarySemanticSearchResponse);
  }

  return renderExplainChanges(params.response as TigerPrimaryExplainChangesResponse);
}
