import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Pool } from "pg";

import { OpportunityRepository } from "./repository.js";
import { compileOpportunityPreview } from "./sql-compiler.js";
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
            game_description: {
              kind: "steam_short",
              sanitizerVersion: "opportunity-description/v99",
              text: "Untrusted contract version.",
            },
            market_potential: "meaningful",
            matched_profiles: [{ id: "profile-1", name: "Cozy scouting" }],
            name: "Lanterns at Low Tide",
            rank_components: { userFit: 1 },
            review_priority: {
              version: "opportunity-ranking/v99",
            },
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
                review_priority: {
                  confidence: {
                    applicableCount: 4,
                    conflictingCount: 0,
                    label: "high",
                    presentCount: 4,
                    reasons: [],
                    score: 1,
                    staleCount: 0,
                    version: "opportunity-confidence/v2",
                  },
                  internalScore: 0.8,
                  lane: "material_change",
                  policy: "monitor_material_changes",
                  priorityBand: "review_now",
                  reasons: ["Material Steam change"],
                  version: "opportunity-ranking/v2",
                  winningProfileId: "profile-1",
                },
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
    assert.equal(
      overview.groups.materiallyChanged[0]?.reviewPriority?.priorityBand,
      "review_now",
    );
    assert.equal(
      overview.groups.materiallyChanged[1]?.reviewPriority,
      null,
    );
    assert.ok(
      overview.groups.materiallyChanged.every(
        (result) => result.gameDescription === null,
      ),
    );
    assert.match(resultQuery, /'affectedRuleFields'/);
    assert.match(resultQuery, /material\.before_summary/);
    assert.match(resultQuery, /material\.after_summary/);
    assert.match(
      resultQuery,
      /raw\.change_type IN \('screenshot_added', 'trailer_added'\)/,
    );
    assert.match(resultQuery, /media\.id = trigger_media\.media_version_id/);
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
          if (text.includes("WITH input_appids AS MATERIALIZED")) {
            return {
              rows: [
                {
                  appid: 424242,
                  app_type: "game",
                  categories: [],
                  developers: [],
                  field_evidence: {
                    genres: {
                      picsRecorded: false,
                      source: "storefront",
                      sourceAt: "2026-07-28T09:00:00.000Z",
                      state: "known",
                      value: ["Strategy"],
                    },
                  },
                  genres: ["Strategy"],
                  has_demo: false,
                  name: "Lanterns at Low Tide",
                  pics_status: "source_blocked",
                  publishers: [],
                  storefront_status: "ready",
                  tags: [],
                },
              ],
            };
          }
          if (text.includes("FROM opportunity.results canonical")) {
            gameRecordQuery = text;
          }
          return {
            rows: [
              {
                app: { appid: 424242, name: "Lanterns at Low Tide" },
                cohort: null,
                current_metrics: {},
                evidence: [],
                market_context: null,
                media: {
                  capturedAt: "2026-07-27T08:00:00.000Z",
                  headerImageUrl: "https://cdn.example.com/header.jpg",
                  screenshots: [],
                  trailers: [
                    {
                      highlight: true,
                      id: 101,
                      mp4Url: null,
                      name: "Trailer",
                      order: 0,
                      thumbnailUrl: "https://cdn.example.com/poster.jpg",
                      webmUrl: null,
                    },
                  ],
                },
                matched_profiles: [],
                missing_evidence: ["genres"],
                official_news: [],
                previous_appearances: [],
                provenance: {
                  run: { windowEnd: "2026-07-27T08:00:00.000Z" },
                  sourceTimestamps: {},
                },
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
      assert.equal(
        record.evidenceResolution.evaluatedAt,
        "2026-07-27T08:00:00.000Z",
      );
      assert.deepEqual(record.missingEvidence, ["genres"]);
      assert.deepEqual(
        record.evidenceResolution.previouslyMissingNowAvailable,
        [
          {
            field: "genres",
            source: "steam_storefront",
            sourceAt: "2026-07-28T09:00:00.000Z",
            value: ["Strategy"],
          },
        ],
      );
      assert.equal(record.media.trailers[0]?.hlsUrl, null);
      assert.match(gameRecordQuery, /'change', CASE/);
      assert.match(gameRecordQuery, /'affectedRuleFields'/);
      assert.match(
        gameRecordQuery,
        /'capturedAt', selected_media\.first_seen_at/,
      );
      assert.match(
        gameRecordQuery,
        /media\.id = trigger_media\.media_version_id/,
      );
    });
  }
});

describe("opportunity field-level Steam evidence resolution", () => {
  it("uses known Storefront fallback while PICS remains source-blocked", async () => {
    let projectionQuery = "";
    const pool = {
      query: async (text: string): Promise<{ rows: unknown[] }> => {
        projectionQuery = text;
        return {
          rows: [
            {
              appid: 5005180,
              app_type: "game",
              catalog_first_observation_kind: "new",
              catalog_first_observed_at: "2026-07-31T08:00:00.000Z",
              catalog_source_at: "2026-07-31T08:00:00.000Z",
              categories: [],
              ccu_change_30d: null,
              ccu_change_7d: null,
              ccu_peak: null,
              content_descriptors: null,
              controller_support: null,
              developer_game_count: null,
              developers: [],
              discount_percent: 0,
              field_evidence: {
                categories: {
                  picsRecorded: false,
                  source: "storefront",
                  sourceAt: "2026-07-31T08:09:12.000Z",
                  state: "known",
                  value: ["Single-player"],
                },
                genres: {
                  picsRecorded: false,
                  source: "storefront",
                  sourceAt: "2026-07-31T08:09:12.000Z",
                  state: "known",
                  value: [],
                },
                platforms: {
                  picsRecorded: false,
                  source: "storefront",
                  sourceAt: "2026-07-31T08:09:12.000Z",
                  state: "missing",
                  value: null,
                },
                tags: {
                  picsRecorded: false,
                  source: "storefront",
                  sourceAt: "2026-07-31T08:10:00.000Z",
                  state: "known",
                  value: ["Action Roguelike", "Strategy"],
                },
              },
              genres: [],
              has_demo: false,
              has_purchase_packages: true,
              is_free: false,
              is_released: false,
              languages: null,
              market_status: "pending",
              name: "Checkmate in 3",
              pics_source_at: "2026-07-31T08:09:30.000Z",
              pics_status: "source_blocked",
              platforms: null,
              positive_percentage: null,
              price_cents: null,
              publisher_game_count: null,
              publishers: [],
              release_date: null,
              release_state: "prerelease",
              reviews_added_30d: null,
              reviews_added_7d: null,
              source_max_metric_date: null,
              steam_deck: null,
              storefront_source_at: "2026-07-31T08:09:12.000Z",
              storefront_status: "ready",
              tags: [],
              total_reviews: null,
            },
          ],
        };
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    const [input] = await repository.getRuleInputsShadow([5005180]);

    assert.equal(input?.fields.genres?.state, "known");
    assert.equal(input?.fields.genres?.source, "steam_storefront");
    assert.deepEqual(input?.fields.genres?.value, []);
    assert.deepEqual(input?.fields.categories?.value, ["Single-player"]);
    assert.equal(input?.fields.platforms?.state, "unknown");
    assert.equal(input?.fields.platforms?.source, "steam_storefront");
    assert.equal(input?.fields.tags?.state, "known");
    assert.equal(input?.fields.tags?.source, "steam_storefront");
    assert.deepEqual(input?.fields.tags?.value, [
      "Action Roguelike",
      "Strategy",
    ]);
    assert.match(
      projectionQuery,
      /CASE evidence\.evidence_state WHEN 'known' THEN 0 ELSE 1 END/,
    );
    assert.match(projectionQuery, /bool_or\(evidence\.source = 'pics'\)/);
  });

  it("retains legacy PICS-ready compatibility until a PICS field row is recorded", async () => {
    const pool = {
      query: async (): Promise<{ rows: unknown[] }> => ({
        rows: [
          {
            appid: 7,
            app_type: "game",
            categories: ["Single-player"],
            developers: [],
            field_evidence: {
              categories: {
                picsRecorded: false,
                source: "storefront",
                state: "missing",
                value: null,
              },
            },
            genres: [],
            has_demo: false,
            name: "Legacy PICS app",
            pics_status: "ready",
            publishers: [],
            storefront_status: "ready",
            tags: [],
          },
        ],
      }),
    } as unknown as Pool;

    const [input] = await new OpportunityRepository(pool).getRuleInputsShadow([
      7,
    ]);

    assert.equal(input?.fields.categories?.state, "known");
    assert.equal(input?.fields.categories?.source, "steam_pics");
    assert.deepEqual(input?.fields.categories?.value, ["Single-player"]);
  });
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

describe("opportunity profile rule-version persistence", () => {
  it("records the v2 schema explicitly when creating an immutable profile version", async () => {
    const calls: QueryCall[] = [];
    const client = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: unknown[] }> => {
        calls.push({ text, values });
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          return { rows: [] };
        }
        if (
          text.includes("FROM opportunity.workspace_memberships membership")
        ) {
          return {
            rows: [{ id: "workspace", name: "Workspace", role: "owner" }],
          };
        }
        if (text.includes("FROM opportunity.profiles profile")) {
          return {
            rows: [
              {
                calculation_config: {},
                source_preset_version_id: null,
                status: "draft",
                version: 1,
              },
            ],
          };
        }
        if (text.includes("INSERT INTO opportunity.profile_versions")) {
          return {
            rows: [
              {
                calculation_config: {},
                created_at: "2026-07-30T18:00:00.000Z",
                event_subscriptions: ["release"],
                id: "version-2",
                profile_id: "profile",
                rules: releaseRules(false),
                version: 2,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: (): void => undefined,
    };
    const pool = {
      connect: async () => client,
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    await repository.saveProfileVersion({
      eventSubscriptions: ["release"],
      identity: {
        accessToken: "token",
        email: "owner@example.com",
        userId: "user",
      },
      immediateFullMatchEnabled: false,
      name: "Upcoming",
      profileId: "profile",
      rules: releaseRules(false),
      timezone: "UTC",
    });

    const insertion = calls.find((call) =>
      call.text.includes("INSERT INTO opportunity.profile_versions"),
    );
    assert.ok(insertion);
    assert.match(insertion.text, /rule_schema_version/);
    assert.equal(
      insertion.values[insertion.values.length - 1],
      OPPORTUNITY_RULE_SCHEMA_VERSION,
    );
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
              app_type: "Game",
              catalog_first_observation_kind: "new",
              catalog_first_observed_at: new Date("2026-07-27T10:00:00.000Z"),
              catalog_source_at: catalogSourceAt,
              categories: [],
              content_descriptors: [],
              developers: [],
              genres: [],
              has_demo: true,
              has_purchase_packages: false,
              is_released: false,
              languages: [],
              market_status: "ready",
              name: "Timestamp Test",
              pics_source_at: picsSourceAt,
              pics_status: "ready",
              platforms: "windows",
              publishers: [],
              release_date: null,
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
              catalog_first_observation_kind: "baseline",
              catalog_first_observed_at: new Date("2026-07-24T00:00:00.000Z"),
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
    assert.equal(inputs[0]?.fields.release_date?.state, "known");
    assert.equal(inputs[0]?.fields.release_date?.value, null);
    assert.equal(inputs[0]?.fields.app_type?.value, "game");
    assert.equal(inputs[0]?.fields.has_demo?.source, "steam_storefront");
    assert.equal(inputs[0]?.fields.demo_only?.value, true);
    assert.equal(
      inputs[0]?.fields.publisheriq_added_at?.value,
      "2026-07-27T10:00:00.000Z",
    );
    assert.equal(inputs[1]?.fields.publisheriq_added_at?.state, "unknown");
    assert.match(
      inputs[1]?.fields.publisheriq_added_at?.reason ?? "",
      /catalog baseline/,
    );

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
    assert.match(calls[0]?.text ?? "", /a\.type IN \('game', 'Game'\)/);
  });
});

describe("opportunity preview query pipeline", () => {
  it("evaluates a lean catalog once and hydrates bounded candidates on one connection", async () => {
    const calls: QueryCall[] = [];
    let releases = 0;
    const client = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: unknown[] }> => {
        calls.push({ text, values });
        if (text.includes("WITH rule_groups AS MATERIALIZED")) {
          return {
            rows: [
              {
                candidate_appids: [42],
                coverage_counts: { demo_only: 100 },
                stage_counts: { demo: 1 },
                total_catalog: 100,
                total_matches: 1,
              },
            ],
          };
        }
        if (text.includes("WITH input_appids AS MATERIALIZED")) {
          return {
            rows: [
              {
                appid: 42,
                app_type: "Game",
                catalog_first_observation_kind: "baseline",
                catalog_first_observed_at: null,
                catalog_source_at: null,
                categories: [],
                content_descriptors: [],
                developers: [],
                genres: [],
                has_demo: true,
                has_purchase_packages: false,
                is_released: false,
                languages: [],
                name: "Demo Candidate",
                pics_status: "ready",
                platforms: [],
                publishers: [],
                release_date: null,
                storefront_status: "ready",
                tags: [],
              },
            ],
          };
        }
        throw new Error(`Unexpected preview query: ${text}`);
      },
      release() {
        releases += 1;
      },
    };
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "demo_only",
              id: "demo-only",
              operator: "equals",
              value: true,
            },
          ],
          id: "demo",
          label: "Only demo available",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    const preview = await repository.getPreviewCatalog(compiled, 80);

    assert.equal(releases, 1);
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.text, /WITH rule_groups AS MATERIALIZED/);
    assert.match(calls[0]!.text, /required_group_0/);
    assert.match(calls[0]!.text, /candidate_metrics/);
    assert.match(calls[0]!.text, /readiness_storefront/);
    assert.doesNotMatch(calls[0]!.text, /app_signal_windows_v1/);
    assert.match(calls[1]!.text, /WITH input_appids AS MATERIALIZED/);
    assert.deepEqual(calls[0]!.values, [true]);
    assert.deepEqual(calls[1]!.values, [[42]]);
    assert.equal(preview.aggregate.totalMatches, 1);
    assert.equal(preview.inputs[0]?.appid, 42);
    assert.equal(preview.inputs[0]?.fields.demo_only?.value, true);
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

describe("opportunity relative-date transitions", () => {
  it("compares current and prior local-day match sets without metric-history scans", async () => {
    const calls: QueryCall[] = [];
    const pool = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: Array<{ appid: number }> }> => {
        calls.push({ text, values });
        return { rows: [{ appid: 10 }, { appid: 20 }] };
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);
    const rules: OpportunityRuleSet = {
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "release_date",
              id: "launch",
              operator: "in_window",
              value: { kind: "relative_window", window: "next_7_days" },
            },
          ],
          id: "launch",
          label: "Upcoming",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    };

    const appids = await repository.getRelativeDateTransitionAppids(
      [{ rules, timezone: "America/Los_Angeles" }],
      "2026-07-30T18:00:00.000Z",
    );

    assert.deepEqual(appids, [10, 20]);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.text, /current_matches AS MATERIALIZED/);
    assert.match(calls[0]!.text, /previous_matches AS MATERIALIZED/);
    assert.match(calls[0]!.text, /FULL OUTER JOIN/);
    assert.match(calls[0]!.text, /a\.type IN \('game', 'Game'\)/);
    assert.doesNotMatch(calls[0]!.text, /legacy\.daily_metrics/);
    assert.equal(calls[0]!.values.length, 4);
  });

  it("does no catalog work for absolute-only profiles", async () => {
    let queries = 0;
    const pool = {
      query: async (): Promise<{ rows: unknown[] }> => {
        queries += 1;
        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);

    const appids = await repository.getRelativeDateTransitionAppids(
      [
        {
          rules: releaseRules(false),
          timezone: "UTC",
        },
      ],
      "2026-07-30T18:00:00.000Z",
    );

    assert.deepEqual(appids, []);
    assert.equal(queries, 0);
  });
});

describe("opportunity Daily Brief repository", () => {
  const identity = {
    accessToken: "token",
    email: "editor@example.com",
    userId: "00000000-0000-0000-0000-000000000001",
  };
  const run = {
    completed_at: "2026-08-03T17:01:00.000Z",
    coverage_warnings: [],
    id: "00000000-0000-0000-0000-000000000010",
    profiles_evaluated: 2,
    result_count: 0,
    run_kind: "daily",
    started_at: "2026-08-03T17:00:00.000Z",
    status: "completed",
    window_end: "2026-08-03T17:00:00.000Z",
    window_start: "2026-08-02T17:00:00.000Z",
  };

  function bypassWorkspace(repository: OpportunityRepository): void {
    const mutable = repository as unknown as {
      ensureWorkspace: () => Promise<{
        id: string;
        name: string;
        role: "owner";
      }>;
      listProfiles: () => Promise<[]>;
    };
    mutable.ensureWorkspace = async () => ({
      id: "00000000-0000-0000-0000-000000000002",
      name: "Editorial",
      role: "owner",
    });
    mutable.listProfiles = async () => [];
  }

  it("uses the latest completed owned run and selects one canonical row per game", async () => {
    const calls: QueryCall[] = [];
    const pool = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rowCount?: number; rows: unknown[] }> => {
        calls.push({ text, values });
        if (text.includes("FROM opportunity.runs run")) {
          return { rows: [run] };
        }
        if (text.includes("COUNT(DISTINCT result.appid) AS result_count")) {
          return {
            rows: [{ high_confidence_count: 0, result_count: 0 }],
          };
        }
        if (text.includes("FROM opportunity.profiles profile")) {
          return { rows: [] };
        }
        if (text.includes("ranked AS MATERIALIZED")) {
          return { rows: [] };
        }
        if (text.includes("FROM opportunity.runs newer")) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected Daily Brief query: ${text}`);
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);
    bypassWorkspace(repository);

    const issue = await repository.getDailyBrief(identity);

    assert.equal(issue.runId, run.id);
    const runCall = calls.find((call) =>
      call.text.includes("FROM opportunity.runs run"),
    );
    assert.match(runCall?.text ?? "", /run\.status = 'completed'/);
    assert.deepEqual(runCall?.values, [
      "00000000-0000-0000-0000-000000000002",
      identity.userId,
    ]);
    const featuredCall = calls.find((call) =>
      call.text.includes("ranked AS MATERIALIZED"),
    );
    assert.match(featuredCall?.text ?? "", /PARTITION BY scoped\.appid/);
    assert.match(
      featuredCall?.text ?? "",
      /scoped\.created_at DESC[\s\S]*scoped\.id/,
    );
    assert.match(featuredCall?.text ?? "", /FROM scoped related/);
  });

  it("returns stable 25-item pages without duplicating the boundary row", async () => {
    const resultRows = Array.from({ length: 26 }, (_, index) => ({
      appid: 100 + index,
      change: null,
      confidence: "high",
      created_at: "2026-08-03T17:00:00.000Z",
      event_fingerprint: `event-${index}`,
      event_label: "newly_qualified",
      header_image_url: null,
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      market_potential: "meaningful",
      matched_profiles: [],
      name: `Game ${index + 1}`,
      rank: index + 1,
      rank_components: {},
      score: 100 - index,
      screenshot_thumbnail_url: null,
      strongest_evidence: [],
      triggered_by_media_addition: false,
      why_now: "Matched.",
    }));
    const pageCalls: QueryCall[] = [];
    const pool = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: unknown[] }> => {
        if (text.includes("FROM opportunity.runs run")) {
          return { rows: [run] };
        }
        if (text.includes("ORDER BY result.score DESC NULLS LAST")) {
          pageCalls.push({ text, values });
          return { rows: values[7] ? [resultRows[25]] : resultRows };
        }
        throw new Error(`Unexpected pagination query: ${text}`);
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);
    bypassWorkspace(repository);

    const first = await repository.listResults(identity, { runId: run.id });
    const second = await repository.listResults(identity, {
      cursor: first.nextCursor,
      runId: run.id,
    });

    assert.equal(first.results.length, 25);
    assert.equal(first.hasMore, true);
    assert.equal(second.results.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(first.results.at(-1)?.appid, 124);
    assert.equal(second.results[0]?.appid, 125);
    assert.equal(pageCalls[1]?.values[8], 76);
    assert.equal(pageCalls[1]?.values[9], 124);
    assert.equal(
      pageCalls[1]?.values[10],
      "00000000-0000-0000-0000-000000000025",
    );
    assert.doesNotMatch(pageCalls[0]?.text ?? "", /LIMIT 500/);
  });

  it("rejects malformed cursors before querying a result page", async () => {
    let resultQueries = 0;
    const pool = {
      query: async (text: string): Promise<{ rows: unknown[] }> => {
        if (text.includes("FROM opportunity.runs run")) {
          return { rows: [run] };
        }
        resultQueries += 1;
        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new OpportunityRepository(pool);
    bypassWorkspace(repository);

    await assert.rejects(
      repository.listResults(identity, {
        cursor: "invalid",
        runId: run.id,
      }),
      /invalid for these filters/,
    );
    assert.equal(resultQueries, 0);
  });
});
