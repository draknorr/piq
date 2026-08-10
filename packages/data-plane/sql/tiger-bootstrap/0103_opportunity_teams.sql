-- Admin-managed collaboration teams for the Opportunity Brief.
--
-- This migration is additive. Existing personal workspaces, profiles, runs,
-- results, deliveries, and activity remain in place. Applying this file is a
-- production database write and requires explicit approval under the
-- repository database-safety policy.

CREATE TABLE IF NOT EXISTS opportunity.teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_by uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_teams_name_unique
    ON opportunity.teams (lower(name));

CREATE TABLE IF NOT EXISTS opportunity.team_memberships (
    team_id uuid NOT NULL
        REFERENCES opportunity.teams(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    identity_email text NOT NULL,
    display_name text,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'removed')),
    added_by uuid NOT NULL,
    joined_at timestamp with time zone NOT NULL DEFAULT now(),
    removed_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_team_memberships_one_active
    ON opportunity.team_memberships (user_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_opportunity_team_memberships_team_active
    ON opportunity.team_memberships (team_id, user_id)
    WHERE status = 'active';

ALTER TABLE opportunity.team_activity
    ADD COLUMN IF NOT EXISTS team_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opportunity_team_activity_team_fk'
          AND conrelid = 'opportunity.team_activity'::regclass
    ) THEN
        ALTER TABLE opportunity.team_activity
            ADD CONSTRAINT opportunity_team_activity_team_fk
            FOREIGN KEY (team_id)
            REFERENCES opportunity.teams(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_opportunity_team_activity_team_game
    ON opportunity.team_activity (team_id, appid, occurred_at DESC)
    WHERE team_id IS NOT NULL;

ALTER TABLE opportunity.team_research_state
    ADD COLUMN IF NOT EXISTS team_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opportunity_team_research_state_team_fk'
          AND conrelid = 'opportunity.team_research_state'::regclass
    ) THEN
        ALTER TABLE opportunity.team_research_state
            ADD CONSTRAINT opportunity_team_research_state_team_fk
            FOREIGN KEY (team_id)
            REFERENCES opportunity.teams(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_team_research_state_active
    ON opportunity.team_research_state (team_id, user_id, appid)
    WHERE team_id IS NOT NULL;

ALTER TABLE opportunity.audit_log
    ADD COLUMN IF NOT EXISTS team_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opportunity_audit_log_team_fk'
          AND conrelid = 'opportunity.audit_log'::regclass
    ) THEN
        ALTER TABLE opportunity.audit_log
            ADD CONSTRAINT opportunity_audit_log_team_fk
            FOREIGN KEY (team_id)
            REFERENCES opportunity.teams(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_opportunity_audit_team
    ON opportunity.audit_log (team_id, occurred_at DESC)
    WHERE team_id IS NOT NULL;

COMMENT ON TABLE opportunity.teams IS
    'Admin-managed collaboration boundary above personal Opportunity workspaces.';
COMMENT ON TABLE opportunity.team_memberships IS
    'One active collaboration-team membership per Supabase auth user.';
COMMENT ON COLUMN opportunity.team_activity.team_id IS
    'Optional collaboration scope; NULL retains legacy personal-workspace activity.';
