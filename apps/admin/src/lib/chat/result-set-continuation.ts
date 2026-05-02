import type {
  SessionChatContext,
  SessionChatResultSet,
  SessionResultSetItemKind,
  ToolAnswerContractSummary,
} from '@/lib/chat/chat-context-types';

type ContinuableToolName =
  | 'discover_trending'
  | 'find_change_patterns'
  | 'query_change_activity'
  | 'screen_games'
  | 'search_games';

type ContinuationIntent =
  | 'continue'
  | 'continue_with_limit'
  | 'continue_with_constraint_delta'
  | 'not_continuation';

type ContinuableContractName = 'discoverMomentum' | 'searchCatalog' | 'semanticSearch';

interface ParsedContinuationDelta {
  maxPriceCents?: number;
  steamDeck?: Array<'verified' | 'playable'>;
  days?: number;
}

interface ContinuationCue {
  intent: Exclude<ContinuationIntent, 'not_continuation'>;
  requestedCount: number | null;
}

export interface ResultSetContinuationResolution {
  continuationToken?: string | null;
  intent: Exclude<ContinuationIntent, 'not_continuation'>;
  requestedCount: number;
  sourceContract?: ContinuableContractName;
  sourceTool: string;
  sourceArgs: Record<string, unknown>;
  excludedCount: number;
  resultSet: SessionChatResultSet;
}

interface TigerSearchCatalogResult {
  continuationToken: string | null;
  items?: Array<{
    appid: number;
    name?: string;
  }>;
}

interface TigerSemanticSearchResult {
  continuation_token?: string | null;
  results?: Array<{
    id: number;
    name?: string;
  }>;
}

interface TigerDiscoverMomentumResult {
  items?: Array<{
    appid: number;
    name?: string;
  }>;
}

export interface TigerContractContinuationResult {
  continuationToken: string | null;
  effectiveArgs: Record<string, unknown>;
  exhausted: boolean;
  result: TigerDiscoverMomentumResult | TigerSearchCatalogResult | TigerSemanticSearchResult;
  sourceContract: ContinuableContractName;
}

interface ContinuationAdapter {
  itemKind: SessionResultSetItemKind;
  excludeField: 'excludeAppIds' | 'excludeActivityIds';
  supportsDelta: {
    maxPriceCents?: boolean;
    steamDeck?: boolean;
    days?: boolean;
  };
}

const DEFAULT_CONTINUATION_COUNT = 5;
const MAX_CONTINUATION_COUNT = 20;
const MAX_TRACKED_SHOWN_IDS = 100;
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const CONTINUATION_ADAPTERS: Record<ContinuableToolName, ContinuationAdapter> = {
  discover_trending: {
    itemKind: 'games',
    excludeField: 'excludeAppIds',
    supportsDelta: {
      steamDeck: true,
    },
  },
  find_change_patterns: {
    itemKind: 'games',
    excludeField: 'excludeAppIds',
    supportsDelta: {
      days: true,
    },
  },
  query_change_activity: {
    itemKind: 'activities',
    excludeField: 'excludeActivityIds',
    supportsDelta: {
      days: true,
    },
  },
  screen_games: {
    itemKind: 'games',
    excludeField: 'excludeAppIds',
    supportsDelta: {
      steamDeck: true,
    },
  },
  search_games: {
    itemKind: 'games',
    excludeField: 'excludeAppIds',
    supportsDelta: {
      maxPriceCents: true,
      steamDeck: true,
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
}

function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[?.,!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPolitePrefixes(prompt: string): string {
  let next = prompt;
  const prefixes = [
    'can you ',
    'could you ',
    'would you ',
    'please ',
    'ok ',
    'okay ',
    'so ',
    'then ',
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (next.startsWith(prefix)) {
        next = next.slice(prefix.length).trim();
        changed = true;
      }
    }
  }

  return next.replace(/\s+please$/, '').trim();
}

function parseCountToken(token: string | undefined): number | null {
  if (!token) {
    return null;
  }

  if (/^\d+$/.test(token)) {
    return Number.parseInt(token, 10);
  }

  return NUMBER_WORDS[token] ?? null;
}

function parseContinuationDelta(prompt: string): {
  delta: ParsedContinuationDelta;
  remainingPrompt: string;
} {
  let remainingPrompt = prompt;
  const delta: ParsedContinuationDelta = {};

  const maxPriceMatch = /\b(?:under|below|less than|max(?:imum)? price(?: of)?)\s+\$?(\d{1,4})(?:\.\d{1,2})?\b/i.exec(remainingPrompt);
  if (maxPriceMatch) {
    delta.maxPriceCents = Math.round(Number.parseFloat(maxPriceMatch[1]) * 100);
    remainingPrompt = remainingPrompt.replace(maxPriceMatch[0], ' ');
  }

  if (/\b(?:steam deck verified|deck verified)\b/i.test(remainingPrompt)) {
    delta.steamDeck = ['verified'];
    remainingPrompt = remainingPrompt.replace(/\b(?:steam deck verified|deck verified)\b/gi, ' ');
  } else if (/\b(?:steam deck playable|deck playable)\b/i.test(remainingPrompt)) {
    delta.steamDeck = ['playable'];
    remainingPrompt = remainingPrompt.replace(/\b(?:steam deck playable|deck playable)\b/gi, ' ');
  }

  const dayMatch =
    /\b(?:in|over|within|for)\s+the\s+last\s+(\d{1,3})\s+days\b/i.exec(remainingPrompt) ??
    /\b(?:last|past)\s+(\d{1,3})\s+days\b/i.exec(remainingPrompt) ??
    /\bthis week\b/i.exec(remainingPrompt) ??
    /\bthis month\b/i.exec(remainingPrompt);

  if (dayMatch) {
    if (dayMatch[0].toLowerCase() === 'this week') {
      delta.days = 7;
    } else if (dayMatch[0].toLowerCase() === 'this month') {
      delta.days = 30;
    } else if (dayMatch[1]) {
      delta.days = Number.parseInt(dayMatch[1], 10);
    }
    remainingPrompt = remainingPrompt.replace(dayMatch[0], ' ');
  }

  remainingPrompt = remainingPrompt
    .replace(/\b(?:but|only|just|with|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { delta, remainingPrompt };
}

function parseContinuationCue(prompt: string, hasDelta: boolean): ContinuationCue | null {
  const exact = prompt.trim();

  const countMoreMatch =
    /^(?:what are|what about|show me|give me|list)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+more$/.exec(exact) ??
    /^(?:show me|give me|list)\s+another\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/.exec(exact) ??
    /^another\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/.exec(exact) ??
    /^next\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/.exec(exact);

  if (countMoreMatch) {
    const parsedCount = parseCountToken(countMoreMatch[1]);
    if (parsedCount) {
      return {
        intent: hasDelta ? 'continue_with_constraint_delta' : 'continue_with_limit',
        requestedCount: parsedCount,
      };
    }
  }

  if (
    /^(?:more|show more|show me more|give me more|what else|anything else|more of those|show me the rest|the rest|more results|keep going|continue|next|next page)$/.test(
      exact
    )
  ) {
    return {
      intent: hasDelta ? 'continue_with_constraint_delta' : 'continue',
      requestedCount: null,
    };
  }

  if (hasDelta && /^(?:same|same thing|same query|same list|same results)$/.test(exact)) {
    return {
      intent: 'continue_with_constraint_delta',
      requestedCount: null,
    };
  }

  return null;
}

function hasUnsupportedModifier(prompt: string): boolean {
  if (prompt.length === 0) {
    return false;
  }

  return !/^(?:more|show more|show me more|give me more|show me the rest|the rest|more results|what else|anything else|keep going|continue|next|next page|more of those|same|same thing|same query|same list|same results|show me|give me|list|what are|what about|another|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\s)+$/.test(
    prompt
  );
}

function uniqueIds(ids: Array<number | string>): Array<number | string> {
  return Array.from(new Set(ids));
}

function toContinuableContractName(value: string | undefined): ContinuableContractName | null {
  return value === 'discoverMomentum' || value === 'searchCatalog' || value === 'semanticSearch'
    ? value
    : null;
}

function toContinuableToolName(value: string): ContinuableToolName | null {
  return value in CONTINUATION_ADAPTERS ? (value as ContinuableToolName) : null;
}

function sanitizeSourceArgs(toolName: ContinuableToolName, args: Record<string, unknown>): Record<string, unknown> {
  const nextArgs = cloneArgs(args);
  delete nextArgs.excludeAppIds;
  delete nextArgs.excludeActivityIds;

  if (toolName === 'query_change_activity') {
    delete nextArgs.cursor;
  }

  return nextArgs;
}

function sanitizeContractSourceArgs(args: Record<string, unknown>): Record<string, unknown> {
  const nextArgs = cloneArgs(args);
  delete nextArgs.limit;
  delete nextArgs.continuationToken;
  delete nextArgs.excludeAppIds;
  return nextArgs;
}

function mergeUniqueStrings(
  current: unknown,
  additions: string[]
): string[] {
  const merged = new Set<string>();
  if (Array.isArray(current)) {
    current
      .filter((entry): entry is string => typeof entry === 'string')
      .forEach((entry) => merged.add(entry));
  }
  additions.forEach((entry) => merged.add(entry));
  return [...merged];
}

function applyDeltaToArgs(
  toolName: ContinuableToolName,
  sourceArgs: Record<string, unknown>,
  delta: ParsedContinuationDelta,
  resultSet: SessionChatResultSet
): Record<string, unknown> | null {
  const adapter = CONTINUATION_ADAPTERS[toolName];
  const nextArgs = cloneArgs(sourceArgs);

  if (delta.maxPriceCents != null) {
    if (!adapter.supportsDelta.maxPriceCents) {
      return null;
    }

    if (toolName !== 'search_games') {
      return null;
    }

    nextArgs.max_price_cents = delta.maxPriceCents;
  }

  if (delta.steamDeck?.length) {
    if (!adapter.supportsDelta.steamDeck) {
      return null;
    }

    if (toolName === 'search_games') {
      nextArgs.steam_deck = mergeUniqueStrings(nextArgs.steam_deck, delta.steamDeck);
    } else {
      const filters = isRecord(nextArgs.filters) ? { ...nextArgs.filters } : {};
      filters.steam_deck = mergeUniqueStrings(filters.steam_deck, delta.steamDeck);
      nextArgs.filters = filters;
    }
  }

  if (delta.days != null) {
    if (!adapter.supportsDelta.days) {
      return null;
    }

    const currentDays = getNumber(sourceArgs.days);
    if (currentDays != null && delta.days >= currentDays) {
      return null;
    }

    nextArgs.days = delta.days;
  }

  if (resultSet.itemKind === 'games') {
    nextArgs[adapter.excludeField] = resultSet.shownIds.filter(
      (value): value is number => typeof value === 'number'
    );
  } else {
    nextArgs[adapter.excludeField] = resultSet.shownIds.filter(
      (value): value is string => typeof value === 'string'
    );
  }

  return nextArgs;
}

function inferFamily(toolName: ContinuableToolName, contract: ToolAnswerContractSummary | null): string {
  if (contract?.family) {
    return contract.family;
  }

  if (toolName === 'query_change_activity' || toolName === 'find_change_patterns') {
    return 'change_intel';
  }

  if (toolName === 'discover_trending') {
    return 'trending';
  }

  return 'discovery';
}

function extractRowIds(
  toolName: ContinuableToolName,
  result: Record<string, unknown>
): Array<number | string> {
  const rows = Array.isArray(result.results)
    ? result.results
    : Array.isArray(result.events)
      ? result.events
      : [];

  if (toolName === 'query_change_activity') {
    return rows
      .filter((row): row is Record<string, unknown> => isRecord(row))
      .map((row) => getString(row.activityId))
      .filter((value): value is string => Boolean(value));
  }

  return rows
    .filter((row): row is Record<string, unknown> => isRecord(row))
    .map((row) => getNumber(row.appid))
    .filter((value): value is number => value != null);
}

function parseStoredResultSet(value: unknown): SessionChatResultSet | null {
  if (!isRecord(value)) {
    return null;
  }

  const family = getString(value.family);
  const sourceTool = getString(value.sourceTool);
  const sourceContract = toContinuableContractName(getString(value.sourceContract) ?? undefined);
  const itemKind = getString(value.itemKind);
  const updatedAt = getString(value.updatedAt);

  if (!family || !sourceTool || !updatedAt) {
    return null;
  }

  if (itemKind !== 'games' && itemKind !== 'activities') {
    return null;
  }

  const sourceArgs = isRecord(value.sourceArgs) ? value.sourceArgs : {};
  const shownIds = Array.isArray(value.shownIds)
    ? value.shownIds.filter(
        (entry): entry is number | string => typeof entry === 'number' || typeof entry === 'string'
      )
    : [];

  return {
    family,
    continuationToken: getString(value.continuationToken) ?? null,
    sourceContract: sourceContract ?? undefined,
    sourceTool,
    itemKind,
    sourceArgs,
    shownIds,
    lastPageSize: getNumber(value.lastPageSize) ?? shownIds.length,
    totalFound: getNumber(value.totalFound),
    continuable: value.continuable !== false,
    updatedAt,
  };
}

export function buildResultSetFromToolExecution(params: {
  toolName: string;
  toolArguments: Record<string, unknown>;
  result: Record<string, unknown>;
  terminalContract?: ToolAnswerContractSummary | null;
  timestamp?: string;
}): SessionChatResultSet | null {
  const { toolName, toolArguments, result, terminalContract, timestamp = new Date().toISOString() } = params;

  const continuationMeta = isRecord(result.continuation_meta) ? result.continuation_meta : null;
  if (continuationMeta?.resultSet) {
    return parseStoredResultSet(continuationMeta.resultSet);
  }

  const continuableToolName = toContinuableToolName(toolName);
  if (!continuableToolName || result.success !== true) {
    return null;
  }

  const rowIds = extractRowIds(continuableToolName, result);
  if (rowIds.length === 0) {
    return null;
  }

  const adapter = CONTINUATION_ADAPTERS[continuableToolName];
  return {
    family: inferFamily(continuableToolName, terminalContract ?? null),
    sourceTool: continuableToolName,
    itemKind: adapter.itemKind,
    sourceArgs: sanitizeSourceArgs(continuableToolName, toolArguments),
    shownIds: uniqueIds(rowIds).slice(0, MAX_TRACKED_SHOWN_IDS),
    lastPageSize: rowIds.length,
    totalFound: getNumber(result.total_found),
    continuable: true,
    updatedAt: timestamp,
  };
}

function buildTigerResultSet(params: {
  family: string;
  sourceArgs: Record<string, unknown>;
  sourceContract: ContinuableContractName;
  sourceTool?: string;
  result: TigerDiscoverMomentumResult | TigerSearchCatalogResult | TigerSemanticSearchResult;
  timestamp?: string;
}): SessionChatResultSet | null {
  const { family, result, sourceArgs, sourceContract, sourceTool = sourceContract, timestamp = new Date().toISOString() } = params;
  const shownIds =
    sourceContract === 'discoverMomentum'
      ? ((result as TigerDiscoverMomentumResult).items ?? [])
          .map((item) => item.appid)
          .filter((appid): appid is number => Number.isFinite(appid))
      : sourceContract === 'searchCatalog'
      ? ((result as TigerSearchCatalogResult).items ?? [])
          .map((item) => item.appid)
          .filter((appid): appid is number => Number.isFinite(appid))
      : ((result as TigerSemanticSearchResult).results ?? [])
          .map((item) => item.id)
          .filter((id): id is number => Number.isFinite(id));

  if (shownIds.length === 0) {
    return null;
  }

  return {
    family,
    continuationToken:
      sourceContract === 'searchCatalog'
        ? (result as TigerSearchCatalogResult).continuationToken
        : (result as TigerSemanticSearchResult).continuation_token ?? null,
    sourceContract,
    sourceTool,
    itemKind: 'games',
    sourceArgs: sanitizeContractSourceArgs(sourceArgs),
    shownIds: uniqueIds(shownIds).slice(0, MAX_TRACKED_SHOWN_IDS),
    lastPageSize: shownIds.length,
    totalFound: null,
    continuable:
      sourceContract === 'discoverMomentum'
        ? shownIds.length > 0
        : sourceContract === 'searchCatalog'
        ? (result as TigerSearchCatalogResult).continuationToken != null
        : ((result as TigerSemanticSearchResult).continuation_token ?? null) != null,
    updatedAt: timestamp,
  };
}

export function buildTigerPrimaryResultSet(params: {
  family: string;
  sourceArgs: Record<string, unknown>;
  sourceContract: ContinuableContractName;
  sourceTool?: string;
  result: TigerDiscoverMomentumResult | TigerSearchCatalogResult | TigerSemanticSearchResult;
  timestamp?: string;
}): SessionChatResultSet | null {
  return buildTigerResultSet(params);
}

export function resolveResultSetContinuation(
  userMessage: string,
  context: SessionChatContext | null | undefined
): ResultSetContinuationResolution | null {
  const resultSet = context?.resultSet;
  if (!resultSet?.continuable) {
    return null;
  }

  const strippedPrompt = stripPolitePrefixes(normalizePrompt(userMessage));
  const { delta, remainingPrompt } = parseContinuationDelta(strippedPrompt);
  const hasDelta =
    delta.maxPriceCents != null ||
    Boolean(delta.steamDeck?.length) ||
    delta.days != null;
  const cue = parseContinuationCue(remainingPrompt, hasDelta);

  if (!cue || hasUnsupportedModifier(remainingPrompt)) {
    return null;
  }

  const requestedCount = Math.min(
    Math.max(
      cue.requestedCount ??
        (resultSet.lastPageSize > 0 ? resultSet.lastPageSize : DEFAULT_CONTINUATION_COUNT),
      1
    ),
    MAX_CONTINUATION_COUNT
  );

  if (resultSet.sourceContract) {
    if (resultSet.itemKind !== 'games') {
      return null;
    }

    if (
      resultSet.sourceContract === 'searchCatalog' &&
      (delta.maxPriceCents != null || Boolean(delta.steamDeck?.length) || delta.days != null)
    ) {
      return null;
    }

    if (
      (resultSet.sourceContract === 'semanticSearch' ||
        resultSet.sourceContract === 'discoverMomentum') &&
      delta.days != null
    ) {
      return null;
    }

    return {
      continuationToken: resultSet.continuationToken ?? null,
      intent: cue.intent,
      requestedCount,
      sourceContract: resultSet.sourceContract,
      sourceTool: resultSet.sourceTool,
      sourceArgs: applyContractDeltaToArgs(
        resultSet.sourceContract,
        resultSet.sourceArgs,
        delta,
        resultSet
      ),
      excludedCount: resultSet.shownIds.length,
      resultSet,
    };
  }

  const toolName = toContinuableToolName(resultSet.sourceTool);
  if (!toolName) {
    return null;
  }
  const sourceArgs = applyDeltaToArgs(toolName, resultSet.sourceArgs, delta, resultSet);
  if (!sourceArgs) {
    return null;
  }

  sourceArgs.limit = requestedCount;

  return {
    intent: cue.intent,
    requestedCount,
    sourceTool: toolName,
    sourceArgs,
    excludedCount: resultSet.shownIds.length,
    resultSet,
  };
}

function applyContractDeltaToArgs(
  sourceContract: ContinuableContractName,
  sourceArgs: Record<string, unknown>,
  delta: ParsedContinuationDelta,
  resultSet: SessionChatResultSet
): Record<string, unknown> {
  const nextArgs = sanitizeContractSourceArgs(sourceArgs);

  if (sourceContract === 'discoverMomentum') {
    const filters = isRecord(nextArgs.filters) ? { ...nextArgs.filters } : {};

    if (delta.maxPriceCents != null) {
      const currentMaxPrice = getNumber(filters.maxPriceCents);
      filters.maxPriceCents =
        currentMaxPrice == null
          ? delta.maxPriceCents
          : Math.min(currentMaxPrice, delta.maxPriceCents);
    }

    if (delta.steamDeck?.length) {
      filters.steamDeck = [...new Set(delta.steamDeck)];
    }

    if (Object.keys(filters).length > 0) {
      nextArgs.filters = filters;
    } else {
      delete nextArgs.filters;
    }
    nextArgs.excludeAppIds = resultSet.shownIds.filter(
      (value): value is number => typeof value === 'number'
    );
    return nextArgs;
  }

  if (sourceContract !== 'semanticSearch') {
    return nextArgs;
  }

  const filters = isRecord(nextArgs.filters) ? { ...nextArgs.filters } : {};
  if (delta.maxPriceCents != null) {
    const currentMaxPrice = getNumber(filters.max_price_cents);
    filters.max_price_cents =
      currentMaxPrice == null
        ? delta.maxPriceCents
        : Math.min(currentMaxPrice, delta.maxPriceCents);
  }

  if (delta.steamDeck?.length) {
    filters.steam_deck = [...new Set(delta.steamDeck)];
  }

  nextArgs.filters = filters;
  return nextArgs;
}

export function buildContinuationResultSet(params: {
  resolution: ResultSetContinuationResolution;
  result: Record<string, unknown>;
  terminalContract?: ToolAnswerContractSummary | null;
  timestamp?: string;
}): {
  resultSet: SessionChatResultSet;
  returnedIds: Array<number | string>;
  exhausted: boolean;
} {
  const {
    resolution,
    result,
    terminalContract,
    timestamp = new Date().toISOString(),
  } = params;
  const sourceTool = resolution.sourceTool as ContinuableToolName;

  const rowIds = extractRowIds(sourceTool, result);
  const returnedIds = rowIds.filter((id) => !resolution.resultSet.shownIds.includes(id));
  const nextShownIds = uniqueIds([...resolution.resultSet.shownIds, ...returnedIds]).slice(
    0,
    MAX_TRACKED_SHOWN_IDS
  );
  const totalFound =
    Math.max(
      resolution.resultSet.totalFound ?? 0,
      nextShownIds.length,
      getNumber(result.total_found) ?? 0
    ) || null;

  return {
    resultSet: {
      family: terminalContract?.family ?? resolution.resultSet.family,
      sourceTool,
      itemKind: resolution.resultSet.itemKind,
      sourceArgs: sanitizeSourceArgs(sourceTool, resolution.sourceArgs),
      shownIds: nextShownIds,
      lastPageSize: returnedIds.length,
      totalFound,
      continuable: true,
      updatedAt: timestamp,
    },
    returnedIds,
    exhausted: returnedIds.length === 0,
  };
}

export function buildTigerContinuationResultSet(params: {
  resolution: ResultSetContinuationResolution;
  response: TigerContractContinuationResult;
  timestamp?: string;
}): {
  resultSet: SessionChatResultSet;
  returnedIds: Array<number | string>;
  exhausted: boolean;
} {
  const {
    resolution,
    response,
    timestamp = new Date().toISOString(),
  } = params;

  const nextPageResultSet = buildTigerResultSet({
    family: resolution.resultSet.family,
    result: response.result,
    sourceArgs: response.effectiveArgs,
    sourceContract: response.sourceContract,
    sourceTool: response.sourceContract,
    timestamp,
  });

  const returnedIds = nextPageResultSet?.shownIds ?? [];
  const nextShownIds = uniqueIds([
    ...resolution.resultSet.shownIds,
    ...returnedIds,
  ]).slice(0, MAX_TRACKED_SHOWN_IDS);

  return {
    resultSet: {
      family: resolution.resultSet.family,
      continuationToken: response.continuationToken,
      sourceContract: response.sourceContract,
      sourceTool: resolution.resultSet.sourceTool,
      itemKind: 'games',
      sourceArgs: sanitizeContractSourceArgs(response.effectiveArgs),
      shownIds: nextShownIds,
      lastPageSize: returnedIds.length,
      totalFound: null,
      continuable: !response.exhausted,
      updatedAt: timestamp,
    },
    returnedIds,
    exhausted: response.exhausted || returnedIds.length === 0,
  };
}

export function attachContinuationMeta(
  result: Record<string, unknown>,
  params: {
    resultSet: SessionChatResultSet;
    intent: ResultSetContinuationResolution['intent'];
    requestedCount: number;
    excludedCount: number;
    exhausted: boolean;
  }
): Record<string, unknown> {
  return {
    ...result,
    continuation_meta: {
      intent: params.intent,
      requestedCount: params.requestedCount,
      excludedCount: params.excludedCount,
      exhausted: params.exhausted,
      resultSet: params.resultSet,
    },
  };
}

export function buildContinuationExhaustedResult(params: {
  resultSet: SessionChatResultSet;
  requestedCount: number;
  terminalContract?: ToolAnswerContractSummary | null;
}): Record<string, unknown> {
  const family = params.terminalContract?.family ?? params.resultSet.family;
  const noun = params.resultSet.itemKind === 'activities' ? 'activity results' : 'results';

  return attachContinuationMeta(
    {
      success: true,
      results: [],
      total_found: params.resultSet.totalFound ?? params.resultSet.shownIds.length,
      no_match: true,
      sufficient_to_answer: true,
      sufficiency_reason: `No additional matching ${noun} remain after excluding the rows already shown.`,
      required_answer_fields: ['that no additional matching rows remain', 'that prior rows were excluded'],
      response_guidance:
        'Say there are no more matching results beyond the rows already shown. Do not repeat earlier rows.',
      continuation_exhausted: true,
      continuation_family: family,
    },
    {
      resultSet: {
        ...params.resultSet,
        lastPageSize: 0,
        updatedAt: new Date().toISOString(),
      },
      intent: 'continue',
      requestedCount: params.requestedCount,
      excludedCount: params.resultSet.shownIds.length,
      exhausted: true,
    }
  );
}
