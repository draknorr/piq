import { createHash, randomUUID } from "node:crypto";

import {
  calculateOpportunityMarketContext,
  calculateOpportunityPresetHealth,
  calculateOpportunityRanking,
  calculateOpportunityReviewPriority,
  compareOpportunityReviewPriority,
  describeOpportunityChange,
  resolveOpportunityPriorityLane,
  resolveOpportunityRankingPolicy,
} from "./intelligence.js";
import {
  evaluateOpportunityProfile,
  supportsReleasedMarketHealth,
} from "./rules.js";
import { encodeOpportunityReviewPriorityDecision } from "./review-priority-storage.js";
import type {
  OpportunityEvaluationInput,
  OpportunityFieldValue,
  OpportunityGameDescription,
  OpportunityMaterialEventType,
  OpportunityProfileEvaluation,
  OpportunityRankComponents,
  OpportunityReviewPriorityDecision,
  OpportunityResultLabel,
  OpportunityRuleField,
  OpportunityWorkerPhaseTimings,
} from "./types.js";
import type {
  OpportunityCandidateEvaluation,
  OpportunityEvaluatedMatch,
  OpportunityEvaluatedResult,
  OpportunityPriorUserState,
  OpportunityReleasedCohort,
  OpportunityRunContext,
  OpportunityWorkerMaterialEvent,
  OpportunityWorkerProfile,
  OpportunityWorkItem,
} from "./worker-repository.js";
import { OpportunityWorkerRepository } from "./worker-repository.js";

const PRESET_HEALTH_MAX_EVALUATED_GAMES = 5_000;
const PRESET_HEALTH_MAX_REFRESHED_GAMES = 20_000;
const PRESET_HEALTH_REFRESH_BATCH_SIZE = 500;
const EVALUATION_HEARTBEAT_GAME_INTERVAL = 10;
const EVALUATION_SIGNAL_REFRESH_BATCH_SIZE = 500;

export interface OpportunityWorkerOptions {
  claimLimit?: number;
  computeReviewPriorityV2?: boolean;
  websiteBaseUrl: string;
  workerId?: string;
}

export interface EvaluationContext {
  appid: number;
  candidateOutcomes: Map<
    string,
    "eligible" | "ineligible" | "pending" | "expired"
  >;
  event: OpportunityWorkerMaterialEvent;
  input: OpportunityEvaluationInput;
  priorState: OpportunityPriorUserState;
  profiles: OpportunityWorkerProfile[];
  run: OpportunityRunContext;
}

interface PreparedEvaluation {
  context: EvaluationContext;
  eligible: Array<{
    evaluation: OpportunityProfileEvaluation;
    priorOutcome: "eligible" | "ineligible" | "pending" | "expired" | undefined;
    profile: OpportunityWorkerProfile;
  }>;
  evaluations: OpportunityCandidateEvaluation[];
  shouldEnrich: boolean;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function valueOf(
  input: OpportunityEvaluationInput,
  field: OpportunityRuleField,
): unknown {
  const value = input.fields[field];
  return value?.state === "known" ? value.value : null;
}

export function opportunityNumericFieldValue(
  input: OpportunityEvaluationInput,
  field: OpportunityRuleField,
): number | null {
  const value = valueOf(input, field);
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return null;
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function percentileRank(
  value: number | null,
  peers: Array<number | null>,
): number {
  if (value === null) {
    return 0.5;
  }
  const measured = peers.filter(
    (peer): peer is number => peer !== null && Number.isFinite(peer),
  );
  if (measured.length === 0) {
    return 0.5;
  }
  return measured.filter((peer) => peer <= value).length / measured.length;
}

function median(values: Array<number | null>): number | null {
  const measured = values
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    )
    .sort((left, right) => left - right);
  if (measured.length === 0) {
    return null;
  }
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 === 0
    ? (measured[middle - 1]! + measured[middle]!) / 2
    : measured[middle]!;
}

function stableFingerprint(values: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...values].sort()))
    .digest("hex");
}

function eventDescription(event: OpportunityWorkerMaterialEvent): string {
  return (
    event.summary ??
    describeOpportunityChange(
      {
        affectedRuleFields: event.affectedRuleFields ?? [],
        after: event.after ?? null,
        before: event.before ?? null,
        confidence: event.confidence ?? "directional",
        effectiveAt: event.effectiveAt,
        eventType: event.eventType as OpportunityMaterialEventType,
        observedAt: event.observedAt,
        signalFamily: event.signalFamily,
      },
      "materially_changed",
    )
  );
}

export function resolveOpportunityResultLabel(params: {
  event: OpportunityWorkerMaterialEvent;
  matches: Array<{
    evaluation: OpportunityProfileEvaluation;
    priorOutcome: "eligible" | "ineligible" | "pending" | "expired" | undefined;
  }>;
  runWindowEnd: string;
  runWindowStart: string;
  tracked: boolean;
}): OpportunityResultLabel {
  const observedAt = Date.parse(params.event.observedAt);
  const eventIsInRunWindow =
    Number.isFinite(observedAt) &&
    observedAt >= Date.parse(params.runWindowStart) &&
    observedAt < Date.parse(params.runWindowEnd);
  const delayedByReadiness = params.matches.some(
    (match) =>
      match.priorOutcome === "pending" || match.priorOutcome === "expired",
  );
  if (delayedByReadiness) {
    return "newly_qualified";
  }
  if (params.event.eventType === "first_observed" && eventIsInRunWindow) {
    return "newly_discovered";
  }
  if (params.event.eventType === "released" && eventIsInRunWindow) {
    return "newly_released";
  }
  if (
    params.matches.some(
      (match) =>
        match.evaluation.outcome === "eligible" &&
        match.priorOutcome !== "eligible",
    )
  ) {
    return "newly_qualified";
  }
  return params.tracked ? "tracked_update" : "materially_changed";
}

export function shouldSurfaceOpportunityMatch(params: {
  event: OpportunityWorkerMaterialEvent;
  immediateRun: boolean;
  priorOutcome: "eligible" | "ineligible" | "pending" | "expired" | undefined;
  profile: OpportunityWorkerProfile;
  tracked: boolean;
}): boolean {
  if (params.immediateRun) {
    return (
      params.event.eligibleForImmediate &&
      params.event.eventType === "first_observed" &&
      params.profile.immediateFullMatchEnabled
    );
  }
  if (params.priorOutcome !== "eligible") {
    return true;
  }
  const subscribed = params.profile.eventSubscriptions.includes(
    params.event.signalFamily,
  );
  return subscribed && (params.event.createsDailyResult || params.tracked);
}

function requiredFields(
  matches: OpportunityEvaluatedMatch[],
): Set<OpportunityRuleField> {
  return new Set(
    matches.flatMap((match) =>
      match.profile.rules.required.flatMap((group) =>
        group.clauses.map((clause) => clause.field),
      ),
    ),
  );
}

function evidenceQuality(
  input: OpportunityEvaluationInput,
  matches: OpportunityEvaluatedMatch[],
): number {
  const fields = [...requiredFields(matches)];
  if (fields.length === 0) {
    return 1;
  }
  const known = fields.filter(
    (field) => input.fields[field]?.state === "known",
  );
  return known.length / fields.length;
}

function buildEvidenceItems(
  input: OpportunityEvaluationInput,
  matches: OpportunityEvaluatedMatch[],
): Array<Record<string, unknown>> {
  const labels: Partial<Record<OpportunityRuleField, string>> = {
    app_type: "Steam app type",
    categories: "Steam features",
    ccu_peak: "Peak concurrent players",
    demo_only: "Only demo available",
    has_demo: "Playable demo",
    is_released: "Released",
    publisheriq_added_at: "Added to PublisherIQ",
    release_date: "Steam launch date",
    release_state: "Release state",
    reviews_added_30d: "Steam reviews added in the last 30 days",
    tags: "Steam tags",
    total_reviews: "Total Steam reviews",
  };
  const fields = Array.from(
    new Set<OpportunityRuleField>([
      ...requiredFields(matches),
      "release_state",
      "tags",
      "has_demo",
      "total_reviews",
      "reviews_added_30d",
      "ccu_peak",
    ]),
  );
  return fields.flatMap((field) => {
    const evidence = input.fields[field];
    if (!evidence || evidence.state !== "known") {
      return [];
    }
    return [
      {
        confidence: evidence.confidence,
        evidenceClass: evidence.evidenceClass,
        label: labels[field] ?? field.replaceAll("_", " "),
        source: evidence.source,
        sourceAt: evidence.sourceAt,
        value: evidence.value,
      },
    ];
  });
}

function buildSourceTimestamps(
  input: OpportunityEvaluationInput,
  event: OpportunityWorkerMaterialEvent,
  profileEvaluationAt: string,
): Record<string, string | null> {
  const timestamps: Record<string, string | null> = {
    materialEvent: event.observedAt,
    materialEventEffectiveAt: event.effectiveAt,
    materialEventObservedAt: event.observedAt,
    profileEvaluationAt,
  };
  for (const evidence of Object.values(input.fields)) {
    if (!evidence) {
      continue;
    }
    const current = timestamps[evidence.source];
    if (
      evidence.sourceAt &&
      (!current || new Date(evidence.sourceAt) > new Date(current))
    ) {
      timestamps[evidence.source] = evidence.sourceAt;
    } else if (!(evidence.source in timestamps)) {
      timestamps[evidence.source] = evidence.sourceAt;
    }
  }
  return timestamps;
}

function marketMomentumComponent(
  direction: "declining" | "stable" | "improving" | "unknown",
): number {
  return {
    declining: 0.2,
    improving: 1,
    stable: 0.55,
    unknown: 0.35,
  }[direction];
}

function fieldExplanation(
  evidence: OpportunityFieldValue | undefined,
): string | null {
  if (!evidence || evidence.state !== "known") {
    return null;
  }
  const value = Array.isArray(evidence.value)
    ? evidence.value.slice(0, 4).join(", ")
    : String(evidence.value);
  return value.length > 0 ? value : null;
}

export class OpportunityWorker {
  private readonly claimLimit: number;
  private readonly computeReviewPriorityV2: boolean;
  private readonly websiteBaseUrl: string;
  readonly workerId: string;

  constructor(
    private readonly repository: OpportunityWorkerRepository,
    options: OpportunityWorkerOptions,
  ) {
    this.claimLimit = Math.max(1, Math.min(50, options.claimLimit ?? 8));
    this.computeReviewPriorityV2 = options.computeReviewPriorityV2 ?? false;
    this.websiteBaseUrl = options.websiteBaseUrl;
    this.workerId = options.workerId ?? `opportunity-${randomUUID()}`;
  }

  async runOnce(): Promise<{ claimed: number; scheduled: number }> {
    const scheduled = await this.repository.scheduleWork();
    const work = await this.repository.claimWork(
      this.workerId,
      this.claimLimit,
    );

    for (const item of work) {
      await this.processSafely(item);
    }

    return { claimed: work.length, scheduled };
  }

  private async processSafely(item: OpportunityWorkItem): Promise<void> {
    try {
      await this.repository.heartbeatWork(item.id, this.workerId);
      switch (item.kind) {
        case "materialize_events":
          await this.repository.materializeEvents(() =>
            this.repository.heartbeatWork(item.id, this.workerId),
          );
          await this.repository.completeWork(item.id, this.workerId);
          return;
        case "daily_evaluation":
        case "immediate_evaluation":
        case "readiness_recheck":
          await this.evaluateWork(item);
          return;
        case "deliver":
        case "refresh_cohort":
          await this.repository.completeWork(item.id, this.workerId);
          return;
        case "refresh_preset_health":
          await this.refreshPresetHealth(() =>
            this.repository.heartbeatWork(item.id, this.workerId),
          );
          await this.repository.completeWork(item.id, this.workerId);
          return;
      }
    } catch (error) {
      await this.repository.failWork({
        code: "opportunity_worker_failed",
        error: error instanceof Error ? error.message : String(error),
        workId: item.id,
        workerId: this.workerId,
      });
    }
  }

  private async refreshPresetHealth(
    onProgress?: () => Promise<void>,
  ): Promise<void> {
    const targets = await this.repository.getPresetHealthTargets();
    const refreshedAppids = new Set<number>();
    for (const target of targets) {
      if (!supportsReleasedMarketHealth(target.rules)) {
        continue;
      }
      await onProgress?.();
      const [initialInputs, prior] = await Promise.all([
        this.repository.productRepository.getPresetHealthInputs(target.rules),
        this.repository.getPriorPresetHealth(target.id),
      ]);
      const remainingRefreshCapacity = Math.max(
        0,
        PRESET_HEALTH_MAX_REFRESHED_GAMES - refreshedAppids.size,
      );
      const appidsToRefresh = initialInputs
        .map((input) => input.appid)
        .filter((appid) => !refreshedAppids.has(appid))
        .slice(0, remainingRefreshCapacity);
      let refreshedSignalWindows = 0;
      if (appidsToRefresh.length > 0) {
        refreshedSignalWindows = await this.repository.refreshSignalWindows(
          appidsToRefresh,
          {
            batchSize: PRESET_HEALTH_REFRESH_BATCH_SIZE,
            onBatch: onProgress,
          },
        );
        for (const appid of appidsToRefresh) {
          refreshedAppids.add(appid);
        }
      }
      const inputs =
        refreshedSignalWindows > 0
          ? await this.repository.productRepository.getPresetHealthInputs(
              target.rules,
            )
          : initialInputs;
      const measurements = inputs.map((input) => {
        const reviews7d = opportunityNumericFieldValue(
          input,
          "reviews_added_7d",
        );
        const reviews30d = opportunityNumericFieldValue(
          input,
          "reviews_added_30d",
        );
        const prior23d =
          reviews30d === null || reviews7d === null
            ? null
            : Math.max(0, reviews30d - reviews7d);
        const recentDaily = reviews7d === null ? null : reviews7d / 7;
        const baselineDaily = prior23d === null ? null : prior23d / 23;
        const reviewAcceleration =
          recentDaily === null || baselineDaily === null
            ? null
            : baselineDaily <= 0
              ? recentDaily > 0
                ? 1
                : 0
              : (recentDaily - baselineDaily) / baselineDaily;
        const ccuGrowth = opportunityNumericFieldValue(input, "ccu_change_30d");
        return {
          ccuGrowth,
          reviewAcceleration,
          reviewContribution: Math.max(0, reviews30d ?? 0),
        };
      });
      const core = measurements.filter(
        (measurement) =>
          measurement.reviewAcceleration !== null &&
          measurement.ccuGrowth !== null,
      );
      const positive = core.filter(
        (measurement) =>
          (measurement.reviewAcceleration ?? 0) > 0 ||
          (measurement.ccuGrowth ?? 0) > 0,
      );
      const totalContribution = measurements.reduce(
        (sum, measurement) => sum + measurement.reviewContribution,
        0,
      );
      const topContributorShare =
        totalContribution > 0
          ? Math.max(
              ...measurements.map(
                (measurement) =>
                  measurement.reviewContribution / totalContribution,
              ),
            )
          : null;
      const consecutiveCandidateDays =
        prior.state === "growing" || prior.state === "surging"
          ? prior.consecutiveDays + 1
          : 1;
      const snapshot = calculateOpportunityPresetHealth({
        asOfDate: new Date().toISOString().slice(0, 10),
        ccuGrowthMedian: median(
          core.map((measurement) => measurement.ccuGrowth),
        ),
        consecutiveCandidateDays,
        coreCoverage: inputs.length === 0 ? 0 : core.length / inputs.length,
        evaluatedGames: inputs.length,
        measuredGames: core.length,
        positiveBreadth:
          core.length === 0 ? null : positive.length / core.length,
        priorState: prior.state,
        reviewAccelerationMedian: median(
          core.map((measurement) => measurement.reviewAcceleration),
        ),
        topContributorShare,
      });
      await this.repository.persistPresetHealth({
        cohortDefinition: {
          candidateCount: inputs.length,
          deterministicOrder: "appid",
          maximumEvaluated: PRESET_HEALTH_MAX_EVALUATED_GAMES,
          ruleSchemaVersion: target.rules.schemaVersion,
          signalWindowRefresh: {
            fullyRefreshed: inputs.every((input) =>
              refreshedAppids.has(input.appid),
            ),
            maximumUniqueGamesPerRun: PRESET_HEALTH_MAX_REFRESHED_GAMES,
            refreshedGames: inputs.filter((input) =>
              refreshedAppids.has(input.appid),
            ).length,
            runUniqueGames: refreshedAppids.size,
          },
          slug: target.slug,
        },
        indicators: {
          ccuGrowthMedian: median(
            core.map((measurement) => measurement.ccuGrowth),
          ),
          positiveBreadth:
            core.length === 0 ? null : positive.length / core.length,
          reviewAccelerationMedian: median(
            core.map((measurement) => measurement.reviewAcceleration),
          ),
          windows: {
            ccu: "latest 30d change",
            reviews: "latest 7d daily rate vs preceding 23d daily rate",
          },
        },
        presetId: target.id,
        priorState: prior.state,
        snapshot,
      });
    }
  }

  private async evaluateWork(item: OpportunityWorkItem): Promise<void> {
    if (!item.workspaceId || !item.userId) {
      throw new Error(
        `${item.kind} work is missing workspace or user identity.`,
      );
    }
    const inputPreparationStartedAt = performance.now();
    const run = await this.repository.createRunContext({
      kind:
        item.kind === "immediate_evaluation"
          ? "immediate"
          : item.kind === "daily_evaluation"
            ? "daily"
            : "readiness",
      userId: item.userId,
      workspaceId: item.workspaceId,
    });

    try {
      const profiles = await this.repository.getActiveProfiles(
        item.workspaceId,
        item.userId,
        { immediateOnly: item.kind === "immediate_evaluation" },
      );
      const [events, dateTransitionAppids] = await Promise.all([
        this.repository.getRunMaterialEvents(
          run,
          item.appid,
          item.materialEventId,
        ),
        item.kind === "daily_evaluation"
          ? this.repository.productRepository.getRelativeDateTransitionAppids(
              profiles,
              run.windowEnd,
            )
          : Promise.resolve([]),
      ]);
      const selectedByAppid = new Map<number, OpportunityWorkerMaterialEvent>();
      for (const event of events) {
        if (!selectedByAppid.has(event.appid)) {
          selectedByAppid.set(event.appid, event);
        }
      }
      for (const appid of dateTransitionAppids) {
        if (selectedByAppid.has(appid)) {
          continue;
        }
        selectedByAppid.set(appid, {
          affectedRuleFields: ["release_date", "publisheriq_added_at"],
          after: { evaluationDate: run.windowEnd },
          appid,
          before: { evaluationDate: run.windowStart },
          confidence: "high",
          createsDailyResult: true,
          effectiveAt: run.windowEnd,
          eligibleForImmediate: false,
          eventFingerprint: stableFingerprint([
            "date-window",
            String(appid),
            run.windowEnd,
          ]),
          eventType: "date_window_changed",
          id: null,
          materiality: 1,
          observedAt: run.windowEnd,
          reevaluateEligibility: true,
          signalFamily: "release",
          summary:
            "The game entered or left a saved calendar-date window in this daily evaluation.",
        });
      }
      const selectedEvents = Array.from(selectedByAppid.values());
      const appids = selectedEvents.map((event) => event.appid);
      const [inputs, priorStates, candidateOutcomes] = await Promise.all([
        this.repository.productRepository.getRuleInputs(appids),
        this.repository.getPriorUserStates(
          item.workspaceId,
          item.userId,
          appids,
        ),
        this.repository.getCandidateOutcomes({
          appids,
          profileVersionIds: profiles.map((profile) => profile.versionId),
          userId: item.userId,
        }),
      ]);
      await this.repository.heartbeatWork(item.id, this.workerId);
      const refreshedSignalWindows = await this.repository.refreshSignalWindows(
        appids,
        {
          batchSize: EVALUATION_SIGNAL_REFRESH_BATCH_SIZE,
          onBatch: () => this.repository.heartbeatWork(item.id, this.workerId),
        },
      );
      const refreshedInputs =
        refreshedSignalWindows > 0
          ? await this.repository.productRepository.getRuleInputs(appids)
          : inputs;
      const inputByApp = new Map(
        refreshedInputs.map((input) => [input.appid, input]),
      );
      const evaluations: OpportunityCandidateEvaluation[] = [];
      const pending: OpportunityCandidateEvaluation[] = [];
      const results: OpportunityEvaluatedResult[] = [];
      const preparedForEnrichment: PreparedEvaluation[] = [];
      const inputPreparationMs = performance.now() - inputPreparationStartedAt;
      const profileEvaluationStartedAt = performance.now();

      for (const [index, event] of selectedEvents.entries()) {
        if (index % EVALUATION_HEARTBEAT_GAME_INTERVAL === 0) {
          await this.repository.heartbeatWork(item.id, this.workerId);
        }
        const input = inputByApp.get(event.appid);
        if (!input) {
          continue;
        }
        const priorState = priorStates.get(event.appid) ?? {
          dismissedEventFingerprint: null,
          ignored: false,
          priorEventFingerprints: new Set<string>(),
          priorResultId: null,
          tracked: false,
        };
        const prepared = this.prepareGame({
          appid: event.appid,
          candidateOutcomes,
          event,
          input,
          priorState,
          profiles,
          run,
        });
        evaluations.push(...prepared.evaluations);
        pending.push(
          ...prepared.evaluations.filter(
            (candidate) => candidate.evaluation.outcome === "pending",
          ),
        );
        if (prepared.shouldEnrich) {
          preparedForEnrichment.push(prepared);
        }
      }

      const profileEvaluationMs =
        performance.now() - profileEvaluationStartedAt;
      await this.repository.heartbeatWork(item.id, this.workerId);
      const cohortResolutionStartedAt = performance.now();
      const cohorts = await this.repository.getReleasedCohorts(
        preparedForEnrichment.map((prepared) => prepared.context.input),
      );
      const cohortResolutionMs = performance.now() - cohortResolutionStartedAt;
      await this.repository.heartbeatWork(item.id, this.workerId);
      const marketCalculationStartedAt = performance.now();
      for (const prepared of preparedForEnrichment) {
        const cohort = cohorts.get(prepared.context.appid);
        if (!cohort) {
          throw new Error(
            `Opportunity cohort resolution omitted app ${prepared.context.appid}.`,
          );
        }
        results.push(this.finalizeGame(prepared, cohort));
      }
      const marketCalculationMs =
        performance.now() - marketCalculationStartedAt;
      results.sort(
        (left, right) =>
          right.rank.finalScore - left.rank.finalScore ||
          left.appid - right.appid,
      );
      await this.repository.persistRunOutcome({
        evaluations,
        pending,
        phaseTimings: {
          cohortResolutionMs,
          inputPreparationMs,
          marketCalculationMs,
          profileEvaluationMs,
        } satisfies Omit<
          OpportunityWorkerPhaseTimings,
          "persistenceMs" | "totalMs"
        >,
        results,
        run,
        userId: item.userId,
        websiteBaseUrl: this.websiteBaseUrl,
        workId: item.id,
        workerId: this.workerId,
        workspaceId: item.workspaceId,
      });
    } catch (error) {
      await this.repository.failRun(run.id, error);
      throw error;
    }
  }

  async evaluateGame(context: EvaluationContext): Promise<{
    evaluations: OpportunityCandidateEvaluation[];
    result: OpportunityEvaluatedResult | null;
  }> {
    const prepared = this.prepareGame(context);
    if (!prepared.shouldEnrich) {
      return { evaluations: prepared.evaluations, result: null };
    }
    const cohort = await this.repository.getReleasedCohort(context.input);
    return {
      evaluations: prepared.evaluations,
      result: this.finalizeGame(prepared, cohort),
    };
  }

  private prepareGame(context: EvaluationContext): PreparedEvaluation {
    const evaluated = context.profiles.map((profile) => {
      const evaluation = evaluateOpportunityProfile(
        profile.rules,
        context.input,
        {
          asOf: context.run.windowEnd,
          timezone: profile.timezone,
        },
      );
      const priorOutcome = context.candidateOutcomes.get(
        `${context.appid}:${profile.versionId}`,
      );
      return { evaluation, priorOutcome, profile };
    });
    const evaluations = evaluated.map(({ evaluation, profile }) => ({
      appid: context.appid,
      evaluation,
      eventId: context.event.id,
      profile,
    }));
    const eligible = evaluated.filter(
      (match) => match.evaluation.outcome === "eligible",
    );
    const surfacing = eligible.filter((match) =>
      shouldSurfaceOpportunityMatch({
        event: context.event,
        immediateRun: context.run.kind === "immediate",
        priorOutcome: match.priorOutcome,
        profile: match.profile,
        tracked: context.priorState.tracked,
      }),
    );
    const dismissedCurrent =
      context.priorState.dismissedEventFingerprint ===
      context.event.eventFingerprint;
    if (
      eligible.length === 0 ||
      surfacing.length === 0 ||
      context.priorState.ignored ||
      dismissedCurrent ||
      context.priorState.priorEventFingerprints.has(
        context.event.eventFingerprint,
      )
    ) {
      return {
        context,
        eligible,
        evaluations,
        shouldEnrich: false,
      };
    }

    return {
      context,
      eligible,
      evaluations,
      shouldEnrich: true,
    };
  }

  private finalizeGame(
    prepared: PreparedEvaluation,
    cohort: OpportunityReleasedCohort,
  ): OpportunityEvaluatedResult {
    const { context, eligible } = prepared;
    const matches: OpportunityEvaluatedMatch[] = eligible.map(
      ({ evaluation, profile }) => ({ evaluation, profile }),
    );
    const market = calculateOpportunityMarketContext(cohort.members);
    const preference = Math.max(
      0,
      ...matches.map((match) => match.evaluation.preferenceContribution),
    );
    const currentReviews = opportunityNumericFieldValue(
      context.input,
      "total_reviews",
    );
    const currentCcu = opportunityNumericFieldValue(context.input, "ccu_peak");
    const peerPosition = Math.max(
      percentileRank(
        currentReviews,
        cohort.members.map((member) => member.totalReviews),
      ),
      percentileRank(
        currentCcu,
        cohort.members.map((member) => member.ccuPeak),
      ),
    );
    const components: OpportunityRankComponents = {
      evidenceQuality: evidenceQuality(context.input, matches),
      marketMomentum: marketMomentumComponent(market.demandDirection),
      peerPosition,
      signalStrength: clamp(context.event.materiality),
      userFit: clamp(0.7 + preference * 0.3),
    };
    const reasons = [
      `${matches.length} profile${matches.length === 1 ? "" : "s"} matched all required rules.`,
      eventDescription(context.event),
      market.explanation[0] ?? "Comparable-market coverage is limited.",
    ];
    const rank = calculateOpportunityRanking({ components, reasons });
    const label = resolveOpportunityResultLabel({
      event: context.event,
      matches: eligible,
      runWindowEnd: context.run.windowEnd,
      runWindowStart: context.run.windowStart,
      tracked: context.priorState.tracked,
    });
    const missingEvidence = Array.from(
      new Set(
        Object.entries(context.input.fields)
          .filter(([, evidence]) => evidence?.state === "unknown")
          .map(([field]) => field),
      ),
    );
    const evidenceItems = buildEvidenceItems(context.input, matches);
    const requiredEvidence = matches.flatMap((match) =>
      match.evaluation.requiredOutcomes
        .filter((outcome) => outcome.state === "true")
        .map((outcome) => outcome.label),
    );
    const preferenceEvidence = matches.flatMap((match) =>
      match.evaluation.preferredOutcomes
        .filter((outcome) => outcome.state === "true")
        .map((outcome) => outcome.label),
    );
    const tags = fieldExplanation(context.input.fields.tags);
    const strongestEvidence = Array.from(
      new Set(
        [
          ...requiredEvidence,
          ...preferenceEvidence,
          tags ? `Positioned around ${tags}` : null,
          eventDescription(context.event),
        ].filter((item): item is string => Boolean(item)),
      ),
    ).slice(0, 4);
    const reappeared =
      context.priorState.dismissedEventFingerprint &&
      context.priorState.dismissedEventFingerprint !==
        context.event.eventFingerprint;

    const firstObservedAt =
      context.input.fields.publisheriq_added_at?.state === "known" &&
      typeof context.input.fields.publisheriq_added_at.value === "string"
        ? context.input.fields.publisheriq_added_at.value
        : null;
    const lane = resolveOpportunityPriorityLane({
      effectiveAt: context.event.effectiveAt,
      eventType: context.event.eventType,
      firstObservedAt,
      hasApplicableTraction:
        currentReviews !== null ||
        currentCcu !== null ||
        opportunityNumericFieldValue(context.input, "reviews_added_7d") !==
          null ||
        opportunityNumericFieldValue(context.input, "ccu_change_7d") !== null,
      isReleased:
        typeof valueOf(context.input, "is_released") === "boolean"
          ? (valueOf(context.input, "is_released") as boolean)
          : null,
      signalFamily: context.event.signalFamily,
    });
    const allMatchedProfileIds = matches
      .map((match) => match.profile.id)
      .sort();
    let cohortMeasuredCount: number | undefined;
    let effectiveAtMs: number | undefined;
    let reviewPriorityNowMs: number | undefined;
    if (this.computeReviewPriorityV2) {
      cohortMeasuredCount = 0;
      for (const member of cohort.members) {
        if (member.totalReviews !== null || member.ccuPeak !== null) {
          cohortMeasuredCount += 1;
        }
      }
      effectiveAtMs = Date.parse(context.event.effectiveAt);
      reviewPriorityNowMs = Date.parse(context.run.windowEnd);
    }
    const matchesWithPriority: OpportunityEvaluatedMatch[] = this
      .computeReviewPriorityV2
      ? matches.map((match) => {
          const selection = resolveOpportunityRankingPolicy({
            calculationConfig: match.profile.calculationConfig,
            rules: match.profile.rules,
          });
          return {
            ...match,
            reviewPriority: calculateOpportunityReviewPriority({
              affectedRuleFields: context.event.affectedRuleFields ?? [],
              allMatchedProfileIds,
              allMatchedProfileIdsSorted: true,
              cohort,
              cohortMeasuredCount,
              effectiveAt: context.event.effectiveAt,
              effectiveAtMs,
              evaluation: match.evaluation,
              eventMateriality: context.event.materiality,
              eventSubscribed: match.profile.eventSubscriptions.includes(
                context.event.signalFamily,
              ),
              eventType: context.event.eventType,
              input: context.input,
              lane,
              market,
              now: context.run.windowEnd,
              nowMs: reviewPriorityNowMs,
              policy: selection.policy,
              profileId: match.profile.id,
              selectionSource: selection.selectionSource,
            }),
          };
        })
      : matches;
    let reviewPriority: OpportunityReviewPriorityDecision | undefined;
    if (this.computeReviewPriorityV2) {
      for (const match of matchesWithPriority) {
        if (
          match.reviewPriority &&
          (!reviewPriority ||
            compareOpportunityReviewPriority(
              match.reviewPriority,
              reviewPriority,
            ) < 0)
        ) {
          reviewPriority = match.reviewPriority;
        }
      }
    }
    const persistedMatches = this.computeReviewPriorityV2
      ? matchesWithPriority.map((match) => ({
          ...match,
          reviewPriority:
            match.reviewPriority === reviewPriority
              ? match.reviewPriority
              : undefined,
          reviewPriorityStorage: match.reviewPriority
            ? encodeOpportunityReviewPriorityDecision(match.reviewPriority)
            : undefined,
        }))
      : matchesWithPriority;
    const description: OpportunityGameDescription | undefined = this
      .computeReviewPriorityV2
      ? (context.input.description ?? {
          contentHash: null,
          hasHeaderImage: false,
          hasReleasePath: false,
          hasSupportedLanguages: false,
          kind: "unavailable",
          sanitizerVersion: "opportunity-description/v1",
          screenshotCount: 0,
          sourceAt: null,
          sourceSnapshotId: null,
          text: "Steam has not provided a short description for this game yet.",
          trailerCount: 0,
        })
      : undefined;

    return {
      appid: context.appid,
      cohort,
      confidence:
        reviewPriority?.confidence.label === "high" ||
        (!reviewPriority &&
          market.confidence === "high" &&
          components.evidenceQuality >= 0.8)
          ? "high"
          : "directional",
      description,
      event: context.event,
      eventLabel: label,
      evidenceItems,
      market,
      matches: persistedMatches,
      missingEvidence,
      profileVersionSetFingerprint: stableFingerprint(
        matches.map((match) => match.profile.versionId),
      ),
      rank,
      reviewPriority,
      reappearedAfterResultId: reappeared
        ? context.priorState.priorResultId
        : null,
      sourceTimestamps: buildSourceTimestamps(
        context.input,
        context.event,
        new Date().toISOString(),
      ),
      strongestEvidence,
      whyNow:
        reviewPriority?.reasons.join(" · ") ||
        `${eventDescription(context.event)} The game now matches the sourcing criteria you selected.`,
    };
  }
}
