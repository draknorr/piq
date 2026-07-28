import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Pool } from "pg";

import {
  type OpportunityEvaluationInput,
  type OpportunityFieldValue,
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityRuleSet,
} from "./types.js";
import {
  opportunityNumericFieldValue,
  OpportunityWorker,
  resolveOpportunityResultLabel,
  shouldSurfaceOpportunityMatch,
} from "./worker.js";
import type {
  OpportunityEvaluatedResult,
  OpportunityWorkerMaterialEvent,
  OpportunityWorkerProfile,
  OpportunityWorkItem,
} from "./worker-repository.js";
import {
  assignOpportunityDeliveryResults,
  OpportunityWorkerRepository,
} from "./worker-repository.js";

const RULES: OpportunityRuleSet = {
  excluded: [],
  preferred: [],
  required: [
    {
      clauses: [
        {
          field: "is_released",
          id: "released",
          operator: "equals",
          value: false,
        },
      ],
      id: "release",
      label: "Upcoming",
      operator: "all",
    },
  ],
  schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
};

const PROFILE: OpportunityWorkerProfile = {
  eventSubscriptions: ["taxonomy"],
  id: "profile",
  immediateFullMatchEnabled: false,
  name: "Profile",
  rules: RULES,
  versionId: "version",
  versionNumber: 1,
};

function knownField(value: unknown): OpportunityFieldValue {
  return {
    confidence: "high",
    evidenceClass: "observed_fact",
    source: "test",
    sourceAt: "2026-07-27T00:00:00.000Z",
    state: "known",
    value,
  };
}

function unknownField(): OpportunityFieldValue {
  return {
    confidence: "directional",
    evidenceClass: "derived_metric",
    reason: "Metric is unavailable.",
    source: "test",
    sourceAt: null,
    state: "unknown",
    value: null,
  };
}

describe("opportunity numeric evidence", () => {
  it("preserves unknown and null values instead of coercing them to zero", () => {
    const input: OpportunityEvaluationInput = {
      appid: 10,
      fields: {
        ccu_peak: unknownField(),
        reviews_added_7d: knownField(0),
        reviews_added_30d: knownField("12"),
        total_reviews: knownField(""),
      },
      name: "Numeric evidence",
    };

    assert.equal(opportunityNumericFieldValue(input, "ccu_peak"), null);
    assert.equal(opportunityNumericFieldValue(input, "reviews_added_7d"), 0);
    assert.equal(opportunityNumericFieldValue(input, "reviews_added_30d"), 12);
    assert.equal(opportunityNumericFieldValue(input, "total_reviews"), null);
  });
});

describe("opportunity worker materialization recovery", () => {
  it("renews the active queue claim when materialization reports progress", async () => {
    const item: OpportunityWorkItem = {
      appid: null,
      attempts: 1,
      id: 495,
      kind: "materialize_events",
      lane: "material_change",
      materialEventId: null,
      payload: {},
      profileId: null,
      userId: null,
      workspaceId: null,
    };
    const heartbeats: Array<[number, string]> = [];
    const completed: Array<[number, string]> = [];
    const repository = {
      async claimWork(): Promise<OpportunityWorkItem[]> {
        return [item];
      },
      async completeWork(workId: number, workerId: string): Promise<void> {
        completed.push([workId, workerId]);
      },
      async heartbeatWork(workId: number, workerId: string): Promise<void> {
        heartbeats.push([workId, workerId]);
      },
      async materializeEvents(
        onProgress?: () => Promise<void>,
      ): Promise<number> {
        await onProgress?.();
        return 1;
      },
      async scheduleWork(): Promise<number> {
        return 0;
      },
    } as unknown as OpportunityWorkerRepository;
    const worker = new OpportunityWorker(repository, {
      claimLimit: 8,
      websiteBaseUrl: "https://publisheriq.com",
      workerId: "lease-test-worker",
    });

    assert.deepEqual(await worker.runOnce(), { claimed: 1, scheduled: 0 });
    assert.deepEqual(heartbeats, [
      [495, "lease-test-worker"],
      [495, "lease-test-worker"],
    ]);
    assert.deepEqual(completed, [[495, "lease-test-worker"]]);
  });
});

describe("opportunity evaluation recovery", () => {
  it("renews the queue lease during signal refresh and long game loops", async () => {
    const item: OpportunityWorkItem = {
      appid: null,
      attempts: 1,
      id: 496,
      kind: "daily_evaluation",
      lane: "daily",
      materialEventId: null,
      payload: {},
      profileId: null,
      userId: "user",
      workspaceId: "workspace",
    };
    const events = Array.from({ length: 21 }, (_, index) =>
      event({
        appid: index + 1,
        eventFingerprint: `fingerprint-${index + 1}`,
        id: `event-${index + 1}`,
      }),
    );
    const inputs = events.map((candidate) => ({
      appid: candidate.appid,
      fields: {
        is_released: knownField(false),
      },
      name: `Game ${candidate.appid}`,
    }));
    let heartbeatCount = 0;
    let persisted = false;
    const repository = {
      async claimWork(): Promise<OpportunityWorkItem[]> {
        return [item];
      },
      createReleasedCohortCache() {
        return new Map();
      },
      async createRunContext() {
        return {
          id: "run",
          kind: "daily" as const,
          windowEnd: "2026-07-28T16:00:00.000Z",
          windowStart: "2026-07-27T16:00:00.000Z",
        };
      },
      async failRun(): Promise<void> {
        return;
      },
      async failWork(params: { error: string }): Promise<void> {
        throw new Error(params.error);
      },
      async getActiveProfiles(): Promise<OpportunityWorkerProfile[]> {
        return [];
      },
      async getCandidateOutcomes() {
        return new Map();
      },
      async getPriorUserStates() {
        return new Map();
      },
      async getRunMaterialEvents() {
        return events;
      },
      async heartbeatWork(): Promise<void> {
        heartbeatCount += 1;
      },
      async persistRunOutcome(params: {
        evaluations: unknown[];
        results: unknown[];
      }): Promise<void> {
        assert.equal(params.evaluations.length, 0);
        assert.equal(params.results.length, 0);
        persisted = true;
      },
      productRepository: {
        async getRuleInputs(): Promise<OpportunityEvaluationInput[]> {
          return inputs;
        },
      },
      async refreshSignalWindows(
        appids: number[],
        options: { batchSize?: number; onBatch?: () => Promise<void> },
      ): Promise<number> {
        assert.deepEqual(
          appids,
          events.map((candidate) => candidate.appid),
        );
        assert.equal(options.batchSize, 500);
        await options.onBatch?.();
        return appids.length;
      },
      async scheduleWork(): Promise<number> {
        return 0;
      },
    } as unknown as OpportunityWorkerRepository;
    const worker = new OpportunityWorker(repository, {
      websiteBaseUrl: "https://publisheriq.com",
      workerId: "evaluation-lease-test-worker",
    });

    assert.deepEqual(await worker.runOnce(), { claimed: 1, scheduled: 0 });
    assert.equal(heartbeatCount, 7);
    assert.equal(persisted, true);
  });
});

describe("opportunity preset health refresh", () => {
  it("hydrates a bounded released cohort and keeps missing core signals insufficient", async () => {
    const supportedRules: OpportunityRuleSet = {
      ...RULES,
      required: [
        {
          clauses: [
            {
              field: "is_released",
              id: "released",
              operator: "equals",
              value: true,
            },
          ],
          id: "release",
          label: "Released",
          operator: "all",
        },
      ],
    };
    const inputs: OpportunityEvaluationInput[] = Array.from(
      { length: 20 },
      (_, index) => ({
        appid: index + 1,
        fields: {
          ccu_change_30d: unknownField(),
          reviews_added_7d: unknownField(),
          reviews_added_30d: unknownField(),
        },
        name: `Game ${index + 1}`,
      }),
    );
    const item: OpportunityWorkItem = {
      appid: null,
      attempts: 1,
      id: 501,
      kind: "refresh_preset_health",
      lane: "market_cohort",
      materialEventId: null,
      payload: {},
      profileId: null,
      userId: null,
      workspaceId: null,
    };
    type PersistParams = Parameters<
      OpportunityWorkerRepository["persistPresetHealth"]
    >[0];
    const persisted: PersistParams[] = [];
    const refreshCalls: number[][] = [];
    let inputCalls = 0;
    let heartbeatCount = 0;
    const repository = {
      async claimWork(): Promise<OpportunityWorkItem[]> {
        return [item];
      },
      async completeWork(): Promise<void> {
        return;
      },
      async failWork(params: { error: string }): Promise<void> {
        throw new Error(params.error);
      },
      async getPresetHealthTargets() {
        return [
          { id: "supported", rules: supportedRules, slug: "supported" },
          { id: "unreleased", rules: RULES, slug: "unreleased" },
        ];
      },
      async getPriorPresetHealth() {
        return { consecutiveDays: 0, state: null };
      },
      async heartbeatWork(): Promise<void> {
        heartbeatCount += 1;
      },
      async persistPresetHealth(params: PersistParams): Promise<void> {
        persisted.push(params);
      },
      productRepository: {
        async getPresetHealthInputs(): Promise<OpportunityEvaluationInput[]> {
          inputCalls += 1;
          return inputs;
        },
      },
      async refreshSignalWindows(
        appids: number[],
        options: { batchSize?: number; onBatch?: () => Promise<void> },
      ): Promise<number> {
        refreshCalls.push(appids);
        assert.equal(options.batchSize, 500);
        await options.onBatch?.();
        return appids.length;
      },
      async scheduleWork(): Promise<number> {
        return 0;
      },
    } as unknown as OpportunityWorkerRepository;
    const worker = new OpportunityWorker(repository, {
      websiteBaseUrl: "https://publisheriq.com",
      workerId: "health-test-worker",
    });

    assert.deepEqual(await worker.runOnce(), { claimed: 1, scheduled: 0 });
    assert.equal(inputCalls, 2);
    assert.deepEqual(refreshCalls, [inputs.map((input) => input.appid)]);
    assert.ok(heartbeatCount >= 3);
    const persistedHealth = persisted[0];
    assert.ok(persistedHealth);
    assert.equal(persistedHealth.snapshot.measuredGames, 0);
    assert.equal(persistedHealth.snapshot.coverage, 0);
    assert.equal(persistedHealth.snapshot.state, "insufficient_data");
    assert.deepEqual(persistedHealth.cohortDefinition.signalWindowRefresh, {
      fullyRefreshed: true,
      maximumUniqueGamesPerRun: 20_000,
      refreshedGames: 20,
      runUniqueGames: 20,
    });
  });

  it("deduplicates appids and refreshes them in bounded heartbeat batches", async () => {
    const batches: number[][] = [];
    let stalenessChecks = 0;
    let progressCalls = 0;
    const pool = {
      query: async (
        text: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: Array<{ appid: number }> }> => {
        if (text.includes("app_signal_windows_v1 signal")) {
          stalenessChecks += 1;
          assert.match(text, /app_data_readiness readiness/);
          assert.match(text, /readiness\.source = 'market_metrics'/);
          return {
            rows: (values[0] as number[]).map((appid) => ({ appid })),
          };
        }
        assert.match(text, /refresh_app_signal_windows_v1/);
        batches.push(values[0] as number[]);
        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new OpportunityWorkerRepository(pool);
    const appids = [
      ...Array.from({ length: 1_200 }, (_, index) => index + 1),
      1,
      -1,
      0,
    ];

    const refreshed = await repository.refreshSignalWindows(appids, {
      batchSize: 500,
      onBatch: async () => {
        progressCalls += 1;
      },
    });

    assert.deepEqual(
      batches.map((batch) => batch.length),
      [500, 500, 200],
    );
    assert.equal(new Set(batches.flat()).size, 1_200);
    assert.equal(refreshed, 1_200);
    assert.equal(progressCalls, 3);
    assert.equal(stalenessChecks, 1);
  });

  it("does not recompute current signal windows", async () => {
    const queries: string[] = [];
    let progressCalls = 0;
    const pool = {
      query: async (
        text: string,
      ): Promise<{ rows: Array<{ appid: number }> }> => {
        queries.push(text);
        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new OpportunityWorkerRepository(pool);

    const refreshed = await repository.refreshSignalWindows([1, 2, 3], {
      batchSize: 2,
      onBatch: async () => {
        progressCalls += 1;
      },
    });

    assert.equal(queries.length, 1);
    assert.match(queries[0] ?? "", /signal\.as_of_date < CURRENT_DATE - 1/);
    assert.match(
      queries[0] ?? "",
      /signal\.calculation_version IS DISTINCT FROM 'signal-windows\/v1'/,
    );
    assert.match(
      queries[0] ?? "",
      /readiness\.version IS DISTINCT FROM 'signal-windows\/v1'/,
    );
    assert.equal(refreshed, 0);
    assert.equal(progressCalls, 0);
  });
});

describe("released opportunity cohort lookup", () => {
  function cohortRow(appid: number) {
    return {
      appid,
      ccu_peak: appid * 10,
      inclusion_score: 1 - appid / 100,
      metric_date: `2026-07-${String((appid % 27) + 1).padStart(2, "0")}`,
      name: `Peer ${appid}`,
      positive_percentage: 80,
      price_cents: 1_999,
      review_change_30d: appid,
      tag_overlap: 2,
      total_reviews: appid * 100,
    };
  }

  it("reuses an exact run-scoped cohort and excludes each subject game", async () => {
    const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
    const rows = Array.from({ length: 51 }, (_, index) => cohortRow(index + 1));
    const pool = {
      query: async (
        sql: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: typeof rows }> => {
        queries.push({ sql, values });
        return { rows };
      },
    } as unknown as Pool;
    const repository = new OpportunityWorkerRepository(pool);
    const cache = repository.createReleasedCohortCache();
    const firstInput: OpportunityEvaluationInput = {
      appid: 1,
      fields: {
        genres: knownField(["Indie", "Action"]),
        is_free: knownField(false),
        price_cents: knownField(1_999),
        tags: knownField(["Roguelike", "Deckbuilder"]),
      },
      name: "First subject",
    };
    const secondInput: OpportunityEvaluationInput = {
      ...firstInput,
      appid: 2,
      fields: {
        ...firstInput.fields,
        genres: knownField(["action", "indie"]),
        tags: knownField(["deckbuilder", "roguelike"]),
      },
      name: "Second subject",
    };

    const first = await repository.getReleasedCohort(firstInput, cache);
    const second = await repository.getReleasedCohort(secondInput, cache);

    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0]?.values, [
      ["deckbuilder", "roguelike"],
      ["action", "indie"],
      false,
      1_999,
    ]);
    assert.match(queries[0]?.sql ?? "", /tag_matches AS MATERIALIZED/);
    assert.match(queries[0]?.sql ?? "", /genre_matches AS MATERIALIZED/);
    assert.match(queries[0]?.sql ?? "", /LIMIT 51/);
    assert.doesNotMatch(
      queries[0]?.sql ?? "",
      /\(\s*SELECT COUNT\(1\)[\s\S]*?overlap_tag/,
    );
    assert.equal(first.members.length, 50);
    assert.deepEqual(
      first.members.map((member) => member.appid),
      Array.from({ length: 50 }, (_, index) => index + 2),
    );
    assert.equal(second.members.length, 50);
    assert.deepEqual(
      second.members.map((member) => member.appid),
      [1, ...Array.from({ length: 49 }, (_, index) => index + 3)],
    );
    assert.deepEqual(first.signature.tags, ["Roguelike", "Deckbuilder"]);
    assert.deepEqual(second.signature.tags, ["deckbuilder", "roguelike"]);
  });

  it("retries only the timed-out cohort lookup once", async () => {
    let calls = 0;
    const pool = {
      query: async (): Promise<{ rows: ReturnType<typeof cohortRow>[] }> => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(
            new Error("canceling statement due to statement timeout"),
            { code: "57014" },
          );
        }
        return { rows: [cohortRow(2)] };
      },
    } as unknown as Pool;
    const repository = new OpportunityWorkerRepository(pool);

    const cohort = await repository.getReleasedCohort({
      appid: 1,
      fields: {
        is_free: knownField(false),
      },
      name: "Retry subject",
    });

    assert.equal(calls, 2);
    assert.deepEqual(
      cohort.members.map((member) => member.appid),
      [2],
    );
  });
});

function event(
  values: Partial<OpportunityWorkerMaterialEvent> = {},
): OpportunityWorkerMaterialEvent {
  return {
    appid: 10,
    createsDailyResult: true,
    effectiveAt: "2026-07-27T00:00:00.000Z",
    eligibleForImmediate: false,
    eventFingerprint: "fingerprint",
    eventType: "taxonomy_repositioned",
    id: "event",
    materiality: 0.75,
    observedAt: "2026-07-27T00:00:00.000Z",
    reevaluateEligibility: true,
    signalFamily: "taxonomy",
    ...values,
  };
}

describe("opportunity worker event policy", () => {
  it("surfaces a first qualification even when the event is not subscribed", () => {
    assert.equal(
      shouldSurfaceOpportunityMatch({
        event: event({ signalFamily: "pricing" }),
        immediateRun: false,
        priorOutcome: "ineligible",
        profile: PROFILE,
        tracked: false,
      }),
      true,
    );
  });

  it("requires a subscribed material event for an existing eligible match", () => {
    assert.equal(
      shouldSurfaceOpportunityMatch({
        event: event({ signalFamily: "pricing" }),
        immediateRun: false,
        priorOutcome: "eligible",
        profile: PROFILE,
        tracked: false,
      }),
      false,
    );
    assert.equal(
      shouldSurfaceOpportunityMatch({
        event: event(),
        immediateRun: false,
        priorOutcome: "eligible",
        profile: PROFILE,
        tracked: false,
      }),
      true,
    );
  });

  it("limits immediate delivery to opted-in first observations", () => {
    const immediateProfile = {
      ...PROFILE,
      immediateFullMatchEnabled: true,
    };
    assert.equal(
      shouldSurfaceOpportunityMatch({
        event: event({
          eligibleForImmediate: true,
          eventType: "first_observed",
          signalFamily: "release",
        }),
        immediateRun: true,
        priorOutcome: undefined,
        profile: immediateProfile,
        tracked: false,
      }),
      true,
    );
    assert.equal(
      shouldSurfaceOpportunityMatch({
        event: event({ eventType: "review_breakthrough" }),
        immediateRun: true,
        priorOutcome: "eligible",
        profile: immediateProfile,
        tracked: true,
      }),
      false,
    );
  });

  it("labels a delayed first-observation qualification as newly qualified", () => {
    assert.equal(
      resolveOpportunityResultLabel({
        event: event({
          eventType: "first_observed",
          observedAt: "2026-07-27T01:30:30.000Z",
          signalFamily: "release",
        }),
        matches: [
          {
            evaluation: {
              excluded: false,
              excludedOutcomes: [],
              missingRequiredFields: [],
              outcome: "eligible",
              preferenceContribution: 0,
              preferredOutcomes: [],
              requiredOutcomes: [],
            },
            priorOutcome: "pending",
          },
        ],
        runWindowEnd: "2026-07-27T01:31:00.000Z",
        runWindowStart: "2026-07-27T01:30:00.000Z",
        tracked: false,
      }),
      "newly_qualified",
    );
  });

  it("preserves new-discovery and new-release labels inside the run window", () => {
    const matches = [
      {
        evaluation: {
          excluded: false,
          excludedOutcomes: [],
          missingRequiredFields: [],
          outcome: "eligible" as const,
          preferenceContribution: 0,
          preferredOutcomes: [],
          requiredOutcomes: [],
        },
        priorOutcome: undefined,
      },
    ];
    const common = {
      matches,
      runWindowEnd: "2026-07-27T00:30:00.000Z",
      runWindowStart: "2026-07-27T00:00:00.000Z",
      tracked: false,
    };
    assert.equal(
      resolveOpportunityResultLabel({
        ...common,
        event: event({
          eventType: "first_observed",
          observedAt: "2026-07-27T00:10:00.000Z",
        }),
      }),
      "newly_discovered",
    );
    assert.equal(
      resolveOpportunityResultLabel({
        ...common,
        event: event({
          eventType: "released",
          observedAt: "2026-07-27T00:10:00.000Z",
        }),
      }),
      "newly_released",
    );
  });
});

describe("opportunity worker result provenance", () => {
  it("aggregates non-null source timestamps from evaluated evidence", async () => {
    const repository = {
      async getReleasedCohort(): Promise<{
        confidence: "directional";
        coverage: number;
        fallbackTier: 5;
        members: [];
        signature: Record<string, unknown>;
        sourceAt: null;
      }> {
        return {
          confidence: "directional",
          coverage: 0,
          fallbackTier: 5,
          members: [],
          signature: {},
          sourceAt: null,
        };
      },
    } as unknown as OpportunityWorkerRepository;
    const worker = new OpportunityWorker(repository, {
      websiteBaseUrl: "https://publisheriq.com",
      workerId: "provenance-test-worker",
    });
    const input: OpportunityEvaluationInput = {
      appid: 42,
      fields: {
        appid: {
          confidence: "high",
          evidenceClass: "observed_fact",
          source: "legacy.apps",
          sourceAt: "2026-07-27T11:36:16.366Z",
          state: "known",
          value: 42,
        },
        is_released: {
          confidence: "high",
          evidenceClass: "observed_fact",
          source: "steam_storefront",
          sourceAt: "2026-07-27T11:39:00.832Z",
          state: "known",
          value: false,
        },
        tags: {
          confidence: "high",
          evidenceClass: "observed_fact",
          source: "steam_pics",
          sourceAt: "2026-07-27T20:31:16.500Z",
          state: "known",
          value: ["Roguelike"],
        },
      },
      name: "Timestamp Test",
    };
    const evaluateGame = (
      worker as unknown as {
        evaluateGame(context: {
          appid: number;
          candidateOutcomes: Map<
            string,
            "eligible" | "ineligible" | "pending" | "expired"
          >;
          event: OpportunityWorkerMaterialEvent;
          input: OpportunityEvaluationInput;
          priorState: {
            dismissedEventFingerprint: null;
            ignored: false;
            priorEventFingerprints: Set<string>;
            priorResultId: null;
            tracked: false;
          };
          profiles: OpportunityWorkerProfile[];
          run: {
            id: string;
            kind: "daily";
            windowEnd: string;
            windowStart: string;
          };
        }): Promise<{
          result: OpportunityEvaluatedResult | null;
        }>;
      }
    ).evaluateGame.bind(worker);

    const outcome = await evaluateGame({
      appid: 42,
      candidateOutcomes: new Map(),
      event: event({
        appid: 42,
        observedAt: "2026-07-27T21:00:00.000Z",
      }),
      input,
      priorState: {
        dismissedEventFingerprint: null,
        ignored: false,
        priorEventFingerprints: new Set(),
        priorResultId: null,
        tracked: false,
      },
      profiles: [PROFILE],
      run: {
        id: "run",
        kind: "daily",
        windowEnd: "2026-07-27T22:00:00.000Z",
        windowStart: "2026-07-27T20:00:00.000Z",
      },
    });

    assert.ok(outcome.result);
    assert.equal(
      outcome.result.sourceTimestamps["legacy.apps"],
      "2026-07-27T11:36:16.366Z",
    );
    assert.equal(
      outcome.result.sourceTimestamps.steam_storefront,
      "2026-07-27T11:39:00.832Z",
    );
    assert.equal(
      outcome.result.sourceTimestamps.steam_pics,
      "2026-07-27T20:31:16.500Z",
    );
  });

  it("uses the neutral peer percentile when reviews and CCU are unknown", async () => {
    const repository = {
      async getReleasedCohort() {
        return {
          confidence: "high" as const,
          coverage: 1,
          fallbackTier: 1 as const,
          members: [
            {
              appid: 101,
              ccuPeak: 25,
              inclusionReasons: ["shared genre"],
              inclusionScore: 0.8,
              name: "Peer one",
              positivePercentage: 90,
              priceCents: 1_000,
              reviewsAdded30d: 10,
              totalReviews: 100,
            },
            {
              appid: 102,
              ccuPeak: 50,
              inclusionReasons: ["shared genre"],
              inclusionScore: 0.7,
              name: "Peer two",
              positivePercentage: 85,
              priceCents: 1_000,
              reviewsAdded30d: 20,
              totalReviews: 200,
            },
          ],
          signature: {},
          sourceAt: "2026-07-27T00:00:00.000Z",
        };
      },
    } as unknown as OpportunityWorkerRepository;
    const worker = new OpportunityWorker(repository, {
      websiteBaseUrl: "https://publisheriq.com",
      workerId: "ranking-test-worker",
    });
    const evaluateGame = (
      worker as unknown as {
        evaluateGame(context: {
          appid: number;
          candidateOutcomes: Map<
            string,
            "eligible" | "ineligible" | "pending" | "expired"
          >;
          event: OpportunityWorkerMaterialEvent;
          input: OpportunityEvaluationInput;
          priorState: {
            dismissedEventFingerprint: null;
            ignored: false;
            priorEventFingerprints: Set<string>;
            priorResultId: null;
            tracked: false;
          };
          profiles: OpportunityWorkerProfile[];
          run: {
            id: string;
            kind: "daily";
            windowEnd: string;
            windowStart: string;
          };
        }): Promise<{
          result: OpportunityEvaluatedResult | null;
        }>;
      }
    ).evaluateGame.bind(worker);

    const outcome = await evaluateGame({
      appid: 42,
      candidateOutcomes: new Map(),
      event: event({ appid: 42 }),
      input: {
        appid: 42,
        fields: {
          ccu_peak: unknownField(),
          is_released: knownField(false),
          total_reviews: unknownField(),
        },
        name: "Unknown market position",
      },
      priorState: {
        dismissedEventFingerprint: null,
        ignored: false,
        priorEventFingerprints: new Set(),
        priorResultId: null,
        tracked: false,
      },
      profiles: [PROFILE],
      run: {
        id: "run",
        kind: "daily",
        windowEnd: "2026-07-27T01:00:00.000Z",
        windowStart: "2026-07-27T00:00:00.000Z",
      },
    });

    assert.ok(outcome.result);
    assert.equal(outcome.result.rank.components.peerPosition, 0.5);
  });
});

describe("opportunity delivery preference scoping", () => {
  it("applies profile-specific preferences before the user-wide fallback", () => {
    const assignments = assignOpportunityDeliveryResults(
      [
        { id: "one", profileIds: ["profile-a", "profile-b"] },
        { id: "two", profileIds: ["profile-b"] },
        { id: "three", profileIds: ["profile-c"] },
      ],
      [
        {
          channel: "email",
          id: "profile-email",
          maxResults: 10,
          profileId: "profile-a",
        },
        {
          channel: "email",
          id: "global-email",
          maxResults: 10,
          profileId: null,
        },
      ],
    );

    assert.deepEqual(assignments.get("profile-email"), {
      availableResultCount: 1,
      resultIds: ["one"],
    });
    assert.deepEqual(assignments.get("global-email"), {
      availableResultCount: 2,
      resultIds: ["two", "three"],
    });
  });

  it("deduplicates within each channel but preserves cross-channel delivery", () => {
    const assignments = assignOpportunityDeliveryResults(
      [{ id: "one", profileIds: ["profile-a"] }],
      [
        {
          channel: "email",
          id: "email-a",
          maxResults: 10,
          profileId: "profile-a",
        },
        {
          channel: "email",
          id: "email-global",
          maxResults: 10,
          profileId: null,
        },
        {
          channel: "slack",
          id: "slack-global",
          maxResults: 10,
          profileId: null,
        },
      ],
    );

    assert.deepEqual(assignments.get("email-a"), {
      availableResultCount: 1,
      resultIds: ["one"],
    });
    assert.deepEqual(assignments.get("email-global"), {
      availableResultCount: 0,
      resultIds: [],
    });
    assert.deepEqual(assignments.get("slack-global"), {
      availableResultCount: 1,
      resultIds: ["one"],
    });
  });

  it("reports the pre-limit result count for truncation notices", () => {
    const assignments = assignOpportunityDeliveryResults(
      [
        { id: "one", profileIds: ["profile-a"] },
        { id: "two", profileIds: ["profile-a"] },
      ],
      [
        {
          channel: "email",
          id: "email",
          maxResults: 1,
          profileId: "profile-a",
        },
        {
          channel: "email",
          id: "global",
          maxResults: 10,
          profileId: null,
        },
      ],
    );

    assert.deepEqual(assignments.get("email"), {
      availableResultCount: 2,
      resultIds: ["one"],
    });
    assert.deepEqual(assignments.get("global"), {
      availableResultCount: 0,
      resultIds: [],
    });
  });
});
