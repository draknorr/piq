import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  areReportsConfigured,
  isReportsAccessTokenValid,
  REPORTS_ACCESS_COOKIE,
} from "@/lib/reports/access";
import { getPublishedReport } from "@/lib/reports/manifest";
import { buildReportsGateUrl } from "@/lib/reports/navigation";
import { readReportHtml } from "@/lib/reports/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReportRouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, context: ReportRouteContext): Promise<NextResponse> {
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  if (!areReportsConfigured()) {
    return NextResponse.redirect(buildReportsGateUrl(request.url, "not-configured", nextPath));
  }

  const accessToken = request.cookies.get(REPORTS_ACCESS_COOKIE)?.value;

  if (!isReportsAccessTokenValid(accessToken)) {
    return NextResponse.redirect(buildReportsGateUrl(request.url, null, nextPath));
  }

  const { slug } = await context.params;
  const report = getPublishedReport(slug);

  if (!report) {
    return new NextResponse("Report not found", { status: 404 });
  }

  try {
    const html = await readReportHtml(report);

    return new NextResponse(html, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error("[reports] failed to read report html", {
      slug: report.slug,
      error,
    });

    return new NextResponse("Report unavailable", { status: 500 });
  }
}
