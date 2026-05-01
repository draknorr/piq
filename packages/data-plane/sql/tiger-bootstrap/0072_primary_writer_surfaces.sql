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

ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_steamspy_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_storefront_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_reviews_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_histogram_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS priority_score integer DEFAULT 0;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS next_sync_after timestamp with time zone DEFAULT now();
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS consecutive_errors integer DEFAULT 0;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_error_source text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_error_message text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_error_at timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS is_syncable boolean DEFAULT true;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS refresh_tier text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_activity_at timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_pics_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS pics_change_number bigint;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS storefront_accessible boolean;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS steamspy_available boolean;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_embedding_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS embedding_hash text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_price_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS next_reviews_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_interval_hours integer;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS review_velocity_tier text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_known_total_reviews integer;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS velocity_7d numeric;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_steamspy_individual_fetch timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS steam_last_modified bigint;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS steam_price_change_number bigint;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_news_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS last_media_sync timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_claimed_by text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_claimed_at timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_claim_expires_at timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_priority_override_bucket text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_priority_override_score integer;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_priority_override_reason text;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS reviews_priority_override_until timestamp with time zone;
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE ops.sync_status ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

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
    metadata jsonb,
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

ALTER TABLE ops.sync_jobs ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE TABLE IF NOT EXISTS ops.api_rate_limit_state (
    source text PRIMARY KEY,
    available_tokens numeric NOT NULL,
    max_tokens numeric NOT NULL,
    refill_rate_per_second numeric NOT NULL,
    last_refill_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    last_worker_id text
);

INSERT INTO ops.api_rate_limit_state (
    source,
    available_tokens,
    max_tokens,
    refill_rate_per_second,
    last_refill_at,
    updated_at
)
VALUES ('reviews', 1, 1, 1, now(), now())
ON CONFLICT (source) DO NOTHING;

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

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics.review_velocity_stats AS
WITH recent_deltas AS (
    SELECT
      appid,
      delta_date,
      reviews_added,
      daily_velocity,
      is_interpolated,
      row_number() OVER (PARTITION BY appid ORDER BY delta_date DESC) AS rn
    FROM metrics.review_deltas
    WHERE delta_date >= CURRENT_DATE - INTERVAL '30 days'
),
velocity_calcs AS (
    SELECT
      appid,
      avg(daily_velocity) FILTER (WHERE rn <= 7 AND NOT is_interpolated) AS velocity_7d,
      avg(daily_velocity) FILTER (WHERE NOT is_interpolated) AS velocity_30d,
      sum(reviews_added) FILTER (WHERE rn <= 7) AS reviews_added_7d,
      sum(reviews_added) AS reviews_added_30d,
      max(delta_date) AS last_delta_date,
      count(*) FILTER (WHERE NOT is_interpolated) AS actual_sync_count
    FROM recent_deltas
    GROUP BY appid
)
SELECT
  appid,
  COALESCE(velocity_7d, 0)::numeric(8,4) AS velocity_7d,
  COALESCE(velocity_30d, 0)::numeric(8,4) AS velocity_30d,
  COALESCE(reviews_added_7d, 0)::integer AS reviews_added_7d,
  COALESCE(reviews_added_30d, 0)::integer AS reviews_added_30d,
  last_delta_date,
  actual_sync_count,
  CASE
    WHEN velocity_7d >= 5 THEN 'high'
    WHEN velocity_7d >= 1 THEN 'medium'
    WHEN velocity_7d >= 0.1 THEN 'low'
    ELSE 'dormant'
  END AS velocity_tier
FROM velocity_calcs;

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_review_velocity_stats_appid
  ON metrics.review_velocity_stats (appid);
CREATE INDEX IF NOT EXISTS idx_metrics_review_velocity_stats_tier
  ON metrics.review_velocity_stats (velocity_tier, velocity_7d DESC);

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

ALTER TABLE ops.ccu_tier_assignments ADD COLUMN IF NOT EXISTS ccu_fetch_status text;
ALTER TABLE ops.ccu_tier_assignments ADD COLUMN IF NOT EXISTS ccu_skip_until timestamp with time zone;
ALTER TABLE ops.ccu_tier_assignments ADD COLUMN IF NOT EXISTS last_ccu_synced timestamp with time zone;
ALTER TABLE ops.ccu_tier_assignments ADD COLUMN IF NOT EXISTS last_ccu_validation_state text;
ALTER TABLE ops.ccu_tier_assignments ADD COLUMN IF NOT EXISTS last_ccu_validation_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS ops.alert_detection_state (
    user_id uuid,
    pin_id uuid,
    alert_type text,
    state_key text,
    last_seen_value numeric,
    last_alerted_at timestamp with time zone,
    entity_type text,
    entity_id integer,
    ccu_7d_avg numeric,
    ccu_prev_value numeric,
    review_velocity_7d_avg numeric,
    positive_ratio_prev numeric,
    total_reviews_prev integer,
    trend_30d_direction_prev text,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ops_alert_detection_state_entity_type_check CHECK (
      entity_type IS NULL OR entity_type IN ('game', 'publisher', 'developer')
    )
);

DO $$
DECLARE
  v_primary_key_name text;
BEGIN
  SELECT conname
  INTO v_primary_key_name
  FROM pg_constraint
  WHERE conrelid = 'ops.alert_detection_state'::regclass
    AND contype = 'p';

  IF v_primary_key_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ops.alert_detection_state DROP CONSTRAINT %I', v_primary_key_name);
  END IF;
END;
$$;

ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS entity_id integer;
ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS ccu_7d_avg numeric;
ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS ccu_prev_value numeric;
ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS review_velocity_7d_avg numeric;
ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS positive_ratio_prev numeric;
ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS total_reviews_prev integer;
ALTER TABLE ops.alert_detection_state ADD COLUMN IF NOT EXISTS trend_30d_direction_prev text;
ALTER TABLE ops.alert_detection_state ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE ops.alert_detection_state ALTER COLUMN pin_id DROP NOT NULL;
ALTER TABLE ops.alert_detection_state ALTER COLUMN alert_type DROP NOT NULL;
ALTER TABLE ops.alert_detection_state ALTER COLUMN state_key DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_alert_detection_state_entity
  ON ops.alert_detection_state (entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_alert_detection_state_legacy_key
  ON ops.alert_detection_state (user_id, pin_id, alert_type, state_key)
  WHERE user_id IS NOT NULL
    AND pin_id IS NOT NULL
    AND alert_type IS NOT NULL
    AND state_key IS NOT NULL;

ALTER TABLE legacy.user_pins ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE legacy.user_alerts ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_legacy_user_pin_alert_settings_pin_id
  ON legacy.user_pin_alert_settings (pin_id);

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

ALTER TABLE legacy.apps ADD COLUMN IF NOT EXISTS catalog_seed_state text;

CREATE SEQUENCE IF NOT EXISTS legacy.developers_tiger_id_seq;
SELECT setval(
  'legacy.developers_tiger_id_seq',
  GREATEST((SELECT COALESCE(max(id), 0) + 1 FROM legacy.developers), 1),
  false
);
ALTER TABLE legacy.developers
  ALTER COLUMN id SET DEFAULT nextval('legacy.developers_tiger_id_seq');

CREATE SEQUENCE IF NOT EXISTS legacy.publishers_tiger_id_seq;
SELECT setval(
  'legacy.publishers_tiger_id_seq',
  GREATEST((SELECT COALESCE(max(id), 0) + 1 FROM legacy.publishers), 1),
  false
);
ALTER TABLE legacy.publishers
  ALTER COLUMN id SET DEFAULT nextval('legacy.publishers_tiger_id_seq');

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

    UPDATE api_rate_limit_state
    SET available_tokens = v_refilled_tokens,
        max_tokens = v_max_tokens,
        refill_rate_per_second = v_refill_rate,
        last_refill_at = v_now,
        updated_at = v_now,
        last_worker_id = p_worker_id
    WHERE source = p_source;

    RETURN QUERY SELECT false, GREATEST(v_wait_ms, 1);
END;
$$;

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

CREATE OR REPLACE FUNCTION ops.interpolate_review_deltas_batch(
    p_start_date date DEFAULT CURRENT_DATE - INTERVAL '30 days',
    p_end_date date DEFAULT CURRENT_DATE,
    p_after_appid integer DEFAULT 0,
    p_app_limit integer DEFAULT 2000
)
RETURNS TABLE (
    total_interpolated integer,
    apps_processed integer,
    last_appid integer,
    has_more boolean
)
LANGUAGE plpgsql
SET search_path = metrics, public
AS $$
DECLARE
    v_total_interpolated integer := 0;
    v_apps_processed integer := 0;
    v_last_appid integer;
    v_has_more boolean := false;
BEGIN
    WITH batch_appids AS (
      SELECT DISTINCT rd.appid
      FROM review_deltas rd
      WHERE rd.is_interpolated = false
        AND rd.delta_date BETWEEN p_start_date AND p_end_date
        AND rd.appid > COALESCE(p_after_appid, 0)
      ORDER BY rd.appid
      LIMIT GREATEST(COALESCE(p_app_limit, 2000), 1)
    ),
    actual_syncs AS (
      SELECT rd.appid, rd.delta_date, rd.total_reviews, rd.positive_reviews
      FROM review_deltas rd
      JOIN batch_appids ba ON ba.appid = rd.appid
      WHERE rd.is_interpolated = false
        AND rd.delta_date BETWEEN p_start_date AND p_end_date
    ),
    with_next AS (
      SELECT
        appid,
        delta_date AS prev_date,
        total_reviews AS prev_total,
        positive_reviews AS prev_positive,
        lead(delta_date) OVER (PARTITION BY appid ORDER BY delta_date) AS next_date,
        lead(total_reviews) OVER (PARTITION BY appid ORDER BY delta_date) AS next_total,
        lead(positive_reviews) OVER (PARTITION BY appid ORDER BY delta_date) AS next_positive
      FROM actual_syncs
    ),
    gaps AS (
      SELECT
        appid,
        prev_date,
        prev_total,
        prev_positive,
        next_date,
        next_total,
        next_positive,
        (next_date - prev_date) AS days_gap,
        (next_total - prev_total)::numeric / (next_date - prev_date) AS daily_total_change,
        (next_positive - prev_positive)::numeric / (next_date - prev_date) AS daily_positive_change
      FROM with_next
      WHERE next_date IS NOT NULL
        AND (next_date - prev_date) > 1
    ),
    interpolated_rows AS (
      SELECT
        g.appid,
        gap_date::date AS delta_date,
        LEAST(2147483647, GREATEST(0, g.prev_total + round(g.daily_total_change * (gap_date::date - g.prev_date))))::integer AS total_reviews,
        LEAST(2147483647, GREATEST(0, g.prev_positive + round(g.daily_positive_change * (gap_date::date - g.prev_date))))::integer AS positive_reviews,
        LEAST(9999, GREATEST(0, round(g.daily_total_change)))::integer AS reviews_added,
        CASE WHEN g.daily_total_change > 0 THEN LEAST(9999, GREATEST(0, round(g.daily_positive_change)))::integer ELSE 0 END AS positive_added,
        CASE WHEN g.daily_total_change > 0 THEN LEAST(9999, GREATEST(0, round(g.daily_total_change - g.daily_positive_change)))::integer ELSE 0 END AS negative_added
      FROM gaps g
      CROSS JOIN LATERAL generate_series(
        g.prev_date + 1,
        g.next_date - 1,
        '1 day'::interval
      ) AS gap_date
    ),
    missing_rows AS (
      SELECT ir.*
      FROM interpolated_rows ir
      WHERE NOT EXISTS (
        SELECT 1
        FROM review_deltas existing
        WHERE existing.appid = ir.appid
          AND existing.delta_date = ir.delta_date
      )
    ),
    inserted AS (
      INSERT INTO review_deltas (
        appid, delta_date, total_reviews, positive_reviews, review_score,
        reviews_added, positive_added, negative_added, hours_since_last_sync,
        is_interpolated
      )
      SELECT
        appid,
        delta_date,
        total_reviews,
        positive_reviews,
        NULL,
        reviews_added,
        positive_added,
        negative_added,
        24.0,
        true
      FROM missing_rows
      ON CONFLICT (appid, delta_date) DO NOTHING
      RETURNING 1
    )
    SELECT
      COALESCE((SELECT count(*)::integer FROM inserted), 0),
      COALESCE((SELECT count(*)::integer FROM batch_appids), 0),
      (SELECT max(appid) FROM batch_appids)
    INTO v_total_interpolated, v_apps_processed, v_last_appid;

    IF v_last_appid IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM review_deltas rd
        WHERE rd.is_interpolated = false
          AND rd.delta_date BETWEEN p_start_date AND p_end_date
          AND rd.appid > v_last_appid
      )
      INTO v_has_more;
    END IF;

    RETURN QUERY SELECT v_total_interpolated, v_apps_processed, v_last_appid, v_has_more;
END;
$$;

CREATE OR REPLACE FUNCTION ops.update_review_velocity_tiers_batch(
    p_limit integer DEFAULT 1000
)
RETURNS TABLE(updated_count integer)
LANGUAGE plpgsql
SET search_path = ops, metrics, public
AS $$
DECLARE
    v_apply_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 1000), 5000));
    v_candidate_limit integer := LEAST(v_apply_limit * 5, 25000);
BEGIN
    RETURN QUERY
    WITH desired_values AS (
      SELECT
        s.appid,
        s.velocity_7d AS current_velocity_7d,
        s.review_velocity_tier AS current_review_velocity_tier,
        s.reviews_interval_hours AS current_reviews_interval_hours,
        CASE
          WHEN rvs.appid IS NOT NULL THEN rvs.velocity_7d
          WHEN at.appid IS NOT NULL THEN LEAST(GREATEST(COALESCE(at.review_velocity_7d, 0), 0), 9999.9999)
          ELSE 0
        END::numeric(8,4) AS desired_velocity_7d,
        CASE
          WHEN rvs.appid IS NOT NULL THEN rvs.velocity_tier
          WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 'high'
          WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 'medium'
          WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 'low'
          ELSE 'dormant'
        END::text AS desired_review_velocity_tier,
        CASE
          WHEN rvs.appid IS NOT NULL AND rvs.velocity_tier = 'high' THEN 4
          WHEN rvs.appid IS NOT NULL AND rvs.velocity_tier = 'medium' THEN 12
          WHEN rvs.appid IS NOT NULL AND rvs.velocity_tier = 'low' THEN 24
          WHEN rvs.appid IS NOT NULL THEN 72
          WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 4
          WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 12
          WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 24
          ELSE 72
        END::integer AS desired_reviews_interval_hours
      FROM sync_status s
      LEFT JOIN review_velocity_stats rvs ON rvs.appid = s.appid
      LEFT JOIN app_trends at ON at.appid = s.appid
      WHERE s.last_reviews_sync IS NOT NULL
    ),
    diff_candidates AS (
      SELECT
        dv.appid,
        dv.desired_velocity_7d,
        dv.desired_review_velocity_tier,
        dv.desired_reviews_interval_hours
      FROM desired_values dv
      WHERE dv.current_velocity_7d IS DISTINCT FROM dv.desired_velocity_7d
         OR dv.current_review_velocity_tier IS DISTINCT FROM dv.desired_review_velocity_tier
         OR dv.current_reviews_interval_hours IS DISTINCT FROM dv.desired_reviews_interval_hours
      ORDER BY dv.appid ASC
      LIMIT v_candidate_limit
    ),
    locked_candidates AS (
      SELECT s.appid
      FROM sync_status s
      JOIN diff_candidates dc ON dc.appid = s.appid
      ORDER BY s.appid ASC
      LIMIT v_apply_limit
      FOR UPDATE OF s SKIP LOCKED
    ),
    updated AS (
      UPDATE sync_status s
      SET velocity_7d = dc.desired_velocity_7d,
          review_velocity_tier = dc.desired_review_velocity_tier,
          reviews_interval_hours = dc.desired_reviews_interval_hours,
          velocity_calculated_at = now(),
          updated_at = now()
      FROM diff_candidates dc
      JOIN locked_candidates lc ON lc.appid = dc.appid
      WHERE s.appid = dc.appid
      RETURNING s.appid
    )
    SELECT count(*)::integer AS updated_count
    FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION ops.update_review_velocity_tiers()
RETURNS TABLE(count integer)
LANGUAGE sql
AS $$
  SELECT updated_count AS count
  FROM ops.update_review_velocity_tiers_batch(5000);
$$;

CREATE OR REPLACE FUNCTION legacy.upsert_storefront_app(
    p_appid integer,
    p_name text,
    p_type text,
    p_is_free boolean,
    p_is_delisted boolean,
    p_release_date date,
    p_release_date_raw text,
    p_has_workshop boolean,
    p_current_price_cents integer,
    p_current_discount_percent integer,
    p_is_released boolean,
    p_developers text[],
    p_publishers text[],
    p_dlc_appids integer[] DEFAULT ARRAY[]::integer[],
    p_parent_appid integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_developer_id integer;
    v_developer_name text;
    v_dlc_appid integer;
    v_publisher_id integer;
    v_publisher_name text;
BEGIN
    INSERT INTO legacy.apps (
      appid, name, type, is_free, is_delisted, release_date,
      release_date_raw, has_workshop, current_price_cents,
      current_discount_percent, is_released, parent_appid,
      has_developer_info, updated_at
    )
    VALUES (
      p_appid, p_name, COALESCE(p_type, 'game'), COALESCE(p_is_free, false),
      COALESCE(p_is_delisted, false), p_release_date, p_release_date_raw,
      COALESCE(p_has_workshop, false), p_current_price_cents,
      COALESCE(p_current_discount_percent, 0), COALESCE(p_is_released, true),
      p_parent_appid,
      COALESCE(array_length(p_developers, 1), 0) > 0
        OR COALESCE(array_length(p_publishers, 1), 0) > 0,
      now()
    )
    ON CONFLICT (appid)
    DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      is_free = EXCLUDED.is_free,
      is_delisted = EXCLUDED.is_delisted,
      release_date = EXCLUDED.release_date,
      release_date_raw = EXCLUDED.release_date_raw,
      has_workshop = EXCLUDED.has_workshop,
      current_price_cents = EXCLUDED.current_price_cents,
      current_discount_percent = EXCLUDED.current_discount_percent,
      is_released = EXCLUDED.is_released,
      parent_appid = EXCLUDED.parent_appid,
      has_developer_info = EXCLUDED.has_developer_info,
      updated_at = now();

    DELETE FROM legacy.app_developers WHERE appid = p_appid;
    FOREACH v_developer_name IN ARRAY COALESCE(p_developers, ARRAY[]::text[])
    LOOP
      v_developer_name := btrim(v_developer_name);
      IF v_developer_name IS NULL OR v_developer_name = '' THEN
        CONTINUE;
      END IF;

      INSERT INTO legacy.developers (name, normalized_name, updated_at)
      VALUES (v_developer_name, lower(v_developer_name), now())
      ON CONFLICT (normalized_name)
      DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_developer_id;

      INSERT INTO legacy.app_developers (appid, developer_id)
      VALUES (p_appid, v_developer_id)
      ON CONFLICT DO NOTHING;
    END LOOP;

    DELETE FROM legacy.app_publishers WHERE appid = p_appid;
    FOREACH v_publisher_name IN ARRAY COALESCE(p_publishers, ARRAY[]::text[])
    LOOP
      v_publisher_name := btrim(v_publisher_name);
      IF v_publisher_name IS NULL OR v_publisher_name = '' THEN
        CONTINUE;
      END IF;

      INSERT INTO legacy.publishers (name, normalized_name, updated_at)
      VALUES (v_publisher_name, lower(v_publisher_name), now())
      ON CONFLICT (normalized_name)
      DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_publisher_id;

      INSERT INTO legacy.app_publishers (appid, publisher_id)
      VALUES (p_appid, v_publisher_id)
      ON CONFLICT DO NOTHING;
    END LOOP;

    DELETE FROM legacy.app_dlc WHERE parent_appid = p_appid;
    FOREACH v_dlc_appid IN ARRAY COALESCE(p_dlc_appids, ARRAY[]::integer[])
    LOOP
      IF v_dlc_appid IS NULL OR v_dlc_appid = p_appid THEN
        CONTINUE;
      END IF;

      INSERT INTO legacy.app_dlc (parent_appid, dlc_appid, source)
      VALUES (p_appid, v_dlc_appid, 'storefront')
      ON CONFLICT (parent_appid, dlc_appid)
      DO UPDATE SET source = EXCLUDED.source;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION ops.get_apps_for_sync(
    p_source text,
    p_limit integer DEFAULT 100
)
RETURNS TABLE (appid integer, priority_score integer)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.appid,
    COALESCE(s.priority_score, 0)::integer AS priority_score
  FROM ops.sync_status s
  JOIN legacy.apps a ON a.appid = s.appid
  WHERE COALESCE(s.is_syncable, true) = true
    AND CASE p_source
      WHEN 'storefront' THEN COALESCE(s.last_storefront_sync, '-infinity'::timestamptz) <= now() - INTERVAL '24 hours'
      WHEN 'histogram' THEN COALESCE(s.last_histogram_sync, '-infinity'::timestamptz) <= now() - INTERVAL '24 hours'
      WHEN 'reviews' THEN COALESCE(s.next_reviews_sync, '-infinity'::timestamptz) <= now()
      WHEN 'steamspy' THEN COALESCE(s.last_steamspy_sync, '-infinity'::timestamptz) <= now() - INTERVAL '24 hours'
      ELSE COALESCE(s.next_sync_after, '-infinity'::timestamptz) <= now()
    END
  ORDER BY COALESCE(s.priority_score, 0) DESC, s.appid ASC
  LIMIT GREATEST(COALESCE(p_limit, 100), 0);
$$;

CREATE OR REPLACE FUNCTION ops.get_apps_for_sync_partitioned(
    p_source text,
    p_limit integer,
    p_partition_count integer,
    p_partition_id integer
)
RETURNS TABLE (appid integer, priority_score integer)
LANGUAGE sql
STABLE
AS $$
  SELECT appid, priority_score
  FROM ops.get_apps_for_sync(p_source, p_limit * GREATEST(p_partition_count, 1))
  WHERE mod(appid, GREATEST(p_partition_count, 1)) = p_partition_id
  ORDER BY priority_score DESC, appid ASC
  LIMIT GREATEST(COALESCE(p_limit, 100), 0);
$$;

CREATE OR REPLACE FUNCTION ops.get_steamspy_individual_fetch_candidates(
    p_limit integer DEFAULT 100,
    p_min_reviews integer DEFAULT 1000
)
RETURNS TABLE (appid integer, name text, total_reviews integer)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.appid,
    a.name,
    COALESCE(ldm.total_reviews, 0)::integer AS total_reviews
  FROM legacy.apps a
  LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN ops.sync_status s ON s.appid = a.appid
  WHERE a.type = 'game'
    AND COALESCE(a.is_delisted, false) = false
    AND COALESCE(ldm.total_reviews, 0) >= COALESCE(p_min_reviews, 1000)
    AND COALESCE(s.last_steamspy_individual_fetch, '-infinity'::timestamptz) <= now() - INTERVAL '7 days'
  ORDER BY COALESCE(ldm.total_reviews, 0) DESC, a.appid ASC
  LIMIT GREATEST(COALESCE(p_limit, 100), 0);
$$;

CREATE OR REPLACE FUNCTION ops.batch_update_prices(
    p_appids integer[],
    p_prices integer[],
    p_discounts integer[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    WITH price_rows AS (
      SELECT appid, price_cents, discount_percent
      FROM unnest(p_appids, p_prices, p_discounts)
        AS rows(appid, price_cents, discount_percent)
    ),
    updated_apps AS (
      UPDATE legacy.apps a
      SET current_price_cents = price_rows.price_cents,
          current_discount_percent = price_rows.discount_percent,
          updated_at = now()
      FROM price_rows
      WHERE a.appid = price_rows.appid
      RETURNING a.appid
    ),
    inserted_metrics AS (
      INSERT INTO metrics.daily_metrics (
        appid, metric_date, price_cents, discount_percent
      )
      SELECT appid, CURRENT_DATE, price_cents, discount_percent
      FROM price_rows
      ON CONFLICT (appid, metric_date)
      DO UPDATE SET
        price_cents = EXCLUDED.price_cents,
        discount_percent = EXCLUDED.discount_percent
      RETURNING appid
    )
    SELECT count(*)::integer INTO v_count FROM updated_apps;

    INSERT INTO ops.sync_status (appid, last_price_sync, updated_at)
    SELECT appid, now(), now()
    FROM unnest(p_appids) AS rows(appid)
    ON CONFLICT (appid)
    DO UPDATE SET last_price_sync = EXCLUDED.last_price_sync, updated_at = now();

    RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION ops.get_suspicious_zero_appids(p_appids integer[])
RETURNS integer[]
LANGUAGE sql
STABLE
AS $$
  WITH selected_appids AS (
    SELECT DISTINCT unnest(COALESCE(p_appids, ARRAY[]::integer[])) AS appid
  ),
  suspicious AS (
    SELECT sa.appid
    FROM selected_appids sa
    JOIN legacy.apps a ON a.appid = sa.appid
    WHERE a.release_date IS NOT NULL
      AND a.release_date >= CURRENT_DATE - 180

    UNION

    SELECT sa.appid
    FROM selected_appids sa
    JOIN legacy.latest_daily_metrics ldm ON ldm.appid = sa.appid
    WHERE COALESCE(ldm.total_reviews, 0) >= 1000

    UNION

    SELECT sa.appid
    FROM selected_appids sa
    WHERE EXISTS (
      SELECT 1
      FROM metrics.daily_metrics dm
      WHERE dm.appid = sa.appid
        AND dm.metric_date >= CURRENT_DATE - 30
        AND COALESCE(dm.ccu_peak, 0) > 0
    )

    UNION

    SELECT sa.appid
    FROM selected_appids sa
    WHERE EXISTS (
      SELECT 1
      FROM metrics.ccu_snapshots cs
      WHERE cs.appid = sa.appid
        AND cs.snapshot_time >= now() - INTERVAL '30 days'
        AND cs.player_count > 0
    )
  )
  SELECT COALESCE(array_agg(appid ORDER BY appid), ARRAY[]::integer[])
  FROM suspicious;
$$;

COMMENT ON FUNCTION ops.get_suspicious_zero_appids(integer[]) IS
  'Returns appids whose zero CCU samples are suspicious because recent release, review, or CCU evidence suggests nonzero activity.';

CREATE OR REPLACE FUNCTION public.recalculate_ccu_tiers()
RETURNS TABLE(tier1_count integer, tier2_count integer, tier3_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier1_count integer;
  v_tier2_count integer;
  v_tier3_count integer;
BEGIN
  WITH recent_snapshot_ccu AS (
    SELECT appid, max(player_count) AS peak_ccu
    FROM metrics.ccu_snapshots
    WHERE snapshot_time > now() - INTERVAL '7 days'
    GROUP BY appid
  ),
  recent_daily_ccu AS (
    SELECT appid, max(ccu_peak) AS peak_ccu
    FROM metrics.daily_metrics
    WHERE metric_date > CURRENT_DATE - INTERVAL '7 days'
    GROUP BY appid
  ),
  recent_ccu AS (
    SELECT
      COALESCE(s.appid, d.appid) AS appid,
      GREATEST(COALESCE(s.peak_ccu, 0), COALESCE(d.peak_ccu, 0)) AS recent_peak_ccu
    FROM recent_snapshot_ccu s
    FULL OUTER JOIN recent_daily_ccu d ON d.appid = s.appid
  ),
  release_ranks AS (
    SELECT
      appid,
      (row_number() OVER (
        ORDER BY
          CASE WHEN release_date IS NULL THEN 0 ELSE 1 END,
          release_date DESC NULLS LAST,
          appid DESC
      ))::integer AS release_rank
    FROM legacy.apps
    WHERE type = 'game'
      AND COALESCE(is_released, false) = true
      AND COALESCE(is_delisted, false) = false
      AND (
        release_date >= CURRENT_DATE - INTERVAL '1 year'
        OR release_date IS NULL
      )
  ),
  tier1_games AS (
    SELECT appid
    FROM recent_ccu
    WHERE recent_peak_ccu > 0
    ORDER BY recent_peak_ccu DESC NULLS LAST, appid ASC
    LIMIT 500
  ),
  tier2_games AS (
    SELECT r.appid
    FROM release_ranks r
    WHERE NOT EXISTS (
      SELECT 1
      FROM tier1_games t1
      WHERE t1.appid = r.appid
    )
    ORDER BY r.release_rank ASC
    LIMIT 1000
  ),
  tier_assignments AS (
    SELECT
      a.appid,
      CASE
        WHEN t1.appid IS NOT NULL THEN 1
        WHEN t2.appid IS NOT NULL THEN 2
        ELSE 3
      END::smallint AS ccu_tier,
      CASE
        WHEN t1.appid IS NOT NULL THEN 'top_ccu'
        WHEN t2.appid IS NOT NULL THEN 'new_release'
        ELSE 'default'
      END AS tier_reason,
      rc.recent_peak_ccu,
      rr.release_rank
    FROM legacy.apps a
    LEFT JOIN tier1_games t1 ON t1.appid = a.appid
    LEFT JOIN tier2_games t2 ON t2.appid = a.appid
    LEFT JOIN recent_ccu rc ON rc.appid = a.appid
    LEFT JOIN release_ranks rr ON rr.appid = a.appid
    WHERE a.type = 'game'
      AND COALESCE(a.is_released, false) = true
      AND COALESCE(a.is_delisted, false) = false
  )
  INSERT INTO ops.ccu_tier_assignments AS existing (
    appid,
    ccu_tier,
    tier_reason,
    recent_peak_ccu,
    release_rank,
    last_tier_change,
    updated_at
  )
  SELECT
    appid,
    ccu_tier,
    tier_reason,
    recent_peak_ccu,
    release_rank,
    now(),
    now()
  FROM tier_assignments
  ON CONFLICT (appid)
  DO UPDATE SET
    ccu_tier = EXCLUDED.ccu_tier,
    tier_reason = EXCLUDED.tier_reason,
    recent_peak_ccu = EXCLUDED.recent_peak_ccu,
    release_rank = EXCLUDED.release_rank,
    last_tier_change = CASE
      WHEN existing.ccu_tier IS DISTINCT FROM EXCLUDED.ccu_tier THEN now()
      ELSE existing.last_tier_change
    END,
    updated_at = now();

  SELECT
    count(*) FILTER (WHERE ccu_tier = 1)::integer,
    count(*) FILTER (WHERE ccu_tier = 2)::integer,
    count(*) FILTER (WHERE ccu_tier = 3)::integer
  INTO v_tier1_count, v_tier2_count, v_tier3_count
  FROM ops.ccu_tier_assignments;

  RETURN QUERY SELECT v_tier1_count, v_tier2_count, v_tier3_count;
END;
$$;

COMMENT ON FUNCTION public.recalculate_ccu_tiers() IS
  'Recalculates Tiger CCU tier assignments. Tier 1 = top 500 by 7-day peak CCU, Tier 2 = 1000 newest releases, Tier 3 = all other released games.';

CREATE OR REPLACE FUNCTION public.refresh_ccu_quality_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.refresh_ccu_quality_stats() IS
  'Compatibility hook for Tiger-primary CCU workers; quality-cache aggregation can be expanded after cutover.';

CREATE OR REPLACE FUNCTION ops.refresh_dashboard_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION ops.refresh_filter_count_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;

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
  FROM legacy.apps a
  LEFT JOIN ops.sync_status s ON s.appid = a.appid
  LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
  LEFT JOIN legacy.app_steam_deck sd ON sd.appid = a.appid
  LEFT JOIN LATERAL (
    SELECT array_agg(d.id ORDER BY d.name) AS ids, array_agg(d.name ORDER BY d.name) AS names
    FROM legacy.app_developers ad
    JOIN legacy.developers d ON d.id = ad.developer_id
    WHERE ad.appid = a.appid
  ) devs ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(p.id ORDER BY p.name) AS ids, array_agg(p.name ORDER BY p.name) AS names
    FROM legacy.app_publishers ap
    JOIN legacy.publishers p ON p.id = ap.publisher_id
    WHERE ap.appid = a.appid
  ) pubs ON true
  LEFT JOIN LATERAL (
    SELECT
      array_agg(g.name ORDER BY ag.is_primary DESC, g.name) AS names,
      (array_agg(g.name ORDER BY ag.is_primary DESC, g.name))[1] AS primary_genre
    FROM legacy.app_genres ag
    JOIN legacy.steam_genres g ON g.genre_id = ag.genre_id
    WHERE ag.appid = a.appid
  ) genres ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(t.name ORDER BY ast.rank NULLS LAST, t.name) AS names
    FROM legacy.app_steam_tags ast
    JOIN legacy.steam_tags t ON t.tag_id = ast.tag_id
    WHERE ast.appid = a.appid
  ) tags ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(c.name ORDER BY c.name) AS names
    FROM legacy.app_categories ac
    JOIN legacy.steam_categories c ON c.category_id = ac.category_id
    WHERE ac.appid = a.appid
  ) categories ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(f.id ORDER BY f.name) AS ids, array_agg(f.name ORDER BY f.name) AS names
    FROM legacy.app_franchises af
    JOIN legacy.franchises f ON f.id = af.franchise_id
    WHERE af.appid = a.appid
  ) franchises ON true
  WHERE a.name IS NOT NULL
    AND COALESCE(a.is_delisted, false) = false
    AND COALESCE(s.last_embedding_sync, '-infinity'::timestamptz)
      <= COALESCE(a.updated_at, now()) - INTERVAL '1 second'
  ORDER BY COALESCE(s.priority_score, 0) DESC, a.appid ASC
  LIMIT GREATEST(COALESCE(p_limit, 500), 0);
$$;

CREATE OR REPLACE FUNCTION ops.mark_apps_embedded(p_appids integer[], p_hashes text[])
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO ops.sync_status (appid, last_embedding_sync, embedding_hash, updated_at)
  SELECT appid, now(), embedding_hash, now()
  FROM unnest(p_appids, p_hashes) AS rows(appid, embedding_hash)
  ON CONFLICT (appid)
  DO UPDATE SET
    last_embedding_sync = EXCLUDED.last_embedding_sync,
    embedding_hash = EXCLUDED.embedding_hash,
    updated_at = now();
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
  SELECT
    p.id,
    p.name,
    p.game_count,
    p.first_game_release_date,
    ARRAY[]::text[] AS top_genres,
    ARRAY[]::text[] AS top_tags,
    ARRAY[]::text[] AS platforms_supported,
    COALESCE(sum(ldm.total_reviews), 0)::bigint AS total_reviews,
    avg(CASE WHEN ldm.total_reviews > 0 THEN ldm.positive_reviews::numeric / ldm.total_reviews::numeric * 100 END) AS avg_review_percentage,
    COALESCE((array_agg(a.name ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::text[]) AS top_game_names,
    COALESCE((array_agg(a.appid ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::integer[]) AS top_game_appids
  FROM legacy.publishers p
  JOIN legacy.app_publishers ap ON ap.publisher_id = p.id
  JOIN legacy.apps a ON a.appid = ap.appid
  LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
  WHERE p.name IS NOT NULL
    AND (
      p.last_embedding_sync IS NULL
      OR COALESCE(p.updated_at, '-infinity'::timestamptz) > p.last_embedding_sync
    )
  GROUP BY p.id, p.name, p.game_count, p.first_game_release_date
  ORDER BY p.game_count DESC NULLS LAST, p.id ASC
  LIMIT GREATEST(COALESCE(p_limit, 200), 0);
$$;

CREATE OR REPLACE FUNCTION ops.mark_publishers_embedded(p_ids integer[], p_hashes text[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE legacy.publishers p
  SET last_embedding_sync = now(),
      embedding_hash = rows.embedding_hash,
      updated_at = now()
  FROM unnest(p_ids, p_hashes) AS rows(id, embedding_hash)
  WHERE p.id = rows.id;
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
  SELECT
    d.id,
    d.name,
    d.game_count,
    d.first_game_release_date,
    d.game_count <= 5 AS is_indie,
    ARRAY[]::text[] AS top_genres,
    ARRAY[]::text[] AS top_tags,
    ARRAY[]::text[] AS platforms_supported,
    COALESCE(sum(ldm.total_reviews), 0)::bigint AS total_reviews,
    avg(CASE WHEN ldm.total_reviews > 0 THEN ldm.positive_reviews::numeric / ldm.total_reviews::numeric * 100 END) AS avg_review_percentage,
    COALESCE((array_agg(a.name ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::text[]) AS top_game_names,
    COALESCE((array_agg(a.appid ORDER BY COALESCE(ldm.total_reviews, 0) DESC NULLS LAST))[1:10], ARRAY[]::integer[]) AS top_game_appids
  FROM legacy.developers d
  JOIN legacy.app_developers ad ON ad.developer_id = d.id
  JOIN legacy.apps a ON a.appid = ad.appid
  LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
  WHERE d.name IS NOT NULL
    AND (
      d.last_embedding_sync IS NULL
      OR COALESCE(d.updated_at, '-infinity'::timestamptz) > d.last_embedding_sync
    )
  GROUP BY d.id, d.name, d.game_count, d.first_game_release_date
  ORDER BY d.game_count DESC NULLS LAST, d.id ASC
  LIMIT GREATEST(COALESCE(p_limit, 100), 0);
$$;

CREATE OR REPLACE FUNCTION ops.mark_developers_embedded(p_ids integer[], p_hashes text[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE legacy.developers d
  SET last_embedding_sync = now(),
      embedding_hash = rows.embedding_hash,
      updated_at = now()
  FROM unnest(p_ids, p_hashes) AS rows(id, embedding_hash)
  WHERE d.id = rows.id;
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
