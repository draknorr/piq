import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_UNRELEASED_COLUMNS,
  parseUnreleasedColumnsParam,
  serializeUnreleasedColumnsParam,
} from './unreleased-columns';

describe('unreleased column helpers', () => {
  it('returns defaults when no columns param is present', () => {
    assert.deepEqual(parseUnreleasedColumnsParam(null), DEFAULT_UNRELEASED_COLUMNS);
  });

  it('round-trips custom column order', () => {
    const columns = parseUnreleasedColumnsParam('media,opportunity_score,latest_news');
    assert.deepEqual(columns, ['media', 'opportunity_score', 'latest_news']);
    assert.equal(serializeUnreleasedColumnsParam(columns), 'media,opportunity_score,latest_news');
  });

  it('removes invalid and duplicate columns', () => {
    assert.deepEqual(
      parseUnreleasedColumnsParam('media,nope,media,tags'),
      ['media', 'tags']
    );
  });

  it('falls back to defaults when every requested column is invalid', () => {
    assert.deepEqual(parseUnreleasedColumnsParam('nope,missing'), DEFAULT_UNRELEASED_COLUMNS);
  });

  it('omits the default column order from URLs', () => {
    assert.equal(serializeUnreleasedColumnsParam(DEFAULT_UNRELEASED_COLUMNS), null);
  });
});
