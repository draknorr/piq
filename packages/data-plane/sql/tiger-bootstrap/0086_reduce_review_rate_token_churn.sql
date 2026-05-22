-- Reduce compute and WAL churn from the shared Steam API token bucket.
--
-- This patch is intentionally not applied automatically. Apply during an
-- approved Tiger maintenance window after reviewing current pg_stat_statements
-- for acquire_api_rate_token.

SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION ops.acquire_api_rate_token(
    p_source text,
    p_worker_id text DEFAULT NULL
)
RETURNS TABLE (granted boolean, wait_ms integer)
LANGUAGE plpgsql
SET search_path = ops, public
AS $$
DECLARE
    v_now timestamp with time zone := clock_timestamp();
    v_available_tokens numeric;
    v_max_tokens numeric;
    v_refill_rate numeric;
    v_last_refill_at timestamp with time zone;
    v_elapsed_seconds numeric;
    v_refilled_tokens numeric;
    v_wait_ms integer;
BEGIN
    INSERT INTO api_rate_limit_state (
      source, available_tokens, max_tokens, refill_rate_per_second,
      last_refill_at, updated_at, last_worker_id
    )
    VALUES (p_source, 1, 1, 1, v_now, v_now, p_worker_id)
    ON CONFLICT (source) DO NOTHING;

    SELECT available_tokens, max_tokens, refill_rate_per_second, last_refill_at
    INTO v_available_tokens, v_max_tokens, v_refill_rate, v_last_refill_at
    FROM api_rate_limit_state
    WHERE source = p_source
    FOR UPDATE;

    v_max_tokens := GREATEST(COALESCE(v_max_tokens, 1), 1);
    v_refill_rate := GREATEST(COALESCE(v_refill_rate, 1), 0.0001);
    v_available_tokens := COALESCE(v_available_tokens, v_max_tokens);
    v_last_refill_at := COALESCE(v_last_refill_at, v_now);
    v_elapsed_seconds := GREATEST(EXTRACT(EPOCH FROM (v_now - v_last_refill_at)), 0);
    v_refilled_tokens := LEAST(v_max_tokens, v_available_tokens + (v_elapsed_seconds * v_refill_rate));

    IF v_refilled_tokens >= 1 THEN
      UPDATE api_rate_limit_state
      SET available_tokens = v_refilled_tokens - 1,
          max_tokens = v_max_tokens,
          refill_rate_per_second = v_refill_rate,
          last_refill_at = v_now,
          updated_at = v_now,
          last_worker_id = p_worker_id
      WHERE source = p_source;

      RETURN QUERY SELECT true, 0;
      RETURN;
    END IF;

    v_wait_ms := CEIL(((1 - v_refilled_tokens) / v_refill_rate) * 1000)::integer;

    -- Denied checks are read-only apart from the row lock above. Updating the
    -- bucket on every denied poll created millions of one-row updates and WAL.
    RETURN QUERY SELECT false, GREATEST(v_wait_ms, 250);
END;
$$;

COMMENT ON FUNCTION ops.acquire_api_rate_token(text, text) IS
  'Shared Steam API token bucket. Grants consume and update a token; denied checks return a bounded wait without rewriting the state row.';
