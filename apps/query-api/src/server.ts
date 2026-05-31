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
  type GetChangeActivityDetailRequest,
  type GetChangeFeedStatusRequest,
  type GetEntityOverviewRequest,
  type GetRelatedEntitiesRequest,
  type GetRelatedEntitiesResponse,
  type GetUserContextRequest,
  type GetYoutubeGameCoverageRequest,
  type GetYoutubeMarketPulseRequest,
  loadQueryApiConfig,
  loadSourceBaselineConfig,
  type CompanyDiligencePackRequest,
  type GameResearchPackRequest,
  type GenreGrowthPackRequest,
  type GetReportInstructionsRequest,
  PublisherIQResearchService,
  type ReadonlyAnalysisRequest,
  type ReportRecreationPackRequest,
  type ResearchRole,
  type QueryMonthlyPlaytimeRequest,
  type RankEntitiesRequest,
  type ResolveEntitiesRequest,
  type SearchCatalogRequest,
  type SearchChangeActivityRequest,
  type SearchDocumentsRequest,
  type SearchReportArchiveRequest,
  type SemanticSearchRequest,
  type TraceMetricHistoryRequest,
  type UnreleasedOpportunityPackRequest,
  type YoutubeCreatorPackRequest,
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
  getChangeActivityDetail: DataPlaneService['getChangeActivityDetail'];
  getChangeFeedStatus: DataPlaneService['getChangeFeedStatus'];
  getRelatedEntities: DataPlaneService['getRelatedEntities'];
  getUserContext: DataPlaneService['getUserContext'];
  getYoutubeGameCoverage: DataPlaneService['getYoutubeGameCoverage'];
  getYoutubeMarketPulse: DataPlaneService['getYoutubeMarketPulse'];
  healthCheck: DataPlaneService['healthCheck'];
  queryMonthlyPlaytime: DataPlaneService['queryMonthlyPlaytime'];
  rankEntities: DataPlaneService['rankEntities'];
  readinessCheck: DataPlaneService['readinessCheck'];
  resolveEntities: DataPlaneService['resolveEntities'];
  searchCatalog: DataPlaneService['searchCatalog'];
  searchChangeActivity: DataPlaneService['searchChangeActivity'];
  searchDocuments: DataPlaneService['searchDocuments'];
  semanticSearch: DataPlaneService['semanticSearch'];
  traceMetricHistory: DataPlaneService['traceMetricHistory'];
}

const YOUTUBE_MARKET_PULSE_CACHE_TTL_MS = 10 * 60 * 1000;
const youtubeMarketPulseCache = new Map<string, { expiresAt: number; result: unknown }>();

function youtubeMarketPulseCacheKey(body: GetYoutubeMarketPulseRequest): string {
  return JSON.stringify({
    contentClass: body.contentClass ?? null,
    limit: body.limit ?? null,
    offset: body.offset ?? null,
    sort: body.sort ?? null,
    window: body.window ?? null,
  });
}

async function getCachedYoutubeMarketPulse(
  dataPlane: QueryApiService,
  body: GetYoutubeMarketPulseRequest
): Promise<unknown> {
  const now = Date.now();
  const key = youtubeMarketPulseCacheKey(body);
  const cached = youtubeMarketPulseCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const result = await dataPlane.getYoutubeMarketPulse(body);
  youtubeMarketPulseCache.set(key, {
    expiresAt: now + YOUTUBE_MARKET_PULSE_CACHE_TTL_MS,
    result,
  });

  if (youtubeMarketPulseCache.size > 200) {
    for (const [cacheKey, value] of youtubeMarketPulseCache.entries()) {
      if (value.expiresAt <= now || youtubeMarketPulseCache.size > 200) {
        youtubeMarketPulseCache.delete(cacheKey);
      }
    }
  }

  return result;
}

async function executeWithSourceFallback<T>(params: {
  action: string;
  primaryOperation: () => Promise<T>;
  fallbackOperation?: (() => Promise<T>) | null;
}): Promise<T> {
  try {
    return await params.primaryOperation();
  } catch (error) {
    if (!params.fallbackOperation) {
      throw error;
    }

    logger.warn('Query API primary request failed; retrying with source fallback', {
      action: params.action,
      error,
    });

    try {
      return await params.fallbackOperation();
    } catch (fallbackError) {
      logger.error('Query API source fallback failed', {
        action: params.action,
        error: fallbackError,
      });
      throw error;
    }
  }
}

function isStatementTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '57014'
    || (typeof candidate.message === 'string' && /statement timeout/i.test(candidate.message));
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
  const chunks: Uint8Array[] = [];
  const textEncoder = new TextEncoder();

  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(new Uint8Array(chunk));
      continue;
    }

    chunks.push(
      typeof chunk === 'string'
        ? textEncoder.encode(chunk)
        : Uint8Array.from(chunk)
    );
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

function resolveResearchRole(request: IncomingMessage): ResearchRole {
  const header = request.headers['x-publisheriq-research-role'];
  const value = Array.isArray(header) ? header[0] : header;
  return value === 'admin' || value === 'researcher' || value === 'internal'
    ? value
    : 'internal';
}

function isResearchSqlSandboxEnabled(): boolean {
  return process.env.RESEARCH_SQL_SANDBOX_ENABLED === 'true';
}

export function createQueryApiRequestHandler(params: {
  bearerToken: string | null;
  dataPlane: QueryApiService;
  relatedEntitiesFallback?: QueryApiService | null;
  sourceFallback?: QueryApiService | null;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const { bearerToken, dataPlane, relatedEntitiesFallback = null, sourceFallback = null } = params;
  const research = new PublisherIQResearchService(dataPlane);

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
        const provenance = await executeWithSourceFallback({
          action: 'healthCheck',
          fallbackOperation: sourceFallback ? () => sourceFallback.healthCheck() : null,
          primaryOperation: () => dataPlane.healthCheck(),
        });
        sendJson(response, 200, { ok: true, provenance });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/readyz') {
        const readiness = await executeWithSourceFallback({
          action: 'readinessCheck',
          fallbackOperation: sourceFallback ? () => sourceFallback.readinessCheck() : null,
          primaryOperation: () => dataPlane.readinessCheck(),
        });
        sendJson(response, readiness.ready ? 200 : 503, readiness);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/contracts') {
        sendJson(response, 200, await executeWithSourceFallback({
          action: 'describeContracts',
          fallbackOperation: sourceFallback ? () => sourceFallback.describeContracts() : null,
          primaryOperation: () => dataPlane.describeContracts(),
        }));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/report-instructions') {
        const body = await readJsonBody<GetReportInstructionsRequest>(request);
        sendJson(response, 200, research.getReportInstructions(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/report-archive/search') {
        const body = await readJsonBody<SearchReportArchiveRequest>(request);
        sendJson(response, 200, await research.searchReportArchive(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/evidence-packs/game') {
        const body = await readJsonBody<GameResearchPackRequest>(request);
        sendJson(response, 200, await research.buildGameResearchPack(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/evidence-packs/genre-growth') {
        const body = await readJsonBody<GenreGrowthPackRequest>(request);
        sendJson(response, 200, await research.buildGenreGrowthPack(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/evidence-packs/youtube-creators') {
        const body = await readJsonBody<YoutubeCreatorPackRequest>(request);
        sendJson(response, 200, await research.buildYoutubeCreatorPack(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/evidence-packs/company-diligence') {
        const body = await readJsonBody<CompanyDiligencePackRequest>(request);
        sendJson(response, 200, await research.buildCompanyDiligencePack(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/evidence-packs/unreleased-opportunity') {
        const body = await readJsonBody<UnreleasedOpportunityPackRequest>(request);
        sendJson(response, 200, await research.buildUnreleasedOpportunityPack(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/evidence-packs/report-recreation') {
        const body = await readJsonBody<ReportRecreationPackRequest>(request);
        sendJson(response, 200, await research.buildReportRecreationPack(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/research/readonly-analysis') {
        if (!isResearchSqlSandboxEnabled()) {
          sendJson(response, 403, {
            code: 'RESEARCH_SQL_SANDBOX_DISABLED',
            error: 'Read-only research SQL sandbox is disabled for this environment.',
          });
          return;
        }
        const body = await readJsonBody<ReadonlyAnalysisRequest>(request);
        sendJson(response, 200, await research.runReadonlyAnalysis(body, resolveResearchRole(request)));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/resolve-entities') {
        const body = await readJsonBody<ResolveEntitiesRequest>(request);
        const fallbackResolveEntitiesOperation = sourceFallback
          ? () => sourceFallback.resolveEntities(body)
          : null;
        try {
          const result = await executeWithSourceFallback({
            action: 'resolveEntities',
            fallbackOperation: fallbackResolveEntitiesOperation,
            primaryOperation: () => dataPlane.resolveEntities(body),
          });
          sendJson(response, 200, result);
        } catch (error) {
          if (isStatementTimeoutError(error)) {
            sendJson(response, 504, {
              code: 'QUERY_TIMEOUT',
              error: fallbackResolveEntitiesOperation
                ? 'Tiger primary resolveEntities timed out and source fallback did not recover the request.'
                : 'Tiger primary resolveEntities timed out before source fallback was available.',
            });
            return;
          }

          throw error;
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-entity-overview') {
        const body = await readJsonBody<GetEntityOverviewRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'getEntityOverview',
          fallbackOperation: sourceFallback ? () => sourceFallback.getEntityOverview(body) : null,
          primaryOperation: () => dataPlane.getEntityOverview(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-related-entities') {
        const body = await readJsonBody<GetRelatedEntitiesRequest>(request);
        let result = await executeWithSourceFallback({
          action: 'getRelatedEntities',
          fallbackOperation: sourceFallback ? () => sourceFallback.getRelatedEntities(body) : null,
          primaryOperation: () => dataPlane.getRelatedEntities(body),
        });

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
        const result = await executeWithSourceFallback({
          action: 'getUserContext',
          fallbackOperation: sourceFallback ? () => sourceFallback.getUserContext(body) : null,
          primaryOperation: () => dataPlane.getUserContext(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-youtube-game-coverage') {
        const body = await readJsonBody<GetYoutubeGameCoverageRequest>(request);
        const result = await dataPlane.getYoutubeGameCoverage(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-youtube-market-pulse') {
        const body = await readJsonBody<GetYoutubeMarketPulseRequest>(request);
        const result = await getCachedYoutubeMarketPulse(dataPlane, body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/search-catalog') {
        const body = await readJsonBody<SearchCatalogRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'searchCatalog',
          fallbackOperation: sourceFallback ? () => sourceFallback.searchCatalog(body) : null,
          primaryOperation: () => dataPlane.searchCatalog(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/discover-momentum') {
        const body = await readJsonBody<DiscoverMomentumRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'discoverMomentum',
          fallbackOperation: sourceFallback ? () => sourceFallback.discoverMomentum(body) : null,
          primaryOperation: () => dataPlane.discoverMomentum(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/search-change-activity') {
        const body = await readJsonBody<SearchChangeActivityRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'searchChangeActivity',
          fallbackOperation: sourceFallback ? () => sourceFallback.searchChangeActivity(body) : null,
          primaryOperation: () => dataPlane.searchChangeActivity(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-change-activity-detail') {
        const body = await readJsonBody<GetChangeActivityDetailRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'getChangeActivityDetail',
          fallbackOperation: sourceFallback ? () => sourceFallback.getChangeActivityDetail(body) : null,
          primaryOperation: () => dataPlane.getChangeActivityDetail(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/get-change-feed-status') {
        const body = await readJsonBody<GetChangeFeedStatusRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'getChangeFeedStatus',
          fallbackOperation: sourceFallback ? () => sourceFallback.getChangeFeedStatus(body) : null,
          primaryOperation: () => dataPlane.getChangeFeedStatus(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/discover-change-patterns') {
        const body = await readJsonBody<DiscoverChangePatternsRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'discoverChangePatterns',
          fallbackOperation: sourceFallback ? () => sourceFallback.discoverChangePatterns(body) : null,
          primaryOperation: () => dataPlane.discoverChangePatterns(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/rank-entities') {
        const body = await readJsonBody<RankEntitiesRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'rankEntities',
          fallbackOperation: sourceFallback ? () => sourceFallback.rankEntities(body) : null,
          primaryOperation: () => dataPlane.rankEntities(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/query-monthly-playtime') {
        const body = await readJsonBody<QueryMonthlyPlaytimeRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'queryMonthlyPlaytime',
          fallbackOperation: sourceFallback ? () => sourceFallback.queryMonthlyPlaytime(body) : null,
          primaryOperation: () => dataPlane.queryMonthlyPlaytime(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/compare-entities') {
        const body = await readJsonBody<CompareEntitiesRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'compareEntities',
          fallbackOperation: sourceFallback ? () => sourceFallback.compareEntities(body) : null,
          primaryOperation: () => dataPlane.compareEntities(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/trace-metric-history') {
        const body = await readJsonBody<TraceMetricHistoryRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'traceMetricHistory',
          fallbackOperation: sourceFallback ? () => sourceFallback.traceMetricHistory(body) : null,
          primaryOperation: () => dataPlane.traceMetricHistory(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/explain-changes') {
        const body = await readJsonBody<ExplainChangesRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'explainChanges',
          fallbackOperation: sourceFallback ? () => sourceFallback.explainChanges(body) : null,
          primaryOperation: () => dataPlane.explainChanges(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/search-documents') {
        const body = await readJsonBody<SearchDocumentsRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'searchDocuments',
          fallbackOperation: sourceFallback ? () => sourceFallback.searchDocuments(body) : null,
          primaryOperation: () => dataPlane.searchDocuments(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/semantic-search') {
        const body = await readJsonBody<SemanticSearchRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'semanticSearch',
          fallbackOperation: sourceFallback ? () => sourceFallback.semanticSearch(body) : null,
          primaryOperation: () => dataPlane.semanticSearch(body),
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/contracts/continue-result-set') {
        const body = await readJsonBody<ContinueResultSetRequest>(request);
        const result = await executeWithSourceFallback({
          action: 'continueResultSet',
          fallbackOperation: sourceFallback ? () => sourceFallback.continueResultSet(body) : null,
          primaryOperation: () => dataPlane.continueResultSet(body),
        });
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
  sourceFallback?: QueryApiService | null;
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
  const sourceFallback =
    params?.sourceFallback
    ?? (
      !params?.dataPlane && config?.source === 'tiger'
        ? createSourceFallback(config)
        : null
    );

  return createServer(
    createQueryApiRequestHandler({
      bearerToken: params?.bearerToken ?? config?.bearerToken ?? null,
      dataPlane,
      relatedEntitiesFallback,
      sourceFallback,
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

function createSourceFallback(
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

    return new DataPlaneService(fallbackConfig);
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
