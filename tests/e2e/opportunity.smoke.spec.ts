import { expect, test, type Page, type Route } from "@playwright/test";

import { installChatFetchMocks } from "./chat-mocks";

const RESULT = {
  appid: 424242,
  change: {
    affectedRuleFields: ["price_cents"],
    after: [{ price_cents: 1499 }],
    before: [{ price_cents: 1999 }],
    confidence: "high",
    effectiveAt: "2026-07-27T07:30:00.000Z",
    eventType: "business_model_changed",
    observedAt: "2026-07-27T07:31:00.000Z",
    signalFamily: "pricing",
  },
  confidence: "high",
  createdAt: "2026-07-27T08:00:00.000Z",
  eventFingerprint: "event-fingerprint-1",
  eventLabel: "materially_changed",
  id: "11111111-1111-4111-8111-111111111111",
  marketPotential: "meaningful",
  matchedProfiles: [{ id: "profile-1", name: "Cozy scouting" }],
  name: "Lanterns at Low Tide",
  rank: 1,
  rankComponents: { userFit: 1 },
  score: 82.5,
  strongestEvidence: ["Price changed from $19.99 to $14.99."],
  whyNow:
    "The game changed its price or business model. It now qualifies for Production smoke.",
};

const CHANGE_RESULTS = [
  RESULT,
  {
    ...RESULT,
    appid: 424243,
    change: {
      ...RESULT.change,
      affectedRuleFields: ["developer"],
      after: [{ developers: ["Harborlight"] }],
      before: [{ developers: ["Old Harbor Studio"] }],
      eventType: "developer_changed",
      signalFamily: "store-page",
    },
    eventFingerprint: "event-fingerprint-2",
    id: "11111111-1111-4111-8111-111111111112",
    name: "Developer Change Game",
    rank: 2,
  },
  {
    ...RESULT,
    appid: 424244,
    change: {
      ...RESULT.change,
      affectedRuleFields: ["platforms"],
      after: [{ platforms: { mac: true, windows: true } }],
      before: [{ platforms: { mac: false, windows: true } }],
      eventType: "platform_expanded",
      signalFamily: "platform",
    },
    eventFingerprint: "event-fingerprint-3",
    id: "11111111-1111-4111-8111-111111111113",
    name: "Platform Change Game",
    rank: 3,
  },
  {
    ...RESULT,
    appid: 424245,
    change: {
      ...RESULT.change,
      affectedRuleFields: ["release_date"],
      after: [{ release_date: "2026-11-12" }],
      before: [{ release_date: "2026-10-20" }],
      eventType: "release_timing_changed",
      signalFamily: "release",
    },
    eventFingerprint: "event-fingerprint-4",
    id: "11111111-1111-4111-8111-111111111114",
    name: "Release Date Game",
    rank: 4,
  },
  {
    ...RESULT,
    appid: 424246,
    change: {
      ...RESULT.change,
      affectedRuleFields: ["has_demo"],
      after: [{ has_demo: true }],
      before: [{ has_demo: false }],
      eventType: "demo_added",
      signalFamily: "release",
    },
    eventFingerprint: "event-fingerprint-5",
    id: "11111111-1111-4111-8111-111111111115",
    name: "Demo Added Game",
    rank: 5,
  },
  {
    ...RESULT,
    appid: 424247,
    change: {
      ...RESULT.change,
      affectedRuleFields: ["tags"],
      after: [{ tags: ["Cozy", "Deckbuilder"] }],
      before: [{ tags: ["Cozy", "Puzzle"] }],
      eventType: "taxonomy_repositioned",
      signalFamily: "taxonomy",
    },
    eventFingerprint: "event-fingerprint-6",
    id: "11111111-1111-4111-8111-111111111116",
    name: "Tag Change Game",
    rank: 6,
  },
  {
    ...RESULT,
    appid: 424248,
    change: {
      ...RESULT.change,
      affectedRuleFields: ["publisher"],
      after: null,
      before: null,
      eventType: "publisher_changed",
      signalFamily: "store-page",
    },
    eventFingerprint: "event-fingerprint-7",
    id: "11111111-1111-4111-8111-111111111117",
    name: "Unknown Publisher Game",
    rank: 7,
  },
];

const BOOTSTRAP = {
  channelPreferences: [],
  dailyOverview: {
    coverageWarnings: ["YouTube evidence is partial."],
    groups: {
      materiallyChanged: [RESULT],
      newlyDiscovered: [],
      newlyQualified: [],
      newlyReleased: [],
      trackedUpdates: [],
    },
    matchedCount: 1,
    presetHealthChanges: [
      {
        asOfDate: "2026-07-28T00:00:00.000Z",
        evaluatedGames: 5_000,
        explanation: [
          "Only 9 of 5,000 evaluated released games have complete review-and-CCU signals (0% core coverage).",
          "At least 10 measured games and 60% coverage are required for a market-health conclusion.",
        ],
        maximumEvaluated: 5_000,
        name: "Extraction Shooter",
        priorState: "quiet",
        sampleCapped: true,
        state: "insufficient_data",
      },
    ],
    profilesEvaluated: 1,
    runId: "run-20260727",
    status: "ready",
    windowEnd: "2026-07-27T08:00:00.000Z",
    windowStart: "2026-07-26T08:00:00.000Z",
  },
  profiles: [
    {
      currentVersion: 1,
      description: "Small cozy games with a demo",
      id: "profile-1",
      immediateFullMatchEnabled: false,
      localDeliveryTime: "09:00",
      name: "Cozy scouting",
      nextEvaluationAt: "2026-07-28T08:00:00.000Z",
      sourcePresetName: "Cozy Sim",
      status: "enabled",
      timezone: "America/Los_Angeles",
      updatedAt: "2026-07-27T07:00:00.000Z",
    },
  ],
  presets: [
    {
      description: "Cozy games with visible product readiness.",
      healthState: "growing",
      healthUnavailableReason: null,
      id: "preset-1",
      name: "Cozy Sim",
      ruleSummary: ["Tags include Cozy", "Playable demo preferred"],
      slug: "cozy-sim",
      version: 1,
    },
    {
      description: "Upcoming games with a playable demo.",
      healthState: null,
      healthUnavailableReason: "unreleased_only",
      id: "preset-2",
      name: "Upcoming Games With Demos",
      ruleSummary: ["Upcoming", "Playable demo required"],
      slug: "upcoming-games-with-demos",
      version: 1,
    },
  ],
  sourceHealth: [
    {
      label: "Steam catalog",
      source: "catalog",
      state: "healthy",
      updatedAt: "2026-07-27T07:59:00.000Z",
    },
    {
      label: "PICS taxonomy",
      source: "pics",
      state: "healthy",
      updatedAt: "2026-07-27T07:58:00.000Z",
    },
  ],
  workspace: {
    id: "workspace-1",
    name: "PublisherIQ research",
    role: "owner",
  },
};

const GAME_RECORD = {
  app: {
    appid: RESULT.appid,
    developers: ["Harborlight"],
    name: RESULT.name,
    publishers: [],
    releaseDate: "2026-11-12",
    releaseState: "prerelease",
    steamUrl: `https://store.steampowered.com/app/${RESULT.appid}`,
  },
  cohort: {
    confidence: "high",
    coverage: 0.8,
    fallbackTier: 1,
    members: [
      {
        appid: 100,
        ccuPeak: 62,
        inclusionReasons: [
          "2 shared primary tags",
          "compatible business model",
        ],
        inclusionScore: 0.75,
        name: "Neighboring Harbor",
        positivePercentage: 91,
        priceCents: 1499,
        reviewsAdded30d: 28,
        totalReviews: 780,
      },
    ],
    signature: { businessModel: "premium", tags: ["Cozy", "Exploration"] },
    sourceAt: "2026-07-26T00:00:00.000Z",
  },
  currentMetrics: {
    CcuPeak: 64,
    positive_percentage: 92,
    ReviewsAdded30d: 12,
    TotalReviews: 42,
  },
  evidence: [
    {
      confidence: "high",
      evidenceClass: "observed",
      label: "Steam tags",
      source: "pics/latest",
      sourceAt: "2026-07-27T07:58:00.000Z",
      value: ["Cozy", "Exploration"],
    },
  ],
  marketContext: {
    concentration: { topOneShare: 0.22, warning: null },
    confidence: "high",
    demandDirection: "improving",
    distributions: {
      ccuPeak: { measured: 20, p25: 18, p50: 40, p75: 75, p90: 180 },
      reviewsAdded30d: { measured: 20, p25: 8, p50: 20, p75: 45, p90: 90 },
      totalReviews: { measured: 20, p25: 120, p50: 330, p75: 720, p90: 1800 },
    },
    explanation: ["20 of 24 released peers have current core measurements."],
    potentialBand: "meaningful",
    supply: { measuredGames: 20, releasedGames: 24 },
  },
  matchedProfiles: [
    {
      id: "profile-1",
      name: "Cozy scouting",
      profileVersion: 1,
      profileVersionId: "22222222-2222-4222-8222-222222222222",
      ruleOutcomes: {
        excluded: false,
        excludedOutcomes: [
          {
            clauseOutcomes: [
              {
                actualValue: [],
                comparisonValue: "Adult",
                explanation: "content_descriptors contains adult did not pass",
                field: "content_descriptors",
                operator: "contains",
                state: "false",
              },
            ],
            groupId: "group-content",
            label: "Content fit",
            state: "false",
          },
        ],
        missingRequiredFields: [],
        outcome: "eligible",
        preferenceContribution: 0.5,
        preferredOutcomes: [
          {
            clauseOutcomes: [
              {
                actualValue: true,
                comparisonValue: true,
                explanation: "has_demo was true; equals true passed",
                field: "has_demo",
                operator: "equals",
                state: "true",
              },
            ],
            groupId: "group-demo",
            label: "Playable build",
            state: "true",
          },
        ],
        requiredOutcomes: [
          {
            clauseOutcomes: [
              {
                actualValue: ["Cozy", "Exploration"],
                comparisonValue: "Cozy",
                explanation: "Steam tags contain Cozy.",
                field: "tags",
                operator: "contains",
                state: "true",
              },
            ],
            groupId: "group-1",
            label: "Cozy positioning",
            state: "true",
          },
        ],
      },
    },
  ],
  missingEvidence: ["ccu_peak"],
  officialNews: [
    {
      feedLabel: "Community Announcements",
      gid: "news-1",
      publishedAt: "2026-07-26T15:00:00.000Z",
      title: "Demo now available",
      url: "https://store.steampowered.com/news/app/424242/view/1",
    },
  ],
  previousAppearances: [],
  provenance: {
    calculationVersions: {
      cohort: "opportunity-cohort/v1",
      evidence: "opportunity-evidence/v1",
      market: "opportunity-market/v1",
      ranking: "opportunity-ranking/v1",
    },
    deliveries: [
      {
        channel: "email",
        createdAt: "2026-07-27T08:01:00.000Z",
        deliveryKind: "daily_digest",
        sentAt: "2026-07-27T08:01:10.000Z",
        status: "sent",
      },
    ],
    run: {
      activeProfileVersions: ["22222222-2222-4222-8222-222222222222"],
      completedAt: "2026-07-27T08:00:05.000Z",
      id: "run-20260727",
      kind: "daily",
      sourceWatermarks: {
        materialEventId: "event-fingerprint-1",
      },
      startedAt: "2026-07-27T08:00:00.000Z",
      windowEnd: "2026-07-27T08:00:00.000Z",
      windowStart: "2026-07-26T08:00:00.000Z",
    },
    sourceTimestamps: {
      materialEventEffectiveAt: "2026-07-27T07:30:00.000Z",
      materialEventObservedAt: "2026-07-27T07:31:00.000Z",
      profileEvaluationAt: "2026-07-27T08:00:00.000Z",
    },
    triggeringEvent: {
      classifierVersion: "opportunity-materiality/v1",
      effectiveAt: "2026-07-27T07:30:00.000Z",
      eventType: "business_model_changed",
      observedAt: "2026-07-27T07:31:00.000Z",
      registryVersion: "steam-change-event-registry/v1",
      signalFamily: "pricing",
    },
  },
  rank: {
    components: {
      evidenceQuality: 0.8,
      marketMomentum: 1,
      peerPosition: 0.7,
      signalStrength: 0.9,
      userFit: 1,
    },
    finalScore: 82.5,
    rankingVersion: "opportunity-ranking/v1",
    reasons: ["One profile matched all required rules."],
    weights: {
      evidenceQuality: 0.05,
      marketMomentum: 0.1,
      peerPosition: 0.2,
      signalStrength: 0.3,
      userFit: 0.35,
    },
  },
  recentChanges: [
    {
      affectedRuleFields: ["price_cents"],
      after: [{ price_cents: 1499 }],
      before: [{ price_cents: 1999 }],
      confidence: "high",
      effectiveAt: "2026-07-27T07:30:00.000Z",
      eventFingerprint: "event-fingerprint-1",
      eventType: "business_model_changed",
      materiality: 0.9,
      observedAt: "2026-07-27T07:31:00.000Z",
      rawEventRefs: [{ source: "storefront" }],
      signalFamily: "pricing",
    },
  ],
  result: RESULT,
  teamActivity: [],
  userState: {
    dismissedAt: null as string | null,
    ignoredAt: null as string | null,
    researching: false,
    trackedAt: null as string | null,
  },
  youtubeEvidence: {
    coverage: "partial",
    latestSnapshotAt: "2026-07-27T06:00:00.000Z",
    videos: [
      {
        channelTitle: "Indie Watch",
        confidenceScore: 0.95,
        contentClass: "editorial",
        publishedAt: "2026-07-26T18:00:00.000Z",
        title: "Five demos worth playing",
        url: "https://www.youtube.com/watch?v=video-1",
        videoId: "video-1",
        viewCount: 12000,
      },
    ],
  },
  workspace: {
    name: "PublisherIQ research",
    role: "owner",
  },
};

const PREVIEW = {
  coverage: [
    {
      field: "tags",
      knownCount: 190000,
      percentage: 0.95,
      totalCount: 200000,
    },
  ],
  eliminationFunnel: [
    {
      eliminated: 199988,
      groupId: "starter-positioning",
      label: "Core positioning",
      remaining: 12,
    },
  ],
  estimatedDailyVolume: {
    basis: "insufficient_history",
    high: null,
    low: null,
  },
  evaluatedCatalogSize: 200000,
  representativeMatches: [
    {
      appid: RESULT.appid,
      matchedPreferences: [],
      name: RESULT.name,
      releaseState: "prerelease",
      scoreHint: 1,
      tags: ["Cozy", "Exploration"],
    },
  ],
  totalMatches: 12,
  warnings: ["Daily volume needs completed run history."],
};

async function installOpportunityMocks(
  page: Page,
  options: {
    bootstrap?: unknown;
    gameRecord?: unknown;
    statefulActions?: boolean;
  } = {},
): Promise<Array<{ body: Record<string, unknown>; operation: string }>> {
  const actionRequests: Array<{
    body: Record<string, unknown>;
    operation: string;
  }> = [];
  const gameRecord = structuredClone(
    (options.gameRecord ?? GAME_RECORD) as typeof GAME_RECORD,
  );
  await installChatFetchMocks(page, { chatResponses: [] });
  await page.route("**/api/opportunities/**", async (route: Route) => {
    const operation = new URL(route.request().url()).pathname.split("/").at(-1);
    const body = (route.request().postDataJSON() ?? {}) as Record<
      string,
      unknown
    >;
    if (
      options.statefulActions &&
      (operation === "game-state" || operation === "team-activity")
    ) {
      actionRequests.push({ body, operation });
      if (operation === "game-state") {
        const timestamp = "2026-07-27T08:05:00.000Z";
        switch (body.action) {
          case "dismiss":
            gameRecord.userState.dismissedAt = timestamp;
            break;
          case "ignore":
            gameRecord.userState.ignoredAt = timestamp;
            break;
          case "restore":
            gameRecord.userState.dismissedAt = null;
            gameRecord.userState.ignoredAt = null;
            break;
          case "track":
            gameRecord.userState.trackedAt = timestamp;
            break;
          case "untrack":
            gameRecord.userState.trackedAt = null;
            break;
        }
      } else {
        gameRecord.userState.researching =
          body.activityType === "researching_started";
      }
      await route.fulfill({
        body: JSON.stringify({ ok: true }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const payload =
      operation === "bootstrap"
        ? (options.bootstrap ?? BOOTSTRAP)
        : operation === "game-record"
          ? gameRecord
          : operation === "preview-profile"
            ? PREVIEW
            : {};
    await route.fulfill({
      body: JSON.stringify(payload),
      contentType: "application/json",
      status: 200,
    });
  });
  return actionRequests;
}

test("daily opportunity brief opens a replayable evidence record", async ({
  page,
}) => {
  test.slow();
  await installOpportunityMocks(page);
  await page.goto("/opportunities");

  await expect(
    page.getByRole("heading", { name: /daily opportunity/i }),
  ).toBeVisible();
  await expect(page.getByText(RESULT.name)).toBeVisible();
  await expect(page.getByText("1 signals worth opening")).toBeVisible();
  await expect(page.getByText("Data status", { exact: true })).toBeVisible();
  await page.getByText("Data status", { exact: true }).click();
  await expect(page.getByText("Recent market health changes")).toBeVisible();
  await expect(page.getByText("Quiet → Insufficient Data")).toBeVisible();
  await expect(
    page.getByText(/5,000-game evaluation cap reached/i),
  ).toBeVisible();
  await expect(
    page.getByText("Price changed from $19.99 to $14.99."),
  ).toBeVisible();
  await expect(page.getByText("Opportunity fit: 83/100")).toBeVisible();
  await expect(page.getByText("Matches your sourcing profile:")).toBeVisible();
  await expect(page.getByText(/Production smoke/i)).toHaveCount(0);

  await page.getByRole("link", { name: new RegExp(RESULT.name) }).click();
  await expect(page).toHaveURL(
    new RegExp(`/opportunities/games/${RESULT.appid}\\?result=${RESULT.id}`),
    { timeout: 20_000 },
  );
  await expect(page.getByRole("heading", { name: RESULT.name })).toBeVisible();
  await expect(
    page.getByText("Price changed from $19.99 to $14.99.").first(),
  ).toBeVisible();
  await expect(
    page.getByText("What drives this opportunity score"),
  ).toBeVisible();
  await expect(page.getByText("Dealbreakers checked")).toBeVisible();
  await expect(page.getByText("Playable demo available")).toBeVisible();
  await expect(
    page.getByText("No adult-only content identified"),
  ).toBeVisible();
  await expect(page.getByText("Peak concurrent players").first()).toBeVisible();
  await expect(
    page.getByText("Median among 20 comparable games").first(),
  ).toBeVisible();
  await expect(page.getByText("Demo now available")).toBeVisible();
  await expect(page.getByText("Five demos worth playing")).toBeVisible();
  await expect(
    page.getByText("Data status and technical details"),
  ).toBeVisible();
  await expect(page.getByText("opportunity-ranking/v1")).not.toBeVisible();
  await expect(page.getByText("Reproduction contract")).toHaveCount(0);
});

test("opportunity list translates stored changes without inventing values", async ({
  page,
}) => {
  await installOpportunityMocks(page, {
    bootstrap: {
      ...BOOTSTRAP,
      dailyOverview: {
        ...BOOTSTRAP.dailyOverview,
        groups: {
          ...BOOTSTRAP.dailyOverview.groups,
          materiallyChanged: CHANGE_RESULTS,
        },
        matchedCount: CHANGE_RESULTS.length,
      },
    },
  });
  await page.goto("/opportunities");

  await expect(
    page.getByText("Developer changed from Old Harbor Studio to Harborlight."),
  ).toBeVisible();
  await expect(page.getByText("macOS support was added.")).toBeVisible();
  await expect(
    page.getByText("Release date moved from Oct 20, 2026 to Nov 12, 2026."),
  ).toBeVisible();
  await expect(page.getByText("A playable demo was added.")).toBeVisible();
  await expect(
    page.getByText("Steam tags changed: added Deckbuilder; removed Puzzle."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The listed publisher changed, but the stored evidence does not contain both names.",
    ),
  ).toBeVisible();
});

for (const role of ["owner", "admin", "member"] as const) {
  test(`data status follows the ${role} workspace role`, async ({ page }) => {
    await installOpportunityMocks(page, {
      bootstrap: {
        ...BOOTSTRAP,
        workspace: { ...BOOTSTRAP.workspace, role },
      },
    });
    await page.goto("/opportunities");

    if (role === "member") {
      await expect(page.getByText("Data status", { exact: true })).toHaveCount(
        0,
      );
    } else {
      await expect(
        page.getByText("Data status", { exact: true }),
      ).toBeVisible();
    }
  });
}

test("opportunity records render truthful null and sparse change evidence", async ({
  page,
}) => {
  await installOpportunityMocks(page, {
    bootstrap: {
      ...BOOTSTRAP,
      dailyOverview: {
        ...BOOTSTRAP.dailyOverview,
        groups: {
          ...BOOTSTRAP.dailyOverview.groups,
          materiallyChanged: [
            { ...RESULT, change: null },
            {
              ...RESULT,
              appid: 424249,
              change: {
                ...RESULT.change,
                affectedRuleFields: ["publisher"],
                after: "{malformed",
                before: null,
                eventType: "publisher_changed",
                signalFamily: "store-page",
              },
              eventFingerprint: "event-fingerprint-8",
              id: "11111111-1111-4111-8111-111111111118",
              name: "Sparse Evidence Game",
              rank: 2,
            },
          ],
        },
        matchedCount: 2,
      },
    },
    gameRecord: {
      ...GAME_RECORD,
      recentChanges: [
        {
          ...GAME_RECORD.recentChanges[0],
          affectedRuleFields: ["publisher"],
          after: "{malformed",
          before: null,
          eventType: "publisher_changed",
          signalFamily: "store-page",
        },
      ],
      result: { ...RESULT, change: null },
    },
  });
  await page.goto("/opportunities");

  await expect(
    page.getByText(
      "PublisherIQ identified a new sourcing signal, but no before-and-after snapshot is linked.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The listed publisher changed, but the stored evidence does not contain both names.",
    ),
  ).toBeVisible();

  await page.getByRole("link", { name: new RegExp(RESULT.name) }).click();
  await expect(
    page.getByText(
      "PublisherIQ identified a new sourcing signal, but no before-and-after snapshot is linked.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The listed publisher changed, but the stored evidence does not contain both names.",
    ),
  ).toBeVisible();
});

test("labels presets that do not support released-market health", async ({
  page,
}) => {
  await installOpportunityMocks(page);
  await page.goto("/opportunities");

  await page.getByRole("button", { name: "Profiles & presets" }).click();
  await expect(page.getByText("Unreleased health model pending")).toBeVisible();
});

test("profile workshop previews with the same visible rule contract", async ({
  page,
}) => {
  await installOpportunityMocks(page);
  await page.goto("/opportunities");

  await page.getByRole("button", { name: "Profiles & presets" }).click();
  await page.getByRole("button", { name: "Build from scratch" }).click();

  await expect(page.getByText("Profile workshop")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove rule" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Preview profile" }).click();
  await expect(page.getByText("12", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(
      /games currently match every must-have criterion across 200,000 Steam games/i,
    ),
  ).toBeVisible();
  await expect(page.getByText(RESULT.name)).toBeVisible();
});

test("personal and team controls survive canonical-record reloads", async ({
  page,
}) => {
  const actionRequests = await installOpportunityMocks(page, {
    statefulActions: true,
  });
  await page.goto(`/opportunities/games/${RESULT.appid}?result=${RESULT.id}`);
  await expect(page.getByRole("heading", { name: RESULT.name })).toBeVisible();

  await page.getByRole("button", { name: "Track", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Tracked", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tracked", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Track", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Researching", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Researching", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start research", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Dismiss", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Ignore", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ignore", exact: true }),
  ).toBeVisible();

  expect(
    actionRequests.map(({ body, operation }) => ({
      action: body.action ?? body.activityType,
      operation,
    })),
  ).toEqual([
    { action: "track", operation: "game-state" },
    { action: "untrack", operation: "game-state" },
    { action: "researching_started", operation: "team-activity" },
    { action: "researching_cleared", operation: "team-activity" },
    { action: "dismiss", operation: "game-state" },
    { action: "restore", operation: "game-state" },
    { action: "ignore", operation: "game-state" },
    { action: "restore", operation: "game-state" },
  ]);
});
