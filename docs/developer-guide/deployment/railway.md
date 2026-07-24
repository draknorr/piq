# Deploying PICS Service to Railway

This guide covers deploying the Python PICS service to Railway for real-time Steam data monitoring. It is separate from the TigerData/query-api data plane and does not deploy the admin dashboard or chat services.

Current state: the genuine legacy PICS service is stopped and disconnected
after the July 24 cursor-loss incident. A second Railway service with the same
`publisheriq` name was an accidental Query API duplicate; it is also stopped
and source-disconnected. See the
[verified topology](../../reference/daily-opportunity-prep-baseline/2026-07-24/railway-pics-service-topology.md).

Do not reconnect, redeploy, or restart either service from this guide. The
durable Tiger schema must be applied in a separately approved database window,
shadow intake must pass its gates, and the exact genuine PICS service ID must be
selected before any runtime action.

## Prerequisites

- GitHub repository with PublisherIQ code
- Railway account ([railway.app](https://railway.app))
- Supabase is needed only if an explicitly retained legacy target still uses it;
  durable PICS intake does not use Supabase
- Tiger bootstrap SQL `0088_durable_pics_intake.sql` applied before starting
  shadow or durable intake
- Cloudflare R2 or another S3-compatible bucket when `PICS_CHANGE_HISTORY_TARGET=tiger`

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

| Variable                                 | Value                                 | Description                                                         |
| ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `MODE`                                   | `change_monitor`                      | Operating mode                                                      |
| `PICS_WORK_MODE`                         | `shadow`                              | Required and fail-closed: `legacy`, `shadow`, or `durable`          |
| `LOG_JSON`                               | `true`                                | JSON logging for Railway                                            |
| `SUPABASE_URL`                           | `https://xxx.supabase.co`             | Required only when either PICS target is `supabase`                 |
| `SUPABASE_SERVICE_KEY`                   | `eyJ...`                              | Required only when either PICS target is `supabase`                 |
| `TIGER_PRIMARY_URL`                      | `postgresql://...`                    | Tiger target URL used by PICS Tiger stores                          |
| `PICS_CHANGE_HISTORY_TARGET`             | `tiger` or `supabase`                 | Controls PICS `app_source_snapshots` and `app_change_events` writes |
| `PICS_LATEST_STATE_TARGET`               | `tiger` or `supabase`                 | Controls PICS app, relationship, sync-status, and cursor writes     |
| `PICS_INTAKE_TIGER_URL`                  | `postgresql://...`                    | Optional durable-intake override; otherwise `TIGER_PRIMARY_URL`     |
| `PICS_INTAKE_STREAM_KEY`                 | unique replay key                     | Non-primary stream key required for shadow intake                   |
| `PICS_INTAKE_LANE`                       | `catchup` or `live`                   | Scheduling lane for the upstream batch                              |
| `PICS_SHADOW_START_CHANGE_NUMBER`        | approved frozen cursor                | Required for the first batch in a new shadow stream                 |
| `CHANGE_INTEL_ARCHIVE_TARGET`            | `object_storage`                      | Required when PICS history target is Tiger                          |
| `CHANGE_INTEL_ARCHIVE_BUCKET`            | `publisheriq-change-intel-archive`    | R2/S3 archive bucket                                                |
| `CHANGE_INTEL_ARCHIVE_PREFIX`            | `production/change-intel`             | R2/S3 key prefix                                                    |
| `CHANGE_INTEL_ARCHIVE_ENDPOINT`          | `https://...r2.cloudflarestorage.com` | R2/S3 endpoint                                                      |
| `CHANGE_INTEL_ARCHIVE_REGION`            | `auto`                                | R2 region                                                           |
| `CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID`     | `...`                                 | R2/S3 access key                                                    |
| `CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY` | `...`                                 | R2/S3 secret key                                                    |
| `CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE`  | `true`                                | R2 path-style setting                                               |

### 4. Deploy

Production deployment is intentionally disabled while the durable intake and
processing path is incomplete. Variables alone are not approval to reconnect a
source or deploy. Use the exact genuine PICS service from the verified topology
and a separately approved rollout procedure.

## Operating Modes

### Initial Bulk Sync

Run once to populate PICS data:

1. Set `MODE=bulk_sync`
2. Deploy and wait for completion (~3 minutes)
3. Check logs for "Bulk sync complete"
4. Change `MODE=change_monitor`
5. Redeploy

### First-Pass Sync

Run a bounded first-pass pass when newly discovered apps need PICS enrichment before a full bulk pass:

1. Set `MODE=first_pass`
2. Keep `FIRST_PASS_BATCH_LIMIT` small for smoke runs, for example `50`
3. Deploy and wait for completion
4. Check logs for selected app IDs, history write status, latest-state write status, and completion
5. Change `MODE=change_monitor`
6. Redeploy

First-pass prioritizes recent releases and near-release apps. It is useful for coverage repair, but it is still a write path and must use the intended `PICS_*_TARGET` settings.

### Change Monitor (Production)

`MODE=change_monitor` requires an explicit `PICS_WORK_MODE`:

- `legacy` is compatibility-only. It advances its cursor before in-memory work
  is durable and must not be production primary.
- `shadow` stores ordered upstream batch rows and isolated shadow work without
  advancing the canonical cursor.
- `durable` stores the batch, every source position, coalesced work, and
  readiness before advancing the canonical cursor in the same Tiger
  transaction.

The current durable implementation is intake-only. Do not enable `durable` in
production until leased consumers and completeness-aware promotion are merged,
verified, and separately approved.

## Configuration Options

| Variable                                 | Default             | Description                                                               |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `MODE`                                   | `change_monitor`    | `bulk_sync`, `first_pass`, `change_monitor`, or `backfill_change_history` |
| `PORT`                                   | Auto                | Health check port (Railway sets this)                                     |
| `PICS_CHANGE_HISTORY_TARGET`             | `tiger`             | `tiger` or legacy `supabase`; controls PICS change-history rows           |
| `PICS_CHANGE_HISTORY_TIGER_URL`          | `TIGER_PRIMARY_URL` | Optional override for history writes                                      |
| `PICS_LATEST_STATE_TARGET`               | `tiger`             | `tiger` or legacy `supabase`; controls PICS latest-state/cursor writes    |
| `PICS_LATEST_STATE_TIGER_URL`            | `TIGER_PRIMARY_URL` | Optional override for latest-state writes                                 |
| `PICS_WORK_MODE`                         | required            | `legacy`, `shadow`, or `durable`; missing/unknown values fail closed      |
| `PICS_INTAKE_TIGER_URL`                  | `TIGER_PRIMARY_URL` | Optional Tiger URL for durable intake                                     |
| `PICS_INTAKE_STREAM_KEY`                 | `shadow-default`    | Non-primary restart cursor namespace for shadow                           |
| `PICS_INTAKE_LANE`                       | `live`              | `live` or `catchup`                                                       |
| `PICS_SHADOW_START_CHANGE_NUMBER`        | unset               | Required for a new shadow stream                                          |
| `PICS_INTAKE_STATEMENT_TIMEOUT_SECONDS`  | `60`                | Maximum duration for one intake transaction                               |
| `PICS_INTAKE_LOCK_TIMEOUT_SECONDS`       | `10`                | Maximum wait for the stream/cursor lock                                   |
| `CHANGE_INTEL_ARCHIVE_TARGET`            | `disabled`          | Must be `object_storage` for Tiger history writes                         |
| `CHANGE_INTEL_ARCHIVE_BUCKET`            | required for Tiger  | S3-compatible bucket for normalized snapshot archives                     |
| `CHANGE_INTEL_ARCHIVE_PREFIX`            | `change-intel`      | Object prefix such as `production/change-intel`                           |
| `CHANGE_INTEL_ARCHIVE_ENDPOINT`          | optional            | S3-compatible endpoint                                                    |
| `CHANGE_INTEL_ARCHIVE_REGION`            | `us-east-1`         | R2 usually uses `auto`                                                    |
| `CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID`     | optional            | S3-compatible access key                                                  |
| `CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY` | optional            | S3-compatible secret key                                                  |
| `BULK_BATCH_SIZE`                        | `200`               | Apps per PICS request                                                     |
| `BULK_REQUEST_DELAY`                     | `0.5`               | Seconds between batches                                                   |
| `FIRST_PASS_BATCH_LIMIT`                 | `500`               | Max apps processed by `MODE=first_pass`                                   |
| `FIRST_PASS_CANDIDATE_POOL_SIZE`         | `1000`              | Candidate pool size for first-pass ranking                                |
| `FIRST_PASS_RECENT_RELEASE_DAYS`         | `30`                | Recent-release priority window                                            |
| `FIRST_PASS_NEAR_RELEASE_DAYS`           | `14`                | Upcoming/near-release priority window                                     |
| `POLL_INTERVAL`                          | `30`                | Seconds between polls                                                     |
| `PROCESS_BATCH_SIZE`                     | `100`               | Queue batch size                                                          |
| `MAX_QUEUE_SIZE`                         | `10000`             | Maximum queue size                                                        |
| `LOG_LEVEL`                              | `INFO`              | `DEBUG`, `INFO`, `WARNING`, `ERROR`                                       |
| `LOG_JSON`                               | `true`              | JSON format for production                                                |

## Health Checks

The service exposes health endpoints:

| Endpoint      | Response | Purpose              |
| ------------- | -------- | -------------------- |
| `GET /`       | `200 OK` | Railway health check |
| `GET /health` | `200 OK` | Basic health         |
| `GET /status` | JSON     | Detailed status      |

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

| Message               | Meaning                     |
| --------------------- | --------------------------- |
| `Connected to Steam`  | PICS connection established |
| `Polling for changes` | Normal operation            |
| `Processing N apps`   | Changes being processed     |
| `Bulk sync complete`  | Initial sync finished       |

## Troubleshooting

### Service keeps restarting

1. Check logs for errors
2. Stop the service; repeated restarts are not a recovery procedure
3. Verify the exact Railway project/service ID against the topology document
4. Verify `PICS_WORK_MODE` is explicit and `0088` exists in Tiger
5. Verify Tiger/R2 credentials; check Supabase only for an explicit legacy target

### "Connection refused" errors

Steam PICS connections can be rate-limited:

- Service implements automatic reconnection
- Check logs for reconnection attempts
- May need to wait a few minutes

### Missing data

1. Verify `MODE=bulk_sync` was run initially
2. Check `pics_sync_state` table for last change number
3. Review logs for processing errors
4. For newly discovered apps, run a bounded `MODE=first_pass` smoke before a full bulk repair
5. If `PICS_CHANGE_HISTORY_TARGET=tiger`, verify R2 archive writes as well as Tiger summary rows

### Database errors

1. Verify migration `20251230000000_add_pics_data.sql` was applied
2. For Supabase targets, check Supabase URL/key and write permissions
3. For Tiger targets, check `TIGER_PRIMARY_URL`, target bootstrap state, and `PICS_*_TARGET` values
4. For history writes to Tiger, check `CHANGE_INTEL_ARCHIVE_TARGET=object_storage` and R2 credentials

### Tiger/R2 target caveats

- `PICS_CHANGE_HISTORY_TARGET=tiger` requires object storage because full normalized snapshots are archived outside Postgres.
- `PICS_LATEST_STATE_TARGET=tiger` should only be enabled after the target has the PICS latest-state tables/functions expected by the service.
- History-write cooldowns do not stop latest-state writes. A green latest-state log line does not prove R2 archival is healthy.
- PICS data remains enrichment/fallback data. Storefront remains authoritative for parsed release dates and `is_free`.

## Scaling

### Resource Allocation

Default Railway allocation is sufficient. For faster processing:

- Increase memory allocation in Railway settings
- Adjust `PROCESS_BATCH_SIZE` for larger batches

### Multiple Instances

Run one PICS intake leader. Future durable consumers may scale independently;
their claims use Tiger leases and `SKIP LOCKED`. Do not scale the intake leader
itself.

## Cost Optimization

Railway charges based on usage. To minimize costs:

- Use default resource allocation
- use one intake leader and no separate managed queue service
- use binary `COPY` plus one Tiger transaction per upstream response
- keep historical catch-up bounded and separate from live consumer capacity

## Deployment Workflow

### Automatic Deploys

Automatic deploys are disabled for the stopped legacy PICS service. Do not
reconnect GitHub until the approved durable cutover.

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
