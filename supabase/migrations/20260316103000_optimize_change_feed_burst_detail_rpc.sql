-- Migration: Optimize Change Feed burst detail RPC
-- Purpose:
--   1. Stop scanning the full steam_news_versions table for every burst detail request
--   2. Resolve latest news version only for nearby related news rows

CREATE OR REPLACE FUNCTION get_change_feed_burst_detail(
  p_burst_id TEXT
)
RETURNS TABLE (
  burst_id TEXT,
  appid INTEGER,
  app_name TEXT,
  app_type TEXT,
  is_released BOOLEAN,
  release_date DATE,
  burst_started_at TIMESTAMPTZ,
  burst_ended_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  event_count INTEGER,
  source_set TEXT[],
  headline_change_types TEXT[],
  change_type_count INTEGER,
  has_related_news BOOLEAN,
  related_news_count INTEGER,
  events JSONB,
  related_news JSONB,
  impact JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH parsed AS (
    SELECT
      split_part(p_burst_id, ':', 1)::INTEGER AS appid,
      to_timestamp(split_part(p_burst_id, ':', 2), 'YYYYMMDD"T"HH24MISS.MS"Z"') AS burst_started_at,
      to_timestamp(split_part(p_burst_id, ':', 3), 'YYYYMMDD"T"HH24MISS.MS"Z"') AS burst_ended_at
  ),
  burst_events AS (
    SELECT
      e.id,
      e.appid,
      e.source,
      e.change_type,
      e.occurred_at,
      e.before_value,
      e.after_value,
      e.context,
      e.source_snapshot_id,
      e.related_snapshot_id,
      e.media_version_id,
      e.news_item_gid
    FROM app_change_events e
    JOIN parsed p ON p.appid = e.appid
    WHERE e.source IN ('storefront', 'pics', 'media')
      AND e.occurred_at >= p.burst_started_at
      AND e.occurred_at <= p.burst_ended_at
    ORDER BY e.occurred_at ASC, e.id ASC
  ),
  related_news_rows AS (
    SELECT
      n.gid,
      n.url,
      n.author,
      n.feedlabel,
      n.feedname,
      n.published_at,
      n.first_seen_at,
      lnv.title,
      lnv.contents,
      lnv.normalized_payload
    FROM steam_news_items n
    JOIN parsed p ON p.appid = n.appid
    LEFT JOIN LATERAL (
      SELECT
        v.title,
        v.contents,
        v.url,
        v.normalized_payload
      FROM steam_news_versions v
      WHERE v.gid = n.gid
      ORDER BY v.first_seen_at DESC
      LIMIT 1
    ) lnv ON TRUE
    WHERE COALESCE(n.published_at, n.first_seen_at) >= p.burst_started_at - INTERVAL '24 hours'
      AND COALESCE(n.published_at, n.first_seen_at) <= p.burst_ended_at + INTERVAL '24 hours'
    ORDER BY COALESCE(n.published_at, n.first_seen_at) DESC, n.gid DESC
  )
  SELECT
    p_burst_id AS burst_id,
    a.appid,
    a.name AS app_name,
    a.type::TEXT AS app_type,
    a.is_released,
    a.release_date,
    p.burst_started_at,
    p.burst_ended_at,
    p.burst_ended_at AS effective_at,
    COUNT(be.id)::INTEGER AS event_count,
    ARRAY(
      SELECT DISTINCT be_source.source::TEXT
      FROM burst_events be_source
      ORDER BY 1
    ) AS source_set,
    ARRAY(
      SELECT DISTINCT be_type.change_type::TEXT
      FROM burst_events be_type
      ORDER BY 1
      LIMIT 3
    ) AS headline_change_types,
    COUNT(DISTINCT be.change_type)::INTEGER AS change_type_count,
    EXISTS(SELECT 1 FROM related_news_rows) AS has_related_news,
    (SELECT COUNT(*)::INTEGER FROM related_news_rows) AS related_news_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'event_id', be.id,
          'source', be.source::TEXT,
          'change_type', be.change_type::TEXT,
          'occurred_at', be.occurred_at,
          'before_value', be.before_value,
          'after_value', be.after_value,
          'context', be.context,
          'source_snapshot_id', be.source_snapshot_id,
          'related_snapshot_id', be.related_snapshot_id,
          'media_version_id', be.media_version_id,
          'news_item_gid', be.news_item_gid
        )
        ORDER BY be.occurred_at ASC, be.id ASC
      ) FILTER (WHERE be.id IS NOT NULL),
      '[]'::JSONB
    ) AS events,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'gid', rnr.gid,
            'url', rnr.url,
            'author', rnr.author,
            'feedlabel', rnr.feedlabel,
            'feedname', rnr.feedname,
            'published_at', rnr.published_at,
            'first_seen_at', rnr.first_seen_at,
            'title', rnr.title,
            'contents', rnr.contents,
            'normalized_payload', rnr.normalized_payload
          )
          ORDER BY COALESCE(rnr.published_at, rnr.first_seen_at) DESC, rnr.gid DESC
        )
        FROM related_news_rows rnr
      ),
      '[]'::JSONB
    ) AS related_news,
    jsonb_build_object(
      'baseline_7d', get_change_window_metrics(a.appid, p.burst_started_at - INTERVAL '7 days', p.burst_started_at),
      'response_1d', get_change_window_metrics(a.appid, p.burst_ended_at, p.burst_ended_at + INTERVAL '1 day'),
      'response_7d', get_change_window_metrics(a.appid, p.burst_ended_at, p.burst_ended_at + INTERVAL '7 days')
    ) AS impact
  FROM parsed p
  JOIN apps a ON a.appid = p.appid
  LEFT JOIN burst_events be ON TRUE
  GROUP BY
    a.appid,
    a.name,
    a.type,
    a.is_released,
    a.release_date,
    p.burst_started_at,
    p.burst_ended_at;
$$;
