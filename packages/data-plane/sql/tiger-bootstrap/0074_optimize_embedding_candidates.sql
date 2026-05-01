-- Optimize Tiger embedding candidate selection.
--
-- The previous app candidate RPC applied LIMIT after joining and aggregating
-- metadata for the broad due set. On production-sized Tiger data, even small
-- embedding batches could hit the statement timeout before returning rows.
-- These functions select the candidate ids first, then enrich only that small
-- candidate set.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ops_sync_status_embedding_candidate_order
  ON ops.sync_status (
    (last_embedding_sync IS NOT NULL),
    priority_score DESC,
    appid ASC
  )
  INCLUDE (last_embedding_sync)
  WHERE COALESCE(is_syncable, true) = true;

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

CREATE OR REPLACE FUNCTION ops.get_publishers_needing_embedding(p_limit integer DEFAULT 200)
RETURNS TABLE (
  id integer,
  name text,
  game_count integer,
  first_game_release_date date,
  top_genres text[],
  top_tags text[],
  platforms_supported text[],
  total_reviews bigint,
  avg_review_percentage numeric,
  top_game_names text[],
  top_game_appids integer[]
)
LANGUAGE sql
STABLE
AS $$
  WITH candidate_publishers AS MATERIALIZED (
    SELECT p.id, p.game_count
    FROM legacy.publishers p
    WHERE p.name IS NOT NULL
      AND p.game_count > 0
      AND (
        p.last_embedding_sync IS NULL
        OR COALESCE(p.updated_at, '-infinity'::timestamptz) > p.last_embedding_sync
      )
    ORDER BY p.game_count DESC NULLS LAST, p.id ASC
    LIMIT GREATEST(COALESCE(p_limit, 200), 0)
  )
  SELECT
    p.id,
    p.name,
    p.game_count,
    p.first_game_release_date,
    COALESCE(genres.names, ARRAY[]::text[]) AS top_genres,
    COALESCE(tags.names, ARRAY[]::text[]) AS top_tags,
    ARRAY[]::text[] AS platforms_supported,
    COALESCE(games.total_reviews, 0)::bigint AS total_reviews,
    games.avg_review_percentage,
    COALESCE(games.top_game_names, ARRAY[]::text[]) AS top_game_names,
    COALESCE(games.top_game_appids, ARRAY[]::integer[]) AS top_game_appids
  FROM candidate_publishers cp
  JOIN legacy.publishers p ON p.id = cp.id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(ldm.total_reviews), 0)::bigint AS total_reviews,
      avg(CASE WHEN ldm.total_reviews > 0 THEN ldm.positive_reviews::numeric / ldm.total_reviews::numeric * 100 END) AS avg_review_percentage,
      COALESCE((array_agg(a.name ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::text[]) AS top_game_names,
      COALESCE((array_agg(a.appid ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::integer[]) AS top_game_appids
    FROM legacy.app_publishers ap
    JOIN legacy.apps a ON a.appid = ap.appid
    LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ap.appid
    WHERE ap.publisher_id = cp.id
  ) games ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT g.name ORDER BY g.name) AS names
    FROM legacy.app_publishers ap
    JOIN legacy.app_genres ag ON ag.appid = ap.appid
    JOIN legacy.steam_genres g ON g.genre_id = ag.genre_id
    WHERE ap.publisher_id = cp.id
  ) genres ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT t.name ORDER BY t.name) AS names
    FROM legacy.app_publishers ap
    JOIN legacy.app_steam_tags ast ON ast.appid = ap.appid AND ast.rank <= 10
    JOIN legacy.steam_tags t ON t.tag_id = ast.tag_id
    WHERE ap.publisher_id = cp.id
  ) tags ON true
  ORDER BY cp.game_count DESC NULLS LAST, cp.id ASC;
$$;

CREATE OR REPLACE FUNCTION ops.get_developers_needing_embedding(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id integer,
  name text,
  game_count integer,
  first_game_release_date date,
  is_indie boolean,
  top_genres text[],
  top_tags text[],
  platforms_supported text[],
  total_reviews bigint,
  avg_review_percentage numeric,
  top_game_names text[],
  top_game_appids integer[]
)
LANGUAGE sql
STABLE
AS $$
  WITH candidate_developers AS MATERIALIZED (
    SELECT d.id, d.game_count
    FROM legacy.developers d
    WHERE d.name IS NOT NULL
      AND d.game_count > 0
      AND (
        d.last_embedding_sync IS NULL
        OR COALESCE(d.updated_at, '-infinity'::timestamptz) > d.last_embedding_sync
      )
    ORDER BY d.game_count DESC NULLS LAST, d.id ASC
    LIMIT GREATEST(COALESCE(p_limit, 100), 0)
  )
  SELECT
    d.id,
    d.name,
    d.game_count,
    d.first_game_release_date,
    d.game_count <= 5 AS is_indie,
    COALESCE(genres.names, ARRAY[]::text[]) AS top_genres,
    COALESCE(tags.names, ARRAY[]::text[]) AS top_tags,
    ARRAY[]::text[] AS platforms_supported,
    COALESCE(games.total_reviews, 0)::bigint AS total_reviews,
    games.avg_review_percentage,
    COALESCE(games.top_game_names, ARRAY[]::text[]) AS top_game_names,
    COALESCE(games.top_game_appids, ARRAY[]::integer[]) AS top_game_appids
  FROM candidate_developers cd
  JOIN legacy.developers d ON d.id = cd.id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(ldm.total_reviews), 0)::bigint AS total_reviews,
      avg(CASE WHEN ldm.total_reviews > 0 THEN ldm.positive_reviews::numeric / ldm.total_reviews::numeric * 100 END) AS avg_review_percentage,
      COALESCE((array_agg(a.name ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::text[]) AS top_game_names,
      COALESCE((array_agg(a.appid ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::integer[]) AS top_game_appids
    FROM legacy.app_developers ad
    JOIN legacy.apps a ON a.appid = ad.appid
    LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ad.appid
    WHERE ad.developer_id = cd.id
  ) games ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT g.name ORDER BY g.name) AS names
    FROM legacy.app_developers ad
    JOIN legacy.app_genres ag ON ag.appid = ad.appid
    JOIN legacy.steam_genres g ON g.genre_id = ag.genre_id
    WHERE ad.developer_id = cd.id
  ) genres ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT t.name ORDER BY t.name) AS names
    FROM legacy.app_developers ad
    JOIN legacy.app_steam_tags ast ON ast.appid = ad.appid AND ast.rank <= 10
    JOIN legacy.steam_tags t ON t.tag_id = ast.tag_id
    WHERE ad.developer_id = cd.id
  ) tags ON true
  ORDER BY cd.game_count DESC NULLS LAST, cd.id ASC;
$$;
