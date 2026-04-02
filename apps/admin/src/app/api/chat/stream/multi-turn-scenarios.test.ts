import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleChatStreamRequest } from './handler';
import {
  MULTI_TURN_SCENARIO_FIXTURES,
  type DeterministicScenarioDefinition,
} from './multi-turn-scenario-fixtures';
import {
  createScriptedChatDeps,
  setScopedEnv,
  type ProviderInvocationPlan,
  type ToolExecutionPlan,
} from './test-support';
import { runChatScenario } from '@/lib/chat/test-helpers';
import type { SessionChatContext } from '@/lib/chat/chat-context-types';

interface CanonicalScenarioTurn {
  expectation: string;
  user: string;
}

interface CanonicalScenario {
  id: string;
  name: string;
  notes: string;
  turns: CanonicalScenarioTurn[];
}

const canonicalScenarioFile = new URL(
  '../../../../../../../scripts/chat-evals/multi-turn-phase1-scenarios.json',
  import.meta.url
);

const canonicalScenarios = JSON.parse(
  readFileSync(canonicalScenarioFile, 'utf8')
) as CanonicalScenario[];

function flattenScenarioPlans(definition: DeterministicScenarioDefinition): {
  providerInvocations: ProviderInvocationPlan[];
  toolExecutions: ToolExecutionPlan[];
} {
  return {
    providerInvocations: definition.turns.flatMap((turn) => turn.providerInvocations),
    toolExecutions: definition.turns.flatMap((turn) => turn.toolExecutions),
  };
}

function buildScenarioHandler(
  definition: DeterministicScenarioDefinition
): {
  assertExhausted: () => void;
  handler: Parameters<typeof runChatScenario>[0]['handler'];
  trace: ReturnType<typeof createScriptedChatDeps>['trace'];
} {
  const flattened = flattenScenarioPlans(definition);
  const { assertExhausted, deps, trace } = createScriptedChatDeps({
    providerInvocations: flattened.providerInvocations,
    toolExecutions: flattened.toolExecutions,
  });

  return {
    assertExhausted,
    handler: async (request) =>
      handleChatStreamRequest(request, {
        deps,
        requireEvalSecret: false,
      }),
    trace,
  };
}

test('deterministic multi-turn fixtures stay aligned with the canonical scenario inventory', () => {
  const canonicalIds = canonicalScenarios.map((scenario) => scenario.id).sort();
  const fixtureIds = Object.keys(MULTI_TURN_SCENARIO_FIXTURES).sort();

  assert.deepEqual(fixtureIds, canonicalIds);

  for (const scenario of canonicalScenarios) {
    const fixture = MULTI_TURN_SCENARIO_FIXTURES[scenario.id];
    assert.ok(fixture, `missing deterministic fixture for ${scenario.id}`);
    assert.equal(
      fixture.turns.length,
      scenario.turns.length,
      `turn count drift for ${scenario.id}`
    );
  }
});

for (const canonicalScenario of canonicalScenarios) {
  test(`multi-turn scenario: ${canonicalScenario.id}`, async (t) => {
    setScopedEnv(t, 'CHAT_PHASE1_QUALITY_ENABLED', 'true');

    const fixture = MULTI_TURN_SCENARIO_FIXTURES[canonicalScenario.id];
    assert.ok(fixture, `missing deterministic fixture for ${canonicalScenario.id}`);

    const { assertExhausted, handler, trace } = buildScenarioHandler(fixture);
    const scenarioResult = await runChatScenario({
      handler,
      initialSessionContext: null,
      turns: canonicalScenario.turns.map((turn) => ({ user: turn.user })),
    });

    assert.equal(
      scenarioResult.turns.length,
      canonicalScenario.turns.length,
      `unexpected executed turn count for ${canonicalScenario.id}`
    );

    let providerOffset = 0;
    for (let index = 0; index < scenarioResult.turns.length; index += 1) {
      const turnPlan = fixture.turns[index];
      const turnResult = scenarioResult.turns[index];
      const providerCalls = trace.providerCalls.slice(
        providerOffset,
        providerOffset + turnPlan.providerInvocations.length
      );
      providerOffset += turnPlan.providerInvocations.length;

      turnPlan.assertTurn({
        events: turnResult.events,
        finalEvent: turnResult.finalEvent,
        providerCalls,
        text: turnResult.text,
      });
    }

    assert.equal(providerOffset, trace.providerCalls.length);
    assert.ok(
      (scenarioResult.finalSessionContext as SessionChatContext | null) !== undefined,
      'expected final session context to be defined'
    );
    assertExhausted();
  });
}
