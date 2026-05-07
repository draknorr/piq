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

test('chat route uses the prompt interpreter before Tiger primary when enabled', async (t) => {
  setScopedEnv(t, 'CHAT_NLU_ENABLED', 'true');
  setScopedEnv(t, 'CHAT_NLU_MIN_CONFIDENCE', 'medium');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'what do you know about assetto corsa' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    providerChats: [
      {
        assertInvocation: ({ tools }) => {
          assert.equal(tools, undefined);
        },
        response: {
          content: JSON.stringify({
            confidence: 'high',
            continuationAction: 'none',
            contractCandidates: ['resolveEntities', 'getEntityOverview'],
            entities: [{ kindHint: 'game', query: 'Assetto Corsa', role: 'primary' }],
            intent: 'entity_overview',
          }),
        },
      },
    ],
    tigerPrimaryCalls: [
      {
        assertRequest: ({ interpretation, prompt }) => {
          assert.equal(prompt, 'what do you know about assetto corsa');
          assert.equal(interpretation?.intent, 'entity_overview');
          assert.equal(interpretation?.entities[0]?.query, 'Assetto Corsa');
        },
        response: {
          contractResult: null,
          info: {
            attempts: [{ contractName: 'getEntityOverview', status: 'success', timingMs: 5 }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_overview',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'Assetto Corsa overview',
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  assert.ok(getTextEvents(events).some((event) => event.delta.includes('Assetto Corsa overview')));
  assertExhausted();
});

test('chat route forwards selected entities into Tiger primary request-binding state', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'show Crimson Desert ccu' }],
      selectedEntities: [
        {
          displayName: 'Crimson Desert',
          entityKind: 'game',
          entityUid: 'game:steam:3321460',
          matchQuality: 'exact',
          platform: 'steam',
          platformEntityId: '3321460',
        },
      ],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        assertRequest: ({ prompt, sessionContext }) => {
          assert.equal(prompt, 'show Crimson Desert ccu');
          assert.equal(sessionContext?.selectionState?.family, 'request_binding');
          assert.equal(sessionContext?.selectionState?.slots[0]?.query, 'Crimson Desert');
          assert.equal(sessionContext?.selectionState?.slots[0]?.selectedEntityUid, 'game:steam:3321460');
          assert.equal(sessionContext?.entities[0]?.name, 'Crimson Desert');
          assert.equal(sessionContext?.entities[0]?.platformEntityId, '3321460');
        },
        response: {
          contractResult: {
            contractName: 'getEntityOverview',
            request: {
              entityKind: 'game',
              entityUid: 'game:steam:3321460',
              gamesLimit: 0,
              gamesSortBy: 'release_date',
              platformEntityId: '3321460',
            },
            response: {
              entity: {
                details: {
                  developers: ['Pearl Abyss'],
                  platforms: ['windows', 'macos'],
                  publishers: ['Pearl Abyss'],
                  releaseDate: '2026-03-19',
                  releaseState: 'released',
                  releaseYear: 2026,
                },
                displayName: 'Crimson Desert',
                entityKind: 'game',
                metrics: {
                  ccuPeak: 16701,
                  gameCount: null,
                  ownersMidpoint: 10000,
                  reviewScore: 83.4,
                  totalReviews: 16572,
                },
                platformEntityId: '3321460',
              },
              games: [],
              sufficientToAnswer: true,
            },
          },
          info: {
            attempts: [{
              contractName: 'resolveEntities',
              reason: 'Reused the current entity selection from session context.',
              status: 'success',
              sufficientToAnswer: true,
              timingMs: 1,
            }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_overview',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'Crimson Desert overview',
          sessionState: {
            lastAnswer: {
              family: 'entity_overview',
              summary: 'Tiger answered entity_overview.',
            },
            selectionState: {
              family: 'entity_overview',
              slots: [{
                candidates: [{
                  displayName: 'Crimson Desert',
                  entityKind: 'game',
                  entityUid: 'game:steam:3321460',
                  matchQuality: 'exact',
                  matchSource: null,
                  ordinal: 1,
                  platform: 'steam',
                  platformEntityId: '3321460',
                  releaseYear: 2026,
                  resolutionTier: 'canonical_exact',
                  score: 100,
                  totalReviews: 16572,
                }],
                continuationToken: null,
                expectedEntityKind: 'game',
                label: 'Crimson Desert',
                query: 'Crimson Desert',
                requiresClarification: false,
                selectedEntityUid: 'game:steam:3321460',
                slotId: 'primary',
                totalCandidates: 1,
              }],
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
  const textEvents = getTextEvents(events);
  const endEvent = getEndEvent(events);

  assert.equal(textEvents[0]?.delta, 'Crimson Desert overview');
  assert.ok(endEvent);
  assert.equal(endEvent.sessionContext?.selectionState?.family, 'entity_overview');
  assertExhausted();
});

test('chat route strips tool debug and message debug for non-admin users', async () => {
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
      },
      {
        chunks: [
          { type: 'text', text: 'A Short Hike and Unpacking are two good starting points.' },
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
          total_found: 2,
          debug: {
            searchCounts: {
              final_count: 2,
            },
            searchSteps: ['catalog lookup'],
          },
        },
      },
    ],
    userRole: 'user',
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const toolResultEvents = getToolResultEvents(events);
  const endEvent = getEndEvent(events);

  assert.equal(toolResultEvents.length, 1);
  assert.equal(toolResultEvents[0]?.result.debug, undefined);
  assert.ok(endEvent);
  assert.equal(endEvent.debug, undefined);
  assertExhausted();
});

test('chat route strips tiger routing metadata for non-admin users', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'games like Hades' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
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
    userRole: 'user',
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.ok(endEvent);
  assert.equal(endEvent.debug, undefined);
  assert.equal(endEvent.tigerPrimary, undefined);
  assert.equal(endEvent.tigerShadow, undefined);
  assertExhausted();
});

test('chat route keeps tiger routing metadata for admin users', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'games like Hades' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
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
    userRole: 'admin',
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const endEvent = getEndEvent(events);

  assert.ok(endEvent);
  assert.ok(endEvent.debug);
  assert.equal(endEvent.tigerPrimary?.route, 'primary_success');
  assertExhausted();
});

test('chat route can return a Tiger primary deterministic answer with continuable session state', async () => {
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

test('chat route returns Tiger primary momentum answers with server follow-up suggestions', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'What games are trending this week?' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          followUpSuggestions: [
            {
              category: 'game',
              label: 'What changed for Breakout Hit?',
              query: 'What changed for Breakout Hit this week?',
            },
          ],
          info: {
            attempts: [{ contractName: 'discoverMomentum', status: 'success', timingMs: 6 }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'momentum_discovery',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'Breakout Hit currently leads this set by Momentum Score.',
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
  assert.equal(textEvents[0]?.delta, 'Breakout Hit currently leads this set by Momentum Score.');
  assert.ok(endEvent);
  assert.equal(endEvent.tigerPrimary?.matchedIntent, 'momentum_discovery');
  assert.equal(endEvent.followUpSuggestions?.[0]?.query, 'What changed for Breakout Hit this week?');
  assertExhausted();
});

test('chat route stores continuable Tiger momentum result sets in session context', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'What games have the most players right now?' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: {
            contractName: 'discoverMomentum',
            request: {
              limit: 3,
              sortBy: 'ccu_peak',
              timeframe: 'current',
            },
            response: {
              filtersApplied: ['sort_by: ccu_peak', 'timeframe: current'],
              items: [
                { appid: 730, name: 'Counter-Strike 2' },
                { appid: 570, name: 'Dota 2' },
                { appid: 320, name: 'Slay the Spire 2' },
              ],
              rankingDefinition: 'Peak CCU uses the latest 24-hour concurrent-player snapshot.',
              rankingLabel: 'Peak CCU',
              sufficientToAnswer: true,
              timeframe: 'current',
              timeframeLabel: 'Current snapshot',
            },
          },
          info: {
            attempts: [{ contractName: 'discoverMomentum', status: 'success', timingMs: 6 }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'momentum_discovery',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'Counter-Strike 2 currently leads this set by Peak CCU.',
          sessionState: {
            lastAnswer: {
              family: 'momentum_discovery',
              summary: 'System answered momentum_discovery.',
            },
            requestState: {
              canonicalArgs: {
                limit: 3,
                sortBy: 'ccu_peak',
                timeframe: 'current',
              },
              contractName: 'discoverMomentum',
              entityKind: 'game',
              family: 'momentum_discovery',
              metric: 'ccu_peak',
              momentumPromptFamily: 'current_players',
              previewItems: [
                {
                  entityUid: null,
                  label: 'Counter-Strike 2',
                  ordinal: 1,
                  platformEntityId: 730,
                },
                {
                  entityUid: null,
                  label: 'Dota 2',
                  ordinal: 2,
                  platformEntityId: 570,
                },
                {
                  entityUid: null,
                  label: 'Slay the Spire 2',
                  ordinal: 3,
                  platformEntityId: 320,
                },
              ],
              timeframe: 'current',
              trendType: null,
              updatedAt: '2026-04-04T00:00:00.000Z',
            },
            selectionState: null,
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

  assert.ok(endEvent);
  assert.equal(endEvent.sessionContext?.resultSet?.sourceContract, 'discoverMomentum');
  assert.equal(endEvent.sessionContext?.resultSet?.sourceTool, 'screen_games');
  assert.deepEqual(endEvent.sessionContext?.resultSet?.shownIds, [730, 570, 320]);
  assert.equal(endEvent.sessionContext?.requestState?.momentumPromptFamily, 'current_players');
  assertExhausted();
});

test('chat route stores Tiger request state for ranking answers', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'What are the biggest games?' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: {
            contractName: 'rankEntities',
            request: {
              entityKind: 'game',
              limit: 10,
              metric: 'owners_midpoint',
              sortDirection: 'desc',
            },
            response: {
              entityKind: 'game',
              items: [
                {
                  displayName: 'Counter-Strike 2',
                  entityKind: 'game',
                  entityUid: 'game:steam:730',
                  metricValue: 150000000,
                  metrics: {
                    ccuPeak: 1404982,
                    gameCount: null,
                    ownersMidpoint: 150000000,
                    reviewScore: 88,
                    totalReviews: 9000000,
                  },
                  platform: 'steam',
                  platformEntityId: '730',
                  rank: 1,
                },
              ],
              metric: 'owners_midpoint',
              sufficientToAnswer: true,
            },
          },
          info: {
            attempts: [{ contractName: 'rankEntities', status: 'success', timingMs: 5 }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_ranking',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'Counter-Strike 2 leads by owners.',
          sessionState: {
            lastAnswer: {
              family: 'entity_ranking',
              summary: 'System answered entity_ranking.',
            },
            requestState: {
              canonicalArgs: {
                entityKind: 'game',
                limit: 10,
                metric: 'owners_midpoint',
                sortDirection: 'desc',
              },
              contractName: 'rankEntities',
              entityKind: 'game',
              family: 'entity_ranking',
              metric: 'owners_midpoint',
              previewItems: [
                {
                  entityUid: 'game:steam:730',
                  label: 'Counter-Strike 2',
                  ordinal: 1,
                  platformEntityId: '730',
                },
              ],
              updatedAt: '2026-04-04T00:00:00.000Z',
            },
            selectionState: null,
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

  assert.ok(endEvent);
  assert.equal(endEvent.sessionContext?.requestState?.family, 'entity_ranking');
  assert.equal(endEvent.sessionContext?.requestState?.metric, 'owners_midpoint');
  assert.equal(endEvent.sessionContext?.candidateSet?.names[0], 'Counter-Strike 2');
  assertExhausted();
});

test('chat route continues Tiger momentum result sets for natural follow-ups like "show me more"', async () => {
  const priorContext: SessionChatContext = {
    version: 1,
    entities: [],
    constraints: [],
    lastAnswer: null,
    resultSet: {
      continuationToken: null,
      continuable: true,
      family: 'momentum',
      itemKind: 'games',
      lastPageSize: 3,
      shownIds: [730, 570, 320],
      sourceArgs: {
        sortBy: 'ccu_peak',
        timeframe: 'current',
      },
      sourceContract: 'discoverMomentum',
      sourceTool: 'screen_games',
      totalFound: null,
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    updatedAt: '2026-04-01T00:00:00.000Z',
  };

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'show me more' }],
      sessionContext: priorContext,
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    queryApiCalls: [
      {
        assertBody: (body) => {
          assert.deepEqual(body, {
            continuationToken: null,
            requestedCount: 3,
            sourceArgs: {
              excludeAppIds: [730, 570, 320],
              sortBy: 'ccu_peak',
              timeframe: 'current',
            },
            sourceContract: 'discoverMomentum',
          });
        },
        expectedPath: '/v1/contracts/continue-result-set',
        response: {
          data: {
            continuationToken: null,
            effectiveArgs: {
              excludeAppIds: [730, 570, 320],
              limit: 3,
              sortBy: 'ccu_peak',
              timeframe: 'current',
            },
            exhausted: false,
            provenance: {
              capturedAt: '2026-04-01T00:00:00.000Z',
              source: 'tiger',
              tables: ['legacy.apps', 'legacy.latest_daily_metrics'],
            },
            result: {
              filtersApplied: ['sort_by: ccu_peak', 'timeframe: current'],
              items: [
                {
                  appid: 440,
                  ccuPeak: 88000,
                  name: 'Team Fortress 2',
                  supportLevel: 'medium',
                  supportReasons: ['Legacy player demand remains durable.'],
                  totalReviews: 1200000,
                },
                {
                  appid: 1172470,
                  ccuPeak: 76000,
                  name: 'Apex Legends',
                  supportLevel: 'medium',
                  supportReasons: ['The active-player baseline is still strong.'],
                  totalReviews: 900000,
                },
                {
                  appid: 271590,
                  ccuPeak: 69000,
                  name: 'Grand Theft Auto V',
                  supportLevel: 'medium',
                  supportReasons: ['Peak concurrency remains high.'],
                  totalReviews: 1800000,
                },
              ],
              rankingDefinition: 'Peak CCU uses the latest 24-hour concurrent-player snapshot.',
              rankingLabel: 'Peak CCU',
              sufficientToAnswer: true,
              timeframe: 'current',
              timeframeLabel: 'Current snapshot',
            },
            sourceContract: 'discoverMomentum',
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
  const textEvents = getTextEvents(events);
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), ['tool_start', 'tool_result', 'text_delta', 'message_end']);
  assert.equal(textEvents.length, 1);
  assert.ok(textEvents[0]?.delta.includes('Peak CCU'));
  assert.ok(endEvent);
  assert.equal(endEvent.sessionContext?.resultSet?.sourceContract, 'discoverMomentum');
  assert.deepEqual(endEvent.sessionContext?.resultSet?.shownIds, [730, 570, 320, 440, 1172470, 271590]);
  assert.equal(trace.queryApiCalls.length, 1);
  assert.equal(trace.tigerPrimaryCalls.length, 0);
  assertExhausted();
});

test('chat route preserves review-trend request families across Tiger continuations', async () => {
  const priorContext: SessionChatContext = {
    version: 1,
    entities: [],
    constraints: [],
    lastAnswer: null,
    requestState: {
      canonicalArgs: {
        filters: {
          maxSentimentDelta: -3,
          minCcu: 100,
          minReviews: 10000,
          minReviewsAdded30d: 25,
        },
        limit: 3,
        sortBy: 'total_reviews',
        sortDirection: 'desc',
        timeframe: '30d',
        trendType: null,
      },
      contractName: 'discoverMomentum',
      entityKind: 'game',
      family: 'momentum_discovery',
      metric: 'total_reviews',
      momentumPromptFamily: 'review_sentiment_down',
      previewItems: [
        {
          entityUid: 'game:steam:2668510',
          label: 'Example Game',
          ordinal: 1,
          platformEntityId: 2668510,
        },
      ],
      timeframe: '30d',
      trendType: null,
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    resultSet: {
      continuationToken: null,
      continuable: true,
      family: 'momentum',
      itemKind: 'games',
      lastPageSize: 3,
      shownIds: [2668510, 2668520, 2668530],
      sourceArgs: {
        filters: {
          maxSentimentDelta: -3,
          minCcu: 100,
          minReviews: 10000,
          minReviewsAdded30d: 25,
        },
        sortBy: 'total_reviews',
        sortDirection: 'desc',
        timeframe: '30d',
      },
      sourceContract: 'discoverMomentum',
      sourceTool: 'screen_games',
      totalFound: null,
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    updatedAt: '2026-04-01T00:00:00.000Z',
  };

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'show me more' }],
      sessionContext: priorContext,
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    queryApiCalls: [
      {
        assertBody: (body) => {
          assert.deepEqual(body, {
            continuationToken: null,
            requestedCount: 3,
            sourceArgs: {
              excludeAppIds: [2668510, 2668520, 2668530],
              filters: {
                maxSentimentDelta: -3,
                minCcu: 100,
                minReviews: 10000,
                minReviewsAdded30d: 25,
              },
              sortBy: 'total_reviews',
              sortDirection: 'desc',
              timeframe: '30d',
            },
            sourceContract: 'discoverMomentum',
          });
        },
        expectedPath: '/v1/contracts/continue-result-set',
        response: {
          data: {
            continuationToken: null,
            effectiveArgs: {
              excludeAppIds: [2668510, 2668520, 2668530],
              filters: {
                maxSentimentDelta: -3,
                minCcu: 100,
                minReviews: 10000,
                minReviewsAdded30d: 25,
              },
              limit: 3,
              sortBy: 'total_reviews',
              sortDirection: 'desc',
              timeframe: '30d',
            },
            exhausted: false,
            provenance: {
              capturedAt: '2026-04-01T00:00:00.000Z',
              source: 'tiger',
              tables: ['legacy.apps', 'legacy.latest_daily_metrics'],
            },
            result: {
              filtersApplied: [
                'sort_by: total_reviews',
                'timeframe: 30d',
                'min_reviews: 10000',
                'min_ccu: 100',
                'min_reviews_added_30d: 25',
                'max_sentiment_delta: -3',
              ],
              items: [
                {
                  appid: 2668540,
                  ccuPeak: 3900,
                  entityUid: 'game:steam:2668540',
                  isFree: false,
                  name: 'Follow-up Game',
                  reviewPercentage: 72,
                  reviewsAdded30d: 180,
                  sentimentDelta: -3.8,
                  supportLevel: 'high',
                  supportReasons: ['Sentiment fell by 3.8 points.'],
                  totalReviews: 16000,
                  trendDirection: 'down',
                },
              ],
              rankingDefinition: 'Total reviews ranks titles by lifetime Steam review volume.',
              rankingLabel: 'Total Reviews',
              sortBy: 'total_reviews',
              sortDirection: 'desc',
              sufficientToAnswer: true,
              timeframe: '30d',
              timeframeLabel: 'Last 30 days',
              trendType: null,
            },
            sourceContract: 'discoverMomentum',
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
  const endEvent = getEndEvent(events);

  assert.ok(endEvent);
  assert.equal(endEvent.sessionContext?.requestState?.momentumPromptFamily, 'review_sentiment_down');
  assertExhausted();
});

test('chat route uses review-trend-aware Tiger-only fallback copy for empty weekly sentiment retries', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'this week instead' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          info: {
            attempts: [
              {
                contractName: 'discoverMomentum',
                reason: 'The broad weekly review-sentiment screen was too sparse, so the system retried with the market-leader floor relaxed.',
                resultCount: 0,
                status: 'skipped',
                sufficientToAnswer: false,
                timingMs: 5,
              },
              {
                contractName: 'discoverMomentum',
                reason: 'No qualifying titles met the weekly review-sentiment screen even after relaxing the popularity floor.',
                resultCount: 0,
                status: 'skipped',
                sufficientToAnswer: false,
                timingMs: 4,
              },
            ],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'momentum_discovery',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'fallback_to_legacy',
          },
          renderedText: null,
          sessionState: null,
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const text = getTextEvents(events)[0]?.delta ?? '';
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), ['text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(endEvent.tigerPrimary?.route, 'primary_success');
  assert.match(text, /week-over-week review-sentiment set/i);
  assert.match(text, /established mid-tier games/i);
  assert.match(text, /switch back to the 30-day view/i);
  assertExhausted();
});

test('chat route uses compare-specific Tiger-only fallback copy for Tiger compare runtime failures', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'compare Marathon to Destiny 2' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          info: {
            attempts: [
              {
                contractName: 'compareEntities',
                httpStatus: 503,
                reason: 'fetch failed',
                status: 'error',
                timingMs: 6,
              },
            ],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_compare',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'error',
          },
          renderedText: null,
          sessionState: null,
        },
      },
    ],
  });

  const response = await handleChatStreamRequest(request, {
    deps,
    requireEvalSecret: false,
  });

  const events = await collectStreamEvents(response);
  const text = getTextEvents(events)[0]?.delta ?? '';
  const endEvent = getEndEvent(events);

  assert.deepEqual(getEventTypes(events), ['text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(endEvent.tigerPrimary?.route, 'primary_success');
  assert.match(text, /complete that comparison from PublisherIQ data right now/i);
  assert.doesNotMatch(text, /route that comparison cleanly/i);
  assertExhausted();
});

test('chat route includes execution trace metadata for eval requests', async (t) => {
  setScopedEnv(t, 'CHAT_EVAL_SECRET', 'test-secret');
  setScopedEnv(t, 'CHAT_TIGER_LEGACY_FALLBACK_ENABLED', 'true');

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

test('chat route keeps Tiger-owned fallback answers off the legacy tool loop when Tiger primary is enabled', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'how many players do fromsoftware games have?' }],
    },
  });

  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          info: {
            attempts: [
              {
                contractName: 'getEntityOverview',
                reason: 'The Tiger primary entity overview path was skipped because the prompt did not resolve to a stable entity.',
                status: 'skipped',
              },
            ],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_overview',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'fallback_to_legacy',
          },
          renderedText: null,
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

  assert.deepEqual(getEventTypes(events), ['text_delta', 'message_end']);
  assert.ok(endEvent);
  assert.equal(trace.providerCalls.length, 0);
  assert.equal(endEvent.tigerPrimary?.route, 'primary_success');
  assert.equal(endEvent.tigerPrimary?.matchedIntent, 'entity_overview');
  assert.match(getTextEvents(events)[0]?.delta ?? '', /couldn't resolve a single stable game or company/i);
  assertExhausted();
});

test('chat route includes execution trace metadata for local audit-trace requests without eval secret', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'compare hades and dead cells by reviews' }],
    },
    headers: {
      'x-chat-eval-trace': '1',
    },
    url: 'http://localhost:3023/api/chat/stream',
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: {
            contractName: 'compareEntities',
            request: {
              entityUids: ['steam:game:1145360', 'steam:game:588650'],
              metrics: ['total_reviews'],
            },
            response: {
              entityKind: 'game',
              highlights: ['Hades leads on total reviews.'],
              items: [],
              metrics: ['total_reviews'],
              sufficientToAnswer: true,
            },
          },
          info: {
            attempts: [{ contractName: 'compareEntities', status: 'success', timingMs: 7 }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_compare',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'Tiger compare answer',
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

  assert.ok(endEvent);
  assert.equal(endEvent.tigerPrimary?.route, 'primary_success');
  assert.deepEqual(
    (endEvent.executionTrace ?? []).map((entry) => `${entry.stage}:${entry.name}:${entry.status}`),
    ['tiger_primary:compareEntities:success']
  );
  assert.equal(endEvent.executionTrace?.[0]?.readOccurred, true);
  assert.deepEqual(endEvent.executionTrace?.[0]?.backendKinds, ['tiger_query_api']);
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
              tables: [
                'legacy.apps',
                'legacy.latest_daily_metrics',
                'legacy.app_publishers',
                'legacy.app_developers',
                'legacy.app_genres',
                'legacy.steam_genres',
                'legacy.app_steam_tags',
                'legacy.steam_tags',
              ],
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
      contractName: 'compareEntities' as const,
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
    contractResult: {
      contractName: 'traceMetricHistory' as const,
      request: {
        endDate: '2026-04-05',
        entityUid: '29e00ab0-9557-57e7-bae5-19d19d27c711',
        metrics: ['review_score'],
        startDate: '2026-03-01',
      },
      response: {
        endDate: '2026-04-05',
        entity: {
          displayName: 'Hades',
          entityKind: 'game',
          entityUid: '29e00ab0-9557-57e7-bae5-19d19d27c711',
          platform: 'steam',
          platformEntityId: '1145360',
        },
        metrics: ['review_score'],
        provenance: {
          capturedAt: '2026-04-05T00:00:00.000Z',
          dataSources: ['query_api:traceMetricHistory'],
        },
        series: [
          {
            metric: 'review_score',
            points: [
              { date: '2026-03-01', value: 96 },
              { date: '2026-04-05', value: 97 },
            ],
            summary: {
              deltaAbs: 1,
              deltaPct: 1.04,
              firstDate: '2026-03-01',
              lastDate: '2026-04-05',
              latestValue: 97,
              pointCount: 2,
              startValue: 96,
            },
          },
        ],
        startDate: '2026-03-01',
        sufficientToAnswer: true,
      },
    },
    matchedIntent: 'metric_history' as const,
    prompt: 'how has Hades review score changed',
    renderedText: 'Here is the Tiger metric history for Hades.',
    testName: 'metric history',
  },
  {
    attemptContract: 'getYoutubeGameCoverage',
    contractResult: {
      contractName: 'getYoutubeGameCoverage' as const,
      request: {
        entityUid: '29e00ab0-9557-57e7-bae5-19d19d27c711',
        limit: 10,
        offset: 0,
        view: 'latest_videos',
        window: '7d',
      },
      response: {
        availability: {
          blockingTables: [],
          reason: null,
          state: 'ready',
        },
        cadence: null,
        contentClass: null,
        contentMix: [],
        creators: [],
        entity: {
          displayName: 'Hades',
          entityKind: 'game',
          entityUid: '29e00ab0-9557-57e7-bae5-19d19d27c711',
          platform: 'steam',
          platformEntityId: '1145360',
        },
        items: [
          {
            channelCountry: 'US',
            channelId: 'channel-1',
            channelSubscriberCount: 240000,
            channelTitle: 'Creator One',
            commentCount: 44,
            confidenceScore: 0.99,
            contentClass: 'standard_video',
            firstSnapshotAt: null,
            growthPct: null,
            lastSnapshotAt: null,
            likeCount: 550,
            matchedAlias: 'Hades',
            publishedAt: '2026-04-12T07:00:00.000Z',
            title: 'Hades Build Guide',
            url: 'https://www.youtube.com/watch?v=video-1',
            videoId: 'video-1',
            viewCount: 32037,
            viewDelta: null,
          },
        ],
        limit: 10,
        pagination: {
          hasNextPage: true,
          hasPreviousPage: false,
          limit: 10,
          offset: 0,
          totalRows: 14,
        },
        provenance: {
          capturedAt: '2026-04-12T00:00:00.000Z',
          dataSources: ['query_api:getYoutubeGameCoverage'],
        },
        resolvedWindow: '7d',
        sufficientToAnswer: true,
        summary: {
          distinctUploadChannels30d: 22,
          distinctUploadChannels7d: 12,
          freshestMatchedUploadAt: '2026-04-12T07:00:00.000Z',
          latestSnapshotAt: '2026-04-12T08:00:00.000Z',
          matchedPrimaryVideoCount: 40,
          matchedVideoViewDelta1d: 12000,
          matchedVideoViewDelta7d: 48000,
          newMatchedVideos1d: 4,
          newMatchedVideos30d: 40,
          newMatchedVideos7d: 19,
        },
        view: 'latest_videos',
      },
    },
    matchedIntent: 'youtube_game_activity' as const,
    prompt: 'show the latest YouTube videos for Hades in the last 7 days',
    renderedText: 'Here are the latest YouTube videos for Hades.',
    testName: 'YouTube latest videos',
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
] as const;

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
    if (testCase.contractResult?.contractName === 'traceMetricHistory') {
      assert.deepEqual(endEvent.renderData, {
        endDate: '2026-04-05',
        entityName: 'Hades',
        kind: 'metric_history',
        series: [
          {
            metric: 'review_score',
            points: [
              { date: '2026-03-01', value: 96 },
              { date: '2026-04-05', value: 97 },
            ],
            summary: {
              deltaAbs: 1,
              deltaPct: 1.04,
              firstDate: '2026-03-01',
              lastDate: '2026-04-05',
              latestValue: 97,
              pointCount: 2,
              startValue: 96,
            },
          },
        ],
        startDate: '2026-03-01',
      });
    }
    if (testCase.contractResult?.contractName === 'getYoutubeGameCoverage') {
      const youtubeRenderData = endEvent.renderData;
      assert.ok(youtubeRenderData && youtubeRenderData.kind === 'youtube_game_activity');
      if (!youtubeRenderData || youtubeRenderData.kind !== 'youtube_game_activity') {
        assert.fail('Expected YouTube game activity render data');
      }

      assert.equal(youtubeRenderData.request.entityUid, '29e00ab0-9557-57e7-bae5-19d19d27c711');
      assert.equal(youtubeRenderData.request.view, 'latest_videos');
      assert.equal(youtubeRenderData.request.window, '7d');
      assert.deepEqual(youtubeRenderData.pagination, {
        hasNextPage: true,
        hasPreviousPage: false,
        limit: 10,
        offset: 0,
        totalRows: 14,
      });
      assert.deepEqual(youtubeRenderData.table.columns.map((column) => column.label), [
        'Video',
        'Channel',
        'Published',
        'Views',
        'Format',
      ]);
      assert.equal(youtubeRenderData.table.rows[0]?.cells[0]?.href, 'https://www.youtube.com/watch?v=video-1');
      assert.equal(youtubeRenderData.table.rows[0]?.cells[1]?.href, 'https://www.youtube.com/channel/channel-1');
      assert.equal(youtubeRenderData.table.rows[0]?.cells[3]?.text, '32,037');
    }
    if (testCase.contractResult?.contractName === 'compareEntities') {
      assert.equal(endEvent.sessionContext?.candidateSet?.sourceTool, 'compareEntities');
      assert.deepEqual(endEvent.sessionContext?.candidateSet?.names, ['Hades', 'Dead Cells']);
    } else {
      assert.equal(endEvent.sessionContext, null);
    }
    assert.equal(trace.providerCalls.length, 0);
    assertExhausted();
  });
}

test('chat route preserves Tiger primary selection state for deterministic clarification turns', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'compare FromSoftware to Rockstar Games' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          info: {
            attempts: [],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_compare',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'I found multiple plausible matches for this Tiger request.',
          sessionState: {
            lastAnswer: {
              clarificationNeeded: true,
              family: 'entity_compare',
              summary: 'Tiger needs clarification for entity_compare.',
            },
            selectionState: {
              family: 'entity_compare',
              slots: [{
                candidates: [{
                  displayName: 'FromSoftware',
                  entityKind: 'developer',
                  entityUid: 'developer:publisheriq:1',
                  matchQuality: 'exact',
                  matchSource: null,
                  ordinal: 1,
                  platform: 'publisheriq',
                  platformEntityId: null,
                  releaseYear: null,
                  resolutionTier: null,
                  score: 100,
                  totalReviews: null,
                }],
                continuationToken: null,
                expectedEntityKind: 'developer',
                label: 'FromSoftware',
                query: 'FromSoftware',
                requiresClarification: true,
                selectedEntityUid: null,
                slotId: 'compare:0',
                totalCandidates: 1,
              }],
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

  assert.ok(endEvent);
  assert.deepEqual(endEvent.renderData, {
    family: 'entity_compare',
    kind: 'entity_clarification',
    originalPrompt: 'compare FromSoftware to Rockstar Games',
    slots: [
      {
        candidates: [{
          displayName: 'FromSoftware',
          entityKind: 'developer',
          entityUid: 'developer:publisheriq:1',
          matchQuality: 'exact',
          matchSource: null,
          ordinal: 1,
          platform: 'publisheriq',
          releaseYear: null,
          resolutionTier: null,
          selectedEntity: {
            displayName: 'FromSoftware',
            entityKind: 'developer',
            entityUid: 'developer:publisheriq:1',
            matchQuality: 'exact',
            platform: 'publisheriq',
          },
          totalReviews: null,
        }],
        continuationToken: null,
        expectedEntityKind: 'developer',
        label: 'FromSoftware',
        query: 'FromSoftware',
        requiresClarification: true,
        slotId: 'compare:0',
        totalCandidates: 1,
      },
    ],
  });
  assert.equal(endEvent.sessionContext?.selectionState?.family, 'entity_compare');
  assert.equal(endEvent.sessionContext?.lastAnswer?.clarificationNeeded, true);
  assertExhausted();
});

test('chat route strips empty Tiger clarification state before emitting message_end', async () => {
  const request = createJsonNextRequest({
    body: {
      messages: [{ role: 'user', content: 'What is the CCU for Counter-Strike 2?' }],
    },
  });

  const { assertExhausted, deps } = createScriptedChatDeps({
    tigerPrimaryCalls: [
      {
        response: {
          contractResult: null,
          info: {
            attempts: [{
              contractName: 'resolveEntities',
              httpStatus: 500,
              reason: 'Internal server error',
              status: 'error',
              timingMs: 570,
            }],
            cohort: 'default',
            enabled: true,
            matchedIntent: 'entity_overview',
            mode: 'all',
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: 'I found a likely match for Counter-Strike 2. Choose the exact one below.',
          sessionState: {
            lastAnswer: {
              clarificationNeeded: true,
              family: 'entity_overview',
              summary: 'Tiger needs clarification for entity_overview.',
            },
            selectionState: {
              family: 'entity_overview',
              slots: [{
                candidates: [],
                continuationToken: null,
                expectedEntityKind: 'game',
                label: 'Counter-Strike 2',
                query: 'Counter-Strike 2',
                requiresClarification: true,
                selectedEntityUid: null,
                slotId: 'primary',
                totalCandidates: 0,
              }],
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

  assert.ok(endEvent);
  assert.equal(endEvent.renderData, undefined);
  assert.equal(endEvent.sessionContext?.selectionState ?? null, null);
  assert.equal(endEvent.sessionContext?.lastAnswer?.clarificationNeeded, false);
  assert.equal(
    endEvent.sessionContext?.lastAnswer?.summary,
    'System could not resolve a stable entity for entity_overview.'
  );
  assertExhausted();
});

test('chat route preserves Tiger fallback metadata and attaches Tiger shadow metadata for legacy recent-news topic answers', async (t) => {
  setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');
  setScopedEnv(t, 'CHAT_TIGER_LEGACY_FALLBACK_ENABLED', 'true');

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
