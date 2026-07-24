export const CHANGE_EVENT_REGISTRY_VERSION = "change-events/v1" as const;

export const CHANGE_EVENT_SIGNAL_FAMILIES = [
  "announcement",
  "release",
  "pricing",
  "store-page",
  "media",
  "taxonomy",
  "platform",
  "build",
  "unknown",
] as const;

export type ChangeEventSignalFamily =
  (typeof CHANGE_EVENT_SIGNAL_FAMILIES)[number];

export const CHANGE_EVENT_STORY_KINDS = [
  "announcement",
  "release-prep",
  "commercial-move",
  "store-refresh",
  "positioning-shift",
  "platform-expansion",
  "build-activity",
  "general-update",
] as const;

export type ChangeEventStoryKind = (typeof CHANGE_EVENT_STORY_KINDS)[number];

export const CHANGE_EVENT_UNKNOWN_BEHAVIOR = "preserve_unknown" as const;

export interface ChangeEventRegistryEntry {
  affectsEligibilityInputs: boolean;
  affectsReadiness: boolean;
  label: string;
  rawEventType: string;
  signalFamily: Exclude<ChangeEventSignalFamily, "unknown">;
  source: string;
  storyKind: Exclude<ChangeEventStoryKind, "general-update">;
}

export interface ResolvedChangeEventDefinition {
  affectsEligibilityInputs: boolean;
  affectsReadiness: boolean;
  isKnown: boolean;
  label: string;
  rawEventType: string;
  registryVersion: typeof CHANGE_EVENT_REGISTRY_VERSION;
  signalFamily: ChangeEventSignalFamily;
  source: string;
  storyKind: ChangeEventStoryKind;
  unknownBehavior: typeof CHANGE_EVENT_UNKNOWN_BEHAVIOR;
}

const announcement = (
  rawEventType: string,
  label: string,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness: false,
  label,
  rawEventType,
  signalFamily: "announcement",
  source: "news",
  storyKind: "announcement",
});

const release = (
  source: string,
  rawEventType: string,
  label: string,
  affectsReadiness = false,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness,
  label,
  rawEventType,
  signalFamily: "release",
  source,
  storyKind: "release-prep",
});

const pricing = (
  source: string,
  rawEventType: string,
  label: string,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness: false,
  label,
  rawEventType,
  signalFamily: "pricing",
  source,
  storyKind: "commercial-move",
});

const storePage = (
  rawEventType: string,
  label: string,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness: false,
  label,
  rawEventType,
  signalFamily: "store-page",
  source: "storefront",
  storyKind: "store-refresh",
});

const media = (
  rawEventType: string,
  label: string,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness: false,
  label,
  rawEventType,
  signalFamily: "media",
  source: "media",
  storyKind: "store-refresh",
});

const taxonomy = (
  source: string,
  rawEventType: string,
  label: string,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness: source === "pics",
  label,
  rawEventType,
  signalFamily: "taxonomy",
  source,
  storyKind: "positioning-shift",
});

const platform = (
  source: string,
  rawEventType: string,
  label: string,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness: source === "pics",
  label,
  rawEventType,
  signalFamily: "platform",
  source,
  storyKind: "platform-expansion",
});

const build = (
  rawEventType: string,
  label: string,
): ChangeEventRegistryEntry => ({
  affectsEligibilityInputs: true,
  affectsReadiness: false,
  label,
  rawEventType,
  signalFamily: "build",
  source: "pics",
  storyKind: "build-activity",
});

export const CHANGE_EVENT_REGISTRY: readonly ChangeEventRegistryEntry[] = [
  announcement("news_published", "Announcement"),
  announcement("news_edited", "Announcement edit"),
  release("catalog", "first_observed", "First observed", true),
  release("storefront", "release_date_text_change", "Release timing"),
  release("storefront", "release_state_changed", "Release state", true),
  release("storefront", "demo_references_changed", "Playable demo", true),
  pricing("storefront", "price_change", "Price"),
  pricing("storefront", "discount_start", "Discount"),
  pricing("storefront", "discount_end", "Discount"),
  pricing("storefront", "dlc_references_changed", "DLC"),
  pricing("pics", "dlc_references_changed", "DLC"),
  pricing("storefront", "package_references_changed", "Packages"),
  storePage("description_rewrite", "Store description"),
  storePage("short_description_rewrite", "Short description"),
  media("capsule_url_changed", "Capsule art"),
  media("header_url_changed", "Header art"),
  media("background_url_changed", "Background art"),
  media("screenshot_added", "Screenshots"),
  media("screenshot_removed", "Screenshots"),
  media("screenshot_reordered", "Screenshots"),
  media("trailer_added", "Trailer"),
  media("trailer_removed", "Trailer"),
  media("trailer_reordered", "Trailer"),
  media("trailer_thumbnail_changed", "Trailer art"),
  taxonomy("storefront", "genres_changed", "Genres"),
  taxonomy("pics", "genres_changed", "Genres"),
  taxonomy("storefront", "categories_changed", "Categories"),
  taxonomy("pics", "categories_changed", "Categories"),
  taxonomy("pics", "tags_added", "Tags"),
  taxonomy("pics", "tags_removed", "Tags"),
  taxonomy("storefront", "publisher_association_changed", "Publisher"),
  taxonomy("pics", "publisher_association_changed", "Publisher"),
  taxonomy("storefront", "developer_association_changed", "Developer"),
  taxonomy("pics", "developer_association_changed", "Developer"),
  platform("storefront", "languages_changed", "Languages"),
  platform("pics", "languages_changed", "Languages"),
  platform("storefront", "platforms_changed", "Platforms"),
  platform("pics", "platforms_changed", "Platforms"),
  platform("storefront", "controller_support_changed", "Controller support"),
  platform("pics", "controller_support_changed", "Controller support"),
  platform("pics", "steam_deck_status_changed", "Steam Deck"),
  build("build_id_changed", "Build"),
  build("last_content_update_changed", "Content update"),
] as const;

const CHANGE_EVENT_REGISTRY_BY_KEY = new Map(
  CHANGE_EVENT_REGISTRY.map((entry) => [
    `${entry.source}\u0000${entry.rawEventType}`,
    entry,
  ]),
);

const CHANGE_EVENT_REGISTRY_BY_TYPE = new Map<
  string,
  ChangeEventRegistryEntry[]
>();
for (const entry of CHANGE_EVENT_REGISTRY) {
  const entries = CHANGE_EVENT_REGISTRY_BY_TYPE.get(entry.rawEventType) ?? [];
  entries.push(entry);
  CHANGE_EVENT_REGISTRY_BY_TYPE.set(entry.rawEventType, entries);
}

function formatUnknownLabel(rawEventType: string): string {
  const formatted = rawEventType
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

  return formatted || "Unknown change";
}

function toResolved(
  entry: ChangeEventRegistryEntry,
  source: string,
): ResolvedChangeEventDefinition {
  return {
    ...entry,
    isKnown: true,
    registryVersion: CHANGE_EVENT_REGISTRY_VERSION,
    source,
    unknownBehavior: CHANGE_EVENT_UNKNOWN_BEHAVIOR,
  };
}

export function resolveChangeEventDefinition(
  source: string,
  rawEventType: string,
): ResolvedChangeEventDefinition {
  const entry = CHANGE_EVENT_REGISTRY_BY_KEY.get(
    `${source}\u0000${rawEventType}`,
  );
  if (entry) {
    return toResolved(entry, source);
  }

  return {
    affectsEligibilityInputs: false,
    affectsReadiness: false,
    isKnown: false,
    label: formatUnknownLabel(rawEventType),
    rawEventType,
    registryVersion: CHANGE_EVENT_REGISTRY_VERSION,
    signalFamily: "unknown",
    source,
    storyKind: "general-update",
    unknownBehavior: CHANGE_EVENT_UNKNOWN_BEHAVIOR,
  };
}

export function resolveChangeEventType(
  rawEventType: string,
): ResolvedChangeEventDefinition {
  const candidates = CHANGE_EVENT_REGISTRY_BY_TYPE.get(rawEventType) ?? [];
  if (candidates.length === 0) {
    return resolveChangeEventDefinition("unknown", rawEventType);
  }

  const first = candidates[0];
  const isUnambiguous = candidates.every(
    (candidate) =>
      candidate.label === first.label &&
      candidate.signalFamily === first.signalFamily &&
      candidate.storyKind === first.storyKind,
  );

  return isUnambiguous
    ? toResolved(first, first.source)
    : resolveChangeEventDefinition("unknown", rawEventType);
}
