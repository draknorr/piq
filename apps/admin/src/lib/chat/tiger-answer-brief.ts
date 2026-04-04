import 'server-only';

import type {
  SessionChatSelectionCandidate,
  SessionChatSelectionSlot,
  SessionChatSelectionState,
} from '@/lib/chat/chat-context-types';
import type { QuerySuggestion } from '@/lib/chat/query-templates';
import type { TigerShadowMatchedIntent } from '@/lib/chat/tiger-shadow-types';

type TigerAnswerIntent = Exclude<TigerShadowMatchedIntent, null>;

export interface TigerAnswerBrief {
  answerKind: 'clarification' | 'success';
  directAnswer: string;
  evidenceMarkdown?: string | null;
  fallbackMarkdown: string;
  followUpSuggestions: QuerySuggestion[];
  intent: TigerAnswerIntent;
  keyFacts: string[];
  selectionNote?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeForLooseMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }

  return value.toFixed(2);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
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

function humanizeMetric(metric: string | null | undefined): string {
  switch (metric) {
    case 'ccu_peak':
      return 'peak CCU';
    case 'game_count':
      return 'game count';
    case 'owners_midpoint':
      return 'owners';
    case 'review_score':
      return 'review score';
    case 'total_reviews':
      return 'total reviews';
    default:
      return metric ? metric.replace(/_/g, ' ') : 'metric';
  }
}

function humanizeEntityKind(entityKind: string | null | undefined): string {
  return entityKind === 'game' || entityKind === 'publisher' || entityKind === 'developer'
    ? entityKind
    : 'entity';
}

function inferNewsAnswerLabel(item: Record<string, unknown> | null): string {
  if (!item) {
    return 'coverage';
  }

  const combined = [
    getString(item.title),
    getString(item.rankingReason),
    getString(item.feedLabel),
    getString(item.feedScope),
    getString(item.excerpt),
    getString(item.bodyPreview),
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

  return 'coverage';
}

function titleCaseToken(value: string): string {
  if (value === 'macos') {
    return 'macOS';
  }

  return value.length > 0
    ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`
    : value;
}

function describeMomentumAppliedFilters(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.filtersApplied)) {
    return [];
  }

  const descriptions: string[] = [];

  for (const rawFilter of response.filtersApplied) {
    const value = String(rawFilter).trim();
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

function formatMomentumAppliedScope(response: unknown): string | null {
  const filters = describeMomentumAppliedFilters(response);
  return filters.length > 0 ? joinHumanList(filters) : null;
}

function getHistoryWindowLabels(response: unknown): { startDate: string | null; endDate: string | null } {
  if (!isRecord(response)) {
    return { endDate: null, startDate: null };
  }

  return {
    endDate: formatDate(getString(response.endDate)),
    startDate: formatDate(getString(response.startDate)),
  };
}

function dedupeSuggestions(suggestions: QuerySuggestion[], maxResults = 4): QuerySuggestion[] {
  const seen = new Set<string>();
  const unique: QuerySuggestion[] = [];

  for (const suggestion of suggestions) {
    const query = suggestion.query.trim().toLowerCase();
    if (!query || seen.has(query)) {
      continue;
    }

    seen.add(query);
    unique.push(suggestion);
    if (unique.length >= maxResults) {
      break;
    }
  }

  return unique;
}

function getDuplicateNameCount(
  slot: SessionChatSelectionSlot,
  candidate: SessionChatSelectionCandidate
): number {
  const normalizedName = normalizeForLooseMatch(candidate.displayName);
  return slot.candidates.filter(
    (item) => normalizeForLooseMatch(item.displayName) === normalizedName
  ).length;
}

function formatSelectionCandidateLabel(
  slot: SessionChatSelectionSlot,
  candidate: SessionChatSelectionCandidate
): string {
  const duplicateNameCount = getDuplicateNameCount(slot, candidate);
  return duplicateNameCount > 1
    ? `${candidate.displayName} (${candidate.entityKind})`
    : candidate.displayName;
}

function buildCandidateSwitchQuery(
  selectionState: SessionChatSelectionState,
  slot: SessionChatSelectionSlot,
  candidate: SessionChatSelectionCandidate
): string {
  const duplicateNameCount = getDuplicateNameCount(slot, candidate);

  if (duplicateNameCount > 1) {
    return selectionState.slots.length === 1
      ? `use the ${candidate.entityKind} one`
      : `switch ${slot.label} to the ${candidate.entityKind} one`;
  }

  return selectionState.slots.length === 1
    ? `use ${candidate.displayName} instead`
    : `switch ${slot.label} to ${candidate.displayName}`;
}

function buildClarificationSuggestions(selectionState: SessionChatSelectionState): QuerySuggestion[] {
  if (selectionState.slots.length === 1) {
    const slot = selectionState.slots[0];
    return slot.candidates.slice(0, 4).map((candidate) => ({
      category: candidate.entityKind,
      label: formatSelectionCandidateLabel(slot, candidate),
      query: buildCandidateSwitchQuery(selectionState, slot, candidate),
    }));
  }

  const [left, right] = selectionState.slots;
  if (!left || !right) {
    return [];
  }

  const suggestions: QuerySuggestion[] = [];
  for (const leftCandidate of left.candidates.slice(0, 2)) {
    for (const rightCandidate of right.candidates.slice(0, 2)) {
      suggestions.push({
        category: 'template',
        label: `${formatSelectionCandidateLabel(left, leftCandidate)} + ${formatSelectionCandidateLabel(right, rightCandidate)}`,
        query: `${leftCandidate.ordinal} and ${rightCandidate.ordinal}`,
      });
    }
  }

  return suggestions;
}

function buildSelectionSwitchSuggestions(selectionState: SessionChatSelectionState | null): QuerySuggestion[] {
  if (!selectionState) {
    return [];
  }

  const suggestions = selectionState.slots.flatMap((slot) =>
    slot.candidates
      .filter((candidate) => candidate.entityUid !== slot.selectedEntityUid)
      .slice(0, 2)
      .map((candidate) => ({
        category: candidate.entityKind,
        label:
          selectionState.slots.length === 1
            ? `Switch to ${formatSelectionCandidateLabel(slot, candidate)}`
            : `Use ${formatSelectionCandidateLabel(slot, candidate)} for ${slot.label}`,
        query: buildCandidateSwitchQuery(selectionState, slot, candidate),
      }))
  );

  return dedupeSuggestions(suggestions, 3);
}

function shouldSurfaceAlternateSelectionHint(
  selected: SessionChatSelectionCandidate,
  alternate: SessionChatSelectionCandidate
): boolean {
  const scoreGap = selected.score - alternate.score;

  if (
    selected.matchQuality === 'exact'
    && alternate.matchQuality !== 'exact'
    && scoreGap >= 20
  ) {
    return false;
  }

  return true;
}

function buildSelectionNote(selectionState: SessionChatSelectionState | null): string | null {
  if (!selectionState) {
    return null;
  }

  const switchableSlots = selectionState.slots.filter(
    (slot) => slot.candidates.length > 1 && slot.selectedEntityUid
  );
  if (switchableSlots.length === 0) {
    return null;
  }

  if (switchableSlots.length === 1) {
    const [slot] = switchableSlots;
    const selected = slot.candidates.find((candidate) => candidate.entityUid === slot.selectedEntityUid);
    const alternate = slot.candidates.find((candidate) => candidate.entityUid !== slot.selectedEntityUid);

    if (!selected || !alternate) {
      return null;
    }

    if (!shouldSurfaceAlternateSelectionHint(selected, alternate)) {
      return null;
    }

    return `I treated this as ${formatSelectionCandidateLabel(slot, selected)} (${selected.entityKind}). Another likely match is ${formatSelectionCandidateLabel(slot, alternate)} (${alternate.entityKind}).`;
  }

  const chosen = switchableSlots
    .map((slot) => {
      const selected = slot.candidates.find((candidate) => candidate.entityUid === slot.selectedEntityUid);
      return selected ? `${slot.label}: ${formatSelectionCandidateLabel(slot, selected)}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return chosen.length > 0
    ? `I interpreted this as ${chosen.join(' and ')}. If you meant a different match, I can switch it.`
    : null;
}

function extractEvidenceMarkdown(fallbackMarkdown: string): string | null {
  const normalized = fallbackMarkdown.trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized.split('\n');
  const firstTableLine = lines.findIndex((line) => line.trim().startsWith('|'));
  if (firstTableLine >= 0) {
    return lines.slice(firstTableLine).join('\n').trim();
  }

  const firstBulletLine = lines.findIndex((line) => /^(- |\d+\. )/.test(line.trim()));
  if (firstBulletLine >= 0) {
    return lines.slice(firstBulletLine).join('\n').trim();
  }

  return null;
}

function getEntityFromResponse(response: unknown): Record<string, unknown> | null {
  return isRecord(response) && isRecord(response.entity) ? response.entity : null;
}

function getItemsFromResponse(response: unknown): Record<string, unknown>[] {
  if (!isRecord(response) || !Array.isArray(response.items)) {
    return [];
  }

  return response.items.filter((item): item is Record<string, unknown> => isRecord(item));
}

function getTopDisplayNames(response: unknown, maxItems = 3): string[] {
  const items = getItemsFromResponse(response);
  const names = items
    .map((item) => getString(item.displayName) ?? getString(item.name) ?? getString(item.appName))
    .filter((name): name is string => Boolean(name));

  return Array.from(new Set(names)).slice(0, maxItems);
}

function buildIntentSuggestions(params: {
  intent: TigerAnswerIntent;
  response: unknown;
}): QuerySuggestion[] {
  const { intent, response } = params;
  const entity = getEntityFromResponse(response);
  const entityName = entity ? getString(entity.displayName) : null;
  const entityKind = entity ? humanizeEntityKind(getString(entity.entityKind)) : null;
  const topNames = getTopDisplayNames(response);
  const items = getItemsFromResponse(response);

  if (intent === 'catalog_search') {
    const suggestions: QuerySuggestion[] = [];
    const firstName = topNames[0] ?? null;
    const secondName = topNames[1] ?? null;
    const interpretedFilters = isRecord(response) && isRecord(response.interpretedFilters) ? response.interpretedFilters : null;
    const companyName =
      interpretedFilters && (getString(interpretedFilters.developerQuery) ?? getString(interpretedFilters.publisherQuery));

    if (firstName) {
      suggestions.push({
        category: 'game',
        label: `What changed for ${firstName}?`,
        query: `What changed for ${firstName} this week?`,
      });
    }
    if (firstName && secondName) {
      suggestions.push({
        category: 'template',
        label: `Compare ${firstName} and ${secondName}`,
        query: `Compare ${firstName} and ${secondName} by reviews`,
      });
    }
    if (companyName) {
      suggestions.push({
        category: 'template',
        label: `${companyName} by player base`,
        query: `How many players do ${companyName} games have?`,
      });
    }

    return suggestions;
  }

  if (intent === 'entity_ranking') {
    const firstName = topNames[0] ?? null;
    const secondName = topNames[1] ?? null;
    const suggestions: QuerySuggestion[] = [];
    const currentMetric = isRecord(response) ? getString(response.metric) : null;

    if (firstName && secondName) {
      suggestions.push({
        category: 'template',
        label: `Compare ${firstName} and ${secondName}`,
        query: `Compare ${firstName} and ${secondName} by reviews`,
      });
    }
    if (firstName) {
      suggestions.push({
        category: 'template',
        label: `What changed for ${firstName}?`,
        query: `What changed for ${firstName} this week?`,
      });
    }
    if (currentMetric !== 'ccu_peak') {
      suggestions.push({
        category: 'template',
        label: 'By Peak CCU',
        query: 'What about by CCU?',
      });
    }
    if (currentMetric !== 'owners_midpoint') {
      suggestions.push({
        category: 'template',
        label: 'By owners',
        query: 'What about by owners?',
      });
    }
    if (currentMetric !== 'total_reviews') {
      suggestions.push({
        category: 'template',
        label: 'By reviews',
        query: 'What about by reviews?',
      });
    }
    if (items.length >= 10) {
      suggestions.push({
        category: 'template',
        label: 'Show the next 10',
        query: 'Show the next 10',
      });
    }

    return suggestions;
  }

  if (intent === 'entity_compare') {
    const firstName = topNames[0] ?? null;
    const secondName = topNames[1] ?? null;
    const suggestions: QuerySuggestion[] = [];

    if (firstName) {
      suggestions.push({
        category: 'template',
        label: `Show ${firstName}'s catalog`,
        query: `Show me all games by ${firstName}`,
      });
    }
    if (secondName) {
      suggestions.push({
        category: 'template',
        label: `Show ${secondName}'s catalog`,
        query: `Show me all games by ${secondName}`,
      });
    }
    if (firstName && secondName) {
      suggestions.push({
        category: 'template',
        label: `${firstName} vs ${secondName} by owners`,
        query: `Compare ${firstName} and ${secondName} by owners`,
      });
    }

    return suggestions;
  }

  if (intent === 'entity_overview' && entityName) {
    if (entityKind === 'game') {
      return [
        {
          category: 'game',
          label: `Recent changes for ${entityName}`,
          query: `What changed for ${entityName} this week?`,
        },
        {
          category: 'game',
          label: `Recent announcements for ${entityName}`,
          query: `Any recent announcements about ${entityName}?`,
        },
        {
          category: 'game',
          label: `${entityName} over the last 30 days`,
          query: `How have ${entityName} reviews changed over the last 30 days?`,
        },
      ];
    }

    return [
      {
        category: entityKind === 'publisher' ? 'publisher' : 'developer',
        label: `${entityName}'s games`,
        query: `Show me all games by ${entityName}`,
      },
      {
        category: entityKind === 'publisher' ? 'publisher' : 'developer',
        label: `${entityName} by player base`,
        query: `How many players do ${entityName} games have?`,
      },
      {
        category: entityKind === 'publisher' ? 'publisher' : 'developer',
        label: `${entityName}'s best-reviewed games`,
        query: `What are the top games by ${entityName} based on reviews?`,
      },
    ];
  }

  if (intent === 'user_context') {
    const pins = isRecord(response) && Array.isArray(response.pins)
      ? response.pins.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const firstPin = pins[0] ?? null;
    const secondPin = pins[1] ?? null;
    const firstName = firstPin ? getString(firstPin.displayName) : null;
    const secondName = secondPin ? getString(secondPin.displayName) : null;
    const suggestions: QuerySuggestion[] = [];

    if (firstName) {
      suggestions.push({
        category: 'template',
        label: `What changed for ${firstName}?`,
        query: `What changed for ${firstName} this week?`,
      });
      suggestions.push({
        category: 'template',
        label: `Announcements for ${firstName}`,
        query: `Any recent announcements about ${firstName}?`,
      });
    }
    if (firstName && secondName) {
      suggestions.push({
        category: 'template',
        label: `Compare ${firstName} and ${secondName}`,
        query: `Compare ${firstName} and ${secondName} by reviews`,
      });
    }

    return suggestions;
  }

  if (intent === 'metric_history' && entityName) {
    return [
      {
        category: 'game',
        label: `Recent changes for ${entityName}`,
        query: `What changed for ${entityName} this week?`,
      },
      {
        category: 'game',
        label: `Recent announcements for ${entityName}`,
        query: `Any recent announcements about ${entityName}?`,
      },
      {
        category: 'game',
        label: `${entityName} price history`,
        query: `Show ${entityName} price and discount over the last 30 days`,
      },
    ];
  }

  if (intent === 'momentum_discovery') {
    const firstName = topNames[0] ?? null;
    const secondName = topNames[1] ?? null;
    const filtersApplied = isRecord(response) && Array.isArray(response.filtersApplied)
      ? response.filtersApplied.map((value) => String(value).toLowerCase())
      : [];
    const rankingLabel = isRecord(response) ? getString(response.rankingLabel) : null;
    const sortBy = isRecord(response) ? getString(response.sortBy) : null;
    const timeframe = isRecord(response) ? getString(response.timeframe) : null;
    const baseTrendQuery =
      rankingLabel?.toLowerCase().includes('ccu')
        ? 'games with the most players right now'
        : rankingLabel?.toLowerCase().includes('acceleration')
          ? `games accelerating ${timeframe === '30d' ? 'this month' : 'this week'}`
          : rankingLabel?.toLowerCase().includes('review')
            ? `games with review momentum ${timeframe === '30d' ? 'this month' : 'this week'}`
            : `games trending ${timeframe === '30d' ? 'this month' : 'this week'}`;
    const suggestions: QuerySuggestion[] = [];

    if (firstName) {
      suggestions.push({
        category: 'game',
        label: `What changed for ${firstName}?`,
        query: `What changed for ${firstName} this week?`,
      });
      suggestions.push({
        category: 'game',
        label: `Recent announcements for ${firstName}`,
        query: `Any recent announcements about ${firstName}?`,
      });
    }
    if (firstName && secondName) {
      suggestions.push({
        category: 'template',
        label: `Compare ${firstName} and ${secondName}`,
        query: `Compare ${firstName} and ${secondName} by reviews`,
      });
    }
    if (sortBy !== 'ccu_peak' || timeframe !== 'current') {
      suggestions.push({
        category: 'template',
        label: 'By Peak CCU',
        query: 'What about by CCU?',
      });
    }
    if (sortBy !== 'momentum_score') {
      suggestions.push({
        category: 'template',
        label: 'Trending instead',
        query: 'What about trending this week?',
      });
    }
    if (!filtersApplied.some((entry) => entry.includes('steam_deck'))) {
      suggestions.push({
        category: 'template',
        label: 'Only Steam Deck verified',
        query: `Show Steam Deck verified ${baseTrendQuery}`,
      });
    } else if (!filtersApplied.some((entry) => entry.includes('platforms'))) {
      suggestions.push({
        category: 'template',
        label: 'Only Linux',
        query: `Show Linux ${baseTrendQuery}`,
      });
    } else if (!filtersApplied.some((entry) => entry.includes('is_free'))) {
      suggestions.push({
        category: 'template',
        label: 'Only free-to-play',
        query: `Show free-to-play ${baseTrendQuery}`,
      });
    }

    return suggestions;
  }

  if ((intent === 'news_search' || intent === 'change_explanation') && entityName) {
    return [
      {
        category: 'game',
        label: `Recent changes for ${entityName}`,
        query: `What changed for ${entityName} this week?`,
      },
      {
        category: 'game',
        label: `${entityName}'s last big update`,
        query: `What changed on ${entityName} before and after its last big update?`,
      },
      {
        category: 'game',
        label: `${entityName} review trend`,
        query: `How have ${entityName} reviews changed over the last 30 days?`,
      },
    ];
  }

  if (intent === 'change_discovery') {
    const firstName = topNames[0] ?? null;
    const secondName = topNames[1] ?? null;
    const suggestions: QuerySuggestion[] = [];
    if (firstName) {
      suggestions.push({
        category: 'game',
        label: `Drill into ${firstName}`,
        query: `What changed for ${firstName} this week?`,
      });
      suggestions.push({
        category: 'game',
        label: `Announcements for ${firstName}`,
        query: `Any recent announcements about ${firstName}?`,
      });
    }
    if (firstName && secondName) {
      suggestions.push({
        category: 'template',
        label: `Compare ${firstName} and ${secondName}`,
        query: `Compare ${firstName} and ${secondName} by reviews`,
      });
    }
    return suggestions;
  }

  if (intent === 'semantic_search') {
    const reference = isRecord(response) && isRecord(response.reference) ? response.reference : null;
    const referenceName = reference ? getString(reference.name) : null;
    const firstName = topNames[0] ?? null;
    const suggestions: QuerySuggestion[] = [];

    if (referenceName && firstName) {
      suggestions.push({
        category: 'template',
        label: `Compare ${referenceName} and ${firstName}`,
        query: `Compare ${referenceName} and ${firstName} by reviews`,
      });
    }
    if (firstName) {
      suggestions.push({
        category: 'game',
        label: `What changed for ${firstName}?`,
        query: `What changed for ${firstName} this week?`,
      });
    }
    if (referenceName) {
      suggestions.push({
        category: 'template',
        label: `More like ${referenceName}`,
        query: `Show more games like ${referenceName}`,
      });
    }
    return suggestions;
  }

  return [];
}

function getMomentumSortBy(
  response: unknown
):
  | 'ccu_peak'
  | 'momentum_score'
  | 'review_score'
  | 'reviews_added_30d'
  | 'reviews_added_7d'
  | 'sentiment_delta'
  | 'total_reviews'
  | 'velocity_7d'
  | 'velocity_acceleration'
  | null {
  if (!isRecord(response)) {
    return null;
  }

  const sortBy = getString(response.sortBy);
  if (
    sortBy === 'ccu_peak'
    || sortBy === 'momentum_score'
    || sortBy === 'review_score'
    || sortBy === 'reviews_added_30d'
    || sortBy === 'reviews_added_7d'
    || sortBy === 'sentiment_delta'
    || sortBy === 'total_reviews'
    || sortBy === 'velocity_7d'
    || sortBy === 'velocity_acceleration'
  ) {
    return sortBy;
  }

  return null;
}

function getMomentumTrendType(
  response: unknown
): 'accelerating' | 'breaking_out' | 'declining' | 'review_momentum' | null {
  if (!isRecord(response)) {
    return null;
  }

  const trendType = getString(response.trendType);
  return trendType === 'accelerating'
    || trendType === 'breaking_out'
    || trendType === 'declining'
    || trendType === 'review_momentum'
    ? trendType
    : null;
}

function getMomentumBriefMode(response: unknown): 'current_players' | 'review_momentum' | 'momentum' {
  const sortBy = getMomentumSortBy(response);
  const trendType = getMomentumTrendType(response);
  const timeframe = isRecord(response) ? getString(response.timeframe) : null;

  if (sortBy === 'ccu_peak' && timeframe === 'current') {
    return 'current_players';
  }

  if (
    sortBy === 'review_score'
    || sortBy === 'reviews_added_7d'
    || sortBy === 'reviews_added_30d'
    || sortBy === 'sentiment_delta'
    || sortBy === 'velocity_7d'
    || trendType === 'review_momentum'
  ) {
    return 'review_momentum';
  }

  return 'momentum';
}

function getMomentumWindowLabel(response: unknown): string {
  const timeframe = isRecord(response) ? getString(response.timeframe) : null;
  const end = new Date();
  const endLabel = formatDate(end.toISOString());

  if (!endLabel || timeframe === 'current' || !timeframe) {
    return endLabel ?? 'today';
  }

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (timeframe === '30d' ? 29 : 6));
  const startLabel = formatDate(start.toISOString());
  return startLabel && endLabel ? `${startLabel} to ${endLabel}` : endLabel;
}

function buildDirectAnswer(params: {
  intent: TigerAnswerIntent;
  response: unknown;
}): string {
  const { intent, response } = params;
  const entity = getEntityFromResponse(response);
  const entityName = entity ? getString(entity.displayName) : null;
  const topNames = getTopDisplayNames(response);

  if (intent === 'catalog_search') {
    const interpretedFilters = isRecord(response) && isRecord(response.interpretedFilters) ? response.interpretedFilters : null;
    const companyName =
      interpretedFilters && (getString(interpretedFilters.developerQuery) ?? getString(interpretedFilters.publisherQuery));
    if (companyName) {
      return `I found matching games from ${companyName}.`;
    }

    return topNames[0]
      ? `I found several matches, led by ${topNames[0]}.`
      : 'I found a set of matching games.';
  }

  if (intent === 'entity_ranking') {
    const firstItem = getItemsFromResponse(response)[0] ?? null;
    const leaderName = firstItem ? getString(firstItem.displayName) ?? getString(firstItem.name) : null;
    const metric = isRecord(response) ? getString(response.metric) : null;
    return leaderName
      ? `${leaderName} currently leads this ranking by ${humanizeMetric(metric)}.`
      : `Here is the current ranking by ${humanizeMetric(metric)}.`;
  }

  if (intent === 'entity_compare') {
    const highlights = isRecord(response) && Array.isArray(response.highlights)
      ? response.highlights.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const firstHighlight = highlights[0] ?? null;
    const secondHighlight = highlights[1] ?? null;
    if (firstHighlight && secondHighlight) {
      return `${getString(firstHighlight.displayName) ?? 'The first match'} leads on ${humanizeMetric(getString(firstHighlight.metric))}, while ${getString(secondHighlight.displayName) ?? 'the second match'} leads on ${humanizeMetric(getString(secondHighlight.metric))}.`;
    }
    if (firstHighlight) {
      return `${getString(firstHighlight.displayName) ?? 'One side'} comes out ahead on ${humanizeMetric(getString(firstHighlight.metric))}.`;
    }
    return 'Here is the side-by-side comparison.';
  }

  if (intent === 'entity_overview' && entityName) {
    if (getString(entity?.entityKind) === 'game') {
      const metrics = isRecord(entity?.metrics) ? entity.metrics : null;
      const totalReviews = metrics ? getNumber(metrics.totalReviews) : null;
      const reviewScore = metrics ? getNumber(metrics.reviewScore) : null;
      if (totalReviews != null || reviewScore != null) {
        return `${entityName} currently shows ${formatPercent(reviewScore)} positive reviews across ${formatNumber(totalReviews)} reviews.`;
      }
      return `Here is the current snapshot for ${entityName}.`;
    }

    const metrics = isRecord(entity?.metrics) ? entity.metrics : null;
    return `${entityName}'s portfolio currently spans ${formatNumber(getNumber(metrics?.gameCount))} games, with approximately ${formatNumber(getNumber(metrics?.ownersMidpoint))} owners midpoint and ${formatNumber(getNumber(metrics?.ccuPeak))} peak CCU across the catalog.`;
  }

  if (intent === 'user_context') {
    const pins = isRecord(response) && Array.isArray(response.pins)
      ? response.pins.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const alerts = isRecord(response) && Array.isArray(response.alerts)
      ? response.alerts.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const unreadAlertCount = isRecord(response) ? getNumber(response.unreadAlertCount) : null;
    const totalPins = isRecord(response) ? getNumber(response.totalPins) : null;
    const firstAlert = alerts[0] ?? null;
    const firstPin = pins[0] ?? null;
    const firstAlertTitle = firstAlert ? getString(firstAlert.title) : null;
    const firstPinName = firstPin ? getString(firstPin.displayName) : null;

    if ((unreadAlertCount ?? 0) > 0) {
      return firstAlertTitle
        ? `You currently have ${formatNumber(unreadAlertCount)} unread alerts across ${formatNumber(totalPins)} pinned items. The latest one is ${firstAlertTitle}.`
        : `You currently have ${formatNumber(unreadAlertCount)} unread alerts across ${formatNumber(totalPins)} pinned items.`;
    }

    if ((totalPins ?? 0) > 0) {
      return firstPinName
        ? `You currently have ${formatNumber(totalPins)} pinned items and no unread alerts. ${firstPinName} is one of the items you're tracking.`
        : `You currently have ${formatNumber(totalPins)} pinned items and no unread alerts.`;
    }

    return 'You do not have any pinned items or alerts yet.';
  }

  if (intent === 'metric_history' && entityName) {
    const series = isRecord(response) && Array.isArray(response.series)
      ? response.series.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const firstSeries = series[0] ?? null;
    const summary = firstSeries && isRecord(firstSeries.summary) ? firstSeries.summary : null;
    const { startDate, endDate } = getHistoryWindowLabels(response);
    if (firstSeries && summary) {
      const windowPrefix = startDate && endDate
        ? `From ${startDate} through ${endDate}, `
        : 'Over this window, ';
      return `${windowPrefix}${entityName}'s ${humanizeMetric(getString(firstSeries.metric))} moved from ${formatNumber(getNumber(summary.startValue))} to ${formatNumber(getNumber(summary.latestValue))}.`;
    }
    return `Here is the recent history for ${entityName}.`;
  }

  if (intent === 'momentum_discovery') {
    const firstItem = getItemsFromResponse(response)[0] ?? null;
    const firstName = firstItem ? getString(firstItem.name) ?? getString(firstItem.displayName) : null;
    const rankingLabel = isRecord(response) ? getString(response.rankingLabel) : null;
    const timeframeLabel = isRecord(response) ? getString(response.timeframeLabel) : null;
    const briefMode = getMomentumBriefMode(response);
    const windowLabel = getMomentumWindowLabel(response);
    const appliedScope = formatMomentumAppliedScope(response);
    const scopeSuffix = appliedScope ? ` within the ${appliedScope} set` : '';
    const supportReasons =
      firstItem && Array.isArray(firstItem.supportReasons)
        ? firstItem.supportReasons.map((value) => String(value)).filter(Boolean)
        : [];
    const ccuPeak = firstItem ? getNumber(firstItem.ccuPeak) : null;
    return firstName
      ? briefMode === 'current_players'
        ? `As of ${windowLabel}, ${firstName} has the highest player count in this snapshot${scopeSuffix}, reaching ${formatNumber(ccuPeak)} peak concurrent users.${supportReasons[0] ? ` ${supportReasons[0]}` : ''}`
        : `From ${windowLabel}, ${firstName} leads this ${timeframeLabel?.toLowerCase() ?? 'recent'} momentum set${scopeSuffix} by ${rankingLabel?.toLowerCase() ?? 'momentum'}.${supportReasons[0] ? ` ${supportReasons[0]}` : ''}`
      : briefMode === 'current_players'
        ? `As of ${windowLabel}, here is the current player leaderboard${scopeSuffix}.`
        : `Here is the current momentum set${scopeSuffix} for ${timeframeLabel?.toLowerCase() ?? 'this window'} (${windowLabel}).`;
  }

  if (intent === 'news_search' && entityName) {
    const firstItem = getItemsFromResponse(response)[0] ?? null;
    const title = firstItem ? getString(firstItem.title) : null;
    const publishedAt = firstItem ? formatDate(getString(firstItem.publishedAt) ?? getString(firstItem.sortTime)) : null;
    const rankingReason = firstItem ? getString(firstItem.rankingReason) : null;
    const answerLabel = inferNewsAnswerLabel(firstItem);
    return title
      ? `I found recent ${answerLabel} for ${entityName}. The strongest match is “${title}” from ${publishedAt ?? 'recently'}${rankingReason ? `, and it lines up as ${rankingReason}` : ''}.`
      : `I found recent ${answerLabel} for ${entityName}.`;
  }

  if (intent === 'change_explanation' && entityName) {
    const summary = isRecord(response) && isRecord(response.summary) ? response.summary : null;
    const strongestMomentStart = summary ? formatDate(getString(summary.strongestMomentStart)) : null;
    const strongestMomentStrength = summary ? getString(summary.strongestMomentStrength) : null;
    return strongestMomentStart
      ? `The clearest recent update for ${entityName} landed around ${strongestMomentStart}${strongestMomentStrength ? ` and looked ${strongestMomentStrength}-signal` : ''}.`
      : `A few meaningful changes showed up for ${entityName} in this window.`;
  }

  if (intent === 'change_discovery') {
    return topNames[0]
      ? `${topNames[0]} is one of the clearest recent change signals in this set.`
      : 'A few titles stand out in the recent change activity.';
  }

  if (intent === 'semantic_search') {
    const reference = isRecord(response) && isRecord(response.reference) ? response.reference : null;
    const referenceName = reference ? getString(reference.name) : null;
    return referenceName && topNames[0]
      ? `${topNames[0]} looks like one of the closest matches to ${referenceName}.`
      : 'I found a few close matches for that request.';
  }

  return 'Here is the best matching answer I found.';
}

function buildKeyFacts(params: {
  intent: TigerAnswerIntent;
  response: unknown;
}): string[] {
  const { intent, response } = params;
  const facts: string[] = [];

  if (intent === 'catalog_search') {
    for (const item of getItemsFromResponse(response).slice(0, 4)) {
      const name = getString(item.name) ?? getString(item.displayName);
      if (!name) {
        continue;
      }

      const parts = [
        getNumber(item.reviewScore) != null ? `${formatNumber(getNumber(item.reviewScore))}/10 reviews` : null,
        getNumber(item.totalReviews) != null ? `${formatNumber(getNumber(item.totalReviews))} total reviews` : null,
        getNumber(item.releaseYear) != null ? `released ${formatNumber(getNumber(item.releaseYear))}` : null,
      ].filter((value): value is string => Boolean(value));

      facts.push(`${name}: ${parts.join(', ') || 'matching result'}.`);
    }
  } else if (intent === 'entity_ranking') {
    const metric = isRecord(response) ? getString(response.metric) : null;
    for (const item of getItemsFromResponse(response).slice(0, 3)) {
      const name = getString(item.displayName) ?? getString(item.name);
      if (!name) {
        continue;
      }

      facts.push(`${name}: ${formatNumber(getNumber(item.metricValue))} ${humanizeMetric(metric)}.`);
    }
  } else if (intent === 'entity_compare') {
    const highlights = isRecord(response) && Array.isArray(response.highlights)
      ? response.highlights.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];

    for (const highlight of highlights.slice(0, 3)) {
      facts.push(
        `${getString(highlight.displayName) ?? 'One side'} leads on ${humanizeMetric(getString(highlight.metric))} at ${formatNumber(getNumber(highlight.value))}.`
      );
    }
  } else if (intent === 'entity_overview') {
    const entity = getEntityFromResponse(response);
    const entityName = entity ? getString(entity.displayName) : null;
    const metrics = entity && isRecord(entity.metrics) ? entity.metrics : null;
    const details = entity && isRecord(entity.details) ? entity.details : null;
    const entityKind = entity ? getString(entity.entityKind) : null;

    if (entityName && metrics) {
      facts.push(
        entityKind === 'game'
          ? `${entityName}: ${formatNumber(getNumber(metrics.totalReviews))} reviews, ${formatNumber(getNumber(metrics.ownersMidpoint))} owners midpoint, ${formatNumber(getNumber(metrics.ccuPeak))} peak CCU.`
          : `Portfolio totals for ${entityName}: ${formatNumber(getNumber(metrics.gameCount))} games, ${formatNumber(getNumber(metrics.totalReviews))} reviews, ${formatNumber(getNumber(metrics.ownersMidpoint))} owners midpoint, ${formatNumber(getNumber(metrics.ccuPeak))} peak CCU.`
      );
    }

    if (details) {
      const releaseDate = formatDate(getString(details.releaseDate));
      const publishers = Array.isArray(details.publishers) ? details.publishers.join(', ') : null;
      if (releaseDate) {
        facts.push(`Release date: ${releaseDate}.`);
      }
      if (publishers) {
        facts.push(`Publishers: ${publishers}.`);
      }
    }
  } else if (intent === 'user_context') {
    const pins = isRecord(response) && Array.isArray(response.pins)
      ? response.pins.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const alerts = isRecord(response) && Array.isArray(response.alerts)
      ? response.alerts.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const unreadAlertCount = isRecord(response) ? getNumber(response.unreadAlertCount) : null;
    const totalPins = isRecord(response) ? getNumber(response.totalPins) : null;

    facts.push(
      `${formatNumber(totalPins)} pinned item${totalPins === 1 ? '' : 's'} and ${formatNumber(unreadAlertCount)} unread alert${unreadAlertCount === 1 ? '' : 's'}.`
    );

    for (const pin of pins.slice(0, 3)) {
      const name = getString(pin.displayName);
      const entityKind = humanizeEntityKind(getString(pin.entityKind));
      const metrics = isRecord(pin.metrics) ? pin.metrics : null;
      if (!name || !metrics) {
        continue;
      }

      facts.push(
        `${name} (${entityKind}): ${formatNumber(getNumber(metrics.gameCount))} games, ${formatPercent(getNumber(metrics.reviewScore))} review score, ${formatNumber(getNumber(metrics.totalReviews))} total reviews, ${formatNumber(getNumber(metrics.ccuPeak))} peak CCU.`
      );
    }

    for (const alert of alerts.slice(0, 2)) {
      const title = getString(alert.title);
      const severity = getString(alert.severity);
      const entity = isRecord(alert.entity) ? alert.entity : null;
      const entityName = entity ? getString(entity.displayName) : null;
      const createdAt = formatDate(getString(alert.createdAt));
      if (!title) {
        continue;
      }

      facts.push(
        `${createdAt ?? 'Recent'}: ${title}${entityName ? ` for ${entityName}` : ''}${severity ? ` (${severity})` : ''}.`
      );
    }
  } else if (intent === 'metric_history') {
    const series = isRecord(response) && Array.isArray(response.series)
      ? response.series.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    const { startDate, endDate } = getHistoryWindowLabels(response);

    if (startDate && endDate) {
      facts.push(`Window: ${startDate} through ${endDate}.`);
    }

    for (const entry of series.slice(0, 4)) {
      const summary = isRecord(entry.summary) ? entry.summary : null;
      if (!summary) {
        continue;
      }

      facts.push(
        `${humanizeMetric(getString(entry.metric))}: ${formatNumber(getNumber(summary.startValue))} to ${formatNumber(getNumber(summary.latestValue))} (${formatNumber(getNumber(summary.deltaAbs))} change).`
      );
    }
  } else if (intent === 'momentum_discovery') {
    const rankingLabel = isRecord(response) ? getString(response.rankingLabel) : null;
    const timeframeLabel = isRecord(response) ? getString(response.timeframeLabel) : null;
    const briefMode = getMomentumBriefMode(response);
    const windowLabel = getMomentumWindowLabel(response);
    const appliedScope = formatMomentumAppliedScope(response);
    if (appliedScope) {
      facts.push(`Applied filters: ${appliedScope}.`);
    }
    for (const item of getItemsFromResponse(response).slice(0, 3)) {
      const name = getString(item.name) ?? getString(item.displayName);
      const supportLevel = getString(item.supportLevel);
      const supportReasons = Array.isArray(item.supportReasons)
        ? item.supportReasons.map((value) => String(value)).filter(Boolean)
        : [];
      const reviewDelta = getNumber(item.reviewsAdded30d) ?? getNumber(item.reviewsAdded7d);
      if (!name) {
        continue;
      }
      if (briefMode === 'current_players') {
        facts.push(
          `${name}: ${formatNumber(getNumber(item.ccuPeak))} peak CCU as of ${windowLabel}, ${formatNumber(getNumber(item.totalReviews))} total reviews, trend ${getString(item.trendDirection) ?? 'n/a'}${supportReasons[0] ? `. ${supportReasons[0]}` : '.'}`
        );
        continue;
      }

      if (briefMode === 'review_momentum') {
        facts.push(
          `${name}: ${formatNumber(reviewDelta)} recent reviews added, ${formatPercent(getNumber(item.reviewPercentage))} review percentage, ${formatNumber(getNumber(item.ccuPeak))} peak CCU${supportReasons[0] ? `. ${supportReasons[0]}` : '.'}`
        );
        continue;
      }

      facts.push(
        `${name}: ${rankingLabel ?? 'Momentum'} over ${timeframeLabel ?? 'this window'} (${windowLabel}), ${supportLevel ?? 'n/a'} support, ${formatNumber(getNumber(item.ccuPeak))} peak CCU, ${formatNumber(reviewDelta)} recent reviews added${supportReasons[0] ? `. ${supportReasons[0]}` : '.'}`
      );
    }
  } else if (intent === 'news_search') {
    for (const item of getItemsFromResponse(response).slice(0, 3)) {
      const title = getString(item.title);
      const source = getString(item.feedLabel) ?? getString(item.feedScope);
      const publishedAt = formatDate(getString(item.publishedAt) ?? getString(item.sortTime));
      const rankingReason = getString(item.rankingReason);
      const excerpt = getString(item.excerpt) ?? getString(item.bodyPreview);
      if (title) {
        facts.push(
          `${publishedAt ?? 'Recent'}: ${title}${source ? ` (${source})` : ''}${rankingReason ? `, matched as ${rankingReason}` : ''}${excerpt && normalizeForLooseMatch(excerpt) !== normalizeForLooseMatch(title) ? `. ${excerpt}` : '.'}`
        );
      }
    }
  } else if (intent === 'change_explanation') {
    const summary = isRecord(response) && isRecord(response.summary) ? response.summary : null;
    if (summary) {
      facts.push(
        `${formatNumber(getNumber(summary.eventCount))} events across ${formatNumber(getNumber(summary.momentCount))} moments and ${formatNumber(getNumber(summary.newsCount))} linked news items.`
      );
      const strongestMomentStart = formatDate(getString(summary.strongestMomentStart));
      const strongestMomentStrength = getString(summary.strongestMomentStrength);
      const strongestMomentReasons = Array.isArray(summary.strongestMomentReasons)
        ? summary.strongestMomentReasons.map((item) => String(item))
        : [];
      if (strongestMomentStart) {
        facts.push(
          `Strongest moment: ${strongestMomentStart}${strongestMomentStrength ? ` (${strongestMomentStrength} signal)` : ''}${strongestMomentReasons[0] ? `. ${strongestMomentReasons[0]}` : '.'}`
        );
      }
    }
    const moments = isRecord(response) && Array.isArray(response.moments)
      ? response.moments.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
    for (const moment of moments.slice(0, 3)) {
      const date = formatDate(getString(moment.windowStart));
      const sources = Array.isArray(moment.sources) ? moment.sources.join(', ') : 'unknown sources';
      const changeTypes = Array.isArray(moment.changeTypes)
        ? moment.changeTypes.slice(0, 3).map((item) => String(item).replace(/_/g, ' ')).join(', ')
        : 'recent updates';
      const burstStrength = getString(moment.burstStrength);
      const linkedNewsCount = getNumber(moment.linkedNewsCount);
      const significanceReasons = Array.isArray(moment.significanceReasons)
        ? moment.significanceReasons.map((item) => String(item))
        : [];
      facts.push(
        `${date ?? 'Recent'}: ${formatNumber(getNumber(moment.eventCount))} events from ${sources}, mostly ${changeTypes}${burstStrength ? ` (${burstStrength} signal)` : ''}${linkedNewsCount ? ` with ${formatNumber(linkedNewsCount)} linked news item${linkedNewsCount === 1 ? '' : 's'}` : ''}${significanceReasons[0] ? `. ${significanceReasons[0]}` : '.'}`
      );
    }
  } else if (intent === 'change_discovery') {
    for (const item of getItemsFromResponse(response).slice(0, 3)) {
      const name = getString(item.name);
      const occurredAt = formatDate(getString(item.occurredAt));
      const evidence = isRecord(item.primaryProof)
        ? getString(item.primaryProof.headline) ?? getString(item.primaryProof.summary)
        : getString(item.summary);
      if (name) {
        facts.push(`${name}${occurredAt ? ` on ${occurredAt}` : ''}: ${evidence ?? 'recent activity detected'}.`);
      }
    }
  } else if (intent === 'semantic_search') {
    for (const item of getItemsFromResponse(response).slice(0, 3)) {
      const name = getString(item.name);
      const reasons = Array.isArray(item.matchReasons) ? item.matchReasons.join(', ') : null;
      if (name) {
        facts.push(`${name}: score ${formatNumber(getNumber(item.score))}${reasons ? `, matched for ${reasons}` : ''}.`);
      }
    }
  }

  return facts;
}

export function buildTigerClarificationBrief(params: {
  clarificationText?: string | null;
  intent: TigerAnswerIntent;
  selectionState: SessionChatSelectionState | null;
}): TigerAnswerBrief {
  const { clarificationText, intent, selectionState } = params;

  if (!selectionState || selectionState.slots.length === 0) {
    const directAnswer = clarificationText?.trim() || 'I found multiple likely matches. Which one did you want?';
    return {
      answerKind: 'clarification',
      directAnswer,
      evidenceMarkdown: null,
      fallbackMarkdown: directAnswer,
      followUpSuggestions: [],
      intent,
      keyFacts: [],
      selectionNote: null,
    };
  }

  if (selectionState.slots.length === 1) {
    const slot = selectionState.slots[0];
    const labels = slot.candidates
      .slice(0, 3)
      .map((candidate) => `${formatSelectionCandidateLabel(slot, candidate)} (${candidate.entityKind})`);

    const directAnswer = labels.length >= 2
      ? `I found a few likely matches for ${slot.query}. Did you mean ${labels.slice(0, -1).join(', ')}${labels.length > 2 ? ',' : ''} or ${labels[labels.length - 1]}?`
      : `I found a few likely matches for ${slot.query}. Which one did you mean?`;
    const fallbackMarkdown = [
      directAnswer,
      '',
      ...slot.candidates.slice(0, 4).map((candidate, index) => `${index + 1}. ${formatSelectionCandidateLabel(slot, candidate)} (${candidate.entityKind})`),
    ].join('\n');

    return {
      answerKind: 'clarification',
      directAnswer,
      evidenceMarkdown: null,
      fallbackMarkdown,
      followUpSuggestions: buildClarificationSuggestions(selectionState),
      intent,
      keyFacts: labels,
      selectionNote: null,
    };
  }

  const slotPrompts = selectionState.slots.map((slot) => {
    const topCandidates = slot.candidates
      .slice(0, 2)
      .map((candidate) => `${formatSelectionCandidateLabel(slot, candidate)} (${candidate.entityKind})`)
      .join(' or ');
    return `${slot.label}: ${topCandidates}`;
  });
  const directAnswer = `I found a few possible matches for this comparison. Which ones did you want?`;
  const fallbackMarkdown = [
    directAnswer,
    '',
    ...selectionState.slots.flatMap((slot) => [
      `For ${slot.label}:`,
      ...slot.candidates.slice(0, 4).map((candidate, index) => `${index + 1}. ${formatSelectionCandidateLabel(slot, candidate)} (${candidate.entityKind})`),
      '',
    ]),
  ].join('\n').trim();

  return {
    answerKind: 'clarification',
    directAnswer,
    evidenceMarkdown: null,
    fallbackMarkdown,
    followUpSuggestions: buildClarificationSuggestions(selectionState),
    intent,
    keyFacts: slotPrompts,
    selectionNote: null,
  };
}

export function buildTigerSuccessBrief(params: {
  fallbackMarkdown: string;
  intent: TigerAnswerIntent;
  response: unknown;
  selectionState: SessionChatSelectionState | null;
}): TigerAnswerBrief {
  const selectionNote = buildSelectionNote(params.selectionState);
  const evidenceMarkdown = extractEvidenceMarkdown(params.fallbackMarkdown);
  const followUpSuggestions = dedupeSuggestions([
    ...buildSelectionSwitchSuggestions(params.selectionState),
    ...buildIntentSuggestions({
      intent: params.intent,
      response: params.response,
    }),
  ]);
  const fallbackMarkdown = selectionNote
    ? `${params.fallbackMarkdown}\n\n${selectionNote}`
    : params.fallbackMarkdown;

  return {
    answerKind: 'success',
    directAnswer: buildDirectAnswer({
      intent: params.intent,
      response: params.response,
    }),
    evidenceMarkdown,
    fallbackMarkdown,
    followUpSuggestions,
    intent: params.intent,
    keyFacts: buildKeyFacts({
      intent: params.intent,
      response: params.response,
    }),
    selectionNote,
  };
}

export function renderTigerAnswerBrief(brief: TigerAnswerBrief): string {
  return brief.fallbackMarkdown.trim();
}

export function renderTigerNarratedAnswer(params: {
  brief: TigerAnswerBrief;
  narration: string;
}): string {
  const parts = [
    params.narration.trim(),
    params.brief.evidenceMarkdown?.trim() ?? null,
  ].filter((value): value is string => Boolean(value));

  return parts.join('\n\n').trim();
}
