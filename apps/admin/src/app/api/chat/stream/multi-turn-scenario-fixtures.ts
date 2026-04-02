import assert from 'node:assert/strict';

import type { MessageEndEvent, StreamEvent, StreamEventType, TextDeltaEvent } from '@/lib/llm/streaming-types';
import type {
  ProviderInvocationPlan,
  ScriptedProviderTrace,
  ToolExecutionPlan,
} from './test-support';

interface ScenarioTurnAssertionParams {
  events: StreamEvent[];
  finalEvent: MessageEndEvent | null;
  providerCalls: ScriptedProviderTrace[];
  text: string;
}

export interface DeterministicScenarioTurnPlan {
  assertTurn: (params: ScenarioTurnAssertionParams) => void;
  providerInvocations: ProviderInvocationPlan[];
  toolExecutions: ToolExecutionPlan[];
}

export interface DeterministicScenarioDefinition {
  turns: DeterministicScenarioTurnPlan[];
}

function toolSequence(
  toolCalls: Array<{ arguments: Record<string, unknown>; id: string; name: string }>
): ProviderInvocationPlan['chunks'] {
  return [
    ...toolCalls.flatMap((toolCall) => [
      { type: 'tool_use_start' as const, toolCall },
      { type: 'tool_use_end' as const, toolCall },
    ]),
    { type: 'done' as const },
  ];
}

function textOnly(text: string): ProviderInvocationPlan['chunks'] {
  return [
    { type: 'text', text },
    { type: 'done' },
  ];
}

function getEventTypes(events: StreamEvent[]): StreamEventType[] {
  return events.map((event) => event.type);
}

function assertSingleMessageEnd(finalEvent: MessageEndEvent | null, events: StreamEvent[]): void {
  assert.ok(finalEvent, 'expected a message_end event');
  assert.equal(
    events.filter((event) => event.type === 'message_end').length,
    1,
    'expected exactly one message_end event'
  );
}

function assertTextIncludes(text: string, expected: string): void {
  assert.ok(
    text.includes(expected),
    `expected streamed text to include "${expected}", received "${text}"`
  );
}

function assertSystemPromptIncludes(
  providerCall: ScriptedProviderTrace | undefined,
  snippets: string[]
): void {
  assert.ok(providerCall, 'expected a provider call trace');
  const systemMessage = providerCall.messages[0];
  assert.equal(systemMessage?.role, 'system');
  for (const snippet of snippets) {
    assert.ok(
      systemMessage?.content.includes(snippet),
      `expected system prompt to include "${snippet}"`
    );
  }
}

function assertTurnEventShape(
  params: ScenarioTurnAssertionParams,
  expectedTypes: StreamEventType[]
): void {
  assertSingleMessageEnd(params.finalEvent, params.events);
  assert.deepEqual(getEventTypes(params.events), expectedTypes);
  assert.ok(params.text.length > 0, 'expected non-empty streamed text');
}

const narrowDiscoveryTurnOneResult = {
  ranking_definition: 'Ordered by current momentum score across indie-leaning titles in the requested window.',
  ranking_label: 'Momentum Score',
  recommended_columns: ['Game', 'Momentum Score', 'Total Reviews'],
  results: [
    { appid: 2379780, name: 'Balatro', momentumScore: 98, totalReviews: 92000 },
    { appid: 813230, name: 'ANIMAL WELL', momentumScore: 94, totalReviews: 18000 },
    { appid: 1562430, name: 'DREDGE', momentumScore: 89, totalReviews: 35000 },
  ],
  success: true,
  sufficient_to_answer: true,
  timeframe_label: 'the last 30 days',
  total_found: 3,
};

const narrowDiscoveryTurnTwoResult = {
  ranking_definition: 'Ordered by current momentum score across indie-leaning titles in the requested window.',
  ranking_label: 'Momentum Score',
  recommended_columns: ['Game', 'Momentum Score', 'Total Reviews', 'Price'],
  results: [
    { appid: 2379780, name: 'Balatro', momentumScore: 98, priceCents: 1499, totalReviews: 92000 },
    { appid: 813230, name: 'ANIMAL WELL', momentumScore: 94, priceCents: 1999, totalReviews: 18000 },
  ],
  success: true,
  sufficient_to_answer: true,
  timeframe_label: 'the last 30 days',
  total_found: 2,
};

const narrowDiscoveryTurnThreeResult = {
  ranking_definition: 'Ordered by current momentum score across indie-leaning titles in the requested window.',
  ranking_label: 'Momentum Score',
  recommended_columns: ['Game', 'Momentum Score', 'Total Reviews'],
  results: [
    { appid: 2379780, name: 'Balatro', momentumScore: 98, totalReviews: 92000 },
  ],
  success: true,
  sufficient_to_answer: true,
  timeframe_label: 'the last 30 days',
  total_found: 1,
};

export const MULTI_TURN_SCENARIO_FIXTURES: Record<string, DeterministicScenarioDefinition> = {
  narrow_discovery_chain: {
    turns: [
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assert.ok(finalEvent?.sessionContext?.resultSet);
          assert.equal(finalEvent.sessionContext?.resultSet?.sourceTool, 'screen_games');
          assert.deepEqual(finalEvent.sessionContext?.candidateSet?.names, ['Balatro', 'ANIMAL WELL', 'DREDGE']);
          assertTextIncludes(text, 'Balatro');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: {
                  indie_heuristic: true,
                  limit: 3,
                  sort_by: 'momentum_score',
                  timeframe: '30d',
                },
                id: 'narrow-discovery-1',
                name: 'screen_games',
              },
            ]),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'screen_games',
            result: narrowDiscoveryTurnOneResult,
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'Current candidate set (games): Balatro, ANIMAL WELL, DREDGE',
            'Most recent continuable result set (games via screen_games): shown 3 of 3',
          ]);
          assert.deepEqual(finalEvent?.sessionContext?.candidateSet?.names, ['Balatro', 'ANIMAL WELL']);
          assertTextIncludes(text, '$19.99');
        },
        providerInvocations: [
          {
            assertInvocation: ({ messages }) => {
              assert.equal(messages.at(-1)?.content, 'Only the ones under $20');
            },
            chunks: toolSequence([
              {
                arguments: {
                  filters: { max_price_cents: 2000 },
                  indie_heuristic: true,
                  limit: 3,
                  sort_by: 'momentum_score',
                  timeframe: '30d',
                },
                id: 'narrow-discovery-2',
                name: 'screen_games',
              },
            ]),
          },
        ],
        toolExecutions: [
          {
            assertArguments: (argumentsShape) => {
              const filters = argumentsShape.filters as Record<string, unknown>;
              assert.equal(filters.max_price_cents, 2000);
              assert.equal(filters.min_reviews_added_7d, 3);
            },
            expectedName: 'screen_games',
            result: narrowDiscoveryTurnTwoResult,
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'Current candidate set (games): Balatro, ANIMAL WELL',
            'Most recent continuable result set (games via screen_games): shown 2 of 2',
          ]);
          assert.deepEqual(finalEvent?.sessionContext?.candidateSet?.names, ['Balatro']);
          assertTextIncludes(text, 'Balatro');
        },
        providerInvocations: [
          {
            assertInvocation: ({ messages }) => {
              assert.equal(messages.at(-1)?.content, 'Which of those are Steam Deck verified?');
            },
            chunks: toolSequence([
              {
                arguments: {
                  filters: {
                    max_price_cents: 2000,
                    steam_deck: ['verified'],
                  },
                  indie_heuristic: true,
                  limit: 3,
                  sort_by: 'momentum_score',
                  timeframe: '30d',
                },
                id: 'narrow-discovery-3',
                name: 'screen_games',
              },
            ]),
          },
        ],
        toolExecutions: [
          {
            assertArguments: (argumentsShape) => {
              const filters = argumentsShape.filters as Record<string, unknown>;
              assert.equal(filters.max_price_cents, 2000);
              assert.equal(filters.min_reviews_added_7d, 3);
              assert.deepEqual(filters.steam_deck, ['verified']);
            },
            expectedName: 'screen_games',
            result: narrowDiscoveryTurnThreeResult,
          },
        ],
      },
    ],
  },
  publisher_followup_resolution: {
    turns: [
      {
        assertTurn: ({ events, finalEvent, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls: [], text },
            ['tool_start', 'tool_start', 'tool_result', 'tool_result', 'text_delta', 'message_end']
          );
          assert.deepEqual(
            finalEvent?.sessionContext?.entities.map((entity) => `${entity.kind}:${entity.name}`),
            ['game:Hades II', 'publisher:Supergiant Games']
          );
          assertTextIncludes(text, 'Hades II');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: { query: 'Hades II' },
                id: 'publisher-followup-lookup-game',
                name: 'lookup_games',
              },
              {
                arguments: { query: 'Supergiant Games' },
                id: 'publisher-followup-lookup-publisher',
                name: 'lookup_publishers',
              },
            ]),
          },
          {
            chunks: textOnly('Hades II is Supergiant Games\' next major release, and that gives us both the game and its publisher context for follow-ups.'),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'lookup_games',
            result: {
              canonicalResult: { id: 1145350, name: 'Hades II' },
              entityType: 'game',
              results: [{ appid: 1145350, name: 'Hades II' }],
              success: true,
              sufficient_to_answer: false,
              total_found: 1,
            },
          },
          {
            expectedName: 'lookup_publishers',
            result: {
              canonicalResult: { id: 200, name: 'Supergiant Games' },
              entityType: 'publisher',
              results: [{ id: 200, name: 'Supergiant Games' }],
              success: true,
              sufficient_to_answer: true,
              total_found: 1,
            },
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'Active entities: game:Hades II; publisher:Supergiant Games',
          ]);
          assert.deepEqual(
            finalEvent?.sessionContext?.candidateSet?.names,
            ['Motion Twin', 'Thunder Lotus Games', 'Mega Crit']
          );
          assertTextIncludes(text, 'Supergiant Games');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: {
                  entity_type: 'publisher',
                  limit: 3,
                  reference_name: 'Supergiant Games',
                },
                id: 'publisher-followup-similar',
                name: 'find_similar',
              },
            ]),
          },
          {
            chunks: textOnly('Supergiant Games clusters with similarly premium indie studios like Motion Twin, Thunder Lotus Games, and Mega Crit.'),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'find_similar',
            result: {
              entityType: 'publisher',
              reference: { id: 200, name: 'Supergiant Games', type: 'publisher' },
              results: [
                { id: 201, name: 'Motion Twin', score: 0.91 },
                { id: 202, name: 'Thunder Lotus Games', score: 0.89 },
                { id: 203, name: 'Mega Crit', score: 0.88 },
              ],
              success: true,
              sufficient_to_answer: true,
              total_found: 3,
            },
          },
        ],
      },
    ],
  },
  similarity_followup_narrowing: {
    turns: [
      {
        assertTurn: ({ events, finalEvent, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls: [], text },
            ['tool_start', 'tool_start', 'tool_result', 'tool_result', 'text_delta', 'message_end']
          );
          assert.deepEqual(
            finalEvent?.sessionContext?.entities.map((entity) => `${entity.kind}:${entity.name}`),
            ['game:Hades', 'game:Death\'s Door', 'game:Warm Snow', 'game:Dreamscaper']
          );
          assertTextIncludes(text, 'Hades');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: { query: 'Hades' },
                id: 'similarity-lookup-game',
                name: 'lookup_games',
              },
              {
                arguments: {
                  entity_type: 'game',
                  limit: 3,
                  min_review_percentage: 92,
                  reference_name: 'Hades',
                },
                id: 'similarity-find-similar',
                name: 'find_similar',
              },
            ]),
          },
          {
            chunks: textOnly('If you want Hades-like games with stronger review sentiment, Death\'s Door, Warm Snow, and Dreamscaper are the closest fits.'),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'lookup_games',
            result: {
              canonicalResult: { id: 1145360, name: 'Hades' },
              entityType: 'game',
              results: [{ appid: 1145360, name: 'Hades' }],
              success: true,
              sufficient_to_answer: false,
              total_found: 1,
            },
          },
          {
            expectedName: 'find_similar',
            result: {
              reference: { id: 1145360, name: 'Hades', type: 'game' },
              results: [
                { id: 894020, name: 'Death\'s Door', review_percentage: 93, total_reviews: 18934 },
                { id: 1296830, name: 'Warm Snow', review_percentage: 94, total_reviews: 9540 },
                { id: 1040420, name: 'Dreamscaper', review_percentage: 92, total_reviews: 8120 },
              ],
              success: true,
              sufficient_to_answer: true,
              total_found: 3,
            },
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'Active entities: game:Hades; game:Death\'s Door; game:Warm Snow; game:Dreamscaper',
            'Current candidate set (games): Death\'s Door, Warm Snow, Dreamscaper',
          ]);
          assert.deepEqual(finalEvent?.sessionContext?.candidateSet?.names, ['Warm Snow', 'Dreamscaper']);
          assertTextIncludes(text, '10K reviews');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: {
                  entity_type: 'game',
                  limit: 2,
                  max_total_reviews: 10000,
                  min_review_percentage: 92,
                  reference_name: 'Hades',
                },
                id: 'similarity-narrow-by-reviews',
                name: 'find_similar',
              },
            ]),
          },
          {
            chunks: textOnly('Under 10K reviews, Warm Snow and Dreamscaper are the surviving Hades-like matches.'),
          },
        ],
        toolExecutions: [
          {
            assertArguments: (argumentsShape) => {
              assert.equal(argumentsShape.max_total_reviews, 10000);
            },
            expectedName: 'find_similar',
            result: {
              reference: { id: 1145360, name: 'Hades', type: 'game' },
              results: [
                { id: 1296830, name: 'Warm Snow', review_percentage: 94, total_reviews: 9540 },
                { id: 1040420, name: 'Dreamscaper', review_percentage: 92, total_reviews: 8120 },
              ],
              success: true,
              sufficient_to_answer: true,
              total_found: 2,
            },
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'Active entities: game:Warm Snow; game:Dreamscaper',
            'Current candidate set (games): Warm Snow, Dreamscaper',
          ]);
          assert.deepEqual(finalEvent?.sessionContext?.candidateSet?.names, ['Warm Snow']);
          assertTextIncludes(text, 'Steam Deck verified');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: {
                  entity_type: 'game',
                  filters: { steam_deck: ['verified'] },
                  limit: 1,
                  max_total_reviews: 10000,
                  min_review_percentage: 92,
                  reference_name: 'Hades',
                },
                id: 'similarity-narrow-by-deck',
                name: 'find_similar',
              },
            ]),
          },
          {
            chunks: textOnly('Warm Snow is the Steam Deck verified option from that narrowed Hades-like set.'),
          },
        ],
        toolExecutions: [
          {
            assertArguments: (argumentsShape) => {
              assert.deepEqual(argumentsShape.filters, { steam_deck: ['verified'] });
            },
            expectedName: 'find_similar',
            result: {
              reference: { id: 1145360, name: 'Hades', type: 'game' },
              results: [
                { id: 1296830, name: 'Warm Snow', review_percentage: 94, steam_deck: 'verified', total_reviews: 9540 },
              ],
              success: true,
              sufficient_to_answer: true,
              total_found: 1,
            },
          },
        ],
      },
    ],
  },
  change_drilldown_chain: {
    turns: [
      {
        assertTurn: ({ events, finalEvent, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls: [], text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assert.equal(finalEvent?.sessionContext?.resultSet?.sourceTool, 'query_change_activity');
          assert.deepEqual(finalEvent?.sessionContext?.candidateSet?.kind, 'activities');
          assertTextIncludes(text, 'Steam page refreshes');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: { days: 14, limit: 3, sort_by: 'impact_score' },
                id: 'change-drilldown-ranked-set',
                name: 'query_change_activity',
              },
            ]),
          },
          {
            chunks: textOnly('The biggest Steam page refreshes lately include Hades II and a smaller set of store-page overhauls with strong visual or copy changes.'),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'query_change_activity',
            result: {
              results: [
                {
                  activityId: 'hades-ii-refresh-1',
                  label: 'Capsule and copy refresh',
                  name: 'Hades II',
                  occurredAt: '2026-03-28T12:00:00.000Z',
                },
                {
                  activityId: 'shapez-refresh-1',
                  label: 'Screenshot overhaul',
                  name: 'shapez 2',
                  occurredAt: '2026-03-27T12:00:00.000Z',
                },
              ],
              success: true,
              sufficient_to_answer: true,
              total_found: 2,
            },
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'Most recent continuable result set (activities via query_change_activity): shown 2 of 2',
          ]);
          assert.deepEqual(
            finalEvent?.sessionContext?.entities.map((entity) => `${entity.kind}:${entity.name}`),
            ['game:Hades II']
          );
          assertTextIncludes(text, 'Hades II');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: { appid: 1145350, days: 30, limit: 5 },
                id: 'change-drilldown-timeline',
                name: 'get_game_change_timeline',
              },
            ]),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'get_game_change_timeline',
            result: {
              app: { appid: 1145350, name: 'Hades II' },
              events: [
                {
                  afterText: 'New hand-painted capsule art',
                  beforeText: 'Earlier teaser capsule art',
                  label: 'Capsule art',
                  occurredAt: '2026-03-28T12:00:00.000Z',
                },
                {
                  afterText: 'Fight deeper into the Underworld.',
                  beforeText: 'Battle beyond the Underworld.',
                  label: 'Short description',
                  occurredAt: '2026-03-28T12:00:00.000Z',
                },
              ],
              success: true,
              sufficient_to_answer: true,
            },
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], ['Active entities: game:Hades II']);
          assert.deepEqual(
            finalEvent?.sessionContext?.entities.map((entity) => `${entity.kind}:${entity.name}`),
            ['game:Hades II']
          );
          assertTextIncludes(text, 'What Changed');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: { activityId: 'hades-ii-refresh-1', appid: 1145350 },
                id: 'change-drilldown-before-after',
                name: 'compare_change_before_after',
              },
            ]),
          },
        ],
        toolExecutions: [
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
                {
                  afterText: 'Fight deeper into the Underworld.',
                  beforeText: 'Battle beyond the Underworld.',
                  label: 'Short description',
                },
              ],
              selectedActivity: {
                headline: 'The latest Steam page refresh for Hades II tightened both the capsule art and the store copy.',
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
      },
    ],
  },
  no_match_recovery_chain: {
    turns: [
      {
        assertTurn: ({ events, finalEvent, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls: [], text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assert.equal(finalEvent?.sessionContext?.resultSet, null);
          assert.ok(finalEvent?.sessionContext?.lastAnswer?.noMatch);
          assert.equal(finalEvent?.sessionContext?.lastAnswer?.fallbackAction, 'retry_relaxed_once');
          assertTextIncludes(text, 'under $2');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: {
                  limit: 5,
                  max_price_cents: 200,
                  min_review_percentage: 85,
                  min_reviews: 100,
                  query: 'highly rated games released in the past year',
                  release_year: { gte: 2025 },
                },
                id: 'no-match-first-pass',
                name: 'search_games',
              },
            ]),
          },
          {
            chunks: textOnly('I could not find any highly rated releases from the past year under $2, so the first pass comes back empty under those exact constraints.'),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'search_games',
            result: {
              allow_follow_up_relaxation: true,
              results: [],
              success: true,
              sufficient_to_answer: true,
              total_found: 0,
            },
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'max_price_cents=200',
            'One controlled relaxation retry is allowed.',
          ]);
          assert.deepEqual(finalEvent?.sessionContext?.candidateSet?.names, ['Mouthwashing']);
          assertTextIncludes(text, 'under $5');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: {
                  limit: 5,
                  max_price_cents: 500,
                  min_review_percentage: 85,
                  min_reviews: 100,
                  query: 'highly rated games released in the past year',
                  release_year: { gte: 2025 },
                },
                id: 'no-match-relaxed-pass',
                name: 'search_games',
              },
            ]),
          },
          {
            chunks: textOnly('Relaxing the cap to under $5 surfaces Mouthwashing as the constrained follow-up match.'),
          },
        ],
        toolExecutions: [
          {
            assertArguments: (argumentsShape) => {
              assert.equal(argumentsShape.max_price_cents, 500);
            },
            expectedName: 'search_games',
            result: {
              results: [
                { appid: 2475490, name: 'Mouthwashing', price_cents: 499 },
              ],
              success: true,
              sufficient_to_answer: true,
              total_found: 1,
            },
          },
        ],
      },
    ],
  },
  company_followup_compare: {
    turns: [
      {
        assertTurn: ({ events, finalEvent, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls: [], text },
            ['tool_start', 'tool_start', 'tool_result', 'tool_result', 'text_delta', 'message_end']
          );
          assert.deepEqual(
            finalEvent?.sessionContext?.entities.map((entity) => `${entity.kind}:${entity.name}`),
            ['developer:FromSoftware', 'game:ELDEN RING', 'game:Armored Core VI Fires of Rubicon', 'game:Sekiro: Shadows Die Twice']
          );
          assert.equal(finalEvent?.sessionContext?.resultSet?.sourceTool, 'search_games');
          assertTextIncludes(text, 'FromSoftware');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: { query: 'FromSoftware' },
                id: 'company-compare-lookup-developer',
                name: 'lookup_developers',
              },
              {
                arguments: {
                  developer_ids: [300],
                  limit: 3,
                  query: 'games by FromSoftware',
                },
                id: 'company-compare-search-games',
                name: 'search_games',
              },
            ]),
          },
          {
            chunks: textOnly('FromSoftware\'s current catalog in this slice is anchored by ELDEN RING, Armored Core VI Fires of Rubicon, and Sekiro: Shadows Die Twice.'),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'lookup_developers',
            result: {
              canonicalResult: { id: 300, name: 'FromSoftware' },
              entityType: 'developer',
              results: [{ id: 300, name: 'FromSoftware' }],
              success: true,
              sufficient_to_answer: false,
              total_found: 1,
            },
          },
          {
            expectedName: 'search_games',
            result: {
              results: [
                { appid: 1245620, name: 'ELDEN RING' },
                { appid: 1888160, name: 'Armored Core VI Fires of Rubicon' },
                { appid: 814380, name: 'Sekiro: Shadows Die Twice' },
              ],
              success: true,
              sufficient_to_answer: true,
              total_found: 3,
            },
          },
        ],
      },
      {
        assertTurn: ({ events, finalEvent, providerCalls, text }) => {
          assertTurnEventShape(
            { events, finalEvent, providerCalls, text },
            ['tool_start', 'tool_result', 'text_delta', 'message_end']
          );
          assertSystemPromptIncludes(providerCalls[0], [
            'Active entities: developer:FromSoftware; game:ELDEN RING; game:Armored Core VI Fires of Rubicon; game:Sekiro: Shadows Die Twice',
            'Current candidate set (games): ELDEN RING, Armored Core VI Fires of Rubicon, Sekiro: Shadows Die Twice',
          ]);
          assert.equal(finalEvent?.sessionContext?.resultSet?.sourceTool, 'screen_games');
          assertTextIncludes(text, '| Game | Review % | Total Reviews |');
        },
        providerInvocations: [
          {
            chunks: toolSequence([
              {
                arguments: {
                  filters: { appids: [1245620, 1888160, 814380] },
                  limit: 3,
                  sort_by: 'review_percentage',
                  timeframe: 'current',
                },
                id: 'company-compare-screen-games',
                name: 'screen_games',
              },
            ]),
          },
        ],
        toolExecutions: [
          {
            expectedName: 'screen_games',
            result: {
              ranking_definition: 'Ordered by current review percentage across the carried FromSoftware set.',
              ranking_label: 'Review %',
              recommended_columns: ['Game', 'Review %', 'Total Reviews'],
              results: [
                { appid: 814380, name: 'Sekiro: Shadows Die Twice', reviewPercentage: 95, totalReviews: 220000 },
                { appid: 1245620, name: 'ELDEN RING', reviewPercentage: 94, totalReviews: 700000 },
                { appid: 1888160, name: 'Armored Core VI Fires of Rubicon', reviewPercentage: 93, totalReviews: 110000 },
              ],
              success: true,
              sufficient_to_answer: true,
              timeframe_label: 'the current FromSoftware catalog',
              total_found: 3,
            },
          },
        ],
      },
    ],
  },
};

export function collectTextFromEvents(events: StreamEvent[]): string {
  return events
    .filter((event): event is TextDeltaEvent => event.type === 'text_delta')
    .map((event) => event.delta)
    .join('');
}
