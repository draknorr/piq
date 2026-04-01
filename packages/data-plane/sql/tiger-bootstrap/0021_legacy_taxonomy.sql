-- Phase 4 Tiger bootstrap for the PublisherIQ taxonomy compatibility slice.
-- Creates the missing genre and tag landing tables required for Tiger-backed
-- catalog filters and broader natural-language discovery prompts.

CREATE TABLE IF NOT EXISTS legacy.steam_genres (
    genre_id integer PRIMARY KEY,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE legacy.steam_genres IS 'Near-lossless landing table for public.steam_genres from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_steam_genres_name_lower ON legacy.steam_genres (lower(name));

CREATE TABLE IF NOT EXISTS legacy.app_genres (
    appid integer NOT NULL,
    genre_id integer NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT legacy_app_genres_pkey PRIMARY KEY (appid, genre_id)
);

COMMENT ON TABLE legacy.app_genres IS 'Near-lossless landing table for public.app_genres from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_app_genres_genre_id ON legacy.app_genres (genre_id);
CREATE INDEX IF NOT EXISTS idx_legacy_app_genres_created_at ON legacy.app_genres (created_at);
CREATE INDEX IF NOT EXISTS idx_legacy_app_genres_primary ON legacy.app_genres (appid) WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS legacy.steam_tags (
    tag_id integer PRIMARY KEY,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE legacy.steam_tags IS 'Near-lossless landing table for public.steam_tags from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_steam_tags_name_lower ON legacy.steam_tags (lower(name));

CREATE TABLE IF NOT EXISTS legacy.app_steam_tags (
    appid integer NOT NULL,
    tag_id integer NOT NULL,
    rank integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT legacy_app_steam_tags_pkey PRIMARY KEY (appid, tag_id)
);

COMMENT ON TABLE legacy.app_steam_tags IS 'Near-lossless landing table for public.app_steam_tags from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_app_steam_tags_tag_id ON legacy.app_steam_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_legacy_app_steam_tags_created_at ON legacy.app_steam_tags (created_at);
CREATE INDEX IF NOT EXISTS idx_legacy_app_steam_tags_rank ON legacy.app_steam_tags (appid, rank NULLS LAST);
