-- Optional performance prep for the /youtube intelligence page.
-- Do not run automatically. Apply only after explicit DB approval.

ALTER TABLE metrics.youtube_game_daily
  ADD COLUMN IF NOT EXISTS current_matched_views bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distinct_upload_channels_1d integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_video_view_delta_30d bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_docs_youtube_matches_primary_app_video
  ON docs.youtube_video_matches (appid, video_id)
  WHERE match_state = 'matched_primary';

CREATE INDEX IF NOT EXISTS idx_docs_youtube_videos_class_language_published
  ON docs.youtube_videos (
    content_class,
    lower(COALESCE(default_language, default_audio_language, '')),
    published_at DESC,
    video_id
  );

CREATE INDEX IF NOT EXISTS idx_metrics_youtube_game_daily_latest_class
  ON metrics.youtube_game_daily (
    metric_date DESC,
    content_class,
    appid
  )
  INCLUDE (
    matched_primary_video_count,
    new_matched_videos_1d,
    new_matched_videos_7d,
    new_matched_videos_30d,
    distinct_upload_channels_1d,
    distinct_upload_channels_7d,
    distinct_upload_channels_30d,
    matched_video_view_delta_1d,
    matched_video_view_delta_7d,
    matched_video_view_delta_30d,
    current_matched_views,
    latest_snapshot_at
  );
