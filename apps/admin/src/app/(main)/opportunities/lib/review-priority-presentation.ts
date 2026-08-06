import type {
  OpportunityBootstrap,
  OpportunityBriefProfileDispatch,
  OpportunityReviewPriorityDecision,
  OpportunityReviewPrioritySummary,
  OpportunityResultSummary,
} from "./types";
import { opportunityPotentialLabel } from "./api";

const POST_RELEASE_TRACTION_INPUT_KEYS = new Set([
  "ccu_change_30d",
  "ccu_change_7d",
  "ccu_peak",
  "reviews_added_30d",
  "reviews_added_7d",
  "total_reviews",
]);

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

function normalizedPresentationText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function opportunityVisibleReviewReasons(
  result: OpportunityResultSummary,
): string[] {
  if (!result.reviewPriority) return [];
  const marketLabel = normalizedPresentationText(
    opportunityPotentialLabel(result.marketPotential),
  );
  return result.reviewPriority.reasons
    .filter((reason) => normalizedPresentationText(reason) !== marketLabel)
    .slice(0, 3);
}

export function opportunityTractionIsNotApplicable(record: {
  matchedProfiles: Array<{
    id: string;
    reviewPriority: OpportunityReviewPriorityDecision | null;
  }>;
  result: { reviewPriority: OpportunityReviewPrioritySummary | null };
}): boolean {
  const summary = record.result.reviewPriority;
  if (!summary || summary.lane !== "new_game") return false;
  const decision = record.matchedProfiles.find(
    (profile) => profile.id === summary.winningProfileId,
  )?.reviewPriority;
  if (!decision) return false;
  const tractionInputs = decision.inputs.filter((input) =>
    POST_RELEASE_TRACTION_INPUT_KEYS.has(input.key),
  );
  return (
    tractionInputs.length === POST_RELEASE_TRACTION_INPUT_KEYS.size &&
    tractionInputs.every((input) => input.availability === "not_applicable")
  );
}

export function opportunityNotApplicablePeerSummary(record: {
  marketContext: null | {
    distributions: Record<string, { measured: number; p50: number | null }>;
  };
}): string | null {
  const totalReviews = record.marketContext?.distributions.totalReviews;
  if (!totalReviews || totalReviews.measured <= 0) return null;
  const measured = totalReviews.measured.toLocaleString();
  if (totalReviews.p50 === null) {
    return `${measured} comparable released games informed the market context.`;
  }
  return `${measured} comparable released games informed the market context; their median total Steam reviews were ${totalReviews.p50.toLocaleString()}.`;
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
