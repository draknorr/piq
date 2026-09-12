# PICS Service

Python microservice for Steam PICS ingestion and PICS-side change intelligence.

## Overview

The PICS service connects directly to Steam's Product Info Cache Server and now serves two jobs:

- bulk, first-pass, and ongoing PICS metadata ingestion
- normalized PICS history capture for change intelligence

During change monitoring, the service writes normalized snapshots and PICS diff events before the latest-state upserts that keep the `apps` table and relationship tables current.
PICS product data is Tiger/R2-primary. The retained Supabase target values are
legacy compatibility only and are not used by durable intake.

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

- requires an explicit, fail-closed `PICS_WORK_MODE`
- `legacy` retains the old in-memory queue for local compatibility only and
  must not be restarted as the production primary
- `shadow` writes ordered source batches and isolated shadow work to Tiger
  without advancing `ops.pics_sync_state`
- `durable` writes the batch, every source list position, coalesced work, and
  PICS readiness in one Tiger transaction before advancing the primary cursor

Durable processing is independently gated by
`PICS_PROCESSING_ENABLED=false`. Do not enable `PICS_WORK_MODE=durable` or
primary processing in production until the durable intake and audited
checkpoint schemas are applied, forced-restart and parity gates pass, and the
exact checkpoint and genuine-service rollout are separately approved. Service
code that supports reconciliation must not be deployed before
`0092_pics_cursor_checkpoint_reconciliation.sql`, because settlement resolves
reconciliation work through the additive Tiger records.

## Runtime Behavior

- durable intake stages one complete upstream response with PostgreSQL binary
  `COPY`; source positions, duplicate app IDs, item change numbers, and token
  requirements remain auditable
- the exact upstream response manifest is archived to R2 before the Tiger
  transaction begins; the transaction must retain its immutable bucket, key,
  SHA-256, byte count, and content type before it can advance any cursor
- Tiger recomputes the item count, distinct count, and SHA-256 before and after
  the permanent child-row insert
- the response's echoed starting cursor and force-full flags are retained;
  cursor mismatch or forced-full app responses are recorded as
  `source_blocked` without creating work or advancing a cursor
- an operator-reviewed shadow-gap replay can recover a later retention gap
  only from an exact complete shadow chain; every derived R2 response records
  its source archive and every primary batch records matching Tiger provenance
  in the same transaction as work creation and cursor advancement
- an archive failure prevents the Tiger transaction from starting; a cursor
  mismatch, manifest mismatch, timeout, or worker termination rolls back the
  batch and leaves the primary cursor unchanged
- shadow streams use their committed batch history as a restart cursor and
  cannot use the canonical `primary` stream key
- durable and shadow work rows are isolated by work mode, so replay cannot make
  production work claimable
- leased consumers use `FOR UPDATE SKIP LOCKED`, heartbeats, stale-claim
  recovery, capped retries, explicit dead letters, and separate live/catch-up
  quotas
- PICS change polls, heartbeats, product-info requests, and access-token
  acquisition share one bounded serialized request scheduler with rate
  spacing, jittered capped backoff, and a circuit breaker
- `needs_token` remains durable from the source change through claim routing;
  token-required work uses explicit cached tokens, refreshes once after
  rejection, and never falls through to an anonymous product-info request
- token-request timeouts and malformed response maps use the existing bounded
  request/queue retries; a valid response without an app token remains an
  unresolved source block. This can add retry traffic compared with falsely
  treating a timeout as a permanent access restriction
- `/status.steam_request_attempts` reports process-lifetime governed Steam
  method attempts by class, including internal retries and failed attempts.
  Counters reset on process restart and survive reconnects. Compare readings
  from the same worker instance; these are not packet counts. The per-pass
  `last_processing_product_info_requests` sums both fetch groups and counts
  fetcher calls rather than retries inside the request governor
- redacted token-request evidence and successful, blocked, or failed request
  evidence are archived separately to R2; access-token values are never stored
- raw source presence is retained before normalization; only explicitly
  complete relationship families may replace or clear Tiger edges
- changed payloads are archived to R2 before one Tiger transaction updates
  snapshots, events, PICS-owned latest state, readiness, and acknowledgement
- absent or partial families preserve prior relationships and normalized state
- Storefront-owned release, free/released, and developer/publisher authority is
  preserved
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

`MODE=change_monitor` also requires `PICS_WORK_MODE`. For a historical shadow
capture, use a unique stream and explicit start cursor:

```bash
MODE=change_monitor \
PICS_WORK_MODE=shadow \
PICS_INTAKE_STREAM_KEY=shadow-2026-07-replay \
PICS_SHADOW_START_CHANGE_NUMBER=36631816 \
python -m src.main
```

## Reproducible Dependencies

Production Docker builds pin Poetry `2.4.1`, require the committed
`poetry.lock`, and fail when the lockfile no longer matches `pyproject.toml`.
Change dependencies intentionally with the pinned Poetry version, regenerate
the lockfile, and run the complete PICS test suite before deployment.

Steam accepts no ending cursor for `get_changes_since`. The response runs
through Steam's current cursor; use the retained per-item change numbers to
select a bounded comparison interval. Do not treat a forced-full response,
echoed-cursor mismatch, or retention-limited empty response as proof that an
old gap was reconstructed.

## Exact Missing-Token Replay

Migration `0100_opportunity_field_sources_token_pics.sql` was explicitly
approved and applied to Tiger production on July 31, 2026 UTC. The command's
default mode remains a bounded, read-only preview:

```bash
python -m src.replay_missing_access_tokens \
  --appid 5005180 \
  --limit 1 \
  --requested-by APPROVED_OPERATOR \
  --reason APPROVED_INCIDENT_REASON
```

The preview must show the same exact eligible app set and reviewed
`planSha256` immediately before a write. `--apply` archives the plan to R2 and requeues only an exact
durable-primary `source_blocked/missing_access_token` row; it is a production
write and requires separate approval, an operator identity, and a reason:

```bash
python -m src.replay_missing_access_tokens \
  --appid 5005180 \
  --limit 1 \
  --requested-by APPROVED_OPERATOR \
  --reason APPROVED_INCIDENT_REASON \
  --apply \
  --execute-plan-sha256 REVIEWED_PLAN_SHA256
```

Neither this documentation nor a successful preview authorizes a schema
change, deployment, Storefront refresh, requeue, or backfill.

## Reviewed Shadow-Gap Replay

`src.shadow_gap_replay` is an operator command, not an automatic service
fallback. It requires:

- one archived durable-primary `source_blocked` force-full batch
- one explicitly selected complete shadow batch covering the primary cursor
- one non-primary source stream and an exact ending batch cursor
- an operator identity and a bounded maximum batch count

The first invocation is read-only and prints a credential-free deterministic
plan:

```bash
python -m src.shadow_gap_replay \
  --gap-evidence-batch-id GAP_UUID \
  --source-stream-key REVIEWED_SHADOW_STREAM \
  --first-source-batch-id OVERLAPPING_SOURCE_BATCH_UUID \
  --expected-start-change-number START_CURSOR \
  --target-change-number TARGET_CURSOR \
  --requested-by OPERATOR_ID
```

Execution remains disabled unless `--execute-plan-sha256` exactly matches that
fresh dry-run. Supplying the hash performs R2 and Tiger writes and still
requires a separately approved production write window:

```bash
python -m src.shadow_gap_replay \
  ...same reviewed arguments... \
  --execute-plan-sha256 REVIEWED_PLAN_SHA256
```

Before planning or execution, apply
`0095_pics_shadow_gap_replay_provenance.sql` in its own approved Tiger schema
window. The command verifies each source R2 object's hash, byte count, content
type, response fields, and ordered app manifest, and verifies the gap-evidence
R2 object before any replay write. An overlapping first batch is trimmed to app
entries strictly after the primary cursor and reindexed before hashing. Each
replay step is a normal durable intake transaction, so a failure leaves the
cursor at the last committed source boundary. A rerun is accepted only when the
stored provenance is the exact completed prefix of the same plan.

## Key Configuration

| Variable                                   | Default                       | Description                                                                                       |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                             | required for Supabase targets | Supabase project URL                                                                              |
| `SUPABASE_SERVICE_KEY`                     | required for Supabase targets | Supabase service role key                                                                         |
| `PICS_CHANGE_HISTORY_TARGET`               | `tiger`                       | `tiger` or legacy `supabase`; controls PICS `app_source_snapshots` and `app_change_events` writes |
| `PICS_CHANGE_HISTORY_TIGER_URL`            | `TIGER_PRIMARY_URL`           | Tiger Postgres URL for PICS change-history writes                                                 |
| `PICS_LATEST_STATE_TARGET`                 | `tiger`                       | `tiger` or legacy `supabase`; controls PICS app, relationship, sync-status, and cursor writes     |
| `PICS_LATEST_STATE_TIGER_URL`              | `TIGER_PRIMARY_URL`           | Tiger Postgres URL for PICS latest-state writes                                                   |
| `PICS_WORK_MODE`                           | required for `change_monitor` | `legacy`, `shadow`, or `durable`; missing and unknown values fail closed                          |
| `PICS_INTAKE_TIGER_URL`                    | `TIGER_PRIMARY_URL`           | Tiger URL used only by durable batch intake                                                       |
| `PICS_INTAKE_STREAM_KEY`                   | `shadow-default`              | Non-primary durable cursor namespace for a shadow replay                                          |
| `PICS_INTAKE_LANE`                         | `live`                        | `live` or `catchup`; newly catalog-observed unsynced apps use the protected `new` lane            |
| `PICS_SHADOW_START_CHANGE_NUMBER`          | unset                         | Required when a shadow stream has no committed batch                                              |
| `PICS_INTAKE_STATEMENT_TIMEOUT_SECONDS`    | `60`                          | Upper bound for one intake transaction                                                            |
| `PICS_INTAKE_LOCK_TIMEOUT_SECONDS`         | `10`                          | Upper bound for the stream/cursor lock                                                            |
| `PICS_PROCESSING_ENABLED`                  | `false`                       | Independent fail-closed gate for leased payload processing                                        |
| `PICS_CONSUMER_WORKER_ID`                  | generated                     | Optional stable worker identity; generated from host/process when unset                           |
| `PICS_CONSUMER_LIVE_BATCH_SIZE`            | `40`                          | Protected per-pass quota for `new` and `live` work                                                |
| `PICS_CONSUMER_CATCHUP_BATCH_SIZE`         | `10`                          | Separate per-pass historical catch-up quota                                                       |
| `PICS_SUCCESSOR_FEEDER_ENABLED`           | `false`                       | Opt-in bounded admission from an active, unpaused audited successor; one chunk per pass, open catch-up window capped at two chunks |
| `PICS_CONSUMER_LIVE_BORROWING_ENABLED`     | `false`                       | Opt-in live priority within the existing combined app cap; does not change Steam pacing |
| `PICS_CONSUMER_CATCHUP_MIN_BATCH_SIZE`     | `10`                          | Reserved catch-up allocation when borrowing is enabled; a zero catch-up quota remains paused |
| `PICS_CONSUMER_LEASE_SECONDS`              | `300`                         | Claim lease and heartbeat extension                                                               |
| `PICS_CONSUMER_CONCURRENCY`                | `4`                           | Bounded native threads for independent post-Steam R2/Tiger work; hard-capped at `8`               |
| `PICS_CONSUMER_HEARTBEAT_INTERVAL_SECONDS` | `60`                          | Maximum interval between batched remaining-claim lease barriers                                   |
| `PICS_PRODUCT_INFO_MIN_INTERVAL_SECONDS`   | `215`                         | Conservative pass spacing; values below `212` fail closed during the bounded canary               |
| `PICS_CONSUMER_RETRY_BASE_SECONDS`         | `30`                          | Initial retry delay                                                                               |
| `PICS_CONSUMER_RETRY_MAX_SECONDS`          | `3600`                        | Maximum capped retry delay                                                                        |
| `PICS_PROGRESS_TIMEOUT_SECONDS`          | `900`                         | Independent intake/processing staleness threshold; healthy source-blocked responses remain live |
| `PICS_WATCHDOG_ENABLED`                  | `false`                       | Opt-in native watchdog exits a stalled process after dumping thread stacks; requires rollout validation |
| `STEAM_REQUEST_DEADLINE_SECONDS`          | `300`                         | Deadline across queue/pacing/retries; a whole product fetch also shares this budget across reconnect, tokens and payload calls |
| `CHANGE_INTEL_ARCHIVE_TARGET`              | `disabled`                    | Must be `object_storage` when `PICS_CHANGE_HISTORY_TARGET=tiger`                                  |
| `CHANGE_INTEL_ARCHIVE_BUCKET`              | required for Tiger            | S3-compatible bucket for archived normalized PICS snapshots                                       |
| `CHANGE_INTEL_ARCHIVE_PREFIX`              | `change-intel`                | Object key prefix, e.g. `production/change-intel`                                                 |
| `CHANGE_INTEL_ARCHIVE_ENDPOINT`            | optional                      | S3-compatible endpoint, e.g. Cloudflare R2 account endpoint                                       |
| `CHANGE_INTEL_ARCHIVE_REGION`              | `us-east-1`                   | S3 region; R2 commonly uses `auto`                                                                |
| `CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID`       | optional                      | S3-compatible access key                                                                          |
| `CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY`   | optional                      | S3-compatible secret key                                                                          |
| `MODE`                                     | `change_monitor`              | `bulk_sync`, `first_pass`, `change_monitor`, or `backfill_change_history`                         |
| `PORT`                                     | `8080`                        | Health-check port                                                                                 |
| `BULK_BATCH_SIZE`                          | `200`                         | Apps per PICS request                                                                             |
| `BULK_REQUEST_DELAY`                       | `0.5`                         | Seconds between bulk requests                                                                     |
| `BULK_TIMEOUT`                             | `60`                          | Timeout per bulk batch fetch                                                                      |
| `BULK_MAX_RETRIES`                         | `5`                           | Retry attempts per bulk batch                                                                     |
| `FIRST_PASS_BATCH_LIMIT`                   | `500`                         | Max apps processed in a first-pass run                                                            |
| `FIRST_PASS_CANDIDATE_POOL_SIZE`           | `1000`                        | Unsynced candidate pool size for first-pass ranking                                               |
| `FIRST_PASS_RECENT_RELEASE_DAYS`           | `30`                          | Prefer recent releases within this window                                                         |
| `FIRST_PASS_NEAR_RELEASE_DAYS`             | `14`                          | Prefer upcoming / near-release apps within this window                                            |
| `POLL_INTERVAL`                            | `30`                          | Seconds between PICS change polls                                                                 |
| `PROCESS_BATCH_SIZE`                       | `100`                         | Apps per queue processing batch                                                                   |
| `MAX_QUEUE_SIZE`                           | `10000`                       | Maximum queued apps                                                                               |
| `STEAM_HEARTBEAT_INTERVAL`                 | `300`                         | Existing heartbeat cadence; heartbeat requests use the shared Steam scheduler                     |
| `STEAM_REQUEST_MIN_INTERVAL_SECONDS`       | `0.5`                         | Minimum start spacing across requests owned by the one Steam session                              |
| `STEAM_REQUEST_QUEUE_CAPACITY`             | `500`                         | Maximum accepted in-process Steam request queue depth                                             |
| `STEAM_REQUEST_MAX_ATTEMPTS`               | `5`                           | Total attempts for a governed Steam request                                                       |
| `STEAM_REQUEST_BACKOFF_BASE_SECONDS`       | `1`                           | Initial exponential request retry delay                                                           |
| `STEAM_REQUEST_BACKOFF_MAX_SECONDS`        | `30`                          | Maximum request retry delay before jitter                                                         |
| `STEAM_REQUEST_BACKOFF_JITTER_RATIO`       | `0.25`                        | Symmetric retry-delay jitter ratio                                                                |
| `STEAM_REQUEST_CIRCUIT_FAILURE_THRESHOLD`  | `5`                           | Consecutive failures that open the per-session circuit                                            |
| `STEAM_REQUEST_CIRCUIT_COOLDOWN_SECONDS`   | `60`                          | Circuit-open cooldown before requests may resume                                                  |
| `STEAM_ACCESS_TOKEN_TTL_SECONDS`           | `3600`                        | In-memory app access-token cache lifetime; token values are never archived                        |
| `STEAM_AUTO_RECONNECT`                     | `true`                        | Automatically reconnect after a disconnect                                                        |
| `LOG_LEVEL`                                | `INFO`                        | Logging level                                                                                     |
| `LOG_JSON`                                 | `true`                        | JSON log formatting                                                                               |

The live plus catch-up consumer quotas must not exceed the existing
200-app product-info batch cap.

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

| Variable                                  | Default            | Description                    |
| ----------------------------------------- | ------------------ | ------------------------------ |
| `PICS_CHANGE_HISTORY_BACKFILL_BATCH_SIZE` | `500`              | Rows per Supabase page         |
| `PICS_CHANGE_HISTORY_BACKFILL_LIMIT`      | unset              | Optional per-surface max rows  |
| `PICS_CHANGE_HISTORY_BACKFILL_MIN_ID`     | `0`                | Resume cursor by source row id |
| `PICS_CHANGE_HISTORY_BACKFILL_SURFACES`   | `snapshots,events` | `snapshots`, `events`, or both |

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

No-network processor benchmark:

```bash
PYTHONPATH=. python scripts/benchmark_durable_processor.py \
  --batch-sizes 50,75,100,150,200 \
  --workers 1,4,8
```

The production-read benchmark is explicitly read-only: it opens Tiger
transactions with `default_transaction_read_only=on` and performs only bounded
`SELECT` queries plus verified R2 `GET` requests. Run it only with the genuine
PICS service environment:

```bash
PYTHONPATH=. python scripts/benchmark_durable_reads.py \
  --confirm-read-only-production \
  --batch-sizes 50,75,100,150,200 \
  --r2-workers 4
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
- [Durable PICS Intake](../../docs/developer-guide/operations/durable-pics-intake.md)
- [Steam Change Intelligence](../../docs/developer-guide/workers/steam-change-intelligence.md)

### Efficiency and successor recovery candidates

The September 2026 changes are local rollout candidates until separately approved. Durable processing requires Tiger bootstrap **0109** (shared heavy-phase coordination) and **0111** (successor metadata/pause checks) before deploying this version. No migration, checkpoint activation, or replay is performed by service startup.

Raw intake and the single processing pass share the Steam owner/governor. Blocking database/archive operations use bounded native work; periodic batched heartbeats renew owned leases during slow phases. A catch-up pass holds one shared advisory lock and each catch-up promotion also takes a shared transaction lock. Heavy refresh contention defers owned work and refunds the unattempted capacity failure. Live work and intake retain their own scheduling. These changes add useful overlap, heartbeats, and a reserved gate connection; they do not demonstrate spare Tiger capacity.

For a populated primary queue, use the audited successor workflow in [the implementation rollout plan](../../output/tigerdata-assessment-2026-09-06/implementation-rollout-and-rollback.md). It retains prior reconciliation dispositions, stages a bounded known-catalog manifest, verifies archived gap/head evidence, and keeps catch-up paused after activation. `scripts/verify_successor_evidence.py` performs bounded SELECTs/R2 GETs only. Old destructive checkpoint rollback is prohibited for successors. After activation, any code rollback must retain current-run settlement scoping and successor pause checks; restoring plain pre-successor code can corrupt prior audit records.

After the initial live-work and recovery canaries pass, explicitly enable `PICS_SUCCESSOR_FEEDER_ENABLED` to continue admitting that manifest without repeated operator commands. The existing worker claims live work first, then admits at most its catch-up allocation (hard cap 100) with an open catch-up window twice that size (hard cap 200). Pending work, delayed retries and owned catch-up all occupy the window. Durable item links preserve progress after restart or an uncertain commit. Admission yields immediately to waiting live work, an exclusive heavy-phase lock, busy intake, an operator lock or the persistent successor pause. Zero catch-up quota and shadow mode disable admission. This adds a bounded transaction to each enabled pass and makes catch-up slower under contention; it does not add a collector, increase Steam pacing or expand processing concurrency.

`/status` exposes `last_processing_recovery_feed` with the latest admission result and run ID, alongside processing phase timing and queue metrics. `manifest_admitted` means every manifest member has a work link, not that all members succeeded. Source-blocked and dead-letter outcomes remain visible; final audit completion, new history gaps and unavailable access tokens still require explicit handling. The feeder never activates a checkpoint, unpauses a run, bypasses tokens or retries a terminal linked item merely because it failed. Admission failure skips catch-up for that pass while allowing already owned live work to settle. To stop recovery, use the audited database pause, drain owned work and disable the feeder; retain all links and accepted data for a later resume.

Durable stores use locked `psycopg-pool` 3.3.1, opened lazily on first checkout. Intake allows one connection, work state allows two (including the catch-up gate), and promotion allows the configured consumer concurrency. At the current concurrency of three this caps the service's durable pools at six connections; do not increase concurrency as part of rollout. Pools start with zero connections, use a 300-second idle shrink interval and a jittered 30-minute lifetime, and retain existing per-operation transactions. Checkout waits are bounded at 10 seconds with at most 16 waiting requests per pool; connect and TCP failure settings are bounded separately. Work-state queries can briefly queue behind a held gate and another work query. Intake has its own pool.

Every return commits or rolls back first, then synchronously clears temporary tables, session advisory locks, role/GUC/LISTEN state and driver transaction settings. Automatic prepared statements are disabled because reset discards server statements. A failed reset closes the connection without changing the already-known transaction outcome; dead sessions are checked/replaced on checkout. Pooling adds persistent backend memory plus check/reset round trips, which must be included in restored-load measurements. Cumulative pool logs expose creation, request, waiting and size counters; these are distinct from logical application transaction counts. Shutdown drains the processing pass before closing the pools. Rollback may restore the tested baseline-plus-successor-compatibility image, preserving accepted data and successor guards.


### Recovery from a stalled Steam connection

Reconnect callers preserve the current attempt's ownership of the Steam client,
even when a caller requests forced recovery. Background reconnects return after
three attempts; subsequent poll passes retry with the existing backoff. Finite
attempt budgets do not reset at the tenth failure. Cooperative deadlines remain
in place, but cannot interrupt every native I/O stall.

`/status` computes liveness at read time and exposes `health_http_status` and
`health_reason`. On a stale worker it reports `health_state=unhealthy`, preserving
the original label as `reported_health_state` and leaving all observation
timestamps untouched. `/status` retains HTTP 200 for diagnostic consumers;
`/health` returns 503 for stale progress. A responsive source-history block remains
degraded and requires audited recovery rather than a restart loop.

For an approved recovery, enable the existing `PICS_WATCHDOG_ENABLED=true` with
`PICS_PROGRESS_TIMEOUT_SECONDS=900` after checking normal phase times. Its native
thread dumps stacks and exits on lost coordinator/processor progress so Railway's
existing failure restart policy can recover. Tradeoff: unfinished transactions
roll back and retry; committed batches, queue outcomes and R2 archives persist.
Do not use a watchdog restart to bypass a forced-full history gap.

Roll out one collector with processing and successor feeder disabled first.
Verify fresh complete archived change batches before activating the audited
successor and restoring bounded primary processing. Retain previous source blocks
and checkpoint audits. Catch-up expansion requires measured restored-load capacity
through a full normal daily overlap cycle. To roll back the runtime, disable
processing/feeder, preserve the persistent catch-up pause, and deploy the previous
successor-compatible image with one collector. Never rewind the canonical cursor.
