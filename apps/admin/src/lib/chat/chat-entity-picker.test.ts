import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractActiveMentionQuery,
  extractComposerEntityQuery,
  extractEntitySearchQuery,
  inferComposerEntityResolutionPreference,
  replaceComposerEntityQuery,
} from './chat-entity-picker';

test('extractEntitySearchQuery captures reversed single-entity metric prompts', () => {
  assert.equal(
    extractEntitySearchQuery('what CCU is Counter Strike 2?'),
    'Counter Strike 2'
  );
});

test('extractComposerEntityQuery keeps multi-word @mentions intact', () => {
  assert.equal(extractActiveMentionQuery('tell me about @crimson de'), 'crimson de');
  assert.equal(extractComposerEntityQuery('tell me about @crimson de'), 'crimson de');
});

test('extractComposerEntityQuery falls back to overview-style prompts without @mentions', () => {
  assert.equal(extractComposerEntityQuery('tell me about crimson desert'), 'crimson desert');
});

test('replaceComposerEntityQuery replaces the full active mention span', () => {
  assert.equal(
    replaceComposerEntityQuery('tell me about @crimson de', 'crimson de', 'Crimson Desert'),
    'tell me about Crimson Desert'
  );
});

test('inferComposerEntityResolutionPreference defaults generic lookups to games and flips on company cues', () => {
  assert.equal(inferComposerEntityResolutionPreference('tell me about crimson', 'crimson'), 'game');
  assert.equal(
    inferComposerEntityResolutionPreference('how many games has crimson published?', 'crimson'),
    'company'
  );
});
