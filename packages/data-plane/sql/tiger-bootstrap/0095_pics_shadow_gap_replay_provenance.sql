-- Auditable provenance for replaying a complete shadow PICS interval into the
-- durable primary stream.
--
-- This schema is intentionally additive and is not applied by any scheduled
-- workflow. Applying it is a production Tiger write and requires a separate
-- approval. Executing a replay is a second, separately approved Tiger/R2 write.

SET statement_timeout = '2min';
SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS ops.pics_shadow_gap_replay_provenance (
    primary_batch_id uuid PRIMARY KEY
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    source_batch_id uuid NOT NULL
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    gap_evidence_batch_id uuid NOT NULL
      REFERENCES ops.pics_change_batches(id) ON DELETE RESTRICT,
    source_stream_key text NOT NULL,
    source_from_change_number bigint NOT NULL,
    source_to_change_number bigint NOT NULL,
    recovered_from_change_number bigint NOT NULL,
    recovered_to_change_number bigint NOT NULL,
    recovered_app_count integer NOT NULL,
    recovered_distinct_app_count integer NOT NULL,
    recovered_app_changes_sha256 text NOT NULL,
    plan_sha256 text NOT NULL,
    requested_by text NOT NULL,
    source_archive_bucket text NOT NULL,
    source_archive_key text NOT NULL,
    source_archive_content_hash text NOT NULL,
    source_archive_byte_size bigint NOT NULL,
    source_archive_content_type text NOT NULL,
    gap_archive_bucket text NOT NULL,
    gap_archive_key text NOT NULL,
    gap_archive_content_hash text NOT NULL,
    gap_archive_byte_size bigint NOT NULL,
    gap_archive_content_type text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pics_shadow_gap_replay_source_stream_check CHECK (
      nullif(btrim(source_stream_key), '') IS NOT NULL
      AND length(source_stream_key) <= 128
      AND source_stream_key <> 'primary'
    ),
    CONSTRAINT pics_shadow_gap_replay_cursor_check CHECK (
      source_from_change_number >= 0
      AND source_to_change_number > source_from_change_number
      AND recovered_from_change_number >= source_from_change_number
      AND recovered_to_change_number = source_to_change_number
      AND recovered_to_change_number > recovered_from_change_number
    ),
    CONSTRAINT pics_shadow_gap_replay_count_check CHECK (
      recovered_app_count >= 0
      AND recovered_distinct_app_count >= 0
      AND recovered_distinct_app_count <= recovered_app_count
    ),
    CONSTRAINT pics_shadow_gap_replay_hash_check CHECK (
      recovered_app_changes_sha256 ~ '^[0-9a-f]{64}$'
      AND plan_sha256 ~ '^[0-9a-f]{64}$'
      AND source_archive_content_hash ~ '^[0-9a-f]{64}$'
      AND gap_archive_content_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT pics_shadow_gap_replay_requested_by_check CHECK (
      nullif(btrim(requested_by), '') IS NOT NULL
      AND length(requested_by) <= 200
    ),
    CONSTRAINT pics_shadow_gap_replay_archive_check CHECK (
      nullif(btrim(source_archive_bucket), '') IS NOT NULL
      AND nullif(btrim(source_archive_key), '') IS NOT NULL
      AND source_archive_byte_size >= 0
      AND nullif(btrim(source_archive_content_type), '') IS NOT NULL
      AND nullif(btrim(gap_archive_bucket), '') IS NOT NULL
      AND nullif(btrim(gap_archive_key), '') IS NOT NULL
      AND gap_archive_byte_size >= 0
      AND nullif(btrim(gap_archive_content_type), '') IS NOT NULL
    ),
    CONSTRAINT pics_shadow_gap_replay_gap_range_key UNIQUE (
      gap_evidence_batch_id,
      recovered_from_change_number,
      recovered_to_change_number
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_pics_shadow_gap_replay_source
  ON ops.pics_shadow_gap_replay_provenance (
    source_stream_key,
    source_from_change_number,
    source_to_change_number
  );

CREATE INDEX IF NOT EXISTS idx_ops_pics_shadow_gap_replay_gap
  ON ops.pics_shadow_gap_replay_provenance (
    gap_evidence_batch_id,
    recovered_to_change_number
  );

COMMENT ON TABLE ops.pics_shadow_gap_replay_provenance IS
  'Immutable per-primary-batch proof that a complete, archived shadow response (or exact post-cursor suffix of one overlapping response) was verified and replayed before the canonical cursor advanced.';
