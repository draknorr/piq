const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OpportunityWorkspaceFeatureControl {
  allWorkspaces: boolean;
  enabled: boolean;
  workspaceIds: ReadonlySet<string>;
}

export interface OpportunityPriorityV2OrderControl extends OpportunityWorkspaceFeatureControl {
  allPolicies: boolean;
}

export const DISABLED_OPPORTUNITY_WORKSPACE_FEATURE_CONTROL: OpportunityWorkspaceFeatureControl =
  {
    allWorkspaces: false,
    enabled: false,
    workspaceIds: new Set<string>(),
  };

export function createOpportunityWorkspaceFeatureControl(
  enabledValue: string | undefined,
  workspaceIdsValue: string | undefined,
): OpportunityWorkspaceFeatureControl {
  if (enabledValue !== "1") {
    return DISABLED_OPPORTUNITY_WORKSPACE_FEATURE_CONTROL;
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

export function isOpportunityWorkspaceFeatureEnabled(
  control: OpportunityWorkspaceFeatureControl,
  workspaceId: string,
): boolean {
  return (
    control.enabled &&
    (control.allWorkspaces ||
      control.workspaceIds.has(workspaceId.toLowerCase()))
  );
}

export function createOpportunityPriorityV2OrderControl(params: {
  discovery: string | undefined;
  materialChanges: string | undefined;
  traction: string | undefined;
  workspaceIds: string | undefined;
}): OpportunityPriorityV2OrderControl {
  const enabledPolicies = [
    params.discovery === "1",
    params.traction === "1",
    params.materialChanges === "1",
  ];
  if (enabledPolicies.every((enabled) => !enabled)) {
    return {
      ...DISABLED_OPPORTUNITY_WORKSPACE_FEATURE_CONTROL,
      allPolicies: false,
    };
  }
  if (!enabledPolicies.every(Boolean)) {
    throw new Error(
      "Opportunity v2 ordering currently requires all three policy controls to change atomically.",
    );
  }
  return {
    ...createOpportunityWorkspaceFeatureControl("1", params.workspaceIds),
    allPolicies: true,
  };
}
