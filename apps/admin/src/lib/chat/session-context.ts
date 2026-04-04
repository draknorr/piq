import type { ChatToolCall } from '@/lib/llm/types';
import type {
  SessionChatCandidateSet,
  SessionChatConstraint,
  SessionChatContext,
  SessionChatEntity,
  SessionChatLastAnswer,
  SessionChatResultSet,
  SessionChatSelectionState,
  ToolAnswerContractSummary,
} from '@/lib/chat/chat-context-types';
import { buildChatEntityUid } from '@/lib/chat/entity-uid';
import { buildResultSetFromToolExecution } from '@/lib/chat/result-set-continuation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseNumericId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function pushUniqueEntity(entities: SessionChatEntity[], candidate: SessionChatEntity): void {
  if (
    entities.some(
      (entity) =>
        entity.kind === candidate.kind &&
        entity.id === candidate.id &&
        entity.name.toLowerCase() === candidate.name.toLowerCase()
    )
  ) {
    return;
  }

  entities.push(candidate);
}

function pushUniqueConstraint(constraints: SessionChatConstraint[], candidate: SessionChatConstraint): void {
  if (
    constraints.some(
      (constraint) =>
        constraint.key === candidate.key &&
        constraint.value === candidate.value &&
        constraint.sourceTool === candidate.sourceTool
    )
  ) {
    return;
  }

  constraints.push(candidate);
}

function formatValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    const serialized = value
      .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
      .map((item) => String(item));
    return serialized.length > 0 ? serialized.join(', ') : null;
  }

  if (isRecord(value)) {
    const parts = Object.entries(value)
      .filter(([, nestedValue]) => typeof nestedValue === 'number' || typeof nestedValue === 'string')
      .map(([key, nestedValue]) => `${key}:${nestedValue}`);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  return null;
}

function extractConstraintsFromFilters(
  filters: unknown,
  sourceTool: string,
  constraints: SessionChatConstraint[]
): void {
  if (!Array.isArray(filters)) {
    return;
  }

  for (const filter of filters) {
    if (!isRecord(filter)) {
      continue;
    }

    const member = getString(filter.member);
    const operator = getString(filter.operator);
    const values = formatValue(filter.values);

    if (!member || !operator) {
      continue;
    }

    pushUniqueConstraint(constraints, {
      key: member,
      label: member,
      value: values ? `${operator} ${values}` : operator,
      sourceTool,
    });
  }
}

function extractConstraintsFromObject(
  value: Record<string, unknown>,
  sourceTool: string,
  constraints: SessionChatConstraint[],
  prefix = ''
): void {
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue == null) {
      continue;
    }

    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (isRecord(nestedValue)) {
      extractConstraintsFromObject(nestedValue, sourceTool, constraints, nextKey);
      continue;
    }

    const formatted = formatValue(nestedValue);
    if (!formatted) {
      continue;
    }

    pushUniqueConstraint(constraints, {
      key: nextKey,
      label: nextKey,
      value: formatted,
      sourceTool,
    });
  }
}

function extractEntityFromLookupResult(
  result: Record<string, unknown>,
  toolName: string,
  entities: SessionChatEntity[]
): void {
  const canonicalResult = isRecord(result.canonicalResult) ? result.canonicalResult : null;
  if (!canonicalResult) {
    return;
  }

  const entityType = getString(result.entityType);
  const entityName = getString(canonicalResult.name);
  const entityId = getNumber(canonicalResult.id);

  if (!entityType || !entityName) {
    return;
  }

  pushUniqueEntity(entities, {
    kind: entityType as SessionChatEntity['kind'],
    id: entityId,
    name: entityName,
    confidence: 'high',
    sourceTool: toolName,
  });
}

function extractEntityFromApp(
  app: unknown,
  toolName: string,
  entities: SessionChatEntity[]
): void {
  if (!isRecord(app)) {
    return;
  }

  const appid = getNumber(app.appid);
  const name = getString(app.name);

  if (!appid || !name) {
    return;
  }

  pushUniqueEntity(entities, {
    kind: 'game',
    id: appid,
    name,
    confidence: 'high',
    sourceTool: toolName,
  });
}

function buildCandidateSet(
  toolName: string,
  result: Record<string, unknown>,
  contract: ToolAnswerContractSummary | null
): SessionChatCandidateSet | null {
  const dataRows = Array.isArray(result.data) ? result.data : [];
  const resultRows = Array.isArray(result.results) ? result.results : [];
  const eventRows = Array.isArray(result.events) ? result.events : [];
  const itemRows = Array.isArray(result.items) ? result.items : [];
  const rows =
    dataRows.length > 0
      ? dataRows
      : resultRows.length > 0
        ? resultRows
        : eventRows.length > 0
          ? eventRows
          : itemRows;

  if (rows.length === 0) {
    return null;
  }

  const names: string[] = [];
  const ids: Array<number | string> = [];
  const entityUids: string[] = [];
  let kind: SessionChatCandidateSet['kind'] = 'games';

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    const entityUid = getString(row.entityUid);
    const displayName = getString(row.displayName);
    const entityKind = getString(row.entityKind);
    const platformEntityId = parseNumericId(row.platformEntityId);
    if (
      entityUid &&
      displayName &&
      platformEntityId != null &&
      (entityKind === 'game' || entityKind === 'publisher' || entityKind === 'developer')
    ) {
      kind =
        entityKind === 'game'
          ? 'games'
          : entityKind === 'publisher'
            ? 'publishers'
            : 'developers';
      ids.push(platformEntityId);
      names.push(displayName);
      entityUids.push(entityUid);
      continue;
    }

    const appid = getNumber(row.appid);
    const id = getNumber(row.id);
    const activityId = getString(row.activityId);
    const name = getString(row.name) ?? getString(row.appName);

    if (activityId) {
      kind = 'activities';
      ids.push(activityId);
      if (name) {
        names.push(name);
      }
      continue;
    }

    if (appid && name) {
      kind = 'games';
      ids.push(appid);
      names.push(name);
      entityUids.push(buildChatEntityUid({ entityKind: 'game', platformEntityId: appid }));
      continue;
    }

    if (id && name) {
      if (toolName === 'lookup_publishers' || toolName === 'find_similar' && result.entityType === 'publisher') {
        kind = 'publishers';
        entityUids.push(buildChatEntityUid({ entityKind: 'publisher', platformEntityId: id }));
      } else if (toolName === 'lookup_developers' || toolName === 'find_similar' && result.entityType === 'developer') {
        kind = 'developers';
        entityUids.push(buildChatEntityUid({ entityKind: 'developer', platformEntityId: id }));
      }
      ids.push(id);
      names.push(name);
    }
  }

  if (ids.length === 0 && names.length === 0) {
    return null;
  }

  return {
    ...(entityUids.length > 0 ? { entityUids: [...new Set(entityUids)].slice(0, 25) } : {}),
    kind,
    sourceTool: toolName,
    ids: [...new Set(ids)].slice(0, 25),
    names: [...new Set(names)].slice(0, 25),
    totalFound: getNumber(result.total_found) ?? getNumber(result.rowCount) ?? rows.length,
    rationale: contract?.summary,
  };
}

function extractEntitiesFromCandidateSet(candidateSet: SessionChatCandidateSet, entities: SessionChatEntity[]): void {
  const entityKind =
    candidateSet.kind === 'games'
      ? 'game'
      : candidateSet.kind === 'publishers'
        ? 'publisher'
        : candidateSet.kind === 'developers'
          ? 'developer'
          : null;

  if (!entityKind) {
    return;
  }

  candidateSet.names.slice(0, 5).forEach((name, index) => {
    pushUniqueEntity(entities, {
      kind: entityKind,
      name,
      id: candidateSet.ids[index],
      confidence: 'medium',
      sourceTool: candidateSet.sourceTool,
    });
  });
}

function extractEntitiesFromSelectionState(
  selectionState: SessionChatSelectionState | null | undefined,
  entities: SessionChatEntity[]
): void {
  if (!selectionState) {
    return;
  }

  for (const slot of selectionState.slots) {
    const selected = slot.candidates.find((candidate) => candidate.entityUid === slot.selectedEntityUid);
    if (!selected) {
      continue;
    }

    pushUniqueEntity(entities, {
      kind: selected.entityKind,
      name: selected.displayName,
      id: selected.platformEntityId ?? selected.entityUid,
      confidence: slot.requiresClarification ? 'medium' : 'high',
      sourceTool: 'tigerPrimarySelection',
    });
  }
}

export function buildSessionContextPrompt(context: SessionChatContext | null | undefined): string {
  if (!context) {
    return '';
  }

  const sections: string[] = [];

  if (context.entities.length > 0) {
    sections.push(
      `Active entities: ${context.entities
        .slice(0, 5)
        .map((entity) => `${entity.kind}:${entity.name}`)
        .join('; ')}`
    );
  }

  if (context.constraints.length > 0) {
    sections.push(
      `Active constraints: ${context.constraints
        .slice(0, 8)
        .map((constraint) => `${constraint.label}=${constraint.value}`)
        .join('; ')}`
    );
  }

  if (context.candidateSet && context.candidateSet.names.length > 0) {
    sections.push(
      `Current candidate set (${context.candidateSet.kind}): ${context.candidateSet.names
        .slice(0, 8)
        .join(', ')}`
    );
  }

  if (context.selectionState?.slots?.length) {
    sections.push(
      `System selection state (${context.selectionState.family}): ${context.selectionState.slots
        .map((slot) => {
          const selected = slot.candidates.find((candidate) => candidate.entityUid === slot.selectedEntityUid);
          return `${slot.label}=${selected?.displayName ?? slot.query}`;
        })
        .join('; ')}`
    );
  }

  if (context.resultSet) {
    const sourceLabel = context.resultSet.sourceContract ?? context.resultSet.sourceTool;
    sections.push(
      `Most recent continuable result set (${context.resultSet.itemKind} via ${sourceLabel}): shown ${context.resultSet.shownIds.length}${typeof context.resultSet.totalFound === 'number' ? ` of ${context.resultSet.totalFound}` : ''}`
    );
  }

  if (context.lastAnswer?.summary) {
    sections.push(`Last answer state: ${context.lastAnswer.summary}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return [
    'SESSION CONTEXT (phase 1 carry-forward):',
    'Use this only when the latest user message clearly refers to prior results or omitted entities.',
    'If the latest user message is a new standalone request, ignore this context and follow the new request.',
    ...sections,
  ].join('\n');
}

export function buildSessionContextFromTurn(params: {
  previousContext?: SessionChatContext | null;
  executedToolCalls: ChatToolCall[];
  terminalContract?: ToolAnswerContractSummary | null;
  timestamp?: string;
}): SessionChatContext | null {
  const { previousContext, executedToolCalls, terminalContract, timestamp = new Date().toISOString() } = params;

  if (executedToolCalls.length === 0) {
    return previousContext ?? null;
  }

  const entities: SessionChatEntity[] = [];
  const constraints: SessionChatConstraint[] = [];
  let candidateSet: SessionChatCandidateSet | null = null;
  let resultSet: SessionChatResultSet | null = null;

  for (const toolCall of executedToolCalls) {
    const result = toolCall.result;
    if (!isRecord(result)) {
      continue;
    }

    extractEntityFromLookupResult(result, toolCall.name, entities);
    extractEntityFromApp(result.app, toolCall.name, entities);
    extractConstraintsFromFilters(toolCall.arguments.filters, toolCall.name, constraints);
    extractConstraintsFromObject(toolCall.arguments, toolCall.name, constraints);

    const nextCandidateSet = buildCandidateSet(toolCall.name, result, terminalContract ?? null);
    if (nextCandidateSet && nextCandidateSet.names.length > 0) {
      candidateSet = nextCandidateSet;
      extractEntitiesFromCandidateSet(nextCandidateSet, entities);
    }

    const nextResultSet = buildResultSetFromToolExecution({
      toolName: toolCall.name,
      toolArguments: toolCall.arguments,
      result,
      terminalContract: terminalContract ?? null,
      timestamp,
    });
    if (nextResultSet) {
      resultSet = nextResultSet;
    }
  }

  if (entities.length === 0 && constraints.length === 0 && !candidateSet && !resultSet) {
    return previousContext ?? null;
  }

  return {
    version: 1,
    entities,
    constraints,
    candidateSet,
    selectionState: previousContext?.selectionState ?? null,
    resultSet,
    lastAnswer: terminalContract
      ? {
          family: terminalContract.family,
          summary: terminalContract.summary,
          noMatch: terminalContract.noMatch,
          sparse: terminalContract.sparse,
          clarificationNeeded: terminalContract.needsClarification,
          fallbackAction: terminalContract.fallbackAction,
        }
      : previousContext?.lastAnswer ?? null,
    updatedAt: timestamp,
  };
}

export function summarizeSessionContextForLog(context: SessionChatContext | null | undefined): Record<string, unknown> | null {
  if (!context) {
    return null;
  }

  return {
    version: context.version,
    entities: context.entities.slice(0, 8).map((entity) => ({
      kind: entity.kind,
      id: entity.id ?? null,
      name: entity.name,
    })),
    constraints: context.constraints.slice(0, 12).map((constraint) => ({
      key: constraint.key,
      value: constraint.value,
    })),
    candidateSet: context.candidateSet
      ? {
          entityUids: context.candidateSet.entityUids?.slice(0, 12) ?? null,
          kind: context.candidateSet.kind,
        ids: context.candidateSet.ids.slice(0, 12),
        names: context.candidateSet.names.slice(0, 12),
        totalFound: context.candidateSet.totalFound ?? null,
      }
      : null,
    selectionState: context.selectionState
      ? {
          family: context.selectionState.family,
          slots: context.selectionState.slots.map((slot) => ({
            candidates: slot.candidates.length,
            label: slot.label,
            query: slot.query,
            requiresClarification: slot.requiresClarification,
            selectedEntityUid: slot.selectedEntityUid,
            slotId: slot.slotId,
          })),
        }
      : null,
    resultSet: context.resultSet
      ? {
          family: context.resultSet.family,
          sourceContract: context.resultSet.sourceContract ?? null,
          sourceTool: context.resultSet.sourceTool,
          itemKind: context.resultSet.itemKind,
          shownIds: context.resultSet.shownIds.slice(0, 25),
          lastPageSize: context.resultSet.lastPageSize,
          totalFound: context.resultSet.totalFound ?? null,
          continuable: context.resultSet.continuable,
          continuationToken: context.resultSet.continuationToken ?? null,
        }
      : null,
    lastAnswer: context.lastAnswer ?? null,
    updatedAt: context.updatedAt,
  };
}

export function applyTigerPrimarySessionState(params: {
  baseContext?: SessionChatContext | null;
  lastAnswer?: SessionChatLastAnswer | null;
  selectionState?: SessionChatSelectionState | null;
  timestamp?: string;
}): SessionChatContext | null {
  const {
    baseContext,
    lastAnswer = null,
    selectionState = null,
    timestamp = new Date().toISOString(),
  } = params;

  if (!baseContext && !lastAnswer && !selectionState) {
    return null;
  }

  const context: SessionChatContext = baseContext
    ? {
        ...baseContext,
        entities: [...baseContext.entities],
        constraints: [...baseContext.constraints],
      }
    : {
        version: 1,
        entities: [],
        constraints: [],
        candidateSet: null,
        selectionState: null,
        resultSet: null,
        lastAnswer: null,
        updatedAt: timestamp,
      };

  if (selectionState) {
    context.selectionState = selectionState;
    extractEntitiesFromSelectionState(selectionState, context.entities);
  } else if (selectionState === null) {
    context.selectionState = null;
  }

  if (lastAnswer) {
    context.lastAnswer = lastAnswer;
  }

  context.updatedAt = timestamp;
  return context;
}
