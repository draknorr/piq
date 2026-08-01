import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOpportunityGallery, opportunityGalleryIndex } from "./media";

describe("opportunity media gallery", () => {
  it("orders header art, trailers, and screenshots while dropping empty media", () => {
    const items = buildOpportunityGallery({
      capturedAt: "2026-07-31T00:00:00.000Z",
      headerImageUrl: "https://cdn.example.com/header.jpg",
      screenshots: [
        {
          fullUrl: "https://cdn.example.com/full.jpg",
          id: 1,
          order: 0,
          thumbnailUrl: "https://cdn.example.com/thumb.jpg",
        },
      ],
      trailers: [
        {
          highlight: true,
          hlsUrl: null,
          id: 2,
          mp4Url: null,
          name: "Reveal",
          order: 0,
          thumbnailUrl: "https://cdn.example.com/poster.jpg",
          webmUrl: null,
        },
        {
          highlight: false,
          hlsUrl: null,
          id: 3,
          mp4Url: null,
          name: null,
          order: 1,
          thumbnailUrl: null,
          webmUrl: null,
        },
      ],
    });

    assert.deepEqual(
      items.map((item) => [item.kind, item.label]),
      [
        ["header", "Steam header art"],
        ["trailer", "Reveal"],
        ["screenshot", "Screenshot 1"],
      ],
    );
    assert.equal(opportunityGalleryIndex(items, "screenshot:1"), 2);
    assert.equal(opportunityGalleryIndex(items, "missing"), 0);
  });

  it("keeps poster-only and HLS-only trailers while handling empty media", () => {
    const empty = buildOpportunityGallery({
      capturedAt: null,
      headerImageUrl: null,
      screenshots: [],
      trailers: [],
    });
    const trailers = buildOpportunityGallery({
      capturedAt: null,
      headerImageUrl: null,
      screenshots: [],
      trailers: [
        {
          highlight: false,
          hlsUrl: null,
          id: 20,
          mp4Url: null,
          name: null,
          order: 0,
          thumbnailUrl: "https://cdn.example.com/poster.jpg",
          webmUrl: null,
        },
        {
          highlight: false,
          hlsUrl: "https://video.fastly.steamstatic.com/video.m3u8",
          id: 21,
          mp4Url: null,
          name: "Gameplay",
          order: 1,
          thumbnailUrl: null,
          webmUrl: null,
        },
      ],
    });

    assert.deepEqual(empty, []);
    assert.deepEqual(
      trailers.map((item) => item.kind === "trailer" && item.mediaId),
      [20, 21],
    );
  });
});
