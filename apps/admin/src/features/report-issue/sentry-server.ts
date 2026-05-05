import * as Sentry from '@sentry/nextjs';
import type { IssueReportInsert } from './types';
import { sanitizeObject } from './sanitizer';

export function captureServerIssueReport(report: IssueReportInsert): string | null {
  if (!Sentry.isEnabled?.()) return null;

  try {
    return Sentry.captureMessage(`PublisherIQ issue report: ${report.issue_type}`, {
      level: 'warning',
      tags: {
        issue_type: report.issue_type,
        publisheriq_report_id: report.id,
        route_pathname: report.route_pathname ?? 'unknown',
        source: 'publisheriq-report-issue-api',
      },
      user: report.user_id
        ? {
            email: report.user_email ?? undefined,
            id: report.user_id,
          }
        : undefined,
      contexts: {
        report_issue: {
          reportId: report.id,
          status: report.status,
        },
        route: sanitizeObject(report.route_context),
      },
      extra: sanitizeObject({
        app: report.app_context,
        browser: report.browser_context,
        debug: report.debug_context,
        note: report.note,
        organization: report.organization,
        page: report.page_context,
        role: report.user_role,
      }),
    });
  } catch (error) {
    console.warn('Failed to capture issue report in Sentry', error);
    return null;
  }
}
