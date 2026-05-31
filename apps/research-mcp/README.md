# PublisherIQ Research MCP

Internal MCP gateway for report-grade PublisherIQ research tools.

The gateway does not connect to TigerData or Supabase directly. It forwards MCP
tool calls to `apps/query-api` research endpoints, which in turn use the
existing `@publisheriq/data-plane` read contracts and guardrails.

## Runtime

Required environment:

- `QUERY_API_BASE_URL`: query-api origin.
- `QUERY_API_BEARER_TOKEN`: optional bearer token for query-api.

Optional environment:

- `RESEARCH_MCP_BEARER_TOKEN`: require `Authorization: Bearer ...` on `/mcp`.
- `RESEARCH_MCP_DEFAULT_ROLE`: `internal`, `researcher`, or `admin`.
- `RESEARCH_MCP_HOST`: default `0.0.0.0`.
- `RESEARCH_MCP_PORT`: default `4320`.

## Commands

```bash
pnpm --filter @publisheriq/research-mcp build
pnpm --filter @publisheriq/research-mcp start
pnpm --filter @publisheriq/research-mcp stdio
```

HTTP MCP endpoint:

```text
POST /mcp
```

The read-only SQL sandbox is still controlled by query-api with
`RESEARCH_SQL_SANDBOX_ENABLED=true` and role gating. It is disabled by default.
