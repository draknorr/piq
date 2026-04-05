import assert from 'node:assert/strict';
import test from 'node:test';

import { getChatLandingPromptGroups } from './example-prompts';

test('getChatLandingPromptGroups is stable for the same visit seed', () => {
  const first = getChatLandingPromptGroups('visit-seed-alpha');
  const second = getChatLandingPromptGroups('visit-seed-alpha');

  assert.deepEqual(second, first);
});

test('getChatLandingPromptGroups keeps balanced category coverage without duplicates', () => {
  const groups = getChatLandingPromptGroups('visit-seed-beta');

  assert.deepEqual(
    groups.map((group) => group.title),
    [
      'Discover Games',
      'Track Momentum',
      'Research Companies',
      'Watch Changes',
    ]
  );

  for (const group of groups) {
    assert.equal(group.prompts.length, 4);

    const uniqueQueries = new Set(group.prompts.map((prompt) => prompt.query));
    assert.equal(uniqueQueries.size, group.prompts.length);
  }
});

test('getChatLandingPromptGroups rotates at least one prompt between visit seeds', () => {
  const first = getChatLandingPromptGroups('visit-seed-gamma')
    .flatMap((group) => group.prompts.map((prompt) => prompt.query));
  const second = getChatLandingPromptGroups('visit-seed-delta')
    .flatMap((group) => group.prompts.map((prompt) => prompt.query));

  assert.notDeepEqual(second, first);
});
