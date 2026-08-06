import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  renderOpportunityDelivery,
  type OpportunityDeliveryWork,
} from "./delivery.js";
import type {
  OpportunityEvaluationInput,
  OpportunityFieldValue,
  OpportunityRuleSet,
} from "./types.js";
import { OPPORTUNITY_RULE_SCHEMA_VERSION } from "./types.js";
import { OpportunityWorker } from "./worker.js";
import type {
  OpportunityEvaluatedResult,
  OpportunityWorkerMaterialEvent,
  OpportunityWorkerProfile,
  OpportunityWorkerRepository,
} from "./worker-repository.js";

function known(value: unknown): OpportunityFieldValue {
  return {
    confidence: "high",
    evidenceClass: "observed_fact",
    source: "report-generation-test",
    sourceAt: "2026-07-30T12:00:00.000Z",
    state: "known",
    value,
  };
}

function profile(
  id: string,
  label: string,
  rules: OpportunityRuleSet,
): OpportunityWorkerProfile {
  return {
    eventSubscriptions: ["release"],
    id,
    immediateFullMatchEnabled: false,
    name: label,
    rules,
    timezone: "America/Los_Angeles",
    versionId: `${id}-version`,
    versionNumber: 1,
  };
}

function materialEvent(
  appid: number,
  summary: string,
): OpportunityWorkerMaterialEvent {
  return {
    affectedRuleFields: [
      "demo_only",
      "is_released",
      "publisheriq_added_at",
      "release_date",
    ],
    appid,
    confidence: "high",
    createsDailyResult: true,
    effectiveAt: "2026-07-30T17:00:00.000Z",
    eligibleForImmediate: false,
    eventFingerprint: `report-${appid}`,
    eventType: "date_window_changed",
    id: null,
    materiality: 0.9,
    observedAt: "2026-07-30T17:00:00.000Z",
    reevaluateEligibility: true,
    signalFamily: "release",
    summary,
  };
}

describe("opportunity option-enabled report generation", () => {
  it("evaluates and renders date, demo-only, undated, and discount reports", async () => {
    const cases: Array<{
      evidenceLabel: string;
      input: OpportunityEvaluationInput;
      profile: OpportunityWorkerProfile;
    }> = [
      {
        evidenceLabel: "Only demo available",
        input: {
          appid: 101,
          fields: { demo_only: known(true) },
          name: "Demo Horizon",
        },
        profile: profile("demo", "Only Demo", {
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
              id: "demo-only-group",
              label: "Only demo available",
              operator: "all",
            },
          ],
          schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
        }),
      },
      {
        evidenceLabel: "Added in the last 30 days",
        input: {
          appid: 102,
          fields: {
            publisheriq_added_at: known("2026-07-20T19:00:00.000Z"),
          },
          name: "Recent Signal",
        },
        profile: profile("added", "Recently Added", {
          excluded: [],
          preferred: [],
          required: [
            {
              clauses: [
                {
                  field: "publisheriq_added_at",
                  id: "recent",
                  operator: "in_window",
                  value: {
                    kind: "relative_window",
                    window: "last_30_days",
                  },
                },
              ],
              id: "recent-group",
              label: "Added in the last 30 days",
              operator: "all",
            },
          ],
          schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
        }),
      },
      {
        evidenceLabel: "Unreleased date TBD",
        input: {
          appid: 103,
          fields: {
            is_released: known(false),
            release_date: known(null),
          },
          name: "Unscheduled Launch",
        },
        profile: profile("undated", "Unreleased Date TBD", {
          excluded: [],
          preferred: [],
          required: [
            {
              clauses: [
                {
                  field: "is_released",
                  id: "unreleased",
                  operator: "equals",
                  value: false,
                },
                {
                  field: "release_date",
                  id: "undated",
                  operator: "not_exists",
                },
              ],
              id: "undated-group",
              label: "Unreleased date TBD",
              operator: "all",
            },
          ],
          schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
        }),
      },
      {
        evidenceLabel: "At least 35% off",
        input: {
          appid: 104,
          fields: {
            discount_percent: known(35),
          },
          name: "Discount Signal",
        },
        profile: profile("discount", "Current Steam Discount", {
          excluded: [],
          preferred: [],
          required: [
            {
              clauses: [
                {
                  field: "discount_percent",
                  id: "discount",
                  operator: "greater_than_or_equal",
                  value: 35,
                },
              ],
              id: "discount-group",
              label: "At least 35% off",
              operator: "all",
            },
          ],
          schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
        }),
      },
    ];
    const repository = {
      async getReleasedCohort() {
        return {
          confidence: "directional" as const,
          coverage: 0,
          fallbackTier: 5 as const,
          members: [],
          signature: {},
          sourceAt: null,
        };
      },
    } as unknown as OpportunityWorkerRepository;
    const worker = new OpportunityWorker(repository, {
      websiteBaseUrl: "https://publisheriq.com",
      workerId: "report-generation-test",
    });
    const generated: OpportunityEvaluatedResult[] = [];

    for (const testCase of cases) {
      const result = await worker.evaluateGame({
        appid: testCase.input.appid,
        candidateOutcomes: new Map(),
        event: materialEvent(
          testCase.input.appid,
          `${testCase.profile.name} criteria changed eligibility.`,
        ),
        input: testCase.input,
        priorState: {
          dismissedEventFingerprint: null,
          ignored: false,
          priorEventFingerprints: new Set(),
          priorResultId: null,
          tracked: false,
        },
        profiles: [testCase.profile],
        run: {
          id: "daily-report-run",
          kind: "daily",
          windowEnd: "2026-07-30T18:00:00.000Z",
          windowStart: "2026-07-29T18:00:00.000Z",
        },
      });

      assert.equal(result.evaluations[0]?.evaluation.outcome, "eligible");
      assert.ok(result.result);
      assert.ok(
        result.result.strongestEvidence.includes(testCase.evidenceLabel),
      );
      generated.push(result.result);
    }

    const work: OpportunityDeliveryWork = {
      availableResultCount: generated.length,
      channel: "email",
      deliveryKind: "daily_digest",
      destinationCiphertext: "encrypted",
      id: "option-report",
      idempotencyKey: "daily:option-report",
      overviewUrl: "https://publisheriq.com/opportunities?run=daily-report-run",
      results: generated.map((result, index) => ({
        appid: result.appid,
        changeSummary: result.event.summary ?? result.whyNow,
        eventLabel: result.eventLabel,
        id: `result-${index + 1}`,
        marketPotential: result.market.potentialBand,
        name: cases[index]!.input.name,
        score: result.rank.finalScore,
        strongestEvidence: result.strongestEvidence,
        whyNow: result.whyNow,
      })),
      workspaceId: "00000000-0000-4000-8000-000000000300",
    };
    const rendered = renderOpportunityDelivery(work);
    const slack = JSON.stringify(rendered.slackBlocks);

    for (const testCase of cases) {
      assert.match(rendered.text, new RegExp(testCase.evidenceLabel));
      assert.match(rendered.html, new RegExp(testCase.evidenceLabel));
      assert.match(slack, new RegExp(testCase.evidenceLabel));
      assert.match(rendered.text, new RegExp(testCase.input.name));
    }
    assert.match(rendered.subject, /4 games/);
  });
});
