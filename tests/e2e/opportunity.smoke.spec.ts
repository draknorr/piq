import { expect, test, type Page, type Route } from "@playwright/test";

import { installChatFetchMocks } from "./chat-mocks";

const RESULT = {
  appid: 424242,
  confidence: "high",
  createdAt: "2026-07-27T08:00:00.000Z",
  eventFingerprint: "event-fingerprint-1",
  eventLabel: "newly_discovered",
  id: "11111111-1111-4111-8111-111111111111",
  marketPotential: "meaningful",
  matchedProfiles: [{ id: "profile-1", name: "Cozy scouting" }],
  name: "Lanterns at Low Tide",
  rank: 1,
  rankComponents: { userFit: 1 },
  score: 82.5,
  strongestEvidence: ["A playable demo became available."],
  whyNow: "PublisherIQ observed this Steam game for the first time.",
};

const BOOTSTRAP = {
  channelPreferences: [],
  dailyOverview: {
    coverageWarnings: ["YouTube evidence is partial."],
    groups: {
      materiallyChanged: [],
      newlyDiscovered: [RESULT],
      newlyQualified: [],
      newlyReleased: [],
      trackedUpdates: [],
    },
    matchedCount: 1,
    presetHealthChanges: [],
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
      name: "Cozy scouting",
      nextEvaluationAt: "2026-07-28T08:00:00.000Z",
      sourcePresetName: "Cozy Sim",
      status: "enabled",
      updatedAt: "2026-07-27T07:00:00.000Z",
    },
  ],
  presets: [
    {
      description: "Cozy games with visible product readiness.",
      healthState: "growing",
      id: "preset-1",
      name: "Cozy Sim",
      ruleSummary: ["Tags include Cozy", "Playable demo preferred"],
      slug: "cozy-sim",
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
  currentMetrics: { "Total reviews": 42 },
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
      ruleOutcomes: {
        excluded: false,
        excludedOutcomes: [],
        missingRequiredFields: [],
        outcome: "eligible",
        preferenceContribution: 0.5,
        preferredOutcomes: [],
        requiredOutcomes: [
          {
            clauseOutcomes: [
              {
                explanation: "Steam tags contain Cozy.",
                field: "tags",
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
      after: { hasDemo: true },
      before: { hasDemo: false },
      confidence: "high",
      effectiveAt: "2026-07-27T07:30:00.000Z",
      eventFingerprint: "event-fingerprint-1",
      eventType: "demo_added",
      materiality: 0.9,
      observedAt: "2026-07-27T07:31:00.000Z",
      rawEventRefs: [{ source: "storefront" }],
      signalFamily: "release",
    },
  ],
  result: RESULT,
  teamActivity: [],
  userState: {
    dismissedAt: null,
    ignoredAt: null,
    researching: false,
    trackedAt: null,
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

async function installOpportunityMocks(page: Page): Promise<void> {
  await installChatFetchMocks(page, { chatResponses: [] });
  await page.route("**/api/opportunities/**", async (route: Route) => {
    const operation = new URL(route.request().url()).pathname.split("/").at(-1);
    const payload =
      operation === "bootstrap"
        ? BOOTSTRAP
        : operation === "game-record"
          ? GAME_RECORD
          : operation === "preview-profile"
            ? PREVIEW
            : {};
    await route.fulfill({
      body: JSON.stringify(payload),
      contentType: "application/json",
      status: 200,
    });
  });
}

test("daily opportunity brief opens a replayable evidence record", async ({
  page,
}) => {
  await installOpportunityMocks(page);
  await page.goto("/opportunities");

  await expect(
    page.getByRole("heading", { name: /daily opportunity/i }),
  ).toBeVisible();
  await expect(page.getByText(RESULT.name)).toBeVisible();
  await expect(page.getByText("1 signals worth opening")).toBeVisible();

  await page.getByText(RESULT.name).click();
  await expect(page).toHaveURL(
    new RegExp(`/opportunities/games/${RESULT.appid}\\?result=${RESULT.id}`),
    { timeout: 20_000 },
  );
  await expect(page.getByRole("heading", { name: RESULT.name })).toBeVisible();
  await expect(page.getByText("What PublisherIQ observed")).toBeVisible();
  await expect(page.getByText("Demo now available")).toBeVisible();
  await expect(page.getByText("Five demos worth playing")).toBeVisible();
  await expect(page.getByText(/partial coverage/i)).toBeVisible();
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
    page.getByText(/current full matches across 200,000 games/i),
  ).toBeVisible();
  await expect(page.getByText(RESULT.name)).toBeVisible();
});
