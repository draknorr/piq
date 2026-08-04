import {
  assertOpportunityRuleSet,
  evaluateOpportunityProfile,
} from "./rules.js";
import {
  compilePreviewForRepository,
  OpportunityRepository,
  previewRepresentativeFromInput,
  type OpportunityPreviewCatalog,
} from "./repository.js";
import type { OpportunityCompiledPreview } from "./sql-compiler.js";
import type { OpportunityDestinationCipher } from "./delivery-secrets.js";
import {
  resolveSteamTrailerManifests,
  type OpportunityTrailerManifestResolver,
} from "./steam-trailer-resolver.js";
import type {
  OpportunityBootstrapResponse,
  OpportunityChannelPreferenceSummary,
  OpportunityDailyBriefIssue,
  OpportunityGameRecord,
  OpportunityIdentity,
  OpportunityPreviewRequest,
  OpportunityPreviewResponse,
  OpportunityProfileDetail,
  OpportunityProfileVersion,
  OpportunityResultLabel,
  OpportunityResultPage,
  OpportunityRuleField,
  OpportunityRuleSet,
  OpportunitySignalFamily,
  OpportunityTrailerStreamsResponse,
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
  app_type: "Steam app type",
  appid: "Steam app ID",
  categories: "Steam features",
  ccu_change_30d: "30-day concurrent-player change",
  ccu_change_7d: "7-day concurrent-player change",
  ccu_peak: "peak concurrent players",
  content_descriptors: "content descriptors",
  controller_support: "controller support",
  days_until_release: "time until release",
  developer: "developer",
  developer_game_count: "developer's Steam releases",
  discount_percent: "current discount",
  demo_only: "demo-only status",
  genres: "Steam genres",
  has_demo: "playable demo availability",
  has_purchase_packages: "purchase availability",
  is_free: "free-to-play status",
  is_released: "release status",
  languages: "language support",
  name: "game name",
  no_publisher_listed: "publisher listing",
  platforms: "platform support",
  positive_percentage: "positive Steam review rate",
  price_cents: "Steam price",
  publisher: "publisher",
  publisher_game_count: "publisher's Steam releases",
  publisheriq_added_at: "PublisherIQ added date",
  release_date: "release date",
  release_state: "release status",
  reviews_added_30d: "Steam reviews added in the last 30 days",
  reviews_added_7d: "Steam reviews added in the last 7 days",
  self_published: "self-published status",
  steam_deck: "Steam Deck support",
  tags: "Steam tags",
  total_reviews: "total Steam reviews",
};

function previewFieldLabel(field: OpportunityRuleField): string {
  return PREVIEW_FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}

export class OpportunityService {
  private readonly previewCatalogInFlight = new Map<
    string,
    Promise<OpportunityPreviewCatalog>
  >();
  private readonly trailerManifestCache = new Map<
    number,
    {
      expiresAt: number;
      manifests: Awaited<ReturnType<OpportunityTrailerManifestResolver>>;
    }
  >();

  constructor(
    private readonly repository: OpportunityRepository,
    private readonly destinationCipher: OpportunityDestinationCipher | null = null,
    private readonly trailerManifestResolver: OpportunityTrailerManifestResolver = resolveSteamTrailerManifests,
  ) {}

  private getPreviewCatalog(
    compiled: OpportunityCompiledPreview,
  ): Promise<OpportunityPreviewCatalog> {
    const key = JSON.stringify(compiled);
    const existing = this.previewCatalogInFlight.get(key);
    if (existing) {
      return existing;
    }
    const pending = this.repository.getPreviewCatalog(compiled, 80);
    this.previewCatalogInFlight.set(key, pending);
    void pending.then(
      () => {
        if (this.previewCatalogInFlight.get(key) === pending) {
          this.previewCatalogInFlight.delete(key);
        }
      },
      () => {
        if (this.previewCatalogInFlight.get(key) === pending) {
          this.previewCatalogInFlight.delete(key);
        }
      },
    );
    return pending;
  }

  getBootstrap(
    identity: OpportunityIdentity,
  ): Promise<OpportunityBootstrapResponse> {
    return this.repository.getBootstrap(identity);
  }

  getDailyBrief(
    identity: OpportunityIdentity,
    params: { runId?: string | null } = {},
  ): Promise<OpportunityDailyBriefIssue> {
    if (params.runId !== undefined && params.runId !== null) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          params.runId,
        )
      ) {
        throw new Error("A valid opportunity run ID is required.");
      }
    }
    return this.repository.getDailyBrief(identity, params);
  }

  listResults(
    identity: OpportunityIdentity,
    params: {
      cursor?: string | null;
      eventLabel?: OpportunityResultLabel | null;
      profileId?: string | null;
      runId: string;
    },
  ): Promise<OpportunityResultPage> {
    const eventLabels = new Set<OpportunityResultLabel>([
      "materially_changed",
      "newly_discovered",
      "newly_qualified",
      "newly_released",
      "tracked_update",
    ]);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.runId,
      )
    ) {
      throw new Error("A valid opportunity run ID is required.");
    }
    if (
      params.profileId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.profileId,
      )
    ) {
      throw new Error("A valid opportunity profile ID is required.");
    }
    if (params.eventLabel && !eventLabels.has(params.eventLabel)) {
      throw new Error("The opportunity event filter is not supported.");
    }
    return this.repository.listResults(identity, params);
  }

  async previewProfile(
    identity: OpportunityIdentity,
    request: OpportunityPreviewRequest,
  ): Promise<OpportunityPreviewResponse> {
    assertOpportunityRuleSet(request.rules);
    const timezone = request.timezone ?? "UTC";
    assertTimezone(timezone);
    const evaluation = {
      asOf: new Date().toISOString(),
      timezone,
    };
    const compiled = compilePreviewForRepository(request.rules, evaluation);
    const [catalog, history] = await Promise.all([
      this.getPreviewCatalog(compiled),
      this.repository.getPreviewHistoryEstimate(
        identity.userId,
        request.profileId,
      ),
    ]);
    const { aggregate, inputs } = catalog;
    const evaluated = inputs
      .map((input) => ({
        evaluation: evaluateOpportunityProfile(
          request.rules,
          input,
          evaluation,
        ),
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

  async resolveTrailerStreams(
    identity: OpportunityIdentity,
    params: { appid: number; trailerIds: number[] },
  ): Promise<OpportunityTrailerStreamsResponse> {
    if (!identity.userId) {
      throw new Error("An authenticated user is required.");
    }
    if (!Number.isInteger(params.appid) || params.appid <= 0) {
      throw new Error("A positive integer appid is required.");
    }
    if (!Array.isArray(params.trailerIds) || params.trailerIds.length > 20) {
      throw new Error("No more than 20 trailer IDs may be resolved at once.");
    }
    const trailerIds = Array.from(new Set(params.trailerIds));
    if (
      trailerIds.some(
        (trailerId) => !Number.isInteger(trailerId) || trailerId <= 0,
      )
    ) {
      throw new Error("Trailer IDs must be positive integers.");
    }
    if (trailerIds.length === 0) {
      return { streams: [] };
    }

    const cached = this.trailerManifestCache.get(params.appid);
    const manifests =
      cached && cached.expiresAt > Date.now()
        ? cached.manifests
        : await this.trailerManifestResolver(params.appid);
    if (!cached || cached.expiresAt <= Date.now()) {
      if (this.trailerManifestCache.size >= 200) {
        const oldestKey = this.trailerManifestCache.keys().next().value;
        if (typeof oldestKey === "number") {
          this.trailerManifestCache.delete(oldestKey);
        }
      }
      this.trailerManifestCache.set(params.appid, {
        expiresAt: Date.now() + 15 * 60 * 1000,
        manifests,
      });
    }
    const byId = new Map(
      manifests.map((manifest) => [manifest.mediaId, manifest.hlsUrl]),
    );
    return {
      streams: trailerIds.map((id) => ({ hlsUrl: byId.get(id) ?? null, id })),
    };
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
