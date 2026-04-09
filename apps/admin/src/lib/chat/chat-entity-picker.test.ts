import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEntityAutocompleteSuggestions,
  extractActiveMentionQuery,
  extractComposerEntityQuery,
  extractEntitySearchQuery,
  inferAutocompleteEntityKinds,
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

test('inferAutocompleteEntityKinds keeps generic autocomplete game-only and company autocomplete company-only', () => {
  assert.deepEqual(inferAutocompleteEntityKinds('game'), ['game']);
  assert.deepEqual(inferAutocompleteEntityKinds('company'), ['publisher', 'developer']);
});

test('buildEntityAutocompleteSuggestions preserves Tiger result order', () => {
  const suggestions = buildEntityAutocompleteSuggestions([
    {
      confidence: 0.92,
      displayName: 'Crimson Desert',
      entityKind: 'game',
      entityUid: 'game:steam:3321460',
      matchQuality: 'prefix',
      matchedName: 'crimson desert',
      platform: 'steam',
      platformEntityId: '3321460',
      releaseYear: 2026,
    },
    {
      confidence: 0.99,
      displayName: 'Crimson',
      entityKind: 'publisher',
      entityUid: 'publisher:publisheriq:200771',
      matchQuality: 'exact',
      matchedName: 'Crimson',
      platform: 'publisheriq',
      platformEntityId: '200771',
    },
  ], 'tell me about crimson');

  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.label),
    ['Crimson Desert', 'Crimson']
  );
});
