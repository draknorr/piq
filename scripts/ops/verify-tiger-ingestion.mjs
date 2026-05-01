#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const WORKFLOW_DIR = path.join(ROOT_DIR, ".github", "workflows");

const STATUS_RANK = {
  pass: 0,
  info: 0,
  warn: 2,
  fail: 3,
  skip: -1,
};

const EXTERNAL_SCHEDULED = "external-scheduled";
const EXTERNAL_MANUAL = "external-manual";
const EXTERNAL_SERVICE = "external-service";
const DERIVED_SCHEDULED = "derived-scheduled";
const REFERENCE_OR_DISABLED = "reference-or-disabled";

const WORKFLOW_SOURCES = [
  {
    id: "steam-applist",
    label: "Steam App List",
    category: EXTERNAL_SCHEDULED,
    workflow: "applist-sync.yml",
    schedule: true,
    commands: [/applist-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_CATALOG_WRITERS",
    liveJobTypes: ["applist"],
    evidence: [
      "legacy.apps.last_seen_in_steam_applist_at",
      "ops.sync_jobs:applist",
    ],
  },
  {
    id: "steam-app-change-hints",
    label: "Steam App Change Hints",
    category: EXTERNAL_SCHEDULED,
    workflow: "app-change-hints.yml",
    schedule: true,
    commands: [/app-change-hints/],
    envEquals: { DATA_READ_TARGET: "tiger", DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    liveJobTypes: ["app-change-hints"],
    evidence: ["ops.sync_jobs:app-change-hints", "ops.app_capture_work_state"],
  },
  {
    id: "steam-storefront",
    label: "Steam Storefront",
    category: EXTERNAL_SCHEDULED,
    workflow: "storefront-sync.yml",
    schedule: true,
    commands: [/storefront-sync/],
    envEquals: {
      CHANGE_INTEL_WRITE_TARGET: "tiger",
      DATA_WRITE_TARGET: "tiger",
    },
    requiredEnv: ["TIGER_PRIMARY_URL", "CHANGE_INTEL_ARCHIVE_BUCKET"],
    optionalGate: "ENABLE_TIGER_CATALOG_WRITERS",
    liveJobTypes: ["storefront"],
    changeIntelJobTypes: ["storefront"],
    evidence: [
      "ops.sync_status.last_storefront_sync",
      "docs.app_source_snapshots:storefront",
      "events.app_change_events:storefront",
    ],
  },
  {
    id: "steam-news-hot-refresh",
    label: "Steam News Hot Refresh",
    category: EXTERNAL_SCHEDULED,
    workflow: "news-hot-refresh.yml",
    schedule: true,
    commands: [/change-intel-worker/],
    envEquals: {
      CHANGE_INTEL_WRITE_TARGET: "tiger",
      DATA_WRITE_TARGET: "tiger",
      QUEUE_SOURCES: "news",
    },
    requiredEnv: ["TIGER_PRIMARY_URL", "CHANGE_INTEL_ARCHIVE_BUCKET"],
    liveJobTypes: ["change-intel"],
    changeIntelJobTypes: ["news"],
    evidence: [
      "ops.sync_status.last_news_sync",
      "docs.steam_news_versions",
      "events.app_change_events:news",
    ],
  },
  {
    id: "steamspy",
    label: "SteamSpy Metrics",
    category: EXTERNAL_SCHEDULED,
    workflow: "steamspy-sync.yml",
    schedule: true,
    commands: [/steamspy-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["steamspy"],
    evidence: ["ops.sync_status.last_steamspy_sync", "metrics.daily_metrics"],
  },
  {
    id: "steam-ccu-tiered",
    label: "Steam CCU Tiered",
    category: EXTERNAL_SCHEDULED,
    workflow: "ccu-sync.yml",
    schedule: true,
    commands: [/ccu-tiered-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["ccu-tiered", "ccu"],
    evidence: [
      "metrics.ccu_snapshots",
      "ops.ccu_tier_assignments.last_ccu_synced",
    ],
  },
  {
    id: "steam-ccu-daily",
    label: "Steam CCU Daily",
    category: EXTERNAL_SCHEDULED,
    workflow: "ccu-daily-sync.yml",
    schedule: true,
    commands: [/ccu-daily-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: [
      "ccu-daily",
      "ccu-daily-p0",
      "ccu-daily-p1",
      "ccu-daily-p2",
      "ccu-daily-p3",
    ],
    evidence: [
      "metrics.daily_metrics.ccu_peak",
      "legacy.latest_daily_metrics.ccu_peak",
    ],
  },
  {
    id: "steam-price",
    label: "Steam Price",
    category: EXTERNAL_SCHEDULED,
    workflow: "price-sync.yml",
    schedule: true,
    commands: [/price-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["price"],
    evidence: [
      "ops.sync_status.last_price_sync",
      "metrics.daily_metrics.price_cents",
    ],
  },
  {
    id: "steam-reviews",
    label: "Steam Reviews",
    category: EXTERNAL_SCHEDULED,
    workflow: "reviews-sync.yml",
    schedule: true,
    commands: [/reviews-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["reviews"],
    evidence: ["ops.sync_status.last_reviews_sync", "metrics.review_deltas"],
  },
  {
    id: "steam-review-histogram",
    label: "Steam Review Histogram",
    category: EXTERNAL_SCHEDULED,
    workflow: "histogram-sync.yml",
    schedule: true,
    commands: [/histogram-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["histogram"],
    evidence: [
      "ops.sync_status.last_histogram_sync",
      "metrics.review_histogram",
    ],
  },
  {
    id: "qdrant-embeddings",
    label: "Embeddings And Qdrant",
    category: EXTERNAL_SCHEDULED,
    workflow: "embedding-sync.yml",
    schedule: true,
    commands: [/embedding-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL", "QDRANT_URL", "OPENAI_API_KEY"],
    optionalGate: "ENABLE_TIGER_EMBEDDING_WRITER",
    liveJobTypes: ["embedding"],
    evidence: [
      "ops.sync_status.last_embedding_sync",
      "legacy.developers.last_embedding_sync",
    ],
  },
  {
    id: "youtube-production",
    label: "YouTube Production",
    category: EXTERNAL_SCHEDULED,
    workflow: "youtube-production-sync.yml",
    schedule: true,
    commands: [
      /youtube:seed-routing/,
      /youtube:sync-discovery/,
      /youtube:sync-refresh/,
      /youtube:rollup-daily/,
    ],
    envEquals: { YOUTUBE_WRITE_TARGET: "production" },
    requiredEnv: [
      "TIGER_PRIMARY_URL",
      "YOUTUBE_SOURCE_DATABASE_URL",
      "YOUTUBE_API_KEY",
    ],
    liveJobTypes: [],
    evidence: [
      "ops.youtube_search_runs",
      "events.youtube_search_hits",
      "docs.youtube_videos",
      "metrics.youtube_game_daily",
    ],
  },
  {
    id: "storefront-initial",
    label: "Steam Storefront Initial Sync",
    category: EXTERNAL_MANUAL,
    workflow: "storefront-initial-sync.yml",
    manual: true,
    commands: [/storefront-sync/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_CATALOG_WRITERS",
    evidence: ["manual backfill only; not part of scheduled ingestion"],
  },
  {
    id: "news-catchup",
    label: "Steam News Catch-up",
    category: EXTERNAL_MANUAL,
    workflow: "news-catchup.yml",
    manual: true,
    commands: [/change-intel-worker/],
    envEquals: {
      CHANGE_INTEL_WRITE_TARGET: "tiger",
      DATA_WRITE_TARGET: "tiger",
    },
    requiredEnv: ["TIGER_PRIMARY_URL", "CHANGE_INTEL_ARCHIVE_BUCKET"],
    evidence: ["manual catch-up only; not part of scheduled ingestion"],
  },
  {
    id: "youtube-bootstrap",
    label: "YouTube Production Bootstrap",
    category: EXTERNAL_MANUAL,
    workflow: "youtube-production-bootstrap.yml",
    manual: true,
    commands: [/youtube:bootstrap-backfill/],
    envEquals: { YOUTUBE_WRITE_TARGET: "production" },
    requiredEnv: ["TIGER_PRIMARY_URL", "YOUTUBE_API_KEY"],
    evidence: ["manual bootstrap only; not part of scheduled ingestion"],
  },
  {
    id: "alert-detection",
    label: "Alert Detection",
    category: DERIVED_SCHEDULED,
    workflow: "alert-detection.yml",
    schedule: true,
    commands: [/alert-detection/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_ALERT_WORKER",
    liveJobTypes: ["alert_detection"],
    evidence: ["ops.alert_detection_state", "legacy.user_alerts"],
  },
  {
    id: "review-interpolation",
    label: "Review Interpolation",
    category: DERIVED_SCHEDULED,
    workflow: "interpolation.yml",
    schedule: true,
    commands: [/interpolate-reviews/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["interpolation"],
    evidence: ["metrics.review_deltas.is_interpolated"],
  },
  {
    id: "review-velocity",
    label: "Review Velocity",
    category: DERIVED_SCHEDULED,
    workflow: "velocity-calculation.yml",
    schedule: true,
    commands: [/calculate-velocity/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["velocity-calc"],
    evidence: ["ops.sync_status.velocity_calculated_at"],
  },
  {
    id: "review-trends",
    label: "Review Trends",
    category: DERIVED_SCHEDULED,
    workflow: "trends-calculation.yml",
    schedule: true,
    commands: [/calculate-trends/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["trends"],
    evidence: ["metrics.app_trends.updated_at"],
  },
  {
    id: "review-priority",
    label: "Review Priority",
    category: DERIVED_SCHEDULED,
    workflow: "priority-calculation.yml",
    schedule: true,
    commands: [/update-priorities/],
    envEquals: { DATA_WRITE_TARGET: "tiger" },
    requiredEnv: ["TIGER_PRIMARY_URL"],
    optionalGate: "ENABLE_TIGER_METRICS_WRITERS",
    liveJobTypes: ["priority"],
    evidence: ["ops.sync_status.priority_calculated_at"],
  },
  {
    id: "tiger-production-sync",
    label: "Tiger Production Reference Sync",
    category: REFERENCE_OR_DISABLED,
    workflow: "tiger-production-sync.yml",
    manual: true,
    reason:
      "Supabase-to-Tiger reference/parity path; must stay manual-only during Tiger primary ingestion cutover.",
  },
  {
    id: "tiger-preview-sync",
    label: "Tiger Preview Sync",
    category: REFERENCE_OR_DISABLED,
    workflow: "tiger-preview-sync.yml",
    manual: true,
    reason: "Preview/manual parity path.",
  },
  {
    id: "tiger-preview-events-news",
    label: "Tiger Preview Events News",
    category: REFERENCE_OR_DISABLED,
    workflow: "tiger-preview-events-news.yml",
    manual: true,
    reason: "Preview/manual parity path.",
  },
  {
    id: "youtube-preview-mirror",
    label: "YouTube Preview Mirror",
    category: REFERENCE_OR_DISABLED,
    workflow: "youtube-preview-mirror.yml",
    manual: true,
    reason: "Preview mirror, not production external ingestion.",
  },
  {
    id: "ccu-cleanup",
    label: "CCU Cleanup",
    category: REFERENCE_OR_DISABLED,
    workflow: "ccu-cleanup.yml",
    reason:
      "Legacy cleanup path, expected to stay disabled unless explicitly reworked.",
  },
  {
    id: "refresh-views",
    label: "Refresh Views",
    category: REFERENCE_OR_DISABLED,
    workflow: "refresh-views.yml",
    reason: "Supabase view refresh path, not incoming external ingestion.",
  },
  {
    id: "refresh-app-filter-data",
    label: "Refresh App Filter Data",
    category: REFERENCE_OR_DISABLED,
    workflow: "refresh-app-filter-data.yml",
    reason: "Supabase derived refresh path, not incoming external ingestion.",
  },
  {
    id: "review-truth-repair",
    label: "Review Truth Repair",
    category: REFERENCE_OR_DISABLED,
    workflow: "review-truth-repair.yml",
    reason:
      "Repair workflow intentionally out of scope for ingestion verification.",
  },
  {
    id: "cleanup-chat-logs",
    label: "Cleanup Chat Logs",
    category: REFERENCE_OR_DISABLED,
    workflow: "cleanup-chat-logs.yml",
    reason: "Runtime product cleanup, not external ingestion.",
  },
  {
    id: "cleanup-reservations",
    label: "Cleanup Reservations",
    category: REFERENCE_OR_DISABLED,
    workflow: "cleanup-reservations.yml",
    reason: "Runtime product cleanup, not external ingestion.",
  },
];

const SERVICE_SOURCES = [
  {
    id: "pics-railway",
    label: "Steam PICS Railway Service",
    category: EXTERNAL_SERVICE,
    manifest: "services/pics-service/railway.toml",
    envExample: "services/pics-service/.env.example",
    expectedEnvEquals: {
      PICS_CHANGE_HISTORY_TARGET: "tiger",
      PICS_LATEST_STATE_TARGET: "tiger",
    },
    requiredAnyEnv: [
      ["PICS_CHANGE_HISTORY_TIGER_URL", "TIGER_PRIMARY_URL"],
      ["PICS_LATEST_STATE_TIGER_URL", "TIGER_PRIMARY_URL"],
    ],
    requiredEnv: ["CHANGE_INTEL_ARCHIVE_BUCKET"],
    liveJobTypes: [],
    evidence: [
      "ops.sync_status.last_pics_sync",
      "ops.pics_sync_state.updated_at",
      "docs.app_source_snapshots:pics",
      "events.app_change_events:pics",
    ],
  },
  {
    id: "railway-change-intel-worker",
    label: "Railway Change Intel Worker",
    category: EXTERNAL_SERVICE,
    manifest: "packages/ingestion/railway.json",
    expectedEnvEquals: {
      CHANGE_INTEL_WRITE_TARGET: "tiger",
      DATA_WRITE_TARGET: "tiger",
    },
    requiredAnyEnv: [["TIGER_PRIMARY_URL", "CHANGE_INTEL_TIGER_URL"]],
    requiredEnv: ["CHANGE_INTEL_ARCHIVE_BUCKET"],
    evidence: [
      "docs.app_source_snapshots:storefront",
      "docs.steam_news_versions",
    ],
  },
];

const STATIC_INGESTION_PATTERN =
  /@publisheriq\/ingestion|change-intel-worker|storefront-sync|applist-sync|steamspy-sync|ccu-(?:daily|tiered)-sync|price-sync|reviews-sync|histogram-sync|embedding-sync|alert-detection|youtube:/;

const SUPABASE_SERVICE_KEY_PATTERN =
  /\bSUPABASE_(?:SERVICE_KEY|SERVICE_ROLE_KEY|SERVICE_ROLE)\b/;
const WRITE_PATTERN =
  /\b(?:INSERT|UPDATE|DELETE|UPSERT|ALTER|DROP|TRUNCATE|CREATE TABLE)\b|\.(?:insert|upsert|update|delete)\s*\(/i;

const TIGER_TABLE_SPECS = [
  { schema: "legacy", table: "apps" },
  { schema: "legacy", table: "developers" },
  { schema: "legacy", table: "publishers" },
  { schema: "legacy", table: "latest_daily_metrics" },
  { schema: "metrics", table: "daily_metrics" },
  { schema: "metrics", table: "ccu_snapshots" },
  { schema: "metrics", table: "review_deltas" },
  { schema: "metrics", table: "review_histogram" },
  { schema: "metrics", table: "app_trends" },
  { schema: "ops", table: "sync_jobs" },
  { schema: "ops", table: "sync_status" },
  { schema: "ops", table: "ccu_tier_assignments" },
  { schema: "ops", table: "alert_detection_state" },
  { schema: "ops", table: "pics_sync_state" },
  { schema: "ops", table: "change_intel_sync_jobs" },
  { schema: "ops", table: "app_capture_work_state" },
  { schema: "docs", table: "app_source_snapshots" },
  { schema: "docs", table: "steam_news_versions" },
  { schema: "docs", table: "app_media_versions" },
  { schema: "docs", table: "app_hero_asset_versions" },
  { schema: "events", table: "app_change_events" },
  { schema: "legacy", table: "user_alerts" },
  { schema: "ops", table: "youtube_game_routing" },
  { schema: "ops", table: "youtube_search_runs" },
  { schema: "ops", table: "youtube_channel_monitors" },
  { schema: "docs", table: "youtube_videos" },
  { schema: "docs", table: "youtube_channels" },
  { schema: "docs", table: "youtube_video_matches" },
  { schema: "events", table: "youtube_search_hits" },
  { schema: "events", table: "youtube_match_decisions" },
  { schema: "metrics", table: "youtube_video_snapshots" },
  { schema: "metrics", table: "youtube_game_daily" },
];

const TABLE_FRESHNESS_CHECKS = [
  {
    id: "catalog-apps",
    label: "Catalog latest state",
    schema: "legacy",
    table: "apps",
    timeColumns: ["last_seen_in_steam_applist_at", "updated_at"],
  },
  {
    id: "metrics-daily",
    label: "Daily metrics",
    schema: "metrics",
    table: "daily_metrics",
    timeColumns: ["metric_date"],
  },
  {
    id: "latest-daily-metrics",
    label: "Latest daily metrics compatibility",
    schema: "legacy",
    table: "latest_daily_metrics",
    timeColumns: ["metric_date"],
  },
  {
    id: "ccu-snapshots",
    label: "CCU snapshots",
    schema: "metrics",
    table: "ccu_snapshots",
    timeColumns: ["snapshot_time"],
  },
  {
    id: "ccu-tier-assignments",
    label: "CCU tier assignments",
    schema: "ops",
    table: "ccu_tier_assignments",
    timeColumns: ["last_ccu_synced", "updated_at"],
  },
  {
    id: "review-deltas",
    label: "Review deltas",
    schema: "metrics",
    table: "review_deltas",
    timeColumns: ["delta_date", "created_at"],
  },
  {
    id: "review-histogram",
    label: "Review histogram",
    schema: "metrics",
    table: "review_histogram",
    timeColumns: ["fetched_at", "month_start"],
  },
  {
    id: "app-trends",
    label: "App trends",
    schema: "metrics",
    table: "app_trends",
    timeColumns: ["updated_at"],
  },
  {
    id: "app-capture-work",
    label: "Change capture work queue",
    schema: "ops",
    table: "app_capture_work_state",
    timeColumns: ["last_dirty_at", "updated_at", "created_at"],
  },
  {
    id: "app-source-snapshots",
    label: "Storefront/PICS snapshots",
    schema: "docs",
    table: "app_source_snapshots",
    timeColumns: ["observed_at", "created_at"],
    groupColumn: "source",
  },
  {
    id: "app-change-events",
    label: "App change events",
    schema: "events",
    table: "app_change_events",
    timeColumns: ["occurred_at", "created_at"],
    groupColumn: "source",
  },
  {
    id: "steam-news-versions",
    label: "Steam news versions",
    schema: "docs",
    table: "steam_news_versions",
    timeColumns: ["first_seen_at", "created_at"],
  },
  {
    id: "app-media-versions",
    label: "App media versions",
    schema: "docs",
    table: "app_media_versions",
    timeColumns: ["first_seen_at", "created_at"],
  },
  {
    id: "app-hero-asset-versions",
    label: "Hero asset R2 pointers",
    schema: "docs",
    table: "app_hero_asset_versions",
    timeColumns: ["first_seen_at", "created_at"],
  },
  {
    id: "pics-sync-state",
    label: "PICS sync cursor",
    schema: "ops",
    table: "pics_sync_state",
    timeColumns: ["updated_at"],
  },
  {
    id: "alert-detection-state",
    label: "Alert detection state",
    schema: "ops",
    table: "alert_detection_state",
    timeColumns: ["updated_at", "last_alerted_at"],
  },
  {
    id: "youtube-routing",
    label: "YouTube routing",
    schema: "ops",
    table: "youtube_game_routing",
    timeColumns: [
      "last_successful_discovery_at",
      "last_search_run_at",
      "updated_at",
    ],
  },
  {
    id: "youtube-search-runs",
    label: "YouTube search runs",
    schema: "ops",
    table: "youtube_search_runs",
    timeColumns: ["completed_at", "started_at", "requested_at"],
    groupColumn: "status",
  },
  {
    id: "youtube-search-hits",
    label: "YouTube search hits",
    schema: "events",
    table: "youtube_search_hits",
    timeColumns: ["captured_at", "created_at"],
  },
  {
    id: "youtube-match-decisions",
    label: "YouTube match decisions",
    schema: "events",
    table: "youtube_match_decisions",
    timeColumns: ["decided_at", "created_at"],
  },
  {
    id: "youtube-videos",
    label: "YouTube videos",
    schema: "docs",
    table: "youtube_videos",
    timeColumns: ["last_hydrated_at", "last_seen_at", "updated_at"],
  },
  {
    id: "youtube-video-matches",
    label: "YouTube video matches",
    schema: "docs",
    table: "youtube_video_matches",
    timeColumns: ["last_seen_at", "updated_at", "matched_at"],
  },
  {
    id: "youtube-video-snapshots",
    label: "YouTube video snapshots",
    schema: "metrics",
    table: "youtube_video_snapshots",
    timeColumns: ["snapshot_time", "created_at"],
  },
  {
    id: "youtube-game-daily",
    label: "YouTube daily rollups",
    schema: "metrics",
    table: "youtube_game_daily",
    timeColumns: ["metric_date", "created_at"],
  },
];

const SYNC_STATUS_COLUMNS = [
  {
    id: "sync-storefront",
    label: "Storefront sync status",
    column: "last_storefront_sync",
  },
  { id: "sync-news", label: "News sync status", column: "last_news_sync" },
  { id: "sync-media", label: "Media sync status", column: "last_media_sync" },
  { id: "sync-pics", label: "PICS sync status", column: "last_pics_sync" },
  {
    id: "sync-steamspy",
    label: "SteamSpy sync status",
    column: "last_steamspy_sync",
  },
  { id: "sync-price", label: "Price sync status", column: "last_price_sync" },
  {
    id: "sync-reviews",
    label: "Reviews sync status",
    column: "last_reviews_sync",
  },
  {
    id: "sync-histogram",
    label: "Histogram sync status",
    column: "last_histogram_sync",
  },
  {
    id: "sync-embedding",
    label: "Embedding sync status",
    column: "last_embedding_sync",
  },
  {
    id: "sync-priority",
    label: "Priority calculation status",
    column: "priority_calculated_at",
  },
  {
    id: "sync-velocity",
    label: "Velocity calculation status",
    column: "velocity_calculated_at",
  },
];

const SUPABASE_GUARD_CHECKS = [
  {
    id: "supabase-apps",
    label: "Supabase apps",
    schema: "public",
    table: "apps",
    timeColumns: ["updated_at", "created_at"],
  },
  {
    id: "supabase-daily-metrics",
    label: "Supabase daily_metrics",
    schema: "public",
    table: "daily_metrics",
    timeColumns: ["updated_at", "created_at", "metric_date"],
  },
  {
    id: "supabase-ccu-snapshots",
    label: "Supabase ccu_snapshots",
    schema: "public",
    table: "ccu_snapshots",
    timeColumns: ["created_at", "updated_at", "snapshot_time"],
  },
  {
    id: "supabase-ccu-tier-assignments",
    label: "Supabase ccu_tier_assignments",
    schema: "public",
    table: "ccu_tier_assignments",
    timeColumns: ["updated_at", "created_at", "last_ccu_synced"],
  },
  {
    id: "supabase-review-deltas",
    label: "Supabase review_deltas",
    schema: "public",
    table: "review_deltas",
    timeColumns: ["updated_at", "created_at", "delta_date"],
  },
  {
    id: "supabase-review-histogram",
    label: "Supabase review_histogram",
    schema: "public",
    table: "review_histogram",
    timeColumns: ["updated_at", "created_at", "fetched_at", "month_start"],
  },
  {
    id: "supabase-app-trends",
    label: "Supabase app_trends",
    schema: "public",
    table: "app_trends",
    timeColumns: ["updated_at", "created_at"],
  },
  {
    id: "supabase-sync-status",
    label: "Supabase sync_status",
    schema: "public",
    table: "sync_status",
    timeColumns: [
      "updated_at",
      "last_storefront_sync",
      "last_reviews_sync",
      "last_histogram_sync",
      "last_embedding_sync",
    ],
  },
  {
    id: "supabase-sync-jobs",
    label: "Supabase sync_jobs",
    schema: "public",
    table: "sync_jobs",
    timeColumns: ["updated_at", "created_at", "started_at", "completed_at"],
  },
  {
    id: "supabase-app-change-events",
    label: "Supabase app_change_events",
    schema: "public",
    table: "app_change_events",
    timeColumns: ["occurred_at", "created_at"],
  },
  {
    id: "supabase-steam-news-items",
    label: "Supabase steam_news_items",
    schema: "public",
    table: "steam_news_items",
    timeColumns: ["first_seen_at", "created_at"],
  },
  {
    id: "supabase-user-alerts",
    label: "Supabase user_alerts",
    schema: "public",
    table: "user_alerts",
    timeColumns: ["created_at", "updated_at"],
  },
];

function parseArgs(argv) {
  const options = {
    envFiles: [],
    days: 2,
    jobDays: 7,
    json: false,
    live: false,
    github: false,
    railway: false,
    supabase: false,
    supabaseBaseline: false,
    failOnGap: false,
    help: false,
    tigerUrl: null,
    supabaseUrl: null,
    cutover: null,
    compareSupabaseBaseline: null,
    railwayService: null,
    railwayEnvironment: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--live":
        options.live = true;
        break;
      case "--github":
        options.github = true;
        break;
      case "--railway":
        options.railway = true;
        break;
      case "--supabase":
        options.supabase = true;
        break;
      case "--supabase-baseline":
        options.supabaseBaseline = true;
        break;
      case "--compare-supabase-baseline":
        options.supabaseBaseline = true;
        options.compareSupabaseBaseline = requireValue(argv, ++index, arg);
        break;
      case "--fail-on-gap":
        options.failOnGap = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--env-file":
        options.envFiles.push(requireValue(argv, ++index, arg));
        break;
      case "--days":
        options.days = readPositiveInteger(
          requireValue(argv, ++index, arg),
          arg,
        );
        break;
      case "--job-days":
        options.jobDays = readPositiveInteger(
          requireValue(argv, ++index, arg),
          arg,
        );
        break;
      case "--tiger-url":
        options.tigerUrl = requireValue(argv, ++index, arg);
        break;
      case "--supabase-url":
        options.supabaseUrl = requireValue(argv, ++index, arg);
        break;
      case "--cutover":
        options.cutover = requireValue(argv, ++index, arg);
        break;
      case "--railway-service":
        options.railwayService = requireValue(argv, ++index, arg);
        break;
      case "--railway-environment":
        options.railwayEnvironment = requireValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return value;
}

function readPositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Tiger ingestion verifier

Usage:
  pnpm tiger:ingestion-verify
  pnpm tiger:ingestion-verify -- --live --env-file .env
  pnpm tiger:ingestion-verify -- --supabase-baseline --supabase-url "$DATABASE_URL" --json > /tmp/supabase-before.json
  pnpm tiger:ingestion-verify -- --supabase-baseline --compare-supabase-baseline /tmp/supabase-before.json --supabase-url "$DATABASE_URL"
  pnpm tiger:ingestion-verify -- --live --supabase --cutover 2026-04-30T00:00:00Z --env-file .env

Options:
  --live                      Run read-only Tiger SQL freshness checks.
  --env-file <path>           Load environment variables from a local file without overwriting existing env.
  --tiger-url <url>           Tiger Postgres URL. Defaults to TIGER_PRIMARY_URL/TIGER_PRODUCTION_URL.
  --supabase                  Run read-only Supabase inactivity guard checks. Requires --cutover.
  --supabase-baseline         Capture read-only Supabase row-count/max-value baseline evidence.
  --compare-supabase-baseline <path>
                              Compare current Supabase baseline against a prior JSON report.
  --supabase-url <url>        Supabase Postgres URL. Defaults to SUPABASE_DATABASE_URL/DATABASE_URL.
  --cutover <iso timestamp>   Timestamp after which Supabase product tables should remain unchanged.
  --github                    Add read-only latest GitHub Actions run metadata via gh.
  --railway                   Add read-only Railway variable checks via railway CLI.
  --railway-service <name>    Railway service name for --railway.
  --railway-environment <env> Railway environment name for --railway.
  --days <n>                  Recent-row freshness window for live table checks. Default: 2.
  --job-days <n>              Recent job lookback window. Default: 7.
  --json                      Print JSON instead of text.
  --fail-on-gap               Exit non-zero when static blockers or live freshness gaps are found.
`);
}

function loadEnvFile(relativeOrAbsolutePath) {
  const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(ROOT_DIR, relativeOrAbsolutePath);
  const text = fs.readFileSync(absolutePath, "utf8");
  const loaded = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseEnvValue(rawValue);
    loaded.push(key);
  }

  return {
    path: relativePath(absolutePath),
    loadedKeys: loaded.sort(),
  };
}

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
}

function relativePath(absolutePath) {
  return path.relative(ROOT_DIR, absolutePath).replaceAll(path.sep, "/");
}

function readTextIfExists(relativePathName) {
  const absolutePath = path.join(ROOT_DIR, relativePathName);
  return fs.existsSync(absolutePath)
    ? fs.readFileSync(absolutePath, "utf8")
    : null;
}

function readWorkflow(name) {
  return readTextIfExists(path.join(".github", "workflows", name));
}

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) {
    return [];
  }

  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

function detectTriggers(text) {
  return {
    schedule: /^\s*schedule\s*:/m.test(text) || /^\s*-\s*cron\s*:/m.test(text),
    workflowDispatch: /^\s*workflow_dispatch\s*:/m.test(text),
    push: /^\s*push\s*:/m.test(text),
    pullRequest: /^\s*pull_request\s*:/m.test(text),
  };
}

function findEnvValues(text, name) {
  const escapedName = escapeRegex(name);
  const values = [];
  const yamlPattern = new RegExp(`^\\s*${escapedName}:\\s*([^\\n#]+)`, "gm");
  let yamlMatch;

  while ((yamlMatch = yamlPattern.exec(text)) !== null) {
    values.push(cleanEnvValue(yamlMatch[1]));
  }

  const shellPattern = new RegExp(`\\b${escapedName}=([^\\s]+)`, "g");
  let shellMatch;

  while ((shellMatch = shellPattern.exec(text)) !== null) {
    values.push(cleanEnvValue(shellMatch[1]));
  }

  return [...new Set(values)];
}

function cleanEnvValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function containsEnv(text, name) {
  return (
    findEnvValues(text, name).length > 0 ||
    new RegExp(`\\b${escapeRegex(name)}\\b`).test(text)
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkTextPattern(text, pattern) {
  return pattern instanceof RegExp
    ? pattern.test(text)
    : text.includes(pattern);
}

function highestStatus(checks, fallback = "pass") {
  return checks.reduce((highest, check) => {
    if ((STATUS_RANK[check.status] ?? 0) > (STATUS_RANK[highest] ?? 0)) {
      return check.status;
    }
    return highest;
  }, fallback);
}

function addCheck(checks, status, message, detail = undefined) {
  checks.push(
    detail === undefined ? { status, message } : { status, message, detail },
  );
}

function analyzeWorkflowSource(source) {
  const text = readWorkflow(source.workflow);
  const checks = [];

  if (text === null) {
    addCheck(
      checks,
      source.category === REFERENCE_OR_DISABLED ? "info" : "fail",
      `Missing workflow ${source.workflow}.`,
    );
    return {
      ...source,
      kind: "workflow",
      path: `.github/workflows/${source.workflow}`,
      status: highestStatus(checks),
      checks,
      triggers: null,
      evidence: source.evidence ?? [],
    };
  }

  const triggers = detectTriggers(text);

  if (source.reason) {
    addCheck(checks, "info", source.reason);
  }

  if (source.schedule && !triggers.schedule) {
    addCheck(
      checks,
      source.category === REFERENCE_OR_DISABLED ? "info" : "fail",
      "Expected a scheduled trigger.",
    );
  } else if (source.schedule) {
    addCheck(checks, "pass", "Scheduled trigger is present.");
  }

  if (source.manual && !triggers.workflowDispatch) {
    addCheck(
      checks,
      source.category === REFERENCE_OR_DISABLED ? "info" : "fail",
      "Expected workflow_dispatch for manual runs.",
    );
  } else if (source.manual) {
    addCheck(checks, "pass", "Manual trigger is present.");
  }

  for (const [name, expected] of Object.entries(source.envEquals ?? {})) {
    const values = findEnvValues(text, name);
    if (values.includes(expected)) {
      addCheck(checks, "pass", `${name}=${expected}.`);
    } else {
      addCheck(
        checks,
        source.category === REFERENCE_OR_DISABLED ? "info" : "fail",
        `Expected ${name}=${expected}.`,
        values.length > 0 ? `found ${values.join(", ")}` : "not found",
      );
    }
  }

  for (const name of source.requiredEnv ?? []) {
    if (containsEnv(text, name)) {
      addCheck(checks, "pass", `${name} is configured.`);
    } else {
      addCheck(
        checks,
        source.category === REFERENCE_OR_DISABLED ? "info" : "fail",
        `Expected ${name} to be configured.`,
      );
    }
  }

  for (const name of source.warnEnv ?? []) {
    if (containsEnv(text, name)) {
      addCheck(
        checks,
        "warn",
        `${name} is present. Confirm this points to Tiger or is read-only reference data for this workflow.`,
      );
    }
  }

  if (source.optionalGate && containsEnv(text, source.optionalGate)) {
    addCheck(checks, "info", `Gate ${source.optionalGate} is present.`);
  } else if (source.optionalGate) {
    addCheck(
      checks,
      "warn",
      `Optional deployment gate ${source.optionalGate} is not visible in the workflow.`,
    );
  }

  for (const pattern of source.commands ?? []) {
    if (checkTextPattern(text, pattern)) {
      addCheck(checks, "pass", `Command pattern ${pattern} is present.`);
    } else {
      addCheck(
        checks,
        source.category === REFERENCE_OR_DISABLED ? "info" : "fail",
        `Missing command pattern ${pattern}.`,
      );
    }
  }

  if (
    SUPABASE_SERVICE_KEY_PATTERN.test(text) &&
    source.category !== REFERENCE_OR_DISABLED
  ) {
    addCheck(
      checks,
      "fail",
      "Supabase service credential is present on an active ingestion path.",
    );
  }

  const hasSupabaseDirectWrite =
    /\bDATABASE_URL\b/.test(text) &&
    /\bpsql\b/.test(text) &&
    WRITE_PATTERN.test(text);
  if (hasSupabaseDirectWrite && source.category !== REFERENCE_OR_DISABLED) {
    addCheck(
      checks,
      "fail",
      "Workflow appears to perform direct SQL writes through DATABASE_URL.",
    );
  }

  return {
    ...source,
    kind: "workflow",
    path: `.github/workflows/${source.workflow}`,
    status: highestStatus(checks),
    checks,
    triggers,
    evidence: source.evidence ?? [],
  };
}

function analyzeServiceSource(source, railwayVariables) {
  const manifestText = readTextIfExists(source.manifest);
  const envExampleText = source.envExample
    ? readTextIfExists(source.envExample)
    : null;
  const checks = [];

  if (manifestText === null) {
    addCheck(checks, "fail", `Missing service manifest ${source.manifest}.`);
  } else {
    addCheck(checks, "pass", `Service manifest ${source.manifest} exists.`);
  }

  if (envExampleText) {
    for (const [name, expected] of Object.entries(
      source.expectedEnvEquals ?? {},
    )) {
      const exampleValues = findEnvValues(envExampleText, name);
      if (exampleValues.includes(expected)) {
        addCheck(checks, "info", `.env.example documents ${name}=${expected}.`);
      } else {
        addCheck(
          checks,
          "warn",
          `.env.example does not default to ${name}=${expected}; production Railway variables must override it.`,
        );
      }
    }
  }

  if (railwayVariables) {
    for (const [name, expected] of Object.entries(
      source.expectedEnvEquals ?? {},
    )) {
      const actual = railwayVariables[name] ?? null;
      if (actual === expected) {
        addCheck(checks, "pass", `Railway ${name}=${expected}.`);
      } else {
        addCheck(
          checks,
          "fail",
          `Railway must set ${name}=${expected}.`,
          actual ? "different value present" : "not found",
        );
      }
    }

    for (const name of source.requiredEnv ?? []) {
      if (railwayVariables[name]) {
        addCheck(checks, "pass", `Railway ${name} is configured.`);
      } else {
        addCheck(checks, "fail", `Railway ${name} is missing.`);
      }
    }

    for (const group of source.requiredAnyEnv ?? []) {
      const found = group.some((name) => railwayVariables[name]);
      addCheck(
        checks,
        found ? "pass" : "fail",
        found
          ? `Railway has one of ${group.join(", ")}.`
          : `Railway needs one of ${group.join(", ")}.`,
      );
    }

    if (
      railwayVariables.SUPABASE_SERVICE_KEY ||
      railwayVariables.SUPABASE_SERVICE_ROLE_KEY
    ) {
      addCheck(
        checks,
        "fail",
        "Railway Supabase service credential is still present.",
      );
    }
  } else {
    addCheck(
      checks,
      "warn",
      "Railway production variables were not checked. Re-run with --railway for live env evidence.",
    );
  }

  return {
    ...source,
    kind: "service",
    path: source.manifest,
    status: highestStatus(checks),
    checks,
    evidence: source.evidence ?? [],
  };
}

function analyzeUnregisteredWorkflows(registeredWorkflowNames) {
  return listWorkflowFiles()
    .filter((fileName) => !registeredWorkflowNames.has(fileName))
    .map((fileName) => {
      const relativePathName = `.github/workflows/${fileName}`;
      const text = readTextIfExists(relativePathName) ?? "";
      const triggers = detectTriggers(text);
      const looksIngestionLike = STATIC_INGESTION_PATTERN.test(text);
      const checks = [];

      if (
        looksIngestionLike &&
        (triggers.schedule || triggers.workflowDispatch)
      ) {
        addCheck(
          checks,
          "warn",
          "Workflow looks ingestion-related but is not in the verifier registry.",
        );
      } else {
        addCheck(
          checks,
          "info",
          "Workflow is not registered as an ingestion source.",
        );
      }

      if (SUPABASE_SERVICE_KEY_PATTERN.test(text) && looksIngestionLike) {
        addCheck(
          checks,
          "fail",
          "Unregistered ingestion-like workflow references a Supabase service credential.",
        );
      }

      return {
        id: `unregistered:${fileName}`,
        label: fileName,
        category: "unregistered",
        kind: "workflow",
        path: relativePathName,
        status: highestStatus(checks),
        checks,
        triggers,
        evidence: [],
      };
    })
    .filter((item) =>
      item.checks.some(
        (check) => check.status === "warn" || check.status === "fail",
      ),
    );
}

function loadRailwayVariables(options) {
  if (!options.railway) {
    return null;
  }

  const args = ["variables", "--json"];
  if (options.railwayService) {
    args.push("--service", options.railwayService);
  }
  if (options.railwayEnvironment) {
    args.push("--environment", options.railwayEnvironment);
  }

  try {
    const stdout = execFileSync("railway", args, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      status: "pass",
      variables: JSON.parse(stdout),
      checks: [
        { status: "pass", message: "Read Railway variables with railway CLI." },
      ],
    };
  } catch (error) {
    return {
      status: "warn",
      variables: null,
      checks: [
        {
          status: "warn",
          message: "Could not read Railway variables.",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function collectGithubRuns(options, sources) {
  if (!options.github) {
    return {
      status: "skip",
      checks: [
        {
          status: "skip",
          message: "GitHub run metadata skipped. Re-run with --github.",
        },
      ],
      runs: [],
    };
  }

  const runs = [];
  const checks = [];
  const workflowSources = sources.filter(
    (source) => source.kind === "workflow" && source.workflow,
  );

  for (const source of workflowSources) {
    try {
      const stdout = execFileSync(
        "gh",
        [
          "run",
          "list",
          "--workflow",
          source.workflow,
          "--limit",
          "3",
          "--json",
          "databaseId,status,conclusion,createdAt,updatedAt,event,url,displayTitle",
        ],
        {
          cwd: ROOT_DIR,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const parsedRuns = JSON.parse(stdout);
      runs.push({
        sourceId: source.id,
        workflow: source.workflow,
        runs: parsedRuns,
      });
    } catch (error) {
      checks.push({
        status: "warn",
        message: `Could not read GitHub runs for ${source.workflow}.`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      status: "pass",
      message: "Read latest GitHub Actions run metadata.",
    });
  }

  return {
    status: highestStatus(checks),
    checks,
    runs,
  };
}

function getPg() {
  const requireFromDatabase = createRequire(
    path.join(ROOT_DIR, "packages", "database", "package.json"),
  );
  return requireFromDatabase("pg");
}

function resolveTigerUrl(options) {
  return (
    options.tigerUrl ??
    process.env.TIGER_PRIMARY_URL ??
    process.env.TIGER_PRODUCTION_URL ??
    process.env.CHANGE_INTEL_TIGER_URL ??
    null
  );
}

function resolveSupabaseUrl(options) {
  return (
    options.supabaseUrl ??
    process.env.SUPABASE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    null
  );
}

function makePool(connectionString, applicationName) {
  const { Pool } = getPg();
  return new Pool({
    application_name: applicationName,
    connectionString,
    max: 3,
    statement_timeout: 15_000,
    query_timeout: 20_000,
  });
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function tableSql(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function tableKey(schema, table) {
  return `${schema}.${table}`;
}

async function loadColumnMap(pool, tableSpecs) {
  const schemas = [...new Set(tableSpecs.map((spec) => spec.schema))];
  const tables = [...new Set(tableSpecs.map((spec) => spec.table))];
  const { rows } = await pool.query(
    `
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = ANY($1::text[])
        AND table_name = ANY($2::text[])
      ORDER BY table_schema, table_name, ordinal_position
    `,
    [schemas, tables],
  );
  const columns = new Map();

  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    if (!columns.has(key)) {
      columns.set(key, new Set());
    }
    columns.get(key).add(row.column_name);
  }

  return columns;
}

function tableExists(columns, schema, table) {
  return columns.has(tableKey(schema, table));
}

function hasColumn(columns, schema, table, column) {
  return columns.get(tableKey(schema, table))?.has(column) ?? false;
}

function firstAvailableColumn(columns, spec) {
  return (
    spec.timeColumns.find((column) =>
      hasColumn(columns, spec.schema, spec.table, column),
    ) ?? null
  );
}

function isDateOnlyFreshnessColumn(column) {
  return (
    column === "metric_date" ||
    column === "delta_date" ||
    column === "month_start" ||
    column.endsWith("_date")
  );
}

function comparableValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const stringValue = String(value);
  const parsed = new Date(stringValue);
  return Number.isNaN(parsed.getTime()) ? stringValue : parsed.toISOString();
}

function extractBaselineEntries(report) {
  const evidence =
    report?.supabaseBaseline?.evidence ??
    report?.baseline?.evidence ??
    report?.supabase?.baseline?.evidence ??
    [];
  const entries = new Map();

  for (const item of evidence) {
    const row = item?.rows?.[0];
    if (row?.table) {
      entries.set(row.table, row);
    }
  }

  return entries;
}

async function collectTableFreshness(pool, columns, spec, days) {
  if (!tableExists(columns, spec.schema, spec.table)) {
    return {
      id: spec.id,
      label: spec.label,
      status: "warn",
      checks: [
        {
          status: "warn",
          message: `Missing Tiger table ${tableKey(spec.schema, spec.table)}.`,
        },
      ],
      rows: [],
    };
  }

  const selectedTimeColumn = firstAvailableColumn(columns, spec);
  if (!selectedTimeColumn) {
    return {
      id: spec.id,
      label: spec.label,
      status: "warn",
      checks: [
        {
          status: "warn",
          message: `No expected freshness column on ${tableKey(spec.schema, spec.table)}.`,
        },
      ],
      rows: [],
    };
  }

  const relation = tableSql(spec.schema, spec.table);
  const timeColumn = quoteIdent(selectedTimeColumn);
  const countResult = await pool.query(
    `SELECT count(*)::bigint AS total_rows FROM ${relation}`,
  );
  const latestResult = await pool.query(
    `SELECT max(${timeColumn}) AS latest_at FROM ${relation}`,
  );
  const recentResult = await pool.query(
    `SELECT count(*)::bigint AS recent_rows FROM ${relation} WHERE ${timeColumn} >= now() - ($1::int * interval '1 day')`,
    [days],
  );
  const latestAt = latestResult.rows[0]?.latest_at ?? null;
  const totalRows = countResult.rows[0]?.total_rows ?? "0";
  const recentRows = recentResult.rows[0]?.recent_rows ?? "0";
  const checks = [];

  if (latestAt === null) {
    addCheck(
      checks,
      "warn",
      `No freshness value found in ${tableKey(spec.schema, spec.table)}.${selectedTimeColumn}.`,
    );
  } else if (Number(recentRows) > 0) {
    addCheck(
      checks,
      "pass",
      `${recentRows} rows updated in the last ${days} day(s).`,
    );
  } else {
    addCheck(checks, "warn", `No rows updated in the last ${days} day(s).`);
  }

  const rows = [
    {
      table: tableKey(spec.schema, spec.table),
      timeColumn: selectedTimeColumn,
      latestAt,
      totalRows,
      recentRows,
    },
  ];

  if (
    spec.groupColumn &&
    hasColumn(columns, spec.schema, spec.table, spec.groupColumn)
  ) {
    const groupColumn = quoteIdent(spec.groupColumn);
    const groupedResult = await pool.query(
      `
        SELECT
          coalesce(${groupColumn}::text, '(null)') AS group_value,
          max(${timeColumn}) AS latest_at,
          count(*)::bigint AS total_rows,
          count(*) FILTER (WHERE ${timeColumn} >= now() - ($1::int * interval '1 day'))::bigint AS recent_rows
        FROM ${relation}
        GROUP BY 1
        ORDER BY latest_at DESC NULLS LAST
        LIMIT 20
      `,
      [days],
    );
    rows[0].groups = groupedResult.rows;
  }

  return {
    id: spec.id,
    label: spec.label,
    status: highestStatus(checks),
    checks,
    rows,
  };
}

async function collectSyncStatusFreshness(pool, columns, days) {
  const schema = "ops";
  const table = "sync_status";
  if (!tableExists(columns, schema, table)) {
    return {
      id: "sync-status-columns",
      label: "Sync status freshness",
      status: "warn",
      checks: [
        { status: "warn", message: "Missing Tiger table ops.sync_status." },
      ],
      rows: [],
    };
  }

  const rows = [];
  const checks = [];

  for (const item of SYNC_STATUS_COLUMNS) {
    if (!hasColumn(columns, schema, table, item.column)) {
      addCheck(checks, "warn", `ops.sync_status.${item.column} is missing.`);
      rows.push({
        id: item.id,
        label: item.label,
        column: item.column,
        status: "missing-column",
      });
      continue;
    }

    const column = quoteIdent(item.column);
    const result = await pool.query(
      `
        SELECT
          max(${column}) AS latest_at,
          count(*) FILTER (WHERE ${column} IS NOT NULL)::bigint AS populated_rows,
          count(*) FILTER (WHERE ${column} >= now() - ($1::int * interval '1 day'))::bigint AS recent_rows
        FROM ops.sync_status
      `,
      [days],
    );
    const row = result.rows[0] ?? {};
    rows.push({
      id: item.id,
      label: item.label,
      column: item.column,
      latestAt: row.latest_at ?? null,
      populatedRows: row.populated_rows ?? "0",
      recentRows: row.recent_rows ?? "0",
    });
  }

  const populatedRecent = rows.filter(
    (row) => Number(row.recentRows ?? 0) > 0,
  ).length;
  if (populatedRecent > 0) {
    addCheck(
      checks,
      "pass",
      `${populatedRecent} sync-status columns have rows in the last ${days} day(s).`,
    );
  } else {
    addCheck(
      checks,
      "warn",
      `No sync-status columns have rows in the last ${days} day(s).`,
    );
  }

  return {
    id: "sync-status-columns",
    label: "Sync status freshness",
    status: highestStatus(checks),
    checks,
    rows,
  };
}

async function collectSyncJobs(pool, columns, days) {
  if (!tableExists(columns, "ops", "sync_jobs")) {
    return {
      id: "sync-jobs",
      label: "Worker sync jobs",
      status: "warn",
      checks: [
        { status: "warn", message: "Missing Tiger table ops.sync_jobs." },
      ],
      rows: [],
    };
  }

  const expectedJobTypes = [
    ...new Set(WORKFLOW_SOURCES.flatMap((source) => source.liveJobTypes ?? [])),
  ].filter(Boolean);
  const result = await pool.query(
    `
      WITH ranked AS (
        SELECT
          job_type,
          status,
          started_at,
          completed_at,
          items_processed,
          items_succeeded,
          items_failed,
          items_created,
          items_updated,
          items_skipped,
          error_message,
          row_number() OVER (PARTITION BY job_type ORDER BY started_at DESC NULLS LAST, created_at DESC NULLS LAST) AS rn
        FROM ops.sync_jobs
        WHERE started_at >= now() - ($1::int * interval '1 day')
      )
      SELECT *
      FROM ranked
      WHERE rn = 1
      ORDER BY job_type
      LIMIT 100
    `,
    [days],
  );
  const seenTypes = new Set(result.rows.map((row) => row.job_type));
  const missingTypes = expectedJobTypes.filter((type) => !seenTypes.has(type));
  const checks = [];

  if (result.rows.length > 0) {
    addCheck(
      checks,
      "pass",
      `${result.rows.length} worker job type(s) have recent Tiger job rows.`,
    );
  } else {
    addCheck(
      checks,
      "warn",
      `No ops.sync_jobs rows started in the last ${days} day(s).`,
    );
  }

  if (missingTypes.length > 0) {
    addCheck(
      checks,
      "warn",
      `${missingTypes.length} expected job type(s) are missing from recent ops.sync_jobs.`,
      missingTypes.join(", "),
    );
  }

  return {
    id: "sync-jobs",
    label: "Worker sync jobs",
    status: highestStatus(checks),
    checks,
    rows: result.rows,
  };
}

async function collectChangeIntelJobs(pool, columns, days) {
  if (!tableExists(columns, "ops", "change_intel_sync_jobs")) {
    return {
      id: "change-intel-jobs",
      label: "Change-intel sync jobs",
      status: "warn",
      checks: [
        {
          status: "warn",
          message: "Missing Tiger table ops.change_intel_sync_jobs.",
        },
      ],
      rows: [],
    };
  }

  const expectedJobTypes = [
    ...new Set(
      WORKFLOW_SOURCES.flatMap((source) => source.changeIntelJobTypes ?? []),
    ),
  ].filter(Boolean);
  const result = await pool.query(
    `
      WITH ranked AS (
        SELECT
          job_type,
          status,
          started_at,
          completed_at,
          items_processed,
          items_succeeded,
          items_failed,
          items_created,
          items_updated,
          items_skipped,
          error_message,
          row_number() OVER (PARTITION BY job_type ORDER BY started_at DESC NULLS LAST, created_at DESC NULLS LAST) AS rn
        FROM ops.change_intel_sync_jobs
        WHERE started_at >= now() - ($1::int * interval '1 day')
      )
      SELECT *
      FROM ranked
      WHERE rn = 1
      ORDER BY job_type
      LIMIT 100
    `,
    [days],
  );
  const seenTypes = new Set(result.rows.map((row) => row.job_type));
  const missingTypes = expectedJobTypes.filter((type) => !seenTypes.has(type));
  const checks = [];

  if (result.rows.length > 0) {
    addCheck(
      checks,
      "pass",
      `${result.rows.length} change-intel job type(s) have recent Tiger rows.`,
    );
  } else {
    addCheck(
      checks,
      "warn",
      `No ops.change_intel_sync_jobs rows started in the last ${days} day(s).`,
    );
  }

  if (missingTypes.length > 0) {
    addCheck(
      checks,
      "warn",
      `${missingTypes.length} expected change-intel job type(s) are missing from recent rows.`,
      missingTypes.join(", "),
    );
  }

  return {
    id: "change-intel-jobs",
    label: "Change-intel sync jobs",
    status: highestStatus(checks),
    checks,
    rows: result.rows,
  };
}

async function collectTigerLiveEvidence(options) {
  if (!options.live) {
    return {
      status: "skip",
      checks: [
        {
          status: "skip",
          message: "Tiger SQL freshness checks skipped. Re-run with --live.",
        },
      ],
      evidence: [],
    };
  }

  const connectionString = resolveTigerUrl(options);
  if (!connectionString) {
    return {
      status: "warn",
      checks: [
        {
          status: "warn",
          message:
            "No Tiger connection string found. Set TIGER_PRIMARY_URL/TIGER_PRODUCTION_URL or pass --tiger-url.",
        },
      ],
      evidence: [],
    };
  }

  const pool = makePool(connectionString, "publisheriq-tiger-ingestion-verify");
  const checks = [];
  const evidence = [];

  try {
    const columns = await loadColumnMap(pool, TIGER_TABLE_SPECS);
    const missingTables = TIGER_TABLE_SPECS.filter(
      (spec) => !tableExists(columns, spec.schema, spec.table),
    );

    if (missingTables.length > 0) {
      addCheck(
        checks,
        "warn",
        `${missingTables.length} expected Tiger table(s) are missing.`,
        missingTables
          .map((spec) => tableKey(spec.schema, spec.table))
          .join(", "),
      );
    } else {
      addCheck(
        checks,
        "pass",
        "All expected Tiger ingestion tables are present.",
      );
    }

    evidence.push(await collectSyncJobs(pool, columns, options.jobDays));
    evidence.push(await collectChangeIntelJobs(pool, columns, options.jobDays));
    evidence.push(
      await collectSyncStatusFreshness(pool, columns, options.days),
    );

    for (const spec of TABLE_FRESHNESS_CHECKS) {
      evidence.push(
        await collectTableFreshness(pool, columns, spec, options.days),
      );
    }
  } catch (error) {
    addCheck(
      checks,
      "fail",
      "Tiger SQL verification failed.",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await pool.end();
  }

  const evidenceStatus = highestStatus(
    evidence.map((item) => ({ status: item.status, message: item.label })),
  );
  const status = highestStatus([
    ...checks,
    { status: evidenceStatus, message: "Tiger live evidence status." },
  ]);

  return {
    status,
    checks,
    evidence,
  };
}

async function collectSupabaseGuard(options) {
  if (!options.supabase) {
    return {
      status: "skip",
      checks: [
        {
          status: "skip",
          message:
            "Supabase inactivity guard skipped. Re-run with --supabase --cutover <timestamp>.",
        },
      ],
      evidence: [],
    };
  }

  const cutover =
    options.cutover ?? process.env.TIGER_CUTOVER_TIMESTAMP ?? null;
  if (!cutover || Number.isNaN(Date.parse(cutover))) {
    return {
      status: "warn",
      checks: [
        {
          status: "warn",
          message:
            "Supabase guard requires --cutover or TIGER_CUTOVER_TIMESTAMP.",
        },
      ],
      evidence: [],
    };
  }

  const connectionString = resolveSupabaseUrl(options);
  if (!connectionString) {
    return {
      status: "warn",
      checks: [
        {
          status: "warn",
          message:
            "No Supabase connection string found. Set SUPABASE_DATABASE_URL/DATABASE_URL or pass --supabase-url.",
        },
      ],
      evidence: [],
    };
  }

  const pool = makePool(
    connectionString,
    "publisheriq-supabase-ingestion-guard",
  );
  const checks = [];
  const evidence = [];

  try {
    const columns = await loadColumnMap(pool, SUPABASE_GUARD_CHECKS);

    for (const spec of SUPABASE_GUARD_CHECKS) {
      evidence.push(
        await collectSupabaseTableGuard(pool, columns, spec, cutover),
      );
    }
  } catch (error) {
    addCheck(
      checks,
      "fail",
      "Supabase guard failed.",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await pool.end();
  }

  const evidenceStatus = highestStatus(
    evidence.map((item) => ({ status: item.status, message: item.label })),
  );
  const status = highestStatus([
    ...checks,
    { status: evidenceStatus, message: "Supabase guard status." },
  ]);

  return {
    status,
    checks,
    cutover,
    evidence,
  };
}

async function collectSupabaseBaseline(options) {
  if (!options.supabaseBaseline) {
    return {
      status: "skip",
      checks: [
        {
          status: "skip",
          message:
            "Supabase baseline skipped. Re-run with --supabase-baseline.",
        },
      ],
      evidence: [],
    };
  }

  const connectionString = resolveSupabaseUrl(options);
  if (!connectionString) {
    return {
      status: "warn",
      checks: [
        {
          status: "warn",
          message:
            "No Supabase connection string found. Set SUPABASE_DATABASE_URL/DATABASE_URL or pass --supabase-url.",
        },
      ],
      evidence: [],
    };
  }

  let previousEntries = null;
  const checks = [];
  if (options.compareSupabaseBaseline) {
    try {
      const baselinePath = path.isAbsolute(options.compareSupabaseBaseline)
        ? options.compareSupabaseBaseline
        : path.join(ROOT_DIR, options.compareSupabaseBaseline);
      previousEntries = extractBaselineEntries(
        JSON.parse(fs.readFileSync(baselinePath, "utf8")),
      );
      addCheck(
        checks,
        "pass",
        `Loaded Supabase baseline comparison file ${relativePath(baselinePath)}.`,
      );
    } catch (error) {
      addCheck(
        checks,
        "fail",
        "Could not load Supabase baseline comparison file.",
        error instanceof Error ? error.message : String(error),
      );
      return {
        status: highestStatus(checks),
        checks,
        evidence: [],
      };
    }
  }

  const pool = makePool(connectionString, "publisheriq-supabase-baseline");
  const evidence = [];

  try {
    const columns = await loadColumnMap(pool, SUPABASE_GUARD_CHECKS);

    for (const spec of SUPABASE_GUARD_CHECKS) {
      evidence.push(
        await collectSupabaseTableBaseline(
          pool,
          columns,
          spec,
          previousEntries,
        ),
      );
    }
  } catch (error) {
    addCheck(
      checks,
      "fail",
      "Supabase baseline failed.",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await pool.end();
  }

  const evidenceStatus = highestStatus(
    evidence.map((item) => ({ status: item.status, message: item.label })),
  );
  const status = highestStatus([
    ...checks,
    { status: evidenceStatus, message: "Supabase baseline status." },
  ]);

  return {
    status,
    checks,
    evidence,
  };
}

async function collectSupabaseTableBaseline(
  pool,
  columns,
  spec,
  previousEntries,
) {
  if (!tableExists(columns, spec.schema, spec.table)) {
    return {
      id: `${spec.id}-baseline`,
      label: `${spec.label} baseline`,
      status: "info",
      checks: [
        {
          status: "info",
          message: `Supabase table ${tableKey(spec.schema, spec.table)} is not present.`,
        },
      ],
      rows: [],
    };
  }

  const selectedTimeColumn = firstAvailableColumn(columns, spec);
  const relation = tableSql(spec.schema, spec.table);
  const selectedFields = ["count(*)::bigint AS total_rows"];

  if (selectedTimeColumn) {
    selectedFields.push(`max(${quoteIdent(selectedTimeColumn)}) AS latest_at`);
  } else {
    selectedFields.push("NULL::timestamptz AS latest_at");
  }

  if (hasColumn(columns, spec.schema, spec.table, "id")) {
    selectedFields.push('max("id"::text) AS max_id');
  } else {
    selectedFields.push("NULL::text AS max_id");
  }

  const result = await pool.query(`
    SELECT
      ${selectedFields.join(",\n      ")}
    FROM ${relation}
  `);
  const row = result.rows[0] ?? {};
  const table = tableKey(spec.schema, spec.table);
  const baselineRow = {
    table,
    timeColumn: selectedTimeColumn,
    totalRows: row.total_rows ?? "0",
    maxId: row.max_id ?? null,
    latestAt: row.latest_at ?? null,
  };
  const checks = [];

  addCheck(
    checks,
    "pass",
    `Captured baseline for ${table}.`,
    `rows=${baselineRow.totalRows}, max_id=${baselineRow.maxId ?? "(none)"}`,
  );

  if (selectedTimeColumn && isDateOnlyFreshnessColumn(selectedTimeColumn)) {
    addCheck(
      checks,
      "warn",
      `${table}.${selectedTimeColumn} is date-only; row count/max id comparison cannot detect updates to existing rows.`,
    );
  }

  const previous = previousEntries?.get(table);
  if (previous) {
    compareBaselineValue(
      checks,
      table,
      "totalRows",
      previous.totalRows,
      baselineRow.totalRows,
    );
    compareBaselineValue(
      checks,
      table,
      "maxId",
      previous.maxId,
      baselineRow.maxId,
    );
    compareBaselineValue(
      checks,
      table,
      "latestAt",
      previous.latestAt,
      baselineRow.latestAt,
    );
  } else if (previousEntries) {
    addCheck(checks, "warn", `No previous baseline entry found for ${table}.`);
  }

  return {
    id: `${spec.id}-baseline`,
    label: `${spec.label} baseline`,
    status: highestStatus(checks),
    checks,
    rows: [baselineRow],
  };
}

function compareBaselineValue(
  checks,
  table,
  field,
  previousValue,
  currentValue,
) {
  const previousComparable = comparableValue(previousValue);
  const currentComparable = comparableValue(currentValue);

  if (previousComparable === currentComparable) {
    addCheck(checks, "pass", `${table}.${field} is unchanged.`);
    return;
  }

  addCheck(
    checks,
    "fail",
    `${table}.${field} changed since baseline.`,
    `before=${previousComparable ?? "(null)"}, after=${currentComparable ?? "(null)"}`,
  );
}

async function collectSupabaseTableGuard(pool, columns, spec, cutover) {
  if (!tableExists(columns, spec.schema, spec.table)) {
    return {
      id: spec.id,
      label: spec.label,
      status: "info",
      checks: [
        {
          status: "info",
          message: `Supabase table ${tableKey(spec.schema, spec.table)} is not present.`,
        },
      ],
      rows: [],
    };
  }

  const selectedTimeColumn = firstAvailableColumn(columns, spec);
  if (!selectedTimeColumn) {
    return {
      id: spec.id,
      label: spec.label,
      status: "warn",
      checks: [
        {
          status: "warn",
          message: `No expected timestamp/date column on ${tableKey(spec.schema, spec.table)}.`,
        },
      ],
      rows: [],
    };
  }

  const relation = tableSql(spec.schema, spec.table);
  const timeColumn = quoteIdent(selectedTimeColumn);
  const dateOnlyColumn = isDateOnlyFreshnessColumn(selectedTimeColumn);
  const cutoffCast = dateOnlyColumn ? "date" : "timestamptz";
  const result = await pool.query(
    `
      SELECT
        count(*)::bigint AS rows_after_cutover,
        max(${timeColumn}) AS latest_at
      FROM ${relation}
      WHERE ${timeColumn} >= $1::${cutoffCast}
    `,
    [cutover],
  );
  const row = result.rows[0] ?? {};
  const rowsAfterCutover = Number(row.rows_after_cutover ?? 0);
  const checks = [];

  if (dateOnlyColumn) {
    addCheck(
      checks,
      rowsAfterCutover > 0 ? "warn" : "pass",
      rowsAfterCutover > 0
        ? `${selectedTimeColumn} is date-only; ${rowsAfterCutover} row(s) fall on/after the cutover date, but this does not prove a post-cutover write. Use --supabase-baseline before and after smoke runs.`
        : `No date-keyed rows found at or after the cutover date on ${tableKey(spec.schema, spec.table)}.`,
      row.latest_at ? `latest ${formatDate(row.latest_at)}` : undefined,
    );
  } else if (rowsAfterCutover > 0) {
    addCheck(
      checks,
      "fail",
      `${rowsAfterCutover} row(s) have ${selectedTimeColumn} at or after cutover.`,
      row.latest_at ? `latest ${formatDate(row.latest_at)}` : undefined,
    );
  } else {
    addCheck(
      checks,
      "pass",
      `No rows found at or after cutover on ${tableKey(spec.schema, spec.table)}.`,
    );
  }

  return {
    id: spec.id,
    label: spec.label,
    status: highestStatus(checks),
    checks,
    rows: [
      {
        table: tableKey(spec.schema, spec.table),
        timeColumn: selectedTimeColumn,
        rowsAfterCutover: row.rows_after_cutover ?? "0",
        latestAt: row.latest_at ?? null,
      },
    ],
  };
}

function formatDate(value) {
  if (!value) {
    return "(none)";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function summarizeStatus(items) {
  const summary = { pass: 0, info: 0, warn: 0, fail: 0, skip: 0 };
  for (const item of items) {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
  }
  return summary;
}

function collectStaticReport(railwayVariables) {
  const workflowSources = WORKFLOW_SOURCES.map(analyzeWorkflowSource);
  const serviceSources = SERVICE_SOURCES.map((source) =>
    analyzeServiceSource(source, railwayVariables),
  );
  const registeredWorkflowNames = new Set(
    WORKFLOW_SOURCES.map((source) => source.workflow).filter(Boolean),
  );
  const unregisteredWorkflows = analyzeUnregisteredWorkflows(
    registeredWorkflowNames,
  );

  return {
    sources: [...workflowSources, ...serviceSources, ...unregisteredWorkflows],
    summary: summarizeStatus([
      ...workflowSources,
      ...serviceSources,
      ...unregisteredWorkflows,
    ]),
  };
}

async function collectReport(options, envLoads) {
  const railway = loadRailwayVariables(options);
  const staticReport = collectStaticReport(railway?.variables ?? null);
  const github = collectGithubRuns(options, staticReport.sources);
  const tiger = await collectTigerLiveEvidence(options);
  const supabase = await collectSupabaseGuard(options);
  const supabaseBaseline = await collectSupabaseBaseline(options);
  const statuses = [
    ...staticReport.sources.map((source) => source.status),
    railway?.status ?? "skip",
    github.status,
    tiger.status,
    supabase.status,
    supabaseBaseline.status,
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: {
      live: options.live,
      github: options.github,
      railway: options.railway,
      supabase: options.supabase,
      supabaseBaseline: options.supabaseBaseline,
      failOnGap: options.failOnGap,
      days: options.days,
      jobDays: options.jobDays,
    },
    envLoads,
    summary: {
      overallStatus: statuses.reduce((highest, status) => {
        if ((STATUS_RANK[status] ?? 0) > (STATUS_RANK[highest] ?? 0)) {
          return status;
        }
        return highest;
      }, "pass"),
      static: staticReport.summary,
      liveTiger: tiger.status,
      supabaseGuard: supabase.status,
      supabaseBaseline: supabaseBaseline.status,
      github: github.status,
      railway: railway?.status ?? "skip",
    },
    static: staticReport,
    railway: railway
      ? {
          status: railway.status,
          checks: railway.checks,
          checked: Boolean(railway.variables),
          variableKeys: railway.variables
            ? Object.keys(railway.variables).sort()
            : [],
        }
      : {
          status: "skip",
          checks: [
            {
              status: "skip",
              message: "Railway variables skipped. Re-run with --railway.",
            },
          ],
          checked: false,
          variableKeys: [],
        },
    github,
    tiger,
    supabase,
    supabaseBaseline,
  };
}

function printChecks(checks, indent = "    ") {
  for (const check of checks) {
    if (check.status === "pass") {
      continue;
    }
    console.log(
      `${indent}- [${check.status}] ${check.message}${check.detail ? ` (${check.detail})` : ""}`,
    );
  }
}

function printSourceSection(title, sources) {
  console.log(`\n${title}`);
  if (sources.length === 0) {
    console.log("  none");
    return;
  }

  for (const source of sources) {
    console.log(`  [${source.status}] ${source.label} - ${source.path}`);
    printChecks(source.checks);
    if (source.evidence?.length > 0 && source.status !== "pass") {
      console.log(`    evidence: ${source.evidence.join(", ")}`);
    }
  }
}

function printEvidenceSection(title, section) {
  console.log(`\n${title}`);
  printChecks(section.checks ?? [], "  ");
  if (!section.evidence || section.evidence.length === 0) {
    if (section.status === "skip") {
      console.log("  skipped");
    }
    return;
  }

  for (const item of section.evidence) {
    console.log(`  [${item.status}] ${item.label}`);
    printChecks(item.checks);
    const firstRows = (item.rows ?? []).slice(0, 5);
    for (const row of firstRows) {
      const details = [];
      if (row.table) {
        details.push(row.table);
      }
      if (row.job_type) {
        details.push(`job_type=${row.job_type}`);
      }
      if (row.status && row.job_type) {
        details.push(`status=${row.status}`);
      }
      if (row.timeColumn) {
        details.push(`column=${row.timeColumn}`);
      }
      if (row.latestAt || row.latest_at) {
        details.push(`latest=${formatDate(row.latestAt ?? row.latest_at)}`);
      }
      if (row.totalRows !== undefined) {
        details.push(`rows=${row.totalRows}`);
      }
      if (row.maxId !== undefined && row.maxId !== null) {
        details.push(`max_id=${row.maxId}`);
      }
      if (row.recentRows !== undefined) {
        details.push(`recent=${row.recentRows}`);
      }
      if (row.rowsAfterCutover !== undefined) {
        details.push(`after_cutover=${row.rowsAfterCutover}`);
      }
      if (details.length > 0) {
        console.log(`    ${details.join(", ")}`);
      }
    }
  }
}

function printHumanReport(report) {
  console.log("Tiger Ingestion Verification");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(
    `Mode: static${report.mode.live ? "+live" : ""}${report.mode.github ? "+github" : ""}${report.mode.railway ? "+railway" : ""}${report.mode.supabase ? "+supabase-guard" : ""}${report.mode.supabaseBaseline ? "+supabase-baseline" : ""}`,
  );
  console.log(
    `Summary: overall=${report.summary.overallStatus}, static fail=${report.summary.static.fail}, warn=${report.summary.static.warn}, liveTiger=${report.summary.liveTiger}, supabase=${report.summary.supabaseGuard}, baseline=${report.summary.supabaseBaseline}`,
  );

  if (report.envLoads.length > 0) {
    console.log(
      `Env files loaded: ${report.envLoads.map((item) => item.path).join(", ")}`,
    );
  }

  const sources = report.static.sources;
  printSourceSection(
    "External Scheduled Sources",
    sources.filter((source) => source.category === EXTERNAL_SCHEDULED),
  );
  printSourceSection(
    "External Manual Sources",
    sources.filter((source) => source.category === EXTERNAL_MANUAL),
  );
  printSourceSection(
    "External Services",
    sources.filter((source) => source.category === EXTERNAL_SERVICE),
  );
  printSourceSection(
    "Derived Scheduled Jobs",
    sources.filter((source) => source.category === DERIVED_SCHEDULED),
  );
  printSourceSection(
    "Reference Or Disabled Paths",
    sources.filter(
      (source) =>
        source.category === REFERENCE_OR_DISABLED && source.status !== "pass",
    ),
  );
  printSourceSection(
    "Unregistered Ingestion-Like Workflows",
    sources.filter((source) => source.category === "unregistered"),
  );

  printEvidenceSection("Tiger Live Evidence", report.tiger);
  printEvidenceSection("Supabase Inactivity Guard", report.supabase);
  printEvidenceSection("Supabase Baseline", report.supabaseBaseline);

  console.log("\nOptional Tooling");
  printChecks(report.github.checks, "  ");
  printChecks(report.railway.checks, "  ");
}

function shouldFail(report) {
  if (!report.mode.failOnGap) {
    return false;
  }

  return report.summary.overallStatus === "fail";
}

async function main() {
  const options = parseArgs(
    process.argv.slice(2).filter((arg) => arg !== "--"),
  );
  if (options.help) {
    printHelp();
    return;
  }

  const envLoads = options.envFiles.map(loadEnvFile);
  const report = await collectReport(options, envLoads);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  if (shouldFail(report)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
