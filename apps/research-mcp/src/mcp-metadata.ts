export interface McpToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
}

export interface McpResourceDefinition {
  description: string;
  mimeType: string;
  name: string;
  uri: string;
}

export const MCP_RESOURCES: McpResourceDefinition[] = [
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

export const MCP_TOOLS: McpToolDefinition[] = [
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
      'Run a governed read-only SQL analysis through query-api. Requires researcher/admin role and server-side sandbox enablement.',
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
