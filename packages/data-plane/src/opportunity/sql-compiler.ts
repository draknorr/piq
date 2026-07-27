import type {
  OpportunityRuleClause,
  OpportunityRuleField,
  OpportunityRuleGroup,
  OpportunityRuleSet,
  OpportunityRuleValue,
} from "./types.js";
import { assertOpportunityRuleSet } from "./rules.js";

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
  matchSql: string;
  requiredStages: Array<{
    groupId: string;
    label: string;
    matchSql: string;
  }>;
  values: unknown[];
}

interface SqlBuildContext {
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

const STOREFRONT_READY = `EXISTS (
  SELECT 1
  FROM ops.app_data_readiness readiness_storefront
  WHERE readiness_storefront.appid = a.appid
    AND readiness_storefront.source = 'storefront'
    AND readiness_storefront.status = 'ready'
)`;

const PICS_READY = `EXISTS (
  SELECT 1
  FROM ops.app_data_readiness readiness_pics
  WHERE readiness_pics.appid = a.appid
    AND readiness_pics.source = 'pics'
    AND readiness_pics.status = 'ready'
)`;

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
      return { knownSql: "a.type IS NOT NULL", scalarSql: "a.type" };
    case "release_state":
      return {
        knownSql: `${STOREFRONT_READY} AND a.release_state IS NOT NULL`,
        scalarSql: "a.release_state",
      };
    case "is_released":
      return { knownSql: STOREFRONT_READY, scalarSql: "a.is_released" };
    case "release_date":
      return {
        knownSql: `${STOREFRONT_READY} AND a.release_date IS NOT NULL`,
        scalarSql: "a.release_date",
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
        knownSql: `${PICS_READY} AND a.controller_support IS NOT NULL`,
        scalarSql: "a.controller_support",
      };
    case "steam_deck":
      return {
        knownSql: `${PICS_READY} AND EXISTS (
          SELECT 1 FROM legacy.app_steam_deck deck_known
          WHERE deck_known.appid = a.appid
        )`,
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
        collection: {
          appidExpression: "app_tag.appid",
          nameExpression: "tag.name",
          relationSql: `legacy.app_steam_tags app_tag
            JOIN legacy.steam_tags tag ON tag.tag_id = app_tag.tag_id`,
        },
        knownSql: PICS_READY,
      };
    case "genres":
      return {
        collection: {
          appidExpression: "app_genre.appid",
          nameExpression: "genre.name",
          relationSql: `legacy.app_genres app_genre
            JOIN legacy.steam_genres genre ON genre.genre_id = app_genre.genre_id`,
        },
        knownSql: PICS_READY,
      };
    case "categories":
      return {
        collection: {
          appidExpression: "app_category.appid",
          nameExpression: "category.name",
          relationSql: `legacy.app_categories app_category
            JOIN legacy.steam_categories category
              ON category.category_id = app_category.category_id`,
        },
        knownSql: PICS_READY,
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
        knownSql: `${PICS_READY} AND a.platforms IS NOT NULL`,
        textCollectionSql: "a.platforms",
      };
    case "languages":
      return {
        knownSql: `${PICS_READY} AND a.languages IS NOT NULL`,
        textCollectionSql: "a.languages::text",
      };
    case "content_descriptors":
      return {
        knownSql: `${PICS_READY} AND a.content_descriptors IS NOT NULL`,
        textCollectionSql: "a.content_descriptors::text",
      };
    case "has_demo":
      return {
        knownSql: PICS_READY,
        scalarSql: `EXISTS (
          SELECT 1 FROM legacy.app_demos demo
          WHERE demo.parent_appid = a.appid
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
        scalarSql: `EXISTS (
          SELECT 1
          FROM legacy.app_developers app_developer
          JOIN legacy.developers developer
            ON developer.id = app_developer.developer_id
          JOIN legacy.app_publishers app_publisher
            ON app_publisher.appid = app_developer.appid
          JOIN legacy.publishers publisher
            ON publisher.id = app_publisher.publisher_id
          WHERE app_developer.appid = a.appid
            AND developer.normalized_name IS NOT NULL
            AND publisher.normalized_name = developer.normalized_name
        )`,
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
  const comparison = field.collection
    ? collectionClauseSql(field, clause, context)
    : scalarClauseSql(
        field.scalarSql ?? field.textCollectionSql ?? "NULL",
        clause,
        context,
      );
  return `((${field.knownSql}) AND (${comparison}))`;
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
): OpportunityCompiledPreview {
  assertOpportunityRuleSet(rules);
  const context: SqlBuildContext = { values: [] };
  const requiredGroupSql = rules.required.map((group) => ({
    group,
    sql: groupTrueSql(group, context),
  }));
  const excludedGroupSql = rules.excluded.map((group) =>
    groupTrueSql(group, context),
  );
  const requiredStages = requiredGroupSql.map((entry, index) => ({
    groupId: entry.group.id,
    label: entry.group.label,
    matchSql:
      index === 0
        ? entry.sql
        : `(${requiredGroupSql
            .slice(0, index + 1)
            .map((required) => required.sql)
            .join(" AND ")})`,
  }));
  const requiredSql =
    requiredGroupSql.length === 0
      ? "TRUE"
      : requiredGroupSql.map((entry) => entry.sql).join(" AND ");
  const excludedSql =
    excludedGroupSql.length === 0 ? "FALSE" : excludedGroupSql.join(" OR ");
  const fields = Array.from(
    new Set(
      [...rules.required, ...rules.preferred, ...rules.excluded].flatMap(
        (group) => group.clauses.map((clause) => clause.field),
      ),
    ),
  );

  return {
    coverageFields: fields.map((field) => ({
      field,
      knownSql: fieldSql(field).knownSql,
    })),
    excludedSql,
    matchSql: `((${requiredSql}) AND NOT (${excludedSql}))`,
    requiredStages,
    values: context.values,
  };
}

export const OPPORTUNITY_PREVIEW_FROM_SQL = `
  FROM legacy.apps a
  LEFT JOIN legacy.latest_daily_metrics m ON m.appid = a.appid
  LEFT JOIN metrics.app_signal_windows_v1 sw ON sw.appid = a.appid
  WHERE a.type = 'game'
    AND COALESCE(a.is_delisted, false) = false
`;
