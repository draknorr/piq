# Deploying Cube.js to Fly.io

This guide covers deploying the Cube.js semantic layer to Fly.io for the PublisherIQ analytics system.

## Prerequisites

- GitHub repository with PublisherIQ code
- Fly.io account ([fly.io](https://fly.io))
- Supabase project with database credentials
- Fly CLI installed (`brew install flyctl` or `curl -L https://fly.io/install.sh | sh`)

## Quick Start

### 1. Authenticate with Fly.io

```bash
fly auth login
```

### 2. Create the App

Navigate to the Cube.js package and create the app:

```bash
cd packages/cube
fly launch --name publisheriq-cube --no-deploy
```

Choose:
- Region closest to your users/database
- Don't set up PostgreSQL (we use Supabase)
- Don't set up Redis (optional for caching)

### 3. Set Environment Variables

Configure the database connection:

```bash
# Database connection (Supabase)
fly secrets set CUBEJS_DB_TYPE=postgres
fly secrets set CUBEJS_DB_HOST=db.your-project.supabase.co
fly secrets set CUBEJS_DB_PORT=5432
fly secrets set CUBEJS_DB_NAME=postgres
fly secrets set CUBEJS_DB_USER=postgres
fly secrets set CUBEJS_DB_PASS=your-database-password

# API Security
fly secrets set CUBEJS_API_SECRET=your-long-random-secret-key

# Optional: Enable development mode features
fly secrets set CUBEJS_DEV_MODE=false
```

**Using Supabase Pooler (Recommended for production):**

```bash
fly secrets set CUBEJS_DB_HOST=aws-0-us-west-1.pooler.supabase.com
fly secrets set CUBEJS_DB_PORT=6543
fly secrets set CUBEJS_DB_USER=postgres.your-project-ref
```

### 4. Configure fly.toml

Create or update `packages/cube/fly.toml`:

```toml
app = "publisheriq-cube"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

**Key Settings:**
- `min_machines_running = 1` - Prevents cold starts
- `auto_stop_machines = false` - Keeps machine warm for faster queries

### 5. Create Dockerfile

Create `packages/cube/Dockerfile`:

```dockerfile
FROM cubejs/cube:latest

COPY model /cube/model

ENV CUBEJS_DB_TYPE=postgres
ENV PORT=4000

EXPOSE 4000
```

### 6. Deploy

```bash
scripts/ops/deploy-cube.sh
```

This wrapper pins a known-good `flyctl` version for the Cube service and avoids relying on whichever global CLI version is currently installed.

Environment options:

```bash
# Use local Docker instead of Fly remote builders
CUBE_DEPLOY_MODE=local scripts/ops/deploy-cube.sh

# Pass through extra fly deploy flags
scripts/ops/deploy-cube.sh --build-only
```

## Cube.js Models

The semantic layer models are located in `packages/cube/model/`:

| File | Cube | Purpose |
|------|------|---------|
| `Discovery.js` | Discovery | Game discovery with metrics |
| `Publishers.js` | PublisherMetrics, PublisherYearMetrics, PublisherGameMetrics | Publisher analytics |
| `Developers.js` | DeveloperMetrics, DeveloperYearMetrics, DeveloperGameMetrics | Developer analytics |
| `DailyMetrics.js` | DailyMetrics, LatestMetrics | Time-series data |
| `MonthlyMetrics.js` | MonthlyGameMetrics, MonthlyPublisherMetrics | Monthly aggregations |

## Configuration

### cube.js

The main configuration file `packages/cube/cube.js`:

```javascript
module.exports = {
  dbType: 'postgres',
  apiSecret: process.env.CUBEJS_API_SECRET,

  // Performance settings
  preAggregationsSchema: 'pre_aggregations',
  scheduledRefreshTimer: 60,

  // CORS for dashboard access
  http: {
    cors: {
      origin: ['https://your-dashboard.vercel.app', 'http://localhost:3001']
    }
  }
};
```

### Pre-aggregations

For improved query performance, enable pre-aggregations:

```javascript
// In model files
preAggregations: {
  main: {
    measures: [this.count, this.avgScore],
    dimensions: [this.publisherName],
    refreshKey: {
      every: '1 hour'
    }
  }
}
```

## Monitoring

### View Logs

```bash
fly logs --app publisheriq-cube
```

### Check Status

```bash
fly status --app publisheriq-cube
```

### SSH Access

```bash
fly ssh console --app publisheriq-cube
```

### Machine Management

```bash
# List machines
fly machines list --app publisheriq-cube

# Restart a machine
fly machines restart <machine-id> --app publisheriq-cube
```

## Troubleshooting

### Remote builder fails before deploy completes

If `fly deploy` fails before a new release is created and logs show errors like:

- `Failed to start remote builder heartbeat ... invalid port ... extendDeadline`
- `unable to upgrade to h2c, received 500`

check whether the failure is in the remote builder path rather than the Cube app itself.

Recommended checks:

```bash
scripts/ops/check-fly-cube.sh
```

If the live app is healthy but remote builds fail, use the pinned wrapper:

```bash
scripts/ops/deploy-cube.sh
```

or switch it to local Docker mode:

```bash
CUBE_DEPLOY_MODE=local scripts/ops/deploy-cube.sh
```

### 502 Gateway Errors

**Cause:** Machine cold start or timeout

**Solutions:**
1. Set `min_machines_running = 1` in fly.toml
2. Dashboard has retry logic (3 retries, exponential backoff)
3. Increase machine memory if queries are complex

### "Database connection failed"

**Solutions:**
1. Verify Supabase credentials
2. Check if Supabase project is not paused
3. Use pooler connection for production
4. Verify network access (Supabase > Settings > Database > Network)

### Slow Queries

**Solutions:**
1. Enable pre-aggregations for common queries
2. Add database indexes for filtered columns
3. Increase machine resources:
   ```toml
   [[vm]]
     cpu_kind = "shared"
     cpus = 2
     memory_mb = 1024
   ```

### Schema Changes Not Reflected

After modifying model files:

```bash
# Redeploy with new models
fly deploy

# Or restart the machine
fly apps restart publisheriq-cube
```

## Scaling

### Horizontal Scaling

Add more machines:

```bash
fly scale count 2 --app publisheriq-cube
```

### Vertical Scaling

Increase resources in fly.toml:

```toml
[[vm]]
  cpu_kind = "performance"
  cpus = 2
  memory_mb = 2048
```

Then redeploy:

```bash
fly deploy
```

## Cost Optimization

Fly.io charges based on machine time and resources.

### Cost-Saving Tips

1. **Use shared CPUs** for development
2. **Enable auto-stop** if low traffic (trades latency for cost)
3. **Right-size memory** based on actual usage
4. **Monitor usage** via Fly.io dashboard

### Estimated Monthly Cost

| Configuration | Approx. Cost |
|---------------|--------------|
| 1x shared-1x-256mb (always on) | ~$3/month |
| 1x shared-1x-512mb (always on) | ~$5/month |
| 1x shared-2x-1gb (always on) | ~$10/month |

## Integration with Dashboard

The admin dashboard connects to Cube.js via JWT authentication:

```typescript
// apps/admin/src/lib/cube-executor.ts
function generateToken(): string {
  return jwt.sign(
    { iss: 'publisheriq-admin', iat: now, exp: now + 3600 },
    process.env.CUBE_API_SECRET,
    { algorithm: 'HS256' }
  );
}
```

Ensure `CUBE_API_SECRET` matches in both Fly.io and Vercel environments.

## Related Documentation

- [Environment Setup](../setup.md) - All environment variables
- [Chat Data System](../architecture/chat-data-system.md) - Cube.js schema documentation
- [Supabase Deployment](supabase.md) - Database setup
- [Vercel Deployment](vercel.md) - Dashboard deployment
