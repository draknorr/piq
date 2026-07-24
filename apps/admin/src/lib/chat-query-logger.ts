import { getServiceClient } from "@publisheriq/database";
import type {
  GuardrailTraceEntry,
  ToolAnswerContractSummary,
} from "@/lib/chat/chat-context-types";
import { getTigerRuntimeWriter } from "@/lib/tiger-runtime";

export type ChatQueryLogWriteTarget = "supabase" | "tiger";

// Types for log entries
export interface ChatQueryLogEntry {
  query_text: string;
  tool_names: string[];
  tool_count: number;
  iteration_count: number;
  response_length: number;
  timing_llm_ms: number | null;
  timing_tools_ms: number | null;
  timing_total_ms: number | null;
  // Credit tracking fields (added in user system migration)
  user_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  tool_credits_used?: number;
  total_credits_charged?: number;
  chat_family?: string;
  quality_flags?: string[];
  session_context_summary?: Record<string, unknown> | null;
  guardrail_trace?: GuardrailTraceEntry[] | null;
  answer_contract_summary?: ToolAnswerContractSummary | null;
}

export interface TigerChatQueryLogEntry {
  query_text: string;
  tool_names: string[];
  tool_count: number;
  iteration_count: number;
  response_length: number;
  timing_llm_ms: number | null;
  timing_tools_ms: number | null;
  timing_total_ms: number | null;
  user_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  tool_credits_used?: number;
  total_credits_charged?: number;
  chat_family?: string;
}

interface ChatQueryLogWriters {
  supabase: (entry: ChatQueryLogEntry) => Promise<void>;
  tiger: (entry: TigerChatQueryLogEntry) => Promise<void>;
}

export function readChatQueryLogWriteTarget(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ChatQueryLogWriteTarget {
  const raw = env.CHAT_QUERY_LOG_WRITE_TARGET?.trim().toLowerCase();
  if (!raw || raw === "supabase") {
    return "supabase";
  }
  if (raw === "tiger") {
    return "tiger";
  }

  throw new Error(
    `Unsupported CHAT_QUERY_LOG_WRITE_TARGET=${JSON.stringify(raw)}. Expected "supabase" or "tiger".`,
  );
}

export function toTigerChatQueryLogEntry(
  entry: ChatQueryLogEntry,
): TigerChatQueryLogEntry {
  return {
    chat_family: entry.chat_family,
    input_tokens: entry.input_tokens,
    iteration_count: entry.iteration_count,
    output_tokens: entry.output_tokens,
    query_text: entry.query_text,
    response_length: entry.response_length,
    timing_llm_ms: entry.timing_llm_ms,
    timing_tools_ms: entry.timing_tools_ms,
    timing_total_ms: entry.timing_total_ms,
    tool_count: entry.tool_count,
    tool_credits_used: entry.tool_credits_used,
    tool_names: entry.tool_names,
    total_credits_charged: entry.total_credits_charged,
    user_id: entry.user_id,
  };
}

const CHAT_QUERY_LOG_WRITERS: ChatQueryLogWriters = {
  supabase: async (entry) => {
    const supabase = getServiceClient();

    // Type assertion needed until database types are regenerated after migration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("chat_query_logs") as any).insert(
      entry,
    );
    if (error) {
      throw error;
    }
  },
  tiger: async (entry) => {
    await getTigerRuntimeWriter().alertsPinsChat.logChatQuery(
      entry as unknown as Record<string, unknown>,
    );
  },
};

export async function writeChatQueryLog(
  entry: ChatQueryLogEntry,
  env: Readonly<Record<string, string | undefined>> = process.env,
  writers: ChatQueryLogWriters = CHAT_QUERY_LOG_WRITERS,
): Promise<void> {
  const target = readChatQueryLogWriteTarget(env);
  if (target === "tiger") {
    await writers.tiger(toTigerChatQueryLogEntry(entry));
    return;
  }

  await writers.supabase(entry);
}

/**
 * Log a chat query to the explicitly selected telemetry store.
 * For serverless environments, we insert immediately since
 * buffering doesn't work reliably (function terminates after response).
 *
 * Logging failures remain non-fatal to chat responses, but a selected Tiger
 * target never falls back to Supabase.
 */
export async function logChatQuery(entry: ChatQueryLogEntry): Promise<void> {
  try {
    await writeChatQueryLog(entry);
  } catch (err) {
    console.error('Error logging chat query:', err);
  }
}
