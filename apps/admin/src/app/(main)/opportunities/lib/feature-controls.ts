const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OpportunityWorkspaceFeatureControl {
  allWorkspaces: boolean;
  enabled: boolean;
  workspaceIds: ReadonlySet<string>;
}

export function createOpportunityWorkspaceFeatureControl(
  enabledValue: string | undefined,
  workspaceIdsValue: string | undefined,
): OpportunityWorkspaceFeatureControl {
  if (enabledValue !== "1") {
    return {
      allWorkspaces: false,
      enabled: false,
      workspaceIds: new Set<string>(),
    };
  }

  const entries = (workspaceIdsValue ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(
      "Opportunity v2 presentation requires a workspace allowlist or '*'.",
    );
  }
  if (entries.includes("*")) {
    if (entries.length !== 1) {
      throw new Error(
        "Opportunity v2 presentation '*' scope cannot be combined with workspace IDs.",
      );
    }
    return {
      allWorkspaces: true,
      enabled: true,
      workspaceIds: new Set<string>(),
    };
  }
  const invalid = entries.find((entry) => !WORKSPACE_ID_PATTERN.test(entry));
  if (invalid) {
    throw new Error(
      `Opportunity v2 presentation workspace scope contains an invalid UUID: ${invalid}`,
    );
  }
  return {
    allWorkspaces: false,
    enabled: true,
    workspaceIds: new Set(entries),
  };
}

const PRESENTATION_CONTROL = createOpportunityWorkspaceFeatureControl(
  process.env.NEXT_PUBLIC_OPPORTUNITY_PRIORITY_V2_PRESENTATION,
  process.env.NEXT_PUBLIC_OPPORTUNITY_PRIORITY_V2_PRESENTATION_WORKSPACE_IDS,
);

export function isOpportunityPriorityV2PresentationEnabled(
  workspaceId: string,
): boolean {
  return (
    PRESENTATION_CONTROL.enabled &&
    (PRESENTATION_CONTROL.allWorkspaces ||
      PRESENTATION_CONTROL.workspaceIds.has(workspaceId.toLowerCase()))
  );
}
