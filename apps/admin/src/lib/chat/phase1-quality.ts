import type { ToolCall } from '@/lib/llm/types';
import type {
  ChatQualityFlag,
  ChatTurnQualityInfo,
  GuardrailTraceEntry,
  Phase1FallbackAction,
  ToolAnswerContractSummary,
} from '@/lib/chat/chat-context-types';

type Phase1ToolResult = { success: boolean; error?: string } & Record<string, unknown>;

interface Phase1GuardrailState {
  contextApplied: boolean;
  fallbackUsed: boolean;
  executedSignatures: Set<string>;
  qualityFlags: Set<ChatQualityFlag>;
  guardrailTrace: GuardrailTraceEntry[];
  lastContract: ToolAnswerContractSummary | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeForSignature(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForSignature);
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeForSignature(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function buildToolSignature(toolCall: ToolCall): string {
  return JSON.stringify({
    name: toolCall.name,
    arguments: normalizeForSignature(toolCall.arguments),
  });
}

function getRowCount(result: Record<string, unknown>): number {
  if (typeof result.rowCount === 'number') {
    return result.rowCount;
  }

  if (typeof result.total_found === 'number') {
    return result.total_found;
  }

  if (Array.isArray(result.data)) {
    return result.data.length;
  }

  if (Array.isArray(result.results)) {
    return result.results.length;
  }

  if (Array.isArray(result.events)) {
    return result.events.length;
  }

  if (Array.isArray(result.items)) {
    return result.items.length;
  }

  if (Array.isArray(result.diffs)) {
    return result.diffs.length;
  }

  return 0;
}

function familyForTool(toolCall: ToolCall, result: Record<string, unknown>): string {
  switch (toolCall.name) {
    case 'screen_games':
    case 'discover_trending':
      return 'trend';
    case 'query_change_activity':
    case 'get_change_activity_detail':
    case 'get_game_change_timeline':
    case 'get_recent_news_digest':
    case 'compare_change_before_after':
    case 'find_change_patterns':
      return 'change_intel';
    case 'find_similar':
      return result.entityType === 'publisher' || result.entityType === 'developer'
        ? 'company_similarity'
        : 'similarity';
    case 'search_by_concept':
      return 'concept';
    case 'lookup_publishers':
    case 'lookup_developers':
      return 'company_lookup';
    case 'lookup_games':
      return 'game_lookup';
    case 'search_games':
      return 'discovery';
    case 'query_analytics':
      return typeof result.result_shape === 'string'
        ? result.result_shape === 'broad_discovery'
          ? 'discovery'
          : result.result_shape === 'lookup'
            ? 'lookup'
            : result.result_shape === 'timeseries'
              ? 'trend'
              : 'analytics'
        : 'analytics';
    default:
      return 'generic';
  }
}

function getRequiredAnswerFields(toolCall: ToolCall, result: Record<string, unknown>, family: string): string[] {
  if (family === 'trend') {
    const columns = Array.isArray(result.recommended_columns)
      ? result.recommended_columns.filter((column): column is string => typeof column === 'string')
      : [];
    return columns.length > 0
      ? columns
      : ['ranking metric', 'exact window', 'supporting metrics', 'why the row qualifies'];
  }

  if (family === 'change_intel') {
    if (toolCall.name === 'compare_change_before_after') {
      return ['what changed', 'before state', 'after state', 'why it matters', 'confidence'];
    }

    if (toolCall.name === 'get_game_change_timeline') {
      return ['dates', 'concrete title-specific changes', 'before/after values when available'];
    }

    if (toolCall.name === 'get_recent_news_digest') {
      return ['dates', 'news titles', 'concrete changes from the news copy'];
    }

    return ['ranked candidates', 'evidence', 'timing', 'why it qualifies'];
  }

  if (isRecord(result.companyAnswerHints)) {
    const requiredColumns = Array.isArray(result.companyAnswerHints.requiredColumns)
      ? result.companyAnswerHints.requiredColumns.filter((column): column is string => typeof column === 'string')
      : [];
    if (requiredColumns.length > 0) {
      return requiredColumns;
    }
  }

  return [];
}

function getSupportingEvidence(toolCall: ToolCall, result: Record<string, unknown>, family: string): string[] {
  const evidence: string[] = [];

  if (family === 'trend') {
    if (typeof result.ranking_definition === 'string') {
      evidence.push(result.ranking_definition);
    }
    if (typeof result.timeframe_label === 'string') {
      evidence.push(`Window: ${result.timeframe_label}`);
    }
  }

  if (family === 'change_intel') {
    if (toolCall.name === 'compare_change_before_after') {
      evidence.push('Use structured diffs plus baseline/response windows.');
    } else if (toolCall.name === 'get_recent_news_digest') {
      evidence.push('Lead with the stored news copy, dates, and the concrete update from each item.');
    } else if (toolCall.name === 'query_change_activity' || toolCall.name === 'find_change_patterns') {
      evidence.push('Lead with exact change evidence, not generic pattern labels.');
    }
  }

  if (Array.isArray(result.matchReasons) && result.matchReasons.length > 0) {
    evidence.push('Use the provided match reasons directly.');
  }

  return evidence;
}

function getAnswerScaffold(toolCall: ToolCall, result: Record<string, unknown>, family: string): string | undefined {
  if (result.success === false) {
    if (result.unavailable === true) {
      return 'Explain that this surface is temporarily unavailable right now. Do not pretend there were zero matches. Suggest a narrower follow-up such as a specific title, a store-refresh slice, or a release-timing query.';
    }

    return typeof result.error === 'string'
      ? `Explain the tool failure directly: ${result.error}`
      : 'Explain that the requested data could not be loaded and avoid inventing ranked results.';
  }

  if (family === 'trend') {
    return typeof result.response_guidance === 'string'
      ? result.response_guidance
      : 'Answer with the exact window, ranking definition, the top rows, supporting metrics, and one short sentence on why each row qualifies.';
  }

  if (family === 'change_intel') {
    if (toolCall.name === 'compare_change_before_after') {
      return 'Use sections in this order: What changed, Before, After, Why it matters, Confidence.';
    }

    if (toolCall.name === 'query_change_activity' || toolCall.name === 'find_change_patterns') {
      return 'For each ranked row, give the exact change or evidence, when it happened, and why it matters. Prefer concrete evidence over generic labels.';
    }

    if (toolCall.name === 'get_game_change_timeline') {
      return 'Lead with the most material title-specific changes and dates. Use before/after text when it exists.';
    }

    if (toolCall.name === 'get_recent_news_digest') {
      return 'Use a short intro sentence and 2-4 bullets. Each bullet should name the game, timing, and concrete update from the news body.';
    }
  }

  return undefined;
}

function buildSummary(params: {
  family: string;
  rowCount: number;
  needsClarification: boolean;
  noMatch: boolean;
  sparse: boolean;
  unavailable: boolean;
  fallbackAction: Phase1FallbackAction;
  result: Record<string, unknown>;
}): string {
  const { family, rowCount, needsClarification, noMatch, sparse, unavailable, fallbackAction, result } = params;

  if (result.success === false) {
    if (unavailable) {
      return typeof result.error === 'string'
        ? result.error
        : `The ${family} surface is temporarily unavailable. Respond directly without inventing empty results.`;
    }

    return typeof result.error === 'string'
      ? result.error
      : `The ${family} tool failed before returning usable results.`;
  }

  if (needsClarification) {
    return typeof result.error === 'string'
      ? result.error
      : 'This turn needs a clarification before any broader tool use.';
  }

  if (noMatch) {
    if (fallbackAction === 'retry_relaxed_once') {
      return 'No qualifying rows matched the first pass. One controlled relaxation retry is allowed.';
    }

    return 'No qualifying rows matched the current constraints. Respond directly and explain the limitation.';
  }

  if (fallbackAction === 'fetch_one_supporting_detail') {
    return 'A ranked change-intel set is available, but one supporting detail fetch should be used before the final answer if more proof is needed.';
  }

  if (sparse) {
    return `Returned a sparse but usable ${family} result with ${rowCount} rows. Keep the answer constrained and say the qualifying set is limited.`;
  }

  return typeof result.sufficiency_reason === 'string'
    ? result.sufficiency_reason
    : `Returned ${rowCount} ${family} rows and can answer directly.`;
}

function attachFlag(flags: Set<ChatQualityFlag>, flag: ChatQualityFlag): void {
  flags.add(flag);
}

export function createPhase1GuardrailState(contextApplied: boolean): Phase1GuardrailState {
  const qualityFlags = new Set<ChatQualityFlag>();
  if (contextApplied) {
    qualityFlags.add('context_applied');
  }

  return {
    contextApplied,
    fallbackUsed: false,
    executedSignatures: new Set<string>(),
    qualityFlags,
    guardrailTrace: [],
    lastContract: null,
  };
}

export function buildToolAnswerContractSummary(
  toolCall: ToolCall,
  result: Phase1ToolResult
): ToolAnswerContractSummary {
  const family = familyForTool(toolCall, result);
  const rowCount = getRowCount(result);
  const unavailable = result.success === false && result.unavailable === true;
  const failureKind = typeof result.failure_kind === 'string' ? result.failure_kind : undefined;
  const needsClarification =
    result.needsDisambiguation === true ||
    (result.success === false && Array.isArray(result.candidates) && result.candidates.length > 0);
  const noMatch =
    !unavailable &&
    !needsClarification &&
    rowCount === 0 &&
    (result.success === true || typeof result.sufficiency_reason === 'string');
  const sparse =
    result.sparse_result === true ||
    (rowCount > 0 && rowCount <= 5 && ['discovery', 'trend', 'change_intel', 'similarity', 'company_similarity'].includes(family));
  const fallbackAllowed =
    result.allow_follow_up_relaxation === true ||
    (
      (toolCall.name === 'query_change_activity' || toolCall.name === 'find_change_patterns') &&
      rowCount > 0 &&
      result.sufficient_to_answer !== true
    );
  let fallbackAction: Phase1FallbackAction = 'respond';

  if (needsClarification) {
    fallbackAction = 'ask_clarification';
  } else if (result.allow_follow_up_relaxation === true) {
    fallbackAction = 'retry_relaxed_once';
  } else if (
    (toolCall.name === 'query_change_activity' || toolCall.name === 'find_change_patterns') &&
    rowCount > 0 &&
    result.sufficient_to_answer !== true
  ) {
    fallbackAction = 'fetch_one_supporting_detail';
  } else if (noMatch) {
    fallbackAction = 'answer_no_match';
  }

  const qualityFlags = new Set<ChatQualityFlag>();
  if (result.sufficient_to_answer === true) {
    attachFlag(qualityFlags, 'terminal_result');
  }
  if (needsClarification) {
    attachFlag(qualityFlags, 'clarification_required');
  }
  if (noMatch) {
    attachFlag(qualityFlags, 'no_match');
  }
  if (sparse) {
    attachFlag(qualityFlags, 'sparse_result');
  }
  if (unavailable) {
    attachFlag(qualityFlags, 'temporary_unavailable');
  }
  if (fallbackAllowed) {
    attachFlag(qualityFlags, 'fallback_allowed');
  }

  const answerScaffold = getAnswerScaffold(toolCall, result, family);
  if (family === 'trend' && answerScaffold) {
    attachFlag(qualityFlags, 'trend_scaffold');
  }
  if (family === 'change_intel' && answerScaffold) {
    attachFlag(qualityFlags, 'change_scaffold');
  }

  return {
    family,
    resultShape: typeof result.result_shape === 'string' ? result.result_shape : undefined,
    sufficientToAnswer: result.sufficient_to_answer === true,
    needsClarification,
    noMatch,
    sparse,
    unavailable,
    failureKind,
    fallbackAllowed,
    fallbackAction,
    requiredAnswerFields: getRequiredAnswerFields(toolCall, result, family),
    supportingEvidence: getSupportingEvidence(toolCall, result, family),
    answerScaffold,
    summary: buildSummary({
      family,
      rowCount,
      needsClarification,
      noMatch,
      sparse,
      unavailable,
      fallbackAction,
      result,
    }),
    qualityFlags: [...qualityFlags],
  };
}

export function attachPhase1MetadataToResult(
  result: Phase1ToolResult,
  contract: ToolAnswerContractSummary
): Phase1ToolResult {
  return {
    ...result,
    phase1_contract: {
      family: contract.family,
      sufficient_to_answer: contract.sufficientToAnswer,
      needs_clarification: contract.needsClarification,
      no_match: contract.noMatch,
      sparse: contract.sparse,
      unavailable: contract.unavailable === true,
      failure_kind: contract.failureKind,
      fallback_action: contract.fallbackAction,
      required_answer_fields: contract.requiredAnswerFields,
      supporting_evidence: contract.supportingEvidence,
      summary: contract.summary,
    },
    ...(contract.answerScaffold ? { response_guidance: contract.answerScaffold } : {}),
  };
}

export function maybeBlockPhase1ToolCall(
  state: Phase1GuardrailState,
  toolCall: ToolCall
): Phase1ToolResult | null {
  const signature = buildToolSignature(toolCall);
  if (state.executedSignatures.has(signature)) {
    attachFlag(state.qualityFlags, 'duplicate_tool_blocked');
    state.guardrailTrace.push({
      step: 'duplicate_signature',
      decision: 'block',
      toolName: toolCall.name,
      reason: 'Blocked an identical tool call after it already executed in this turn.',
    });

    return {
      success: true,
      skipped_phase1_guardrail: true,
      sufficient_to_answer: true,
      sufficiency_reason: 'Skipped a duplicate tool call after an equivalent call already ran this turn.',
      debug: {
        phase1GuardrailDecision: 'duplicate_signature',
        blockedTool: toolCall.name,
      },
    };
  }

  const lastContract = state.lastContract;
  if (!lastContract) {
    state.guardrailTrace.push({
      step: 'pre_execute',
      decision: 'allow',
      toolName: toolCall.name,
      reason: 'No prior terminal contract blocked this tool call.',
    });
    return null;
  }

  if (lastContract.fallbackAction === 'retry_relaxed_once') {
    if (state.fallbackUsed) {
      attachFlag(state.qualityFlags, 'redundant_tool_blocked');
      state.guardrailTrace.push({
        step: 'fallback_retry_budget',
        decision: 'block',
        toolName: toolCall.name,
        reason: 'Blocked an additional fallback retry after the one allowed relaxation was already used.',
      });

      return {
        success: true,
        skipped_phase1_guardrail: true,
        sufficient_to_answer: true,
        sufficiency_reason: lastContract.summary,
        debug: {
          phase1GuardrailDecision: 'fallback_retry_budget',
          blockedTool: toolCall.name,
        },
      };
    }

    state.fallbackUsed = true;
    attachFlag(state.qualityFlags, 'fallback_used');
    state.guardrailTrace.push({
      step: 'fallback_retry_budget',
      decision: 'allow',
      toolName: toolCall.name,
      reason: 'Allowed the single controlled relaxation retry for this turn.',
    });
    return null;
  }

  if (lastContract.fallbackAction === 'fetch_one_supporting_detail') {
    const isAllowedSupportTool =
      toolCall.name === 'get_change_activity_detail' || toolCall.name === 'compare_change_before_after';

    if (!isAllowedSupportTool || state.fallbackUsed) {
      attachFlag(state.qualityFlags, 'redundant_tool_blocked');
      state.guardrailTrace.push({
        step: 'supporting_detail_budget',
        decision: 'block',
        toolName: toolCall.name,
        reason: 'Blocked further broadening after a ranked change-intel set. Only one supporting detail fetch is allowed.',
      });

      return {
        success: true,
        skipped_phase1_guardrail: true,
        sufficient_to_answer: true,
        sufficiency_reason: lastContract.summary,
        debug: {
          phase1GuardrailDecision: 'supporting_detail_budget',
          blockedTool: toolCall.name,
        },
      };
    }

    state.fallbackUsed = true;
    attachFlag(state.qualityFlags, 'fallback_used');
    state.guardrailTrace.push({
      step: 'supporting_detail_budget',
      decision: 'allow',
      toolName: toolCall.name,
      reason: 'Allowed a single supporting detail fetch after a ranked change-intel result.',
    });
    return null;
  }

  if (lastContract.sufficientToAnswer) {
    attachFlag(state.qualityFlags, 'redundant_tool_blocked');
    state.guardrailTrace.push({
      step: 'terminal_contract',
      decision: 'block',
      toolName: toolCall.name,
      reason: lastContract.summary,
    });

    return {
      success: true,
      skipped_phase1_guardrail: true,
      sufficient_to_answer: true,
      sufficiency_reason: lastContract.summary,
      debug: {
        phase1GuardrailDecision: 'terminal_contract',
        blockedTool: toolCall.name,
        contractFamily: lastContract.family,
      },
    };
  }

  state.guardrailTrace.push({
    step: 'pre_execute',
    decision: 'allow',
    toolName: toolCall.name,
    reason: 'No phase-1 governor rule blocked this tool call.',
  });
  return null;
}

export function observeExecutedToolCall(
  state: Phase1GuardrailState,
  toolCall: ToolCall,
  contract: ToolAnswerContractSummary
): void {
  state.executedSignatures.add(buildToolSignature(toolCall));
  state.lastContract = contract;
  contract.qualityFlags.forEach((flag) => attachFlag(state.qualityFlags, flag));
  state.guardrailTrace.push({
    step: 'post_execute_contract',
    decision: 'observe',
    toolName: toolCall.name,
    reason: contract.summary,
  });
}

export function buildPhase1QualityInfo(state: Phase1GuardrailState): ChatTurnQualityInfo {
  return {
    family: state.lastContract?.family,
    qualityFlags: [...state.qualityFlags],
    fallbackUsed: state.fallbackUsed,
    contextApplied: state.contextApplied,
    guardrailTrace: state.guardrailTrace,
    terminalContract: state.lastContract,
  };
}
