-- Extend the Tiger compatibility landing zone with relation tables that the
-- chat contracts depend on for strict Tiger-only lookups.

CREATE TABLE IF NOT EXISTS legacy.app_dlc (
    parent_appid integer NOT NULL,
    dlc_appid integer NOT NULL,
    source text NOT NULL DEFAULT 'pics',
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT legacy_app_dlc_pkey PRIMARY KEY (parent_appid, dlc_appid)
);

COMMENT ON TABLE legacy.app_dlc IS 'Near-lossless landing table for public.app_dlc from the live source database.';

CREATE INDEX IF NOT EXISTS idx_legacy_app_dlc_parent
  ON legacy.app_dlc (parent_appid);
CREATE INDEX IF NOT EXISTS idx_legacy_app_dlc_child
  ON legacy.app_dlc (dlc_appid);
