import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionContextFromTurn } from './session-context';

test('buildSessionContextFromTurn captures Tiger-owned result-set metadata from synthetic tool calls', () => {
  const context = buildSessionContextFromTurn({
    executedToolCalls: [
      {
        arguments: {
          entityKind: 'game',
          mode: 'similarity',
          referenceQuery: 'Hades',
        },
        name: 'find_similar',
        result: {
          continuation_meta: {
            resultSet: {
              continuationToken: 'cursor-2',
              continuable: true,
              family: 'similarity',
              itemKind: 'games',
              lastPageSize: 2,
              shownIds: [367520, 632360],
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
          },
          results: [
            { id: 367520, name: 'Hollow Knight', score: 0.94 },
            { id: 632360, name: 'Risk of Rain 2', score: 0.9 },
          ],
          success: true,
        },
      },
    ],
    timestamp: '2026-04-01T00:05:00.000Z',
  });

  assert.ok(context);
  assert.equal(context.resultSet?.sourceContract, 'semanticSearch');
  assert.deepEqual(context.resultSet?.shownIds, [367520, 632360]);
  assert.equal(context.resultSet?.updatedAt, '2026-04-01T00:00:00.000Z');
});
