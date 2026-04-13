import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

import {
  handleChatYoutubeCoverageRequest,
  type ChatYoutubeCoverageRouteDeps,
} from './handler';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat/youtube-coverage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('chat youtube coverage route returns 401 when unauthenticated', async () => {
  const deps: ChatYoutubeCoverageRouteDeps = {
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

  const response = await handleChatYoutubeCoverageRequest(makeRequest({
    entityUid: 'entity-1',
    view: 'latest_videos',
  }), deps);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: 'Authentication required',
    result: null,
    success: false,
  });
});

test('chat youtube coverage route validates required fields', async () => {
  const deps: ChatYoutubeCoverageRouteDeps = {
    createServerClient: async () =>
      ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1' } } }),
        },
      }) as never,
    postToQueryApi: async () => {
      throw new Error('query-api should not be called for invalid requests');
    },
  };

  const missingEntityResponse = await handleChatYoutubeCoverageRequest(makeRequest({
    view: 'latest_videos',
  }), deps);

  assert.equal(missingEntityResponse.status, 400);
  assert.deepEqual(await missingEntityResponse.json(), {
    error: 'entityUid is required',
    result: null,
    success: false,
  });

  const missingViewResponse = await handleChatYoutubeCoverageRequest(makeRequest({
    entityUid: 'entity-1',
    view: 'not-a-real-view',
  }), deps);

  assert.equal(missingViewResponse.status, 400);
  assert.deepEqual(await missingViewResponse.json(), {
    error: 'view is required',
    result: null,
    success: false,
  });
});

test('chat youtube coverage route proxies get-youtube-game-coverage with normalized pagination params', async () => {
  const queryApiCalls: Array<{ body: unknown; path: string }> = [];
  const deps: ChatYoutubeCoverageRouteDeps = {
    createServerClient: async () =>
      ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1' } } }),
        },
      }) as never,
    postToQueryApi: (async (path, body) => {
      queryApiCalls.push({ body, path });
      return {
        data: {
          availability: { blockingTables: [], reason: null, state: 'ready' },
          entity: {
            displayName: 'ARC Raiders',
            entityKind: 'game',
            entityUid: 'entity-1',
            platform: 'steam',
            platformEntityId: '1149460',
          },
          items: [],
          limit: 25,
          pagination: {
            hasNextPage: true,
            hasPreviousPage: false,
            limit: 25,
            offset: 0,
            totalRows: 30,
          },
          provenance: {
            capturedAt: '2026-04-12T00:00:00.000Z',
            source: 'tiger',
            tables: ['docs.youtube_videos'],
          },
          resolvedWindow: '7d',
          sufficientToAnswer: true,
          summary: {
            distinctUploadChannels30d: 0,
            distinctUploadChannels7d: 0,
            freshestMatchedUploadAt: null,
            latestSnapshotAt: null,
            matchedPrimaryVideoCount: 0,
            matchedVideoViewDelta1d: 0,
            matchedVideoViewDelta7d: 0,
            newMatchedVideos1d: 0,
            newMatchedVideos30d: 0,
            newMatchedVideos7d: 0,
          },
          view: 'latest_videos',
          cadence: null,
          contentClass: null,
          contentMix: [],
          creators: [],
        },
        httpStatus: 200,
        ok: true,
      };
    }) as ChatYoutubeCoverageRouteDeps['postToQueryApi'],
  };

  const response = await handleChatYoutubeCoverageRequest(makeRequest({
    contentClass: 'standard_video',
    entityUid: ' entity-1 ',
    limit: 99,
    offset: -4,
    view: 'latest_videos',
    window: '7d',
  }), deps);

  assert.equal(response.status, 200);
  assert.deepEqual(queryApiCalls, [
    {
      body: {
        contentClass: 'standard_video',
        entityUid: 'entity-1',
        limit: 25,
        offset: 0,
        view: 'latest_videos',
        window: '7d',
      },
      path: '/v1/contracts/get-youtube-game-coverage',
    },
  ]);

  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.result?.pagination?.totalRows, 30);
  assert.equal(typeof payload.timing?.total_ms, 'number');
});
