import type {
  OpportunityDateOperand,
  OpportunityEvaluationContext,
  OpportunityRuleClause,
  OpportunityRuleField,
  OpportunityRuleGroup,
  OpportunityRuleSet,
  OpportunityRuleValue,
} from "./types.js";
import {
  assertOpportunityRuleSet,
  OPPORTUNITY_ADULT_CONTENT_TAGS,
  OPPORTUNITY_CONTENT_DESCRIPTOR_RULE_VALUES,
} from "./rules.js";
import {
  localDateStartUtc,
  opportunityDateRangeForOperand,
  isOpportunityDateField,
  opportunityDateOperandFromValue,
} from "./date-rules.js";

export interface OpportunitySqlFragment {
  sql: string;
  values: unknown[];
}

export interface OpportunityCompiledPreview {
  coverageFields: Array<{
    field: OpportunityRuleField;
    knownSql: string;
  }>;
  excludedSql: string;
  fromSql: string;
  matchSql: string;
  requiredGroups: Array<{
    groupId: string;
    label: string;
    matchSql: string;
  }>;
  requiredStages: Array<{
    groupId: string;
    label: string;
    matchSql: string;
  }>;
  values: unknown[];
}

interface SqlBuildContext {
  evaluation: OpportunityEvaluationContext;
  values: unknown[];
}

interface FieldSql {
  collection?: {
    appidExpression: string;
    nameExpression: string;
    relationSql: string;
  };
  knownSql: string;
  scalarSql?: string;
  textCollectionSql?: string;
}

const STOREFRONT_READY = "readiness_storefront.status = 'ready'";
const PICS_READY = "readiness_pics.status = 'ready'";
const CONTENT_DESCRIPTORS_EVIDENCE_ALIAS = "evidence_content_descriptors_pics";
const CONTENT_TAGS_EVIDENCE_ALIAS = "evidence_tags_storefront";
const SELF_PUBLISHED_ALIAS = "self_published_app";
const CONTENT_SAFETY_READINESS_GROUP_ID = "content-safety-readiness";
const CONTENT_SAFETY_READINESS_LABEL = "Content tags or descriptors available";
const ADULT_CONTENT_JSONPATH = '$.* ? (@ == "3" || @ == "adult")';
const ADULT_CONTENT_TAG_VALUES_SQL = OPPORTUNITY_ADULT_CONTENT_TAGS.map(
  (tag) => `'${tag}'`,
).join(", ");

const CONTENT_TAGS_VALUE_SQL = `CASE
  WHEN jsonb_typeof(${CONTENT_TAGS_EVIDENCE_ALIAS}.value) = 'array'
    THEN ${CONTENT_TAGS_EVIDENCE_ALIAS}.value
  ELSE '[]'::jsonb
END`;

const CONTENT_TAGS_READY_SQL = `(
  ${CONTENT_TAGS_EVIDENCE_ALIAS}.evidence_state = 'known'
  AND jsonb_array_length(${CONTENT_TAGS_VALUE_SQL}) > 0
)`;

const ADULT_CONTENT_TAGS_SQL = `EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(${CONTENT_TAGS_VALUE_SQL}) AS content_tag(value)
  WHERE lower(btrim(content_tag.value)) = ANY (
    ARRAY[${ADULT_CONTENT_TAG_VALUES_SQL}]::text[]
  )
)`;

const CONTENT_DESCRIPTOR_RULE_VALUE_SQL = `CASE raw_descriptor.value
${Object.entries(OPPORTUNITY_CONTENT_DESCRIPTOR_RULE_VALUES)
  .map(([descriptor, value]) => `  WHEN '${descriptor}' THEN '${value}'`)
  .join("\n")}
  ELSE raw_descriptor.value
END`;

const CONTENT_DESCRIPTOR_RESOLVED_VALUE_SQL = `CASE
  WHEN ${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}.evidence_state = 'known'
    THEN COALESCE(${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}.value, '{}'::jsonb)
  ELSE COALESCE(a.content_descriptors, '{}'::jsonb)
END`;

function assertSqlIdentifier(identifier: string): void {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid internal SQL identifier: ${identifier}`);
  }
}

export function opportunityPersistedResultContentSafetySql(
  resultAlias: string,
  appAlias?: string,
): string {
  assertSqlIdentifier(resultAlias);
  if (appAlias) {
    assertSqlIdentifier(appAlias);
  }
  const appRelation = appAlias
    ? `(VALUES (1)) AS content_safety_anchor(present)`
    : `legacy.apps content_safety_app`;
  const descriptorValueSql = appAlias
    ? `${appAlias}.content_descriptors`
    : `content_safety_app.content_descriptors`;
  const appPredicate = appAlias
    ? "TRUE"
    : `content_safety_app.appid = ${resultAlias}.appid`;
  const evidenceArraySql = `CASE
    WHEN jsonb_typeof(content_evidence_row.value) = 'array'
      THEN content_evidence_row.value
    ELSE '[]'::jsonb
  END`;

  return `EXISTS (
    SELECT 1
    FROM ${appRelation}
    LEFT JOIN ops.app_data_readiness content_safety_readiness
      ON content_safety_readiness.appid = ${resultAlias}.appid
     AND content_safety_readiness.source = 'pics'
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE content_evidence_row.field_name = 'content_descriptors'
            AND content_evidence_row.source = 'pics'
        ) > 0 AS descriptor_recorded,
        COUNT(*) FILTER (
          WHERE content_evidence_row.field_name = 'content_descriptors'
            AND content_evidence_row.source = 'pics'
            AND content_evidence_row.evidence_state = 'known'
        ) > 0 AS descriptor_known,
        COUNT(*) FILTER (
          WHERE content_evidence_row.field_name = 'tags'
            AND content_evidence_row.source = 'storefront'
            AND content_evidence_row.evidence_state = 'known'
            AND jsonb_array_length(${evidenceArraySql}) > 0
        ) > 0 AS tag_known,
        COUNT(*) FILTER (
          WHERE content_evidence_row.field_name = 'tags'
            AND content_evidence_row.source = 'storefront'
            AND content_evidence_row.evidence_state = 'known'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(${evidenceArraySql})
                AS adult_tag(value)
              WHERE lower(btrim(adult_tag.value)) = ANY (
                ARRAY[${ADULT_CONTENT_TAG_VALUES_SQL}]::text[]
              )
            )
        ) > 0 AS adult_tag
      FROM ops.app_field_evidence content_evidence_row
      WHERE content_evidence_row.appid = ${resultAlias}.appid
        AND (
          (
            content_evidence_row.field_name = 'content_descriptors'
            AND content_evidence_row.source = 'pics'
          )
          OR (
            content_evidence_row.field_name = 'tags'
            AND content_evidence_row.source = 'storefront'
          )
        )
    ) content_evidence ON true
    WHERE ${appPredicate}
      AND (
        content_evidence.descriptor_known
        OR content_evidence.tag_known
        OR (
          NOT content_evidence.descriptor_recorded
          AND content_safety_readiness.status = 'ready'
          AND ${descriptorValueSql} IS NOT NULL
        )
      )
      AND NOT jsonb_path_exists(
        COALESCE(${descriptorValueSql}, '{}'::jsonb),
        '${ADULT_CONTENT_JSONPATH}'
      )
      AND NOT content_evidence.adult_tag
  )`;
}

function fieldEvidenceKnownSql(
  field: OpportunityRuleField,
  sources: readonly ("pics" | "storefront")[],
  legacyKnownSql = "TRUE",
): string {
  const sourceList = sources.map((source) => `'${source}'`).join(", ");
  return `(EXISTS (
    SELECT 1
    FROM ops.app_field_evidence field_evidence
    WHERE field_evidence.appid = a.appid
      AND field_evidence.field_name = '${field}'
      AND field_evidence.source IN (${sourceList})
      AND field_evidence.evidence_state = 'known'
  ) OR (
    NOT EXISTS (
      SELECT 1
      FROM ops.app_field_evidence field_evidence_any
      WHERE field_evidence_any.appid = a.appid
        AND field_evidence_any.field_name = '${field}'
        AND field_evidence_any.source = 'pics'
    )
    AND ${PICS_READY}
    AND ${legacyKnownSql}
  ))`;
}

function resolvedFieldEvidenceValueSql(
  field: "tags" | "genres" | "categories" | "platforms" | "languages",
  legacyValueSql: string,
): string {
  return `COALESCE((
    SELECT field_value.value
    FROM ops.app_field_evidence field_value
    WHERE field_value.appid = a.appid
      AND field_value.field_name = '${field}'
      AND field_value.source IN ('pics', 'storefront')
      AND field_value.evidence_state = 'known'
    ORDER BY
      CASE field_value.source WHEN 'pics' THEN 0 ELSE 1 END,
      field_value.source_at DESC
    LIMIT 1
  ), (${legacyValueSql}))`;
}

function resolvedTextCollection(
  field: "tags" | "genres" | "categories" | "platforms" | "languages",
  legacyValueSql: string,
): FieldSql["collection"] {
  return {
    appidExpression: "a.appid",
    nameExpression: "resolved_value.name",
    relationSql: `jsonb_array_elements_text(
      ${resolvedFieldEvidenceValueSql(field, legacyValueSql)}
    ) AS resolved_value(name)`,
  };
}

const METRIC_FIELDS = new Set<OpportunityRuleField>([
  "price_cents",
  "discount_percent",
  "total_reviews",
  "positive_percentage",
  "ccu_peak",
]);
const SIGNAL_WINDOW_FIELDS = new Set<OpportunityRuleField>([
  "reviews_added_7d",
  "reviews_added_30d",
  "ccu_change_7d",
  "ccu_change_30d",
]);
const STOREFRONT_FIELDS = new Set<OpportunityRuleField>([
  "release_state",
  "is_released",
  "release_date",
  "days_until_release",
  "is_free",
  "price_cents",
  "discount_percent",
  "has_purchase_packages",
  "developer",
  "publisher",
  "has_demo",
  "demo_only",
  "no_publisher_listed",
  "self_published",
  "publisher_game_count",
  "developer_game_count",
]);
const PICS_FIELDS = new Set<OpportunityRuleField>([
  "controller_support",
  "steam_deck",
  "tags",
  "genres",
  "categories",
  "platforms",
  "languages",
  "content_descriptors",
]);

function relativeCcuGrowthSql(window: "7d" | "30d"): string {
  const first = `sw.ccu_peak_first_${window}`;
  const latest = `sw.ccu_peak_latest_${window}`;
  return `(CASE
    WHEN ${first} IS NULL OR ${latest} IS NULL THEN NULL
    WHEN ${first} = 0 THEN CASE WHEN ${latest} > 0 THEN 1.0 ELSE 0.0 END
    ELSE (${latest} - ${first})::numeric / ABS(${first})::numeric
  END)`;
}

function fieldSql(field: OpportunityRuleField): FieldSql {
  switch (field) {
    case "appid":
      return { knownSql: "TRUE", scalarSql: "a.appid" };
    case "name":
      return {
        knownSql: `a.name IS NOT NULL AND a.name <> ''`,
        scalarSql: "a.name",
      };
    case "app_type":
      return {
        knownSql: "a.type IS NOT NULL",
        scalarSql: "LOWER(a.type)",
      };
    case "release_state":
      return {
        knownSql: `${STOREFRONT_READY} AND a.release_state IS NOT NULL`,
        scalarSql: "a.release_state",
      };
    case "is_released":
      return { knownSql: STOREFRONT_READY, scalarSql: "a.is_released" };
    case "release_date":
      return {
        knownSql: STOREFRONT_READY,
        scalarSql: "a.release_date",
      };
    case "publisheriq_added_at":
      return {
        knownSql: `catalog_state.first_observation_kind = 'new'`,
        scalarSql: "catalog_state.first_observed_at",
      };
    case "days_until_release":
      return {
        knownSql: `${STOREFRONT_READY} AND a.release_date IS NOT NULL`,
        scalarSql: "(a.release_date - CURRENT_DATE)",
      };
    case "is_free":
      return { knownSql: STOREFRONT_READY, scalarSql: "a.is_free" };
    case "price_cents":
      return {
        knownSql: `${STOREFRONT_READY} AND COALESCE(a.current_price_cents, m.price_cents) IS NOT NULL`,
        scalarSql: "COALESCE(a.current_price_cents, m.price_cents)",
      };
    case "discount_percent":
      return {
        knownSql: `${STOREFRONT_READY} AND COALESCE(a.current_discount_percent, m.discount_percent) IS NOT NULL`,
        scalarSql: "COALESCE(a.current_discount_percent, m.discount_percent)",
      };
    case "has_purchase_packages":
      return {
        knownSql: STOREFRONT_READY,
        scalarSql: "a.has_purchase_packages",
      };
    case "controller_support":
      return {
        knownSql: fieldEvidenceKnownSql(
          "controller_support",
          ["pics"],
          "a.controller_support IS NOT NULL",
        ),
        scalarSql: "a.controller_support",
      };
    case "steam_deck":
      return {
        knownSql: fieldEvidenceKnownSql(
          "steam_deck",
          ["pics"],
          `EXISTS (
            SELECT 1 FROM legacy.app_steam_deck deck_known
            WHERE deck_known.appid = a.appid
          )`,
        ),
        scalarSql: `(
          SELECT deck.category
          FROM legacy.app_steam_deck deck
          WHERE deck.appid = a.appid
          LIMIT 1
        )`,
      };
    case "publisher_game_count":
      return {
        knownSql: STOREFRONT_READY,
        scalarSql: `(
          SELECT MAX(publisher.game_count)
          FROM legacy.app_publishers ap_count
          JOIN legacy.publishers publisher
            ON publisher.id = ap_count.publisher_id
          WHERE ap_count.appid = a.appid
        )`,
      };
    case "developer_game_count":
      return {
        knownSql: STOREFRONT_READY,
        scalarSql: `(
          SELECT MAX(developer.game_count)
          FROM legacy.app_developers ad_count
          JOIN legacy.developers developer
            ON developer.id = ad_count.developer_id
          WHERE ad_count.appid = a.appid
        )`,
      };
    case "total_reviews":
      return {
        knownSql: "m.total_reviews IS NOT NULL",
        scalarSql: "m.total_reviews",
      };
    case "positive_percentage":
      return {
        knownSql: "m.positive_percentage IS NOT NULL",
        scalarSql: "m.positive_percentage",
      };
    case "reviews_added_7d":
      return {
        knownSql: `sw.review_change_7d IS NOT NULL AND sw.coverage_state <> 'none'`,
        scalarSql: "sw.review_change_7d",
      };
    case "reviews_added_30d":
      return {
        knownSql: `sw.review_change_30d IS NOT NULL AND sw.coverage_state <> 'none'`,
        scalarSql: "sw.review_change_30d",
      };
    case "ccu_peak":
      return { knownSql: "m.ccu_peak IS NOT NULL", scalarSql: "m.ccu_peak" };
    case "ccu_change_7d":
      return {
        knownSql: `sw.ccu_peak_first_7d IS NOT NULL
          AND sw.ccu_peak_latest_7d IS NOT NULL
          AND sw.coverage_state <> 'none'`,
        scalarSql: relativeCcuGrowthSql("7d"),
      };
    case "ccu_change_30d":
      return {
        knownSql: `sw.ccu_peak_first_30d IS NOT NULL
          AND sw.ccu_peak_latest_30d IS NOT NULL
          AND sw.coverage_state <> 'none'`,
        scalarSql: relativeCcuGrowthSql("30d"),
      };
    case "tags":
      return {
        collection: resolvedTextCollection(
          "tags",
          `SELECT COALESCE(
            jsonb_agg(tag.name ORDER BY app_tag.rank NULLS LAST, tag.name),
            '[]'::jsonb
          )
          FROM legacy.app_steam_tags app_tag
          JOIN legacy.steam_tags tag ON tag.tag_id = app_tag.tag_id
          WHERE app_tag.appid = a.appid`,
        ),
        knownSql: fieldEvidenceKnownSql("tags", ["pics", "storefront"]),
      };
    case "genres":
      return {
        collection: resolvedTextCollection(
          "genres",
          `SELECT COALESCE(
            jsonb_agg(genre.name ORDER BY app_genre.is_primary DESC, genre.name),
            '[]'::jsonb
          )
          FROM legacy.app_genres app_genre
          JOIN legacy.steam_genres genre ON genre.genre_id = app_genre.genre_id
          WHERE app_genre.appid = a.appid`,
        ),
        knownSql: fieldEvidenceKnownSql("genres", ["pics", "storefront"]),
      };
    case "categories":
      return {
        collection: resolvedTextCollection(
          "categories",
          `SELECT COALESCE(
            jsonb_agg(category.name ORDER BY category.name),
            '[]'::jsonb
          )
          FROM legacy.app_categories app_category
          JOIN legacy.steam_categories category
            ON category.category_id = app_category.category_id
          WHERE app_category.appid = a.appid`,
        ),
        knownSql: fieldEvidenceKnownSql("categories", ["pics", "storefront"]),
      };
    case "developer":
      return {
        collection: {
          appidExpression: "app_developer.appid",
          nameExpression: "developer.name",
          relationSql: `legacy.app_developers app_developer
            JOIN legacy.developers developer
              ON developer.id = app_developer.developer_id`,
        },
        knownSql: STOREFRONT_READY,
      };
    case "publisher":
      return {
        collection: {
          appidExpression: "app_publisher.appid",
          nameExpression: "publisher.name",
          relationSql: `legacy.app_publishers app_publisher
            JOIN legacy.publishers publisher
              ON publisher.id = app_publisher.publisher_id`,
        },
        knownSql: STOREFRONT_READY,
      };
    case "platforms":
      return {
        collection: resolvedTextCollection(
          "platforms",
          "SELECT to_jsonb(string_to_array(a.platforms, ','))",
        ),
        knownSql: fieldEvidenceKnownSql(
          "platforms",
          ["pics", "storefront"],
          "a.platforms IS NOT NULL",
        ),
      };
    case "languages":
      return {
        collection: resolvedTextCollection(
          "languages",
          `SELECT CASE jsonb_typeof(a.languages)
            WHEN 'array' THEN a.languages
            WHEN 'object' THEN COALESCE((
              SELECT jsonb_agg(language.value ORDER BY language.value)
              FROM jsonb_object_keys(a.languages) AS language(value)
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END`,
        ),
        knownSql: fieldEvidenceKnownSql(
          "languages",
          ["pics", "storefront"],
          "a.languages IS NOT NULL",
        ),
      };
    case "content_descriptors":
      return {
        collection: {
          appidExpression: "a.appid",
          nameExpression: CONTENT_DESCRIPTOR_RULE_VALUE_SQL,
          relationSql: `jsonb_array_elements_text(
            jsonb_path_query_array(
              ${CONTENT_DESCRIPTOR_RESOLVED_VALUE_SQL},
              '$.*'
            )
          ) AS raw_descriptor(value)`,
        },
        knownSql: `(
          ${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}.evidence_state = 'known'
          OR (
            ${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}.appid IS NULL
            AND ${PICS_READY}
            AND a.content_descriptors IS NOT NULL
          )
        )`,
      };
    case "has_demo":
      return {
        knownSql: STOREFRONT_READY,
        scalarSql: `EXISTS (
          SELECT 1 FROM legacy.app_demos demo
          WHERE demo.parent_appid = a.appid
        )`,
      };
    case "demo_only":
      return {
        knownSql: `${STOREFRONT_READY}
          AND a.is_released IS NOT NULL
          AND a.has_purchase_packages IS NOT NULL`,
        scalarSql: `(
          a.is_released = false
          AND a.has_purchase_packages = false
          AND EXISTS (
            SELECT 1 FROM legacy.app_demos demo_only_relation
            WHERE demo_only_relation.parent_appid = a.appid
          )
        )`,
      };
    case "no_publisher_listed":
      return {
        knownSql: STOREFRONT_READY,
        scalarSql: `NOT EXISTS (
          SELECT 1 FROM legacy.app_publishers app_publisher
          WHERE app_publisher.appid = a.appid
        )`,
      };
    case "self_published":
      return {
        knownSql: STOREFRONT_READY,
        scalarSql: `${SELF_PUBLISHED_ALIAS}.appid IS NOT NULL`,
      };
  }
}

function addValue(context: SqlBuildContext, value: unknown): string {
  context.values.push(value);
  return `$${context.values.length}`;
}

function normalizedValues(value: OpportunityRuleValue | undefined): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function dateClauseSql(
  expression: string,
  clause: OpportunityRuleClause,
  operand: OpportunityDateOperand,
  context: SqlBuildContext,
): string {
  const range = opportunityDateRangeForOperand(operand, context.evaluation);
  const timestampField = clause.field === "publisheriq_added_at";
  const startValue = timestampField
    ? localDateStartUtc(range.startDate, context.evaluation.timezone)
    : range.startDate;
  const endValue = timestampField
    ? localDateStartUtc(range.endDateExclusive, context.evaluation.timezone)
    : range.endDateExclusive;
  const start = addValue(context, startValue);
  const end = addValue(context, endValue);

  switch (clause.operator) {
    case "in_window":
    case "equals":
      return `(${expression} >= ${start} AND ${expression} < ${end})`;
    case "not_equals":
      return `(${expression} < ${start} OR ${expression} >= ${end})`;
    case "greater_than":
      return `${expression} >= ${end}`;
    case "greater_than_or_equal":
      return `${expression} >= ${start}`;
    case "less_than":
      return `${expression} < ${start}`;
    case "less_than_or_equal":
      return `${expression} < ${end}`;
    default:
      return "FALSE";
  }
}

function equalitySql(
  expression: string,
  placeholder: string,
  value: unknown,
): string {
  if (typeof value === "string") {
    return `LOWER(CAST(${expression} AS text)) = LOWER(CAST(${placeholder} AS text))`;
  }
  return `${expression} IS NOT DISTINCT FROM ${placeholder}`;
}

function scalarClauseSql(
  expression: string,
  clause: OpportunityRuleClause,
  context: SqlBuildContext,
): string {
  const values = normalizedValues(clause.value);

  switch (clause.operator) {
    case "exists":
      return `${expression} IS NOT NULL`;
    case "not_exists":
      return `${expression} IS NULL`;
    case "equals": {
      const placeholder = addValue(context, clause.value);
      return equalitySql(expression, placeholder, clause.value);
    }
    case "not_equals": {
      const placeholder = addValue(context, clause.value);
      return `NOT (${equalitySql(expression, placeholder, clause.value)})`;
    }
    case "in":
    case "not_in": {
      const comparisons = values.map((value) => {
        const placeholder = addValue(context, value);
        return equalitySql(expression, placeholder, value);
      });
      const matched =
        comparisons.length === 0 ? "FALSE" : `(${comparisons.join(" OR ")})`;
      return clause.operator === "in" ? matched : `NOT ${matched}`;
    }
    case "greater_than":
    case "greater_than_or_equal":
    case "less_than":
    case "less_than_or_equal": {
      const operator = {
        greater_than: ">",
        greater_than_or_equal: ">=",
        less_than: "<",
        less_than_or_equal: "<=",
      }[clause.operator];
      const placeholder = addValue(context, clause.value);
      return `${expression} ${operator} ${placeholder}`;
    }
    case "between": {
      if (!Array.isArray(clause.value) || clause.value.length !== 2) {
        return "FALSE";
      }
      const lower = addValue(context, clause.value[0]);
      const upper = addValue(context, clause.value[1]);
      return `${expression} BETWEEN ${lower} AND ${upper}`;
    }
    case "in_window":
      return "FALSE";
    case "contains":
    case "not_contains": {
      const comparisons = values.map((value) => {
        const placeholder = addValue(context, `%${String(value)}%`);
        return `LOWER(CAST(${expression} AS text)) LIKE LOWER(${placeholder})`;
      });
      if (comparisons.length === 0) {
        return clause.operator === "contains" ? "FALSE" : "TRUE";
      }
      return clause.operator === "contains"
        ? `(${comparisons.join(" AND ")})`
        : `(${comparisons.map((comparison) => `NOT (${comparison})`).join(" AND ")})`;
    }
  }
}

function collectionClauseSql(
  field: FieldSql,
  clause: OpportunityRuleClause,
  context: SqlBuildContext,
): string {
  const collection = field.collection!;
  const expected = normalizedValues(clause.value);
  const existsSql = (value: unknown): string => {
    const placeholder = addValue(context, value);
    return `EXISTS (
      SELECT 1
      FROM ${collection.relationSql}
      WHERE ${collection.appidExpression} = a.appid
        AND LOWER(${collection.nameExpression}) = LOWER(CAST(${placeholder} AS text))
    )`;
  };

  if (clause.operator === "exists") {
    return `EXISTS (
      SELECT 1 FROM ${collection.relationSql}
      WHERE ${collection.appidExpression} = a.appid
    )`;
  }
  if (clause.operator === "not_exists") {
    return `NOT EXISTS (
      SELECT 1 FROM ${collection.relationSql}
      WHERE ${collection.appidExpression} = a.appid
    )`;
  }

  const comparisons = expected.map(existsSql);
  if (clause.operator === "not_contains" || clause.operator === "not_in") {
    return comparisons.length === 0
      ? "TRUE"
      : `(${comparisons.map((comparison) => `NOT (${comparison})`).join(" AND ")})`;
  }
  if (
    clause.operator === "contains" ||
    clause.operator === "in" ||
    clause.operator === "equals"
  ) {
    return comparisons.length === 0
      ? "FALSE"
      : `(${comparisons.join(" AND ")})`;
  }

  return "FALSE";
}

function clauseTrueSql(
  clause: OpportunityRuleClause,
  context: SqlBuildContext,
): string {
  const field = fieldSql(clause.field);
  const dateOperand = isOpportunityDateField(clause.field)
    ? opportunityDateOperandFromValue(clause.value)
    : null;
  const comparison = field.collection
    ? collectionClauseSql(field, clause, context)
    : dateOperand
      ? dateClauseSql(field.scalarSql ?? "NULL", clause, dateOperand, context)
      : scalarClauseSql(
          field.scalarSql ?? field.textCollectionSql ?? "NULL",
          clause,
          context,
        );
  return `((${field.knownSql}) AND COALESCE((${comparison}), FALSE))`;
}

function groupTrueSql(
  group: OpportunityRuleGroup,
  context: SqlBuildContext,
): string {
  const clauses = group.clauses.map((clause) => clauseTrueSql(clause, context));
  if (clauses.length === 0) {
    return group.operator === "all" ? "TRUE" : "FALSE";
  }
  return `(${clauses.join(group.operator === "all" ? " AND " : " OR ")})`;
}

export function compileOpportunityPreview(
  rules: OpportunityRuleSet,
  evaluation: OpportunityEvaluationContext = {
    asOf: new Date().toISOString(),
    timezone: "UTC",
  },
): OpportunityCompiledPreview {
  assertOpportunityRuleSet(rules);
  const context: SqlBuildContext = { evaluation, values: [] };
  const requiredGroupSql = rules.required.map((group) => ({
    group,
    sql: groupTrueSql(group, context),
  }));
  const contentDescriptorReadinessSql = fieldSql(
    "content_descriptors",
  ).knownSql;
  const contentSafetyReadinessSql = `(
    (${contentDescriptorReadinessSql}) OR (${CONTENT_TAGS_READY_SQL})
  )`;
  const adultContentSql = `(
    ((${contentDescriptorReadinessSql}) AND jsonb_path_exists(
      ${CONTENT_DESCRIPTOR_RESOLVED_VALUE_SQL},
      '${ADULT_CONTENT_JSONPATH}'
    ))
    OR ((${CONTENT_TAGS_READY_SQL}) AND (${ADULT_CONTENT_TAGS_SQL}))
  )`;
  const excludedGroupSql = rules.excluded.map((group) =>
    groupTrueSql(group, context),
  );
  const requiredStages = [
    {
      groupId: CONTENT_SAFETY_READINESS_GROUP_ID,
      label: CONTENT_SAFETY_READINESS_LABEL,
      matchSql: contentSafetyReadinessSql,
    },
    ...requiredGroupSql.map((entry, index) => ({
      groupId: entry.group.id,
      label: entry.group.label,
      matchSql: `(${[
        contentSafetyReadinessSql,
        ...requiredGroupSql.slice(0, index + 1).map((required) => required.sql),
      ].join(" AND ")})`,
    })),
  ];
  const requiredSql =
    requiredGroupSql.length === 0
      ? "TRUE"
      : requiredGroupSql.map((entry) => entry.sql).join(" AND ");
  const excludedSql = [adultContentSql, ...excludedGroupSql].join(" OR ");
  const fields = Array.from(
    new Set([
      ...[...rules.required, ...rules.preferred, ...rules.excluded].flatMap(
        (group) => group.clauses.map((clause) => clause.field),
      ),
      "tags" as const,
      "content_descriptors" as const,
    ]),
  );

  return {
    coverageFields: fields.map((field) => ({
      field,
      knownSql: fieldSql(field).knownSql,
    })),
    excludedSql,
    fromSql: opportunityPreviewFromSql(fields),
    matchSql: `((${contentSafetyReadinessSql}) AND (${requiredSql}) AND NOT (${excludedSql}))`,
    requiredGroups: [
      {
        groupId: CONTENT_SAFETY_READINESS_GROUP_ID,
        label: CONTENT_SAFETY_READINESS_LABEL,
        matchSql: contentSafetyReadinessSql,
      },
      ...requiredGroupSql.map((entry) => ({
        groupId: entry.group.id,
        label: entry.group.label,
        matchSql: entry.sql,
      })),
    ],
    requiredStages,
    values: context.values,
  };
}

export function opportunityPreviewFromSql(
  requestedFields: readonly OpportunityRuleField[] | boolean,
): string {
  const fields = new Set<OpportunityRuleField>(
    typeof requestedFields === "boolean"
      ? requestedFields
        ? ["publisheriq_added_at"]
        : []
      : requestedFields,
  );
  const joins = [
    [...fields].some((field) => METRIC_FIELDS.has(field))
      ? "LEFT JOIN legacy.latest_daily_metrics m ON m.appid = a.appid"
      : null,
    [...fields].some((field) => SIGNAL_WINDOW_FIELDS.has(field))
      ? "LEFT JOIN metrics.app_signal_windows_v1 sw ON sw.appid = a.appid"
      : null,
    fields.has("publisheriq_added_at")
      ? `LEFT JOIN ops.app_catalog_state catalog_state
    ON catalog_state.appid = a.appid`
      : null,
    fields.has("self_published")
      ? `LEFT JOIN (
      SELECT DISTINCT app_developer.appid
      FROM legacy.app_developers app_developer
      JOIN legacy.developers developer
        ON developer.id = app_developer.developer_id
      JOIN legacy.app_publishers app_publisher
        ON app_publisher.appid = app_developer.appid
      JOIN legacy.publishers publisher
        ON publisher.id = app_publisher.publisher_id
      WHERE developer.normalized_name IS NOT NULL
        AND publisher.normalized_name = developer.normalized_name
    ) ${SELF_PUBLISHED_ALIAS}
    ON ${SELF_PUBLISHED_ALIAS}.appid = a.appid`
      : null,
    fields.has("content_descriptors")
      ? `LEFT JOIN ops.app_field_evidence ${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}
    ON ${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}.appid = a.appid
    AND ${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}.field_name = 'content_descriptors'
    AND ${CONTENT_DESCRIPTORS_EVIDENCE_ALIAS}.source = 'pics'`
      : null,
    fields.has("tags")
      ? `LEFT JOIN ops.app_field_evidence ${CONTENT_TAGS_EVIDENCE_ALIAS}
    ON ${CONTENT_TAGS_EVIDENCE_ALIAS}.appid = a.appid
    AND ${CONTENT_TAGS_EVIDENCE_ALIAS}.field_name = 'tags'
    AND ${CONTENT_TAGS_EVIDENCE_ALIAS}.source = 'storefront'`
      : null,
    [...fields].some((field) => STOREFRONT_FIELDS.has(field))
      ? `LEFT JOIN ops.app_data_readiness readiness_storefront
    ON readiness_storefront.appid = a.appid
    AND readiness_storefront.source = 'storefront'`
      : null,
    [...fields].some((field) => PICS_FIELDS.has(field))
      ? `LEFT JOIN ops.app_data_readiness readiness_pics
    ON readiness_pics.appid = a.appid
    AND readiness_pics.source = 'pics'`
      : null,
  ].filter((join): join is string => join !== null);
  return `
  FROM legacy.apps a
  ${joins.join("\n  ")}
  WHERE a.type IN ('game', 'Game')
    AND COALESCE(a.is_delisted, false) = false
`;
}

export const OPPORTUNITY_PREVIEW_FROM_SQL = opportunityPreviewFromSql(false);
