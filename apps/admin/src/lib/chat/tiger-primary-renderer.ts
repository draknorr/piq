import 'server-only';

type TigerPrimaryRenderableIntent =
  | 'catalog_search'
  | 'entity_ranking'
  | 'metric_history';

interface TigerPrimaryCatalogItem {
  appid: number;
  name: string;
  platforms: string[];
  releaseYear: number | null;
  reviewScore: number | null;
  totalReviews: number | null;
}

interface TigerPrimaryCatalogResponse {
  interpretedFilters: {
    developerQuery: string | null;
    minReviewScore: number | null;
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

function formatGameLink(name: string, appid: number | null | undefined): string {
  return typeof appid === 'number' ? `[${name}](game:${appid})` : name;
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
  if (response.interpretedFilters.releaseYear?.gte != null) {
    qualifiers.push(`released since ${response.interpretedFilters.releaseYear.gte}`);
  }

  return qualifiers.length > 0
    ? `Here are the matching ${qualifiers.join(', ')} games from Tiger.`
    : 'Here are the matching games from Tiger.';
}

function renderCatalogSearch(response: TigerPrimaryCatalogResponse): string {
  const rows = response.items
    .slice(0, 10)
    .map((item) => [
      formatGameLink(item.name, item.appid),
      item.reviewScore == null ? 'n/a' : `${formatNumber(item.reviewScore)}/10`,
      formatNumber(item.totalReviews),
      item.platforms.join(', ') || 'n/a',
      item.releaseYear == null ? 'n/a' : String(item.releaseYear),
    ]);

  return [
    formatCatalogIntro(response),
    '',
    buildMarkdownTable(
      ['Game', 'Review Score', 'Total Reviews', 'Platforms', 'Release Year'],
      rows
    ),
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

export function renderTigerPrimaryResult(params: {
  matchedIntent: TigerPrimaryRenderableIntent;
  response: unknown;
}): string {
  if (params.matchedIntent === 'catalog_search') {
    return renderCatalogSearch(params.response as TigerPrimaryCatalogResponse);
  }

  if (params.matchedIntent === 'entity_ranking') {
    return renderRankEntities(params.response as TigerPrimaryRankEntitiesResponse);
  }

  return renderMetricHistory(params.response as TigerPrimaryTraceMetricHistoryResponse);
}
