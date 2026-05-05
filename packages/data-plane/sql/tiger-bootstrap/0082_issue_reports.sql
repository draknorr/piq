CREATE TABLE IF NOT EXISTS chat.issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'triaged', 'in_progress', 'resolved', 'wont_fix')),
  issue_type text NOT NULL,
  note text,
  user_id uuid,
  user_email text,
  user_role text,
  organization text,
  route_url text,
  route_pathname text,
  route_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  browser_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  debug_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  include_chat_preview boolean NOT NULL DEFAULT false,
  chat_preview jsonb,
  sentry_server_event_id text,
  sentry_client_event_id text,
  sentry_feedback_id text,
  sentry_replay_id text,
  sentry_trace_id text,
  app_environment text,
  app_release text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_reports_created_at_idx
  ON chat.issue_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS issue_reports_status_created_at_idx
  ON chat.issue_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS issue_reports_type_created_at_idx
  ON chat.issue_reports (issue_type, created_at DESC);

CREATE INDEX IF NOT EXISTS issue_reports_user_created_at_idx
  ON chat.issue_reports (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS issue_reports_route_created_at_idx
  ON chat.issue_reports (route_pathname, created_at DESC)
  WHERE route_pathname IS NOT NULL;

CREATE INDEX IF NOT EXISTS issue_reports_sentry_feedback_idx
  ON chat.issue_reports (sentry_feedback_id)
  WHERE sentry_feedback_id IS NOT NULL;

COMMENT ON TABLE chat.issue_reports IS
  'User-submitted PublisherIQ product issue reports with sanitized route, browser, page, and Sentry triage metadata.';
