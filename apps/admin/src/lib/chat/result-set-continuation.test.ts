import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTigerContinuationResultSet,
  resolveResultSetContinuation,
} from './result-set-continuation';
import type { SessionChatContext } from './chat-context-types';

test('resolveResultSetContinuation keeps Tiger semantic ownership and applies bounded deltas', () => {
  const context: SessionChatContext = {
    version: 1,
    entities: [],
    constraints: [],
    lastAnswer: null,
    resultSet: {
      continuationToken: 'cursor-1',
      continuable: true,
      family: 'similarity',
      itemKind: 'games',
      lastPageSize: 5,
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

  const resolution = resolveResultSetContinuation(
    'same but Steam Deck verified under $20',
    context
  );

  assert.ok(resolution);
  assert.equal(resolution.sourceContract, 'semanticSearch');
  assert.equal(resolution.requestedCount, 5);
  assert.deepEqual(resolution.sourceArgs, {
    entityKind: 'game',
    filters: {
      max_price_cents: 2000,
      steam_deck: ['verified'],
    },
    mode: 'similarity',
    referenceQuery: 'Hades',
  });
});

test('buildTigerContinuationResultSet appends newly returned ids and marks exhaustion', () => {
  const resolution = resolveResultSetContinuation('more', {
    version: 1,
    entities: [],
    constraints: [],
    lastAnswer: null,
    resultSet: {
      continuationToken: 'cursor-1',
      continuable: true,
      family: 'similarity',
      itemKind: 'games',
      lastPageSize: 2,
      shownIds: [1145360, 367520],
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
  });

  assert.ok(resolution);

  const next = buildTigerContinuationResultSet({
    resolution,
    response: {
      continuationToken: null,
      effectiveArgs: {
        continuationToken: 'cursor-1',
        entityKind: 'game',
        limit: 2,
        mode: 'similarity',
        referenceQuery: 'Hades',
      },
      exhausted: true,
      provenance: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        source: 'tiger',
        tables: ['qdrant:publisheriq_games'],
      },
      result: {
        continuation_token: null,
        results: [
          { id: 367520, name: 'Hollow Knight' },
          { id: 632360, name: 'Risk of Rain 2' },
        ],
      },
      sourceContract: 'semanticSearch',
      sufficientToAnswer: true,
    },
  });

  assert.equal(next.exhausted, true);
  assert.deepEqual(next.returnedIds, [367520, 632360]);
  assert.deepEqual(next.resultSet.shownIds, [1145360, 367520, 632360]);
  assert.equal(next.resultSet.continuationToken, null);
});
