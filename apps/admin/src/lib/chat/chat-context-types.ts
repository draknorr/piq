export type ChatEntityKind =
  | 'game'
  | 'publisher'
  | 'developer'
  | 'tag'
  | 'genre'
  | 'category'
  | 'change_activity';

export type SessionCandidateKind = 'games' | 'publishers' | 'developers' | 'activities';
export type SessionResultSetItemKind = 'games' | 'activities';

export type Phase1FallbackAction =
  | 'respond'
  | 'ask_clarification'
  | 'answer_no_match'
  | 'retry_relaxed_once'
  | 'fetch_one_supporting_detail';

export type ChatQualityFlag =
  | 'context_applied'
  | 'terminal_result'
  | 'clarification_required'
  | 'no_match'
  | 'sparse_result'
  | 'temporary_unavailable'
  | 'fallback_allowed'
  | 'fallback_used'
  | 'duplicate_tool_blocked'
  | 'redundant_tool_blocked'
  | 'trend_scaffold'
  | 'change_scaffold'
  | 'iteration_limit';

export interface SessionChatEntity {
  kind: ChatEntityKind;
  name: string;
  id?: number | string;
  confidence?: 'high' | 'medium' | 'low';
  sourceTool: string;
}

export interface SessionChatConstraint {
  key: string;
  label: string;
  value: string;
  sourceTool: string;
}

export interface SessionChatCandidateSet {
  kind: SessionCandidateKind;
  sourceTool: string;
  ids: Array<number | string>;
  names: string[];
  totalFound?: number;
  rationale?: string;
}

export interface SessionChatLastAnswer {
  family?: string;
  summary: string;
  noMatch?: boolean;
  sparse?: boolean;
  clarificationNeeded?: boolean;
  fallbackAction?: Phase1FallbackAction;
}

export interface SessionChatResultSet {
  continuationToken?: string | null;
  family: string;
  sourceTool: string;
  sourceContract?: 'searchCatalog' | 'semanticSearch';
  itemKind: SessionResultSetItemKind;
  sourceArgs: Record<string, unknown>;
  shownIds: Array<number | string>;
  lastPageSize: number;
  totalFound?: number | null;
  continuable: boolean;
  updatedAt: string;
}

export interface SessionChatContext {
  version: 1;
  entities: SessionChatEntity[];
  constraints: SessionChatConstraint[];
  candidateSet?: SessionChatCandidateSet | null;
  resultSet?: SessionChatResultSet | null;
  lastAnswer?: SessionChatLastAnswer | null;
  updatedAt: string;
}

export interface ToolAnswerContractSummary {
  family: string;
  resultShape?: string;
  sufficientToAnswer: boolean;
  needsClarification: boolean;
  noMatch: boolean;
  sparse: boolean;
  unavailable?: boolean;
  failureKind?: string;
  fallbackAllowed: boolean;
  fallbackAction: Phase1FallbackAction;
  requiredAnswerFields: string[];
  supportingEvidence: string[];
  answerScaffold?: string;
  summary: string;
  qualityFlags: ChatQualityFlag[];
}

export interface GuardrailTraceEntry {
  step: string;
  decision: 'allow' | 'block' | 'observe';
  toolName?: string;
  reason: string;
}

export interface ChatTurnQualityInfo {
  family?: string;
  qualityFlags: ChatQualityFlag[];
  fallbackUsed: boolean;
  contextApplied: boolean;
  guardrailTrace: GuardrailTraceEntry[];
  terminalContract?: ToolAnswerContractSummary | null;
  renderMode?: 'model' | 'deterministic';
  terminalAfterIteration?: number | null;
  modelHistoryChars?: number;
  continuationDetected?: boolean;
  continuationIntent?: 'continue' | 'continue_with_limit' | 'continue_with_constraint_delta';
  continuationSourceTool?: string;
  requestedCount?: number;
  excludedCount?: number;
  continuationExhausted?: boolean;
}
