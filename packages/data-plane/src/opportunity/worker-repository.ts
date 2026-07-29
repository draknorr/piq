import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  groupOpportunitySourceEvents,
  type OpportunityMaterialMoment,
  type OpportunitySourceEvent,
} from "./material-events.js";
import type {
  OpportunityCohortMember,
  OpportunityEvaluationInput,
  OpportunityConfidence,
  OpportunityMarketContext,
  OpportunityMaterialEventType,
  OpportunityProfileEvaluation,
  OpportunityRankingEvidence,
  OpportunityResultLabel,
  OpportunityRuleSet,
  OpportunityRuleField,
  OpportunitySignalFamily,
  OpportunityPresetHealthSnapshot,
  OpportunityPresetHealthState,
  OpportunityWorkerPhaseTimings,
} from "./types.js";
import {
  OPPORTUNITY_BULK_PERSISTENCE_VERSION,
  OPPORTUNITY_COHORT_CACHE_VERSION,
  OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
  OPPORTUNITY_COHORT_RESOLVER_VERSION,
  OPPORTUNITY_COHORT_VERSION,
  OPPORTUNITY_MARKET_VERSION,
  OPPORTUNITY_MATERIALITY_VERSION,
  OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
} from "./types.js";
import {
  OpportunityRepository,
  presentOpportunityChanges,
} from "./repository.js";

const COHORT_FEATURE_PAGE_SIZE = 25_000;
const COHORT_FEATURE_MAX_ROWS = 250_000;
const COHORT_CACHE_WRITE_BATCH_SIZE = 250;
const RESULT_PERSISTENCE_BATCH_SIZE = 100;
const CANDIDATE_PERSISTENCE_BATCH_SIZE = 500;

export interface OpportunityWorkItem {
  appid: number | null;
  attempts: number;
  id: number;
  kind:
    | "materialize_events"
    | "daily_evaluation"
    | "readiness_recheck"
    | "immediate_evaluation"
    | "refresh_cohort"
    | "refresh_preset_health"
    | "deliver";
  lane: string;
  materialEventId: string | null;
  payload: Record<string, unknown>;
  profileId: string | null;
  userId: string | null;
  workspaceId: string | null;
}

export interface OpportunityWorkerProfile {
  eventSubscriptions: OpportunitySignalFamily[];
  id: string;
  immediateFullMatchEnabled: boolean;
  name: string;
  rules: OpportunityRuleSet;
  versionId: string;
  versionNumber: number;
}

export interface OpportunityWorkerMaterialEvent {
  affectedRuleFields?: OpportunityRuleField[];
  after?: unknown;
  appid: number;
  before?: unknown;
  confidence?: OpportunityConfidence;
  createsDailyResult: boolean;
  effectiveAt: string;
  eligibleForImmediate: boolean;
  eventFingerprint: string;
  eventType: OpportunityMaterialEventType;
  id: string;
  materiality: number;
  observedAt: string;
  reevaluateEligibility: boolean;
  signalFamily: OpportunitySignalFamily;
  summary?: string;
}

export interface OpportunityPriorUserState {
  dismissedEventFingerprint: string | null;
  ignored: boolean;
  priorEventFingerprints: Set<string>;
  priorResultId: string | null;
  tracked: boolean;
}

export interface OpportunityRunContext {
  id: string;
  kind: "daily" | "immediate" | "manual" | "replay" | "readiness";
  windowEnd: string;
  windowStart: string;
}

export interface OpportunityEvaluatedMatch {
  evaluation: OpportunityProfileEvaluation;
  profile: OpportunityWorkerProfile;
}

export interface OpportunityReleasedCohort {
  confidence: "high" | "directional";
  coverage: number;
  fallbackTier: 1 | 2 | 3 | 4 | 5;
  members: OpportunityCohortMember[];
  signature: Record<string, unknown>;
  sourceAt: string | null;
}

export interface OpportunityEvaluatedResult {
  appid: number;
  cohort: OpportunityReleasedCohort;
  confidence: "high" | "directional";
  event: OpportunityWorkerMaterialEvent;
  eventLabel: OpportunityResultLabel;
  evidenceItems: Array<Record<string, unknown>>;
  matches: OpportunityEvaluatedMatch[];
  market: OpportunityMarketContext;
  missingEvidence: string[];
  profileVersionSetFingerprint: string;
  rank: OpportunityRankingEvidence;
  reappearedAfterResultId: string | null;
  sourceTimestamps: Record<string, string | null>;
  strongestEvidence: string[];
  whyNow: string;
}

export interface OpportunityPendingEvaluation {
  appid: number;
  evaluation: OpportunityProfileEvaluation;
  eventId: string | null;
  profile: OpportunityWorkerProfile;
}

export interface OpportunityCandidateEvaluation {
  appid: number;
  evaluation: OpportunityProfileEvaluation;
  eventId: string | null;
  profile: OpportunityWorkerProfile;
}

export interface OpportunityPresetHealthTarget {
  id: string;
  rules: OpportunityRuleSet;
  slug: string;
}

export interface OpportunityPriorPresetHealth {
  consecutiveDays: number;
  state: OpportunityPresetHealthState | null;
}

interface OpportunityReleasedCohortRow extends QueryResultRow {
  signature_key?: string;
  appid: number;
  ccu_peak: number | null;
  inclusion_score: string | number;
  metric_date: Date | string | null;
  name: string;
  positive_percentage: string | number | null;
  price_cents: number | null;
  review_change_30d: string | number | null;
  tag_overlap: number;
  total_reviews: number | null;
}

interface OpportunityCohortFeatureRow extends QueryResultRow {
  appid: number;
  ccu_peak: number | null;
  effective_price_cents: number | null;
  genre_ids: number[];
  is_free: boolean;
  metric_date: Date | string | null;
  name: string;
  positive_percentage: string | number | null;
  review_change_30d: string | number | null;
  tag_ids: number[];
  total_reviews: number | null;
}

interface OpportunityCohortTaxonomyRow extends QueryResultRow {
  name: string;
  taxonomy_id: number;
  taxonomy_kind: "genre" | "tag";
}

interface OpportunityCohortSourceWatermarkRow extends QueryResultRow {
  source_date: Date | string;
  source_watermark: Record<string, unknown> | string;
}

interface OpportunityCohortSourceWatermark {
  cacheable: boolean;
  featureSourceRevisions: Record<string, number> | null;
  hash: string;
  sourceDate: string;
  value: Record<string, unknown>;
}

interface OpportunityCohortCacheRow extends QueryResultRow {
  cache_key: string;
  cohort: OpportunityReleasedCohort | string;
}

interface OpportunityExportedSnapshotRow extends QueryResultRow {
  snapshot_id: string;
}

export type OpportunityReleasedCohortCache = Map<
  string,
  Promise<OpportunityReleasedCohortRow[]>
>;

interface WorkRow extends QueryResultRow {
  appid: number | null;
  attempts: number;
  id: string | number;
  kind: OpportunityWorkItem["kind"];
  lane: string;
  material_event_id: string | null;
  payload: Record<string, unknown>;
  profile_id: string | null;
  user_id: string | null;
  workspace_id: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function isCanonicalIsoOrNull(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isReleasedCohort(value: unknown): value is OpportunityReleasedCohort {
  const cohort = asRecord(value);
  if (!cohort) {
    return false;
  }
  const signature = asRecord(cohort.signature);
  const genres = signature?.genres;
  const tags = signature?.tags;
  const priceBand = signature?.priceBand;
  if (
    (cohort.confidence !== "high" && cohort.confidence !== "directional") ||
    typeof cohort.coverage !== "number" ||
    !Number.isFinite(cohort.coverage) ||
    cohort.coverage < 0 ||
    cohort.coverage > 1 ||
    ![1, 2, 3, 4, 5].includes(Number(cohort.fallbackTier)) ||
    !Array.isArray(cohort.members) ||
    cohort.members.length > 50 ||
    !signature ||
    (signature.businessModel !== "free" &&
      signature.businessModel !== "premium") ||
    !Array.isArray(genres) ||
    !genres.every((item) => typeof item === "string") ||
    !Array.isArray(tags) ||
    !tags.every((item) => typeof item === "string") ||
    !(
      priceBand === null ||
      (Array.isArray(priceBand) &&
        priceBand.length === 2 &&
        priceBand.every(
          (item) => typeof item === "number" && Number.isFinite(item),
        ))
    ) ||
    !isCanonicalIsoOrNull(cohort.sourceAt)
  ) {
    return false;
  }
  const appids = new Set<number>();
  const membersValid = cohort.members.every((member) => {
    const row = asRecord(member);
    if (
      !row ||
      !Number.isInteger(row.appid) ||
      Number(row.appid) <= 0 ||
      appids.has(Number(row.appid)) ||
      typeof row.name !== "string" ||
      typeof row.inclusionScore !== "number" ||
      !Number.isFinite(row.inclusionScore) ||
      !Array.isArray(row.inclusionReasons) ||
      !row.inclusionReasons.every((reason) => typeof reason === "string") ||
      !isFiniteNumberOrNull(row.ccuPeak) ||
      !isFiniteNumberOrNull(row.positivePercentage) ||
      !isFiniteNumberOrNull(row.priceCents) ||
      !isFiniteNumberOrNull(row.reviewsAdded30d) ||
      !isFiniteNumberOrNull(row.totalReviews)
    ) {
      return false;
    }
    appids.add(Number(row.appid));
    return true;
  });
  if (!membersValid) {
    return false;
  }
  const members = cohort.members as OpportunityCohortMember[];
  const measured = members.filter(
    (member) => member.totalReviews !== null || member.ccuPeak !== null,
  ).length;
  const expectedCoverage = members.length === 0 ? 0 : measured / members.length;
  const expectedConfidence =
    members.length >= 10 && expectedCoverage >= 0.6 ? "high" : "directional";
  const expectedFallbackTier =
    members.length >= 20 && tags.length >= 2
      ? 1
      : members.length >= 10
        ? 2
        : genres.length > 0
          ? 3
          : tags.length > 0
            ? 4
            : 5;
  return (
    cohort.coverage === expectedCoverage &&
    cohort.confidence === expectedConfidence &&
    cohort.fallbackTier === expectedFallbackTier
  );
}

interface NormalizedCohortInput {
  appid: number;
  genres: string[];
  input: OpportunityEvaluationInput;
  inputFingerprint: string;
  isFree: boolean;
  normalizedGenres: string[];
  normalizedTags: string[];
  price: number;
  priceValid: boolean;
  signatureKey: string;
  tags: string[];
}

function normalizeCohortInput(
  input: OpportunityEvaluationInput,
): NormalizedCohortInput {
  const tagValue = input.fields.tags?.value;
  const genreValue = input.fields.genres?.value;
  const tags = (Array.isArray(tagValue) ? tagValue : [])
    .filter((value): value is string => typeof value === "string")
    .slice(0, 10);
  const genres = (Array.isArray(genreValue) ? genreValue : [])
    .filter((value): value is string => typeof value === "string")
    .slice(0, 6);
  const rawPrice = Number(input.fields.price_cents?.value ?? 0);
  const priceValid = Number.isFinite(rawPrice);
  const price = priceValid ? rawPrice : 0;
  const isFree = input.fields.is_free?.value === true;
  const normalizedTags = tags.map((tag) => tag.toLocaleLowerCase()).sort();
  const normalizedGenres = genres
    .map((genre) => genre.toLocaleLowerCase())
    .sort();
  const inputFingerprint = stableHash({
    appid: input.appid,
    genres: input.fields.genres ?? null,
    isFree: input.fields.is_free ?? null,
    price: input.fields.price_cents ?? null,
    tags: input.fields.tags ?? null,
  });
  return {
    appid: input.appid,
    genres,
    input,
    inputFingerprint,
    isFree,
    normalizedGenres,
    normalizedTags,
    price,
    priceValid,
    signatureKey: stableHash({
      genres: normalizedGenres,
      isFree,
      price,
      tags: normalizedTags,
    }),
    tags,
  };
}

function releasedCohortFromRows(
  subject: NormalizedCohortInput,
  candidateRows: OpportunityReleasedCohortRow[],
): OpportunityReleasedCohort {
  const rows = candidateRows
    .filter((row) => row.appid !== subject.appid)
    .slice(0, 50);
  const members: OpportunityCohortMember[] = rows.map((row) => ({
    appid: row.appid,
    ccuPeak: row.ccu_peak,
    inclusionReasons: [
      row.tag_overlap > 0
        ? `${row.tag_overlap} shared primary tags`
        : "shared genre",
      row.price_cents === null
        ? "price unavailable"
        : "compatible business model",
    ],
    inclusionScore: Number(row.inclusion_score),
    name: row.name,
    positivePercentage:
      row.positive_percentage === null ? null : Number(row.positive_percentage),
    priceCents: row.price_cents,
    reviewsAdded30d:
      row.review_change_30d === null ? null : Number(row.review_change_30d),
    totalReviews: row.total_reviews,
  }));
  const measured = members.filter(
    (member) => member.totalReviews !== null || member.ccuPeak !== null,
  ).length;
  const coverage = members.length === 0 ? 0 : measured / members.length;
  const latestMetricDate =
    rows
      .map((row) => row.metric_date)
      .filter((value): value is Date | string => value !== null)
      .map(iso)
      .sort()
      .at(-1) ?? null;
  const fallbackTier: 1 | 2 | 3 | 4 | 5 =
    members.length >= 20 && subject.tags.length >= 2
      ? 1
      : members.length >= 10
        ? 2
        : subject.genres.length > 0
          ? 3
          : subject.tags.length > 0
            ? 4
            : 5;
  return {
    confidence:
      members.length >= 10 && coverage >= 0.6 ? "high" : "directional",
    coverage,
    fallbackTier,
    members,
    signature: {
      businessModel: subject.isFree ? "free" : "premium",
      genres: subject.genres,
      priceBand: subject.priceValid
        ? [Math.max(0, subject.price - 1000), subject.price + 1000]
        : null,
      tags: subject.tags,
    },
    sourceAt: latestMetricDate,
  };
}

function asSignalFamily(value: string): OpportunitySignalFamily {
  const supported = new Set<OpportunitySignalFamily>([
    "release",
    "taxonomy",
    "pricing",
    "platform",
    "store-page",
    "media",
    "build",
    "announcement",
    "reviews",
    "ccu",
    "unknown",
  ]);
  return supported.has(value as OpportunitySignalFamily)
    ? (value as OpportunitySignalFamily)
    : "unknown";
}

function isStatementTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "57014" &&
    /statement timeout/i.test(error.message)
  );
}

export function assignOpportunityDeliveryResults(
  results: Array<{ id: string; profileIds: string[] }>,
  preferences: Array<{
    channel: "email" | "slack";
    id: string;
    maxResults: number;
    profileId: string | null;
  }>,
): Map<string, { availableResultCount: number; resultIds: string[] }> {
  const assignments = new Map<
    string,
    { availableResultCount: number; resultIds: string[] }
  >();
  const assignedByChannel = new Map<"email" | "slack", Set<string>>();
  for (const preference of preferences) {
    const assigned =
      assignedByChannel.get(preference.channel) ?? new Set<string>();
    assignedByChannel.set(preference.channel, assigned);
    const available = results.filter(
      (result) =>
        !assigned.has(result.id) &&
        (preference.profileId === null ||
          result.profileIds.includes(preference.profileId)),
    );
    const selected = available
      .slice(0, preference.maxResults)
      .map((result) => result.id);
    available.forEach((result) => assigned.add(result.id));
    assignments.set(preference.id, {
      availableResultCount: available.length,
      resultIds: selected,
    });
  }
  return assignments;
}

export class OpportunityWorkerRepository {
  readonly productRepository: OpportunityRepository;

  constructor(private readonly pool: Pool) {
    this.productRepository = new OpportunityRepository(pool);
  }

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

  async scheduleWork(): Promise<number> {
    const result = await this.transaction(async (client) => {
      const materialize = await client.query(
        `
          INSERT INTO opportunity.work_queue (
            kind,
            lane,
            priority,
            idempotency_key,
            scheduled_for,
            payload
          )
          VALUES (
            'materialize_events',
            'material_change',
            500,
            'materialize:' || to_char(date_trunc('minute', now()) - (
              (EXTRACT(minute FROM now())::integer % 5) * interval '1 minute'
            ), 'YYYYMMDDHH24MI'),
            now(),
            '{}'::jsonb
          )
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,
      );
      const daily = await client.query(
        `
          INSERT INTO opportunity.work_queue (
            kind,
            lane,
            workspace_id,
            user_id,
            scheduled_for,
            priority,
            idempotency_key,
            payload
          )
          SELECT
            'daily_evaluation',
            'daily',
            due.workspace_id,
            due.owner_user_id,
            due.next_evaluation_at,
            100,
            'daily:' || due.workspace_id || ':' || due.owner_user_id || ':' ||
              to_char(due.next_evaluation_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI'),
            jsonb_build_object('reason', 'schedule_due')
          FROM (
            SELECT
              profile.workspace_id,
              profile.owner_user_id,
              MIN(profile.next_evaluation_at) AS next_evaluation_at
            FROM opportunity.profiles profile
            WHERE profile.status = 'enabled'
              AND profile.next_evaluation_at <= now()
            GROUP BY profile.workspace_id, profile.owner_user_id
            LIMIT 1000
          ) due
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,
      );
      const readiness = await client.query(
        `
          INSERT INTO opportunity.work_queue (
            kind,
            lane,
            workspace_id,
            user_id,
            appid,
            material_event_id,
            scheduled_for,
            priority,
            idempotency_key,
            payload
          )
          SELECT
            'readiness_recheck',
            'profile_readiness',
            pending.workspace_id,
            pending.user_id,
            pending.appid,
            pending.material_event_id,
            pending.next_evaluation_at,
            250,
            'readiness:' || pending.user_id || ':' || pending.appid || ':' ||
              to_char(pending.next_evaluation_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI'),
            jsonb_build_object('reason', 'readiness_due')
          FROM opportunity.candidate_state pending
          WHERE pending.state = 'pending_readiness'
            AND pending.next_evaluation_at <= now()
          ORDER BY pending.next_evaluation_at, pending.appid
          LIMIT 1000
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,
      );
      const health = await client.query(
        `
          INSERT INTO opportunity.work_queue (
            kind,
            lane,
            priority,
            idempotency_key,
            scheduled_for,
            payload
          )
          VALUES (
            'refresh_preset_health',
            'market_cohort',
            50,
            'preset-health:' || CURRENT_DATE,
            now(),
            '{}'::jsonb
          )
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,
      );

      return (
        (materialize.rowCount ?? 0) +
        (daily.rowCount ?? 0) +
        (readiness.rowCount ?? 0) +
        (health.rowCount ?? 0)
      );
    });
    return result;
  }

  async claimWork(
    workerId: string,
    limit: number,
  ): Promise<OpportunityWorkItem[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const result = await this.pool.query<WorkRow>(
      `
        WITH eligible AS (
          SELECT
            work.id,
            row_number() OVER (
              PARTITION BY work.lane
              ORDER BY work.priority DESC, work.scheduled_for, work.id
            ) AS lane_rank
          FROM opportunity.work_queue work
          WHERE (
              work.state IN ('pending', 'retrying')
              AND work.scheduled_for <= now()
              AND work.next_attempt_at <= now()
            )
            OR (
              work.state = 'claimed'
              AND work.claim_expires_at < now()
            )
        ),
        claims AS (
          SELECT work.id
          FROM opportunity.work_queue work
          JOIN eligible ON eligible.id = work.id
          WHERE eligible.lane_rank <= CASE
            WHEN work.kind = 'materialize_events' THEN 1
            ELSE GREATEST(1, CEIL($2::numeric / 4))
          END
          ORDER BY work.priority DESC, work.scheduled_for, work.id
          LIMIT $2
          FOR UPDATE OF work SKIP LOCKED
        )
        UPDATE opportunity.work_queue work
        SET state = 'claimed',
            claimed_at = now(),
            claim_expires_at = now() + interval '5 minutes',
            heartbeat_at = now(),
            worker_id = $1,
            attempts = work.attempts + 1,
            updated_at = now()
        FROM claims
        WHERE work.id = claims.id
        RETURNING
          work.id,
          work.kind,
          work.lane,
          work.workspace_id,
          work.user_id,
          work.appid,
          work.profile_id,
          work.material_event_id,
          work.payload,
          work.attempts
      `,
      [workerId, boundedLimit],
    );
    return result.rows.map((row) => ({
      appid: row.appid,
      attempts: row.attempts,
      id: Number(row.id),
      kind: row.kind,
      lane: row.lane,
      materialEventId: row.material_event_id,
      payload: row.payload ?? {},
      profileId: row.profile_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
    }));
  }

  async heartbeatWork(workId: number, workerId: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE opportunity.work_queue
        SET heartbeat_at = now(),
            claim_expires_at = now() + interval '5 minutes',
            updated_at = now()
        WHERE id = $1
          AND worker_id = $2
          AND state = 'claimed'
      `,
      [workId, workerId],
    );
  }

  async completeWork(workId: number, workerId: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE opportunity.work_queue
        SET state = 'completed',
            completed_at = now(),
            claim_expires_at = NULL,
            heartbeat_at = now(),
            updated_at = now()
        WHERE id = $1
          AND worker_id = $2
          AND state = 'claimed'
      `,
      [workId, workerId],
    );
  }

  async failWork(params: {
    code: string;
    error: string;
    sourceBlocked?: boolean;
    workId: number;
    workerId: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE opportunity.work_queue
        SET state = CASE
              WHEN $5 THEN 'source_blocked'
              WHEN attempts >= max_attempts THEN 'dead_letter'
              ELSE 'retrying'
            END,
            next_attempt_at = now() + (
              LEAST(360, POWER(2, LEAST(attempts, 8))) * interval '1 minute'
            ),
            last_error_code = $3,
            last_error_message = left($4, 2000),
            claim_expires_at = NULL,
            worker_id = NULL,
            updated_at = now()
        WHERE id = $1
          AND worker_id = $2
          AND state = 'claimed'
      `,
      [
        params.workId,
        params.workerId,
        params.code,
        params.error,
        params.sourceBlocked ?? false,
      ],
    );
  }

  async materializeEvents(onProgress?: () => Promise<void>): Promise<number> {
    const cursorResult = await this.pool.query<
      QueryResultRow & { cursor_value: Record<string, string> }
    >(
      `
        SELECT cursor_value
        FROM opportunity.worker_cursors
        WHERE cursor_key = 'materialize-events/v1'
        LIMIT 1
      `,
    );
    const cursor = cursorResult.rows[0]?.cursor_value ?? {};
    const catalogAfter = Number(cursor.catalogId ?? 0);
    const lifecycleAfter = Number(cursor.lifecycleId ?? 0);
    const rawAfter = Number(cursor.rawId ?? 0);
    const initialCutoff = new Date(
      Date.now() - 48 * 60 * 60 * 1_000,
    ).toISOString();

    const [catalog, lifecycle, raw] = await Promise.all([
      this.pool.query<
        QueryResultRow & {
          after_value: unknown;
          appid: number;
          id: string | number;
          observed_at: Date | string;
          source: string;
        }
      >(
        `
          SELECT id, appid, source, observed_at, payload AS after_value
          FROM events.app_catalog_events
          WHERE event_type = 'first_observed'
            AND id > $1
            AND ($1 > 0 OR observed_at >= $2::timestamptz)
          ORDER BY id
          LIMIT 100
        `,
        [catalogAfter, initialCutoff],
      ),
      this.pool.query<
        QueryResultRow & {
          after_value: unknown;
          appid: number;
          before_value: unknown;
          effective_at: Date | string;
          event_type: string;
          id: string | number;
          occurred_at: Date | string;
          source: string;
        }
      >(
        `
          SELECT
            id,
            appid,
            source,
            event_type,
            occurred_at,
            effective_at,
            before_state AS before_value,
            after_state AS after_value
          FROM events.app_lifecycle_events
          WHERE id > $1
            AND ($1 > 0 OR occurred_at >= $2::timestamptz)
          ORDER BY id
          LIMIT 100
        `,
        [lifecycleAfter, initialCutoff],
      ),
      this.pool.query<
        QueryResultRow & {
          affects_eligibility_inputs: boolean;
          after_value: unknown;
          appid: number;
          before_value: unknown;
          change_type: string;
          id: string | number;
          occurred_at: Date | string;
          signal_family: string | null;
          source: string;
        }
      >(
        `
          SELECT
            event.id,
            event.appid,
            event.source,
            event.change_type,
            event.occurred_at,
            event.before_value,
            event.after_value,
            registry.signal_family,
            COALESCE(registry.affects_eligibility_inputs, true)
              AS affects_eligibility_inputs
          FROM events.app_change_events event
          LEFT JOIN events.change_event_registry registry
            ON registry.registry_version = 'change-events/v1'
            AND registry.source = event.source
            AND registry.raw_event_type = event.change_type
          WHERE event.id > $1
            AND ($1 > 0 OR event.occurred_at >= $2::timestamptz)
          ORDER BY event.id
          LIMIT 500
        `,
        [rawAfter, initialCutoff],
      ),
    ]);
    const sourceEvents: OpportunitySourceEvent[] = [
      ...catalog.rows.map((row) => ({
        affectsEligibilityInputs: true,
        afterValue: row.after_value,
        appid: row.appid,
        beforeValue: null,
        effectiveAt: iso(row.observed_at),
        observedAt: iso(row.observed_at),
        rawEventType: "first_observed",
        signalFamily: "release" as const,
        source: row.source,
        sourceEventId: `catalog:${row.id}`,
      })),
      ...lifecycle.rows.map((row) => ({
        affectsEligibilityInputs: true,
        afterValue: row.after_value,
        appid: row.appid,
        beforeValue: row.before_value,
        effectiveAt: iso(row.effective_at),
        observedAt: iso(row.occurred_at),
        rawEventType: row.event_type,
        signalFamily: "release" as const,
        source: row.source,
        sourceEventId: `lifecycle:${row.id}`,
      })),
      ...raw.rows.map((row) => ({
        affectsEligibilityInputs: row.affects_eligibility_inputs,
        afterValue: row.after_value,
        appid: row.appid,
        beforeValue: row.before_value,
        effectiveAt: iso(row.occurred_at),
        observedAt: iso(row.occurred_at),
        rawEventType: row.change_type,
        signalFamily: asSignalFamily(row.signal_family ?? "unknown"),
        source: row.source,
        sourceEventId: `raw:${row.id}`,
      })),
    ];
    const moments = groupOpportunitySourceEvents(sourceEvents);
    const nextCursor = {
      catalogId: String(catalog.rows.at(-1)?.id ?? catalogAfter),
      lifecycleId: String(lifecycle.rows.at(-1)?.id ?? lifecycleAfter),
      rawId: String(raw.rows.at(-1)?.id ?? rawAfter),
    };

    await this.transaction(async (client) => {
      let processedMoments = 0;
      for (const moment of moments) {
        const inserted = await this.insertMaterialMoment(client, moment);
        if (inserted && moment.eligibleForImmediate) {
          await client.query(
            `
              INSERT INTO opportunity.work_queue (
                kind,
                lane,
                workspace_id,
                user_id,
                appid,
                material_event_id,
                priority,
                idempotency_key,
                payload
              )
              SELECT DISTINCT
                'immediate_evaluation',
                'new_observation',
                profile.workspace_id,
                profile.owner_user_id,
                $1::integer,
                $2::uuid,
                1000,
                'event:' || $2::text || ':user:' || profile.owner_user_id,
                jsonb_build_object('eventFingerprint', $3::text)
              FROM opportunity.profiles profile
              WHERE profile.status = 'enabled'
                AND profile.immediate_full_match_enabled
              ON CONFLICT (idempotency_key) DO NOTHING
            `,
            [moment.appid, inserted, moment.eventFingerprint],
          );
        } else if (inserted && moment.reevaluateEligibility) {
          await client.query(
            `
              INSERT INTO opportunity.work_queue (
                kind,
                lane,
                workspace_id,
                user_id,
                appid,
                material_event_id,
                priority,
                idempotency_key,
                payload
              )
              SELECT DISTINCT
                'readiness_recheck',
                'profile_readiness',
                candidate.workspace_id,
                candidate.user_id,
                $1::integer,
                $2::uuid,
                300,
                'event:' || $2::text || ':readiness:' || candidate.user_id,
                jsonb_build_object('eventFingerprint', $3::text)
              FROM opportunity.candidate_state candidate
              WHERE candidate.appid = $1::integer
                AND candidate.state = 'pending_readiness'
              ON CONFLICT (idempotency_key) DO NOTHING
            `,
            [moment.appid, inserted, moment.eventFingerprint],
          );
        }
        processedMoments += 1;
        if (onProgress && processedMoments % 50 === 0) {
          await onProgress();
        }
      }
      await client.query(
        `
          INSERT INTO opportunity.worker_cursors (
            cursor_key,
            cursor_value,
            updated_at
          )
          VALUES ('materialize-events/v1', $1::jsonb, now())
          ON CONFLICT (cursor_key)
          DO UPDATE SET
            cursor_value = EXCLUDED.cursor_value,
            updated_at = now()
        `,
        [JSON.stringify(nextCursor)],
      );
    });

    return moments.length;
  }

  private async insertMaterialMoment(
    client: PoolClient,
    moment: OpportunityMaterialMoment,
  ): Promise<string | null> {
    const result = await client.query<QueryResultRow & { id: string }>(
      `
        INSERT INTO opportunity.material_events (
          appid,
          event_type,
          signal_family,
          effective_at,
          observed_at,
          grouped_window_start,
          grouped_window_end,
          event_fingerprint,
          registry_version,
          classifier_version,
          materiality,
          confidence,
          reevaluate_eligibility,
          creates_daily_result,
          eligible_for_immediate,
          affected_rule_fields,
          before_summary,
          after_summary,
          raw_event_refs,
          provenance
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
          'change-events/v1',
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15::text[],
          $16::jsonb,
          $17::jsonb,
          $18::jsonb,
          $19::jsonb
        )
        ON CONFLICT (event_fingerprint) DO NOTHING
        RETURNING id
      `,
      [
        moment.appid,
        moment.eventType,
        moment.signalFamily,
        moment.effectiveAt,
        moment.observedAt,
        moment.groupedWindowStart,
        moment.groupedWindowEnd,
        moment.eventFingerprint,
        moment.classifierVersion,
        moment.materiality,
        moment.confidence,
        moment.reevaluateEligibility,
        moment.createsDailyResult,
        moment.eligibleForImmediate,
        moment.affectedRuleFields,
        JSON.stringify(moment.beforeSummary),
        JSON.stringify(moment.afterSummary),
        JSON.stringify(moment.rawEventIds),
        JSON.stringify({
          groupedEventCount: moment.rawEventIds.length,
          materialityVersion: OPPORTUNITY_MATERIALITY_VERSION,
        }),
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  async createRunContext(params: {
    kind: "daily" | "immediate" | "manual" | "replay" | "readiness";
    userId: string;
    workspaceId: string;
  }): Promise<OpportunityRunContext> {
    const profileResult = await this.pool.query<
      QueryResultRow & { version_id: string }
    >(
      `
        SELECT profile.current_version_id AS version_id
        FROM opportunity.profiles profile
        WHERE profile.workspace_id = $1
          AND profile.owner_user_id = $2
          AND profile.status = 'enabled'
          AND profile.current_version_id IS NOT NULL
        ORDER BY profile.id
        LIMIT 100
      `,
      [params.workspaceId, params.userId],
    );
    const versionIds = profileResult.rows.map((row) => row.version_id);
    const watermarks = await this.pool.query<
      QueryResultRow & {
        catalog_event_id: string | number | null;
        lifecycle_event_id: string | number | null;
        material_event_at: Date | string | null;
        pics_cursor: string | number | null;
        raw_event_id: string | number | null;
      }
    >(`
      SELECT
        (SELECT MAX(id) FROM events.app_catalog_events) AS catalog_event_id,
        (SELECT MAX(id) FROM events.app_lifecycle_events) AS lifecycle_event_id,
        (SELECT MAX(id) FROM events.app_change_events) AS raw_event_id,
        (SELECT MAX(observed_at) FROM opportunity.material_events) AS material_event_at,
        (SELECT last_change_number FROM ops.pics_sync_state ORDER BY id LIMIT 1)
          AS pics_cursor
    `);
    const watermark = watermarks.rows[0] ?? {};
    const run = await this.pool.query<
      QueryResultRow & {
        id: string;
        window_end: Date | string;
        window_start: Date | string;
      }
    >(
      `
        WITH prior AS (
          SELECT MAX(window_end) AS last_success
          FROM opportunity.runs
          WHERE workspace_id = $1
            AND user_id = $2
            AND status = 'completed'
            AND run_kind IN ('daily', 'manual', 'replay')
        )
        INSERT INTO opportunity.runs (
          workspace_id,
          user_id,
          run_kind,
          window_start,
          window_end,
          source_watermarks,
          active_profile_versions,
          calculation_versions
        )
        SELECT
          $1,
          $2,
          $3,
          COALESCE(
            prior.last_success,
            now() - interval '24 hours'
          ),
          now(),
          $4::jsonb,
          $5::uuid[],
          $6::jsonb
        FROM prior
        RETURNING id, window_start, window_end
      `,
      [
        params.workspaceId,
        params.userId,
        params.kind,
        JSON.stringify({
          catalogEventId: watermark.catalog_event_id ?? null,
          lifecycleEventId: watermark.lifecycle_event_id ?? null,
          materialEventAt: watermark.material_event_at
            ? iso(watermark.material_event_at)
            : null,
          picsCursor: watermark.pics_cursor ?? null,
          rawEventId: watermark.raw_event_id ?? null,
        }),
        versionIds,
        JSON.stringify({
          bulkPersistence: OPPORTUNITY_BULK_PERSISTENCE_VERSION,
          cohort: OPPORTUNITY_COHORT_VERSION,
          cohortCache: OPPORTUNITY_COHORT_CACHE_VERSION,
          cohortFeatureProjection:
            OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
          cohortResolver: OPPORTUNITY_COHORT_RESOLVER_VERSION,
          health: "opportunity-health/v1",
          market: OPPORTUNITY_MARKET_VERSION,
          materiality: "opportunity-materiality/v1",
          ranking: "opportunity-ranking/v1",
          ruleInputProjection: OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
          rules: "opportunity-rules/v1",
          signals: "signal-windows/v1",
        }),
      ],
    );
    const row = run.rows[0]!;
    return {
      id: row.id,
      kind: params.kind,
      windowEnd: iso(row.window_end),
      windowStart: iso(row.window_start),
    };
  }

  async failRun(runId: string, error: unknown): Promise<void> {
    await this.pool.query(
      `
        UPDATE opportunity.runs
        SET status = 'failed',
            error = $2::jsonb,
            completed_at = now()
        WHERE id = $1
          AND status = 'running'
      `,
      [
        runId,
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
    );
  }

  async getActiveProfiles(
    workspaceId: string,
    userId: string,
    options?: { immediateOnly?: boolean },
  ): Promise<OpportunityWorkerProfile[]> {
    const result = await this.pool.query<
      QueryResultRow & {
        event_subscriptions: OpportunitySignalFamily[];
        id: string;
        immediate_full_match_enabled: boolean;
        name: string;
        rules: OpportunityRuleSet;
        version_id: string;
        version_number: number;
      }
    >(
      `
        SELECT
          profile.id,
          profile.name,
          profile.immediate_full_match_enabled,
          version.id AS version_id,
          version.version AS version_number,
          version.rules,
          version.event_subscriptions
        FROM opportunity.profiles profile
        JOIN opportunity.profile_versions version
          ON version.id = profile.current_version_id
        WHERE profile.workspace_id = $1
          AND profile.owner_user_id = $2
          AND profile.status = 'enabled'
          AND ($3::boolean = false OR profile.immediate_full_match_enabled)
        ORDER BY profile.id
        LIMIT 100
      `,
      [workspaceId, userId, options?.immediateOnly ?? false],
    );
    return result.rows.map((row) => ({
      eventSubscriptions: row.event_subscriptions,
      id: row.id,
      immediateFullMatchEnabled: row.immediate_full_match_enabled,
      name: row.name,
      rules: row.rules,
      versionId: row.version_id,
      versionNumber: row.version_number,
    }));
  }

  async getRunMaterialEvents(
    run: OpportunityRunContext,
    appid?: number | null,
    materialEventId?: string | null,
  ): Promise<OpportunityWorkerMaterialEvent[]> {
    const result = await this.pool.query<
      QueryResultRow & {
        appid: number;
        affected_rule_fields: OpportunityRuleField[];
        after_summary: unknown;
        before_summary: unknown;
        confidence: OpportunityConfidence;
        creates_daily_result: boolean;
        effective_at: Date | string;
        eligible_for_immediate: boolean;
        event_fingerprint: string;
        event_type: OpportunityMaterialEventType;
        id: string;
        materiality: string | number;
        observed_at: Date | string;
        reevaluate_eligibility: boolean;
        signal_family: OpportunitySignalFamily;
      }
    >(
      `
        SELECT
          id,
          appid,
          event_type,
          signal_family,
          affected_rule_fields,
          before_summary,
          after_summary,
          confidence,
          effective_at,
          observed_at,
          event_fingerprint,
          materiality,
          reevaluate_eligibility,
          creates_daily_result,
          eligible_for_immediate
        FROM opportunity.material_events
        WHERE (
            (
              $4::uuid IS NULL
              AND observed_at >= $1
              AND observed_at < $2
            )
            OR id = $4
          )
          AND ($3::integer IS NULL OR appid = $3)
        ORDER BY appid, observed_at DESC, id
        LIMIT 10000
      `,
      [run.windowStart, run.windowEnd, appid ?? null, materialEventId ?? null],
    );
    const changes = await presentOpportunityChanges(
      this.pool,
      result.rows.map((row) => ({
        affectedRuleFields: row.affected_rule_fields,
        after: row.after_summary,
        before: row.before_summary,
        confidence: row.confidence,
        effectiveAt: iso(row.effective_at),
        eventType: row.event_type,
        observedAt: iso(row.observed_at),
        signalFamily: row.signal_family,
        summary: "",
      })),
      result.rows.map(() => "materially_changed" as const),
    );
    return result.rows.map((row, index) => ({
      affectedRuleFields: row.affected_rule_fields,
      after: row.after_summary,
      appid: row.appid,
      before: row.before_summary,
      confidence: row.confidence,
      createsDailyResult: row.creates_daily_result,
      effectiveAt: iso(row.effective_at),
      eligibleForImmediate: row.eligible_for_immediate,
      eventFingerprint: row.event_fingerprint,
      eventType: row.event_type,
      id: row.id,
      materiality: Number(row.materiality),
      observedAt: iso(row.observed_at),
      reevaluateEligibility: row.reevaluate_eligibility,
      signalFamily: row.signal_family,
      summary:
        changes[index]?.summary ??
        "Steam recorded a change, but the affected field is unavailable.",
    }));
  }

  async getPriorUserStates(
    workspaceId: string,
    userId: string,
    appids: number[],
  ): Promise<Map<number, OpportunityPriorUserState>> {
    const result = await this.pool.query<
      QueryResultRow & {
        appid: number;
        dismissed_event_fingerprint: string | null;
        event_fingerprints: string[] | null;
        ignored: boolean;
        prior_result_id: string | null;
        tracked: boolean;
      }
    >(
      `
        SELECT
          app.appid,
          state.dismissed_event_fingerprint,
          state.ignored_at IS NOT NULL AS ignored,
          state.tracked_at IS NOT NULL AS tracked,
          prior.id AS prior_result_id,
          prior.event_fingerprints
        FROM unnest($3::integer[]) AS app(appid)
        LEFT JOIN opportunity.user_game_state state
          ON state.workspace_id = $1
          AND state.user_id = $2
          AND state.appid = app.appid
        LEFT JOIN LATERAL (
          SELECT
            latest.id,
            history.event_fingerprints
          FROM (
            SELECT result.id
            FROM opportunity.results result
            WHERE result.workspace_id = $1
              AND result.user_id = $2
              AND result.appid = app.appid
            ORDER BY result.created_at DESC, result.id DESC
            LIMIT 1
          ) latest
          CROSS JOIN LATERAL (
            SELECT
              array_agg(DISTINCT result.event_fingerprint)
                AS event_fingerprints
            FROM opportunity.results result
            WHERE result.workspace_id = $1
              AND result.user_id = $2
              AND result.appid = app.appid
          ) history
        ) prior ON true
      `,
      [workspaceId, userId, appids],
    );
    return new Map(
      result.rows.map((row) => [
        row.appid,
        {
          dismissedEventFingerprint: row.dismissed_event_fingerprint,
          ignored: row.ignored,
          priorEventFingerprints: new Set(row.event_fingerprints ?? []),
          priorResultId: row.prior_result_id,
          tracked: row.tracked,
        },
      ]),
    );
  }

  async getCandidateOutcomes(params: {
    appids: number[];
    profileVersionIds: string[];
    userId: string;
  }): Promise<Map<string, "eligible" | "ineligible" | "pending" | "expired">> {
    if (params.appids.length === 0 || params.profileVersionIds.length === 0) {
      return new Map();
    }
    const result = await this.pool.query<
      QueryResultRow & {
        appid: number;
        profile_version_id: string;
        state: string;
      }
    >(
      `
        SELECT appid, profile_version_id, state
        FROM opportunity.candidate_state
        WHERE user_id = $1
          AND appid = ANY($2::integer[])
          AND profile_version_id = ANY($3::uuid[])
      `,
      [params.userId, params.appids, params.profileVersionIds],
    );
    return new Map(
      result.rows.map((row) => [
        `${row.appid}:${row.profile_version_id}`,
        row.state === "eligible"
          ? "eligible"
          : row.state === "ineligible"
            ? "ineligible"
            : row.state === "readiness_expired"
              ? "expired"
              : "pending",
      ]),
    );
  }

  createReleasedCohortCache(): OpportunityReleasedCohortCache {
    return new Map();
  }

  private async loadReleasedCohortRows(
    params: {
      genres: string[];
      isFree: boolean;
      price: number;
      tags: string[];
    },
    client: PoolClient | null = null,
  ): Promise<OpportunityReleasedCohortRow[]> {
    const values = [params.tags, params.genres, params.isFree, params.price];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (client) {
        await client.query("SAVEPOINT opportunity_legacy_cohort");
      }
      try {
        const sql = `
            WITH tag_matches AS MATERIALIZED (
              SELECT
                app_tag.appid,
                COUNT(1)::integer AS tag_overlap
              FROM legacy.app_steam_tags app_tag
              JOIN legacy.steam_tags tag ON tag.tag_id = app_tag.tag_id
              WHERE LOWER(tag.name) = ANY($1::text[])
              GROUP BY app_tag.appid
            ),
            genre_matches AS MATERIALIZED (
              SELECT
                app_genre.appid,
                COUNT(1)::integer AS genre_overlap
              FROM legacy.app_genres app_genre
              JOIN legacy.steam_genres genre
                ON genre.genre_id = app_genre.genre_id
              WHERE LOWER(genre.name) = ANY($2::text[])
              GROUP BY app_genre.appid
            ),
            candidate_ids AS MATERIALIZED (
              SELECT appid FROM tag_matches
              UNION
              SELECT appid FROM genre_matches
              UNION
              SELECT app.appid
              FROM legacy.apps app
              WHERE cardinality($1::text[]) = 0
                AND cardinality($2::text[]) = 0
                AND app.type = 'game'
                AND app.is_released = true
                AND COALESCE(app.is_delisted, false) = false
            )
            SELECT
              app.appid,
              app.name,
              COALESCE(app.current_price_cents, metric.price_cents)
                AS price_cents,
              metric.total_reviews,
              metric.positive_percentage,
              metric.ccu_peak,
              metric.metric_date,
              signal.review_change_30d,
              COALESCE(tag_matches.tag_overlap, 0)::integer AS tag_overlap,
              (
                0.45 * LEAST(
                  1,
                  COALESCE(tag_matches.tag_overlap, 0)::numeric /
                    GREATEST(1, cardinality($1::text[]))
                )
                + 0.20 * LEAST(
                  1,
                  COALESCE(genre_matches.genre_overlap, 0)::numeric /
                    GREATEST(1, cardinality($2::text[]))
                )
                + 0.10 * CASE
                    WHEN $3::boolean = app.is_free THEN 1
                    ELSE 0
                  END
                + 0.10 * CASE
                    WHEN ABS(
                      COALESCE(
                        app.current_price_cents,
                        metric.price_cents,
                        0
                      ) - $4
                    ) <= 1000
                      THEN 1
                    ELSE 0
                  END
              ) AS inclusion_score
            FROM candidate_ids candidate
            JOIN legacy.apps app ON app.appid = candidate.appid
            LEFT JOIN tag_matches ON tag_matches.appid = app.appid
            LEFT JOIN genre_matches ON genre_matches.appid = app.appid
            LEFT JOIN legacy.latest_daily_metrics metric
              ON metric.appid = app.appid
            LEFT JOIN metrics.app_signal_windows_v1 signal
              ON signal.appid = app.appid
            WHERE app.type = 'game'
              AND app.is_released = true
              AND COALESCE(app.is_delisted, false) = false
              AND app.is_free = $3
            ORDER BY inclusion_score DESC, app.appid
            LIMIT 51
          `;
        const result = client
          ? await client.query<OpportunityReleasedCohortRow>(sql, values)
          : await this.pool.query<OpportunityReleasedCohortRow>(sql, values);
        if (client) {
          await client.query("RELEASE SAVEPOINT opportunity_legacy_cohort");
        }
        return result.rows;
      } catch (error) {
        if (client) {
          await client
            .query("ROLLBACK TO SAVEPOINT opportunity_legacy_cohort")
            .catch(() => undefined);
        }
        if (attempt >= 2 || !isStatementTimeout(error)) {
          throw error;
        }
      }
    }
    return [];
  }

  async getReleasedCohort(
    input: OpportunityEvaluationInput,
    cache: OpportunityReleasedCohortCache = this.createReleasedCohortCache(),
  ): Promise<OpportunityReleasedCohort> {
    const subject = normalizeCohortInput(input);
    const cacheKey = JSON.stringify([
      subject.normalizedTags,
      subject.normalizedGenres,
      subject.isFree,
      subject.price,
    ]);
    let rowsPromise = cache.get(cacheKey);
    if (!rowsPromise) {
      rowsPromise = this.loadReleasedCohortRows({
        genres: subject.normalizedGenres,
        isFree: subject.isFree,
        price: subject.price,
        tags: subject.normalizedTags,
      });
      cache.set(cacheKey, rowsPromise);
    }
    return releasedCohortFromRows(subject, await rowsPromise);
  }

  async getReleasedCohortShadow(
    input: OpportunityEvaluationInput,
    snapshotId: string,
  ): Promise<OpportunityReleasedCohort> {
    if (!/^[0-9A-Fa-f-]+$/.test(snapshotId)) {
      throw new Error(
        "Tiger returned an invalid exported snapshot identifier.",
      );
    }
    const subject = normalizeCohortInput(input);
    const client = await this.pool.connect();
    try {
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      await client.query(`SET TRANSACTION SNAPSHOT '${snapshotId}'`);
      const rows = await this.loadReleasedCohortRows(
        {
          genres: subject.normalizedGenres,
          isFree: subject.isFree,
          price: subject.price,
          tags: subject.normalizedTags,
        },
        client,
      );
      await client.query("COMMIT");
      return releasedCohortFromRows(subject, rows);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async cohortFeatureProjectionReady(
    expectedSourceRevisions: Record<string, number> | null = null,
    client: PoolClient | null = null,
  ): Promise<boolean> {
    const sql = `
        WITH current_revisions AS (
          SELECT jsonb_object_agg(
            source_key,
            revision
            ORDER BY source_key
          ) AS value
          FROM opportunity.cohort_source_revisions_v1
          WHERE source_key IN (
            'legacy.apps',
            'legacy.app_steam_tags',
            'legacy.steam_tags',
            'legacy.app_genres',
            'legacy.steam_genres',
            'legacy.latest_daily_metrics'
          )
        )
        SELECT EXISTS (
          SELECT 1
          FROM opportunity.cohort_feature_projection_state_v1 state
          CROSS JOIN current_revisions
          JOIN pg_class relation
            ON relation.oid =
              'opportunity.released_cohort_features_v2'::regclass
          WHERE state.singleton
            AND relation.relispopulated
            AND state.row_count > 0
            AND state.feature_projection_version = $1
            AND state.source_revisions = current_revisions.value
            AND (
              $2::jsonb IS NULL
              OR state.source_revisions = $2::jsonb
            )
        ) AS ready
      `;
    const values = [
      OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
      expectedSourceRevisions ? JSON.stringify(expectedSourceRevisions) : null,
    ];
    const result = client
      ? await client.query<QueryResultRow & { ready: boolean }>(sql, values)
      : await this.pool.query<QueryResultRow & { ready: boolean }>(sql, values);
    return result.rows[0]?.ready === true;
  }

  private async refreshCohortFeatureProjection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query(
        "CALL opportunity.refresh_released_cohort_features_v2()",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async acquireCohortFeatureSourceFence(): Promise<PoolClient> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query("SET LOCAL lock_timeout = '2min'");
      await client.query(`
        LOCK TABLE
          legacy.apps,
          legacy.steam_genres,
          legacy.app_genres,
          legacy.steam_tags,
          legacy.app_steam_tags,
          legacy.latest_daily_metrics
        IN SHARE MODE
      `);
      return client;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw error;
    }
  }

  private async getCohortSourceWatermark(
    client: PoolClient | null = null,
  ): Promise<OpportunityCohortSourceWatermark> {
    const sql = `
        WITH expected(source_key) AS (
          VALUES
            ('legacy.apps'),
            ('legacy.app_steam_tags'),
            ('legacy.steam_tags'),
            ('legacy.app_genres'),
            ('legacy.steam_genres'),
            ('legacy.latest_daily_metrics'),
            ('metrics.app_signal_windows_v1'),
            ('ops.app_data_readiness')
        )
        SELECT
          CURRENT_DATE AS source_date,
          jsonb_build_object(
            'sourceRevisions',
              (
                SELECT jsonb_object_agg(
                  expected.source_key,
                  revisions.revision
                  ORDER BY expected.source_key
                )
                FROM expected
                LEFT JOIN opportunity.cohort_source_revisions_v1 revisions
                  USING (source_key)
              )
          ) AS source_watermark
      `;
    const result = client
      ? await client.query<OpportunityCohortSourceWatermarkRow>(sql)
      : await this.pool.query<OpportunityCohortSourceWatermarkRow>(sql);
    const row = result.rows[0];
    const value = asRecord(row?.source_watermark) ?? {};
    const sourceRevisions = asRecord(value.sourceRevisions) ?? {};
    const sourceDate = row?.source_date
      ? row.source_date instanceof Date
        ? row.source_date.toISOString().slice(0, 10)
        : String(row.source_date).slice(0, 10)
      : "";
    const required = [
      "legacy.apps",
      "legacy.app_steam_tags",
      "legacy.steam_tags",
      "legacy.app_genres",
      "legacy.steam_genres",
      "legacy.latest_daily_metrics",
      "metrics.app_signal_windows_v1",
      "ops.app_data_readiness",
    ];
    const cacheable =
      /^\d{4}-\d{2}-\d{2}$/.test(sourceDate) &&
      required.every(
        (key) =>
          typeof sourceRevisions[key] === "number" &&
          Number.isSafeInteger(sourceRevisions[key]) &&
          Number(sourceRevisions[key]) >= 0,
      );
    const featureSourceRevisions = cacheable
      ? Object.fromEntries(
          [
            "legacy.apps",
            "legacy.app_steam_tags",
            "legacy.steam_tags",
            "legacy.app_genres",
            "legacy.steam_genres",
            "legacy.latest_daily_metrics",
          ].map((key) => [key, Number(sourceRevisions[key])]),
        )
      : null;
    return {
      cacheable,
      featureSourceRevisions,
      hash: stableHash({ sourceDate, value }),
      sourceDate,
      value,
    };
  }

  private async openCurrentCohortSnapshot(): Promise<{
    client: PoolClient;
    snapshotId: string;
    watermark: OpportunityCohortSourceWatermark;
  } | null> {
    const client = await this.pool.connect();
    try {
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const watermark = await this.getCohortSourceWatermark(client);
      if (
        !watermark.featureSourceRevisions ||
        !(await this.cohortFeatureProjectionReady(
          watermark.featureSourceRevisions,
          client,
        ))
      ) {
        await client.query("ROLLBACK");
        client.release();
        return null;
      }
      const snapshot = await client.query<OpportunityExportedSnapshotRow>(
        "SELECT pg_export_snapshot() AS snapshot_id",
      );
      const snapshotId = snapshot.rows[0]?.snapshot_id;
      if (!snapshotId) {
        throw new Error(
          "Tiger did not return an exported snapshot for Opportunity cohort resolution.",
        );
      }
      return { client, snapshotId, watermark };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw error;
    }
  }

  private cohortCacheKey(
    subject: NormalizedCohortInput,
    watermark: { hash: string; sourceDate: string },
  ): string {
    return stableHash({
      appid: subject.appid,
      cacheVersion: OPPORTUNITY_COHORT_CACHE_VERSION,
      cohortVersion: OPPORTUNITY_COHORT_VERSION,
      featureProjectionVersion: OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
      inputFingerprint: subject.inputFingerprint,
      marketVersion: OPPORTUNITY_MARKET_VERSION,
      projectionVersion: OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
      resolverVersion: OPPORTUNITY_COHORT_RESOLVER_VERSION,
      sourceDate: watermark.sourceDate,
      sourceWatermarkHash: watermark.hash,
    });
  }

  private async loadCachedReleasedCohorts(
    cacheKeys: string[],
    client: PoolClient | null = null,
  ): Promise<Map<string, OpportunityReleasedCohort>> {
    if (cacheKeys.length === 0) {
      return new Map();
    }
    const sql = `
        SELECT cache_key, cohort
        FROM opportunity.released_cohort_cache_v1
        WHERE cache_key = ANY($1::text[])
          AND projection_version = $2
          AND feature_projection_version = $3
          AND cohort_version = $4
          AND market_version = $5
          AND resolver_version = $6
          AND expires_at > now()
        ORDER BY cache_key
      `;
    const values = [
      cacheKeys,
      OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
      OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
      OPPORTUNITY_COHORT_VERSION,
      OPPORTUNITY_MARKET_VERSION,
      OPPORTUNITY_COHORT_RESOLVER_VERSION,
    ];
    const result = client
      ? await client.query<OpportunityCohortCacheRow>(sql, values)
      : await this.pool.query<OpportunityCohortCacheRow>(sql, values);
    const cohorts = new Map<string, OpportunityReleasedCohort>();
    const expectedCacheKeys = new Set(cacheKeys);
    for (const row of result.rows) {
      const cohort =
        typeof row.cohort === "string" ? asRecord(row.cohort) : row.cohort;
      if (
        !expectedCacheKeys.has(row.cache_key) ||
        cohorts.has(row.cache_key) ||
        !isReleasedCohort(cohort)
      ) {
        continue;
      }
      cohorts.set(row.cache_key, cohort);
    }
    return cohorts;
  }

  private async loadReleasedCohortRowsBatch(
    signatures: NormalizedCohortInput[],
    snapshotId: string | null = null,
  ): Promise<Map<string, OpportunityReleasedCohortRow[]>> {
    const unique = Array.from(
      new Map(
        signatures.map((subject) => [subject.signatureKey, subject]),
      ).values(),
    );
    const rowsBySignature = new Map<string, OpportunityReleasedCohortRow[]>();
    if (unique.length === 0) {
      return rowsBySignature;
    }

    const client = await this.pool.connect();
    let transactionOpen = false;
    const features: OpportunityCohortFeatureRow[] = [];
    let taxonomyRows: OpportunityCohortTaxonomyRow[] = [];
    try {
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      transactionOpen = true;
      await client.query("SET LOCAL statement_timeout = '120s'");
      if (snapshotId) {
        if (!/^[0-9A-Fa-f-]+$/.test(snapshotId)) {
          throw new Error(
            "Tiger returned an invalid exported snapshot identifier.",
          );
        }
        await client.query(`SET TRANSACTION SNAPSHOT '${snapshotId}'`);
      }
      const taxonomy = await client.query<OpportunityCohortTaxonomyRow>(`
        SELECT
          position.taxonomy_kind,
          position.taxonomy_id,
          lower(CASE
            WHEN position.taxonomy_kind = 'tag' THEN tag.name
            ELSE genre.name
          END) AS name
        FROM opportunity.cohort_taxonomy_positions_v1 position
        LEFT JOIN legacy.steam_tags tag
          ON position.taxonomy_kind = 'tag'
         AND tag.tag_id = position.taxonomy_id
        LEFT JOIN legacy.steam_genres genre
          ON position.taxonomy_kind = 'genre'
         AND genre.genre_id = position.taxonomy_id
        WHERE CASE
          WHEN position.taxonomy_kind = 'tag' THEN tag.name
          ELSE genre.name
        END IS NOT NULL
        ORDER BY position.taxonomy_kind, position.taxonomy_id
      `);
      taxonomyRows = taxonomy.rows;

      let cursor = 0;
      while (features.length <= COHORT_FEATURE_MAX_ROWS) {
        const page = await client.query<OpportunityCohortFeatureRow>(
          `
            SELECT
              feature.appid,
              feature.is_free,
              feature.effective_price_cents,
              feature.tag_ids,
              feature.genre_ids,
              app.name,
              metric.total_reviews,
              metric.positive_percentage,
              metric.ccu_peak,
              metric.metric_date,
              signal.review_change_30d
            FROM opportunity.released_cohort_features_v2 feature
            JOIN legacy.apps app ON app.appid = feature.appid
            LEFT JOIN legacy.latest_daily_metrics metric
              ON metric.appid = feature.appid
            LEFT JOIN metrics.app_signal_windows_v1 signal
              ON signal.appid = feature.appid
            WHERE feature.appid > $1
            ORDER BY feature.appid
            LIMIT $2
          `,
          [cursor, COHORT_FEATURE_PAGE_SIZE],
        );
        features.push(...page.rows);
        if (features.length > COHORT_FEATURE_MAX_ROWS) {
          throw new Error(
            `Opportunity cohort feature row cap exceeded (${COHORT_FEATURE_MAX_ROWS}).`,
          );
        }
        if (page.rows.length < COHORT_FEATURE_PAGE_SIZE) {
          break;
        }
        cursor = page.rows.at(-1)?.appid ?? cursor;
      }
      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }

    const taxonomyIds = {
      genre: new Map<string, number[]>(),
      tag: new Map<string, number[]>(),
    };
    for (const row of taxonomyRows) {
      const ids = taxonomyIds[row.taxonomy_kind].get(row.name) ?? [];
      ids.push(row.taxonomy_id);
      taxonomyIds[row.taxonomy_kind].set(row.name, ids);
    }

    const genrePostings = new Map<number, OpportunityCohortFeatureRow[]>();
    const tagPostings = new Map<number, OpportunityCohortFeatureRow[]>();
    const businessFeatures = new Map<boolean, OpportunityCohortFeatureRow[]>([
      [false, []],
      [true, []],
    ]);
    for (const feature of features) {
      businessFeatures.get(feature.is_free)?.push(feature);
      for (const taxonomyId of feature.tag_ids) {
        const posting = tagPostings.get(taxonomyId) ?? [];
        posting.push(feature);
        tagPostings.set(taxonomyId, posting);
      }
      for (const taxonomyId of feature.genre_ids) {
        const posting = genrePostings.get(taxonomyId) ?? [];
        posting.push(feature);
        genrePostings.set(taxonomyId, posting);
      }
    }

    for (const subject of unique) {
      const candidates = new Map<
        number,
        {
          feature: OpportunityCohortFeatureRow;
          genreOverlap: number;
          tagOverlap: number;
        }
      >();
      const addPosting = (
        posting: OpportunityCohortFeatureRow[],
        kind: "genreOverlap" | "tagOverlap",
      ): void => {
        for (const feature of posting) {
          if (feature.is_free !== subject.isFree) {
            continue;
          }
          const candidate = candidates.get(feature.appid) ?? {
            feature,
            genreOverlap: 0,
            tagOverlap: 0,
          };
          candidate[kind] += 1;
          candidates.set(feature.appid, candidate);
        }
      };
      const subjectTagIds = new Set(
        subject.normalizedTags.flatMap(
          (name) => taxonomyIds.tag.get(name) ?? [],
        ),
      );
      const subjectGenreIds = new Set(
        subject.normalizedGenres.flatMap(
          (name) => taxonomyIds.genre.get(name) ?? [],
        ),
      );
      for (const taxonomyId of subjectTagIds) {
        addPosting(tagPostings.get(taxonomyId) ?? [], "tagOverlap");
      }
      for (const taxonomyId of subjectGenreIds) {
        addPosting(genrePostings.get(taxonomyId) ?? [], "genreOverlap");
      }
      if (
        subject.normalizedTags.length === 0 &&
        subject.normalizedGenres.length === 0
      ) {
        for (const feature of businessFeatures.get(subject.isFree) ?? []) {
          candidates.set(feature.appid, {
            feature,
            genreOverlap: 0,
            tagOverlap: 0,
          });
        }
      }

      const tagDenominator = Math.max(1, subject.normalizedTags.length);
      const genreDenominator = Math.max(1, subject.normalizedGenres.length);
      const rows = Array.from(candidates.values(), (candidate) => {
        const priceCompatible =
          Math.abs(
            (candidate.feature.effective_price_cents ?? 0) - subject.price,
          ) <= 1_000;
        const numerator =
          45 *
            Math.min(candidate.tagOverlap, tagDenominator) *
            genreDenominator +
          20 *
            Math.min(candidate.genreOverlap, genreDenominator) *
            tagDenominator +
          (priceCompatible ? 20 : 10) * tagDenominator * genreDenominator;
        return {
          appid: candidate.feature.appid,
          ccu_peak: candidate.feature.ccu_peak,
          inclusion_score:
            numerator / (100 * tagDenominator * genreDenominator),
          metric_date: candidate.feature.metric_date,
          name: candidate.feature.name,
          positive_percentage: candidate.feature.positive_percentage,
          price_cents: candidate.feature.effective_price_cents,
          review_change_30d: candidate.feature.review_change_30d,
          signature_key: subject.signatureKey,
          tag_overlap: candidate.tagOverlap,
          total_reviews: candidate.feature.total_reviews,
        } satisfies OpportunityReleasedCohortRow;
      });
      rows.sort(
        (left, right) =>
          Number(right.inclusion_score) - Number(left.inclusion_score) ||
          left.appid - right.appid,
      );
      rowsBySignature.set(subject.signatureKey, rows.slice(0, 51));
    }
    return rowsBySignature;
  }

  private async persistReleasedCohortCache(
    rows: Array<{
      cacheKey: string;
      cohort: OpportunityReleasedCohort;
      subject: NormalizedCohortInput;
    }>,
    watermark: {
      hash: string;
      sourceDate: string;
      value: Record<string, unknown>;
    },
  ): Promise<void> {
    for (
      let offset = 0;
      offset < rows.length;
      offset += COHORT_CACHE_WRITE_BATCH_SIZE
    ) {
      const batch = rows
        .slice(offset, offset + COHORT_CACHE_WRITE_BATCH_SIZE)
        .map((row) => ({
          appid: row.subject.appid,
          cache_key: row.cacheKey,
          cohort: row.cohort,
          input_fingerprint: row.subject.inputFingerprint,
          source_date: watermark.sourceDate,
          source_watermark: watermark.value,
          source_watermark_hash: watermark.hash,
        }));
      await this.pool.query(
        `
          INSERT INTO opportunity.released_cohort_cache_v1 (
            cache_key,
            appid,
            source_date,
            source_watermark_hash,
            source_watermark,
            input_fingerprint,
            projection_version,
            feature_projection_version,
            cohort_version,
            market_version,
            resolver_version,
            cohort,
            created_at,
            expires_at
          )
          SELECT
            cached.cache_key,
            cached.appid,
            cached.source_date,
            cached.source_watermark_hash,
            cached.source_watermark,
            cached.input_fingerprint,
            $2,
            $3,
            $4,
            $5,
            $6,
            cached.cohort,
            clock_timestamp(),
            clock_timestamp() + interval '3 days'
          FROM jsonb_to_recordset($1::jsonb) AS cached(
            cache_key text,
            appid integer,
            source_date date,
            source_watermark_hash text,
            source_watermark jsonb,
            input_fingerprint text,
            cohort jsonb
          )
          ON CONFLICT (cache_key)
          DO UPDATE SET
            cohort = EXCLUDED.cohort,
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at
          WHERE opportunity.released_cohort_cache_v1.cohort
              IS DISTINCT FROM EXCLUDED.cohort
             OR opportunity.released_cohort_cache_v1.expires_at <= now()
        `,
        [
          JSON.stringify(batch),
          OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
          OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
          OPPORTUNITY_COHORT_VERSION,
          OPPORTUNITY_MARKET_VERSION,
          OPPORTUNITY_COHORT_RESOLVER_VERSION,
        ],
      );
    }
  }

  async roundTripReleasedCohortCacheShadow(
    inputs: OpportunityEvaluationInput[],
    expected: Map<number, OpportunityReleasedCohort>,
    sourceClient: PoolClient,
  ): Promise<{
    exactMatches: number;
    persisted: number;
    persistenceMs: number;
    readMs: number;
  }> {
    const subjects = Array.from(
      new Map(
        inputs.map((input) => [input.appid, normalizeCohortInput(input)]),
      ).values(),
    );
    const watermark = await this.getCohortSourceWatermark(sourceClient);
    if (!watermark.cacheable || !watermark.featureSourceRevisions) {
      throw new Error(
        "Opportunity cache shadow requires a complete exported source watermark.",
      );
    }
    const keyed = subjects.map((subject) => ({
      cacheKey: this.cohortCacheKey(subject, watermark),
      cohort: expected.get(subject.appid),
      subject,
    }));
    if (keyed.some((item) => !item.cohort)) {
      throw new Error(
        "Opportunity cache shadow is missing an expected cohort payload.",
      );
    }
    const persistenceStartedAt = performance.now();
    await this.persistReleasedCohortCache(
      keyed.map((item) => ({
        cacheKey: item.cacheKey,
        cohort: item.cohort!,
        subject: item.subject,
      })),
      watermark,
    );
    const persistenceMs = performance.now() - persistenceStartedAt;
    const readStartedAt = performance.now();
    const loaded = await this.loadCachedReleasedCohorts(
      keyed.map((item) => item.cacheKey),
    );
    const readMs = performance.now() - readStartedAt;
    const exactMatches = keyed.filter(
      (item) =>
        stableHash(loaded.get(item.cacheKey)) === stableHash(item.cohort),
    ).length;
    return {
      exactMatches,
      persisted: keyed.length,
      persistenceMs,
      readMs,
    };
  }

  async getReleasedCohorts(
    inputs: OpportunityEvaluationInput[],
  ): Promise<Map<number, OpportunityReleasedCohort>> {
    const subjects = Array.from(
      new Map(
        inputs.map((input) => [input.appid, normalizeCohortInput(input)]),
      ).values(),
    );
    if (subjects.length === 0) {
      return new Map();
    }

    let snapshot = await this.openCurrentCohortSnapshot();
    if (!snapshot) {
      const fenceClient = await this.acquireCohortFeatureSourceFence();
      try {
        await this.refreshCohortFeatureProjection();
        snapshot = await this.openCurrentCohortSnapshot();
        if (!snapshot) {
          throw new Error(
            "Opportunity cohort feature projection did not match the fenced exported source snapshot.",
          );
        }
        await fenceClient.query("COMMIT");
      } catch (error) {
        await fenceClient.query("ROLLBACK").catch(() => undefined);
        if (snapshot) {
          await snapshot.client.query("ROLLBACK").catch(() => undefined);
          snapshot.client.release();
        }
        throw error;
      } finally {
        fenceClient.release();
      }
    }

    const snapshotClient = snapshot.client;
    const before = snapshot.watermark;
    let snapshotOpen = true;
    try {
      const keyed = subjects.map((subject) => ({
        cacheKey: this.cohortCacheKey(subject, before),
        subject,
      }));
      const cached = before.cacheable
        ? await this.loadCachedReleasedCohorts(
            keyed.map((item) => item.cacheKey),
            snapshotClient,
          )
        : new Map<string, OpportunityReleasedCohort>();
      const misses = keyed.filter((item) => !cached.has(item.cacheKey));
      const rowsBySignature = await this.loadReleasedCohortRowsBatch(
        misses.map((item) => item.subject),
        snapshot.snapshotId,
      );
      const resolved = new Map<number, OpportunityReleasedCohort>();
      for (const item of keyed) {
        const cohort =
          cached.get(item.cacheKey) ??
          releasedCohortFromRows(
            item.subject,
            rowsBySignature.get(item.subject.signatureKey) ?? [],
          );
        resolved.set(item.subject.appid, cohort);
      }
      await snapshotClient.query("COMMIT");
      snapshotOpen = false;
      if (before.cacheable) {
        await this.persistReleasedCohortCache(
          misses.map((item) => ({
            cacheKey: item.cacheKey,
            cohort: resolved.get(item.subject.appid)!,
            subject: item.subject,
          })),
          before,
        );
      }
      return resolved;
    } catch (error) {
      if (snapshotOpen) {
        await snapshotClient.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      snapshotClient.release();
    }
  }

  /**
   * Runs the set-based cohort resolver without reading or writing cache state.
   * Live callers must wrap this in a read-only transaction for a stable,
   * non-mutating shadow comparison.
   */
  async getReleasedCohortsShadow(
    inputs: OpportunityEvaluationInput[],
    snapshotId: string | null = null,
  ): Promise<Map<number, OpportunityReleasedCohort>> {
    const subjects = Array.from(
      new Map(
        inputs.map((input) => [input.appid, normalizeCohortInput(input)]),
      ).values(),
    );
    const rowsBySignature = await this.loadReleasedCohortRowsBatch(
      subjects,
      snapshotId,
    );
    return new Map(
      subjects.map((subject) => [
        subject.appid,
        releasedCohortFromRows(
          subject,
          rowsBySignature.get(subject.signatureKey) ?? [],
        ),
      ]),
    );
  }

  async refreshSignalWindows(
    appids: number[],
    options: {
      batchSize?: number;
      onBatch?: () => Promise<void>;
    } = {},
  ): Promise<number> {
    const bounded = Array.from(
      new Set(appids.filter((appid) => Number.isInteger(appid) && appid > 0)),
    ).slice(0, 50_000);
    if (bounded.length === 0) {
      return 0;
    }
    const stale = await this.pool.query<
      QueryResultRow & {
        appid: number;
      }
    >(
      `
        WITH input AS (
          SELECT DISTINCT ON (candidate.appid)
            candidate.appid,
            candidate.ordinality
          FROM unnest($1::integer[]) WITH ORDINALITY
            AS candidate(appid, ordinality)
          ORDER BY candidate.appid, candidate.ordinality
        )
        SELECT input.appid
        FROM input
        LEFT JOIN metrics.app_signal_windows_v1 signal
          ON signal.appid = input.appid
        LEFT JOIN ops.app_data_readiness readiness
          ON readiness.appid = input.appid
          AND readiness.source = 'market_metrics'
        WHERE signal.appid IS NULL
          OR signal.as_of_date < CURRENT_DATE - 1
          OR signal.calculation_version IS DISTINCT FROM 'signal-windows/v1'
          OR readiness.appid IS NULL
          OR readiness.version IS DISTINCT FROM 'signal-windows/v1'
        ORDER BY input.ordinality
      `,
      [bounded],
    );
    const staleAppids = stale.rows.map((row) => row.appid);
    if (staleAppids.length === 0) {
      return 0;
    }
    const batchSize = Math.max(
      1,
      Math.min(5_000, Math.floor(options.batchSize ?? 5_000)),
    );
    for (let offset = 0; offset < staleAppids.length; offset += batchSize) {
      await this.pool.query(
        `SELECT metrics.refresh_app_signal_windows_v1(CURRENT_DATE - 1, $1::integer[], 'signal-windows/v1')`,
        [staleAppids.slice(offset, offset + batchSize)],
      );
      await options.onBatch?.();
    }
    return staleAppids.length;
  }

  async getPresetHealthTargets(): Promise<OpportunityPresetHealthTarget[]> {
    const result = await this.pool.query<
      QueryResultRow & {
        id: string;
        rules: OpportunityRuleSet;
        slug: string;
      }
    >(
      `
        SELECT preset.id, preset.slug, version.rules
        FROM opportunity.presets preset
        JOIN opportunity.preset_versions version
          ON version.id = preset.current_version_id
        WHERE preset.editorial_status = 'published'
        ORDER BY preset.slug
        LIMIT 100
      `,
    );
    return result.rows;
  }

  async getPriorPresetHealth(
    presetId: string,
  ): Promise<OpportunityPriorPresetHealth> {
    const result = await this.pool.query<
      QueryResultRow & {
        consecutive_days: number;
        state: OpportunityPresetHealthState;
      }
    >(
      `
        SELECT state, consecutive_days
        FROM opportunity.preset_health_snapshots
        WHERE preset_id = $1
          AND health_version = 'opportunity-health/v1'
          AND as_of_date < CURRENT_DATE
        ORDER BY as_of_date DESC
        LIMIT 1
      `,
      [presetId],
    );
    return {
      consecutiveDays: result.rows[0]?.consecutive_days ?? 0,
      state: result.rows[0]?.state ?? null,
    };
  }

  async persistPresetHealth(params: {
    cohortDefinition: Record<string, unknown>;
    indicators: Record<string, unknown>;
    presetId: string;
    priorState: OpportunityPresetHealthState | null;
    snapshot: OpportunityPresetHealthSnapshot;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO opportunity.preset_health_snapshots (
          preset_id,
          as_of_date,
          health_version,
          state,
          prior_state,
          consecutive_days,
          cohort_definition,
          indicators,
          coverage,
          concentration,
          explanation
        )
        VALUES (
          $1,
          $2,
          'opportunity-health/v1',
          $3,
          $4,
          $5,
          $6::jsonb,
          $7::jsonb,
          $8::jsonb,
          $9::jsonb,
          $10::jsonb
        )
        ON CONFLICT (preset_id, as_of_date, health_version)
          WHERE preset_id IS NOT NULL
        DO UPDATE SET
          state = EXCLUDED.state,
          prior_state = EXCLUDED.prior_state,
          consecutive_days = EXCLUDED.consecutive_days,
          cohort_definition = EXCLUDED.cohort_definition,
          indicators = EXCLUDED.indicators,
          coverage = EXCLUDED.coverage,
          concentration = EXCLUDED.concentration,
          explanation = EXCLUDED.explanation,
          calculated_at = now()
      `,
      [
        params.presetId,
        params.snapshot.asOfDate,
        params.snapshot.state,
        params.priorState,
        params.snapshot.consecutiveDays,
        JSON.stringify(params.cohortDefinition),
        JSON.stringify(params.indicators),
        JSON.stringify({
          measuredGames: params.snapshot.measuredGames,
          ratio: params.snapshot.coverage,
        }),
        JSON.stringify({
          topContributorShare: params.snapshot.topContributorShare,
        }),
        JSON.stringify(params.snapshot.explanation),
      ],
    );
  }

  private async persistResultBatch(
    client: PoolClient,
    params: {
      results: OpportunityEvaluatedResult[];
      runId: string;
      userId: string;
      workspaceId: string;
    },
  ): Promise<number> {
    if (params.results.length === 0) {
      return 0;
    }
    const payload = params.results.map((result) => ({
      appid: result.appid,
      calculation_versions: {
        bulkPersistence: OPPORTUNITY_BULK_PERSISTENCE_VERSION,
        cohort: OPPORTUNITY_COHORT_VERSION,
        cohortCache: OPPORTUNITY_COHORT_CACHE_VERSION,
        cohortFeatureProjection: OPPORTUNITY_COHORT_FEATURE_PROJECTION_VERSION,
        cohortResolver: OPPORTUNITY_COHORT_RESOLVER_VERSION,
        market: OPPORTUNITY_MARKET_VERSION,
        materiality: "opportunity-materiality/v1",
        ranking: "opportunity-ranking/v1",
        ruleInputProjection: OPPORTUNITY_RULE_INPUT_PROJECTION_VERSION,
        rules: "opportunity-rules/v1",
        signals: "signal-windows/v1",
      },
      cohort: {
        ...result.cohort,
        measuredCount: result.cohort.members.filter(
          (member) => member.totalReviews !== null || member.ccuPeak !== null,
        ).length,
      },
      confidence: result.confidence,
      event_fingerprint: result.event.eventFingerprint,
      event_label: result.eventLabel,
      evidence_summary: {
        currentMetrics: Object.fromEntries(
          result.evidenceItems.map((item) => [
            String(item.label ?? "evidence"),
            item.value ?? null,
          ]),
        ),
        items: result.evidenceItems,
        strongest: result.strongestEvidence,
      },
      market: result.market,
      matches: result.matches.map((match) => ({
        delivery_urgency: match.profile.immediateFullMatchEnabled
          ? "immediate"
          : "daily",
        preference_score: match.evaluation.preferenceContribution,
        profile_id: match.profile.id,
        profile_version_id: match.profile.versionId,
        rule_outcomes: match.evaluation,
      })),
      material_event_id: result.event.id,
      missing_evidence: result.missingEvidence,
      profile_version_set_fingerprint: result.profileVersionSetFingerprint,
      rank_components: {
        ...result.rank.components,
        reasons: result.rank.reasons,
        weights: result.rank.weights,
      },
      reappeared_after_result_id: result.reappearedAfterResultId,
      rule_evidence: Object.fromEntries(
        result.matches.map((match) => [
          match.profile.versionId,
          match.evaluation,
        ]),
      ),
      score: result.rank.finalScore,
      source_timestamps: result.sourceTimestamps,
      why_now: { summary: result.whyNow },
    }));
    const inserted = await client.query<
      QueryResultRow & { created_count: string | number }
    >(
      `
        WITH payload AS MATERIALIZED (
          SELECT *
          FROM jsonb_to_recordset($4::jsonb) AS result(
            appid integer,
            calculation_versions jsonb,
            cohort jsonb,
            confidence text,
            event_fingerprint text,
            event_label text,
            evidence_summary jsonb,
            market jsonb,
            matches jsonb,
            material_event_id uuid,
            missing_evidence jsonb,
            profile_version_set_fingerprint text,
            rank_components jsonb,
            reappeared_after_result_id uuid,
            rule_evidence jsonb,
            score numeric,
            source_timestamps jsonb,
            why_now jsonb
          )
        ),
        cohort_rows AS (
          INSERT INTO opportunity.cohort_snapshots (
            run_id,
            appid,
            cohort_kind,
            cohort_version,
            signature,
            fallback_tier,
            member_count,
            measured_count,
            coverage,
            members,
            source_at
          )
          SELECT
            $1,
            payload.appid,
            'released_market',
            $5,
            payload.cohort->'signature',
            (payload.cohort->>'fallbackTier')::smallint,
            jsonb_array_length(payload.cohort->'members'),
            (payload.cohort->>'measuredCount')::integer,
            (payload.cohort->>'coverage')::numeric,
            payload.cohort->'members',
            NULLIF(payload.cohort->>'sourceAt', '')::timestamptz
          FROM payload
          ON CONFLICT (run_id, appid, cohort_kind)
          DO UPDATE SET
            signature = EXCLUDED.signature,
            fallback_tier = EXCLUDED.fallback_tier,
            member_count = EXCLUDED.member_count,
            measured_count = EXCLUDED.measured_count,
            coverage = EXCLUDED.coverage,
            members = EXCLUDED.members,
            source_at = EXCLUDED.source_at
          RETURNING id, appid
        ),
        market_rows AS (
          INSERT INTO opportunity.market_context_snapshots (
            run_id,
            appid,
            cohort_snapshot_id,
            calculation_version,
            distributions,
            demand_direction,
            supply,
            concentration,
            potential_band,
            confidence,
            explanation,
            source_at
          )
          SELECT
            $1,
            payload.appid,
            cohort_rows.id,
            $6,
            payload.market->'distributions',
            jsonb_build_object(
              'state',
              payload.market->>'demandDirection'
            ),
            payload.market->'supply',
            payload.market->'concentration',
            payload.market->>'potentialBand',
            payload.market->>'confidence',
            payload.market->'explanation',
            NULLIF(payload.cohort->>'sourceAt', '')::timestamptz
          FROM payload
          JOIN cohort_rows USING (appid)
          ON CONFLICT (run_id, appid)
          DO UPDATE SET
            distributions = EXCLUDED.distributions,
            demand_direction = EXCLUDED.demand_direction,
            supply = EXCLUDED.supply,
            concentration = EXCLUDED.concentration,
            potential_band = EXCLUDED.potential_band,
            confidence = EXCLUDED.confidence,
            explanation = EXCLUDED.explanation,
            source_at = EXCLUDED.source_at
          RETURNING id, appid
        ),
        inserted_results AS (
          INSERT INTO opportunity.results (
            run_id,
            workspace_id,
            user_id,
            appid,
            material_event_id,
            event_label,
            event_fingerprint,
            profile_version_set_fingerprint,
            score,
            rank_components,
            rule_evidence,
            why_now,
            evidence_summary,
            source_timestamps,
            calculation_versions,
            missing_evidence,
            confidence,
            cohort_snapshot_id,
            market_context_snapshot_id,
            reappeared_after_result_id
          )
          SELECT
            $1,
            $2,
            $3,
            payload.appid,
            payload.material_event_id,
            payload.event_label,
            payload.event_fingerprint,
            payload.profile_version_set_fingerprint,
            payload.score,
            payload.rank_components,
            payload.rule_evidence,
            payload.why_now,
            payload.evidence_summary,
            payload.source_timestamps,
            payload.calculation_versions,
            payload.missing_evidence,
            payload.confidence,
            cohort_rows.id,
            market_rows.id,
            payload.reappeared_after_result_id
          FROM payload
          JOIN cohort_rows USING (appid)
          JOIN market_rows USING (appid)
          ON CONFLICT (
            user_id,
            appid,
            event_fingerprint,
            profile_version_set_fingerprint
          )
          DO NOTHING
          RETURNING id, appid, event_fingerprint
        ),
        dismissal_resets AS (
          UPDATE opportunity.user_game_state state
          SET dismissed_at = NULL,
              dismissed_event_fingerprint = NULL,
              updated_at = now()
          FROM inserted_results inserted
          WHERE state.workspace_id = $2
            AND state.user_id = $3
            AND state.appid = inserted.appid
            AND state.dismissed_event_fingerprint IS NOT NULL
            AND state.dismissed_event_fingerprint
              <> inserted.event_fingerprint
          RETURNING state.appid
        ),
        inserted_matches AS (
          INSERT INTO opportunity.result_profile_matches (
            result_id,
            profile_id,
            profile_version_id,
            eligibility_outcome,
            rule_outcomes,
            preference_score,
            delivery_urgency
          )
          SELECT
            inserted.id,
            match.profile_id,
            match.profile_version_id,
            'eligible',
            match.rule_outcomes,
            match.preference_score,
            match.delivery_urgency
          FROM inserted_results inserted
          JOIN payload USING (appid)
          CROSS JOIN LATERAL jsonb_to_recordset(payload.matches) AS match(
            delivery_urgency text,
            preference_score numeric,
            profile_id uuid,
            profile_version_id uuid,
            rule_outcomes jsonb
          )
          ON CONFLICT (result_id, profile_version_id) DO NOTHING
          RETURNING result_id
        )
        SELECT count(*) AS created_count
        FROM inserted_results
      `,
      [
        params.runId,
        params.workspaceId,
        params.userId,
        JSON.stringify(payload),
        OPPORTUNITY_COHORT_VERSION,
        OPPORTUNITY_MARKET_VERSION,
      ],
    );
    return Number(inserted.rows[0]?.created_count ?? 0);
  }

  private async persistCandidateBatch(
    client: PoolClient,
    params: {
      candidates: OpportunityCandidateEvaluation[];
      userId: string;
      workspaceId: string;
    },
  ): Promise<void> {
    if (params.candidates.length === 0) {
      return;
    }
    const payload = params.candidates.map((candidate) => ({
      appid: candidate.appid,
      last_outcome: candidate.evaluation,
      material_event_id: candidate.eventId,
      missing_fields: candidate.evaluation.missingRequiredFields,
      profile_version_id: candidate.profile.versionId,
      state:
        candidate.evaluation.outcome === "pending"
          ? "pending_readiness"
          : candidate.evaluation.outcome,
    }));
    await client.query(
      `
        INSERT INTO opportunity.candidate_state (
          workspace_id,
          user_id,
          appid,
          profile_version_id,
          material_event_id,
          state,
          missing_fields,
          first_pending_at,
          readiness_deadline,
          next_evaluation_at,
          last_evaluated_at,
          last_outcome
        )
        SELECT
          $1,
          $2,
          candidate.appid,
          candidate.profile_version_id,
          candidate.material_event_id,
          candidate.state,
          candidate.missing_fields,
          CASE
            WHEN candidate.state = 'pending_readiness' THEN now()
            ELSE NULL
          END,
          CASE
            WHEN candidate.state = 'pending_readiness'
              THEN now() + interval '72 hours'
            ELSE NULL
          END,
          CASE
            WHEN candidate.state = 'pending_readiness'
              THEN now() + interval '30 minutes'
            ELSE NULL
          END,
          now(),
          candidate.last_outcome
        FROM jsonb_to_recordset($3::jsonb) AS candidate(
          appid integer,
          last_outcome jsonb,
          material_event_id uuid,
          missing_fields text[],
          profile_version_id uuid,
          state text
        )
        ON CONFLICT (user_id, appid, profile_version_id)
        DO UPDATE SET
          material_event_id = EXCLUDED.material_event_id,
          state = CASE
            WHEN EXCLUDED.state = 'pending_readiness'
              AND opportunity.candidate_state.readiness_deadline <= now()
              THEN 'readiness_expired'
            ELSE EXCLUDED.state
          END,
          missing_fields = EXCLUDED.missing_fields,
          first_pending_at = CASE
            WHEN EXCLUDED.state = 'pending_readiness'
              THEN COALESCE(
                opportunity.candidate_state.first_pending_at,
                EXCLUDED.first_pending_at
              )
            ELSE NULL
          END,
          readiness_deadline = CASE
            WHEN EXCLUDED.state = 'pending_readiness'
              THEN COALESCE(
                opportunity.candidate_state.readiness_deadline,
                EXCLUDED.readiness_deadline
              )
            ELSE NULL
          END,
          next_evaluation_at = CASE
            WHEN EXCLUDED.state <> 'pending_readiness' THEN NULL
            WHEN opportunity.candidate_state.readiness_deadline <= now()
              THEN NULL
            ELSE now() + interval '30 minutes'
          END,
          last_evaluated_at = now(),
          last_outcome = EXCLUDED.last_outcome,
          updated_at = now()
      `,
      [params.workspaceId, params.userId, JSON.stringify(payload)],
    );
  }

  async persistRunOutcomeLegacy(params: {
    evaluations: OpportunityCandidateEvaluation[];
    pending: OpportunityPendingEvaluation[];
    results: OpportunityEvaluatedResult[];
    run: OpportunityRunContext;
    userId: string;
    workId: number;
    workerId: string;
    workspaceId: string;
    websiteBaseUrl: string;
  }): Promise<void> {
    await this.transaction(async (client) => {
      let createdResults = 0;
      for (const result of params.results) {
        const cohort = await client.query<QueryResultRow & { id: string }>(
          `
            INSERT INTO opportunity.cohort_snapshots (
              run_id,
              appid,
              cohort_kind,
              cohort_version,
              signature,
              fallback_tier,
              member_count,
              measured_count,
              coverage,
              members,
              source_at
            )
            VALUES (
              $1,
              $2,
              'released_market',
              'opportunity-cohort/v1',
              $3::jsonb,
              $4,
              $5,
              $6,
              $7,
              $8::jsonb,
              $9
            )
            ON CONFLICT (run_id, appid, cohort_kind)
            DO UPDATE SET
              signature = EXCLUDED.signature,
              fallback_tier = EXCLUDED.fallback_tier,
              member_count = EXCLUDED.member_count,
              measured_count = EXCLUDED.measured_count,
              coverage = EXCLUDED.coverage,
              members = EXCLUDED.members,
              source_at = EXCLUDED.source_at
            RETURNING id
          `,
          [
            params.run.id,
            result.appid,
            JSON.stringify(result.cohort.signature),
            result.cohort.fallbackTier,
            result.cohort.members.length,
            result.cohort.members.filter(
              (member) =>
                member.totalReviews !== null || member.ccuPeak !== null,
            ).length,
            result.cohort.coverage,
            JSON.stringify(result.cohort.members),
            result.cohort.sourceAt,
          ],
        );
        const cohortId = cohort.rows[0]!.id;
        const market = await client.query<QueryResultRow & { id: string }>(
          `
            INSERT INTO opportunity.market_context_snapshots (
              run_id,
              appid,
              cohort_snapshot_id,
              calculation_version,
              distributions,
              demand_direction,
              supply,
              concentration,
              potential_band,
              confidence,
              explanation,
              source_at
            )
            VALUES (
              $1,
              $2,
              $3,
              'opportunity-market/v1',
              $4::jsonb,
              $5::jsonb,
              $6::jsonb,
              $7::jsonb,
              $8,
              $9,
              $10::jsonb,
              $11
            )
            ON CONFLICT (run_id, appid)
            DO UPDATE SET
              distributions = EXCLUDED.distributions,
              demand_direction = EXCLUDED.demand_direction,
              supply = EXCLUDED.supply,
              concentration = EXCLUDED.concentration,
              potential_band = EXCLUDED.potential_band,
              confidence = EXCLUDED.confidence,
              explanation = EXCLUDED.explanation,
              source_at = EXCLUDED.source_at
            RETURNING id
          `,
          [
            params.run.id,
            result.appid,
            cohortId,
            JSON.stringify(result.market.distributions),
            JSON.stringify({ state: result.market.demandDirection }),
            JSON.stringify(result.market.supply),
            JSON.stringify(result.market.concentration),
            result.market.potentialBand,
            result.market.confidence,
            JSON.stringify(result.market.explanation),
            result.cohort.sourceAt,
          ],
        );
        const marketId = market.rows[0]!.id;
        const ruleEvidence = Object.fromEntries(
          result.matches.map((match) => [
            match.profile.versionId,
            match.evaluation,
          ]),
        );
        const inserted = await client.query<QueryResultRow & { id: string }>(
          `
            INSERT INTO opportunity.results (
              run_id,
              workspace_id,
              user_id,
              appid,
              material_event_id,
              event_label,
              event_fingerprint,
              profile_version_set_fingerprint,
              score,
              rank_components,
              rule_evidence,
              why_now,
              evidence_summary,
              source_timestamps,
              calculation_versions,
              missing_evidence,
              confidence,
              cohort_snapshot_id,
              market_context_snapshot_id,
              reappeared_after_result_id
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
              $9,
              $10::jsonb,
              $11::jsonb,
              $12::jsonb,
              $13::jsonb,
              $14::jsonb,
              $15::jsonb,
              $16::jsonb,
              $17,
              $18,
              $19,
              $20
            )
            ON CONFLICT (
              user_id,
              appid,
              event_fingerprint,
              profile_version_set_fingerprint
            )
            DO NOTHING
            RETURNING id
          `,
          [
            params.run.id,
            params.workspaceId,
            params.userId,
            result.appid,
            result.event.id,
            result.eventLabel,
            result.event.eventFingerprint,
            result.profileVersionSetFingerprint,
            result.rank.finalScore,
            JSON.stringify({
              ...result.rank.components,
              reasons: result.rank.reasons,
              weights: result.rank.weights,
            }),
            JSON.stringify(ruleEvidence),
            JSON.stringify({ summary: result.whyNow }),
            JSON.stringify({
              currentMetrics: Object.fromEntries(
                result.evidenceItems.map((item) => [
                  String(item.label ?? "evidence"),
                  item.value ?? null,
                ]),
              ),
              items: result.evidenceItems,
              strongest: result.strongestEvidence,
            }),
            JSON.stringify(result.sourceTimestamps),
            JSON.stringify({
              cohort: "opportunity-cohort/v1",
              market: "opportunity-market/v1",
              materiality: "opportunity-materiality/v1",
              ranking: "opportunity-ranking/v1",
              rules: "opportunity-rules/v1",
              signals: "signal-windows/v1",
            }),
            JSON.stringify(result.missingEvidence),
            result.confidence,
            cohortId,
            marketId,
            result.reappearedAfterResultId,
          ],
        );
        const resultId = inserted.rows[0]?.id;
        if (!resultId) {
          continue;
        }
        createdResults += 1;
        await client.query(
          `
            UPDATE opportunity.user_game_state
            SET dismissed_at = NULL,
                dismissed_event_fingerprint = NULL,
                updated_at = now()
            WHERE workspace_id = $1
              AND user_id = $2
              AND appid = $3
              AND dismissed_event_fingerprint IS NOT NULL
              AND dismissed_event_fingerprint <> $4
          `,
          [
            params.workspaceId,
            params.userId,
            result.appid,
            result.event.eventFingerprint,
          ],
        );
        for (const match of result.matches) {
          await client.query(
            `
              INSERT INTO opportunity.result_profile_matches (
                result_id,
                profile_id,
                profile_version_id,
                eligibility_outcome,
                rule_outcomes,
                preference_score,
                delivery_urgency
              )
              VALUES ($1, $2, $3, 'eligible', $4::jsonb, $5, $6)
              ON CONFLICT (result_id, profile_version_id) DO NOTHING
            `,
            [
              resultId,
              match.profile.id,
              match.profile.versionId,
              JSON.stringify(match.evaluation),
              match.evaluation.preferenceContribution,
              match.profile.immediateFullMatchEnabled ? "immediate" : "daily",
            ],
          );
        }
      }

      for (const candidate of params.evaluations) {
        const candidateState =
          candidate.evaluation.outcome === "pending"
            ? "pending_readiness"
            : candidate.evaluation.outcome;
        await client.query(
          `
            INSERT INTO opportunity.candidate_state (
              workspace_id,
              user_id,
              appid,
              profile_version_id,
              material_event_id,
              state,
              missing_fields,
              first_pending_at,
              readiness_deadline,
              next_evaluation_at,
              last_evaluated_at,
              last_outcome
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7::text[],
              CASE WHEN $6 = 'pending_readiness' THEN now() ELSE NULL END,
              CASE
                WHEN $6 = 'pending_readiness' THEN now() + interval '72 hours'
                ELSE NULL
              END,
              CASE
                WHEN $6 = 'pending_readiness' THEN now() + interval '30 minutes'
                ELSE NULL
              END,
              now(),
              $8::jsonb
            )
            ON CONFLICT (user_id, appid, profile_version_id)
            DO UPDATE SET
              material_event_id = EXCLUDED.material_event_id,
              state = CASE
                WHEN EXCLUDED.state = 'pending_readiness'
                  AND opportunity.candidate_state.readiness_deadline <= now()
                  THEN 'readiness_expired'
                ELSE EXCLUDED.state
              END,
              missing_fields = EXCLUDED.missing_fields,
              first_pending_at = CASE
                WHEN EXCLUDED.state = 'pending_readiness'
                  THEN COALESCE(
                    opportunity.candidate_state.first_pending_at,
                    EXCLUDED.first_pending_at
                  )
                ELSE NULL
              END,
              readiness_deadline = CASE
                WHEN EXCLUDED.state = 'pending_readiness'
                  THEN COALESCE(
                    opportunity.candidate_state.readiness_deadline,
                    EXCLUDED.readiness_deadline
                  )
                ELSE NULL
              END,
              next_evaluation_at = CASE
                WHEN EXCLUDED.state <> 'pending_readiness' THEN NULL
                WHEN opportunity.candidate_state.readiness_deadline <= now()
                  THEN NULL
                ELSE now() + interval '30 minutes'
              END,
              last_evaluated_at = now(),
              last_outcome = EXCLUDED.last_outcome,
              updated_at = now()
          `,
          [
            params.workspaceId,
            params.userId,
            candidate.appid,
            candidate.profile.versionId,
            candidate.eventId,
            candidateState,
            candidate.evaluation.missingRequiredFields,
            JSON.stringify(candidate.evaluation),
          ],
        );
      }

      await client.query(
        `
          WITH ranked AS (
            SELECT
              id,
              row_number() OVER (
                ORDER BY score DESC NULLS LAST, appid, id
              ) AS rank
            FROM opportunity.results
            WHERE run_id = $1
              AND user_id = $2
          )
          UPDATE opportunity.results result
          SET rank = ranked.rank
          FROM ranked
          WHERE result.id = ranked.id
        `,
        [params.run.id, params.userId],
      );

      const resultIds = await client.query<
        QueryResultRow & { id: string; profile_ids: string[] }
      >(
        `
          SELECT
            result.id,
            COALESCE(
              array_agg(DISTINCT match.profile_id)
                FILTER (WHERE match.profile_id IS NOT NULL),
              '{}'::uuid[]
            ) AS profile_ids
          FROM opportunity.results result
          LEFT JOIN opportunity.result_profile_matches match
            ON match.result_id = result.id
          WHERE result.user_id = $2
            AND (
              result.run_id = $1
              OR (
                $3::text = 'daily'
                AND result.created_at >= $4
                AND result.created_at < $5
              )
            )
          GROUP BY result.id
          ORDER BY
            result.score DESC NULLS LAST,
            result.appid,
            result.id
          LIMIT 500
        `,
        [
          params.run.id,
          params.userId,
          params.run.kind,
          params.run.windowStart,
          params.run.windowEnd,
        ],
      );
      const preferences = await client.query<
        QueryResultRow & {
          channel: "email" | "slack";
          id: string;
          max_results: number;
          profile_id: string | null;
          quiet_day_behavior: "skip" | "send_empty";
        }
      >(
        `
          SELECT
            id,
            profile_id,
            channel,
            max_results,
            quiet_day_behavior
          FROM opportunity.channel_preferences
          WHERE workspace_id = $1
            AND user_id = $2
            AND channel IN ('email', 'slack')
            AND enabled
            AND ($3::boolean = false OR immediate_full_match_enabled)
            AND $4::boolean
          ORDER BY channel, profile_id NULLS LAST, id
          LIMIT 100
        `,
        [
          params.workspaceId,
          params.userId,
          params.run.kind === "immediate",
          params.run.kind !== "readiness",
        ],
      );
      const assignments = assignOpportunityDeliveryResults(
        resultIds.rows.map((row) => ({
          id: row.id,
          profileIds: row.profile_ids,
        })),
        preferences.rows.map((preference) => ({
          channel: preference.channel,
          id: preference.id,
          maxResults: preference.max_results,
          profileId: preference.profile_id,
        })),
      );
      for (const preference of preferences.rows) {
        const assignment = assignments.get(preference.id) ?? {
          availableResultCount: 0,
          resultIds: [],
        };
        const selectedIds = assignment.resultIds;
        const shouldSkip =
          selectedIds.length === 0 && preference.quiet_day_behavior === "skip";
        await client.query(
          `
            INSERT INTO opportunity.deliveries (
              run_id,
              workspace_id,
              user_id,
              channel,
              delivery_kind,
              status,
              result_ids,
              preference_id,
              rendered_content_version,
              rendered_payload,
              idempotency_key
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7::uuid[],
              $8,
              'opportunity-digest/v1',
              $9::jsonb,
              $10
            )
            ON CONFLICT (idempotency_key) DO NOTHING
          `,
          [
            params.run.id,
            params.workspaceId,
            params.userId,
            preference.channel,
            params.run.kind === "immediate"
              ? "immediate_full_match"
              : "daily_digest",
            shouldSkip ? "skipped" : "pending",
            selectedIds,
            preference.id,
            JSON.stringify({
              availableResultCount: assignment.availableResultCount,
              canonicalOverviewUrl: `${params.websiteBaseUrl.replace(/\/$/, "")}/opportunities?run=${params.run.id}`,
              resultCount: selectedIds.length,
              truncated: assignment.availableResultCount > selectedIds.length,
              windowEnd: params.run.windowEnd,
              windowStart: params.run.windowStart,
            }),
            params.run.kind === "immediate"
              ? `immediate:${resultIds.rows[0]?.id ?? params.run.id}:${preference.id}`
              : `daily:${params.run.id}:${preference.id}`,
          ],
        );
      }

      await client.query(
        `
          UPDATE opportunity.runs
          SET status = 'completed',
              candidate_count = $2,
              evaluated_count = $3,
              result_count = $4,
              pending_count = $5,
              coverage_warnings = $6::jsonb,
              completed_at = now()
          WHERE id = $1
            AND status = 'running'
        `,
        [
          params.run.id,
          new Set([
            ...params.results.map((result) => result.appid),
            ...params.pending.map((pending) => pending.appid),
          ]).size,
          params.results.length + params.pending.length,
          createdResults,
          params.pending.length,
          JSON.stringify(
            params.pending.length > 0
              ? [
                  `${params.pending.length} profile evaluations are waiting for required source data.`,
                ]
              : [],
          ),
        ],
      );
      await client.query(
        `
          WITH personal_schedule AS (
            SELECT timezone, local_delivery_time
            FROM opportunity.profiles
            WHERE workspace_id = $1
              AND owner_user_id = $2
              AND status = 'enabled'
            ORDER BY next_evaluation_at NULLS LAST, id
            LIMIT 1
          )
          UPDATE opportunity.profiles profile
          SET timezone = personal_schedule.timezone,
              local_delivery_time = personal_schedule.local_delivery_time,
              next_evaluation_at = opportunity.next_profile_evaluation_v1(
                personal_schedule.timezone,
                personal_schedule.local_delivery_time,
                now()
              ),
              updated_at = now()
          FROM personal_schedule
          WHERE profile.workspace_id = $1
            AND profile.owner_user_id = $2
            AND profile.status = 'enabled'
            AND $3::boolean
        `,
        [
          params.workspaceId,
          params.userId,
          ["daily", "manual", "replay"].includes(params.run.kind),
        ],
      );
      await client.query(
        `
          UPDATE opportunity.work_queue
          SET state = 'completed',
              completed_at = now(),
              claim_expires_at = NULL,
              heartbeat_at = now(),
              updated_at = now()
          WHERE id = $1
            AND worker_id = $2
            AND state = 'claimed'
        `,
        [params.workId, params.workerId],
      );
    });
  }

  async persistRunOutcome(params: {
    evaluations: OpportunityCandidateEvaluation[];
    pending: OpportunityPendingEvaluation[];
    phaseTimings: Omit<
      OpportunityWorkerPhaseTimings,
      "persistenceMs" | "totalMs"
    >;
    results: OpportunityEvaluatedResult[];
    run: OpportunityRunContext;
    userId: string;
    workId: number;
    workerId: string;
    workspaceId: string;
    websiteBaseUrl: string;
  }): Promise<OpportunityWorkerPhaseTimings> {
    const persistenceStartedAt = performance.now();
    let completedTimings: OpportunityWorkerPhaseTimings | null = null;
    await this.transaction(async (client) => {
      let createdResults = 0;
      for (
        let offset = 0;
        offset < params.results.length;
        offset += RESULT_PERSISTENCE_BATCH_SIZE
      ) {
        createdResults += await this.persistResultBatch(client, {
          results: params.results.slice(
            offset,
            offset + RESULT_PERSISTENCE_BATCH_SIZE,
          ),
          runId: params.run.id,
          userId: params.userId,
          workspaceId: params.workspaceId,
        });
      }
      for (
        let offset = 0;
        offset < params.evaluations.length;
        offset += CANDIDATE_PERSISTENCE_BATCH_SIZE
      ) {
        await this.persistCandidateBatch(client, {
          candidates: params.evaluations.slice(
            offset,
            offset + CANDIDATE_PERSISTENCE_BATCH_SIZE,
          ),
          userId: params.userId,
          workspaceId: params.workspaceId,
        });
      }

      await client.query(
        `
          WITH ranked AS (
            SELECT
              id,
              row_number() OVER (
                ORDER BY score DESC NULLS LAST, appid, id
              ) AS rank
            FROM opportunity.results
            WHERE run_id = $1
              AND user_id = $2
          )
          UPDATE opportunity.results result
          SET rank = ranked.rank
          FROM ranked
          WHERE result.id = ranked.id
        `,
        [params.run.id, params.userId],
      );

      const resultIds = await client.query<
        QueryResultRow & { id: string; profile_ids: string[] }
      >(
        `
          SELECT
            result.id,
            COALESCE(
              array_agg(DISTINCT match.profile_id)
                FILTER (WHERE match.profile_id IS NOT NULL),
              '{}'::uuid[]
            ) AS profile_ids
          FROM opportunity.results result
          LEFT JOIN opportunity.result_profile_matches match
            ON match.result_id = result.id
          WHERE result.user_id = $2
            AND (
              result.run_id = $1
              OR (
                $3::text = 'daily'
                AND result.created_at >= $4
                AND result.created_at < $5
              )
            )
          GROUP BY result.id
          ORDER BY
            result.score DESC NULLS LAST,
            result.appid,
            result.id
          LIMIT 500
        `,
        [
          params.run.id,
          params.userId,
          params.run.kind,
          params.run.windowStart,
          params.run.windowEnd,
        ],
      );
      const preferences = await client.query<
        QueryResultRow & {
          channel: "email" | "slack";
          id: string;
          max_results: number;
          profile_id: string | null;
          quiet_day_behavior: "skip" | "send_empty";
        }
      >(
        `
          SELECT
            id,
            profile_id,
            channel,
            max_results,
            quiet_day_behavior
          FROM opportunity.channel_preferences
          WHERE workspace_id = $1
            AND user_id = $2
            AND channel IN ('email', 'slack')
            AND enabled
            AND ($3::boolean = false OR immediate_full_match_enabled)
            AND $4::boolean
          ORDER BY channel, profile_id NULLS LAST, id
          LIMIT 100
        `,
        [
          params.workspaceId,
          params.userId,
          params.run.kind === "immediate",
          params.run.kind !== "readiness",
        ],
      );
      const assignments = assignOpportunityDeliveryResults(
        resultIds.rows.map((row) => ({
          id: row.id,
          profileIds: row.profile_ids,
        })),
        preferences.rows.map((preference) => ({
          channel: preference.channel,
          id: preference.id,
          maxResults: preference.max_results,
          profileId: preference.profile_id,
        })),
      );
      const deliveryPayload = preferences.rows.map((preference) => {
        const assignment = assignments.get(preference.id) ?? {
          availableResultCount: 0,
          resultIds: [],
        };
        const shouldSkip =
          assignment.resultIds.length === 0 &&
          preference.quiet_day_behavior === "skip";
        return {
          channel: preference.channel,
          delivery_kind:
            params.run.kind === "immediate"
              ? "immediate_full_match"
              : "daily_digest",
          idempotency_key:
            params.run.kind === "immediate"
              ? `immediate:${resultIds.rows[0]?.id ?? params.run.id}:${preference.id}`
              : `daily:${params.run.id}:${preference.id}`,
          preference_id: preference.id,
          rendered_payload: {
            availableResultCount: assignment.availableResultCount,
            canonicalOverviewUrl: `${params.websiteBaseUrl.replace(/\/$/, "")}/opportunities?run=${params.run.id}`,
            resultCount: assignment.resultIds.length,
            truncated:
              assignment.availableResultCount > assignment.resultIds.length,
            windowEnd: params.run.windowEnd,
            windowStart: params.run.windowStart,
          },
          result_ids: assignment.resultIds,
          status: shouldSkip ? "skipped" : "pending",
        };
      });
      if (deliveryPayload.length > 0) {
        await client.query(
          `
            INSERT INTO opportunity.deliveries (
              run_id,
              workspace_id,
              user_id,
              channel,
              delivery_kind,
              status,
              result_ids,
              preference_id,
              rendered_content_version,
              rendered_payload,
              idempotency_key
            )
            SELECT
              $1,
              $2,
              $3,
              delivery.channel,
              delivery.delivery_kind,
              delivery.status,
              delivery.result_ids,
              delivery.preference_id,
              'opportunity-digest/v1',
              delivery.rendered_payload,
              delivery.idempotency_key
            FROM jsonb_to_recordset($4::jsonb) AS delivery(
              channel text,
              delivery_kind text,
              status text,
              result_ids uuid[],
              preference_id uuid,
              rendered_payload jsonb,
              idempotency_key text
            )
            ON CONFLICT (idempotency_key) DO NOTHING
          `,
          [
            params.run.id,
            params.workspaceId,
            params.userId,
            JSON.stringify(deliveryPayload),
          ],
        );
      }

      await client.query(
        `
          WITH personal_schedule AS (
            SELECT timezone, local_delivery_time
            FROM opportunity.profiles
            WHERE workspace_id = $1
              AND owner_user_id = $2
              AND status = 'enabled'
            ORDER BY next_evaluation_at NULLS LAST, id
            LIMIT 1
          )
          UPDATE opportunity.profiles profile
          SET timezone = personal_schedule.timezone,
              local_delivery_time = personal_schedule.local_delivery_time,
              next_evaluation_at = opportunity.next_profile_evaluation_v1(
                personal_schedule.timezone,
                personal_schedule.local_delivery_time,
                now()
              ),
              updated_at = now()
          FROM personal_schedule
          WHERE profile.workspace_id = $1
            AND profile.owner_user_id = $2
            AND profile.status = 'enabled'
            AND $3::boolean
        `,
        [
          params.workspaceId,
          params.userId,
          ["daily", "manual", "replay"].includes(params.run.kind),
        ],
      );
      await client.query(
        `
          UPDATE opportunity.work_queue
          SET state = 'completed',
              completed_at = now(),
              claim_expires_at = NULL,
              heartbeat_at = now(),
              updated_at = now()
          WHERE id = $1
            AND worker_id = $2
            AND state = 'claimed'
        `,
        [params.workId, params.workerId],
      );

      const persistenceMs = performance.now() - persistenceStartedAt;
      completedTimings = {
        ...params.phaseTimings,
        persistenceMs,
        totalMs:
          params.phaseTimings.inputPreparationMs +
          params.phaseTimings.profileEvaluationMs +
          params.phaseTimings.cohortResolutionMs +
          params.phaseTimings.marketCalculationMs +
          persistenceMs,
      };
      await client.query(
        `
          UPDATE opportunity.runs
          SET status = 'completed',
              candidate_count = $2,
              evaluated_count = $3,
              result_count = $4,
              pending_count = $5,
              coverage_warnings = $6::jsonb,
              phase_timings = $7::jsonb,
              completed_at = now()
          WHERE id = $1
            AND status = 'running'
        `,
        [
          params.run.id,
          new Set([
            ...params.results.map((result) => result.appid),
            ...params.pending.map((pending) => pending.appid),
          ]).size,
          params.results.length + params.pending.length,
          createdResults,
          params.pending.length,
          JSON.stringify(
            params.pending.length > 0
              ? [
                  `${params.pending.length} profile evaluations are waiting for required source data.`,
                ]
              : [],
          ),
          JSON.stringify(completedTimings),
        ],
      );
    });
    if (!completedTimings) {
      throw new Error(
        "Opportunity bulk persistence completed without phase timings.",
      );
    }
    return completedTimings;
  }
}
