import { createHash } from "node:crypto";

import {
  OPPORTUNITY_MATERIALITY_VERSION,
  type OpportunityConfidence,
  type OpportunityMaterialEventType,
  type OpportunityRuleField,
  type OpportunitySignalFamily,
} from "./types.js";

export interface OpportunitySourceEvent {
  affectsEligibilityInputs: boolean;
  afterValue: unknown;
  appid: number;
  beforeValue: unknown;
  effectiveAt: string;
  observedAt: string;
  rawEventType: string;
  signalFamily: OpportunitySignalFamily;
  source: string;
  sourceEventId: string;
}

export interface OpportunityMaterialMoment {
  affectedRuleFields: OpportunityRuleField[];
  afterSummary: unknown[];
  appid: number;
  beforeSummary: unknown[];
  classifierVersion: typeof OPPORTUNITY_MATERIALITY_VERSION;
  confidence: OpportunityConfidence;
  createsDailyResult: boolean;
  effectiveAt: string;
  eligibleForImmediate: boolean;
  eventFingerprint: string;
  eventType: OpportunityMaterialEventType;
  groupedWindowEnd: string;
  groupedWindowStart: string;
  materiality: number;
  observedAt: string;
  rawEventIds: string[];
  reevaluateEligibility: boolean;
  signalFamily: OpportunitySignalFamily;
}

const GROUP_WINDOW_MS = 30 * 60 * 1_000;

const TYPE_FIELDS: Record<string, OpportunityRuleField[]> = {
  categories_changed: ["categories"],
  controller_support_changed: ["controller_support"],
  ccu_breakthrough: ["ccu_peak", "ccu_change_7d", "ccu_change_30d"],
  demo_references_changed: ["has_demo"],
  developer_association_changed: [
    "developer",
    "developer_game_count",
    "self_published",
  ],
  discount_end: ["discount_percent"],
  discount_start: ["discount_percent"],
  genres_changed: ["genres"],
  languages_changed: ["languages"],
  package_references_changed: ["has_purchase_packages"],
  platforms_changed: ["platforms"],
  price_change: ["price_cents", "is_free"],
  publisher_association_changed: [
    "publisher",
    "publisher_game_count",
    "no_publisher_listed",
    "self_published",
  ],
  release_date_text_change: ["release_date", "days_until_release"],
  release_state_changed: ["release_state", "is_released"],
  review_breakthrough: [
    "total_reviews",
    "positive_percentage",
    "reviews_added_7d",
    "reviews_added_30d",
  ],
  steam_deck_status_changed: ["steam_deck"],
  tags_added: ["tags"],
  tags_removed: ["tags"],
};

function demoReferences(
  value: unknown,
  path = "demo",
  result = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      result.add(`${path}:${JSON.stringify(item)}`);
    });
    return result;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      demoReferences(nested, `${path}.${key}`, result);
    });
    return result;
  }
  if (value === true) {
    result.add(`${path}:true`);
  }
  return result;
}

function mapEventType(
  events: OpportunitySourceEvent[],
): OpportunityMaterialEventType {
  const rawTypes = new Set(events.map((event) => event.rawEventType));
  if (rawTypes.has("first_observed")) {
    return "first_observed";
  }
  if (rawTypes.has("release_state_changed")) {
    const released = events.some((event) => {
      const serialized = JSON.stringify(event.afterValue).toLocaleLowerCase();
      return (
        serialized.includes('"is_released":true') ||
        serialized.includes('"released"') ||
        serialized === "true"
      );
    });
    return released ? "released" : "material_change";
  }
  if (rawTypes.has("demo_references_changed")) {
    const demoAdded = events.some((event) => {
      if (event.rawEventType !== "demo_references_changed") {
        return false;
      }
      const before = demoReferences(event.beforeValue);
      return [...demoReferences(event.afterValue)].some(
        (reference) => !before.has(reference),
      );
    });
    return demoAdded ? "demo_added" : "material_change";
  }
  if (rawTypes.has("release_date_text_change")) {
    return "release_timing_changed";
  }
  if (rawTypes.has("publisher_association_changed")) {
    return "publisher_changed";
  }
  if (rawTypes.has("developer_association_changed")) {
    return "developer_changed";
  }
  if (
    rawTypes.has("tags_added") ||
    rawTypes.has("tags_removed") ||
    rawTypes.has("genres_changed") ||
    rawTypes.has("categories_changed")
  ) {
    return "taxonomy_repositioned";
  }
  if (
    rawTypes.has("price_change") ||
    rawTypes.has("package_references_changed")
  ) {
    return "business_model_changed";
  }
  if (
    rawTypes.has("platforms_changed") ||
    rawTypes.has("languages_changed") ||
    rawTypes.has("steam_deck_status_changed") ||
    rawTypes.has("controller_support_changed")
  ) {
    return "platform_expanded";
  }
  if (rawTypes.has("news_published")) {
    return "announcement";
  }
  if (rawTypes.has("review_breakthrough")) {
    return "review_breakthrough";
  }
  if (rawTypes.has("ccu_breakthrough")) {
    return "ccu_breakthrough";
  }
  if (
    events.some((event) => event.signalFamily === "store-page") ||
    events.some((event) => event.signalFamily === "media")
  ) {
    return "store_readiness_improved";
  }
  return "material_change";
}

function baseMateriality(type: OpportunityMaterialEventType): number {
  return {
    announcement: 0.65,
    business_model_changed: 0.55,
    ccu_breakthrough: 0.85,
    date_window_changed: 1,
    demo_added: 0.95,
    developer_changed: 0.9,
    first_observed: 1,
    material_change: 0.35,
    platform_expanded: 0.55,
    publisher_changed: 0.95,
    release_timing_changed: 0.85,
    released: 1,
    review_breakthrough: 0.85,
    store_readiness_improved: 0.45,
    taxonomy_repositioned: 0.75,
  }[type];
}

function fingerprint(params: {
  appid: number;
  eventType: OpportunityMaterialEventType;
  groupedWindowStart: string;
  rawEventIds: string[];
  signalFamily: OpportunitySignalFamily;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        appid: params.appid,
        classifierVersion: OPPORTUNITY_MATERIALITY_VERSION,
        eventType: params.eventType,
        groupedWindowStart: params.groupedWindowStart,
        rawEventIds: [...params.rawEventIds].sort(),
        signalFamily: params.signalFamily,
      }),
    )
    .digest("hex");
}

function buildMoment(
  events: OpportunitySourceEvent[],
): OpportunityMaterialMoment {
  const ordered = [...events].sort(
    (left, right) =>
      new Date(left.observedAt).getTime() -
        new Date(right.observedAt).getTime() ||
      left.sourceEventId.localeCompare(right.sourceEventId),
  );
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const eventType = mapEventType(ordered);
  const sourceFamilies = Array.from(
    new Set(ordered.map((event) => event.signalFamily)),
  );
  const signalFamily =
    sourceFamilies.length === 1 ? sourceFamilies[0]! : first.signalFamily;
  const independentSources = new Set(ordered.map((event) => event.source)).size;
  const materiality = Math.min(
    1,
    baseMateriality(eventType) +
      Math.min(0.1, (ordered.length - 1) * 0.02) +
      (independentSources > 1 ? 0.05 : 0),
  );
  const rawEventIds = ordered.map((event) => event.sourceEventId);
  const affectedRuleFields = Array.from(
    new Set(ordered.flatMap((event) => TYPE_FIELDS[event.rawEventType] ?? [])),
  );
  const groupedWindowStart = first.observedAt;
  const groupedWindowEnd = last.observedAt;

  return {
    affectedRuleFields,
    afterSummary: ordered.map((event) => event.afterValue),
    appid: first.appid,
    beforeSummary: ordered.map((event) => event.beforeValue),
    classifierVersion: OPPORTUNITY_MATERIALITY_VERSION,
    confidence:
      independentSources > 1 || materiality >= 0.75 ? "high" : "directional",
    createsDailyResult: materiality >= 0.5,
    effectiveAt: ordered
      .map((event) => event.effectiveAt)
      .sort()
      .at(-1)!,
    eligibleForImmediate: eventType === "first_observed",
    eventFingerprint: fingerprint({
      appid: first.appid,
      eventType,
      groupedWindowStart,
      rawEventIds,
      signalFamily,
    }),
    eventType,
    groupedWindowEnd,
    groupedWindowStart,
    materiality,
    observedAt: last.observedAt,
    rawEventIds,
    reevaluateEligibility: ordered.some(
      (event) => event.affectsEligibilityInputs,
    ),
    signalFamily,
  };
}

export function groupOpportunitySourceEvents(
  sourceEvents: OpportunitySourceEvent[],
): OpportunityMaterialMoment[] {
  const sorted = [...sourceEvents].sort(
    (left, right) =>
      left.appid - right.appid ||
      left.signalFamily.localeCompare(right.signalFamily) ||
      new Date(left.observedAt).getTime() -
        new Date(right.observedAt).getTime() ||
      left.sourceEventId.localeCompare(right.sourceEventId),
  );
  const groups: OpportunitySourceEvent[][] = [];

  for (const event of sorted) {
    const current = groups.at(-1);
    if (!current) {
      groups.push([event]);
      continue;
    }
    const first = current[0]!;
    const last = current.at(-1)!;
    const sameGroup =
      event.appid === first.appid &&
      event.signalFamily === first.signalFamily &&
      new Date(event.observedAt).getTime() -
        new Date(last.observedAt).getTime() <=
        GROUP_WINDOW_MS;

    if (sameGroup) {
      current.push(event);
    } else {
      groups.push([event]);
    }
  }

  return groups.map(buildMoment);
}
