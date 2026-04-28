-- Narrow Tiger write surface for PICS change-history cutover.
-- Apply only after the events/news foundation has created events.app_change_events.

CREATE TABLE IF NOT EXISTS docs.app_source_snapshots (
    id bigserial PRIMARY KEY,
    appid integer NOT NULL,
    source text NOT NULL,
    observed_at timestamp with time zone NOT NULL DEFAULT now(),
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    content_hash text NOT NULL,
    previous_snapshot_id bigint,
    trigger_reason text NOT NULL,
    trigger_cursor text,
    snapshot_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    archive_bucket text,
    archive_key text,
    archive_content_hash text,
    archive_byte_size bigint,
    archive_content_type text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT app_source_snapshots_source_check CHECK (
      source = ANY (ARRAY['storefront'::text, 'pics'::text])
    )
);

CREATE INDEX IF NOT EXISTS idx_docs_app_source_snapshots_app_source_time
  ON docs.app_source_snapshots(appid, source, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_docs_app_source_snapshots_archive_key
  ON docs.app_source_snapshots(archive_bucket, archive_key)
  WHERE archive_key IS NOT NULL;

SELECT setval(
  pg_get_serial_sequence('docs.app_source_snapshots', 'id'),
  GREATEST(
    COALESCE((SELECT MAX(id) + 1 FROM docs.app_source_snapshots), 1000000000000),
    1000000000000
  ),
  false
);

ALTER TABLE events.app_change_events
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD COLUMN IF NOT EXISTS evidence_archive_bucket text,
  ADD COLUMN IF NOT EXISTS evidence_archive_key text,
  ADD COLUMN IF NOT EXISTS evidence_archive_content_hash text,
  ADD COLUMN IF NOT EXISTS evidence_archive_byte_size bigint,
  ADD COLUMN IF NOT EXISTS evidence_archive_content_type text,
  ADD COLUMN IF NOT EXISTS evidence_archived_at timestamp with time zone;

CREATE SEQUENCE IF NOT EXISTS events.app_change_events_tiger_id_seq
  AS bigint
  START WITH 1000000000000
  INCREMENT BY 1;

ALTER TABLE events.app_change_events
  ALTER COLUMN id SET DEFAULT nextval('events.app_change_events_tiger_id_seq');

SELECT setval(
  'events.app_change_events_tiger_id_seq',
  GREATEST(
    COALESCE((SELECT MAX(id) + 1 FROM events.app_change_events), 1000000000000),
    1000000000000
  ),
  false
);

CREATE INDEX IF NOT EXISTS idx_events_app_change_events_evidence_archive_key
  ON events.app_change_events(evidence_archive_bucket, evidence_archive_key)
  WHERE evidence_archive_key IS NOT NULL;
