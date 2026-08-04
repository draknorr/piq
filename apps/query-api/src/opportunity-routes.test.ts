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
  SupabaseOpportunityIdentityVerifier,
  tryHandleOpportunityRequest,
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
});
