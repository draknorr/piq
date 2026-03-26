-- Migration: Harden reviews sync scheduling and shared rate limiting
-- Purpose:
--   1. Prevent reviews queue starvation with claim/lease-based scheduling
--   2. Enforce a shared reviews API budget across workers
--   3. Add short-lived review promotions for new, changed, and important apps
--   4. Move previously-synced no-signal apps out of the sticky "unknown" tier

ALTER TABLE sync_status
    ADD COLUMN IF NOT EXISTS reviews_claimed_by TEXT,
    ADD COLUMN IF NOT EXISTS reviews_claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviews_claim_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviews_priority_override_bucket TEXT,
    ADD COLUMN IF NOT EXISTS reviews_priority_override_score INTEGER,
    ADD COLUMN IF NOT EXISTS reviews_priority_override_reason TEXT,
    ADD COLUMN IF NOT EXISTS reviews_priority_override_until TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_reviews_priority_override_bucket'
    ) THEN
        ALTER TABLE sync_status
            ADD CONSTRAINT chk_reviews_priority_override_bucket
            CHECK (
                reviews_priority_override_bucket IS NULL
                OR reviews_priority_override_bucket IN (
                    'launch_critical',
                    'change_critical',
                    'active_reviews',
                    'important_backfill',
                    'unknown_sweep'
                )
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sync_status_reviews_claimable
    ON sync_status(next_reviews_sync, review_velocity_tier, priority_score DESC)
    WHERE is_syncable = TRUE;

CREATE INDEX IF NOT EXISTS idx_sync_status_reviews_claim_lease
    ON sync_status(reviews_claim_expires_at, next_reviews_sync)
    WHERE is_syncable = TRUE;

CREATE INDEX IF NOT EXISTS idx_sync_status_reviews_override
    ON sync_status(reviews_priority_override_until, reviews_priority_override_bucket, reviews_priority_override_score DESC)
    WHERE reviews_priority_override_until IS NOT NULL;

COMMENT ON COLUMN sync_status.reviews_claimed_by IS
    'Worker id currently holding the reviews-sync lease.';

COMMENT ON COLUMN sync_status.reviews_claimed_at IS
    'When the current reviews-sync lease was acquired.';

COMMENT ON COLUMN sync_status.reviews_claim_expires_at IS
    'Lease expiry for the current reviews-sync claim.';

COMMENT ON COLUMN sync_status.reviews_priority_override_bucket IS
    'Short-lived override lane for review scheduling: launch_critical, change_critical, active_reviews, important_backfill, unknown_sweep.';

COMMENT ON COLUMN sync_status.reviews_priority_override_score IS
    'Relative urgency score for the active review scheduling override.';

COMMENT ON COLUMN sync_status.reviews_priority_override_reason IS
    'Reason string describing why an app was promoted for review sync.';

COMMENT ON COLUMN sync_status.reviews_priority_override_until IS
    'Expiry timestamp for the current review scheduling override.';

CREATE TABLE IF NOT EXISTS api_rate_limit_state (
    source TEXT PRIMARY KEY,
    available_tokens NUMERIC NOT NULL,
    max_tokens NUMERIC NOT NULL,
    refill_rate_per_second NUMERIC NOT NULL,
    last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_worker_id TEXT
);

COMMENT ON TABLE api_rate_limit_state IS
    'Shared per-source API budget state used to coordinate rate limits across workers.';

INSERT INTO api_rate_limit_state (
    source,
    available_tokens,
    max_tokens,
    refill_rate_per_second,
    last_refill_at,
    updated_at
)
VALUES (
    'reviews',
    1,
    1,
    1,
    NOW(),
    NOW()
)
ON CONFLICT (source) DO NOTHING;

CREATE OR REPLACE FUNCTION acquire_api_rate_token(
    p_source TEXT,
    p_worker_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    granted BOOLEAN,
    wait_ms INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_available_tokens NUMERIC;
    v_max_tokens NUMERIC;
    v_refill_rate NUMERIC;
    v_last_refill_at TIMESTAMPTZ;
    v_elapsed_seconds NUMERIC;
    v_refilled_tokens NUMERIC;
    v_wait_ms INTEGER;
BEGIN
    INSERT INTO api_rate_limit_state (
        source,
        available_tokens,
        max_tokens,
        refill_rate_per_second,
        last_refill_at,
        updated_at,
        last_worker_id
    )
    VALUES (
        p_source,
        1,
        1,
        1,
        v_now,
        v_now,
        p_worker_id
    )
    ON CONFLICT (source) DO NOTHING;

    SELECT
        available_tokens,
        max_tokens,
        refill_rate_per_second,
        last_refill_at
    INTO
        v_available_tokens,
        v_max_tokens,
        v_refill_rate,
        v_last_refill_at
    FROM api_rate_limit_state
    WHERE source = p_source
    FOR UPDATE;

    IF v_max_tokens IS NULL OR v_max_tokens < 1 THEN
        v_max_tokens := 1;
    END IF;

    IF v_refill_rate IS NULL OR v_refill_rate <= 0 THEN
        v_refill_rate := 1;
    END IF;

    IF v_available_tokens IS NULL THEN
        v_available_tokens := v_max_tokens;
    END IF;

    IF v_last_refill_at IS NULL THEN
        v_last_refill_at := v_now;
    END IF;

    v_elapsed_seconds := GREATEST(EXTRACT(EPOCH FROM (v_now - v_last_refill_at)), 0);
    v_refilled_tokens := LEAST(v_max_tokens, v_available_tokens + (v_elapsed_seconds * v_refill_rate));

    IF v_refilled_tokens >= 1 THEN
        UPDATE api_rate_limit_state
        SET
            available_tokens = v_refilled_tokens - 1,
            max_tokens = v_max_tokens,
            refill_rate_per_second = v_refill_rate,
            last_refill_at = v_now,
            updated_at = v_now,
            last_worker_id = p_worker_id
        WHERE source = p_source;

        RETURN QUERY SELECT TRUE, 0;
        RETURN;
    END IF;

    v_wait_ms := CEIL(((1 - v_refilled_tokens) / v_refill_rate) * 1000)::INTEGER;

    UPDATE api_rate_limit_state
    SET
        available_tokens = v_refilled_tokens,
        max_tokens = v_max_tokens,
        refill_rate_per_second = v_refill_rate,
        last_refill_at = v_now,
        updated_at = v_now,
        last_worker_id = p_worker_id
    WHERE source = p_source;

    RETURN QUERY SELECT FALSE, GREATEST(v_wait_ms, 1);
END;
$$;

COMMENT ON FUNCTION acquire_api_rate_token IS
    'Attempt to consume one shared API token for a source. Returns granted=false with wait_ms when the caller should retry later.';

CREATE OR REPLACE FUNCTION promote_reviews_sync(
    p_appid INTEGER,
    p_bucket TEXT,
    p_score INTEGER,
    p_reason TEXT,
    p_until TIMESTAMPTZ
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_until TIMESTAMPTZ := COALESCE(p_until, v_now + INTERVAL '2 hours');
    v_score INTEGER := GREATEST(COALESCE(p_score, 0), 0);
BEGIN
    IF p_bucket NOT IN (
        'launch_critical',
        'change_critical',
        'active_reviews',
        'important_backfill',
        'unknown_sweep'
    ) THEN
        RAISE EXCEPTION 'Unsupported reviews override bucket: %', p_bucket;
    END IF;

    INSERT INTO sync_status (
        appid,
        reviews_priority_override_bucket,
        reviews_priority_override_score,
        reviews_priority_override_reason,
        reviews_priority_override_until,
        next_reviews_sync
    )
    VALUES (
        p_appid,
        p_bucket,
        v_score,
        p_reason,
        v_until,
        v_now
    )
    ON CONFLICT (appid) DO UPDATE
    SET
        reviews_priority_override_bucket = CASE
            WHEN sync_status.reviews_priority_override_until IS NOT NULL
                 AND sync_status.reviews_priority_override_until > v_now
                 AND COALESCE(sync_status.reviews_priority_override_score, 0) > v_score
            THEN sync_status.reviews_priority_override_bucket
            ELSE EXCLUDED.reviews_priority_override_bucket
        END,
        reviews_priority_override_score = GREATEST(
            COALESCE(sync_status.reviews_priority_override_score, 0),
            v_score
        ),
        reviews_priority_override_reason = CASE
            WHEN sync_status.reviews_priority_override_until IS NOT NULL
                 AND sync_status.reviews_priority_override_until > v_now
                 AND COALESCE(sync_status.reviews_priority_override_score, 0) > v_score
            THEN sync_status.reviews_priority_override_reason
            ELSE EXCLUDED.reviews_priority_override_reason
        END,
        reviews_priority_override_until = GREATEST(
            COALESCE(sync_status.reviews_priority_override_until, v_now),
            v_until
        ),
        next_reviews_sync = LEAST(COALESCE(sync_status.next_reviews_sync, v_now), v_now);
END;
$$;

COMMENT ON FUNCTION promote_reviews_sync IS
    'Promote an app into a short-lived reviews scheduling lane and pull next_reviews_sync forward to now.';

CREATE OR REPLACE FUNCTION update_review_velocity_tiers()
RETURNS TABLE(count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_deltas INTEGER := 0;
    v_from_trends INTEGER := 0;
    v_from_no_signal INTEGER := 0;
BEGIN
    UPDATE sync_status s
    SET
        velocity_7d = rvs.velocity_7d,
        review_velocity_tier = rvs.velocity_tier,
        reviews_interval_hours = CASE rvs.velocity_tier
            WHEN 'high' THEN 4
            WHEN 'medium' THEN 12
            WHEN 'low' THEN 24
            ELSE 72
        END,
        velocity_calculated_at = NOW()
    FROM review_velocity_stats rvs
    WHERE s.appid = rvs.appid
      AND (
        s.velocity_7d IS DISTINCT FROM rvs.velocity_7d
        OR s.review_velocity_tier IS DISTINCT FROM rvs.velocity_tier
        OR s.reviews_interval_hours IS DISTINCT FROM CASE rvs.velocity_tier
            WHEN 'high' THEN 4
            WHEN 'medium' THEN 12
            WHEN 'low' THEN 24
            ELSE 72
        END
      );

    GET DIAGNOSTICS v_from_deltas = ROW_COUNT;

    UPDATE sync_status s
    SET
        velocity_7d = COALESCE(at.review_velocity_7d, 0),
        review_velocity_tier = CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 'high'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 'medium'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 'low'
            ELSE 'dormant'
        END,
        reviews_interval_hours = CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 4
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 12
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 24
            ELSE 72
        END,
        velocity_calculated_at = NOW()
    FROM app_trends at
    WHERE s.appid = at.appid
      AND s.last_reviews_sync IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM review_velocity_stats rvs
          WHERE rvs.appid = s.appid
      )
      AND (
        s.velocity_7d IS DISTINCT FROM COALESCE(at.review_velocity_7d, 0)
        OR s.review_velocity_tier IS DISTINCT FROM CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 'high'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 'medium'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 'low'
            ELSE 'dormant'
        END
        OR s.reviews_interval_hours IS DISTINCT FROM CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 4
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 12
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 24
            ELSE 72
        END
      );

    GET DIAGNOSTICS v_from_trends = ROW_COUNT;

    UPDATE sync_status s
    SET
        velocity_7d = 0,
        review_velocity_tier = 'dormant',
        reviews_interval_hours = 72,
        velocity_calculated_at = NOW()
    WHERE s.last_reviews_sync IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM review_velocity_stats rvs
          WHERE rvs.appid = s.appid
      )
      AND NOT EXISTS (
          SELECT 1
          FROM app_trends at
          WHERE at.appid = s.appid
      )
      AND (
        s.velocity_7d IS DISTINCT FROM 0
        OR s.review_velocity_tier IS DISTINCT FROM 'dormant'
        OR s.reviews_interval_hours IS DISTINCT FROM 72
      );

    GET DIAGNOSTICS v_from_no_signal = ROW_COUNT;

    RETURN QUERY SELECT v_from_deltas + v_from_trends + v_from_no_signal;
END;
$$;

COMMENT ON FUNCTION update_review_velocity_tiers IS
    'Sync review velocity tiers to sync_status, using review_velocity_stats first and app_trends/dormant fallbacks for previously-synced apps without review_deltas.';

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
    WITH launch_candidates AS (
        SELECT
            s.appid,
            'launch_critical'::TEXT AS lane,
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
          AND (
              (
                  s.reviews_priority_override_until IS NOT NULL
                  AND s.reviews_priority_override_until > v_now
                  AND s.reviews_priority_override_bucket = 'launch_critical'
              )
              OR (
                  (
                      s.reviews_priority_override_until IS NULL
                      OR s.reviews_priority_override_until <= v_now
                      OR s.reviews_priority_override_bucket IS NULL
                  )
                  AND COALESCE(a.is_released, FALSE) = TRUE
                  AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
              )
          )
        ORDER BY
            COALESCE(s.reviews_priority_override_score, 0) DESC,
            CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END ASC,
            COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) DESC,
            s.appid ASC
        FOR UPDATE OF s SKIP LOCKED
        LIMIT v_requested_limit
    ),
    change_candidates AS (
        SELECT
            s.appid,
            'change_critical'::TEXT AS lane,
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
          AND (
              s.reviews_priority_override_until IS NOT NULL
              AND s.reviews_priority_override_until > v_now
              AND s.reviews_priority_override_bucket = 'change_critical'
          )
        ORDER BY
            COALESCE(s.reviews_priority_override_score, 0) DESC,
            CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END ASC,
            COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) DESC,
            s.appid ASC
        FOR UPDATE OF s SKIP LOCKED
        LIMIT v_requested_limit
    ),
    active_candidates AS (
        SELECT
            s.appid,
            'active_reviews'::TEXT AS lane,
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
          AND (
              (
                  s.reviews_priority_override_until IS NOT NULL
                  AND s.reviews_priority_override_until > v_now
                  AND s.reviews_priority_override_bucket = 'active_reviews'
              )
              OR (
                  (
                      s.reviews_priority_override_until IS NULL
                      OR s.reviews_priority_override_until <= v_now
                      OR s.reviews_priority_override_bucket IS NULL
                  )
                  AND NOT (
                      COALESCE(a.is_released, FALSE) = TRUE
                      AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
                  )
                  AND (
                      COALESCE(s.review_velocity_tier, 'unknown') IN ('high', 'medium')
                      OR COALESCE(at.review_velocity_7d, s.velocity_7d, 0) >= 1
                  )
              )
          )
        ORDER BY
            COALESCE(s.reviews_priority_override_score, 0) DESC,
            CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END ASC,
            COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) DESC,
            s.appid ASC
        FOR UPDATE OF s SKIP LOCKED
        LIMIT v_requested_limit
    ),
    backfill_candidates AS (
        SELECT
            s.appid,
            'important_backfill'::TEXT AS lane,
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
          AND (
              (
                  s.reviews_priority_override_until IS NOT NULL
                  AND s.reviews_priority_override_until > v_now
                  AND s.reviews_priority_override_bucket = 'important_backfill'
              )
              OR (
                  (
                      s.reviews_priority_override_until IS NULL
                      OR s.reviews_priority_override_until <= v_now
                      OR s.reviews_priority_override_bucket IS NULL
                  )
                  AND NOT (
                      COALESCE(a.is_released, FALSE) = TRUE
                      AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
                  )
                  AND NOT (
                      COALESCE(s.review_velocity_tier, 'unknown') IN ('high', 'medium')
                      OR COALESCE(at.review_velocity_7d, s.velocity_7d, 0) >= 1
                  )
                  AND (
                      COALESCE(s.priority_score, 0) >= 50
                      OR COALESCE(ct.ccu_tier, 99) IN (1, 2)
                      OR COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) >= 1000
                  )
              )
          )
        ORDER BY
            COALESCE(s.reviews_priority_override_score, 0) DESC,
            CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END ASC,
            COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) DESC,
            s.appid ASC
        FOR UPDATE OF s SKIP LOCKED
        LIMIT v_requested_limit
    ),
    unknown_candidates AS (
        SELECT
            s.appid,
            'unknown_sweep'::TEXT AS lane,
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
          AND (
              (
                  s.reviews_priority_override_until IS NOT NULL
                  AND s.reviews_priority_override_until > v_now
                  AND s.reviews_priority_override_bucket = 'unknown_sweep'
              )
              OR (
                  (
                      s.reviews_priority_override_until IS NULL
                      OR s.reviews_priority_override_until <= v_now
                      OR s.reviews_priority_override_bucket IS NULL
                  )
                  AND NOT (
                      COALESCE(a.is_released, FALSE) = TRUE
                      AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
                  )
                  AND NOT (
                      COALESCE(s.review_velocity_tier, 'unknown') IN ('high', 'medium')
                      OR COALESCE(at.review_velocity_7d, s.velocity_7d, 0) >= 1
                  )
                  AND NOT (
                      COALESCE(s.priority_score, 0) >= 50
                      OR COALESCE(ct.ccu_tier, 99) IN (1, 2)
                      OR COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) >= 1000
                  )
              )
          )
        ORDER BY
            COALESCE(s.reviews_priority_override_score, 0) DESC,
            CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END ASC,
            COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) DESC,
            s.appid ASC
        FOR UPDATE OF s SKIP LOCKED
        LIMIT v_requested_limit
    ),
    all_candidates AS (
        SELECT * FROM launch_candidates
        UNION ALL
        SELECT * FROM change_candidates
        UNION ALL
        SELECT * FROM active_candidates
        UNION ALL
        SELECT * FROM backfill_candidates
        UNION ALL
        SELECT * FROM unknown_candidates
    ),
    ranked AS (
        SELECT
            ac.*,
            ROW_NUMBER() OVER (
                PARTITION BY ac.lane
                ORDER BY
                    ac.sort_override_score DESC,
                    ac.sort_never_synced ASC,
                    ac.sort_due_at ASC NULLS FIRST,
                    ac.priority_score DESC,
                    ac.sort_total_reviews DESC,
                    ac.appid ASC
            ) AS lane_rank
        FROM all_candidates ac
    ),
    primary_claims AS (
        SELECT *
        FROM ranked
        WHERE (lane = 'launch_critical' AND lane_rank <= v_launch_quota)
           OR (lane = 'change_critical' AND lane_rank <= v_change_quota)
           OR (lane = 'active_reviews' AND lane_rank <= v_active_quota)
           OR (lane = 'important_backfill' AND lane_rank <= v_backfill_quota)
           OR (lane = 'unknown_sweep' AND lane_rank <= v_unknown_quota)
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
    'Claim due apps for reviews sync with lease semantics, fixed lane quotas, and quota reallocation.';
