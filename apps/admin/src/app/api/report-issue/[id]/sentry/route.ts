import { NextRequest, NextResponse } from 'next/server';
import type { IssueReportSentryIds as TigerIssueReportSentryIds } from '@publisheriq/database/tiger-writer';
import { getAuthErrorResponse, requireAuthOrThrow } from '@/lib/auth-utils';
import {
  getDatabaseErrorMessage,
  getTigerRuntimeWriter,
} from '@/lib/tiger-runtime';
import type {
  IssueReportSentryIds,
  ReportIssueSentryPatchBody,
} from '@/features/report-issue/types';
import { sanitizeShortText } from '@/features/report-issue/sanitizer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasDefinedValue(values: IssueReportSentryIds): boolean {
  return Object.values(values).some((value) => value !== undefined);
}

function assignSentryId(
  target: IssueReportSentryIds,
  targetKey: keyof IssueReportSentryIds,
  source: ReportIssueSentryPatchBody,
  sourceKey: keyof ReportIssueSentryPatchBody
): void {
  if (Object.prototype.hasOwnProperty.call(source, sourceKey)) {
    target[targetKey] = sanitizeShortText(source[sourceKey], 128);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthOrThrow();
    const { id } = await params;

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid report id' }, { status: 400 });
    }

    let body: ReportIssueSentryPatchBody;
    try {
      body = (await request.json()) as ReportIssueSentryPatchBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const sentryIds: IssueReportSentryIds = {};
    assignSentryId(sentryIds, 'sentry_client_event_id', body, 'sentryClientEventId');
    assignSentryId(sentryIds, 'sentry_feedback_id', body, 'sentryFeedbackId');
    assignSentryId(sentryIds, 'sentry_replay_id', body, 'sentryReplayId');
    assignSentryId(sentryIds, 'sentry_trace_id', body, 'sentryTraceId');

    if (!hasDefinedValue(sentryIds)) {
      return NextResponse.json({ error: 'No Sentry metadata supplied' }, { status: 400 });
    }

    try {
      const updated = await getTigerRuntimeWriter().issueReports.attachSentryIds({
        ids: sentryIds as TigerIssueReportSentryIds,
        reportId: id,
        userId: auth.user.id,
      });

      if (updated === 0) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
    } catch (error) {
      console.error('Issue report Sentry metadata update error:', error);
      return NextResponse.json({ error: getDatabaseErrorMessage(error) }, { status: 500 });
    }

    return NextResponse.json({ status: 'updated' });
  } catch (error) {
    const authErrorResponse = getAuthErrorResponse(error);
    if (authErrorResponse) {
      return authErrorResponse;
    }

    console.error('Issue report Sentry PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
