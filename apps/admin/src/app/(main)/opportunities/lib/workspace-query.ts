import type { OpportunityResultLabel } from "./types";

export type OpportunityWorkspaceTab =
  | "daily-brief"
  | "profile-lists"
  | "profiles"
  | "delivery";

const WORKSPACE_TABS = new Set<OpportunityWorkspaceTab>([
  "daily-brief",
  "profile-lists",
  "profiles",
  "delivery",
]);

const EVENT_FILTERS = new Set<OpportunityResultLabel>([
  "materially_changed",
  "newly_discovered",
  "newly_qualified",
  "newly_released",
  "tracked_update",
]);

export function parseOpportunityWorkspaceTab(
  value: string | null,
): OpportunityWorkspaceTab {
  return value && WORKSPACE_TABS.has(value as OpportunityWorkspaceTab)
    ? (value as OpportunityWorkspaceTab)
    : "daily-brief";
}

export function parseOpportunityEventFilter(
  value: string | null,
): OpportunityResultLabel | null {
  return value && EVENT_FILTERS.has(value as OpportunityResultLabel)
    ? (value as OpportunityResultLabel)
    : null;
}
