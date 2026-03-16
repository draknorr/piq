-- Migration: Optimize Change Feed activity RPC
-- Purpose:
--   1. Apply mode/view/signal filters before expensive branch work
--   2. Eliminate repeated burst-member rescans on the change branch
--   3. Reuse the fast recent-news pattern for announcement rows

CREATE INDEX IF NOT EXISTS idx_steam_news_items_appid_sort_time_gid
  ON steam_news_items(appid, (COALESCE(published_at, first_seen_at)) DESC, gid DESC);

CREATE OR REPLACE FUNCTION get_change_feed_activity(
  p_days INTEGER DEFAULT 7,
  p_view TEXT DEFAULT 'overview',
  p_mode TEXT DEFAULT 'all',
  p_app_types TEXT[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_signal_families TEXT[] DEFAULT NULL,
  p_sort TEXT DEFAULT 'relevant',
  p_cursor_score DOUBLE PRECISION DEFAULT NULL,
  p_cursor_time TIMESTAMPTZ DEFAULT NULL,
  p_cursor_activity_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  activity_id TEXT,
  activity_kind TEXT,
  story_kind TEXT,
  appid INTEGER,
  app_name TEXT,
  app_type TEXT,
  is_released BOOLEAN,
  release_date DATE,
  occurred_at TIMESTAMPTZ,
  headline TEXT,
  summary TEXT,
  facts TEXT[],
  highlight_labels TEXT[],
  signal_families TEXT[],
  has_before_after BOOLEAN,
  related_announcement_count INTEGER,
  external_url TEXT,
  sort_score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 7), 1) AS days,
      COALESCE(p_view, 'overview') AS requested_view,
      COALESCE(p_mode, 'all') AS requested_mode,
      COALESCE(p_sort, 'relevant') AS requested_sort,
      p_app_types AS requested_app_types,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      CASE
        WHEN p_signal_families IS NULL OR CARDINALITY(p_signal_families) = 0 THEN NULL::TEXT[]
        ELSE p_signal_families
      END AS requested_signal_families
  ),
  request_filters AS (
    SELECT
      rc.*,
      CASE
        WHEN rc.requested_signal_families IS NULL THEN
          CASE rc.requested_view
            WHEN 'commercial-moves' THEN ARRAY['pricing']::TEXT[]
            WHEN 'store-refreshes' THEN ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[]
            ELSE NULL::TEXT[]
          END
        ELSE ARRAY(
          SELECT DISTINCT family
          FROM unnest(rc.requested_signal_families) AS family
          WHERE family <> 'announcement'
            AND (
              rc.requested_view <> 'commercial-moves'
              OR family = 'pricing'
            )
            AND (
              rc.requested_view <> 'store-refreshes'
              OR family = ANY (ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[])
            )
          ORDER BY 1
        )
      END AS requested_change_families
    FROM request_config rc
  ),
  request_flags AS (
    SELECT
      rf.*,
      CASE
        WHEN rf.requested_mode NOT IN ('all', 'changes') THEN FALSE
        WHEN rf.requested_signal_families IS NOT NULL
          AND COALESCE(CARDINALITY(rf.requested_change_families), 0) = 0 THEN FALSE
        ELSE TRUE
      END AS allow_change_rows,
      CASE
        WHEN rf.requested_mode NOT IN ('all', 'announcements') THEN FALSE
        WHEN rf.requested_view NOT IN ('overview', 'all-activity') THEN FALSE
        WHEN rf.requested_signal_families IS NOT NULL
          AND NOT ('announcement' = ANY (rf.requested_signal_families)) THEN FALSE
        ELSE TRUE
      END AS allow_announcement_rows
    FROM request_filters rf
  ),
  classified_change_events AS (
    SELECT
      e.appid,
      a.name AS app_name,
      a.type::TEXT AS app_type,
      a.is_released,
      a.release_date,
      e.change_type::TEXT AS change_type,
      e.occurred_at,
      CASE
        WHEN e.change_type::TEXT = 'release_date_text_change' THEN 'release'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'price_change',
            'discount_start',
            'discount_end',
            'dlc_references_changed',
            'package_references_changed'
          ]::TEXT[]
        ) THEN 'pricing'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'description_rewrite',
            'short_description_rewrite'
          ]::TEXT[]
        ) THEN 'store-page'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'capsule_url_changed',
            'header_url_changed',
            'background_url_changed',
            'screenshot_added',
            'screenshot_removed',
            'screenshot_reordered',
            'trailer_added',
            'trailer_removed',
            'trailer_reordered',
            'trailer_thumbnail_changed'
          ]::TEXT[]
        ) THEN 'media'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'tags_added',
            'tags_removed',
            'genres_changed',
            'categories_changed',
            'publisher_association_changed',
            'developer_association_changed'
          ]::TEXT[]
        ) THEN 'taxonomy'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'languages_changed',
            'platforms_changed',
            'controller_support_changed',
            'steam_deck_status_changed'
          ]::TEXT[]
        ) THEN 'platform'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'build_id_changed',
            'last_content_update_changed'
          ]::TEXT[]
        ) THEN 'build'
        ELSE 'store-page'
      END AS signal_family,
      CASE e.change_type::TEXT
        WHEN 'description_rewrite' THEN 'Store description'
        WHEN 'short_description_rewrite' THEN 'Short description'
        WHEN 'release_date_text_change' THEN 'Release timing'
        WHEN 'price_change' THEN 'Price'
        WHEN 'discount_start' THEN 'Discount'
        WHEN 'discount_end' THEN 'Discount'
        WHEN 'tags_added' THEN 'Tags'
        WHEN 'tags_removed' THEN 'Tags'
        WHEN 'genres_changed' THEN 'Genres'
        WHEN 'categories_changed' THEN 'Categories'
        WHEN 'languages_changed' THEN 'Languages'
        WHEN 'platforms_changed' THEN 'Platforms'
        WHEN 'controller_support_changed' THEN 'Controller support'
        WHEN 'steam_deck_status_changed' THEN 'Steam Deck'
        WHEN 'publisher_association_changed' THEN 'Publisher'
        WHEN 'developer_association_changed' THEN 'Developer'
        WHEN 'dlc_references_changed' THEN 'DLC'
        WHEN 'package_references_changed' THEN 'Packages'
        WHEN 'build_id_changed' THEN 'Build'
        WHEN 'last_content_update_changed' THEN 'Content update'
        WHEN 'capsule_url_changed' THEN 'Capsule art'
        WHEN 'header_url_changed' THEN 'Header art'
        WHEN 'background_url_changed' THEN 'Background art'
        WHEN 'screenshot_added' THEN 'Screenshots'
        WHEN 'screenshot_removed' THEN 'Screenshots'
        WHEN 'screenshot_reordered' THEN 'Screenshots'
        WHEN 'trailer_added' THEN 'Trailer'
        WHEN 'trailer_removed' THEN 'Trailer'
        WHEN 'trailer_reordered' THEN 'Trailer'
        WHEN 'trailer_thumbnail_changed' THEN 'Trailer art'
        ELSE INITCAP(REPLACE(e.change_type::TEXT, '_', ' '))
      END AS highlight_label
    FROM app_change_events e
    JOIN apps a ON a.appid = e.appid
    CROSS JOIN request_flags rf
    WHERE rf.allow_change_rows
      AND e.source IN ('storefront', 'pics', 'media')
      AND e.occurred_at >= NOW() - make_interval(days => rf.days)
      AND (
        rf.requested_app_types IS NULL
        OR a.type::TEXT = ANY (rf.requested_app_types)
      )
      AND (
        rf.requested_search IS NULL
        OR a.name ILIKE '%' || rf.requested_search || '%'
      )
      AND (
        rf.requested_view <> 'launch-watch'
        OR a.is_released = FALSE
        OR (a.release_date IS NOT NULL AND a.release_date >= CURRENT_DATE - 30)
        OR e.change_type::TEXT = 'release_date_text_change'
      )
  ),
  filtered_change_events AS (
    SELECT cce.*
    FROM classified_change_events cce
    CROSS JOIN request_flags rf
    WHERE (
      rf.requested_change_families IS NULL
      OR cce.signal_family = ANY (rf.requested_change_families)
    )
  ),
  sequenced_changes AS (
    SELECT
      fce.*,
      CASE
        WHEN LAG(fce.occurred_at) OVER app_window IS NULL THEN 1
        WHEN fce.occurred_at - LAG(fce.occurred_at) OVER app_window > INTERVAL '90 minutes' THEN 1
        ELSE 0
      END AS starts_new_burst
    FROM filtered_change_events fce
    WINDOW app_window AS (PARTITION BY fce.appid ORDER BY fce.occurred_at)
  ),
  burst_members AS (
    SELECT
      sc.*,
      SUM(sc.starts_new_burst) OVER (
        PARTITION BY sc.appid
        ORDER BY sc.occurred_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS burst_number
    FROM sequenced_changes sc
  ),
  change_core AS (
    SELECT
      bm.appid,
      bm.app_name,
      bm.app_type,
      bm.is_released,
      bm.release_date,
      bm.burst_number,
      MIN(bm.occurred_at) AS burst_started_at,
      MAX(bm.occurred_at) AS occurred_at,
      COUNT(*)::INTEGER AS event_count,
      COUNT(DISTINCT bm.change_type)::INTEGER AS change_type_count,
      ARRAY_AGG(DISTINCT bm.change_type ORDER BY bm.change_type) AS change_types,
      ARRAY_AGG(DISTINCT bm.highlight_label ORDER BY bm.highlight_label)
        FILTER (WHERE bm.highlight_label IS NOT NULL) AS highlight_labels_raw,
      ARRAY_AGG(DISTINCT bm.signal_family)
        FILTER (WHERE bm.signal_family IS NOT NULL) AS signal_family_set
    FROM burst_members bm
    GROUP BY
      bm.appid,
      bm.app_name,
      bm.app_type,
      bm.is_released,
      bm.release_date,
      bm.burst_number
  ),
  change_enriched AS (
    SELECT
      'change:' ||
        FORMAT(
          '%s:%s:%s',
          cc.appid,
          TO_CHAR(cc.burst_started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"'),
          TO_CHAR(cc.occurred_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"')
        ) AS activity_id,
      'change'::TEXT AS activity_kind,
      cc.appid,
      cc.app_name,
      cc.app_type,
      cc.is_released,
      cc.release_date,
      cc.burst_started_at,
      cc.occurred_at,
      cc.event_count,
      cc.change_type_count,
      cc.change_types,
      COALESCE(
        ARRAY(
          SELECT family
          FROM unnest(
            ARRAY['release', 'pricing', 'store-page', 'media', 'taxonomy', 'platform', 'build']::TEXT[]
          ) AS family
          WHERE family = ANY (COALESCE(cc.signal_family_set, ARRAY[]::TEXT[]))
        ),
        ARRAY[]::TEXT[]
      ) AS signal_families,
      COALESCE(cc.highlight_labels_raw[1:4], ARRAY[]::TEXT[]) AS highlight_labels
    FROM change_core cc
  ),
  change_activity AS (
    SELECT
      ce.activity_id,
      ce.activity_kind,
      CASE
        WHEN ce.signal_families && ARRAY['release']::TEXT[]
          OR ce.is_released = FALSE
          OR (ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30)
          THEN 'release-prep'
        WHEN ce.signal_families && ARRAY['pricing']::TEXT[]
          THEN 'commercial-move'
        WHEN ce.signal_families && ARRAY['store-page', 'media']::TEXT[]
          THEN 'store-refresh'
        WHEN ce.signal_families && ARRAY['taxonomy']::TEXT[]
          THEN 'positioning-shift'
        WHEN ce.signal_families && ARRAY['platform']::TEXT[]
          THEN 'platform-expansion'
        WHEN ce.signal_families && ARRAY['build']::TEXT[]
          THEN 'build-activity'
        ELSE 'general-update'
      END AS story_kind,
      ce.appid,
      ce.app_name,
      ce.app_type,
      ce.is_released,
      ce.release_date,
      ce.occurred_at,
      CASE
        WHEN ce.change_types && ARRAY['release_date_text_change']::TEXT[]
          THEN 'Locked in more precise release timing'
        WHEN ce.signal_families && ARRAY['pricing']::TEXT[]
          THEN 'Adjusted pricing, packages, or monetization setup'
        WHEN ce.signal_families && ARRAY['store-page', 'media']::TEXT[]
          THEN 'Refreshed store presentation and merchandising'
        WHEN ce.signal_families && ARRAY['taxonomy']::TEXT[]
          THEN 'Shifted tags, genres, or positioning signals'
        WHEN ce.signal_families && ARRAY['platform']::TEXT[]
          THEN 'Expanded platform, language, or audience reach'
        WHEN ce.signal_families && ARRAY['build']::TEXT[]
          THEN 'Shipped a new build or content update'
        WHEN ce.change_type_count > 1
          THEN 'Multiple Steam changes landed together'
        ELSE 'Single Steam change detected'
      END AS headline,
      CASE
        WHEN ce.signal_families && ARRAY['build']::TEXT[]
          AND NOT (
            ce.signal_families && ARRAY['pricing', 'store-page', 'media', 'taxonomy', 'platform', 'release']::TEXT[]
          )
          THEN 'Grouped technical updates into one readable activity card.'
        ELSE 'Grouped recent Steam changes into one readable activity card.'
      END AS summary,
      ARRAY_REMOVE(
        ARRAY[
          CASE WHEN ce.is_released = FALSE THEN 'Upcoming title' END,
          CASE
            WHEN ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30
              THEN 'Released in the last 30 days'
          END,
          ce.event_count::TEXT || ' grouped updates',
          ce.change_type_count::TEXT || ' change types'
        ],
        NULL
      ) AS facts,
      ce.highlight_labels,
      ce.signal_families,
      TRUE AS has_before_after,
      0::INTEGER AS related_announcement_count,
      NULL::TEXT AS external_url,
      (
        CASE
          WHEN ce.signal_families && ARRAY['release']::TEXT[]
            OR ce.is_released = FALSE
            OR (ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30)
            THEN 42
          WHEN ce.signal_families && ARRAY['pricing']::TEXT[] THEN 38
          WHEN ce.signal_families && ARRAY['store-page', 'media']::TEXT[] THEN 32
          WHEN ce.signal_families && ARRAY['taxonomy']::TEXT[] THEN 30
          WHEN ce.signal_families && ARRAY['platform']::TEXT[] THEN 28
          WHEN ce.signal_families && ARRAY['build']::TEXT[] THEN 14
          ELSE 20
        END
        + ce.event_count * 6
        + ce.change_type_count * 4
      )::DOUBLE PRECISION AS relevance_score,
      (
        ce.event_count * 6
        + ce.change_type_count * 8
        + COALESCE(CARDINALITY(ce.highlight_labels), 0) * 4
      )::DOUBLE PRECISION AS magnitude_score,
      (
        CASE WHEN ce.signal_families && ARRAY['pricing']::TEXT[] THEN 80 ELSE 0 END
        + ce.event_count * 6
        + ce.change_type_count * 4
      )::DOUBLE PRECISION AS commercial_score,
      (
        CASE
          WHEN ce.signal_families && ARRAY['release']::TEXT[]
            OR ce.is_released = FALSE
            OR (ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30)
            THEN 90
          ELSE 0
        END
        + ce.event_count * 4
      )::DOUBLE PRECISION AS launch_score
    FROM change_enriched ce
  ),
  recent_news AS (
    SELECT
      n.gid,
      n.appid,
      n.app_name,
      n.app_type,
      n.published_at,
      n.first_seen_at,
      n.title,
      n.feedlabel,
      n.feedname,
      n.url,
      COALESCE(n.published_at, n.first_seen_at) AS occurred_at
    FROM request_flags rf
    CROSS JOIN LATERAL get_change_feed_news(
      rf.days,
      rf.requested_app_types,
      rf.requested_search,
      NULL,
      NULL,
      LEAST(GREATEST(COALESCE(p_limit, 50), 50) * 10, 500)
    ) AS n
    WHERE rf.allow_announcement_rows
  ),
  announcement_activity AS (
    SELECT
      'announcement:' || rn.gid AS activity_id,
      'announcement'::TEXT AS activity_kind,
      'announcement'::TEXT AS story_kind,
      rn.appid,
      rn.app_name,
      rn.app_type,
      a.is_released,
      a.release_date,
      rn.occurred_at,
      COALESCE(rn.title, 'New Steam announcement published') AS headline,
      CASE
        WHEN rn.feedlabel IS NOT NULL AND rn.feedname IS NOT NULL
          THEN rn.app_name || ' published a Steam announcement in ' || rn.feedlabel || ' / ' || rn.feedname || '.'
        WHEN rn.feedlabel IS NOT NULL
          THEN rn.app_name || ' published a Steam announcement in ' || rn.feedlabel || '.'
        WHEN rn.feedname IS NOT NULL
          THEN rn.app_name || ' published a Steam announcement in ' || rn.feedname || '.'
        ELSE rn.app_name || ' published a new Steam announcement.'
      END AS summary,
      ARRAY_REMOVE(ARRAY[rn.feedlabel, rn.feedname], NULL) AS facts,
      ARRAY_REMOVE(ARRAY[rn.feedlabel, rn.feedname], NULL) AS highlight_labels,
      ARRAY['announcement']::TEXT[] AS signal_families,
      FALSE AS has_before_after,
      0::INTEGER AS related_announcement_count,
      rn.url AS external_url,
      16::DOUBLE PRECISION AS relevance_score,
      8::DOUBLE PRECISION AS magnitude_score,
      6::DOUBLE PRECISION AS commercial_score,
      CASE
        WHEN a.is_released = FALSE OR (a.release_date IS NOT NULL AND a.release_date >= CURRENT_DATE - 30)
          THEN 24::DOUBLE PRECISION
        ELSE 6::DOUBLE PRECISION
      END AS launch_score
    FROM recent_news rn
    JOIN apps a ON a.appid = rn.appid
    CROSS JOIN request_flags rf
    WHERE
      (
        rf.requested_view <> 'launch-watch'
        OR a.is_released = FALSE
        OR (a.release_date IS NOT NULL AND a.release_date >= CURRENT_DATE - 30)
      )
  ),
  combined AS (
    SELECT
      ca.activity_id,
      ca.activity_kind,
      ca.story_kind,
      ca.appid,
      ca.app_name,
      ca.app_type,
      ca.is_released,
      ca.release_date,
      ca.occurred_at,
      ca.headline,
      ca.summary,
      ca.facts,
      ca.highlight_labels,
      ca.signal_families,
      ca.has_before_after,
      ca.related_announcement_count,
      ca.external_url,
      CASE COALESCE(rf.requested_sort, 'relevant')
        WHEN 'newest' THEN EXTRACT(EPOCH FROM ca.occurred_at)
        WHEN 'biggest-change' THEN ca.magnitude_score
        WHEN 'most-commercial' THEN ca.commercial_score
        WHEN 'most-launch-relevant' THEN ca.launch_score
        ELSE ca.relevance_score
      END AS sort_score
    FROM change_activity ca
    CROSS JOIN request_flags rf

    UNION ALL

    SELECT
      aa.activity_id,
      aa.activity_kind,
      aa.story_kind,
      aa.appid,
      aa.app_name,
      aa.app_type,
      aa.is_released,
      aa.release_date,
      aa.occurred_at,
      aa.headline,
      aa.summary,
      aa.facts,
      aa.highlight_labels,
      aa.signal_families,
      aa.has_before_after,
      aa.related_announcement_count,
      aa.external_url,
      CASE COALESCE(rf.requested_sort, 'relevant')
        WHEN 'newest' THEN EXTRACT(EPOCH FROM aa.occurred_at)
        WHEN 'biggest-change' THEN aa.magnitude_score
        WHEN 'most-commercial' THEN aa.commercial_score
        WHEN 'most-launch-relevant' THEN aa.launch_score
        ELSE aa.relevance_score
      END AS sort_score
    FROM announcement_activity aa
    CROSS JOIN request_flags rf
  ),
  view_filtered AS (
    SELECT c.*
    FROM combined c
    CROSS JOIN request_flags rf
    WHERE (
      rf.requested_signal_families IS NULL
      OR c.signal_families && rf.requested_signal_families
    )
      AND CASE rf.requested_view
        WHEN 'launch-watch' THEN
          c.story_kind = 'release-prep'
          OR c.is_released = FALSE
          OR (c.release_date IS NOT NULL AND c.release_date >= CURRENT_DATE - 30)
        WHEN 'commercial-moves' THEN
          c.story_kind = 'commercial-move'
          OR c.signal_families && ARRAY['pricing']::TEXT[]
        WHEN 'store-refreshes' THEN
          c.story_kind IN ('store-refresh', 'positioning-shift', 'platform-expansion')
          OR c.signal_families && ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[]
        ELSE TRUE
      END
  )
  SELECT
    vf.activity_id,
    vf.activity_kind,
    vf.story_kind,
    vf.appid,
    vf.app_name,
    vf.app_type,
    vf.is_released,
    vf.release_date,
    vf.occurred_at,
    vf.headline,
    vf.summary,
    vf.facts,
    vf.highlight_labels,
    vf.signal_families,
    vf.has_before_after,
    vf.related_announcement_count,
    vf.external_url,
    vf.sort_score
  FROM view_filtered vf
  WHERE (
    p_cursor_score IS NULL
    OR p_cursor_time IS NULL
    OR p_cursor_activity_id IS NULL
    OR (vf.sort_score, vf.occurred_at, vf.activity_id) < (p_cursor_score, p_cursor_time, p_cursor_activity_id)
  )
  ORDER BY vf.sort_score DESC, vf.occurred_at DESC, vf.activity_id DESC
  LIMIT LEAST(COALESCE(p_limit, 50), 100);
$$;

COMMENT ON FUNCTION get_change_feed_activity(INTEGER, TEXT, TEXT, TEXT[], TEXT, TEXT[], TEXT, DOUBLE PRECISION, TIMESTAMPTZ, TEXT, INTEGER) IS
  'Returns a unified activity-card stream for /changes, applying request filters before burst/news work for low-latency activity reads.';
