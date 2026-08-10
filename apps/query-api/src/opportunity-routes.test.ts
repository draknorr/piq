import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";

import {
  OpportunityNotFoundError,
  type OpportunityIdentity,
  type OpportunityService,
} from "@publisheriq/data-plane";

import {
  SupabaseOpportunityAdminAuthorizer,
  SupabaseOpportunityIdentityVerifier,
  tryHandleOpportunityRequest,
  type OpportunityAdminAuthorizer,
  type OpportunityIdentityVerifier,
} from "./opportunity-routes.js";

const identity: OpportunityIdentity = {
  accessToken: "token",
  email: "user@example.com",
  userId: "00000000-0000-0000-0000-000000000001",
};

const verifier: OpportunityIdentityVerifier = {
  async verify(accessToken) {
    return accessToken === "token" ? identity : null;
  },
};

let recordedTeamActivity: unknown = null;

const service = {
  async getDailyBrief(
    received: OpportunityIdentity,
    request: { runId?: string },
  ) {
    if (request.runId === "00000000-0000-0000-0000-000000000404") {
      throw new OpportunityNotFoundError("Daily Brief not found.");
    }
    return { received, request, type: "daily-brief" };
  },
  async getBootstrap(received: OpportunityIdentity) {
    return {
      received,
      result: {
        changeSummary: "Tags added: Roguelike and Deckbuilding.",
        matchedProfiles: [{ id: "profile", name: "Roguelike Deckbuilder" }],
      },
    };
  },
  async listResults(received: OpportunityIdentity, request: unknown) {
    return { received, request, type: "list-results" };
  },
  async previewProfile(received: OpportunityIdentity, request: unknown) {
    return { received, request };
  },
  async resolveTrailerStreams(received: OpportunityIdentity, request: unknown) {
    return { received, request };
  },
  async recordTeamActivity(received: OpportunityIdentity, request: unknown) {
    recordedTeamActivity = { received, request };
    return { received, request };
  },
} as unknown as OpportunityService;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const handled = await tryHandleOpportunityRequest({
    identityVerifier: verifier,
    opportunityService: service,
    request,
    response,
    url,
  });
  if (!handled) {
    response.writeHead(404).end();
  }
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Test server did not bind.");
}
const baseUrl = `http://127.0.0.1:${address.port}`;

after(async () => {
  server.close();
  await once(server, "close");
});

describe("opportunity query-api routes", () => {
  it("requires a Supabase identity token independently of the service bearer", async () => {
    const response = await fetch(`${baseUrl}/v1/opportunities/bootstrap`, {
      method: "POST",
    });

    assert.equal(response.status, 401);
  });

  it("passes a verified identity to the opportunity service", async () => {
    const response = await fetch(`${baseUrl}/v1/opportunities/bootstrap`, {
      headers: { "x-supabase-access-token": "token" },
      method: "POST",
    });
    const payload = (await response.json()) as {
      received: OpportunityIdentity;
      result: {
        changeSummary: string;
        matchedProfiles: Array<{ id: string; name: string }>;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.received.userId, identity.userId);
    assert.equal(
      payload.result.changeSummary,
      "Tags added: Roguelike and Deckbuilding.",
    );
    assert.equal(
      payload.result.matchedProfiles[0]?.name,
      "Roguelike Deckbuilder",
    );
  });

  it("forwards Daily Brief run selection with the verified identity", async () => {
    const request = { runId: "00000000-0000-0000-0000-000000000010" };
    const response = await fetch(`${baseUrl}/v1/opportunities/daily-brief`, {
      body: JSON.stringify(request),
      headers: {
        "content-type": "application/json",
        "x-supabase-access-token": "token",
      },
      method: "POST",
    });
    const payload = (await response.json()) as {
      received: OpportunityIdentity;
      request: typeof request;
      type: string;
    };

    assert.equal(response.status, 200);
    assert.equal(payload.type, "daily-brief");
    assert.equal(payload.received.userId, identity.userId);
    assert.deepEqual(payload.request, request);
  });

  it("returns not-found for an unavailable owned-run lookup", async () => {
    const response = await fetch(`${baseUrl}/v1/opportunities/daily-brief`, {
      body: JSON.stringify({
        runId: "00000000-0000-0000-0000-000000000404",
      }),
      headers: {
        "content-type": "application/json",
        "x-supabase-access-token": "token",
      },
      method: "POST",
    });
    const payload = (await response.json()) as { code: string };

    assert.equal(response.status, 404);
    assert.equal(payload.code, "OPPORTUNITY_NOT_FOUND");
  });

  it("forwards result cursors and profile filters", async () => {
    const request = {
      cursor: "cursor",
      eventLabel: "newly_qualified",
      profileId: "00000000-0000-0000-0000-000000000020",
      runId: "00000000-0000-0000-0000-000000000010",
    };
    const response = await fetch(`${baseUrl}/v1/opportunities/list-results`, {
      body: JSON.stringify(request),
      headers: {
        "content-type": "application/json",
        "x-supabase-access-token": "token",
      },
      method: "POST",
    });
    const payload = (await response.json()) as {
      request: typeof request;
      type: string;
    };

    assert.equal(response.status, 200);
    assert.equal(payload.type, "list-results");
    assert.deepEqual(payload.request, request);
  });

  it("forwards v2 date operands and the profile timezone unchanged", async () => {
    const request = {
      rules: {
        excluded: [],
        preferred: [],
        required: [
          {
            clauses: [
              {
                field: "publisheriq_added_at",
                id: "recent",
                operator: "in_window",
                value: { kind: "relative_window", window: "last_7_days" },
              },
            ],
            id: "recent",
            label: "Recently added",
            operator: "all",
          },
        ],
        schemaVersion: "opportunity-rules/v2",
      },
      timezone: "America/Los_Angeles",
    };
    const response = await fetch(
      `${baseUrl}/v1/opportunities/preview-profile`,
      {
        body: JSON.stringify(request),
        headers: {
          "content-type": "application/json",
          "x-supabase-access-token": "token",
        },
        method: "POST",
      },
    );
    const payload = (await response.json()) as {
      request: typeof request;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.request, request);
  });

  it("authenticates and forwards bounded trailer stream requests", async () => {
    const request = { appid: 4672300, trailerIds: [257381675] };
    const response = await fetch(
      `${baseUrl}/v1/opportunities/resolve-trailer-streams`,
      {
        body: JSON.stringify(request),
        headers: {
          "content-type": "application/json",
          "x-supabase-access-token": "token",
        },
        method: "POST",
      },
    );
    const payload = (await response.json()) as {
      received: OpportunityIdentity;
      request: typeof request;
    };

    assert.equal(response.status, 200);
    assert.equal(payload.received.userId, identity.userId);
    assert.deepEqual(payload.request, request);
  });

  it("keeps trailer stream resolution authenticated", async () => {
    const response = await fetch(
      `${baseUrl}/v1/opportunities/resolve-trailer-streams`,
      {
        body: JSON.stringify({ appid: 4672300, trailerIds: [257381675] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    assert.equal(response.status, 401);
  });

  it("requires result context when forwarding team activity", async () => {
    const request = {
      activityType: "researching_started",
      appid: 4672300,
      resultId: "00000000-0000-0000-0000-000000000020",
    };
    const response = await fetch(`${baseUrl}/v1/opportunities/team-activity`, {
      body: JSON.stringify(request),
      headers: {
        "content-type": "application/json",
        "x-supabase-access-token": "token",
      },
      method: "POST",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(recordedTeamActivity, { received: identity, request });
  });

  it("rejects team administration for non-admin identities", async () => {
    let listed = false;
    const adminService = {
      async listTeams() {
        listed = true;
        return [];
      },
    } as unknown as OpportunityService;
    const adminAuthorizer: OpportunityAdminAuthorizer = {
      async authorize() {
        return false;
      },
      async findUser() {
        return null;
      },
    };
    const adminServer = createServer(async (request, response) => {
      await tryHandleOpportunityRequest({
        adminAuthorizer,
        identityVerifier: verifier,
        opportunityService: adminService,
        request,
        response,
        url: new URL(request.url ?? "/", "http://localhost"),
      });
    });
    await new Promise<void>((resolve) =>
      adminServer.listen(0, "127.0.0.1", resolve),
    );
    const adminAddress = adminServer.address();
    if (!adminAddress || typeof adminAddress === "string") {
      throw new Error("Admin authorization test server did not bind.");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${adminAddress.port}/v1/opportunities/admin/list-teams`,
        {
          headers: { "x-supabase-access-token": "token" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as { code: string };

      assert.equal(response.status, 403);
      assert.equal(payload.code, "OPPORTUNITY_ADMIN_REQUIRED");
      assert.equal(listed, false);
    } finally {
      adminServer.close();
      await once(adminServer, "close");
    }
  });

  it("allows an admin to list teams through the protected route", async () => {
    const adminService = {
      async listTeams() {
        return [{ id: "team", members: [], name: "Tenon", status: "active" }];
      },
    } as unknown as OpportunityService;
    const adminAuthorizer: OpportunityAdminAuthorizer = {
      async authorize(accessToken, userId) {
        assert.equal(accessToken, "token");
        assert.equal(userId, identity.userId);
        return true;
      },
      async findUser() {
        return null;
      },
    };
    const adminServer = createServer(async (request, response) => {
      await tryHandleOpportunityRequest({
        adminAuthorizer,
        identityVerifier: verifier,
        opportunityService: adminService,
        request,
        response,
        url: new URL(request.url ?? "/", "http://localhost"),
      });
    });
    await new Promise<void>((resolve) =>
      adminServer.listen(0, "127.0.0.1", resolve),
    );
    const adminAddress = adminServer.address();
    if (!adminAddress || typeof adminAddress === "string") {
      throw new Error("Admin team test server did not bind.");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${adminAddress.port}/v1/opportunities/admin/list-teams`,
        {
          headers: { "x-supabase-access-token": "token" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as Array<{ name: string }>;

      assert.equal(response.status, 200);
      assert.equal(payload[0]?.name, "Tenon");
    } finally {
      adminServer.close();
      await once(adminServer, "close");
    }
  });

  it("rejects unknown users before creating a team membership", async () => {
    let membershipChanged = false;
    const adminService = {
      async setTeamMembership() {
        membershipChanged = true;
      },
    } as unknown as OpportunityService;
    const adminAuthorizer: OpportunityAdminAuthorizer = {
      async authorize() {
        return true;
      },
      async findUser() {
        return null;
      },
    };
    const adminServer = createServer(async (request, response) => {
      await tryHandleOpportunityRequest({
        adminAuthorizer,
        identityVerifier: verifier,
        opportunityService: adminService,
        request,
        response,
        url: new URL(request.url ?? "/", "http://localhost"),
      });
    });
    await new Promise<void>((resolve) =>
      adminServer.listen(0, "127.0.0.1", resolve),
    );
    const adminAddress = adminServer.address();
    if (!adminAddress || typeof adminAddress === "string") {
      throw new Error("Unknown team user test server did not bind.");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${adminAddress.port}/v1/opportunities/admin/set-team-membership`,
        {
          body: JSON.stringify({
            active: true,
            email: "unknown@example.com",
            teamId: "00000000-0000-0000-0000-000000000010",
            userId: "00000000-0000-0000-0000-000000000099",
          }),
          headers: {
            "content-type": "application/json",
            "x-supabase-access-token": "token",
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        code: string;
        error: string;
      };

      assert.equal(response.status, 404);
      assert.equal(payload.code, "OPPORTUNITY_TEAM_USER_NOT_FOUND");
      assert.match(payload.error, /Invite the user first/);
      assert.equal(membershipChanged, false);
    } finally {
      adminServer.close();
      await once(adminServer, "close");
    }
  });

  it("returns a bounded error response when Steam resolution fails", async () => {
    const failingService = {
      async resolveTrailerStreams() {
        throw new Error("Steam trailer metadata returned HTTP 503.");
      },
    } as unknown as OpportunityService;
    const failingServer = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      await tryHandleOpportunityRequest({
        identityVerifier: verifier,
        opportunityService: failingService,
        request,
        response,
        url,
      });
    });
    await new Promise<void>((resolve) =>
      failingServer.listen(0, "127.0.0.1", resolve),
    );
    const failingAddress = failingServer.address();
    if (!failingAddress || typeof failingAddress === "string") {
      throw new Error("Trailer failure test server did not bind.");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${failingAddress.port}/v1/opportunities/resolve-trailer-streams`,
        {
          body: JSON.stringify({ appid: 4672300, trailerIds: [257381675] }),
          headers: {
            "content-type": "application/json",
            "x-supabase-access-token": "token",
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        code: string;
        error: string;
      };

      assert.equal(response.status, 400);
      assert.equal(payload.code, "OPPORTUNITY_REQUEST_INVALID");
      assert.match(payload.error, /Steam trailer metadata/);
    } finally {
      failingServer.close();
      await once(failingServer, "close");
    }
  });

  it("reports catalog statement timeouts as gateway timeouts", async () => {
    const timeoutService = {
      async previewProfile() {
        throw Object.assign(
          new Error("canceling statement due to statement timeout"),
          { code: "57014" },
        );
      },
    } as unknown as OpportunityService;
    const timeoutServer = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      await tryHandleOpportunityRequest({
        identityVerifier: verifier,
        opportunityService: timeoutService,
        request,
        response,
        url,
      });
    });
    await new Promise<void>((resolve) =>
      timeoutServer.listen(0, "127.0.0.1", resolve),
    );
    const timeoutAddress = timeoutServer.address();
    if (!timeoutAddress || typeof timeoutAddress === "string") {
      throw new Error("Timeout test server did not bind.");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${timeoutAddress.port}/v1/opportunities/preview-profile`,
        {
          body: JSON.stringify({}),
          headers: {
            "content-type": "application/json",
            "x-supabase-access-token": "token",
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        code: string;
        error: string;
      };

      assert.equal(response.status, 504);
      assert.equal(payload.code, "OPPORTUNITY_QUERY_TIMEOUT");
      assert.match(payload.error, /catalog data/);
    } finally {
      timeoutServer.close();
      await once(timeoutServer, "close");
    }
  });

  it("validates Supabase tokens against the auth user endpoint", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const identityVerifier = new SupabaseOpportunityIdentityVerifier(
      "https://example.supabase.co",
      "anon-key",
      (async (input, init) => {
        calls.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            email: "verified@example.com",
            id: identity.userId,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    );
    const result = await identityVerifier.verify("access-token");

    assert.equal(result?.email, "verified@example.com");
    assert.equal(calls[0]?.input, "https://example.supabase.co/auth/v1/user");
    assert.equal(
      new Headers(calls[0]?.init?.headers).get("authorization"),
      "Bearer access-token",
    );
  });

  it("validates the PublisherIQ admin role through Supabase", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const authorizer = new SupabaseOpportunityAdminAuthorizer(
      "https://example.supabase.co",
      "anon-key",
      (async (input, init) => {
        calls.push({ input: String(input), init });
        return new Response(
          JSON.stringify([
            {
              email: "admin@example.com",
              full_name: "Admin User",
              id: identity.userId,
              role: "admin",
            },
          ]),
          {
            status: 200,
          },
        );
      }) as typeof fetch,
    );

    assert.equal(
      await authorizer.authorize("access-token", identity.userId),
      true,
    );
    const url = new URL(calls[0]!.input);
    assert.equal(url.pathname, "/rest/v1/user_profiles");
    assert.equal(url.searchParams.get("id"), `eq.${identity.userId}`);
    assert.equal(
      new Headers(calls[0]?.init?.headers).get("authorization"),
      "Bearer access-token",
    );
    assert.deepEqual(
      await authorizer.findUser("access-token", identity.userId),
      {
        displayName: "Admin User",
        email: "admin@example.com",
        userId: identity.userId,
      },
    );
  });
});
