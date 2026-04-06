# Prerequisites

Before setting up PublisherIQ, ensure you have the following tools, accounts, and API keys.

## Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | JavaScript runtime |
| pnpm | 9+ | Package manager |
| Git | Latest | Version control |
| Python | 3.11+ | PICS service (optional) |
| Poetry | Latest | Python dependency management (optional) |

### Installing pnpm

```bash
# Using npm
npm install -g pnpm

# Or using Corepack (Node.js 16.13+)
corepack enable
corepack prepare pnpm@latest --activate
```

## Required Accounts

### 1. Supabase Account

Supabase is the write/control plane for the live product database and admin surfaces.

1. Create account at [supabase.com](https://supabase.com)
2. Create a new project
3. Note your project URL and service key (Settings > API)

### 2. Steam API Key

Required for accessing Steam's official APIs.

1. Log in to Steam
2. Visit [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
3. Register a domain name (can be `localhost` for development)
4. Copy your API key

### 3. LLM API Key (for Chat Interface)

The chat interface requires an LLM provider. Choose one:

**Option A: OpenAI (Default)**
1. Create account at [platform.openai.com](https://platform.openai.com)
2. Generate an API key
3. Uses GPT-4o Mini by default

**Option B: Anthropic**
1. Create account at [console.anthropic.com](https://console.anthropic.com)
2. Generate an API key
3. Uses Claude 3.5 Haiku when selected

### 4. OpenAI API Key (for Embeddings)

Required for the current semantic retrieval pipeline:
1. Create account at [platform.openai.com](https://platform.openai.com)
2. Generate an API key
3. Used for text-embedding-3-small model (1536 dimensions)

### 5. TigerData / Timescale (for Query API Data Plane)

TigerData backs the current query-api contracts used by `/chat` and the Tiger-backed discovery/change paths:

1. Create or access a TigerData / Timescale service.
2. Get the Postgres connection string for `TIGER_PRIMARY_URL`.
3. Allow your local/dev runtime or deployed `query-api` to connect.

### 6. Cube.js Cloud or Fly.io (for Analytics)

Semantic layer for structured queries:
- **Option A: Cube Cloud** - [cube.dev/cloud](https://cube.dev/cloud)
- **Option B: Self-hosted on Fly.io** - Deploy `packages/cube`

## Optional Services

### GitHub Account

Required for:
- Running scheduled sync workflows via GitHub Actions
- Hosting the repository

### Vercel Account

For deploying the admin dashboard:
1. Create account at [vercel.com](https://vercel.com)
2. Connect to your GitHub repository

### Railway Account

For deploying the PICS service:
1. Create account at [railway.app](https://railway.app)
2. Connect to your GitHub repository

## System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 4 GB | 8 GB |
| Disk | 1 GB | 5 GB |
| Network | Stable | Stable |

## Next Steps

Once you have all prerequisites:
1. [Installation](installation.md) - Clone and set up the project
2. [Environment Setup](setup.md) - Configure environment variables
