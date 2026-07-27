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
    assert.match(rendered.html, /Open canonical record/);
    assert.match(JSON.stringify(rendered.slackBlocks), /games\/10/);
  });

  it("escapes game names in email HTML", () => {
    const rendered = renderOpportunityDelivery(DELIVERY);

    assert.match(rendered.html, /&lt;Game &amp; Friends&gt;/);
    assert.doesNotMatch(rendered.html, /<Game & Friends>/);
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
});
