-- Migration: Fix overflow in review velocity tier fallback updates
-- Purpose:
--   Clamp fallback app_trends.review_velocity_7d values to the precision of
--   sync_status.velocity_7d (numeric(8,4)) so update_review_velocity_tiers()
--   does not fail on extreme trend values.

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
        velocity_7d = LEAST(GREATEST(COALESCE(at.review_velocity_7d, 0), 0), 9999.9999),
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
        s.velocity_7d IS DISTINCT FROM LEAST(GREATEST(COALESCE(at.review_velocity_7d, 0), 0), 9999.9999)
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
    'Sync review velocity tiers to sync_status, clamping fallback app_trends velocities to fit numeric(8,4).';
