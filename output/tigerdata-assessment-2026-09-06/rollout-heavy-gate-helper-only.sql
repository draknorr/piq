-- Apply only after explicit production approval. No scheduler interval changes.
-- One global gate for heavy refreshes; PICS holds its shared counterpart only
-- while settling a bounded catch-up pass. Raw intake and live work do not wait.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Install only the additive helper before rolling out gate-before-fence callers.
-- The native procedures must remain unchanged until older worker processes drain.
DO $absent$
BEGIN
  IF to_regprocedure('ops.acquire_heavy_phase_gate(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Heavy gate helper already exists: inspect the prior commit/result before continuing';
  END IF;
END;
$absent$;

CREATE OR REPLACE FUNCTION ops.acquire_heavy_phase_gate(p_wait_seconds integer DEFAULT 120)
RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF p_wait_seconds IS NULL OR p_wait_seconds < 1 OR p_wait_seconds > 300 THEN
    RAISE EXCEPTION 'Heavy phase wait must be between 1 and 300 seconds';
  END IF;
  PERFORM set_config('lock_timeout', p_wait_seconds::text || 's', true);
  PERFORM pg_advisory_xact_lock(1886417008, 3);
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
END;
$gate$;

COMMIT;
