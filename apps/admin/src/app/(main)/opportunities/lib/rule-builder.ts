import type { OpportunityRuleGroup, OpportunityRuleSet } from "./types";

export type OpportunityRuleShortcut = "demo_only" | "undated_unreleased";

export function upgradeOpportunityRules(
  rules: OpportunityRuleSet,
  today: string,
): OpportunityRuleSet {
  const upgradeGroup = (group: OpportunityRuleGroup): OpportunityRuleGroup => ({
    ...group,
    clauses: group.clauses.map((clause) => {
      if (
        (clause.field === "release_date" ||
          clause.field === "publisheriq_added_at") &&
        clause.operator !== "exists" &&
        clause.operator !== "not_exists" &&
        (typeof clause.value === "string" || clause.value === undefined)
      ) {
        return {
          ...clause,
          value: {
            date:
              typeof clause.value === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(clause.value)
                ? clause.value
                : today,
            kind: "absolute_date",
          },
        };
      }
      return clause;
    }),
  });
  return {
    excluded: rules.excluded.map(upgradeGroup),
    preferred: rules.preferred.map(upgradeGroup),
    required: rules.required.map(upgradeGroup),
    schemaVersion: "opportunity-rules/v2",
  };
}

export function createOpportunityShortcutGroup(
  shortcut: OpportunityRuleShortcut,
  createId: (prefix: string) => string,
): OpportunityRuleGroup {
  if (shortcut === "demo_only") {
    return {
      clauses: [
        {
          field: "demo_only",
          id: createId("rule"),
          label: "Only demo available",
          operator: "equals",
          value: true,
        },
      ],
      id: createId("shortcut"),
      label: "Only demo available",
      operator: "all",
    };
  }
  return {
    clauses: [
      {
        field: "is_released",
        id: createId("rule"),
        label: "Is released",
        operator: "equals",
        value: false,
      },
      {
        field: "release_date",
        id: createId("rule"),
        label: "Steam launch date",
        operator: "not_exists",
      },
    ],
    id: createId("shortcut"),
    label: "Unreleased date TBD",
    operator: "all",
  };
}
