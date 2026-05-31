# PublisherIQ Research MCP

Internal MCP gateway for governed PublisherIQ research data access.

The gateway does not connect to TigerData or Supabase directly. It forwards MCP
tool calls to `apps/query-api` research endpoints, which in turn use the
existing `@publisheriq/data-plane` read contracts and guardrails.

The MCP server is format-neutral. It returns structured evidence, provenance,
freshness, caveats, and bounded rows. The connected LLM writes whatever output
the user asks for: Markdown, HTML, tables, memo, JSON, CSV summary, deck outline,
or another format.

## Runtime

Required environment:

- `QUERY_API_BASE_URL`: query-api origin.
- `QUERY_API_BEARER_TOKEN`: optional bearer token for query-api.

Optional environment:

- `RESEARCH_MCP_BEARER_TOKEN`: require `Authorization: Bearer ...` on `/mcp`.
- `RESEARCH_MCP_DEFAULT_ROLE`: `internal`, `researcher`, or `admin`.
- `RESEARCH_MCP_HOST`: default `0.0.0.0`.
- `RESEARCH_MCP_PORT`: default `4320`.

Optional query-api/data-plane environment:

- `RESEARCH_ARCHIVE_SCAN_FILESYSTEM=true`: opt into local `docs/reports` prior-work scanning. Leave unset in production unless the full archive is intentionally packaged with query-api.

## Commands

```bash
pnpm --filter @publisheriq/research-mcp build
pnpm --filter @publisheriq/research-mcp dev
pnpm --filter @publisheriq/research-mcp start
pnpm --filter @publisheriq/research-mcp stdio
```

HTTP MCP endpoint:

```text
POST /mcp
```

The read-only SQL sandbox is still controlled by query-api with
`RESEARCH_SQL_SANDBOX_ENABLED=true` and role gating. It is disabled by default.

## Local Smoke Test

Start query-api first:

```bash
pnpm --filter @publisheriq/query-api dev
```

Then start the MCP gateway:

```bash
QUERY_API_BASE_URL=http://127.0.0.1:4318 pnpm --filter @publisheriq/research-mcp dev
```

Check health and tool discovery:

```bash
curl -s http://127.0.0.1:4320/healthz

curl -s http://127.0.0.1:4320/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Railway Deployment

Deploy this app as a separate Railway service from query-api. Use
`apps/research-mcp/railway.json` for the service build/deploy config.

Set these variables on the research MCP service:

```text
QUERY_API_BASE_URL=https://publisheriq-query-api-prod-production.up.railway.app
QUERY_API_BEARER_TOKEN=<same token configured on query-api>
RESEARCH_MCP_BEARER_TOKEN=<long random token for MCP clients>
RESEARCH_MCP_DEFAULT_ROLE=internal
```

Do not set `RESEARCH_MCP_PORT` on Railway; Railway provides `PORT`.

After deployment, test with:

```bash
curl -s https://<research-mcp-domain>/healthz

curl -s https://<research-mcp-domain>/mcp \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <RESEARCH_MCP_BEARER_TOKEN>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s https://<research-mcp-domain>/mcp \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <RESEARCH_MCP_BEARER_TOKEN>' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"build_game_research_pack","arguments":{"game":"Mortal Sin","budget":"lite","peerMode":"similarity","include":["metric_history","change_activity","youtube"]}}}'
```

`search_report_archive` is optional prior-work discovery. It returns an empty
catalog unless query-api is configured with `RESEARCH_ARCHIVE_SCAN_FILESYSTEM=true`
or a future archive index provider.
