-- Opportunity Review Priority v2 storefront description/readiness materialization.
-- Additive behavior only: replaces one trigger function and writes bounded JSON
-- into the existing ops.app_data_readiness.provenance object on natural syncs.

CREATE OR REPLACE FUNCTION ops.capture_storefront_sync_readiness_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_snapshot docs.app_source_snapshots%ROWTYPE;
  v_description jsonb;
BEGIN
  IF NEW.last_storefront_sync IS NULL
     OR NEW.storefront_accessible IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_snapshot
  FROM docs.app_source_snapshots
  WHERE appid = NEW.appid
    AND source = 'storefront'
  ORDER BY observed_at DESC, id DESC
  LIMIT 1;

  IF v_snapshot.id IS NOT NULL
     AND jsonb_typeof(v_snapshot.snapshot_summary->'opportunityDescription') = 'object'
  THEN
    v_description :=
      v_snapshot.snapshot_summary->'opportunityDescription'
      || jsonb_build_object(
        'sourceSnapshotId', v_snapshot.id,
        'sourceAt', v_snapshot.observed_at,
        'contentHash', v_snapshot.content_hash
      );
  ELSE
    v_description := NULL;
  END IF;

  INSERT INTO ops.app_data_readiness (
    appid,
    source,
    status,
    source_at,
    processed_at,
    version,
    blocking_reason,
    retryable,
    provenance,
    created_at,
    updated_at
  )
  VALUES (
    NEW.appid,
    'storefront',
    CASE
      WHEN NEW.storefront_accessible THEN 'ready'
      ELSE 'source_blocked'
    END,
    NEW.last_storefront_sync,
    clock_timestamp(),
    'storefront-readiness/v2',
    CASE
      WHEN NEW.storefront_accessible THEN NULL
      ELSE 'storefront_inaccessible'
    END,
    true,
    jsonb_strip_nulls(jsonb_build_object(
      'storefront_accessible', NEW.storefront_accessible,
      'last_error_source', NEW.last_error_source,
      'last_error_at', NEW.last_error_at,
      'source_snapshot_id', v_snapshot.id,
      'snapshot_observed_at', v_snapshot.observed_at,
      'content_hash', v_snapshot.content_hash,
      'archive_bucket', v_snapshot.archive_bucket,
      'archive_key', v_snapshot.archive_key,
      'description', v_description
    )),
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (appid, source)
  DO UPDATE SET
    status = EXCLUDED.status,
    source_at = EXCLUDED.source_at,
    processed_at = EXCLUDED.processed_at,
    version = EXCLUDED.version,
    blocking_reason = EXCLUDED.blocking_reason,
    retryable = EXCLUDED.retryable,
    provenance = EXCLUDED.provenance,
    updated_at = clock_timestamp()
  WHERE ops.app_data_readiness.source_at IS NULL
     OR EXCLUDED.source_at >= ops.app_data_readiness.source_at;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ops.capture_storefront_sync_readiness_v1() IS
  'Captures storefront readiness and bounded Opportunity description provenance from the latest natural snapshot; opportunity-review-priority/v2.';
