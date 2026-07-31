import type {
  OpportunityResultSummary,
  OpportunityRuleField,
  OpportunityRuleOperator,
} from "./types";

export async function opportunityPost<T>(
  operation: string,
  body: unknown = {},
): Promise<T> {
  const response = await fetch(`/api/opportunities/${operation}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error ?? `Opportunity request failed (${response.status}).`,
    );
  }
  return payload as T;
}

export function formatOpportunityDate(value: string | null): string {
  if (!value) {
    return "Not available";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatOpportunityDay(value: string | null): string {
  if (!value) {
    return "an unknown date";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : undefined,
  }).format(date);
}

const FIELD_LABELS: Record<OpportunityRuleField, string> = {
  app_type: "Steam app type",
  appid: "Steam app ID",
  categories: "Steam categories",
  ccu_change_30d: "30-day concurrent-player change",
  ccu_change_7d: "7-day concurrent-player change",
  ccu_peak: "Peak concurrent players",
  content_descriptors: "Content descriptors",
  controller_support: "Controller support",
  days_until_release: "Time until release",
  demo_only: "Only demo available",
  developer: "Developer",
  developer_game_count: "Developer's Steam releases",
  discount_percent: "Current discount",
  genres: "Steam genres",
  has_demo: "Playable demo",
  has_purchase_packages: "Purchase option",
  is_free: "Free-to-play status",
  is_released: "Release status",
  languages: "Supported languages",
  name: "Game name",
  no_publisher_listed: "Publisher listing",
  platforms: "Platform support",
  positive_percentage: "Positive Steam review rate",
  price_cents: "Price",
  publisher: "Publisher",
  publisher_game_count: "Publisher's Steam releases",
  publisheriq_added_at: "Added to PublisherIQ",
  release_date: "Release date",
  release_state: "Release status",
  reviews_added_30d: "Steam reviews added in the last 30 days",
  reviews_added_7d: "Steam reviews added in the last 7 days",
  self_published: "Self-published status",
  steam_deck: "Steam Deck support",
  tags: "Steam tags",
  total_reviews: "Total Steam reviews",
};

export function opportunityFieldLabel(field: string): string {
  return FIELD_LABELS[field as OpportunityRuleField] ?? "Game information";
}

const METRIC_LABELS: Record<string, string> = {
  ccupeak: "Peak concurrent players",
  currentpricecents: "Current Steam price",
  peakconcurrentplayers: "Peak concurrent players",
  positivepercentage: "Positive Steam review rate",
  positivesteamreviewrate: "Positive Steam review rate",
  reviewsadded30d: "Steam reviews added in the last 30 days",
  reviewsadded7d: "Steam reviews added in the last 7 days",
  steamreviewsaddedinthelast30days: "Steam reviews added in the last 30 days",
  steamreviewsaddedinthelast7days: "Steam reviews added in the last 7 days",
  totalreviews: "Total Steam reviews",
  totalsteamreviews: "Total Steam reviews",
};

function keyToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function opportunityMetricLabel(value: string): string {
  return METRIC_LABELS[keyToken(value)] ?? opportunityFieldLabel(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function asStringList(value: unknown): string[] | null {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined) {
    return null;
  }
  if (Array.isArray(parsed)) {
    const items = parsed
      .flatMap((item) => asStringList(item) ?? [])
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? Array.from(new Set(items)) : [];
  }
  if (typeof parsed === "object") {
    const enabled = Object.entries(parsed as Record<string, unknown>)
      .filter(([, state]) => state === true || state === 1 || state === "true")
      .map(([key]) => key);
    return enabled.length > 0 ? enabled : null;
  }
  if (typeof parsed === "string") {
    const items = parsed
      .split(/\s*[,|]\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : [];
  }
  return [String(parsed)];
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function formatCurrency(value: unknown): string | null {
  if (typeof value === "string" && value.trim().startsWith("$")) {
    return value.trim();
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount / 100);
}

function formatCompactValue(value: unknown): string | null {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined || parsed === "") {
    return null;
  }
  if (typeof parsed === "boolean") {
    return parsed ? "Yes" : "No";
  }
  if (typeof parsed === "number") {
    return parsed.toLocaleString();
  }
  if (Array.isArray(parsed)) {
    const items = asStringList(parsed);
    return items ? joinNatural(items) : null;
  }
  if (typeof parsed === "object") {
    const pairs = Object.entries(parsed as Record<string, unknown>)
      .filter(([, nested]) => nested !== null && nested !== undefined)
      .slice(0, 5)
      .map(
        ([key, nested]) =>
          `${opportunityFieldLabel(key)}: ${formatCompactValue(nested) ?? "Not available"}`,
      );
    return pairs.length > 0 ? pairs.join("; ") : null;
  }
  return String(parsed);
}

export function opportunityWhyItMatters(
  result: OpportunityResultSummary,
): string {
  return {
    developing:
      "Comparable games show early commercial traction worth monitoring.",
    insufficient_data:
      "This is an early sourcing signal; player and review history is still developing.",
    large_but_competitive:
      "Comparable games show strong demand, though competition for attention is high.",
    limited:
      "Comparable demand is modest, so a selective commercial review is appropriate.",
    meaningful: "Comparable games show meaningful commercial potential.",
  }[result.marketPotential];
}

export function opportunityPotentialLabel(
  value: OpportunityResultSummary["marketPotential"] | string,
): string {
  return (
    {
      developing: "Developing",
      insufficient_data: "Too early to size",
      large_but_competitive: "Large, competitive market",
      limited: "Selective",
      meaningful: "Meaningful",
    }[value] ?? "Developing"
  );
}

export function opportunityConfidenceLabel(
  value: "directional" | "high",
): string {
  return value === "high" ? "High confidence" : "Directional confidence";
}

export function opportunityConfidenceExplanation(
  value: "directional" | "high",
): string {
  return value === "high"
    ? "The key sourcing and market inputs are well covered."
    : "The signal is useful, but some supporting inputs are still developing.";
}

export function opportunityStrengthLabel(score: number | null): string {
  if (score === null) return "Not yet scored";
  if (score >= 85) return "Exceptional fit";
  if (score >= 70) return "Strong fit";
  if (score >= 55) return "Promising fit";
  if (score >= 40) return "Developing fit";
  return "Early fit";
}

export const OPPORTUNITY_COMPONENTS: Record<
  string,
  { description: string; label: string }
> = {
  evidenceQuality: {
    description: "How complete and current the supporting data is.",
    label: "Data completeness and confidence",
  },
  marketMomentum: {
    description: "Whether comparable-game demand is strengthening.",
    label: "Recent market momentum",
  },
  peerPosition: {
    description: "How the game compares with similar released titles.",
    label: "Position among comparable games",
  },
  signalStrength: {
    description: "How commercially important the latest observed change is.",
    label: "Importance of the latest change",
  },
  userFit: {
    description: "How closely the game matches the sourcing criteria you set.",
    label: "Match to your sourcing criteria",
  },
};

export function opportunityComponentStrength(value: number): string {
  if (value >= 0.85) return "Excellent";
  if (value >= 0.7) return "Strong";
  if (value >= 0.5) return "Moderate";
  if (value >= 0.3) return "Limited";
  return "Weak";
}

export function formatOpportunityMetricValue(
  metric: string,
  value: number | string | null,
): string {
  if (value === null) return "Not available";
  const token = keyToken(metric);
  if (token.includes("price") && token.includes("cent")) {
    return formatCurrency(value) ?? String(value);
  }
  if (
    token.includes("percentage") ||
    token.includes("percent") ||
    token.includes("discount") ||
    token.includes("rate")
  ) {
    const number = Number(value);
    return Number.isFinite(number)
      ? `${number.toLocaleString()}%`
      : String(value);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function comparisonText(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value
  ) {
    const operand = value as {
      date?: string;
      kind: string;
      window?: string;
    };
    return operand.kind === "absolute_date"
      ? (operand.date ?? "the selected date")
      : (operand.window?.replaceAll("_", " ") ?? "the selected window");
  }
  const formatted = formatCompactValue(value);
  return formatted ?? "the selected value";
}

export function describeOpportunityRuleClause(
  clause: {
    actualValue?: unknown;
    comparisonValue?: unknown;
    field: OpportunityRuleField;
    operator?: OpportunityRuleOperator;
    state: "false" | "true" | "unknown";
  },
  context: "dealbreaker" | "matched" | "strength",
): string {
  const { field, operator, state } = clause;
  const expected = clause.comparisonValue;
  const actual = clause.actualValue;
  const label = opportunityFieldLabel(field);

  if (state === "unknown") {
    return `${label} could not be confirmed from the available data.`;
  }
  if (field === "has_demo" && operator === "equals" && expected === true) {
    return state === "true"
      ? "Playable demo available"
      : "No playable demo identified";
  }
  if (field === "demo_only" && operator === "equals" && expected === true) {
    return state === "true"
      ? "Only a playable demo is currently available"
      : "The canonical game is released, purchasable, or has no linked demo";
  }
  if (
    (field === "release_date" || field === "publisheriq_added_at") &&
    operator === "in_window"
  ) {
    return state === "true"
      ? `${label} is in ${comparisonText(expected)}`
      : `${label} is outside ${comparisonText(expected)}`;
  }
  if (
    field === "publisher_game_count" &&
    operator === "less_than_or_equal" &&
    typeof expected === "number"
  ) {
    return state === "true"
      ? `Publisher has released ${expected.toLocaleString()} or fewer Steam games`
      : `Publisher has released more than ${expected.toLocaleString()} Steam games`;
  }
  if (
    field === "developer_game_count" &&
    operator === "less_than_or_equal" &&
    typeof expected === "number"
  ) {
    return state === "true"
      ? `Developer has released ${expected.toLocaleString()} or fewer Steam games`
      : `Developer has released more than ${expected.toLocaleString()} Steam games`;
  }
  if (field === "content_descriptors" && operator === "contains") {
    const descriptor =
      keyToken(comparisonText(expected)) === "adult"
        ? "adult-only"
        : comparisonText(expected).toLocaleLowerCase();
    if (context === "dealbreaker" && state === "false") {
      return `No ${descriptor} content identified`;
    }
    return state === "true"
      ? `${descriptor} content identified`
      : `No ${descriptor} content identified`;
  }
  if (field === "no_publisher_listed" && operator === "equals") {
    return state === "true"
      ? "No publisher is currently listed"
      : "A publisher is listed";
  }
  if (field === "self_published" && operator === "equals") {
    return state === "true"
      ? "Developer appears to be self-publishing"
      : "A separate publisher is listed";
  }
  if (
    [
      "less_than",
      "less_than_or_equal",
      "greater_than",
      "greater_than_or_equal",
    ].includes(operator ?? "")
  ) {
    const relation: Partial<Record<OpportunityRuleOperator, string>> = {
      greater_than: "more than",
      greater_than_or_equal: "at least",
      less_than: "fewer than",
      less_than_or_equal: "no more than",
    };
    const comparison = operator ? relation[operator] : undefined;
    return state === "true"
      ? `${label}: ${comparison ?? "within"} ${comparisonText(expected)}`
      : `${label}: ${comparisonText(actual)}, outside the selected range`;
  }
  if (operator === "between" && Array.isArray(expected)) {
    return state === "true"
      ? `${label}: between ${comparisonText(expected[0])} and ${comparisonText(expected[1])}`
      : `${label}: ${comparisonText(actual)}, outside the selected range`;
  }
  if (operator === "contains" || operator === "in") {
    const singular = ["developer", "name", "publisher"].includes(field);
    return state === "true"
      ? `${label} ${singular ? "includes" : "include"} ${comparisonText(expected)}`
      : `${label} ${singular ? "does" : "do"} not include ${comparisonText(expected)}`;
  }
  if (operator === "not_contains" || operator === "not_in") {
    const singular = ["developer", "name", "publisher"].includes(field);
    return state === "true"
      ? `${label} ${singular ? "does" : "do"} not include ${comparisonText(expected)}`
      : `${label} ${singular ? "includes" : "include"} ${comparisonText(expected)}`;
  }
  if (operator === "exists" || operator === "not_exists") {
    return state === "true"
      ? operator === "exists"
        ? `${label} is available`
        : `${label} is not listed`
      : operator === "exists"
        ? `${label} is not listed`
        : `${label} is available`;
  }
  if (operator === "equals" || operator === "not_equals") {
    const matches =
      operator === "equals" ? state === "true" : state === "false";
    return matches
      ? `${label}: ${comparisonText(expected)}`
      : `${label}: ${comparisonText(actual)}`;
  }
  return `${label}: ${comparisonText(actual)}`;
}
