import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type OpportunityIdentity,
  type OpportunityPreviewRequest,
  type OpportunityRuleSet,
  type OpportunityService,
  type OpportunitySignalFamily,
} from "@publisheriq/data-plane";

export interface OpportunityIdentityVerifier {
  verify(accessToken: string): Promise<OpportunityIdentity | null>;
}

interface SupabaseUserPayload {
  email?: unknown;
  id?: unknown;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function accessTokenFromRequest(request: IncomingMessage): string | null {
  const value = request.headers["x-supabase-access-token"];
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}

export class SupabaseOpportunityIdentityVerifier implements OpportunityIdentityVerifier {
  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseAnonKey: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async verify(accessToken: string): Promise<OpportunityIdentity | null> {
    const response = await this.fetchImplementation(
      new URL("/auth/v1/user", this.supabaseUrl),
      {
        headers: {
          apikey: this.supabaseAnonKey,
          authorization: `Bearer ${accessToken}`,
        },
        method: "GET",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as SupabaseUserPayload;
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      return null;
    }
    return {
      accessToken,
      email: typeof payload.email === "string" ? payload.email : null,
      userId: payload.id,
    };
  }
}

export function loadOpportunityIdentityVerifier(
  env: NodeJS.ProcessEnv = process.env,
): OpportunityIdentityVerifier | null {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  return new SupabaseOpportunityIdentityVerifier(supabaseUrl, supabaseAnonKey);
}

function isOpportunityPath(pathname: string): boolean {
  return pathname.startsWith("/v1/opportunities/");
}

function isOpportunityQueryTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "57014" ||
    (typeof candidate.message === "string" &&
      /statement timeout|timeout exceeded when trying to connect/i.test(
        candidate.message,
      ))
  );
}

export async function tryHandleOpportunityRequest(params: {
  identityVerifier: OpportunityIdentityVerifier | null;
  opportunityService: OpportunityService | null;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}): Promise<boolean> {
  if (!isOpportunityPath(params.url.pathname)) {
    return false;
  }
  if (params.request.method !== "POST") {
    sendJson(params.response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!params.opportunityService || !params.identityVerifier) {
    sendJson(params.response, 503, {
      code: "OPPORTUNITY_RUNTIME_UNAVAILABLE",
      error: "Opportunity identity or service configuration is unavailable.",
    });
    return true;
  }

  const accessToken = accessTokenFromRequest(params.request);
  if (!accessToken) {
    sendJson(params.response, 401, {
      error: "Supabase identity token required.",
    });
    return true;
  }
  const identity = await params.identityVerifier.verify(accessToken);
  if (!identity) {
    sendJson(params.response, 401, {
      error: "Supabase identity token is invalid.",
    });
    return true;
  }

  try {
    switch (params.url.pathname) {
      case "/v1/opportunities/bootstrap": {
        sendJson(
          params.response,
          200,
          await params.opportunityService.getBootstrap(identity),
        );
        return true;
      }
      case "/v1/opportunities/preview-profile": {
        const body = await readJsonBody<OpportunityPreviewRequest>(
          params.request,
        );
        sendJson(
          params.response,
          200,
          await params.opportunityService.previewProfile(identity, body),
        );
        return true;
      }
      case "/v1/opportunities/create-profile": {
        const body = await readJsonBody<{
          description?: string | null;
          enabled?: boolean;
          eventSubscriptions: OpportunitySignalFamily[];
          immediateFullMatchEnabled?: boolean;
          localDeliveryTime?: string;
          name: string;
          rules: OpportunityRuleSet;
          sourcePresetVersionId?: string | null;
          timezone: string;
        }>(params.request);
        sendJson(
          params.response,
          201,
          await params.opportunityService.createProfile(identity, body),
        );
        return true;
      }
      case "/v1/opportunities/clone-preset": {
        const body = await readJsonBody<{
          localDeliveryTime?: string;
          name?: string;
          presetId: string;
          timezone: string;
        }>(params.request);
        sendJson(
          params.response,
          201,
          await params.opportunityService.clonePreset(identity, body),
        );
        return true;
      }
      case "/v1/opportunities/get-profile": {
        const body = await readJsonBody<{ profileId: string }>(params.request);
        sendJson(
          params.response,
          200,
          await params.opportunityService.getProfile(identity, body),
        );
        return true;
      }
      case "/v1/opportunities/save-profile": {
        const body = await readJsonBody<{
          description?: string | null;
          eventSubscriptions: OpportunitySignalFamily[];
          immediateFullMatchEnabled: boolean;
          localDeliveryTime?: string;
          name: string;
          profileId: string;
          rules: OpportunityRuleSet;
          timezone: string;
        }>(params.request);
        sendJson(
          params.response,
          200,
          await params.opportunityService.saveProfileVersion(identity, body),
        );
        return true;
      }
      case "/v1/opportunities/set-profile-status": {
        const body = await readJsonBody<{
          profileId: string;
          status: "enabled" | "paused" | "archived";
        }>(params.request);
        await params.opportunityService.setProfileStatus(identity, body);
        sendJson(params.response, 200, { ok: true });
        return true;
      }
      case "/v1/opportunities/game-record": {
        const body = await readJsonBody<{ appid: number; resultId: string }>(
          params.request,
        );
        sendJson(
          params.response,
          200,
          await params.opportunityService.getGameRecord(identity, body),
        );
        return true;
      }
      case "/v1/opportunities/resolve-trailer-streams": {
        const body = await readJsonBody<{
          appid: number;
          trailerIds: number[];
        }>(params.request);
        sendJson(
          params.response,
          200,
          await params.opportunityService.resolveTrailerStreams(identity, body),
        );
        return true;
      }
      case "/v1/opportunities/game-state": {
        const body = await readJsonBody<{
          action: "dismiss" | "ignore" | "restore" | "track" | "untrack";
          appid: number;
          eventFingerprint?: string | null;
        }>(params.request);
        await params.opportunityService.setGameState(identity, body);
        sendJson(params.response, 200, { ok: true });
        return true;
      }
      case "/v1/opportunities/team-activity": {
        const body = await readJsonBody<{
          activityType: "researching_started" | "researching_cleared";
          appid: number;
          note?: string | null;
        }>(params.request);
        await params.opportunityService.recordTeamActivity(identity, body);
        sendJson(params.response, 200, { ok: true });
        return true;
      }
      case "/v1/opportunities/configure-channel": {
        const body = await readJsonBody<{
          channel: "website" | "email" | "slack";
          destination?: string | null;
          enabled: boolean;
          immediateFullMatchEnabled: boolean;
          maxResults: number;
          profileId?: string | null;
          quietDayBehavior: "skip" | "send_empty";
        }>(params.request);
        sendJson(
          params.response,
          200,
          await params.opportunityService.configureChannel(identity, body),
        );
        return true;
      }
      default:
        sendJson(params.response, 404, {
          error: "Opportunity route not found.",
        });
        return true;
    }
  } catch (error) {
    if (isOpportunityQueryTimeout(error)) {
      sendJson(params.response, 504, {
        code: "OPPORTUNITY_QUERY_TIMEOUT",
        error: "Opportunity preview timed out while querying catalog data.",
      });
      return true;
    }
    sendJson(params.response, 400, {
      code: "OPPORTUNITY_REQUEST_INVALID",
      error:
        error instanceof Error ? error.message : "Invalid opportunity request.",
    });
    return true;
  }
}
