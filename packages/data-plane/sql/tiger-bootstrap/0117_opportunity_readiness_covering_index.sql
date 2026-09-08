-- Apply only after explicit approval, outside a transaction block.
-- Covers the unchanged readiness anti-join and its exact due/appid ordering.
-- Duplicate-heavy queues can inspect due candidates without fetching their
-- large last_outcome/missing_fields heap tuples. Exclusion still precedes LIMIT.
--
-- Keep idx_opportunity_candidate_recheck during the observation window. After
-- acceptance, separately approve dropping that superseded index concurrently.
-- The wider index consumes storage/WAL and indexes workspace/material-event
-- changes too; index-only benefits depend on vacuum's visibility map.
-- Rollback: DROP INDEX CONCURRENTLY opportunity.idx_opportunity_candidate_recheck_covering;
SET lock_timeout = '5s';
SET statement_timeout = '5min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opportunity_candidate_recheck_covering
  ON opportunity.candidate_state (next_evaluation_at, appid)
  INCLUDE (user_id, workspace_id, material_event_id)
  WHERE state = 'pending_readiness';
