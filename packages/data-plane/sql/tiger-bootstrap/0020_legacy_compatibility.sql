-- Phase 3 Tiger bootstrap for the PublisherIQ compatibility slice.
-- Creates near-lossless landing tables in legacy for the first contract-serving
-- data path without redesigning the underlying source schema yet.

CREATE TABLE IF NOT EXISTS legacy.apps (
    appid integer PRIMARY KEY,
    name text NOT NULL,
    type text DEFAULT 'game'::text,
    is_free boolean DEFAULT false,
    release_date date,
    release_date_raw text,
    store_asset_mtime date,
    has_workshop boolean DEFAULT false,
    current_price_cents integer,
    current_discount_percent integer DEFAULT 0,
    is_released boolean DEFAULT true,
    is_delisted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    has_developer_info boolean DEFAULT false,
    controller_support text,
    pics_review_score smallint,
    pics_review_percentage smallint,
    metacritic_score smallint,
    metacritic_url text,
    platforms text,
    release_state text,
    parent_appid integer,
    homepage_url text,
    app_state text,
    last_content_update timestamp with time zone,
    current_build_id text,
    content_descriptors jsonb,
    languages jsonb,
    last_seen_in_steam_applist_at timestamp with time zone,
    CONSTRAINT legacy_apps_reasonable_price CHECK (
      current_price_cents IS NULL OR current_price_cents <= 50000
    )
);

COMMENT ON TABLE legacy.apps IS 'Near-lossless landing table for public.apps from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_apps_name ON legacy.apps (name);
CREATE INDEX IF NOT EXISTS idx_legacy_apps_name_lower_trgm ON legacy.apps USING gin (lower(name) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_legacy_apps_name_trgm ON legacy.apps USING gin (name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_legacy_apps_type_released ON legacy.apps (type, is_released, is_delisted);
CREATE INDEX IF NOT EXISTS idx_legacy_apps_release_date_desc ON legacy.apps (release_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_legacy_apps_parent_appid ON legacy.apps (parent_appid) WHERE parent_appid IS NOT NULL;

CREATE TABLE IF NOT EXISTS legacy.developers (
    id integer PRIMARY KEY,
    name text NOT NULL,
    normalized_name text NOT NULL,
    steam_vanity_url text,
    first_game_release_date date,
    game_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_embedding_sync timestamp with time zone,
    embedding_hash text,
    CONSTRAINT legacy_developers_name_key UNIQUE (name),
    CONSTRAINT legacy_developers_normalized_name_key UNIQUE (normalized_name)
);

COMMENT ON TABLE legacy.developers IS 'Near-lossless landing table for public.developers from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_developers_normalized_name ON legacy.developers (normalized_name);
CREATE INDEX IF NOT EXISTS idx_legacy_developers_name_lower_trgm ON legacy.developers USING gin (lower(name) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_legacy_developers_name_trgm ON legacy.developers USING gin (name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_legacy_developers_embedding_needed ON legacy.developers (game_count DESC, last_embedding_sync NULLS FIRST)
  WHERE game_count > 0;

CREATE TABLE IF NOT EXISTS legacy.publishers (
    id integer PRIMARY KEY,
    name text NOT NULL,
    normalized_name text NOT NULL,
    steam_vanity_url text,
    first_game_release_date date,
    game_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_embedding_sync timestamp with time zone,
    embedding_hash text,
    CONSTRAINT legacy_publishers_name_key UNIQUE (name),
    CONSTRAINT legacy_publishers_normalized_name_key UNIQUE (normalized_name)
);

COMMENT ON TABLE legacy.publishers IS 'Near-lossless landing table for public.publishers from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_publishers_normalized_name ON legacy.publishers (normalized_name);
CREATE INDEX IF NOT EXISTS idx_legacy_publishers_name_lower_trgm ON legacy.publishers USING gin (lower(name) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_legacy_publishers_name_trgm ON legacy.publishers USING gin (name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_legacy_publishers_embedding_needed ON legacy.publishers (game_count DESC, last_embedding_sync NULLS FIRST)
  WHERE game_count > 0;

CREATE TABLE IF NOT EXISTS legacy.app_developers (
    appid integer NOT NULL,
    developer_id integer NOT NULL,
    CONSTRAINT legacy_app_developers_pkey PRIMARY KEY (appid, developer_id)
);

COMMENT ON TABLE legacy.app_developers IS 'Near-lossless landing table for public.app_developers from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_app_developers_developer_id ON legacy.app_developers (developer_id);

CREATE TABLE IF NOT EXISTS legacy.app_publishers (
    appid integer NOT NULL,
    publisher_id integer NOT NULL,
    CONSTRAINT legacy_app_publishers_pkey PRIMARY KEY (appid, publisher_id)
);

COMMENT ON TABLE legacy.app_publishers IS 'Near-lossless landing table for public.app_publishers from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_app_publishers_publisher_id ON legacy.app_publishers (publisher_id);

CREATE TABLE IF NOT EXISTS legacy.latest_daily_metrics (
    appid integer PRIMARY KEY,
    metric_date date,
    owners_min integer,
    owners_max integer,
    owners_midpoint integer,
    ccu_peak integer,
    ccu_source text,
    total_reviews integer,
    positive_reviews integer,
    negative_reviews integer,
    review_score smallint,
    review_score_desc text,
    positive_percentage numeric,
    price_cents integer,
    discount_percent smallint,
    average_playtime_forever integer,
    average_playtime_2weeks integer,
    estimated_weekly_hours bigint
);

COMMENT ON TABLE legacy.latest_daily_metrics IS 'Landing table for the public.latest_daily_metrics materialized view from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_latest_daily_metrics_reviews ON legacy.latest_daily_metrics (total_reviews DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_legacy_latest_daily_metrics_owners ON legacy.latest_daily_metrics (owners_midpoint DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_legacy_latest_daily_metrics_ccu ON legacy.latest_daily_metrics (ccu_peak DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_legacy_latest_daily_metrics_metric_date ON legacy.latest_daily_metrics (metric_date DESC NULLS LAST);
