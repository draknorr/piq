import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  renderOpportunityDelivery,
  type OpportunityDeliveryWork,
} from "./delivery.js";

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
};

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
