# PICS Service

Python microservice for Steam PICS ingestion and PICS-side change intelligence.

## Overview

The PICS service connects directly to Steam's Product Info Cache Server and now serves two jobs:

- bulk, first-pass, and ongoing PICS metadata ingestion
- normalized PICS history capture for change intelligence

During change monitoring, the service writes normalized snapshots and PICS diff events before the latest-state upserts that keep the `apps` table and relationship tables current.
`PICS_CHANGE_HISTORY_TARGET=tiger` moves only that normalized history capture to Tiger/R2; latest-state PICS metadata writes remain on Supabase until a later migration.

## Modes

### `MODE=bulk_sync`

- one-time backfill of PICS metadata for apps already in the warehouse
- exits when complete
- useful for initial population or large repair runs

### `MODE=first_pass`

- prioritized bounded backfill for newly discovered unsynced apps
- focuses on recent releases and near-release apps first
- useful when you want the highest-value missing PICS rows filled before a full bulk pass

### `MODE=change_monitor`

- long-running polling of Steam PICS change numbers
- fetches changed app payloads
- writes normalized history snapshots and diff events
- then performs latest-state upserts for apps and relationships

## Runtime Behavior

- history capture retries bounded transient and schema-cache failures before giving up
- unchanged normalized snapshots update `last_seen_at` instead of producing duplicate history rows
- structured PICS diff events are only written when the normalized snapshot hash changes
- repeated history failures trigger a short cooldown for history capture rather than blocking the whole batch
- latest-state upserts continue even when historical writes are temporarily cooled down

## Source-of-Truth Rules

- Storefront remains authoritative for parsed `release_date` and `is_free`
- PICS fields are enrichment and fallback data
- use raw text fields when the Storefront date is not parseable instead of forcing invalid typed dates

## Local Development

```bash
poetry install
cp .env.example .env
MODE=bulk_sync python -m src.main
MODE=first_pass python -m src.main
MODE=change_monitor python -m src.main
```

## Key Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | required | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | required | Supabase service role key |
| `PICS_CHANGE_HISTORY_TARGET` | `supabase` | `supabase` or `tiger`; controls only PICS `app_source_snapshots` and `app_change_events` writes |
| `PICS_CHANGE_HISTORY_TIGER_URL` | `TIGER_PRIMARY_URL` | Tiger Postgres URL for PICS change-history writes |
| `CHANGE_INTEL_ARCHIVE_TARGET` | `disabled` | Must be `object_storage` when `PICS_CHANGE_HISTORY_TARGET=tiger` |
| `CHANGE_INTEL_ARCHIVE_BUCKET` | required for Tiger | S3-compatible bucket for archived normalized PICS snapshots |
| `CHANGE_INTEL_ARCHIVE_PREFIX` | `change-intel` | Object key prefix, e.g. `production/change-intel` |
| `CHANGE_INTEL_ARCHIVE_ENDPOINT` | optional | S3-compatible endpoint, e.g. Cloudflare R2 account endpoint |
| `CHANGE_INTEL_ARCHIVE_REGION` | `us-east-1` | S3 region; R2 commonly uses `auto` |
| `CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID` | optional | S3-compatible access key |
| `CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY` | optional | S3-compatible secret key |
| `MODE` | `change_monitor` | `bulk_sync`, `first_pass`, `change_monitor`, or `backfill_change_history` |
| `PORT` | `8080` | Health-check port |
| `BULK_BATCH_SIZE` | `200` | Apps per PICS request |
| `BULK_REQUEST_DELAY` | `0.5` | Seconds between bulk requests |
| `BULK_TIMEOUT` | `60` | Timeout per bulk batch fetch |
| `BULK_MAX_RETRIES` | `5` | Retry attempts per bulk batch |
| `FIRST_PASS_BATCH_LIMIT` | `500` | Max apps processed in a first-pass run |
| `FIRST_PASS_CANDIDATE_POOL_SIZE` | `1000` | Unsynced candidate pool size for first-pass ranking |
| `FIRST_PASS_RECENT_RELEASE_DAYS` | `30` | Prefer recent releases within this window |
| `FIRST_PASS_NEAR_RELEASE_DAYS` | `14` | Prefer upcoming / near-release apps within this window |
| `POLL_INTERVAL` | `30` | Seconds between PICS change polls |
| `PROCESS_BATCH_SIZE` | `100` | Apps per queue processing batch |
| `MAX_QUEUE_SIZE` | `10000` | Maximum queued apps |
| `STEAM_HEARTBEAT_INTERVAL` | `300` | Heartbeat interval to keep the Steam connection alive |
| `STEAM_AUTO_RECONNECT` | `true` | Automatically reconnect after a disconnect |
| `LOG_LEVEL` | `INFO` | Logging level |
| `LOG_JSON` | `true` | JSON log formatting |

## PICS Change-History Backfill

After applying the Tiger write-surface SQL, run the one-time backfill in dry-run mode first:

```bash
MODE=backfill_change_history PICS_CHANGE_HISTORY_BACKFILL_DRY_RUN=true python -m src.main
```

Then run the write pass with Tiger/R2 env vars present:

```bash
MODE=backfill_change_history PICS_CHANGE_HISTORY_BACKFILL_DRY_RUN=false python -m src.main
```

Useful controls:

| Variable | Default | Description |
|----------|---------|-------------|
| `PICS_CHANGE_HISTORY_BACKFILL_BATCH_SIZE` | `500` | Rows per Supabase page |
| `PICS_CHANGE_HISTORY_BACKFILL_LIMIT` | unset | Optional per-surface max rows |
| `PICS_CHANGE_HISTORY_BACKFILL_MIN_ID` | `0` | Resume cursor by source row id |
| `PICS_CHANGE_HISTORY_BACKFILL_SURFACES` | `snapshots,events` | `snapshots`, `events`, or both |

## Health Endpoints

- `GET /`
- `GET /health`
- `GET /status`

`/health` stays `200` while the worker is starting or transiently degraded, and returns `503` when the worker marks itself unhealthy after repeated change-poll failures or a fatal process error.

## Tests

```bash
cd services/pics-service
pytest
```

Focused suites:

```bash
pytest tests/test_change_intelligence.py tests/test_operations_change_history.py tests/test_operations_relationship_sync.py
```

## Package Layout

```text
src/
├── config/                 # Settings
├── database/               # Supabase operations and change-intel helpers
├── extractors/             # PICS field extraction
├── health/                 # HTTP health server
├── steam/                  # Steam client + PICS operations
└── workers/                # bulk_sync and change_monitor
```

## Related Documentation

- [PICS Data Fields Reference](../../docs/reference/pics-data-fields.md)
- [Data Sources](../../docs/developer-guide/architecture/data-sources.md)
- [Steam Change Intelligence](../../docs/developer-guide/workers/steam-change-intelligence.md)
