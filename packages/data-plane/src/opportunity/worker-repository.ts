import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  groupOpportunitySourceEvents,
  type OpportunityMaterialMoment,
  type OpportunitySourceEvent,
} from "./material-events.js";
import type {
  OpportunityCohortMember,
  OpportunityEvaluationInput,
  OpportunityMarketContext,
  OpportunityProfileEvaluation,
  OpportunityRankingEvidence,
  OpportunityResultLabel,
  OpportunityRuleSet,
  OpportunitySignalFamily,
  OpportunityPresetHealthSnapshot,
  OpportunityPresetHealthState,
} from "./types.js";
import { OPPORTUNITY_MATERIALITY_VERSION } from "./types.js";
import { OpportunityRepository } from "./repository.js";

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
  appid: number;
  createsDailyResult: boolean;
  effectiveAt: string;
  eligibleForImmediate: boolean;
  eventFingerprint: string;
  eventType: string;
  id: string;
  materiality: number;
  observedAt: string;
  reevaluateEligibility: boolean;
  signalFamily: OpportunitySignalFamily;
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
  kind: "daily" | "immediate" | "manual" | "replay";
  windowEnd: string;
  windowStart: string;
}

export interface OpportunityEvaluatedMatch {
  evaluation: OpportunityProfileEvaluation;
  profile: OpportunityWorkerProfile;
}

export interface OpportunityEvaluatedResult {
  appid: number;
  cohort: {
    confidence: "high" | "directional";
    coverage: number;
    fallbackTier: 1 | 2 | 3 | 4 | 5;
    members: OpportunityCohortMember[];
    signature: Record<string, unknown>;
    sourceAt: string | null;
  };
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
          WHERE eligible.lane_rank <= GREATEST(1, CEIL($2::numeric / 4))
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

  async materializeEvents(): Promise<number> {
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
          LIMIT 2000
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
          LIMIT 2000
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
          LIMIT 4000
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
      for (const moment of moments) {
        const inserted = await this.insertMaterialMoment(client, moment);
        if (!inserted) {
          continue;
        }
        if (moment.eligibleForImmediate) {
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
                $1,
                $2,
                1000,
                'event:' || $2 || ':user:' || profile.owner_user_id,
                jsonb_build_object('eventFingerprint', $3)
              FROM opportunity.profiles profile
              WHERE profile.status = 'enabled'
                AND profile.immediate_full_match_enabled
              ON CONFLICT (idempotency_key) DO NOTHING
            `,
            [moment.appid, inserted, moment.eventFingerprint],
          );
        } else if (moment.reevaluateEligibility) {
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
                $1,
                $2,
                300,
                'event:' || $2 || ':readiness:' || candidate.user_id,
                jsonb_build_object('eventFingerprint', $3)
              FROM opportunity.candidate_state candidate
              WHERE candidate.appid = $1
                AND candidate.state = 'pending_readiness'
              ON CONFLICT (idempotency_key) DO NOTHING
            `,
            [moment.appid, inserted, moment.eventFingerprint],
          );
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
    kind: "daily" | "immediate" | "manual" | "replay";
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
          cohort: "opportunity-cohort/v1",
          health: "opportunity-health/v1",
          market: "opportunity-market/v1",
          materiality: "opportunity-materiality/v1",
          ranking: "opportunity-ranking/v1",
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
        creates_daily_result: boolean;
        effective_at: Date | string;
        eligible_for_immediate: boolean;
        event_fingerprint: string;
        event_type: string;
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
    return result.rows.map((row) => ({
      appid: row.appid,
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

  async getReleasedCohort(input: OpportunityEvaluationInput): Promise<{
    confidence: "high" | "directional";
    coverage: number;
    fallbackTier: 1 | 2 | 3 | 4 | 5;
    members: OpportunityCohortMember[];
    signature: Record<string, unknown>;
    sourceAt: string | null;
  }> {
    const tagValue = input.fields.tags?.value;
    const genreValue = input.fields.genres?.value;
    const tags = (Array.isArray(tagValue) ? tagValue : [])
      .filter((value): value is string => typeof value === "string")
      .slice(0, 10);
    const genres = (Array.isArray(genreValue) ? genreValue : [])
      .filter((value): value is string => typeof value === "string")
      .slice(0, 6);
    const price = Number(input.fields.price_cents?.value ?? 0);
    const isFree = input.fields.is_free?.value === true;
    const result = await this.pool.query<
      QueryResultRow & {
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
    >(
      `
        WITH candidate_ids AS (
          SELECT app_tag.appid
          FROM legacy.app_steam_tags app_tag
          JOIN legacy.steam_tags tag ON tag.tag_id = app_tag.tag_id
          WHERE LOWER(tag.name) = ANY($1::text[])
          UNION
          SELECT app_genre.appid
          FROM legacy.app_genres app_genre
          JOIN legacy.steam_genres genre ON genre.genre_id = app_genre.genre_id
          WHERE LOWER(genre.name) = ANY($2::text[])
          UNION
          SELECT app.appid
          FROM legacy.apps app
          WHERE cardinality($1::text[]) = 0
            AND cardinality($2::text[]) = 0
            AND app.type = 'game'
            AND app.is_released = true
            AND COALESCE(app.is_delisted, false) = false
        ),
        scored AS (
          SELECT
            app.appid,
            app.name,
            COALESCE(app.current_price_cents, metric.price_cents) AS price_cents,
            metric.total_reviews,
            metric.positive_percentage,
            metric.ccu_peak,
            metric.metric_date,
            signal.review_change_30d,
            (
              SELECT COUNT(1)
              FROM legacy.app_steam_tags overlap_tag
              JOIN legacy.steam_tags tag ON tag.tag_id = overlap_tag.tag_id
              WHERE overlap_tag.appid = app.appid
                AND LOWER(tag.name) = ANY($1::text[])
            ) AS tag_overlap,
            (
              0.45 * LEAST(1, (
                SELECT COUNT(1)::numeric / GREATEST(1, cardinality($1::text[]))
                FROM legacy.app_steam_tags overlap_tag
                JOIN legacy.steam_tags tag ON tag.tag_id = overlap_tag.tag_id
                WHERE overlap_tag.appid = app.appid
                  AND LOWER(tag.name) = ANY($1::text[])
              ))
              + 0.20 * LEAST(1, (
                SELECT COUNT(1)::numeric / GREATEST(1, cardinality($2::text[]))
                FROM legacy.app_genres overlap_genre
                JOIN legacy.steam_genres genre
                  ON genre.genre_id = overlap_genre.genre_id
                WHERE overlap_genre.appid = app.appid
                  AND LOWER(genre.name) = ANY($2::text[])
              ))
              + 0.10 * CASE
                  WHEN $3::boolean = app.is_free THEN 1
                  ELSE 0
                END
              + 0.10 * CASE
                  WHEN ABS(COALESCE(app.current_price_cents, metric.price_cents, 0) - $4) <= 1000
                    THEN 1
                  ELSE 0
                END
            ) AS inclusion_score
          FROM candidate_ids candidate
          JOIN legacy.apps app ON app.appid = candidate.appid
          LEFT JOIN legacy.latest_daily_metrics metric ON metric.appid = app.appid
          LEFT JOIN metrics.app_signal_windows_v1 signal ON signal.appid = app.appid
          WHERE app.appid <> $5
            AND app.type = 'game'
            AND app.is_released = true
            AND COALESCE(app.is_delisted, false) = false
            AND app.is_free = $3
        )
        SELECT *
        FROM scored
        ORDER BY inclusion_score DESC, appid
        LIMIT 50
      `,
      [
        tags.map((tag) => tag.toLocaleLowerCase()),
        genres.map((genre) => genre.toLocaleLowerCase()),
        isFree,
        Number.isFinite(price) ? price : 0,
        input.appid,
      ],
    );
    const members: OpportunityCohortMember[] = result.rows.map((row) => ({
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
        row.positive_percentage === null
          ? null
          : Number(row.positive_percentage),
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
      result.rows
        .map((row) => row.metric_date)
        .filter((value): value is Date | string => value !== null)
        .map(iso)
        .sort()
        .at(-1) ?? null;
    const fallbackTier: 1 | 2 | 3 | 4 | 5 =
      members.length >= 20 && tags.length >= 2
        ? 1
        : members.length >= 10
          ? 2
          : genres.length > 0
            ? 3
            : tags.length > 0
              ? 4
              : 5;
    return {
      confidence:
        members.length >= 10 && coverage >= 0.6 ? "high" : "directional",
      coverage,
      fallbackTier,
      members,
      signature: {
        businessModel: isFree ? "free" : "premium",
        genres,
        priceBand: Number.isFinite(price)
          ? [Math.max(0, price - 1000), price + 1000]
          : null,
        tags,
      },
      sourceAt: latestMetricDate,
    };
  }

  async refreshSignalWindows(appids: number[]): Promise<void> {
    const bounded = Array.from(new Set(appids)).slice(0, 5_000);
    if (bounded.length === 0) {
      return;
    }
    await this.pool.query(
      `SELECT metrics.refresh_app_signal_windows_v1(CURRENT_DATE - 1, $1::integer[], 'signal-windows/v1')`,
      [bounded],
    );
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

  async persistRunOutcome(params: {
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

      const resultIds = await client.query<QueryResultRow & { id: string }>(
        `
          SELECT id
          FROM opportunity.results
          WHERE run_id = $1
            AND user_id = $2
          ORDER BY rank NULLS LAST, score DESC NULLS LAST, appid
          LIMIT 500
        `,
        [params.run.id, params.userId],
      );
      const preferences = await client.query<
        QueryResultRow & {
          channel: "email" | "slack";
          id: string;
          max_results: number;
          quiet_day_behavior: "skip" | "send_empty";
        }
      >(
        `
          SELECT id, channel, max_results, quiet_day_behavior
          FROM opportunity.channel_preferences
          WHERE workspace_id = $1
            AND user_id = $2
            AND profile_id IS NULL
            AND channel IN ('email', 'slack')
            AND enabled
            AND ($3::boolean = false OR immediate_full_match_enabled)
          ORDER BY channel
          LIMIT 10
        `,
        [params.workspaceId, params.userId, params.run.kind === "immediate"],
      );
      for (const preference of preferences.rows) {
        const selectedIds = resultIds.rows
          .slice(0, preference.max_results)
          .map((row) => row.id);
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
              canonicalOverviewUrl: `${params.websiteBaseUrl.replace(/\/$/, "")}/opportunities?run=${params.run.id}`,
              resultCount: resultIds.rowCount,
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
          UPDATE opportunity.profiles
          SET next_evaluation_at = now() + interval '24 hours',
              updated_at = now()
          WHERE workspace_id = $1
            AND owner_user_id = $2
            AND status = 'enabled'
            AND $3::boolean
        `,
        [params.workspaceId, params.userId, params.run.kind !== "immediate"],
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
}
