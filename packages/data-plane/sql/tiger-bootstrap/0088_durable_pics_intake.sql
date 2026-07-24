-- Durable Steam PICS intake records.
-- This file is intentionally not applied by scheduled workflows. Apply it only
-- during an approved Tiger write window after backup/PITR evidence is current.
--
-- The PICS leader writes one upstream response per transaction. Every source
-- list position is retained (including duplicate app IDs), claimable work is
-- coalesced separately, and the primary cursor advances only after count/hash
-- reconciliation succeeds.

CREATE TABLE IF NOT EXISTS ops.pics_change_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_key text NOT NULL,
    work_mode text NOT NULL,
    lane text NOT NULL,
    from_change_number bigint NOT NULL,
    to_change_number bigint NOT NULL,
    response_since_change_number bigint NOT NULL,
    received_at timestamp with time zone NOT NULL,
    source_app_count integer NOT NULL,
    distinct_app_count integer NOT NULL,
    durable_app_count integer NOT NULL,
    app_changes_sha256 text NOT NULL,
    force_full_update boolean NOT NULL,
    force_full_app_update boolean NOT NULL,
    force_full_package_update boolean NOT NULL,
    source_complete boolean NOT NULL,
    payload_schema_version text NOT NULL DEFAULT 'pics-change-response/v2',
    archive_bucket text,
    archive_key text,
    archive_content_hash text,
    archive_byte_size bigint,
    archive_content_type text,
    primary_cursor_advanced boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'committed',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pics_change_batches_stream_key_check CHECK (
      nullif(btrim(stream_key), '') IS NOT NULL
      AND length(stream_key) <= 128
    ),
    CONSTRAINT pics_change_batches_work_mode_check CHECK (
      work_mode = ANY (ARRAY['shadow'::text, 'durable'::text])
    ),
    CONSTRAINT pics_change_batches_lane_check CHECK (
      lane = ANY (ARRAY['live'::text, 'catchup'::text])
    ),
    CONSTRAINT pics_change_batches_cursor_check CHECK (
      from_change_number >= 0
      AND to_change_number > from_change_number
      AND response_since_change_number >= 0
    ),
    CONSTRAINT pics_change_batches_count_check CHECK (
      source_app_count >= 0
      AND distinct_app_count >= 0
      AND durable_app_count >= 0
      AND distinct_app_count <= source_app_count
      AND durable_app_count = source_app_count
    ),
    CONSTRAINT pics_change_batches_hash_check CHECK (
      app_changes_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT pics_change_batches_payload_version_check CHECK (
      nullif(btrim(payload_schema_version), '') IS NOT NULL
    ),
    CONSTRAINT pics_change_batches_status_check CHECK (
      status = ANY (
        ARRAY[
          'committed'::text,
          'reconciled'::text,
          'source_blocked'::text
        ]
      )
    ),
    CONSTRAINT pics_change_batches_source_complete_check CHECK (
      source_complete = (
        response_since_change_number = from_change_number
        AND NOT force_full_update
        AND NOT force_full_app_update
      )
    ),
    CONSTRAINT pics_change_batches_status_completeness_check CHECK (
      (
        source_complete
        AND status = ANY (ARRAY['committed'::text, 'reconciled'::text])
      )
      OR (
        NOT source_complete
        AND status = 'source_blocked'
      )
    ),
    CONSTRAINT pics_change_batches_primary_cursor_check CHECK (
      primary_cursor_advanced = (work_mode = 'durable' AND source_complete)
    ),
    CONSTRAINT pics_change_batches_archive_check CHECK (
      (
        archive_bucket IS NULL
        AND archive_key IS NULL
        AND archive_content_hash IS NULL
        AND archive_byte_size IS NULL
        AND archive_content_type IS NULL
      )
      OR (
        nullif(btrim(archive_bucket), '') IS NOT NULL
        AND nullif(btrim(archive_key), '') IS NOT NULL
        AND archive_content_hash ~ '^[0-9a-f]{64}$'
        AND archive_byte_size >= 0
        AND nullif(btrim(archive_content_type), '') IS NOT NULL
      )
    ),
    CONSTRAINT pics_change_batches_stream_cursor_key UNIQUE (
      stream_key,
      from_change_number,
      to_change_number
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_change_batches_stream_cursor
  ON ops.pics_change_batches (stream_key, to_change_number DESC);
CREATE INDEX IF NOT EXISTS idx_ops_pics_change_batches_received
  ON ops.pics_change_batches (received_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_ops_pics_change_batches_unreconciled
  ON ops.pics_change_batches (received_at ASC, id)
  WHERE status = 'committed';

CREATE TABLE IF NOT EXISTS ops.pics_change_batch_apps (
    batch_id uuid NOT NULL
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    source_index integer NOT NULL,
    appid integer NOT NULL,
    source_change_number bigint NOT NULL,
    needs_token boolean NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pics_change_batch_apps_pkey PRIMARY KEY (batch_id, source_index),
    CONSTRAINT pics_change_batch_apps_source_index_check CHECK (source_index >= 0),
    CONSTRAINT pics_change_batch_apps_appid_check CHECK (appid > 0),
    CONSTRAINT pics_change_batch_apps_change_number_check CHECK (
      source_change_number >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_change_batch_apps_appid_batch
  ON ops.pics_change_batch_apps (appid, batch_id);

CREATE TABLE IF NOT EXISTS ops.pics_work_state (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    stream_key text NOT NULL,
    work_mode text NOT NULL,
    lane text NOT NULL,
    priority integer NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    first_batch_id uuid NOT NULL
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    latest_batch_id uuid NOT NULL
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    first_change_number bigint NOT NULL,
    latest_change_number bigint NOT NULL,
    dirty_since timestamp with time zone NOT NULL,
    last_dirty_at timestamp with time zone NOT NULL,
    claimed_through_change_number bigint,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    worker_id text,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 8,
    next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
    last_completed_change_number bigint,
    last_completed_at timestamp with time zone,
    last_error_code text,
    last_error_message text,
    dead_lettered_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pics_work_state_app_stream_key UNIQUE (appid, stream_key),
    CONSTRAINT pics_work_state_appid_check CHECK (appid > 0),
    CONSTRAINT pics_work_state_stream_key_check CHECK (
      nullif(btrim(stream_key), '') IS NOT NULL
      AND length(stream_key) <= 128
    ),
    CONSTRAINT pics_work_state_work_mode_check CHECK (
      work_mode = ANY (ARRAY['shadow'::text, 'durable'::text])
    ),
    CONSTRAINT pics_work_state_lane_check CHECK (
      lane = ANY (ARRAY['new'::text, 'live'::text, 'catchup'::text])
    ),
    CONSTRAINT pics_work_state_state_check CHECK (
      state = ANY (
        ARRAY[
          'pending'::text,
          'claimed'::text,
          'retrying'::text,
          'completed'::text,
          'dead_letter'::text,
          'source_blocked'::text
        ]
      )
    ),
    CONSTRAINT pics_work_state_priority_check CHECK (priority >= 0),
    CONSTRAINT pics_work_state_change_number_check CHECK (
      first_change_number >= 0
      AND latest_change_number >= first_change_number
      AND (
        claimed_through_change_number IS NULL
        OR claimed_through_change_number <= latest_change_number
      )
      AND (
        last_completed_change_number IS NULL
        OR last_completed_change_number <= latest_change_number
      )
    ),
    CONSTRAINT pics_work_state_attempts_check CHECK (
      attempts >= 0 AND max_attempts > 0
    ),
    CONSTRAINT pics_work_state_lease_check CHECK (
      (
        state = 'claimed'
        AND nullif(btrim(worker_id), '') IS NOT NULL
        AND claimed_at IS NOT NULL
        AND claim_expires_at IS NOT NULL
        AND claimed_through_change_number IS NOT NULL
      )
      OR (
        state <> 'claimed'
        AND worker_id IS NULL
        AND claimed_at IS NULL
        AND claim_expires_at IS NULL
        AND heartbeat_at IS NULL
        AND claimed_through_change_number IS NULL
      )
    ),
    CONSTRAINT pics_work_state_dead_letter_check CHECK (
      (state = 'dead_letter' AND dead_lettered_at IS NOT NULL)
      OR (state <> 'dead_letter' AND dead_lettered_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_work_state_claimable
  ON ops.pics_work_state (
    work_mode,
    stream_key,
    lane,
    priority DESC,
    next_attempt_at ASC,
    dirty_since ASC,
    id ASC
  )
  WHERE state IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_ops_pics_work_state_claimed
  ON ops.pics_work_state (work_mode, stream_key, claim_expires_at ASC, id ASC)
  WHERE state = 'claimed';
CREATE INDEX IF NOT EXISTS idx_ops_pics_work_state_dead_letter
  ON ops.pics_work_state (work_mode, stream_key, dead_lettered_at DESC, id DESC)
  WHERE state = 'dead_letter';

CREATE TABLE IF NOT EXISTS ops.app_data_readiness (
    appid integer NOT NULL,
    source text NOT NULL,
    status text NOT NULL,
    source_at timestamp with time zone,
    processed_at timestamp with time zone,
    version text NOT NULL,
    blocking_reason text,
    retryable boolean NOT NULL DEFAULT true,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_data_readiness_pkey PRIMARY KEY (appid, source),
    CONSTRAINT app_data_readiness_appid_check CHECK (appid > 0),
    CONSTRAINT app_data_readiness_source_check CHECK (
      source = ANY (
        ARRAY[
          'catalog'::text,
          'storefront'::text,
          'pics'::text,
          'market_metrics'::text,
          'creator'::text,
          'overall'::text
        ]
      )
    ),
    CONSTRAINT app_data_readiness_status_check CHECK (
      status = ANY (
        ARRAY[
          'unknown'::text,
          'pending'::text,
          'ready'::text,
          'partial'::text,
          'stale'::text,
          'source_blocked'::text,
          'invalid'::text,
          'failed'::text
        ]
      )
    ),
    CONSTRAINT app_data_readiness_version_check CHECK (
      nullif(btrim(version), '') IS NOT NULL
    ),
    CONSTRAINT app_data_readiness_provenance_check CHECK (
      jsonb_typeof(provenance) = 'object'
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_app_data_readiness_source_status
  ON ops.app_data_readiness (source, status, updated_at ASC, appid ASC);
CREATE INDEX IF NOT EXISTS idx_ops_app_data_readiness_retryable
  ON ops.app_data_readiness (source, updated_at ASC, appid ASC)
  WHERE retryable = true AND status IN ('pending', 'partial', 'stale', 'failed');
