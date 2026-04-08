import type { ChatTiming } from './types';
import type { ChatTurnQualityInfo, SessionChatContext } from '@/lib/chat/chat-context-types';
import type { ChatExecutionTraceEntry } from '@/lib/chat/execution-trace';
import type { QuerySuggestion } from '@/lib/chat/query-templates';
import type { TigerPrimaryInfo, TigerShadowInfo } from '@/lib/chat/tiger-shadow-types';
import type { ChatRenderData } from '@/lib/chat/chat-render-data';

// Streaming event types for Server-Sent Events format
export type StreamEventType =
  | 'text_delta'      // Incremental text chunk
  | 'tool_start'      // Tool call initiated
  | 'tool_result'     // Tool execution completed
  | 'message_end'     // Response complete
  | 'error';          // Error occurred

export interface BaseStreamEvent {
  type: StreamEventType;
}

export interface TextDeltaEvent extends BaseStreamEvent {
  type: 'text_delta';
  delta: string;
}

export interface ToolStartEvent extends BaseStreamEvent {
  type: 'tool_start';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseStreamEvent {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: { success: boolean; error?: string; [key: string]: any };
  timing: { executionMs: number };
}

export interface StreamDebugInfo {
  iterations: number;          // How many LLM calls happened
  textDeltaCount: number;      // Number of text_delta events received
  totalChars: number;          // Total characters streamed
  toolCallCount: number;       // Number of tool calls made
  lastIterationHadText: boolean; // Whether the final iteration produced text
  tigerPrimaryDebug?: {
    matchedIntent?: string | null;
    queryApiBaseUrl?: string | null;
    resolvedQueryApiBaseUrl?: string | null;
    youtubeEntityQuery?: string | null;
    youtubeSelectionQuery?: string | null;
  } | null;
}

export interface MessageEndEvent extends BaseStreamEvent {
  type: 'message_end';
  timing: ChatTiming;
  debug?: StreamDebugInfo;
  quality?: ChatTurnQualityInfo;
  sessionContext?: SessionChatContext | null;
  executionTrace?: ChatExecutionTraceEntry[];
  followUpSuggestions?: QuerySuggestion[];
  renderData?: ChatRenderData;
  tigerPrimary?: TigerPrimaryInfo;
  tigerShadow?: TigerShadowInfo;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  creditsCharged?: number;
}

export interface ErrorEvent extends BaseStreamEvent {
  type: 'error';
  message: string;
}

export type StreamEvent =
  | TextDeltaEvent
  | ToolStartEvent
  | ToolResultEvent
  | MessageEndEvent
  | ErrorEvent;

// Token usage from LLM provider
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
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
  usage?: TokenUsage;
}
