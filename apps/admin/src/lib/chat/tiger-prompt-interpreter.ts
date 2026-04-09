import type { SessionChatContext, SessionSelectionEntityKind } from '@/lib/chat/chat-context-types';
import { buildSessionContextPrompt } from '@/lib/chat/session-context';
import type { Message } from '@/lib/llm/types';
import type {
  TigerShadowContractName,
  TigerShadowMatchedIntent,
} from '@/lib/chat/tiger-shadow-types';

export type TigerInterpretationConfidence = 'low' | 'medium' | 'high';

export interface TigerPromptEntityHint {
  kindHint?: SessionSelectionEntityKind | null;
  query: string;
  role: 'comparison' | 'primary' | 'reference' | 'scope';
}

export interface TigerPromptInterpretationFilters {
  genres?: string[];
  isFree?: boolean | null;
  maxPriceCents?: number | null;
  maxReviews?: number | null;
  minReviews?: number | null;
  platforms?: string[];
  releaseYear?: {
    gte?: number | null;
    lte?: number | null;
  } | null;
  relationKind?: 'dlc' | 'franchise_games' | null;
  steamDeck?: Array<'playable' | 'verified'>;
  tags?: string[];
}

export interface TigerPromptInterpretationTimeWindow {
  days?: number | null;
  endDate?: string | null;
  startDate?: string | null;
  timeframe?: '7d' | '30d' | 'current' | null;
}

export interface TigerPromptInterpretation {
  clarificationQuestion?: string | null;
  confidence: TigerInterpretationConfidence;
  continuationAction: 'broaden' | 'continue' | 'narrow' | 'none';
  contractCandidates: TigerShadowContractName[];
  entities: TigerPromptEntityHint[];
  filters?: TigerPromptInterpretationFilters | null;
  intent: TigerShadowMatchedIntent;
  timeWindow?: TigerPromptInterpretationTimeWindow | null;
}

const ALLOWED_INTENTS = new Set<TigerShadowMatchedIntent>([
  'catalog_search',
  'change_discovery',
  'change_explanation',
  'entity_compare',
  'entity_overview',
  'entity_ranking',
  'metric_history',
  'momentum_discovery',
  'news_search',
  'relation_lookup',
  'semantic_search',
  'user_context',
  null,
]);

const ALLOWED_CONTRACTS = new Set<TigerShadowContractName>([
  'compareEntities',
  'discoverChangePatterns',
  'discoverMomentum',
  'explainChanges',
  'getEntityOverview',
  'getRelatedEntities',
  'getUserContext',
  'rankEntities',
  'resolveEntities',
  'searchCatalog',
  'searchChangeActivity',
  'searchDocuments',
  'semanticSearch',
  'traceMetricHistory',
]);

const JSON_BLOCK_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === 'boolean' ? value : undefined;
}

function getNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return strings.length > 0 ? strings : undefined;
}

function getSteamDeckArray(value: unknown): Array<'playable' | 'verified'> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter(
    (item): item is 'playable' | 'verified' => item === 'playable' || item === 'verified'
  );

  return values.length > 0 ? values : undefined;
}

function getConfidence(value: unknown): TigerInterpretationConfidence | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

function getIntent(value: unknown): TigerShadowMatchedIntent | null {
  if (value === null) {
    return null;
  }

  return typeof value === 'string' && ALLOWED_INTENTS.has(value as TigerShadowMatchedIntent)
    ? value as TigerShadowMatchedIntent
    : null;
}

function extractJsonText(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(JSON_BLOCK_PATTERN);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return trimmed;
}

function normalizeEntityHints(value: unknown): TigerPromptEntityHint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const hints: TigerPromptEntityHint[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const query = getString(item.query);
    const role = item.role;
    const kindHint = item.kindHint;

    if (
      !query ||
      (role !== 'comparison' && role !== 'primary' && role !== 'reference' && role !== 'scope')
    ) {
      continue;
    }

    hints.push({
      kindHint:
        kindHint === 'game' || kindHint === 'publisher' || kindHint === 'developer'
          ? kindHint
          : null,
      query,
      role,
    });
  }

  return hints;
}

function normalizeFilters(value: unknown): TigerPromptInterpretationFilters | null {
  if (!isRecord(value)) {
    return null;
  }

  const releaseYear = isRecord(value.releaseYear)
    ? {
        gte: getNullableNumber(value.releaseYear.gte) ?? null,
        lte: getNullableNumber(value.releaseYear.lte) ?? null,
      }
    : null;

  const relationKind =
    value.relationKind === 'dlc' || value.relationKind === 'franchise_games'
      ? value.relationKind
      : null;

  return {
    genres: getStringArray(value.genres),
    isFree: getNullableBoolean(value.isFree),
    maxPriceCents: getNullableNumber(value.maxPriceCents),
    maxReviews: getNullableNumber(value.maxReviews),
    minReviews: getNullableNumber(value.minReviews),
    platforms: getStringArray(value.platforms),
    releaseYear:
      releaseYear && (releaseYear.gte != null || releaseYear.lte != null)
        ? releaseYear
        : null,
    relationKind,
    steamDeck: getSteamDeckArray(value.steamDeck),
    tags: getStringArray(value.tags),
  };
}

function normalizeTimeWindow(value: unknown): TigerPromptInterpretationTimeWindow | null {
  if (!isRecord(value)) {
    return null;
  }

  const timeframe =
    value.timeframe === '7d' || value.timeframe === '30d' || value.timeframe === 'current'
      ? value.timeframe
      : null;
  const days = getNullableNumber(value.days);
  const startDate = getString(value.startDate);
  const endDate = getString(value.endDate);

  if (timeframe == null && days == null && !startDate && !endDate) {
    return null;
  }

  return {
    days,
    endDate,
    startDate,
    timeframe,
  };
}

export function parseTigerPromptInterpretation(
  rawContent: string | null | undefined
): TigerPromptInterpretation | null {
  if (!rawContent) {
    return null;
  }

  try {
    const parsed = JSON.parse(extractJsonText(rawContent)) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const confidence = getConfidence(parsed.confidence);
    const continuationAction =
      parsed.continuationAction === 'broaden'
      || parsed.continuationAction === 'continue'
      || parsed.continuationAction === 'narrow'
      || parsed.continuationAction === 'none'
        ? parsed.continuationAction
        : 'none';
    const intent = getIntent(parsed.intent);
    const contractCandidates = Array.isArray(parsed.contractCandidates)
      ? parsed.contractCandidates.filter(
          (item): item is TigerShadowContractName =>
            typeof item === 'string' && ALLOWED_CONTRACTS.has(item as TigerShadowContractName)
        )
      : [];

    if (!confidence) {
      return null;
    }

    return {
      clarificationQuestion: getString(parsed.clarificationQuestion),
      confidence,
      continuationAction,
      contractCandidates,
      entities: normalizeEntityHints(parsed.entities),
      filters: normalizeFilters(parsed.filters),
      intent,
      timeWindow: normalizeTimeWindow(parsed.timeWindow),
    };
  } catch {
    return null;
  }
}

export function tigerInterpretationMeetsThreshold(
  interpretation: TigerPromptInterpretation | null | undefined,
  threshold: TigerInterpretationConfidence
): boolean {
  if (!interpretation) {
    return false;
  }

  const order: Record<TigerInterpretationConfidence, number> = {
    high: 3,
    low: 1,
    medium: 2,
  };

  return order[interpretation.confidence] >= order[threshold];
}

export function buildTigerPromptInterpreterMessages(params: {
  prompt: string;
  sessionContext: SessionChatContext | null;
}): Message[] {
  const sessionContextPrompt = buildSessionContextPrompt(params.sessionContext);

  return [
    {
      role: 'system',
      content: [
        'You map natural-language analytics chat prompts onto a fixed set of supported system intents.',
        'Return valid JSON only. Do not wrap in markdown fences.',
        'Do not invent facts, IDs, metrics, or dates. Only interpret the user request.',
        'Prefer the closest supported intent rather than null when the request is clearly about one supported task.',
        'If the user is vague, set a low confidence and include a short clarificationQuestion.',
        'Supported intents:',
        '- entity_overview: tell me about a game, publisher, or developer',
        '- news_search: recent announcements, latest news, recent updates',
        '- change_explanation: what changed recently for one game',
        '- change_discovery: cross-game change or marketing pattern discovery',
        '- catalog_search: structured game discovery with metadata filters',
        '- entity_ranking: top/best/most style ranking',
        '- entity_compare: A vs B comparisons',
        '- momentum_discovery: trending, breakout, accelerating, current-player prompts',
        '- metric_history: over-time metric trend for one game',
        '- relation_lookup: DLC or same-franchise lookups',
        '- semantic_search: games like X or concept/vibe search',
        '- user_context: my pins, my alerts, my portfolio',
        'Interpretation rules:',
        '- Single-entity current metric prompts map to entity_overview, not momentum_discovery.',
        '- Examples: "What\'s the CCU for Counter-Strike 2?", "How many players does Crimson Desert have?", "What\'s the price for Hades II?" => entity_overview.',
        '- Single-game over-time prompts map to metric_history.',
        '- Examples: "Show Counter-Strike 2 CCU over the last 30 days", "How have Hades II reviews changed over time?" => metric_history.',
        '- momentum_discovery is for cross-game discovery or ranking prompts such as "Which games have the most players right now?" or "What games are trending up?".',
        'Allowed contracts:',
        '- resolveEntities, getEntityOverview, getRelatedEntities, getUserContext',
        '- searchCatalog, discoverMomentum, rankEntities, compareEntities, traceMetricHistory',
        '- searchChangeActivity, discoverChangePatterns, explainChanges, searchDocuments, semanticSearch',
        'JSON schema:',
        '{',
        '  "intent": string|null,',
        '  "confidence": "low"|"medium"|"high",',
        '  "contractCandidates": string[],',
        '  "entities": [{"query": string, "role": "primary"|"reference"|"comparison"|"scope", "kindHint": "game"|"publisher"|"developer"|null}],',
        '  "filters": {',
        '    "genres"?: string[], "tags"?: string[], "platforms"?: string[],',
        '    "steamDeck"?: ["playable"|"verified"], "isFree"?: boolean|null,',
        '    "maxPriceCents"?: number|null, "minReviews"?: number|null, "maxReviews"?: number|null,',
        '    "releaseYear"?: {"gte"?: number|null, "lte"?: number|null},',
        '    "relationKind"?: "dlc"|"franchise_games"|null',
        '  },',
        '  "timeWindow": {"timeframe"?: "7d"|"30d"|"current"|null, "days"?: number|null, "startDate"?: string|null, "endDate"?: string|null},',
        '  "continuationAction": "none"|"continue"|"narrow"|"broaden",',
        '  "clarificationQuestion": string|null',
        '}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `User prompt:\n${params.prompt}`,
        sessionContextPrompt ? `\n${sessionContextPrompt}` : '',
      ].filter(Boolean).join('\n'),
    },
  ];
}
