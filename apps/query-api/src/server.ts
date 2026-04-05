import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  type CompareEntitiesRequest,
  ContractRuntimeUnavailableError,
  type DiscoverChangePatternsRequest,
  type DiscoverMomentumRequest,
  type ContinueResultSetRequest,
  DataPlaneService,
  type ExplainChangesRequest,
  type GetEntityOverviewRequest,
  type GetRelatedEntitiesRequest,
  type GetRelatedEntitiesResponse,
  type GetUserContextRequest,
  loadQueryApiConfig,
  loadSourceBaselineConfig,
  type RankEntitiesRequest,
  type ResolveEntitiesRequest,
  type SearchCatalogRequest,
  type SearchChangeActivityRequest,
  type SearchDocumentsRequest,
  type SemanticSearchRequest,
  type TraceMetricHistoryRequest,
} from '@publisheriq/data-plane';
import { logger, PublisherIQError } from '@publisheriq/shared';

let queryApiEnvLoaded = false;

function loadQueryApiEnvFiles(): void {
  if (queryApiEnvLoaded) {
    return;
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = path.resolve(packageRoot, '..', '..');
  const envFiles = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, '.env.tiger.local'),
    path.join(packageRoot, '.env.local'),
    path.join(repoRoot, 'apps', 'admin', '.env.local'),
  ];

  for (const envFile of envFiles) {
    if (!existsSync(envFile)) {
      continue;
    }

    const text = readFileSync(envFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }

  queryApiEnvLoaded = true;
}

interface QueryApiService {
  compareEntities: DataPlaneService['compareEntities'];
  discoverChangePatterns: DataPlaneService['discoverChangePatterns'];
  discoverMomentum: DataPlaneService['discoverMomentum'];
  describeContracts: DataPlaneService['describeContracts'];
  continueResultSet: DataPlaneService['continueResultSet'];
  explainChanges: DataPlaneService['explainChanges'];
  getEntityOverview: DataPlaneService['getEntityOverview'];
  getRelatedEntities: DataPlaneService['getRelatedEntities'];
  getUserContext: DataPlaneService['getUserContext'];
  healthCheck: DataPlaneService['healthCheck'];
  rankEntities: DataPlaneService['rankEntities'];
  readinessCheck: DataPlaneService['readinessCheck'];
  resolveEntities: DataPlaneService['resolveEntities'];
  searchCatalog: DataPlaneService['searchCatalog'];
  searchChangeActivity: DataPlaneService['searchChangeActivity'];
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

function applyRelatedEntitiesFallbackSourceContext(params: {
  fallbackService: QueryApiService;
  primaryResult: GetRelatedEntitiesResponse;
}): () => void {
  const fallbackService = params.fallbackService as QueryApiService & Partial<{
    queryRelatedDlcRows: () => Promise<[]>;
    queryRelatedDlcRowsFromApps: () => Promise<[]>;
    queryGameOverview: (appid: number) => Promise<{
      display_name: string;
      review_score: number | null;
      total_reviews: number | null;
    }>;
    querySteamDeckCategoryByApp: (appid: number) => Promise<'playable' | 'verified' | 'unsupported' | 'unknown' | null>;
  }>;
  const originalQueryRelatedDlcRows = fallbackService.queryRelatedDlcRows;
  const originalQueryRelatedDlcRowsFromApps = fallbackService.queryRelatedDlcRowsFromApps;
  const originalQueryGameOverview = fallbackService.queryGameOverview;
  const originalQuerySteamDeckCategoryByApp = fallbackService.querySteamDeckCategoryByApp;

  if (typeof fallbackService.queryRelatedDlcRows === 'function') {
    fallbackService.queryRelatedDlcRows = async () => [];
  }

  if (typeof fallbackService.queryRelatedDlcRowsFromApps === 'function') {
    fallbackService.queryRelatedDlcRowsFromApps = async () => [];
  }

  if (typeof fallbackService.queryGameOverview === 'function') {
    fallbackService.queryGameOverview = async () => ({
      display_name: params.primaryResult.source.displayName,
      review_score: params.primaryResult.source.reviewScore,
      total_reviews: params.primaryResult.source.totalReviews,
    });
  }

  if (typeof fallbackService.querySteamDeckCategoryByApp === 'function') {
    fallbackService.querySteamDeckCategoryByApp = async () => params.primaryResult.source.steamDeckCategory;
  }

  return () => {
    if (originalQueryRelatedDlcRows) {
      fallbackService.queryRelatedDlcRows = originalQueryRelatedDlcRows;
    } else {
      delete fallbackService.queryRelatedDlcRows;
    }

    if (originalQueryRelatedDlcRowsFromApps) {
      fallbackService.queryRelatedDlcRowsFromApps = originalQueryRelatedDlcRowsFromApps;
    } else {
      delete fallbackService.queryRelatedDlcRowsFromApps;
    }

    if (originalQueryGameOverview) {
      fallbackService.queryGameOverview = originalQueryGameOverview;
    } else {
      delete fallbackService.queryGameOverview;
    }

    if (originalQuerySteamDeckCategoryByApp) {
      fallbackService.querySteamDeckCategoryByApp = originalQuerySteamDeckCategoryByApp;
    } else {
      delete fallbackService.querySteamDeckCategoryByApp;
    }
  };
}

export function createQueryApiRequestHandler(params: {
  bearerToken: string | null;
  dataPlane: QueryApiService;
  relatedEntitiesFallback?: QueryApiService | null;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const { bearerToken, dataPlane, relatedEntitiesFallback = null } = params;

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

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-related-entities') {
        const body = await readJsonBody<GetRelatedEntitiesRequest>(request);
        let result = await dataPlane.getRelatedEntities(body);

        if (
          relatedEntitiesFallback
          && (result.items?.length ?? 0) === 0
          && (result.unresolvedCount ?? 0) === 0
        ) {
          const restoreFallbackContext =
            body.relationKind === 'dlc'
              ? applyRelatedEntitiesFallbackSourceContext({
                  fallbackService: relatedEntitiesFallback,
                  primaryResult: result,
                })
              : () => undefined;
          try {
            const fallbackResult = await relatedEntitiesFallback.getRelatedEntities(body);
            if ((fallbackResult.items?.length ?? 0) > 0 || (fallbackResult.unresolvedCount ?? 0) > 0) {
              result = fallbackResult;
            }
          } catch (error) {
            logger.warn('Query API related-entities fallback failed', {
              error,
              relationKind: body.relationKind,
              sourceAppid: body.sourceAppid ?? null,
            });
          } finally {
            restoreFallbackContext();
          }
        }

        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-user-context') {
        const body = await readJsonBody<GetUserContextRequest>(request);
        const result = await dataPlane.getUserContext(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/search-catalog') {
        const body = await readJsonBody<SearchCatalogRequest>(request);
        const result = await dataPlane.searchCatalog(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/discover-momentum') {
        const body = await readJsonBody<DiscoverMomentumRequest>(request);
        const result = await dataPlane.discoverMomentum(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/search-change-activity') {
        const body = await readJsonBody<SearchChangeActivityRequest>(request);
        const result = await dataPlane.searchChangeActivity(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/discover-change-patterns') {
        const body = await readJsonBody<DiscoverChangePatternsRequest>(request);
        const result = await dataPlane.discoverChangePatterns(body);
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
  config?: ReturnType<typeof loadQueryApiConfig> | null;
  dataPlane?: QueryApiService;
  relatedEntitiesFallback?: QueryApiService | null;
}): ReturnType<typeof createServer> {
  loadQueryApiEnvFiles();

  const config = params?.config
    ?? (
      params?.dataPlane && params?.bearerToken !== undefined
        ? null
        : loadQueryApiConfig()
    );
  const dataPlane = params?.dataPlane ?? new DataPlaneService(config!);
  const relatedEntitiesFallback =
    params?.relatedEntitiesFallback
    ?? (
      !params?.dataPlane && config?.source === 'tiger'
        ? createRelatedEntitiesFallback(config)
        : null
    );

  return createServer(
    createQueryApiRequestHandler({
      bearerToken: params?.bearerToken ?? config?.bearerToken ?? null,
      dataPlane,
      relatedEntitiesFallback,
    })
  );
}

async function main(): Promise<void> {
  loadQueryApiEnvFiles();
  const config = loadQueryApiConfig();
  const server = createQueryApiServer({ config });

  server.listen(config.port, config.host, () => {
    logger.info('Query API listening', {
      host: config.host,
      port: config.port,
      source: config.source,
    });
  });
}

function createRelatedEntitiesFallback(
  primaryConfig: ReturnType<typeof loadQueryApiConfig> | null
): QueryApiService | null {
  if (!primaryConfig || primaryConfig.source !== 'tiger') {
    return null;
  }

  try {
    const fallbackConfig = loadSourceBaselineConfig();
    if (
      fallbackConfig.source === primaryConfig.source
      && fallbackConfig.connectionString === primaryConfig.connectionString
    ) {
      return null;
    }

    const fallbackService = new DataPlaneService(fallbackConfig);
    const fallbackServiceWithOverride = fallbackService as unknown as {
      assertContractRuntime: (contractName: string) => Promise<void>;
    };
    const originalAssertContractRuntime =
      fallbackServiceWithOverride.assertContractRuntime.bind(fallbackService);
    fallbackServiceWithOverride.assertContractRuntime = async (contractName: string) => {
      if (contractName === 'getRelatedEntities') {
        return;
      }

      await originalAssertContractRuntime(contractName);
    };

    return fallbackService;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logger.error('Failed to start query API', { error });
    process.exitCode = 1;
  });
}
