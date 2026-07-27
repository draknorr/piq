import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityRuleSet,
} from "./types.js";
import {
  resolveOpportunityResultLabel,
  shouldSurfaceOpportunityMatch,
} from "./worker.js";
import type {
  OpportunityWorkerMaterialEvent,
  OpportunityWorkerProfile,
} from "./worker-repository.js";
import { assignOpportunityDeliveryResults } from "./worker-repository.js";

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
