import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";

import type {
  OpportunityIdentity,
  OpportunityService,
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
  async getBootstrap(received: OpportunityIdentity) {
    return { received };
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
    };

    assert.equal(response.status, 200);
    assert.equal(payload.received.userId, identity.userId);
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
