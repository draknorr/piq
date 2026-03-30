-- Migration: Add bounded recent-news digest RPC for chat
-- Purpose:
--   1. Expose latest news body text for one title or a small known set of titles
--   2. Keep chat news-summary reads bounded and index-friendly

CREATE OR REPLACE FUNCTION get_chat_recent_news(
  p_appids INTEGER[] DEFAULT NULL,
  p_days INTEGER DEFAULT 14,
  p_limit INTEGER DEFAULT 6
)
RETURNS TABLE (
  gid TEXT,
  appid INTEGER,
  app_name TEXT,
  app_type TEXT,
  published_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ,
  title TEXT,
  feedlabel TEXT,
  feedname TEXT,
  url TEXT,
  contents TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_news AS (
    SELECT
      n.gid,
      n.appid,
      n.published_at,
      n.first_seen_at,
      n.feedlabel,
      n.feedname,
      n.url,
      COALESCE(n.published_at, n.first_seen_at) AS sort_time
    FROM steam_news_items n
    WHERE COALESCE(n.published_at, n.first_seen_at) >= NOW() - make_interval(days => GREATEST(COALESCE(p_days, 14), 1))
      AND (
        p_appids IS NULL
        OR n.appid = ANY (p_appids)
      )
    ORDER BY COALESCE(n.published_at, n.first_seen_at) DESC, n.gid DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1) * 2, 12)
  )
  SELECT
    fn.gid,
    fn.appid,
    a.name AS app_name,
    a.type::TEXT AS app_type,
    fn.published_at,
    fn.first_seen_at,
    lv.title,
    fn.feedlabel,
    fn.feedname,
    COALESCE(lv.url, fn.url) AS url,
    lv.contents
  FROM filtered_news fn
  JOIN apps a ON a.appid = fn.appid
  LEFT JOIN LATERAL (
    SELECT
      v.title,
      v.contents,
      v.url
    FROM steam_news_versions v
    WHERE v.gid = fn.gid
    ORDER BY v.first_seen_at DESC
    LIMIT 1
  ) lv ON TRUE
  ORDER BY fn.sort_time DESC, fn.gid DESC;
$$;

COMMENT ON FUNCTION get_chat_recent_news(INTEGER[], INTEGER, INTEGER) IS
  'Returns a bounded recent-news digest with latest body text for chat summaries over one title or a small known set of titles.';

REVOKE EXECUTE ON FUNCTION get_chat_recent_news(INTEGER[], INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_chat_recent_news(INTEGER[], INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION get_chat_recent_news(INTEGER[], INTEGER, INTEGER) TO authenticated, service_role;
