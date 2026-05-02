import type { SessionChatSelectionCandidate, SessionChatSelectionState } from '@/lib/chat/chat-context-types';
import type { ChatSelectedEntity } from '@/lib/llm/types';

export type ChatHistoryMetric =
  | 'ccu_peak'
  | 'discount_percent'
  | 'owners_midpoint'
  | 'positive_percentage'
  | 'price_cents'
  | 'review_score'
  | 'total_reviews';

export interface ChatMetricHistoryPoint {
  date: string;
  value: number | null;
}

export interface ChatMetricHistorySeries {
  metric: ChatHistoryMetric;
  points: ChatMetricHistoryPoint[];
  summary: {
    deltaAbs: number | null;
    deltaPct: number | null;
    firstDate: string | null;
    lastDate: string | null;
    latestValue: number | null;
    pointCount: number;
    startValue: number | null;
  };
}

export interface ChatMetricHistoryRenderData {
  endDate: string;
  entityName: string;
  kind: 'metric_history';
  series: ChatMetricHistorySeries[];
  startDate: string;
}

export interface ChatMomentumCurrentPlayersRow {
  appid: number;
  ccuPeak: number | null;
  ccuSparkline: number[];
  name: string;
  platformSupport: string[];
  totalReviews: number | null;
  trendDirection: 'down' | 'stable' | 'up' | null;
}

export interface ChatMomentumCurrentPlayersRenderData {
  kind: 'momentum_current_players';
  rankingLabel: string;
  rows: ChatMomentumCurrentPlayersRow[];
}

export interface ChatEntityClarificationCandidate {
  displayName: string;
  entityKind: ChatSelectedEntity['entityKind'];
  entityUid: string;
  matchQuality: NonNullable<ChatSelectedEntity['matchQuality']>;
  matchSource: NonNullable<SessionChatSelectionCandidate['matchSource']> | null;
  ordinal: number;
  platform: ChatSelectedEntity['platform'];
  platformEntityId?: string | null;
  releaseYear: number | null;
  resolutionTier: NonNullable<SessionChatSelectionCandidate['resolutionTier']> | null;
  selectedEntity: ChatSelectedEntity;
  totalReviews: number | null;
}

export interface ChatEntityClarificationSlot {
  candidates: ChatEntityClarificationCandidate[];
  continuationToken?: string | null;
  expectedEntityKind?: ChatEntityClarificationCandidate['entityKind'] | null;
  label: string;
  query: string;
  requiresClarification: boolean;
  slotId: string;
  totalCandidates?: number | null;
}

export interface ChatEntityClarificationRenderData {
  family: string;
  kind: 'entity_clarification';
  originalPrompt: string;
  slots: ChatEntityClarificationSlot[];
}

type ChatYoutubeCoverageView =
  | 'latest_videos'
  | 'creator_coverage'
  | 'top_videos'
  | 'video_growth'
  | 'content_mix'
  | 'cadence';
type ChatYoutubeContentClass =
  | 'standard_video'
  | 'short'
  | 'live_or_recent_live';
type ChatYoutubeCoverageWindowDays = 1 | 2 | 3 | 7 | 14 | 30;
type ChatYoutubeCoverageWindow = 'current' | `${ChatYoutubeCoverageWindowDays}d`;

export interface ChatYoutubeTableColumn {
  align?: 'left' | 'right';
  label: string;
  numeric?: boolean;
}

export interface ChatYoutubeTableCell {
  href?: string;
  text: string;
}

export interface ChatYoutubeTableRow {
  cells: ChatYoutubeTableCell[];
  key: string;
}

export interface ChatYoutubePaginationState {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  limit: number;
  offset: number;
  totalRows: number;
}

export interface ChatYoutubeCoverageRequestState {
  contentClass?: ChatYoutubeContentClass | null;
  entityUid: string;
  limit: number;
  offset: number;
  view: ChatYoutubeCoverageView;
  window?: ChatYoutubeCoverageWindow | null;
}

export interface ChatYoutubeGameActivityRenderData {
  kind: 'youtube_game_activity';
  pagination: ChatYoutubePaginationState | null;
  request: ChatYoutubeCoverageRequestState;
  table: {
    columns: ChatYoutubeTableColumn[];
    rows: ChatYoutubeTableRow[];
  };
  view: ChatYoutubeCoverageView;
}

export type ChatRenderData =
  | ChatMetricHistoryRenderData
  | ChatMomentumCurrentPlayersRenderData
  | ChatYoutubeGameActivityRenderData
  | ChatEntityClarificationRenderData;

type TigerRenderContractName =
  | 'compareEntities'
  | 'discoverMomentum'
  | 'getEntityOverview'
  | 'getRelatedEntities'
  | 'getYoutubeGameCoverage'
  | 'queryMonthlyPlaytime'
  | 'rankEntities'
  | 'searchCatalog'
  | 'semanticSearch'
  | 'traceMetricHistory';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function getSparklinePoints(value: unknown): number[] {
  return Array.isArray(value)
    ? value
      .map((item) => getNumber(item))
      .filter((item): item is number => item !== null)
    : [];
}

function isHistoryMetric(value: string | null): value is ChatHistoryMetric {
  return value === 'ccu_peak'
    || value === 'discount_percent'
    || value === 'owners_midpoint'
    || value === 'positive_percentage'
    || value === 'price_cents'
    || value === 'review_score'
    || value === 'total_reviews';
}

function buildMomentumCurrentPlayersRenderData(
  response: unknown
): ChatMomentumCurrentPlayersRenderData | null {
  if (!isRecord(response) || getString(response.timeframe) !== 'current') {
    return null;
  }

  const rows = asRecordArray(response.items)
    .map((item) => {
      const appid = getNumber(item.appid);
      const name = getString(item.name);
      if (!appid || !name) {
        return null;
      }

      return {
        appid,
        ccuPeak: getNumber(item.ccuPeak),
        ccuSparkline: getSparklinePoints(item.ccuSparkline),
        name,
        platformSupport: getStringArray(item.platformSupport),
        totalReviews: getNumber(item.totalReviews),
        trendDirection:
          item.trendDirection === 'up' || item.trendDirection === 'down' || item.trendDirection === 'stable'
            ? item.trendDirection
            : null,
      };
    })
    .filter((item): item is ChatMomentumCurrentPlayersRow => item !== null);

  if (rows.length === 0) {
    return null;
  }

  return {
    kind: 'momentum_current_players',
    rankingLabel: getString(response.rankingLabel) ?? 'Peak CCU',
    rows,
  };
}

function buildMetricHistoryRenderData(response: unknown): ChatMetricHistoryRenderData | null {
  if (!isRecord(response)) {
    return null;
  }

  const entity = isRecord(response.entity) ? response.entity : null;
  const entityName = getString(entity?.displayName);
  const startDate = getString(response.startDate);
  const endDate = getString(response.endDate);

  if (!entityName || !startDate || !endDate) {
    return null;
  }

  const series = asRecordArray(response.series)
    .map((item) => {
      const metric = getString(item.metric);
      if (!isHistoryMetric(metric)) {
        return null;
      }

      const summaryRecord = isRecord(item.summary) ? item.summary : null;

      return {
        metric,
        points: asRecordArray(item.points).map((point) => ({
          date: getString(point.date) ?? '',
          value: getNumber(point.value),
        })).filter((point) => point.date.length > 0),
        summary: {
          deltaAbs: getNumber(summaryRecord?.deltaAbs),
          deltaPct: getNumber(summaryRecord?.deltaPct),
          firstDate: getString(summaryRecord?.firstDate),
          lastDate: getString(summaryRecord?.lastDate),
          latestValue: getNumber(summaryRecord?.latestValue),
          pointCount: Math.max(0, Math.trunc(getNumber(summaryRecord?.pointCount) ?? 0)),
          startValue: getNumber(summaryRecord?.startValue),
        },
      };
    })
    .filter((item): item is ChatMetricHistorySeries => item !== null);

  if (series.length === 0) {
    return null;
  }

  return {
    endDate,
    entityName,
    kind: 'metric_history',
    series,
    startDate,
  };
}

function isYoutubeCoverageView(value: string | null): value is ChatYoutubeCoverageView {
  return value === 'latest_videos'
    || value === 'creator_coverage'
    || value === 'top_videos'
    || value === 'video_growth'
    || value === 'content_mix'
    || value === 'cadence';
}

function isYoutubeContentClass(value: string | null): value is ChatYoutubeContentClass {
  return value === 'standard_video' || value === 'short' || value === 'live_or_recent_live';
}

function getYoutubeContentClass(value: unknown): ChatYoutubeContentClass | null {
  const normalized = getString(value);
  return isYoutubeContentClass(normalized) ? normalized : null;
}

function isYoutubeCoverageWindow(value: string | null): value is ChatYoutubeCoverageWindow {
  return value === 'current'
    || value === '1d'
    || value === '2d'
    || value === '3d'
    || value === '7d'
    || value === '14d'
    || value === '30d';
}

function formatYoutubeCount(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return Math.round(value).toLocaleString('en-US');
}

function formatYoutubePercent(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`
    : 'n/a';
}

function formatYoutubeDateTime(value: string | null): string {
  if (!value) {
    return 'unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}

function formatYoutubeContentClassLabel(value: ChatYoutubeContentClass | null): string {
  if (value === 'short') {
    return 'Shorts';
  }

  if (value === 'live_or_recent_live') {
    return 'Live / recent live';
  }

  return 'Standard video';
}

function buildYoutubeLinkCell(text: string, href: string | null = null): ChatYoutubeTableCell {
  return href ? { href, text } : { text };
}

function buildYoutubePaginationState(params: {
  fallbackTotalRows?: number | null;
  limit: number;
  offset: number;
  rowCount: number;
  value: Record<string, unknown> | null;
}): ChatYoutubePaginationState {
  const inferredTotalRows = getNumber(params.value?.totalRows) ?? params.fallbackTotalRows ?? params.rowCount;
  const totalRows = Math.max(0, Math.trunc(inferredTotalRows));
  const offset = Math.max(0, Math.trunc(getNumber(params.value?.offset) ?? params.offset));
  const limit = Math.max(1, Math.trunc(getNumber(params.value?.limit) ?? params.limit));

  return {
    hasNextPage: params.value?.hasNextPage === true || offset + params.rowCount < totalRows,
    hasPreviousPage: params.value?.hasPreviousPage === true || offset > 0,
    limit,
    offset,
    totalRows,
  };
}

function inferYoutubePaginationTotalRows(params: {
  response: Record<string, unknown>;
  rowCount: number;
  view: ChatYoutubeCoverageView;
  window: ChatYoutubeCoverageWindow | null;
}): number | null {
  const summary = isRecord(params.response.summary) ? params.response.summary : null;
  if (!summary) {
    return null;
  }

  if (params.view === 'latest_videos' || params.view === 'top_videos') {
    if (params.window === 'current') {
      return getNumber(summary.matchedPrimaryVideoCount);
    }

    if (params.window === '1d') {
      return getNumber(summary.newMatchedVideos1d);
    }

    if (params.window === '7d') {
      return getNumber(summary.newMatchedVideos7d);
    }

    if (params.window === '30d') {
      return getNumber(summary.newMatchedVideos30d);
    }
  }

  if (params.view === 'creator_coverage') {
    if (params.window === '7d') {
      return getNumber(summary.distinctUploadChannels7d);
    }

    if (params.window === '30d') {
      return getNumber(summary.distinctUploadChannels30d);
    }
  }

  return params.rowCount > 0 ? params.rowCount : null;
}

function buildYoutubeGameActivityRenderData(
  response: unknown
): ChatYoutubeGameActivityRenderData | null {
  if (!isRecord(response)) {
    return null;
  }

  const availability = isRecord(response.availability) ? response.availability : null;
  if (getString(availability?.state) !== 'ready') {
    return null;
  }

  const entity = isRecord(response.entity) ? response.entity : null;
  const entityUid = getString(entity?.entityUid);
  const view = getString(response.view);
  if (!entityUid || !isYoutubeCoverageView(view)) {
    return null;
  }

  const contentClassRaw = getString(response.contentClass);
  const contentClass = isYoutubeContentClass(contentClassRaw) ? contentClassRaw : null;
  const resolvedWindowRaw = getString(response.resolvedWindow);
  const resolvedWindow = isYoutubeCoverageWindow(resolvedWindowRaw) ? resolvedWindowRaw : null;
  const limit = Math.max(1, Math.trunc(getNumber(response.limit) ?? 10));
  const paginationRecord = isRecord(response.pagination) ? response.pagination : null;
  const request: ChatYoutubeCoverageRequestState = {
    ...(contentClass ? { contentClass } : {}),
    entityUid,
    limit,
    offset: Math.max(0, Math.trunc(getNumber(paginationRecord?.offset) ?? 0)),
    view,
    ...(resolvedWindow ? { window: resolvedWindow } : {}),
  };

  if (view === 'creator_coverage') {
    const creators = asRecordArray(response.creators);
    if (creators.length === 0) {
      return null;
    }

    const hasSubscribers = creators.some((row) => getNumber(row.channelSubscriberCount) !== null);
    const rows = creators.map((row, index) => ({
      cells: [
        buildYoutubeLinkCell(
          getString(row.channelTitle) ?? 'Unknown channel',
          getString(row.channelId)
            ? `https://www.youtube.com/channel/${encodeURIComponent(getString(row.channelId) ?? '')}`
            : null
        ),
        { text: formatYoutubeCount(getNumber(row.matchedVideoCount)) },
        { text: formatYoutubeCount(getNumber(row.totalMatchedViews)) },
        ...(hasSubscribers ? [{ text: formatYoutubeCount(getNumber(row.channelSubscriberCount)) }] : []),
        { text: formatYoutubeDateTime(getString(row.latestMatchedUploadAt)) },
      ],
      key: getString(row.channelId) ?? `creator-${index}`,
    }));

    return {
      kind: 'youtube_game_activity',
      pagination: buildYoutubePaginationState({
        fallbackTotalRows: inferYoutubePaginationTotalRows({
          response,
          rowCount: rows.length,
          view,
          window: resolvedWindow,
        }),
        limit,
        offset: request.offset,
        rowCount: rows.length,
        value: paginationRecord,
      }),
      request,
      table: {
        columns: [
          { label: 'Channel' },
          { label: 'Videos', numeric: true, align: 'right' },
          { label: 'Views', numeric: true, align: 'right' },
          ...(hasSubscribers ? [{ label: 'Subscribers', numeric: true, align: 'right' as const }] : []),
          { label: 'Latest Upload' },
        ],
        rows,
      },
      view,
    };
  }

  if (view === 'content_mix') {
    const rowsData = asRecordArray(response.contentMix);
    if (rowsData.length === 0) {
      return null;
    }

    return {
      kind: 'youtube_game_activity',
      pagination: null,
      request,
      table: {
        columns: [
          { label: 'Format' },
          { label: 'Videos', numeric: true, align: 'right' },
          { label: 'New Videos', numeric: true, align: 'right' },
          { label: 'Channels', numeric: true, align: 'right' },
          { label: 'Views', numeric: true, align: 'right' },
          { label: 'View Delta', numeric: true, align: 'right' },
        ],
        rows: rowsData.map((row, index) => ({
          cells: [
            { text: formatYoutubeContentClassLabel(getYoutubeContentClass(row.contentClass)) },
            { text: formatYoutubeCount(getNumber(row.matchedPrimaryVideoCount)) },
            { text: formatYoutubeCount(getNumber(row.newMatchedVideos)) },
            { text: formatYoutubeCount(getNumber(row.distinctUploadChannels)) },
            { text: formatYoutubeCount(getNumber(row.currentViews)) },
            { text: formatYoutubeCount(getNumber(row.matchedVideoViewDelta)) },
          ],
          key: getString(row.contentClass) ?? `content-mix-${index}`,
        })),
      },
      view,
    };
  }

  if (view === 'cadence') {
    const cadence = isRecord(response.cadence) ? response.cadence : null;
    if (!cadence) {
      return null;
    }

    const rows: ChatYoutubeTableRow[] = [
      { key: 'upload-channels', cells: [{ text: 'Upload channels' }, { text: formatYoutubeCount(getNumber(cadence.distinctUploadChannels)) }] },
      { key: 'new-videos', cells: [{ text: 'New videos' }, { text: formatYoutubeCount(getNumber(cadence.newMatchedVideos)) }] },
      { key: 'current-views', cells: [{ text: 'Current views' }, { text: formatYoutubeCount(getNumber(cadence.viewsOnNewVideos)) }] },
    ];

    if (getNumber(cadence.matchedVideoViewDelta) !== null) {
      rows.push({
        key: 'view-delta',
        cells: [{ text: 'View delta' }, { text: formatYoutubeCount(getNumber(cadence.matchedVideoViewDelta)) }],
      });
    }

    const summary = isRecord(response.summary) ? response.summary : null;
    if (getString(summary?.freshestMatchedUploadAt)) {
      rows.push({
        key: 'most-recent-upload',
        cells: [{ text: 'Most recent upload' }, { text: formatYoutubeDateTime(getString(summary?.freshestMatchedUploadAt)) }],
      });
    }

    return {
      kind: 'youtube_game_activity',
      pagination: null,
      request,
      table: {
        columns: [{ label: 'Metric' }, { label: 'Value' }],
        rows,
      },
      view,
    };
  }

  const items = asRecordArray(response.items);
  if (items.length === 0) {
    return null;
  }

  const rows = items.map((row, index) => {
    const channelId = getString(row.channelId);
    const videoUrl = getString(row.url);
    const cells: ChatYoutubeTableCell[] =
      view === 'video_growth'
        ? [
            buildYoutubeLinkCell(getString(row.title) ?? 'Untitled video', videoUrl),
            buildYoutubeLinkCell(
              getString(row.channelTitle) ?? 'Unknown channel',
              channelId ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}` : null
            ),
            { text: formatYoutubeDateTime(getString(row.publishedAt)) },
            { text: formatYoutubeCount(getNumber(row.viewDelta)) },
            { text: formatYoutubePercent(getNumber(row.growthPct)) },
            { text: formatYoutubeCount(getNumber(row.viewCount)) },
            { text: formatYoutubeContentClassLabel(getYoutubeContentClass(row.contentClass)) },
          ]
        : [
            buildYoutubeLinkCell(getString(row.title) ?? 'Untitled video', videoUrl),
            buildYoutubeLinkCell(
              getString(row.channelTitle) ?? 'Unknown channel',
              channelId ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}` : null
            ),
            { text: formatYoutubeDateTime(getString(row.publishedAt)) },
            { text: formatYoutubeCount(getNumber(row.viewCount)) },
            { text: formatYoutubeContentClassLabel(getYoutubeContentClass(row.contentClass)) },
          ];

    return {
      cells,
      key: getString(row.videoId) ?? `youtube-item-${index}`,
    };
  });

  return {
    kind: 'youtube_game_activity',
    pagination: buildYoutubePaginationState({
      fallbackTotalRows: inferYoutubePaginationTotalRows({
        response,
        rowCount: rows.length,
        view,
        window: resolvedWindow,
      }),
      limit,
      offset: request.offset,
      rowCount: rows.length,
      value: paginationRecord,
    }),
    request,
    table: {
      columns:
        view === 'video_growth'
          ? [
              { label: 'Video' },
              { label: 'Channel' },
              { label: 'Published' },
              { label: 'View Delta', numeric: true, align: 'right' },
              { label: 'Growth', numeric: true, align: 'right' },
              { label: 'Views', numeric: true, align: 'right' },
              { label: 'Format' },
            ]
          : [
              { label: 'Video' },
              { label: 'Channel' },
              { label: 'Published' },
              { label: 'Views', numeric: true, align: 'right' },
              { label: 'Format' },
            ],
      rows,
    },
    view,
  };
}

export function buildTigerChatRenderData(params: {
  contractName: TigerRenderContractName;
  response: unknown;
}): ChatRenderData | null {
  if (params.contractName === 'discoverMomentum') {
    return buildMomentumCurrentPlayersRenderData(params.response);
  }

  if (params.contractName === 'traceMetricHistory') {
    return buildMetricHistoryRenderData(params.response);
  }

  if (params.contractName === 'getYoutubeGameCoverage') {
    return buildYoutubeGameActivityRenderData(params.response);
  }

  return null;
}

function buildClarificationSelectedEntity(
  candidate: SessionChatSelectionCandidate
): ChatSelectedEntity {
  return {
    displayName: candidate.displayName,
    entityKind: candidate.entityKind,
    entityUid: candidate.entityUid,
    matchQuality: candidate.matchQuality ?? 'exact',
    platform: candidate.platform === 'steam' ? 'steam' : 'publisheriq',
    ...(candidate.platformEntityId ? { platformEntityId: candidate.platformEntityId } : {}),
  };
}

export function buildTigerClarificationRenderData(params: {
  originalPrompt: string;
  selectionState: SessionChatSelectionState | null | undefined;
}): ChatEntityClarificationRenderData | null {
  const selectionState = params.selectionState;
  if (!selectionState?.slots?.length) {
    return null;
  }

  const slots = selectionState.slots
    .filter((slot) => slot.requiresClarification && slot.candidates.length > 0)
    .map((slot) => ({
      candidates: slot.candidates
        .map((candidate) => {
          const selectedEntity = buildClarificationSelectedEntity(candidate);
          return {
            displayName: candidate.displayName,
            entityKind: candidate.entityKind,
            entityUid: candidate.entityUid,
            matchQuality: candidate.matchQuality ?? 'exact',
            matchSource: candidate.matchSource ?? null,
            ordinal: candidate.ordinal,
            platform: selectedEntity.platform,
            ...(selectedEntity.platformEntityId
              ? { platformEntityId: selectedEntity.platformEntityId }
              : {}),
            releaseYear: candidate.releaseYear ?? null,
            resolutionTier: candidate.resolutionTier ?? null,
            selectedEntity,
            totalReviews: candidate.totalReviews ?? null,
          };
        }),
      continuationToken: slot.continuationToken ?? null,
      expectedEntityKind: slot.expectedEntityKind ?? null,
      label: slot.label,
      query: slot.query,
      requiresClarification: slot.requiresClarification,
      slotId: slot.slotId,
      totalCandidates: slot.totalCandidates ?? slot.candidates.length,
    }))
    .filter((slot) => slot.candidates.length > 0);

  if (slots.length === 0) {
    return null;
  }

  return {
    family: selectionState.family,
    kind: 'entity_clarification',
    originalPrompt: params.originalPrompt,
    slots,
  };
}
