'use client';

import * as Sentry from '@sentry/nextjs';
import type { IssueType, ReportIssueClientContext } from './types';
import { sanitizeObject } from './sanitizer';

interface CaptureReportIssueParams {
  clientContext: ReportIssueClientContext;
  issueType: IssueType;
  note: string | null;
  reportId: string;
}

function getReplayId(): string | null {
  try {
    const replay = Sentry.getReplay?.();
    return replay?.getReplayId?.() ?? null;
  } catch {
    return null;
  }
}

function getTraceId(): string | null {
  try {
    const traceData = Sentry.getTraceData?.();
    const sentryTrace = traceData?.['sentry-trace'];
    return typeof sentryTrace === 'string' ? sentryTrace.split('-')[0] ?? null : null;
  } catch {
    return null;
  }
}

async function patchSentryIds(reportId: string, payload: Record<string, string | null>): Promise<void> {
  await fetch(`/api/report-issue/${reportId}/sentry`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function captureReportIssueInSentry({
  clientContext,
  issueType,
  note,
  reportId,
}: CaptureReportIssueParams): Promise<void> {
  if (!Sentry.isEnabled?.()) return;

  try {
    const sentryReplayId = getReplayId();
    const sentryTraceId = getTraceId();
    const eventId = Sentry.captureMessage(`PublisherIQ issue report: ${issueType}`, {
      level: 'warning',
      tags: {
        issue_type: issueType,
        publisheriq_report_id: reportId,
        source: 'publisheriq-report-issue',
      },
      contexts: {
        report_issue: {
          issueType,
          reportId,
          sentryReplayId,
          sentryTraceId,
        },
        route: sanitizeObject(clientContext.route),
      },
      extra: sanitizeObject({
        app: clientContext.app,
        browser: clientContext.browser,
        debug: clientContext.debug,
        note,
        page: clientContext.page,
      }),
    });

    const feedbackId = await Sentry.sendFeedback?.(
      {
        associatedEventId: eventId,
        message: note || issueType,
        source: 'publisheriq-report-issue',
        tags: {
          issue_type: issueType,
          publisheriq_report_id: reportId,
        },
        url: typeof clientContext.route.url === 'string' ? clientContext.route.url : undefined,
      },
      {
        includeReplay: true,
      }
    );

    await patchSentryIds(reportId, {
      sentryClientEventId: eventId ?? null,
      sentryFeedbackId: feedbackId ?? null,
      sentryReplayId,
      sentryTraceId,
    });
  } catch (error) {
    console.warn('Failed to attach Sentry issue report metadata', error);
  }
}
