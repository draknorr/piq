import { createHash, randomUUID } from "node:crypto";

import {
  calculateOpportunityMarketContext,
  calculateOpportunityPresetHealth,
  calculateOpportunityRanking,
} from "./intelligence.js";
import {
  evaluateOpportunityProfile,
  supportsReleasedMarketHealth,
} from "./rules.js";
import type {
  OpportunityEvaluationInput,
  OpportunityFieldValue,
  OpportunityProfileEvaluation,
  OpportunityRankComponents,
  OpportunityResultLabel,
  OpportunityRuleField,
} from "./types.js";
import type {
  OpportunityCandidateEvaluation,
  OpportunityEvaluatedMatch,
  OpportunityEvaluatedResult,
  OpportunityPriorUserState,
  OpportunityReleasedCohortCache,
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
  websiteBaseUrl: string;
  workerId?: string;
}

interface EvaluationContext {
  appid: number;
  candidateOutcomes: Map<
    string,
    "eligible" | "ineligible" | "pending" | "expired"
  >;
  cohortCache?: OpportunityReleasedCohortCache;
  event: OpportunityWorkerMaterialEvent;
  input: OpportunityEvaluationInput;
  priorState: OpportunityPriorUserState;
  profiles: OpportunityWorkerProfile[];
  run: OpportunityRunContext;
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
    {
      announcement: "PublisherIQ observed a new official announcement.",
      business_model_changed: "The game changed its price or business model.",
      ccu_breakthrough:
        "The game crossed a material concurrent-player threshold.",
      demo_added: "A playable demo became available.",
      developer_changed: "The listed developer relationship changed.",
      first_observed: "PublisherIQ observed this Steam app for the first time.",
      material_change: "A subscribed material Steam signal changed.",
      platform_expanded:
        "The game expanded its platform or accessibility support.",
      publisher_changed: "The listed publisher relationship changed.",
      release_timing_changed: "The announced release timing changed.",
      released: "The game transitioned to released.",
      review_breakthrough: "Review activity crossed a material threshold.",
      store_readiness_improved:
        "The Steam store presentation became more complete.",
      taxonomy_repositioned:
        "The game changed its tags, genres, or categories.",
      tracked_update: "A tracked title received a subscribed update.",
    }[event.eventType] ?? "A material Steam signal changed."
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
): Array<Record<string, unknown>> {
  const labels: Array<[OpportunityRuleField, string]> = [
    ["release_state", "Release state"],
    ["tags", "Steam tags"],
    ["has_demo", "Playable demo"],
    ["total_reviews", "Total reviews"],
    ["reviews_added_30d", "Reviews added (30d)"],
    ["ccu_peak", "CCU peak"],
  ];
  return labels.flatMap(([field, label]) => {
    const evidence = input.fields[field];
    if (!evidence || evidence.state !== "known") {
      return [];
    }
    return [
      {
        confidence: evidence.confidence,
        evidenceClass: evidence.evidenceClass,
        label,
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
  private readonly websiteBaseUrl: string;
  readonly workerId: string;

  constructor(
    private readonly repository: OpportunityWorkerRepository,
    options: OpportunityWorkerOptions,
  ) {
    this.claimLimit = Math.max(1, Math.min(50, options.claimLimit ?? 8));
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
      const events = await this.repository.getRunMaterialEvents(
        run,
        item.appid,
        item.materialEventId,
      );
      const selectedByAppid = new Map<number, OpportunityWorkerMaterialEvent>();
      for (const event of events) {
        if (!selectedByAppid.has(event.appid)) {
          selectedByAppid.set(event.appid, event);
        }
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
      const cohortCache = this.repository.createReleasedCohortCache();

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
        const outcome = await this.evaluateGame({
          appid: event.appid,
          candidateOutcomes,
          cohortCache,
          event,
          input,
          priorState,
          profiles,
          run,
        });
        evaluations.push(...outcome.evaluations);
        pending.push(
          ...outcome.evaluations.filter(
            (candidate) => candidate.evaluation.outcome === "pending",
          ),
        );
        if (outcome.result) {
          results.push(outcome.result);
        }
      }

      await this.repository.heartbeatWork(item.id, this.workerId);
      results.sort(
        (left, right) =>
          right.rank.finalScore - left.rank.finalScore ||
          left.appid - right.appid,
      );
      await this.repository.persistRunOutcome({
        evaluations,
        pending,
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

  private async evaluateGame(context: EvaluationContext): Promise<{
    evaluations: OpportunityCandidateEvaluation[];
    result: OpportunityEvaluatedResult | null;
  }> {
    const evaluated = context.profiles.map((profile) => {
      const evaluation = evaluateOpportunityProfile(
        profile.rules,
        context.input,
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
      return { evaluations, result: null };
    }

    const matches: OpportunityEvaluatedMatch[] = eligible.map(
      ({ evaluation, profile }) => ({ evaluation, profile }),
    );
    const cohort = await this.repository.getReleasedCohort(
      context.input,
      context.cohortCache,
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
    const evidenceItems = buildEvidenceItems(context.input);
    const preferenceEvidence = matches.flatMap((match) =>
      match.evaluation.preferredOutcomes
        .filter((outcome) => outcome.state === "true")
        .map((outcome) => outcome.label),
    );
    const tags = fieldExplanation(context.input.fields.tags);
    const strongestEvidence = Array.from(
      new Set(
        [
          eventDescription(context.event),
          ...preferenceEvidence,
          tags ? `Positioned around ${tags}` : null,
        ].filter((item): item is string => Boolean(item)),
      ),
    ).slice(0, 4);
    const reappeared =
      context.priorState.dismissedEventFingerprint &&
      context.priorState.dismissedEventFingerprint !==
        context.event.eventFingerprint;

    return {
      evaluations,
      result: {
        appid: context.appid,
        cohort,
        confidence:
          market.confidence === "high" && components.evidenceQuality >= 0.8
            ? "high"
            : "directional",
        event: context.event,
        eventLabel: label,
        evidenceItems,
        market,
        matches,
        missingEvidence,
        profileVersionSetFingerprint: stableFingerprint(
          matches.map((match) => match.profile.versionId),
        ),
        rank,
        reappearedAfterResultId: reappeared
          ? context.priorState.priorResultId
          : null,
        sourceTimestamps: buildSourceTimestamps(
          context.input,
          context.event,
          new Date().toISOString(),
        ),
        strongestEvidence,
        whyNow: `${eventDescription(context.event)} It now qualifies for ${matches.map((match) => match.profile.name).join(", ")}.`,
      },
    };
  }
}
