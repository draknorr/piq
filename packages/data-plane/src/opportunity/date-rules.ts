import type {
  OpportunityDateOperand,
  OpportunityEvaluationContext,
  OpportunityRelativeDateWindow,
  OpportunityRuleField,
  OpportunityRuleOperator,
} from "./types.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = new Set<OpportunityRuleField>([
  "publisheriq_added_at",
  "release_date",
]);

export interface OpportunityDateRange {
  endDateExclusive: string;
  startDate: string;
}

function dateParts(value: string): [number, number, number] {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return [year!, month!, day];
}

function formatDate(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function isOpportunityDateField(field: OpportunityRuleField): boolean {
  return DATE_FIELDS.has(field);
}

export function isOpportunityDateOperand(
  value: unknown,
): value is OpportunityDateOperand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "absolute_date") {
    try {
      dateParts(String(candidate.date ?? ""));
      return typeof candidate.date === "string";
    } catch {
      return false;
    }
  }
  return (
    candidate.kind === "relative_window" &&
    typeof candidate.window === "string" &&
    [
      "today",
      "this_week",
      "last_7_days",
      "last_30_days",
      "this_month",
      "next_7_days",
      "next_30_days",
    ].includes(candidate.window)
  );
}

export function opportunityDateOperandFromValue(
  value: unknown,
): OpportunityDateOperand | null {
  if (isOpportunityDateOperand(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      dateParts(value);
      return { date: value, kind: "absolute_date" };
    } catch {
      return null;
    }
  }
  return null;
}

export function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = dateParts(value);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    result.getUTCDate(),
  );
}

function startOfMonth(value: string): string {
  const [year, month] = dateParts(value);
  return formatDate(year, month, 1);
}

function startOfNextMonth(value: string): string {
  const [year, month] = dateParts(value);
  const result = new Date(Date.UTC(year, month, 1));
  return formatDate(result.getUTCFullYear(), result.getUTCMonth() + 1, 1);
}

export function localDateForInstant(instant: string, timezone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid evaluation instant: ${instant}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(parsed);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function previousLocalDayEvaluationContext(
  context: OpportunityEvaluationContext,
): OpportunityEvaluationContext {
  const previousDate = addCalendarDays(
    localDateForInstant(context.asOf, context.timezone),
    -1,
  );
  const previousStart = Date.parse(
    localDateStartUtc(previousDate, context.timezone),
  );
  return {
    asOf: new Date(previousStart + 12 * 60 * 60 * 1_000).toISOString(),
    timezone: context.timezone,
  };
}

export function resolveOpportunityRelativeDateRange(
  window: OpportunityRelativeDateWindow,
  context: OpportunityEvaluationContext,
): OpportunityDateRange {
  const today = localDateForInstant(context.asOf, context.timezone);
  switch (window) {
    case "today":
      return { endDateExclusive: addCalendarDays(today, 1), startDate: today };
    case "last_7_days":
      return {
        endDateExclusive: addCalendarDays(today, 1),
        startDate: addCalendarDays(today, -6),
      };
    case "last_30_days":
      return {
        endDateExclusive: addCalendarDays(today, 1),
        startDate: addCalendarDays(today, -29),
      };
    case "this_week": {
      const [year, month, day] = dateParts(today);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const startDate = addCalendarDays(today, -((weekday + 6) % 7));
      return {
        endDateExclusive: addCalendarDays(startDate, 7),
        startDate,
      };
    }
    case "this_month":
      return {
        endDateExclusive: startOfNextMonth(today),
        startDate: startOfMonth(today),
      };
    case "next_7_days": {
      const startDate = addCalendarDays(today, 1);
      return {
        endDateExclusive: addCalendarDays(startDate, 7),
        startDate,
      };
    }
    case "next_30_days": {
      const startDate = addCalendarDays(today, 1);
      return {
        endDateExclusive: addCalendarDays(startDate, 30),
        startDate,
      };
    }
  }
}

function zonedParts(
  instant: Date,
  timezone: string,
): [number, number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(instant);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  // Some ICU builds represent midnight as 24:00 for en-US.
  const hour = value.hour === 24 ? 0 : value.hour;
  return [
    value.year!,
    value.month!,
    value.day!,
    hour!,
    value.minute!,
    value.second!,
  ];
}

export function localDateStartUtc(value: string, timezone: string): string {
  const [year, month, day] = dateParts(value);
  const desired = Date.UTC(year, month - 1, day);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timezone);
    const represented = Date.UTC(
      parts[0],
      parts[1] - 1,
      parts[2],
      parts[3],
      parts[4],
      parts[5],
    );
    candidate += desired - represented;
  }
  return new Date(candidate).toISOString();
}

export function opportunityDateRangeForOperand(
  operand: OpportunityDateOperand,
  context: OpportunityEvaluationContext,
): OpportunityDateRange {
  if (operand.kind === "relative_window") {
    return resolveOpportunityRelativeDateRange(operand.window, context);
  }
  return {
    endDateExclusive: addCalendarDays(operand.date, 1),
    startDate: operand.date,
  };
}

export function evaluateOpportunityDateComparison(params: {
  actual: unknown;
  context: OpportunityEvaluationContext;
  field: OpportunityRuleField;
  operand: OpportunityDateOperand;
  operator: OpportunityRuleOperator;
}): boolean | null {
  const range = opportunityDateRangeForOperand(params.operand, params.context);
  const timestampField = params.field === "publisheriq_added_at";
  const actualComparable = timestampField
    ? new Date(String(params.actual)).getTime()
    : typeof params.actual === "string" && DATE_ONLY_PATTERN.test(params.actual)
      ? params.actual
      : null;
  if (
    actualComparable === null ||
    (typeof actualComparable === "number" && !Number.isFinite(actualComparable))
  ) {
    return null;
  }
  const start = timestampField
    ? new Date(
        localDateStartUtc(range.startDate, params.context.timezone),
      ).getTime()
    : range.startDate;
  const end = timestampField
    ? new Date(
        localDateStartUtc(range.endDateExclusive, params.context.timezone),
      ).getTime()
    : range.endDateExclusive;

  switch (params.operator) {
    case "in_window":
    case "equals":
      return actualComparable >= start && actualComparable < end;
    case "not_equals":
      return actualComparable < start || actualComparable >= end;
    case "greater_than":
      return actualComparable >= end;
    case "greater_than_or_equal":
      return actualComparable >= start;
    case "less_than":
      return actualComparable < start;
    case "less_than_or_equal":
      return actualComparable < end;
    default:
      return null;
  }
}
