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

export type ChatRenderData =
  | ChatMetricHistoryRenderData
  | ChatMomentumCurrentPlayersRenderData
  | ChatEntityClarificationRenderData;

type TigerRenderContractName =
  | 'compareEntities'
  | 'discoverMomentum'
  | 'getEntityOverview'
  | 'getRelatedEntities'
  | 'getYoutubeGameCoverage'
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
