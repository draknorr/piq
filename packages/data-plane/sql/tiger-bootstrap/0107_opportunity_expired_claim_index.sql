-- Apply only after explicit approval, outside a transaction block.
-- The pending/retrying branch retains idx_opportunity_work_claim.
-- A small extra index lets expired-lease reads avoid scanning completed work.
-- Rollback: DROP INDEX CONCURRENTLY opportunity.idx_opportunity_work_expired_claim;
SET lock_timeout = '5s';
SET statement_timeout = '5min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opportunity_work_expired_claim
  ON opportunity.work_queue (claim_expires_at, id)
  WHERE state = 'claimed';
