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
    case 'run_readonly_analysis':
      return context.queryApi.post('/v1/research/readonly-analysis', args, context.role);
    default:
      throw new Error(`Unknown PublisherIQ research tool: ${name}`);
  }
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

Do not expose Tiger or Supabase database credentials to users or model clients. Ad hoc SQL must go through the governed readonly-analysis tool. MCP does not choose or publish the final user-facing format.
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
