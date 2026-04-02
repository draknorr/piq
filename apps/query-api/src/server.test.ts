import assert from 'node:assert/strict';
import test from 'node:test';

import { ContractRuntimeUnavailableError } from '@publisheriq/data-plane';

import { createQueryApiServer } from './server.js';

function createDataPlaneStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    compareEntities: async () => ({ ok: true }),
    continueResultSet: async () => ({ ok: true }),
    describeContracts: async () => ({ contracts: [], source: 'tiger' }),
    explainChanges: async () => ({ ok: true }),
    getEntityOverview: async () => ({ ok: true }),
    healthCheck: async () => ({
      capturedAt: '2026-04-01T00:00:00.000Z',
      source: 'tiger',
      tables: [],
    }),
    rankEntities: async () => ({ ok: true }),
    readinessCheck: async () => ({
      blockedContracts: [],
      provenance: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        source: 'tiger',
        tables: [],
      },
      ready: true,
    }),
    resolveEntities: async () => ({ ok: true }),
    searchCatalog: async () => ({ ok: true }),
    searchDocuments: async () => ({ ok: true }),
    semanticSearch: async () => ({ ok: true }),
    traceMetricHistory: async () => ({ ok: true }),
    ...overrides,
  };
}

async function withServer(
  dataPlane: Record<string, unknown>,
  bearerToken: string | null,
  callback: (origin: string) => Promise<void>
): Promise<void> {
  const server = createQueryApiServer({
    bearerToken,
    dataPlane: dataPlane as any,
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP address');
  }

  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error?: Error) => (error ? reject(error) : resolve()))
    );
  }
}

test('query-api keeps /healthz public but protects contract routes with bearer auth', async () => {
  await withServer(createDataPlaneStub(), 'secret-token', async (origin) => {
    const healthResponse = await fetch(`${origin}/healthz`);
    assert.equal(healthResponse.status, 200);

    const protectedResponse = await fetch(`${origin}/v1/contracts`);
    assert.equal(protectedResponse.status, 401);
    assert.deepEqual(await protectedResponse.json(), { error: 'Unauthorized' });
  });
});

test('query-api routes semantic-search requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      semanticSearch: async (body: unknown) => {
        receivedBody = body;
        return {
          provenance: {
            capturedAt: '2026-04-01T00:00:00.000Z',
            source: 'tiger',
            tables: ['qdrant:publisheriq_games'],
          },
          results: [{ id: 367520, name: 'Hollow Knight', score: 0.94 }],
          sufficient_to_answer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/semantic-search`, {
        body: JSON.stringify({
          entityKind: 'game',
          mode: 'similarity',
          referenceQuery: 'Hades',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        entityKind: 'game',
        mode: 'similarity',
        referenceQuery: 'Hades',
      });
      assert.deepEqual(await response.json(), {
        provenance: {
          capturedAt: '2026-04-01T00:00:00.000Z',
          source: 'tiger',
          tables: ['qdrant:publisheriq_games'],
        },
        results: [{ id: 367520, name: 'Hollow Knight', score: 0.94 }],
        sufficient_to_answer: true,
      });
    }
  );
});

test('query-api routes get-entity-overview requests to the data-plane service', async () => {
  let receivedBody: unknown = null;

  await withServer(
    createDataPlaneStub({
      getEntityOverview: async (body: unknown) => {
        receivedBody = body;
        return {
          entity: {
            details: {
              appType: null,
              developerIds: [],
              developers: [],
              discountPercent: null,
              isFree: null,
              isReleased: null,
              parentAppid: null,
              platforms: [],
              priceCents: null,
              publisherIds: [],
              publishers: [],
              releaseDate: null,
              releaseState: null,
              releaseYear: null,
            },
            displayName: 'FromSoftware',
            entityKind: 'developer',
            entityUid: 'entity-1',
            metrics: {
              ccuPeak: 12345,
              gameCount: 7,
              ownersMidpoint: 4000000,
              reviewScore: 94,
              totalReviews: 600000,
            },
            platform: 'publisheriq',
            platformEntityId: '3005',
          },
          games: [],
          provenance: {
            capturedAt: '2026-04-01T00:00:00.000Z',
            source: 'tiger',
            tables: ['legacy.developers'],
          },
          sufficientToAnswer: true,
        };
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/get-entity-overview`, {
        body: JSON.stringify({
          entityKind: 'developer',
          gamesLimit: 5,
          gamesSortBy: 'reviews',
          platformEntityId: '3005',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedBody, {
        entityKind: 'developer',
        gamesLimit: 5,
        gamesSortBy: 'reviews',
        platformEntityId: '3005',
      });
      const payload = await response.json() as {
        entity: {
          displayName: string;
        };
      };
      assert.equal(payload.entity.displayName, 'FromSoftware');
    }
  );
});

test('query-api maps blocked contracts to HTTP 503', async () => {
  await withServer(
    createDataPlaneStub({
      compareEntities: async () => {
        throw new ContractRuntimeUnavailableError(
          'Contract compareEntities is not ready at runtime.',
          'compareEntities',
          ['legacy.publishers']
        );
      },
    }),
    null,
    async (origin) => {
      const response = await fetch(`${origin}/v1/contracts/compare-entities`, {
        body: JSON.stringify({ entityUids: ['publisher:publisheriq:1', 'publisher:publisheriq:2'] }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        blockingTables: ['legacy.publishers'],
        code: 'CONTRACT_RUNTIME_UNAVAILABLE',
        contractName: 'compareEntities',
        error: 'Contract compareEntities is not ready at runtime.',
      });
    }
  );
});
