-- Keep Tiger game embedding candidates aligned with the worker's isWorthEmbedding()
-- predicate so non-embeddable rows do not get returned forever.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legacy_app_genres_appid_embedding
  ON legacy.app_genres (appid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legacy_app_steam_tags_appid_embedding
  ON legacy.app_steam_tags (appid);

CREATE OR REPLACE FUNCTION ops.get_apps_for_embedding(p_limit integer DEFAULT 500)
RETURNS TABLE (
  appid integer,
  name text,
  type text,
  is_free boolean,
  current_price_cents integer,
  release_date date,
  platforms text,
  controller_support text,
  pics_review_score smallint,
  pics_review_percentage smallint,
  steam_deck_category text,
  is_released boolean,
  is_delisted boolean,
  developers text[],
  publishers text[],
  genres text[],
  tags text[],
  categories text[],
  franchise_ids bigint[],
  developer_ids integer[],
  publisher_ids integer[],
  updated_at timestamp with time zone,
  total_reviews integer,
  owners_min integer,
  ccu_peak integer,
  average_playtime_forever integer,
  metacritic_score smallint,
  content_descriptors jsonb,
  language_count integer,
  trend_30d_direction text,
  velocity_tier text,
  franchise_names text[],
  steamspy_tags text[],
  primary_genre text,
  ccu_growth_7d numeric,
  ccu_growth_30d numeric,
  velocity_7d numeric,
  velocity_acceleration numeric,
  recent_review_pct numeric,
  historical_review_pct numeric,
  sentiment_delta numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH candidate_appids AS MATERIALIZED (
    SELECT
      a.appid,
      COALESCE(s.priority_score, 0) AS priority_score,
      s.last_embedding_sync
    FROM ops.sync_status s
    JOIN legacy.apps a ON a.appid = s.appid
    WHERE COALESCE(s.is_syncable, true) = true
      AND a.name IS NOT NULL
      AND COALESCE(a.is_delisted, false) = false
      AND COALESCE(s.last_embedding_sync, '-infinity'::timestamptz)
        <= COALESCE(a.updated_at, now()) - INTERVAL '1 second'
      AND (
        (
          a.type = 'game'
          AND (
            EXISTS (
              SELECT 1
              FROM legacy.app_genres ag
              WHERE ag.appid = a.appid
            )
            OR (
              SELECT count(*)
              FROM legacy.app_steam_tags ast
              WHERE ast.appid = a.appid
            ) >= 3
          )
        )
        OR (
          a.type IS DISTINCT FROM 'game'
          AND (
            EXISTS (
              SELECT 1
              FROM legacy.app_genres ag
              WHERE ag.appid = a.appid
            )
            OR EXISTS (
              SELECT 1
              FROM legacy.app_steam_tags ast
              WHERE ast.appid = a.appid
            )
          )
        )
      )
    ORDER BY
      (s.last_embedding_sync IS NOT NULL) ASC,
      COALESCE(s.priority_score, 0) DESC,
      a.appid ASC
    LIMIT GREATEST(COALESCE(p_limit, 500), 0)
  )
  SELECT
    a.appid,
    a.name,
    a.type,
    a.is_free,
    a.current_price_cents,
    a.release_date,
    a.platforms,
    a.controller_support,
    a.pics_review_score,
    a.pics_review_percentage,
    sd.category AS steam_deck_category,
    a.is_released,
    a.is_delisted,
    COALESCE(devs.names, ARRAY[]::text[]) AS developers,
    COALESCE(pubs.names, ARRAY[]::text[]) AS publishers,
    COALESCE(genres.names, ARRAY[]::text[]) AS genres,
    COALESCE(tags.names, ARRAY[]::text[]) AS tags,
    COALESCE(categories.names, ARRAY[]::text[]) AS categories,
    COALESCE(franchises.ids, ARRAY[]::bigint[]) AS franchise_ids,
    COALESCE(devs.ids, ARRAY[]::integer[]) AS developer_ids,
    COALESCE(pubs.ids, ARRAY[]::integer[]) AS publisher_ids,
    a.updated_at,
    ldm.total_reviews,
    ldm.owners_min,
    ldm.ccu_peak,
    ldm.average_playtime_forever,
    a.metacritic_score,
    a.content_descriptors,
    CASE
      WHEN jsonb_typeof(a.languages) = 'array' THEN jsonb_array_length(a.languages)
      ELSE NULL
    END AS language_count,
    trends.trend_30d_direction,
    s.review_velocity_tier AS velocity_tier,
    COALESCE(franchises.names, ARRAY[]::text[]) AS franchise_names,
    COALESCE(tags.names, ARRAY[]::text[]) AS steamspy_tags,
    genres.primary_genre,
    NULL::numeric AS ccu_growth_7d,
    NULL::numeric AS ccu_growth_30d,
    s.velocity_7d,
    NULL::numeric AS velocity_acceleration,
    CASE
      WHEN ldm.total_reviews > 0 THEN (ldm.positive_reviews::numeric / ldm.total_reviews::numeric) * 100
      ELSE NULL
    END AS recent_review_pct,
    CASE
      WHEN ldm.total_reviews > 0 THEN (ldm.positive_reviews::numeric / ldm.total_reviews::numeric) * 100
      ELSE NULL
    END AS historical_review_pct,
    NULL::numeric AS sentiment_delta
  FROM candidate_appids ca
  JOIN legacy.apps a ON a.appid = ca.appid
  JOIN ops.sync_status s ON s.appid = ca.appid
  LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ca.appid
  LEFT JOIN metrics.app_trends trends ON trends.appid = ca.appid
  LEFT JOIN legacy.app_steam_deck sd ON sd.appid = ca.appid
  LEFT JOIN LATERAL (
    SELECT array_agg(d.id ORDER BY d.name) AS ids, array_agg(d.name ORDER BY d.name) AS names
    FROM legacy.app_developers ad
    JOIN legacy.developers d ON d.id = ad.developer_id
    WHERE ad.appid = ca.appid
  ) devs ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(p.id ORDER BY p.name) AS ids, array_agg(p.name ORDER BY p.name) AS names
    FROM legacy.app_publishers ap
    JOIN legacy.publishers p ON p.id = ap.publisher_id
    WHERE ap.appid = ca.appid
  ) pubs ON true
  LEFT JOIN LATERAL (
    SELECT
      array_agg(g.name ORDER BY ag.is_primary DESC, g.name) AS names,
      (array_agg(g.name ORDER BY ag.is_primary DESC, g.name))[1] AS primary_genre
    FROM legacy.app_genres ag
    JOIN legacy.steam_genres g ON g.genre_id = ag.genre_id
    WHERE ag.appid = ca.appid
  ) genres ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(t.name ORDER BY ast.rank NULLS LAST, t.name) AS names
    FROM legacy.app_steam_tags ast
    JOIN legacy.steam_tags t ON t.tag_id = ast.tag_id
    WHERE ast.appid = ca.appid
  ) tags ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(c.name ORDER BY c.name) AS names
    FROM legacy.app_categories ac
    JOIN legacy.steam_categories c ON c.category_id = ac.category_id
    WHERE ac.appid = ca.appid
  ) categories ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(f.id ORDER BY f.name) AS ids, array_agg(f.name ORDER BY f.name) AS names
    FROM legacy.app_franchises af
    JOIN legacy.franchises f ON f.id = af.franchise_id
    WHERE af.appid = ca.appid
  ) franchises ON true
  ORDER BY
    (ca.last_embedding_sync IS NOT NULL) ASC,
    ca.priority_score DESC,
    ca.appid ASC;
$$;
