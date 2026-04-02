import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  type CompareEntitiesRequest,
  ContractRuntimeUnavailableError,
  type ContinueResultSetRequest,
  DataPlaneService,
  type ExplainChangesRequest,
  type GetEntityOverviewRequest,
  loadQueryApiConfig,
  type RankEntitiesRequest,
  type ResolveEntitiesRequest,
  type SearchCatalogRequest,
  type SearchDocumentsRequest,
  type SemanticSearchRequest,
  type TraceMetricHistoryRequest,
} from '@publisheriq/data-plane';
import { logger, PublisherIQError } from '@publisheriq/shared';

interface QueryApiService {
  compareEntities: DataPlaneService['compareEntities'];
  describeContracts: DataPlaneService['describeContracts'];
  continueResultSet: DataPlaneService['continueResultSet'];
  explainChanges: DataPlaneService['explainChanges'];
  getEntityOverview: DataPlaneService['getEntityOverview'];
  healthCheck: DataPlaneService['healthCheck'];
  rankEntities: DataPlaneService['rankEntities'];
  readinessCheck: DataPlaneService['readinessCheck'];
  resolveEntities: DataPlaneService['resolveEntities'];
  searchCatalog: DataPlaneService['searchCatalog'];
  searchDocuments: DataPlaneService['searchDocuments'];
  semanticSearch: DataPlaneService['semanticSearch'];
  traceMetricHistory: DataPlaneService['traceMetricHistory'];
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function methodNotAllowed(response: ServerResponse): void {
  sendJson(response, 405, { error: 'Method not allowed' });
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function authorizeRequest(request: IncomingMessage, bearerToken: string | null): boolean {
  if (!bearerToken) {
    return true;
  }

  const header = request.headers.authorization;
  return header === `Bearer ${bearerToken}`;
}

function routeRequiresAuthorization(
  request: IncomingMessage,
  url: URL,
  bearerToken: string | null,
): boolean {
  if (!bearerToken) {
    return false;
  }

  return !(request.method === 'GET' && url.pathname === '/healthz');
}

export function createQueryApiRequestHandler(params: {
  bearerToken: string | null;
  dataPlane: QueryApiService;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const { bearerToken, dataPlane } = params;

  return async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (
        routeRequiresAuthorization(request, url, bearerToken) &&
        !authorizeRequest(request, bearerToken)
      ) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/healthz') {
        const provenance = await dataPlane.healthCheck();
        sendJson(response, 200, { ok: true, provenance });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/readyz') {
        const readiness = await dataPlane.readinessCheck();
        sendJson(response, readiness.ready ? 200 : 503, readiness);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/contracts') {
        sendJson(response, 200, await dataPlane.describeContracts());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/resolve-entities') {
        const body = await readJsonBody<ResolveEntitiesRequest>(request);
        const result = await dataPlane.resolveEntities(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-entity-overview') {
        const body = await readJsonBody<GetEntityOverviewRequest>(request);
        const result = await dataPlane.getEntityOverview(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/search-catalog') {
        const body = await readJsonBody<SearchCatalogRequest>(request);
        const result = await dataPlane.searchCatalog(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/rank-entities') {
        const body = await readJsonBody<RankEntitiesRequest>(request);
        const result = await dataPlane.rankEntities(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/compare-entities') {
        const body = await readJsonBody<CompareEntitiesRequest>(request);
        const result = await dataPlane.compareEntities(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/trace-metric-history') {
        const body = await readJsonBody<TraceMetricHistoryRequest>(request);
        const result = await dataPlane.traceMetricHistory(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/explain-changes') {
        const body = await readJsonBody<ExplainChangesRequest>(request);
        const result = await dataPlane.explainChanges(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/search-documents') {
        const body = await readJsonBody<SearchDocumentsRequest>(request);
        const result = await dataPlane.searchDocuments(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/semantic-search') {
        const body = await readJsonBody<SemanticSearchRequest>(request);
        const result = await dataPlane.semanticSearch(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/continue-result-set') {
        const body = await readJsonBody<ContinueResultSetRequest>(request);
        const result = await dataPlane.continueResultSet(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' || request.method === 'POST') {
        sendJson(response, 404, { error: 'Route not found' });
        return;
      }

      methodNotAllowed(response);
    } catch (error) {
      if (error instanceof ContractRuntimeUnavailableError) {
        sendJson(response, 503, {
          blockingTables: error.blockingTables,
          code: error.code,
          contractName: error.contractName,
          error: error.message,
        });
        return;
      }

      if (error instanceof PublisherIQError) {
        sendJson(response, 400, {
          code: error.code,
          error: error.message,
        });
        return;
      }

      logger.error('Query API request failed', {
        error,
        method: request.method,
        url: request.url,
      });
      sendJson(response, 500, { error: 'Internal server error' });
    }
  };
}

export function createQueryApiServer(params?: {
  bearerToken?: string | null;
  dataPlane?: QueryApiService;
}): ReturnType<typeof createServer> {
  const config = params?.dataPlane && params?.bearerToken !== undefined
    ? null
    : loadQueryApiConfig();
  const dataPlane = params?.dataPlane ?? new DataPlaneService(config!);

  return createServer(
    createQueryApiRequestHandler({
      bearerToken: params?.bearerToken ?? config?.bearerToken ?? null,
      dataPlane,
    })
  );
}

async function main(): Promise<void> {
  const config = loadQueryApiConfig();
  const server = createQueryApiServer();

  server.listen(config.port, config.host, () => {
    logger.info('Query API listening', {
      host: config.host,
      port: config.port,
      source: config.source,
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logger.error('Failed to start query API', { error });
    process.exitCode = 1;
  });
}
