-- Tiger primary writer surfaces for application/control-plane cutover.
-- This file defines data tables and helper RPCs needed before workers and
-- server-side app routes can stop writing Supabase. It is intentionally not
-- applied automatically by scheduled sync workflows.

CREATE TABLE IF NOT EXISTS ops.sync_status (
    appid integer PRIMARY KEY,
    last_steamspy_sync timestamp with time zone,
    last_storefront_sync timestamp with time zone,
    last_reviews_sync timestamp with time zone,
    last_histogram_sync timestamp with time zone,
    priority_score integer DEFAULT 0,
    priority_calculated_at timestamp with time zone,
    next_sync_after timestamp with time zone DEFAULT now(),
    sync_interval_hours integer DEFAULT 24,
    consecutive_errors integer DEFAULT 0,
    last_error_source text,
    last_error_message text,
    last_error_at timestamp with time zone,
    is_syncable boolean DEFAULT true,
    refresh_tier text,
    last_activity_at timestamp with time zone,
    last_pics_sync timestamp with time zone,
    pics_change_number bigint,
    storefront_accessible boolean,
    steamspy_available boolean,
    last_embedding_sync timestamp with time zone,
    embedding_hash text,
    last_price_sync timestamp with time zone,
    next_reviews_sync timestamp with time zone,
    reviews_interval_hours integer,
    review_velocity_tier text,
    last_known_total_reviews integer,
    velocity_7d numeric,
    velocity_calculated_at timestamp with time zone,
    last_steamspy_individual_fetch timestamp with time zone,
    steam_last_modified bigint,
    steam_price_change_number bigint,
    last_news_sync timestamp with time zone,
    last_media_sync timestamp with time zone,
    reviews_claimed_by text,
    reviews_claimed_at timestamp with time zone,
    reviews_claim_expires_at timestamp with time zone,
    reviews_priority_override_bucket text,
    reviews_priority_override_score integer,
    reviews_priority_override_reason text,
    reviews_priority_override_until timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_sync_status_storefront_due
  ON ops.sync_status (next_sync_after ASC, priority_score DESC, appid ASC)
  WHERE is_syncable = true;
CREATE INDEX IF NOT EXISTS idx_ops_sync_status_reviews_due
  ON ops.sync_status (next_reviews_sync ASC, priority_score DESC, appid ASC)
  WHERE is_syncable = true;
CREATE INDEX IF NOT EXISTS idx_ops_sync_status_embedding_needed
  ON ops.sync_status (last_embedding_sync NULLS FIRST, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_ops_sync_status_last_pics_sync
  ON ops.sync_status (last_pics_sync NULLS FIRST);

CREATE TABLE IF NOT EXISTS ops.sync_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    status text DEFAULT 'running',
    items_processed integer DEFAULT 0,
    items_succeeded integer DEFAULT 0,
    items_failed integer DEFAULT 0,
    items_created integer DEFAULT 0,
    items_updated integer DEFAULT 0,
    items_skipped integer DEFAULT 0,
    batch_size integer,
    error_message text,
    github_run_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ops_sync_jobs_status_check CHECK (
      status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_sync_jobs_type_started
  ON ops.sync_jobs (job_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_sync_jobs_running
  ON ops.sync_jobs (started_at ASC)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS metrics.review_histogram (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    month_start date NOT NULL,
    recommendations_up integer NOT NULL,
    recommendations_down integer NOT NULL,
    fetched_at timestamp with time zone DEFAULT now(),
    CONSTRAINT metrics_review_histogram_app_month_key UNIQUE (appid, month_start)
);

CREATE INDEX IF NOT EXISTS idx_metrics_review_histogram_app_month
  ON metrics.review_histogram (appid, month_start DESC);

CREATE TABLE IF NOT EXISTS metrics.app_trends (
    appid integer PRIMARY KEY,
    trend_30d_direction text,
    trend_30d_change_pct numeric(6,2),
    trend_90d_direction text,
    trend_90d_change_pct numeric(6,2),
    current_positive_ratio numeric(5,4),
    previous_positive_ratio numeric(5,4),
    review_velocity_7d numeric(10,2),
    review_velocity_30d numeric(10,2),
    ccu_trend_7d_pct numeric(6,2),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metrics.review_deltas (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    delta_date date NOT NULL,
    total_reviews integer NOT NULL,
    positive_reviews integer NOT NULL,
    review_score smallint,
    review_score_desc text,
    reviews_added integer NOT NULL DEFAULT 0,
    positive_added integer NOT NULL DEFAULT 0,
    negative_added integer NOT NULL DEFAULT 0,
    hours_since_last_sync numeric(6,2),
    daily_velocity numeric(12,4) GENERATED ALWAYS AS (
      CASE
        WHEN hours_since_last_sync > 0 THEN reviews_added * 24.0 / hours_since_last_sync
        ELSE 0
      END
    ) STORED,
    is_interpolated boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT metrics_review_deltas_app_day_key UNIQUE (appid, delta_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_review_deltas_app_date
  ON metrics.review_deltas (appid, delta_date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_review_deltas_velocity
  ON metrics.review_deltas (daily_velocity DESC)
  WHERE is_interpolated = false;

CREATE TABLE IF NOT EXISTS metrics.ccu_snapshots (
    id bigint GENERATED BY DEFAULT AS IDENTITY,
    appid integer NOT NULL,
    snapshot_time timestamp with time zone NOT NULL DEFAULT now(),
    player_count integer NOT NULL,
    ccu_tier smallint NOT NULL,
    CONSTRAINT metrics_ccu_snapshots_pkey PRIMARY KEY (snapshot_time, id),
    CONSTRAINT metrics_ccu_snapshots_app_time_key UNIQUE (appid, snapshot_time)
);

SELECT public.create_hypertable(
  'metrics.ccu_snapshots',
  'snapshot_time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE,
  create_default_indexes => FALSE
);

CREATE INDEX IF NOT EXISTS idx_metrics_ccu_snapshots_app_time
  ON metrics.ccu_snapshots (appid, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_ccu_snapshots_tier_time
  ON metrics.ccu_snapshots (ccu_tier, snapshot_time DESC);

CREATE TABLE IF NOT EXISTS ops.ccu_tier_assignments (
    appid integer PRIMARY KEY,
    ccu_tier smallint NOT NULL DEFAULT 3,
    tier_reason text,
    last_tier_change timestamp with time zone DEFAULT now(),
    recent_peak_ccu integer,
    release_rank integer,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_ccu_tier_assignments_tier
  ON ops.ccu_tier_assignments (ccu_tier);

CREATE TABLE IF NOT EXISTS ops.alert_detection_state (
    user_id uuid NOT NULL,
    pin_id uuid NOT NULL,
    alert_type text NOT NULL,
    state_key text NOT NULL,
    last_seen_value numeric,
    last_alerted_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, pin_id, alert_type, state_key)
);

CREATE TABLE IF NOT EXISTS legacy.steam_categories (
    category_id integer PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy.app_categories (
    appid integer NOT NULL,
    category_id integer NOT NULL,
    PRIMARY KEY (appid, category_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_app_categories_category_id
  ON legacy.app_categories (category_id);

CREATE TABLE IF NOT EXISTS legacy.franchises (
    id bigserial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    normalized_name text NOT NULL UNIQUE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legacy.app_franchises (
    appid integer NOT NULL,
    franchise_id bigint NOT NULL,
    PRIMARY KEY (appid, franchise_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_app_franchises_franchise_id
  ON legacy.app_franchises (franchise_id);

CREATE TABLE IF NOT EXISTS ops.pics_sync_state (
    id integer PRIMARY KEY,
    last_change_number bigint NOT NULL DEFAULT 0,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat.user_profiles (
    id uuid PRIMARY KEY,
    email text NOT NULL,
    full_name text,
    organization text,
    role text NOT NULL DEFAULT 'user',
    credit_balance integer NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
    total_credits_used integer NOT NULL DEFAULT 0,
    total_messages_sent integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_user_profiles_email
  ON chat.user_profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_chat_user_profiles_role
  ON chat.user_profiles (role);

CREATE TABLE IF NOT EXISTS chat.waitlist (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    full_name text NOT NULL,
    organization text,
    how_i_plan_to_use text,
    status text NOT NULL DEFAULT 'pending',
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    invite_sent_at timestamp with time zone,
    initial_credits integer,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT chat_waitlist_email_key UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_chat_waitlist_status
  ON chat.waitlist (status);
CREATE INDEX IF NOT EXISTS idx_chat_waitlist_created_at
  ON chat.waitlist (created_at DESC);

CREATE TABLE IF NOT EXISTS chat.credit_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    reserved_amount integer NOT NULL,
    actual_amount integer,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    finalized_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_chat_credit_reservations_user_pending
  ON chat.credit_reservations (user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS chat.credit_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    balance_after integer NOT NULL,
    transaction_type text NOT NULL,
    description text,
    input_tokens integer,
    output_tokens integer,
    tool_credits integer,
    admin_user_id uuid,
    reservation_id uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_credit_transactions_user_date
  ON chat.credit_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat.rate_limit_state (
    user_id uuid PRIMARY KEY,
    requests_this_minute integer NOT NULL DEFAULT 0,
    requests_this_hour integer NOT NULL DEFAULT 0,
    minute_window_start timestamp with time zone NOT NULL DEFAULT now(),
    hour_window_start timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat.chat_query_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    query_text text NOT NULL,
    tool_names text[] DEFAULT '{}',
    tool_count integer DEFAULT 0,
    iteration_count integer DEFAULT 1,
    response_length integer DEFAULT 0,
    timing_llm_ms integer,
    timing_tools_ms integer,
    timing_total_ms integer,
    user_id uuid,
    input_tokens integer,
    output_tokens integer,
    tool_credits_used integer,
    total_credits_charged integer,
    reservation_id uuid,
    query_type text,
    success boolean,
    error_message text,
    chat_family text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_query_logs_created_at
  ON chat.chat_query_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_query_logs_user_id
  ON chat.chat_query_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_query_logs_tool_names
  ON chat.chat_query_logs USING gin (tool_names);

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
    reviews_priority_override_bucket,
    reviews_priority_override_score,
    reviews_priority_override_reason,
    reviews_priority_override_until,
    updated_at
  )
  VALUES ($1, $2, $3, $4, $5, now())
  ON CONFLICT (appid)
  DO UPDATE SET
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

CREATE OR REPLACE FUNCTION chat.reserve_credits(p_user_id uuid, p_amount integer)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_balance integer;
    v_reservation_id uuid;
BEGIN
    SELECT credit_balance INTO v_current_balance
    FROM chat.user_profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL OR v_current_balance < p_amount THEN
        RETURN NULL;
    END IF;

    UPDATE chat.user_profiles
    SET credit_balance = credit_balance - p_amount,
        updated_at = now()
    WHERE id = p_user_id;

    INSERT INTO chat.credit_reservations (user_id, reserved_amount, status)
    VALUES (p_user_id, p_amount, 'pending')
    RETURNING id INTO v_reservation_id;

    RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION chat.finalize_credits(
    p_reservation_id uuid,
    p_actual_amount integer,
    p_description text DEFAULT NULL,
    p_input_tokens integer DEFAULT NULL,
    p_output_tokens integer DEFAULT NULL,
    p_tool_credits integer DEFAULT NULL
)
RETURNS TABLE (success boolean, refunded integer, new_balance integer)
LANGUAGE plpgsql
AS $$
DECLARE
    v_reservation record;
    v_refund_amount integer;
    v_new_balance integer;
BEGIN
    SELECT r.*, u.credit_balance
    INTO v_reservation
    FROM chat.credit_reservations r
    JOIN chat.user_profiles u ON u.id = r.user_id
    WHERE r.id = p_reservation_id AND r.status = 'pending'
    FOR UPDATE OF r, u;

    IF v_reservation IS NULL THEN
        RETURN QUERY SELECT false, 0::integer, 0::integer;
        RETURN;
    END IF;

    v_refund_amount := GREATEST(0, v_reservation.reserved_amount - p_actual_amount);

    UPDATE chat.user_profiles
    SET credit_balance = credit_balance + v_refund_amount,
        total_credits_used = total_credits_used + p_actual_amount,
        total_messages_sent = total_messages_sent + 1,
        updated_at = now()
    WHERE id = v_reservation.user_id
    RETURNING credit_balance INTO v_new_balance;

    UPDATE chat.credit_reservations
    SET status = 'finalized',
        actual_amount = p_actual_amount,
        finalized_at = now()
    WHERE id = p_reservation_id;

    INSERT INTO chat.credit_transactions (
      user_id, amount, balance_after, transaction_type, description,
      input_tokens, output_tokens, tool_credits, reservation_id
    )
    VALUES (
      v_reservation.user_id, -p_actual_amount, v_new_balance, 'chat_usage',
      COALESCE(p_description, 'Chat usage'), p_input_tokens, p_output_tokens,
      p_tool_credits, p_reservation_id
    );

    RETURN QUERY SELECT true, v_refund_amount, v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION chat.refund_reservation(p_reservation_id uuid)
RETURNS TABLE (success boolean, refunded integer, new_balance integer)
LANGUAGE plpgsql
AS $$
DECLARE
    v_reservation record;
    v_new_balance integer;
BEGIN
    SELECT r.*, u.credit_balance
    INTO v_reservation
    FROM chat.credit_reservations r
    JOIN chat.user_profiles u ON u.id = r.user_id
    WHERE r.id = p_reservation_id AND r.status = 'pending'
    FOR UPDATE OF r, u;

    IF v_reservation IS NULL THEN
        RETURN QUERY SELECT false, 0::integer, 0::integer;
        RETURN;
    END IF;

    UPDATE chat.user_profiles
    SET credit_balance = credit_balance + v_reservation.reserved_amount,
        updated_at = now()
    WHERE id = v_reservation.user_id
    RETURNING credit_balance INTO v_new_balance;

    UPDATE chat.credit_reservations
    SET status = 'refunded',
        actual_amount = 0,
        finalized_at = now()
    WHERE id = p_reservation_id;

    INSERT INTO chat.credit_transactions (
      user_id, amount, balance_after, transaction_type, description, reservation_id
    )
    VALUES (
      v_reservation.user_id, v_reservation.reserved_amount, v_new_balance,
      'refund', 'Server error refund', p_reservation_id
    );

    RETURN QUERY SELECT true, v_reservation.reserved_amount, v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION chat.check_and_increment_rate_limit(p_user_id uuid)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
AS $$
DECLARE
    v_now timestamp with time zone := now();
    v_minute_limit integer := 20;
    v_hour_limit integer := 200;
    v_state chat.rate_limit_state%ROWTYPE;
    v_requests_minute integer;
    v_requests_hour integer;
    v_minute_start timestamp with time zone;
    v_hour_start timestamp with time zone;
BEGIN
    SELECT * INTO v_state
    FROM chat.rate_limit_state
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO chat.rate_limit_state (user_id)
        VALUES (p_user_id)
        RETURNING * INTO v_state;
    END IF;

    v_minute_start := v_state.minute_window_start;
    v_hour_start := v_state.hour_window_start;
    v_requests_minute := v_state.requests_this_minute;
    v_requests_hour := v_state.requests_this_hour;

    IF v_minute_start < v_now - INTERVAL '1 minute' THEN
        v_requests_minute := 0;
        v_minute_start := v_now;
    END IF;

    IF v_hour_start < v_now - INTERVAL '1 hour' THEN
        v_requests_hour := 0;
        v_hour_start := v_now;
    END IF;

    IF v_requests_minute >= v_minute_limit THEN
        RETURN QUERY SELECT false,
          EXTRACT(EPOCH FROM (v_minute_start + INTERVAL '1 minute' - v_now))::integer;
        RETURN;
    END IF;

    IF v_requests_hour >= v_hour_limit THEN
        RETURN QUERY SELECT false,
          EXTRACT(EPOCH FROM (v_hour_start + INTERVAL '1 hour' - v_now))::integer;
        RETURN;
    END IF;

    UPDATE chat.rate_limit_state
    SET requests_this_minute = v_requests_minute + 1,
        requests_this_hour = v_requests_hour + 1,
        minute_window_start = v_minute_start,
        hour_window_start = v_hour_start,
        updated_at = v_now
    WHERE user_id = p_user_id;

    RETURN QUERY SELECT true, 0::integer;
END;
$$;

CREATE OR REPLACE FUNCTION chat.cleanup_old_chat_logs()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM chat.chat_query_logs
    WHERE created_at < now() - INTERVAL '7 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION chat.cleanup_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer := 0;
    v_reservation record;
BEGIN
    FOR v_reservation IN
        SELECT id
        FROM chat.credit_reservations
        WHERE status = 'pending'
          AND created_at < now() - INTERVAL '1 hour'
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM *
        FROM chat.refund_reservation(v_reservation.id);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION chat.admin_adjust_credits(
    p_admin_id uuid,
    p_user_id uuid,
    p_amount integer,
    p_description text
)
RETURNS TABLE (success boolean, new_balance integer)
LANGUAGE plpgsql
AS $$
DECLARE
    v_admin_role text;
    v_current_balance integer;
    v_new_balance integer;
    v_type text;
BEGIN
    SELECT role INTO v_admin_role
    FROM chat.user_profiles
    WHERE id = p_admin_id;

    IF v_admin_role IS NULL OR v_admin_role != 'admin' THEN
        RETURN QUERY SELECT false, 0::integer;
        RETURN;
    END IF;

    SELECT credit_balance INTO v_current_balance
    FROM chat.user_profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RETURN QUERY SELECT false, 0::integer;
        RETURN;
    END IF;

    v_new_balance := GREATEST(0, v_current_balance + p_amount);
    v_type := CASE WHEN p_amount >= 0 THEN 'admin_grant' ELSE 'admin_deduct' END;

    UPDATE chat.user_profiles
    SET credit_balance = v_new_balance,
        updated_at = now()
    WHERE id = p_user_id;

    INSERT INTO chat.credit_transactions (
      user_id, amount, balance_after, transaction_type, description, admin_user_id
    )
    VALUES (p_user_id, p_amount, v_new_balance, v_type, p_description, p_admin_id);

    RETURN QUERY SELECT true, v_new_balance;
END;
$$;
