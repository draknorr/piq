import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileOpportunityPreview,
  opportunityPersistedResultContentSafetySql,
} from "./sql-compiler.js";
import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityRuleSet,
} from "./types.js";

describe("opportunity SQL compiler", () => {
  it("builds a fail-closed safety predicate for persisted results", () => {
    const sql = opportunityPersistedResultContentSafetySql("result", "app");

    assert.match(sql, /result\.missing_evidence/);
    assert.match(sql, /app\.content_descriptors/);
    assert.match(sql, /@ == "3" \|\| @ == "adult"/);
    assert.throws(
      () => opportunityPersistedResultContentSafetySql("result; DROP"),
      /Invalid internal SQL identifier/,
    );
  });

  it("parameterizes user values and preserves required/excluded semantics", () => {
    const rules: OpportunityRuleSet = {
      excluded: [
        {
          clauses: [
            {
              field: "content_descriptors",
              id: "adult",
              operator: "contains",
              value: "adult' OR TRUE --",
            },
          ],
          id: "excluded-content",
          label: "Excluded content",
          operator: "any",
        },
      ],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "tags",
              id: "tag-a",
              operator: "contains",
              value: "Roguelike",
            },
            {
              field: "tags",
              id: "tag-b",
              operator: "contains",
              value: "Deckbuilding",
            },
          ],
          id: "taxonomy",
          label: "Taxonomy",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    };

    const compiled = compileOpportunityPreview(rules);

    assert.doesNotMatch(compiled.matchSql, /OR TRUE/);
    assert.ok(compiled.matchSql.includes(" AND "));
    assert.ok(compiled.matchSql.includes("NOT"));
    assert.deepEqual(compiled.values, [
      "Roguelike",
      "Deckbuilding",
      "adult' OR TRUE --",
    ]);
  });

  it("requires content-descriptor readiness even when a profile has no rules", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(compiled.matchSql, /evidence_content_descriptors_pics/);
    assert.match(compiled.matchSql, /readiness_pics\.status = 'ready'/);
    assert.match(compiled.excludedSql, /@ == "3" \|\| @ == "adult"/);
    assert.equal(
      compiled.requiredGroups[0]?.groupId,
      "content-safety-readiness",
    );
    assert.equal(
      compiled.requiredStages[0]?.label,
      "Content descriptors available",
    );
  });

  it("uses set-based joins for self-published and descriptor evidence", () => {
    const compiled = compileOpportunityPreview(
      {
        excluded: [
          {
            clauses: [
              {
                field: "content_descriptors",
                id: "adult-content",
                operator: "contains",
                value: "adult",
              },
            ],
            id: "excluded-content",
            label: "Excluded content",
            operator: "all",
          },
        ],
        preferred: [],
        required: [
          {
            clauses: [
              {
                field: "self_published",
                id: "self-published",
                operator: "equals",
                value: true,
              },
              {
                field: "publisheriq_added_at",
                id: "added-today",
                operator: "in_window",
                value: { kind: "relative_window", window: "today" },
              },
            ],
            id: "positioning",
            label: "Core positioning",
            operator: "all",
          },
        ],
        schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
      },
      {
        asOf: "2026-08-03T20:00:00.000Z",
        timezone: "America/Los_Angeles",
      },
    );

    assert.match(compiled.fromSql, /SELECT DISTINCT app_developer\.appid/);
    assert.match(compiled.fromSql, /LEFT JOIN ops\.app_catalog_state/);
    assert.match(
      compiled.fromSql,
      /LEFT JOIN ops\.app_field_evidence evidence_content_descriptors_pics/,
    );
    assert.match(compiled.matchSql, /self_published_app\.appid IS NOT NULL/);
    assert.match(
      compiled.matchSql,
      /evidence_content_descriptors_pics\.evidence_state = 'known'/,
    );
    assert.match(compiled.excludedSql, /WHEN '3' THEN 'adult'/);
    assert.match(compiled.excludedSql, /jsonb_path_query_array/);
    assert.doesNotMatch(
      compiled.matchSql,
      /FROM legacy\.app_developers app_developer/,
    );
    assert.doesNotMatch(
      compiled.matchSql,
      /FROM ops\.app_field_evidence field_evidence/,
    );
  });

  it("compiles ANY rule groups with OR", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "genres",
              id: "sim",
              operator: "contains",
              value: "Simulation",
            },
            {
              field: "genres",
              id: "strategy",
              operator: "contains",
              value: "Strategy",
            },
          ],
          id: "genre",
          label: "Genre",
          operator: "any",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(compiled.matchSql, / OR /);
  });

  it("allows Storefront evidence for source-aware fallback fields", () => {
    const rules: OpportunityRuleSet = {
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "genres",
              id: "genre",
              operator: "contains",
              value: "Strategy",
            },
            {
              field: "tags",
              id: "tag",
              operator: "contains",
              value: "Tactical",
            },
          ],
          id: "taxonomy",
          label: "Taxonomy",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    };

    const compiled = compileOpportunityPreview(rules);
    const genreCoverage = compiled.coverageFields.find(
      ({ field }) => field === "genres",
    )!;
    const tagCoverage = compiled.coverageFields.find(
      ({ field }) => field === "tags",
    )!;

    assert.match(genreCoverage.knownSql, /'pics', 'storefront'/);
    assert.match(tagCoverage.knownSql, /'pics', 'storefront'/);
    assert.match(compiled.matchSql, /field_value\.field_name = 'tags'/);
    assert.match(compiled.matchSql, /jsonb_array_elements_text/);
    assert.match(genreCoverage.knownSql, /field_evidence_any\.source = 'pics'/);

    const emptyPlatform = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "platforms",
              id: "none",
              operator: "not_exists",
            },
          ],
          id: "platform",
          label: "No listed platform",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });
    assert.match(
      emptyPlatform.coverageFields[0]!.knownSql,
      /a\.platforms IS NOT NULL/,
    );
    assert.match(emptyPlatform.matchSql, /jsonb_array_elements_text/);
    assert.match(
      emptyPlatform.matchSql,
      /CASE field_value\.source WHEN 'pics' THEN 0 ELSE 1 END/,
    );
  });

  it("uses relative CCU growth consistently in preview rules", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "ccu_change_30d",
              id: "ccu-growth",
              operator: "greater_than_or_equal",
              value: 0.2,
            },
          ],
          id: "traction",
          label: "Traction",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(
      compiled.matchSql,
      /ccu_peak_latest_30d - sw\.ccu_peak_first_30d/,
    );
    assert.match(compiled.matchSql, /ABS\(sw\.ccu_peak_first_30d\)/);
    assert.doesNotMatch(compiled.matchSql, /ccu_peak_change_30d/);
    assert.deepEqual(compiled.values, [0.2]);
  });

  it("compiles discount profile values as whole percentages", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "discount_percent",
              id: "discount",
              operator: "greater_than_or_equal",
              value: 35,
            },
          ],
          id: "commercial",
          label: "Discounted",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(
      compiled.matchSql,
      /COALESCE\(a\.current_discount_percent, m\.discount_percent\)/,
    );
    assert.deepEqual(compiled.values, [35]);
  });

  it("compiles release-date absence as known when storefront data is ready", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "is_released",
              id: "unreleased",
              operator: "equals",
              value: false,
            },
            {
              field: "release_date",
              id: "undated",
              operator: "not_exists",
            },
          ],
          id: "undated",
          label: "Unreleased date TBD",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(compiled.matchSql, /readiness_storefront/);
    assert.match(compiled.matchSql, /a\.release_date IS NULL/);
    assert.doesNotMatch(
      compiled.coverageFields.find((item) => item.field === "release_date")!
        .knownSql,
      /release_date IS NOT NULL/,
    );
  });

  it("compiles canonical demo-only semantics from storefront truth", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "demo_only",
              id: "demo-only",
              operator: "equals",
              value: true,
            },
          ],
          id: "demo",
          label: "Only demo available",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(compiled.matchSql, /a\.is_released = false/);
    assert.match(compiled.matchSql, /a\.has_purchase_packages = false/);
    assert.match(compiled.matchSql, /legacy\.app_demos/);
    assert.match(compiled.fromSql, /a\.type IN \('game', 'Game'\)/);
  });

  it("precomputes timezone-aware added-date bounds and joins catalog state only when needed", () => {
    const compiled = compileOpportunityPreview(
      {
        excluded: [],
        preferred: [],
        required: [
          {
            clauses: [
              {
                field: "publisheriq_added_at",
                id: "recent",
                operator: "in_window",
                value: {
                  kind: "relative_window",
                  window: "today",
                },
              },
            ],
            id: "recent",
            label: "Recently added",
            operator: "all",
          },
        ],
        schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
      },
      {
        asOf: "2026-03-08T20:00:00.000Z",
        timezone: "America/Los_Angeles",
      },
    );

    assert.match(compiled.fromSql, /ops\.app_catalog_state catalog_state/);
    assert.match(
      compiled.coverageFields[0]!.knownSql,
      /first_observation_kind = 'new'/,
    );
    assert.deepEqual(compiled.values, [
      "2026-03-08T08:00:00.000Z",
      "2026-03-09T07:00:00.000Z",
    ]);

    const noAddedDate = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });
    assert.doesNotMatch(noAddedDate.fromSql, /app_catalog_state/);
  });
});
