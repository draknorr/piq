import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  areReportsConfigured,
  createReportsAccessToken,
  getReportsCookieOptions,
  REPORTS_ACCESS_COOKIE,
  isReportsPasswordValid,
} from "@/lib/reports/access";
import { buildReportsGateUrl, sanitizeReportsNextPath } from "@/lib/reports/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const password = formData.get("password");
  const nextPath = sanitizeReportsNextPath(formData.get("next"));

  if (!areReportsConfigured()) {
    return NextResponse.redirect(buildReportsGateUrl(request.url, "not-configured", nextPath), 303);
  }

  if (typeof password !== "string" || !isReportsPasswordValid(password)) {
    return NextResponse.redirect(buildReportsGateUrl(request.url, "invalid", nextPath), 303);
  }

  const token = createReportsAccessToken();

  if (!token) {
    return NextResponse.redirect(buildReportsGateUrl(request.url, "not-configured", nextPath), 303);
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set(REPORTS_ACCESS_COOKIE, token, getReportsCookieOptions());

  return response;
}
