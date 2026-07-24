import assert from "node:assert/strict";
import test from "node:test";

import {
  readChatQueryLogWriteTarget,
  toTigerChatQueryLogEntry,
  writeChatQueryLog,
  type ChatQueryLogEntry,
  type TigerChatQueryLogEntry,
} from "./chat-query-logger";

const ENTRY: ChatQueryLogEntry = {
  answer_contract_summary: null,
  chat_family: "market_research",
  guardrail_trace: [],
  input_tokens: 120,
  iteration_count: 2,
  output_tokens: 45,
  quality_flags: ["grounded"],
  query_text: "What changed?",
  response_length: 400,
  session_context_summary: { entityCount: 1 },
  timing_llm_ms: 1200,
  timing_tools_ms: 300,
  timing_total_ms: 1600,
  tool_count: 1,
  tool_credits_used: 2,
  tool_names: ["change_feed"],
  total_credits_charged: 3,
  user_id: "00000000-0000-0000-0000-000000000001",
};

test("chat query log target defaults to Supabase for a reversible rollout", () => {
  assert.equal(readChatQueryLogWriteTarget({}), "supabase");
  assert.equal(
    readChatQueryLogWriteTarget({ CHAT_QUERY_LOG_WRITE_TARGET: " TiGeR " }),
    "tiger",
  );
});

test("chat query log target rejects unknown values instead of silently falling back", () => {
  assert.throws(
    () =>
      readChatQueryLogWriteTarget({ CHAT_QUERY_LOG_WRITE_TARGET: "shadow" }),
    /Unsupported CHAT_QUERY_LOG_WRITE_TARGET/,
  );
});

test("Tiger chat log payload contains only columns present in the live Tiger table", () => {
  const payload = toTigerChatQueryLogEntry(ENTRY);

  assert.equal(payload.query_text, ENTRY.query_text);
  assert.equal(payload.total_credits_charged, ENTRY.total_credits_charged);
  assert.equal("quality_flags" in payload, false);
  assert.equal("session_context_summary" in payload, false);
  assert.equal("guardrail_trace" in payload, false);
  assert.equal("answer_contract_summary" in payload, false);
});

test("Tiger target writes only to Tiger and does not silently fall back", async () => {
  const calls: string[] = [];
  const tigerPayloads: TigerChatQueryLogEntry[] = [];

  await writeChatQueryLog(
    ENTRY,
    { CHAT_QUERY_LOG_WRITE_TARGET: "tiger" },
    {
      supabase: async () => {
        calls.push("supabase");
      },
      tiger: async (payload) => {
        calls.push("tiger");
        tigerPayloads.push(payload);
      },
    },
  );

  assert.deepEqual(calls, ["tiger"]);
  assert.equal(tigerPayloads[0]?.query_text, ENTRY.query_text);
});

test("Tiger write failures remain failures and never invoke Supabase", async () => {
  let supabaseCalled = false;

  await assert.rejects(
    writeChatQueryLog(
      ENTRY,
      { CHAT_QUERY_LOG_WRITE_TARGET: "tiger" },
      {
        supabase: async () => {
          supabaseCalled = true;
        },
        tiger: async () => {
          throw new Error("Tiger unavailable");
        },
      },
    ),
    /Tiger unavailable/,
  );

  assert.equal(supabaseCalled, false);
});
