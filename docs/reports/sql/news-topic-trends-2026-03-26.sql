-- news-topic-trends-2026-03-26
-- Purpose:
-- Extract the full available Steam news corpus for games, split it into
-- community announcements versus external coverage, and support a one-off
-- topic-intent trend report with CSV, Markdown, and HTML outputs.
--
-- Reporting timezone: America/Los_Angeles
-- Scope:
-- - apps.type = 'game'
-- - one row per news item gid using the latest news version text
-- - split feed scope into Community Announcements vs External Coverage
-- - reporting window uses first capture time, not original publish time,
--   so the trend window matches the data we actually have in the warehouse
-- - downstream classification and phrase mining happen in the report script

WITH base_news AS (
  SELECT
    n.gid,
    n.appid,
    a.name AS app_name,
    n.first_seen_at AS captured_at_utc,
    COALESCE(n.published_at, n.first_seen_at) AS published_at_utc,
    (n.first_seen_at AT TIME ZONE 'America/Los_Angeles')::date AS day_pt,
    date_trunc('week', n.first_seen_at AT TIME ZONE 'America/Los_Angeles')::date AS week_pt,
    CASE
      WHEN COALESCE(n.feedlabel, '') = 'Community Announcements' THEN 'community_announcements'
      ELSE 'external_coverage'
    END AS feed_scope,
    COALESCE(n.feedlabel, '') AS feedlabel,
    COALESCE(n.feedname, '') AS feedname,
    regexp_replace(COALESCE(lv.title, ''), E'[\n\r\t]+', ' ', 'g') AS title,
    left(
      regexp_replace(
        regexp_replace(
          regexp_replace(COALESCE(lv.contents, ''), 'https?://\S+', ' ', 'gi'),
          E'[\n\r\t]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      ),
      220
    ) AS content_preview
  FROM steam_news_items n
  JOIN apps a ON a.appid = n.appid
  LEFT JOIN LATERAL (
    SELECT
      NULLIF(btrim(v.title), '') AS title,
      NULLIF(btrim(v.contents), '') AS contents
    FROM steam_news_versions v
    WHERE v.gid = n.gid
    ORDER BY v.first_seen_at DESC, v.id DESC
    LIMIT 1
  ) lv ON TRUE
  WHERE a.type = 'game'
)
SELECT
  gid,
  appid,
  app_name,
  captured_at_utc,
  published_at_utc,
  day_pt,
  week_pt,
  feed_scope,
  feedlabel,
  feedname,
  title,
  content_preview
FROM base_news
WHERE COALESCE(title, '') <> ''
   OR COALESCE(content_preview, '') <> '';
