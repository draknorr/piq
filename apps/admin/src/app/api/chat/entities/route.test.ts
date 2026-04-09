import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

import { handleChatEntityRequest, type ChatEntityRouteDeps } from './handler';
import type { ChatEntityPickerResults } from '@/lib/chat/chat-entity-picker';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat/entities', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('chat entity route returns 401 when unauthenticated', async () => {
  const deps: ChatEntityRouteDeps = {
    createServerClient: async () =>
      ({
        auth: {
          getUser: async () => ({ data: { user: null } }),
        },
      }) as never,
    postToQueryApi: async () => {
      throw new Error('query-api should not be called for unauthenticated requests');
    },
  };

  const response = await handleChatEntityRequest(makeRequest({ query: 'Counter-Strike 2' }), deps);

  assert.equal(response.status, 401);
  const payload = (await response.json()) as {
    error: string;
    query: string;
    results: ChatEntityPickerResults;
    success: boolean;
  };

  assert.equal(payload.success, false);
  assert.equal(payload.query, '');
  assert.equal(payload.error, 'Authentication required');
  assert.deepEqual(payload.results.ambiguity, {
    candidateNames: [],
    message: null,
    requiresClarification: false,
  });
  assert.equal(payload.results.continuationToken, null);
  assert.deepEqual(payload.results.entities, []);
  assert.equal(payload.results.provenance.source, 'tiger');
  assert.equal(payload.results.totalCandidates, 0);
});

test('chat entity route proxies resolve-entities and trims the query', async () => {
  const resolveResults: ChatEntityPickerResults = {
    ambiguity: {
      candidateNames: [],
      message: null,
      requiresClarification: false,
    },
    entities: [
      {
        confidence: 0.98,
        displayName: 'Counter-Strike 2',
        entityKind: 'game',
        entityUid: 'entity-123',
        matchQuality: 'exact',
        matchedName: 'counter-strike 2',
        platform: 'steam',
        platformEntityId: '730',
        releaseYear: 2023,
        latestMetrics: {
          ccuPeak: 1510000,
          ownersMidpoint: 0,
          reviewScore: 97,
          totalReviews: 1200000,
        },
      },
    ],
    provenance: {
      capturedAt: '2026-04-08T00:00:00.000Z',
      source: 'tiger',
      tables: ['core.entities'],
    },
    continuationToken: 'cursor-2',
    totalCandidates: 18,
  };

  const queryApiCalls: Array<{ path: string; body: unknown }> = [];

  const deps: ChatEntityRouteDeps = {
    createServerClient: async () =>
      ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1' } } }),
        },
      }) as never,
    postToQueryApi: (async (path, body) => {
      queryApiCalls.push({ path, body });
      return {
        ok: true,
        httpStatus: 200,
        data: resolveResults,
      };
    }) as ChatEntityRouteDeps['postToQueryApi'],
  };

  const response = await handleChatEntityRequest(
    makeRequest({
      query: '  Counter-Strike 2  ',
      limit: 3,
      includeMetrics: true,
      continuationToken: 'cursor-1',
      resolutionMode: 'autocomplete',
      resolutionPreference: 'game',
    }),
    deps
  );

  assert.equal(response.status, 200);
  assert.deepEqual(queryApiCalls, [
    {
      path: '/v1/contracts/resolve-entities',
      body: {
        entityKinds: ['game', 'publisher', 'developer'],
        continuationToken: 'cursor-1',
        includeMetrics: true,
        limit: 3,
        query: 'Counter-Strike 2',
        resolutionMode: 'autocomplete',
        resolutionPreference: 'game',
      },
    },
  ]);

  const payload = (await response.json()) as {
    query: string;
    results: ChatEntityPickerResults;
    success: boolean;
    timing: { total_ms: number };
  };

  assert.equal(payload.success, true);
  assert.equal(payload.query, 'Counter-Strike 2');
  assert.equal(payload.results.entities[0]?.displayName, 'Counter-Strike 2');
  assert.equal(payload.results.continuationToken, 'cursor-2');
  assert.equal(payload.results.totalCandidates, 18);
  assert.equal(typeof payload.timing.total_ms, 'number');
});
