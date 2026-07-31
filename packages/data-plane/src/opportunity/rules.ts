import {
  OPPORTUNITY_RULE_FIELDS,
  OPPORTUNITY_RULE_SCHEMA_V1,
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityClauseOutcome,
  type OpportunityEvaluationContext,
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
import {
  evaluateOpportunityDateComparison,
  isOpportunityDateField,
  isOpportunityDateOperand,
  opportunityDateOperandFromValue,
} from "./date-rules.js";

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
  "in_window",
  "exists",
  "not_exists",
]);

const SUPPORTED_FIELDS = new Set<OpportunityRuleField>(OPPORTUNITY_RULE_FIELDS);
const DATE_OPERATORS = new Set<OpportunityRuleOperator>([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "in_window",
  "exists",
  "not_exists",
]);
const V1_FIELDS = new Set<OpportunityRuleField>(
  OPPORTUNITY_RULE_FIELDS.filter(
    (field) => field !== "publisheriq_added_at" && field !== "demo_only",
  ),
);

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
  if (
    actual === null ||
    actual === undefined ||
    actual === "" ||
    expected === null ||
    expected === undefined ||
    expected === ""
  ) {
    return null;
  }
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
    case "in_window":
      return null;
  }
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value === null || value === undefined || value === "") {
    return "no value";
  }
  if (isOpportunityDateOperand(value)) {
    return value.kind === "absolute_date"
      ? value.date
      : value.window.replaceAll("_", " ");
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
  context: OpportunityEvaluationContext = {
    asOf: new Date().toISOString(),
    timezone: "UTC",
  },
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

  const dateOperand = isOpportunityDateField(clause.field)
    ? opportunityDateOperandFromValue(clause.value)
    : null;
  const matched = dateOperand
    ? evaluateOpportunityDateComparison({
        actual: fieldValue.value,
        context,
        field: clause.field,
        operand: dateOperand,
        operator: clause.operator,
      })
    : evaluateKnownValue(clause.operator, fieldValue.value, clause.value);
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
  context?: OpportunityEvaluationContext,
): OpportunityGroupOutcome {
  const clauseOutcomes = group.clauses.map((clause) =>
    evaluateOpportunityClause(clause, input, context),
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
  context?: OpportunityEvaluationContext,
): OpportunityProfileEvaluation["preferredOutcomes"][number] {
  const outcome = evaluateOpportunityGroup(group, input, context);
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
  context?: OpportunityEvaluationContext,
): OpportunityProfileEvaluation {
  assertOpportunityRuleSet(rules);

  const requiredOutcomes = rules.required.map((group) =>
    evaluateOpportunityGroup(group, input, context),
  );
  const excludedOutcomes = rules.excluded.map((group) =>
    evaluateOpportunityGroup(group, input, context),
  );
  const totalPreferenceWeight = rules.preferred.reduce(
    (sum, group) => sum + IMPORTANCE_WEIGHT[group.importance],
    0,
  );
  const preferredOutcomes = rules.preferred.map((group) =>
    evaluatePreferredGroup(group, input, totalPreferenceWeight, context),
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
  schemaVersion: string,
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
      !SUPPORTED_FIELDS.has(clause.field as OpportunityRuleField) ||
      (schemaVersion === OPPORTUNITY_RULE_SCHEMA_V1 &&
        !V1_FIELDS.has(clause.field as OpportunityRuleField))
    ) {
      throw new Error(`${path}.clauses[${index}].field is not supported.`);
    }
    if (
      typeof clause.operator !== "string" ||
      !SUPPORTED_OPERATORS.has(clause.operator as OpportunityRuleOperator)
    ) {
      throw new Error(`${path}.clauses[${index}].operator is not supported.`);
    }
    const field = clause.field as OpportunityRuleField;
    const operator = clause.operator as OpportunityRuleOperator;
    if (
      schemaVersion === OPPORTUNITY_RULE_SCHEMA_VERSION &&
      isOpportunityDateField(field) &&
      !DATE_OPERATORS.has(operator)
    ) {
      throw new Error(
        `${path}.clauses[${index}].operator is not supported for date fields.`,
      );
    }
    if (
      !isOpportunityDateField(field) &&
      isOpportunityDateOperand(clause.value)
    ) {
      throw new Error(
        `${path}.clauses[${index}].value uses a date operand with a non-date field.`,
      );
    }
    if (operator === "in_window" && !isOpportunityDateField(field)) {
      throw new Error(
        `${path}.clauses[${index}].operator in_window requires a date field.`,
      );
    }
    if (
      schemaVersion === OPPORTUNITY_RULE_SCHEMA_V1 &&
      operator === "in_window"
    ) {
      throw new Error(
        `${path}.clauses[${index}].operator is not supported by ${OPPORTUNITY_RULE_SCHEMA_V1}.`,
      );
    }
    if (
      schemaVersion === OPPORTUNITY_RULE_SCHEMA_VERSION &&
      isOpportunityDateField(field) &&
      operator !== "exists" &&
      operator !== "not_exists" &&
      !isOpportunityDateOperand(clause.value)
    ) {
      throw new Error(
        `${path}.clauses[${index}].value must be a valid date operand.`,
      );
    }
    if (
      operator === "in_window" &&
      (!isOpportunityDateOperand(clause.value) ||
        clause.value.kind !== "relative_window")
    ) {
      throw new Error(
        `${path}.clauses[${index}].value must be a relative date window.`,
      );
    }
    if (
      schemaVersion === OPPORTUNITY_RULE_SCHEMA_VERSION &&
      isOpportunityDateField(field) &&
      operator !== "in_window" &&
      operator !== "exists" &&
      operator !== "not_exists" &&
      isOpportunityDateOperand(clause.value) &&
      clause.value.kind !== "absolute_date"
    ) {
      throw new Error(
        `${path}.clauses[${index}].value must be an absolute date.`,
      );
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
  if (
    value.schemaVersion !== OPPORTUNITY_RULE_SCHEMA_V1 &&
    value.schemaVersion !== OPPORTUNITY_RULE_SCHEMA_VERSION
  ) {
    throw new Error(
      `Opportunity rules must use ${OPPORTUNITY_RULE_SCHEMA_V1} or ${OPPORTUNITY_RULE_SCHEMA_VERSION}.`,
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
        value.schemaVersion as string,
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
