-- tag-genre-market-shifts-2026-03-25
-- Purpose:
-- Aggregate tag and genre change history for all game-type apps,
-- export raw daily series, theme daily series, and summary tables,
-- and support a one-off report with CSV outputs.
--
-- Reporting timezone: America/Los_Angeles
-- Scope:
-- - apps.type = 'game'
-- - includes released and prerelease games
-- - excludes categories
-- - cancels same-day same-label add/remove churn per app

-- Metadata
WITH source_events AS (
  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_added'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_removed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'
),
normalized_events AS (
  SELECT
    appid,
    app_name,
    is_released,
    occurred_at,
    (occurred_at AT TIME ZONE 'America/Los_Angeles')::date AS day_pt,
    dimension_type,
    direction,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'free to play'
      ELSE lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g'))
    END AS label_key,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'Free to Play'
      ELSE btrim(label_display_raw)
    END AS label_display
  FROM source_events
  WHERE label_display_raw IS NOT NULL
    AND btrim(label_display_raw) <> ''
),
raw_dedup AS (
  SELECT
    appid,
    MIN(app_name) AS app_name,
    BOOL_OR(is_released) AS is_released,
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    MAX(occurred_at) AS latest_occurred_at,
    BOOL_OR(direction = 'add') AS has_add,
    BOOL_OR(direction = 'remove') AS has_remove
  FROM normalized_events
  GROUP BY appid, day_pt, dimension_type, label_key
),
raw_directional AS (
  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'add'::text AS direction
  FROM raw_dedup
  WHERE has_add = TRUE
    AND has_remove = FALSE

  UNION ALL

  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'remove'::text AS direction
  FROM raw_dedup
  WHERE has_add = FALSE
    AND has_remove = TRUE
),
window_bounds AS (
  SELECT
    MIN(latest_occurred_at) AS window_start_utc,
    MAX(latest_occurred_at) AS window_end_utc,
    MIN(day_pt) AS window_start_pt,
    MAX(day_pt) AS window_end_pt
  FROM raw_directional
),
calendar AS (
  SELECT
    generate_series(window_start_pt, window_end_pt, INTERVAL '1 day')::date AS day_pt
  FROM window_bounds
),
raw_daily AS (
  SELECT
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM raw_directional
  GROUP BY day_pt, dimension_type, label_key
),
raw_labels AS (
  SELECT
    dimension_type,
    label_key,
    MIN(label_display) AS label_display
  FROM raw_directional
  GROUP BY dimension_type, label_key
),
raw_series AS (
  SELECT
    c.day_pt,
    l.dimension_type,
    l.label_key,
    l.label_display,
    COALESCE(rd.adds, 0)::int AS adds,
    COALESCE(rd.removes, 0)::int AS removes,
    (COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0))::int AS net_apps,
    COALESCE(rd.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0)) OVER (
      PARTITION BY l.dimension_type, l.label_key
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN raw_labels l
  LEFT JOIN raw_daily rd
    ON rd.day_pt = c.day_pt
   AND rd.dimension_type = l.dimension_type
   AND rd.label_key = l.label_key
),
theme_map(label_key, theme) AS (
  VALUES
    ('indie', 'Indie & Casual'),
    ('casual', 'Indie & Casual'),
    ('cozy', 'Indie & Casual'),
    ('cute', 'Indie & Casual'),
    ('family friendly', 'Indie & Casual'),
    ('funny', 'Indie & Casual'),
    ('comedy', 'Indie & Casual'),
    ('relaxing', 'Indie & Casual'),
    ('colorful', 'Indie & Casual'),
    ('action', 'Action & Combat'),
    ('action-adventure', 'Action & Combat'),
    ('arcade', 'Action & Combat'),
    ('combat', 'Action & Combat'),
    ('third person', 'Action & Combat'),
    ('top-down', 'Action & Combat'),
    ('difficult', 'Action & Combat'),
    ('adventure', 'Adventure & Story'),
    ('story rich', 'Adventure & Story'),
    ('choices matter', 'Adventure & Story'),
    ('exploration', 'Adventure & Story'),
    ('strategy', 'Strategy & Management'),
    ('management', 'Strategy & Management'),
    ('simulation', 'Simulation & Sandbox'),
    ('sandbox', 'Simulation & Sandbox'),
    ('physics', 'Simulation & Sandbox'),
    ('job simulator', 'Simulation & Sandbox'),
    ('rpg', 'RPG & Fantasy'),
    ('fantasy', 'RPG & Fantasy'),
    ('roguelite', 'RPG & Fantasy'),
    ('medieval', 'RPG & Fantasy'),
    ('character customization', 'RPG & Fantasy'),
    ('singleplayer', 'Play Modes & Social'),
    ('multiplayer', 'Play Modes & Social'),
    ('co-op', 'Play Modes & Social'),
    ('online co-op', 'Play Modes & Social'),
    ('party game', 'Play Modes & Social'),
    ('massively multiplayer', 'Play Modes & Social'),
    ('2d', 'Visual & Format'),
    ('3d', 'Visual & Format'),
    ('stylized', 'Visual & Format'),
    ('pixel graphics', 'Visual & Format'),
    ('retro', 'Visual & Format'),
    ('early access', 'Lifecycle & Business Model'),
    ('free to play', 'Lifecycle & Business Model'),
    ('atmospheric', 'Atmosphere & Horror'),
    ('dark', 'Atmosphere & Horror'),
    ('psychological horror', 'Atmosphere & Horror'),
    ('sports', 'Sports & Racing'),
    ('racing', 'Sports & Racing'),
    ('artificial intelligence', 'Tech & AI')
),
theme_directional AS (
  SELECT
    r.appid,
    MIN(r.app_name) AS app_name,
    r.day_pt,
    COALESCE(tm.theme, 'Other') AS theme,
    r.direction
  FROM raw_directional r
  LEFT JOIN theme_map tm
    ON tm.label_key = r.label_key
  GROUP BY r.appid, r.day_pt, COALESCE(tm.theme, 'Other'), r.direction
),
theme_daily AS (
  SELECT
    day_pt,
    theme,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM theme_directional
  GROUP BY day_pt, theme
),
theme_labels AS (
  SELECT DISTINCT theme
  FROM theme_directional
),
theme_series AS (
  SELECT
    c.day_pt,
    t.theme,
    COALESCE(td.adds, 0)::int AS adds,
    COALESCE(td.removes, 0)::int AS removes,
    (COALESCE(td.adds, 0) - COALESCE(td.removes, 0))::int AS net_apps,
    COALESCE(td.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(td.adds, 0) - COALESCE(td.removes, 0)) OVER (
      PARTITION BY t.theme
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN theme_labels t
  LEFT JOIN theme_daily td
    ON td.day_pt = c.day_pt
   AND td.theme = t.theme
),
raw_samples AS (
  SELECT
    dimension_type,
    label_key,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      dimension_type,
      label_key,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY dimension_type, label_key
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM raw_directional
    GROUP BY dimension_type, label_key, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY dimension_type, label_key
),
theme_samples AS (
  SELECT
    theme,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      theme,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY theme
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM theme_directional
    GROUP BY theme, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY theme
),
raw_totals AS (
  SELECT
    'all-games'::text AS scope,
    CASE
      WHEN dimension_type = 'tag' THEN 'raw-tag'
      ELSE 'raw-genre'
    END AS series_type,
    dimension_type,
    label_key,
    MIN(label_display) AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM raw_series
  GROUP BY dimension_type, label_key
),
theme_totals AS (
  SELECT
    'all-games'::text AS scope,
    'theme'::text AS series_type,
    'theme'::text AS dimension_type,
    lower(theme) AS label_key,
    theme AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM theme_series
  GROUP BY theme
),
summary AS (
  SELECT
    rt.scope,
    rt.series_type,
    rt.label,
    rt.adds,
    rt.removes,
    rt.net_apps,
    rt.total_moves,
    COALESCE(rs.sample_apps, '') AS sample_apps
  FROM raw_totals rt
  LEFT JOIN raw_samples rs
    ON rs.dimension_type = rt.dimension_type
   AND rs.label_key = rt.label_key

  UNION ALL

  SELECT
    tt.scope,
    tt.series_type,
    tt.label,
    tt.adds,
    tt.removes,
    tt.net_apps,
    tt.total_moves,
    COALESCE(ts.sample_apps, '') AS sample_apps
  FROM theme_totals tt
  LEFT JOIN theme_samples ts
    ON ts.theme = tt.label
)

SELECT
  window_start_utc,
  window_end_utc,
  window_start_pt,
  window_end_pt,
  (SELECT COUNT(DISTINCT appid) FROM raw_directional)::int AS games_touched,
  (SELECT COUNT(*) FROM raw_directional WHERE dimension_type = 'tag')::int AS raw_tag_moves,
  (SELECT COUNT(*) FROM raw_directional WHERE dimension_type = 'genre')::int AS raw_genre_moves
FROM window_bounds;

-- Daily raw series
WITH source_events AS (
  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_added'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_removed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'
),
normalized_events AS (
  SELECT
    appid,
    app_name,
    is_released,
    occurred_at,
    (occurred_at AT TIME ZONE 'America/Los_Angeles')::date AS day_pt,
    dimension_type,
    direction,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'free to play'
      ELSE lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g'))
    END AS label_key,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'Free to Play'
      ELSE btrim(label_display_raw)
    END AS label_display
  FROM source_events
  WHERE label_display_raw IS NOT NULL
    AND btrim(label_display_raw) <> ''
),
raw_dedup AS (
  SELECT
    appid,
    MIN(app_name) AS app_name,
    BOOL_OR(is_released) AS is_released,
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    MAX(occurred_at) AS latest_occurred_at,
    BOOL_OR(direction = 'add') AS has_add,
    BOOL_OR(direction = 'remove') AS has_remove
  FROM normalized_events
  GROUP BY appid, day_pt, dimension_type, label_key
),
raw_directional AS (
  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'add'::text AS direction
  FROM raw_dedup
  WHERE has_add = TRUE
    AND has_remove = FALSE

  UNION ALL

  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'remove'::text AS direction
  FROM raw_dedup
  WHERE has_add = FALSE
    AND has_remove = TRUE
),
window_bounds AS (
  SELECT
    MIN(latest_occurred_at) AS window_start_utc,
    MAX(latest_occurred_at) AS window_end_utc,
    MIN(day_pt) AS window_start_pt,
    MAX(day_pt) AS window_end_pt
  FROM raw_directional
),
calendar AS (
  SELECT
    generate_series(window_start_pt, window_end_pt, INTERVAL '1 day')::date AS day_pt
  FROM window_bounds
),
raw_daily AS (
  SELECT
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM raw_directional
  GROUP BY day_pt, dimension_type, label_key
),
raw_labels AS (
  SELECT
    dimension_type,
    label_key,
    MIN(label_display) AS label_display
  FROM raw_directional
  GROUP BY dimension_type, label_key
),
raw_series AS (
  SELECT
    c.day_pt,
    l.dimension_type,
    l.label_key,
    l.label_display,
    COALESCE(rd.adds, 0)::int AS adds,
    COALESCE(rd.removes, 0)::int AS removes,
    (COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0))::int AS net_apps,
    COALESCE(rd.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0)) OVER (
      PARTITION BY l.dimension_type, l.label_key
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN raw_labels l
  LEFT JOIN raw_daily rd
    ON rd.day_pt = c.day_pt
   AND rd.dimension_type = l.dimension_type
   AND rd.label_key = l.label_key
),
theme_map(label_key, theme) AS (
  VALUES
    ('indie', 'Indie & Casual'),
    ('casual', 'Indie & Casual'),
    ('cozy', 'Indie & Casual'),
    ('cute', 'Indie & Casual'),
    ('family friendly', 'Indie & Casual'),
    ('funny', 'Indie & Casual'),
    ('comedy', 'Indie & Casual'),
    ('relaxing', 'Indie & Casual'),
    ('colorful', 'Indie & Casual'),
    ('action', 'Action & Combat'),
    ('action-adventure', 'Action & Combat'),
    ('arcade', 'Action & Combat'),
    ('combat', 'Action & Combat'),
    ('third person', 'Action & Combat'),
    ('top-down', 'Action & Combat'),
    ('difficult', 'Action & Combat'),
    ('adventure', 'Adventure & Story'),
    ('story rich', 'Adventure & Story'),
    ('choices matter', 'Adventure & Story'),
    ('exploration', 'Adventure & Story'),
    ('strategy', 'Strategy & Management'),
    ('management', 'Strategy & Management'),
    ('simulation', 'Simulation & Sandbox'),
    ('sandbox', 'Simulation & Sandbox'),
    ('physics', 'Simulation & Sandbox'),
    ('job simulator', 'Simulation & Sandbox'),
    ('rpg', 'RPG & Fantasy'),
    ('fantasy', 'RPG & Fantasy'),
    ('roguelite', 'RPG & Fantasy'),
    ('medieval', 'RPG & Fantasy'),
    ('character customization', 'RPG & Fantasy'),
    ('singleplayer', 'Play Modes & Social'),
    ('multiplayer', 'Play Modes & Social'),
    ('co-op', 'Play Modes & Social'),
    ('online co-op', 'Play Modes & Social'),
    ('party game', 'Play Modes & Social'),
    ('massively multiplayer', 'Play Modes & Social'),
    ('2d', 'Visual & Format'),
    ('3d', 'Visual & Format'),
    ('stylized', 'Visual & Format'),
    ('pixel graphics', 'Visual & Format'),
    ('retro', 'Visual & Format'),
    ('early access', 'Lifecycle & Business Model'),
    ('free to play', 'Lifecycle & Business Model'),
    ('atmospheric', 'Atmosphere & Horror'),
    ('dark', 'Atmosphere & Horror'),
    ('psychological horror', 'Atmosphere & Horror'),
    ('sports', 'Sports & Racing'),
    ('racing', 'Sports & Racing'),
    ('artificial intelligence', 'Tech & AI')
),
theme_directional AS (
  SELECT
    r.appid,
    MIN(r.app_name) AS app_name,
    r.day_pt,
    COALESCE(tm.theme, 'Other') AS theme,
    r.direction
  FROM raw_directional r
  LEFT JOIN theme_map tm
    ON tm.label_key = r.label_key
  GROUP BY r.appid, r.day_pt, COALESCE(tm.theme, 'Other'), r.direction
),
theme_daily AS (
  SELECT
    day_pt,
    theme,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM theme_directional
  GROUP BY day_pt, theme
),
theme_labels AS (
  SELECT DISTINCT theme
  FROM theme_directional
),
theme_series AS (
  SELECT
    c.day_pt,
    t.theme,
    COALESCE(td.adds, 0)::int AS adds,
    COALESCE(td.removes, 0)::int AS removes,
    (COALESCE(td.adds, 0) - COALESCE(td.removes, 0))::int AS net_apps,
    COALESCE(td.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(td.adds, 0) - COALESCE(td.removes, 0)) OVER (
      PARTITION BY t.theme
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN theme_labels t
  LEFT JOIN theme_daily td
    ON td.day_pt = c.day_pt
   AND td.theme = t.theme
),
raw_samples AS (
  SELECT
    dimension_type,
    label_key,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      dimension_type,
      label_key,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY dimension_type, label_key
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM raw_directional
    GROUP BY dimension_type, label_key, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY dimension_type, label_key
),
theme_samples AS (
  SELECT
    theme,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      theme,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY theme
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM theme_directional
    GROUP BY theme, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY theme
),
raw_totals AS (
  SELECT
    'all-games'::text AS scope,
    CASE
      WHEN dimension_type = 'tag' THEN 'raw-tag'
      ELSE 'raw-genre'
    END AS series_type,
    dimension_type,
    label_key,
    MIN(label_display) AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM raw_series
  GROUP BY dimension_type, label_key
),
theme_totals AS (
  SELECT
    'all-games'::text AS scope,
    'theme'::text AS series_type,
    'theme'::text AS dimension_type,
    lower(theme) AS label_key,
    theme AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM theme_series
  GROUP BY theme
),
summary AS (
  SELECT
    rt.scope,
    rt.series_type,
    rt.label,
    rt.adds,
    rt.removes,
    rt.net_apps,
    rt.total_moves,
    COALESCE(rs.sample_apps, '') AS sample_apps
  FROM raw_totals rt
  LEFT JOIN raw_samples rs
    ON rs.dimension_type = rt.dimension_type
   AND rs.label_key = rt.label_key

  UNION ALL

  SELECT
    tt.scope,
    tt.series_type,
    tt.label,
    tt.adds,
    tt.removes,
    tt.net_apps,
    tt.total_moves,
    COALESCE(ts.sample_apps, '') AS sample_apps
  FROM theme_totals tt
  LEFT JOIN theme_samples ts
    ON ts.theme = tt.label
)

SELECT
  day_pt,
  dimension_type,
  label_key,
  label_display,
  adds,
  removes,
  net_apps,
  cumulative_net_apps,
  total_moves
FROM raw_series
ORDER BY dimension_type, label_display, day_pt;

-- Daily theme series
WITH source_events AS (
  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_added'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_removed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'
),
normalized_events AS (
  SELECT
    appid,
    app_name,
    is_released,
    occurred_at,
    (occurred_at AT TIME ZONE 'America/Los_Angeles')::date AS day_pt,
    dimension_type,
    direction,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'free to play'
      ELSE lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g'))
    END AS label_key,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'Free to Play'
      ELSE btrim(label_display_raw)
    END AS label_display
  FROM source_events
  WHERE label_display_raw IS NOT NULL
    AND btrim(label_display_raw) <> ''
),
raw_dedup AS (
  SELECT
    appid,
    MIN(app_name) AS app_name,
    BOOL_OR(is_released) AS is_released,
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    MAX(occurred_at) AS latest_occurred_at,
    BOOL_OR(direction = 'add') AS has_add,
    BOOL_OR(direction = 'remove') AS has_remove
  FROM normalized_events
  GROUP BY appid, day_pt, dimension_type, label_key
),
raw_directional AS (
  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'add'::text AS direction
  FROM raw_dedup
  WHERE has_add = TRUE
    AND has_remove = FALSE

  UNION ALL

  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'remove'::text AS direction
  FROM raw_dedup
  WHERE has_add = FALSE
    AND has_remove = TRUE
),
window_bounds AS (
  SELECT
    MIN(latest_occurred_at) AS window_start_utc,
    MAX(latest_occurred_at) AS window_end_utc,
    MIN(day_pt) AS window_start_pt,
    MAX(day_pt) AS window_end_pt
  FROM raw_directional
),
calendar AS (
  SELECT
    generate_series(window_start_pt, window_end_pt, INTERVAL '1 day')::date AS day_pt
  FROM window_bounds
),
raw_daily AS (
  SELECT
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM raw_directional
  GROUP BY day_pt, dimension_type, label_key
),
raw_labels AS (
  SELECT
    dimension_type,
    label_key,
    MIN(label_display) AS label_display
  FROM raw_directional
  GROUP BY dimension_type, label_key
),
raw_series AS (
  SELECT
    c.day_pt,
    l.dimension_type,
    l.label_key,
    l.label_display,
    COALESCE(rd.adds, 0)::int AS adds,
    COALESCE(rd.removes, 0)::int AS removes,
    (COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0))::int AS net_apps,
    COALESCE(rd.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0)) OVER (
      PARTITION BY l.dimension_type, l.label_key
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN raw_labels l
  LEFT JOIN raw_daily rd
    ON rd.day_pt = c.day_pt
   AND rd.dimension_type = l.dimension_type
   AND rd.label_key = l.label_key
),
theme_map(label_key, theme) AS (
  VALUES
    ('indie', 'Indie & Casual'),
    ('casual', 'Indie & Casual'),
    ('cozy', 'Indie & Casual'),
    ('cute', 'Indie & Casual'),
    ('family friendly', 'Indie & Casual'),
    ('funny', 'Indie & Casual'),
    ('comedy', 'Indie & Casual'),
    ('relaxing', 'Indie & Casual'),
    ('colorful', 'Indie & Casual'),
    ('action', 'Action & Combat'),
    ('action-adventure', 'Action & Combat'),
    ('arcade', 'Action & Combat'),
    ('combat', 'Action & Combat'),
    ('third person', 'Action & Combat'),
    ('top-down', 'Action & Combat'),
    ('difficult', 'Action & Combat'),
    ('adventure', 'Adventure & Story'),
    ('story rich', 'Adventure & Story'),
    ('choices matter', 'Adventure & Story'),
    ('exploration', 'Adventure & Story'),
    ('strategy', 'Strategy & Management'),
    ('management', 'Strategy & Management'),
    ('simulation', 'Simulation & Sandbox'),
    ('sandbox', 'Simulation & Sandbox'),
    ('physics', 'Simulation & Sandbox'),
    ('job simulator', 'Simulation & Sandbox'),
    ('rpg', 'RPG & Fantasy'),
    ('fantasy', 'RPG & Fantasy'),
    ('roguelite', 'RPG & Fantasy'),
    ('medieval', 'RPG & Fantasy'),
    ('character customization', 'RPG & Fantasy'),
    ('singleplayer', 'Play Modes & Social'),
    ('multiplayer', 'Play Modes & Social'),
    ('co-op', 'Play Modes & Social'),
    ('online co-op', 'Play Modes & Social'),
    ('party game', 'Play Modes & Social'),
    ('massively multiplayer', 'Play Modes & Social'),
    ('2d', 'Visual & Format'),
    ('3d', 'Visual & Format'),
    ('stylized', 'Visual & Format'),
    ('pixel graphics', 'Visual & Format'),
    ('retro', 'Visual & Format'),
    ('early access', 'Lifecycle & Business Model'),
    ('free to play', 'Lifecycle & Business Model'),
    ('atmospheric', 'Atmosphere & Horror'),
    ('dark', 'Atmosphere & Horror'),
    ('psychological horror', 'Atmosphere & Horror'),
    ('sports', 'Sports & Racing'),
    ('racing', 'Sports & Racing'),
    ('artificial intelligence', 'Tech & AI')
),
theme_directional AS (
  SELECT
    r.appid,
    MIN(r.app_name) AS app_name,
    r.day_pt,
    COALESCE(tm.theme, 'Other') AS theme,
    r.direction
  FROM raw_directional r
  LEFT JOIN theme_map tm
    ON tm.label_key = r.label_key
  GROUP BY r.appid, r.day_pt, COALESCE(tm.theme, 'Other'), r.direction
),
theme_daily AS (
  SELECT
    day_pt,
    theme,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM theme_directional
  GROUP BY day_pt, theme
),
theme_labels AS (
  SELECT DISTINCT theme
  FROM theme_directional
),
theme_series AS (
  SELECT
    c.day_pt,
    t.theme,
    COALESCE(td.adds, 0)::int AS adds,
    COALESCE(td.removes, 0)::int AS removes,
    (COALESCE(td.adds, 0) - COALESCE(td.removes, 0))::int AS net_apps,
    COALESCE(td.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(td.adds, 0) - COALESCE(td.removes, 0)) OVER (
      PARTITION BY t.theme
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN theme_labels t
  LEFT JOIN theme_daily td
    ON td.day_pt = c.day_pt
   AND td.theme = t.theme
),
raw_samples AS (
  SELECT
    dimension_type,
    label_key,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      dimension_type,
      label_key,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY dimension_type, label_key
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM raw_directional
    GROUP BY dimension_type, label_key, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY dimension_type, label_key
),
theme_samples AS (
  SELECT
    theme,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      theme,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY theme
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM theme_directional
    GROUP BY theme, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY theme
),
raw_totals AS (
  SELECT
    'all-games'::text AS scope,
    CASE
      WHEN dimension_type = 'tag' THEN 'raw-tag'
      ELSE 'raw-genre'
    END AS series_type,
    dimension_type,
    label_key,
    MIN(label_display) AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM raw_series
  GROUP BY dimension_type, label_key
),
theme_totals AS (
  SELECT
    'all-games'::text AS scope,
    'theme'::text AS series_type,
    'theme'::text AS dimension_type,
    lower(theme) AS label_key,
    theme AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM theme_series
  GROUP BY theme
),
summary AS (
  SELECT
    rt.scope,
    rt.series_type,
    rt.label,
    rt.adds,
    rt.removes,
    rt.net_apps,
    rt.total_moves,
    COALESCE(rs.sample_apps, '') AS sample_apps
  FROM raw_totals rt
  LEFT JOIN raw_samples rs
    ON rs.dimension_type = rt.dimension_type
   AND rs.label_key = rt.label_key

  UNION ALL

  SELECT
    tt.scope,
    tt.series_type,
    tt.label,
    tt.adds,
    tt.removes,
    tt.net_apps,
    tt.total_moves,
    COALESCE(ts.sample_apps, '') AS sample_apps
  FROM theme_totals tt
  LEFT JOIN theme_samples ts
    ON ts.theme = tt.label
)

SELECT
  day_pt,
  theme,
  adds,
  removes,
  net_apps,
  cumulative_net_apps,
  total_moves
FROM theme_series
ORDER BY theme, day_pt;

-- Summary
WITH source_events AS (
  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_added'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'tag'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(st.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_tags st
    ON st.tag_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'tags_removed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'add'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'added', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'

  UNION ALL

  SELECT
    e.appid,
    a.name AS app_name,
    a.is_released,
    e.occurred_at,
    'genre'::text AS dimension_type,
    'remove'::text AS direction,
    COALESCE(sg.name, x.value) AS label_display_raw
  FROM app_change_events e
  JOIN apps a ON a.appid = e.appid
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.context -> 'removed', '[]'::jsonb)) AS x(value)
  LEFT JOIN steam_genres sg
    ON sg.genre_id = CASE WHEN x.value ~ '^[0-9]+$' THEN x.value::int ELSE NULL END
  WHERE a.type = 'game'
    AND e.change_type = 'genres_changed'
),
normalized_events AS (
  SELECT
    appid,
    app_name,
    is_released,
    occurred_at,
    (occurred_at AT TIME ZONE 'America/Los_Angeles')::date AS day_pt,
    dimension_type,
    direction,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'free to play'
      ELSE lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g'))
    END AS label_key,
    CASE
      WHEN lower(regexp_replace(btrim(label_display_raw), '\s+', ' ', 'g')) = 'free to play'
        THEN 'Free to Play'
      ELSE btrim(label_display_raw)
    END AS label_display
  FROM source_events
  WHERE label_display_raw IS NOT NULL
    AND btrim(label_display_raw) <> ''
),
raw_dedup AS (
  SELECT
    appid,
    MIN(app_name) AS app_name,
    BOOL_OR(is_released) AS is_released,
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    MAX(occurred_at) AS latest_occurred_at,
    BOOL_OR(direction = 'add') AS has_add,
    BOOL_OR(direction = 'remove') AS has_remove
  FROM normalized_events
  GROUP BY appid, day_pt, dimension_type, label_key
),
raw_directional AS (
  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'add'::text AS direction
  FROM raw_dedup
  WHERE has_add = TRUE
    AND has_remove = FALSE

  UNION ALL

  SELECT
    appid,
    app_name,
    is_released,
    day_pt,
    latest_occurred_at,
    dimension_type,
    label_key,
    label_display,
    'remove'::text AS direction
  FROM raw_dedup
  WHERE has_add = FALSE
    AND has_remove = TRUE
),
window_bounds AS (
  SELECT
    MIN(latest_occurred_at) AS window_start_utc,
    MAX(latest_occurred_at) AS window_end_utc,
    MIN(day_pt) AS window_start_pt,
    MAX(day_pt) AS window_end_pt
  FROM raw_directional
),
calendar AS (
  SELECT
    generate_series(window_start_pt, window_end_pt, INTERVAL '1 day')::date AS day_pt
  FROM window_bounds
),
raw_daily AS (
  SELECT
    day_pt,
    dimension_type,
    label_key,
    MIN(label_display) AS label_display,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM raw_directional
  GROUP BY day_pt, dimension_type, label_key
),
raw_labels AS (
  SELECT
    dimension_type,
    label_key,
    MIN(label_display) AS label_display
  FROM raw_directional
  GROUP BY dimension_type, label_key
),
raw_series AS (
  SELECT
    c.day_pt,
    l.dimension_type,
    l.label_key,
    l.label_display,
    COALESCE(rd.adds, 0)::int AS adds,
    COALESCE(rd.removes, 0)::int AS removes,
    (COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0))::int AS net_apps,
    COALESCE(rd.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(rd.adds, 0) - COALESCE(rd.removes, 0)) OVER (
      PARTITION BY l.dimension_type, l.label_key
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN raw_labels l
  LEFT JOIN raw_daily rd
    ON rd.day_pt = c.day_pt
   AND rd.dimension_type = l.dimension_type
   AND rd.label_key = l.label_key
),
theme_map(label_key, theme) AS (
  VALUES
    ('indie', 'Indie & Casual'),
    ('casual', 'Indie & Casual'),
    ('cozy', 'Indie & Casual'),
    ('cute', 'Indie & Casual'),
    ('family friendly', 'Indie & Casual'),
    ('funny', 'Indie & Casual'),
    ('comedy', 'Indie & Casual'),
    ('relaxing', 'Indie & Casual'),
    ('colorful', 'Indie & Casual'),
    ('action', 'Action & Combat'),
    ('action-adventure', 'Action & Combat'),
    ('arcade', 'Action & Combat'),
    ('combat', 'Action & Combat'),
    ('third person', 'Action & Combat'),
    ('top-down', 'Action & Combat'),
    ('difficult', 'Action & Combat'),
    ('adventure', 'Adventure & Story'),
    ('story rich', 'Adventure & Story'),
    ('choices matter', 'Adventure & Story'),
    ('exploration', 'Adventure & Story'),
    ('strategy', 'Strategy & Management'),
    ('management', 'Strategy & Management'),
    ('simulation', 'Simulation & Sandbox'),
    ('sandbox', 'Simulation & Sandbox'),
    ('physics', 'Simulation & Sandbox'),
    ('job simulator', 'Simulation & Sandbox'),
    ('rpg', 'RPG & Fantasy'),
    ('fantasy', 'RPG & Fantasy'),
    ('roguelite', 'RPG & Fantasy'),
    ('medieval', 'RPG & Fantasy'),
    ('character customization', 'RPG & Fantasy'),
    ('singleplayer', 'Play Modes & Social'),
    ('multiplayer', 'Play Modes & Social'),
    ('co-op', 'Play Modes & Social'),
    ('online co-op', 'Play Modes & Social'),
    ('party game', 'Play Modes & Social'),
    ('massively multiplayer', 'Play Modes & Social'),
    ('2d', 'Visual & Format'),
    ('3d', 'Visual & Format'),
    ('stylized', 'Visual & Format'),
    ('pixel graphics', 'Visual & Format'),
    ('retro', 'Visual & Format'),
    ('early access', 'Lifecycle & Business Model'),
    ('free to play', 'Lifecycle & Business Model'),
    ('atmospheric', 'Atmosphere & Horror'),
    ('dark', 'Atmosphere & Horror'),
    ('psychological horror', 'Atmosphere & Horror'),
    ('sports', 'Sports & Racing'),
    ('racing', 'Sports & Racing'),
    ('artificial intelligence', 'Tech & AI')
),
theme_directional AS (
  SELECT
    r.appid,
    MIN(r.app_name) AS app_name,
    r.day_pt,
    COALESCE(tm.theme, 'Other') AS theme,
    r.direction
  FROM raw_directional r
  LEFT JOIN theme_map tm
    ON tm.label_key = r.label_key
  GROUP BY r.appid, r.day_pt, COALESCE(tm.theme, 'Other'), r.direction
),
theme_daily AS (
  SELECT
    day_pt,
    theme,
    COUNT(*) FILTER (WHERE direction = 'add')::int AS adds,
    COUNT(*) FILTER (WHERE direction = 'remove')::int AS removes,
    COUNT(*)::int AS total_moves
  FROM theme_directional
  GROUP BY day_pt, theme
),
theme_labels AS (
  SELECT DISTINCT theme
  FROM theme_directional
),
theme_series AS (
  SELECT
    c.day_pt,
    t.theme,
    COALESCE(td.adds, 0)::int AS adds,
    COALESCE(td.removes, 0)::int AS removes,
    (COALESCE(td.adds, 0) - COALESCE(td.removes, 0))::int AS net_apps,
    COALESCE(td.total_moves, 0)::int AS total_moves,
    SUM(COALESCE(td.adds, 0) - COALESCE(td.removes, 0)) OVER (
      PARTITION BY t.theme
      ORDER BY c.day_pt
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::int AS cumulative_net_apps
  FROM calendar c
  CROSS JOIN theme_labels t
  LEFT JOIN theme_daily td
    ON td.day_pt = c.day_pt
   AND td.theme = t.theme
),
raw_samples AS (
  SELECT
    dimension_type,
    label_key,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      dimension_type,
      label_key,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY dimension_type, label_key
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM raw_directional
    GROUP BY dimension_type, label_key, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY dimension_type, label_key
),
theme_samples AS (
  SELECT
    theme,
    STRING_AGG(app_name, ', ' ORDER BY latest_day DESC, app_name) AS sample_apps
  FROM (
    SELECT
      theme,
      app_name,
      MAX(day_pt) AS latest_day,
      ROW_NUMBER() OVER (
        PARTITION BY theme
        ORDER BY MAX(day_pt) DESC, app_name
      ) AS rn
    FROM theme_directional
    GROUP BY theme, app_name
  ) ranked
  WHERE rn <= 3
  GROUP BY theme
),
raw_totals AS (
  SELECT
    'all-games'::text AS scope,
    CASE
      WHEN dimension_type = 'tag' THEN 'raw-tag'
      ELSE 'raw-genre'
    END AS series_type,
    dimension_type,
    label_key,
    MIN(label_display) AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM raw_series
  GROUP BY dimension_type, label_key
),
theme_totals AS (
  SELECT
    'all-games'::text AS scope,
    'theme'::text AS series_type,
    'theme'::text AS dimension_type,
    lower(theme) AS label_key,
    theme AS label,
    SUM(adds)::int AS adds,
    SUM(removes)::int AS removes,
    SUM(net_apps)::int AS net_apps,
    SUM(total_moves)::int AS total_moves
  FROM theme_series
  GROUP BY theme
),
summary AS (
  SELECT
    rt.scope,
    rt.series_type,
    rt.label,
    rt.adds,
    rt.removes,
    rt.net_apps,
    rt.total_moves,
    COALESCE(rs.sample_apps, '') AS sample_apps
  FROM raw_totals rt
  LEFT JOIN raw_samples rs
    ON rs.dimension_type = rt.dimension_type
   AND rs.label_key = rt.label_key

  UNION ALL

  SELECT
    tt.scope,
    tt.series_type,
    tt.label,
    tt.adds,
    tt.removes,
    tt.net_apps,
    tt.total_moves,
    COALESCE(ts.sample_apps, '') AS sample_apps
  FROM theme_totals tt
  LEFT JOIN theme_samples ts
    ON ts.theme = tt.label
)

SELECT
  scope,
  series_type,
  label,
  adds,
  removes,
  net_apps,
  total_moves,
  sample_apps
FROM summary
ORDER BY series_type, total_moves DESC, ABS(net_apps) DESC, label;
