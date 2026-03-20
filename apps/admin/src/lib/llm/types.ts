// Message types for LLM conversation
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// OpenAI function calling format
// Using a more flexible type to support nested objects, enums, and arrays
export interface ToolPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolPropertySchema;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  additionalProperties?: ToolPropertySchema;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolPropertySchema>;
      required: string[];
    };
  };
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[] | null;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LLMProvider {
  chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
  chatStream?(messages: Message[], tools?: Tool[]): AsyncGenerator<StreamChunk, void, unknown>;
}

// Chunk types from LLM provider streaming
export interface StreamChunk {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'done' | 'usage';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// Debug information for tool calls
export interface DebugInfo {
  // For Cube queries (query_analytics)
  cubeQuery?: Record<string, unknown>;
  filters?: unknown[];
  segments?: string[];
  order?: Record<string, string>;
  limit?: number;
  // For SQL queries (query_database)
  executedSql?: string;
  // For similarity search (find_similar)
  searchParams?: Record<string, unknown>;
  vectorFilter?: Record<string, unknown>;
  companyCanonicalizationReason?: string;
  // For search_games
  searchSteps?: string[];
  searchCounts?: {
    tag_candidates?: number;
    genre_candidates?: number;
    category_candidates?: number;
    steam_deck_candidates?: number;
    final_candidates?: number | null;
    query_rows?: number;
    after_release_filter?: number;
    after_review_filter?: number;
    final_count?: number;
  };
  resultShape?: ToolResultShape;
  sufficientToAnswer?: boolean;
  sufficiencyReason?: string;
  allowFollowUpRelaxation?: boolean;
  redundantDiscoveryQueryBlocked?: boolean;
  redundantDiscoveryBlockReason?: string;
}

export type ToolResultShape = 'broad_discovery' | 'lookup' | 'aggregation' | 'timeseries' | 'other';

export interface ToolSufficiencyMetadata {
  result_shape?: ToolResultShape;
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  allow_follow_up_relaxation?: boolean;
}

// Query execution
export interface QueryResult extends ToolSufficiencyMetadata {
  success: boolean;
  data?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
  truncated?: boolean;
  debug?: DebugInfo;
}

// Chat API
export interface ChatRequest {
  messages: Message[];
}

export interface ChatToolCall {
  name: string;
  arguments: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: { success: boolean; error?: string; [key: string]: any };
  timing?: {
    executionMs: number;  // Time to execute the tool
  };
}

export interface ChatTiming {
  llmMs: number;       // Total LLM inference time
  toolsMs: number;     // Total tool execution time
  totalMs: number;     // Total request time
}

// Similarity search result
export interface SimilarityResult extends ToolSufficiencyMetadata {
  success: boolean;
  mode?: 'semantic' | 'heuristic_portfolio';
  entityType?: 'publisher' | 'developer';
  reference?: {
    id: number;
    name: string;
    type: string;
  };
  results?: Array<{
    id: number;
    name: string;
    score: number;
    type?: string;
    genres?: string[];
    tags?: string[];
    review_percentage?: number | null;
    total_reviews?: number | null;
    price_cents?: number | null;
    is_free?: boolean;
    steam_deck?: 'unknown' | 'unsupported' | 'playable' | 'verified';
    game_count?: number;
    is_major?: boolean;
    matchReasons?: string[];
    flagshipTitles?: Array<{
      appid: number;
      name: string;
      totalReviews?: number;
      reviewPercentage?: number | null;
      releaseDate?: string | null;
    }>;
  }>;
  candidates?: Array<{
    id: number;
    name: string;
  }>;
  total_found?: number;
  error?: string;
  debug?: DebugInfo;
  companyAnswerHints?: Record<string, unknown>;
}

export interface ChatResponse {
  response: string;
  toolCalls?: ChatToolCall[];
  timing?: ChatTiming;
  error?: string;
}
