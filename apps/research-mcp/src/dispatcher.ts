import type { ResearchMcpRole } from './config.js';
import { MCP_RESOURCES, MCP_TOOLS } from './mcp-metadata.js';

type JsonRpcId = number | string | null;

interface JsonRpcRequest {
  id?: JsonRpcId;
  jsonrpc?: string;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolCallParams {
  arguments?: Record<string, unknown>;
  name?: string;
}

interface ResourceReadParams {
  uri?: string;
}

export interface McpDispatchContext {
  queryApi: {
    post(path: string, body: unknown, role?: ResearchMcpRole): Promise<unknown>;
  };
  role: ResearchMcpRole;
}

export async function dispatchMcpRequest(
  request: JsonRpcRequest,
  context: McpDispatchContext
): Promise<Record<string, unknown> | null> {
  try {
    const result = await handleMethod(request, context);
    if (request.id === undefined) {
      return null;
    }
    return {
      id: request.id,
      jsonrpc: '2.0',
      result,
    };
  } catch (error) {
    if (request.id === undefined) {
      return null;
    }
    return {
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Unknown MCP error',
      },
      id: request.id,
      jsonrpc: '2.0',
    };
  }
}

async function handleMethod(
  request: JsonRpcRequest,
  context: McpDispatchContext
): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return {
        capabilities: {
          resources: {},
          tools: {},
        },
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'publisheriq-research-mcp',
          version: '0.0.1',
        },
      };
    case 'notifications/initialized':
      return {};
    case 'tools/list':
      return { tools: MCP_TOOLS };
    case 'resources/list':
      return { resources: MCP_RESOURCES };
    case 'tools/call':
      return callTool(request.params as ToolCallParams | undefined, context);
    case 'resources/read':
      return readResource(request.params as ResourceReadParams | undefined, context);
    default:
      throw new Error(`Unsupported MCP method: ${request.method}`);
  }
}

async function callTool(
  params: ToolCallParams | undefined,
  context: McpDispatchContext
): Promise<unknown> {
  const name = params?.name;
  const args = params?.arguments ?? {};
  if (!name) {
    throw new Error('Missing tool name.');
  }

  const result = await invokeQueryApiTool(name, args, context);
  return {
    content: [
      {
        text: JSON.stringify(result, null, 2),
        type: 'text',
      },
    ],
  };
}

async function invokeQueryApiTool(
  name: string,
  args: Record<string, unknown>,
  context: McpDispatchContext
): Promise<unknown> {
  switch (name) {
    case 'get_report_instructions':
      return context.queryApi.post('/v1/research/report-instructions', args, context.role);
    case 'search_report_archive':
      return context.queryApi.post('/v1/research/report-archive/search', args, context.role);
    case 'build_game_research_pack':
      return context.queryApi.post('/v1/research/evidence-packs/game', args, context.role);
    case 'build_genre_growth_pack':
      return context.queryApi.post('/v1/research/evidence-packs/genre-growth', args, context.role);
    case 'build_youtube_creator_pack':
      return context.queryApi.post('/v1/research/evidence-packs/youtube-creators', args, context.role);
    case 'build_company_diligence_pack':
      return context.queryApi.post('/v1/research/evidence-packs/company-diligence', args, context.role);
    case 'build_unreleased_opportunity_pack':
      return context.queryApi.post('/v1/research/evidence-packs/unreleased-opportunity', args, context.role);
    case 'build_report_recreation_pack':
      return context.queryApi.post('/v1/research/evidence-packs/report-recreation', args, context.role);
    case 'get_publisheriq_data_dictionary':
      return buildPublisherIqDataDictionary(args);
    case 'query_publisheriq_data':
      return context.queryApi.post(
        '/v1/research/readonly-analysis',
        normalizeReadonlyAnalysisArgs(args),
        context.role
      );
    case 'run_readonly_analysis':
      return context.queryApi.post('/v1/research/readonly-analysis', args, context.role);
    default:
      throw new Error(`Unknown PublisherIQ research tool: ${name}`);
  }
}

function normalizeReadonlyAnalysisArgs(args: Record<string, unknown>): Record<string, unknown> {
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  const purpose = typeof args.purpose === 'string' && args.purpose.trim() ? args.purpose : question;
  return {
    ...args,
    purpose,
  };
}

function buildPublisherIqDataDictionary(args: Record<string, unknown>): Record<string, unknown> {
  const topic = typeof args.topic === 'string' && args.topic.trim() ? args.topic.trim() : null;

  return {
    allowedSchemas: [
      {
        commonRelations: [
          'legacy.apps',
          'legacy.app_steam_tags',
          'legacy.steam_tags',
          'legacy.app_genres',
          'legacy.steam_genres',
        ],
        purpose: 'Steam app identity, catalog, company, genre, and tag bridge tables.',
        schema: 'legacy',
      },
      {
        commonRelations: [
          'metrics.apps_page_projection',
          'metrics.unreleased_games_projection',
          'metrics.daily_metrics',
          'metrics.ccu_snapshots',
          'metrics.review_deltas',
          'metrics.youtube_game_daily',
        ],
        purpose:
          'Governed projections, rankings, current metrics, and time-series evidence. Large history tables require date bounds.',
        schema: 'metrics',
      },
      {
        commonRelations: ['docs.steam_news', 'docs.youtube_channels', 'docs.youtube_videos'],
        purpose: 'Steam news, source documents, and YouTube metadata/coverage evidence.',
        schema: 'docs',
      },
      {
        commonRelations: ['events.app_change_events', 'events.change_bursts'],
        purpose: 'Steam app change activity and launch/update event signals.',
        schema: 'events',
      },
      {
        commonRelations: ['core.entities', 'core.entity_aliases', 'core.external_ids'],
        purpose: 'Canonical entity identity, aliases, and cross-platform IDs.',
        schema: 'core',
      },
      {
        commonRelations: [
          'ops.app_capture_work_state',
          'ops.ccu_tier_assignments',
          'ops.change_intel_sync_jobs',
          'ops.sync_jobs',
          'ops.sync_status',
        ],
        purpose: 'Limited status and freshness views only.',
        schema: 'ops',
      },
    ],
    commonQuestions: [
      {
        question: 'Top released games, including indie-tagged games',
        startFrom: 'metrics.apps_page_projection',
        joins: ['legacy.app_steam_tags', 'legacy.steam_tags'],
      },
      {
        question: 'Upcoming or unreleased opportunity candidates',
        startFrom: 'metrics.unreleased_games_projection',
      },
      {
        question: 'Steam tag or genre cohorts',
        startFrom: 'legacy.app_steam_tags or legacy.app_genres',
        joins: ['legacy.steam_tags', 'legacy.steam_genres'],
      },
      {
        question: 'YouTube attention over time',
        startFrom: 'metrics.youtube_game_daily',
        requirement: 'Always bound metric_date.',
      },
      {
        question: 'Metric history',
        startFrom: 'metrics.daily_metrics, metrics.ccu_snapshots, or metrics.review_deltas',
        requirement: 'Always include metric_date, captured_at, snapshot_at, observed_at, or delta_date bounds.',
      },
    ],
    defaultRanking: {
      rule: 'When the user asks for top games without naming a metric, use released, non-delisted games ordered by total_reviews DESC NULLS LAST, owners_midpoint DESC NULLS LAST, ccu_peak DESC NULLS LAST.',
      sourceTable: 'metrics.apps_page_projection',
      stateInAnswer: true,
    },
    disallowedSchemas: ['information_schema', 'tiger', 'read', 'publisheriq', 'analytics'],
    notes: [
      'query_publisheriq_data only accepts one SELECT/WITH statement.',
      'Use LIMIT and set expectedRows to the intended returned row count.',
      'Do not query raw profile/player identifiers; use aggregate evidence unless a privileged audited workflow exists.',
      'Do not use database credentials directly. All SQL must go through query_publisheriq_data.',
    ],
    topic,
    templates: {
      top_indie_games: {
        description:
          'Default top-indie list using released, non-delisted Steam games and the Indie Steam tag.',
        sql:
          "SELECT p.appid, p.name, p.total_reviews, p.review_score, p.owners_midpoint, p.ccu_peak, p.release_date, p.developer_name, p.publisher_name\nFROM metrics.apps_page_projection p\nJOIN legacy.app_steam_tags ast ON ast.appid = p.appid\nJOIN legacy.steam_tags st ON st.tag_id = ast.tag_id\nWHERE p.type = 'game'\n  AND p.is_released = true\n  AND p.is_delisted = false\n  AND lower(st.name) = 'indie'\nORDER BY p.total_reviews DESC NULLS LAST, p.owners_midpoint DESC NULLS LAST, p.ccu_peak DESC NULLS LAST\nLIMIT 10",
      },
    },
  };
}

async function readResource(
  params: ResourceReadParams | undefined,
  context: McpDispatchContext
): Promise<unknown> {
  const uri = params?.uri;
  if (!uri) {
    throw new Error('Missing resource URI.');
  }

  switch (uri) {
    case 'publisheriq://instructions/report-writing/v1':
      return textResource(uri, REPORT_WRITING_RESOURCE);
    case 'publisheriq://instructions/evidence-standards/v1':
      return textResource(uri, EVIDENCE_STANDARDS_RESOURCE);
    case 'publisheriq://reports/catalog': {
      const catalog = await context.queryApi.post(
        '/v1/research/report-archive/search',
        { limit: 100 },
        context.role
      );
      return jsonResource(uri, catalog);
    }
    case 'publisheriq://schemas/evidence-pack/v1':
      return jsonResource(uri, EVIDENCE_PACK_SCHEMA);
    case 'publisheriq://data-dictionary/tiger-read-plane/v1':
      return textResource(uri, TIGER_READ_PLANE_RESOURCE);
    default:
      throw new Error(`Unknown PublisherIQ resource: ${uri}`);
  }
}

function textResource(uri: string, text: string): Record<string, unknown> {
  return {
    contents: [
      {
        mimeType: 'text/markdown',
        text,
        uri,
      },
    ],
  };
}

function jsonResource(uri: string, value: unknown): Record<string, unknown> {
  return {
    contents: [
      {
        mimeType: 'application/json',
        text: JSON.stringify(value, null, 2),
        uri,
      },
    ],
  };
}

const REPORT_WRITING_RESOURCE = `# PublisherIQ Optional Writing Guidance

PublisherIQ MCP tools provide data, provenance, and caveats. The connected LLM should write in whatever format the user requests: memo, Markdown, HTML, table, JSON, CSV summary, deck outline, or another shape.

Use this guidance only when the user wants PublisherIQ house style.

Recommended opening for house-style outputs:
- Game- or market-specific headline.
- Verdict that names the mechanism.
- Source block with counts and dates.
- Confidence taxonomy: High confidence, Directional signal, Strategic inference.

Rules:
- Every analytical claim needs a source, sample size when available, and a number or named data point.
- Recommendations need consequence blocks: "If [wrong move]: [specific commercial/player outcome]."
- Do not publish to /reports through MCP. Treat outputs as unpublished drafts unless a human separately approves publication.
- Use evidence packs first; synthesis comes after evidence assembly.
- The final output format belongs to the user's prompt, not to MCP.
`;

const EVIDENCE_STANDARDS_RESOURCE = `# PublisherIQ Evidence Standards

Confidence:
- High confidence: multiple independent signals agree, or one authoritative source directly supports the claim.
- Directional signal: one strong source supports prioritization, but not a forecast by itself.
- Strategic inference: the commercial read that connects observed evidence into an operating sequence.

Claim requirements:
- Source.
- Sample size where available.
- Number or named data point.
- Player-language example when the claim is about player language.

Raw community, profile, and public-player evidence should default to aggregate output. Do not expose raw profile identifiers unless a privileged, audited workflow explicitly requests it.
`;

const TIGER_READ_PLANE_RESOURCE = `# Tiger / Query-API Read Plane

Use query-api contracts and evidence packs for governed PublisherIQ research data access. Current contract families include entity resolution, entity overview, catalog search, momentum, similarity, metric history, change/news evidence, comparison, continuation, and YouTube coverage.

Primary research source families:
- legacy apps/company/taxonomy relations.
- metrics daily metrics, monthly playtime, review velocity, review deltas, review histograms, YouTube rollups.
- docs Steam news, source snapshots, YouTube channels/videos/matches.
- events app change events, change bursts, and pattern windows.
- core entities, aliases, external IDs, and relationships.

For broad questions, use query_publisheriq_data and write a bounded SELECT query. Prefer projection tables when possible:
- Released game rankings: metrics.apps_page_projection. Useful columns include appid, name, type, is_released, is_delisted, owners_midpoint, total_reviews, review_score, positive_percentage, ccu_peak, release_date, publisher_name, developer_name, genre_ids, tag_ids, metric_date.
- Steam tags and genres: legacy.app_steam_tags, legacy.steam_tags, legacy.app_genres, legacy.steam_genres. For "indie", join legacy.steam_tags where lower(name) = 'indie'.
- Unreleased opportunities: metrics.unreleased_games_projection. Useful columns include appid, name, release_date, release_status, publisher_status, opportunity_score, publisher_name, developer_name, genre_names, tag_names, latest_news_at, latest_change_at.
- YouTube market attention: metrics.youtube_game_daily joined to legacy.apps. Always bound metric_date.
- Large history tables such as metrics.daily_metrics, metrics.ccu_snapshots, and metrics.review_deltas require date bounds.

Default "top games" ranking when the user does not specify a metric: released, non-delisted games ranked by total_reviews DESC, then owners_midpoint DESC, then ccu_peak DESC. State this choice in the answer.

Example top indie SQL:
SELECT p.appid, p.name, p.total_reviews, p.review_score, p.owners_midpoint, p.ccu_peak, p.release_date, p.developer_name, p.publisher_name
FROM metrics.apps_page_projection p
JOIN legacy.app_steam_tags ast ON ast.appid = p.appid
JOIN legacy.steam_tags st ON st.tag_id = ast.tag_id
WHERE p.type = 'game'
  AND p.is_released = true
  AND p.is_delisted = false
  AND lower(st.name) = 'indie'
ORDER BY p.total_reviews DESC NULLS LAST, p.owners_midpoint DESC NULLS LAST, p.ccu_peak DESC NULLS LAST
LIMIT 10;

Do not expose Tiger or Supabase database credentials to users or model clients. Ad hoc SQL must go through query_publisheriq_data or the governed readonly-analysis alias. MCP does not choose or publish the final user-facing format.
`;

const EVIDENCE_PACK_SCHEMA = {
  properties: {
    artifacts: { type: 'array' },
    confidenceHints: { type: 'array' },
    costEstimate: { type: 'object' },
    entities: { type: 'array' },
    freshness: { type: 'array' },
    generatedAt: { type: 'string' },
    limitations: { type: 'array' },
    packId: { type: 'string' },
    packType: { type: 'string' },
    provenance: { type: 'array' },
    request: { type: 'object' },
    sections: { type: 'array' },
  },
  required: [
    'packId',
    'packType',
    'request',
    'generatedAt',
    'freshness',
    'entities',
    'sections',
    'artifacts',
    'provenance',
    'limitations',
    'confidenceHints',
    'costEstimate',
  ],
  type: 'object',
};
