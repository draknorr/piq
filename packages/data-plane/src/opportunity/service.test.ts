import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool } from "pg";

import {
  OpportunityRepository,
  presentOpportunityChanges,
} from "./repository.js";
import {
  normalizeOpportunityLocalDeliveryTime,
  OpportunityService,
} from "./service.js";
import type { OpportunityRuleSet } from "./types.js";

describe("opportunity profile delivery schedule", () => {
  it("defaults new profiles to 09:00 local time", () => {
    assert.equal(normalizeOpportunityLocalDeliveryTime(undefined), "09:00");
  });

  it("accepts bounded 24-hour times and rejects ambiguous input", () => {
    assert.equal(normalizeOpportunityLocalDeliveryTime("06:45"), "06:45");
    assert.equal(normalizeOpportunityLocalDeliveryTime("23:59"), "23:59");
    assert.throws(
      () => normalizeOpportunityLocalDeliveryTime("9:00"),
      /24-hour HH:MM/,
    );
    assert.throws(
      () => normalizeOpportunityLocalDeliveryTime("24:00"),
      /24-hour HH:MM/,
    );
  });
});

describe("opportunity trailer stream resolution", () => {
  const identity = {
    accessToken: "token",
    email: "user@example.com",
    userId: "user-1",
  };

  it("returns matched HLS streams and caches one Steam lookup per app", async () => {
    let calls = 0;
    const service = new OpportunityService(
      {} as OpportunityRepository,
      null,
      async () => {
        calls += 1;
        return [
          {
            hlsUrl: "https://video.fastly.steamstatic.com/video.m3u8",
            mediaId: 101,
            posterUrl: null,
            title: "Trailer",
          },
        ];
      },
    );

    const first = await service.resolveTrailerStreams(identity, {
      appid: 10,
      trailerIds: [101, 202],
    });
    const second = await service.resolveTrailerStreams(identity, {
      appid: 10,
      trailerIds: [101],
    });

    assert.deepEqual(first, {
      streams: [
        {
          hlsUrl: "https://video.fastly.steamstatic.com/video.m3u8",
          id: 101,
        },
        { hlsUrl: null, id: 202 },
      ],
    });
    assert.equal(second.streams[0]?.id, 101);
    assert.equal(calls, 1);
  });

  it("rejects invalid app and trailer identifiers before resolving Steam", async () => {
    const service = new OpportunityService({} as OpportunityRepository);

    await assert.rejects(
      () =>
        service.resolveTrailerStreams(identity, {
          appid: 0,
          trailerIds: [1],
        }),
      /positive integer appid/,
    );
    await assert.rejects(
      () =>
        service.resolveTrailerStreams(identity, {
          appid: 10,
          trailerIds: [-1],
        }),
      /positive integers/,
    );
    await assert.rejects(
      () =>
        service.resolveTrailerStreams(identity, {
          appid: 10,
          trailerIds: Array.from({ length: 21 }, (_, index) => index + 1),
        }),
      /No more than 20/,
    );
  });
});

describe("opportunity API presentation", () => {
  it("loads Tiger taxonomy names before returning change summaries", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const queryable = {
      async query(text: string, values: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            { id: 4195, kind: "tags", name: "Roguelike" },
            { id: 4305, kind: "tags", name: "Deckbuilding" },
          ],
        };
      },
    } as unknown as Pool;

    const [presented] = await presentOpportunityChanges(
      queryable,
      [
        {
          affectedRuleFields: ["tags"],
          after: [[4195, 4305]],
          before: [[]],
          confidence: "high",
          effectiveAt: "2026-07-27T00:00:00.000Z",
          eventType: "taxonomy_repositioned",
          observedAt: "2026-07-27T00:00:00.000Z",
          signalFamily: "taxonomy",
          summary: "",
        },
      ],
      ["materially_changed"],
    );

    assert.equal(presented?.summary, "Tags added: Roguelike and Deckbuilding.");
    assert.deepEqual(queries[0]?.values, [[4195, 4305]]);
    assert.match(queries[0]?.text ?? "", /legacy\.steam_tags/);
  });
});

describe("opportunity preview date context", () => {
  const rules: OpportunityRuleSet = {
    excluded: [],
    preferred: [],
    required: [
      {
        clauses: [
          {
            field: "publisheriq_added_at",
            id: "added",
            operator: "equals",
            value: { date: "2026-03-08", kind: "absolute_date" },
          },
        ],
        id: "added",
        label: "Added date",
        operator: "all",
      },
    ],
    schemaVersion: "opportunity-rules/v2",
  };

  it("uses one profile timezone for SQL and representative evaluation", async () => {
    let compiledValues: unknown[] = [];
    let workspaceWrites = 0;
    const repository = {
      async ensureWorkspace() {
        workspaceWrites += 1;
        return { id: "workspace", name: "Workspace", role: "owner" as const };
      },
      async getPreviewCatalog(compiled: { values: unknown[] }) {
        compiledValues = compiled.values;
        return {
          aggregate: {
            coverage: { publisheriq_added_at: 1 },
            stageCounts: { added: 1 },
            totalCatalog: 1,
            totalMatches: 1,
          },
          inputs: [
            {
              appid: 10,
              fields: {
                publisheriq_added_at: {
                  confidence: "high" as const,
                  evidenceClass: "observed_fact" as const,
                  source: "ops.app_catalog_state",
                  sourceAt: "2026-03-08T20:00:00.000Z",
                  state: "known" as const,
                  value: "2026-03-08T20:00:00.000Z",
                },
              },
              name: "Date Test",
            },
          ],
        };
      },
      async getPreviewHistoryEstimate() {
        return { high: null, low: null };
      },
    } as unknown as OpportunityRepository;
    const service = new OpportunityService(repository);

    const preview = await service.previewProfile(
      {
        accessToken: "token",
        email: "user@example.com",
        userId: "user",
      },
      {
        rules,
        timezone: "America/Los_Angeles",
      },
    );

    assert.deepEqual(compiledValues, [
      "2026-03-08T08:00:00.000Z",
      "2026-03-09T07:00:00.000Z",
    ]);
    assert.equal(workspaceWrites, 0);
    assert.equal(preview.totalMatches, 1);
    assert.equal(preview.representativeMatches[0]?.appid, 10);
  });

  it("coalesces identical in-flight catalog previews without caching completed results", async () => {
    let catalogQueries = 0;
    let releaseCatalog: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCatalog = resolve;
    });
    const repository = {
      async getPreviewCatalog() {
        catalogQueries += 1;
        await gate;
        return {
          aggregate: {
            coverage: { publisheriq_added_at: 0 },
            stageCounts: { added: 0 },
            totalCatalog: 1,
            totalMatches: 0,
          },
          inputs: [],
        };
      },
      async getPreviewHistoryEstimate() {
        return { high: null, low: null };
      },
    } as unknown as OpportunityRepository;
    const service = new OpportunityService(repository);
    const identity = {
      accessToken: "token",
      email: null,
      userId: "user",
    };

    const first = service.previewProfile(identity, {
      rules,
      timezone: "America/Los_Angeles",
    });
    const second = service.previewProfile(identity, {
      rules,
      timezone: "America/Los_Angeles",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(catalogQueries, 1);
    releaseCatalog?.();
    await Promise.all([first, second]);

    await service.previewProfile(identity, {
      rules,
      timezone: "America/Los_Angeles",
    });
    assert.equal(catalogQueries, 2);
  });

  it("rejects invalid preview timezones before querying", async () => {
    const service = new OpportunityService({} as OpportunityRepository);

    await assert.rejects(
      () =>
        service.previewProfile(
          {
            accessToken: "token",
            email: null,
            userId: "user",
          },
          { rules, timezone: "Mars/Olympus_Mons" },
        ),
      /Unsupported timezone/,
    );
  });
});
