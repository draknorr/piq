# Deploying to Vercel

This guide covers deploying the PublisherIQ admin dashboard to Vercel.

## Prerequisites

- GitHub repository with PublisherIQ code
- Vercel account ([vercel.com](https://vercel.com))
- Supabase project set up
- LLM API key (Anthropic or OpenAI)

## Quick Start

### 1. Connect Repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Select the repository containing PublisherIQ

### 2. Configure Project

Set the following in the Vercel project settings:

**Root Directory:**
```
apps/admin
```

**Build Command:**
```bash
cd ../.. && pnpm build && cd apps/admin && pnpm build
```

**Output Directory:**
```
.next
```

**Install Command:**
```bash
cd ../.. && pnpm install
```

### 3. Set Environment Variables

Navigate to **Settings > Environment Variables** and add:

**Required:**

| Variable | Value | Environment |
|----------|-------|-------------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | All |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | All |
| `CUBE_API_URL` | `https://publisheriq-cube.fly.dev/cubejs-api/v1` | All |
| `CUBE_API_SECRET` | Your Cube.js JWT secret | All |
| `QUERY_API_BASE_URL` | `https://publisheriq-production.up.railway.app` | All |
| `QUERY_API_BEARER_TOKEN` | Shared bearer token for query-api | All |
| `CHAT_TIGER_PRIMARY_MODE` | `all` | All |
| `CHAT_TIGER_SHADOW_MODE` | `off` | All |

**LLM Provider (choose one):**

| Variable | Value | Environment |
|----------|-------|-------------|
| `LLM_PROVIDER` | `anthropic` | All |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | All |

Or if using OpenAI:

| Variable | Value | Environment |
|----------|-------|-------------|
| `LLM_PROVIDER` | `openai` | All |
| `OPENAI_API_KEY` | `sk-...` | All |

**Optional diagnostics:**

| Variable | Value | Environment |
|----------|-------|-------------|
| `NEXT_PUBLIC_CHAT_TIGER_DEBUG` | `true` | Preview / Development only |

For a split preview/production TigerData rollout, do not reuse the same query-api
base URL and bearer token across environments. Use the dedicated Railway/TigerData
pairing described in [Tiger Chat Production](./tiger-chat-production.md).

### 4. Deploy

Click **Deploy** and wait for the build to complete.

## Configuration Details

### Framework Preset

Vercel auto-detects Next.js. Ensure the preset is set to **Next.js**.

### Node.js Version

Set Node.js version to **20.x**:
1. Go to **Settings > General**
2. Under "Node.js Version", select **20.x**

### Build Settings

For monorepo support, Vercel needs to build from the root:

```json
{
  "buildCommand": "cd ../.. && pnpm build && cd apps/admin && pnpm build",
  "installCommand": "cd ../.. && pnpm install",
  "framework": "nextjs"
}
```

## Custom Domain

1. Go to **Settings > Domains**
2. Add your custom domain
3. Configure DNS as instructed
4. Wait for SSL certificate provisioning

## Environment-Specific Settings

### Production

- Use production Supabase project
- Use production LLM API keys
- Enable caching

### Preview

Preview deployments use the same environment variables by default. For different staging settings:

1. Create variables with **Preview** environment only
2. Use a separate Supabase project for staging
3. Point `QUERY_API_BASE_URL` and `QUERY_API_BEARER_TOKEN` at the preview Railway service, not production

If `QUERY_API_BASE_URL` is not set in a deployed Vercel preview or production
environment, the admin app now treats that as a configuration error instead of
silently falling back to `127.0.0.1`.

## Troubleshooting

### Build fails with "module not found"

The monorepo packages must be built first:

```bash
# Ensure buildCommand includes root build
cd ../.. && pnpm build && cd apps/admin && pnpm build
```

### Type errors during build

Regenerate database types:

```bash
pnpm --filter database generate
```

### Environment variables not working

1. Verify variables are set for the correct environment (Production/Preview/Development)
2. Redeploy after adding new variables
3. Check for typos in variable names

### Chat interface not responding

1. Verify `LLM_PROVIDER` is set
2. Check the corresponding API key is valid
3. View function logs in Vercel dashboard

## Monitoring

### Function Logs

View real-time logs:
1. Go to **Logs** tab
2. Filter by "Functions"
3. Select time range

### Analytics

Enable Vercel Analytics for:
- Page views
- Web Vitals
- Real User Monitoring

## Related Documentation

- [Environment Setup](../setup.md) - All environment variables
- [Tiger Chat Production](./tiger-chat-production.md) - Preview/prod Tiger + Railway rollout
- [Supabase Deployment](supabase.md) - Database setup
- [GitHub Actions](github-actions.md) - Sync job configuration
