import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityRuleSet,
} from "./types.js";
import { shouldSurfaceOpportunityMatch } from "./worker.js";
import type {
  OpportunityWorkerMaterialEvent,
  OpportunityWorkerProfile,
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
});
