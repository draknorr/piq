import type {
  OpportunityBriefProfileDispatch,
  OpportunityBriefProfileStats,
  OpportunityDailyBriefIssue,
  OpportunityProfileSummary,
  OpportunityResultLabel,
  OpportunityResultSummary,
} from "./types.js";

const EVENT_LABELS: OpportunityResultLabel[] = [
  "newly_qualified",
  "materially_changed",
  "newly_discovered",
  "newly_released",
  "tracked_update",
];

const EVENT_NOUNS: Record<
  OpportunityResultLabel,
  { plural: string; singular: string }
> = {
  materially_changed: {
    plural: "material changes",
    singular: "material change",
  },
  newly_discovered: {
    plural: "new discoveries",
    singular: "new discovery",
  },
  newly_qualified: { plural: "new matches", singular: "new match" },
  newly_released: { plural: "new releases", singular: "new release" },
  tracked_update: { plural: "tracked updates", singular: "tracked update" },
};

export function emptyOpportunityEventCounts(): Record<
  OpportunityResultLabel,
  number
> {
  return {
    materially_changed: 0,
    newly_discovered: 0,
    newly_qualified: 0,
    newly_released: 0,
    tracked_update: 0,
  };
}

function compareResults(
  left: OpportunityResultSummary,
  right: OpportunityResultSummary,
): number {
  const scoreDifference = (right.score ?? -1) - (left.score ?? -1);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  const createdDifference =
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  return createdDifference || left.id.localeCompare(right.id);
}

export function dedupeOpportunityBriefGames(
  results: OpportunityResultSummary[],
): OpportunityResultSummary[] {
  const byAppid = new Map<number, OpportunityResultSummary>();
  for (const result of [...results].sort(compareResults)) {
    const existing = byAppid.get(result.appid);
    if (!existing) {
      byAppid.set(result.appid, {
        ...result,
        matchedProfiles: [...result.matchedProfiles].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      });
      continue;
    }
    const profiles = new Map(
      existing.matchedProfiles.map((profile) => [profile.id, profile]),
    );
    result.matchedProfiles.forEach((profile) =>
      profiles.set(profile.id, profile),
    );
    existing.matchedProfiles = Array.from(profiles.values()).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
  }
  return Array.from(byAppid.values()).sort(compareResults);
}

function dominantEventLabel(
  counts: Record<OpportunityResultLabel, number>,
): OpportunityResultLabel | null {
  return EVENT_LABELS.reduce<OpportunityResultLabel | null>(
    (selected, label) => {
      if (counts[label] <= 0) {
        return selected;
      }
      if (!selected || counts[label] > counts[selected]) {
        return label;
      }
      return selected;
    },
    null,
  );
}

function profileSummary(
  profile: OpportunityProfileSummary,
  stats: OpportunityBriefProfileStats,
): string {
  if (profile.status !== "enabled") {
    return "This profile was not monitored in this issue.";
  }
  if (stats.resultCount === 0) {
    return "No game crossed this profile’s sourcing criteria in this issue.";
  }
  const eventLabel = dominantEventLabel(stats.eventCounts);
  const eventCount = eventLabel ? stats.eventCounts[eventLabel] : 0;
  const movement = eventLabel
    ? `${eventCount} ${eventCount === 1 ? EVENT_NOUNS[eventLabel].singular : EVENT_NOUNS[eventLabel].plural}`
    : `${stats.resultCount} matching games`;
  const lead = stats.topResult ? `, led by ${stats.topResult.name}` : "";
  return `${stats.resultCount} ${stats.resultCount === 1 ? "game matched" : "games matched"}; ${movement}${lead}.`;
}

function buildProfileDispatches(params: {
  profiles: OpportunityProfileSummary[];
  profileStats: OpportunityBriefProfileStats[];
  runId: string | null;
}): OpportunityBriefProfileDispatch[] {
  const byProfile = new Map(
    params.profileStats.map((stats) => [stats.profileId, stats]),
  );
  return params.profiles
    .filter((profile) => profile.status !== "archived")
    .map((profile) => {
      const stats = byProfile.get(profile.id) ?? {
        eventCounts: emptyOpportunityEventCounts(),
        highConfidenceCount: 0,
        profileId: profile.id,
        resultCount: 0,
        topResult: null,
      };
      const query = new URLSearchParams({
        profile: profile.id,
        tab: "profile-lists",
      });
      if (params.runId) {
        query.set("run", params.runId);
      }
      return {
        description: profile.description,
        eventCounts: stats.eventCounts,
        highConfidenceCount: stats.highConfidenceCount,
        id: profile.id,
        listUrl: `/opportunities?${query.toString()}`,
        name: profile.name,
        resultCount: stats.resultCount,
        status: profile.status,
        summary: profileSummary(profile, stats),
        topResult: stats.topResult,
      };
    });
}

export function buildOpportunityDailyBriefIssue(params: {
  availableResultCount: number;
  coverageWarnings: string[];
  featuredCandidates: OpportunityResultSummary[];
  featuredLimit?: number;
  highConfidenceCount: number;
  issueDate: string | null;
  newerRunUpdating: boolean;
  profiles: OpportunityProfileSummary[];
  profilesEvaluated: number;
  profileStats: OpportunityBriefProfileStats[];
  runId: string | null;
  status: OpportunityDailyBriefIssue["status"];
  windowEnd: string | null;
  windowStart: string | null;
}): OpportunityDailyBriefIssue {
  const featuredGames = dedupeOpportunityBriefGames(
    params.featuredCandidates,
  ).slice(0, Math.max(1, Math.min(100, params.featuredLimit ?? 10)));
  const lead = featuredGames[0] ?? null;
  const headline =
    params.status === "not_run"
      ? "Your first sourcing issue is waiting"
      : params.availableResultCount === 0
        ? "A quiet day across your sourcing profiles"
        : lead
          ? `${lead.name} leads ${params.availableResultCount} ${params.availableResultCount === 1 ? "opportunity" : "opportunities"} today`
          : `${params.availableResultCount} ${params.availableResultCount === 1 ? "game is" : "games are"} worth reviewing today`;
  const dek =
    params.availableResultCount === 0
      ? "No game crossed an enabled profile’s criteria, but PublisherIQ is continuing to watch Steam for meaningful movement."
      : `${params.profilesEvaluated} ${params.profilesEvaluated === 1 ? "profile surfaced" : "profiles surfaced"} today’s matches. ${params.highConfidenceCount} ${params.highConfidenceCount === 1 ? "game carries" : "games carry"} high-confidence evidence.`;

  return {
    availableResultCount: params.availableResultCount,
    coverageWarnings: Array.from(new Set(params.coverageWarnings)),
    dek,
    featuredGames,
    headline,
    highConfidenceCount: params.highConfidenceCount,
    issueDate: params.issueDate,
    newerRunUpdating: params.newerRunUpdating,
    profileDispatches: buildProfileDispatches(params),
    profilesEvaluated: params.profilesEvaluated,
    runId: params.runId,
    status: params.status,
    windowEnd: params.windowEnd,
    windowStart: params.windowStart,
  };
}
