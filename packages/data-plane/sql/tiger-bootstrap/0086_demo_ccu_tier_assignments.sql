-- Demo-only CCU polling state.
--
-- This intentionally does not reuse ops.ccu_tier_assignments, which is the game
-- CCU queue used by the existing ccu/ccu-tiered/ccu-daily workers.

CREATE TABLE IF NOT EXISTS ops.demo_ccu_tier_assignments (
  appid integer PRIMARY KEY,
  demo_ccu_tier smallint NOT NULL DEFAULT 2,
  tier_reason text,
  rank_position integer,
  recent_peak_ccu integer,
  total_reviews integer,
  release_date date,
  is_new_demo boolean NOT NULL DEFAULT false,
  ccu_fetch_status text,
  ccu_skip_until timestamp with time zone,
  last_ccu_synced timestamp with time zone,
  last_ccu_validation_state text,
  last_ccu_validation_at timestamp with time zone,
  last_tier_change timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_demo_ccu_tier_assignments_tier_rank
  ON ops.demo_ccu_tier_assignments (demo_ccu_tier, rank_position, appid);

CREATE INDEX IF NOT EXISTS idx_ops_demo_ccu_tier_assignments_tier_synced
  ON ops.demo_ccu_tier_assignments (
    demo_ccu_tier,
    last_ccu_synced ASC NULLS FIRST,
    rank_position ASC NULLS LAST,
    appid
  );

CREATE INDEX IF NOT EXISTS idx_ops_demo_ccu_tier_assignments_skip
  ON ops.demo_ccu_tier_assignments (ccu_skip_until)
  WHERE ccu_skip_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_demo_ccu_tier_assignments_new_rank
  ON ops.demo_ccu_tier_assignments (is_new_demo DESC, rank_position, appid)
  WHERE is_new_demo = true;

CREATE INDEX IF NOT EXISTS idx_ops_demo_ccu_tier_assignments_recent_peak
  ON ops.demo_ccu_tier_assignments (recent_peak_ccu DESC NULLS LAST)
  WHERE recent_peak_ccu IS NOT NULL;

COMMENT ON TABLE ops.demo_ccu_tier_assignments IS
  'Demo-only CCU polling state. Keeps demo prioritization, rotation, and validation separate from game CCU tier assignments.';

COMMENT ON COLUMN ops.demo_ccu_tier_assignments.demo_ccu_tier IS
  '1 = hot demo tier, 2 = rotating demo tail.';

COMMENT ON COLUMN ops.demo_ccu_tier_assignments.is_new_demo IS
  'True while the demo is inside the configurable new-demo boost window.';
