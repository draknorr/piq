-- Reviews queue capacity policy.
--
-- This function-only patch is intentionally not applied automatically.
-- Apply during an approved Tiger maintenance window.

CREATE OR REPLACE FUNCTION ops.promote_reviews_sync(
    p_appid integer,
    p_bucket text,
    p_score integer,
    p_reason text,
    p_until timestamp with time zone
)
RETURNS boolean
LANGUAGE sql
AS $$
  INSERT INTO ops.sync_status (
    appid,
    next_reviews_sync,
    reviews_priority_override_bucket,
    reviews_priority_override_score,
    reviews_priority_override_reason,
    reviews_priority_override_until,
    updated_at
  )
  VALUES ($1, now(), $2, $3, $4, $5, now())
  ON CONFLICT (appid)
  DO UPDATE SET
    next_reviews_sync = LEAST(
      COALESCE(ops.sync_status.next_reviews_sync, now()),
      now()
    ),
    reviews_priority_override_bucket = EXCLUDED.reviews_priority_override_bucket,
    reviews_priority_override_score = GREATEST(
      COALESCE(ops.sync_status.reviews_priority_override_score, 0),
      COALESCE(EXCLUDED.reviews_priority_override_score, 0)
    ),
    reviews_priority_override_reason = EXCLUDED.reviews_priority_override_reason,
    reviews_priority_override_until = GREATEST(
      COALESCE(ops.sync_status.reviews_priority_override_until, '-infinity'::timestamptz),
      COALESCE(EXCLUDED.reviews_priority_override_until, '-infinity'::timestamptz)
    ),
    updated_at = now();
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION ops.update_review_velocity_tiers_batch(
    p_limit integer DEFAULT 1000
)
RETURNS TABLE(updated_count integer)
LANGUAGE plpgsql
SET search_path = ops, metrics, legacy, public
AS $$
DECLARE
    v_apply_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 1000), 5000));
    v_candidate_limit integer := LEAST(v_apply_limit * 5, 25000);
BEGIN
    RETURN QUERY
    WITH source_values AS (
      SELECT
        s.appid,
        s.velocity_7d AS current_velocity_7d,
        s.review_velocity_tier AS current_review_velocity_tier,
        s.reviews_interval_hours AS current_reviews_interval_hours,
        CASE
          WHEN rvs.appid IS NOT NULL THEN rvs.velocity_7d
          WHEN at.appid IS NOT NULL
            THEN LEAST(GREATEST(COALESCE(at.review_velocity_7d, 0), 0), 9999.9999)
          ELSE 0
        END::numeric(8,4) AS desired_velocity_7d,
        CASE
          WHEN rvs.appid IS NOT NULL THEN rvs.velocity_tier
          WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 'high'
          WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 'medium'
          WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 'low'
          ELSE 'dormant'
        END::text AS desired_review_velocity_tier,
        COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0)::integer
          AS current_total_reviews,
        COALESCE(s.priority_score, 0)::integer AS current_priority_score,
        s.last_activity_at,
        (
          s.reviews_priority_override_until IS NOT NULL
          AND s.reviews_priority_override_until > now()
          AND s.reviews_priority_override_bucket IN (
            'launch_critical',
            'change_critical',
            'active_reviews'
          )
        ) AS has_active_review_promotion,
        (
          COALESCE(a.is_released, false) = true
          AND (
            a.release_date IS NULL
            OR a.release_date >= CURRENT_DATE - INTERVAL '7 days'
          )
        ) AS is_current_launch_window,
        EXISTS (
          SELECT 1
          FROM legacy.user_pins pin
          WHERE pin.entity_type = 'game'
            AND pin.entity_id = s.appid
        ) AS is_pinned_game
      FROM ops.sync_status s
      LEFT JOIN metrics.review_velocity_stats rvs ON rvs.appid = s.appid
      LEFT JOIN metrics.app_trends at ON at.appid = s.appid
      LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = s.appid
      LEFT JOIN legacy.apps a ON a.appid = s.appid
      WHERE s.last_reviews_sync IS NOT NULL
    ),
    desired_values AS (
      SELECT
        source.appid,
        source.current_velocity_7d,
        source.current_review_velocity_tier,
        source.current_reviews_interval_hours,
        source.desired_velocity_7d,
        source.desired_review_velocity_tier,
        CASE
          WHEN source.desired_review_velocity_tier = 'high' THEN 4
          WHEN source.desired_review_velocity_tier = 'medium' THEN 12
          WHEN source.desired_review_velocity_tier = 'low' THEN 24
          WHEN source.has_active_review_promotion
            OR source.is_current_launch_window
          THEN 24
          WHEN source.is_pinned_game
            OR source.current_priority_score >= 50
          THEN 168
          WHEN source.current_total_reviews = 0
            AND source.last_activity_at >= now() - INTERVAL '90 days'
          THEN 168
          WHEN source.current_total_reviews > 0 THEN 720
          ELSE 2160
        END::integer AS desired_reviews_interval_hours
      FROM source_values source
    ),
    diff_candidates AS (
      SELECT
        desired.appid,
        desired.desired_velocity_7d,
        desired.desired_review_velocity_tier,
        desired.desired_reviews_interval_hours
      FROM desired_values desired
      WHERE desired.current_velocity_7d
              IS DISTINCT FROM desired.desired_velocity_7d
         OR desired.current_review_velocity_tier
              IS DISTINCT FROM desired.desired_review_velocity_tier
         OR desired.current_reviews_interval_hours
              IS DISTINCT FROM desired.desired_reviews_interval_hours
      ORDER BY desired.appid ASC
      LIMIT v_candidate_limit
    ),
    locked_candidates AS (
      SELECT status.appid
      FROM ops.sync_status status
      JOIN diff_candidates candidate ON candidate.appid = status.appid
      ORDER BY status.appid ASC
      LIMIT v_apply_limit
      FOR UPDATE OF status SKIP LOCKED
    ),
    updated AS (
      UPDATE ops.sync_status status
      SET velocity_7d = candidate.desired_velocity_7d,
          review_velocity_tier = candidate.desired_review_velocity_tier,
          reviews_interval_hours = candidate.desired_reviews_interval_hours,
          velocity_calculated_at = now(),
          updated_at = now()
      FROM diff_candidates candidate
      JOIN locked_candidates locked ON locked.appid = candidate.appid
      WHERE status.appid = candidate.appid
      RETURNING status.appid
    )
    SELECT count(*)::integer AS updated_count
    FROM updated;
END;
$$;
