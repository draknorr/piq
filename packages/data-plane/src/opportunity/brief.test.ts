import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOpportunityDailyBriefIssue,
  dedupeOpportunityBriefGames,
  emptyOpportunityEventCounts,
} from "./brief.js";
import type {
  OpportunityProfileSummary,
  OpportunityResultSummary,
} from "./types.js";

function result(
  overrides: Partial<OpportunityResultSummary> &
    Pick<OpportunityResultSummary, "appid" | "id" | "name">,
): OpportunityResultSummary {
  const { appid, id, name, ...rest } = overrides;
  return {
    appid,
    change: null,
    changeSummary: "The Steam page changed.",
    confidence: "high",
    createdAt: "2026-08-03T16:00:00.000Z",
    eventFingerprint: `event-${id}`,
    eventLabel: "newly_qualified",
    gameDescription: null,
    headerImageUrl: null,
    id,
    marketPotential: "meaningful",
    matchedProfiles: [],
    name,
    rank: 1,
    rankComponents: {
      evidenceQuality: 1,
      marketMomentum: 1,
      peerPosition: 1,
      signalStrength: 1,
      userFit: 1,
    },
    reviewPriority: null,
    score: 80,
    screenshotThumbnailUrl: null,
    strongestEvidence: ["Playable demo"],
    triggeredByMediaAddition: false,
    whyNow: "A playable demo was added.",
    ...rest,
  };
}

function profile(
  id: string,
  status: OpportunityProfileSummary["status"] = "enabled",
): OpportunityProfileSummary {
  return {
    currentVersion: 1,
    description: `${id} description`,
    id,
    immediateFullMatchEnabled: false,
    localDeliveryTime: "09:00",
    name: id,
    nextEvaluationAt: null,
    sourcePresetName: null,
    status,
    timezone: "America/Los_Angeles",
    updatedAt: "2026-08-03T16:00:00.000Z",
  };
}

describe("opportunity Daily Brief composition", () => {
  it("deduplicates by game, keeps the strongest result, and merges profiles", () => {
    const games = dedupeOpportunityBriefGames([
      result({
        appid: 10,
        id: "older",
        matchedProfiles: [{ id: "b", name: "B profile" }],
        name: "Shared game",
        score: 72,
      }),
      result({
        appid: 10,
        id: "stronger",
        matchedProfiles: [{ id: "a", name: "A profile" }],
        name: "Shared game",
        score: 91,
      }),
    ]);

    assert.equal(games.length, 1);
    assert.equal(games[0]?.id, "stronger");
    assert.deepEqual(
      games[0]?.matchedProfiles.map((item) => item.id),
      ["a", "b"],
    );
  });

  it("accounts for active, quiet, and paused profiles", () => {
    const eventCounts = emptyOpportunityEventCounts();
    eventCounts.newly_qualified = 2;
    const issue = buildOpportunityDailyBriefIssue({
      availableResultCount: 2,
      coverageWarnings: ["Storefront data is delayed."],
      featuredCandidates: [result({ appid: 10, id: "lead", name: "Lead" })],
      highConfidenceCount: 1,
      issueDate: "2026-08-03T17:00:00.000Z",
      newerRunUpdating: true,
      profileStats: [
        {
          eventCounts,
          highConfidenceCount: 1,
          profileId: "Active",
          resultCount: 2,
          topResult: { appid: 10, name: "Lead", resultId: "lead" },
        },
      ],
      profiles: [
        profile("Active"),
        profile("Quiet"),
        profile("Paused", "paused"),
      ],
      profilesEvaluated: 2,
      runId: "run",
      status: "ready",
      windowEnd: "2026-08-03T17:00:00.000Z",
      windowStart: "2026-08-02T17:00:00.000Z",
    });

    assert.match(issue.headline, /Lead leads 2 opportunities/);
    assert.match(issue.profileDispatches[0]?.summary ?? "", /2 games matched/);
    assert.match(issue.profileDispatches[1]?.summary ?? "", /No game crossed/);
    assert.match(issue.profileDispatches[2]?.summary ?? "", /not monitored/);
    assert.equal(
      issue.profileDispatches[0]?.listUrl,
      "/opportunities?profile=Active&tab=profile-lists&run=run",
    );
  });

  it("uses singular editorial copy for one profile event", () => {
    const eventCounts = emptyOpportunityEventCounts();
    eventCounts.newly_qualified = 1;
    const issue = buildOpportunityDailyBriefIssue({
      availableResultCount: 1,
      coverageWarnings: [],
      featuredCandidates: [result({ appid: 10, id: "lead", name: "Lead" })],
      highConfidenceCount: 1,
      issueDate: "2026-08-03T17:00:00.000Z",
      newerRunUpdating: false,
      profileStats: [
        {
          eventCounts,
          highConfidenceCount: 1,
          profileId: "Active",
          resultCount: 1,
          topResult: { appid: 10, name: "Lead", resultId: "lead" },
        },
      ],
      profiles: [profile("Active")],
      profilesEvaluated: 1,
      runId: "run",
      status: "ready",
      windowEnd: "2026-08-03T17:00:00.000Z",
      windowStart: "2026-08-02T17:00:00.000Z",
    });

    assert.match(issue.profileDispatches[0]?.summary ?? "", /1 new match,/);
  });
});
