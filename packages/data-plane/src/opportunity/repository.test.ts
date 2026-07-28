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

describe("opportunity rule-input provenance", () => {
  it("maps canonical readiness timestamps and preserves missing sources", async () => {
    const catalogSourceAt = new Date("2026-07-27T11:36:16.366Z");
    const storefrontSourceAt = new Date("2026-07-27T11:39:00.832Z");
    const picsSourceAt = new Date("2026-07-27T20:31:16.500Z");
    const metricSourceAt = new Date("2026-07-26T00:00:00.000Z");
    const calls: QueryCall[] = [];
    const pool = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: unknown[] }> => {
        calls.push({ text, values });
        return {
          rows: [
            {
              appid: 42,
              app_type: "game",
              catalog_source_at: catalogSourceAt,
              categories: [],
              content_descriptors: [],
              developers: [],
              genres: [],
              has_demo: true,
              languages: [],
              market_status: "ready",
              name: "Timestamp Test",
              pics_source_at: picsSourceAt,
              pics_status: "ready",
              platforms: "windows",
              publishers: [],
              release_state: "prerelease",
              source_max_metric_date: metricSourceAt,
              storefront_source_at: storefrontSourceAt,
              storefront_status: "ready",
              tags: ["Roguelike"],
              total_reviews: 12,
            },
            {
              appid: 43,
              app_type: "game",
              catalog_source_at: catalogSourceAt,
              categories: [],
              content_descriptors: [],
              developers: [],
              genres: [],
              has_demo: false,
              languages: [],
              market_status: "ready",
              name: "Missing Storefront",
              pics_source_at: picsSourceAt,
              pics_status: "ready",
              platforms: "windows",
              publishers: [],
              source_max_metric_date: metricSourceAt,
              storefront_source_at: null,
              storefront_status: null,
              tags: ["Deckbuilding"],
              total_reviews: 3,
            },
          ],
        };
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    const inputs = await repository.getRuleInputs([42, 43]);

    assert.equal(inputs[0]?.fields.appid?.sourceAt, "2026-07-27T11:36:16.366Z");
    assert.equal(
      inputs[0]?.fields.release_state?.sourceAt,
      "2026-07-27T11:39:00.832Z",
    );
    assert.equal(inputs[0]?.fields.tags?.sourceAt, "2026-07-27T20:31:16.500Z");
    assert.equal(
      inputs[0]?.fields.total_reviews?.sourceAt,
      "2026-07-26T00:00:00.000Z",
    );
    assert.equal(inputs[1]?.fields.release_state?.state, "unknown");
    assert.equal(inputs[1]?.fields.release_state?.sourceAt, null);

    assert.deepEqual(calls[0]?.values, [[42, 43]]);
    assert.match(
      calls[0]?.text ?? "",
      /readiness_catalog\.source_at AS catalog_source_at/,
    );
    assert.match(
      calls[0]?.text ?? "",
      /readiness_storefront\.source_at AS storefront_source_at/,
    );
    assert.match(
      calls[0]?.text ?? "",
      /readiness_pics\.source_at AS pics_source_at/,
    );
    assert.match(calls[0]?.text ?? "", /readiness_catalog\.source = 'catalog'/);
  });
});

describe("opportunity personal game state", () => {
  const cases = [
    {
      action: "dismiss",
      expectedBindCount: 4,
      expectedUpdate: /dismissed_event_fingerprint = \$4/,
    },
    {
      action: "ignore",
      expectedBindCount: 3,
      expectedUpdate: /ignored_at = now\(\)/,
    },
    {
      action: "restore",
      expectedBindCount: 3,
      expectedUpdate: /ignored_at = NULL/,
    },
    {
      action: "track",
      expectedBindCount: 3,
      expectedUpdate: /tracked_at = now\(\)/,
    },
    {
      action: "untrack",
      expectedBindCount: 3,
      expectedUpdate: /tracked_at = NULL/,
    },
  ] as const;

  for (const testCase of cases) {
    it(`binds only referenced parameters for ${testCase.action}`, async () => {
      const workspaceId = "32d4ce66-6344-4a7d-91b1-59d3a5bd405a";
      const userId = "f71d6cd1-38ff-4f16-a3e7-b4c6de0c64ea";
      const appid = 570;
      const eventFingerprint = "event-fingerprint-123";
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
            text.includes("UPDATE opportunity.workspace_memberships") ||
            text.includes("INSERT INTO opportunity.user_game_state") ||
            text.includes("UPDATE opportunity.user_game_state") ||
            text.includes("INSERT INTO opportunity.audit_log")
          ) {
            return { rows: [] };
          }
          if (
            text.includes("FROM opportunity.workspace_memberships membership")
          ) {
            return {
              rows: [
                { id: workspaceId, name: "Test workspace", role: "owner" },
              ],
            };
          }

          throw new Error(
            `Unexpected query in personal game state test: ${text}`,
          );
        },
        release: (): void => undefined,
      };
      const pool = {
        connect: async () => client,
      } as unknown as Pool;
      const repository = new OpportunityRepository(pool);

      await repository.setUserGameState({
        action: testCase.action,
        appid,
        eventFingerprint,
        identity: {
          accessToken: "test-access-token",
          email: "owner@example.com",
          userId,
        },
      });

      const updateCall = calls.find((call) =>
        call.text.includes("UPDATE opportunity.user_game_state"),
      );
      assert.ok(updateCall);
      assert.match(updateCall.text, testCase.expectedUpdate);
      assert.equal(updateCall.values.length, testCase.expectedBindCount);
      assert.deepEqual(
        updateCall.values,
        testCase.action === "dismiss"
          ? [workspaceId, userId, appid, eventFingerprint]
          : [workspaceId, userId, appid],
      );

      const auditCall = calls.find((call) =>
        call.text.includes("'game_state'"),
      );
      assert.ok(auditCall);
      assert.deepEqual(auditCall.values, [
        workspaceId,
        userId,
        `game_state.${testCase.action}`,
        String(appid),
        JSON.stringify({ eventFingerprint }),
      ]);
    });
  }
});
