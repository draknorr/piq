import assert from 'node:assert/strict';
import test from 'node:test';

import { matchVideoToGame } from './matcher.js';

test('matchVideoToGame accepts title alias matches', () => {
  const result = matchVideoToGame({
    title: 'Blue Prince review after 20 hours',
    description: '',
    aliases: ['Blue Prince'],
    channelId: 'channel-1',
  });

  assert.equal(result.matchState, 'matched_primary');
  assert.equal(result.matchedAlias, 'Blue Prince');
});

test('matchVideoToGame keeps description-only matches ambiguous by default', () => {
  const result = matchVideoToGame({
    title: 'Indie review roundup',
    description: 'This week we cover Blue Prince and a few others.',
    aliases: ['Blue Prince'],
    channelId: 'channel-1',
  });

  assert.equal(result.matchState, 'ambiguous');
});

test('matchVideoToGame uses channel priors to upgrade description matches', () => {
  const result = matchVideoToGame({
    title: 'Weekly upload',
    description: 'Blue Prince patch impressions',
    aliases: ['Blue Prince'],
    monitoredChannelIds: ['channel-1'],
    channelId: 'channel-1',
  });

  assert.equal(result.matchState, 'matched_primary');
  assert.equal(result.confidenceBucket, 'medium');
});
