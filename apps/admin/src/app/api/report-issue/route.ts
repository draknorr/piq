import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { IssueReportInsert as TigerIssueReportInsert } from '@publisheriq/database/tiger-writer';
import { getAuthErrorResponse, requireAuthOrThrow } from '@/lib/auth-utils';
import {
  getDatabaseErrorMessage,
  getTigerRuntimeWriter,
} from '@/lib/tiger-runtime';
import {
  ISSUE_TYPES,
  type IssueReportInsert,
  type IssueType,
  type JsonObject,
  type ReportIssueRequestBody,
  type ReportIssueResponseBody,
} from '@/features/report-issue/types';
import {
  sanitizeNote,
  sanitizeObject,
  sanitizeShortText,
  sanitizeUrl,
} from '@/features/report-issue/sanitizer';
import { captureServerIssueReport } from '@/features/report-issue/sentry-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REPORT_BODY_BYTES = 128 * 1024;

function isIssueType(value: unknown): value is IssueType {
  return typeof value === 'string' && (ISSUE_TYPES as readonly string[]).includes(value);
}

function getJsonObject(value: unknown): JsonObject {
  return sanitizeObject(value);
}

function getObjectField(value: JsonObject, key: string): JsonObject {
  const nested = value[key];
  return typeof nested === 'object' && nested !== null && !Array.isArray(nested)
    ? sanitizeObject(nested)
    : {};
}

function getStringField(value: JsonObject, key: string, maxLength = 512): string | null {
  return sanitizeShortText(value[key], maxLength);
}

function isIssueReportStorageUnavailableError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : null;
  const message = error instanceof Error ? error.message : String(error);

  return (
    code === '42P01' ||
    (message.includes('chat.issue_reports') && message.includes('does not exist')) ||
    message.includes('Missing TIGER_PRIMARY_URL or CHANGE_INTEL_TIGER_URL')
  );
}

function logIssueReportFallback(report: IssueReportInsert, error: unknown): void {
  console.warn(
    'Issue report storage is unavailable; report accepted via fallback logging.',
    sanitizeObject({
      error: error instanceof Error ? error.message : String(error),
      issueType: report.issue_type,
      reportId: report.id,
      routePathname: report.route_pathname,
      sentryServerEventId: report.sentry_server_event_id ?? null,
      userId: report.user_id ?? null,
    })
  );
}

async function readReportBody(request: NextRequest): Promise<ReportIssueRequestBody | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BODY_BYTES) {
    return null;
  }

  return (await request.json()) as ReportIssueRequestBody;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthOrThrow();

    let body: ReportIssueRequestBody | null = null;
    try {
      body = await readReportBody(request);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body) {
      return NextResponse.json({ error: 'Report payload is too large' }, { status: 413 });
    }

    if (!isIssueType(body.issueType)) {
      return NextResponse.json({ error: 'A valid issue type is required' }, { status: 400 });
    }

    const clientContext = getJsonObject(body.clientContext);
    const routeContext = getObjectField(clientContext, 'route');
    const pageContext = getObjectField(clientContext, 'page');
    const browserContext = getObjectField(clientContext, 'browser');
    const appContext = getObjectField(clientContext, 'app');
    const debugContext = getObjectField(clientContext, 'debug');
    const includeChatPreview = body.includeChatPreview === true;
    const chatPreview = includeChatPreview
      ? sanitizeObject(body.chatPreview, {
          maxArrayLength: 8,
          maxDepth: 3,
          maxKeys: 20,
          maxStringLength: 1_000,
        })
      : null;

    const report: IssueReportInsert = {
      app_context: appContext,
      app_environment:
        getStringField(appContext, 'environment', 128) ??
        sanitizeShortText(
          process.env.SENTRY_ENVIRONMENT ??
            process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
            process.env.NODE_ENV,
          128
        ),
      app_release:
        getStringField(appContext, 'release', 256) ??
        sanitizeShortText(
          process.env.SENTRY_RELEASE ??
            process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
            process.env.VERCEL_GIT_COMMIT_SHA,
          256
        ),
      app_version: sanitizeShortText(process.env.NEXT_PUBLIC_APP_VERSION, 128),
      browser_context: browserContext,
      chat_preview: includeChatPreview ? chatPreview : null,
      debug_context: sanitizeObject({
        ...debugContext,
        server: {
          host: sanitizeShortText(request.headers.get('host'), 256),
          receivedAt: new Date().toISOString(),
          referer: sanitizeUrl(request.headers.get('referer')),
          requestId:
            sanitizeShortText(request.headers.get('x-request-id'), 256) ??
            sanitizeShortText(request.headers.get('x-vercel-id'), 256),
          route: '/api/report-issue',
          userAgent: sanitizeShortText(request.headers.get('user-agent'), 1_000),
        },
      }),
      id: randomUUID(),
      include_chat_preview: includeChatPreview,
      issue_type: body.issueType,
      note: sanitizeNote(body.note),
      organization: auth.profile.organization,
      page_context: pageContext,
      route_context: routeContext,
      route_pathname: getStringField(routeContext, 'pathname', 1_000),
      route_url: sanitizeUrl(getStringField(routeContext, 'url', 2_000)),
      status: 'open',
      user_email: auth.profile.email,
      user_id: auth.user.id,
      user_role: auth.profile.role,
    };

    const sentryServerEventId = captureServerIssueReport(report);
    if (sentryServerEventId) {
      report.sentry_server_event_id = sentryServerEventId;
    }

    try {
      const storedReportId = await getTigerRuntimeWriter().issueReports.createIssueReport(
        report as TigerIssueReportInsert
      );
      if (!storedReportId) {
        return NextResponse.json(
          { error: 'Report could not be saved' },
          { status: 500 }
        );
      }
    } catch (error) {
      if (isIssueReportStorageUnavailableError(error)) {
        logIssueReportFallback(report, error);

        const fallbackResponseBody: ReportIssueResponseBody = {
          destination: sentryServerEventId ? 'sentry' : 'server_log',
          reportId: report.id,
          status: 'accepted',
          storageStatus: 'logged',
          ...(sentryServerEventId ? { sentryServerEventId } : {}),
        };

        return NextResponse.json(fallbackResponseBody, { status: 202 });
      }

      console.error('Issue report save error:', error);
      return NextResponse.json({ error: getDatabaseErrorMessage(error) }, { status: 500 });
    }

    const responseBody: ReportIssueResponseBody = {
      destination: 'tiger',
      reportId: report.id,
      status: 'accepted',
      storageStatus: 'persisted',
      ...(sentryServerEventId ? { sentryServerEventId } : {}),
    };

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error) {
    const authErrorResponse = getAuthErrorResponse(error);
    if (authErrorResponse) {
      return authErrorResponse;
    }

    console.error('Issue report POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
