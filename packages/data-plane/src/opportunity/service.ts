import {
  assertOpportunityRuleSet,
  evaluateOpportunityProfile,
} from "./rules.js";
import {
  compilePreviewForRepository,
  OpportunityRepository,
  previewRepresentativeFromInput,
} from "./repository.js";
import type { OpportunityDestinationCipher } from "./delivery-secrets.js";
import type {
  OpportunityBootstrapResponse,
  OpportunityChannelPreferenceSummary,
  OpportunityGameRecord,
  OpportunityIdentity,
  OpportunityPreviewRequest,
  OpportunityPreviewResponse,
  OpportunityProfileDetail,
  OpportunityProfileVersion,
  OpportunityRuleField,
  OpportunityRuleSet,
  OpportunitySignalFamily,
} from "./types.js";

const SIGNAL_FAMILIES = new Set<OpportunitySignalFamily>([
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

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Unsupported timezone: ${timezone}`);
  }
}

export function normalizeOpportunityLocalDeliveryTime(
  value: string | undefined,
): string {
  const normalized = value?.trim() || "09:00";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new Error("Daily delivery time must use 24-hour HH:MM format.");
  }
  return normalized;
}

function assertProfileName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 120) {
    throw new Error("Profile name must contain between 2 and 120 characters.");
  }
}

function assertSignalFamilies(
  values: OpportunitySignalFamily[],
): OpportunitySignalFamily[] {
  const normalized = Array.from(new Set(values));
  for (const value of normalized) {
    if (!SIGNAL_FAMILIES.has(value)) {
      throw new Error(`Unsupported opportunity signal family: ${value}`);
    }
  }
  return normalized;
}

function evenlySample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) {
    return items;
  }
  if (limit <= 1) {
    return [items[0]!];
  }

  const sampled: T[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (items.length - 1)) / (limit - 1));
    if (!seen.has(sourceIndex)) {
      seen.add(sourceIndex);
      sampled.push(items[sourceIndex]!);
    }
  }
  return sampled;
}

const PREVIEW_FIELD_LABELS: Partial<Record<OpportunityRuleField, string>> = {
  ccu_change_30d: "30-day concurrent-player change",
  ccu_change_7d: "7-day concurrent-player change",
  ccu_peak: "peak concurrent players",
  positive_percentage: "positive Steam review rate",
  reviews_added_30d: "Steam reviews added in the last 30 days",
  reviews_added_7d: "Steam reviews added in the last 7 days",
  total_reviews: "total Steam reviews",
};

function previewFieldLabel(field: OpportunityRuleField): string {
  return PREVIEW_FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}

export class OpportunityService {
  constructor(
    private readonly repository: OpportunityRepository,
    private readonly destinationCipher: OpportunityDestinationCipher | null = null,
  ) {}

  getBootstrap(
    identity: OpportunityIdentity,
  ): Promise<OpportunityBootstrapResponse> {
    return this.repository.getBootstrap(identity);
  }

  async previewProfile(
    identity: OpportunityIdentity,
    request: OpportunityPreviewRequest,
  ): Promise<OpportunityPreviewResponse> {
    assertOpportunityRuleSet(request.rules);
    await this.repository.ensureWorkspace(identity);
    const compiled = compilePreviewForRepository(request.rules);
    const [aggregate, inputs, history] = await Promise.all([
      this.repository.getPreviewAggregate(compiled),
      this.repository.getPreviewInputs(request.rules, 80),
      this.repository.getPreviewHistoryEstimate(
        identity.userId,
        request.profileId,
      ),
    ]);
    const evaluated = inputs
      .map((input) => ({
        evaluation: evaluateOpportunityProfile(request.rules, input),
        input,
      }))
      .filter((item) => item.evaluation.outcome === "eligible")
      .sort(
        (left, right) =>
          right.evaluation.preferenceContribution -
            left.evaluation.preferenceContribution ||
          left.input.appid - right.input.appid,
      );
    const representatives = evenlySample(evaluated, 10).map(
      ({ evaluation, input }) =>
        previewRepresentativeFromInput(
          input,
          evaluation.preferredOutcomes
            .filter((outcome) => outcome.state === "true")
            .map((outcome) => outcome.label),
          evaluation.preferenceContribution,
        ),
    );
    const coverage = compiled.coverageFields.map(({ field }) => {
      const knownCount = aggregate.coverage[field] ?? 0;
      return {
        field,
        knownCount,
        percentage:
          aggregate.totalCatalog === 0
            ? 0
            : knownCount / aggregate.totalCatalog,
        totalCount: aggregate.totalCatalog,
      };
    });
    const requiredFields = new Set<OpportunityRuleField>(
      request.rules.required.flatMap((group) =>
        group.clauses.map((clause) => clause.field),
      ),
    );
    const warnings = coverage
      .filter((item) => requiredFields.has(item.field) && item.percentage < 0.6)
      .map(
        (item) =>
          `${previewFieldLabel(item.field)} is currently available for ${(100 * item.percentage).toFixed(0)}% of Steam games. Games without this information will wait until it can be confirmed.`,
      );
    if (
      request.rules.required.some((group) =>
        group.clauses.some((clause) =>
          ["tags", "genres", "categories", "steam_deck"].includes(clause.field),
        ),
      )
    ) {
      warnings.push(
        "Some games do not yet have complete Steam positioning details. They will be checked again when that information becomes available.",
      );
    }
    let previousCount = aggregate.totalCatalog;
    const eliminationFunnel = compiled.requiredStages.map((stage) => {
      const remaining = aggregate.stageCounts[stage.groupId] ?? 0;
      const result = {
        eliminated: Math.max(0, previousCount - remaining),
        groupId: stage.groupId,
        label: stage.label,
        remaining,
      };
      previousCount = remaining;
      return result;
    });

    return {
      coverage,
      eliminationFunnel,
      estimatedDailyVolume: {
        basis:
          history.high === null || history.low === null
            ? "insufficient_history"
            : "run_history",
        high: history.high,
        low: history.low,
      },
      evaluatedCatalogSize: aggregate.totalCatalog,
      representativeMatches: representatives,
      totalMatches: aggregate.totalMatches,
      warnings,
    };
  }

  createProfile(
    identity: OpportunityIdentity,
    params: {
      description?: string | null;
      enabled?: boolean;
      eventSubscriptions: OpportunitySignalFamily[];
      immediateFullMatchEnabled?: boolean;
      localDeliveryTime?: string;
      name: string;
      rules: OpportunityRuleSet;
      sourcePresetVersionId?: string | null;
      timezone: string;
    },
  ): Promise<OpportunityProfileVersion> {
    assertProfileName(params.name);
    assertTimezone(params.timezone);
    assertOpportunityRuleSet(params.rules);

    return this.repository.createProfile({
      description: params.description,
      enabled: params.enabled ?? false,
      eventSubscriptions: assertSignalFamilies(params.eventSubscriptions),
      identity,
      immediateFullMatchEnabled: params.immediateFullMatchEnabled ?? false,
      localDeliveryTime: normalizeOpportunityLocalDeliveryTime(
        params.localDeliveryTime,
      ),
      name: params.name,
      rules: params.rules,
      sourcePresetVersionId: params.sourcePresetVersionId,
      timezone: params.timezone,
    });
  }

  clonePreset(
    identity: OpportunityIdentity,
    params: {
      localDeliveryTime?: string;
      name?: string;
      presetId: string;
      timezone: string;
    },
  ): Promise<OpportunityProfileVersion> {
    if (params.name) {
      assertProfileName(params.name);
    }
    assertTimezone(params.timezone);
    return this.repository.clonePreset({
      ...params,
      identity,
      localDeliveryTime: normalizeOpportunityLocalDeliveryTime(
        params.localDeliveryTime,
      ),
    });
  }

  getProfile(
    identity: OpportunityIdentity,
    params: { profileId: string },
  ): Promise<OpportunityProfileDetail> {
    return this.repository.getProfile({ ...params, identity });
  }

  saveProfileVersion(
    identity: OpportunityIdentity,
    params: {
      description?: string | null;
      eventSubscriptions: OpportunitySignalFamily[];
      immediateFullMatchEnabled: boolean;
      localDeliveryTime?: string;
      name: string;
      profileId: string;
      rules: OpportunityRuleSet;
      timezone: string;
    },
  ): Promise<OpportunityProfileVersion> {
    assertProfileName(params.name);
    assertTimezone(params.timezone);
    assertOpportunityRuleSet(params.rules);

    return this.repository.saveProfileVersion({
      ...params,
      eventSubscriptions: assertSignalFamilies(params.eventSubscriptions),
      identity,
      localDeliveryTime:
        params.localDeliveryTime === undefined
          ? undefined
          : normalizeOpportunityLocalDeliveryTime(params.localDeliveryTime),
    });
  }

  setProfileStatus(
    identity: OpportunityIdentity,
    params: {
      profileId: string;
      status: "enabled" | "paused" | "archived";
    },
  ): Promise<void> {
    return this.repository.setProfileStatus({ ...params, identity });
  }

  getGameRecord(
    identity: OpportunityIdentity,
    params: { appid: number; resultId: string },
  ): Promise<OpportunityGameRecord> {
    if (!Number.isInteger(params.appid) || params.appid <= 0) {
      throw new Error("A positive integer appid is required.");
    }
    return this.repository.getGameRecord({ ...params, identity });
  }

  setGameState(
    identity: OpportunityIdentity,
    params: {
      action: "dismiss" | "ignore" | "restore" | "track" | "untrack";
      appid: number;
      eventFingerprint?: string | null;
    },
  ): Promise<void> {
    if (!Number.isInteger(params.appid) || params.appid <= 0) {
      throw new Error("A positive integer appid is required.");
    }
    return this.repository.setUserGameState({ ...params, identity });
  }

  recordTeamActivity(
    identity: OpportunityIdentity,
    params: {
      activityType: "researching_started" | "researching_cleared";
      appid: number;
      note?: string | null;
    },
  ): Promise<void> {
    if (!Number.isInteger(params.appid) || params.appid <= 0) {
      throw new Error("A positive integer appid is required.");
    }
    return this.repository.recordTeamActivity({
      ...params,
      identity,
      note: params.note ?? null,
    });
  }

  configureChannel(
    identity: OpportunityIdentity,
    params: {
      channel: OpportunityChannelPreferenceSummary["channel"];
      destination?: string | null;
      enabled: boolean;
      immediateFullMatchEnabled: boolean;
      maxResults: number;
      profileId?: string | null;
      quietDayBehavior: OpportunityChannelPreferenceSummary["quietDayBehavior"];
    },
  ): Promise<OpportunityChannelPreferenceSummary> {
    if (
      !Number.isInteger(params.maxResults) ||
      params.maxResults < 1 ||
      params.maxResults > 100
    ) {
      throw new Error("Channel result limit must be between 1 and 100.");
    }
    if (
      params.quietDayBehavior !== "skip" &&
      params.quietDayBehavior !== "send_empty"
    ) {
      throw new Error("Quiet-day behavior must be skip or send_empty.");
    }

    let destination: string | null = null;
    let destinationLabel: string | null = null;
    if (params.channel === "email") {
      destination = identity.email;
      destinationLabel = identity.email;
      if (params.enabled && !destination) {
        throw new Error("The verified Supabase identity has no email address.");
      }
    } else if (params.channel === "slack") {
      destination = params.destination?.trim() || null;
      if (params.enabled && !destination) {
        throw new Error("A Slack incoming-webhook URL is required.");
      }
      if (destination) {
        const url = new URL(destination);
        if (
          url.protocol !== "https:" ||
          !["hooks.slack.com", "hooks.slack-gov.com"].includes(url.hostname) ||
          !url.pathname.startsWith("/services/")
        ) {
          throw new Error(
            "Slack destination must be an HTTPS incoming-webhook URL.",
          );
        }
        destinationLabel = `Slack webhook •••${url.pathname.slice(-6)}`;
      }
    } else {
      destinationLabel = "Canonical website";
    }

    if (destination && !this.destinationCipher) {
      throw new Error("Opportunity delivery encryption is not configured.");
    }

    return this.repository.upsertChannelPreference({
      channel: params.channel,
      destinationCiphertext:
        destination && this.destinationCipher
          ? this.destinationCipher.encrypt(destination)
          : null,
      destinationLabel,
      enabled: params.enabled,
      identity,
      immediateFullMatchEnabled: params.immediateFullMatchEnabled,
      maxResults: params.maxResults,
      profileId: params.profileId,
      quietDayBehavior: params.quietDayBehavior,
    });
  }
}
