import type {
  OpportunityObservedChange,
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

export function humanizeOpportunity(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  return (
    FIELD_LABELS[field as OpportunityRuleField] ?? humanizeOpportunity(field)
  );
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
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function findNestedValue(
  input: unknown,
  aliases: string[],
  depth = 0,
): unknown {
  if (depth > 5) {
    return undefined;
  }
  const value = parseMaybeJson(input);
  const aliasTokens = new Set(aliases.map(keyToken));
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const match = findNestedValue(item, aliases, depth + 1);
        if (match !== undefined) {
          return match;
        }
      }
    }
    if (value.length === 1) {
      return parseMaybeJson(value[0]);
    }
    if (
      value.length > 0 &&
      value.every(
        (item) =>
          item === null ||
          ["boolean", "number", "string"].includes(typeof item),
      )
    ) {
      return value;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const direct = entries.find(([key]) => aliasTokens.has(keyToken(key)));
    if (direct) {
      return parseMaybeJson(direct[1]);
    }
    for (const [, nested] of entries) {
      if (nested && typeof nested === "object") {
        const match = findNestedValue(nested, aliases, depth + 1);
        if (match !== undefined) {
          return match;
        }
      }
    }
    return undefined;
  }
  return value;
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

function listDifference(left: string[], right: string[]): string[] {
  const rightValues = new Set(right.map((item) => item.toLocaleLowerCase()));
  return left.filter((item) => !rightValues.has(item.toLocaleLowerCase()));
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function readablePlatform(value: string): string {
  const token = keyToken(value);
  if (["mac", "macos", "osx"].includes(token)) return "macOS";
  if (["win", "windows"].includes(token)) return "Windows";
  if (token === "linux") return "Linux";
  return humanizeOpportunity(value);
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

function fieldValue(
  change: OpportunityObservedChange,
  side: "after" | "before",
  field: OpportunityRuleField,
  aliases: string[] = [],
): unknown {
  const source = change[side];
  const found = findNestedValue(source, [field, ...aliases]);
  if (found !== undefined) {
    if (
      Array.isArray(found) &&
      ![
        "categories",
        "content_descriptors",
        "developer",
        "genres",
        "languages",
        "platforms",
        "publisher",
        "tags",
      ].includes(field)
    ) {
      return side === "before" ? found[0] : found.at(-1);
    }
    return found;
  }
  if (change.affectedRuleFields.length === 1) {
    return findNestedValue(source, ["value"]);
  }
  return undefined;
}

function describePartyChange(
  change: OpportunityObservedChange,
  kind: "developer" | "publisher",
): string {
  const label = kind === "developer" ? "Developer" : "Publisher";
  const aliases =
    kind === "developer"
      ? ["developers", "developer_names", "developerName"]
      : ["publishers", "publisher_names", "publisherName"];
  const before =
    asStringList(fieldValue(change, "before", kind, aliases)) ?? [];
  const after = asStringList(fieldValue(change, "after", kind, aliases)) ?? [];
  const added = listDifference(after, before);
  const removed = listDifference(before, after);

  if (
    before.length > 0 &&
    after.length > 0 &&
    (added.length || removed.length)
  ) {
    return `${label} changed from ${joinNatural(before)} to ${joinNatural(after)}.`;
  }
  if (added.length > 0) {
    return `${label} ${joinNatural(added)} ${added.length === 1 ? "was" : "were"} added.`;
  }
  if (removed.length > 0) {
    return `${label} ${joinNatural(removed)} ${removed.length === 1 ? "was" : "were"} removed.`;
  }
  if (after.length > 0) {
    return `${label} changed to ${joinNatural(after)}; the prior ${kind} is not available in the stored evidence.`;
  }
  return `The listed ${kind} changed, but the stored evidence does not contain both names.`;
}

function describeTaxonomyChange(change: OpportunityObservedChange): string {
  const field =
    change.affectedRuleFields.find((candidate) =>
      ["tags", "genres", "categories"].includes(candidate),
    ) ?? "tags";
  const before = asStringList(fieldValue(change, "before", field)) ?? [];
  const after = asStringList(fieldValue(change, "after", field)) ?? [];
  const added = listDifference(after, before);
  const removed = listDifference(before, after);
  const label = opportunityFieldLabel(field);
  if (added.length > 0 && removed.length > 0) {
    return `${label} changed: added ${joinNatural(added)}; removed ${joinNatural(removed)}.`;
  }
  if (added.length > 0) {
    return `${label} added: ${joinNatural(added)}.`;
  }
  if (removed.length > 0) {
    return `${label} removed: ${joinNatural(removed)}.`;
  }
  return `The game's ${label.toLocaleLowerCase()} changed, but exact additions and removals are not available in the stored evidence.`;
}

function describePlatformChange(change: OpportunityObservedChange): string {
  const before =
    asStringList(
      fieldValue(change, "before", "platforms", [
        "supported_platforms",
        "platform",
      ]),
    ) ?? [];
  const after =
    asStringList(
      fieldValue(change, "after", "platforms", [
        "supported_platforms",
        "platform",
      ]),
    ) ?? [];
  const added = listDifference(after, before).map(readablePlatform);
  const removed = listDifference(before, after).map(readablePlatform);
  if (added.length > 0 && removed.length === 0) {
    return `${joinNatural(added)} support was added.`;
  }
  if (removed.length > 0 && added.length === 0) {
    return `${joinNatural(removed)} support was removed.`;
  }
  if (added.length > 0 || removed.length > 0) {
    return `Platform support changed: added ${joinNatural(added)}; removed ${joinNatural(removed)}.`;
  }
  const controllerBefore = fieldValue(change, "before", "controller_support");
  const controllerAfter = fieldValue(change, "after", "controller_support");
  if (controllerAfter !== undefined && controllerBefore !== controllerAfter) {
    return `Controller support changed from ${formatCompactValue(controllerBefore) ?? "an unknown setting"} to ${formatCompactValue(controllerAfter) ?? "an unknown setting"}.`;
  }
  return "Platform or controller support changed; the exact setting is not available in the stored evidence.";
}

function describeMetricChange(
  change: OpportunityObservedChange,
  field: "ccu_peak" | "total_reviews",
): string {
  const before = Number(fieldValue(change, "before", field));
  const after = Number(fieldValue(change, "after", field));
  const label = opportunityFieldLabel(field);
  if (Number.isFinite(before) && Number.isFinite(after)) {
    const direction = after >= before ? "increased" : "decreased";
    return `${label} ${direction} from ${before.toLocaleString()} to ${after.toLocaleString()}.`;
  }
  if (Number.isFinite(after)) {
    return `${label} reached ${after.toLocaleString()}.`;
  }
  return `${label} crossed an important milestone.`;
}

export function describeOpportunityChange(
  change: OpportunityObservedChange | null,
): string {
  if (!change) {
    return "PublisherIQ identified a new sourcing signal, but no before-and-after snapshot is linked.";
  }
  switch (change.eventType) {
    case "developer_changed":
      return describePartyChange(change, "developer");
    case "publisher_changed":
      return describePartyChange(change, "publisher");
    case "demo_added":
      return "A playable demo was added.";
    case "release_timing_changed": {
      const before = fieldValue(change, "before", "release_date", [
        "release_date_raw",
        "releaseDate",
      ]);
      const after = fieldValue(change, "after", "release_date", [
        "release_date_raw",
        "releaseDate",
      ]);
      if (before !== undefined && after !== undefined) {
        return `Release date moved from ${formatOpportunityDay(String(before))} to ${formatOpportunityDay(String(after))}.`;
      }
      if (after !== undefined) {
        return `Release date moved to ${formatOpportunityDay(String(after))}; the prior date is not available in the stored evidence.`;
      }
      return "The announced release date changed, but both dates are not available in the stored evidence.";
    }
    case "business_model_changed": {
      const beforePrice = fieldValue(change, "before", "price_cents", [
        "current_price_cents",
        "price",
      ]);
      const afterPrice = fieldValue(change, "after", "price_cents", [
        "current_price_cents",
        "price",
      ]);
      const previous = formatCurrency(beforePrice);
      const next = formatCurrency(afterPrice);
      if (previous && next && previous !== next) {
        return `Price changed from ${previous} to ${next}.`;
      }
      const wasFree = fieldValue(change, "before", "is_free");
      const isFree = fieldValue(change, "after", "is_free");
      if (wasFree === false && isFree === true) {
        return "The game became free to play.";
      }
      if (wasFree === true && isFree === false) {
        return "The game moved from free to play to a paid model.";
      }
      const hadPackage = fieldValue(change, "before", "has_purchase_packages");
      const hasPackage = fieldValue(change, "after", "has_purchase_packages");
      if (hadPackage === false && hasPackage === true) {
        return "A Steam purchase option was added.";
      }
      return "The game's price or business model changed, but the stored evidence does not support a more exact comparison.";
    }
    case "platform_expanded":
      return describePlatformChange(change);
    case "taxonomy_repositioned":
      return describeTaxonomyChange(change);
    case "released":
      return "The game was released on Steam.";
    case "first_observed":
      return "PublisherIQ first identified this game on Steam.";
    case "announcement": {
      const title = findNestedValue(change.after, [
        "title",
        "headline",
        "announcement_title",
      ]);
      return typeof title === "string" && title.trim()
        ? `“${title.trim()}” was announced on Steam.`
        : "A new official Steam announcement was published.";
    }
    case "review_breakthrough":
      return describeMetricChange(change, "total_reviews");
    case "ccu_breakthrough":
      return describeMetricChange(change, "ccu_peak");
    case "store_readiness_improved":
      return "The Steam store page added an important sales asset.";
    case "material_change": {
      const field = change.affectedRuleFields[0];
      if (field) {
        const before = fieldValue(change, "before", field);
        const after = fieldValue(change, "after", field);
        if (
          before !== undefined &&
          after !== undefined &&
          formatCompactValue(before) !== formatCompactValue(after)
        ) {
          return `${opportunityFieldLabel(field)} changed from ${formatCompactValue(before) ?? "an unknown value"} to ${formatCompactValue(after) ?? "an unknown value"}.`;
        }
        return `${opportunityFieldLabel(field)} changed; the stored evidence does not contain both values.`;
      }
      return "An important Steam detail changed.";
    }
  }
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
    }[value] ?? humanizeOpportunity(value)
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
  if (token.includes("percentage") || token.includes("rate")) {
    const number = Number(value);
    return Number.isFinite(number)
      ? `${number.toLocaleString()}%`
      : String(value);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function comparisonText(value: unknown): string {
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
