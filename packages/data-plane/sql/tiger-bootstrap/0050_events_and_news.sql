-- Phase 6 Tiger bootstrap for the PublisherIQ change-intel foundation.
-- Creates the first event hypertable and the recent-news serving tables used by
-- explainChanges and future topic-aware news contracts.

CREATE TABLE IF NOT EXISTS docs.steam_news_items (
    gid text PRIMARY KEY,
    appid integer NOT NULL,
    url text NOT NULL,
    author text,
    feedlabel text,
    feedname text,
    published_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE docs.steam_news_items IS 'Near-lossless landing table for public.steam_news_items from the live source database.';

CREATE INDEX IF NOT EXISTS idx_docs_steam_news_items_appid_published
  ON docs.steam_news_items (appid, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_docs_steam_news_items_appid_sort_time_gid
  ON docs.steam_news_items (appid, COALESCE(published_at, first_seen_at) DESC, gid DESC);
CREATE INDEX IF NOT EXISTS idx_docs_steam_news_items_published_gid
  ON docs.steam_news_items (published_at DESC NULLS LAST, gid DESC);
CREATE INDEX IF NOT EXISTS idx_docs_steam_news_items_sort_time_gid
  ON docs.steam_news_items (COALESCE(published_at, first_seen_at) DESC, gid DESC);

CREATE TABLE IF NOT EXISTS docs.steam_news_search_projection (
    gid text PRIMARY KEY,
    appid integer NOT NULL,
    published_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    sort_time timestamp with time zone NOT NULL,
    feed_scope text NOT NULL,
    title text,
    search_document tsvector NOT NULL
);

COMMENT ON TABLE docs.steam_news_search_projection IS 'Near-lossless landing table for public.steam_news_search_projection from the live source database.';

CREATE INDEX IF NOT EXISTS idx_docs_steam_news_search_projection_appid_sort_time
  ON docs.steam_news_search_projection (appid, sort_time DESC);
CREATE INDEX IF NOT EXISTS idx_docs_steam_news_search_projection_feed_scope_sort_time_gid
  ON docs.steam_news_search_projection (feed_scope, sort_time DESC, gid DESC);
CREATE INDEX IF NOT EXISTS idx_docs_steam_news_search_projection_search_document
  ON docs.steam_news_search_projection USING gin (search_document);

CREATE TABLE IF NOT EXISTS events.app_change_events (
    id bigint NOT NULL,
    appid integer NOT NULL,
    source text NOT NULL,
    change_type text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    source_snapshot_id bigint,
    related_snapshot_id bigint,
    media_version_id bigint,
    news_item_gid text,
    before_value jsonb,
    after_value jsonb,
    context jsonb NOT NULL,
    trigger_cursor text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT events_app_change_events_pkey PRIMARY KEY (occurred_at, id)
);

COMMENT ON TABLE events.app_change_events IS 'Timescale hypertable for public.app_change_events from the live source database.';
COMMENT ON COLUMN events.app_change_events.id IS 'Source event identifier preserved from public.app_change_events. Stored in a composite primary key with occurred_at because Tiger hypertable uniqueness must include the partitioning column.';

SELECT public.create_hypertable(
  'events.app_change_events',
  'occurred_at',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE,
  create_default_indexes => FALSE
);

CREATE INDEX IF NOT EXISTS idx_events_app_change_events_appid_time
  ON events.app_change_events (appid, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_app_change_events_source_time
  ON events.app_change_events (source, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_app_change_events_type_time
  ON events.app_change_events (change_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_app_change_events_news_item_gid
  ON events.app_change_events (news_item_gid)
  WHERE news_item_gid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_app_change_events_id
  ON events.app_change_events (id DESC);
