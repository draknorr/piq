import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityClauseOutcome,
  type OpportunityEvaluationInput,
  type OpportunityFieldValue,
  type OpportunityGroupOutcome,
  type OpportunityPreferredRuleGroup,
  type OpportunityPreferenceImportance,
  type OpportunityProfileEvaluation,
  type OpportunityRuleClause,
  type OpportunityRuleField,
  type OpportunityRuleGroup,
  type OpportunityRuleOperator,
  type OpportunityRuleSet,
  type OpportunityRuleValue,
  type OpportunityTriState,
} from "./types.js";

const IMPORTANCE_WEIGHT: Record<OpportunityPreferenceImportance, number> = {
  high: 3,
  low: 1,
  medium: 2,
};

const SUPPORTED_OPERATORS = new Set<OpportunityRuleOperator>([
  "equals",
  "not_equals",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "between",
  "exists",
  "not_exists",
]);

const SUPPORTED_FIELDS = new Set<OpportunityRuleField>([
  "appid",
  "name",
  "app_type",
  "developer",
  "publisher",
  "release_state",
  "is_released",
  "release_date",
  "days_until_release",
  "tags",
  "genres",
  "categories",
  "is_free",
  "price_cents",
  "discount_percent",
  "has_purchase_packages",
  "platforms",
  "controller_support",
  "steam_deck",
  "languages",
  "has_demo",
  "no_publisher_listed",
  "self_published",
  "publisher_game_count",
  "developer_game_count",
  "content_descriptors",
  "total_reviews",
  "positive_percentage",
  "reviews_added_7d",
  "reviews_added_30d",
  "ccu_peak",
  "ccu_change_7d",
  "ccu_change_30d",
]);

function clauseRequiresUnreleasedGame(clause: OpportunityRuleClause): boolean {
  return (
    clause.field === "is_released" &&
    ((clause.operator === "equals" && clause.value === false) ||
      (clause.operator === "not_equals" && clause.value === true))
  );
}

export function supportsReleasedMarketHealth(
  rules: OpportunityRuleSet,
): boolean {
  return !rules.required.some((group) =>
    group.operator === "all"
      ? group.clauses.some(clauseRequiresUnreleasedGame)
      : group.clauses.length > 0 &&
        group.clauses.every(clauseRequiresUnreleasedGame),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asComparable(value: unknown): boolean | number | string | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  return JSON.stringify(value);
}

function compareEquality(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected === "string") {
    return (
      actual.localeCompare(expected, undefined, { sensitivity: "accent" }) ===
        0 || actual.toLocaleLowerCase() === expected.toLocaleLowerCase()
    );
  }

  return asComparable(actual) === asComparable(expected);
}

function normalizeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function compareNumeric(
  actual: unknown,
  expected: unknown,
  predicate: (left: number, right: number) => boolean,
): boolean | null {
  const left = typeof actual === "number" ? actual : Number(actual);
  const right = typeof expected === "number" ? expected : Number(expected);

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  return predicate(left, right);
}

function evaluateKnownValue(
  operator: OpportunityRuleOperator,
  actual: unknown,
  expected: OpportunityRuleValue | undefined,
): boolean | null {
  switch (operator) {
    case "exists":
      return actual !== null && actual !== undefined && actual !== "";
    case "not_exists":
      return actual === null || actual === undefined || actual === "";
    case "equals":
      return compareEquality(actual, expected);
    case "not_equals":
      return !compareEquality(actual, expected);
    case "in": {
      const expectedValues = normalizeArray(expected);
      return expectedValues.some((value) => compareEquality(actual, value));
    }
    case "not_in": {
      const expectedValues = normalizeArray(expected);
      return !expectedValues.some((value) => compareEquality(actual, value));
    }
    case "contains": {
      if (typeof actual === "string") {
        return normalizeArray(expected).every(
          (expectedValue) =>
            typeof expectedValue === "string" &&
            actual
              .toLocaleLowerCase()
              .includes(expectedValue.toLocaleLowerCase()),
        );
      }
      const actualValues = normalizeArray(actual);
      const expectedValues = normalizeArray(expected);
      return expectedValues.every((expectedValue) =>
        actualValues.some((actualValue) =>
          compareEquality(actualValue, expectedValue),
        ),
      );
    }
    case "not_contains": {
      if (typeof actual === "string") {
        return normalizeArray(expected).every(
          (expectedValue) =>
            typeof expectedValue !== "string" ||
            !actual
              .toLocaleLowerCase()
              .includes(expectedValue.toLocaleLowerCase()),
        );
      }
      const actualValues = normalizeArray(actual);
      const expectedValues = normalizeArray(expected);
      return expectedValues.every((expectedValue) =>
        actualValues.every(
          (actualValue) => !compareEquality(actualValue, expectedValue),
        ),
      );
    }
    case "greater_than":
      return compareNumeric(actual, expected, (left, right) => left > right);
    case "greater_than_or_equal":
      return compareNumeric(actual, expected, (left, right) => left >= right);
    case "less_than":
      return compareNumeric(actual, expected, (left, right) => left < right);
    case "less_than_or_equal":
      return compareNumeric(actual, expected, (left, right) => left <= right);
    case "between": {
      if (!Array.isArray(expected) || expected.length !== 2) {
        return null;
      }

      const lower = compareNumeric(
        actual,
        expected[0],
        (left, right) => left >= right,
      );
      const upper = compareNumeric(
        actual,
        expected[1],
        (left, right) => left <= right,
      );
      return lower === null || upper === null ? null : lower && upper;
    }
  }
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value === null || value === undefined || value === "") {
    return "no value";
  }

  return String(value);
}

function fieldValueFor(
  input: OpportunityEvaluationInput,
  field: OpportunityRuleField,
): OpportunityFieldValue | null {
  return input.fields[field] ?? null;
}

export function evaluateOpportunityClause(
  clause: OpportunityRuleClause,
  input: OpportunityEvaluationInput,
): OpportunityClauseOutcome {
  const fieldValue = fieldValueFor(input, clause.field);
  const isUnknown = !fieldValue || fieldValue.state === "unknown";

  if (isUnknown) {
    return {
      actualValue: null,
      clauseId: clause.id,
      comparisonValue: clause.value,
      confidence: fieldValue?.confidence ?? "directional",
      evidenceClass: fieldValue?.evidenceClass ?? "observed_fact",
      explanation:
        fieldValue?.reason ??
        `${clause.label ?? clause.field} is not available from the required source yet.`,
      field: clause.field,
      operator: clause.operator,
      source: fieldValue?.source ?? null,
      sourceAt: fieldValue?.sourceAt ?? null,
      state: "unknown",
    };
  }

  const matched = evaluateKnownValue(
    clause.operator,
    fieldValue.value,
    clause.value,
  );
  const state: OpportunityTriState =
    matched === null ? "unknown" : matched ? "true" : "false";
  const operatorText = clause.operator.replaceAll("_", " ");

  return {
    actualValue: fieldValue.value,
    clauseId: clause.id,
    comparisonValue: clause.value,
    confidence: fieldValue.confidence,
    evidenceClass: fieldValue.evidenceClass,
    explanation:
      state === "unknown"
        ? `${clause.label ?? clause.field} could not be compared with ${operatorText}.`
        : `${clause.label ?? clause.field} was ${renderValue(fieldValue.value)}; ${operatorText} ${renderValue(clause.value)} ${state === "true" ? "passed" : "did not pass"}.`,
    field: clause.field,
    operator: clause.operator,
    source: fieldValue.source,
    sourceAt: fieldValue.sourceAt,
    state,
  };
}

function combineStates(
  states: OpportunityTriState[],
  operator: "all" | "any",
): OpportunityTriState {
  if (states.length === 0) {
    return operator === "all" ? "true" : "false";
  }

  if (operator === "all") {
    if (states.includes("false")) {
      return "false";
    }
    return states.includes("unknown") ? "unknown" : "true";
  }

  if (states.includes("true")) {
    return "true";
  }
  return states.includes("unknown") ? "unknown" : "false";
}

export function evaluateOpportunityGroup(
  group: OpportunityRuleGroup,
  input: OpportunityEvaluationInput,
): OpportunityGroupOutcome {
  const clauseOutcomes = group.clauses.map((clause) =>
    evaluateOpportunityClause(clause, input),
  );

  return {
    clauseOutcomes,
    groupId: group.id,
    label: group.label,
    operator: group.operator,
    state: combineStates(
      clauseOutcomes.map((outcome) => outcome.state),
      group.operator,
    ),
  };
}

function evaluatePreferredGroup(
  group: OpportunityPreferredRuleGroup,
  input: OpportunityEvaluationInput,
  totalWeight: number,
): OpportunityProfileEvaluation["preferredOutcomes"][number] {
  const outcome = evaluateOpportunityGroup(group, input);
  const weight = IMPORTANCE_WEIGHT[group.importance];

  return {
    ...outcome,
    contribution:
      outcome.state === "true" && totalWeight > 0 ? weight / totalWeight : 0,
    importance: group.importance,
  };
}

export function evaluateOpportunityProfile(
  rules: OpportunityRuleSet,
  input: OpportunityEvaluationInput,
): OpportunityProfileEvaluation {
  assertOpportunityRuleSet(rules);

  const requiredOutcomes = rules.required.map((group) =>
    evaluateOpportunityGroup(group, input),
  );
  const excludedOutcomes = rules.excluded.map((group) =>
    evaluateOpportunityGroup(group, input),
  );
  const totalPreferenceWeight = rules.preferred.reduce(
    (sum, group) => sum + IMPORTANCE_WEIGHT[group.importance],
    0,
  );
  const preferredOutcomes = rules.preferred.map((group) =>
    evaluatePreferredGroup(group, input, totalPreferenceWeight),
  );
  const excluded = excludedOutcomes.some((outcome) => outcome.state === "true");
  const requiredState = combineStates(
    requiredOutcomes.map((outcome) => outcome.state),
    "all",
  );
  const missingRequiredFields = Array.from(
    new Set(
      requiredOutcomes.flatMap((outcome) =>
        outcome.clauseOutcomes
          .filter((clause) => clause.state === "unknown")
          .map((clause) => clause.field),
      ),
    ),
  );
  const outcome: OpportunityProfileEvaluation["outcome"] =
    excluded || requiredState === "false"
      ? "ineligible"
      : requiredState === "unknown"
        ? "pending"
        : "eligible";

  return {
    excluded,
    excludedOutcomes,
    missingRequiredFields,
    outcome,
    preferenceContribution: preferredOutcomes.reduce(
      (sum, preferred) => sum + preferred.contribution,
      0,
    ),
    preferredOutcomes,
    requiredOutcomes,
  };
}

function assertRuleGroup(
  value: unknown,
  path: string,
  preferred: boolean,
): asserts value is OpportunityRuleGroup | OpportunityPreferredRuleGroup {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`${path}.id must be a non-empty string.`);
  }
  if (typeof value.label !== "string" || value.label.length === 0) {
    throw new Error(`${path}.label must be a non-empty string.`);
  }
  if (value.operator !== "any" && value.operator !== "all") {
    throw new Error(`${path}.operator must be any or all.`);
  }
  if (!Array.isArray(value.clauses) || value.clauses.length === 0) {
    throw new Error(`${path}.clauses must contain at least one rule.`);
  }

  value.clauses.forEach((clause, index) => {
    if (!isRecord(clause)) {
      throw new Error(`${path}.clauses[${index}] must be an object.`);
    }
    if (typeof clause.id !== "string" || clause.id.length === 0) {
      throw new Error(
        `${path}.clauses[${index}].id must be a non-empty string.`,
      );
    }
    if (
      typeof clause.field !== "string" ||
      !SUPPORTED_FIELDS.has(clause.field as OpportunityRuleField)
    ) {
      throw new Error(`${path}.clauses[${index}].field is not supported.`);
    }
    if (
      typeof clause.operator !== "string" ||
      !SUPPORTED_OPERATORS.has(clause.operator as OpportunityRuleOperator)
    ) {
      throw new Error(`${path}.clauses[${index}].operator is not supported.`);
    }
  });

  if (
    preferred &&
    value.importance !== "low" &&
    value.importance !== "medium" &&
    value.importance !== "high"
  ) {
    throw new Error(`${path}.importance must be low, medium, or high.`);
  }
}

export function assertOpportunityRuleSet(
  value: unknown,
): asserts value is OpportunityRuleSet {
  if (!isRecord(value)) {
    throw new Error("Opportunity rules must be an object.");
  }
  if (value.schemaVersion !== OPPORTUNITY_RULE_SCHEMA_VERSION) {
    throw new Error(
      `Opportunity rules must use ${OPPORTUNITY_RULE_SCHEMA_VERSION}.`,
    );
  }

  for (const section of ["required", "preferred", "excluded"] as const) {
    if (!Array.isArray(value[section])) {
      throw new Error(`Opportunity rules.${section} must be an array.`);
    }

    value[section].forEach((group, index) =>
      assertRuleGroup(
        group,
        `Opportunity rules.${section}[${index}]`,
        section === "preferred",
      ),
    );
  }
}

export function describeOpportunityRuleSet(
  rules: OpportunityRuleSet,
): string[] {
  assertOpportunityRuleSet(rules);

  const describeGroup = (group: OpportunityRuleGroup): string => {
    const clauses = group.clauses.map((clause) => {
      const operator = clause.operator.replaceAll("_", " ");
      return `${clause.label ?? clause.field} ${operator} ${renderValue(clause.value)}`;
    });
    return `${group.label}: ${clauses.join(group.operator === "all" ? " AND " : " OR ")}`;
  };

  return [
    ...rules.required.map((group) => `Required — ${describeGroup(group)}`),
    ...rules.preferred.map(
      (group) => `Preferred (${group.importance}) — ${describeGroup(group)}`,
    ),
    ...rules.excluded.map((group) => `Excluded — ${describeGroup(group)}`),
  ];
}
