import type { QueryResultRow } from 'pg';

import { logger, PublisherIQError } from '@publisheriq/shared';

import type {
  DataPlaneReadiness,
  DataPlaneRelationKey,
  EntityKind,
  ExplainChangesLinkedNewsItem,
  ExplainChangesMoment,
  ExplainChangesRequest,
  ExplainChangesResponse,
  MatchQuality,
  QueryProvenance,
  RankEntitiesRequest,
  RankEntitiesResponse,
  RankMetric,
  RankedEntity,
  ResolveEntitiesRequest,
  ResolveEntitiesResponse,
  ResolvedEntity,
  RuntimeQueryContractDescriptor,
  SearchCatalogItem,
  SearchCatalogRequest,
  SearchCatalogResponse,
  SearchDocumentItem,
  SearchDocumentsRequest,
  SearchDocumentsResponse,
  TraceMetric,
  TraceMetricHistoryRequest,
  TraceMetricHistoryResponse,
  TraceMetricHistorySeries,
} from './contracts.js';
import { CONTRACT_REGISTRY } from './contract-registry.js';
import { loadDataPlaneConfig, type DataPlaneConfig } from './config.js';
import { ContractRuntimeUnavailableError } from './errors.js';
import { buildEntityUid } from './identity.js';
import { runQuery } from './pg.js';

interface EntityRow extends QueryResultRow {
  ccu_peak: number | null;
  display_name: string;
  entity_id: number;
  game_count?: number | null;
  owners_midpoint: number | null;
  release_year?: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface CatalogRow extends QueryResultRow {
  appid: number;
  ccu_peak: number | null;
  developers: string[] | null;
  is_free: boolean;
  name: string;
  owners_midpoint: number | null;
  platforms: string | null;
  publishers: string[] | null;
  release_date: string | null;
  release_year: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface RankRow extends QueryResultRow {
  ccu_peak: number | null;
  display_name: string;
  entity_id: number;
  game_count: number | null;
  owners_midpoint: number | null;
  release_year?: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface CoreEntityRow extends QueryResultRow {
  canonical_name: string;
  entity_kind: EntityKind;
  entity_uid: string;
  platform: 'steam' | 'publisheriq';
  platform_entity_id: string;
}

interface DailyMetricHistoryRow extends QueryResultRow {
  average_playtime_2weeks: number | null;
  average_playtime_forever: number | null;
  ccu_peak: number | null;
  discount_percent: number | null;
  metric_date: string;
  negative_reviews: number | null;
  owners_max: number | null;
  owners_min: number | null;
  positive_reviews: number | null;
  price_cents: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface ChangeEventRow extends QueryResultRow {
  after_value: unknown | null;
  before_value: unknown | null;
  change_type: string;
  context: unknown;
  id: string;
  news_item_gid: string | null;
  occurred_at: string;
  source: string;
}

interface ExplainNewsRow extends QueryResultRow {
  feed_scope: string | null;
  feedlabel: string | null;
  feedname: string | null;
  first_seen_at: string;
  gid: string;
  published_at: string | null;
  sort_time: string;
  title: string | null;
  url: string;
}

interface SearchDocumentRow extends QueryResultRow {
  app_name: string;
  appid: number;
  feed_scope: string;
  feedlabel: string | null;
  feedname: string | null;
  first_seen_at: string;
  gid: string;
  published_at: string | null;
  rank: number;
  sort_time: string;
  title: string | null;
  title_phrase_hit: boolean;
  url: string;
}

interface ExplainMomentAccumulator {
  directNewsGids: Set<string>;
  events: ChangeEventRow[];
  linkedNews: ExplainChangesLinkedNewsItem[];
  windowEnd: Date;
  windowStart: Date;
}

interface ContinuationTokenPayload {
  offset: number;
}

interface RelationLocation {
  schema: string;
  sql: string;
  table: string;
}

const DEFAULT_ENTITY_LIMIT = 8;
const DEFAULT_CATALOG_LIMIT = 25;
const DEFAULT_RANK_LIMIT = 10;
const DEFAULT_TRACE_DAYS = 30;
const DEFAULT_EXPLAIN_CHANGES_DAYS = 14;
const DEFAULT_EXPLAIN_CHANGES_LIMIT = 20;
const DEFAULT_DOCUMENT_SEARCH_DAYS = 30;
const DEFAULT_DOCUMENT_LIMIT = 8;
const MAX_ENTITY_LIMIT = 15;
const MAX_CATALOG_LIMIT = 50;
const MAX_RANK_LIMIT = 25;
const MAX_TRACE_DAYS = 180;
const MAX_TRACE_METRICS = 4;
const MAX_EXPLAIN_CHANGES_DAYS = 90;
const MAX_EXPLAIN_CHANGES_LIMIT = 50;
const MAX_DOCUMENT_SEARCH_DAYS = 90;
const MAX_DOCUMENT_LIMIT = 10;
const EXPLAIN_CHANGE_MOMENT_GAP_MS = 6 * 60 * 60 * 1000;
const EXPLAIN_NEWS_PROXIMITY_MS = 24 * 60 * 60 * 1000;
const READINESS_GATE_CONTRACTS = new Set<
  RuntimeQueryContractDescriptor['name']
>(['resolveEntities', 'searchCatalog', 'rankEntities']);
const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE_METRIC_SET = new Set<TraceMetric>([
  'owners_midpoint',
  'ccu_peak',
  'total_reviews',
  'positive_reviews',
  'negative_reviews',
  'review_score',
  'positive_percentage',
  'price_cents',
  'discount_percent',
  'average_playtime_forever',
  'average_playtime_2weeks',
]);
const GAME_TYPE_PREDICATE: Record<DataPlaneConfig['source'], string> = {
  tiger: "a.type = 'game'",
  'supabase-postgres': "a.type = 'game'::public.app_type",
};
const RELATION_LOCATIONS: Record<
  DataPlaneConfig['source'],
  Record<DataPlaneRelationKey, RelationLocation>
> = {
  'supabase-postgres': {
    app_developers: { schema: 'public', sql: 'public.app_developers', table: 'app_developers' },
    app_genres: { schema: 'public', sql: 'public.app_genres', table: 'app_genres' },
    app_publishers: { schema: 'public', sql: 'public.app_publishers', table: 'app_publishers' },
    app_steam_tags: { schema: 'public', sql: 'public.app_steam_tags', table: 'app_steam_tags' },
    apps: { schema: 'public', sql: 'public.apps', table: 'apps' },
    developers: { schema: 'public', sql: 'public.developers', table: 'developers' },
    latest_daily_metrics: {
      schema: 'public',
      sql: 'public.latest_daily_metrics',
      table: 'latest_daily_metrics',
    },
    metrics_daily_metrics: {
      schema: 'public',
      sql: 'public.daily_metrics',
      table: 'daily_metrics',
    },
    core_entities: {
      schema: 'public',
      sql: 'public.core_entities',
      table: 'core_entities',
    },
    docs_steam_news_items: {
      schema: 'public',
      sql: 'public.steam_news_items',
      table: 'steam_news_items',
    },
    docs_steam_news_search_projection: {
      schema: 'public',
      sql: 'public.steam_news_search_projection',
      table: 'steam_news_search_projection',
    },
    events_app_change_events: {
      schema: 'public',
      sql: 'public.app_change_events',
      table: 'app_change_events',
    },
    publishers: { schema: 'public', sql: 'public.publishers', table: 'publishers' },
    steam_genres: { schema: 'public', sql: 'public.steam_genres', table: 'steam_genres' },
    steam_tags: { schema: 'public', sql: 'public.steam_tags', table: 'steam_tags' },
  },
  tiger: {
    app_developers: { schema: 'legacy', sql: 'legacy.app_developers', table: 'app_developers' },
    app_genres: { schema: 'legacy', sql: 'legacy.app_genres', table: 'app_genres' },
    app_publishers: { schema: 'legacy', sql: 'legacy.app_publishers', table: 'app_publishers' },
    app_steam_tags: { schema: 'legacy', sql: 'legacy.app_steam_tags', table: 'app_steam_tags' },
    apps: { schema: 'legacy', sql: 'legacy.apps', table: 'apps' },
    developers: { schema: 'legacy', sql: 'legacy.developers', table: 'developers' },
    latest_daily_metrics: {
      schema: 'legacy',
      sql: 'legacy.latest_daily_metrics',
      table: 'latest_daily_metrics',
    },
    metrics_daily_metrics: {
      schema: 'metrics',
      sql: 'metrics.daily_metrics',
      table: 'daily_metrics',
    },
    core_entities: {
      schema: 'core',
      sql: 'core.entities',
      table: 'entities',
    },
    docs_steam_news_items: {
      schema: 'docs',
      sql: 'docs.steam_news_items',
      table: 'steam_news_items',
    },
    docs_steam_news_search_projection: {
      schema: 'docs',
      sql: 'docs.steam_news_search_projection',
      table: 'steam_news_search_projection',
    },
    events_app_change_events: {
      schema: 'events',
      sql: 'events.app_change_events',
      table: 'app_change_events',
    },
    publishers: { schema: 'legacy', sql: 'legacy.publishers', table: 'publishers' },
    steam_genres: { schema: 'legacy', sql: 'legacy.steam_genres', table: 'steam_genres' },
    steam_tags: { schema: 'legacy', sql: 'legacy.steam_tags', table: 'steam_tags' },
  },
};

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(value)));
}

function normalizeLikeValue(value: string): string {
  return `%${value.trim().toLowerCase()}%`;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date): string {
  return value.toISOString();
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parseTimestamp(value: string): Date {
  return new Date(value);
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function resolveOwnersMidpoint(row: DailyMetricHistoryRow): number | null {
  if (row.owners_min === null && row.owners_max === null) {
    return null;
  }

  const minValue = row.owners_min ?? row.owners_max ?? 0;
  const maxValue = row.owners_max ?? row.owners_min ?? 0;
  return (minValue + maxValue) / 2;
}

function traceMetricValue(metric: TraceMetric, row: DailyMetricHistoryRow): number | null {
  switch (metric) {
    case 'average_playtime_2weeks':
      return row.average_playtime_2weeks;
    case 'average_playtime_forever':
      return row.average_playtime_forever;
    case 'ccu_peak':
      return row.ccu_peak;
    case 'discount_percent':
      return row.discount_percent;
    case 'negative_reviews':
      return row.negative_reviews;
    case 'owners_midpoint':
      return resolveOwnersMidpoint(row);
    case 'positive_percentage':
      return row.total_reviews && row.total_reviews > 0 && row.positive_reviews !== null
        ? roundNumber((row.positive_reviews * 100) / row.total_reviews, 1)
        : null;
    case 'positive_reviews':
      return row.positive_reviews;
    case 'price_cents':
      return row.price_cents;
    case 'review_score':
      return row.review_score;
    case 'total_reviews':
      return row.total_reviews;
  }
}

function metricValueForRow(metric: RankMetric, row: RankRow): number | null {
  switch (metric) {
    case 'ccu_peak':
      return row.ccu_peak;
    case 'game_count':
      return row.game_count;
    case 'owners_midpoint':
      return row.owners_midpoint;
    case 'review_score':
      return row.review_score;
    case 'total_reviews':
      return row.total_reviews;
  }
}

function inferMatchQuality(candidate: string, query: string): MatchQuality {
  const normalizedCandidate = candidate.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedCandidate === normalizedQuery) {
    return 'exact';
  }

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 'prefix';
  }

  return 'substring';
}

function matchConfidence(matchQuality: MatchQuality): number {
  switch (matchQuality) {
    case 'exact':
      return 0.99;
    case 'prefix':
      return 0.92;
    default:
      return 0.82;
  }
}

function buildProvenance(source: DataPlaneConfig['source'], tables: string[]): QueryProvenance {
  return {
    capturedAt: new Date().toISOString(),
    source,
    tables,
  };
}

function encodeContinuationToken(payload: ContinuationTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeContinuationToken(token: string | null | undefined): ContinuationTokenPayload {
  if (!token) {
    return { offset: 0 };
  }

  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      offset?: unknown;
    };

    const offset = Number(parsed.offset);
    return Number.isFinite(offset) && offset >= 0
      ? { offset: Math.floor(offset) }
      : { offset: 0 };
  } catch {
    return { offset: 0 };
  }
}

export class DataPlaneService {
  constructor(private readonly config: DataPlaneConfig = loadDataPlaneConfig()) {}

  async describeContracts(): Promise<{
    contracts: RuntimeQueryContractDescriptor[];
    source: DataPlaneConfig['source'];
  }> {
    const contracts = await Promise.all(
      CONTRACT_REGISTRY.map(async (contract) => {
        const blockingTables =
          contract.status === 'ready'
            ? await this.getBlockingTables(contract.requiredRelations)
            : contract.requiredRelations.map((relationKey) => this.relation(relationKey).sql);

        return {
          ...contract,
          blockingTables,
          runtimeReadiness:
            contract.status === 'ready' && blockingTables.length === 0 ? 'ready' : 'blocked',
        } satisfies RuntimeQueryContractDescriptor;
      })
    );

    return {
      contracts,
      source: this.config.source,
    };
  }

  async healthCheck(): Promise<QueryProvenance> {
    await runQuery('SELECT 1', [], this.config);
    return buildProvenance(this.config.source, []);
  }

  async readinessCheck(): Promise<DataPlaneReadiness> {
    const description = await this.describeContracts();
    const blockedContracts = description.contracts
      .filter((contract) => contract.status === 'ready' && contract.runtimeReadiness === 'blocked')
      .map((contract) => ({
        blockingTables: contract.blockingTables,
        name: contract.name,
      }));
    const readinessBlockingContracts = blockedContracts.filter((contract) =>
      READINESS_GATE_CONTRACTS.has(contract.name)
    );

    return {
      blockedContracts,
      provenance: buildProvenance(
        this.config.source,
        description.contracts
          .filter((contract) => contract.status === 'ready')
          .flatMap((contract) => contract.requiredRelations.map((relationKey) => this.relation(relationKey).sql))
      ),
      ready: readinessBlockingContracts.length === 0,
    };
  }

  async resolveEntities(request: ResolveEntitiesRequest): Promise<ResolveEntitiesResponse> {
    await this.assertContractRuntime('resolveEntities');
    const query = request.query.trim();

    if (!query) {
      return {
        ambiguity: {
          candidateNames: [],
          message: 'Query text is required.',
          requiresClarification: true,
        },
        entities: [],
        provenance: buildProvenance(this.config.source, []),
      };
    }

    const limit = normalizeLimit(request.limit, DEFAULT_ENTITY_LIMIT, MAX_ENTITY_LIMIT);
    const includeMetrics = request.includeMetrics ?? true;
    const requestedKinds = new Set<EntityKind>(
      request.entityKinds?.length ? request.entityKinds : ['game', 'publisher', 'developer']
    );

    const entities: ResolvedEntity[] = [];

    if (requestedKinds.has('game')) {
      const gameRows = await this.queryGames(query, limit);
      entities.push(...gameRows.map((row) => this.mapResolvedEntity('game', 'steam', row, query, includeMetrics)));
    }

    if (requestedKinds.has('publisher')) {
      const publisherRows = await this.queryCompanies('publisher', query, limit);
      entities.push(
        ...publisherRows.map((row) =>
          this.mapResolvedEntity('publisher', 'publisheriq', row, query, includeMetrics)
        )
      );
    }

    if (requestedKinds.has('developer')) {
      const developerRows = await this.queryCompanies('developer', query, limit);
      entities.push(
        ...developerRows.map((row) =>
          this.mapResolvedEntity('developer', 'publisheriq', row, query, includeMetrics)
        )
      );
    }

    const sortedEntities = entities
      .sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }

        const rightReviews = right.latestMetrics?.totalReviews ?? 0;
        const leftReviews = left.latestMetrics?.totalReviews ?? 0;
        if (rightReviews !== leftReviews) {
          return rightReviews - leftReviews;
        }

        return left.displayName.localeCompare(right.displayName);
      })
      .slice(0, limit);

    const ambiguity =
      sortedEntities.length <= 1
        ? {
            candidateNames: sortedEntities.map((entity) => entity.displayName),
            message: null,
            requiresClarification: false,
          }
        : {
            candidateNames: sortedEntities.slice(0, 3).map((entity) => entity.displayName),
            message:
              sortedEntities[0].confidence - sortedEntities[1].confidence < 0.08
                ? 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.'
                : null,
            requiresClarification:
              sortedEntities[0].confidence - sortedEntities[1].confidence < 0.08,
          };

    return {
      ambiguity,
      entities: sortedEntities,
      provenance: buildProvenance(this.config.source, [
        this.relation('apps').sql,
        this.relation('latest_daily_metrics').sql,
        this.relation('publishers').sql,
        this.relation('developers').sql,
      ]),
    };
  }

  async searchCatalog(request: SearchCatalogRequest): Promise<SearchCatalogResponse> {
    await this.assertContractRuntime('searchCatalog');
    await this.assertTigerSearchFiltersSupported(request);

    const limit = normalizeLimit(request.limit, DEFAULT_CATALOG_LIMIT, MAX_CATALOG_LIMIT);
    const { offset } = decodeContinuationToken(request.continuationToken);
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appPublishersTable = this.relation('app_publishers').sql;
    const publishersTable = this.relation('publishers').sql;
    const appDevelopersTable = this.relation('app_developers').sql;
    const developersTable = this.relation('developers').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;

    const params: unknown[] = [];
    const conditions: string[] = [
      "a.is_delisted = false",
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (request.query?.trim()) {
      params.push(normalizeLikeValue(request.query));
      conditions.push(`lower(a.name) LIKE $${params.length}`);
    }

    if (request.publisherQuery?.trim()) {
      params.push(normalizeLikeValue(request.publisherQuery));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appPublishersTable} ap
          JOIN ${publishersTable} p ON p.id = ap.publisher_id
          WHERE ap.appid = a.appid
            AND lower(p.name) LIKE $${params.length}
        )`
      );
    }

    if (request.developerQuery?.trim()) {
      params.push(normalizeLikeValue(request.developerQuery));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appDevelopersTable} ad
          JOIN ${developersTable} d ON d.id = ad.developer_id
          WHERE ad.appid = a.appid
            AND lower(d.name) LIKE $${params.length}
        )`
      );
    }

    if (typeof request.isFree === 'boolean') {
      params.push(request.isFree);
      conditions.push(`a.is_free = $${params.length}`);
    }

    if (request.releaseYear?.gte) {
      params.push(request.releaseYear.gte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) >= $${params.length}`);
    }

    if (request.releaseYear?.lte) {
      params.push(request.releaseYear.lte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) <= $${params.length}`);
    }

    if (typeof request.minReviews === 'number') {
      params.push(request.minReviews);
      conditions.push(`COALESCE(ldm.total_reviews, 0) >= $${params.length}`);
    }

    if (typeof request.minReviewScore === 'number') {
      params.push(request.minReviewScore);
      conditions.push(
        request.minReviewScore > 10
          ? `COALESCE(ldm.positive_percentage, 0) >= $${params.length}`
          : `COALESCE(ldm.review_score, 0) >= $${params.length}`
      );
    }

    if (typeof request.minOwners === 'number') {
      params.push(request.minOwners);
      conditions.push(`COALESCE(ldm.owners_midpoint, 0) >= $${params.length}`);
    }

    if (typeof request.minCcu === 'number') {
      params.push(request.minCcu);
      conditions.push(`COALESCE(ldm.ccu_peak, 0) >= $${params.length}`);
    }

    if (request.platforms?.length) {
      for (const platform of request.platforms) {
        params.push(`%${platform.toLowerCase()}%`);
        conditions.push(`lower(COALESCE(a.platforms, '')) LIKE $${params.length}`);
      }
    }

    if (request.genres?.length) {
      params.push(request.genres.map((genre) => genre.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appGenresTable} ag
          JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
          WHERE ag.appid = a.appid
            AND lower(sg.name) = ANY($${params.length}::text[])
        )`
      );
    }

    if (request.tags?.length) {
      params.push(request.tags.map((tag) => tag.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamTagsTable} ast
          JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
          WHERE ast.appid = a.appid
            AND lower(st.name) = ANY($${params.length}::text[])
        )`
      );
    }

    const sortBy = request.sortBy ?? 'relevance';
    const sortDirection = request.sortDirection ?? 'desc';
    const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';

    let orderClause = `COALESCE(ldm.total_reviews, 0) DESC, a.name ASC`;
    if (sortBy === 'reviews') {
      orderClause = `COALESCE(ldm.total_reviews, 0) ${direction}, a.name ASC`;
    } else if (sortBy === 'owners') {
      orderClause = `COALESCE(ldm.owners_midpoint, 0) ${direction}, a.name ASC`;
    } else if (sortBy === 'release_date') {
      orderClause = `a.release_date ${direction} NULLS LAST, a.name ASC`;
    } else if (sortBy === 'ccu_peak') {
      orderClause = `COALESCE(ldm.ccu_peak, 0) ${direction}, a.name ASC`;
    } else if (request.query?.trim()) {
      params.push(request.query.trim().toLowerCase());
      params.push(`${request.query.trim().toLowerCase()}%`);
      params.push(normalizeLikeValue(request.query));
      orderClause = `CASE
          WHEN lower(a.name) = $${params.length - 2} THEN 3
          WHEN lower(a.name) LIKE $${params.length - 1} THEN 2
          WHEN lower(a.name) LIKE $${params.length} THEN 1
          ELSE 0
        END DESC,
        COALESCE(ldm.total_reviews, 0) DESC,
        a.name ASC`;
    }

    params.push(limit + 1);
    params.push(offset);

    const sql = `
      SELECT
        a.appid,
        a.name,
        a.is_free,
        a.platforms,
        a.release_date::text,
        EXTRACT(YEAR FROM a.release_date)::int AS release_year,
        ldm.total_reviews,
        ldm.review_score,
        ldm.owners_midpoint,
        ldm.ccu_peak,
        COALESCE((
          SELECT array_agg(DISTINCT p.name ORDER BY p.name)
          FROM ${appPublishersTable} ap
          JOIN ${publishersTable} p ON p.id = ap.publisher_id
          WHERE ap.appid = a.appid
        ), ARRAY[]::text[]) AS publishers,
        COALESCE((
          SELECT array_agg(DISTINCT d.name ORDER BY d.name)
          FROM ${appDevelopersTable} ad
          JOIN ${developersTable} d ON d.id = ad.developer_id
          WHERE ad.appid = a.appid
        ), ARRAY[]::text[]) AS developers
      FROM ${appsTable} a
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY ${orderClause}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const result = await runQuery<CatalogRow>(sql, params, this.config);
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: SearchCatalogItem[] = pageRows.map((row) => ({
      appid: row.appid,
      ccuPeak: row.ccu_peak,
      developers: row.developers ?? [],
      entityUid: buildEntityUid('steam', 'game', String(row.appid)),
      isFree: row.is_free,
      name: row.name,
      ownersMidpoint: row.owners_midpoint,
      platforms: row.platforms
        ? row.platforms.split(',').map((platform) => platform.trim()).filter(Boolean)
        : [],
      publishers: row.publishers ?? [],
      releaseDate: row.release_date,
      releaseYear: row.release_year,
      reviewScore: row.review_score,
      totalReviews: row.total_reviews,
    }));

    return {
      continuationToken: hasMore
        ? encodeContinuationToken({ offset: offset + items.length })
        : null,
      interpretedFilters: {
        developerQuery: request.developerQuery?.trim() ?? null,
        genres: request.genres ?? [],
        isFree: request.isFree ?? null,
        minCcu: request.minCcu ?? null,
        minOwners: request.minOwners ?? null,
        minReviewScore: request.minReviewScore ?? null,
        minReviews: request.minReviews ?? null,
        platforms: request.platforms ?? [],
        publisherQuery: request.publisherQuery?.trim() ?? null,
        query: request.query?.trim() ?? null,
        releaseYear: request.releaseYear
          ? {
              gte: request.releaseYear.gte ?? null,
              lte: request.releaseYear.lte ?? null,
            }
          : null,
        sortBy,
        sortDirection,
        tags: request.tags ?? [],
      },
      items,
      provenance: buildProvenance(this.config.source, [
        appsTable,
        latestDailyMetricsTable,
        appPublishersTable,
        publishersTable,
        appDevelopersTable,
        developersTable,
        appGenresTable,
        steamGenresTable,
        appSteamTagsTable,
        steamTagsTable,
      ]),
      sufficientToAnswer: items.length > 0,
    };
  }

  async rankEntities(request: RankEntitiesRequest): Promise<RankEntitiesResponse> {
    await this.assertContractRuntime('rankEntities');

    const limit = normalizeLimit(request.limit, DEFAULT_RANK_LIMIT, MAX_RANK_LIMIT);
    const direction = request.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const entityKind = request.entityKind;
    const metric = request.metric;
    const query = request.query?.trim() ?? '';

    if (entityKind === 'game' && metric === 'game_count') {
      throw new PublisherIQError(
        'game_count rankings are only valid for publisher or developer entities.',
        'INVALID_RANK_METRIC',
        { entityKind, metric }
      );
    }

    const rows =
      entityKind === 'game'
        ? await this.queryRankedGames(
            metric as Exclude<RankMetric, 'game_count'>,
            query,
            limit,
            direction
          )
        : await this.queryRankedCompanies(entityKind, metric, query, limit, direction);

    return {
      entityKind,
      items: rows.map((row, index) => this.mapRankedEntity(entityKind, metric, row, index + 1)),
      metric,
      provenance: buildProvenance(
        this.config.source,
        entityKind === 'game'
          ? [this.relation('apps').sql, this.relation('latest_daily_metrics').sql]
          : [
              this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql,
              this.relation(entityKind === 'publisher' ? 'app_publishers' : 'app_developers').sql,
              this.relation('apps').sql,
              this.relation('latest_daily_metrics').sql,
            ]
      ),
      sufficientToAnswer: rows.length > 0,
    };
  }

  async traceMetricHistory(
    request: TraceMetricHistoryRequest
  ): Promise<TraceMetricHistoryResponse> {
    await this.assertContractRuntime('traceMetricHistory');

    const metrics = this.normalizeTraceMetrics(request.metrics);
    const { endDate, startDate } = this.normalizeTraceDateWindow(
      request.startDate ?? null,
      request.endDate ?? null
    );
    const entity = await this.resolveCoreEntity(request.entityUid, {
      invalidCode: 'INVALID_TRACE_ENTITY_UID',
      notFoundCode: 'TRACE_ENTITY_NOT_FOUND',
    });

    if (entity.entity_kind !== 'game' || entity.platform !== 'steam') {
      throw new PublisherIQError(
        'traceMetricHistory currently supports only Steam game entities.',
        'INVALID_TRACE_ENTITY_KIND',
        {
          entityKind: entity.entity_kind,
          entityUid: request.entityUid,
          platform: entity.platform,
        }
      );
    }

    const appid = Number(entity.platform_entity_id);
    if (!Number.isInteger(appid) || appid <= 0) {
      throw new PublisherIQError(
        'Resolved game entity does not have a valid Steam appid.',
        'INVALID_TRACE_ENTITY_ID',
        {
          entityUid: request.entityUid,
          platformEntityId: entity.platform_entity_id,
        }
      );
    }

    const rows = await this.queryMetricHistoryRows(appid, startDate, endDate);
    const series = metrics.map((metric) => this.buildTraceSeries(metric, rows));

    return {
      endDate,
      entity: {
        displayName: entity.canonical_name,
        entityKind: entity.entity_kind,
        entityUid: entity.entity_uid,
        platform: entity.platform,
        platformEntityId: entity.platform_entity_id,
      },
      metrics,
      provenance: buildProvenance(this.config.source, [
        this.relation('core_entities').sql,
        this.relation('metrics_daily_metrics').sql,
      ]),
      series,
      startDate,
      sufficientToAnswer: series.some((item) => item.summary.pointCount > 0),
    };
  }

  async explainChanges(request: ExplainChangesRequest): Promise<ExplainChangesResponse> {
    await this.assertContractRuntime('explainChanges');

    const { endTime, startTime } = this.normalizeExplainTimeWindow(
      request.startTime ?? null,
      request.endTime ?? null
    );
    const limit = normalizeLimit(
      request.limit,
      DEFAULT_EXPLAIN_CHANGES_LIMIT,
      MAX_EXPLAIN_CHANGES_LIMIT
    );
    const includeNews = request.includeNews ?? true;
    const sources = this.normalizeExplainFilters(request.sources);
    const changeTypes = this.normalizeExplainFilters(request.changeTypes);
    const entity = await this.resolveCoreEntity(request.entityUid, {
      invalidCode: 'INVALID_EXPLAIN_ENTITY_UID',
      notFoundCode: 'EXPLAIN_ENTITY_NOT_FOUND',
    });

    if (entity.entity_kind !== 'game' || entity.platform !== 'steam') {
      throw new PublisherIQError(
        'explainChanges currently supports only Steam game entities.',
        'INVALID_EXPLAIN_ENTITY_KIND',
        {
          entityKind: entity.entity_kind,
          entityUid: request.entityUid,
          platform: entity.platform,
        }
      );
    }

    const appid = Number(entity.platform_entity_id);
    if (!Number.isInteger(appid) || appid <= 0) {
      throw new PublisherIQError(
        'Resolved game entity does not have a valid Steam appid.',
        'INVALID_EXPLAIN_ENTITY_ID',
        {
          entityUid: request.entityUid,
          platformEntityId: entity.platform_entity_id,
        }
      );
    }

    const events = await this.queryChangeEvents(appid, startTime, endTime, sources, changeTypes);
    const moments = this.buildExplainMoments(events, limit);

    if (includeNews && moments.length > 0) {
      await this.attachExplainNews(appid, moments);
    }

    const responseMoments: ExplainChangesMoment[] = moments.map((moment) => ({
      changeTypes: [...new Set(moment.events.map((event) => event.change_type))].sort(),
      eventCount: moment.events.length,
      events: [...moment.events]
        .sort(
          (left, right) =>
            parseTimestamp(left.occurred_at).getTime() - parseTimestamp(right.occurred_at).getTime() ||
            left.id.localeCompare(right.id)
        )
        .map((event) => ({
          afterValue: event.after_value,
          beforeValue: event.before_value,
          changeType: event.change_type,
          context: event.context,
          id: event.id,
          newsItemGid: event.news_item_gid,
          occurredAt: formatTimestamp(parseTimestamp(event.occurred_at)),
          source: event.source,
        })),
      linkedNews: [...moment.linkedNews].sort(
        (left, right) => parseTimestamp(right.sortTime).getTime() - parseTimestamp(left.sortTime).getTime()
      ),
      sources: [...new Set(moment.events.map((event) => event.source))].sort(),
      windowEnd: formatTimestamp(moment.windowEnd),
      windowStart: formatTimestamp(moment.windowStart),
    }));

    const responseEvents = responseMoments.flatMap((moment) => moment.events);
    const responseNews = responseMoments.flatMap((moment) => moment.linkedNews);

    return {
      entity: {
        displayName: entity.canonical_name,
        entityKind: entity.entity_kind,
        entityUid: entity.entity_uid,
        platform: entity.platform,
        platformEntityId: entity.platform_entity_id,
      },
      moments: responseMoments,
      provenance: buildProvenance(
        this.config.source,
        includeNews
          ? [
              this.relation('core_entities').sql,
              this.relation('events_app_change_events').sql,
              this.relation('docs_steam_news_items').sql,
              this.relation('docs_steam_news_search_projection').sql,
            ]
          : [this.relation('core_entities').sql, this.relation('events_app_change_events').sql]
      ),
      sufficientToAnswer: true,
      summary: {
        countsByChangeType: countBy(responseEvents.map((event) => event.changeType)),
        countsBySource: countBy(responseEvents.map((event) => event.source)),
        eventCount: responseEvents.length,
        momentCount: responseMoments.length,
        newsCount: responseNews.length,
      },
      timeWindow: {
        endTime,
        startTime,
      },
    };
  }

  async searchDocuments(
    request: SearchDocumentsRequest
  ): Promise<SearchDocumentsResponse> {
    const blockingTables = await this.getBlockingTables([
      'docs_steam_news_items',
      'docs_steam_news_search_projection',
      'apps',
    ]);

    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        'searchDocuments is not ready on the current data source until the docs/news projection tables are present and backfilled.',
        'searchDocuments',
        blockingTables
      );
    }

    const query = request.query.trim();
    if (!query) {
      throw new PublisherIQError(
        'searchDocuments requires a non-empty query string.',
        'INVALID_DOCUMENT_QUERY'
      );
    }

    const { endTime, startTime } = this.normalizeDocumentTimeWindow(
      request.startTime ?? null,
      request.endTime ?? null
    );
    const limit = normalizeLimit(request.limit, DEFAULT_DOCUMENT_LIMIT, MAX_DOCUMENT_LIMIT);
    const feedScopes = this.normalizeFeedScopes(request.feedScopes);
    const entity = request.entityUid?.trim()
      ? await this.resolveCoreEntity(request.entityUid.trim(), {
          invalidCode: 'INVALID_DOCUMENT_ENTITY_UID',
          notFoundCode: 'DOCUMENT_ENTITY_NOT_FOUND',
        })
      : null;

    let appidFilter: number | null = null;
    if (entity) {
      if (entity.entity_kind !== 'game' || entity.platform !== 'steam') {
        throw new PublisherIQError(
          'searchDocuments currently supports only Steam game entity filters.',
          'INVALID_DOCUMENT_ENTITY_KIND',
          {
            entityKind: entity.entity_kind,
            entityUid: request.entityUid,
            platform: entity.platform,
          }
        );
      }

      appidFilter = Number(entity.platform_entity_id);
      if (!Number.isInteger(appidFilter) || appidFilter <= 0) {
        throw new PublisherIQError(
          'Resolved game entity does not have a valid Steam appid.',
          'INVALID_DOCUMENT_ENTITY_ID',
          {
            entityUid: request.entityUid,
            platformEntityId: entity.platform_entity_id,
          }
        );
      }
    }

    const rows = await this.querySearchDocumentRows({
      appidFilter,
      endTime,
      feedScopes,
      limit,
      query,
      startTime,
    });

    const items: SearchDocumentItem[] = rows.map((row) => ({
      appid: row.appid,
      appName: row.app_name,
      entityUid: buildEntityUid('steam', 'game', String(row.appid)),
      feedLabel: row.feedlabel,
      feedName: row.feedname,
      feedScope: row.feed_scope,
      firstSeenAt: formatTimestamp(parseTimestamp(row.first_seen_at)),
      gid: row.gid,
      matchReason: row.title_phrase_hit ? 'matched_title_phrase' : 'matched_topic_terms',
      publishedAt: row.published_at ? formatTimestamp(parseTimestamp(row.published_at)) : null,
      rank: roundNumber(row.rank ?? 0, 4),
      sortTime: formatTimestamp(parseTimestamp(row.sort_time)),
      title: row.title,
      url: row.url,
    }));

    return {
      entity: entity
        ? {
            displayName: entity.canonical_name,
            entityKind: entity.entity_kind,
            entityUid: entity.entity_uid,
            platform: entity.platform,
            platformEntityId: entity.platform_entity_id,
          }
        : null,
      interpretedFilters: {
        endTime,
        feedScopes,
        query,
        startTime,
      },
      items,
      provenance: buildProvenance(this.config.source, [
        this.relation('apps').sql,
        this.relation('docs_steam_news_items').sql,
        this.relation('docs_steam_news_search_projection').sql,
      ]),
      sufficientToAnswer: items.length > 0,
    };
  }

  private async queryGames(query: string, limit: number): Promise<EntityRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const sql = `
      SELECT
        a.appid AS entity_id,
        a.name AS display_name,
        EXTRACT(YEAR FROM a.release_date)::int AS release_year,
        ldm.total_reviews,
        ldm.review_score,
        ldm.owners_midpoint,
        ldm.ccu_peak
      FROM ${appsTable} a
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      WHERE a.is_delisted = false
        AND (
          lower(a.name) = lower($1)
          OR lower(a.name) LIKE lower($2)
          OR lower(a.name) LIKE lower($3)
        )
      ORDER BY
        CASE
          WHEN lower(a.name) = lower($1) THEN 3
          WHEN lower(a.name) LIKE lower($2) THEN 2
          ELSE 1
        END DESC,
        COALESCE(ldm.total_reviews, 0) DESC,
        a.name ASC
      LIMIT $4
    `;

    const result = await runQuery<EntityRow>(
      sql,
      [query, `${query}%`, normalizeLikeValue(query), limit],
      this.config
    );

    return result.rows;
  }

  private async queryChangeEvents(
    appid: number,
    startTime: string,
    endTime: string,
    sources: string[],
    changeTypes: string[]
  ): Promise<ChangeEventRow[]> {
    const eventsTable = this.relation('events_app_change_events').sql;
    const params: unknown[] = [appid, startTime, endTime];
    const conditions = [
      'appid = $1',
      'occurred_at BETWEEN $2::timestamptz AND $3::timestamptz',
    ];

    if (sources.length > 0) {
      params.push(sources);
      conditions.push(`lower(source::text) = ANY($${params.length}::text[])`);
    }

    if (changeTypes.length > 0) {
      params.push(changeTypes);
      conditions.push(`lower(change_type::text) = ANY($${params.length}::text[])`);
    }

    const result = await runQuery<ChangeEventRow>(
      `
        SELECT
          id::text AS id,
          source::text AS source,
          change_type::text AS change_type,
          occurred_at::text,
          news_item_gid,
          before_value,
          after_value,
          context
        FROM ${eventsTable}
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY occurred_at DESC, id DESC
      `,
      params,
      this.config
    );

    return result.rows;
  }

  private buildExplainMoments(
    events: ChangeEventRow[],
    limit: number
  ): ExplainMomentAccumulator[] {
    const moments: ExplainMomentAccumulator[] = [];

    for (const event of events) {
      const occurredAt = parseTimestamp(event.occurred_at);
      const currentMoment = moments.at(-1);

      if (
        currentMoment &&
        currentMoment.windowStart.getTime() - occurredAt.getTime() <= EXPLAIN_CHANGE_MOMENT_GAP_MS
      ) {
        currentMoment.events.push(event);
        currentMoment.windowStart = occurredAt;

        if (event.news_item_gid) {
          currentMoment.directNewsGids.add(event.news_item_gid);
        }

        continue;
      }

      moments.push({
        directNewsGids: new Set(event.news_item_gid ? [event.news_item_gid] : []),
        events: [event],
        linkedNews: [],
        windowEnd: occurredAt,
        windowStart: occurredAt,
      });

      if (moments.length >= limit) {
        break;
      }
    }

    return moments;
  }

  private async attachExplainNews(
    appid: number,
    moments: ExplainMomentAccumulator[]
  ): Promise<void> {
    const directNewsGids = [...new Set(moments.flatMap((moment) => [...moment.directNewsGids]))];
    const earliestMomentStart = moments.reduce(
      (earliest, moment) =>
        moment.windowStart.getTime() < earliest.getTime() ? moment.windowStart : earliest,
      moments[0]!.windowStart
    );
    const latestMomentEnd = moments.reduce(
      (latest, moment) =>
        moment.windowEnd.getTime() > latest.getTime() ? moment.windowEnd : latest,
      moments[0]!.windowEnd
    );

    const newsRows = await this.queryExplainNewsRows(
      appid,
      directNewsGids,
      formatTimestamp(addHours(earliestMomentStart, -24)),
      formatTimestamp(addHours(latestMomentEnd, 24))
    );
    const newsByGid = new Map(newsRows.map((row) => [row.gid, row]));

    for (const moment of moments) {
      const linkedNews: ExplainChangesLinkedNewsItem[] = [];
      const seenGids = new Set<string>();
      const directMatches = [...moment.directNewsGids]
        .map((gid) => newsByGid.get(gid))
        .filter((row): row is ExplainNewsRow => Boolean(row))
        .sort(
          (left, right) =>
            parseTimestamp(right.sort_time).getTime() - parseTimestamp(left.sort_time).getTime()
        );

      for (const row of directMatches) {
        linkedNews.push(this.mapExplainNews(row));
        seenGids.add(row.gid);
      }

      if (linkedNews.length < 3) {
        const nearbyCandidates = newsRows
          .filter((row) => !seenGids.has(row.gid))
          .filter((row) => {
            const sortTime = parseTimestamp(row.sort_time).getTime();
            return (
              sortTime >= moment.windowStart.getTime() - EXPLAIN_NEWS_PROXIMITY_MS &&
              sortTime <= moment.windowEnd.getTime() + EXPLAIN_NEWS_PROXIMITY_MS
            );
          })
          .sort(
            (left, right) =>
              parseTimestamp(right.sort_time).getTime() - parseTimestamp(left.sort_time).getTime()
          )
          .slice(0, 3 - linkedNews.length);

        for (const row of nearbyCandidates) {
          linkedNews.push(this.mapExplainNews(row));
          seenGids.add(row.gid);
        }
      }

      moment.linkedNews = linkedNews;
    }
  }

  private async queryExplainNewsRows(
    appid: number,
    directNewsGids: string[],
    windowStart: string,
    windowEnd: string
  ): Promise<ExplainNewsRow[]> {
    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const newsProjectionTable = this.relation('docs_steam_news_search_projection').sql;
    const result = await runQuery<ExplainNewsRow>(
      `
        SELECT
          n.gid,
          n.url,
          n.feedlabel,
          n.feedname,
          n.published_at::text,
          n.first_seen_at::text,
          COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at))::text AS sort_time,
          p.feed_scope,
          p.title
        FROM ${newsItemsTable} n
        LEFT JOIN ${newsProjectionTable} p ON p.gid = n.gid
        WHERE (
          cardinality($2::text[]) > 0
          AND n.gid = ANY($2::text[])
        )
          OR (
            n.appid = $1
            AND COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at))
              BETWEEN $3::timestamptz AND $4::timestamptz
          )
        ORDER BY COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at)) DESC, n.gid DESC
      `,
      [appid, directNewsGids, windowStart, windowEnd],
      this.config
    );

    return result.rows;
  }

  private async querySearchDocumentRows(params: {
    appidFilter: number | null;
    endTime: string;
    feedScopes: string[];
    limit: number;
    query: string;
    startTime: string;
  }): Promise<SearchDocumentRow[]> {
    const projectionTable = this.relation('docs_steam_news_search_projection').sql;
    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const appsTable = this.relation('apps').sql;
    const sqlParams: unknown[] = [params.query, params.startTime, params.endTime];
    const conditions = [
      'projection.sort_time BETWEEN $2::timestamptz AND $3::timestamptz',
      "projection.search_document @@ websearch_to_tsquery('english', $1::text)",
    ];

    if (params.feedScopes.length > 0) {
      sqlParams.push(params.feedScopes);
      conditions.push(`lower(projection.feed_scope) = ANY($${sqlParams.length}::text[])`);
    }

    if (params.appidFilter !== null) {
      sqlParams.push(params.appidFilter);
      conditions.push(`projection.appid = $${sqlParams.length}`);
    }

    sqlParams.push(normalizeLikeValue(params.query));
    sqlParams.push(params.limit);

    const result = await runQuery<SearchDocumentRow>(
      `
        SELECT
          projection.gid,
          projection.appid,
          apps.name AS app_name,
          projection.published_at::text,
          projection.first_seen_at::text,
          projection.sort_time::text,
          projection.feed_scope,
          projection.title,
          news.feedlabel,
          news.feedname,
          news.url,
          ts_rank_cd(
            projection.search_document,
            websearch_to_tsquery('english', $1::text)
          )::double precision AS rank,
          lower(COALESCE(projection.title, '')) LIKE $${sqlParams.length - 1} AS title_phrase_hit
        FROM ${projectionTable} projection
        JOIN ${newsItemsTable} news ON news.gid = projection.gid
        JOIN ${appsTable} apps ON apps.appid = projection.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY
          title_phrase_hit DESC,
          rank DESC,
          projection.sort_time DESC,
          projection.gid DESC
        LIMIT $${sqlParams.length}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async queryCompanies(
    kind: Extract<EntityKind, 'publisher' | 'developer'>,
    query: string,
    limit: number
  ): Promise<EntityRow[]> {
    const table = this.relation(kind === 'publisher' ? 'publishers' : 'developers').sql;
    const idColumn = kind === 'publisher' ? 'id' : 'id';
    const result = await runQuery<EntityRow>(
      `
        SELECT
          ${idColumn} AS entity_id,
          name AS display_name,
          game_count
        FROM ${table}
        WHERE
          lower(name) = lower($1)
          OR lower(name) LIKE lower($2)
          OR lower(name) LIKE lower($3)
        ORDER BY
          CASE
            WHEN lower(name) = lower($1) THEN 3
            WHEN lower(name) LIKE lower($2) THEN 2
            ELSE 1
          END DESC,
          COALESCE(game_count, 0) DESC,
          name ASC
        LIMIT $4
      `,
      [query, `${query}%`, normalizeLikeValue(query), limit],
      this.config
    );

    return result.rows;
  }

  private async queryRankedGames(
    metric: Exclude<RankMetric, 'game_count'>,
    query: string,
    limit: number,
    direction: 'ASC' | 'DESC'
  ): Promise<RankRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const params: unknown[] = [];
    const conditions: string[] = [
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (query) {
      params.push(normalizeLikeValue(query));
      conditions.push(`lower(a.name) LIKE $${params.length}`);
    }

    params.push(limit);

    const sql = `
      SELECT
        a.appid AS entity_id,
        a.name AS display_name,
        EXTRACT(YEAR FROM a.release_date)::int AS release_year,
        ldm.total_reviews,
        ldm.review_score,
        ldm.owners_midpoint,
        ldm.ccu_peak,
        NULL::int AS game_count
      FROM ${appsTable} a
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY COALESCE(ldm.${metric}, 0) ${direction}, COALESCE(ldm.total_reviews, 0) DESC, a.name ASC
      LIMIT $${params.length}
    `;

    const result = await runQuery<RankRow>(sql, params, this.config);
    return result.rows;
  }

  private async queryRankedCompanies(
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>,
    metric: RankMetric,
    query: string,
    limit: number,
    direction: 'ASC' | 'DESC'
  ): Promise<RankRow[]> {
    const companyTable = this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql;
    const relationTable = this.relation(
      entityKind === 'publisher' ? 'app_publishers' : 'app_developers'
    ).sql;
    const relationColumn = entityKind === 'publisher' ? 'publisher_id' : 'developer_id';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (query) {
      params.push(normalizeLikeValue(query));
      conditions.push(`lower(c.name) LIKE $${params.length}`);
    }

    params.push(limit);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join('\n        AND ')}` : '';
    const sql = `
      SELECT
        c.id AS entity_id,
        c.name AS display_name,
        NULL::int AS release_year,
        COUNT(DISTINCT a.appid)::int AS game_count,
        SUM(COALESCE(ldm.total_reviews, 0))::double precision AS total_reviews,
        SUM(COALESCE(ldm.owners_midpoint, 0))::double precision AS owners_midpoint,
        MAX(COALESCE(ldm.ccu_peak, 0))::double precision AS ccu_peak,
        CASE
          WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
            THEN ROUND(
              (
                SUM(COALESCE(ldm.review_score, 0) * COALESCE(ldm.total_reviews, 0))::numeric
                / NULLIF(SUM(COALESCE(ldm.total_reviews, 0)), 0)
              ),
              2
            )::double precision
          ELSE NULL
        END AS review_score
      FROM ${companyTable} c
      LEFT JOIN ${relationTable} rel ON rel.${relationColumn} = c.id
      LEFT JOIN ${appsTable} a
        ON a.appid = rel.appid
        AND a.is_delisted = false
        AND ${GAME_TYPE_PREDICATE[this.config.source]}
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      ${whereClause}
      GROUP BY c.id, c.name
      HAVING COUNT(DISTINCT a.appid) > 0
      ORDER BY COALESCE(${metric}, 0) ${direction}, total_reviews DESC, c.name ASC
      LIMIT $${params.length}
    `;

    const result = await runQuery<RankRow>(sql, params, this.config);
    return result.rows;
  }

  private buildTraceSeries(
    metric: TraceMetric,
    rows: DailyMetricHistoryRow[]
  ): TraceMetricHistorySeries {
    const points = rows.map((row) => ({
      date: row.metric_date,
      value: traceMetricValue(metric, row),
    }));
    const valuedPoints = points.filter(
      (point): point is { date: string; value: number } => point.value !== null
    );
    const firstPoint = valuedPoints[0] ?? null;
    const lastPoint = valuedPoints.at(-1) ?? null;
    const deltaAbs =
      firstPoint && lastPoint ? roundNumber(lastPoint.value - firstPoint.value, 2) : null;
    const deltaPct =
      firstPoint && lastPoint && firstPoint.value !== 0
        ? roundNumber(((lastPoint.value - firstPoint.value) / firstPoint.value) * 100, 2)
        : null;

    return {
      metric,
      points,
      summary: {
        deltaAbs,
        deltaPct,
        firstDate: firstPoint?.date ?? null,
        lastDate: lastPoint?.date ?? null,
        latestValue: lastPoint?.value ?? null,
        pointCount: valuedPoints.length,
        startValue: firstPoint?.value ?? null,
      },
    };
  }

  private normalizeTraceDateWindow(
    startDateInput: string | null,
    endDateInput: string | null
  ): { endDate: string; startDate: string } {
    const today = formatDateOnly(new Date());
    const endDate = endDateInput?.trim() ? this.validateDateOnly(endDateInput, 'endDate') : today;
    const startDate = startDateInput?.trim()
      ? this.validateDateOnly(startDateInput, 'startDate')
      : formatDateOnly(addUtcDays(parseDateOnly(endDate), -(DEFAULT_TRACE_DAYS - 1)));

    if (startDate > endDate) {
      throw new PublisherIQError(
        'startDate must be on or before endDate.',
        'INVALID_TRACE_DATE_RANGE',
        { endDate, startDate }
      );
    }

    const rangeDays =
      Math.floor((parseDateOnly(endDate).getTime() - parseDateOnly(startDate).getTime()) / 86_400_000) + 1;
    if (rangeDays > MAX_TRACE_DAYS) {
      throw new PublisherIQError(
        `traceMetricHistory supports a maximum range of ${MAX_TRACE_DAYS} days.`,
        'TRACE_RANGE_TOO_LARGE',
        { endDate, rangeDays, startDate }
      );
    }

    return { endDate, startDate };
  }

  private normalizeTraceMetrics(metrics: TraceMetric[]): TraceMetric[] {
    if (!Array.isArray(metrics) || metrics.length === 0) {
      throw new PublisherIQError(
        'traceMetricHistory requires at least one metric.',
        'INVALID_TRACE_METRICS'
      );
    }

    const uniqueMetrics: TraceMetric[] = [];
    for (const metric of metrics) {
      if (!TRACE_METRIC_SET.has(metric)) {
        throw new PublisherIQError(
          `Unsupported trace metric: ${String(metric)}.`,
          'INVALID_TRACE_METRIC',
          { metric }
        );
      }

      if (!uniqueMetrics.includes(metric)) {
        uniqueMetrics.push(metric);
      }
    }

    if (uniqueMetrics.length > MAX_TRACE_METRICS) {
      throw new PublisherIQError(
        `traceMetricHistory supports at most ${MAX_TRACE_METRICS} metrics per request.`,
        'TRACE_TOO_MANY_METRICS',
        { metrics: uniqueMetrics }
      );
    }

    return uniqueMetrics;
  }

  private normalizeExplainTimeWindow(
    startTimeInput: string | null,
    endTimeInput: string | null
  ): { endTime: string; startTime: string } {
    const endDate = endTimeInput?.trim()
      ? this.validateIsoTimestamp(endTimeInput, 'endTime')
      : new Date();
    const startDate = startTimeInput?.trim()
      ? this.validateIsoTimestamp(startTimeInput, 'startTime')
      : new Date(endDate.getTime() - DEFAULT_EXPLAIN_CHANGES_DAYS * 24 * 60 * 60 * 1000);

    if (startDate.getTime() > endDate.getTime()) {
      throw new PublisherIQError(
        'startTime must be on or before endTime.',
        'INVALID_EXPLAIN_TIME_RANGE',
        {
          endTime: formatTimestamp(endDate),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    const rangeDays = (endDate.getTime() - startDate.getTime()) / 86_400_000;
    if (rangeDays > MAX_EXPLAIN_CHANGES_DAYS) {
      throw new PublisherIQError(
        `explainChanges supports a maximum range of ${MAX_EXPLAIN_CHANGES_DAYS} days.`,
        'EXPLAIN_RANGE_TOO_LARGE',
        {
          endTime: formatTimestamp(endDate),
          rangeDays: roundNumber(rangeDays, 2),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    return {
      endTime: formatTimestamp(endDate),
      startTime: formatTimestamp(startDate),
    };
  }

  private normalizeExplainFilters(values: string[] | undefined): string[] {
    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }

    return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  }

  private normalizeDocumentTimeWindow(
    startTimeInput: string | null,
    endTimeInput: string | null
  ): { endTime: string; startTime: string } {
    const endDate = endTimeInput?.trim()
      ? this.validateIsoTimestamp(endTimeInput, 'endTime')
      : new Date();
    const startDate = startTimeInput?.trim()
      ? this.validateIsoTimestamp(startTimeInput, 'startTime')
      : new Date(endDate.getTime() - DEFAULT_DOCUMENT_SEARCH_DAYS * 24 * 60 * 60 * 1000);

    if (startDate.getTime() > endDate.getTime()) {
      throw new PublisherIQError(
        'startTime must be on or before endTime.',
        'INVALID_DOCUMENT_TIME_RANGE',
        {
          endTime: formatTimestamp(endDate),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    const rangeDays = (endDate.getTime() - startDate.getTime()) / 86_400_000;
    if (rangeDays > MAX_DOCUMENT_SEARCH_DAYS) {
      throw new PublisherIQError(
        `searchDocuments supports a maximum range of ${MAX_DOCUMENT_SEARCH_DAYS} days.`,
        'DOCUMENT_RANGE_TOO_LARGE',
        {
          endTime: formatTimestamp(endDate),
          rangeDays: roundNumber(rangeDays, 2),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    return {
      endTime: formatTimestamp(endDate),
      startTime: formatTimestamp(startDate),
    };
  }

  private normalizeFeedScopes(feedScopes: string[] | undefined): string[] {
    if (!Array.isArray(feedScopes) || feedScopes.length === 0) {
      return [];
    }

    return [
      ...new Set(
        feedScopes
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0)
      ),
    ];
  }

  private async queryMetricHistoryRows(
    appid: number,
    startDate: string,
    endDate: string
  ): Promise<DailyMetricHistoryRow[]> {
    const metricsTable = this.relation('metrics_daily_metrics').sql;
    const result = await runQuery<DailyMetricHistoryRow>(
      `
        SELECT
          metric_date::text,
          owners_min,
          owners_max,
          ccu_peak,
          average_playtime_forever,
          average_playtime_2weeks,
          total_reviews,
          positive_reviews,
          negative_reviews,
          review_score,
          price_cents,
          discount_percent
        FROM ${metricsTable}
        WHERE appid = $1
          AND metric_date BETWEEN $2::date AND $3::date
        ORDER BY metric_date ASC
      `,
      [appid, startDate, endDate],
      this.config
    );

    return result.rows;
  }

  private async resolveCoreEntity(
    entityUid: string,
    codes: {
      invalidCode: string;
      notFoundCode: string;
    }
  ): Promise<CoreEntityRow> {
    if (!UUID_PATTERN.test(entityUid)) {
      throw new PublisherIQError('entityUid must be a valid UUID.', codes.invalidCode, {
        entityUid,
      });
    }

    const entitiesTable = this.relation('core_entities').sql;
    const result = await runQuery<CoreEntityRow>(
      `
        SELECT
          entity_uid::text,
          entity_kind,
          platform,
          platform_entity_id,
          canonical_name
        FROM ${entitiesTable}
        WHERE entity_uid = $1::uuid
        LIMIT 1
      `,
      [entityUid],
      this.config
    );

    const entity = result.rows[0];
    if (!entity) {
      throw new PublisherIQError(
        'No entity found for the provided entityUid.',
        codes.notFoundCode,
        { entityUid }
      );
    }

    return entity;
  }

  private validateDateOnly(value: string, fieldName: 'startDate' | 'endDate'): string {
    if (!ISO_DATE_ONLY_PATTERN.test(value)) {
      throw new PublisherIQError(
        `${fieldName} must be a YYYY-MM-DD string.`,
        'INVALID_TRACE_DATE',
        { fieldName, value }
      );
    }

    const parsed = parseDateOnly(value);
    if (Number.isNaN(parsed.getTime()) || formatDateOnly(parsed) !== value) {
      throw new PublisherIQError(
        `${fieldName} must be a valid calendar date.`,
        'INVALID_TRACE_DATE',
        { fieldName, value }
      );
    }

    return value;
  }

  private validateIsoTimestamp(value: string, fieldName: 'startTime' | 'endTime'): Date {
    const parsed = parseTimestamp(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new PublisherIQError(
        `${fieldName} must be a valid ISO timestamp.`,
        'INVALID_EXPLAIN_TIMESTAMP',
        { fieldName, value }
      );
    }

    return parsed;
  }

  private async assertTigerSearchFiltersSupported(request: SearchCatalogRequest): Promise<void> {
    if (this.config.source !== 'tiger') {
      return;
    }

    const requiredRelations = new Set<DataPlaneRelationKey>();
    const unsupportedFilters: string[] = [];

    if (request.genres?.length) {
      unsupportedFilters.push('genres');
      requiredRelations.add('app_genres');
      requiredRelations.add('steam_genres');
    }

    if (request.tags?.length) {
      unsupportedFilters.push('tags');
      requiredRelations.add('app_steam_tags');
      requiredRelations.add('steam_tags');
    }

    if (requiredRelations.size === 0) {
      return;
    }

    const blockingTables = await this.getBlockingTables([...requiredRelations]);

    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        `Tiger searchCatalog does not support ${unsupportedFilters.join(', ')} filters until those legacy tables are backfilled.`,
        'searchCatalog',
        blockingTables,
        { unsupportedFilters }
      );
    }
  }

  private async assertContractRuntime(
    contractName: RuntimeQueryContractDescriptor['name']
  ): Promise<void> {
    const contract = CONTRACT_REGISTRY.find((candidate) => candidate.name === contractName);
    if (!contract || contract.status !== 'ready') {
      return;
    }

    const blockingTables = await this.getBlockingTables(contract.requiredRelations);
    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        `${contractName} is not ready on ${this.config.source} until the required tables are present and backfilled.`,
        contractName,
        blockingTables
      );
    }
  }

  private async getBlockingTables(requiredRelations: DataPlaneRelationKey[]): Promise<string[]> {
    const blockingTables: string[] = [];

    for (const relationKey of requiredRelations) {
      const location = this.relation(relationKey);
      const relationName = `${location.schema}.${location.table}`;
      const existsResult = await runQuery<{ exists: boolean }>(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [relationName],
        this.config
      );
      const exists = existsResult.rows[0]?.exists ?? false;

      if (!exists) {
        blockingTables.push(location.sql);
        continue;
      }

      const hasRowsResult = await runQuery<{ has_rows: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM ${location.sql} LIMIT 1) AS has_rows`,
        [],
        this.config
      );

      if (!(hasRowsResult.rows[0]?.has_rows ?? false)) {
        blockingTables.push(location.sql);
      }
    }

    return blockingTables;
  }

  private relation(relationKey: DataPlaneRelationKey): RelationLocation {
    return RELATION_LOCATIONS[this.config.source][relationKey];
  }

  private mapExplainNews(row: ExplainNewsRow): ExplainChangesLinkedNewsItem {
    return {
      feedLabel: row.feedlabel,
      feedName: row.feedname,
      feedScope: row.feed_scope,
      firstSeenAt: formatTimestamp(parseTimestamp(row.first_seen_at)),
      gid: row.gid,
      publishedAt: row.published_at ? formatTimestamp(parseTimestamp(row.published_at)) : null,
      sortTime: formatTimestamp(parseTimestamp(row.sort_time)),
      title: row.title,
      url: row.url,
    };
  }

  private mapRankedEntity(
    entityKind: EntityKind,
    metric: RankMetric,
    row: RankRow,
    rank: number
  ): RankedEntity {
    const platform = entityKind === 'game' ? 'steam' : 'publisheriq';

    return {
      displayName: row.display_name,
      entityKind,
      entityUid: buildEntityUid(platform, entityKind, String(row.entity_id)),
      metricValue: metricValueForRow(metric, row),
      metrics: {
        ccuPeak: row.ccu_peak,
        gameCount: row.game_count,
        ownersMidpoint: row.owners_midpoint,
        reviewScore: row.review_score,
        totalReviews: row.total_reviews,
      },
      platform,
      platformEntityId: String(row.entity_id),
      rank,
      releaseYear: row.release_year ?? null,
    };
  }

  private mapResolvedEntity(
    entityKind: EntityKind,
    platform: 'steam' | 'publisheriq',
    row: EntityRow,
    query: string,
    includeMetrics: boolean
  ): ResolvedEntity {
    const matchQuality = inferMatchQuality(row.display_name, query);

    return {
      confidence: matchConfidence(matchQuality),
      displayName: row.display_name,
      entityKind,
      entityUid: buildEntityUid(platform, entityKind, String(row.entity_id)),
      latestMetrics: includeMetrics
        ? {
            ccuPeak: row.ccu_peak,
            ownersMidpoint: row.owners_midpoint,
            reviewScore: row.review_score,
            totalReviews: row.total_reviews,
          }
        : undefined,
      matchQuality,
      matchedName: row.display_name,
      platform,
      platformEntityId: String(row.entity_id),
      releaseYear: row.release_year ?? null,
      signals:
        entityKind === 'game'
          ? undefined
          : {
              gameCount: row.game_count ?? null,
            },
    };
  }
}

export async function runReadinessProbe(
  config: DataPlaneConfig = loadDataPlaneConfig()
): Promise<QueryProvenance> {
  const service = new DataPlaneService(config);
  const provenance = await service.healthCheck();
  logger.info('Query API readiness probe succeeded', {
    capturedAt: provenance.capturedAt,
    source: provenance.source,
    tables: provenance.tables,
  });
  return provenance;
}
