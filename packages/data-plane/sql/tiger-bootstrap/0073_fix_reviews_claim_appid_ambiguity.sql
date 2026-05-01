-- Fix plpgsql name resolution in the review claim RPC.
-- RETURNS TABLE exposes "appid" as an output variable, so unqualified CTE
-- references to appid can become ambiguous at runtime.

CREATE OR REPLACE FUNCTION ops.claim_apps_for_reviews_sync(
    p_worker_id text,
    p_limit integer DEFAULT 100,
    p_claim_ttl_minutes integer DEFAULT 15,
    p_launch_limit integer DEFAULT 25,
    p_change_limit integer DEFAULT 20,
    p_active_limit integer DEFAULT 35,
    p_backfill_limit integer DEFAULT 19,
    p_unknown_limit integer DEFAULT 1
)
RETURNS TABLE (
    appid integer,
    lane text,
    priority_score integer,
    velocity_tier text,
    hours_overdue numeric,
    last_known_total_reviews integer,
    last_reviews_sync timestamp with time zone
)
LANGUAGE plpgsql
SET search_path = ops, legacy, metrics, public
AS $$
DECLARE
    v_now timestamp with time zone := now();
    v_requested_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
    v_claim_ttl_minutes integer := GREATEST(1, LEAST(COALESCE(p_claim_ttl_minutes, 15), 240));
    v_total_weight integer := GREATEST(
      COALESCE(p_launch_limit, 0)
      + COALESCE(p_change_limit, 0)
      + COALESCE(p_active_limit, 0)
      + COALESCE(p_backfill_limit, 0)
      + COALESCE(p_unknown_limit, 0),
      1
    );
    v_launch_quota integer := FLOOR(v_requested_limit::numeric * COALESCE(p_launch_limit, 0) / v_total_weight)::integer;
    v_change_quota integer := FLOOR(v_requested_limit::numeric * COALESCE(p_change_limit, 0) / v_total_weight)::integer;
    v_active_quota integer := FLOOR(v_requested_limit::numeric * COALESCE(p_active_limit, 0) / v_total_weight)::integer;
    v_backfill_quota integer := FLOOR(v_requested_limit::numeric * COALESCE(p_backfill_limit, 0) / v_total_weight)::integer;
    v_unknown_quota integer := FLOOR(v_requested_limit::numeric * COALESCE(p_unknown_limit, 0) / v_total_weight)::integer;
    v_seed_limit integer := LEAST(GREATEST(v_requested_limit * 20, 500), 2000);
    v_override_seed_limit integer := LEAST(GREATEST(v_requested_limit * 4, 100), 400);
    v_expired_seed_limit integer := LEAST(GREATEST((v_seed_limit + 3) / 4, 100), 500);
BEGIN
    RETURN QUERY
    WITH override_seed AS (
      SELECT s.appid
      FROM sync_status s
      WHERE COALESCE(s.is_syncable, true) = true
        AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
        AND (s.reviews_claim_expires_at IS NULL OR s.reviews_claim_expires_at <= v_now)
        AND s.reviews_priority_override_until IS NOT NULL
        AND s.reviews_priority_override_until > v_now
        AND s.reviews_priority_override_bucket IS NOT NULL
      ORDER BY
        COALESCE(s.reviews_priority_override_score, 0) DESC,
        s.next_reviews_sync ASC NULLS FIRST,
        COALESCE(s.priority_score, 0) DESC,
        s.appid ASC
      LIMIT v_override_seed_limit
    ),
    due_seed_unclaimed AS (
      SELECT s.appid
      FROM sync_status s
      LEFT JOIN apps a ON a.appid = s.appid
      LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
      WHERE COALESCE(s.is_syncable, true) = true
        AND s.reviews_claim_expires_at IS NULL
        AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
        AND NOT (
          a.release_date > CURRENT_DATE + INTERVAL '7 days'
          AND COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) = 0
          AND NOT (
            s.reviews_priority_override_until IS NOT NULL
            AND s.reviews_priority_override_until > v_now
            AND s.reviews_priority_override_bucket IS NOT NULL
          )
        )
      ORDER BY
        s.next_reviews_sync ASC NULLS FIRST,
        COALESCE(s.priority_score, 0) DESC,
        s.appid ASC
      LIMIT v_seed_limit
    ),
    due_seed_expired AS (
      SELECT s.appid
      FROM sync_status s
      LEFT JOIN apps a ON a.appid = s.appid
      LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
      WHERE COALESCE(s.is_syncable, true) = true
        AND s.reviews_claim_expires_at <= v_now
        AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
        AND NOT (
          a.release_date > CURRENT_DATE + INTERVAL '7 days'
          AND COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) = 0
          AND NOT (
            s.reviews_priority_override_until IS NOT NULL
            AND s.reviews_priority_override_until > v_now
            AND s.reviews_priority_override_bucket IS NOT NULL
          )
        )
      ORDER BY
        s.reviews_claim_expires_at ASC,
        s.next_reviews_sync ASC NULLS FIRST,
        COALESCE(s.priority_score, 0) DESC,
        s.appid ASC
      LIMIT v_expired_seed_limit
    ),
    seed_appids AS (
      SELECT override_seed.appid FROM override_seed
      UNION
      SELECT due_seed_unclaimed.appid FROM due_seed_unclaimed
      UNION
      SELECT due_seed_expired.appid FROM due_seed_expired
    ),
    candidate_pool AS (
      SELECT
        s.appid,
        CASE
          WHEN s.reviews_priority_override_until IS NOT NULL
               AND s.reviews_priority_override_until > v_now
               AND s.reviews_priority_override_bucket IS NOT NULL
          THEN s.reviews_priority_override_bucket
          WHEN COALESCE(a.is_released, false) = true
               AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
          THEN 'launch_critical'
          WHEN COALESCE(s.review_velocity_tier, 'unknown') IN ('high', 'medium')
               OR COALESCE(s.velocity_7d, 0) >= 1
          THEN 'active_reviews'
          WHEN COALESCE(s.priority_score, 0) >= 50
               OR COALESCE(s.last_known_total_reviews, 0) >= 1000
          THEN 'important_backfill'
          ELSE 'unknown_sweep'
        END::text AS lane,
        COALESCE(s.priority_score, 0)::integer AS priority_score,
        COALESCE(s.review_velocity_tier, 'unknown')::text AS velocity_tier,
        (EXTRACT(EPOCH FROM (v_now - COALESCE(s.next_reviews_sync, v_now))) / 3600.0)::numeric AS hours_overdue,
        s.last_known_total_reviews,
        s.last_reviews_sync,
        COALESCE(s.reviews_priority_override_score, 0)::integer AS sort_override_score,
        CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END AS sort_never_synced,
        COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) AS sort_due_at,
        COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0)::integer AS sort_total_reviews
      FROM sync_status s
      JOIN seed_appids seed ON seed.appid = s.appid
      LEFT JOIN apps a ON a.appid = s.appid
      LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
      WHERE COALESCE(s.is_syncable, true) = true
        AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
        AND (s.reviews_claim_expires_at IS NULL OR s.reviews_claim_expires_at <= v_now)
      FOR UPDATE OF s SKIP LOCKED
    ),
    ranked AS (
      SELECT
        cp.*,
        row_number() OVER (
          PARTITION BY cp.lane
          ORDER BY
            cp.sort_override_score DESC,
            cp.sort_never_synced ASC,
            cp.sort_due_at ASC NULLS FIRST,
            cp.priority_score DESC,
            cp.sort_total_reviews DESC,
            cp.appid ASC
        ) AS lane_rank
      FROM candidate_pool cp
    ),
    primary_claims AS (
      SELECT r.*
      FROM ranked r
      WHERE (r.lane = 'launch_critical' AND r.lane_rank <= v_launch_quota)
         OR (r.lane = 'change_critical' AND r.lane_rank <= v_change_quota)
         OR (r.lane = 'active_reviews' AND r.lane_rank <= v_active_quota)
         OR (r.lane = 'important_backfill' AND r.lane_rank <= v_backfill_quota)
         OR (r.lane = 'unknown_sweep' AND r.lane_rank <= v_unknown_quota)
    ),
    primary_count AS (
      SELECT count(*) AS count FROM primary_claims
    ),
    reallocated_claims AS (
      SELECT r.*
      FROM ranked r
      WHERE NOT EXISTS (
        SELECT 1
        FROM primary_claims pc
        WHERE pc.appid = r.appid
      )
      ORDER BY
        CASE r.lane
          WHEN 'launch_critical' THEN 0
          WHEN 'change_critical' THEN 1
          WHEN 'active_reviews' THEN 2
          WHEN 'important_backfill' THEN 3
          ELSE 4
        END,
        r.sort_override_score DESC,
        r.sort_never_synced ASC,
        r.sort_due_at ASC NULLS FIRST,
        r.priority_score DESC,
        r.sort_total_reviews DESC,
        r.appid ASC
      LIMIT GREATEST(v_requested_limit - (SELECT count FROM primary_count), 0)
    ),
    selected AS (
      SELECT * FROM primary_claims
      UNION ALL
      SELECT * FROM reallocated_claims
    )
    UPDATE sync_status s
    SET reviews_claimed_by = p_worker_id,
        reviews_claimed_at = v_now,
        reviews_claim_expires_at = v_now + make_interval(mins => v_claim_ttl_minutes)
    FROM selected sel
    WHERE s.appid = sel.appid
    RETURNING
      s.appid,
      sel.lane,
      sel.priority_score,
      sel.velocity_tier,
      sel.hours_overdue,
      sel.last_known_total_reviews,
      sel.last_reviews_sync;
END;
$$;
