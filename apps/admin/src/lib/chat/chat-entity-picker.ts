import type { QuerySuggestion } from '@/lib/chat/query-templates';

export type ChatEntityKind = 'game' | 'publisher' | 'developer';
export type ChatEntityPlatform = 'steam' | 'publisheriq';
export type ChatEntityMatchQuality = 'exact' | 'prefix' | 'substring' | 'fuzzy';

export interface ChatEntityLatestMetrics {
  ccuPeak: number | null;
  ownersMidpoint: number | null;
  reviewScore: number | null;
  totalReviews: number | null;
}

export interface ChatEntitySignals {
  gameCount?: number | null;
}

export interface ChatEntityPickerEntity {
  confidence: number;
  displayName: string;
  entityKind: ChatEntityKind;
  entityUid: string;
  latestMetrics?: ChatEntityLatestMetrics;
  matchQuality: ChatEntityMatchQuality;
  matchedName: string;
  platform: ChatEntityPlatform;
  platformEntityId: string;
  releaseYear?: number | null;
  signals?: ChatEntitySignals;
}

export interface ChatEntityPickerAmbiguity {
  candidateNames: string[];
  message: string | null;
  requiresClarification: boolean;
}

export interface ChatEntityPickerProvenance {
  capturedAt: string;
  source: string;
  tables: string[];
}

export interface ChatEntityPickerResults {
  ambiguity: ChatEntityPickerAmbiguity;
  entities: ChatEntityPickerEntity[];
  provenance: ChatEntityPickerProvenance;
}

export interface ChatEntityPickerRequest {
  entityKinds?: ChatEntityKind[];
  includeMetrics?: boolean;
  limit?: number;
  query: string;
}

export interface ChatEntityPickerResponse {
  error?: string;
  query: string;
  results: ChatEntityPickerResults;
  success: boolean;
  timing?: {
    total_ms: number;
  };
}

export interface ChatEntityBinding {
  entity: ChatEntityPickerEntity;
  prompt: string;
  sourceQuery: string;
}

export interface ChatEntitySuggestion {
  category: 'template' | 'tag' | 'game' | 'publisher' | 'developer' | 'example' | 'entity';
  description?: string;
  entity?: ChatEntityPickerEntity;
  label: string;
  query: string;
}

const ENTITY_SEARCH_PATTERNS = [
  /(?:tell me about|what can you tell me about|what do you know about|give me an overview of|overview of)\s+(.+?)(?:[?!.]|$)/i,
  /\bhow many\s+(?:players?|owners?|reviews?)\s+does\s+(.+?)\s+have\b/i,
  /\bwhat(?:'s| is)\s+(?:the\s+)?(?:review score|price|discount|ccu|owners?|player count|total reviews?)\s+for\s+(.+?)(?:[?!.]|$)/i,
  /\bshow\s+(.+?)\s+(?:ccu|owners?|reviews?|review score|sentiment|price|discount|playtime)\b/i,
  /\b(?:about|for|on|of)\s+(.+?)(?:\s+(?:this|last|over|in|during|from|while|since|with)\b|[?!.]|$)/i,
];

const ENTITY_QUALITY_ORDER: Record<ChatEntityMatchQuality, number> = {
  exact: 0,
  prefix: 1,
  substring: 2,
  fuzzy: 3,
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeEntityQuery(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasAnyKeyword(normalizedText: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalizedText.includes(keyword));
}

function formatCount(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return new Intl.NumberFormat('en-US').format(value);
}

export function buildChatEntitySuggestionDescription(entity: ChatEntityPickerEntity): string {
  const parts: string[] = [entity.entityKind];
  parts.push(`${entity.matchQuality} match`);

  if (entity.entityKind === 'game' && typeof entity.releaseYear === 'number') {
    parts.push(String(entity.releaseYear));
  }

  if (entity.entityKind !== 'game') {
    const gameCount = formatCount(entity.signals?.gameCount);
    if (gameCount) {
      parts.push(`${gameCount} games`);
    }
  }

  if (entity.matchedName && normalizeText(entity.matchedName) !== normalizeText(entity.displayName)) {
    parts.push(`matched as ${entity.matchedName}`);
  }

  return parts.join(' · ');
}

export function extractEntitySearchQuery(input: string): string {
  const trimmedInput = normalizeEntityQuery(input);
  if (!trimmedInput) {
    return '';
  }

  for (const pattern of ENTITY_SEARCH_PATTERNS) {
    const match = trimmedInput.match(pattern);
    const candidate = normalizeEntityQuery(match?.[1] ?? null);
    if (candidate) {
      return candidate;
    }
  }

  return trimmedInput;
}

export function replaceEntitySearchQuery(
  input: string,
  searchQuery: string,
  displayName: string
): string {
  const trimmedInput = input.trim();
  const normalizedSearchQuery = normalizeEntityQuery(searchQuery);
  if (!trimmedInput || !normalizedSearchQuery) {
    return displayName;
  }

  const pattern = new RegExp(escapeRegExp(normalizedSearchQuery), 'i');
  if (!pattern.test(trimmedInput)) {
    return displayName;
  }

  return trimmedInput.replace(pattern, displayName);
}

export function buildEntitySelectionPrompt(
  entity: ChatEntityPickerEntity,
  currentInput: string
): string {
  const normalizedInput = normalizeText(currentInput);
  const displayName = entity.displayName;

  if (entity.entityKind === 'game') {
    if (
      hasAnyKeyword(normalizedInput, [
        'history',
        'over time',
        'trend',
        'trends',
        'timeline',
        'recent',
        'last ',
        'week',
        'month',
        'days',
      ])
    ) {
      return `Show ${displayName} CCU over time`;
    }

    if (
      hasAnyKeyword(normalizedInput, [
        'about',
        'overview',
        'tell me',
        'what do you know',
        'who is',
      ])
    ) {
      return `Tell me about ${displayName}`;
    }

    return `What's the CCU for ${displayName}?`;
  }

  if (entity.entityKind === 'publisher') {
    if (hasAnyKeyword(normalizedInput, ['top', 'best', 'games', 'published'])) {
      return `Top games from ${displayName}`;
    }

    if (hasAnyKeyword(normalizedInput, ['how many', 'count', 'published'])) {
      return `How many games has ${displayName} published?`;
    }

    return `Tell me about ${displayName}`;
  }

  if (hasAnyKeyword(normalizedInput, ['top', 'best', 'games', 'developed'])) {
    return `Top games from ${displayName}`;
  }

  if (hasAnyKeyword(normalizedInput, ['how many', 'count', 'developed', 'published'])) {
    return `How many games has ${displayName} developed?`;
  }

  return `Tell me about ${displayName}`;
}

export function buildEntityQuickPrompts(entity: ChatEntityPickerEntity): QuerySuggestion[] {
  const name = entity.displayName;

  if (entity.entityKind === 'game') {
    return [
      {
        label: `What's the CCU for ${name}?`,
        query: `What's the CCU for ${name}?`,
        category: 'game',
      },
      {
        label: `Show ${name} CCU over time`,
        query: `Show ${name} CCU over time`,
        category: 'game',
      },
      {
        label: `Tell me about ${name}`,
        query: `Tell me about ${name}`,
        category: 'game',
      },
    ];
  }

  if (entity.entityKind === 'publisher') {
    return [
      {
        label: `How many games has ${name} published?`,
        query: `How many games has ${name} published?`,
        category: 'publisher',
      },
      {
        label: `Top games from ${name}`,
        query: `Top games from ${name}`,
        category: 'publisher',
      },
      {
        label: `Tell me about ${name}`,
        query: `Tell me about ${name}`,
        category: 'publisher',
      },
    ];
  }

  return [
    {
      label: `How many games has ${name} developed?`,
      query: `How many games has ${name} developed?`,
      category: 'developer',
    },
    {
      label: `Top games from ${name}`,
      query: `Top games from ${name}`,
      category: 'developer',
    },
    {
      label: `Tell me about ${name}`,
      query: `Tell me about ${name}`,
      category: 'developer',
    },
  ];
}

export function buildEntityAutocompleteSuggestions(
  entities: ChatEntityPickerEntity[],
  currentInput: string
): ChatEntitySuggestion[] {
  return [...entities]
    .sort((left, right) => {
      const qualityDiff =
        ENTITY_QUALITY_ORDER[left.matchQuality] - ENTITY_QUALITY_ORDER[right.matchQuality];
      if (qualityDiff !== 0) {
        return qualityDiff;
      }

      return right.confidence - left.confidence;
    })
    .map((entity) => ({
      label: entity.displayName,
      query: buildEntitySelectionPrompt(entity, currentInput),
      category: 'entity',
      description: buildChatEntitySuggestionDescription(entity),
      entity,
    }));
}

export function buildSelectedEntityBinding(
  entity: ChatEntityPickerEntity,
  currentInput: string
): ChatEntityBinding {
  return {
    entity,
    prompt: buildEntitySelectionPrompt(entity, currentInput),
    sourceQuery: currentInput.trim(),
  };
}

export function isSelectedEntityPrompt(
  binding: ChatEntityBinding | null,
  input: string
): boolean {
  if (!binding) {
    return false;
  }

  const normalizedInput = normalizeText(input);
  const normalizedPrompt = normalizeText(binding.prompt);
  const normalizedDisplayName = normalizeText(binding.entity.displayName);
  const normalizedMatchedName = normalizeText(binding.entity.matchedName);

  return (
    normalizedInput === normalizedPrompt ||
    normalizedInput.includes(normalizedDisplayName) ||
    normalizedInput.includes(normalizedMatchedName)
  );
}
