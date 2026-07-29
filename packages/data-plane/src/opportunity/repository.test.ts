import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Pool } from "pg";

import { OpportunityRepository } from "./repository.js";
import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityObservedChange,
  type OpportunityRuleSet,
} from "./types.js";

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

function releaseRules(released: boolean): OpportunityRuleSet {
  return {
    excluded: [],
    preferred: [],
    required: [
      {
        clauses: [
          {
            field: "is_released",
            id: released ? "released" : "unreleased",
            operator: "equals",
            value: released,
          },
        ],
        id: "release",
        label: released ? "Released" : "Upcoming",
        operator: "all",
      },
    ],
    schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
  };
}

describe("opportunity preset health presentation", () => {
  it("marks unreleased presets unsupported in the released-market model", async () => {
    const pool = {
      query: async (): Promise<{ rows: unknown[] }> => ({
        rows: [
          {
            description: "Released",
            health_state: "quiet",
            id: "released",
            name: "Released preset",
            rules: releaseRules(true),
            slug: "released",
            version: 1,
          },
          {
            description: "Upcoming",
            health_state: "insufficient_data",
            id: "upcoming",
            name: "Upcoming preset",
            rules: releaseRules(false),
            slug: "upcoming",
            version: 1,
          },
        ],
      }),
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    const presets = await repository.listPresets();

    assert.deepEqual(
      presets.map((preset) => ({
        healthState: preset.healthState,
        healthUnavailableReason: preset.healthUnavailableReason,
        id: preset.id,
      })),
      [
        {
          healthState: "quiet",
          healthUnavailableReason: null,
          id: "released",
        },
        {
          healthState: null,
          healthUnavailableReason: "unreleased_only",
          id: "upcoming",
        },
      ],
    );
  });

  it("returns only latest non-initial supported transitions with cap metadata", async () => {
    const calls: QueryCall[] = [];
    const pool = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: unknown[] }> => {
        calls.push({ text, values });
        if (text.includes("WITH latest_changes AS")) {
          return {
            rows: [
              {
                as_of_date: new Date("2026-07-28T00:00:00.000Z"),
                evaluated_games: 5_000,
                explanation: ["coverage", "state reason"],
                maximum_evaluated: 5_000,
                name: "Released preset",
                prior_state: "quiet",
                rules: releaseRules(true),
                state: "insufficient_data",
              },
              {
                as_of_date: new Date("2026-07-28T00:00:00.000Z"),
                evaluated_games: 0,
                explanation: ["coverage", "state reason"],
                maximum_evaluated: 5_000,
                name: "Upcoming preset",
                prior_state: "quiet",
                rules: releaseRules(false),
                state: "insufficient_data",
              },
            ],
          };
        }
        if (text.includes("FROM opportunity.runs run")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query in health transition test: ${text}`);
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    const overview = await repository.getLatestDailyOverview(
      "workspace",
      "user",
    );

    assert.deepEqual(overview.presetHealthChanges, [
      {
        asOfDate: "2026-07-28T00:00:00.000Z",
        evaluatedGames: 5_000,
        explanation: [
          "More released games are needed for a reliable market comparison.",
        ],
        maximumEvaluated: 5_000,
        name: "Released preset",
        priorState: "quiet",
        sampleCapped: true,
        state: "insufficient_data",
      },
    ]);
    assert.match(calls[0]?.text ?? "", /DISTINCT ON \(snapshot\.preset_id\)/);
    assert.match(calls[0]?.text ?? "", /snapshot\.prior_state IS NOT NULL/);
    assert.match(
      calls[0]?.text ?? "",
      /snapshot\.state IS DISTINCT FROM snapshot\.prior_state/,
    );
  });
});

describe("opportunity customer response contracts", () => {
  const observedChange: OpportunityObservedChange = {
    affectedRuleFields: ["price_cents"],
    after: [{ price_cents: 1499 }],
    before: [{ price_cents: 1999 }],
    confidence: "high",
    effectiveAt: "2026-07-27T07:30:00.000Z",
    eventType: "business_model_changed",
    observedAt: "2026-07-27T07:31:00.000Z",
    signalFamily: "pricing",
    summary: "Price lowered from $19.99 to $14.99.",
  };

  it("returns exact stored change evidence and preserves a nullable change", async () => {
    let resultQuery = "";
    const pool = {
      query: async (text: string): Promise<{ rows: unknown[] }> => {
        if (text.includes("WITH latest_changes AS")) {
          return { rows: [] };
        }
        if (text.includes("FROM opportunity.runs run")) {
          return {
            rows: [
              {
                completed_at: "2026-07-27T08:01:00.000Z",
                coverage_warnings: [],
                id: "run-1",
                profiles_evaluated: 1,
                result_count: 2,
                run_kind: "daily",
                started_at: "2026-07-27T08:00:00.000Z",
                status: "completed",
                window_end: "2026-07-27T08:00:00.000Z",
                window_start: "2026-07-26T08:00:00.000Z",
              },
            ],
          };
        }
        if (text.includes("FROM opportunity.results result")) {
          resultQuery = text;
          const base = {
            confidence: "high",
            created_at: "2026-07-27T08:00:00.000Z",
            event_label: "materially_changed",
            market_potential: "meaningful",
            matched_profiles: [{ id: "profile-1", name: "Cozy scouting" }],
            name: "Lanterns at Low Tide",
            rank_components: { userFit: 1 },
            score: "82.5",
            strongest_evidence: ["Price changed."],
            why_now: "The price changed.",
          };
          return {
            rows: [
              {
                ...base,
                appid: 424242,
                change: observedChange,
                event_fingerprint: "event-1",
                id: "result-1",
                rank: 1,
              },
              {
                ...base,
                appid: 424243,
                change: null,
                event_fingerprint: "event-2",
                id: "result-2",
                rank: 2,
              },
            ],
          };
        }
        throw new Error(`Unexpected query in result contract test: ${text}`);
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    const overview = await repository.getLatestDailyOverview(
      "workspace-1",
      "user-1",
    );

    assert.deepEqual(
      overview.groups.materiallyChanged.map((result) => result.change),
      [observedChange, null],
    );
    assert.match(resultQuery, /'affectedRuleFields'/);
    assert.match(resultQuery, /material\.before_summary/);
    assert.match(resultQuery, /material\.after_summary/);
  });

  for (const role of ["owner", "admin", "member"] as const) {
    it(`returns workspace role ${role} and reuses the observed-change contract`, async () => {
      let gameRecordQuery = "";
      const recentChange = {
        ...observedChange,
        eventFingerprint: "event-1",
        materiality: 0.9,
        rawEventRefs: [{ source: "storefront" }],
      };
      const pool = {
        query: async (text: string): Promise<{ rows: unknown[] }> => {
          gameRecordQuery = text;
          return {
            rows: [
              {
                app: { appid: 424242, name: "Lanterns at Low Tide" },
                cohort: null,
                current_metrics: {},
                evidence: [],
                market_context: null,
                matched_profiles: [],
                missing_evidence: [],
                official_news: [],
                previous_appearances: [],
                provenance: {},
                rank: {},
                recent_changes: [recentChange],
                result_summary: {
                  appid: 424242,
                  change: observedChange,
                  confidence: "high",
                  createdAt: "2026-07-27T08:00:00.000Z",
                  eventFingerprint: "event-1",
                  eventLabel: "materially_changed",
                  id: "result-1",
                  marketPotential: "meaningful",
                  matchedProfiles: [],
                  name: "Lanterns at Low Tide",
                  rank: 1,
                  rankComponents: {},
                  score: 82.5,
                  strongestEvidence: [],
                  whyNow: "The price changed.",
                },
                team_activity: [],
                user_state: null,
                youtube_evidence: {
                  coverage: "partial",
                  latestSnapshotAt: null,
                  videos: [],
                },
              },
            ],
          };
        },
      } as unknown as Pool;
      const repository = new OpportunityRepository(pool);
      repository.ensureWorkspace = async () => ({
        id: "workspace-1",
        name: "PublisherIQ research",
        role,
      });
      repository.recordTeamActivity = async () => undefined;

      const record = await repository.getGameRecord({
        appid: 424242,
        identity: {
          accessToken: "test-token",
          email: "user@example.com",
          userId: "user-1",
        },
        resultId: "result-1",
      });

      assert.deepEqual(record.workspace, {
        name: "PublisherIQ research",
        role,
      });
      assert.deepEqual(record.result.change, observedChange);
      assert.deepEqual(record.recentChanges, [recentChange]);
      assert.match(gameRecordQuery, /'change', CASE/);
      assert.match(gameRecordQuery, /'affectedRuleFields'/);
    });
  }
});

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
