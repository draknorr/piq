import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MCP_URL = 'https://publisheriq-research-mcp-prod-production.up.railway.app/mcp';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = {
  name: 'publisheriq-research',
  version: '0.1.2',
};

const MCP_RESOURCES = [
  {
    description: 'Optional PublisherIQ writing guidance for users who want a house style.',
    mimeType: 'text/markdown',
    name: 'Optional Writing Guidance',
    uri: 'publisheriq://instructions/report-writing/v1',
  },
  {
    description: 'Evidence, source-block, confidence, review-fragment, and citation standards.',
    mimeType: 'text/markdown',
    name: 'Evidence Standards',
    uri: 'publisheriq://instructions/evidence-standards/v1',
  },
  {
    description: 'Optional prior-work catalog when archive indexing is enabled.',
    mimeType: 'application/json',
    name: 'Prior-Work Catalog',
    uri: 'publisheriq://reports/catalog',
  },
  {
    description: 'JSON shape returned by PublisherIQ research evidence pack tools.',
    mimeType: 'application/json',
    name: 'Evidence Pack Schema',
    uri: 'publisheriq://schemas/evidence-pack/v1',
  },
  {
    description: 'High-level Tiger/query-api read-plane dictionary for research agents.',
    mimeType: 'text/markdown',
    name: 'Tiger Read Plane Data Dictionary',
    uri: 'publisheriq://data-dictionary/tiger-read-plane/v1',
  },
];

const budgetSchema = {
  enum: ['lite', 'standard', 'full'],
  type: 'string',
};

const READ_PLANE_SQL_GUIDANCE =
  'Allowed Tiger read-plane schemas are legacy, metrics, docs, events, and core; ops is limited to status/work-state relations. For broad released-game rankings, start from metrics.apps_page_projection. For Steam tag filters such as indie, join legacy.app_steam_tags to legacy.steam_tags. Default top-game ranking is total_reviews DESC NULLS LAST, owners_midpoint DESC NULLS LAST, ccu_peak DESC NULLS LAST. Do not use information_schema, tiger, read, publisheriq, or analytics schemas.';

const TOP_INDIE_SQL_GUIDANCE =
  "Top indie template: SELECT p.appid, p.name, p.total_reviews, p.review_score, p.owners_midpoint, p.ccu_peak, p.release_date, p.developer_name, p.publisher_name FROM metrics.apps_page_projection p JOIN legacy.app_steam_tags ast ON ast.appid = p.appid JOIN legacy.steam_tags st ON st.tag_id = ast.tag_id WHERE p.type = 'game' AND p.is_released = true AND p.is_delisted = false AND lower(st.name) = 'indie' ORDER BY p.total_reviews DESC NULLS LAST, p.owners_midpoint DESC NULLS LAST, p.ccu_peak DESC NULLS LAST LIMIT 10.";

const MCP_TOOLS = [
  {
    description:
      'Return optional PublisherIQ writing guidance, confidence rules, and source-use guidance.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        audience: { type: 'string' },
        depth: { enum: ['short', 'standard', 'full'], type: 'string' },
        shape: { type: 'string' },
      },
      type: 'object',
    },
    name: 'get_report_instructions',
  },
  {
    description:
      'Search optional indexed prior work, SQL evidence, CSV artifacts, HTML/Markdown reports, and static audit outputs when available.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        limit: { maximum: 100, minimum: 1, type: 'number' },
        query: { type: 'string' },
        reportType: { type: 'string' },
      },
      type: 'object',
    },
    name: 'search_report_archive',
  },
  {
    description:
      'Build a format-neutral game evidence pack with snapshot, metric history, news/change evidence, peers, and YouTube.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        game: { type: 'string' },
        include: {
          items: {
            enum: [
              'achievement',
              'change_activity',
              'community',
              'metric_history',
              'peer_cohort',
              'review_history',
              'store_state',
              'youtube',
            ],
            type: 'string',
          },
          type: 'array',
        },
        peerMode: { enum: ['none', 'similarity', 'tag_cohort'], type: 'string' },
        windows: { type: 'object' },
      },
      required: ['game'],
      type: 'object',
    },
    name: 'build_game_research_pack',
  },
  {
    description:
      'Build a genre/tag growth evidence pack with available movement rows, market context, and caveats.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        dimensions: {
          items: { enum: ['genre', 'tag', 'theme'], type: 'string' },
          type: 'array',
        },
        topN: { maximum: 50, minimum: 1, type: 'number' },
        windows: { type: 'object' },
        year: { type: 'number' },
      },
      type: 'object',
    },
    name: 'build_genre_growth_pack',
  },
  {
    description:
      'Build a per-game YouTube creator coverage pack with channels, videos, growth, cadence, and coverage caveats.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        game: { type: 'string' },
        limit: { maximum: 50, minimum: 1, type: 'number' },
        window: { enum: ['1d', '7d', '14d', '30d', 'current'], type: 'string' },
      },
      required: ['game'],
      type: 'object',
    },
    name: 'build_youtube_creator_pack',
  },
  {
    description:
      'Build a company diligence evidence pack with portfolio, target games, community signals when available, and caveats.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        company: { type: 'string' },
        includeCommunity: { type: 'boolean' },
        targetGames: { items: { type: 'string' }, type: 'array' },
      },
      required: ['company'],
      type: 'object',
    },
    name: 'build_company_diligence_pack',
  },
  {
    description:
      'Build an unreleased opportunity evidence pack with candidate rows, release-window evidence, and signability caveats.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        filters: { type: 'object' },
        releaseWindow: { type: 'object' },
        targetLens: {
          enum: ['all', 'no_publisher', 'self_published', 'small_publisher'],
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'build_unreleased_opportunity_pack',
  },
  {
    description:
      'Build an optional prior-work recreation pack from indexed PublisherIQ archive metadata when available.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        reportId: { type: 'string' },
      },
      required: ['reportId'],
      type: 'object',
    },
    name: 'build_report_recreation_pack',
  },
  {
    description:
      'Return the PublisherIQ read-plane data dictionary for SQL-backed questions: allowed schemas, common tables, ranking defaults, key columns, and safe SQL templates. Call this before query_publisheriq_data when table names or ranking rules are unclear.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        topic: {
          description:
            'Optional focus such as top games, indie games, released rankings, unreleased opportunities, YouTube, tags, genres, companies, or metric history.',
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'get_publisheriq_data_dictionary',
  },
  {
    description:
      `Answer arbitrary PublisherIQ data questions by running bounded read-only SQL through query-api. Use this for top-N lists, rankings, filters, cohorts, comparisons, exploratory reads, and questions that do not fit a specific evidence-pack tool. The SQL must be a single SELECT/WITH statement with LIMIT and safe time bounds for large metric tables. ${READ_PLANE_SQL_GUIDANCE} ${TOP_INDIE_SQL_GUIDANCE}`,
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        expectedRows: { maximum: 500, minimum: 1, type: 'number' },
        question: {
          description: 'The user-facing analysis question this SQL is meant to answer.',
          type: 'string',
        },
        sql: {
          description:
            `Single read-only SELECT/WITH SQL statement. Include LIMIT and use allowlisted Tiger read-plane schemas. ${READ_PLANE_SQL_GUIDANCE} ${TOP_INDIE_SQL_GUIDANCE}`,
          type: 'string',
        },
      },
      required: ['question', 'sql'],
      type: 'object',
    },
    name: 'query_publisheriq_data',
  },
  {
    description:
      'Backward-compatible alias for governed read-only SQL analysis. Prefer query_publisheriq_data for arbitrary PublisherIQ questions.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        budget: budgetSchema,
        expectedRows: { maximum: 500, minimum: 1, type: 'number' },
        purpose: { type: 'string' },
        sql: { type: 'string' },
      },
      required: ['sql', 'purpose'],
      type: 'object',
    },
    name: 'run_readonly_analysis',
  },
];

export function loadConfig(env = process.env) {
  const url = (env.RESEARCH_MCP_URL || DEFAULT_MCP_URL).trim();
  const bearerToken = (env.RESEARCH_MCP_BEARER_TOKEN || '').trim();

  if (!url) {
    throw new Error('Missing RESEARCH_MCP_URL.');
  }
  if (!bearerToken) {
    throw new Error('Missing RESEARCH_MCP_BEARER_TOKEN.');
  }

  return {
    bearerToken,
    timeoutMs: readPositiveNumber(env.RESEARCH_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    url,
  };
}

export async function forwardJsonRpcLine(line, options = {}) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return JSON.stringify(errorResponse(null, -32700, 'Invalid JSON-RPC request.'));
  }

  const hasResponse = Object.prototype.hasOwnProperty.call(request, 'id');
  const localResponse = localResponseFor(request, hasResponse);
  if (localResponse !== undefined) {
    return localResponse;
  }

  let config;
  try {
    config = options.config ?? loadConfig(options.env);
  } catch (error) {
    if (!hasResponse) {
      return null;
    }
    return JSON.stringify(errorResponse(request.id, -32000, messageFromError(error)));
  }

  try {
    const payload = await postToHostedMcp(trimmed, {
      config,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
    });
    return payload === null ? null : JSON.stringify(payload);
  } catch (error) {
    if (!hasResponse) {
      return null;
    }
    return JSON.stringify(errorResponse(request.id, -32000, messageFromError(error)));
  }
}

export function startProxy(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const env = options.env ?? process.env;

  const lines = readline.createInterface({
    input,
    output,
    terminal: false,
  });

  lines.on('line', (line) => {
    void forwardJsonRpcLine(line, { env, fetchImpl })
      .then((responseLine) => {
        if (responseLine) {
          output.write(`${responseLine}\n`);
        }
      })
      .catch((error) => {
        errorOutput.write(`${messageFromError(error)}\n`);
      });
  });
}

export function isCliEntrypoint(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) {
    return false;
  }

  try {
    return fileURLToPath(metaUrl) === argvPath;
  } catch {
    return false;
  }
}

function localResponseFor(request, hasResponse) {
  switch (request.method) {
    case 'initialize':
      return hasResponse
        ? JSON.stringify(
            resultResponse(request.id, {
              capabilities: {
                resources: {},
                tools: {},
              },
              protocolVersion:
                typeof request.params?.protocolVersion === 'string'
                  ? request.params.protocolVersion
                  : DEFAULT_PROTOCOL_VERSION,
              serverInfo: SERVER_INFO,
            })
          )
        : null;
    case 'notifications/initialized':
      return hasResponse ? JSON.stringify(resultResponse(request.id, {})) : null;
    case 'tools/list':
      return hasResponse ? JSON.stringify(resultResponse(request.id, { tools: MCP_TOOLS })) : null;
    case 'resources/list':
      return hasResponse
        ? JSON.stringify(resultResponse(request.id, { resources: MCP_RESOURCES }))
        : null;
    default:
      return undefined;
  }
}

async function postToHostedMcp(body, { config, fetchImpl }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This extension requires a Node runtime with fetch support.');
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(config.url, {
      body,
      headers: {
        authorization: `Bearer ${config.bearerToken}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: abortController.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `PublisherIQ MCP request failed with HTTP ${response.status}: ${text || 'empty response'}`
      );
    }
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('PublisherIQ MCP returned invalid JSON.');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resultResponse(id, result) {
  return {
    id,
    jsonrpc: '2.0',
    result,
  };
}

function errorResponse(id, code, message) {
  return {
    error: {
      code,
      message,
    },
    id,
    jsonrpc: '2.0',
  };
}

function messageFromError(error) {
  return error instanceof Error ? error.message : 'Unknown PublisherIQ MCP proxy error.';
}

if (isCliEntrypoint(import.meta.url)) {
  startProxy();
}
