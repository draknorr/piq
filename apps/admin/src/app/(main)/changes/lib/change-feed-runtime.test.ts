import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldUseStrictTigerChangeFeedReads,
  shouldUseTigerChangeFeedReads,
} from './change-feed-runtime';

function makeEnv(overrides: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    ...overrides,
  };
}

test('shouldUseTigerChangeFeedReads honors the canonical and compatibility target names', () => {
  assert.equal(
    shouldUseTigerChangeFeedReads(
      makeEnv({
        CHANGE_INTEL_READ_TARGET: 'tiger',
      })
    ),
    true
  );
  assert.equal(
    shouldUseTigerChangeFeedReads(
      makeEnv({
        CHANGE_FEED_READ_TARGET: 'tiger',
      })
    ),
    true
  );
});

test('shouldUseTigerChangeFeedReads preserves explicit non-Tiger targets', () => {
  assert.equal(
    shouldUseTigerChangeFeedReads(
      makeEnv({
        CHANGE_INTEL_READ_TARGET: 'supabase',
        CHANGE_FEED_READ_TARGET: 'tiger',
      })
    ),
    false
  );
  assert.equal(shouldUseTigerChangeFeedReads(makeEnv({})), false);
});

test('shouldUseStrictTigerChangeFeedReads parses strict mode flags', () => {
  assert.equal(
    shouldUseStrictTigerChangeFeedReads(
      makeEnv({
        CHANGE_FEED_READ_STRICT: 'true',
      })
    ),
    true
  );
  assert.equal(shouldUseStrictTigerChangeFeedReads(makeEnv({})), false);
});
