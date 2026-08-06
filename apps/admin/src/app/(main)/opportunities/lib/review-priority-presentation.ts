import type {
  OpportunityBootstrap,
  OpportunityBriefProfileDispatch,
  OpportunityResultSummary,
} from "./types";

export interface OpportunityResultSection {
  key: string;
  kicker: string;
  results: OpportunityResultSummary[];
  title: string;
}

const LEGACY_RESULT_SECTIONS: Array<{
  key: keyof OpportunityBootstrap["dailyOverview"]["groups"];
  kicker: string;
  title: string;
}> = [
  {
    key: "newlyDiscovered",
    kicker: "New to your search",
    title: "New discoveries",
  },
  {
    key: "newlyReleased",
    kicker: "Just launched",
    title: "Newly released",
  },
  {
    key: "newlyQualified",
    kicker: "New match",
    title: "Newly qualified",
  },
  {
    key: "materiallyChanged",
    kicker: "Commercial change",
    title: "Material changes",
  },
  { key: "trackedUpdates", kicker: "You follow", title: "Tracked updates" },
];

export function opportunityPriorityLabel(
  result: OpportunityResultSummary,
): string {
  if (!result.reviewPriority) return "Legacy result";
  const lane = {
    material_change: "Material change",
    new_game: "New discovery",
    traction: "Traction",
  }[result.reviewPriority.lane];
  const band = {
    monitor: "Monitor",
    review_now: "Review now",
    review_soon: "Review soon",
  }[result.reviewPriority.priorityBand];
  return `${lane} — ${band}`;
}

export function opportunityResultDescription(
  result: OpportunityResultSummary,
): string {
  return (
    result.gameDescription?.text ??
    "Steam has not provided a short description for this game yet."
  );
}

export function opportunityProfileDispatchSummary(
  profile: OpportunityBriefProfileDispatch,
): string {
  if (profile.status !== "enabled" || profile.resultCount === 0) {
    return profile.summary;
  }
  const lead = profile.topResult ? `, led by ${profile.topResult.name}` : "";
  return `${profile.resultCount} ${profile.resultCount === 1 ? "game matched" : "games matched"}${lead}.`;
}

export function opportunityResultSections(params: {
  groups: OpportunityBootstrap["dailyOverview"]["groups"];
  presentReviewPriorityV2: boolean;
  results: OpportunityResultSummary[];
}): OpportunityResultSection[] {
  if (params.presentReviewPriorityV2) {
    return params.results.length === 0
      ? []
      : [
          {
            key: "review-priority",
            kicker: "Review priority",
            results: params.results,
            title: "Ordered for review",
          },
        ];
  }

  return LEGACY_RESULT_SECTIONS.flatMap((section) => {
    const results = params.groups[section.key];
    return results.length > 0 ? [{ ...section, results }] : [];
  });
}
