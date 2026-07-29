import { createHash } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  OPPORTUNITY_COHORT_VERSION,
  OPPORTUNITY_HEALTH_VERSION,
  OPPORTUNITY_MARKET_VERSION,
  OPPORTUNITY_RANKING_VERSION,
  OPPORTUNITY_RULE_FIELDS,
  OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
  type OpportunityBootstrapResponse,
  type OpportunityChannelPreferenceSummary,
  type OpportunityDailyOverview,
  type OpportunityEvaluationInput,
  type OpportunityFieldValue,
  type OpportunityGameRecord,
  type OpportunityIdentity,
  type OpportunityPreviewRepresentative,
  type OpportunityProfileDetail,
  type OpportunityProfileSummary,
  type OpportunityProfileVersion,
  type OpportunityPresetSummary,
  type OpportunityResultSummary,
  type OpportunityRuleField,
  type OpportunityRuleSet,
  type OpportunitySignalFamily,
} from "./types.js";
import {
  compileOpportunityPreview,
  OPPORTUNITY_PREVIEW_FROM_SQL,
  type OpportunityCompiledPreview,
} from "./sql-compiler.js";
import {
  describeOpportunityRuleSet,
  supportsReleasedMarketHealth,
} from "./rules.js";

interface WorkspaceContext {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
}

interface PreviewAggregateRow extends QueryResultRow {
  coverage_counts: Record<string, number> | string;
  stage_counts: Record<string, number> | string;
  total_catalog: string | number;
  total_matches: string | number;
}

interface RuleInputRow extends QueryResultRow {
  appid: number;
  app_type: string | null;
  catalog_source_at: Date | string | null;
  categories: string[] | null;
  ccu_change_30d: string | number | null;
  ccu_change_7d: string | number | null;
  ccu_peak: number | null;
  content_descriptors: unknown;
  controller_support: string | null;
  developer_game_count: number | null;
  developers: string[] | null;
  discount_percent: number | null;
  genres: string[] | null;
  has_demo: boolean;
  has_purchase_packages: boolean | null;
  is_free: boolean | null;
  is_released: boolean | null;
  languages: unknown;
  market_status: string | null;
  name: string;
  pics_source_at: Date | string | null;
  pics_status: string | null;
  platforms: string | null;
  positive_percentage: string | number | null;
  price_cents: number | null;
  publisher_game_count: number | null;
  publishers: string[] | null;
  release_date: Date | string | null;
  release_state: string | null;
  reviews_added_30d: string | number | null;
  reviews_added_7d: string | number | null;
  source_max_metric_date: Date | string | null;
  steam_deck: string | null;
  storefront_source_at: Date | string | null;
  storefront_status: string | null;
  tags: string[] | null;
  total_reviews: number | null;
}

export const OPPORTUNITY_RULE_INPUT_FIELD_SOURCES: Record<
  OpportunityRuleField,
  "catalog" | "market_metrics" | "pics" | "storefront"
> = {
  app_type: "catalog",
  appid: "catalog",
  categories: "pics",
  ccu_change_30d: "market_metrics",
  ccu_change_7d: "market_metrics",
  ccu_peak: "market_metrics",
  content_descriptors: "pics",
  controller_support: "pics",
  days_until_release: "storefront",
  developer: "storefront",
  developer_game_count: "storefront",
  discount_percent: "storefront",
  genres: "pics",
  has_demo: "pics",
  has_purchase_packages: "storefront",
  is_free: "storefront",
  is_released: "storefront",
  languages: "pics",
  name: "catalog",
  no_publisher_listed: "storefront",
  platforms: "pics",
  positive_percentage: "market_metrics",
  price_cents: "storefront",
  publisher: "storefront",
  publisher_game_count: "storefront",
  release_date: "storefront",
  release_state: "storefront",
  reviews_added_30d: "market_metrics",
  reviews_added_7d: "market_metrics",
  self_published: "storefront",
  steam_deck: "pics",
  tags: "pics",
  total_reviews: "market_metrics",
};

const RULE_INPUT_PROJECTION_BATCH_SIZE = 500;

interface ProfileRow extends QueryResultRow {
  current_version: number | null;
  description: string | null;
  id: string;
  immediate_full_match_enabled: boolean;
  local_delivery_time: string;
  name: string;
  next_evaluation_at: Date | string | null;
  source_preset_name: string | null;
  status: OpportunityProfileSummary["status"];
  timezone: string;
  updated_at: Date | string;
}

interface PresetRow extends QueryResultRow {
  description: string | null;
  health_state: OpportunityPresetSummary["healthState"];
  id: string;
  name: string;
  rules: OpportunityRuleSet;
  slug: string;
  version: number;
}

interface ResultRow extends QueryResultRow {
  appid: number;
  change: OpportunityResultSummary["change"];
  confidence: OpportunityResultSummary["confidence"];
  created_at: Date | string;
  event_fingerprint: string;
  event_label: OpportunityResultSummary["eventLabel"];
  id: string;
  market_potential: OpportunityResultSummary["marketPotential"];
  matched_profiles: Array<{ id: string; name: string }> | null;
  name: string;
  rank: number | null;
  rank_components: OpportunityResultSummary["rankComponents"];
  score: string | number | null;
  strongest_evidence: string[] | null;
  why_now: string;
}

interface LatestRunRow extends QueryResultRow {
  completed_at: Date | string | null;
  coverage_warnings: string[] | null;
  id: string;
  result_count: number;
  run_kind: "daily" | "manual" | "replay";
  started_at: Date | string;
  status: "running" | "completed" | "failed" | "cancelled";
  window_end: Date | string;
  window_start: Date | string;
  profiles_evaluated: number;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function numberValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordValue(
  value: Record<string, number> | string,
): Record<string, number> {
  return typeof value === "string"
    ? (JSON.parse(value) as Record<string, number>)
    : value;
}

function stableSlug(userId: string): string {
  return `personal-${userId.toLowerCase()}`;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ruleInputSourceWatermarks(
  input: OpportunityEvaluationInput,
): Record<string, unknown> {
  return Object.fromEntries(
    OPPORTUNITY_RULE_FIELDS.map((field) => {
      const evidence = input.fields[field];
      return [
        field,
        evidence
          ? {
              calculationVersion: evidence.calculationVersion ?? null,
              source: evidence.source,
              sourceAt: evidence.sourceAt,
              state: evidence.state,
            }
          : null,
      ];
    }),
  );
}

function knownField(
  value: unknown,
  source: string,
  sourceAt: string | null,
  options?: {
    calculationVersion?: string;
    confidence?: OpportunityFieldValue["confidence"];
    evidenceClass?: OpportunityFieldValue["evidenceClass"];
  },
): OpportunityFieldValue {
  return {
    calculationVersion: options?.calculationVersion ?? null,
    confidence: options?.confidence ?? "high",
    evidenceClass: options?.evidenceClass ?? "observed_fact",
    source,
    sourceAt,
    state: "known",
    value,
  };
}

function unknownField(
  source: string,
  reason: string,
  sourceAt: string | null = null,
): OpportunityFieldValue {
  return {
    confidence: "directional",
    evidenceClass: "observed_fact",
    reason,
    source,
    sourceAt,
    state: "unknown",
    value: null,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : value
            .split(/[,|]/)
            .map((item) => item.trim())
            .filter(Boolean);
    } catch {
      return value
        .split(/[,|]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function assertOpportunityRuleInputComplete(
  input: OpportunityEvaluationInput,
): void {
  const missing = OPPORTUNITY_RULE_FIELDS.filter(
    (field) => input.fields[field] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `Opportunity rule-input projection ${OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION} does not support: ${missing.join(", ")}.`,
    );
  }
}

function buildOpportunityRuleInput(
  row: RuleInputRow,
): OpportunityEvaluationInput {
  const storefrontReady = row.storefront_status === "ready";
  const picsReady = row.pics_status === "ready";
  const catalogSourceAt = iso(row.catalog_source_at);
  const storefrontSourceAt = iso(row.storefront_source_at);
  const picsSourceAt = iso(row.pics_source_at);
  const metricSourceAt = iso(row.source_max_metric_date);
  const fields: OpportunityEvaluationInput["fields"] = {
    appid: knownField(row.appid, "legacy.apps", catalogSourceAt),
    name: knownField(row.name, "legacy.apps", catalogSourceAt),
    app_type: knownField(row.app_type, "legacy.apps", catalogSourceAt),
  };

  const setStorefront = (field: OpportunityRuleField, value: unknown): void => {
    fields[field] = storefrontReady
      ? knownField(value, "steam_storefront", storefrontSourceAt)
      : unknownField(
          "steam_storefront",
          `Storefront readiness is ${row.storefront_status ?? "unknown"}.`,
          storefrontSourceAt,
        );
  };
  const setPics = (field: OpportunityRuleField, value: unknown): void => {
    fields[field] = picsReady
      ? knownField(value, "steam_pics", picsSourceAt)
      : unknownField(
          "steam_pics",
          `PICS readiness is ${row.pics_status ?? "unknown"}.`,
          picsSourceAt,
        );
  };
  const setMetric = (
    field: OpportunityRuleField,
    value: unknown,
    calculationVersion?: string,
  ): void => {
    fields[field] =
      value !== null && value !== undefined
        ? knownField(value, "tiger_metrics", metricSourceAt, {
            calculationVersion,
            evidenceClass: "derived_metric",
          })
        : unknownField(
            "tiger_metrics",
            `Market metric is ${row.market_status ?? "unknown"} for this game.`,
            metricSourceAt,
          );
  };

  setStorefront("is_released", row.is_released);
  setStorefront("release_state", row.release_state);
  setStorefront("release_date", iso(row.release_date));
  setStorefront(
    "days_until_release",
    row.release_date
      ? Math.ceil(
          (new Date(row.release_date).getTime() - Date.now()) / 86_400_000,
        )
      : null,
  );
  setStorefront("is_free", row.is_free);
  setStorefront("price_cents", row.price_cents);
  setStorefront("discount_percent", row.discount_percent);
  setStorefront("has_purchase_packages", row.has_purchase_packages);
  setStorefront("publisher", row.publishers ?? []);
  setStorefront("developer", row.developers ?? []);
  setStorefront("no_publisher_listed", (row.publishers ?? []).length === 0);
  setStorefront(
    "self_published",
    (row.publishers ?? []).some((publisher) =>
      (row.developers ?? []).some(
        (developer) =>
          publisher.toLocaleLowerCase() === developer.toLocaleLowerCase(),
      ),
    ),
  );
  setStorefront("publisher_game_count", row.publisher_game_count);
  setStorefront("developer_game_count", row.developer_game_count);

  setPics("tags", row.tags ?? []);
  setPics("genres", row.genres ?? []);
  setPics("categories", row.categories ?? []);
  setPics("platforms", normalizeStringArray(row.platforms));
  setPics("controller_support", row.controller_support);
  setPics("steam_deck", row.steam_deck);
  setPics("languages", normalizeStringArray(row.languages));
  setPics("content_descriptors", normalizeStringArray(row.content_descriptors));
  setPics("has_demo", row.has_demo);

  setMetric("total_reviews", row.total_reviews);
  setMetric("positive_percentage", numberValue(row.positive_percentage));
  setMetric("ccu_peak", row.ccu_peak);
  setMetric(
    "reviews_added_7d",
    numberValue(row.reviews_added_7d),
    "signal-windows/v1",
  );
  setMetric(
    "reviews_added_30d",
    numberValue(row.reviews_added_30d),
    "signal-windows/v1",
  );
  setMetric(
    "ccu_change_7d",
    numberValue(row.ccu_change_7d),
    "signal-windows/v1",
  );
  setMetric(
    "ccu_change_30d",
    numberValue(row.ccu_change_30d),
    "signal-windows/v1",
  );

  const input = {
    appid: row.appid,
    fields,
    name: row.name,
  };
  assertOpportunityRuleInputComplete(input);
  return input;
}

const RULE_INPUT_SELECT = `
  SELECT
    a.appid,
    a.name,
    a.type AS app_type,
    a.is_free,
    a.is_released,
    a.release_state,
    a.release_date,
    COALESCE(a.current_price_cents, m.price_cents) AS price_cents,
    COALESCE(a.current_discount_percent, m.discount_percent) AS discount_percent,
    a.has_purchase_packages,
    a.platforms,
    a.controller_support,
    a.languages,
    a.content_descriptors,
    m.total_reviews,
    m.positive_percentage,
    m.ccu_peak,
    sw.review_change_7d AS reviews_added_7d,
    sw.review_change_30d AS reviews_added_30d,
    CASE
      WHEN sw.ccu_peak_first_7d IS NULL OR sw.ccu_peak_latest_7d IS NULL THEN NULL
      WHEN sw.ccu_peak_first_7d = 0
        THEN CASE WHEN sw.ccu_peak_latest_7d > 0 THEN 1.0 ELSE 0.0 END
      ELSE
        (sw.ccu_peak_latest_7d - sw.ccu_peak_first_7d)::numeric
        / ABS(sw.ccu_peak_first_7d)::numeric
    END AS ccu_change_7d,
    CASE
      WHEN sw.ccu_peak_first_30d IS NULL OR sw.ccu_peak_latest_30d IS NULL THEN NULL
      WHEN sw.ccu_peak_first_30d = 0
        THEN CASE WHEN sw.ccu_peak_latest_30d > 0 THEN 1.0 ELSE 0.0 END
      ELSE
        (sw.ccu_peak_latest_30d - sw.ccu_peak_first_30d)::numeric
        / ABS(sw.ccu_peak_first_30d)::numeric
    END AS ccu_change_30d,
    sw.source_max_metric_date,
    readiness_catalog.source_at AS catalog_source_at,
    readiness_storefront.status AS storefront_status,
    readiness_storefront.source_at AS storefront_source_at,
    readiness_pics.status AS pics_status,
    readiness_pics.source_at AS pics_source_at,
    readiness_market.status AS market_status,
    COALESCE((
      SELECT array_agg(tag.name ORDER BY app_tag.rank NULLS LAST, tag.name)
      FROM legacy.app_steam_tags app_tag
      JOIN legacy.steam_tags tag ON tag.tag_id = app_tag.tag_id
      WHERE app_tag.appid = a.appid
    ), '{}'::text[]) AS tags,
    COALESCE((
      SELECT array_agg(genre.name ORDER BY app_genre.is_primary DESC, genre.name)
      FROM legacy.app_genres app_genre
      JOIN legacy.steam_genres genre ON genre.genre_id = app_genre.genre_id
      WHERE app_genre.appid = a.appid
    ), '{}'::text[]) AS genres,
    COALESCE((
      SELECT array_agg(category.name ORDER BY category.name)
      FROM legacy.app_categories app_category
      JOIN legacy.steam_categories category
        ON category.category_id = app_category.category_id
      WHERE app_category.appid = a.appid
    ), '{}'::text[]) AS categories,
    COALESCE((
      SELECT array_agg(publisher.name ORDER BY publisher.name)
      FROM legacy.app_publishers app_publisher
      JOIN legacy.publishers publisher ON publisher.id = app_publisher.publisher_id
      WHERE app_publisher.appid = a.appid
    ), '{}'::text[]) AS publishers,
    COALESCE((
      SELECT array_agg(developer.name ORDER BY developer.name)
      FROM legacy.app_developers app_developer
      JOIN legacy.developers developer ON developer.id = app_developer.developer_id
      WHERE app_developer.appid = a.appid
    ), '{}'::text[]) AS developers,
    (
      SELECT MAX(publisher.game_count)
      FROM legacy.app_publishers app_publisher
      JOIN legacy.publishers publisher ON publisher.id = app_publisher.publisher_id
      WHERE app_publisher.appid = a.appid
    ) AS publisher_game_count,
    (
      SELECT MAX(developer.game_count)
      FROM legacy.app_developers app_developer
      JOIN legacy.developers developer ON developer.id = app_developer.developer_id
      WHERE app_developer.appid = a.appid
    ) AS developer_game_count,
    EXISTS (
      SELECT 1 FROM legacy.app_demos demo WHERE demo.parent_appid = a.appid
    ) AS has_demo,
    (
      SELECT deck.category
      FROM legacy.app_steam_deck deck
      WHERE deck.appid = a.appid
      LIMIT 1
    ) AS steam_deck
  FROM legacy.apps a
  LEFT JOIN legacy.latest_daily_metrics m ON m.appid = a.appid
  LEFT JOIN metrics.app_signal_windows_v1 sw ON sw.appid = a.appid
  LEFT JOIN ops.app_data_readiness readiness_catalog
    ON readiness_catalog.appid = a.appid
    AND readiness_catalog.source = 'catalog'
  LEFT JOIN ops.app_data_readiness readiness_storefront
    ON readiness_storefront.appid = a.appid
    AND readiness_storefront.source = 'storefront'
  LEFT JOIN ops.app_data_readiness readiness_pics
    ON readiness_pics.appid = a.appid
    AND readiness_pics.source = 'pics'
  LEFT JOIN ops.app_data_readiness readiness_market
    ON readiness_market.appid = a.appid
    AND readiness_market.source = 'market_metrics'
`;

const RULE_INPUT_BATCH_SELECT = `
  WITH input_appids AS MATERIALIZED (
    SELECT DISTINCT input.appid
    FROM unnest($1::integer[]) AS input(appid)
  ),
  tag_values AS MATERIALIZED (
    SELECT
      app_tag.appid,
      array_agg(tag.name ORDER BY app_tag.rank NULLS LAST, tag.name) AS tags
    FROM legacy.app_steam_tags app_tag
    JOIN input_appids input ON input.appid = app_tag.appid
    JOIN legacy.steam_tags tag ON tag.tag_id = app_tag.tag_id
    GROUP BY app_tag.appid
  ),
  genre_values AS MATERIALIZED (
    SELECT
      app_genre.appid,
      array_agg(
        genre.name
        ORDER BY app_genre.is_primary DESC, genre.name
      ) AS genres
    FROM legacy.app_genres app_genre
    JOIN input_appids input ON input.appid = app_genre.appid
    JOIN legacy.steam_genres genre
      ON genre.genre_id = app_genre.genre_id
    GROUP BY app_genre.appid
  ),
  category_values AS MATERIALIZED (
    SELECT
      app_category.appid,
      array_agg(category.name ORDER BY category.name) AS categories
    FROM legacy.app_categories app_category
    JOIN input_appids input ON input.appid = app_category.appid
    JOIN legacy.steam_categories category
      ON category.category_id = app_category.category_id
    GROUP BY app_category.appid
  ),
  publisher_values AS MATERIALIZED (
    SELECT
      app_publisher.appid,
      array_agg(publisher.name ORDER BY publisher.name) AS publishers,
      max(publisher.game_count) AS publisher_game_count
    FROM legacy.app_publishers app_publisher
    JOIN input_appids input ON input.appid = app_publisher.appid
    JOIN legacy.publishers publisher
      ON publisher.id = app_publisher.publisher_id
    GROUP BY app_publisher.appid
  ),
  developer_values AS MATERIALIZED (
    SELECT
      app_developer.appid,
      array_agg(developer.name ORDER BY developer.name) AS developers,
      max(developer.game_count) AS developer_game_count
    FROM legacy.app_developers app_developer
    JOIN input_appids input ON input.appid = app_developer.appid
    JOIN legacy.developers developer
      ON developer.id = app_developer.developer_id
    GROUP BY app_developer.appid
  ),
  demo_values AS MATERIALIZED (
    SELECT demo.parent_appid AS appid, true AS has_demo
    FROM legacy.app_demos demo
    JOIN input_appids input ON input.appid = demo.parent_appid
    GROUP BY demo.parent_appid
  )
  SELECT
    a.appid,
    a.name,
    a.type AS app_type,
    a.is_free,
    a.is_released,
    a.release_state,
    a.release_date,
    COALESCE(a.current_price_cents, m.price_cents) AS price_cents,
    COALESCE(
      a.current_discount_percent,
      m.discount_percent
    ) AS discount_percent,
    a.has_purchase_packages,
    a.platforms,
    a.controller_support,
    a.languages,
    a.content_descriptors,
    m.total_reviews,
    m.positive_percentage,
    m.ccu_peak,
    sw.review_change_7d AS reviews_added_7d,
    sw.review_change_30d AS reviews_added_30d,
    CASE
      WHEN sw.ccu_peak_first_7d IS NULL
        OR sw.ccu_peak_latest_7d IS NULL
        THEN NULL
      WHEN sw.ccu_peak_first_7d = 0
        THEN CASE WHEN sw.ccu_peak_latest_7d > 0 THEN 1.0 ELSE 0.0 END
      ELSE
        (sw.ccu_peak_latest_7d - sw.ccu_peak_first_7d)::numeric
        / ABS(sw.ccu_peak_first_7d)::numeric
    END AS ccu_change_7d,
    CASE
      WHEN sw.ccu_peak_first_30d IS NULL
        OR sw.ccu_peak_latest_30d IS NULL
        THEN NULL
      WHEN sw.ccu_peak_first_30d = 0
        THEN CASE WHEN sw.ccu_peak_latest_30d > 0 THEN 1.0 ELSE 0.0 END
      ELSE
        (sw.ccu_peak_latest_30d - sw.ccu_peak_first_30d)::numeric
        / ABS(sw.ccu_peak_first_30d)::numeric
    END AS ccu_change_30d,
    sw.source_max_metric_date,
    readiness_catalog.source_at AS catalog_source_at,
    readiness_storefront.status AS storefront_status,
    readiness_storefront.source_at AS storefront_source_at,
    readiness_pics.status AS pics_status,
    readiness_pics.source_at AS pics_source_at,
    readiness_market.status AS market_status,
    COALESCE(tag_values.tags, '{}'::text[]) AS tags,
    COALESCE(genre_values.genres, '{}'::text[]) AS genres,
    COALESCE(category_values.categories, '{}'::text[]) AS categories,
    COALESCE(publisher_values.publishers, '{}'::text[]) AS publishers,
    COALESCE(developer_values.developers, '{}'::text[]) AS developers,
    publisher_values.publisher_game_count,
    developer_values.developer_game_count,
    COALESCE(demo_values.has_demo, false) AS has_demo,
    deck.category AS steam_deck
  FROM input_appids input
  JOIN legacy.apps a ON a.appid = input.appid
  LEFT JOIN legacy.latest_daily_metrics m ON m.appid = a.appid
  LEFT JOIN metrics.app_signal_windows_v1 sw ON sw.appid = a.appid
  LEFT JOIN ops.app_data_readiness readiness_catalog
    ON readiness_catalog.appid = a.appid
    AND readiness_catalog.source = 'catalog'
  LEFT JOIN ops.app_data_readiness readiness_storefront
    ON readiness_storefront.appid = a.appid
    AND readiness_storefront.source = 'storefront'
  LEFT JOIN ops.app_data_readiness readiness_pics
    ON readiness_pics.appid = a.appid
    AND readiness_pics.source = 'pics'
  LEFT JOIN ops.app_data_readiness readiness_market
    ON readiness_market.appid = a.appid
    AND readiness_market.source = 'market_metrics'
  LEFT JOIN tag_values ON tag_values.appid = a.appid
  LEFT JOIN genre_values ON genre_values.appid = a.appid
  LEFT JOIN category_values ON category_values.appid = a.appid
  LEFT JOIN publisher_values ON publisher_values.appid = a.appid
  LEFT JOIN developer_values ON developer_values.appid = a.appid
  LEFT JOIN demo_values ON demo_values.appid = a.appid
  LEFT JOIN legacy.app_steam_deck deck ON deck.appid = a.appid
  ORDER BY a.appid
`;

export class OpportunityRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureWorkspace(
    identity: OpportunityIdentity,
  ): Promise<WorkspaceContext> {
    return this.transaction(async (client) => {
      const activeMembership = await client.query<
        QueryResultRow & WorkspaceContext
      >(
        `
          SELECT
            workspace.id,
            workspace.name,
            membership.role
          FROM opportunity.workspace_memberships membership
          JOIN opportunity.workspaces workspace
            ON workspace.id = membership.workspace_id
          WHERE membership.user_id = $1
            AND membership.status = 'active'
            AND workspace.status = 'active'
          ORDER BY membership.joined_at
          LIMIT 1
        `,
        [identity.userId],
      );

      if (activeMembership.rows[0]) {
        await client.query(
          `
            UPDATE opportunity.workspace_memberships
            SET identity_email = $2,
                updated_at = CASE
                  WHEN identity_email IS DISTINCT FROM $2 THEN now()
                  ELSE updated_at
                END
            WHERE user_id = $1
              AND status = 'active'
          `,
          [identity.userId, identity.email],
        );
        return activeMembership.rows[0];
      }

      const slug = stableSlug(identity.userId);
      const displayName = identity.email
        ? `${identity.email.split("@")[0]}'s workspace`
        : "My workspace";
      await client.query(
        `
          INSERT INTO opportunity.workspaces (slug, name, created_by)
          VALUES ($1, $2, $3)
          ON CONFLICT (slug) DO NOTHING
        `,
        [slug, displayName, identity.userId],
      );
      const workspace = await client.query<
        QueryResultRow & { id: string; name: string }
      >(
        `
          SELECT id, name
          FROM opportunity.workspaces
          WHERE slug = $1
            AND status = 'active'
          LIMIT 1
        `,
        [slug],
      );
      const row = workspace.rows[0];
      if (!row) {
        throw new Error("Unable to provision an opportunity workspace.");
      }

      const existingMembership = await client.query<
        QueryResultRow & { status: string }
      >(
        `
          SELECT status
          FROM opportunity.workspace_memberships
          WHERE workspace_id = $1 AND user_id = $2
          LIMIT 1
        `,
        [row.id, identity.userId],
      );
      if (existingMembership.rows[0]?.status === "removed") {
        throw new Error("Opportunity workspace membership has been removed.");
      }

      await client.query(
        `
          INSERT INTO opportunity.workspace_memberships (
            workspace_id,
            user_id,
            identity_email,
            role,
            status
          )
          VALUES ($1, $2, $3, 'owner', 'active')
          ON CONFLICT (workspace_id, user_id)
          DO UPDATE SET
            identity_email = EXCLUDED.identity_email,
            updated_at = now()
          WHERE opportunity.workspace_memberships.status <> 'removed'
        `,
        [row.id, identity.userId, identity.email],
      );
      await client.query(
        `
          INSERT INTO opportunity.audit_log (
            workspace_id,
            actor_user_id,
            action,
            object_type,
            object_id,
            after_state
          )
          VALUES ($1, $2, 'workspace.provisioned', 'workspace', $4, $3::jsonb)
        `,
        [row.id, identity.userId, JSON.stringify({ role: "owner" }), row.id],
      );

      return { id: row.id, name: row.name, role: "owner" };
    });
  }

  async listPresets(): Promise<OpportunityPresetSummary[]> {
    const result = await this.pool.query<PresetRow>(`
      SELECT
        preset.id,
        preset.slug,
        preset.name,
        preset.description,
        version.version,
        version.rules,
        health.state AS health_state
      FROM opportunity.presets preset
      JOIN opportunity.preset_versions version
        ON version.id = preset.current_version_id
      LEFT JOIN LATERAL (
        SELECT snapshot.state
        FROM opportunity.preset_health_snapshots snapshot
        WHERE snapshot.preset_id = preset.id
        ORDER BY snapshot.as_of_date DESC
        LIMIT 1
      ) health ON true
      WHERE preset.editorial_status = 'published'
      ORDER BY preset.name
      LIMIT 100
    `);

    return result.rows.map((row) => {
      const healthSupported = supportsReleasedMarketHealth(row.rules);
      return {
        description: row.description,
        healthState: healthSupported ? row.health_state : null,
        healthUnavailableReason: healthSupported ? null : "unreleased_only",
        id: row.id,
        name: row.name,
        ruleSummary: describeOpportunityRuleSet(row.rules),
        slug: row.slug,
        version: row.version,
      };
    });
  }

  async listProfiles(
    workspaceId: string,
    userId: string,
  ): Promise<OpportunityProfileSummary[]> {
    const result = await this.pool.query<ProfileRow>(
      `
        SELECT
          profile.id,
          profile.name,
          profile.description,
          profile.status,
          profile.timezone,
          to_char(profile.local_delivery_time, 'HH24:MI') AS local_delivery_time,
          profile.immediate_full_match_enabled,
          profile.next_evaluation_at,
          profile.updated_at,
          version.version AS current_version,
          preset.name AS source_preset_name
        FROM opportunity.profiles profile
        LEFT JOIN opportunity.profile_versions version
          ON version.id = profile.current_version_id
        LEFT JOIN opportunity.presets preset
          ON preset.id = profile.source_preset_id
        WHERE profile.workspace_id = $1
          AND profile.owner_user_id = $2
          AND profile.status <> 'archived'
        ORDER BY profile.updated_at DESC, profile.id
        LIMIT 100
      `,
      [workspaceId, userId],
    );

    return result.rows.map((row) => ({
      currentVersion: row.current_version,
      description: row.description,
      id: row.id,
      immediateFullMatchEnabled: row.immediate_full_match_enabled,
      localDeliveryTime: row.local_delivery_time,
      name: row.name,
      nextEvaluationAt: iso(row.next_evaluation_at),
      sourcePresetName: row.source_preset_name,
      status: row.status,
      timezone: row.timezone,
      updatedAt: iso(row.updated_at)!,
    }));
  }

  async getLatestDailyOverview(
    workspaceId: string,
    userId: string,
  ): Promise<OpportunityDailyOverview> {
    const healthChanges = await this.pool.query<
      QueryResultRow & {
        as_of_date: Date | string;
        evaluated_games: number | string;
        explanation: string[];
        maximum_evaluated: number | string;
        name: string;
        prior_state: OpportunityPresetSummary["healthState"];
        rules: OpportunityRuleSet;
        state: NonNullable<OpportunityPresetSummary["healthState"]>;
      }
    >(
      `
        WITH latest_changes AS (
          SELECT DISTINCT ON (snapshot.preset_id)
            snapshot.preset_id,
            preset.name,
            version.rules,
            snapshot.as_of_date,
            snapshot.state,
            snapshot.prior_state,
            snapshot.explanation,
            COALESCE(
              (snapshot.cohort_definition->>'candidateCount')::integer,
              0
            ) AS evaluated_games,
            COALESCE(
              (snapshot.cohort_definition->>'maximumEvaluated')::integer,
              5000
            ) AS maximum_evaluated,
            snapshot.calculated_at
          FROM opportunity.preset_health_snapshots snapshot
          JOIN opportunity.presets preset ON preset.id = snapshot.preset_id
          JOIN opportunity.preset_versions version
            ON version.id = preset.current_version_id
          WHERE snapshot.calculated_at >= now() - interval '48 hours'
            AND snapshot.prior_state IS NOT NULL
            AND snapshot.state IS DISTINCT FROM snapshot.prior_state
          ORDER BY snapshot.preset_id, snapshot.calculated_at DESC
        )
        SELECT
          name,
          rules,
          as_of_date,
          state,
          prior_state,
          explanation,
          evaluated_games,
          maximum_evaluated
        FROM latest_changes
        ORDER BY calculated_at DESC, name
        LIMIT 50
      `,
    );
    const presetHealthChanges = healthChanges.rows
      .filter((row) => supportsReleasedMarketHealth(row.rules))
      .map((row) => {
        const evaluatedGames = Number(row.evaluated_games);
        const maximumEvaluated = Number(row.maximum_evaluated);
        return {
          asOfDate: iso(row.as_of_date)!,
          evaluatedGames,
          explanation: row.explanation,
          maximumEvaluated,
          name: row.name,
          priorState: row.prior_state,
          sampleCapped:
            maximumEvaluated > 0 && evaluatedGames >= maximumEvaluated,
          state: row.state,
        };
      });
    const runResult = await this.pool.query<LatestRunRow>(
      `
        SELECT
          run.id,
          run.run_kind,
          run.status,
          run.window_start,
          run.window_end,
          run.started_at,
          run.completed_at,
          run.result_count,
          run.coverage_warnings,
          cardinality(run.active_profile_versions) AS profiles_evaluated
        FROM opportunity.runs run
        WHERE run.workspace_id = $1
          AND run.user_id = $2
          AND run.run_kind IN ('daily', 'manual', 'replay')
        ORDER BY run.window_end DESC
        LIMIT 1
      `,
      [workspaceId, userId],
    );
    const run = runResult.rows[0];

    if (!run) {
      return {
        coverageWarnings: [],
        groups: {
          materiallyChanged: [],
          newlyDiscovered: [],
          newlyQualified: [],
          newlyReleased: [],
          trackedUpdates: [],
        },
        matchedCount: 0,
        presetHealthChanges,
        profilesEvaluated: 0,
        runId: null,
        status: "not_run",
        windowEnd: null,
        windowStart: null,
      };
    }

    const results = await this.pool.query<ResultRow>(
      `
        SELECT
          result.id,
          result.appid,
          app.name,
          (
            SELECT jsonb_build_object(
              'eventType', material.event_type,
              'signalFamily', material.signal_family,
              'effectiveAt', material.effective_at,
              'observedAt', material.observed_at,
              'confidence', material.confidence,
              'affectedRuleFields', material.affected_rule_fields,
              'before', material.before_summary,
              'after', material.after_summary
            )
            FROM opportunity.material_events material
            WHERE material.id = result.material_event_id
            LIMIT 1
          ) AS change,
          result.event_label,
          result.event_fingerprint,
          row_number() OVER (
            ORDER BY result.score DESC NULLS LAST, result.appid, result.id
          )::integer AS rank,
          result.score,
          result.rank_components,
          result.confidence,
          result.created_at,
          COALESCE(
            market.potential_band,
            'insufficient_data'
          ) AS market_potential,
          COALESCE(
            result.why_now->>'summary',
            result.event_label
          ) AS why_now,
          COALESCE(
            ARRAY(
              SELECT jsonb_array_elements_text(
                COALESCE(result.evidence_summary->'strongest', '[]'::jsonb)
              )
            ),
            '{}'::text[]
          ) AS strongest_evidence,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'id', profile.id,
                'name', profile.name
              )
            ) FILTER (WHERE profile.id IS NOT NULL),
            '[]'::jsonb
          ) AS matched_profiles
        FROM opportunity.results result
        JOIN legacy.apps app ON app.appid = result.appid
        LEFT JOIN opportunity.market_context_snapshots market
          ON market.id = result.market_context_snapshot_id
        LEFT JOIN opportunity.result_profile_matches match
          ON match.result_id = result.id
        LEFT JOIN opportunity.profiles profile
          ON profile.id = match.profile_id
        WHERE result.user_id = $2
          AND (
            result.run_id = $1
            OR (
              $5::text = 'daily'
              AND result.created_at >= $3
              AND result.created_at < $4
            )
          )
        GROUP BY result.id, app.name, market.potential_band
        ORDER BY result.score DESC NULLS LAST, result.appid, result.id
        LIMIT 500
      `,
      [run.id, userId, run.window_start, run.window_end, run.run_kind],
    );
    const summaries = results.rows.map((row) => this.mapResult(row));
    const group = (label: OpportunityResultSummary["eventLabel"]) =>
      summaries.filter((summary) => summary.eventLabel === label);

    return {
      coverageWarnings: run.coverage_warnings ?? [],
      groups: {
        materiallyChanged: group("materially_changed"),
        newlyDiscovered: group("newly_discovered"),
        newlyQualified: group("newly_qualified"),
        newlyReleased: group("newly_released"),
        trackedUpdates: group("tracked_update"),
      },
      matchedCount: summaries.length,
      presetHealthChanges,
      profilesEvaluated: run.profiles_evaluated,
      runId: run.id,
      status:
        run.status === "completed"
          ? summaries.length > 0
            ? "ready"
            : "empty"
          : run.status === "running"
            ? "running"
            : "failed",
      windowEnd: iso(run.window_end),
      windowStart: iso(run.window_start),
    };
  }

  async getSourceHealth(): Promise<
    OpportunityBootstrapResponse["sourceHealth"]
  > {
    const result = await this.pool.query<
      QueryResultRow & {
        source: string;
        state: "healthy" | "delayed" | "blocked";
        updated_at: Date | string | null;
      }
    >(`
      WITH expected(source) AS (
        VALUES
          ('catalog'::text),
          ('storefront'::text),
          ('pics'::text),
          ('market_metrics'::text),
          ('creator'::text)
      ),
      prepared AS (
        SELECT
          source,
          MAX(processed_at) AS updated_at,
          COUNT(1) FILTER (WHERE status = 'ready') AS ready_count,
          COUNT(1) FILTER (WHERE status IN ('failed', 'source_blocked')) AS blocked_count
        FROM ops.app_data_readiness
        WHERE source IN ('catalog', 'storefront', 'pics', 'market_metrics', 'creator')
        GROUP BY source
      )
      SELECT
        expected.source,
        prepared.updated_at,
        CASE
          WHEN COALESCE(prepared.ready_count, 0) = 0
            AND COALESCE(prepared.blocked_count, 0) > 0
            THEN 'blocked'
          WHEN prepared.updated_at IS NULL
            OR prepared.updated_at < now() - interval '36 hours'
            THEN 'delayed'
          ELSE 'healthy'
        END AS state
      FROM expected
      LEFT JOIN prepared ON prepared.source = expected.source
      ORDER BY expected.source
      LIMIT 20
    `);

    return result.rows.map((row) => ({
      label: row.source.replaceAll("_", " "),
      source: row.source,
      state: row.state,
      updatedAt: iso(row.updated_at),
    }));
  }

  async getBootstrap(
    identity: OpportunityIdentity,
  ): Promise<OpportunityBootstrapResponse> {
    const workspace = await this.ensureWorkspace(identity);
    const [presets, profiles, dailyOverview, sourceHealth, channelPreferences] =
      await Promise.all([
        this.listPresets(),
        this.listProfiles(workspace.id, identity.userId),
        this.getLatestDailyOverview(workspace.id, identity.userId),
        this.getSourceHealth(),
        this.listChannelPreferences(workspace.id, identity.userId),
      ]);

    return {
      channelPreferences,
      dailyOverview,
      presets,
      profiles,
      sourceHealth,
      workspace,
    };
  }

  async listChannelPreferences(
    workspaceId: string,
    userId: string,
  ): Promise<OpportunityChannelPreferenceSummary[]> {
    const result = await this.pool.query<
      QueryResultRow & {
        channel: OpportunityChannelPreferenceSummary["channel"];
        destination_label: string | null;
        enabled: boolean;
        id: string;
        immediate_full_match_enabled: boolean;
        max_results: number;
        profile_id: string | null;
        quiet_day_behavior: OpportunityChannelPreferenceSummary["quietDayBehavior"];
      }
    >(
      `
        SELECT
          id,
          profile_id,
          channel,
          enabled,
          quiet_day_behavior,
          max_results,
          immediate_full_match_enabled,
          destination_metadata->>'label' AS destination_label
        FROM opportunity.channel_preferences
        WHERE workspace_id = $1
          AND user_id = $2
        ORDER BY profile_id NULLS FIRST, channel
        LIMIT 100
      `,
      [workspaceId, userId],
    );
    return result.rows.map((row) => ({
      channel: row.channel,
      destinationLabel: row.destination_label,
      enabled: row.enabled,
      id: row.id,
      immediateFullMatchEnabled: row.immediate_full_match_enabled,
      maxResults: row.max_results,
      profileId: row.profile_id,
      quietDayBehavior: row.quiet_day_behavior,
    }));
  }

  async upsertChannelPreference(params: {
    channel: OpportunityChannelPreferenceSummary["channel"];
    destinationCiphertext: string | null;
    destinationLabel: string | null;
    enabled: boolean;
    identity: OpportunityIdentity;
    immediateFullMatchEnabled: boolean;
    maxResults: number;
    profileId?: string | null;
    quietDayBehavior: OpportunityChannelPreferenceSummary["quietDayBehavior"];
  }): Promise<OpportunityChannelPreferenceSummary> {
    const workspace = await this.ensureWorkspace(params.identity);
    return this.transaction(async (client) => {
      if (params.profileId) {
        const profile = await client.query(
          `
            SELECT 1
            FROM opportunity.profiles
            WHERE id = $1
              AND workspace_id = $2
              AND owner_user_id = $3
              AND status <> 'archived'
            LIMIT 1
          `,
          [params.profileId, workspace.id, params.identity.userId],
        );
        if (!profile.rows[0]) {
          throw new Error("Opportunity profile not found.");
        }
      }

      const existing = await client.query<QueryResultRow & { id: string }>(
        `
          SELECT id
          FROM opportunity.channel_preferences
          WHERE workspace_id = $1
            AND user_id = $2
            AND profile_id IS NOT DISTINCT FROM $3::uuid
            AND channel = $4
          FOR UPDATE
        `,
        [
          workspace.id,
          params.identity.userId,
          params.profileId ?? null,
          params.channel,
        ],
      );
      const values = [
        workspace.id,
        params.identity.userId,
        params.profileId ?? null,
        params.channel,
        params.enabled,
        params.quietDayBehavior,
        params.maxResults,
        params.immediateFullMatchEnabled,
        params.destinationCiphertext,
        JSON.stringify({ label: params.destinationLabel }),
      ];
      const saved = existing.rows[0]
        ? await client.query<
            QueryResultRow & {
              channel: OpportunityChannelPreferenceSummary["channel"];
              destination_label: string | null;
              enabled: boolean;
              id: string;
              immediate_full_match_enabled: boolean;
              max_results: number;
              profile_id: string | null;
              quiet_day_behavior: OpportunityChannelPreferenceSummary["quietDayBehavior"];
            }
          >(
            `
              UPDATE opportunity.channel_preferences
              SET enabled = $5,
                  quiet_day_behavior = $6,
                  max_results = $7,
                  immediate_full_match_enabled = $8,
                  destination_ciphertext = COALESCE($9, destination_ciphertext),
                  destination_metadata = $10::jsonb,
                  updated_at = now()
              WHERE id = $11
              RETURNING
                id,
                profile_id,
                channel,
                enabled,
                quiet_day_behavior,
                max_results,
                immediate_full_match_enabled,
                destination_metadata->>'label' AS destination_label
            `,
            [...values, existing.rows[0].id],
          )
        : await client.query<
            QueryResultRow & {
              channel: OpportunityChannelPreferenceSummary["channel"];
              destination_label: string | null;
              enabled: boolean;
              id: string;
              immediate_full_match_enabled: boolean;
              max_results: number;
              profile_id: string | null;
              quiet_day_behavior: OpportunityChannelPreferenceSummary["quietDayBehavior"];
            }
          >(
            `
              INSERT INTO opportunity.channel_preferences (
                workspace_id,
                user_id,
                profile_id,
                channel,
                enabled,
                quiet_day_behavior,
                max_results,
                immediate_full_match_enabled,
                destination_ciphertext,
                destination_metadata
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
              RETURNING
                id,
                profile_id,
                channel,
                enabled,
                quiet_day_behavior,
                max_results,
                immediate_full_match_enabled,
                destination_metadata->>'label' AS destination_label
            `,
            values,
          );
      const row = saved.rows[0]!;
      await client.query(
        `
          INSERT INTO opportunity.audit_log (
            workspace_id,
            actor_user_id,
            action,
            object_type,
            object_id,
            after_state
          )
          VALUES ($1, $2, 'delivery.preference_changed', 'channel_preference', $3, $4::jsonb)
        `,
        [
          workspace.id,
          params.identity.userId,
          row.id,
          JSON.stringify({
            channel: params.channel,
            enabled: params.enabled,
            profileId: params.profileId ?? null,
          }),
        ],
      );
      return {
        channel: row.channel,
        destinationLabel: row.destination_label,
        enabled: row.enabled,
        id: row.id,
        immediateFullMatchEnabled: row.immediate_full_match_enabled,
        maxResults: row.max_results,
        profileId: row.profile_id,
        quietDayBehavior: row.quiet_day_behavior,
      };
    });
  }

  async createProfile(params: {
    description?: string | null;
    enabled: boolean;
    eventSubscriptions: OpportunitySignalFamily[];
    identity: OpportunityIdentity;
    immediateFullMatchEnabled: boolean;
    localDeliveryTime: string;
    name: string;
    rules: OpportunityRuleSet;
    sourcePresetVersionId?: string | null;
    timezone: string;
  }): Promise<OpportunityProfileVersion> {
    const workspace = await this.ensureWorkspace(params.identity);

    return this.transaction(async (client) => {
      const sourcePreset = params.sourcePresetVersionId
        ? await client.query<
            QueryResultRow & { preset_id: string; version_id: string }
          >(
            `
              SELECT preset_id, id AS version_id
              FROM opportunity.preset_versions
              WHERE id = $1
                AND published_at IS NOT NULL
              LIMIT 1
            `,
            [params.sourcePresetVersionId],
          )
        : null;
      if (params.sourcePresetVersionId && !sourcePreset?.rows[0]) {
        throw new Error("Published preset version not found.");
      }

      const profile = await client.query<QueryResultRow & { id: string }>(
        `
          INSERT INTO opportunity.profiles (
            workspace_id,
            owner_user_id,
            source_preset_id,
            source_preset_version_id,
            name,
            description,
            status,
            timezone,
            local_delivery_time,
            next_evaluation_at,
            immediate_full_match_enabled
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9::time,
            CASE WHEN $7 = 'enabled' THEN now() ELSE NULL END,
            $10
          )
          RETURNING id
        `,
        [
          workspace.id,
          params.identity.userId,
          sourcePreset?.rows[0]?.preset_id ?? null,
          sourcePreset?.rows[0]?.version_id ?? null,
          params.name.trim(),
          params.description?.trim() || null,
          params.enabled ? "enabled" : "draft",
          params.timezone,
          params.localDeliveryTime,
          params.immediateFullMatchEnabled,
        ],
      );
      const profileId = profile.rows[0]!.id;
      await client.query(
        `
          UPDATE opportunity.profiles
          SET timezone = $4,
              local_delivery_time = $5::time,
              next_evaluation_at = CASE
                WHEN status = 'enabled'
                  AND (
                    timezone IS DISTINCT FROM $4
                    OR local_delivery_time IS DISTINCT FROM $5::time
                  )
                  THEN opportunity.next_profile_evaluation_v1(
                    $4,
                    $5::time,
                    now()
                  )
                ELSE next_evaluation_at
              END,
              updated_at = now()
          WHERE workspace_id = $1
            AND owner_user_id = $2
            AND id <> $3
            AND status <> 'archived'
        `,
        [
          workspace.id,
          params.identity.userId,
          profileId,
          params.timezone,
          params.localDeliveryTime,
        ],
      );
      const version = await client.query<
        QueryResultRow & {
          calculation_config: Record<string, unknown>;
          created_at: Date | string;
          event_subscriptions: OpportunitySignalFamily[];
          id: string;
          profile_id: string;
          rules: OpportunityRuleSet;
          version: number;
        }
      >(
        `
          INSERT INTO opportunity.profile_versions (
            profile_id,
            version,
            rules,
            event_subscriptions,
            calculation_config,
            source_preset_version_id,
            activated_at,
            created_by
          )
          VALUES (
            $1,
            1,
            $2::jsonb,
            $3::text[],
            $4::jsonb,
            $5,
            CASE WHEN $6 THEN now() ELSE NULL END,
            $7
          )
          RETURNING
            id,
            profile_id,
            version,
            rules,
            event_subscriptions,
            calculation_config,
            created_at
        `,
        [
          profileId,
          JSON.stringify(params.rules),
          params.eventSubscriptions,
          JSON.stringify({
            cohortVersion: OPPORTUNITY_COHORT_VERSION,
            healthVersion: OPPORTUNITY_HEALTH_VERSION,
            marketVersion: OPPORTUNITY_MARKET_VERSION,
            rankingVersion: OPPORTUNITY_RANKING_VERSION,
          }),
          sourcePreset?.rows[0]?.version_id ?? null,
          params.enabled,
          params.identity.userId,
        ],
      );
      const row = version.rows[0]!;
      await client.query(
        `UPDATE opportunity.profiles SET current_version_id = $2 WHERE id = $1`,
        [profileId, row.id],
      );
      if (params.enabled) {
        await client.query(
          `
            INSERT INTO opportunity.work_queue (
              kind,
              lane,
              workspace_id,
              user_id,
              profile_id,
              priority,
              idempotency_key,
              payload
            )
            VALUES (
              'daily_evaluation',
              'daily',
              $1,
              $2,
              $3,
              100,
              $4,
              $5::jsonb
            )
            ON CONFLICT (idempotency_key) DO NOTHING
          `,
          [
            workspace.id,
            params.identity.userId,
            profileId,
            `profile-enable:${profileId}:v1`,
            JSON.stringify({ reason: "profile_enabled" }),
          ],
        );
      }
      await client.query(
        `
          INSERT INTO opportunity.audit_log (
            workspace_id,
            actor_user_id,
            action,
            object_type,
            object_id,
            after_state
          )
          VALUES ($1, $2, 'profile.created', 'profile', $3, $4::jsonb)
        `,
        [
          workspace.id,
          params.identity.userId,
          profileId,
          JSON.stringify({
            enabled: params.enabled,
            rulesHash: stableHash(params.rules),
            version: 1,
          }),
        ],
      );

      return {
        calculationConfig: row.calculation_config,
        createdAt: iso(row.created_at)!,
        eventSubscriptions: row.event_subscriptions,
        id: row.id,
        profileId: row.profile_id,
        rules: row.rules,
        version: row.version,
      };
    });
  }

  async clonePreset(params: {
    identity: OpportunityIdentity;
    localDeliveryTime: string;
    name?: string;
    presetId: string;
    timezone: string;
  }): Promise<OpportunityProfileVersion> {
    const preset = await this.pool.query<
      QueryResultRow & {
        description: string | null;
        event_subscriptions: OpportunitySignalFamily[];
        name: string;
        rules: OpportunityRuleSet;
        version_id: string;
      }
    >(
      `
        SELECT
          preset.name,
          preset.description,
          version.id AS version_id,
          version.rules,
          version.event_subscriptions
        FROM opportunity.presets preset
        JOIN opportunity.preset_versions version
          ON version.id = preset.current_version_id
        WHERE preset.id = $1
          AND preset.editorial_status = 'published'
        LIMIT 1
      `,
      [params.presetId],
    );
    const row = preset.rows[0];
    if (!row) {
      throw new Error("Published opportunity preset not found.");
    }

    return this.createProfile({
      description: row.description,
      enabled: false,
      eventSubscriptions: row.event_subscriptions,
      identity: params.identity,
      immediateFullMatchEnabled: false,
      localDeliveryTime: params.localDeliveryTime,
      name: params.name?.trim() || row.name,
      rules: row.rules,
      sourcePresetVersionId: row.version_id,
      timezone: params.timezone,
    });
  }

  async getProfile(params: {
    identity: OpportunityIdentity;
    profileId: string;
  }): Promise<OpportunityProfileDetail> {
    const workspace = await this.ensureWorkspace(params.identity);
    const result = await this.pool.query<
      QueryResultRow & {
        calculation_config: Record<string, unknown>;
        created_at: Date | string;
        current_version: number;
        description: string | null;
        event_subscriptions: OpportunitySignalFamily[];
        id: string;
        immediate_full_match_enabled: boolean;
        local_delivery_time: string;
        name: string;
        next_evaluation_at: Date | string | null;
        profile_version_id: string;
        rules: OpportunityRuleSet;
        source_preset_name: string | null;
        status: OpportunityProfileSummary["status"];
        timezone: string;
        updated_at: Date | string;
      }
    >(
      `
        SELECT
          profile.id,
          profile.name,
          profile.description,
          profile.status,
          profile.timezone,
          to_char(profile.local_delivery_time, 'HH24:MI') AS local_delivery_time,
          profile.immediate_full_match_enabled,
          profile.next_evaluation_at,
          profile.updated_at,
          preset.name AS source_preset_name,
          version.id AS profile_version_id,
          version.version AS current_version,
          version.rules,
          version.event_subscriptions,
          version.calculation_config,
          version.created_at
        FROM opportunity.profiles profile
        JOIN opportunity.profile_versions version
          ON version.id = profile.current_version_id
        LEFT JOIN opportunity.presets preset
          ON preset.id = profile.source_preset_id
        WHERE profile.id = $1
          AND profile.workspace_id = $2
          AND profile.owner_user_id = $3
          AND profile.status <> 'archived'
        LIMIT 1
      `,
      [params.profileId, workspace.id, params.identity.userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Opportunity profile not found.");
    }
    return {
      currentVersion: row.current_version,
      currentVersionDetail: {
        calculationConfig: row.calculation_config,
        createdAt: iso(row.created_at)!,
        eventSubscriptions: row.event_subscriptions,
        id: row.profile_version_id,
        profileId: row.id,
        rules: row.rules,
        version: row.current_version,
      },
      description: row.description,
      id: row.id,
      immediateFullMatchEnabled: row.immediate_full_match_enabled,
      localDeliveryTime: row.local_delivery_time,
      name: row.name,
      nextEvaluationAt: iso(row.next_evaluation_at),
      sourcePresetName: row.source_preset_name,
      status: row.status,
      timezone: row.timezone,
      updatedAt: iso(row.updated_at)!,
    };
  }

  async saveProfileVersion(params: {
    description?: string | null;
    eventSubscriptions: OpportunitySignalFamily[];
    identity: OpportunityIdentity;
    immediateFullMatchEnabled: boolean;
    localDeliveryTime?: string;
    name: string;
    profileId: string;
    rules: OpportunityRuleSet;
    timezone: string;
  }): Promise<OpportunityProfileVersion> {
    const workspace = await this.ensureWorkspace(params.identity);

    return this.transaction(async (client) => {
      const profile = await client.query<
        QueryResultRow & {
          calculation_config: Record<string, unknown> | null;
          source_preset_version_id: string | null;
          status: OpportunityProfileSummary["status"];
          version: number;
        }
      >(
        `
          SELECT
            profile.status,
            profile.source_preset_version_id,
            COALESCE(version.version, 0) AS version,
            version.calculation_config
          FROM opportunity.profiles profile
          LEFT JOIN opportunity.profile_versions version
            ON version.id = profile.current_version_id
          WHERE profile.id = $1
            AND profile.workspace_id = $2
            AND profile.owner_user_id = $3
            AND profile.status <> 'archived'
          FOR UPDATE OF profile
        `,
        [params.profileId, workspace.id, params.identity.userId],
      );
      const current = profile.rows[0];
      if (!current) {
        throw new Error("Opportunity profile not found.");
      }
      const nextVersion = current.version + 1;
      const inserted = await client.query<
        QueryResultRow & {
          calculation_config: Record<string, unknown>;
          created_at: Date | string;
          event_subscriptions: OpportunitySignalFamily[];
          id: string;
          profile_id: string;
          rules: OpportunityRuleSet;
          version: number;
        }
      >(
        `
          INSERT INTO opportunity.profile_versions (
            profile_id,
            version,
            rules,
            event_subscriptions,
            calculation_config,
            source_preset_version_id,
            activated_at,
            created_by
          )
          VALUES (
            $1,
            $2,
            $3::jsonb,
            $4::text[],
            $5::jsonb,
            $6,
            CASE WHEN $7 = 'enabled' THEN now() ELSE NULL END,
            $8
          )
          RETURNING
            id,
            profile_id,
            version,
            rules,
            event_subscriptions,
            calculation_config,
            created_at
        `,
        [
          params.profileId,
          nextVersion,
          JSON.stringify(params.rules),
          params.eventSubscriptions,
          JSON.stringify(
            current.calculation_config ?? {
              cohortVersion: OPPORTUNITY_COHORT_VERSION,
              healthVersion: OPPORTUNITY_HEALTH_VERSION,
              marketVersion: OPPORTUNITY_MARKET_VERSION,
              rankingVersion: OPPORTUNITY_RANKING_VERSION,
            },
          ),
          current.source_preset_version_id,
          current.status,
          params.identity.userId,
        ],
      );
      const row = inserted.rows[0]!;
      await client.query(
        `
          UPDATE opportunity.profiles
          SET current_version_id = $2,
              name = $3,
              description = $4,
              timezone = $5,
              local_delivery_time = COALESCE($6::time, local_delivery_time),
              immediate_full_match_enabled = $7,
              next_evaluation_at = CASE
                WHEN status = 'enabled' THEN now()
                ELSE next_evaluation_at
              END,
              updated_at = now()
          WHERE id = $1
        `,
        [
          params.profileId,
          row.id,
          params.name.trim(),
          params.description?.trim() || null,
          params.timezone,
          params.localDeliveryTime ?? null,
          params.immediateFullMatchEnabled,
        ],
      );
      if (params.localDeliveryTime !== undefined) {
        await client.query(
          `
            UPDATE opportunity.profiles
            SET timezone = $4,
                local_delivery_time = $5::time,
                next_evaluation_at = CASE
                  WHEN status = 'enabled'
                    AND (
                      timezone IS DISTINCT FROM $4
                      OR local_delivery_time IS DISTINCT FROM $5::time
                    )
                    THEN opportunity.next_profile_evaluation_v1(
                      $4,
                      $5::time,
                      now()
                    )
                  ELSE next_evaluation_at
                END,
                updated_at = now()
            WHERE workspace_id = $1
              AND owner_user_id = $2
              AND id <> $3
              AND status <> 'archived'
          `,
          [
            workspace.id,
            params.identity.userId,
            params.profileId,
            params.timezone,
            params.localDeliveryTime,
          ],
        );
      }
      await client.query(
        `
          INSERT INTO opportunity.audit_log (
            workspace_id,
            actor_user_id,
            action,
            object_type,
            object_id,
            after_state
          )
          VALUES ($1, $2, 'profile.version_created', 'profile', $3, $4::jsonb)
        `,
        [
          workspace.id,
          params.identity.userId,
          params.profileId,
          JSON.stringify({
            rulesHash: stableHash(params.rules),
            version: nextVersion,
          }),
        ],
      );

      return {
        calculationConfig: row.calculation_config,
        createdAt: iso(row.created_at)!,
        eventSubscriptions: row.event_subscriptions,
        id: row.id,
        profileId: row.profile_id,
        rules: row.rules,
        version: row.version,
      };
    });
  }

  async setProfileStatus(params: {
    identity: OpportunityIdentity;
    profileId: string;
    status: "enabled" | "paused" | "archived";
  }): Promise<void> {
    const workspace = await this.ensureWorkspace(params.identity);
    await this.transaction(async (client) => {
      const updated = await client.query<QueryResultRow & { id: string }>(
        `
          UPDATE opportunity.profiles
          SET status = $4,
              next_evaluation_at = CASE
                WHEN $4 = 'enabled' THEN now()
                ELSE NULL
              END,
              updated_at = now()
          WHERE id = $1
            AND workspace_id = $2
            AND owner_user_id = $3
            AND current_version_id IS NOT NULL
            AND status <> 'archived'
          RETURNING id
        `,
        [params.profileId, workspace.id, params.identity.userId, params.status],
      );
      if (!updated.rows[0]) {
        throw new Error(
          "Opportunity profile not found or cannot change state.",
        );
      }
      if (params.status === "enabled") {
        await client.query(
          `
            UPDATE opportunity.profile_versions
            SET activated_at = COALESCE(activated_at, now())
            WHERE id = (
              SELECT current_version_id
              FROM opportunity.profiles
              WHERE id = $1
            )
          `,
          [params.profileId],
        );
      }
      await client.query(
        `
          INSERT INTO opportunity.audit_log (
            workspace_id,
            actor_user_id,
            action,
            object_type,
            object_id,
            after_state
          )
          VALUES ($1, $2, 'profile.status_changed', 'profile', $3, $4::jsonb)
        `,
        [
          workspace.id,
          params.identity.userId,
          params.profileId,
          JSON.stringify({ status: params.status }),
        ],
      );
    });
  }

  async getPreviewAggregate(compiled: OpportunityCompiledPreview): Promise<{
    coverage: Record<string, number>;
    stageCounts: Record<string, number>;
    totalCatalog: number;
    totalMatches: number;
  }> {
    const stageObject =
      compiled.requiredStages.length === 0
        ? `'{}'::jsonb`
        : `jsonb_build_object(${compiled.requiredStages
            .flatMap((stage) => [
              `'${stage.groupId.replaceAll("'", "''")}'`,
              `COUNT(1) FILTER (WHERE ${stage.matchSql})`,
            ])
            .join(", ")})`;
    const coverageObject =
      compiled.coverageFields.length === 0
        ? `'{}'::jsonb`
        : `jsonb_build_object(${compiled.coverageFields
            .flatMap((coverage) => [
              `'${coverage.field}'`,
              `COUNT(1) FILTER (WHERE ${coverage.knownSql})`,
            ])
            .join(", ")})`;
    const result = await this.pool.query<PreviewAggregateRow>(
      `
        SELECT
          COUNT(1) AS total_catalog,
          COUNT(1) FILTER (WHERE ${compiled.matchSql}) AS total_matches,
          ${stageObject} AS stage_counts,
          ${coverageObject} AS coverage_counts
        ${OPPORTUNITY_PREVIEW_FROM_SQL}
      `,
      compiled.values,
    );
    const row = result.rows[0]!;

    return {
      coverage: recordValue(row.coverage_counts),
      stageCounts: recordValue(row.stage_counts),
      totalCatalog: Number(row.total_catalog),
      totalMatches: Number(row.total_matches),
    };
  }

  async getPreviewInputs(
    rules: OpportunityRuleSet,
    limit = 60,
  ): Promise<OpportunityEvaluationInput[]> {
    const compiled = compileOpportunityPreview(rules);
    const result = await this.pool.query<RuleInputRow>(
      `
        ${RULE_INPUT_SELECT}
        WHERE a.type = 'game'
          AND COALESCE(a.is_delisted, false) = false
          AND ${compiled.matchSql}
        ORDER BY
          COALESCE(a.release_date, DATE '9999-12-31'),
          COALESCE(m.total_reviews, 0) DESC,
          a.appid
        LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))}
      `,
      compiled.values,
    );
    return result.rows.map(buildOpportunityRuleInput);
  }

  private async persistRuleInputProjection(
    inputs: OpportunityEvaluationInput[],
  ): Promise<void> {
    for (
      let offset = 0;
      offset < inputs.length;
      offset += RULE_INPUT_PROJECTION_BATCH_SIZE
    ) {
      const batch = inputs
        .slice(offset, offset + RULE_INPUT_PROJECTION_BATCH_SIZE)
        .map((input) => ({
          appid: input.appid,
          fields: input.fields,
          input_fingerprint: stableHash({
            appid: input.appid,
            fields: input.fields,
            name: input.name,
          }),
          name: input.name,
          source_watermarks: ruleInputSourceWatermarks(input),
        }));
      await this.pool.query(
        `
          INSERT INTO opportunity.rule_input_projection_v1 (
            appid,
            projection_version,
            as_of_date,
            input_fingerprint,
            name,
            fields,
            source_watermarks,
            calculated_at
          )
          SELECT
            projected.appid,
            $2,
            CURRENT_DATE,
            projected.input_fingerprint,
            projected.name,
            projected.fields,
            projected.source_watermarks,
            clock_timestamp()
          FROM jsonb_to_recordset($1::jsonb) AS projected(
            appid integer,
            fields jsonb,
            input_fingerprint text,
            name text,
            source_watermarks jsonb
          )
          ON CONFLICT (appid, projection_version)
          DO UPDATE SET
            as_of_date = EXCLUDED.as_of_date,
            input_fingerprint = EXCLUDED.input_fingerprint,
            name = EXCLUDED.name,
            fields = EXCLUDED.fields,
            source_watermarks = EXCLUDED.source_watermarks,
            calculated_at = EXCLUDED.calculated_at
          WHERE opportunity.rule_input_projection_v1.input_fingerprint
              IS DISTINCT FROM EXCLUDED.input_fingerprint
             OR opportunity.rule_input_projection_v1.as_of_date
              IS DISTINCT FROM EXCLUDED.as_of_date
        `,
        [JSON.stringify(batch), OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION],
      );
    }
  }

  async getRuleInputsLegacy(
    appids: number[],
    client: PoolClient | null = null,
  ): Promise<OpportunityEvaluationInput[]> {
    const bounded = Array.from(
      new Set(appids.filter((appid) => Number.isInteger(appid) && appid > 0)),
    ).slice(0, 5_000);
    if (bounded.length === 0) {
      return [];
    }
    const sql = `
        ${RULE_INPUT_SELECT}
        WHERE a.appid = ANY($1::integer[])
        ORDER BY a.appid
      `;
    const result = client
      ? await client.query<RuleInputRow>(sql, [bounded])
      : await this.pool.query<RuleInputRow>(sql, [bounded]);
    return result.rows.map(buildOpportunityRuleInput);
  }

  async getRuleInputs(appids: number[]): Promise<OpportunityEvaluationInput[]> {
    const bounded = Array.from(
      new Set(appids.filter((appid) => Number.isInteger(appid) && appid > 0)),
    ).slice(0, 5_000);
    if (bounded.length === 0) {
      return [];
    }
    const result = await this.pool.query<RuleInputRow>(
      RULE_INPUT_BATCH_SELECT,
      [bounded],
    );
    const inputs = result.rows.map(buildOpportunityRuleInput);
    await this.persistRuleInputProjection(inputs);
    return inputs;
  }

  /**
   * Executes the production set-based projection without persistence.
   * Callers must hold a read-only transaction when using this for live shadow
   * validation so every downstream comparison sees one stable source snapshot.
   */
  async getRuleInputsShadow(
    appids: number[],
    client: PoolClient | null = null,
  ): Promise<OpportunityEvaluationInput[]> {
    const bounded = Array.from(
      new Set(appids.filter((appid) => Number.isInteger(appid) && appid > 0)),
    ).slice(0, 5_000);
    if (bounded.length === 0) {
      return [];
    }
    const result = client
      ? await client.query<RuleInputRow>(RULE_INPUT_BATCH_SELECT, [bounded])
      : await this.pool.query<RuleInputRow>(RULE_INPUT_BATCH_SELECT, [bounded]);
    return result.rows.map(buildOpportunityRuleInput);
  }

  async getPresetHealthInputs(
    rules: OpportunityRuleSet,
    limit = 5_000,
  ): Promise<OpportunityEvaluationInput[]> {
    const compiled = compileOpportunityPreview(rules);
    const boundedLimit = Math.max(10, Math.min(5_000, Math.floor(limit)));
    const result = await this.pool.query<RuleInputRow>(
      `
        ${RULE_INPUT_SELECT}
        WHERE a.type = 'game'
          AND a.is_released = true
          AND COALESCE(a.is_delisted, false) = false
          AND ${compiled.matchSql}
        ORDER BY a.appid
        LIMIT ${boundedLimit}
      `,
      compiled.values,
    );
    return result.rows.map(buildOpportunityRuleInput);
  }

  async getPreviewHistoryEstimate(
    userId: string,
    profileId?: string,
  ): Promise<{ high: number | null; low: number | null }> {
    if (!profileId) {
      return { high: null, low: null };
    }
    const result = await this.pool.query<
      QueryResultRow & { average_count: string | number; run_days: number }
    >(
      `
        SELECT
          COUNT(DISTINCT run.id) AS run_days,
          AVG(per_run.result_count)::numeric AS average_count
        FROM (
          SELECT match.profile_id, result.run_id, COUNT(1) AS result_count
          FROM opportunity.result_profile_matches match
          JOIN opportunity.results result ON result.id = match.result_id
          WHERE match.profile_id = $1
            AND result.user_id = $2
          GROUP BY match.profile_id, result.run_id
          ORDER BY MAX(result.created_at) DESC
          LIMIT 30
        ) per_run
        JOIN opportunity.runs run ON run.id = per_run.run_id
      `,
      [profileId, userId],
    );
    const row = result.rows[0];
    if (!row || Number(row.run_days) < 3) {
      return { high: null, low: null };
    }
    const average = Number(row.average_count);
    return {
      high: Math.ceil(average * 1.5),
      low: Math.max(0, Math.floor(average * 0.5)),
    };
  }

  async getGameRecord(params: {
    appid: number;
    identity: OpportunityIdentity;
    resultId: string;
  }): Promise<OpportunityGameRecord> {
    const workspace = await this.ensureWorkspace(params.identity);
    const result = await this.pool.query<
      QueryResultRow & {
        app: OpportunityGameRecord["app"];
        cohort: OpportunityGameRecord["cohort"];
        current_metrics: OpportunityGameRecord["currentMetrics"];
        evidence: OpportunityGameRecord["evidence"];
        market_context: OpportunityGameRecord["marketContext"];
        matched_profiles: OpportunityGameRecord["matchedProfiles"];
        missing_evidence: string[];
        official_news: OpportunityGameRecord["officialNews"];
        previous_appearances: OpportunityGameRecord["previousAppearances"];
        provenance: OpportunityGameRecord["provenance"];
        recent_changes: OpportunityGameRecord["recentChanges"];
        rank: OpportunityGameRecord["rank"];
        result_summary: OpportunityResultSummary;
        team_activity: OpportunityGameRecord["teamActivity"];
        user_state: OpportunityGameRecord["userState"];
        youtube_evidence: OpportunityGameRecord["youtubeEvidence"];
      }
    >(
      `
        SELECT
          jsonb_build_object(
            'appid', app.appid,
            'name', app.name,
            'releaseState', app.release_state,
            'releaseDate', app.release_date,
            'steamUrl', 'https://store.steampowered.com/app/' || app.appid,
            'publishers', COALESCE((
              SELECT jsonb_agg(publisher.name ORDER BY publisher.name)
              FROM legacy.app_publishers app_publisher
              JOIN legacy.publishers publisher
                ON publisher.id = app_publisher.publisher_id
              WHERE app_publisher.appid = app.appid
            ), '[]'::jsonb),
            'developers', COALESCE((
              SELECT jsonb_agg(developer.name ORDER BY developer.name)
              FROM legacy.app_developers app_developer
              JOIN legacy.developers developer
                ON developer.id = app_developer.developer_id
              WHERE app_developer.appid = app.appid
            ), '[]'::jsonb)
          ) AS app,
          jsonb_build_object(
            'id', canonical.id,
            'appid', canonical.appid,
            'name', app.name,
            'change', CASE
              WHEN triggering_event.id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'eventType', triggering_event.event_type,
                'signalFamily', triggering_event.signal_family,
                'effectiveAt', triggering_event.effective_at,
                'observedAt', triggering_event.observed_at,
                'confidence', triggering_event.confidence,
                'affectedRuleFields', triggering_event.affected_rule_fields,
                'before', triggering_event.before_summary,
                'after', triggering_event.after_summary
              )
            END,
            'eventLabel', canonical.event_label,
            'eventFingerprint', canonical.event_fingerprint,
            'rank', canonical.rank,
            'score', canonical.score,
            'rankComponents', canonical.rank_components,
            'confidence', canonical.confidence,
            'createdAt', canonical.created_at,
            'marketPotential', COALESCE(market.potential_band, 'insufficient_data'),
            'matchedProfiles', COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.name))
              FROM opportunity.result_profile_matches match
              JOIN opportunity.profiles profile ON profile.id = match.profile_id
              WHERE match.result_id = canonical.id
            ), '[]'::jsonb),
            'strongestEvidence', COALESCE(canonical.evidence_summary->'strongest', '[]'::jsonb),
            'whyNow', COALESCE(canonical.why_now->>'summary', canonical.event_label)
          ) AS result_summary,
          jsonb_build_object(
            'rankingVersion', canonical.calculation_versions->>'ranking',
            'components', canonical.rank_components,
            'weights', canonical.rank_components->'weights',
            'finalScore', canonical.score,
            'reasons', COALESCE(canonical.rank_components->'reasons', '[]'::jsonb)
          ) AS rank,
          jsonb_build_object(
            'calculationVersions', canonical.calculation_versions,
            'sourceTimestamps', canonical.source_timestamps,
            'run', jsonb_build_object(
              'id', canonical_run.id,
              'kind', canonical_run.run_kind,
              'windowStart', canonical_run.window_start,
              'windowEnd', canonical_run.window_end,
              'startedAt', canonical_run.started_at,
              'completedAt', canonical_run.completed_at,
              'sourceWatermarks', canonical_run.source_watermarks,
              'activeProfileVersions', canonical_run.active_profile_versions
            ),
            'triggeringEvent', CASE
              WHEN triggering_event.id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'eventType', triggering_event.event_type,
                'signalFamily', triggering_event.signal_family,
                'effectiveAt', triggering_event.effective_at,
                'observedAt', triggering_event.observed_at,
                'registryVersion', triggering_event.registry_version,
                'classifierVersion', triggering_event.classifier_version
              )
            END,
            'deliveries', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'channel', delivery.channel,
                'deliveryKind', delivery.delivery_kind,
                'status', delivery.status,
                'createdAt', delivery.created_at,
                'sentAt', delivery.sent_at
              ) ORDER BY delivery.created_at, delivery.id)
              FROM opportunity.deliveries delivery
              WHERE canonical.id = ANY(delivery.result_ids)
                AND delivery.user_id = canonical.user_id
            ), '[]'::jsonb)
          ) AS provenance,
          canonical.evidence_summary->'items' AS evidence,
          canonical.missing_evidence AS missing_evidence,
          canonical.evidence_summary->'currentMetrics' AS current_metrics,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'gid', news.gid,
              'title', COALESCE(news.title, 'Steam announcement'),
              'url', news.url,
              'feedLabel', news.feedlabel,
              'publishedAt', news.published_at
            ) ORDER BY COALESCE(news.published_at, news.first_seen_at) DESC)
            FROM (
              SELECT
                item.gid,
                item.url,
                item.feedlabel,
                item.published_at,
                item.first_seen_at,
                projection.title
              FROM docs.steam_news_items item
              LEFT JOIN docs.steam_news_search_projection projection
                ON projection.gid = item.gid
              WHERE item.appid = canonical.appid
                AND COALESCE(item.published_at, item.first_seen_at)
                  <= canonical.created_at
              ORDER BY COALESCE(item.published_at, item.first_seen_at) DESC
              LIMIT 5
            ) news
          ), '[]'::jsonb) AS official_news,
          CASE WHEN cohort.id IS NULL THEN NULL ELSE jsonb_build_object(
            'cohortKind', cohort.cohort_kind,
            'cohortVersion', cohort.cohort_version,
            'signature', cohort.signature,
            'fallbackTier', cohort.fallback_tier,
            'coverage', cohort.coverage,
            'members', cohort.members,
            'confidence', CASE WHEN cohort.coverage >= 0.6 THEN 'high' ELSE 'directional' END,
            'sourceAt', cohort.source_at,
            'calculatedAt', cohort.calculated_at
          ) END AS cohort,
          CASE WHEN market.id IS NULL THEN NULL ELSE jsonb_build_object(
            'marketVersion', market.calculation_version,
            'distributions', market.distributions,
            'demandDirection', market.demand_direction->>'state',
            'supply', market.supply,
            'concentration', market.concentration,
            'potentialBand', market.potential_band,
            'confidence', market.confidence,
            'explanation', market.explanation
          ) END AS market_context,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', profile.id,
              'name', profile.name,
              'profileVersionId', match.profile_version_id,
              'profileVersion', version.version,
              'ruleOutcomes', match.rule_outcomes
            ) ORDER BY profile.name)
            FROM opportunity.result_profile_matches match
            JOIN opportunity.profiles profile ON profile.id = match.profile_id
            JOIN opportunity.profile_versions version
              ON version.id = match.profile_version_id
            WHERE match.result_id = canonical.id
          ), '[]'::jsonb) AS matched_profiles,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'resultId', prior.id,
              'eventLabel', prior.event_label,
              'createdAt', prior.created_at,
              'whyNow', COALESCE(prior.why_now->>'summary', prior.event_label)
            ) ORDER BY prior.created_at DESC)
            FROM opportunity.results prior
            WHERE prior.user_id = canonical.user_id
              AND prior.appid = canonical.appid
              AND prior.id <> canonical.id
          ), '[]'::jsonb) AS previous_appearances,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'eventType', recent.event_type,
              'signalFamily', recent.signal_family,
              'effectiveAt', recent.effective_at,
              'observedAt', recent.observed_at,
              'eventFingerprint', recent.event_fingerprint,
              'materiality', recent.materiality,
              'confidence', recent.confidence,
              'affectedRuleFields', recent.affected_rule_fields,
              'before', recent.before_summary,
              'after', recent.after_summary,
              'rawEventRefs', recent.raw_event_refs
            ) ORDER BY recent.observed_at DESC)
            FROM (
              SELECT *
              FROM opportunity.material_events material
              WHERE material.appid = canonical.appid
                AND material.observed_at <= canonical.created_at
              ORDER BY material.observed_at DESC
              LIMIT 20
            ) recent
          ), '[]'::jsonb) AS recent_changes,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'activityType', activity.activity_type,
              'occurredAt', activity.occurred_at,
              'userDisplay', COALESCE(membership.identity_email, 'Team member')
            ) ORDER BY activity.occurred_at DESC)
            FROM (
              SELECT recent.*
              FROM opportunity.team_activity recent
              WHERE recent.workspace_id = canonical.workspace_id
                AND recent.appid = canonical.appid
              ORDER BY recent.occurred_at DESC
              LIMIT 100
            ) activity
            LEFT JOIN opportunity.workspace_memberships membership
              ON membership.workspace_id = activity.workspace_id
              AND membership.user_id = activity.user_id
          ), '[]'::jsonb) AS team_activity,
          jsonb_build_object(
            'dismissedAt', game_state.dismissed_at,
            'ignoredAt', game_state.ignored_at,
            'researching', COALESCE(research_state.is_researching, false),
            'trackedAt', game_state.tracked_at
          ) AS user_state,
          jsonb_build_object(
            'coverage', 'partial',
            'latestSnapshotAt', (
              SELECT MAX(snapshot.snapshot_time)
              FROM metrics.youtube_video_snapshots snapshot
              WHERE snapshot.appid = canonical.appid
                AND snapshot.snapshot_time <= canonical.created_at
            ),
            'videos', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'videoId', video.video_id,
                'title', video.title,
                'url', 'https://www.youtube.com/watch?v=' || video.video_id,
                'publishedAt', video.published_at,
                'contentClass', video.content_class,
                'viewCount', video.view_count,
                'channelTitle', video.channel_title,
                'confidenceScore', video.confidence_score
              ) ORDER BY video.published_at DESC NULLS LAST)
              FROM (
                SELECT
                  youtube.video_id,
                  youtube.title,
                  youtube.published_at,
                  youtube.content_class,
                  youtube.view_count,
                  COALESCE(channel.title, youtube.channel_title) AS channel_title,
                  match.confidence_score
                FROM docs.youtube_video_matches match
                JOIN docs.youtube_videos youtube
                  ON youtube.video_id = match.video_id
                LEFT JOIN docs.youtube_channels channel
                  ON channel.channel_id = youtube.channel_id
                WHERE match.appid = canonical.appid
                  AND match.match_state = 'matched_primary'
                  AND youtube.published_at <= canonical.created_at
                ORDER BY youtube.published_at DESC NULLS LAST, youtube.video_id
                LIMIT 5
              ) video
            ), '[]'::jsonb)
          ) AS youtube_evidence
        FROM opportunity.results canonical
        JOIN legacy.apps app ON app.appid = canonical.appid
        JOIN opportunity.runs canonical_run ON canonical_run.id = canonical.run_id
        LEFT JOIN opportunity.material_events triggering_event
          ON triggering_event.id = canonical.material_event_id
        LEFT JOIN opportunity.cohort_snapshots cohort
          ON cohort.id = canonical.cohort_snapshot_id
        LEFT JOIN opportunity.market_context_snapshots market
          ON market.id = canonical.market_context_snapshot_id
        LEFT JOIN opportunity.user_game_state game_state
          ON game_state.workspace_id = canonical.workspace_id
          AND game_state.user_id = canonical.user_id
          AND game_state.appid = canonical.appid
        LEFT JOIN opportunity.team_research_state research_state
          ON research_state.workspace_id = canonical.workspace_id
          AND research_state.user_id = canonical.user_id
          AND research_state.appid = canonical.appid
        WHERE canonical.id = $1
          AND canonical.appid = $2
          AND canonical.workspace_id = $3
          AND canonical.user_id = $4
        LIMIT 1
      `,
      [params.resultId, params.appid, workspace.id, params.identity.userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Opportunity result not found.");
    }
    await this.recordTeamActivity({
      activityType: "viewed",
      appid: params.appid,
      identity: params.identity,
      note: null,
    });
    return {
      app: row.app,
      cohort: row.cohort,
      currentMetrics: row.current_metrics ?? {},
      evidence: row.evidence ?? [],
      marketContext: row.market_context,
      matchedProfiles: row.matched_profiles,
      missingEvidence: row.missing_evidence ?? [],
      officialNews: row.official_news,
      previousAppearances: row.previous_appearances,
      provenance: row.provenance,
      recentChanges: row.recent_changes,
      rank: row.rank,
      result: row.result_summary,
      teamActivity: row.team_activity,
      userState: row.user_state ?? {
        dismissedAt: null,
        ignoredAt: null,
        researching: false,
        trackedAt: null,
      },
      youtubeEvidence: row.youtube_evidence,
      workspace: {
        name: workspace.name,
        role: workspace.role,
      },
    };
  }

  async setUserGameState(params: {
    action: "dismiss" | "ignore" | "restore" | "track" | "untrack";
    appid: number;
    eventFingerprint?: string | null;
    identity: OpportunityIdentity;
  }): Promise<void> {
    const workspace = await this.ensureWorkspace(params.identity);
    await this.transaction(async (client) => {
      await client.query(
        `
          INSERT INTO opportunity.user_game_state (
            workspace_id,
            user_id,
            appid
          )
          VALUES ($1, $2, $3)
          ON CONFLICT (workspace_id, user_id, appid) DO NOTHING
        `,
        [workspace.id, params.identity.userId, params.appid],
      );
      const updateSql = {
        dismiss: `
          dismissed_at = now(),
          dismissed_event_fingerprint = $4
        `,
        ignore: `ignored_at = now()`,
        restore: `
          dismissed_at = NULL,
          dismissed_event_fingerprint = NULL,
          ignored_at = NULL
        `,
        track: `tracked_at = now()`,
        untrack: `tracked_at = NULL`,
      }[params.action];
      const updateValues =
        params.action === "dismiss"
          ? [
              workspace.id,
              params.identity.userId,
              params.appid,
              params.eventFingerprint ?? null,
            ]
          : [workspace.id, params.identity.userId, params.appid];
      await client.query(
        `
          UPDATE opportunity.user_game_state
          SET ${updateSql},
              updated_at = now()
          WHERE workspace_id = $1
            AND user_id = $2
            AND appid = $3
        `,
        updateValues,
      );
      await client.query(
        `
          INSERT INTO opportunity.audit_log (
            workspace_id,
            actor_user_id,
            action,
            object_type,
            object_id,
            after_state
          )
          VALUES ($1, $2, $3, 'game_state', $4, $5::jsonb)
        `,
        [
          workspace.id,
          params.identity.userId,
          `game_state.${params.action}`,
          String(params.appid),
          JSON.stringify({ eventFingerprint: params.eventFingerprint ?? null }),
        ],
      );
    });
  }

  async recordTeamActivity(params: {
    activityType: "viewed" | "researching_started" | "researching_cleared";
    appid: number;
    identity: OpportunityIdentity;
    note: string | null;
  }): Promise<void> {
    const workspace = await this.ensureWorkspace(params.identity);
    await this.transaction(async (client) => {
      await client.query(
        `
          INSERT INTO opportunity.team_activity (
            workspace_id,
            user_id,
            appid,
            activity_type,
            note
          )
          SELECT $1, $2, $3, $4, $5
          WHERE $4 <> 'viewed'
            OR NOT EXISTS (
              SELECT 1
              FROM opportunity.team_activity recent
              WHERE recent.workspace_id = $1
                AND recent.user_id = $2
                AND recent.appid = $3
                AND recent.activity_type = 'viewed'
                AND recent.occurred_at >= now() - interval '1 hour'
            )
        `,
        [
          workspace.id,
          params.identity.userId,
          params.appid,
          params.activityType,
          params.note?.slice(0, 500) ?? null,
        ],
      );
      if (params.activityType !== "viewed") {
        await client.query(
          `
            INSERT INTO opportunity.team_research_state (
              workspace_id,
              user_id,
              appid,
              is_researching,
              note,
              started_at,
              cleared_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              CASE WHEN $4 THEN now() ELSE now() END,
              CASE WHEN $4 THEN NULL ELSE now() END
            )
            ON CONFLICT (workspace_id, user_id, appid)
            DO UPDATE SET
              is_researching = EXCLUDED.is_researching,
              note = EXCLUDED.note,
              started_at = CASE
                WHEN EXCLUDED.is_researching THEN now()
                ELSE opportunity.team_research_state.started_at
              END,
              cleared_at = CASE
                WHEN EXCLUDED.is_researching THEN NULL
                ELSE now()
              END,
              updated_at = now()
          `,
          [
            workspace.id,
            params.identity.userId,
            params.appid,
            params.activityType === "researching_started",
            params.note?.slice(0, 500) ?? null,
          ],
        );
      }
    });
  }

  private mapResult(row: ResultRow): OpportunityResultSummary {
    return {
      appid: row.appid,
      change: row.change ?? null,
      confidence: row.confidence,
      createdAt: iso(row.created_at)!,
      eventLabel: row.event_label,
      eventFingerprint: row.event_fingerprint,
      id: row.id,
      marketPotential: row.market_potential,
      matchedProfiles: row.matched_profiles ?? [],
      name: row.name,
      rank: row.rank,
      rankComponents: row.rank_components,
      score: numberValue(row.score),
      strongestEvidence: row.strongest_evidence ?? [],
      whyNow: row.why_now,
    };
  }
}

export function compilePreviewForRepository(
  rules: OpportunityRuleSet,
): OpportunityCompiledPreview {
  return compileOpportunityPreview(rules);
}

export function previewRepresentativeFromInput(
  input: OpportunityEvaluationInput,
  matchedPreferences: string[],
  scoreHint: number,
): OpportunityPreviewRepresentative {
  const tags = input.fields.tags?.value;
  const releaseState = input.fields.release_state?.value;
  return {
    appid: input.appid,
    matchedPreferences,
    name: input.name,
    releaseState: typeof releaseState === "string" ? releaseState : null,
    scoreHint,
    tags: Array.isArray(tags)
      ? tags.filter((value): value is string => typeof value === "string")
      : [],
  };
}
