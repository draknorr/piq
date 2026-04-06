# Environment Setup

PublisherIQ uses environment variables to configure database connections, API keys, and service settings. This guide covers the current Supabase + TigerData split.

## Quick Setup

Create a `.env` file in the project root:

```bash
# Required for all operations
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
STEAM_API_KEY=your_steam_api_key

# Chat defaults to OpenAI; switch providers only if you explicitly want Anthropic
OPENAI_API_KEY=sk-...
LLM_PROVIDER=openai
# Optional alternate provider
ANTHROPIC_API_KEY=sk-ant-...
# LLM_PROVIDER=anthropic
```

---

## Variable Reference

### Core Database

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (has admin access) |

**Where to find:**
1. Go to your Supabase project
2. Settings > API
3. Copy "Project URL" and "service_role" key

**Security note:** The service key has full database access. Never expose it in client-side code.

### Steam API

| Variable | Required | Description |
|----------|----------|-------------|
| `STEAM_API_KEY` | Yes | Steam Web API key |

**Where to get:**
[steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)

### LLM Provider (Chat Interface)

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_PROVIDER` | No | `openai` (default) or `anthropic` |
| `OPENAI_API_KEY` | Recommended | OpenAI API key for the default chat provider and embeddings |
| `ANTHROPIC_API_KEY` | If using Anthropic | Anthropic API key |

**Models used by default repo configuration:**
- OpenAI: GPT-4o Mini (`gpt-4o-mini`)
- Anthropic: Claude 3.5 Haiku (`claude-3-5-haiku-20241022`) when `LLM_PROVIDER=anthropic`

### Cube.js Semantic Layer

| Variable | Required | Description |
|----------|----------|-------------|
| `CUBE_API_URL` | Yes | Cube.js API endpoint (e.g., `https://your-app.fly.dev/cubejs-api/v1`) |
| `CUBE_API_SECRET` | Yes | Secret for JWT token signing |

### Tiger Query API / TigerData Data Plane

| Variable | Required | Description |
|----------|----------|-------------|
| `QUERY_API_BASE_URL` | Yes for deployed admin chat | Base URL for the Tiger query-api |
| `QUERY_API_BEARER_TOKEN` | Yes for protected query-api routes | Shared bearer token between admin and query-api |
| `TIGER_PRIMARY_URL` | Yes for query-api | TigerData / Timescale Postgres connection string |

**Notes:**
- `/chat` and the Tiger-backed discovery routes use the Tiger query-api for contract execution.
- `QUERY_API_BASE_URL` / `QUERY_API_BEARER_TOKEN` belong in `apps/admin/.env.local`.
- `TIGER_PRIMARY_URL` belongs in the query-api / data-plane runtime environment.
- `DATA_PLANE_SOURCE_URL` is reserved for source-side baseline/backfill reads.
- `DATABASE_URL` is the Supabase source fallback used by worker and repair scripts.

### Authentication (v2.1+)

Optional variables for user authentication and credits:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_MODE` | No | `none` | Set to `magic_link` to enable Supabase auth |
| `CREDITS_ENABLED` | No | `false` | Set to `true` to enable credit system |
| `NEXT_PUBLIC_SUPABASE_URL` | If auth | - | Public Supabase URL (client-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | If auth | - | Public anon key (client-side) |

**Credit System:**
- Signup bonus: 1000 credits
- Chat uses reservation plus finalize/refund billing with the current runtime defaults
- Reservation pattern: Credits reserved before chat, finalized after

---

## PICS Service Variables

The Python PICS service has its own configuration. Create `services/pics-service/.env`:

### Required

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Same as root project |
| `SUPABASE_SERVICE_KEY` | Yes | Same as root project |

### Service Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `change_monitor` | `bulk_sync` or `change_monitor` |
| `PORT` | `8080` | Health check server port |

**Modes:**
- `bulk_sync` - Fetches all ~70k apps (one-time initial sync)
- `change_monitor` - Watches for PICS changes in real-time

### Bulk Sync Options

Used when `MODE=bulk_sync`:

| Variable | Default | Description |
|----------|---------|-------------|
| `BULK_BATCH_SIZE` | `200` | Apps per batch |
| `BULK_REQUEST_DELAY` | `0.5` | Seconds between batches |

### Change Monitor Options

Used when `MODE=change_monitor`:

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL` | `30` | Seconds between change polls |
| `PROCESS_BATCH_SIZE` | `100` | Changes to process per batch |
| `MAX_QUEUE_SIZE` | `10000` | Maximum queued changes |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `LOG_JSON` | `true` | JSON format for production logging |

---

## GitHub Actions Secrets

For scheduled sync jobs, add these secrets to your GitHub repository:

**Settings > Secrets and variables > Actions > New repository secret**

| Secret Name | Value |
|-------------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your service role key |
| `STEAM_API_KEY` | Your Steam API key |
| `DATABASE_URL` | PostgreSQL connection string (v2.1, for refresh-views workflow) |

---

## Vercel Environment Variables

For dashboard deployment, add these in Vercel project settings:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your service role key |
| `OPENAI_API_KEY` | OpenAI API key |
| `LLM_PROVIDER` | `openai` |
| `CUBE_API_URL` | Cube.js API endpoint |
| `CUBE_API_SECRET` | Cube.js JWT secret |
| `QUERY_API_BASE_URL` | Tiger query-api endpoint |
| `QUERY_API_BEARER_TOKEN` | Tiger query-api bearer token |
| `CHAT_TIGER_PRIMARY_MODE` | `all` for Tiger-first chat |
| `CHAT_TIGER_SHADOW_MODE` | `off` for Tiger-first chat |

---

## Railway Environment Variables

For PICS service deployment:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your service role key |
| `MODE` | `change_monitor` |
| `PORT` | `${{RAILWAY_PORT}}` (auto-injected) |
| `LOG_JSON` | `true` |

---

## Example .env Files

### Root `.env`

```bash
# Database
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Steam
STEAM_API_KEY=ABCD1234EFGH5678

# LLM (for chat)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Cube.js (semantic layer)
CUBE_API_URL=https://publisheriq-cube.fly.dev/cubejs-api/v1
CUBE_API_SECRET=your-cube-api-secret

# Tiger query-api / query contracts
QUERY_API_BASE_URL=http://127.0.0.1:4318
QUERY_API_BEARER_TOKEN=your-query-api-bearer-token
CHAT_TIGER_PRIMARY_MODE=all
CHAT_TIGER_SHADOW_MODE=off

# OpenAI (embeddings)
OPENAI_API_KEY=sk-...
```

### `apps/admin/.env.local`

```bash
# Database
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# LLM (for chat)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Cube.js (semantic layer)
CUBE_API_URL=https://publisheriq-cube.fly.dev/cubejs-api/v1
CUBE_API_SECRET=your-cube-api-secret

# Tiger query-api / TigerData data plane
TIGER_PRIMARY_URL=postgres://tsdbadmin:password@host:5432/tsdb?sslmode=require
DATA_PLANE_SOURCE_URL=postgres://postgres:password@live-source-host:5432/postgres
DATABASE_URL=postgres://postgres:password@supabase-host:5432/postgres
QUERY_API_BEARER_TOKEN=your-query-api-bearer-token
```

### `services/pics-service/.env`

```bash
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

MODE=change_monitor
PORT=8080

POLL_INTERVAL=30
LOG_LEVEL=INFO
LOG_JSON=false
```

---

## Validating Configuration

### Check database connection

```bash
# Build shared packages and ensure types are sound
pnpm build
pnpm check-types
```

### Check Steam API

```bash
# Run a quick worker smoke test
BATCH_SIZE=10 pnpm --filter @publisheriq/ingestion storefront-sync
```

### Check LLM connection

Start the dashboard and try a chat query:

```bash
pnpm --filter @publisheriq/admin dev
# Visit http://localhost:3001 and use the chat interface
```

## Next Steps

1. [First Run](first-run.md) - Run your first data sync
