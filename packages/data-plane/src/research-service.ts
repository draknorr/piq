import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  CompareEntitiesRequest,
  CompareEntitiesResponse,
  DataPlaneSource,
  DiscoverMomentumRequest,
  DiscoverMomentumResponse,
  EntityKind,
  GetEntityOverviewRequest,
  GetEntityOverviewResponse,
  GetYoutubeGameCoverageRequest,
  GetYoutubeGameCoverageResponse,
  QueryProvenance,
  ResolveEntitiesRequest,
  ResolveEntitiesResponse,
  SearchCatalogRequest,
  SearchCatalogResponse,
  SearchDocumentsRequest,
  SearchDocumentsResponse,
  SemanticSearchRequest,
  SemanticSearchResponse,
  TraceMetricHistoryRequest,
  TraceMetricHistoryResponse,
} from './contracts.js';
import { loadReadonlyAnalysisConfig } from './config.js';
import { withClient } from './pg.js';
import type {
  CompanyDiligencePackRequest,
  GameResearchPackRequest,
  GenreGrowthPackRequest,
  GetReportInstructionsRequest,
  GetReportInstructionsResponse,
  ReadonlyAnalysisRequest,
  ReadonlyAnalysisResponse,
  ReportArchiveItem,
  ReportConfidence,
  ReportEvidenceArtifact,
  ReportEvidencePack,
  ReportEvidenceSection,
  ReportPackEntity,
  ReportPackType,
  ReportRecreationPackRequest,
  ResearchPackBudget,
  ResearchRole,
  SearchReportArchiveRequest,
  SearchReportArchiveResponse,
  UnreleasedOpportunityPackRequest,
  YoutubeCreatorPackRequest,
} from './research-contracts.js';

type JsonRecord = Record<string, unknown>;

interface ResearchDataPlane {
  compareEntities?: (request: CompareEntitiesRequest) => Promise<CompareEntitiesResponse>;
  discoverMomentum?: (request: DiscoverMomentumRequest) => Promise<DiscoverMomentumResponse>;
  getEntityOverview?: (request: GetEntityOverviewRequest) => Promise<GetEntityOverviewResponse>;
  getYoutubeGameCoverage?: (
    request: GetYoutubeGameCoverageRequest
  ) => Promise<GetYoutubeGameCoverageResponse>;
  resolveEntities?: (request: ResolveEntitiesRequest) => Promise<ResolveEntitiesResponse>;
  searchCatalog?: (request: SearchCatalogRequest) => Promise<SearchCatalogResponse>;
  searchDocuments?: (request: SearchDocumentsRequest) => Promise<SearchDocumentsResponse>;
  semanticSearch?: (request: SemanticSearchRequest) => Promise<SemanticSearchResponse>;
  traceMetricHistory?: (request: TraceMetricHistoryRequest) => Promise<TraceMetricHistoryResponse>;
}

export interface ResearchServiceOptions {
  repoRoot?: string;
  source?: DataPlaneSource;
}

interface ResolvedResearchEntity {
  displayName: string;
  entityKind: EntityKind;
  entityUid: string;
  platform: string;
  platformEntityId: string;
}

const ALLOWED_READONLY_SCHEMAS = new Set(['core', 'docs', 'events', 'legacy', 'metrics', 'ops']);
const ALLOWED_OPS_RELATIONS = new Set([
  'ops.app_capture_work_state',
  'ops.ccu_tier_assignments',
  'ops.change_intel_sync_jobs',
  'ops.sync_jobs',
  'ops.sync_status',
]);

const READONLY_SQL_SCHEMA_GUIDANCE =
  'Allowed schemas: legacy, metrics, docs, events, core; ops only allows status/work-state relations. Common starts: metrics.apps_page_projection for released-game rankings, legacy.app_steam_tags plus legacy.steam_tags for Steam tag filters, metrics.unreleased_games_projection for unreleased opportunities. Do not use information_schema, tiger, read, publisheriq, or analytics. Use get_publisheriq_data_dictionary before query_publisheriq_data when schema names are unclear.';

const DENIED_READONLY_RELATION_PATTERNS = [
  /\bauth\./i,
  /\bchat_(messages|sessions|threads)\b/i,
  /\bsessions?\b/i,
  /\buser_(accounts|control|profiles|sessions)\b/i,
  /\b(users|accounts)\b/i,
  /\b(raw_)?(steam_)?profiles\b/i,
  /\b(player|profile)_overlap_raw\b/i,
];

const FORBIDDEN_SQL_PATTERNS = [
  /\balter\b/i,
  /\bbegin\b/i,
  /\bcall\b/i,
  /\bcopy\b/i,
  /\bcreate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\bexecute\b/i,
  /\bgrant\b/i,
  /\binsert\b/i,
  /\bmerge\b/i,
  /\brefresh\b/i,
  /\breindex\b/i,
  /\breset\b/i,
  /\brevoke\b/i,
  /\bset\b/i,
  /\btruncate\b/i,
  /\bupdate\b/i,
  /\bvacuum\b/i,
  /\bpg_sleep\s*\(/i,
];

export class PublisherIQResearchService {
  private readonly repoRoot: string;
  private readonly source: DataPlaneSource;

  constructor(
    private readonly dataPlane: ResearchDataPlane,
    options: ResearchServiceOptions = {}
  ) {
    this.repoRoot = options.repoRoot ?? findRepoRoot(process.cwd());
    this.source = options.source ?? 'tiger';
  }

  getReportInstructions(
    request: GetReportInstructionsRequest = {}
  ): GetReportInstructionsResponse {
    const shape = request.shape?.trim() || 'user-selected research output';
    const audience = request.audience?.trim() || 'internal operator or research reader';
    const depth = request.depth ?? 'standard';

    return {
      audience,
      depth,
      resources: [
        {
          title: 'Optional PublisherIQ writing guidance',
          uri: 'publisheriq://instructions/report-writing/v1',
        },
        {
          title: 'PublisherIQ evidence standards',
          uri: 'publisheriq://instructions/evidence-standards/v1',
        },
      ],
      sections: [
        section({
          confidence: 'high_confidence',
          id: 'instructions-source-block',
          rows: [
            {
              rule: 'Open with source counts, dates, and confidence taxonomy.',
              reason: 'Research outputs should show the work before making commercial claims.',
            },
            {
              rule: 'Every analytical claim needs a source, sample size when available, and a named data point.',
              reason: 'This keeps GPT/Claude/Codex output anchored to evidence packs regardless of final format.',
            },
            {
              rule: 'Final format belongs to the user prompt.',
              reason: 'MCP provides data, provenance, and caveats; the connected LLM writes Markdown, HTML, CSV, JSON, memo, or another requested format.',
            },
          ],
          sourceTables: [],
          summary:
            'Use these only when the user wants PublisherIQ-style writing. Evidence packs are format-neutral by default.',
          title: 'Optional Source And Confidence Rules',
        }),
        section({
          confidence: 'strategic_inference',
          id: 'instructions-output-shape',
          rows: [
            {
              audience,
              depth,
              shape,
            },
          ],
          sourceTables: [],
          summary:
            'Let the user prompt determine the output shape: memo, table, HTML, Markdown, JSON, deck outline, CSV summary, or another requested format.',
          title: 'Output Shape',
        }),
      ],
      shape,
    };
  }

  async searchReportArchive(
    request: SearchReportArchiveRequest = {}
  ): Promise<SearchReportArchiveResponse> {
    const catalog = await this.getArchiveCatalog();
    const query = normalizeText(request.query ?? '');
    const reportType = normalizeText(request.reportType ?? '');
    const limit = clampInt(request.limit ?? 20, 1, 100);
    const scored = catalog
      .map((item) => ({ item, score: scoreArchiveItem(item, query, reportType) }))
      .filter(({ score }) => score > 0 || (!query && !reportType))
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));

    return {
      items: scored.slice(0, limit).map(({ item }) => item),
      totalMatches: scored.length,
    };
  }

  async buildReportRecreationPack(
    request: ReportRecreationPackRequest
  ): Promise<ReportEvidencePack> {
    const budget = normalizeBudget(request.budget);
    const archive = await this.searchReportArchive({
      limit: 5,
      query: request.reportId,
    });
    const matched = archive.items[0] ?? null;
    const artifacts = matched?.artifacts ?? [];
    const rows = artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      citationHandle: artifact.citationHandle,
      kind: artifact.kind,
      path: artifact.path,
      rowCount: artifact.rowCount ?? null,
      title: artifact.title,
    }));

    return this.pack({
      artifacts,
      budget,
      confidenceHints: [
        {
          confidence: 'high_confidence',
          reason:
            'Archive recreation packs use optional indexed prior-work artifacts when an archive source is enabled.',
        },
      ],
      entities: matched
        ? [{ displayName: matched.title, entityKind: 'report', entityUid: matched.id }]
        : [],
      limitations: matched
        ? [
            'This recreates the indexed prior-work evidence state, not a fresh live-data rerun.',
            'Use current-equivalent recipe sections before making claims about today.',
          ]
        : [
            shouldScanArchiveFilesystem()
              ? 'No matching prior-work evidence bundle was found for the requested reportId.'
              : 'Prior-work archive scanning is disabled in this environment; use live evidence-pack tools for current data access.',
          ],
      packType: 'report_recreation',
      request: { ...request },
      sections: [
        section({
          confidence: matched ? 'high_confidence' : 'directional_signal',
          id: 'archive-match',
          rows: matched ? [{ ...matched, artifacts: undefined }] : [],
          sampleSize: matched ? 1 : 0,
          sourceTables: [],
          summary: matched
            ? `Matched archived report "${matched.title}" with ${artifacts.length} linked artifacts.`
            : 'No indexed prior-work bundle matched the requested identifier.',
          title: 'Archive Match',
        }),
        section({
          confidence: 'high_confidence',
          id: 'archive-artifacts',
          rows,
          sampleSize: rows.length,
          sourceTables: [],
          summary:
            'Optional prior-work artifacts. These are reference handles, not required inputs for custom output generation.',
          title: 'Prior-Work Artifacts',
        }),
        section({
          confidence: 'strategic_inference',
          id: 'current-equivalent-recipe',
          rows: [
            {
              step: 'Resolve target entities and source freshness.',
            },
            {
              step: 'Rebuild current snapshot, metric history, review histogram/deltas, change/news activity, YouTube coverage, and available community/achievement summaries.',
            },
            {
              step: 'Have the connected LLM write the output in the user-requested format; do not publish to /reports through MCP.',
            },
          ],
          sourceTables: [],
          summary:
            'The current-equivalent rerun should use deterministic evidence-pack tools before synthesis.',
          title: 'Current Equivalent Recipe',
        }),
      ],
    });
  }

  async buildGameResearchPack(request: GameResearchPackRequest): Promise<ReportEvidencePack> {
    const budget = normalizeBudget(request.budget);
    const include = new Set(request.include ?? [
      'metric_history',
      'review_history',
      'change_activity',
      'store_state',
      'peer_cohort',
      'youtube',
      'community',
      'achievement',
    ]);
    const resolved = await this.resolveEntity(request.game, ['game'], 'game');
    const sections: ReportEvidenceSection[] = [];
    const provenance: QueryProvenance[] = [];
    const entities = resolved ? [entityFromResolved(resolved)] : [];
    const artifacts = await this.findRelatedArtifacts(request.game);
    const limitations: string[] = [
      'This pack is a format-neutral evidence bundle for the connected LLM; final output shape is user-controlled.',
    ];

    if (!resolved) {
      limitations.push('The requested game could not be resolved through query-api.');
    } else {
      const overview = await this.safeCall(() =>
        this.dataPlane.getEntityOverview?.({
          entityKind: 'game',
          entityUid: resolved.entityUid,
          gamesLimit: 0,
        })
      );
      if (overview) {
        provenance.push(overview.provenance);
        sections.push(section({
          confidence: 'high_confidence',
          id: 'current-snapshot',
          rows: [compactRecord(overview.entity)],
          sampleSize: 1,
          sourceTables: overview.provenance.tables,
          summary:
            'Current entity overview with Steam identity, company links, review/player metrics, price, platforms, and release state.',
          title: 'Current Snapshot',
        }));
      }

      if (include.has('metric_history')) {
        const history = await this.safeCall(() =>
          this.dataPlane.traceMetricHistory?.({
            endDate: request.windows?.metricEndDate ?? null,
            entityUid: resolved.entityUid,
            metrics: [
              'ccu_peak',
              'total_reviews',
              'positive_percentage',
              'price_cents',
              'discount_percent',
            ],
            startDate: request.windows?.metricStartDate ?? null,
          })
        );
        if (history) {
          provenance.push(history.provenance);
          sections.push(section({
            confidence: 'high_confidence',
            id: 'metric-history',
            rows: history.series.map((item) => compactRecord(item.summary, { metric: item.metric })),
            sampleSize: history.series.reduce((sum, item) => sum + item.summary.pointCount, 0),
            sourceTables: history.provenance.tables,
            summary:
              'Bounded metric history summaries for CCU, reviews, price, and discount movement.',
            title: 'Metric History',
          }));
        }
      }

      if (include.has('change_activity') || include.has('store_state')) {
        const news = await this.safeCall(() =>
          this.dataPlane.searchDocuments?.({
            entityUid: resolved.entityUid,
            limit: budget === 'lite' ? 4 : 8,
            mode: 'digest',
            startTime: daysAgoIso(request.windows?.newsDays ?? 90),
          })
        );
        if (news) {
          provenance.push(news.provenance);
          sections.push(section({
            confidence: 'directional_signal',
            id: 'news-and-documents',
            rows: news.items.map((item) => compactRecord(item)),
            sampleSize: news.items.length,
            sourceTables: news.provenance.tables,
            summary:
              'Recent Steam news/document evidence for launch, update, roadmap, and support language.',
            title: 'News And Documents',
            truncated: news.items.length >= (budget === 'lite' ? 4 : 8),
          }));
        }
      }

      if (include.has('peer_cohort') && request.peerMode !== 'none') {
        const peers = await this.safeCall(() =>
          this.dataPlane.semanticSearch?.({
            entityKind: 'game',
            limit: budget === 'full' ? 15 : 8,
            mode: 'similarity',
            referencePlatformEntityId: resolved.platformEntityId,
            referenceQuery: resolved.displayName,
          })
        );
        if (peers) {
          provenance.push(peers.provenance);
          sections.push(section({
            confidence: 'directional_signal',
            id: 'similar-games',
            rows: (peers.results ?? []).map((item) => compactRecord(item)),
            sampleSize: peers.results?.length ?? 0,
            sourceTables: peers.provenance.tables,
            summary:
              'Similarity-derived peer set for comparison, positioning, and player-overlap-style reasoning.',
            title: 'Similar Games',
          }));
        }
      }

      if (include.has('youtube')) {
        const youtube = await this.safeCall(() =>
          this.dataPlane.getYoutubeGameCoverage?.({
            entityUid: resolved.entityUid,
            includeSummary: true,
            limit: budget === 'full' ? 20 : 10,
            view: 'creator_coverage',
            window: request.windows?.youtubeWindow ?? '30d',
          })
        );
        if (youtube) {
          provenance.push(youtube.provenance);
          sections.push(youtubeSection(youtube, budget));
        }
      }
    }

    if (artifacts.length > 0) {
      sections.push(artifactSection(artifacts, request.game));
    }

    return this.pack({
      artifacts,
      budget,
      confidenceHints: defaultConfidenceHints(),
      entities,
      limitations,
      packType: 'game_research',
      provenance,
      request: { ...request },
      sections,
    });
  }

  async buildGenreGrowthPack(request: GenreGrowthPackRequest): Promise<ReportEvidencePack> {
    const budget = normalizeBudget(request.budget);
    const topN = clampInt(request.topN ?? 10, 1, 50);
    const year = request.year ?? new Date().getUTCFullYear();
    const artifacts = await this.findRelatedArtifacts(`tag genre market shifts ${year}`);
    const rows = await readLatestGenreSummary(this.repoRoot, year, topN);
    const sections = [
      section({
        confidence: rows.length ? 'high_confidence' : 'directional_signal',
        id: 'genre-growth-summary',
        rows,
        sampleSize: rows.length,
        sourceTables: rows.length ? ['events.app_change_events', 'legacy.steam_tags', 'legacy.steam_genres'] : [],
        summary: rows.length
          ? 'Latest archived tag/genre movement summary for the requested year.'
          : 'No archived tag/genre summary rows were found; use the archive search results as the next best evidence.',
        title: 'Genre And Tag Movement',
      }),
      section({
        confidence: 'directional_signal',
        id: 'genre-growth-caveats',
        rows: [
          {
            caveat:
              'Steam taxonomy is noisy; interpret movement as market/team positioning behavior, not direct player demand by itself.',
          },
          {
            caveat:
              'Current v1 uses archived movement CSVs where available and should be replaced by a native Tiger research projection in phase 3.',
          },
        ],
        sourceTables: [],
        summary: 'Caveats that should travel with every genre growth output.',
        title: 'Interpretation Caveats',
      }),
    ];

    return this.pack({
      artifacts,
      budget,
      confidenceHints: defaultConfidenceHints(),
      entities: [{ displayName: `Genre growth ${year}`, entityKind: 'topic' }],
      limitations: [
        'The v1 genre growth pack uses optional prior-work artifacts when an archive source is enabled.',
        'Do not treat taxonomy movement as a causal demand forecast without supporting review, owner, CCU, and release-supply evidence.',
      ],
      packType: 'genre_growth',
      request: { ...request },
      sections,
    });
  }

  async buildYoutubeCreatorPack(
    request: YoutubeCreatorPackRequest
  ): Promise<ReportEvidencePack> {
    const budget = normalizeBudget(request.budget);
    const resolved = await this.resolveEntity(request.game, ['game'], 'game');
    const sections: ReportEvidenceSection[] = [];
    const provenance: QueryProvenance[] = [];
    const limitations = [
      'YouTube matching is a PublisherIQ routed coverage surface, not proof of total market-wide creator coverage.',
    ];

    if (resolved) {
      const youtube = await this.safeCall(() =>
        this.dataPlane.getYoutubeGameCoverage?.({
          entityUid: resolved.entityUid,
          includeSummary: true,
          limit: clampInt(request.limit ?? 20, 1, 50),
          view: 'creator_coverage',
          window: request.window ?? '30d',
        })
      );
      if (youtube) {
        provenance.push(youtube.provenance);
        sections.push(youtubeSection(youtube, budget));
      }
    } else {
      limitations.push('The requested game could not be resolved through query-api.');
    }

    return this.pack({
      budget,
      confidenceHints: defaultConfidenceHints(),
      entities: resolved ? [entityFromResolved(resolved)] : [],
      limitations,
      packType: 'youtube_creator',
      provenance,
      request: { ...request },
      sections,
    });
  }

  async buildCompanyDiligencePack(
    request: CompanyDiligencePackRequest
  ): Promise<ReportEvidencePack> {
    const budget = normalizeBudget(request.budget);
    const resolved = await this.resolveEntity(request.company, ['publisher', 'developer'], 'company');
    const sections: ReportEvidenceSection[] = [];
    const provenance: QueryProvenance[] = [];
    const artifacts = await this.findRelatedArtifacts(request.company);
    const entities = resolved ? [entityFromResolved(resolved)] : [];
    const limitations = [
      'Company diligence packs are research bundles; legal, financial, and transaction conclusions require human review.',
    ];

    if (resolved) {
      const overview = await this.safeCall(() =>
        this.dataPlane.getEntityOverview?.({
          entityKind: resolved.entityKind,
          entityUid: resolved.entityUid,
          gamesLimit: 50,
        })
      );
      if (overview) {
        provenance.push(overview.provenance);
        sections.push(section({
          confidence: 'high_confidence',
          id: 'company-overview',
          rows: [compactRecord(overview.entity)],
          sampleSize: 1,
          sourceTables: overview.provenance.tables,
          summary:
            'Company projection and identity overview for diligence framing.',
          title: 'Company Overview',
        }));
        sections.push(section({
          confidence: 'high_confidence',
          id: 'company-portfolio',
          rows: overview.games.map((item) => compactRecord(item)),
          sampleSize: overview.games.length,
          sourceTables: overview.provenance.tables,
          summary:
            'Linked portfolio rows used to judge concentration, repeatability, and target-title fit.',
          title: 'Portfolio Rows',
          truncated: overview.games.length >= 50,
        }));
      }
    } else {
      limitations.push('The requested company could not be resolved through query-api.');
    }

    const targetGames = (request.targetGames ?? []).slice(0, 5);
    if (targetGames.length > 0) {
      const rows: JsonRecord[] = [];
      for (const target of targetGames) {
        const targetEntity = await this.resolveEntity(target, ['game'], 'game');
        if (targetEntity) {
          rows.push(compactRecord(targetEntity));
          entities.push(entityFromResolved(targetEntity));
        }
      }
      sections.push(section({
        confidence: 'directional_signal',
        id: 'target-games',
        rows,
        sampleSize: rows.length,
        sourceTables: ['core.entities', 'legacy.apps'],
        summary:
          'Resolved target games supplied by the user for focused diligence.',
        title: 'Target Games',
      }));
    }

    if (artifacts.length > 0) {
      sections.push(artifactSection(artifacts, request.company));
    }

    if (request.includeCommunity) {
      limitations.push(
        'Community evidence is exposed as aggregate archive artifacts in v1; raw profile/user rows are intentionally suppressed.'
      );
    }

    return this.pack({
      artifacts,
      budget,
      confidenceHints: defaultConfidenceHints(),
      entities,
      limitations,
      packType: 'company_diligence',
      provenance,
      request: { ...request },
      sections,
    });
  }

  async buildUnreleasedOpportunityPack(
    request: UnreleasedOpportunityPackRequest
  ): Promise<ReportEvidencePack> {
    const budget = normalizeBudget(request.budget);
    const artifacts = await this.findRelatedArtifacts('unreleased publisher opportunity');
    const sections: ReportEvidenceSection[] = [];
    const provenance: QueryProvenance[] = [];

    const catalog = await this.safeCall(() =>
      this.dataPlane.searchCatalog?.({
        genres: request.filters?.genres ?? undefined,
        includeAppTypes: ['game'],
        isReleased: false,
        limit: budget === 'full' ? 50 : 25,
        releaseYear: releaseYearFilter(request.releaseWindow),
        sortBy: 'release_date',
        sortDirection: 'asc',
        tags: request.filters?.tags ?? undefined,
      })
    );
    if (catalog) {
      provenance.push(catalog.provenance);
      sections.push(section({
        confidence: 'directional_signal',
        id: 'unreleased-catalog',
        rows: catalog.items.map((item) => compactRecord(item)),
        sampleSize: catalog.items.length,
        sourceTables: catalog.provenance.tables,
        summary:
          'Upcoming/unreleased catalog rows suitable for outreach and launch-readiness screening.',
        title: 'Unreleased Catalog Candidates',
        truncated: catalog.items.length >= (budget === 'full' ? 50 : 25),
      }));
    }

    if (artifacts.length > 0) {
      sections.push(artifactSection(artifacts, 'unreleased publisher opportunity'));
    }

    return this.pack({
      artifacts,
      budget,
      confidenceHints: defaultConfidenceHints(),
      limitations: [
        'V1 combines query-api unreleased catalog reads with archived opportunity CSVs when present.',
        'End-of-month, end-of-quarter, and end-of-year release spikes may reflect Steam date normalization artifacts.',
      ],
      packType: 'unreleased_opportunity',
      provenance,
      request: { ...request },
      sections,
    });
  }

  async runReadonlyAnalysis(
    request: ReadonlyAnalysisRequest,
    role: ResearchRole
  ): Promise<ReadonlyAnalysisResponse> {
    const budget = normalizeBudget(request.budget);
    const purpose = normalizeReadonlyPurpose(request);
    const validation = validateReadonlySql(request.sql, {
      expectedRows: request.expectedRows ?? null,
      role,
    });
    const rowCap = validation.rowCap;
    const diagnosticsBase = {
      normalizedSqlHash: hashSql(request.sql),
      planCost: null as number | null,
      rejectedReasons: validation.rejectedReasons,
      role,
      rowCap,
      safetyChecks: validation.safetyChecks,
    };

    if (validation.rejectedReasons.length > 0) {
      return {
        diagnostics: diagnosticsBase,
        pack: null,
      };
    }

    const sql = stripTrailingSemicolon(request.sql);
    const wrappedSql = `SELECT * FROM (${sql}) AS publisheriq_readonly_analysis LIMIT ${rowCap}`;
    const startedAt = new Date().toISOString();
    const result = await withClient(
      async (client) => {
        await client.query('BEGIN READ ONLY');
        try {
          await client.query("SET LOCAL statement_timeout = '8000ms'");
          await client.query("SET LOCAL lock_timeout = '1000ms'");
          await client.query('SET LOCAL search_path = legacy, metrics, docs, events, core, ops');
          const explain = await client.query<{ 'QUERY PLAN': unknown }>(
            `EXPLAIN (FORMAT JSON) ${wrappedSql}`
          );
          const planCost = extractPlanCost(explain.rows[0]?.['QUERY PLAN']);
          const maxPlanCost = getMaxReadonlyPlanCost();
          if (planCost !== null && planCost > maxPlanCost) {
            await client.query('ROLLBACK');
            return {
              planCost,
              rejectedReason: `estimated plan cost ${planCost} exceeds configured maximum ${maxPlanCost}`,
              rows: null,
            };
          }
          const rows = await client.query<JsonRecord>(wrappedSql);
          await client.query('COMMIT');
          return {
            planCost,
            rejectedReason: null,
            rows: rows.rows,
          };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      },
      loadReadonlyAnalysisConfig()
    );

    if (result.rejectedReason) {
      return {
        diagnostics: {
          ...diagnosticsBase,
          planCost: result.planCost,
          rejectedReasons: [result.rejectedReason],
        },
        pack: null,
      };
    }

    const provenance: QueryProvenance = {
      capturedAt: startedAt,
      source: this.source,
      tables: validation.detectedRelations,
    };

    const pack = this.pack({
      budget,
      confidenceHints: [
        {
          confidence: 'directional_signal',
          reason:
            'Ad hoc SQL output is governed and read-only, but interpretation remains analyst-authored.',
        },
      ],
      limitations: [
        'Ad hoc SQL is an expert escape hatch. Prefer deterministic evidence-pack tools for standard research prompts.',
        'Results are capped and should not be treated as exhaustive unless the query was written to aggregate explicitly.',
      ],
      packType: 'readonly_analysis',
      provenance: [provenance],
      request: {
        expectedRows: request.expectedRows ?? null,
        purpose,
        question: request.question ?? null,
        sqlHash: hashSql(request.sql),
      },
      sections: [
        section({
          confidence: 'directional_signal',
          id: 'readonly-analysis-result',
          rows: result.rows ?? [],
          sampleSize: result.rows?.length ?? 0,
          sourceTables: validation.detectedRelations,
          summary: purpose,
          title: 'Read-Only Analysis Result',
          truncated: (result.rows?.length ?? 0) >= rowCap,
        }),
      ],
    });

    return {
      diagnostics: {
        ...diagnosticsBase,
        planCost: result.planCost,
      },
      pack,
    };
  }

  private async resolveEntity(
    query: string,
    entityKinds: EntityKind[],
    preference: 'company' | 'game'
  ): Promise<ResolvedResearchEntity | null> {
    const response = await this.safeCall(() =>
      this.dataPlane.resolveEntities?.({
        entityKinds,
        includeMetrics: true,
        limit: 5,
        query,
        resolutionMode: 'chat_strict',
        resolutionPreference: preference,
      })
    );

    const entity = response?.entities?.[0];
    if (!entity) {
      return null;
    }

    return {
      displayName: entity.displayName,
      entityKind: entity.entityKind,
      entityUid: entity.entityUid,
      platform: entity.platform,
      platformEntityId: entity.platformEntityId,
    };
  }

  private async getArchiveCatalog(): Promise<ReportArchiveItem[]> {
    if (!shouldScanArchiveFilesystem()) {
      return [];
    }

    const reportDir = path.join(this.repoRoot, 'docs', 'reports');
    if (!existsSync(reportDir)) {
      return [];
    }

    const files = await fs.readdir(reportDir, { withFileTypes: true });
    const topLevel = files
      .filter((file) => file.isFile() && !file.name.startsWith('.'))
      .map((file) => path.join(reportDir, file.name));
    const sqlArtifacts = await listArtifactFiles(path.join(reportDir, 'sql'));
    const dataArtifacts = await listArtifactFiles(path.join(reportDir, 'data'));
    const dataAuditArtifacts = await listArtifactFiles(path.join(this.repoRoot, 'data-audit'), 2);

    const items: ReportArchiveItem[] = [];
    for (const filePath of topLevel) {
      const basename = path.basename(filePath);
      const id = idFromFileName(basename);
      const title = await inferTitle(filePath);
      const artifacts = [
        await artifactFromPath(filePath, this.repoRoot, 'source report'),
        ...artifactMatches(id, [...sqlArtifacts, ...dataArtifacts, ...dataAuditArtifacts], this.repoRoot),
      ].filter((artifact): artifact is ReportEvidenceArtifact => artifact !== null);

      items.push({
        artifactCount: artifacts.length,
        artifacts,
        date: inferDate(basename),
        id,
        path: path.relative(this.repoRoot, filePath),
        reportType: inferReportType(basename),
        title,
      });
    }

    return items;
  }

  private async findRelatedArtifacts(query: string): Promise<ReportEvidenceArtifact[]> {
    const archive = await this.searchReportArchive({ limit: 5, query });
    const artifacts = new Map<string, ReportEvidenceArtifact>();
    for (const item of archive.items) {
      for (const artifact of item.artifacts) {
        artifacts.set(artifact.artifactId, artifact);
      }
    }
    return [...artifacts.values()].slice(0, 40);
  }

  private async safeCall<T>(callback: () => Promise<T> | undefined): Promise<T | null> {
    try {
      const result = await callback();
      return result ?? null;
    } catch {
      return null;
    }
  }

  private pack(params: {
    artifacts?: ReportEvidenceArtifact[];
    budget?: ResearchPackBudget | null;
    confidenceHints: ReportEvidencePack['confidenceHints'];
    entities?: ReportPackEntity[];
    limitations: string[];
    packType: ReportPackType;
    provenance?: QueryProvenance[];
    request: Record<string, unknown>;
    sections: ReportEvidenceSection[];
  }): ReportEvidencePack {
    const budget = normalizeBudget(params.budget);
    const estimatedRows = params.sections.reduce(
      (sum, item) => sum + item.rows.length + (item.sampleSize ?? 0),
      0
    );
    const generatedAt = new Date().toISOString();
    const provenance = params.provenance ?? [];

    return {
      artifacts: params.artifacts ?? [],
      confidenceHints: params.confidenceHints,
      costEstimate: {
        budget,
        estimatedInputTokens: estimateTokensForRows(estimatedRows, budget),
        estimatedOutputTokens: budget === 'lite' ? 1200 : budget === 'standard' ? 3000 : 6500,
        estimatedRows,
        notes: [
          'Deterministic evidence assembly runs before user-facing synthesis.',
          'Use lite packs for outline/rewrite passes and full packs for final high-stakes synthesis.',
        ],
      },
      entities: params.entities ?? [],
      freshness: provenance.map((item, index) => ({
        capturedAt: item.capturedAt,
        label: `query-api provenance ${index + 1}`,
        source: item.tables.join(', '),
      })),
      generatedAt,
      limitations: params.limitations,
      packId: buildPackId(params.packType, params.request),
      packType: params.packType,
      provenance,
      request: params.request,
      sections: params.sections,
    };
  }
}

export function validateReadonlySql(
  sql: string,
  options: { expectedRows: number | null; role: ResearchRole }
): {
  detectedRelations: string[];
  rejectedReasons: string[];
  rowCap: number;
  safetyChecks: string[];
} {
  const rejectedReasons: string[] = [];
  const safetyChecks: string[] = [];
  const cleaned = stripSqlComments(sql).trim();
  const normalized = cleaned.toLowerCase();
  const rowCap = clampInt(options.expectedRows ?? 100, 1, 500);
  const detectedRelations = detectRelations(cleaned);

  if (options.role !== 'admin' && options.role !== 'researcher') {
    rejectedReasons.push('readonly analysis requires researcher or admin role');
  } else {
    safetyChecks.push(`role ${options.role} is allowed for readonly analysis`);
  }

  if (!cleaned) {
    rejectedReasons.push('sql is empty');
  }

  if (hasMultipleStatements(cleaned)) {
    rejectedReasons.push('only one SQL statement is allowed');
  } else {
    safetyChecks.push('single-statement check passed');
  }

  if (!/^(select|with)\b/i.test(cleaned)) {
    rejectedReasons.push('only SELECT or WITH SELECT statements are allowed');
  } else {
    safetyChecks.push('statement starts with SELECT/WITH');
  }

  for (const pattern of FORBIDDEN_SQL_PATTERNS) {
    if (pattern.test(cleaned)) {
      rejectedReasons.push(`forbidden SQL token matched: ${pattern.source}`);
      break;
    }
  }

  const schemaRefs = detectSchemaRefs(cleaned);
  for (const ref of schemaRefs) {
    if (!ALLOWED_READONLY_SCHEMAS.has(ref.schema)) {
      rejectedReasons.push(
        `schema ${ref.schema} is not allowlisted. ${READONLY_SQL_SCHEMA_GUIDANCE}`
      );
    }
    if (ref.schema === 'ops' && !ALLOWED_OPS_RELATIONS.has(`${ref.schema}.${ref.table}`)) {
      rejectedReasons.push(
        `ops relation ${ref.schema}.${ref.table} is not allowlisted. ${READONLY_SQL_SCHEMA_GUIDANCE}`
      );
    }
  }
  if (schemaRefs.length > 0) {
    safetyChecks.push('schema allowlist check completed');
  }

  for (const pattern of DENIED_READONLY_RELATION_PATTERNS) {
    if (pattern.test(cleaned)) {
      rejectedReasons.push(`sensitive relation pattern matched: ${pattern.source}`);
      break;
    }
  }

  for (const table of ['metrics.daily_metrics', 'daily_metrics']) {
    if (normalized.includes(table) && !/\bmetric_date\b\s*(=|>|<|between|in\b)/i.test(cleaned)) {
      rejectedReasons.push('daily_metrics queries require a metric_date bound');
    }
  }
  for (const table of ['metrics.review_deltas', 'review_deltas']) {
    if (normalized.includes(table) && !/\bdelta_date\b\s*(=|>|<|between|in\b)/i.test(cleaned)) {
      rejectedReasons.push('review_deltas queries require a delta_date bound');
    }
  }
  for (const table of ['metrics.ccu_snapshots', 'ccu_snapshots']) {
    if (
      normalized.includes(table)
      && !/\b(captured_at|snapshot_at|observed_at|metric_date)\b\s*(=|>|<|between|in\b)/i.test(cleaned)
    ) {
      rejectedReasons.push('ccu_snapshots queries require a time bound');
    }
  }

  return {
    detectedRelations,
    rejectedReasons: [...new Set(rejectedReasons)],
    rowCap,
    safetyChecks,
  };
}

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return startDir;
}

function shouldScanArchiveFilesystem(): boolean {
  return process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM === 'true';
}

function normalizeBudget(value: ResearchPackBudget | null | undefined): ResearchPackBudget {
  return value === 'full' || value === 'lite' || value === 'standard' ? value : 'standard';
}

function normalizeReadonlyPurpose(request: ReadonlyAnalysisRequest): string {
  return request.purpose?.trim() || request.question?.trim() || 'PublisherIQ read-only analysis';
}

function getMaxReadonlyPlanCost(): number {
  const parsed = Number(process.env.RESEARCH_SQL_MAX_PLAN_COST ?? 500_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500_000;
}

function section(params: {
  confidence: ReportConfidence;
  id: string;
  rows: JsonRecord[];
  sampleSize?: number | null;
  sourceTables: string[];
  summary: string;
  title: string;
  truncated?: boolean;
}): ReportEvidenceSection {
  return {
    citationHandles: params.sourceTables.map((source, index) => `source:${params.id}:${index + 1}:${source}`),
    confidence: params.confidence,
    id: params.id,
    limitations: [],
    rows: params.rows,
    sampleSize: params.sampleSize ?? params.rows.length,
    sourceTables: params.sourceTables,
    summary: params.summary,
    title: params.title,
    truncated: params.truncated ?? false,
  };
}

function artifactSection(artifacts: ReportEvidenceArtifact[], query: string): ReportEvidenceSection {
  return section({
    confidence: 'directional_signal',
    id: 'related-archive-artifacts',
    rows: artifacts.map((artifact) => compactRecord(artifact)),
    sampleSize: artifacts.length,
    sourceTables: [],
    summary: `Related optional prior-work artifacts found for "${query}".`,
    title: 'Related Archive Artifacts',
  });
}

function youtubeSection(
  youtube: GetYoutubeGameCoverageResponse,
  budget: ResearchPackBudget
): ReportEvidenceSection {
  const rows = youtube.creators.length > 0
    ? youtube.creators.map((creator) => compactRecord(creator))
    : youtube.items.map((item) => compactRecord(item));

  return section({
    confidence: youtube.availability.state === 'ready' ? 'directional_signal' : 'high_confidence',
    id: 'youtube-creator-coverage',
    rows,
    sampleSize: rows.length,
    sourceTables: youtube.provenance.tables,
    summary:
      'Creator/channel coverage, matched video counts, current views, freshness, and routed YouTube limitations.',
    title: 'YouTube Creator Coverage',
    truncated: rows.length >= (budget === 'full' ? 20 : 10),
  });
}

function defaultConfidenceHints(): ReportEvidencePack['confidenceHints'] {
  return [
    {
      confidence: 'high_confidence',
      reason: 'Use for direct query-api counts, source freshness, current snapshots, and indexed prior-work artifacts.',
    },
    {
      confidence: 'directional_signal',
      reason: 'Use for one-surface movement, similarity/peer sets, community samples, and routed YouTube coverage.',
    },
    {
      confidence: 'strategic_inference',
      reason: 'Use for the commercial sequence the connected LLM derives from multiple evidence sections.',
    },
  ];
}

function compactRecord(value: unknown, extra: JsonRecord = {}): JsonRecord {
  if (typeof value !== 'object' || value === null) {
    return extra;
  }
  const record = value as JsonRecord;
  const output: JsonRecord = { ...extra };
  for (const [key, entry] of Object.entries(record)) {
    if (entry === undefined || typeof entry === 'function') {
      continue;
    }
    output[key] = entry;
  }
  return output;
}

function entityFromResolved(entity: ResolvedResearchEntity): ReportPackEntity {
  return {
    displayName: entity.displayName,
    entityKind: entity.entityKind,
    entityUid: entity.entityUid,
    platform: entity.platform,
    platformEntityId: entity.platformEntityId,
  };
}

async function listArtifactFiles(dir: string, maxDepth = 1): Promise<string[]> {
  if (!existsSync(dir) || maxDepth < 0) {
    return [];
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    if (entry.isFile()) {
      result.push(filePath);
    } else if (entry.isDirectory() && maxDepth > 0) {
      result.push(...await listArtifactFiles(filePath, maxDepth - 1));
    }
  }
  return result;
}

async function artifactFromPath(
  filePath: string,
  repoRoot: string,
  titlePrefix = 'artifact'
): Promise<ReportEvidenceArtifact | null> {
  try {
    const stats = await fs.stat(filePath);
    const relative = path.relative(repoRoot, filePath);
    return {
      artifactId: idFromFileName(relative),
      byteSize: stats.size,
      citationHandle: `artifact:${idFromFileName(relative)}`,
      kind: artifactKind(filePath),
      path: relative,
      rowCount: await inferRowCount(filePath),
      title: `${titlePrefix}: ${path.basename(filePath)}`,
    };
  } catch {
    return null;
  }
}

function artifactMatches(
  reportId: string,
  artifactPaths: string[],
  repoRoot: string
): Array<ReportEvidenceArtifact | null> {
  const reportTokens = meaningfulTokens(reportId);
  return artifactPaths
    .filter((filePath) => {
      const normalized = normalizeText(path.basename(filePath));
      return reportTokens.some((token) => normalized.includes(token));
    })
    .slice(0, 30)
    .map((filePath) => artifactFromPathSyncMetadata(filePath, repoRoot));
}

function artifactFromPathSyncMetadata(
  filePath: string,
  repoRoot: string
): ReportEvidenceArtifact | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const relative = path.relative(repoRoot, filePath);
  return {
    artifactId: idFromFileName(relative),
    citationHandle: `artifact:${idFromFileName(relative)}`,
    kind: artifactKind(filePath),
    path: relative,
    title: path.basename(filePath),
  };
}

async function inferTitle(filePath: string): Promise<string> {
  const fallback = titleFromFileName(path.basename(filePath));
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const markdownTitle = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (markdownTitle) {
      return markdownTitle;
    }
    const htmlTitle = text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/\s+/g, ' ').trim();
    if (htmlTitle) {
      return htmlTitle;
    }
    const h1 = text.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return h1 || fallback;
  } catch {
    return fallback;
  }
}

async function inferRowCount(filePath: string): Promise<number | null> {
  if (!/\.(csv|jsonl)$/i.test(filePath)) {
    return null;
  }
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean).length;
    return filePath.endsWith('.csv') ? Math.max(0, lines - 1) : lines;
  } catch {
    return null;
  }
}

async function readLatestGenreSummary(
  repoRoot: string,
  year: number,
  topN: number
): Promise<JsonRecord[]> {
  const dataDir = path.join(repoRoot, 'docs', 'reports', 'data');
  if (!existsSync(dataDir)) {
    return [];
  }
  const files = (await fs.readdir(dataDir))
    .filter((file) => file.includes('tag-genre-market-shifts-summary') && file.includes(String(year)))
    .sort()
    .reverse();
  const target = files[0];
  if (!target) {
    return [];
  }
  const text = await fs.readFile(path.join(dataDir, target), 'utf8');
  return parseCsv(text).slice(0, topN);
}

function parseCsv(text: string): JsonRecord[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const [headerLine, ...body] = lines;
  if (!headerLine) {
    return [];
  }
  const headers = parseCsvLine(headerLine);
  return body.map((line) => {
    const values = parseCsvLine(line);
    const row: JsonRecord = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function scoreArchiveItem(item: ReportArchiveItem, query: string, reportType: string): number {
  const haystack = normalizeText(`${item.id} ${item.title} ${item.reportType} ${item.path}`);
  let score = 0;
  if (!query) {
    score += 1;
  }
  for (const token of meaningfulTokens(query)) {
    if (haystack.includes(token)) {
      score += 3;
    }
  }
  if (reportType && normalizeText(item.reportType).includes(reportType)) {
    score += 5;
  }
  return score;
}

function titleFromFileName(fileName: string): string {
  return idFromFileName(fileName)
    .split('-')
    .filter((part) => !/^\d{4}$/.test(part) && !/^\d{2}$/.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function idFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function inferDate(fileName: string): string | null {
  return fileName.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function inferReportType(fileName: string): string {
  const normalized = normalizeText(fileName);
  if (normalized.includes('investor') || normalized.includes('diligence')) {
    return 'company_diligence';
  }
  if (normalized.includes('tag') || normalized.includes('genre') || normalized.includes('market-shifts')) {
    return 'genre_growth';
  }
  if (normalized.includes('youtube')) {
    return 'youtube_creator';
  }
  if (normalized.includes('unreleased')) {
    return 'unreleased_opportunity';
  }
  if (normalized.includes('post-launch') || normalized.includes('launch')) {
    return 'game_research';
  }
  if (normalized.includes('community') || normalized.includes('achievement') || normalized.includes('falloff')) {
    return 'community_or_player_evidence';
  }
  return 'general_report';
}

function artifactKind(filePath: string): ReportEvidenceArtifact['kind'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv') return 'csv';
  if (extension === '.html') return 'html';
  if (extension === '.json') return 'json';
  if (extension === '.jsonl') return 'jsonl';
  if (extension === '.md') return 'markdown';
  if (extension === '.pdf') return 'pdf';
  if (extension === '.sql') return 'sql';
  if (filePath.includes('data-audit')) return 'data_audit';
  return 'unknown';
}

function meaningfulTokens(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
    .slice(0, 12);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function buildPackId(packType: ReportPackType, request: Record<string, unknown>): string {
  const hash = createHash('sha256')
    .update(packType)
    .update(JSON.stringify(sortRecord(request)))
    .digest('hex')
    .slice(0, 16);
  return `${packType}-${hash}`;
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortRecord);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortRecord(entry)])
    );
  }
  return value;
}

function estimateTokensForRows(rows: number, budget: ResearchPackBudget): number {
  const multiplier = budget === 'lite' ? 35 : budget === 'standard' ? 55 : 85;
  return Math.min(160_000, Math.max(1200, rows * multiplier));
}

function daysAgoIso(days: number): string {
  const boundedDays = clampInt(days, 1, 365);
  return new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000).toISOString();
}

function releaseYearFilter(
  releaseWindow: UnreleasedOpportunityPackRequest['releaseWindow']
): { gte?: number | null; lte?: number | null } | null {
  const startYear = releaseWindow?.startDate ? new Date(releaseWindow.startDate).getUTCFullYear() : null;
  const endYear = releaseWindow?.endDate ? new Date(releaseWindow.endDate).getUTCFullYear() : null;
  if (!startYear && !endYear) {
    return null;
  }
  return {
    gte: startYear,
    lte: endYear,
  };
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function stripTrailingSemicolon(sql: string): string {
  return stripSqlComments(sql).trim().replace(/;+$/g, '').trim();
}

function hasMultipleStatements(sql: string): boolean {
  const stripped = sql.trim().replace(/;+$/g, '');
  return stripped.includes(';');
}

function hashSql(sql: string): string {
  return createHash('sha256').update(stripSqlComments(sql).trim()).digest('hex');
}

function detectSchemaRefs(sql: string): Array<{ schema: string; table: string }> {
  const refs: Array<{ schema: string; table: string }> = [];
  const regex = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;
  for (const match of sql.matchAll(regex)) {
    refs.push({ schema: match[1].toLowerCase(), table: match[2].toLowerCase() });
  }
  return refs;
}

function detectRelations(sql: string): string[] {
  const refs = detectSchemaRefs(sql).map((ref) => `${ref.schema}.${ref.table}`);
  return [...new Set(refs)].sort();
}

function extractPlanCost(plan: unknown): number | null {
  if (!Array.isArray(plan)) {
    return null;
  }
  const first = plan[0];
  if (typeof first !== 'object' || first === null) {
    return null;
  }
  const planNode = (first as JsonRecord).Plan;
  if (typeof planNode !== 'object' || planNode === null) {
    return null;
  }
  const totalCost = (planNode as JsonRecord)['Total Cost'];
  return typeof totalCost === 'number' ? totalCost : null;
}
