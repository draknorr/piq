import { createHash } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  type OpportunityBriefProfileStats,
  OPPORTUNITY_COHORT_VERSION,
  OPPORTUNITY_HEALTH_VERSION,
  OPPORTUNITY_MARKET_VERSION,
  OPPORTUNITY_RANKING_VERSION,
  OPPORTUNITY_RULE_FIELDS,
  OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
  type OpportunityBootstrapResponse,
  type OpportunityAccessContext,
  type OpportunityChannelPreferenceSummary,
  type OpportunityDailyOverview,
  type OpportunityDailyBriefIssue,
  type OpportunityEvaluationInput,
  type OpportunityEvaluationContext,
  type OpportunityFieldValue,
  type OpportunityGameRecord,
  type OpportunityGameDescription,
  type OpportunityIdentity,
  type OpportunityPreviewRepresentative,
  type OpportunityProfileDetail,
  type OpportunityProfileSummary,
  type OpportunityProfileVersion,
  type OpportunityPresetSummary,
  type OpportunityResultSummary,
  type OpportunityReviewPriorityDecision,
  type OpportunityReviewPrioritySummary,
  type OpportunityResultLabel,
  type OpportunityResultPage,
  type OpportunityRuleField,
  type OpportunityRuleSet,
  type OpportunityRankingPolicy,
  type OpportunitySignalFamily,
  type OpportunityTeamSummary,
} from "./types.js";
import {
  buildOpportunityDailyBriefIssue,
  emptyOpportunityEventCounts,
} from "./brief.js";
import { OpportunityNotFoundError } from "./errors.js";
import {
  DISABLED_OPPORTUNITY_WORKSPACE_FEATURE_CONTROL,
  isOpportunityWorkspaceFeatureEnabled,
  type OpportunityPriorityV2OrderControl,
} from "./feature-controls.js";
import {
  decodeOpportunityResultCursor,
  encodeOpportunityResultCursor,
  opportunityCursorFilterKey,
} from "./result-cursor.js";
import {
  compileOpportunityPreview,
  opportunityPersistedResultContentSafetySql,
  type OpportunityCompiledPreview,
} from "./sql-compiler.js";
import {
  describeOpportunityRuleSet,
  evaluateOpportunityProfile,
  normalizeOpportunityContentDescriptors,
  supportsReleasedMarketHealth,
} from "./rules.js";
import { decodeOpportunityReviewPriorityDecision } from "./review-priority-storage.js";
import {
  isOpportunityDateOperand,
  localDateStartUtc,
  opportunityDateRangeForOperand,
  previousLocalDayEvaluationContext,
} from "./date-rules.js";
import {
  cleanOpportunityCoverageWarning,
  cleanOpportunityEvidence,
  cleanOpportunityProfileName,
  cleanOpportunityUserText,
  decodeOpportunityText,
  decodeOpportunityValue,
  opportunityChangeSummary,
  presentOpportunityChange,
  resolveOpportunityRankingPolicy,
  type OpportunityTaxonomyNames,
} from "./intelligence.js";

interface WorkspaceContext {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
}

interface OpportunityRecordAccess {
  access: OpportunityAccessContext;
  ownerUserId: string;
  ownerWorkspaceId: string;
}

interface PreviewAggregateRow extends QueryResultRow {
  candidate_appids?: number[] | string;
  coverage_counts: Record<string, number> | string;
  stage_counts: Record<string, number> | string;
  total_catalog: string | number;
  total_matches: string | number;
}

export interface OpportunityPreviewCatalog {
  aggregate: {
    coverage: Record<string, number>;
    stageCounts: Record<string, number>;
    totalCatalog: number;
    totalMatches: number;
  };
  inputs: OpportunityEvaluationInput[];
}

interface RuleInputRow extends QueryResultRow {
  appid: number;
  app_type: string | null;
  catalog_first_observation_kind: string | null;
  catalog_first_observed_at: Date | string | null;
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
  storefront_description: unknown;
  storefront_status: string | null;
  tags: string[] | null;
  total_reviews: number | null;
  field_evidence: Record<string, unknown> | null;
}

function parseOpportunityGameDescription(
  value: unknown,
): OpportunityGameDescription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const kind = row.kind;
  const text = typeof row.text === "string" ? row.text.trim() : "";
  if (
    !text ||
    ![
      "steam_short",
      "steam_about",
      "steam_detailed",
      "structured",
      "unavailable",
    ].includes(String(kind)) ||
    row.sanitizerVersion !== "opportunity-description/v1"
  ) {
    return null;
  }
  return {
    contentHash: typeof row.contentHash === "string" ? row.contentHash : null,
    hasHeaderImage: row.hasHeaderImage === true,
    hasReleasePath: row.hasReleasePath === true,
    hasSupportedLanguages: row.hasSupportedLanguages === true,
    kind: kind as OpportunityGameDescription["kind"],
    sanitizerVersion: "opportunity-description/v1",
    screenshotCount: Math.max(0, Number(row.screenshotCount) || 0),
    sourceAt: typeof row.sourceAt === "string" ? row.sourceAt : null,
    sourceSnapshotId:
      typeof row.sourceSnapshotId === "string" ||
      typeof row.sourceSnapshotId === "number"
        ? String(row.sourceSnapshotId)
        : null,
    text,
    trailerCount: Math.max(0, Number(row.trailerCount) || 0),
  };
}

function opportunityRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOpportunityReviewPrioritySummary(
  value: unknown,
): OpportunityReviewPrioritySummary | null {
  const row = opportunityRecord(value);
  const confidence = opportunityRecord(row?.confidence);
  if (
    !row ||
    row.version !== "opportunity-ranking/v2" ||
    !["new_game", "traction", "material_change"].includes(String(row.lane)) ||
    ![
      "discover_new_games",
      "find_emerging_traction",
      "monitor_material_changes",
    ].includes(String(row.policy)) ||
    !["review_now", "review_soon", "monitor"].includes(
      String(row.priorityBand),
    ) ||
    !Array.isArray(row.reasons) ||
    row.reasons.length > 3 ||
    !row.reasons.every((reason) => typeof reason === "string") ||
    typeof row.winningProfileId !== "string" ||
    !confidence ||
    confidence.version !== "opportunity-confidence/v2" ||
    !["high", "directional", "limited"].includes(String(confidence.label)) ||
    ![
      confidence.applicableCount,
      confidence.conflictingCount,
      confidence.presentCount,
      confidence.staleCount,
    ].every((count) => Number.isInteger(count) && Number(count) >= 0) ||
    typeof confidence.score !== "number" ||
    !Number.isFinite(confidence.score) ||
    !Array.isArray(confidence.reasons) ||
    !confidence.reasons.every((reason) => typeof reason === "string") ||
    Number(confidence.presentCount) > Number(confidence.applicableCount) ||
    Number(confidence.staleCount) > Number(confidence.presentCount) ||
    !(
      row.internalScore === null ||
      (typeof row.internalScore === "number" &&
        Number.isFinite(row.internalScore) &&
        row.internalScore >= 0 &&
        row.internalScore <= 1)
    )
  ) {
    return null;
  }
  return row as unknown as OpportunityReviewPrioritySummary;
}

function parseOpportunityReviewPriorityDecision(
  value: unknown,
): OpportunityReviewPriorityDecision | null {
  const decoded = decodeOpportunityReviewPriorityDecision(value);
  const row = opportunityRecord(decoded);
  if (
    !parseOpportunityReviewPrioritySummary(decoded) ||
    !row ||
    row.eligibility !== "eligible" ||
    !Array.isArray(row.allMatchedProfileIds) ||
    !row.allMatchedProfileIds.every((id) => typeof id === "string") ||
    !Array.isArray(row.components) ||
    !row.components.every((component) => {
      const item = opportunityRecord(component);
      return (
        item !== null &&
        typeof item.key === "string" &&
        typeof item.baseWeight === "number" &&
        typeof item.effectiveWeight === "number" &&
        (item.value === null || typeof item.value === "number") &&
        (item.contribution === null || typeof item.contribution === "number")
      );
    }) ||
    !Array.isArray(row.inputs) ||
    !row.inputs.every((input) => {
      const item = opportunityRecord(input);
      return (
        item !== null &&
        typeof item.key === "string" &&
        typeof item.confidenceWeight === "number" &&
        ["available", "unavailable", "not_applicable"].includes(
          String(item.availability),
        )
      );
    }) ||
    !Array.isArray(row.eligibilityReasonCodes) ||
    !Array.isArray(row.sortTuple) ||
    row.sortTuple.length !== 6 ||
    typeof row.sortTuple[0] !== "number" ||
    typeof row.sortTuple[1] !== "number" ||
    !(row.sortTuple[2] === null || typeof row.sortTuple[2] === "number") ||
    typeof row.sortTuple[3] !== "string" ||
    typeof row.sortTuple[4] !== "number" ||
    typeof row.sortTuple[5] !== "string" ||
    !["explicit", "legacy_inference"].includes(String(row.selectionSource))
  ) {
    return null;
  }
  return decoded as OpportunityReviewPriorityDecision;
}

export const OPPORTUNITY_RULE_INPUT_FIELD_SOURCES: Record<
  OpportunityRuleField,
  "catalog" | "market_metrics" | "pics" | "resolved" | "storefront"
> = {
  app_type: "catalog",
  appid: "catalog",
  categories: "resolved",
  ccu_change_30d: "market_metrics",
  ccu_change_7d: "market_metrics",
  ccu_peak: "market_metrics",
  content_descriptors: "pics",
  controller_support: "pics",
  days_until_release: "storefront",
  demo_only: "storefront",
  developer: "storefront",
  developer_game_count: "storefront",
  discount_percent: "storefront",
  genres: "resolved",
  has_demo: "storefront",
  has_purchase_packages: "storefront",
  is_free: "storefront",
  is_released: "storefront",
  languages: "resolved",
  name: "catalog",
  no_publisher_listed: "storefront",
  platforms: "resolved",
  positive_percentage: "market_metrics",
  price_cents: "storefront",
  publisher: "storefront",
  publisher_game_count: "storefront",
  publisheriq_added_at: "catalog",
  release_date: "storefront",
  release_state: "storefront",
  reviews_added_30d: "market_metrics",
  reviews_added_7d: "market_metrics",
  self_published: "storefront",
  steam_deck: "pics",
  tags: "resolved",
  total_reviews: "market_metrics",
};

const DATE_TRANSITION_CANDIDATE_BATCH_SIZE = 500;
const RULE_INPUT_PROJECTION_BATCH_SIZE = 500;
const RULE_INPUT_QUERY_BATCH_SIZE = 100;

interface OpportunityDateBoundary {
  endDateExclusive: string;
  field: "publisheriq_added_at" | "release_date";
  startDate: string;
}

function opportunityDateRangeSymmetricDifference(
  current: { endDateExclusive: string; startDate: string },
  previous: { endDateExclusive: string; startDate: string },
): Array<{ endDateExclusive: string; startDate: string }> {
  const points = Array.from(
    new Set([
      current.startDate,
      current.endDateExclusive,
      previous.startDate,
      previous.endDateExclusive,
    ]),
  ).sort();
  const ranges: Array<{ endDateExclusive: string; startDate: string }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const startDate = points[index]!;
    const endDateExclusive = points[index + 1]!;
    const inCurrent =
      startDate >= current.startDate && startDate < current.endDateExclusive;
    const inPrevious =
      startDate >= previous.startDate && startDate < previous.endDateExclusive;
    if (inCurrent !== inPrevious) {
      ranges.push({ endDateExclusive, startDate });
    }
  }
  return ranges;
}

function opportunityRelativeDateBoundaries(
  rules: OpportunityRuleSet,
  current: OpportunityEvaluationContext,
  previous: OpportunityEvaluationContext,
): OpportunityDateBoundary[] {
  const boundaries = new Map<string, OpportunityDateBoundary>();
  for (const group of [...rules.required, ...rules.excluded]) {
    for (const clause of group.clauses) {
      if (
        (clause.field !== "publisheriq_added_at" &&
          clause.field !== "release_date") ||
        !isOpportunityDateOperand(clause.value) ||
        clause.value.kind !== "relative_window"
      ) {
        continue;
      }
      const currentRange = opportunityDateRangeForOperand(
        clause.value,
        current,
      );
      const previousRange = opportunityDateRangeForOperand(
        clause.value,
        previous,
      );
      for (const range of opportunityDateRangeSymmetricDifference(
        currentRange,
        previousRange,
      )) {
        const boundary = { field: clause.field, ...range };
        boundaries.set(
          `${boundary.field}:${boundary.startDate}:${boundary.endDateExclusive}`,
          boundary,
        );
      }
    }
  }
  return Array.from(boundaries.values());
}

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
  header_image_url: string | null;
  game_description: OpportunityGameDescription | null;
  id: string;
  market_potential: OpportunityResultSummary["marketPotential"];
  matched_profiles: Array<{ id: string; name: string }> | null;
  name: string;
  rank: number | null;
  rank_components: OpportunityResultSummary["rankComponents"];
  review_priority: OpportunityReviewPrioritySummary | null;
  score: string | number | null;
  screenshot_thumbnail_url: string | null;
  strongest_evidence: string[] | null;
  triggered_by_media_addition: boolean;
  why_now: string;
}

interface BriefProfileStatsRow extends QueryResultRow {
  high_confidence_count: number | string;
  materially_changed_count: number | string;
  newly_discovered_count: number | string;
  newly_qualified_count: number | string;
  newly_released_count: number | string;
  profile_id: string;
  result_count: number | string;
  top_result: null | {
    appid: number;
    name: string;
    resultId: string;
  };
  tracked_update_count: number | string;
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

function integerArrayValue(value: number[] | string | undefined): number[] {
  if (Array.isArray(value)) {
    return value
      .map(Number)
      .filter((item) => Number.isSafeInteger(item) && item > 0);
  }
  if (!value || value === "{}") {
    return [];
  }
  return value
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map(Number)
    .filter((item) => Number.isSafeInteger(item) && item > 0);
}

function stableSlug(userId: string): string {
  return `personal-${userId.toLowerCase()}`;
}

function teamSlug(name: string): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "team";
  return `${base}-${stableHash(name.trim().toLowerCase()).slice(0, 8)}`;
}

const PROFILE_INDEPENDENT_REVIEW_REASONS = new Set([
  "Early traction is moving",
  "Large, competitive market",
  "Material Steam change",
  "New on Steam",
  "Self-published",
]);

function redactOpportunityResult(
  result: OpportunityResultSummary,
): OpportunityResultSummary {
  const reviewReasons = (result.reviewPriority?.reasons ?? []).filter(
    (reason) => PROFILE_INDEPENDENT_REVIEW_REASONS.has(reason),
  );
  return {
    ...result,
    matchedProfiles: [],
    rankComponents: {
      evidenceQuality: result.rankComponents.evidenceQuality,
      marketMomentum: result.rankComponents.marketMomentum,
      peerPosition: result.rankComponents.peerPosition,
      signalStrength: result.rankComponents.signalStrength,
      userFit: result.rankComponents.userFit,
    },
    reviewPriority: result.reviewPriority
      ? {
          ...result.reviewPriority,
          confidence: {
            ...result.reviewPriority.confidence,
            reasons: [],
          },
          reasons: reviewReasons,
          winningProfileId: "",
        }
      : null,
    strongestEvidence: Array.from(
      new Set([result.changeSummary, ...reviewReasons]),
    ),
    whyNow: reviewReasons.join(" · ") || result.changeSummary,
  };
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function collectNumericIdentifiers(
  value: unknown,
  result = new Set<number>(),
  depth = 0,
): Set<number> {
  if (depth > 8 || result.size >= 2_000) {
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNumericIdentifiers(item, result, depth + 1);
    }
    return result;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectNumericIdentifiers(item, result, depth + 1);
    }
    return result;
  }
  const number = Number(value);
  if (Number.isSafeInteger(number) && number >= 0 && number <= 2_147_483_647) {
    result.add(number);
  }
  return result;
}

async function loadOpportunityTaxonomyNames(
  queryable: Pool | PoolClient,
  changes: Array<OpportunityResultSummary["change"]>,
): Promise<OpportunityTaxonomyNames> {
  const identifiers = Array.from(
    changes.reduce((result, change) => {
      if (
        change?.affectedRuleFields.some((field) =>
          ["categories", "genres", "tags"].includes(field),
        )
      ) {
        collectNumericIdentifiers(change.before, result);
        collectNumericIdentifiers(change.after, result);
      }
      return result;
    }, new Set<number>()),
  ).slice(0, 2_000);
  const names: OpportunityTaxonomyNames = {
    categories: new Map<string, string>(),
    genres: new Map<string, string>(),
    tags: new Map<string, string>(),
  };
  if (identifiers.length === 0) {
    return names;
  }
  const result = await queryable.query<
    QueryResultRow & {
      id: number;
      kind: "categories" | "genres" | "tags";
      name: string;
    }
  >(
    `
      SELECT 'tags'::text AS kind, tag_id AS id, name
      FROM legacy.steam_tags
      WHERE tag_id = ANY($1::integer[])
      UNION ALL
      SELECT 'categories'::text AS kind, category_id AS id, name
      FROM legacy.steam_categories
      WHERE category_id = ANY($1::integer[])
      UNION ALL
      SELECT 'genres'::text AS kind, genre_id AS id, name
      FROM legacy.steam_genres
      WHERE genre_id = ANY($1::integer[])
      LIMIT 6000
    `,
    [identifiers],
  );
  for (const row of result.rows) {
    (names[row.kind] as Map<string, string>).set(
      String(row.id),
      decodeOpportunityText(row.name),
    );
  }
  return names;
}

export async function presentOpportunityChanges(
  queryable: Pool | PoolClient,
  changes: Array<OpportunityResultSummary["change"]>,
  fallbackLabels: OpportunityResultSummary["eventLabel"][],
): Promise<Array<OpportunityResultSummary["change"]>> {
  const taxonomy = await loadOpportunityTaxonomyNames(queryable, changes);
  return changes.map((change, index) =>
    presentOpportunityChange(
      change,
      fallbackLabels[index] ?? "newly_qualified",
      taxonomy,
    ),
  );
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

function resolvedFieldEvidence(
  row: RuleInputRow,
  field: OpportunityRuleField,
): OpportunityFieldValue | null {
  const evidence = row.field_evidence?.[field];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }
  const record = evidence as Record<string, unknown>;
  const source =
    record.source === "storefront" ? "steam_storefront" : "steam_pics";
  const sourceAt =
    typeof record.sourceAt === "string" ? iso(record.sourceAt) : null;
  if (record.state === "known") {
    return knownField(
      field === "content_descriptors"
        ? normalizeOpportunityContentDescriptors(record.value)
        : record.value,
      source,
      sourceAt,
    );
  }
  if (record.state === "missing") {
    if (
      source === "steam_storefront" &&
      row.pics_status === "ready" &&
      record.picsRecorded !== true
    ) {
      return null;
    }
    return unknownField(
      source,
      `${source === "steam_storefront" ? "Storefront" : "PICS"} did not include this field.`,
      sourceAt,
    );
  }
  return null;
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return new Date(value).toISOString().slice(0, 10);
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
    app_type: knownField(
      row.app_type?.toLocaleLowerCase() ?? null,
      "legacy.apps",
      catalogSourceAt,
    ),
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
  const setResolved = (
    field: OpportunityRuleField,
    legacyValue: unknown,
  ): void => {
    const resolved = resolvedFieldEvidence(row, field);
    if (resolved) {
      fields[field] = resolved;
    } else {
      setPics(field, legacyValue);
    }
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
  setStorefront("release_date", dateOnly(row.release_date));
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
  fields.publisheriq_added_at =
    row.catalog_first_observation_kind === "new" &&
    row.catalog_first_observed_at
      ? knownField(
          iso(row.catalog_first_observed_at),
          "ops.app_catalog_state",
          iso(row.catalog_first_observed_at),
        )
      : unknownField(
          "ops.app_catalog_state",
          row.catalog_first_observation_kind === "baseline"
            ? "PublisherIQ first observed this game during the catalog baseline, so its true added date is unknown."
            : "PublisherIQ has not recorded a durable first observation for this game.",
          iso(row.catalog_first_observed_at),
        );

  setResolved("tags", row.tags ?? []);
  setResolved("genres", row.genres ?? []);
  setResolved("categories", row.categories ?? []);
  setResolved("platforms", normalizeStringArray(row.platforms));
  setPics("controller_support", row.controller_support);
  setPics("steam_deck", row.steam_deck);
  setResolved("languages", normalizeStringArray(row.languages));
  setResolved(
    "content_descriptors",
    normalizeOpportunityContentDescriptors(row.content_descriptors),
  );
  setStorefront("has_demo", row.has_demo);
  fields.demo_only =
    storefrontReady &&
    row.is_released !== null &&
    row.has_purchase_packages !== null
      ? knownField(
          row.has_demo &&
            row.is_released === false &&
            row.has_purchase_packages === false,
          "steam_storefront",
          storefrontSourceAt,
        )
      : unknownField(
          "steam_storefront",
          storefrontReady
            ? "Release or purchase-package status is unavailable."
            : `Storefront readiness is ${row.storefront_status ?? "unknown"}.`,
          storefrontSourceAt,
        );

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
    description: parseOpportunityGameDescription(row.storefront_description),
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
    catalog_state.first_observed_at AS catalog_first_observed_at,
    catalog_state.first_observation_kind AS catalog_first_observation_kind,
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
    readiness_storefront.provenance->'description' AS storefront_description,
    readiness_pics.status AS pics_status,
    readiness_pics.source_at AS pics_source_at,
    readiness_market.status AS market_status,
    field_resolution.fields AS field_evidence,
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
  LEFT JOIN ops.app_catalog_state catalog_state
    ON catalog_state.appid = a.appid
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(
      resolved.field_name,
      jsonb_build_object(
        'source', resolved.source,
        'state', resolved.evidence_state,
        'value', resolved.value,
        'sourceAt', resolved.source_at,
        'version', resolved.version,
        'picsRecorded', resolved.pics_recorded
      )
    ) AS fields
    FROM (
      SELECT DISTINCT ON (evidence.field_name)
        evidence.field_name,
        evidence.source,
        evidence.evidence_state,
        evidence.value,
        evidence.source_at,
        evidence.version,
        bool_or(evidence.source = 'pics') OVER (
          PARTITION BY evidence.field_name
        ) AS pics_recorded
      FROM ops.app_field_evidence evidence
      WHERE evidence.appid = a.appid
      ORDER BY
        evidence.field_name,
        CASE evidence.evidence_state WHEN 'known' THEN 0 ELSE 1 END,
        CASE evidence.source WHEN 'pics' THEN 0 ELSE 1 END,
        evidence.source_at DESC
    ) resolved
  ) field_resolution ON true
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
    catalog_state.first_observed_at AS catalog_first_observed_at,
    catalog_state.first_observation_kind AS catalog_first_observation_kind,
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
    readiness_storefront.provenance->'description' AS storefront_description,
    readiness_pics.status AS pics_status,
    readiness_pics.source_at AS pics_source_at,
    readiness_market.status AS market_status,
    field_resolution.fields AS field_evidence,
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
  LEFT JOIN ops.app_catalog_state catalog_state
    ON catalog_state.appid = a.appid
  LEFT JOIN tag_values ON tag_values.appid = a.appid
  LEFT JOIN genre_values ON genre_values.appid = a.appid
  LEFT JOIN category_values ON category_values.appid = a.appid
  LEFT JOIN publisher_values ON publisher_values.appid = a.appid
  LEFT JOIN developer_values ON developer_values.appid = a.appid
  LEFT JOIN demo_values ON demo_values.appid = a.appid
  LEFT JOIN legacy.app_steam_deck deck ON deck.appid = a.appid
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(
      resolved.field_name,
      jsonb_build_object(
        'source', resolved.source,
        'state', resolved.evidence_state,
        'value', resolved.value,
        'sourceAt', resolved.source_at,
        'version', resolved.version,
        'picsRecorded', resolved.pics_recorded
      )
    ) AS fields
    FROM (
      SELECT DISTINCT ON (evidence.field_name)
        evidence.field_name,
        evidence.source,
        evidence.evidence_state,
        evidence.value,
        evidence.source_at,
        evidence.version,
        bool_or(evidence.source = 'pics') OVER (
          PARTITION BY evidence.field_name
        ) AS pics_recorded
      FROM ops.app_field_evidence evidence
      WHERE evidence.appid = a.appid
      ORDER BY
        evidence.field_name,
        CASE evidence.evidence_state WHEN 'known' THEN 0 ELSE 1 END,
        CASE evidence.source WHEN 'pics' THEN 0 ELSE 1 END,
        evidence.source_at DESC
    ) resolved
  ) field_resolution ON true
  WHERE a.type IN ('game', 'Game')
    AND COALESCE(a.is_delisted, false) = false
  ORDER BY a.appid
`;

export class OpportunityRepository {
  constructor(
    private readonly pool: Pool,
    private readonly orderReviewPriorityV2: OpportunityPriorityV2OrderControl = {
      ...DISABLED_OPPORTUNITY_WORKSPACE_FEATURE_CONTROL,
      allPolicies: false,
    },
  ) {}

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

  private async getActiveTeamForUser(
    userId: string,
  ): Promise<{ id: string; name: string } | null> {
    const result = await this.pool.query<
      QueryResultRow & { id: string; name: string }
    >(
      `
        SELECT team.id, team.name
        FROM opportunity.team_memberships membership
        JOIN opportunity.teams team ON team.id = membership.team_id
        WHERE membership.user_id = $1
          AND membership.status = 'active'
          AND team.status = 'active'
        LIMIT 1
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private async resolveRunAccess(
    identity: OpportunityIdentity,
    runId: string,
  ): Promise<LatestRunRow & OpportunityRecordAccess> {
    const result = await this.pool.query<
      LatestRunRow &
        QueryResultRow & {
          owner_user_id: string;
          owner_workspace_id: string;
          source_user_display: string | null;
          team_id: string | null;
          team_name: string | null;
        }
    >(
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
          cardinality(run.active_profile_versions) AS profiles_evaluated,
          run.user_id AS owner_user_id,
          run.workspace_id AS owner_workspace_id,
          owner_membership.team_id,
          team.name AS team_name,
          COALESCE(
            owner_membership.display_name,
            owner_membership.identity_email
          ) AS source_user_display
        FROM opportunity.runs run
        LEFT JOIN opportunity.team_memberships owner_membership
          ON owner_membership.user_id = run.user_id
          AND owner_membership.status = 'active'
        LEFT JOIN opportunity.teams team
          ON team.id = owner_membership.team_id
          AND team.status = 'active'
        LEFT JOIN opportunity.team_memberships viewer_membership
          ON viewer_membership.team_id = team.id
          AND viewer_membership.user_id = $2
          AND viewer_membership.status = 'active'
        WHERE run.id = $1
          AND run.run_kind IN ('daily', 'manual', 'replay')
          AND (
            run.user_id = $2
            OR viewer_membership.user_id = $2
          )
        LIMIT 1
      `,
      [runId, identity.userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new OpportunityNotFoundError(
        "The requested opportunity brief was not found.",
      );
    }
    const shared = row.owner_user_id !== identity.userId;
    return {
      ...row,
      access: {
        scope: shared ? "team" : "owner",
        sourceUserDisplay: shared ? row.source_user_display : null,
        team:
          row.team_id && row.team_name
            ? { id: row.team_id, name: decodeOpportunityText(row.team_name) }
            : null,
      },
      ownerUserId: row.owner_user_id,
      ownerWorkspaceId: row.owner_workspace_id,
    };
  }

  private async resolveResultAccess(params: {
    appid: number;
    identity: OpportunityIdentity;
    resultId: string;
  }): Promise<OpportunityRecordAccess> {
    const result = await this.pool.query<
      QueryResultRow & {
        owner_user_id: string;
        owner_workspace_id: string;
        source_user_display: string | null;
        team_id: string | null;
        team_name: string | null;
      }
    >(
      `
        SELECT
          canonical.user_id AS owner_user_id,
          canonical.workspace_id AS owner_workspace_id,
          owner_membership.team_id,
          team.name AS team_name,
          COALESCE(
            owner_membership.display_name,
            owner_membership.identity_email
          ) AS source_user_display
        FROM opportunity.results canonical
        LEFT JOIN opportunity.team_memberships owner_membership
          ON owner_membership.user_id = canonical.user_id
          AND owner_membership.status = 'active'
        LEFT JOIN opportunity.teams team
          ON team.id = owner_membership.team_id
          AND team.status = 'active'
        LEFT JOIN opportunity.team_memberships viewer_membership
          ON viewer_membership.team_id = team.id
          AND viewer_membership.user_id = $3
          AND viewer_membership.status = 'active'
        WHERE canonical.id = $1
          AND canonical.appid = $2
          AND (
            canonical.user_id = $3
            OR viewer_membership.user_id = $3
          )
        LIMIT 1
      `,
      [params.resultId, params.appid, params.identity.userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new OpportunityNotFoundError("Opportunity result not found.");
    }
    const shared = row.owner_user_id !== params.identity.userId;
    return {
      access: {
        scope: shared ? "team" : "owner",
        sourceUserDisplay: shared ? row.source_user_display : null,
        team:
          row.team_id && row.team_name
            ? { id: row.team_id, name: decodeOpportunityText(row.team_name) }
            : null,
      },
      ownerUserId: row.owner_user_id,
      ownerWorkspaceId: row.owner_workspace_id,
    };
  }

  async listTeams(): Promise<OpportunityTeamSummary[]> {
    const [teams, members] = await Promise.all([
      this.pool.query<
        QueryResultRow & {
          created_at: Date | string;
          id: string;
          name: string;
          slug: string;
          status: "active" | "archived";
          updated_at: Date | string;
        }
      >(
        `
          SELECT id, slug, name, status, created_at, updated_at
          FROM opportunity.teams
          ORDER BY status, lower(name), id
          LIMIT 100
        `,
      ),
      this.pool.query<
        QueryResultRow & {
          display_name: string | null;
          identity_email: string;
          joined_at: Date | string;
          status: "active" | "removed";
          team_id: string;
          user_id: string;
        }
      >(
        `
          SELECT
            team_id,
            user_id,
            identity_email,
            display_name,
            status,
            joined_at
          FROM opportunity.team_memberships
          ORDER BY team_id, status, lower(identity_email), user_id
          LIMIT 1000
        `,
      ),
    ]);
    return teams.rows.map((team) => ({
      createdAt: iso(team.created_at)!,
      id: team.id,
      members: members.rows
        .filter((member) => member.team_id === team.id)
        .map((member) => ({
          displayName: cleanOpportunityUserText(member.display_name),
          email: member.identity_email,
          joinedAt: iso(member.joined_at)!,
          status: member.status,
          userId: member.user_id,
        })),
      name: decodeOpportunityText(team.name),
      slug: team.slug,
      status: team.status,
      updatedAt: iso(team.updated_at)!,
    }));
  }

  async createTeam(params: {
    actorUserId: string;
    name: string;
  }): Promise<OpportunityTeamSummary> {
    const normalizedName = params.name.trim();
    try {
      await this.transaction(async (client) => {
        const created = await client.query<QueryResultRow & { id: string }>(
          `
            INSERT INTO opportunity.teams (slug, name, created_by)
            VALUES ($1, $2, $3)
            RETURNING id
          `,
          [teamSlug(normalizedName), normalizedName, params.actorUserId],
        );
        const teamId = created.rows[0]!.id;
        await client.query(
          `
            INSERT INTO opportunity.audit_log (
              team_id,
              actor_user_id,
              action,
              object_type,
              object_id,
              after_state
            )
            VALUES ($1, $2, 'team.created', 'team', $1::text, $3::jsonb)
          `,
          [
            teamId,
            params.actorUserId,
            JSON.stringify({ name: normalizedName }),
          ],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error("A team with this name already exists.");
      }
      throw error;
    }
    const team = (await this.listTeams()).find(
      (candidate) =>
        candidate.name.toLowerCase() === normalizedName.toLowerCase(),
    );
    if (!team) {
      throw new Error("The team was created but could not be reloaded.");
    }
    return team;
  }

  async updateTeam(params: {
    actorUserId: string;
    name?: string;
    status?: "active" | "archived";
    teamId: string;
  }): Promise<OpportunityTeamSummary> {
    try {
      await this.transaction(async (client) => {
        const current = await client.query<
          QueryResultRow & { name: string; status: string }
        >(
          `
            SELECT name, status
            FROM opportunity.teams
            WHERE id = $1
            FOR UPDATE
          `,
          [params.teamId],
        );
        const row = current.rows[0];
        if (!row) {
          throw new OpportunityNotFoundError("Team not found.");
        }
        const nextName = params.name?.trim() || row.name;
        const nextStatus = params.status ?? row.status;
        await client.query(
          `
            UPDATE opportunity.teams
            SET name = $2,
                slug = CASE WHEN name IS DISTINCT FROM $2 THEN $3 ELSE slug END,
                status = $4,
                updated_at = now()
            WHERE id = $1
          `,
          [params.teamId, nextName, teamSlug(nextName), nextStatus],
        );
        await client.query(
          `
            INSERT INTO opportunity.audit_log (
              team_id,
              actor_user_id,
              action,
              object_type,
              object_id,
              before_state,
              after_state
            )
            VALUES (
              $1,
              $2,
              'team.updated',
              'team',
              $1::text,
              $3::jsonb,
              $4::jsonb
            )
          `,
          [
            params.teamId,
            params.actorUserId,
            JSON.stringify({ name: row.name, status: row.status }),
            JSON.stringify({ name: nextName, status: nextStatus }),
          ],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error("A team with this name already exists.");
      }
      throw error;
    }
    const team = (await this.listTeams()).find(
      (candidate) => candidate.id === params.teamId,
    );
    if (!team) {
      throw new OpportunityNotFoundError("Team not found.");
    }
    return team;
  }

  async setTeamMembership(params: {
    active: boolean;
    actorUserId: string;
    displayName: string | null;
    email: string;
    teamId: string;
    userId: string;
  }): Promise<void> {
    try {
      await this.transaction(async (client) => {
        const team = await client.query<
          QueryResultRow & { status: "active" | "archived" }
        >(
          `
            SELECT status
            FROM opportunity.teams
            WHERE id = $1
            FOR UPDATE
          `,
          [params.teamId],
        );
        if (!team.rows[0]) {
          throw new OpportunityNotFoundError("Team not found.");
        }
        if (params.active && team.rows[0].status !== "active") {
          throw new Error("Members cannot be added to an archived team.");
        }
        if (params.active) {
          await client.query(
            `
              INSERT INTO opportunity.team_memberships (
                team_id,
                user_id,
                identity_email,
                display_name,
                status,
                added_by,
                removed_at
              )
              VALUES ($1, $2, $3, $4, 'active', $5, NULL)
              ON CONFLICT (team_id, user_id)
              DO UPDATE SET
                identity_email = EXCLUDED.identity_email,
                display_name = EXCLUDED.display_name,
                status = 'active',
                added_by = EXCLUDED.added_by,
                removed_at = NULL,
                updated_at = now()
            `,
            [
              params.teamId,
              params.userId,
              params.email,
              params.displayName,
              params.actorUserId,
            ],
          );
        } else {
          const removed = await client.query(
            `
              UPDATE opportunity.team_memberships
              SET status = 'removed',
                  removed_at = now(),
                  updated_at = now()
              WHERE team_id = $1
                AND user_id = $2
                AND status = 'active'
            `,
            [params.teamId, params.userId],
          );
          if ((removed.rowCount ?? 0) === 0) {
            throw new OpportunityNotFoundError("Active team member not found.");
          }
          await client.query(
            `
              UPDATE opportunity.team_research_state
              SET is_researching = false,
                  cleared_at = now(),
                  updated_at = now()
              WHERE team_id = $1
                AND user_id = $2
                AND is_researching
            `,
            [params.teamId, params.userId],
          );
        }
        await client.query(
          `
            INSERT INTO opportunity.audit_log (
              team_id,
              actor_user_id,
              action,
              object_type,
              object_id,
              after_state
            )
            VALUES ($1, $2, $3, 'team_membership', $4, $5::jsonb)
          `,
          [
            params.teamId,
            params.actorUserId,
            params.active ? "team.member_added" : "team.member_removed",
            params.userId,
            JSON.stringify({ active: params.active, email: params.email }),
          ],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error("This user already belongs to an active team.");
      }
      throw error;
    }
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
        description: cleanOpportunityUserText(row.description),
        healthState: healthSupported ? row.health_state : null,
        healthUnavailableReason: healthSupported ? null : "unreleased_only",
        id: row.id,
        name: decodeOpportunityText(row.name),
        ruleSummary: describeOpportunityRuleSet(row.rules).map(
          decodeOpportunityText,
        ),
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
      description: cleanOpportunityUserText(row.description),
      id: row.id,
      immediateFullMatchEnabled: row.immediate_full_match_enabled,
      localDeliveryTime: row.local_delivery_time,
      name: cleanOpportunityProfileName(row.name),
      nextEvaluationAt: iso(row.next_evaluation_at),
      sourcePresetName: cleanOpportunityUserText(row.source_preset_name),
      status: row.status,
      timezone: row.timezone,
      updatedAt: iso(row.updated_at)!,
    }));
  }

  private async getBriefRun(params: {
    runId?: string | null;
    userId: string;
    workspaceId: string;
  }): Promise<LatestRunRow | null> {
    const result = await this.pool.query<LatestRunRow>(
      params.runId
        ? `
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
          WHERE run.id = $3
            AND run.workspace_id = $1
            AND run.user_id = $2
            AND run.run_kind IN ('daily', 'manual', 'replay')
          LIMIT 1
        `
        : `
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
            AND run.status = 'completed'
          ORDER BY
            run.window_end DESC,
            run.completed_at DESC NULLS LAST,
            run.id DESC
          LIMIT 1
        `,
      params.runId
        ? [params.workspaceId, params.userId, params.runId]
        : [params.workspaceId, params.userId],
    );
    if (params.runId && !result.rows[0]) {
      throw new OpportunityNotFoundError(
        "The requested opportunity brief was not found.",
      );
    }
    return result.rows[0] ?? null;
  }

  private async queryBriefResultRows(params: {
    cursor?: string | null;
    eventLabel?: OpportunityResultLabel | null;
    limit: number;
    orderReviewPriorityV2: boolean;
    profileId?: string | null;
    run: LatestRunRow;
    userId: string;
  }): Promise<{ hasMore: boolean; results: OpportunityResultSummary[] }> {
    const profileId = params.profileId ?? null;
    const eventLabel = params.eventLabel ?? null;
    const filterKey = opportunityCursorFilterKey({
      eventLabel,
      profileId,
      runId: params.run.id,
    });
    const cursor = decodeOpportunityResultCursor(
      params.cursor ?? null,
      filterKey,
      params.orderReviewPriorityV2 ? "review_priority_v2" : "score",
    );
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(params.limit)));
    const cursorPredicateSql = params.orderReviewPriorityV2
      ? `
          AND (
            NOT $8::boolean
            OR result.rank > $9::integer
            OR (
              result.rank = $9::integer
              AND (
                result.appid > $10
                OR (result.appid = $10 AND result.id > $11::uuid)
              )
            )
          )`
      : `
          AND (
            NOT $8::boolean
            OR (
              $9::numeric IS NOT NULL
              AND (
                result.score < $9
                OR result.score IS NULL
                OR (
                  result.score = $9
                  AND (
                    result.appid > $10
                    OR (result.appid = $10 AND result.id > $11::uuid)
                  )
                )
              )
            )
            OR (
              $9::numeric IS NULL
              AND result.score IS NULL
              AND (
                result.appid > $10
                OR (result.appid = $10 AND result.id > $11::uuid)
              )
            )
          )`;
    const resultOrderSql = params.orderReviewPriorityV2
      ? "result.rank ASC, result.appid, result.id"
      : "result.score DESC NULLS LAST, result.appid, result.id";
    const result = await this.pool.query<ResultRow>(
      `
        SELECT
          result.id,
          result.appid,
          app.name,
          CASE WHEN material.id IS NULL THEN NULL ELSE jsonb_build_object(
            'eventType', material.event_type,
            'signalFamily', material.signal_family,
            'effectiveAt', material.effective_at,
            'observedAt', material.observed_at,
            'confidence', material.confidence,
            'affectedRuleFields', material.affected_rule_fields,
            'before', material.before_summary,
            'after', material.after_summary
          ) END AS change,
          result.event_label,
          result.event_fingerprint,
          selected_media.hero_assets->>'header' AS header_image_url,
          selected_media.screenshots->0->>'thumbnailUrl'
            AS screenshot_thumbnail_url,
          COALESCE(trigger_media.media_addition, false)
            AS triggered_by_media_addition,
          result.rank,
          result.score,
          result.rank_components,
          result.evidence_summary->'gameDescription' AS game_description,
          result.evidence_summary->'reviewPriorityV2' AS review_priority,
          result.confidence,
          result.created_at,
          COALESCE(market.potential_band, 'insufficient_data')
            AS market_potential,
          COALESCE(result.why_now->>'summary', result.event_label) AS why_now,
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
              DISTINCT jsonb_build_object('id', profile.id, 'name', profile.name)
            ) FILTER (WHERE profile.id IS NOT NULL),
            '[]'::jsonb
          ) AS matched_profiles
        FROM opportunity.results result
        JOIN legacy.apps app ON app.appid = result.appid
        LEFT JOIN opportunity.material_events material
          ON material.id = result.material_event_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            bool_or(raw.change_type IN ('screenshot_added', 'trailer_added')),
            false
          ) AS media_addition
          FROM events.app_change_events raw
          WHERE material.id IS NOT NULL
            AND raw.appid = result.appid
            AND raw.occurred_at >= material.grouped_window_start
            AND raw.occurred_at <= material.grouped_window_end
            AND ('raw:' || raw.id::text) IN (
              SELECT jsonb_array_elements_text(
                COALESCE(material.raw_event_refs, '[]'::jsonb)
              )
            )
        ) trigger_media ON true
        LEFT JOIN LATERAL (
          SELECT media.hero_assets, media.screenshots
          FROM docs.app_media_versions media
          WHERE media.appid = result.appid
          ORDER BY media.first_seen_at DESC, media.id DESC
          LIMIT 1
        ) selected_media ON true
        LEFT JOIN opportunity.market_context_snapshots market
          ON market.id = result.market_context_snapshot_id
        LEFT JOIN opportunity.result_profile_matches match
          ON match.result_id = result.id
        LEFT JOIN opportunity.profiles profile
          ON profile.id = match.profile_id
        WHERE result.user_id = $2
          AND ${opportunityPersistedResultContentSafetySql("result", "app")}
          AND (
            result.run_id = $1
            OR (
              $5::text = 'daily'
              AND result.created_at >= $3
              AND result.created_at < $4
            )
          )
          AND (
            $6::uuid IS NULL
            OR EXISTS (
              SELECT 1
              FROM opportunity.result_profile_matches selected_match
              WHERE selected_match.result_id = result.id
                AND selected_match.profile_id = $6
            )
          )
          AND ($7::text IS NULL OR result.event_label = $7)
          ${cursorPredicateSql}
        GROUP BY
          result.id,
          app.name,
          market.potential_band,
          material.id,
          selected_media.hero_assets,
          selected_media.screenshots,
          trigger_media.media_addition
        ORDER BY ${resultOrderSql}
        LIMIT $12
      `,
      [
        params.run.id,
        params.userId,
        params.run.window_start,
        params.run.window_end,
        params.run.run_kind,
        profileId,
        eventLabel,
        cursor !== null,
        params.orderReviewPriorityV2
          ? (cursor?.rank ?? 0)
          : (cursor?.score ?? null),
        cursor?.appid ?? 0,
        cursor?.id ?? "00000000-0000-0000-0000-000000000000",
        boundedLimit + 1,
      ],
    );
    const hasMore = result.rows.length > boundedLimit;
    const rows = result.rows.slice(0, boundedLimit);
    const changes = await presentOpportunityChanges(
      this.pool,
      rows.map((row) => row.change),
      rows.map((row) => row.event_label),
    );
    return {
      hasMore,
      results: rows.map((row, index) =>
        this.mapResult({ ...row, change: changes[index] ?? null }),
      ),
    };
  }

  private async queryBriefFeaturedRows(params: {
    limit: number;
    orderReviewPriorityV2: boolean;
    run: LatestRunRow;
    userId: string;
  }): Promise<OpportunityResultSummary[]> {
    const boundedLimit = Math.max(1, Math.min(10, Math.floor(params.limit)));
    const scopedOrderSql = params.orderReviewPriorityV2
      ? "scoped.rank ASC NULLS LAST,"
      : "scoped.score DESC NULLS LAST,";
    const rankedOrderSql = params.orderReviewPriorityV2
      ? "ranked.rank ASC NULLS LAST, ranked.appid, ranked.id"
      : "ranked.score DESC NULLS LAST, ranked.appid, ranked.id";
    const resultOrderSql = params.orderReviewPriorityV2
      ? "result.rank ASC NULLS LAST, result.appid, result.id"
      : "result.score DESC NULLS LAST, result.appid, result.id";
    const result = await this.pool.query<ResultRow>(
      `
        WITH scoped AS MATERIALIZED (
          SELECT candidate.*
          FROM opportunity.results candidate
          WHERE candidate.user_id = $2
            AND ${opportunityPersistedResultContentSafetySql("candidate")}
            AND (
              candidate.run_id = $1
              OR (
                $5::text = 'daily'
                AND candidate.created_at >= $3
                AND candidate.created_at < $4
              )
            )
        ),
        ranked AS MATERIALIZED (
          SELECT
            scoped.*,
            row_number() OVER (
              PARTITION BY scoped.appid
              ORDER BY
                ${scopedOrderSql}
                scoped.created_at DESC,
                scoped.id
            ) AS editorial_rank
          FROM scoped
        ),
        canonical AS (
          SELECT ranked.*
          FROM ranked
          WHERE ranked.editorial_rank = 1
          ORDER BY ${rankedOrderSql}
          LIMIT $6
        )
        SELECT
          result.id,
          result.appid,
          app.name,
          CASE WHEN material.id IS NULL THEN NULL ELSE jsonb_build_object(
            'eventType', material.event_type,
            'signalFamily', material.signal_family,
            'effectiveAt', material.effective_at,
            'observedAt', material.observed_at,
            'confidence', material.confidence,
            'affectedRuleFields', material.affected_rule_fields,
            'before', material.before_summary,
            'after', material.after_summary
          ) END AS change,
          result.event_label,
          result.event_fingerprint,
          selected_media.hero_assets->>'header' AS header_image_url,
          selected_media.screenshots->0->>'thumbnailUrl'
            AS screenshot_thumbnail_url,
          COALESCE(trigger_media.media_addition, false)
            AS triggered_by_media_addition,
          result.rank,
          result.score,
          result.rank_components,
          result.evidence_summary->'gameDescription' AS game_description,
          result.evidence_summary->'reviewPriorityV2' AS review_priority,
          result.confidence,
          result.created_at,
          COALESCE(market.potential_band, 'insufficient_data')
            AS market_potential,
          COALESCE(result.why_now->>'summary', result.event_label) AS why_now,
          COALESCE(
            ARRAY(
              SELECT jsonb_array_elements_text(
                COALESCE(result.evidence_summary->'strongest', '[]'::jsonb)
              )
            ),
            '{}'::text[]
          ) AS strongest_evidence,
          profile_matches.matched_profiles
        FROM canonical result
        JOIN legacy.apps app ON app.appid = result.appid
        LEFT JOIN opportunity.material_events material
          ON material.id = result.material_event_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            bool_or(raw.change_type IN ('screenshot_added', 'trailer_added')),
            false
          ) AS media_addition
          FROM events.app_change_events raw
          WHERE material.id IS NOT NULL
            AND raw.appid = result.appid
            AND raw.occurred_at >= material.grouped_window_start
            AND raw.occurred_at <= material.grouped_window_end
            AND ('raw:' || raw.id::text) IN (
              SELECT jsonb_array_elements_text(
                COALESCE(material.raw_event_refs, '[]'::jsonb)
              )
            )
        ) trigger_media ON true
        LEFT JOIN LATERAL (
          SELECT media.hero_assets, media.screenshots
          FROM docs.app_media_versions media
          WHERE media.appid = result.appid
          ORDER BY media.first_seen_at DESC, media.id DESC
          LIMIT 1
        ) selected_media ON true
        LEFT JOIN opportunity.market_context_snapshots market
          ON market.id = result.market_context_snapshot_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object('id', profile.id, 'name', profile.name)
            ) FILTER (WHERE profile.id IS NOT NULL),
            '[]'::jsonb
          ) AS matched_profiles
          FROM scoped related
          JOIN opportunity.result_profile_matches match
            ON match.result_id = related.id
          JOIN opportunity.profiles profile ON profile.id = match.profile_id
          WHERE related.appid = result.appid
            AND profile.status <> 'archived'
        ) profile_matches ON true
        ORDER BY ${resultOrderSql}
        LIMIT $6
      `,
      [
        params.run.id,
        params.userId,
        params.run.window_start,
        params.run.window_end,
        params.run.run_kind,
        boundedLimit,
      ],
    );
    const changes = await presentOpportunityChanges(
      this.pool,
      result.rows.map((row) => row.change),
      result.rows.map((row) => row.event_label),
    );
    return result.rows.map((row, index) =>
      this.mapResult({ ...row, change: changes[index] ?? null }),
    );
  }

  async getDailyBrief(
    identity: OpportunityIdentity,
    params: { runId?: string | null } = {},
  ): Promise<OpportunityDailyBriefIssue> {
    const workspace = await this.ensureWorkspace(identity);
    const explicitRun = params.runId
      ? await this.resolveRunAccess(identity, params.runId)
      : null;
    const access: OpportunityAccessContext = explicitRun?.access ?? {
      scope: "owner",
      sourceUserDisplay: null,
      team: null,
    };
    const ownerUserId = explicitRun?.ownerUserId ?? identity.userId;
    const ownerWorkspaceId = explicitRun?.ownerWorkspaceId ?? workspace.id;
    const shared = access.scope === "team";
    const [profiles, run] = await Promise.all([
      shared
        ? Promise.resolve([] as OpportunityProfileSummary[])
        : this.listProfiles(ownerWorkspaceId, ownerUserId),
      explicitRun
        ? Promise.resolve(explicitRun)
        : this.getBriefRun({
            userId: identity.userId,
            workspaceId: workspace.id,
          }),
    ]);
    if (!run) {
      return {
        ...buildOpportunityDailyBriefIssue({
          availableResultCount: 0,
          coverageWarnings: [],
          featuredCandidates: [],
          highConfidenceCount: 0,
          issueDate: null,
          newerRunUpdating: false,
          profiles,
          profilesEvaluated: 0,
          profileStats: [],
          runId: null,
          status: "not_run",
          windowEnd: null,
          windowStart: null,
        }),
        access,
      };
    }
    const orderReviewPriorityV2 =
      this.orderReviewPriorityV2.allPolicies &&
      isOpportunityWorkspaceFeatureEnabled(
        this.orderReviewPriorityV2,
        ownerWorkspaceId,
      );
    const profileTopResultOrderSql = orderReviewPriorityV2
      ? "scoped.rank ASC NULLS LAST, scoped.appid, scoped.id"
      : "scoped.score DESC NULLS LAST, scoped.appid, scoped.id";

    const scopeParams = [
      run.id,
      ownerUserId,
      run.window_start,
      run.window_end,
      run.run_kind,
    ];
    const [summary, profileStatsResult, featured, newerRun] = await Promise.all(
      [
        this.pool.query<
          QueryResultRow & {
            high_confidence_count: number | string;
            result_count: number | string;
          }
        >(
          `
          SELECT
            COUNT(DISTINCT result.appid) AS result_count,
            COUNT(DISTINCT result.appid) FILTER (
              WHERE result.confidence = 'high'
            ) AS high_confidence_count
          FROM opportunity.results result
          WHERE result.user_id = $2
            AND ${opportunityPersistedResultContentSafetySql("result")}
            AND (
              result.run_id = $1
              OR (
                $5::text = 'daily'
                AND result.created_at >= $3
                AND result.created_at < $4
              )
            )
          LIMIT 1
        `,
          scopeParams,
        ),
        shared
          ? Promise.resolve({ rows: [] } as { rows: BriefProfileStatsRow[] })
          : this.pool.query<BriefProfileStatsRow>(
              `
          WITH scoped AS (
            SELECT result.*
            FROM opportunity.results result
            WHERE result.user_id = $2
              AND ${opportunityPersistedResultContentSafetySql("result")}
              AND (
                result.run_id = $1
                OR (
                  $5::text = 'daily'
                  AND result.created_at >= $3
                  AND result.created_at < $4
                )
              )
          )
          SELECT
            profile.id AS profile_id,
            COUNT(DISTINCT scoped.appid) AS result_count,
            COUNT(DISTINCT scoped.appid) FILTER (
              WHERE scoped.confidence = 'high'
            ) AS high_confidence_count,
            COUNT(DISTINCT scoped.appid) FILTER (
              WHERE scoped.event_label = 'newly_discovered'
            ) AS newly_discovered_count,
            COUNT(DISTINCT scoped.appid) FILTER (
              WHERE scoped.event_label = 'newly_released'
            ) AS newly_released_count,
            COUNT(DISTINCT scoped.appid) FILTER (
              WHERE scoped.event_label = 'newly_qualified'
            ) AS newly_qualified_count,
            COUNT(DISTINCT scoped.appid) FILTER (
              WHERE scoped.event_label = 'materially_changed'
            ) AS materially_changed_count,
            COUNT(DISTINCT scoped.appid) FILTER (
              WHERE scoped.event_label = 'tracked_update'
            ) AS tracked_update_count,
            (array_agg(
              jsonb_build_object(
                'appid', scoped.appid,
                'name', app.name,
                'resultId', scoped.id
              )
              ORDER BY ${profileTopResultOrderSql}
            ) FILTER (WHERE scoped.id IS NOT NULL))[1] AS top_result
          FROM opportunity.profiles profile
          LEFT JOIN opportunity.result_profile_matches match
            ON match.profile_id = profile.id
          LEFT JOIN scoped ON scoped.id = match.result_id
          LEFT JOIN legacy.apps app ON app.appid = scoped.appid
          WHERE profile.workspace_id = $6
            AND profile.owner_user_id = $2
            AND profile.status <> 'archived'
          GROUP BY profile.id
          ORDER BY profile.updated_at DESC, profile.id
          LIMIT 100
              `,
              [...scopeParams, ownerWorkspaceId],
            ),
        this.queryBriefFeaturedRows({
          limit: 10,
          orderReviewPriorityV2,
          run,
          userId: ownerUserId,
        }),
        shared
          ? Promise.resolve({ rowCount: 0 })
          : this.pool.query(
              `
          SELECT 1
          FROM opportunity.runs newer
          WHERE newer.workspace_id = $1
            AND newer.user_id = $2
            AND newer.run_kind IN ('daily', 'manual', 'replay')
            AND newer.status = 'running'
            AND (
              newer.window_end > $3
              OR newer.started_at > $4
            )
          LIMIT 1
              `,
              [
                ownerWorkspaceId,
                ownerUserId,
                run.window_end,
                run.completed_at ?? run.started_at,
              ],
            ),
      ],
    );
    const summaryRow = summary.rows[0];
    const profileStats: OpportunityBriefProfileStats[] =
      profileStatsResult.rows.map((row) => ({
        eventCounts: {
          ...emptyOpportunityEventCounts(),
          materially_changed: Number(row.materially_changed_count),
          newly_discovered: Number(row.newly_discovered_count),
          newly_qualified: Number(row.newly_qualified_count),
          newly_released: Number(row.newly_released_count),
          tracked_update: Number(row.tracked_update_count),
        },
        highConfidenceCount: Number(row.high_confidence_count),
        profileId: row.profile_id,
        resultCount: Number(row.result_count),
        topResult: row.top_result,
      }));
    const availableResultCount = Number(summaryRow?.result_count ?? 0);

    const issue = buildOpportunityDailyBriefIssue({
      availableResultCount,
      coverageWarnings: shared
        ? []
        : (run.coverage_warnings ?? []).map(cleanOpportunityCoverageWarning),
      featuredCandidates: shared
        ? featured.map(redactOpportunityResult)
        : featured,
      highConfidenceCount: Number(summaryRow?.high_confidence_count ?? 0),
      issueDate: iso(run.completed_at ?? run.window_end),
      newerRunUpdating:
        !shared && ((newerRun.rowCount ?? 0) > 0 || run.status === "running"),
      profiles,
      profilesEvaluated: run.profiles_evaluated,
      profileStats,
      runId: run.id,
      status:
        run.status === "completed"
          ? availableResultCount > 0
            ? "ready"
            : "empty"
          : run.status === "running"
            ? "running"
            : "failed",
      windowEnd: iso(run.window_end),
      windowStart: iso(run.window_start),
    });
    return {
      ...issue,
      access,
      profileDispatches: shared ? [] : issue.profileDispatches,
      profilesEvaluated: shared ? 0 : issue.profilesEvaluated,
    };
  }

  async listResults(
    identity: OpportunityIdentity,
    params: {
      cursor?: string | null;
      eventLabel?: OpportunityResultLabel | null;
      profileId?: string | null;
      runId: string;
    },
  ): Promise<OpportunityResultPage> {
    await this.ensureWorkspace(identity);
    const run = await this.resolveRunAccess(identity, params.runId);
    const shared = run.access.scope === "team";
    if (params.profileId) {
      if (shared) {
        throw new OpportunityNotFoundError(
          "The requested opportunity profile was not found.",
        );
      }
      const profile = await this.pool.query(
        `
          SELECT 1
          FROM opportunity.profiles
          WHERE id = $1
            AND workspace_id = $2
            AND owner_user_id = $3
            AND status <> 'archived'
          LIMIT 1
        `,
        [params.profileId, run.ownerWorkspaceId, run.ownerUserId],
      );
      if (!profile.rows[0]) {
        throw new OpportunityNotFoundError(
          "The requested opportunity profile was not found.",
        );
      }
    }
    const orderReviewPriorityV2 =
      this.orderReviewPriorityV2.allPolicies &&
      isOpportunityWorkspaceFeatureEnabled(
        this.orderReviewPriorityV2,
        run.ownerWorkspaceId,
      );
    const page = await this.queryBriefResultRows({
      cursor: params.cursor,
      eventLabel: params.eventLabel,
      limit: 25,
      orderReviewPriorityV2,
      profileId: params.profileId,
      run,
      userId: run.ownerUserId,
    });
    const lastResult = page.results.at(-1) ?? null;
    const filterKey = opportunityCursorFilterKey({
      eventLabel: params.eventLabel ?? null,
      profileId: params.profileId ?? null,
      runId: run.id,
    });
    return {
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && lastResult
          ? encodeOpportunityResultCursor(
              lastResult,
              filterKey,
              orderReviewPriorityV2 ? "review_priority_v2" : "score",
            )
          : null,
      pageSize: 25,
      access: run.access,
      results: shared
        ? page.results.map(redactOpportunityResult)
        : page.results,
      runId: run.id,
    };
  }

  async getLatestDailyOverview(
    workspaceId: string,
    userId: string,
  ): Promise<OpportunityDailyOverview> {
    const orderReviewPriorityV2 =
      this.orderReviewPriorityV2.allPolicies &&
      isOpportunityWorkspaceFeatureEnabled(
        this.orderReviewPriorityV2,
        workspaceId,
      );
    const resultRankSql = orderReviewPriorityV2
      ? "result.rank::integer AS rank"
      : `row_number() OVER (
            ORDER BY result.score DESC NULLS LAST, result.appid, result.id
          )::integer AS rank`;
    const resultOrderSql = orderReviewPriorityV2
      ? "result.rank ASC NULLS LAST, result.appid, result.id"
      : "result.score DESC NULLS LAST, result.appid, result.id";
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
          explanation: [
            {
              active: "Recent demand among matching games is broadly steady.",
              cooling: "Recent demand among matching games has softened.",
              growing: "More matching games are showing positive demand.",
              insufficient_data:
                "More released games are needed for a reliable market comparison.",
              quiet: "Few matching games are showing material demand changes.",
              surging:
                "Reviews and player activity are improving across matching games.",
            }[row.state],
          ],
          maximumEvaluated,
          name: decodeOpportunityText(row.name),
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
          CASE WHEN material.id IS NULL THEN NULL ELSE jsonb_build_object(
            'eventType', material.event_type,
            'signalFamily', material.signal_family,
            'effectiveAt', material.effective_at,
            'observedAt', material.observed_at,
            'confidence', material.confidence,
            'affectedRuleFields', material.affected_rule_fields,
            'before', material.before_summary,
            'after', material.after_summary
          ) END AS change,
          result.event_label,
          result.event_fingerprint,
          selected_media.hero_assets->>'header' AS header_image_url,
          COALESCE(trigger_media.media_addition, false)
            AS triggered_by_media_addition,
          ${resultRankSql},
          result.score,
          result.rank_components,
          result.evidence_summary->'gameDescription' AS game_description,
          result.evidence_summary->'reviewPriorityV2' AS review_priority,
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
        LEFT JOIN opportunity.material_events material
          ON material.id = result.material_event_id
        LEFT JOIN LATERAL (
          SELECT
            (
              array_agg(
                raw.media_version_id
                ORDER BY raw.occurred_at DESC, raw.id DESC
              ) FILTER (WHERE raw.media_version_id IS NOT NULL)
            )[1] AS media_version_id,
            COALESCE(
              bool_or(
                raw.change_type IN ('screenshot_added', 'trailer_added')
              ),
              false
            ) AS media_addition
          FROM events.app_change_events raw
          WHERE material.id IS NOT NULL
            AND raw.appid = result.appid
            AND raw.occurred_at >= material.grouped_window_start
            AND raw.occurred_at <= material.grouped_window_end
            AND ('raw:' || raw.id::text) IN (
              SELECT jsonb_array_elements_text(
                COALESCE(material.raw_event_refs, '[]'::jsonb)
              )
            )
        ) trigger_media ON true
        LEFT JOIN LATERAL (
          SELECT media.hero_assets
          FROM docs.app_media_versions media
          WHERE media.appid = result.appid
          ORDER BY
            CASE
              WHEN media.id = trigger_media.media_version_id THEN 0
              WHEN media.first_seen_at <= result.created_at THEN 1
              ELSE 2
            END,
            CASE
              WHEN media.id = trigger_media.media_version_id
                THEN media.first_seen_at
              ELSE NULL
            END DESC,
            CASE
              WHEN media.first_seen_at <= result.created_at
                THEN media.first_seen_at
              ELSE NULL
            END DESC,
            media.first_seen_at DESC,
            media.id DESC
          LIMIT 1
        ) selected_media ON true
        LEFT JOIN opportunity.market_context_snapshots market
          ON market.id = result.market_context_snapshot_id
        LEFT JOIN opportunity.result_profile_matches match
          ON match.result_id = result.id
        LEFT JOIN opportunity.profiles profile
          ON profile.id = match.profile_id
        WHERE result.user_id = $2
          AND ${opportunityPersistedResultContentSafetySql("result", "app")}
          AND (
            result.run_id = $1
            OR (
              $5::text = 'daily'
              AND result.created_at >= $3
              AND result.created_at < $4
            )
          )
        GROUP BY
          result.id,
          app.name,
          market.potential_band,
          material.id,
          selected_media.hero_assets,
          trigger_media.media_addition
        ORDER BY ${resultOrderSql}
        LIMIT 500
      `,
      [run.id, userId, run.window_start, run.window_end, run.run_kind],
    );
    const changes = await presentOpportunityChanges(
      this.pool,
      results.rows.map((row) => row.change),
      results.rows.map((row) => row.event_label),
    );
    const summaries = results.rows.map((row, index) =>
      this.mapResult({ ...row, change: changes[index] ?? null }),
    );
    const group = (label: OpportunityResultSummary["eventLabel"]) =>
      summaries.filter((summary) => summary.eventLabel === label);

    return {
      coverageWarnings: Array.from(
        new Set(
          (run.coverage_warnings ?? []).map(cleanOpportunityCoverageWarning),
        ),
      ),
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
      label:
        {
          catalog: "Steam catalog",
          creator: "Creator coverage",
          market_metrics: "Player and review activity",
          pics: "Steam features and positioning",
          storefront: "Steam store details",
        }[row.source] ?? "Game information",
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
      workspace: decodeOpportunityValue(workspace),
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
    rankingPolicy?: OpportunityRankingPolicy;
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
            created_by,
            rule_schema_version
          )
          VALUES (
            $1,
            1,
            $2::jsonb,
            $3::text[],
            $4::jsonb,
            $5,
            CASE WHEN $6 THEN now() ELSE NULL END,
            $7,
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
          profileId,
          JSON.stringify(params.rules),
          params.eventSubscriptions,
          JSON.stringify({
            cohortVersion: OPPORTUNITY_COHORT_VERSION,
            healthVersion: OPPORTUNITY_HEALTH_VERSION,
            marketVersion: OPPORTUNITY_MARKET_VERSION,
            rankingVersion: OPPORTUNITY_RANKING_VERSION,
            rankingPolicy:
              params.rankingPolicy ??
              resolveOpportunityRankingPolicy({ rules: params.rules }).policy,
          }),
          sourcePreset?.rows[0]?.version_id ?? null,
          params.enabled,
          params.identity.userId,
          params.rules.schemaVersion,
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
        slug: string;
        version_id: string;
      }
    >(
      `
        SELECT
          preset.name,
          preset.description,
          preset.slug,
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
      description: cleanOpportunityUserText(row.description),
      enabled: false,
      eventSubscriptions: row.event_subscriptions,
      identity: params.identity,
      immediateFullMatchEnabled: false,
      localDeliveryTime: params.localDeliveryTime,
      name: params.name?.trim() || cleanOpportunityProfileName(row.name),
      rankingPolicy:
        row.slug === "upcoming-games-with-demos"
          ? "discover_new_games"
          : row.slug === "new-self-published-indie-releases" ||
              row.slug === "recently-released-early-traction"
            ? "find_emerging_traction"
            : "monitor_material_changes",
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
      description: cleanOpportunityUserText(row.description),
      id: row.id,
      immediateFullMatchEnabled: row.immediate_full_match_enabled,
      localDeliveryTime: row.local_delivery_time,
      name: cleanOpportunityProfileName(row.name),
      nextEvaluationAt: iso(row.next_evaluation_at),
      sourcePresetName: cleanOpportunityUserText(row.source_preset_name),
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
    rankingPolicy?: OpportunityRankingPolicy;
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
            created_by,
            rule_schema_version
          )
          VALUES (
            $1,
            $2,
            $3::jsonb,
            $4::text[],
            $5::jsonb,
            $6,
            CASE WHEN $7 = 'enabled' THEN now() ELSE NULL END,
            $8,
            $9
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
          JSON.stringify({
            ...(current.calculation_config ?? {
              cohortVersion: OPPORTUNITY_COHORT_VERSION,
              healthVersion: OPPORTUNITY_HEALTH_VERSION,
              marketVersion: OPPORTUNITY_MARKET_VERSION,
              rankingVersion: OPPORTUNITY_RANKING_VERSION,
            }),
            rankingPolicy:
              params.rankingPolicy ??
              (current.calculation_config?.rankingPolicy as
                | OpportunityRankingPolicy
                | undefined) ??
              resolveOpportunityRankingPolicy({ rules: params.rules }).policy,
          }),
          current.source_preset_version_id,
          current.status,
          params.identity.userId,
          params.rules.schemaVersion,
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
        ${compiled.fromSql}
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

  async getPreviewCatalog(
    compiled: OpportunityCompiledPreview,
    limit = 80,
  ): Promise<OpportunityPreviewCatalog> {
    const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const requiredAliases = compiled.requiredGroups.map(
      (_group, index) => `required_group_${index}`,
    );
    const coverageAliases = compiled.coverageFields.map(
      (_coverage, index) => `coverage_${index}`,
    );
    const requiredMatch =
      requiredAliases.length === 0
        ? "TRUE"
        : requiredAliases
            .map((alias) => `COALESCE(${alias}, FALSE)`)
            .join(" AND ");
    const stageObject =
      compiled.requiredGroups.length === 0
        ? `'{}'::jsonb`
        : `jsonb_build_object(${compiled.requiredGroups
            .flatMap((group, index) => [
              `'${group.groupId.replaceAll("'", "''")}'`,
              `COUNT(1) FILTER (WHERE ${requiredAliases
                .slice(0, index + 1)
                .map((alias) => `COALESCE(${alias}, FALSE)`)
                .join(" AND ")})`,
            ])
            .join(", ")})`;
    const coverageObject =
      compiled.coverageFields.length === 0
        ? `'{}'::jsonb`
        : `jsonb_build_object(${compiled.coverageFields
            .flatMap((coverage, index) => [
              `'${coverage.field}'`,
              `COUNT(1) FILTER (WHERE COALESCE(${coverageAliases[index]}, FALSE))`,
            ])
            .join(", ")})`;
    const client = await this.pool.connect();
    try {
      const aggregateResult = await client.query<PreviewAggregateRow>(
        `
          WITH rule_groups AS MATERIALIZED (
            SELECT
              a.appid,
              a.release_date,
              (${compiled.excludedSql}) AS excluded_match
              ${
                compiled.requiredGroups.length > 0
                  ? `,${compiled.requiredGroups
                      .map(
                        (group, index) =>
                          `\n              (${group.matchSql}) AS ${requiredAliases[index]}`,
                      )
                      .join(",")}`
                  : ""
              }
              ${
                compiled.coverageFields.length > 0
                  ? `,${compiled.coverageFields
                      .map(
                        (coverage, index) =>
                          `\n              (${coverage.knownSql}) AS ${coverageAliases[index]}`,
                      )
                      .join(",")}`
                  : ""
              }
            ${compiled.fromSql}
          ),
          evaluated AS MATERIALIZED (
            SELECT
              rule_groups.*,
              ((${requiredMatch}) AND NOT COALESCE(excluded_match, FALSE))
                AS is_match
            FROM rule_groups
          )
          SELECT
            COUNT(1) AS total_catalog,
            COUNT(1) FILTER (WHERE is_match) AS total_matches,
            ${stageObject} AS stage_counts,
            ${coverageObject} AS coverage_counts,
            ARRAY(
              SELECT candidate.appid
              FROM evaluated candidate
              LEFT JOIN legacy.latest_daily_metrics candidate_metrics
                ON candidate_metrics.appid = candidate.appid
              WHERE candidate.is_match
              ORDER BY
                COALESCE(candidate.release_date, DATE '9999-12-31'),
                COALESCE(candidate_metrics.total_reviews, 0) DESC,
                candidate.appid
              LIMIT ${boundedLimit}
            ) AS candidate_appids
          FROM evaluated
        `,
        compiled.values,
      );
      const aggregateRow = aggregateResult.rows[0]!;
      const candidateAppids = integerArrayValue(aggregateRow.candidate_appids);
      const inputResult =
        candidateAppids.length === 0
          ? { rows: [] as RuleInputRow[] }
          : await client.query<RuleInputRow>(RULE_INPUT_BATCH_SELECT, [
              candidateAppids,
            ]);
      const inputByAppid = new Map(
        inputResult.rows.map((row) => [
          row.appid,
          buildOpportunityRuleInput(row),
        ]),
      );
      return {
        aggregate: {
          coverage: recordValue(aggregateRow.coverage_counts),
          stageCounts: recordValue(aggregateRow.stage_counts),
          totalCatalog: Number(aggregateRow.total_catalog),
          totalMatches: Number(aggregateRow.total_matches),
        },
        inputs: candidateAppids.flatMap((appid) => {
          const input = inputByAppid.get(appid);
          return input ? [input] : [];
        }),
      };
    } finally {
      client.release();
    }
  }

  async getPreviewInputs(
    rules: OpportunityRuleSet,
    limit = 60,
    evaluation?: OpportunityEvaluationContext,
  ): Promise<OpportunityEvaluationInput[]> {
    const compiled = compileOpportunityPreview(rules, evaluation);
    const result = await this.pool.query<RuleInputRow>(
      `
        ${RULE_INPUT_SELECT}
        WHERE a.type IN ('game', 'Game')
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
          AND a.type IN ('game', 'Game')
          AND COALESCE(a.is_delisted, false) = false
        ORDER BY a.appid
      `;
    const result = client
      ? await client.query<RuleInputRow>(sql, [bounded])
      : await this.pool.query<RuleInputRow>(sql, [bounded]);
    return result.rows.map(buildOpportunityRuleInput);
  }

  async getRuleInputs(
    appids: number[],
    options: { onBatch?: () => Promise<void> } = {},
  ): Promise<OpportunityEvaluationInput[]> {
    const bounded = Array.from(
      new Set(appids.filter((appid) => Number.isInteger(appid) && appid > 0)),
    )
      .sort((left, right) => left - right)
      .slice(0, 5_000);
    if (bounded.length === 0) {
      return [];
    }
    const inputs: OpportunityEvaluationInput[] = [];
    for (
      let offset = 0;
      offset < bounded.length;
      offset += RULE_INPUT_QUERY_BATCH_SIZE
    ) {
      const batch = bounded.slice(offset, offset + RULE_INPUT_QUERY_BATCH_SIZE);
      const result = await this.pool.query<RuleInputRow>(
        RULE_INPUT_BATCH_SELECT,
        [batch],
      );
      const batchInputs = result.rows.map(buildOpportunityRuleInput);
      inputs.push(...batchInputs);
      await this.persistRuleInputProjection(batchInputs);
      await options.onBatch?.();
    }
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
        WHERE a.type IN ('game', 'Game')
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
            AND ${opportunityPersistedResultContentSafetySql("result")}
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

  async getRelativeDateTransitionAppids(
    profiles: Array<{
      rules: OpportunityRuleSet;
      timezone: string;
    }>,
    asOf: string,
    options: {
      limit?: number;
      onBatch?: () => Promise<void>;
      previousAsOf?: string;
    } = {},
  ): Promise<number[]> {
    const boundedLimit = Math.max(
      1,
      Math.min(10_000, Math.floor(options.limit ?? 10_000)),
    );
    const changed = new Set<number>();

    for (const profile of profiles) {
      if (changed.size >= boundedLimit) {
        break;
      }
      const currentContext: OpportunityEvaluationContext = {
        asOf,
        timezone: profile.timezone,
      };
      const previousContext = options.previousAsOf
        ? {
            asOf: options.previousAsOf,
            timezone: profile.timezone,
          }
        : previousLocalDayEvaluationContext(currentContext);
      const boundaries = opportunityRelativeDateBoundaries(
        profile.rules,
        currentContext,
        previousContext,
      );
      if (boundaries.length === 0) {
        continue;
      }
      const seenCandidateAppids = new Set<number>();
      for (const boundary of boundaries) {
        let startValue = boundary.startDate;
        let endValue = boundary.endDateExclusive;
        if (boundary.field === "publisheriq_added_at") {
          startValue = localDateStartUtc(startValue, profile.timezone);
          endValue = localDateStartUtc(endValue, profile.timezone);
        }
        let cursorValue = endValue;
        let cursorAppid = 2_147_483_647;
        while (changed.size < boundedLimit) {
          const result = await this.pool.query<
            QueryResultRow & {
              appid: number;
              boundary_value: Date | string;
            }
          >(
            boundary.field === "release_date"
              ? `
                  SELECT
                    app.appid,
                    app.release_date AS boundary_value
                  FROM legacy.apps app
                  WHERE app.release_date >= $1::date
                    AND app.release_date < $2::date
                    AND (app.release_date, app.appid) < ($3::date, $4)
                    AND app.type IN ('game', 'Game')
                    AND COALESCE(app.is_delisted, false) = false
                  ORDER BY app.release_date DESC, app.appid DESC
                  LIMIT $5
                `
              : `
                  SELECT
                    catalog.appid,
                    catalog.first_observed_at AS boundary_value
                  FROM ops.app_catalog_state catalog
                  JOIN legacy.apps app ON app.appid = catalog.appid
                  WHERE catalog.first_observed_at >= $1::timestamptz
                    AND catalog.first_observed_at < $2::timestamptz
                    AND (catalog.first_observed_at, catalog.appid) <
                      ($3::timestamptz, $4)
                    AND catalog.first_observation_kind = 'new'
                    AND app.type IN ('game', 'Game')
                    AND COALESCE(app.is_delisted, false) = false
                  ORDER BY catalog.first_observed_at DESC, catalog.appid DESC
                  LIMIT $5
                `,
            [
              startValue,
              endValue,
              cursorValue,
              cursorAppid,
              DATE_TRANSITION_CANDIDATE_BATCH_SIZE,
            ],
          );
          await options.onBatch?.();
          if (result.rows.length === 0) {
            break;
          }
          const candidateAppids = result.rows
            .map((row) => row.appid)
            .filter((appid) => {
              if (seenCandidateAppids.has(appid)) {
                return false;
              }
              seenCandidateAppids.add(appid);
              return true;
            });
          if (candidateAppids.length > 0) {
            for (
              let offset = 0;
              offset < candidateAppids.length;
              offset += RULE_INPUT_QUERY_BATCH_SIZE
            ) {
              const inputs = await this.getRuleInputsShadow(
                candidateAppids.slice(
                  offset,
                  offset + RULE_INPUT_QUERY_BATCH_SIZE,
                ),
              );
              for (const input of inputs) {
                const currentEligible =
                  evaluateOpportunityProfile(
                    profile.rules,
                    input,
                    currentContext,
                  ).outcome === "eligible";
                const previousEligible =
                  evaluateOpportunityProfile(
                    profile.rules,
                    input,
                    previousContext,
                  ).outcome === "eligible";
                if (currentEligible !== previousEligible) {
                  changed.add(input.appid);
                  if (changed.size >= boundedLimit) {
                    break;
                  }
                }
              }
              await options.onBatch?.();
              if (changed.size >= boundedLimit) {
                break;
              }
            }
          }
          const cursorRow = result.rows.at(-1)!;
          cursorValue =
            boundary.field === "release_date"
              ? cursorRow.boundary_value instanceof Date
                ? cursorRow.boundary_value.toISOString().slice(0, 10)
                : String(cursorRow.boundary_value)
              : iso(cursorRow.boundary_value)!;
          cursorAppid = cursorRow.appid;
          if (result.rows.length < DATE_TRANSITION_CANDIDATE_BATCH_SIZE) {
            break;
          }
        }
      }
    }

    return Array.from(changed).sort((left, right) => left - right);
  }

  async getGameRecord(params: {
    appid: number;
    identity: OpportunityIdentity;
    resultId: string;
  }): Promise<OpportunityGameRecord> {
    const workspace = await this.ensureWorkspace(params.identity);
    const recordAccess = await this.resolveResultAccess(params);
    const teamId = recordAccess.access.team?.id ?? null;
    const result = await this.pool.query<
      QueryResultRow & {
        app: OpportunityGameRecord["app"];
        cohort: OpportunityGameRecord["cohort"];
        current_metrics: OpportunityGameRecord["currentMetrics"];
        evidence: OpportunityGameRecord["evidence"];
        market_context: OpportunityGameRecord["marketContext"];
        media: OpportunityGameRecord["media"];
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
            'headerImageUrl', selected_media.hero_assets->>'header',
            'gameDescription', canonical.evidence_summary->'gameDescription',
            'rank', canonical.rank,
            'score', canonical.score,
            'rankComponents', canonical.rank_components,
            'reviewPriority', canonical.evidence_summary->'reviewPriorityV2',
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
            'triggeredByMediaAddition', COALESCE(trigger_media.media_addition, false),
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
          jsonb_build_object(
            'capturedAt', selected_media.first_seen_at,
            'headerImageUrl', selected_media.hero_assets->>'header',
            'screenshots', COALESCE(selected_media.screenshots, '[]'::jsonb),
            'trailers', COALESCE(selected_media.trailers, '[]'::jsonb)
          ) AS media,
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
              'ruleOutcomes', match.rule_outcomes - 'reviewPriorityV2',
              'reviewPriority', match.rule_outcomes->'reviewPriorityV2'
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
              AND ${opportunityPersistedResultContentSafetySql("prior", "app")}
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
              'userDisplay', COALESCE(
                team_membership.display_name,
                team_membership.identity_email,
                workspace_membership.identity_email,
                'Team member'
              )
            ) ORDER BY activity.occurred_at DESC)
            FROM (
              SELECT recent.*
              FROM opportunity.team_activity recent
              WHERE (
                  ($7::uuid IS NOT NULL AND recent.team_id = $7)
                  OR (
                    $7::uuid IS NULL
                    AND recent.team_id IS NULL
                    AND recent.workspace_id = canonical.workspace_id
                  )
                )
                AND recent.appid = canonical.appid
              ORDER BY recent.occurred_at DESC
              LIMIT 100
            ) activity
            LEFT JOIN opportunity.team_memberships team_membership
              ON team_membership.team_id = activity.team_id
              AND team_membership.user_id = activity.user_id
            LEFT JOIN opportunity.workspace_memberships workspace_membership
              ON workspace_membership.workspace_id = activity.workspace_id
              AND workspace_membership.user_id = activity.user_id
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
        LEFT JOIN LATERAL (
          SELECT
            (
              array_agg(
                raw.media_version_id
                ORDER BY raw.occurred_at DESC, raw.id DESC
              ) FILTER (WHERE raw.media_version_id IS NOT NULL)
            )[1] AS media_version_id,
            COALESCE(
              bool_or(
                raw.change_type IN ('screenshot_added', 'trailer_added')
              ),
              false
            ) AS media_addition
          FROM events.app_change_events raw
          WHERE triggering_event.id IS NOT NULL
            AND raw.appid = canonical.appid
            AND raw.occurred_at >= triggering_event.grouped_window_start
            AND raw.occurred_at <= triggering_event.grouped_window_end
            AND ('raw:' || raw.id::text) IN (
              SELECT jsonb_array_elements_text(
                COALESCE(triggering_event.raw_event_refs, '[]'::jsonb)
              )
            )
        ) trigger_media ON true
        LEFT JOIN LATERAL (
          SELECT
            media.first_seen_at,
            media.hero_assets,
            media.screenshots,
            media.trailers
          FROM docs.app_media_versions media
          WHERE media.appid = canonical.appid
          ORDER BY
            CASE
              WHEN media.id = trigger_media.media_version_id THEN 0
              WHEN media.first_seen_at <= canonical.created_at THEN 1
              ELSE 2
            END,
            CASE
              WHEN media.id = trigger_media.media_version_id
                THEN media.first_seen_at
              ELSE NULL
            END DESC,
            CASE
              WHEN media.first_seen_at <= canonical.created_at
                THEN media.first_seen_at
              ELSE NULL
            END DESC,
            media.first_seen_at DESC,
            media.id DESC
          LIMIT 1
        ) selected_media ON true
        LEFT JOIN opportunity.cohort_snapshots cohort
          ON cohort.id = canonical.cohort_snapshot_id
        LEFT JOIN opportunity.market_context_snapshots market
          ON market.id = canonical.market_context_snapshot_id
        LEFT JOIN opportunity.user_game_state game_state
          ON game_state.workspace_id = $5
          AND game_state.user_id = $6
          AND game_state.appid = canonical.appid
        LEFT JOIN opportunity.team_research_state research_state
          ON research_state.user_id = $6
          AND research_state.appid = canonical.appid
          AND (
            ($7::uuid IS NOT NULL AND research_state.team_id = $7)
            OR (
              $7::uuid IS NULL
              AND research_state.team_id IS NULL
              AND research_state.workspace_id = $5
            )
          )
        WHERE canonical.id = $1
          AND canonical.appid = $2
          AND canonical.workspace_id = $3
          AND canonical.user_id = $4
          AND ${opportunityPersistedResultContentSafetySql("canonical", "app")}
        LIMIT 1
      `,
      [
        params.resultId,
        params.appid,
        recordAccess.ownerWorkspaceId,
        recordAccess.ownerUserId,
        workspace.id,
        params.identity.userId,
        teamId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new OpportunityNotFoundError("Opportunity result not found.");
    }
    const presentedChanges = await presentOpportunityChanges(
      this.pool,
      [
        row.result_summary.change,
        ...row.recent_changes.map((change) => change),
      ],
      [
        row.result_summary.eventLabel,
        ...row.recent_changes.map(() => "materially_changed" as const),
      ],
    );
    const primaryChange = presentedChanges[0] ?? null;
    const changeSummary = opportunityChangeSummary(
      primaryChange,
      row.result_summary.eventLabel,
    );
    const resultSummary: OpportunityResultSummary = {
      ...decodeOpportunityValue(row.result_summary),
      change: primaryChange,
      changeSummary,
      gameDescription: parseOpportunityGameDescription(
        row.result_summary.gameDescription,
      ),
      matchedProfiles: row.result_summary.matchedProfiles.map((profile) => ({
        ...profile,
        name: cleanOpportunityProfileName(profile.name),
      })),
      name: decodeOpportunityText(row.result_summary.name),
      reviewPriority: parseOpportunityReviewPrioritySummary(
        row.result_summary.reviewPriority,
      ),
      strongestEvidence: cleanOpportunityEvidence(
        row.result_summary.strongestEvidence,
        changeSummary,
      ),
      whyNow:
        cleanOpportunityUserText(row.result_summary.whyNow) ?? changeSummary,
    };
    const recentChanges = row.recent_changes.map((change, index) => ({
      ...decodeOpportunityValue(change),
      ...(presentedChanges[index + 1] ?? {
        summary: opportunityChangeSummary(null, "materially_changed"),
      }),
    }));
    const currentInput = (await this.getRuleInputsShadow([params.appid]))[0];
    const previouslyMissingNowAvailable = (row.missing_evidence ?? []).flatMap(
      (fieldName) => {
        if (
          !OPPORTUNITY_RULE_FIELDS.includes(fieldName as OpportunityRuleField)
        ) {
          return [];
        }
        const field = fieldName as OpportunityRuleField;
        const evidence = currentInput?.fields[field];
        return evidence?.state === "known"
          ? [
              {
                field,
                source: evidence.source,
                sourceAt: evidence.sourceAt,
                value: evidence.value,
              },
            ]
          : [];
      },
    );
    const evaluatedAt =
      row.provenance?.run?.windowEnd ??
      row.provenance?.sourceTimestamps?.profileEvaluationAt ??
      row.result_summary.createdAt;
    const decodedMedia = decodeOpportunityValue(
      row.media ?? {
        capturedAt: null,
        headerImageUrl: null,
        screenshots: [],
        trailers: [],
      },
    );
    await this.recordTeamActivity({
      activityType: "viewed",
      appid: params.appid,
      identity: params.identity,
      note: null,
      resolvedTeamId: teamId,
      resultId: params.resultId,
    });
    const matchedProfiles = decodeOpportunityValue(row.matched_profiles)
      .map((profile) => ({
        ...profile,
        name: cleanOpportunityProfileName(profile.name),
        reviewPriority: parseOpportunityReviewPriorityDecision(
          profile.reviewPriority,
        ),
      }))
      .sort((left, right) => {
        const winner = resultSummary.reviewPriority?.winningProfileId;
        if (left.id === winner) return -1;
        if (right.id === winner) return 1;
        return left.name.localeCompare(right.name);
      });
    const shared = recordAccess.access.scope === "team";
    const visibleResultSummary = shared
      ? redactOpportunityResult(resultSummary)
      : resultSummary;
    const provenance = shared
      ? {
          ...row.provenance,
          deliveries: [],
          run: {
            ...row.provenance.run,
            activeProfileVersions: [],
          },
        }
      : row.provenance;
    const rank = decodeOpportunityValue(row.rank);
    return {
      access: recordAccess.access,
      app: decodeOpportunityValue(row.app),
      cohort: decodeOpportunityValue(row.cohort),
      currentMetrics: decodeOpportunityValue(row.current_metrics ?? {}),
      evidence: decodeOpportunityValue(row.evidence ?? []),
      evidenceResolution: {
        currentResolvedAt: new Date().toISOString(),
        evaluatedAt,
        previouslyMissingNowAvailable: shared
          ? []
          : previouslyMissingNowAvailable,
      },
      marketContext: decodeOpportunityValue(row.market_context),
      media: {
        capturedAt: decodedMedia.capturedAt ?? null,
        headerImageUrl: decodedMedia.headerImageUrl ?? null,
        screenshots: decodedMedia.screenshots ?? [],
        trailers: (decodedMedia.trailers ?? []).map((trailer) => ({
          ...trailer,
          hlsUrl: trailer.hlsUrl ?? null,
          mp4Url: trailer.mp4Url ?? null,
          thumbnailUrl: trailer.thumbnailUrl ?? null,
          webmUrl: trailer.webmUrl ?? null,
        })),
      },
      matchedProfiles: shared ? [] : matchedProfiles,
      missingEvidence: shared ? [] : (row.missing_evidence ?? []),
      officialNews: decodeOpportunityValue(row.official_news),
      previousAppearances: shared
        ? []
        : decodeOpportunityValue(row.previous_appearances).map(
            (appearance) => ({
              ...appearance,
              whyNow: opportunityChangeSummary(null, appearance.eventLabel),
            }),
          ),
      provenance,
      recentChanges,
      rank: shared ? { ...rank, reasons: [] } : rank,
      result: visibleResultSummary,
      teamActivity: decodeOpportunityValue(row.team_activity),
      userState: row.user_state ?? {
        dismissedAt: null,
        ignoredAt: null,
        researching: false,
        trackedAt: null,
      },
      youtubeEvidence: decodeOpportunityValue(row.youtube_evidence),
      workspace: {
        id: workspace.id,
        name: decodeOpportunityText(workspace.name),
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
    resolvedTeamId?: string | null;
    resultId?: string;
  }): Promise<void> {
    const workspace = await this.ensureWorkspace(params.identity);
    const teamId =
      params.resolvedTeamId !== undefined
        ? params.resolvedTeamId
        : params.resultId
          ? ((
              await this.resolveResultAccess({
                appid: params.appid,
                identity: params.identity,
                resultId: params.resultId,
              })
            ).access.team?.id ?? null)
          : ((await this.getActiveTeamForUser(params.identity.userId))?.id ??
            null);
    await this.transaction(async (client) => {
      await client.query(
        `
          INSERT INTO opportunity.team_activity (
            workspace_id,
            team_id,
            user_id,
            appid,
            activity_type,
            note
          )
          SELECT $1, $6, $2, $3, $4, $5
          WHERE $4 <> 'viewed'
            OR NOT EXISTS (
              SELECT 1
              FROM opportunity.team_activity recent
              WHERE (
                  ($6::uuid IS NOT NULL AND recent.team_id = $6)
                  OR (
                    $6::uuid IS NULL
                    AND recent.team_id IS NULL
                    AND recent.workspace_id = $1
                  )
                )
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
          teamId,
        ],
      );
      if (params.activityType !== "viewed") {
        await client.query(
          `
            INSERT INTO opportunity.team_research_state (
              workspace_id,
              team_id,
              user_id,
              appid,
              is_researching,
              note,
              started_at,
              cleared_at
            )
            VALUES (
              $1,
              $6,
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
              team_id = EXCLUDED.team_id,
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
            teamId,
          ],
        );
      }
    });
  }

  private mapResult(row: ResultRow): OpportunityResultSummary {
    const changeSummary = opportunityChangeSummary(row.change, row.event_label);
    const reviewPriority = parseOpportunityReviewPrioritySummary(
      row.review_priority,
    );
    const matchedProfiles = (row.matched_profiles ?? [])
      .map((profile) => ({
        ...profile,
        name: cleanOpportunityProfileName(profile.name),
      }))
      .sort((left, right) => {
        if (left.id === reviewPriority?.winningProfileId) return -1;
        if (right.id === reviewPriority?.winningProfileId) return 1;
        return left.name.localeCompare(right.name);
      });
    return {
      appid: row.appid,
      change: row.change ?? null,
      changeSummary,
      confidence: row.confidence,
      createdAt: iso(row.created_at)!,
      eventLabel: row.event_label,
      eventFingerprint: row.event_fingerprint,
      headerImageUrl: row.header_image_url ?? null,
      gameDescription: parseOpportunityGameDescription(row.game_description),
      id: row.id,
      marketPotential: row.market_potential,
      matchedProfiles,
      name: decodeOpportunityText(row.name),
      rank: row.rank,
      rankComponents: row.rank_components,
      reviewPriority,
      score: numberValue(row.score),
      screenshotThumbnailUrl: row.screenshot_thumbnail_url ?? null,
      strongestEvidence: cleanOpportunityEvidence(
        row.strongest_evidence ?? [],
        changeSummary,
      ),
      triggeredByMediaAddition: row.triggered_by_media_addition ?? false,
      whyNow: cleanOpportunityUserText(row.why_now) ?? changeSummary,
    };
  }
}

export function compilePreviewForRepository(
  rules: OpportunityRuleSet,
  evaluation?: OpportunityEvaluationContext,
): OpportunityCompiledPreview {
  return compileOpportunityPreview(rules, evaluation);
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
