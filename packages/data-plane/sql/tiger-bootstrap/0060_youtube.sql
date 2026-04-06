-- Phase 7 Tiger bootstrap for the YouTube collector foundation.
-- Creates the first YouTube-specific ops, docs, events, and metrics slices.

CREATE TABLE IF NOT EXISTS ops.youtube_game_routing (
    appid integer PRIMARY KEY,
    app_name text NOT NULL,
    routing_state text NOT NULL DEFAULT 'active_baseline_daily',
    source_priority_score integer,
    source_refresh_tier text,
    query_template_id text,
    discovery_cursor_published_after timestamp with time zone,
    last_search_run_at timestamp with time zone,
    last_successful_discovery_at timestamp with time zone,
    next_discovery_at timestamp with time zone NOT NULL DEFAULT now(),
    suppress_reason text,
    boost_reason text,
    allow_second_page boolean NOT NULL DEFAULT false,
    manual_override_applied boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_game_routing_state_check CHECK (
      routing_state = ANY (
        ARRAY[
          'escalated'::text,
          'active_baseline_daily'::text,
          'active_baseline_rotating'::text,
          'evergreen_baseline'::text,
          'suppressed'::text
        ]
      )
    )
);

COMMENT ON TABLE ops.youtube_game_routing IS 'Per-game YouTube routing state for Steam-tracked games.';
COMMENT ON COLUMN ops.youtube_game_routing.appid IS 'Steam appid used as the authoritative game key for YouTube collection.';
COMMENT ON COLUMN ops.youtube_game_routing.discovery_cursor_published_after IS 'Discovery cursor used to resume sparse YouTube search for this game.';

CREATE INDEX IF NOT EXISTS idx_ops_youtube_game_routing_state_next
  ON ops.youtube_game_routing (routing_state, next_discovery_at, appid);
CREATE INDEX IF NOT EXISTS idx_ops_youtube_game_routing_priority
  ON ops.youtube_game_routing (source_priority_score DESC, next_discovery_at, appid)
  WHERE source_priority_score IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops.youtube_search_runs (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    run_kind text NOT NULL DEFAULT 'search',
    query_template_id text,
    query_text text,
    negative_keywords text[] NOT NULL DEFAULT '{}'::text[],
    playlist_id text,
    published_after timestamp with time zone,
    page_token text,
    page_number integer NOT NULL DEFAULT 1,
    search_order text,
    requested_at timestamp with time zone NOT NULL DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    status text NOT NULL DEFAULT 'pending',
    quota_units integer NOT NULL DEFAULT 0,
    result_count integer NOT NULL DEFAULT 0,
    response_total_results integer,
    response_etag text,
    response_next_page_token text,
    error_message text,
    retry_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_search_runs_kind_check CHECK (run_kind = ANY (ARRAY['search'::text, 'playlist'::text])),
    CONSTRAINT youtube_search_runs_status_check CHECK (
      status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text])
    )
);

COMMENT ON TABLE ops.youtube_search_runs IS 'Stateful YouTube collection runs for search and playlist polling.';
COMMENT ON COLUMN ops.youtube_search_runs.query_template_id IS 'Identifier for the exact query template used for the run when run_kind = search.';
COMMENT ON COLUMN ops.youtube_search_runs.playlist_id IS 'Uploads playlist ID when run_kind = playlist.';

CREATE INDEX IF NOT EXISTS idx_ops_youtube_search_runs_appid_requested
  ON ops.youtube_search_runs (appid, requested_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ops_youtube_search_runs_status_requested
  ON ops.youtube_search_runs (status, requested_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ops_youtube_search_runs_kind_requested
  ON ops.youtube_search_runs (run_kind, requested_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ops.youtube_channel_monitors (
    appid integer NOT NULL,
    channel_id text NOT NULL,
    channel_title text,
    uploads_playlist_id text,
    monitor_state text NOT NULL DEFAULT 'active',
    first_matched_at timestamp with time zone,
    last_matched_at timestamp with time zone,
    last_playlist_poll_at timestamp with time zone,
    next_playlist_poll_at timestamp with time zone NOT NULL DEFAULT now(),
    last_hydrated_at timestamp with time zone,
    last_seen_video_published_at timestamp with time zone,
    match_count_30d integer NOT NULL DEFAULT 0,
    manual_override_applied boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_channel_monitors_pkey PRIMARY KEY (appid, channel_id),
    CONSTRAINT youtube_channel_monitors_state_check CHECK (
      monitor_state = ANY (ARRAY['active'::text, 'paused'::text, 'disabled'::text])
    )
);

COMMENT ON TABLE ops.youtube_channel_monitors IS 'Monitored creator channels for game-specific uploads playlist polling.';

CREATE INDEX IF NOT EXISTS idx_ops_youtube_channel_monitors_next_poll
  ON ops.youtube_channel_monitors (monitor_state, next_playlist_poll_at, appid);
CREATE INDEX IF NOT EXISTS idx_ops_youtube_channel_monitors_uploads_playlist
  ON ops.youtube_channel_monitors (uploads_playlist_id)
  WHERE uploads_playlist_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops.youtube_game_overrides (
    appid integer PRIMARY KEY,
    override_state text NOT NULL DEFAULT 'allowlisted',
    override_reason text,
    override_priority_delta integer,
    override_query_template_id text,
    allow_second_page boolean NOT NULL DEFAULT false,
    manual_override_applied boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_game_overrides_state_check CHECK (
      override_state = ANY (ARRAY['allowlisted'::text, 'suppressed'::text, 'boosted'::text, 'manual_lane'::text])
    )
);

COMMENT ON TABLE ops.youtube_game_overrides IS 'Manual per-game override state for YouTube routing and cadence.';

CREATE TABLE IF NOT EXISTS ops.youtube_channel_overrides (
    appid integer NOT NULL,
    channel_id text NOT NULL,
    override_state text NOT NULL DEFAULT 'allowlisted',
    override_reason text,
    confidence_floor numeric(5,2),
    allow_playlist_monitor boolean NOT NULL DEFAULT true,
    manual_override_applied boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_channel_overrides_pkey PRIMARY KEY (appid, channel_id),
    CONSTRAINT youtube_channel_overrides_state_check CHECK (
      override_state = ANY (ARRAY['allowlisted'::text, 'suppressed'::text, 'boosted'::text])
    )
);

COMMENT ON TABLE ops.youtube_channel_overrides IS 'Manual per-channel override state for YouTube matching and playlist monitoring.';

CREATE INDEX IF NOT EXISTS idx_ops_youtube_channel_overrides_state
  ON ops.youtube_channel_overrides (override_state, appid, channel_id);

CREATE TABLE IF NOT EXISTS events.youtube_search_hits (
    captured_at timestamp with time zone NOT NULL,
    id bigserial NOT NULL,
    search_run_id bigint NOT NULL,
    appid integer NOT NULL,
    query_template_id text,
    page_number integer NOT NULL DEFAULT 1,
    result_rank integer NOT NULL,
    video_id text NOT NULL,
    channel_id text,
    channel_title text,
    published_at timestamp with time zone,
    title text,
    description text,
    live_broadcast_content text,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_search_hits_pkey PRIMARY KEY (captured_at, id)
);

COMMENT ON TABLE events.youtube_search_hits IS 'Append-only YouTube discovery history keyed by search run and result rank.';
COMMENT ON COLUMN events.youtube_search_hits.raw_payload IS 'Raw YouTube search item payload preserved for rematching and debugging.';

SELECT public.create_hypertable(
  'events.youtube_search_hits',
  'captured_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE,
  create_default_indexes => FALSE
);

CREATE INDEX IF NOT EXISTS idx_events_youtube_search_hits_run_rank
  ON events.youtube_search_hits (search_run_id, result_rank);
CREATE INDEX IF NOT EXISTS idx_events_youtube_search_hits_appid_captured
  ON events.youtube_search_hits (appid, captured_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_youtube_search_hits_video_captured
  ON events.youtube_search_hits (video_id, captured_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_youtube_search_hits_channel_captured
  ON events.youtube_search_hits (channel_id, captured_at DESC, id DESC)
  WHERE channel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS events.youtube_match_decisions (
    decided_at timestamp with time zone NOT NULL,
    id bigserial NOT NULL,
    appid integer NOT NULL,
    video_id text NOT NULL,
    search_run_id bigint,
    match_state text NOT NULL,
    decision_source text NOT NULL,
    confidence_score numeric(5,2),
    matched_alias text,
    negative_rule_hit text,
    channel_prior_used boolean NOT NULL DEFAULT false,
    evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    methodology_version text NOT NULL DEFAULT 'youtube-v1',
    decision_reason text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_match_decisions_pkey PRIMARY KEY (decided_at, id),
    CONSTRAINT youtube_match_decisions_state_check CHECK (
      match_state = ANY (ARRAY['matched_primary'::text, 'matched_secondary'::text, 'ambiguous'::text, 'rejected'::text, 'suppressed'::text])
    ),
    CONSTRAINT youtube_match_decisions_source_check CHECK (
      decision_source = ANY (ARRAY['search'::text, 'playlist'::text, 'manual'::text, 'alias'::text, 'override'::text])
    )
);

COMMENT ON TABLE events.youtube_match_decisions IS 'Append-only audit trail for YouTube match decisions and reclassifications.';

SELECT public.create_hypertable(
  'events.youtube_match_decisions',
  'decided_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE,
  create_default_indexes => FALSE
);

CREATE INDEX IF NOT EXISTS idx_events_youtube_match_decisions_appid_decided
  ON events.youtube_match_decisions (appid, decided_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_youtube_match_decisions_video_decided
  ON events.youtube_match_decisions (video_id, decided_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_youtube_match_decisions_state_decided
  ON events.youtube_match_decisions (match_state, decided_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS docs.youtube_videos (
    video_id text PRIMARY KEY,
    channel_id text NOT NULL,
    channel_title text,
    published_at timestamp with time zone,
    title text NOT NULL,
    description text,
    content_class text NOT NULL DEFAULT 'standard_video',
    duration_seconds integer,
    category_id text,
    default_language text,
    default_audio_language text,
    tags text[] NOT NULL DEFAULT '{}'::text[],
    definition text,
    caption_status text,
    topic_categories text[] NOT NULL DEFAULT '{}'::text[],
    live_broadcast_content text,
    live_scheduled_start_at timestamp with time zone,
    live_scheduled_end_at timestamp with time zone,
    live_actual_start_at timestamp with time zone,
    live_actual_end_at timestamp with time zone,
    view_count bigint NOT NULL DEFAULT 0,
    like_count bigint NOT NULL DEFAULT 0,
    comment_count bigint NOT NULL DEFAULT 0,
    concurrent_viewers bigint,
    is_live boolean NOT NULL DEFAULT false,
    availability_state text NOT NULL DEFAULT 'unknown',
    made_for_kids boolean,
    embeddable boolean,
    public_stats_viewable boolean,
    licensed_content boolean,
    latest_payload_etag text,
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    first_hydrated_at timestamp with time zone,
    last_hydrated_at timestamp with time zone,
    raw_latest_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_videos_content_class_check CHECK (
      content_class = ANY (ARRAY['standard_video'::text, 'short'::text, 'live_or_recent_live'::text])
    ),
    CONSTRAINT youtube_videos_availability_state_check CHECK (
      availability_state = ANY (ARRAY['public'::text, 'unlisted'::text, 'private'::text, 'deleted'::text, 'live'::text, 'vod'::text, 'unknown'::text])
    )
);

COMMENT ON TABLE docs.youtube_videos IS 'Canonical latest-state YouTube video metadata for matched and discovered videos.';
COMMENT ON COLUMN docs.youtube_videos.raw_latest_payload IS 'Raw hydrated YouTube video payload preserved for rematching and future field extraction.';

CREATE INDEX IF NOT EXISTS idx_docs_youtube_videos_channel_published
  ON docs.youtube_videos (channel_id, published_at DESC, video_id DESC);
CREATE INDEX IF NOT EXISTS idx_docs_youtube_videos_published
  ON docs.youtube_videos (published_at DESC, video_id DESC);
CREATE INDEX IF NOT EXISTS idx_docs_youtube_videos_last_hydrated
  ON docs.youtube_videos (last_hydrated_at DESC, video_id DESC)
  WHERE last_hydrated_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS docs.youtube_channels (
    channel_id text PRIMARY KEY,
    title text NOT NULL,
    description text,
    custom_url text,
    country text,
    published_at timestamp with time zone,
    uploads_playlist_id text,
    subscriber_count bigint,
    hidden_subscriber_count boolean,
    view_count bigint,
    video_count bigint,
    latest_payload_etag text,
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    first_hydrated_at timestamp with time zone,
    last_hydrated_at timestamp with time zone,
    raw_latest_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE docs.youtube_channels IS 'Canonical latest-state YouTube channel metadata for matching and monitoring.';
COMMENT ON COLUMN docs.youtube_channels.raw_latest_payload IS 'Raw hydrated YouTube channel payload preserved for rematching and future field extraction.';

CREATE INDEX IF NOT EXISTS idx_docs_youtube_channels_uploads_playlist
  ON docs.youtube_channels (uploads_playlist_id)
  WHERE uploads_playlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_youtube_channels_last_hydrated
  ON docs.youtube_channels (last_hydrated_at DESC, channel_id DESC)
  WHERE last_hydrated_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS docs.youtube_video_matches (
    appid integer NOT NULL,
    video_id text NOT NULL,
    match_state text NOT NULL DEFAULT 'matched_primary',
    decision_source text NOT NULL DEFAULT 'search',
    confidence_score numeric(5,2),
    matched_alias text,
    negative_rule_hit text,
    channel_prior_used boolean NOT NULL DEFAULT false,
    matched_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_search_run_id bigint,
    last_decision_at timestamp with time zone,
    last_decision_id bigint,
    evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    methodology_version text NOT NULL DEFAULT 'youtube-v1',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_video_matches_pkey PRIMARY KEY (appid, video_id),
    CONSTRAINT youtube_video_matches_state_check CHECK (
      match_state = ANY (ARRAY['matched_primary'::text, 'matched_secondary'::text, 'ambiguous'::text, 'rejected'::text, 'suppressed'::text])
    ),
    CONSTRAINT youtube_video_matches_source_check CHECK (
      decision_source = ANY (ARRAY['search'::text, 'playlist'::text, 'manual'::text, 'alias'::text, 'override'::text])
    )
);

COMMENT ON TABLE docs.youtube_video_matches IS 'Current match state for the relationship between a Steam app and a YouTube video.';

CREATE INDEX IF NOT EXISTS idx_docs_youtube_video_matches_state
  ON docs.youtube_video_matches (appid, match_state, matched_at DESC, video_id);
CREATE INDEX IF NOT EXISTS idx_docs_youtube_video_matches_video
  ON docs.youtube_video_matches (video_id, matched_at DESC, appid);

CREATE TABLE IF NOT EXISTS metrics.youtube_video_snapshots (
    snapshot_time timestamp with time zone NOT NULL,
    video_id text NOT NULL,
    appid integer NOT NULL,
    content_class text NOT NULL,
    view_count bigint NOT NULL DEFAULT 0,
    like_count bigint NOT NULL DEFAULT 0,
    comment_count bigint NOT NULL DEFAULT 0,
    concurrent_viewers bigint,
    is_live boolean NOT NULL DEFAULT false,
    availability_state text NOT NULL DEFAULT 'unknown',
    snapshot_reason text NOT NULL DEFAULT 'scheduled',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_video_snapshots_pkey PRIMARY KEY (snapshot_time, video_id),
    CONSTRAINT youtube_video_snapshots_content_class_check CHECK (
      content_class = ANY (ARRAY['standard_video'::text, 'short'::text, 'live_or_recent_live'::text])
    ),
    CONSTRAINT youtube_video_snapshots_availability_state_check CHECK (
      availability_state = ANY (ARRAY['public'::text, 'unlisted'::text, 'private'::text, 'deleted'::text, 'live'::text, 'vod'::text, 'unknown'::text])
    )
);

COMMENT ON TABLE metrics.youtube_video_snapshots IS 'Append-only YouTube video metric snapshots used to compute view growth over time.';

SELECT public.create_hypertable(
  'metrics.youtube_video_snapshots',
  'snapshot_time',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE,
  create_default_indexes => FALSE
);

CREATE INDEX IF NOT EXISTS idx_metrics_youtube_video_snapshots_video_time
  ON metrics.youtube_video_snapshots (video_id, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_youtube_video_snapshots_appid_time
  ON metrics.youtube_video_snapshots (appid, snapshot_time DESC, video_id);
CREATE INDEX IF NOT EXISTS idx_metrics_youtube_video_snapshots_content_time
  ON metrics.youtube_video_snapshots (content_class, snapshot_time DESC, video_id);

CREATE TABLE IF NOT EXISTS metrics.youtube_game_daily (
    metric_date date NOT NULL,
    appid integer NOT NULL,
    content_class text NOT NULL,
    coverage_state text NOT NULL DEFAULT 'partial',
    matched_primary_video_count integer NOT NULL DEFAULT 0,
    matched_secondary_video_count integer NOT NULL DEFAULT 0,
    monitored_channel_count integer NOT NULL DEFAULT 0,
    discovered_video_count integer NOT NULL DEFAULT 0,
    new_matched_videos_1d integer NOT NULL DEFAULT 0,
    new_matched_videos_7d integer NOT NULL DEFAULT 0,
    new_matched_videos_30d integer NOT NULL DEFAULT 0,
    distinct_upload_channels_7d integer NOT NULL DEFAULT 0,
    distinct_upload_channels_30d integer NOT NULL DEFAULT 0,
    views_on_new_videos_7d bigint NOT NULL DEFAULT 0,
    views_on_new_videos_30d bigint NOT NULL DEFAULT 0,
    matched_video_view_delta_1d bigint NOT NULL DEFAULT 0,
    matched_video_view_delta_7d bigint NOT NULL DEFAULT 0,
    total_snapshot_count integer NOT NULL DEFAULT 0,
    latest_snapshot_at timestamp with time zone,
    rollup_methodology_version text NOT NULL DEFAULT 'youtube-v1',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT youtube_game_daily_pkey PRIMARY KEY (metric_date, appid, content_class),
    CONSTRAINT youtube_game_daily_content_class_check CHECK (
      content_class = ANY (ARRAY['standard_video'::text, 'short'::text, 'live_or_recent_live'::text])
    ),
    CONSTRAINT youtube_game_daily_coverage_state_check CHECK (
      coverage_state = ANY (ARRAY['none'::text, 'partial'::text, 'full'::text])
    )
);

COMMENT ON TABLE metrics.youtube_game_daily IS 'Derived per-game YouTube daily rollups by content class.';

SELECT public.create_hypertable(
  'metrics.youtube_game_daily',
  'metric_date',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE,
  create_default_indexes => FALSE
);

CREATE INDEX IF NOT EXISTS idx_metrics_youtube_game_daily_appid_class_date
  ON metrics.youtube_game_daily (appid, content_class, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_youtube_game_daily_date
  ON metrics.youtube_game_daily (metric_date DESC, appid, content_class);
