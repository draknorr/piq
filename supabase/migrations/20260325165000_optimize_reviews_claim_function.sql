-- Migration: Optimize reviews claim RPC to avoid statement timeout
-- Purpose:
--   Replace the multi-scan lane query with a single candidate pass that
--   computes lane assignment once, ranks once, and then applies quotas.

CREATE OR REPLACE FUNCTION claim_apps_for_reviews_sync(
    p_worker_id TEXT,
    p_limit INTEGER DEFAULT 100,
    p_claim_ttl_minutes INTEGER DEFAULT 15,
    p_launch_limit INTEGER DEFAULT 25,
    p_change_limit INTEGER DEFAULT 20,
    p_active_limit INTEGER DEFAULT 35,
    p_backfill_limit INTEGER DEFAULT 10,
    p_unknown_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    appid INTEGER,
    lane TEXT,
    priority_score INTEGER,
    velocity_tier TEXT,
    hours_overdue DECIMAL,
    last_known_total_reviews INTEGER,
    last_reviews_sync TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_requested_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
    v_claim_ttl_minutes INTEGER := GREATEST(1, LEAST(COALESCE(p_claim_ttl_minutes, 15), 240));
    v_total_weight INTEGER := GREATEST(
        COALESCE(p_launch_limit, 0)
        + COALESCE(p_change_limit, 0)
        + COALESCE(p_active_limit, 0)
        + COALESCE(p_backfill_limit, 0)
        + COALESCE(p_unknown_limit, 0),
        1
    );
    v_launch_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_launch_limit, 0) / v_total_weight)::INTEGER;
    v_change_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_change_limit, 0) / v_total_weight)::INTEGER;
    v_active_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_active_limit, 0) / v_total_weight)::INTEGER;
    v_backfill_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_backfill_limit, 0) / v_total_weight)::INTEGER;
    v_unknown_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_unknown_limit, 0) / v_total_weight)::INTEGER;
BEGIN
    RETURN QUERY
    WITH candidate_pool AS (
        SELECT
            s.appid,
            CASE
                WHEN s.reviews_priority_override_until IS NOT NULL
                     AND s.reviews_priority_override_until > v_now
                     AND s.reviews_priority_override_bucket IS NOT NULL
                THEN s.reviews_priority_override_bucket
                WHEN COALESCE(a.is_released, FALSE) = TRUE
                     AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
                THEN 'launch_critical'
                WHEN COALESCE(s.review_velocity_tier, 'unknown') IN ('high', 'medium')
                     OR COALESCE(at.review_velocity_7d, s.velocity_7d, 0) >= 1
                THEN 'active_reviews'
                WHEN COALESCE(s.priority_score, 0) >= 50
                     OR COALESCE(ct.ccu_tier, 99) IN (1, 2)
                     OR COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) >= 1000
                THEN 'important_backfill'
                ELSE 'unknown_sweep'
            END::TEXT AS lane,
            COALESCE(s.priority_score, 0)::INTEGER AS priority_score,
            COALESCE(s.review_velocity_tier, 'unknown')::TEXT AS velocity_tier,
            (EXTRACT(EPOCH FROM (v_now - COALESCE(s.next_reviews_sync, v_now))) / 3600.0)::DECIMAL AS hours_overdue,
            s.last_known_total_reviews,
            s.last_reviews_sync,
            COALESCE(s.reviews_priority_override_score, 0)::INTEGER AS sort_override_score,
            CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END AS sort_never_synced,
            COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) AS sort_due_at,
            COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0)::INTEGER AS sort_total_reviews
        FROM sync_status s
        LEFT JOIN apps a ON a.appid = s.appid
        LEFT JOIN app_trends at ON at.appid = s.appid
        LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
        LEFT JOIN ccu_tier_assignments ct ON ct.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
          AND (s.reviews_claim_expires_at IS NULL OR s.reviews_claim_expires_at <= v_now)
        FOR UPDATE OF s SKIP LOCKED
    ),
    ranked AS (
        SELECT
            cp.*,
            ROW_NUMBER() OVER (
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
        SELECT COUNT(*) AS count
        FROM primary_claims
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
    SET
        reviews_claimed_by = p_worker_id,
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

COMMENT ON FUNCTION claim_apps_for_reviews_sync IS
    'Claim due apps for reviews sync using a single-pass lane ranking strategy with quota reallocation.';
