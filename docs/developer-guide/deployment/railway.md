# Deploying PICS Service to Railway

This guide covers deploying the Python PICS service to Railway for real-time Steam data monitoring. It is separate from the TigerData/query-api data plane and does not deploy the admin dashboard or chat services.

## Prerequisites

- GitHub repository with PublisherIQ code
- Railway account ([railway.app](https://railway.app))
- Supabase project with PICS tables migrated

## Quick Start

### 1. Create Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **Deploy from GitHub repo**
3. Select your repository

### 2. Configure Service

Set the following service settings:

**Root Directory:**
```
services/pics-service
```

**Start Command:**
```bash
python -m src.main
```

Railway auto-detects Python and uses Poetry for dependencies.

### 3. Set Environment Variables

Click **Variables** and add:

| Variable | Value | Description |
|----------|-------|-------------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Service role key |
| `MODE` | `change_monitor` | Operating mode |
| `LOG_JSON` | `true` | JSON logging for Railway |

### 4. Deploy

Railway automatically deploys when variables are set.

## Operating Modes

### Initial Bulk Sync

Run once to populate PICS data:

1. Set `MODE=bulk_sync`
2. Deploy and wait for completion (~3 minutes)
3. Check logs for "Bulk sync complete"
4. Change `MODE=change_monitor`
5. Redeploy

### Change Monitor (Production)

Continuous monitoring:
- Polls Steam for changes every 30 seconds
- Queues and processes changed apps
- Runs indefinitely

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `change_monitor` | `bulk_sync` or `change_monitor` |
| `PORT` | Auto | Health check port (Railway sets this) |
| `BULK_BATCH_SIZE` | `200` | Apps per PICS request |
| `BULK_REQUEST_DELAY` | `0.5` | Seconds between batches |
| `POLL_INTERVAL` | `30` | Seconds between polls |
| `PROCESS_BATCH_SIZE` | `100` | Queue batch size |
| `MAX_QUEUE_SIZE` | `10000` | Maximum queue size |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `LOG_JSON` | `true` | JSON format for production |

## Health Checks

The service exposes health endpoints:

| Endpoint | Response | Purpose |
|----------|----------|---------|
| `GET /` | `200 OK` | Railway health check |
| `GET /health` | `200 OK` | Basic health |
| `GET /status` | JSON | Detailed status |

Railway uses these to:
- Detect service health
- Trigger restarts on failures
- Show status in dashboard

## Monitoring

### View Logs

1. Click on the service in Railway dashboard
2. Go to **Logs** tab
3. View real-time output

### Log Format

With `LOG_JSON=true`, logs are structured:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "INFO",
  "message": "Processed 100 apps",
  "apps_processed": 100
}
```

### Key Log Messages

| Message | Meaning |
|---------|---------|
| `Connected to Steam` | PICS connection established |
| `Polling for changes` | Normal operation |
| `Processing N apps` | Changes being processed |
| `Bulk sync complete` | Initial sync finished |

## Troubleshooting

### Service keeps restarting

1. Check logs for errors
2. Verify Supabase credentials are correct
3. Ensure PICS tables exist in database

### "Connection refused" errors

Steam PICS connections can be rate-limited:
- Service implements automatic reconnection
- Check logs for reconnection attempts
- May need to wait a few minutes

### Missing data

1. Verify `MODE=bulk_sync` was run initially
2. Check `pics_sync_state` table for last change number
3. Review logs for processing errors

### Database errors

1. Verify migration `20251230000000_add_pics_data.sql` was applied
2. Check Supabase connection string
3. Verify service key has write permissions

## Scaling

### Resource Allocation

Default Railway allocation is sufficient. For faster processing:
- Increase memory allocation in Railway settings
- Adjust `PROCESS_BATCH_SIZE` for larger batches

### Multiple Instances

**Not recommended.** The PICS service maintains state:
- Change number tracking
- Connection management
- Queue processing

Run a single instance to avoid duplicate processing.

## Cost Optimization

Railway charges based on usage. To minimize costs:
- Use default resource allocation
- `change_monitor` mode is efficient (low CPU when idle)
- Consider pausing during low-activity periods

## Deployment Workflow

### Automatic Deploys

Railway deploys automatically on push to main branch.

### Manual Deploys

1. Go to Railway dashboard
2. Click service
3. Click **Deploy** button

### Rollback

1. Go to **Deployments** tab
2. Find previous deployment
3. Click **Redeploy**

## Related Documentation

- [PICS Data Fields](../../reference/pics-data-fields.md) - Extracted data reference
- [Environment Setup](../setup.md) - All variables
- [Supabase Deployment](supabase.md) - Database setup
