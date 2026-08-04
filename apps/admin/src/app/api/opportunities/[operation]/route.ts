import { NextResponse } from "next/server";

import { postToQueryApi } from "@/lib/query-api-client";
import { createServerClient } from "@/lib/supabase/server";

const ALLOWED_OPERATIONS = new Set([
  "bootstrap",
  "daily-brief",
  "list-results",
  "preview-profile",
  "create-profile",
  "clone-preset",
  "get-profile",
  "save-profile",
  "set-profile-status",
  "game-record",
  "resolve-trailer-streams",
  "game-state",
  "team-activity",
  "configure-channel",
]);

interface RouteContext {
  params: Promise<{ operation: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { operation } = await context.params;
  if (!ALLOWED_OPERATIONS.has(operation)) {
    return NextResponse.json(
      { error: "Opportunity operation not found." },
      { status: 404 },
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json(
      { error: "Authenticated session token unavailable." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const result = await postToQueryApi<unknown>(
    `/v1/opportunities/${operation}`,
    body,
    {
      identityAccessToken: session.access_token,
      timeoutMs: operation === "preview-profile" ? 30_000 : 15_000,
    },
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        code: result.errorCode ?? "OPPORTUNITY_API_UNAVAILABLE",
        error: result.reason ?? "Opportunity service unavailable.",
      },
      { status: result.httpStatus ?? 503 },
    );
  }

  return NextResponse.json(result.data, {
    status:
      operation === "create-profile" || operation === "clone-preset"
        ? 201
        : 200,
  });
}
