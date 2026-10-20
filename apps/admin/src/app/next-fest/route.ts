import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import {
  createNextFestAccessToken,
  getNextFestCookieOptions,
  isNextFestAccessTokenValid,
  isNextFestConfigured,
  isNextFestPasswordValid,
  NEXT_FEST_ACCESS_COOKIE,
} from "./access";
import { renderNextFestGate } from "./gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};

function gate(error: "invalid" | "not-configured" | null): NextResponse {
  return new NextResponse(renderNextFestGate(error), {
    headers: PRIVATE_HEADERS,
    status: error === "not-configured" ? 503 : 200,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isNextFestConfigured()) return gate("not-configured");
  if (!isNextFestAccessTokenValid(request.cookies.get(NEXT_FEST_ACCESS_COOKIE)?.value)) {
    return gate(request.nextUrl.searchParams.get("error") === "invalid" ? "invalid" : null);
  }
  try {
    const html = await readFile(
      path.join(process.cwd(), "src", "app", "next-fest", "content", "atlas.html"),
      "utf8",
    );
    return new NextResponse(html, { headers: PRIVATE_HEADERS });
  } catch {
    return new NextResponse("The atlas is temporarily unavailable.", {
      status: 503,
      headers: PRIVATE_HEADERS,
    });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isNextFestConfigured()) return gate("not-configured");
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Invalid request origin.", { status: 403, headers: PRIVATE_HEADERS });
  }
  if (Number(request.headers.get("content-length")) > 4096) {
    return new NextResponse("Request too large.", { status: 413, headers: PRIVATE_HEADERS });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new NextResponse("Invalid form.", { status: 400, headers: PRIVATE_HEADERS });
  }
  const password = form.get("password");
  if (typeof password !== "string" || password.length > 1024 || !isNextFestPasswordValid(password)) {
    return NextResponse.redirect(new URL("/next-fest?error=invalid", request.url), {
      status: 303,
      headers: PRIVATE_HEADERS,
    });
  }
  const token = createNextFestAccessToken();
  if (!token) return gate("not-configured");
  const response = NextResponse.redirect(new URL("/next-fest", request.url), {
    status: 303,
    headers: PRIVATE_HEADERS,
  });
  response.cookies.set(NEXT_FEST_ACCESS_COOKIE, token, getNextFestCookieOptions());
  return response;
}
