# Steam Change Intelligence

Steam change intelligence is split across three runtimes:

- `app-change-hints`: hourly GitHub Action that pages `IStoreService/GetAppList`, updates `sync_status.steam_last_modified` and `sync_status.steam_price_change_number`, and enqueues `storefront` capture work when the hint cursor changed.
- `change-intel-worker`: long-running queue drainer for `storefront`, `news`, `projection_refresh`, and `hero_asset` capture sources. Railway should run this continuously with `pnpm --filter @publisheriq/ingestion change-intel-worker`.
- `services/pics-service`: writes normalized PICS snapshots and diff events inline before the existing latest-state upserts. It also supports `bulk_sync`, `first_pass`, and `change_monitor` modes.

## Recent Behavior Notes

- Diff canonicalization now normalizes JSON payload ordering before comparison, which reduces false positives caused by key-order churn in stored JSON values.
- Storefront latest-state writes keep parsed `release_date` strict; non-parseable release text remains raw text instead of overwriting typed dates.
- `app_capture_work_state` coalesces repeated dirty signals for the same app/source pair instead of spawning duplicate queue rows.
- Projection refresh jobs keep `change_activity_bursts`, `change_pattern_activity_days`, `change_pattern_app_windows`, and `steam_news_search_projection` in sync with upstream changes.
- PICS history capture retries transient and schema-cache failures, updates `last_seen_at` for unchanged normalized snapshots, and cools down temporarily if historical writes keep failing.
- Latest-state PICS upserts continue even when the historical-write cooldown is active.

## Queue Ownership

- PICS uses `app_capture_work_state` rather than the historical `app_capture_queue` path.
- Queue sources are:
  - `storefront`: recapture Storefront details, write `app_source_snapshots`, `app_media_versions`, `app_change_events`, and latest-state RPC updates.
  - `news`: fetch reachable Steam News history, write `steam_news_items`, `steam_news_versions`, `steam_news_search_projection`, and `app_change_events`.
  - `projection_refresh`: refresh change/news read projections after storefront or news mutations.
  - `hero_asset`: archive changed `header` and `capsule` binaries for the eligible cohort only. Backgrounds still remain in URL-level media history and change events, but their binaries are not archived.

## Worker Environment

- `CLAIM_LIMIT`: number of queue rows to claim per source sweep. Default `25`.
- `POLL_INTERVAL_MS`: sleep duration when no work is found. Default `5000`.
- `QUEUE_SOURCES`: comma-separated subset of `storefront,news,projection_refresh,hero_asset`. Default is all four.
- `NEWS_CATCHUP_SEED_LIMIT`: how many stale-app news jobs to seed when the worker goes idle. Default `10`.
- `MAX_IDLE_POLLS`: optional bounded-exit control for manual workflows. `0` means run forever.
- `CLAIM_STALE_AFTER_MS`: requeue `claimed` queue rows older than this threshold so abandoned work is not stranded during worker churn or replica scale-down. Default `1800000` (`30` minutes). Set `0` to disable.
- `STALE_CLAIM_SWEEP_INTERVAL_MS`: how often the worker checks for stale claimed rows. Default `60000`.

When stale claims are requeued, the completion path records the `stale_claim_requeued` reason so abandoned rows do not stay stranded.

## Storage Guardrails

- Bucket: `steam-hero-assets`
- Archive only `header` and `capsule` binaries.
- Reject assets larger than `2 MB`.
- Warn when bucket usage reaches `20 GB`.
- Tighten archival behavior at `35 GB`.
- Pause new archival at `50 GB`.
- Hero archival failures must not block Storefront snapshot capture, media versioning, or News capture.

## Operational Workflows

- `.github/workflows/app-change-hints.yml`: scheduled hourly hint sweep plus manual dispatch.
- `.github/workflows/news-catchup.yml`: manual bounded news catch-up using `QUEUE_SOURCES=news` and `MAX_IDLE_POLLS`.
- `.github/workflows/storefront-initial-sync.yml`: existing manual storefront bootstrap workflow.

## Read Surfaces

The user-facing `/changes` page reads from:

- `get_change_feed_activity`
- `get_change_feed_bursts`
- `get_change_feed_burst_detail`
- `get_change_feed_news`
- `/api/change-feed/status`

Shared chat/news surfaces such as `get_chat_recent_news` and `search_recent_news_topics` sit alongside those page-facing reads.

## Verification

- Node tests: `cd packages/ingestion && pnpm run test:change-intel`
- Node typecheck: `cd packages/ingestion && pnpm check-types`
- Python tests: `cd services/pics-service && pytest tests/test_change_intelligence.py tests/test_operations_change_history.py`
- Python syntax smoke: run `python3 -m py_compile` on the changed PICS modules and tests.
- First-pass smoke: run `cd services/pics-service && MODE=first_pass python3 -m src.main` with a small candidate window or inspect `get_first_pass_app_ids(...)` selections directly.
- Chat smoke: open `/admin/chat-smoke` and run the change-intelligence groups through `/chat`, then inspect Query Details and Admin Chat Logs.

The foundational migration for this feature is [20260313130000_add_steam_change_intelligence.sql](/Users/ryanbohmann/Desktop/publisheriq/supabase/migrations/20260313130000_add_steam_change_intelligence.sql). The chat bounds hardening migration is [20260318153000_harden_change_intel_chat_query_bounds.sql](/Users/ryanbohmann/Desktop/publisheriq/supabase/migrations/20260318153000_harden_change_intel_chat_query_bounds.sql), and it was applied manually via `psql` on 2026-03-18 so the live RPCs enforce the same bounds as the chat service.
