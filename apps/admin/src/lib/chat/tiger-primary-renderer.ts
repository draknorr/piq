import 'server-only';

import type { SessionMomentumPromptFamily } from '@/lib/chat/chat-context-types';

type TigerPrimaryRenderableIntent =
  | 'catalog_search'
  | 'change_discovery'
  | 'change_explanation'
  | 'entity_compare'
  | 'entity_overview'
  | 'entity_ranking'
  | 'metric_history'
  | 'momentum_discovery'
  | 'monthly_playtime'
  | 'news_search'
  | 'relation_lookup'
  | 'semantic_search'
  | 'user_context';

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
  facets?: {
    canonicalMatch?: {
      name?: string;
      type?: 'categories' | 'genres' | 'tags';
    } | null;
    categories?: string[];
    genres?: string[];
    tags?: string[];
  } | null;
  interpretedFilters: {
    developerQuery: string | null;
    facetQuery?: string | null;
    includeAppTypes?: string[];
    includeFacets?: Array<'categories' | 'genres' | 'tags'>;
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

interface TigerPrimaryRelatedEntityItem {
  appid: number;
  name: string;
  releaseDate?: string | null;
  releaseYear?: number | null;
  reviewScore?: number | null;
  steamDeckCategory?: 'playable' | 'verified' | 'unsupported' | 'unknown' | null;
  totalReviews?: number | null;
}

interface TigerPrimaryRelatedEntitiesResponse {
  items: TigerPrimaryRelatedEntityItem[];
  matchMode?: 'parent_appid' | 'relation_ids_only' | 'structured_relation' | 'title_family';
  provenance?: {
    source?: 'supabase-postgres' | 'tiger';
  };
  relationKind: 'dlc' | 'franchise_games';
  source: {
    appid: number;
    displayName: string;
    franchiseNames?: string[];
  };
  unresolvedAppids?: number[];
  unresolvedCount?: number;
}

interface TigerPrimaryRelatedEntitiesRequest {
  filters?: {
    minReviewScore?: number | null;
    reviewComparison?: 'any' | 'better_only';
    steamDeck?: Array<'playable' | 'verified'>;
  } | null;
  relationKind: 'dlc' | 'franchise_games';
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
  viewMode: 'company_count' | 'company_games' | 'company_metrics' | 'game_overview';
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

interface TigerPrimaryRankRequest {
  aggregateFilters?: {
    minAverageReviewScore?: number | null;
    minGameCount?: number | null;
    minMinimumReviewScore?: number | null;
  } | null;
  catalogFilters?: {
    isFree?: boolean | null;
    platforms?: string[];
    releaseYear?: {
      gte?: number | null;
      lte?: number | null;
    } | null;
    tags?: string[];
  } | null;
  entityKind: 'developer' | 'game' | 'publisher';
  fallbackMode?: 'closest_match' | null;
  metric: TigerPrimaryRankEntitiesResponse['metric'];
  originalAggregateFilters?: {
    minAverageReviewScore?: number | null;
    minGameCount?: number | null;
    minMinimumReviewScore?: number | null;
  } | null;
  recentReleaseDays?: number | null;
  releaseDays?: number | null;
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

interface TigerPrimaryMonthlyPlaytimeItem {
  entityId: number;
  entityKind: 'game' | 'publisher';
  estimatedMonthlyHours: number | string | null;
  gameCount?: number | null;
  month: string;
  monthNum: number;
  monthlyCcuSum?: number | string | null;
  name: string;
  rank: number;
  year: number;
}

interface TigerPrimaryMonthlyPlaytimeResponse {
  endMonth: string;
  entityKind: 'game' | 'publisher';
  items: TigerPrimaryMonthlyPlaytimeItem[];
  startMonth: string;
}

interface TigerPrimaryDiscoverMomentumItem {
  appid: number;
  ccuPeak: number | null;
  matchedSteamDeck?: 'playable' | 'verified' | null;
  momentumScore: number | null;
  name: string;
  platformSupport: string[];
  reviewPercentage: number | null;
  reviewsAdded30d: number | null;
  reviewsAdded7d: number | null;
  sentimentDelta?: number | null;
  supportLevel: 'high' | 'low' | 'medium';
  supportReasons: string[];
  totalReviews: number | null;
  trendDirection: 'down' | 'stable' | 'up' | null;
  velocityAcceleration: number | null;
}

interface TigerPrimaryDiscoverMomentumResponse {
  broadeningApplied?: boolean;
  filtersApplied: string[];
  idealItems?: number;
  items: TigerPrimaryDiscoverMomentumItem[];
  minimumItems?: number;
  provenanceSource?: 'supabase-postgres' | 'tiger' | null;
  rankingDefinition: string;
  rankingLabel: string;
  reference?: {
    id?: number;
    name?: string;
    type?: string;
  } | null;
  resultCount?: number;
  shortfallReason?: string | null;
  sortBy?:
    | 'ccu_peak'
    | 'momentum_score'
    | 'review_score'
    | 'reviews_added_30d'
    | 'reviews_added_7d'
    | 'sentiment_delta'
    | 'total_reviews'
    | 'velocity_7d'
    | 'velocity_acceleration';
  sortDirection?: 'asc' | 'desc';
  sufficientToAnswer: boolean;
  timeframe: '7d' | '30d' | 'current';
  timeframeLabel: string;
  trendType?: 'accelerating' | 'breaking_out' | 'declining' | 'review_momentum' | null;
}

interface TigerPrimarySearchDocumentItem {
  appid?: number;
  appName: string;
  bodyPreview?: string | null;
  excerpt?: string | null;
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
    mode?: 'digest' | 'latest_item' | 'topic_search';
    query: string | null;
  };
  items: TigerPrimarySearchDocumentItem[];
}

interface TigerPrimarySearchChangeActivityResponse {
  interpretedFilters?: {
    query?: string | null;
    signalFamilies?: string[];
    view?: string;
  };
  items: Array<{
    activityId: string;
    appid: number;
    headline: string;
    name: string;
    occurredAt: string;
    storyKind: string;
    summary: string;
  }>;
}

interface TigerPrimaryDiscoverChangePatternsResponse {
  interpretedFilters?: {
    mode?: 'prospect_ranking';
    pattern?: string;
    patterns?: string[];
  };
  kind?: 'prospect_ranking';
  items: Array<{
    appid: number;
    confidence: 'high' | 'medium';
    evidenceQualityScore?: number;
    evidenceSummary?: string[];
    latestSignalAt?: string;
    name: string;
    needScore?: number;
    occurredAt: string;
    patternSignals?: string[];
    primaryProof?: {
      headline?: string;
      summary?: string;
    } | null;
    reasons: string[];
    timingScore?: number;
    totalScore?: number;
  }>;
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
  close_alternatives?: TigerPrimarySemanticSearchResult[];
  close_alternatives_reason?: string;
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

interface TigerPrimarySemanticSearchRequest {
  description?: string | null;
  entityKind: 'developer' | 'game' | 'publisher';
  filters?: {
    max_price_cents?: number | null;
    review_comparison?: 'any' | 'better_only' | 'similar_or_better';
    steam_deck?: Array<'playable' | 'verified'>;
    tags?: string[];
  } | null;
  mode: 'concept' | 'similarity';
  referenceQuery?: string | null;
}

interface TigerPrimaryUserContextPin {
  displayName: string;
  entityKind: 'developer' | 'game' | 'publisher';
  metrics: {
    ccuPeak: number | null;
    gameCount: number | null;
    ownersMidpoint: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  };
  pinId: string;
  pinOrder: number;
  pinnedAt: string;
}

interface TigerPrimaryUserContextAlert {
  alertId: string;
  alertType: string;
  createdAt: string;
  description: string;
  entity: {
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
  };
  isRead: boolean;
  severity: 'high' | 'low' | 'medium';
  title: string;
}

interface TigerPrimaryUserContextResponse {
  alertPreferences: {
    alertsEnabled: boolean;
    emailDigestEnabled: boolean;
    emailDigestFrequency: string | null;
  } | null;
  alerts: TigerPrimaryUserContextAlert[];
  pins: TigerPrimaryUserContextPin[];
  totalAlerts: number;
  totalPins: number;
  unreadAlertCount: number;
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

function formatNumber(value: unknown): string {
  const numericValue = coerceNumber(value);
  if (numericValue == null) {
    return 'n/a';
  }

  if (!Number.isInteger(numericValue)) {
    return numericValue.toFixed(2);
  }

  return numericValue.toLocaleString();
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatPercent(value: unknown): string {
  const numericValue = coerceNumber(value);
  if (numericValue == null) {
    return 'n/a';
  }

  return `${numericValue.toFixed(numericValue % 1 === 0 ? 0 : 1)}%`;
}

function normalizeReviewPercentage(value: unknown): number | null {
  const numericValue = coerceNumber(value);
  if (numericValue == null) {
    return null;
  }

  return numericValue >= 0 && numericValue <= 10
    ? numericValue * 10
    : numericValue;
}

function formatReviewPercentage(value: unknown): string {
  const normalized = normalizeReviewPercentage(value);
  if (normalized == null) {
    return 'n/a';
  }

  return formatPercent(normalized);
}

function formatMatchScore(value: unknown): string {
  const numericValue = coerceNumber(value);
  if (numericValue == null) {
    return 'n/a';
  }

  const bounded = Math.max(0, Math.min(numericValue, 100));
  return `${Math.round(bounded)}/100`;
}

function hasPositiveMetric(
  items: Array<Record<string, unknown>>,
  key: string
): boolean {
  return items.some((item) => {
    const value = coerceNumber(item[key]);
    return value != null && value > 0;
  });
}

function formatSignedNumber(value: unknown): string {
  const numericValue = coerceNumber(value);
  if (numericValue == null) {
    return 'n/a';
  }

  const absolute = Math.abs(numericValue);
  const formatted = absolute % 1 === 0 ? absolute.toFixed(0) : absolute.toFixed(1);
  return `${numericValue > 0 ? '+' : numericValue < 0 ? '-' : ''}${formatted}`;
}

function formatCurrencyCents(value: number | null | undefined): string {
  const numericValue = coerceNumber(value);
  if (numericValue == null) {
    return 'n/a';
  }

  return `$${(numericValue / 100).toFixed(2)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return value.slice(0, 10);
}

function formatDateOffsetDays(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function sanitizeMarkdownTableCell(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function escapeMarkdownLinkLabel(value: string): string {
  return sanitizeMarkdownTableCell(value)
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function formatGameLink(name: string, appid: number | null | undefined): string {
  const label = escapeMarkdownLinkLabel(name);
  return typeof appid === 'number' ? `[${label}](game:${appid})` : label;
}

function formatTitleLink(title: string | null | undefined, url: string): string {
  const label = escapeMarkdownLinkLabel(title?.trim() || 'Untitled');
  const safeUrl = sanitizeMarkdownTableCell(url);
  return safeUrl ? `[${label}](<${safeUrl}>)` : label;
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
  const header = `| ${columns.map((column) => sanitizeMarkdownTableCell(column)).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell) => sanitizeMarkdownTableCell(cell)).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function formatCatalogIntro(response: TigerPrimaryCatalogResponse): string {
  const company = response.interpretedFilters.developerQuery || response.interpretedFilters.publisherQuery;
  if (company) {
    return `Here are the matching games for **${company}**.`;
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
    ? `Here are the matching ${qualifiers.join(', ')} games.`
    : 'Here are the matching games.';
}

function renderCatalogSearch(response: TigerPrimaryCatalogResponse): string {
  const facetEntries = [
    ...(response.facets?.tags ?? []).map((name) => ({ name, type: 'Tag' })),
    ...(response.facets?.genres ?? []).map((name) => ({ name, type: 'Genre' })),
    ...(response.facets?.categories ?? []).map((name) => ({ name, type: 'Category' })),
  ];
  if ((response.items?.length ?? 0) === 0 && facetEntries.length > 0) {
    const requestedFacet = response.interpretedFilters.includeFacets?.[0] ?? response.facets?.canonicalMatch?.type ?? 'tags';
    const requestedLabel =
      requestedFacet === 'genres' ? 'genres'
      : requestedFacet === 'categories' ? 'categories'
      : 'tags';
    const subject =
      response.facets?.canonicalMatch?.name
      ?? response.interpretedFilters.facetQuery
      ?? response.interpretedFilters.query
      ?? 'that concept';
    const rows = facetEntries.slice(0, 12).map((entry) => [entry.name, entry.type]);
    const intro = response.facets?.canonicalMatch
      ? `Here are the ${requestedLabel} most commonly paired with **${subject}**.`
      : `Here are the closest matching ${requestedLabel} for **${subject}**.`;
    return [
      intro,
      '',
      buildMarkdownTable(['Name', 'Kind'], rows),
    ].join('\n');
  }

  const showPrice =
    response.interpretedFilters.minPriceCents != null
    || response.interpretedFilters.maxPriceCents != null
    || response.interpretedFilters.onSale === true;
  const showDiscount =
    response.interpretedFilters.onSale === true
    || response.interpretedFilters.minDiscountPercent != null;
  const columns = ['Game', 'Review %', 'Total Reviews'];
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
        formatReviewPercentage(item.reviewScore),
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

function describeRelatedScope(request: TigerPrimaryRelatedEntitiesRequest | null | undefined): string[] {
  if (!request?.filters) {
    return [];
  }

  const scope: string[] = [];
  if (request.filters.steamDeck?.length) {
    scope.push(`Steam Deck ${joinHumanList(request.filters.steamDeck)}`);
  }
  if (typeof request.filters.minReviewScore === 'number') {
    scope.push(`review score >= ${request.filters.minReviewScore}%`);
  }
  if (request.filters.reviewComparison === 'better_only') {
    scope.push('better review score than the source title');
  }

  return scope;
}

function renderRelatedEntities(
  response: TigerPrimaryRelatedEntitiesResponse,
  request?: TigerPrimaryRelatedEntitiesRequest | null
): string {
  const sourceName = response.source.displayName;
  const relationLabel = response.relationKind === 'dlc' ? 'DLC' : 'same-franchise games';
  const appliedScope = describeRelatedScope(request);
  const scopeSuffix = appliedScope.length > 0 ? ` after filtering to ${joinHumanList(appliedScope)}` : '';
  const baselineFallbackNote =
    response.provenance?.source === 'supabase-postgres'
      ? ' I used the source baseline relation graph because PublisherIQ data does not yet carry the complete linked rows for this title.'
      : '';
  const matchModeNote =
    response.matchMode === 'title_family'
      ? ' I used title-family matching because exact franchise links are not fully backfilled in this data slice yet.'
      : response.matchMode === 'relation_ids_only'
        ? ' PublisherIQ found structured relation links, but the current app snapshot is missing the linked titles.'
      : response.matchMode === 'parent_appid'
        ? ' This is based on current parent/child app links in the catalog.'
        : '';
  if (response.items.length === 0 && (response.unresolvedCount ?? 0) > 0) {
    const linkedAppids = (response.unresolvedAppids ?? []).slice(0, 8).map((appid) => String(appid));
    const linkedAppidNote = linkedAppids.length > 0 ? ` Linked appids: ${linkedAppids.join(', ')}.` : '';

    return `PublisherIQ found **${formatNumber(response.unresolvedCount ?? 0)}** ${relationLabel} link${(response.unresolvedCount ?? 0) === 1 ? '' : 's'} for **${sourceName}**, but the current app snapshot is missing those linked titles.${matchModeNote}${baselineFallbackNote}${linkedAppidNote}`;
  }

  const intro = response.relationKind === 'dlc'
    ? `Here is the current **${relationLabel}** set for **${sourceName}**${scopeSuffix}.${matchModeNote}${baselineFallbackNote}`
    : `Here are the current **${relationLabel}** for **${sourceName}**${scopeSuffix}.${matchModeNote}${baselineFallbackNote}`;
  const singleItem = response.items[0] ?? null;
  const franchiseLabel =
    response.relationKind === 'franchise_games' && response.source.franchiseNames?.length
      ? ` in the **${joinHumanList(response.source.franchiseNames.slice(0, 2))}** franchise`
      : '';
  const singleItemSupportNote =
    response.items.length === 1 && singleItem
      ? response.relationKind === 'franchise_games'
        ? `**${singleItem.name}** is the only current same-franchise title${franchiseLabel}${scopeSuffix}.`
        : `**${singleItem.name}** is the only current DLC entry${scopeSuffix}.`
      : null;
  const rows = response.items.slice(0, 12).map((item) => [
    formatGameLink(item.name, item.appid),
    item.releaseYear == null ? 'n/a' : String(item.releaseYear),
    formatReviewPercentage(item.reviewScore),
    formatNumber(item.totalReviews),
    item.steamDeckCategory ?? 'n/a',
  ]);

  return [
    intro,
    ...(singleItemSupportNote ? ['', singleItemSupportNote] : []),
    '',
    buildMarkdownTable(['Game', 'Year', 'Review %', 'Total Reviews', 'Steam Deck'], rows),
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
      return 'Review %';
    case 'total_reviews':
      return 'Total Reviews';
    default:
      return metric;
  }
}

function formatMetricValue(
  entityKind: TigerPrimaryRankEntitiesResponse['entityKind'],
  metric: TigerPrimaryRankEntitiesResponse['metric'],
  value: number | null
): string {
  if (metric === 'review_score') {
    return formatReviewPercentage(value);
  }

  return formatNumber(value);
}

function describeReleaseWindow(request: TigerPrimaryRankRequest | null | undefined): string | null {
  if (!request) {
    return null;
  }

  if (typeof request.recentReleaseDays === 'number' && request.recentReleaseDays > 0) {
    return `with at least one release from ${formatDateOffsetDays(request.recentReleaseDays)} through ${formatDateOffsetDays(0)}`;
  }

  if (typeof request.releaseDays === 'number' && request.releaseDays > 0) {
    return `released from ${formatDateOffsetDays(request.releaseDays)} through ${formatDateOffsetDays(0)}`;
  }

  const releaseYear = request.catalogFilters?.releaseYear ?? null;
  if (releaseYear?.gte != null && releaseYear?.lte != null && releaseYear.gte === releaseYear.lte) {
    return `released in ${releaseYear.gte}`;
  }

  if (releaseYear?.gte != null && releaseYear?.lte != null) {
    return `released from ${releaseYear.gte} through ${releaseYear.lte}`;
  }

  if (releaseYear?.gte != null) {
    return `released since ${releaseYear.gte}`;
  }

  if (releaseYear?.lte != null) {
    return `released through ${releaseYear.lte}`;
  }

  return null;
}

function describeRankingScope(request: TigerPrimaryRankRequest | null | undefined): string[] {
  if (!request) {
    return [];
  }

  const scope: string[] = [];
  const aggregate = request.aggregateFilters ?? null;
  const catalog = request.catalogFilters ?? null;

  if (typeof aggregate?.minGameCount === 'number') {
    scope.push(`at least ${formatNumber(aggregate.minGameCount)} games`);
  }

  if (typeof aggregate?.minAverageReviewScore === 'number') {
    scope.push(`average review >= ${aggregate.minAverageReviewScore}%`);
  }

  if (typeof aggregate?.minMinimumReviewScore === 'number') {
    scope.push(`every title >= ${aggregate.minMinimumReviewScore}% reviews`);
  }

  const releaseWindow = describeReleaseWindow(request);
  if (releaseWindow) {
    scope.push(releaseWindow);
  }

  if (catalog?.platforms?.length) {
    scope.push(`${catalog.platforms.join('/')} only`);
  }

  if (catalog?.tags?.length) {
    scope.push(`tagged ${joinHumanList(catalog.tags.slice(0, 3))}`);
  }

  if (catalog?.isFree === true) {
    scope.push('free-to-play only');
  } else if (catalog?.isFree === false) {
    scope.push('premium only');
  }

  return scope;
}

function renderRankEntities(
  response: TigerPrimaryRankEntitiesResponse,
  request?: TigerPrimaryRankRequest | null
): string {
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
      formatMetricValue(response.entityKind, response.metric, item.metricValue),
      secondaryValue,
    ];
  });
  const leader = response.items[0];
  const scope = describeRankingScope(request);
  const requestedScope = request?.fallbackMode === 'closest_match'
    ? describeRankingScope({
        ...request,
        aggregateFilters: request.originalAggregateFilters ?? request.aggregateFilters ?? null,
      })
    : scope;
  const scopeSuffix = scope.length > 0 ? ` among ${joinHumanList(scope)}` : '';
  const intro = request?.fallbackMode === 'closest_match'
    ? `No rows met every original threshold, so here are the closest ${response.entityKind === 'game' ? 'games' : `${response.entityKind}s`} by **${metricLabel(response.metric)}**${scopeSuffix}.`
    : leader
      ? `**${leader.displayName}** currently leads this ranking by **${metricLabel(response.metric)}**${scopeSuffix}.`
      : `Here are the top ${response.entityKind === 'game' ? 'games' : `${response.entityKind}s`} by **${metricLabel(response.metric)}**${scopeSuffix}.`;
  const scopeNotes = request?.fallbackMode === 'closest_match'
    ? [
        requestedScope.length > 0 ? `Original thresholds: ${requestedScope.join('; ')}.` : null,
        scope.length > 0 ? `Closest-match view: ${scope.join('; ')}.` : null,
      ].filter((value): value is string => Boolean(value))
    : (
      scope.length > 0
        ? [`Active filters: ${scope.join('; ')}.`]
        : []
    );

  return [
    intro,
    '',
    buildMarkdownTable(
      ['Rank', nameColumn, metricLabel(response.metric), secondaryColumn],
      rows
    ),
    ...(scopeNotes.length > 0 ? ['', ...scopeNotes] : []),
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
      return item.metrics.reviewScore == null
        ? 'n/a'
        : formatReviewPercentage(item.metrics.reviewScore);
    case 'total_reviews':
      return formatNumber(item.metrics.totalReviews);
    default:
      return 'n/a';
  }
}

function renderCompareScalarValue(
  entityKind: TigerPrimaryCompareEntitiesResponse['entityKind'],
  metric: TigerPrimaryCompareEntitiesResponse['metrics'][number],
  value: number | null
): string {
  if (metric === 'review_score') {
    return formatReviewPercentage(value);
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
    .map((highlight) => `- **${metricLabel(highlight.metric)}** leader: ${highlight.displayName} (${renderCompareScalarValue(response.entityKind, highlight.metric, highlight.value)})`);
  const comparisonSummary = response.highlights.slice(0, 2).map((highlight) => {
    return `${highlight.displayName} leads on ${metricLabel(highlight.metric).toLowerCase()}`;
  });
  const intro = comparisonSummary.length > 0
    ? `${comparisonSummary.join(', while ')}.`
    : `Here is the comparison for ${compareTarget}.`;

  return [
    intro,
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
      return 'Review %';
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
    return formatReviewPercentage(value);
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

  const firstSeries = response.series[0];
  const intro = firstSeries
    ? `Over this window, **${response.entity.displayName}** moved from **${formatHistoryValue(firstSeries.metric, firstSeries.summary.startValue)}** to **${formatHistoryValue(firstSeries.metric, firstSeries.summary.latestValue)}** on **${historyMetricLabel(firstSeries.metric)}**.`
    : `Here is the recent history for **${response.entity.displayName}**.`;

  return [
    `${intro} The window runs from **${response.startDate}** through **${response.endDate}**.`,
    '',
    ...bullets,
  ].join('\n');
}

function formatMomentumSupportLevel(value: TigerPrimaryDiscoverMomentumItem['supportLevel']): string {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'n/a';
}

function formatMomentumSupportReason(item: TigerPrimaryDiscoverMomentumItem): string {
  const supportReasons = Array.isArray(item.supportReasons) ? item.supportReasons : [];
  return supportReasons[0] ?? 'Momentum evidence supports this ranking.';
}

function formatMomentumTrendDirection(
  value: TigerPrimaryDiscoverMomentumItem['trendDirection']
): string {
  switch (value) {
    case 'up':
      return 'up';
    case 'down':
      return 'down';
    case 'stable':
      return 'stable';
    default:
      return 'n/a';
  }
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function joinHumanList(values: string[]): string {
  if (values.length === 0) {
    return '';
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function titleCaseToken(value: string): string {
  if (value === 'macos') {
    return 'macOS';
  }

  return value.length > 0
    ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`
    : value;
}

function describeMomentumAppliedFilters(filtersApplied: string[]): string[] {
  const descriptions: string[] = [];

  for (const rawFilter of filtersApplied) {
    const value = rawFilter.trim();
    if (!value) {
      continue;
    }

    const [rawKey, rawRest = ''] = value.split(':', 2);
    const key = rawKey.trim().toLowerCase();
    const rest = rawRest.trim();

    if (key === 'steam_deck' && rest) {
      const deckValues = rest
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
        .map((entry) => `Steam Deck ${titleCaseToken(entry)}`);
      descriptions.push(...deckValues);
      continue;
    }

    if (key === 'platforms' && rest) {
      const platforms = rest
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
        .map(titleCaseToken);
      descriptions.push(...platforms);
      continue;
    }

    if (key === 'is_free') {
      if (rest === 'true') {
        descriptions.push('free-to-play');
      } else if (rest === 'false') {
        descriptions.push('premium');
      }
      continue;
    }

    if (key === 'indie_heuristic' && rest === 'true') {
      descriptions.push('indie');
      continue;
    }
  }

  return [...new Set(descriptions)];
}

function hasMomentumAppliedFilter(filtersApplied: string[], filterKey: string): boolean {
  return filtersApplied.some((entry) => {
    const [rawKey] = entry.split(':', 1);
    return rawKey.trim().toLowerCase() === filterKey.toLowerCase();
  });
}

function hasMomentumAppliedFilterValue(
  filtersApplied: string[],
  filterKey: string,
  expectedValue: string
): boolean {
  return filtersApplied.some((entry) => {
    const [rawKey, rawRest = ''] = entry.split(':', 2);
    return rawKey.trim().toLowerCase() === filterKey.toLowerCase()
      && rawRest.trim().toLowerCase() === expectedValue.toLowerCase();
  });
}

function isReviewSentimentMomentumFamily(
  promptFamily: SessionMomentumPromptFamily | null | undefined
): promptFamily is 'review_sentiment_down' | 'review_sentiment_up' {
  return promptFamily === 'review_sentiment_down' || promptFamily === 'review_sentiment_up';
}

function isReviewActivityMomentumFamily(
  promptFamily: SessionMomentumPromptFamily | null | undefined
): promptFamily is 'review_activity_down' | 'review_activity_up' | 'review_momentum' {
  return (
    promptFamily === 'review_activity_down'
    || promptFamily === 'review_activity_up'
    || promptFamily === 'review_momentum'
  );
}

function hasEstablishedTitlesFloor(response: TigerPrimaryDiscoverMomentumResponse): boolean {
  return hasMomentumAppliedFilterValue(response.filtersApplied, 'min_reviews', '10000')
    && hasMomentumAppliedFilterValue(response.filtersApplied, 'min_ccu', '100')
    && (
      hasMomentumAppliedFilterValue(response.filtersApplied, 'min_reviews_added_7d', '25')
      || hasMomentumAppliedFilterValue(response.filtersApplied, 'min_reviews_added_30d', '25')
    );
}

function getMomentumBroadeningNote(params: {
  response: TigerPrimaryDiscoverMomentumResponse;
  scopeAdjustedForSparseResults?: boolean;
}): string | null {
  const broadened =
    params.response.broadeningApplied === true || params.scopeAdjustedForSparseResults === true;

  if (!broadened || params.response.shortfallReason) {
    return null;
  }

  return 'I widened the default popularity floor to fill out this list.';
}

function getMomentumShortfallNote(
  response: TigerPrimaryDiscoverMomentumResponse
): string | null {
  return typeof response.shortfallReason === 'string' && response.shortfallReason.trim().length > 0
    ? response.shortfallReason.trim()
    : null;
}

function buildMomentumWindowLabel(response: TigerPrimaryDiscoverMomentumResponse): string {
  const end = new Date();
  const endLabel = formatIsoDate(end);

  if (response.timeframe === 'current') {
    return endLabel;
  }

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (response.timeframe === '30d' ? 29 : 6));
  return `${formatIsoDate(start)} to ${endLabel}`;
}

function getMomentumTableMode(
  response: TigerPrimaryDiscoverMomentumResponse,
  momentumPromptFamily: SessionMomentumPromptFamily | null | undefined = null
): 'current_players' | 'review_activity' | 'review_sentiment' | 'momentum' {
  if (response.sortBy === 'ccu_peak' && response.timeframe === 'current') {
    return 'current_players';
  }

  if (
    isReviewSentimentMomentumFamily(momentumPromptFamily)
    || response.sortBy === 'sentiment_delta'
    || hasMomentumAppliedFilter(response.filtersApplied, 'min_sentiment_delta')
    || hasMomentumAppliedFilter(response.filtersApplied, 'max_sentiment_delta')
  ) {
    return 'review_sentiment';
  }

  if (
    isReviewActivityMomentumFamily(momentumPromptFamily)
    || response.sortBy === 'review_score'
    || response.sortBy === 'reviews_added_7d'
    || response.sortBy === 'reviews_added_30d'
    || response.sortBy === 'velocity_7d'
    || (response.sortBy === 'velocity_acceleration'
      && response.sortDirection === 'asc'
      && response.trendType !== 'declining')
    || response.trendType === 'review_momentum'
    || hasMomentumAppliedFilter(response.filtersApplied, 'min_reviews_added_7d')
    || hasMomentumAppliedFilter(response.filtersApplied, 'min_reviews_added_30d')
  ) {
    return 'review_activity';
  }

  return 'momentum';
}

function isReviewSentimentDown(
  response: TigerPrimaryDiscoverMomentumResponse,
  momentumPromptFamily: SessionMomentumPromptFamily | null | undefined
): boolean {
  if (momentumPromptFamily === 'review_sentiment_down') {
    return true;
  }

  if (momentumPromptFamily === 'review_sentiment_up') {
    return false;
  }

  return hasMomentumAppliedFilter(response.filtersApplied, 'max_sentiment_delta')
    || (response.sortBy === 'sentiment_delta' && response.sortDirection === 'asc');
}

function isReviewActivityDown(
  response: TigerPrimaryDiscoverMomentumResponse,
  momentumPromptFamily: SessionMomentumPromptFamily | null | undefined
): boolean {
  if (momentumPromptFamily === 'review_activity_down') {
    return true;
  }

  if (
    momentumPromptFamily === 'review_activity_up'
    || momentumPromptFamily === 'review_momentum'
  ) {
    return false;
  }

  return response.sortBy === 'velocity_acceleration'
    && response.sortDirection === 'asc'
    && response.trendType !== 'declining';
}

function renderMomentumDiscovery(params: {
  momentumPromptFamily?: SessionMomentumPromptFamily | null;
  scopeAdjustedForSparseResults?: boolean;
  response: TigerPrimaryDiscoverMomentumResponse;
}): string {
  const { response } = params;
  const leader = response.items[0] ?? null;
  const leaderReason = leader ? formatMomentumSupportReason(leader) : null;
  const windowLabel = buildMomentumWindowLabel(response);
  const appliedScope = describeMomentumAppliedFilters(response.filtersApplied);
  const similarityScope = response.reference?.name
    ? ` among games similar to **${response.reference.name}**`
    : '';
  const scopeSuffix = appliedScope.length > 0 ? ` within the **${joinHumanList(appliedScope)}** set` : '';
  const tableMode = getMomentumTableMode(response, params.momentumPromptFamily);
  const sentimentDown = isReviewSentimentDown(response, params.momentumPromptFamily);
  const activityDown = isReviewActivityDown(response, params.momentumPromptFamily);
  const establishedTitlesNote =
    hasEstablishedTitlesFloor(response) && (tableMode === 'review_activity' || tableMode === 'review_sentiment')
      ? 'I screened for established titles so this stays focused on broadly played games rather than low-volume noise.'
      : null;
  const broadeningNote = getMomentumBroadeningNote({
    response,
    scopeAdjustedForSparseResults: params.scopeAdjustedForSparseResults,
  });
  const shortfallNote = getMomentumShortfallNote(response);
  const establishedTitlesSuffix = establishedTitlesNote ? ` ${establishedTitlesNote}` : '';
  const broadeningSuffix = broadeningNote ? ` ${broadeningNote}` : '';
  const shortfallSuffix = shortfallNote ? ` ${shortfallNote}` : '';
  const itemsForSignalCheck = response.items as unknown as Array<Record<string, unknown>>;
  const hasPeakCcuSignal = hasPositiveMetric(itemsForSignalCheck, 'ccuPeak');
  const intro = leader
    ? response.timeframe === 'current'
      ? `As of **${windowLabel}**, **${leader.name}** has the highest **${response.rankingLabel}** in this snapshot${similarityScope}${scopeSuffix}.${leaderReason ? ` ${leaderReason}` : ''}`
      : tableMode === 'review_sentiment'
        ? `From **${windowLabel}**, **${leader.name}** leads this review sentiment ${sentimentDown ? 'decline' : 'improvement'} screen${similarityScope}${scopeSuffix} by **${response.rankingLabel}** for **${response.timeframeLabel}**.${leaderReason ? ` ${leaderReason}` : ''}${establishedTitlesSuffix}${broadeningSuffix}${shortfallSuffix}`
        : tableMode === 'review_activity'
          ? `From **${windowLabel}**, **${leader.name}** ${activityDown ? 'shows the sharpest slowdown in incoming review pace' : 'leads this review-activity set'}${similarityScope}${scopeSuffix} by **${response.rankingLabel}** for **${response.timeframeLabel}**.${leaderReason ? ` ${leaderReason}` : ''}${establishedTitlesSuffix}${broadeningSuffix}${shortfallSuffix}`
          : `From **${windowLabel}**, **${leader.name}** leads this set${similarityScope}${scopeSuffix} by **${response.rankingLabel}** for **${response.timeframeLabel}**.${leaderReason ? ` ${leaderReason}` : ''}`
    : response.timeframe === 'current'
      ? `As of **${windowLabel}**, here are the leading games by **${response.rankingLabel}**${similarityScope}${scopeSuffix}.`
      : tableMode === 'review_sentiment'
        ? `From **${windowLabel}**, here are the leading games by **${response.rankingLabel}** for this review sentiment ${sentimentDown ? 'decline' : 'improvement'} screen${similarityScope}${scopeSuffix}.${establishedTitlesSuffix}${broadeningSuffix}${shortfallSuffix}`
        : tableMode === 'review_activity'
          ? `From **${windowLabel}**, here are the leading games by **${response.rankingLabel}** for this review-activity screen${similarityScope}${scopeSuffix}.${establishedTitlesSuffix}${broadeningSuffix}${shortfallSuffix}`
          : `From **${windowLabel}**, here are the leading games by **${response.rankingLabel}**${similarityScope}${scopeSuffix} for **${response.timeframeLabel}**.`;
  const reviewDeltaColumn = response.timeframe === '30d' ? 'Reviews Added (30d)' : 'Reviews Added (7d)';
  const rows = response.items.slice(0, 10).map((item) => {
    if (tableMode === 'current_players') {
      return [
        formatGameLink(item.name, item.appid),
        formatNumber(item.ccuPeak),
        formatMomentumTrendDirection(item.trendDirection),
        formatNumber(item.totalReviews),
        (Array.isArray(item.platformSupport) ? item.platformSupport : []).join(', ') || 'n/a',
      ];
    }

    if (tableMode === 'review_sentiment') {
      return [
        formatGameLink(item.name, item.appid),
        `${formatSignedNumber(item.sentimentDelta)} pts`,
        formatReviewPercentage(item.reviewPercentage),
        formatNumber(response.timeframe === '30d' ? item.reviewsAdded30d : item.reviewsAdded7d),
        formatNumber(item.totalReviews),
        (Array.isArray(item.platformSupport) ? item.platformSupport : []).join(', ') || 'n/a',
      ];
    }

    if (tableMode === 'review_activity') {
      const row = [
        formatGameLink(item.name, item.appid),
        formatNumber(response.timeframe === '30d' ? item.reviewsAdded30d : item.reviewsAdded7d),
        formatReviewPercentage(item.reviewPercentage),
        formatNumber(item.totalReviews),
        (Array.isArray(item.platformSupport) ? item.platformSupport : []).join(', ') || 'n/a',
      ];

      if (hasPeakCcuSignal) {
        row.splice(4, 0, formatNumber(item.ccuPeak));
      }

      return row;
    }

    const row = [
      formatGameLink(item.name, item.appid),
      formatMomentumSupportLevel(item.supportLevel),
      formatMomentumTrendDirection(item.trendDirection),
      formatNumber(response.timeframe === '30d' ? item.reviewsAdded30d : item.reviewsAdded7d),
      (Array.isArray(item.platformSupport) ? item.platformSupport : []).join(', ') || 'n/a',
    ];

    if (hasPeakCcuSignal) {
      row.splice(3, 0, formatNumber(item.ccuPeak));
    }

    return row;
  });

  const headers =
    tableMode === 'current_players'
      ? ['Game', 'Peak CCU', 'Trend', 'Total Reviews', 'Platforms']
      : tableMode === 'review_sentiment'
        ? ['Game', 'Sentiment Delta', 'Review %', reviewDeltaColumn, 'Total Reviews', 'Platforms']
        : tableMode === 'review_activity'
        ? [
            'Game',
            reviewDeltaColumn,
            'Review %',
            'Total Reviews',
            ...(hasPeakCcuSignal ? ['Peak CCU'] : []),
            'Platforms',
          ]
        : [
            'Game',
            'Support',
            'Trend',
            ...(hasPeakCcuSignal ? ['Peak CCU'] : []),
            reviewDeltaColumn,
            'Platforms',
          ];

  return [
    intro,
    '',
    buildMarkdownTable(headers, rows),
    '',
    response.timeframe === 'current'
      ? `Snapshot date: **${windowLabel}**.`
      : `Window: **${windowLabel}**.`,
    '',
    response.rankingDefinition,
  ].join('\n');
}

function renderUserContext(response: TigerPrimaryUserContextResponse): string {
  const sections: string[] = [];
  const unreadIntro = response.unreadAlertCount > 0
    ? `You currently have **${formatNumber(response.unreadAlertCount)} unread alerts** across **${formatNumber(response.totalPins)} pinned items**.`
    : response.totalPins > 0
      ? `You currently have **${formatNumber(response.totalPins)} pinned items** and no unread alerts.`
      : 'You do not have any pinned items or alerts yet.';

  sections.push(unreadIntro);

  if (response.pins.length > 0) {
    const pinRows = response.pins.slice(0, 8).map((pin) => [
      pin.displayName,
      pin.entityKind,
      formatNumber(pin.metrics.gameCount),
      formatReviewPercentage(pin.metrics.reviewScore),
      formatNumber(pin.metrics.totalReviews),
      formatNumber(pin.metrics.ccuPeak),
    ]);

    sections.push(
      '',
      'Pinned items:',
      '',
      buildMarkdownTable(['Name', 'Kind', 'Game Count', 'Review %', 'Total Reviews', 'Peak CCU'], pinRows),
    );
  }

  if (response.alerts.length > 0) {
    const alertRows = response.alerts.slice(0, 6).map((alert) => [
      formatDate(alert.createdAt),
      alert.entity.displayName,
      alert.severity,
      alert.title,
    ]);

    sections.push(
      '',
      'Recent alerts:',
      '',
      buildMarkdownTable(['Date', 'Entity', 'Severity', 'Title'], alertRows),
    );
  }

  if (response.alertPreferences) {
    sections.push(
      '',
      `Alert preferences: ${response.alertPreferences.alertsEnabled ? 'enabled' : 'disabled'}`
      + `${response.alertPreferences.emailDigestEnabled ? `, ${response.alertPreferences.emailDigestFrequency ?? 'digest'} email digest on` : ', email digest off'}.`,
    );
  }

  return sections.join('\n');
}

function renderSearchDocuments(response: TigerPrimarySearchDocumentsResponse): string {
  const uniqueGames = Array.from(new Set(response.items.map((item) => item.appName).filter(Boolean)));
  const topic = response.interpretedFilters.query?.trim() ?? null;
  const mode = response.interpretedFilters.mode ?? 'topic_search';
  const introLabel = inferNewsIntroLabel(response.items[0]);
  const intro = response.entity
    ? `Here are the most relevant recent ${introLabel} for **${response.entity.displayName}**.`
    : mode === 'digest' && uniqueGames.length >= 2
      ? `Here is a recent news digest across **${uniqueGames.slice(0, 3).join(', ')}**.`
      : topic
        ? `Here are the most relevant recent ${introLabel} for **${topic}**.`
        : `Here are the most relevant recent ${introLabel}.`;

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

function renderChangeDiscovery(
  response: TigerPrimaryDiscoverChangePatternsResponse | TigerPrimarySearchChangeActivityResponse
): string {
  const isProspectRanking = 'kind' in response && response.kind === 'prospect_ranking';
  const isPatternResponse = response.items.some((item) => 'reasons' in item);

  if (isProspectRanking) {
    const prospectResponse = response as TigerPrimaryDiscoverChangePatternsResponse;
    const rows = prospectResponse.items.slice(0, 8).map((item) => [
      formatGameLink(item.name, item.appid),
      formatNumber(item.needScore ?? null),
      formatNumber(item.timingScore ?? null),
      formatNumber(item.evidenceQualityScore ?? null),
      formatDate(item.latestSignalAt ?? item.occurredAt),
      item.evidenceSummary?.[0] ?? item.reasons[0] ?? 'Composite prospect evidence',
    ]);

    return [
      'Here are the strongest current agency-style prospects by need, timing, and evidence quality.',
      '',
      buildMarkdownTable(['Game', 'Need', 'Timing', 'Evidence', 'Latest Signal', 'Why It Stands Out'], rows),
    ].join('\n');
  }

  if (isPatternResponse) {
    const patternResponse = response as TigerPrimaryDiscoverChangePatternsResponse;
    const rows = patternResponse.items.slice(0, 8).map((item) => [
      formatGameLink(item.name, item.appid),
      item.confidence,
      formatDate(item.occurredAt),
      item.primaryProof?.headline ?? item.reasons[0] ?? 'Pattern evidence',
    ]);

    return [
      'Here are the strongest recent change-pattern matches.',
      '',
      buildMarkdownTable(['Game', 'Confidence', 'Date', 'Evidence'], rows),
    ].join('\n');
  }

  const activityResponse = response as TigerPrimarySearchChangeActivityResponse;
  const rows = activityResponse.items.slice(0, 8).map((item) => [
    formatGameLink(item.name, item.appid),
    item.storyKind,
    formatDate(item.occurredAt),
    item.summary || item.headline,
  ]);

  return [
    'Here are the strongest recent change-activity matches.',
    '',
    buildMarkdownTable(['Game', 'Change Type', 'Date', 'Details'], rows),
  ].join('\n');
}

function joinLabels(values: string[] | null | undefined): string {
  if (!Array.isArray(values) || values.length === 0) {
    return 'n/a';
  }

  return values.join(', ');
}

function inferNewsIntroLabel(item: TigerPrimarySearchDocumentItem | null | undefined): string {
  if (!item) {
    return 'news documents';
  }

  const combined = [
    item.title,
    item.feedLabel,
    item.feedScope,
    item.excerpt ?? null,
    item.bodyPreview ?? null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (/\b(patch notes?|hotfix|changelog|update notes?|accumulated updates?|growth rate update)\b/.test(combined)) {
    return 'patch notes';
  }

  if (/\b(announcement|announcements|developer diary|dev diary|roadmap|playtest|demo)\b/.test(combined)) {
    return 'announcements';
  }

  if (/\b(update|updates)\b/.test(combined)) {
    return 'update posts';
  }

  return 'news documents';
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
      `Here is the latest snapshot for **${entity.displayName}**.`,
      '',
      `- **Release date**: ${formatDate(details.releaseDate)}`,
      `- **Release status**: ${formatReleaseStatus(details)}`,
      `- **Price**: ${details.isFree ? 'Free' : formatCurrencyCents(details.priceCents)}`,
      `- **Review %**: ${formatReviewPercentage(entity.metrics.reviewScore)}`,
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
      ? `**${entity.displayName}** currently has **${formatNumber(entity.metrics.gameCount)}** games in the catalog.`
      : response.viewMode === 'company_metrics'
        ? `Here are the main portfolio metrics for **${entity.displayName}**.`
      : `Here is the current overview for **${entity.displayName}**.`;

  const games = response.games.slice(0, 5).map((game) => [
    formatGameLink(game.name, game.appid),
    game.releaseYear == null ? 'n/a' : String(game.releaseYear),
    formatReviewPercentage(game.reviewScore),
    game.totalReviews == null ? 'n/a' : formatNumber(game.totalReviews),
    game.ownersMidpoint == null ? 'n/a' : formatNumber(game.ownersMidpoint),
  ]);

  const sections = [
    intro,
    '',
    `- **Game count**: ${formatNumber(entity.metrics.gameCount)}`,
    `- **Portfolio review %**: ${formatReviewPercentage(entity.metrics.reviewScore)}`,
    `- **Portfolio total reviews**: ${formatNumber(entity.metrics.totalReviews)}`,
    `- **Portfolio owners midpoint**: ${formatNumber(entity.metrics.ownersMidpoint)}`,
    `- **Portfolio CCU peak**: ${formatNumber(entity.metrics.ccuPeak)}`,
  ];

  if (games.length > 0) {
    sections.push(
      '',
      response.viewMode === 'company_count' || response.viewMode === 'company_metrics'
        ? 'Sample titles:'
        : 'Top titles:',
      '',
      buildMarkdownTable(['Game', 'Year', 'Review %', 'Total Reviews', 'Owners'], games)
    );
  }

  return sections.join('\n');
}

function describeSemanticScope(request: TigerPrimarySemanticSearchRequest | null | undefined): string[] {
  if (!request?.filters) {
    return [];
  }

  const scope: string[] = [];

  if (request.filters.review_comparison === 'better_only') {
    scope.push('a higher review % than the reference');
  } else if (request.filters.review_comparison === 'similar_or_better') {
    scope.push('a review % at least as strong as the reference');
  }

  if (request.filters.steam_deck?.length) {
    scope.push(`Steam Deck ${joinHumanList(request.filters.steam_deck)}`);
  }

  if (typeof request.filters.max_price_cents === 'number') {
    scope.push(`priced under ${formatCurrencyCents(request.filters.max_price_cents)}`);
  }

  if (request.filters.tags?.length) {
    scope.push(`tagged ${joinHumanList(request.filters.tags.slice(0, 3))}`);
  }

  return scope;
}

function renderSemanticSearch(
  response: TigerPrimarySemanticSearchResponse,
  request?: TigerPrimarySemanticSearchRequest | null
): string {
  const buildRows = (items: TigerPrimarySemanticSearchResult[]) => items.map((item) => [
    item.type === 'game' || !response.entityType
      ? formatGameLink(item.name, item.id)
      : item.name,
    formatMatchScore(item.score),
    formatReviewPercentage(item.review_percentage),
    formatNumber(item.total_reviews),
    item.price_cents == null ? 'n/a' : formatCurrencyCents(item.price_cents),
    item.matchReasons?.join(', ') || 'semantic match',
  ]);
  const strictRows = buildRows((response.results ?? []).slice(0, 10));
  const closeAlternativeRows = buildRows((response.close_alternatives ?? []).slice(0, 6));

  const scope = describeSemanticScope(request);
  const scopeSuffix = scope.length > 0 ? ` that keep ${joinHumanList(scope)}` : '';
  const strictIntro = response.reference
    ? `Here are the strongest matches for **${response.reference.name}**${scopeSuffix}.`
    : response.query_description
      ? `Here are the strongest matching games for **${response.query_description}**${scopeSuffix}.`
      : 'Here are the strongest matches.';
  const fallbackIntro = response.reference
    ? `I could not find exact matches for **${response.reference.name}**${scopeSuffix}. Here are the closest alternatives that still match the core similarity profile.`
    : response.query_description
      ? `I could not find exact matches for **${response.query_description}**${scopeSuffix}. Here are the closest alternatives that still match the core query.`
      : 'I could not find exact matches, but here are the closest alternatives.';
  const headers = ['Result', 'Match Score', 'Review %', 'Total Reviews', 'Price', 'Why It Matched'];
  const sections: string[] = [strictRows.length > 0 ? strictIntro : fallbackIntro];

  if (strictRows.length > 0) {
    sections.push('');
    if (closeAlternativeRows.length > 0) {
      sections.push('Strict matches');
      sections.push('');
    }
    sections.push(buildMarkdownTable(headers, strictRows));
  }

  if (closeAlternativeRows.length > 0) {
    sections.push('');
    sections.push('Close alternatives');
    if (response.close_alternatives_reason?.trim()) {
      sections.push('');
      sections.push(response.close_alternatives_reason.trim());
    }
    sections.push('');
    sections.push(buildMarkdownTable(headers, closeAlternativeRows));
  }

  return sections.join('\n');
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
      `${moment.eventCount} event${moment.eventCount === 1 ? '' : 's'} from ${(moment.sources ?? []).join(', ') || 'unknown sources'}`,
      changeSummary ? `(${changeSummary})` : '',
      eventSummary ? `${eventSummary}.` : '',
      newsSummary,
    ].filter(Boolean);

    return `- **${formatDate(moment.windowStart)}**: ${detailParts.join(' ')}`;
  });

  const entityName = response.entity?.displayName ?? 'the selected title';
  const startLabel = response.timeWindow?.startTime ? formatDate(response.timeWindow.startTime) : null;
  const endLabel = response.timeWindow?.endTime ? formatDate(response.timeWindow.endTime) : null;
  const eventCount = response.summary?.eventCount ?? response.moments.reduce((sum, moment) => sum + (moment.eventCount ?? 0), 0);
  const momentCount = response.summary?.momentCount ?? response.moments.length;
  const newsCount = response.summary?.newsCount ?? response.moments.reduce((sum, moment) => sum + (moment.linkedNews?.length ?? 0), 0);
  const intro = startLabel && endLabel
    ? `Here are the main change moments for **${entityName}** from **${startLabel}** through **${endLabel}**.`
    : `Here are the main change moments for **${entityName}**.`;

  return [
    intro,
    '',
    `Summary: ${formatNumber(eventCount)} events across ${formatNumber(momentCount)} moments and ${formatNumber(newsCount)} linked news items.`,
    '',
    ...bullets,
  ].join('\n');
}

function formatMonthLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
}

function renderMonthlyPlaytime(response: TigerPrimaryMonthlyPlaytimeResponse): string {
  const entityLabel = response.entityKind === 'publisher' ? 'publishers' : 'games';
  const monthLabel =
    response.startMonth === response.endMonth
      ? formatMonthLabel(response.startMonth)
      : `${formatMonthLabel(response.startMonth)} to ${formatMonthLabel(response.endMonth)}`;
  const rows = response.items.slice(0, 10).map((item) => {
    const name = response.entityKind === 'game'
      ? `[${item.name}](game:${item.entityId})`
      : item.name;
    const base = [
      item.rank,
      name,
      formatNumber(item.estimatedMonthlyHours),
    ];
    if (response.entityKind === 'publisher') {
      base.push(formatNumber(item.gameCount));
    } else {
      base.push(formatNumber(item.monthlyCcuSum));
    }
    return `| ${base.join(' | ')} |`;
  });
  const finalColumn = response.entityKind === 'publisher' ? 'Games' : 'Monthly CCU Sum';

  return [
    `Here are the top ${entityLabel} by estimated played hours for **${monthLabel}**.`,
    '',
    `| Rank | ${response.entityKind === 'publisher' ? 'Publisher' : 'Game'} | Estimated Played Hours | ${finalColumn} |`,
    '| --- | --- | ---: | ---: |',
    ...rows,
    '',
    '*Estimated played hours are modeled from concurrent-player data; Steam does not publish actual total played hours.*',
  ].join('\n');
}

export function renderTigerPrimaryResult(params: {
  matchedIntent: TigerPrimaryRenderableIntent;
  momentumPromptFamily?: SessionMomentumPromptFamily | null;
  request?: unknown;
  response: unknown;
  scopeAdjustedForSparseResults?: boolean;
}): string {
  if (params.matchedIntent === 'change_discovery') {
    return renderChangeDiscovery(
      params.response as TigerPrimaryDiscoverChangePatternsResponse | TigerPrimarySearchChangeActivityResponse
    );
  }

  if (params.matchedIntent === 'catalog_search') {
    return renderCatalogSearch(params.response as TigerPrimaryCatalogResponse);
  }

  if (params.matchedIntent === 'entity_overview') {
    return renderEntityOverview(params.response as TigerPrimaryEntityOverviewResponse);
  }

  if (params.matchedIntent === 'entity_ranking') {
    return renderRankEntities(
      params.response as TigerPrimaryRankEntitiesResponse,
      (params.request as TigerPrimaryRankRequest | null | undefined) ?? null
    );
  }

  if (params.matchedIntent === 'entity_compare') {
    return renderCompareEntities(params.response as TigerPrimaryCompareEntitiesResponse);
  }

  if (params.matchedIntent === 'metric_history') {
    return renderMetricHistory(params.response as TigerPrimaryTraceMetricHistoryResponse);
  }

  if (params.matchedIntent === 'momentum_discovery') {
    return renderMomentumDiscovery({
      momentumPromptFamily: params.momentumPromptFamily ?? null,
      scopeAdjustedForSparseResults: params.scopeAdjustedForSparseResults,
      response: params.response as TigerPrimaryDiscoverMomentumResponse,
    });
  }

  if (params.matchedIntent === 'monthly_playtime') {
    return renderMonthlyPlaytime(params.response as TigerPrimaryMonthlyPlaytimeResponse);
  }

  if (params.matchedIntent === 'news_search') {
    return renderSearchDocuments(params.response as TigerPrimarySearchDocumentsResponse);
  }

  if (params.matchedIntent === 'relation_lookup') {
    return renderRelatedEntities(
      params.response as TigerPrimaryRelatedEntitiesResponse,
      (params.request as TigerPrimaryRelatedEntitiesRequest | null | undefined) ?? null
    );
  }

  if (params.matchedIntent === 'semantic_search') {
    return renderSemanticSearch(
      params.response as TigerPrimarySemanticSearchResponse,
      (params.request as TigerPrimarySemanticSearchRequest | null | undefined) ?? null
    );
  }

  if (params.matchedIntent === 'user_context') {
    return renderUserContext(params.response as TigerPrimaryUserContextResponse);
  }

  return renderExplainChanges(params.response as TigerPrimaryExplainChangesResponse);
}
