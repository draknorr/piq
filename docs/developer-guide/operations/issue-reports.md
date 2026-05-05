# Issue Reports

PublisherIQ has a native **Report issue** control mounted in the main app shell. It opens a small dialog, writes a sanitized report to TigerData, and links the report to Sentry events/feedback when Sentry is configured.

## Where Reports Go

Reports are saved first to TigerData in `chat.issue_reports`. This is the canonical exportable record.

When `NEXT_PUBLIC_SENTRY_DSN` is set, the browser also creates a Sentry warning event and Sentry User Feedback linked to the Tiger report id. When `SENTRY_DSN` is set, the API route creates a server-side Sentry event before saving the report. The Tiger row stores the Sentry server event id, browser event id, feedback id, replay id, and trace id when available.

If the TigerData writer is not configured or the `chat.issue_reports` table has not been applied yet, the API accepts the report with a `202` response and logs a sanitized fallback record. With `SENTRY_DSN` configured, that fallback still creates a server-side Sentry event; without Sentry, the only destination is the server log until TigerData storage is configured.

## Captured Metadata

TigerData stores:
- user selected issue type and optional note
- current URL, pathname, route kind, route params, search params, and selected filters inferred from the URL
- page context such as document title and any component-registered report context
- browser context: user agent, language, platform, viewport, screen size, timezone, touch/device hints, and coarse network info where available
- logged-in user id, email, role, and organization from `user_profiles`
- app environment, release, and optional app version
- selected non-sensitive request metadata from the API route: host, referer, user agent, request id, receive timestamp
- Sentry event, feedback, replay, and trace identifiers when available

Sentry stores:
- a warning event tagged with `source=publisheriq-report-issue` and `publisheriq_report_id`
- the issue type, report id, route context, app context, browser context, page context, debug context, and note after the same sanitizer runs
- a Sentry User Feedback item associated with the browser warning event
- a masked Session Replay association when replay sampling captured one

The sanitizer redacts keys and values that look like tokens, cookies, auth headers, API keys, Supabase secrets, JWTs, passwords, service-role credentials, or sessions. Raw cookies, auth headers, API keys, and sensitive payloads are not intentionally collected.

## Screenshots And Replay

The custom PublisherIQ dialog does not attach screenshots. Sentry Session Replay is enabled with privacy-heavy defaults: all text and inputs are masked and media is blocked. If replay sampling is active, the report stores the replay id and asks Sentry feedback to include replay association.

## Configuration

Dashboard runtime variables:

```bash
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=
NEXT_PUBLIC_SENTRY_RELEASE=
NEXT_PUBLIC_APP_VERSION=
SENTRY_TRACES_SAMPLE_RATE=0.1
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.05
NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1.0
```

Build-time source map upload variables:

```bash
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=
```

TigerData must include `packages/data-plane/sql/tiger-bootstrap/0082_issue_reports.sql` for durable storage and SQL export. Do not apply this DDL automatically; apply it through the normal Tiger bootstrap/migration process.

## Export Examples

Recent open reports:

```sql
SELECT
  id,
  created_at,
  status,
  issue_type,
  user_email,
  organization,
  route_pathname,
  note,
  sentry_feedback_id,
  sentry_replay_id
FROM chat.issue_reports
WHERE status = 'open'
ORDER BY created_at DESC
LIMIT 100;
```

Export for triage:

```sql
\copy (
  SELECT
    id,
    created_at,
    status,
    issue_type,
    user_email,
    organization,
    route_url,
    note,
    route_context,
    page_context,
    browser_context,
    debug_context,
    sentry_server_event_id,
    sentry_client_event_id,
    sentry_feedback_id,
    sentry_replay_id,
    sentry_trace_id
  FROM chat.issue_reports
  WHERE created_at >= now() - interval '30 days'
  ORDER BY created_at DESC
) TO 'publisheriq_issue_reports.csv' CSV HEADER;
```

## Adding Page-Specific Context

Client components can register additional safe context without changing the global report dialog:

```tsx
'use client';

import { useReportIssueContext } from '@/features/report-issue';

export function ExampleReportContext({ appId }: { appId: number }) {
  useReportIssueContext('app-detail', { appId, activeTab: 'overview' });
  return null;
}
```

Keep registered context small and sanitized. Do not pass raw API payloads, prompts with secrets, auth state, cookies, request headers, or access tokens.
