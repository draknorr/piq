-- Custom Daily Steam Opportunity Brief MVP.
--
-- This migration is additive. Supabase authentication identifiers are stored
-- as external UUIDs, while all opportunity product and operational state is
-- transactionally owned by Tiger behind the query API.
--
-- Applying this file is a production database write and requires explicit
-- approval under the repository database-safety policy.

CREATE SCHEMA IF NOT EXISTS opportunity;

CREATE TABLE IF NOT EXISTS opportunity.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_by uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunity.workspace_memberships (
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    identity_email text,
    role text NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member')),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
    joined_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_memberships_user_active
    ON opportunity.workspace_memberships (user_id, workspace_id)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS opportunity.presets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    description text,
    editorial_status text NOT NULL DEFAULT 'draft'
        CHECK (editorial_status IN ('draft', 'published', 'archived')),
    current_version_id uuid,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunity.preset_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    preset_id uuid NOT NULL
        REFERENCES opportunity.presets(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK (version > 0),
    rule_schema_version text NOT NULL DEFAULT 'opportunity-rules/v1',
    rules jsonb NOT NULL,
    event_subscriptions text[] NOT NULL DEFAULT '{}'::text[],
    calculation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    change_notes text,
    published_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (preset_id, version)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opportunity_presets_current_version_fk'
          AND conrelid = 'opportunity.presets'::regclass
    ) THEN
        ALTER TABLE opportunity.presets
            ADD CONSTRAINT opportunity_presets_current_version_fk
            FOREIGN KEY (current_version_id)
            REFERENCES opportunity.preset_versions(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS opportunity.profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    owner_user_id uuid NOT NULL,
    source_preset_id uuid
        REFERENCES opportunity.presets(id) ON DELETE SET NULL,
    source_preset_version_id uuid
        REFERENCES opportunity.preset_versions(id) ON DELETE SET NULL,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'enabled', 'paused', 'archived')),
    current_version_id uuid,
    timezone text NOT NULL DEFAULT 'UTC',
    local_delivery_time time without time zone NOT NULL DEFAULT '09:00',
    next_evaluation_at timestamp with time zone,
    immediate_full_match_enabled boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_profiles_due
    ON opportunity.profiles (next_evaluation_at, owner_user_id)
    WHERE status = 'enabled';

CREATE INDEX IF NOT EXISTS idx_opportunity_profiles_owner
    ON opportunity.profiles (owner_user_id, workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS opportunity.profile_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL
        REFERENCES opportunity.profiles(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK (version > 0),
    rule_schema_version text NOT NULL DEFAULT 'opportunity-rules/v1',
    rules jsonb NOT NULL,
    event_subscriptions text[] NOT NULL DEFAULT '{}'::text[],
    calculation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_preset_version_id uuid
        REFERENCES opportunity.preset_versions(id) ON DELETE SET NULL,
    activated_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (profile_id, version)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opportunity_profiles_current_version_fk'
          AND conrelid = 'opportunity.profiles'::regclass
    ) THEN
        ALTER TABLE opportunity.profiles
            ADD CONSTRAINT opportunity_profiles_current_version_fk
            FOREIGN KEY (current_version_id)
            REFERENCES opportunity.profile_versions(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS opportunity.channel_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    profile_id uuid
        REFERENCES opportunity.profiles(id) ON DELETE RESTRICT,
    channel text NOT NULL
        CHECK (channel IN ('website', 'email', 'slack')),
    enabled boolean NOT NULL DEFAULT true,
    quiet_day_behavior text NOT NULL DEFAULT 'skip'
        CHECK (quiet_day_behavior IN ('skip', 'send_empty')),
    max_results integer NOT NULL DEFAULT 10
        CHECK (max_results BETWEEN 1 AND 100),
    immediate_full_match_enabled boolean NOT NULL DEFAULT false,
    destination_ciphertext text,
    destination_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_channel_preferences_scope
    ON opportunity.channel_preferences (
        workspace_id,
        user_id,
        COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
        channel
    );

CREATE TABLE IF NOT EXISTS opportunity.material_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    event_type text NOT NULL,
    signal_family text NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    grouped_window_start timestamp with time zone,
    grouped_window_end timestamp with time zone,
    event_fingerprint text NOT NULL UNIQUE,
    registry_version text NOT NULL,
    classifier_version text NOT NULL,
    materiality numeric(6, 5) NOT NULL
        CHECK (materiality BETWEEN 0 AND 1),
    confidence text NOT NULL
        CHECK (confidence IN ('high', 'directional')),
    reevaluate_eligibility boolean NOT NULL DEFAULT true,
    creates_daily_result boolean NOT NULL DEFAULT false,
    eligible_for_immediate boolean NOT NULL DEFAULT false,
    affected_rule_fields text[] NOT NULL DEFAULT '{}'::text[],
    before_summary jsonb,
    after_summary jsonb,
    raw_event_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
    corroborating_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    contradicting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_material_events_window
    ON opportunity.material_events (observed_at DESC, appid);
CREATE INDEX IF NOT EXISTS idx_opportunity_material_events_app
    ON opportunity.material_events (appid, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_material_events_family
    ON opportunity.material_events (signal_family, observed_at DESC);

CREATE TABLE IF NOT EXISTS opportunity.worker_cursors (
    cursor_key text PRIMARY KEY,
    cursor_value jsonb NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunity.work_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL
        CHECK (kind IN (
            'materialize_events',
            'daily_evaluation',
            'readiness_recheck',
            'immediate_evaluation',
            'refresh_cohort',
            'refresh_preset_health',
            'deliver'
        )),
    lane text NOT NULL DEFAULT 'daily'
        CHECK (lane IN (
            'new_observation',
            'release_transition',
            'profile_readiness',
            'material_change',
            'tracked_game',
            'market_cohort',
            'daily',
            'delivery',
            'reconciliation'
        )),
    workspace_id uuid
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid,
    appid integer
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    profile_id uuid
        REFERENCES opportunity.profiles(id) ON DELETE RESTRICT,
    material_event_id uuid
        REFERENCES opportunity.material_events(id) ON DELETE RESTRICT,
    scheduled_for timestamp with time zone NOT NULL DEFAULT now(),
    priority integer NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN (
            'pending',
            'claimed',
            'retrying',
            'completed',
            'source_blocked',
            'dead_letter'
        )),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key text NOT NULL UNIQUE,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    worker_id text,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 8,
    next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
    last_error_code text,
    last_error_message text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_work_claim
    ON opportunity.work_queue (
        lane,
        priority DESC,
        scheduled_for,
        next_attempt_at,
        id
    )
    WHERE state IN ('pending', 'retrying');

CREATE TABLE IF NOT EXISTS opportunity.runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    run_kind text NOT NULL DEFAULT 'daily'
        CHECK (run_kind IN ('daily', 'immediate', 'manual', 'replay')),
    status text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    source_watermarks jsonb NOT NULL DEFAULT '{}'::jsonb,
    active_profile_versions uuid[] NOT NULL DEFAULT '{}'::uuid[],
    calculation_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
    replay_of_run_id uuid
        REFERENCES opportunity.runs(id) ON DELETE RESTRICT,
    candidate_count integer NOT NULL DEFAULT 0,
    evaluated_count integer NOT NULL DEFAULT 0,
    result_count integer NOT NULL DEFAULT 0,
    pending_count integer NOT NULL DEFAULT 0,
    suppressed_count integer NOT NULL DEFAULT 0,
    duplicate_count integer NOT NULL DEFAULT 0,
    coverage_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    error jsonb,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_runs_user
    ON opportunity.runs (user_id, window_end DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_runs_daily_window
    ON opportunity.runs (workspace_id, user_id, run_kind, window_start, window_end)
    WHERE run_kind = 'daily';

CREATE TABLE IF NOT EXISTS opportunity.cohort_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL
        REFERENCES opportunity.runs(id) ON DELETE RESTRICT,
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    cohort_kind text NOT NULL
        CHECK (cohort_kind IN ('upcoming_readiness', 'released_market')),
    cohort_version text NOT NULL,
    signature jsonb NOT NULL,
    fallback_tier integer NOT NULL CHECK (fallback_tier BETWEEN 1 AND 5),
    member_count integer NOT NULL DEFAULT 0,
    measured_count integer NOT NULL DEFAULT 0,
    coverage numeric(6, 5),
    members jsonb NOT NULL DEFAULT '[]'::jsonb,
    exclusions jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_at timestamp with time zone,
    calculated_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (run_id, appid, cohort_kind)
);

CREATE TABLE IF NOT EXISTS opportunity.market_context_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL
        REFERENCES opportunity.runs(id) ON DELETE RESTRICT,
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    cohort_snapshot_id uuid NOT NULL
        REFERENCES opportunity.cohort_snapshots(id) ON DELETE RESTRICT,
    calculation_version text NOT NULL,
    distributions jsonb NOT NULL,
    demand_direction jsonb NOT NULL,
    supply jsonb NOT NULL,
    concentration jsonb NOT NULL,
    potential_band text NOT NULL
        CHECK (potential_band IN (
            'insufficient_data',
            'limited',
            'developing',
            'meaningful',
            'large_but_competitive'
        )),
    confidence text NOT NULL
        CHECK (confidence IN ('high', 'directional')),
    explanation jsonb NOT NULL,
    source_at timestamp with time zone,
    calculated_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (run_id, appid)
);

CREATE TABLE IF NOT EXISTS opportunity.preset_health_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    preset_id uuid
        REFERENCES opportunity.presets(id) ON DELETE RESTRICT,
    profile_id uuid
        REFERENCES opportunity.profiles(id) ON DELETE RESTRICT,
    as_of_date date NOT NULL,
    health_version text NOT NULL,
    state text NOT NULL
        CHECK (state IN (
            'insufficient_data',
            'quiet',
            'active',
            'growing',
            'surging',
            'cooling'
        )),
    prior_state text,
    consecutive_days integer NOT NULL DEFAULT 1 CHECK (consecutive_days > 0),
    cohort_definition jsonb NOT NULL,
    indicators jsonb NOT NULL,
    coverage jsonb NOT NULL,
    concentration jsonb NOT NULL,
    leading_contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
    explanation jsonb NOT NULL,
    calculated_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CHECK ((preset_id IS NOT NULL) <> (profile_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_preset_health_preset_day
    ON opportunity.preset_health_snapshots (preset_id, as_of_date, health_version)
    WHERE preset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_preset_health_profile_day
    ON opportunity.preset_health_snapshots (profile_id, as_of_date, health_version)
    WHERE profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS opportunity.results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL
        REFERENCES opportunity.runs(id) ON DELETE RESTRICT,
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    material_event_id uuid
        REFERENCES opportunity.material_events(id) ON DELETE RESTRICT,
    event_label text NOT NULL
        CHECK (event_label IN (
            'newly_discovered',
            'newly_released',
            'newly_qualified',
            'materially_changed',
            'tracked_update'
        )),
    event_fingerprint text NOT NULL,
    profile_version_set_fingerprint text NOT NULL,
    rank integer,
    score numeric(7, 4),
    rank_components jsonb NOT NULL,
    rule_evidence jsonb NOT NULL,
    why_now jsonb NOT NULL,
    evidence_summary jsonb NOT NULL,
    source_timestamps jsonb NOT NULL,
    calculation_versions jsonb NOT NULL,
    missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    confidence text NOT NULL
        CHECK (confidence IN ('high', 'directional')),
    cohort_snapshot_id uuid
        REFERENCES opportunity.cohort_snapshots(id) ON DELETE RESTRICT,
    market_context_snapshot_id uuid
        REFERENCES opportunity.market_context_snapshots(id) ON DELETE RESTRICT,
    reappeared_after_result_id uuid
        REFERENCES opportunity.results(id) ON DELETE RESTRICT,
    dismissed_at timestamp with time zone,
    viewed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (run_id, user_id, appid),
    UNIQUE (
        user_id,
        appid,
        event_fingerprint,
        profile_version_set_fingerprint
    )
);

CREATE INDEX IF NOT EXISTS idx_opportunity_results_user_created
    ON opportunity.results (user_id, created_at DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_results_workspace_app
    ON opportunity.results (workspace_id, appid, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity.result_profile_matches (
    result_id uuid NOT NULL
        REFERENCES opportunity.results(id) ON DELETE RESTRICT,
    profile_id uuid NOT NULL
        REFERENCES opportunity.profiles(id) ON DELETE RESTRICT,
    profile_version_id uuid NOT NULL
        REFERENCES opportunity.profile_versions(id) ON DELETE RESTRICT,
    eligibility_outcome text NOT NULL
        CHECK (eligibility_outcome IN ('eligible', 'ineligible', 'pending')),
    rule_outcomes jsonb NOT NULL,
    preference_score numeric(7, 4) NOT NULL DEFAULT 0,
    delivery_urgency text NOT NULL DEFAULT 'daily'
        CHECK (delivery_urgency IN ('website', 'daily', 'immediate')),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (result_id, profile_version_id)
);

CREATE TABLE IF NOT EXISTS opportunity.candidate_state (
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    profile_version_id uuid NOT NULL
        REFERENCES opportunity.profile_versions(id) ON DELETE RESTRICT,
    material_event_id uuid
        REFERENCES opportunity.material_events(id) ON DELETE RESTRICT,
    state text NOT NULL
        CHECK (state IN (
            'pending_readiness',
            'eligible',
            'ineligible',
            'readiness_expired',
            'source_blocked'
        )),
    missing_fields text[] NOT NULL DEFAULT '{}'::text[],
    first_pending_at timestamp with time zone,
    readiness_deadline timestamp with time zone,
    next_evaluation_at timestamp with time zone,
    last_evaluated_at timestamp with time zone,
    last_outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, appid, profile_version_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_candidate_recheck
    ON opportunity.candidate_state (next_evaluation_at, user_id, appid)
    WHERE state = 'pending_readiness';

CREATE TABLE IF NOT EXISTS opportunity.user_game_state (
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    dismissed_event_fingerprint text,
    dismissed_at timestamp with time zone,
    ignored_at timestamp with time zone,
    tracked_at timestamp with time zone,
    tracked_event_families text[] NOT NULL DEFAULT '{}'::text[],
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id, appid)
);

CREATE TABLE IF NOT EXISTS opportunity.team_activity (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    activity_type text NOT NULL
        CHECK (activity_type IN (
            'viewed',
            'researching_started',
            'researching_cleared'
        )),
    note text,
    occurred_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_team_activity_game
    ON opportunity.team_activity (workspace_id, appid, occurred_at DESC);

CREATE TABLE IF NOT EXISTS opportunity.team_research_state (
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    appid integer NOT NULL
        REFERENCES legacy.apps(appid) ON DELETE RESTRICT,
    is_researching boolean NOT NULL DEFAULT true,
    note text,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    cleared_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id, appid)
);

CREATE TABLE IF NOT EXISTS opportunity.deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL
        REFERENCES opportunity.runs(id) ON DELETE RESTRICT,
    workspace_id uuid NOT NULL
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    channel text NOT NULL CHECK (channel IN ('email', 'slack')),
    delivery_kind text NOT NULL
        CHECK (delivery_kind IN ('daily_digest', 'immediate_full_match')),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'claimed',
            'retrying',
            'sent',
            'skipped',
            'dead_letter'
        )),
    result_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    preference_id uuid
        REFERENCES opportunity.channel_preferences(id) ON DELETE RESTRICT,
    rendered_content_version text NOT NULL,
    rendered_payload jsonb NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    scheduled_for timestamp with time zone NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 8,
    next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    worker_id text,
    provider_message_id text,
    last_error_code text,
    last_error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_delivery_claim
    ON opportunity.deliveries (scheduled_for, next_attempt_at, created_at)
    WHERE status IN ('pending', 'retrying');

CREATE TABLE IF NOT EXISTS opportunity.audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id uuid
        REFERENCES opportunity.workspaces(id) ON DELETE RESTRICT,
    actor_user_id uuid,
    action text NOT NULL,
    object_type text NOT NULL,
    object_id text NOT NULL,
    before_state jsonb,
    after_state jsonb,
    request_id text,
    occurred_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_audit_workspace
    ON opportunity.audit_log (workspace_id, occurred_at DESC);

COMMENT ON SCHEMA opportunity IS
    'Transactional Custom Daily Steam Opportunity Brief product domain.';
COMMENT ON TABLE opportunity.results IS
    'Canonical per-user/game/run website results with immutable explanation evidence.';
COMMENT ON TABLE opportunity.deliveries IS
    'Idempotent external-channel outbox projecting canonical website results.';
COMMENT ON TABLE opportunity.user_game_state IS
    'Personal dismiss, ignore, and track state; never shared across users.';
COMMENT ON TABLE opportunity.team_activity IS
    'Workspace-shared viewed and lightweight researching activity only.';
