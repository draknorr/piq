# PublisherIQ Research Claude Extension

This package builds a Claude Desktop `.mcpb` extension for PublisherIQ Research.
The extension runs a tiny local stdio proxy that forwards Claude MCP requests to
the hosted PublisherIQ Research MCP endpoint.

The bundle does not contain secrets. Claude Desktop prompts for the bearer token
at install time and stores it as a sensitive setting.

## Build

```bash
pnpm --filter @publisheriq/research-mcp-claude-extension test
pnpm --filter @publisheriq/research-mcp-claude-extension pack
```

The pack command runs Anthropic's MCPB CLI and produces a `.mcpb` file from this
directory.

## Install In Claude Desktop

1. Open Claude Desktop.
2. Go to Settings -> Extensions -> Advanced settings -> Install Extension.
3. Select the generated `.mcpb` file.
4. Leave the MCP URL as:

```text
https://publisheriq-research-mcp-prod-production.up.railway.app/mcp
```

5. Paste the PublisherIQ Research MCP bearer token when prompted.

## Smoke Prompts

```text
Use PublisherIQ to list the available research tools.
```

```text
Use PublisherIQ to build a lite game research pack for Mortal Sin. Summarize the
current snapshot, YouTube evidence, freshness, and limitations.
```

```text
Use PublisherIQ to build a genre growth pack for 2026 and return the result as a
table plus caveats.
```
