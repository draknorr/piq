# Supabase Setup

This guide covers setting up the Supabase side of PublisherIQ.

## Prerequisites

- Supabase account ([supabase.com](https://supabase.com))
- SQL knowledge (for migrations)

## Quick Start

### 1. Create Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New project**
3. Choose organization
4. Set project name (e.g., "publisheriq")
5. Generate a strong database password
6. Select region (closest to your users)
7. Click **Create new project**

Wait for provisioning (~2 minutes).

### 2. Get Credentials

Go to **Settings > API**:

| Credential | Location | Use |
|------------|----------|-----|
| Project URL | "Project URL" | `SUPABASE_URL` |
| Service Role Key | "service_role" under "Project API keys" | `SUPABASE_SERVICE_KEY` |
| Anon Key | "anon" under "Project API keys" | Client-side (optional) |

**Security Note:** The service role key bypasses Row Level Security. Never expose it in client-side code.

### 3. Apply Migrations

Migrations are in `supabase/migrations/`. Apply them in order:

1. Go to **SQL Editor**
2. Click **New query**
3. Paste the first migration file contents
4. Click **Run**
5. Repeat for each migration file

Or use Supabase CLI:

```bash
# Install CLI
npm install -g supabase

# Login
supabase login

# Link to project
supabase link --project-ref your-project-ref

# Apply migrations
supabase db push
```

## Migration Files

Apply in chronological order (by filename):

```
supabase/migrations/
├── 20240101000000_initial_schema.sql      # Core tables
├── 20240102000000_add_indexes.sql         # Performance indexes
├── 20240103000000_add_sync_tracking.sql   # Sync status tables
├── 20240104000000_add_trends.sql          # Trend calculations
├── 20251230000000_add_pics_data.sql       # PICS service tables
└── ...
```

## Database Schema Overview

### Core Tables

| Table | Purpose |
|-------|---------|
| `apps` | Steam apps (games, DLC, demos) |
| `publishers` | Publisher entities |
| `developers` | Developer entities |
| `app_publishers` | App-publisher relationships |
| `app_developers` | App-developer relationships |

### Metrics Tables

| Table | Purpose |
|-------|---------|
| `daily_metrics` | Daily snapshots (CCU, reviews, owners) |
| `review_histogram` | Monthly review buckets |
| `app_trends` | Computed trend data |
| `app_tags` | User-voted tags |

### Sync Tables

| Table | Purpose |
|-------|---------|
| `sync_status` | Per-app sync tracking |
| `sync_jobs` | Job execution history |

### PICS Tables

| Table | Purpose |
|-------|---------|
| `steam_tags` | Tag reference |
| `steam_genres` | Genre reference |
| `steam_categories` | Category reference |
| `franchises` | Franchise names |
| `app_steam_tags` | App-tag relationships |
| `app_genres` | App-genre relationships |
| `app_categories` | App-category relationships |
| `app_franchises` | App-franchise relationships |
| `app_steam_deck` | Steam Deck compatibility |

See [Database Schema](../architecture/database-schema.md) for full details.

## Scope

Supabase remains responsible for:

- write authority for the live product database
- auth and session state
- operational/control-plane tables
- page and admin reads that still execute directly against Supabase RPCs and materialized views

TigerData owns the contract-serving query plane documented in [Tiger Chat Production](./tiger-chat-production.md) and [Query API](../../../apps/query-api/README.md).

## RPC Functions

The chat interface uses a secure RPC function:

```sql
-- Execute read-only queries safely
CREATE FUNCTION execute_readonly_query(query_text TEXT)
RETURNS JSONB AS $$
BEGIN
  -- Validate query is SELECT
  -- Execute and return results
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

This function:
- Validates queries start with SELECT
- Blocks dangerous keywords
- Returns results as JSONB

## Performance Configuration

### Indexes

Key indexes for common queries:

```sql
-- App lookups
CREATE INDEX idx_apps_name ON apps(name);
CREATE INDEX idx_apps_type ON apps(type) WHERE type = 'game';

-- Metrics queries
CREATE INDEX idx_daily_metrics_appid_date ON daily_metrics(appid, metric_date DESC);

-- Sync scheduling
CREATE INDEX idx_sync_status_priority ON sync_status(priority_score DESC);
```

### Connection Pooling

For high-traffic scenarios:
1. Go to **Settings > Database**
2. Enable connection pooling
3. Use the pooling connection string

## Backup & Recovery

### Automatic Backups

Supabase provides automatic daily backups (Pro plan and above).

### Manual Backup

```sql
-- Export specific tables
pg_dump --table=apps --table=publishers ...
```

### Point-in-Time Recovery

Available on Pro plan:
1. Go to **Database > Backups**
2. Click **Restore**
3. Select date/time

## Monitoring

### Database Health

Go to **Database > Health** to view:
- Active connections
- Query performance
- Storage usage

### Query Performance

Use the SQL Editor to analyze slow queries:

```sql
EXPLAIN ANALYZE
SELECT * FROM apps WHERE name ILIKE '%stardew%';
```

### Storage Usage

Check storage in **Settings > Database**:
- Database size
- Table sizes
- Index sizes

## Troubleshooting

### "Connection refused"

1. Verify project is not paused
2. Check project URL format: `https://xxx.supabase.co`
3. Ensure service key is complete

### "Permission denied"

1. Use service role key (not anon key)
2. Check RLS policies if using anon key

### "Migration failed"

1. Check for syntax errors
2. Verify prerequisites are met
3. Run migrations in order

### "Query timeout"

1. Add missing indexes
2. Optimize query
3. Increase statement timeout:

```sql
SET statement_timeout = '60s';
```

## Scaling

### When to Upgrade

Consider upgrading from Free tier when:
- Database size > 500MB
- Concurrent connections > 50
- Need automatic backups
- Require more API requests

### Plan Comparison

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Database size | 500MB | 8GB | Unlimited |
| API requests | 50K/month | 2M/month | Unlimited |
| Backups | Manual | Daily | Continuous |
| Support | Community | Email | Dedicated |

## Security Best Practices

1. **Use service role key server-side only**
2. **Enable RLS for client-side access**
3. **Rotate keys periodically**
4. **Monitor access logs**
5. **Use connection pooling for production**

## Related Documentation

- [Database Schema](../architecture/database-schema.md) - Full schema reference
- [Environment Setup](../setup.md) - Credentials configuration
- [Troubleshooting](../../admin-guide/troubleshooting.md) - Common issues
