# PublisherIQ Research Claude Extension

This package builds a Claude Desktop `.mcpb` extension for PublisherIQ Research.
The extension runs a tiny local stdio proxy. It answers Claude's startup and
tool/resource discovery calls locally, then forwards actual PublisherIQ data
tool calls to the hosted PublisherIQ Research MCP endpoint.

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

If you are replacing an older local build, uninstall the existing PublisherIQ
Research extension first, install the newly generated `.mcpb`, then fully quit
and reopen Claude Desktop. Claude caches extension server processes aggressively
enough that disabling and re-enabling is not always sufficient after proxy code
changes.

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

```text
Use PublisherIQ Research to tell me the top 10 indie games. Use the default
PublisherIQ ranking if I do not specify a metric. Call the PublisherIQ data
dictionary first if you need table names, then include SQL provenance and caveats.
```
