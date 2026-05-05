export const ISSUE_TYPES = [
  'Bad chat response',
  'Chat failed or stopped',
  'Missing or weak citation/evidence',
  'Broken filter',
  'Search or result mismatch',
  'Slow page or query',
  'Data failed to load',
  'Incorrect app detail content',
  'Incorrect developer detail content',
  'Incorrect publisher/company content',
  'Change feed or news issue',
  'Alert or notification issue',
  'Pin, compare, or export issue',
  'Auth, access, or account issue',
  'UI bug or layout issue',
  'Mobile/responsive issue',
  'Confusing or suspicious data',
  'Missing data',
  'Other',
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_STATUSES = ['open', 'triaged', 'in_progress', 'resolved', 'wont_fix'] as const;

export type IssueReportStatus = (typeof ISSUE_STATUSES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ReportIssueClientContext {
  app: JsonObject;
  browser: JsonObject;
  debug: JsonObject;
  page: JsonObject;
  route: JsonObject;
}

export interface ReportIssueRequestBody {
  chatPreview?: unknown;
  clientContext?: unknown;
  includeChatPreview?: boolean;
  issueType?: unknown;
  note?: unknown;
}

export interface ReportIssueResponseBody {
  destination?: 'sentry' | 'server_log' | 'tiger';
  reportId: string;
  sentryServerEventId?: string;
  storageStatus?: 'logged' | 'persisted';
  status: 'accepted';
}

export interface ReportIssueSentryPatchBody {
  sentryClientEventId?: unknown;
  sentryFeedbackId?: unknown;
  sentryReplayId?: unknown;
  sentryTraceId?: unknown;
}

export interface IssueReportInsert {
  app_context: JsonObject;
  app_environment?: string | null;
  app_release?: string | null;
  app_version?: string | null;
  browser_context: JsonObject;
  chat_preview?: JsonObject | null;
  debug_context: JsonObject;
  id: string;
  include_chat_preview: boolean;
  issue_type: IssueType;
  note?: string | null;
  organization?: string | null;
  page_context: JsonObject;
  route_context: JsonObject;
  route_pathname?: string | null;
  route_url?: string | null;
  sentry_server_event_id?: string | null;
  status: IssueReportStatus;
  user_email?: string | null;
  user_id?: string | null;
  user_role?: string | null;
}

export interface IssueReportSentryIds {
  sentry_client_event_id?: string | null;
  sentry_feedback_id?: string | null;
  sentry_replay_id?: string | null;
  sentry_server_event_id?: string | null;
  sentry_trace_id?: string | null;
}

export interface RegisteredReportContext {
  context: JsonObject;
  source: string;
}
