import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyVideo, parseIso8601DurationToSeconds } from './classify.js';

test('parseIso8601DurationToSeconds parses common video durations', () => {
  assert.equal(parseIso8601DurationToSeconds('PT2M30S'), 150);
  assert.equal(parseIso8601DurationToSeconds('PT1H2M3S'), 3723);
  assert.equal(parseIso8601DurationToSeconds(undefined), null);
});

test('classifyVideo marks short videos separately from standard videos', () => {
  assert.equal(
    classifyVideo({
      id: 'a',
      contentDetails: { duration: 'PT59S' },
    }),
    'short'
  );

  assert.equal(
    classifyVideo({
      id: 'b',
      contentDetails: { duration: 'PT12M' },
    }),
    'standard_video'
  );
});

test('classifyVideo treats live metadata as live content', () => {
  assert.equal(
    classifyVideo({
      id: 'c',
      snippet: { liveBroadcastContent: 'live' },
    }),
    'live_or_recent_live'
  );
});
