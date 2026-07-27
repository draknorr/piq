import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Pool } from "pg";

import { OpportunityRepository } from "./repository.js";

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

describe("opportunity workspace provisioning", () => {
  it("binds the audit object id independently from the workspace UUID", async () => {
    const workspaceId = "32d4ce66-6344-4a7d-91b1-59d3a5bd405a";
    const userId = "f71d6cd1-38ff-4f16-a3e7-b4c6de0c64ea";
    const calls: QueryCall[] = [];
    const client = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: unknown[] }> => {
        calls.push({ text, values });

        if (
          text === "BEGIN" ||
          text === "COMMIT" ||
          text === "ROLLBACK" ||
          text.includes("INSERT INTO opportunity.workspaces") ||
          text.includes("INSERT INTO opportunity.workspace_memberships") ||
          text.includes("INSERT INTO opportunity.audit_log")
        ) {
          return { rows: [] };
        }
        if (
          text.includes("FROM opportunity.workspace_memberships membership")
        ) {
          return { rows: [] };
        }
        if (text.includes("FROM opportunity.workspaces")) {
          return { rows: [{ id: workspaceId, name: "Test workspace" }] };
        }
        if (text.includes("SELECT status")) {
          return { rows: [] };
        }

        throw new Error(`Unexpected query in workspace test: ${text}`);
      },
      release: (): void => undefined,
    };
    const pool = {
      connect: async () => client,
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    const workspace = await repository.ensureWorkspace({
      accessToken: "test-access-token",
      email: "owner@example.com",
      userId,
    });

    assert.deepEqual(workspace, {
      id: workspaceId,
      name: "Test workspace",
      role: "owner",
    });
    const auditCall = calls.find((call) =>
      call.text.includes("'workspace.provisioned'"),
    );
    assert.ok(auditCall);
    assert.match(
      auditCall.text,
      /VALUES \(\$1, \$2, 'workspace\.provisioned', 'workspace', \$4, \$3::jsonb\)/,
    );
    assert.doesNotMatch(auditCall.text, /\$1::text/);
    assert.deepEqual(auditCall.values, [
      workspaceId,
      userId,
      JSON.stringify({ role: "owner" }),
      workspaceId,
    ]);
  });
});
