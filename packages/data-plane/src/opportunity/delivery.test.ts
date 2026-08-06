import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool } from "pg";

import {
  OpportunityDeliveryDispatcher,
  OpportunityDeliveryRepository,
  renderOpportunityDelivery,
  type OpportunityDeliveryProvider,
  type OpportunityDeliveryWork,
} from "./delivery.js";
import type { OpportunityDestinationCipher } from "./delivery-secrets.js";
import { createOpportunityWorkspaceFeatureControl } from "./feature-controls.js";

const DELIVERY: OpportunityDeliveryWork = {
  availableResultCount: 1,
  channel: "email",
  deliveryKind: "daily_digest",
  destinationCiphertext: "encrypted",
  id: "delivery",
  idempotencyKey: "daily:run:preference",
  overviewUrl: "https://app.publisheriq.com/opportunities?run=run",
  results: [
    {
      appid: 10,
      changeSummary: "A playable demo was added.",
      eventLabel: "newly_qualified",
      id: "result",
      marketPotential: "meaningful",
      name: "<Game & Friends>",
      score: 82,
      strongestEvidence: ["Playable demo"],
      whyNow: "A demo arrived and every required rule now matches.",
    },
  ],
  workspaceId: "00000000-0000-4000-8000-000000000300",
};

function deliveryClaimFixture(params: { count: number; taxonomy: boolean }): {
  pool: Pool;
  statements: string[];
} {
  const statements: string[] = [];
  const claimed = Array.from({ length: params.count }, (_, index) => ({
    channel: "email",
    delivery_kind: "daily_digest",
    destination_ciphertext: "encrypted",
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    idempotency_key: `delivery:${index}`,
    profile_id: null,
    rendered_content_version: "opportunity-digest/v2",
    rendered_payload: {},
    user_id: "00000000-0000-4000-8000-000000000200",
    workspace_id: "00000000-0000-4000-8000-000000000300",
  }));
  const result = params.taxonomy
    ? {
        appid: 10,
        change: {
          affectedRuleFields: ["tags"],
          after: [1],
          before: [],
          confidence: "high",
          effectiveAt: "2026-08-05T12:00:00.000Z",
          eventType: "taxonomy_repositioned",
          observedAt: "2026-08-05T12:00:00.000Z",
          signalFamily: "taxonomy",
        },
        confidence: "high",
        created_at: "2026-08-05T12:00:00.000Z",
        event_label: "materially_changed",
        game_description: null,
        header_image_url: null,
        id: "00000000-0000-4000-8000-000000000010",
        market_potential: "meaningful",
        matched_profiles: [],
        name: "Fixture game",
        review_priority: null,
        score: 70,
        screenshot_thumbnail_url: null,
        strongest_evidence: [],
        why_now: "Tags changed.",
      }
    : null;
  const client = {
    async query(sql: string): Promise<Record<string, unknown>> {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized === "BEGIN" || normalized === "COMMIT") {
        return { rowCount: null, rows: [] };
      }
      if (normalized.includes("WITH claims AS")) {
        return { rowCount: claimed.length, rows: claimed };
      }
      if (normalized.includes("WITH selected_deliveries AS MATERIALIZED")) {
        return {
          rowCount: claimed.length,
          rows: claimed.map((delivery) => ({
            delivery_id: delivery.id,
            profiles: [],
            results: result
              ? [{ ...result, id: `${result.id}-${delivery.id}` }]
              : [],
          })),
        };
      }
      if (normalized.includes("FROM legacy.steam_tags")) {
        return { rowCount: 1, rows: [{ id: 1, kind: "tags", name: "RPG" }] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
    release(): void {},
  };
  return {
    pool: {
      async connect() {
        return client;
      },
    } as unknown as Pool,
    statements,
  };
}

describe("opportunity delivery hydration", () => {
  for (const count of [1, 10]) {
    it(`uses four round trips for ${count} ${count === 1 ? "delivery" : "deliveries"} without taxonomy`, async () => {
      const fixture = deliveryClaimFixture({ count, taxonomy: false });
      const work = await new OpportunityDeliveryRepository(fixture.pool).claim(
        "worker",
        count,
      );

      assert.equal(work.length, count);
      assert.equal(
        work[0]?.workspaceId,
        "00000000-0000-4000-8000-000000000300",
      );
      assert.equal(fixture.statements.length, 4);
      assert.equal(
        fixture.statements.filter((sql) =>
          sql.includes("WITH selected_deliveries AS MATERIALIZED"),
        ).length,
        1,
      );
      assert.ok(
        fixture.statements.some(
          (sql) =>
            sql.includes("result.missing_evidence") &&
            sql.includes("? 'content_descriptors'") &&
            sql.includes('@ == "3" || @ == "adult"'),
        ),
      );
    });
  }

  it("adds exactly one set-based taxonomy lookup", async () => {
    const fixture = deliveryClaimFixture({ count: 10, taxonomy: true });
    await new OpportunityDeliveryRepository(fixture.pool).claim("worker", 10);

    assert.equal(fixture.statements.length, 5);
    assert.equal(
      fixture.statements.filter((sql) => sql.includes("legacy.steam_tags"))
        .length,
      1,
    );
  });
});

describe("opportunity delivery rendering", () => {
  it("links summaries to canonical website records", () => {
    const rendered = renderOpportunityDelivery(DELIVERY);

    assert.match(rendered.text, /\/opportunities\/games\/10\?result=result/);
    assert.match(rendered.html, /View full analysis/);
    assert.match(JSON.stringify(rendered.slackBlocks), /games\/10/);
    assert.match(rendered.text, /A playable demo was added\./);
    assert.match(rendered.html, /A playable demo was added\./);
    assert.match(
      JSON.stringify(rendered.slackBlocks),
      /A playable demo was added\./,
    );
  });

  it("escapes game names in email HTML", () => {
    const rendered = renderOpportunityDelivery(DELIVERY);

    assert.match(rendered.html, /&lt;Game &amp; Friends&gt;/);
    assert.doesNotMatch(rendered.html, /<Game & Friends>/);
  });

  it("decodes external entities before safely escaping delivery markup", () => {
    const rendered = renderOpportunityDelivery({
      ...DELIVERY,
      results: [
        {
          ...DELIVERY.results[0]!,
          name: "CREEK &amp; RIVER &#38; CO.",
        },
      ],
    });

    assert.match(rendered.text, /CREEK & RIVER & CO\./);
    assert.match(rendered.html, /CREEK &amp; RIVER &amp; CO\./);
    assert.doesNotMatch(rendered.text, /&amp;|&#38;/);
  });

  it("escapes untrusted Steam text in Slack mrkdwn", () => {
    const rendered = renderOpportunityDelivery(DELIVERY);
    const blocks = JSON.stringify(rendered.slackBlocks);

    assert.match(blocks, /&lt;Game &amp; Friends&gt;/);
    assert.doesNotMatch(blocks, /\|<Game & Friends>>/);
  });

  it("makes summary truncation explicit in every delivery projection", () => {
    const rendered = renderOpportunityDelivery({
      ...DELIVERY,
      availableResultCount: 12,
    });

    assert.match(rendered.text, /top 1 of 12 results/);
    assert.match(rendered.html, /top 1 of 12 results/);
    assert.match(JSON.stringify(rendered.slackBlocks), /top 1 of 12 results/);
  });

  it("includes matched profile criteria in email, text, and Slack reports", () => {
    const rendered = renderOpportunityDelivery({
      ...DELIVERY,
      results: [
        {
          ...DELIVERY.results[0]!,
          strongestEvidence: [
            "Only demo available",
            "Unreleased date TBD",
            "Added in the last 30 days",
          ],
        },
      ],
    });

    assert.match(rendered.text, /Only demo available/);
    assert.match(rendered.html, /Unreleased date TBD/);
    assert.match(
      JSON.stringify(rendered.slackBlocks),
      /Added in the last 30 days/,
    );
  });

  it("renders v2 daily deliveries as an editorial issue with media and profiles", () => {
    const rendered = renderOpportunityDelivery({
      ...DELIVERY,
      renderedContentVersion: "opportunity-digest/v2",
      profiles: [
        {
          currentVersion: 1,
          description: "Games with playable demos.",
          id: "profile",
          immediateFullMatchEnabled: false,
          localDeliveryTime: "09:00",
          name: "Demo watch",
          nextEvaluationAt: null,
          sourcePresetName: null,
          status: "enabled",
          timezone: "UTC",
          updatedAt: "2026-08-03T12:00:00.000Z",
        },
      ],
      results: [
        {
          ...DELIVERY.results[0]!,
          confidence: "high",
          createdAt: "2026-08-03T12:00:00.000Z",
          headerImageUrl: "https://cdn.example.com/header.jpg",
          matchedProfiles: [{ id: "profile", name: "Demo watch" }],
          screenshotThumbnailUrl: "https://cdn.example.com/screenshot.jpg",
        },
      ],
      windowEnd: "2026-08-03T12:00:00.000Z",
      windowStart: "2026-08-02T12:00:00.000Z",
    });

    assert.match(rendered.subject, /^Daily Brief:/);
    assert.match(rendered.html, /PublisherIQ · Daily Brief/);
    assert.match(rendered.html, /cdn\.example\.com\/header\.jpg/);
    assert.match(rendered.html, /Demo watch/);
    assert.match(rendered.text, /Profile dispatches|Demo watch/);
    assert.match(JSON.stringify(rendered.slackBlocks), /image_url/);
  });

  it("uses canonical v2 descriptions and reasons only behind presentation control", () => {
    const work: OpportunityDeliveryWork = {
      ...DELIVERY,
      renderedContentVersion: "opportunity-digest/v2",
      results: [
        {
          ...DELIVERY.results[0]!,
          gameDescription: {
            contentHash: "description",
            hasHeaderImage: true,
            hasReleasePath: true,
            hasSupportedLanguages: true,
            kind: "steam_short",
            sanitizerVersion: "opportunity-description/v1",
            screenshotCount: 4,
            sourceAt: "2026-08-05T12:00:00.000Z",
            sourceSnapshotId: "snapshot",
            text: "A concise canonical game description.",
            trailerCount: 1,
          },
          reviewPriority: {
            confidence: {
              applicableCount: 3,
              conflictingCount: 0,
              label: "high",
              presentCount: 3,
              reasons: [],
              score: 1,
              staleCount: 0,
              version: "opportunity-confidence/v2",
            },
            internalScore: 0.8,
            lane: "new_game",
            policy: "discover_new_games",
            priorityBand: "review_now",
            reasons: [
              "New on Steam",
              "Self-published",
              "Large, competitive market",
            ],
            version: "opportunity-ranking/v2",
            winningProfileId: "profile",
          },
          marketPotential: "large_but_competitive",
        },
      ],
    };

    const controlledOff = renderOpportunityDelivery(work);
    const controlledOn = renderOpportunityDelivery(work, {
      presentReviewPriorityV2: true,
    });

    assert.doesNotMatch(controlledOff.text, /canonical game description/);
    assert.match(controlledOn.text, /canonical game description/);
    assert.match(controlledOn.text, /New on Steam · Self-published/);
    assert.equal(
      controlledOn.text.match(/Large, competitive market/g)?.length,
      1,
    );
    assert.equal(
      controlledOn.html.match(/Large, competitive market/g)?.length,
      1,
    );
    assert.equal(
      JSON.stringify(controlledOn.slackBlocks).match(
        /Large, competitive market/g,
      )?.length,
      1,
    );
  });

  it("keeps queued v1 deliveries on the compact renderer", () => {
    const rendered = renderOpportunityDelivery({
      ...DELIVERY,
      renderedContentVersion: "opportunity-digest/v1",
    });

    assert.doesNotMatch(rendered.subject, /^Daily Brief:/);
    assert.match(rendered.html, /View full analysis/);
  });

  it("uses a branded v2 email fallback for missing or unsafe media", () => {
    const rendered = renderOpportunityDelivery({
      ...DELIVERY,
      renderedContentVersion: "opportunity-digest/v2",
      results: [
        {
          ...DELIVERY.results[0]!,
          headerImageUrl: "http://cdn.example.com/unsafe.jpg",
          screenshotThumbnailUrl: null,
        },
      ],
    });

    assert.match(rendered.html, /PublisherIQ watch desk · Artwork unavailable/);
    assert.doesNotMatch(rendered.html, /unsafe\.jpg/);
  });
});

describe("opportunity delivery presentation scope", () => {
  it("renders v2 copy only for allowlisted workspaces in the same claim", async () => {
    const allowlistedWorkspaceId = "00000000-0000-4000-8000-000000000301";
    const unlistedWorkspaceId = "00000000-0000-4000-8000-000000000302";
    const reviewPriority = {
      confidence: {
        applicableCount: 3,
        conflictingCount: 0,
        label: "high" as const,
        presentCount: 3,
        reasons: [],
        score: 1,
        staleCount: 0,
        version: "opportunity-confidence/v2" as const,
      },
      internalScore: 0.8,
      lane: "new_game" as const,
      policy: "discover_new_games" as const,
      priorityBand: "review_now" as const,
      reasons: ["Scoped v2 reason"],
      version: "opportunity-ranking/v2" as const,
      winningProfileId: "profile",
    };
    const deliveries = [allowlistedWorkspaceId, unlistedWorkspaceId].map(
      (workspaceId, index): OpportunityDeliveryWork => ({
        ...DELIVERY,
        id: `delivery-${index}`,
        idempotencyKey: `delivery-${index}`,
        renderedContentVersion: "opportunity-digest/v2",
        results: [{ ...DELIVERY.results[0]!, reviewPriority }],
        workspaceId,
      }),
    );
    const completed: string[] = [];
    const failed: string[] = [];
    const repository = {
      async claim(): Promise<OpportunityDeliveryWork[]> {
        return deliveries;
      },
      async complete(params: { deliveryId: string }): Promise<void> {
        completed.push(params.deliveryId);
      },
      async fail(params: { deliveryId: string }): Promise<void> {
        failed.push(params.deliveryId);
      },
    } as unknown as OpportunityDeliveryRepository;
    const cipher = {
      decrypt(): string {
        return "reviewer@example.com";
      },
    } as unknown as OpportunityDestinationCipher;
    const sentText: string[] = [];
    const provider: OpportunityDeliveryProvider = {
      async sendEmail(params): Promise<string> {
        sentText.push(params.text);
        return `message-${sentText.length}`;
      },
      async sendSlack(): Promise<string> {
        throw new Error("unexpected Slack delivery");
      },
    };
    const dispatcher = new OpportunityDeliveryDispatcher(
      repository,
      cipher,
      provider,
      "worker",
      createOpportunityWorkspaceFeatureControl("1", allowlistedWorkspaceId),
    );

    assert.equal(await dispatcher.runOnce(10), 2);
    assert.match(sentText[0]!, /Scoped v2 reason/);
    assert.doesNotMatch(sentText[1]!, /Scoped v2 reason/);
    assert.deepEqual(completed, ["delivery-0", "delivery-1"]);
    assert.deepEqual(failed, []);
  });
});
