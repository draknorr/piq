-- Prepared only. Apply after explicit approval, with festival jobs held.
-- Existing source history retains exact review observations and replay identity.
-- Run as separate statements, not inside a surrounding transaction. Build the
-- partial index before allowing review rows, without blocking existing writers.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
CREATE UNIQUE INDEX CONCURRENTLY idx_app_source_snapshots_review_observation
  ON docs.app_source_snapshots(appid, source, observed_at) WHERE source = 'reviews';
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE docs.app_source_snapshots DROP CONSTRAINT app_source_snapshots_source_check;
ALTER TABLE docs.app_source_snapshots ADD CONSTRAINT app_source_snapshots_source_check
  CHECK (source IN ('storefront', 'pics', 'reviews')) NOT VALID;
-- Existing rows already passed the narrower constraint. Validation can be
-- scheduled separately; NOT VALID still checks every new/changed row.
COMMIT;
RESET lock_timeout;
RESET statement_timeout;
-- If the concurrent index build fails, stop and inspect its validity before
-- retrying; a failed build can leave an invalid index. Do not enable writers.
-- Rollback: disable festival writes/export; retain review rows and this additive
-- surface. Restoring the old constraint would require deleting retained history.
