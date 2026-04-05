import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import type { ChatRouteDependencies } from './handler';
import {
  attachToolExecutionProvenance,
  extractToolExecutionProvenance,
} from '@/lib/chat/execution-trace';
import type { SessionChatContext } from '@/lib/chat/chat-context-types';
import type { TigerShadowInfo } from '@/lib/chat/tiger-shadow-types';
import type { StreamChunk } from '@/lib/llm/streaming-types';
import type { ChatToolCall, Message, Tool, ToolCall } from '@/lib/llm/types';

type TigerPrimaryEvaluationResult = Awaited<
  ReturnType<ChatRouteDependencies['runTigerPrimaryEvaluation']>
>;
type ToolExecutionResult = Awaited<ReturnType<ChatRouteDependencies['executeTool']>>;

type QueryApiResponse = {
  data?: unknown;
  httpStatus: number;
  ok: boolean;
  reason?: string;
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface ProviderInvocationPlan {
  assertInvocation?: (params: { messages: Message[]; tools: Tool[] | undefined }) => void;
  chunks: StreamChunk[];
  label?: string;
}

export interface ToolExecutionPlan {
  assertArguments?: (argumentsShape: Record<string, unknown>) => void;
  expectedName: string;
  label?: string;
  result: ToolExecutionResult;
}

export interface QueryApiPlan {
  assertBody?: (body: unknown) => void;
  expectedPath: string;
  label?: string;
  response: QueryApiResponse;
}

export interface TigerPrimaryPlan {
  assertRequest?: (params: {
    isEvalRequest: boolean;
    prompt: string;
    sessionContext: SessionChatContext | null;
    userId: string | null;
  }) => void;
  label?: string;
  response: TigerPrimaryEvaluationResult;
}

export interface TigerShadowPlan {
  assertRequest?: (params: {
    isEvalRequest: boolean;
    prompt: string;
    sessionContext: SessionChatContext | null;
    toolCalls: ChatToolCall[];
    userId: string | null;
  }) => void;
  label?: string;
  response: TigerShadowInfo;
}

export interface ScriptedProviderTrace {
  label?: string;
  messages: Message[];
  toolNames: string[];
  toolsProvided: boolean;
}

export interface ScriptedChatTrace {
  executeToolCalls: Array<{ label?: string; toolCall: ToolCall }>;
  providerCalls: ScriptedProviderTrace[];
  queryApiCalls: Array<{ body: unknown; label?: string; path: string }>;
  tigerPrimaryCalls: Array<{
    isEvalRequest: boolean;
    label?: string;
    prompt: string;
    sessionContext: SessionChatContext | null;
    userId: string | null;
  }>;
  tigerShadowCalls: Array<{
    isEvalRequest: boolean;
    label?: string;
    prompt: string;
    sessionContext: SessionChatContext | null;
    toolCalls: ChatToolCall[];
    userId: string | null;
  }>;
}

function buildDisabledTigerPrimaryResult(): TigerPrimaryEvaluationResult {
  return {
    contractResult: null,
    info: {
      attempts: [],
      cohort: 'default',
      enabled: false,
      matchedIntent: null,
      mode: 'off',
      renderMode: 'deterministic',
      route: 'disabled',
    },
    renderedText: null,
  };
}

function buildDisabledTigerShadowResult(): TigerShadowInfo {
  return {
    attempts: [],
    cohort: 'default',
    enabled: false,
    matchedIntent: null,
    mode: 'off',
    route: 'disabled',
  };
}

export function setScopedEnv(
  t: TestContext,
  key: string,
  value: string | undefined
): void {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  t.after(() => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  });
}

export function createServerClientStub(
  userId: string | null
): ChatRouteDependencies['createServerClient'] {
  return async () =>
    ({
      auth: {
        getUser: async () => ({
          data: {
            user: userId ? { id: userId } : null,
          },
        }),
      },
    }) as Awaited<ReturnType<ChatRouteDependencies['createServerClient']>>;
}

export function createScriptedChatDeps(params: {
  providerInvocations?: ProviderInvocationPlan[];
  queryApiCalls?: QueryApiPlan[];
  tigerPrimaryCalls?: TigerPrimaryPlan[];
  tigerShadowCalls?: TigerShadowPlan[];
  toolExecutions?: ToolExecutionPlan[];
  userCreditBalance?: number;
  userEmail?: string;
  userId?: string | null;
  userRole?: 'admin' | 'user';
}): {
  assertExhausted: () => void;
  deps: Partial<ChatRouteDependencies>;
  trace: ScriptedChatTrace;
} {
  const providerInvocations = [...(params.providerInvocations ?? [])];
  const queryApiCalls = [...(params.queryApiCalls ?? [])];
  const tigerPrimaryCalls = [...(params.tigerPrimaryCalls ?? [])];
  const tigerShadowCalls = [...(params.tigerShadowCalls ?? [])];
  const toolExecutions = [...(params.toolExecutions ?? [])];
  const trace: ScriptedChatTrace = {
    executeToolCalls: [],
    providerCalls: [],
    queryApiCalls: [],
    tigerPrimaryCalls: [],
    tigerShadowCalls: [],
  };
  let nowTick = 0;
  const scriptedUserId = params.userId ?? 'user-1';
  const scriptedUserEmail = params.userEmail ?? 'user@example.com';
  const scriptedUserRole = params.userRole ?? 'admin';
  const scriptedCreditBalance = params.userCreditBalance ?? 1000;

  const deps: Partial<ChatRouteDependencies> = {
    createProvider: () =>
      ({
        chat: async () => {
          throw new Error('chat() should not be used in scripted chat tests');
        },
        async *chatStream(messages: Message[], tools?: Tool[], _options?: { signal?: AbortSignal }) {
          const plan = providerInvocations.shift();
          assert.ok(plan, 'Unexpected provider chatStream invocation');

          const messageSnapshot = cloneValue(messages);
          const toolSnapshot = tools ? cloneValue(tools) : undefined;
          trace.providerCalls.push({
            label: plan.label,
            messages: messageSnapshot,
            toolNames: (toolSnapshot ?? []).map((tool) => tool.function.name),
            toolsProvided: (toolSnapshot?.length ?? 0) > 0,
          });

          plan.assertInvocation?.({
            messages: messageSnapshot,
            tools: toolSnapshot,
          });

          for (const chunk of plan.chunks) {
            yield cloneValue(chunk);
          }
        },
      }) as ReturnType<ChatRouteDependencies['createProvider']>,
    createServerClient: createServerClientStub(params.userId ?? 'user-1'),
    executeTool: async (toolCall: ToolCall) => {
      const plan = toolExecutions.shift();
      assert.ok(plan, `Unexpected tool execution: ${toolCall.name}`);
      assert.equal(
        toolCall.name,
        plan.expectedName,
        `Unexpected tool execution order for ${plan.label ?? toolCall.name}`
      );
      plan.assertArguments?.(toolCall.arguments);
      trace.executeToolCalls.push({
        label: plan.label,
        toolCall: cloneValue(toolCall),
      });
      const resultSnapshot = cloneValue(plan.result);
      const provenance = extractToolExecutionProvenance(plan.result);
      return provenance && typeof resultSnapshot === 'object' && resultSnapshot !== null
        ? attachToolExecutionProvenance(resultSnapshot, provenance)
        : resultSnapshot;
    },
    getServiceClient: (() =>
      ({
        from: (table: string) => {
          assert.equal(table, 'user_profiles', `Unexpected scripted service table lookup: ${table}`);

          const filters = new Map<string, unknown>();
          const chain = {
            eq(column: string, value: unknown) {
              filters.set(column, value);
              return chain;
            },
            async maybeSingle() {
              const lookupById = filters.get('id');
              const lookupByEmail = filters.get('email');
              const matchesId = lookupById == null || lookupById === scriptedUserId;
              const matchesEmail = lookupByEmail == null || lookupByEmail === scriptedUserEmail;

              if (!matchesId || !matchesEmail || scriptedUserId == null) {
                return { data: null, error: null };
              }

              return {
                data: {
                  credit_balance: scriptedCreditBalance,
                  email: scriptedUserEmail,
                  id: scriptedUserId,
                  role: scriptedUserRole,
                },
                error: null,
              };
            },
          };

          return {
            select(_columns: string) {
              return chain;
            },
          };
        },
      }) as ReturnType<ChatRouteDependencies['getServiceClient']>) as ChatRouteDependencies['getServiceClient'],
    logChatQuery: async () => undefined,
    now: () => {
      nowTick += 5;
      return nowTick;
    },
    postToQueryApi: async <T>(path: string, body: unknown) => {
      const plan = queryApiCalls.shift();
      assert.ok(plan, `Unexpected query-api call: ${path}`);
      assert.equal(path, plan.expectedPath, `Unexpected query-api path for ${plan.label ?? path}`);
      plan.assertBody?.(body);
      trace.queryApiCalls.push({
        body: cloneValue(body),
        label: plan.label,
        path,
      });

      const response = cloneValue(plan.response);
      return {
        data: response.data as T | undefined,
        httpStatus: response.httpStatus,
        ok: response.ok,
        reason: response.reason,
      };
    },
    randomUUID: () => 'fixed-uuid',
    runTigerPrimaryEvaluation: async (request) => {
      const plan = tigerPrimaryCalls.shift();
      const snapshot = {
        isEvalRequest: request.isEvalRequest,
        label: plan?.label,
        prompt: request.prompt,
        sessionContext: cloneValue(request.sessionContext),
        userId: request.userId,
      };
      trace.tigerPrimaryCalls.push(snapshot);

      if (!plan) {
        return buildDisabledTigerPrimaryResult();
      }

      plan.assertRequest?.({
        isEvalRequest: request.isEvalRequest,
        prompt: request.prompt,
        sessionContext: snapshot.sessionContext,
        userId: request.userId,
      });
      return cloneValue(plan.response);
    },
    runTigerShadowEvaluation: async (request) => {
      const snapshot = {
        isEvalRequest: request.isEvalRequest,
        label: tigerShadowCalls[0]?.label,
        prompt: request.prompt,
        sessionContext: cloneValue(request.sessionContext),
        toolCalls: cloneValue(request.toolCalls),
        userId: request.userId,
      };
      trace.tigerShadowCalls.push(snapshot);

      const plan = tigerShadowCalls.shift();
      if (!plan) {
        return buildDisabledTigerShadowResult();
      }

      plan.assertRequest?.({
        isEvalRequest: request.isEvalRequest,
        prompt: request.prompt,
        sessionContext: snapshot.sessionContext,
        toolCalls: snapshot.toolCalls,
        userId: request.userId,
      });
      return cloneValue(plan.response);
    },
  };

  return {
    assertExhausted: () => {
      assert.equal(providerInvocations.length, 0, 'Unconsumed scripted provider invocations remain');
      assert.equal(toolExecutions.length, 0, 'Unconsumed scripted tool executions remain');
      assert.equal(queryApiCalls.length, 0, 'Unconsumed scripted query-api calls remain');
      assert.equal(tigerPrimaryCalls.length, 0, 'Unconsumed scripted Tiger primary calls remain');
      assert.equal(tigerShadowCalls.length, 0, 'Unconsumed scripted Tiger shadow calls remain');
    },
    deps,
    trace,
  };
}
