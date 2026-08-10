import { NextRequest, NextResponse } from "next/server";

import { getAuthErrorResponse, requireAdminOrThrow } from "@/lib/auth-utils";
import { postToQueryApi } from "@/lib/query-api-client";
import { createServerClient } from "@/lib/supabase/server";

interface TeamMutationRequest {
  email?: string;
  name?: string;
  operation?:
    | "add-member"
    | "archive"
    | "create"
    | "remove-member"
    | "rename"
    | "restore";
  teamId?: string;
  userId?: string;
}

interface OpportunityTeamUserProfile {
  email: string;
  full_name: string | null;
  id: string;
}

async function adminAccessToken(): Promise<string> {
  await requireAdminOrThrow();
  const supabase = await createServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Authenticated admin session token unavailable.");
  }
  return session.access_token;
}

function queryApiFailure(result: {
  errorCode?: string | null;
  httpStatus: number | null;
  reason?: string | null;
}): NextResponse {
  return NextResponse.json(
    {
      code: result.errorCode ?? "OPPORTUNITY_TEAM_API_UNAVAILABLE",
      error: result.reason ?? "Opportunity team service unavailable.",
    },
    { status: result.httpStatus ?? 503 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const accessToken = await adminAccessToken();
    const query = request.nextUrl.searchParams.get("query")?.trim();
    if (query) {
      if (query.length < 2) {
        return NextResponse.json({ users: [] });
      }
      const supabase = await createServerClient();
      const pattern = `%${query}%`;
      const [emailMatches, nameMatches] = await Promise.all([
        supabase
          .from("user_profiles")
          .select("id, email, full_name")
          .ilike("email", pattern)
          .limit(10),
        supabase
          .from("user_profiles")
          .select("id, email, full_name")
          .ilike("full_name", pattern)
          .limit(10),
      ]);
      const error = emailMatches.error ?? nameMatches.error;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const unique = new Map<
        string,
        { email: string; fullName: string | null; id: string }
      >();
      for (const profile of [
        ...((emailMatches.data ?? []) as OpportunityTeamUserProfile[]),
        ...((nameMatches.data ?? []) as OpportunityTeamUserProfile[]),
      ]) {
        unique.set(profile.id, {
          email: profile.email,
          fullName: profile.full_name,
          id: profile.id,
        });
      }
      return NextResponse.json({ users: [...unique.values()].slice(0, 10) });
    }
    const result = await postToQueryApi<unknown>(
      "/v1/opportunities/admin/list-teams",
      {},
      { identityAccessToken: accessToken, timeoutMs: 15_000 },
    );
    if (!result.ok) return queryApiFailure(result);
    return NextResponse.json(result.data ?? []);
  } catch (error) {
    const authError = getAuthErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load teams.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const accessToken = await adminAccessToken();
    const body = (await request.json()) as TeamMutationRequest;
    if (body.operation === "create") {
      const result = await postToQueryApi<unknown>(
        "/v1/opportunities/admin/create-team",
        { name: body.name },
        { identityAccessToken: accessToken, timeoutMs: 15_000 },
      );
      if (!result.ok) return queryApiFailure(result);
      return NextResponse.json(result.data, { status: 201 });
    }

    if (["archive", "rename", "restore"].includes(body.operation ?? "")) {
      const result = await postToQueryApi<unknown>(
        "/v1/opportunities/admin/update-team",
        {
          name: body.operation === "rename" ? body.name : undefined,
          status:
            body.operation === "archive"
              ? "archived"
              : body.operation === "restore"
                ? "active"
                : undefined,
          teamId: body.teamId,
        },
        { identityAccessToken: accessToken, timeoutMs: 15_000 },
      );
      if (!result.ok) return queryApiFailure(result);
      return NextResponse.json(result.data);
    }

    if (body.operation === "add-member") {
      const email = body.email?.trim().toLowerCase();
      if (!email) {
        return NextResponse.json(
          { error: "Email is required." },
          { status: 400 },
        );
      }
      const supabase = await createServerClient();
      const { data: profile, error } = await supabase
        .from("user_profiles")
        .select("id, email, full_name")
        .ilike("email", email)
        .limit(1)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!profile) {
        return NextResponse.json(
          {
            code: "OPPORTUNITY_TEAM_USER_NOT_FOUND",
            error:
              "No PublisherIQ account uses this email. Invite the user first, then add them to the team.",
          },
          { status: 404 },
        );
      }
      const teamProfile = profile as OpportunityTeamUserProfile;
      const result = await postToQueryApi<unknown>(
        "/v1/opportunities/admin/set-team-membership",
        {
          active: true,
          displayName: teamProfile.full_name,
          email: teamProfile.email,
          teamId: body.teamId,
          userId: teamProfile.id,
        },
        { identityAccessToken: accessToken, timeoutMs: 15_000 },
      );
      if (!result.ok) return queryApiFailure(result);
      return NextResponse.json({ ok: true });
    }

    if (body.operation === "remove-member") {
      if (!body.email || !body.userId) {
        return NextResponse.json(
          { error: "Member identity is required." },
          { status: 400 },
        );
      }
      const result = await postToQueryApi<unknown>(
        "/v1/opportunities/admin/set-team-membership",
        {
          active: false,
          displayName: null,
          email: body.email,
          teamId: body.teamId,
          userId: body.userId,
        },
        { identityAccessToken: accessToken, timeoutMs: 15_000 },
      );
      if (!result.ok) return queryApiFailure(result);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "Unsupported team operation." },
      { status: 400 },
    );
  } catch (error) {
    const authError = getAuthErrorResponse(error);
    if (authError) return authError;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update team.",
      },
      { status: 500 },
    );
  }
}
