import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

import { handleChatStreamRequest } from './handler';
import {
  createScriptedChatDeps,
  createServerClientStub,
  setScopedEnv,
} from './test-support';
import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import {
  collectStreamEvents,
  createJsonNextRequest,
} from '@/lib/chat/test-helpers';
import type { SessionChatContext } from '@/lib/chat/chat-context-types';
import type {
  ErrorEvent,
  MessageEndEvent,
  StreamEvent,
  TextDeltaEvent,
  ToolResultEvent,
} from '@/lib/llm/streaming-types';

function getEventTypes(events: StreamEvent[]): string[] {
  return events.map((event) => event.type);
}

function getEndEvent(events: StreamEvent[]): MessageEndEvent | null {
  return events.find((event): event is MessageEndEvent => event.type === 'message_end') ?? null;
}

function getErrorEvent(events: StreamEvent[]): ErrorEvent | null {
  return events.find((event): event is ErrorEvent => event.type === 'error') ?? null;
}

function getTextEvents(events: StreamEvent[]): TextDeltaEvent[] {
  return events.filter((event): event is TextDeltaEvent => event.type === 'text_delta');
}

function getToolResultEvents(events: StreamEvent[]): ToolResultEvent[] {
  return events.filter((event): event is ToolResultEvent => event.type === 'tool_result');
}

const TIGER_SEARCH_GAMES_TEST_PROVENANCE: ChatExecutionProvenanceOverride = {
  backendKinds: ['tiger_query_api'],
  dataSources: ['query_api:searchCatalog'],
  migrationDisposition: 'already_tiger',
  migrationNotes: 'Test compatibility wrapper routed search_games through Tiger.',
  recommendedTigerContracts: ['searchCatalog'],
};

test('chat route returns 401 when the request is unauthenticated', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  const { deps } = createScriptedChatDeps({
    userId: null,
  });

  const response = await handleChatStreamRequest(request, {
    deps: {
      ...deps,
      createServerClient: createServerClientStub(null),
    },
    requireEvalSecret: false,
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: 'unauthorized',
    message: 'Authentication required',
  });
});

test('chat route can return a Tiger primary deterministic answer with continuable session state', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'games like Hades' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: {
            contractName: 'searchCatalog',
            request: {
              query: 'hades-like',
              limit: 2,
            },
            response: {
              continuationToken: 'cursor-2',
              items: [
                { appid: 367520, name: 'Hollow Knight' },
                { appid: 632360, name: 'Risk of Rain 2' },
              ],
              sufficientToAnswer: true,
            },
          },
          info: {
            attempts: [{ contractName: 'searchCatalog', status: 'success', timingMs: 5 }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'catalog_search',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'Tiger answer',
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const textEvents = events.filter(
    (event): event is TextDeltaEvent => event.type === 'text_delta'
  );
  const endEvent =
    events.find((event): event is MessageEndEvent => event.type === 'message_end') ?? null;

  assert.equal(textEvents.length, 1);
  assert.equal(textEvents[0]?.delta, 'Tiger answer');
  assert.ok(endEvent);
  assert.equal(endEvent.tigerPrimary?.route, 'primary_success');
  assert.equal(endEvent.sessionContext?.resultSet?.sourceContract, 'searchCatalog');
  assert.deepEqual(endEvent.sessionContext?.resultSet?.shownIds, [367520, 632360]);
  assertExhausted();
});

test('chat route includes execution trace metadata for eval requests', async (t) => {
  setScopedEnv(t, 'CHAT_EVAL_SECRET', 'test-secret');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'find roguelikes under $20' }],
    },
    headers: {
      'x-chat-eval-secret': 'test-secret',
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    providerInvocations: [
      {
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-1',
              name: 'search_games',
              arguments: {
                limit: 3,
                max_price_cents: 2000,
                tags: ['Roguelike'],
              },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-1',
              name: 'search_games',
              arguments: {
                limit: 3,
                max_price_cents: 2000,
                tags: ['Roguelike'],
              },
            },
          },
          {
            type: 'usage',
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
            },
          },
        ],
      },
      {
        chunks: [
          { type: 'text', text: 'Legacy answer' },
          {
            type: 'usage',
            usage: {
              inputTokens: 5,
              outputTokens: 3,
              totalTokens: 8,
            },
          },
        ],
      },
    ],
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          info: {
            attempts: [
              {
                contractName: 'searchCatalog',
                reason: 'Primary parser skipped this prompt during the test.',
                status: 'skipped',
              },
            ],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'catalog_search',
            mode: 'eval',
            renderMode: 'deterministic',
            route: 'fallback_to_legacy',
          },
          renderedText: null,
        },
      },
    ],
    tigerShadowCalls: [
      {
        response: {
          attempts: [
            {
              contractName: 'searchCatalog',
              resultCount: 3,
              status: 'success',
              timingMs: 6,
            },
          ],
          cohort: 'default',
          enabled: true,
          matchedIntent: 'catalog_search',
          mode: 'eval',
          route: 'shadow_success_legacy_answer',
        },
      },
    ],
    toolExecutions: [
      {
        expectedName: 'search_games',
        result: attachToolExecutionProvenance(
          {
            results: [
              { appid: 367520, name: 'Hollow Knight' },
              { appid: 774361, name: 'Blasphemous' },
            ],
            success: true,
            total_found: 2,
          },
          TIGER_SEARCH_GAMES_TEST_PROVENANCE
        ),
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.ok(endEvent);
  assert.deepEqual(
    (endEvent.executionTrace ?? []).map((entry) => `${entry.stage}:${entry.name}:${entry.status}`),
    [
      'tiger_primary:searchCatalog:skipped',
      'tool:search_games:success',
      'tiger_shadow:searchCatalog:success',
    ]
  );
  assert.equal(endEvent.executionTrace?.[0]?.readOccurred, false);
  assert.deepEqual(endEvent.executionTrace?.[1]?.backendKinds, ['tiger_query_api']);
  assert.equal(endEvent.executionTrace?.[1]?.migrationDisposition, 'already_tiger');
  assert.ok(endEvent.executionTrace?.[1]?.dataSources.includes('query_api:searchCatalog'));
  assert.ok(endEvent.executionTrace?.[2]?.dataSources.includes('query_api:searchCatalog'));
  assertExhausted();
});

test('chat route uses Tiger continuation contracts for semantic follow-ups', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const priorContext: SessionChatContext = {
    version: 1,
    entities: [],
    constraints: [],
    lastAnswer: null,
    resultSet: {
      continuationToken: 'cursor-1',
      continuable: true,
      family: 'similarity',
      itemKind: 'games',
      lastPageSize: 1,
      shownIds: [1145360],
      sourceArgs: {
        entityKind: 'game',
        mode: 'similarity',
        referenceQuery: 'Hades',
      },
      sourceContract: 'semanticSearch',
      sourceTool: 'find_similar',
      totalFound: null,
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    updatedAt: '2026-04-01T00:00:00.000Z',
  };

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'same but Steam Deck verified' }],
      sessionContext: priorContext,
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    queryApiCalls: [
      {
        assertBody: (body) => {
          assert.deepEqual(body, {
            continuationToken: 'cursor-1',
            requestedCount: 1,
            sourceArgs: {
              entityKind: 'game',
              filters: { steam_deck: ['verified'] },
              mode: 'similarity',
              referenceQuery: 'Hades',
            },
            sourceContract: 'semanticSearch',
          });
        },
        expectedPath: '/v1/contracts/continue-result-set',
        response: {
          data: {
            continuationToken: null,
            effectiveArgs: {
              continuationToken: 'cursor-1',
              entityKind: 'game',
              filters: { steam_deck: ['verified'] },
              limit: 1,
              mode: 'similarity',
              referenceQuery: 'Hades',
            },
            exhausted: true,
            provenance: {
              capturedAt: '2026-04-01T00:00:00.000Z',
              source: 'tiger',
              tables: ['qdrant:publisheriq_games'],
            },
            result: {
              continuation_token: null,
              results: [
                {
                  id: 367520,
                  name: 'Hollow Knight',
                  review_percentage: 97,
                  score: 0.94,
                  steam_deck: 'verified',
                  total_reviews: 100000,
                },
              ],
              sufficient_to_answer: true,
            },
            sourceContract: 'semanticSearch',
            sufficientToAnswer: true,
          },
          httpStatus: 200,
          ok: true,
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const eventTypes = events.map((event) => event.type);
  const textEvents = events.filter(
    (event): event is TextDeltaEvent => event.type === 'text_delta'
  );
  const endEvent =
    events.find((event): event is MessageEndEvent => event.type === 'message_end') ?? null;

  assert.deepEqual(eventTypes, ['tool_start', 'tool_result', 'text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(textEvents.length, 1);
  assert.ok(textEvents[0]?.delta.length);
  assert.equal(endEvent.sessionContext?.resultSet?.sourceContract, 'semanticSearch');
  assert.equal(endEvent.sessionContext?.resultSet?.continuationToken, null);
  assert.deepEqual(endEvent.sessionContext?.resultSet?.shownIds, [1145360, 367520]);
  assert.equal(trace.queryApiCalls.length, 1);
  assertExhausted();
});

test('chat route preserves legacy tool streaming behavior with deterministic tool results', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'find cozy games' }],
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    providerInvocations: [
      {
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-1',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-1',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          { type: 'done' },
        ],
        label: 'legacy-search',
      },
      {
        assertInvocation: ({ messages, tools }) => {
          assert.equal(messages[0]?.role, 'system');
          assert.equal(tools, undefined);
        },
        chunks: [
          { type: 'text', text: 'A Short Hike and Unpacking are two good starting points.' },
          { type: 'done' },
        ],
        label: 'legacy-search-final-render',
      },
    ],
    toolExecutions: [
      {
        expectedName: 'search_games',
        result: {
          results: [
            { appid: 1, name: 'A Short Hike' },
            { appid: 2, name: 'Unpacking' },
          ],
          success: true,
          sufficient_to_answer: true,
          total_found: 2,
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const eventTypes = events.map((event) => event.type);
  const endEvent =
    events.find((event): event is MessageEndEvent => event.type === 'message_end') ?? null;

  assert.equal(trace.providerCalls.length, 2);
  assert.deepEqual(eventTypes, ['tool_start', 'tool_result', 'text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(endEvent.sessionContext?.resultSet?.sourceTool, 'search_games');
  assert.deepEqual(endEvent.sessionContext?.resultSet?.shownIds, [1, 2]);
  assertExhausted();
});

const TIGER_PRIMARY_SUCCESS_CASES = [
  {
    attemptContract: 'compareEntities',
    contractResult: {
      contractName: 'compareEntities',
      request: {
        entityUids: ['steam:game:1145360', 'steam:game:588650'],
      },
      response: {
        entityKind: 'game',
        highlights: [
          {
            displayName: 'Hades',
            entityUid: 'steam:game:1145360',
            metric: 'review_score',
            value: 9.6,
          },
        ],
        items: [
          {
            displayName: 'Hades',
            entityKind: 'game',
            entityUid: 'steam:game:1145360',
            metrics: {
              ccuPeak: 37000,
              gameCount: null,
              ownersMidpoint: 5500000,
              reviewScore: 9.6,
              totalReviews: 260000,
            },
            platformEntityId: '1145360',
          },
          {
            displayName: 'Dead Cells',
            entityKind: 'game',
            entityUid: 'steam:game:588650',
            metrics: {
              ccuPeak: 22000,
              gameCount: null,
              ownersMidpoint: 6800000,
              reviewScore: 9.3,
              totalReviews: 145000,
            },
            platformEntityId: '588650',
          },
        ],
        metrics: ['review_score', 'total_reviews', 'owners_midpoint'],
      },
    },
    matchedIntent: 'entity_compare' as const,
    prompt: 'compare Hades and Dead Cells',
    renderedText: 'Here is the Tiger comparison for Hades and Dead Cells.',
    testName: 'entity compare',
  },
  {
    attemptContract: 'traceMetricHistory',
    contractResult: null,
    matchedIntent: 'metric_history' as const,
    prompt: 'how has Hades review score changed',
    renderedText: 'Here is the Tiger metric history for Hades.',
    testName: 'metric history',
  },
  {
    attemptContract: 'searchDocuments',
    contractResult: null,
    matchedIntent: 'news_search' as const,
    prompt: 'recent roadmap news for Hades II',
    renderedText: 'Here are the most relevant recent documents for Hades II from Tiger.',
    testName: 'news search',
  },
  {
    attemptContract: 'explainChanges',
    contractResult: null,
    matchedIntent: 'change_explanation' as const,
    prompt: 'why did Hades II spike recently',
    renderedText: 'Here are the main Tiger change moments for Hades II.',
    testName: 'change explanation',
  },
];

for (const testCase of TIGER_PRIMARY_SUCCESS_CASES) {
  test(`chat route can return a Tiger primary ${testCase.testName} answer`, async (t) => {
    setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

    const request = createJsonNextRequest({
      body: {
        messages: [{ role: 'user', content: testCase.prompt }],
      },
    });

    const { assertExhausted, deps, trace } = createScriptedChatDeps({
      tigerPrimaryCalls: [
        {
          response: {
            contractResult: testCase.contractResult,
            info: {
              attempts: [{
                contractName: testCase.attemptContract,
                status: 'success',
                sufficientToAnswer: true,
                timingMs: 6,
              }],
              cohort: 'default',
              enabled: true,
              matchedIntent: testCase.matchedIntent,
              mode: 'all',
              renderMode: 'deterministic',
              route: 'primary_success',
            },
            renderedText: testCase.renderedText,
          },
        },
      ],
    });

    const response = await handleChatStreamRequest(request, {
      deps,
      requireEvalSecret: false,
    });

    const events = await collectStreamEvents(response);
    const textEvents = getTextEvents(events);
    const endEvent = getEndEvent(events);

    assert.deepEqual(getEventTypes(events), ['text_delta', 'message_end']);
    assert.equal(textEvents.length, 1);
    assert.equal(textEvents[0]?.delta, testCase.renderedText);
    assert.ok(endEvent);
    assert.equal(endEvent.tigerPrimary?.route, 'primary_success');
    assert.equal(endEvent.tigerPrimary?.matchedIntent, testCase.matchedIntent);
    assert.equal(endEvent.sessionContext, null);
    assert.equal(trace.providerCalls.length, 0);
    assertExhausted();
  });
}

test('chat route preserves Tiger fallback metadata and attaches Tiger shadow metadata for legacy recent-news topic answers', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'Which games mentioned a roadmap lately?' }],
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    providerInvocations: [
      {
        assertInvocation: ({ messages, tools }) => {
          assert.equal(messages[0]?.role, 'system');
          assert.ok((tools?.length ?? 0) > 0);
        },
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-news-topic',
              name: 'search_recent_news_topics',
              arguments: { days: 30, query: 'roadmap' },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-news-topic',
              name: 'search_recent_news_topics',
              arguments: { days: 30, query: 'roadmap' },
            },
          },
          { type: 'done' },
        ],
      },
    ],
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          info: {
            attempts: [{
              contractName: 'searchDocuments',
              reason: 'Tiger document search fell back to the legacy path for this prompt.',
              status: 'skipped',
              timingMs: 4,
            }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'news_search',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'fallback_to_legacy',
          },
          renderedText: null,
        },
      },
    ],
    tigerShadowCalls: [
      {
        response: {
          attempts: [{
            contractName: 'searchDocuments',
            resultCount: 2,
            status: 'success',
            sufficientToAnswer: true,
            timingMs: 8,
          }],
          cohort: 'default',
          enabled: true,
          matchedIntent: 'news_search',
          mode: 'all',
          route: 'shadow_success_legacy_answer',
        },
      },
    ],
    toolExecutions: [
      {
        expectedName: 'search_recent_news_topics',
        result: {
          items: [
            {
              appName: 'Hades II',
              appid: 1145350,
              bodyPreview: 'The latest roadmap outlines upcoming biome and weapon updates.',
              publishedAt: '2026-03-30T12:00:00.000Z',
              title: 'Early Access Roadmap',
            },
            {
              appName: 'No Rest for the Wicked',
              appid: 1371980,
              bodyPreview: 'Moon Studios shared a roadmap for the next major patch.',
              publishedAt: '2026-03-27T12:00:00.000Z',
              title: 'Patch Roadmap',
            },
          ],
          success: true,
          sufficient_to_answer: true,
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), ['tool_start', 'tool_result', 'text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(endEvent.tigerPrimary?.route, 'fallback_to_legacy');
  assert.equal(endEvent.tigerShadow?.route, 'shadow_success_legacy_answer');
  assert.equal(endEvent.tigerShadow?.matchedIntent, 'news_search');
  assert.ok(getTextEvents(events)[0]?.delta.includes('recent Steam news matches'));
  assert.equal(trace.tigerShadowCalls.length, 1);
  assertExhausted();
});

test('chat route deterministically renders recent-news detail tool results', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'What changed in the latest Steam news for Hades II?' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    providerInvocations: [
      {
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-news-detail',
              name: 'get_recent_news_detail',
              arguments: { app_name: 'Hades II', days: 14 },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-news-detail',
              name: 'get_recent_news_detail',
              arguments: { app_name: 'Hades II', days: 14 },
            },
          },
          { type: 'done' },
        ],
      },
    ],
    toolExecutions: [
      {
        expectedName: 'get_recent_news_detail',
        result: {
          detail_mode: 'latest_item',
          items: [
            {
              appName: 'Hades II',
              appid: 1145350,
              bodyPreview: 'Supergiant outlined the next weapon aspects and balance pass.',
              publishedAt: '2026-03-31T12:00:00.000Z',
              title: 'Hades II Early Access Update',
            },
          ],
          latestItem: {
            appName: 'Hades II',
            appid: 1145350,
            bodyPreview: 'Supergiant outlined the next weapon aspects and balance pass.',
            publishedAt: '2026-03-31T12:00:00.000Z',
            title: 'Hades II Early Access Update',
          },
          success: true,
          sufficient_to_answer: true,
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), ['tool_start', 'tool_result', 'text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.ok(getTextEvents(events)[0]?.delta.includes('latest Steam news item'));
  assert.equal(endEvent.quality?.family, 'change_intel');
  assert.equal(endEvent.sessionContext?.lastAnswer?.family, 'change_intel');
  assertExhausted();
});

test('chat route allows one supporting detail fetch after ranked change discovery', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'What are the biggest Steam page refreshes lately? Compare the top one.' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    providerInvocations: [
      {
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-change-ranked',
              name: 'query_change_activity',
              arguments: { days: 14, limit: 3, sort: 'biggest-change', view: 'store-refreshes' },
            },
          },
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-change-compare',
              name: 'compare_change_before_after',
              arguments: { activity_id: 'refresh-hades-ii-1', appid: 1145350 },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-change-ranked',
              name: 'query_change_activity',
              arguments: { days: 14, limit: 3, sort: 'biggest-change', view: 'store-refreshes' },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-change-compare',
              name: 'compare_change_before_after',
              arguments: { activity_id: 'refresh-hades-ii-1', appid: 1145350 },
            },
          },
          { type: 'done' },
        ],
      },
    ],
    toolExecutions: [
      {
        expectedName: 'query_change_activity',
        result: {
          results: [
            {
              activityId: 'refresh-hades-ii-1',
              label: 'Store-page refresh',
              name: 'Hades II',
              occurredAt: '2026-03-28T12:00:00.000Z',
            },
          ],
          success: true,
          sufficient_to_answer: false,
          total_found: 1,
        },
      },
      {
        expectedName: 'compare_change_before_after',
        result: {
          app: { appid: 1145350, name: 'Hades II' },
          diffs: [
            {
              afterText: 'New hand-painted capsule art',
              beforeText: 'Earlier teaser capsule art',
              label: 'Capsule art',
            },
          ],
          selectedActivity: {
            headline: 'The latest Hades II page refresh tightened both the art and copy.',
          },
          success: true,
          sufficient_to_answer: true,
          windows: {
            baseline30d: {
              ccuPeak: 18500,
              priceCents: 2999,
              reviewScore: 9.3,
              totalReviews: 12000,
            },
            response30d: {
              ccuPeak: 22100,
              priceCents: 2999,
              reviewScore: 9.4,
              totalReviews: 14500,
            },
          },
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), [
    'tool_start',
    'tool_start',
    'tool_result',
    'tool_result',
    'text_delta',
    'message_end',
  ]);
  assert.ok(endEvent);
  assert.equal(endEvent.quality?.fallbackUsed, true);
  assert.ok(endEvent.quality?.qualityFlags.includes('fallback_used'));
  assert.ok(getTextEvents(events)[0]?.delta.includes('What Changed'));
  assert.equal(endEvent.sessionContext?.entities[0]?.name, 'Hades II');
  assertExhausted();
});

test('chat route carries clarification state for ambiguous company lookups', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'How many games has Team17 published?' }],
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    providerInvocations: [
      {
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-company-lookup',
              name: 'lookup_publishers',
              arguments: { query: 'Team17' },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-company-lookup',
              name: 'lookup_publishers',
              arguments: { query: 'Team17' },
            },
          },
          { type: 'done' },
        ],
      },
      {
        assertInvocation: ({ tools }) => {
          assert.ok((tools?.length ?? 0) > 0);
        },
        chunks: [
          {
            type: 'text',
            text: 'Which Team17 did you mean: Team17 Group or Team17 Digital?',
          },
          { type: 'done' },
        ],
      },
    ],
    toolExecutions: [
      {
        expectedName: 'lookup_publishers',
        result: {
          entityType: 'publisher',
          error: 'The publisher name "Team17" is ambiguous and needs clarification.',
          needsDisambiguation: true,
          query: 'Team17',
          result_shape: 'lookup',
          results: [
            { id: 1, name: 'Team17 Group' },
            { id: 2, name: 'Team17 Digital' },
          ],
          success: false,
          sufficient_to_answer: true,
          sufficiency_reason: 'The publisher name "Team17" is ambiguous and needs clarification.',
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), ['tool_start', 'tool_result', 'text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(trace.providerCalls.length, 2);
  assert.equal(endEvent.quality?.terminalContract?.needsClarification, true);
  assert.ok(endEvent.quality?.qualityFlags.includes('clarification_required'));
  assert.equal(endEvent.sessionContext?.lastAnswer?.clarificationNeeded, true);
  assert.ok(getTextEvents(events)[0]?.delta.includes('Which Team17 did you mean'));
  assertExhausted();
});

test('chat route leaves unsupported continuation prompts on the legacy path', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const priorContext: SessionChatContext = {
    version: 1,
    entities: [],
    constraints: [],
    lastAnswer: null,
    resultSet: {
      continuationToken: 'cursor-3',
      continuable: true,
      family: 'similarity',
      itemKind: 'games',
      lastPageSize: 3,
      shownIds: [1145360, 367520, 632360],
      sourceArgs: {
        entityKind: 'game',
        mode: 'similarity',
        referenceQuery: 'Hades',
      },
      sourceContract: 'semanticSearch',
      sourceTool: 'find_similar',
      totalFound: null,
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    updatedAt: '2026-04-01T00:00:00.000Z',
  };

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'show me more of those by Devolver' }],
      sessionContext: priorContext,
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    providerInvocations: [
      {
        assertInvocation: ({ messages, tools }) => {
          assert.ok(messages[0]?.content.includes('Most recent continuable result set (games via semanticSearch)'));
          assert.ok((tools?.length ?? 0) > 0);
        },
        chunks: [
          {
            type: 'text',
            text: 'Please restate which subset you want narrowed instead of referring to "those" and a new company at once.',
          },
          { type: 'done' },
        ],
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), ['text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(trace.queryApiCalls.length, 0);
  assert.equal(trace.providerCalls.length, 1);
  assert.deepEqual(endEvent.sessionContext?.resultSet?.shownIds, [1145360, 367520, 632360]);
  assertExhausted();
});

test('chat route marks duplicate tool calls via the phase-1 guardrail', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'find cozy games' }],
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    providerInvocations: [
      {
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-dup-1',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-dup-2',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-dup-1',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-dup-2',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          { type: 'done' },
        ],
      },
      {
        assertInvocation: ({ tools }) => {
          assert.ok((tools?.length ?? 0) > 0);
        },
        chunks: [
          {
            type: 'text',
            text: 'A Short Hike is still the strongest fit from that cozy search.',
          },
          { type: 'done' },
        ],
      },
    ],
    toolExecutions: [
      {
        expectedName: 'search_games',
        result: {
          results: [
            { appid: 1, name: 'A Short Hike' },
            { appid: 2, name: 'Unpacking' },
          ],
          success: true,
          sufficient_to_answer: true,
          total_found: 2,
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);
  const toolResults = getToolResultEvents(events);

  assert.deepEqual(getEventTypes(events), [
    'tool_start',
    'tool_start',
    'tool_result',
    'tool_result',
    'text_delta',
    'message_end',
  ]);
  assert.ok(endEvent);
  assert.equal(trace.executeToolCalls.length, 1);
  assert.equal(toolResults[1]?.result.debug?.phase1GuardrailDecision, 'duplicate_signature');
  assert.ok(endEvent.quality?.qualityFlags.includes('duplicate_tool_blocked'));
  assertExhausted();
});

test('chat route emits an error event when tool execution throws', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'find cozy games' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    providerInvocations: [
      {
        chunks: [
          {
            type: 'tool_use_start',
            toolCall: {
              id: 'tool-error',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          {
            type: 'tool_use_end',
            toolCall: {
              id: 'tool-error',
              name: 'search_games',
              arguments: { query: 'cozy games', limit: 2 },
            },
          },
          { type: 'done' },
        ],
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps: {
      ...deps,
      executeTool: async () => {
        throw new Error('Tool exploded');
      },
    },
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const errorEvent = getErrorEvent(events);

  assert.deepEqual(getEventTypes(events), ['tool_start', 'error']);
  assert.ok(errorEvent);
  assert.equal(errorEvent.message, 'Tool exploded');
  assert.equal(getEndEvent(events), null);
  assertExhausted();
});

test('chat route emits an error event when the request body is missing messages', async () => {
  const request = new NextRequest('http://localhost/api/chat/stream', {
    body: JSON.stringify({ sessionContext: null }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  const { assertExhausted, deps } = createScriptedChatDeps({});

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const errorEvent = getErrorEvent(events);

  assert.deepEqual(getEventTypes(events), ['error']);
  assert.ok(errorEvent);
  assert.equal(errorEvent.message, 'Invalid request: messages array required');
  assertExhausted();
});

test('chat route emits an error event when the provider does not support streaming', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({});

  const response = await handleChatStreamRequest(request, {
    deps: {
      ...deps,
      createProvider: () =>
        ({
          chat: async () => ({
            content: null,
            finishReason: 'stop',
            toolCalls: null,
          }),
        }) as ReturnType<NonNullable<typeof deps.createProvider>>,
    },
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const errorEvent = getErrorEvent(events);

  assert.deepEqual(getEventTypes(events), ['error']);
  assert.ok(errorEvent);
  assert.equal(errorEvent.message, 'Provider does not support streaming');
  assertExhausted();
});
