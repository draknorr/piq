-- Migration: Drop legacy full-body latest-news projection after lean search projection rollout
-- Purpose:
--   1. Reclaim TOAST-heavy storage from the old steam_news_latest_projection table
--   2. Keep the compatibility refresh function name while removing the old table itself

DROP TABLE IF EXISTS public.steam_news_latest_projection;
