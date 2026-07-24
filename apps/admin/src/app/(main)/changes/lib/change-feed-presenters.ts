import { resolveChangeEventType } from '@publisheriq/shared';
import type {
  ChangeActivityDetail,
  ChangeActivityRow,
  ChangeActivitySignalFamily,
  ChangeActivitySort,
  ChangeActivityStoryKind,
  ChangeActivityView,
  ChangeAnnouncementPreview,
  ChangeBurstDetail,
  ChangeBurstRow,
  ChangeDetailEvent,
  ChangeDiffPreview,
  ChangeNewsRow,
  ChangeTextDiffSection,
  JsonValue,
} from './change-feed-types';

const SIGNAL_ORDER: ChangeActivitySignalFamily[] = [
  'release',
  'pricing',
  'store-page',
  'media',
  'taxonomy',
  'platform',
  'announcement',
  'build',
  'unknown',
];

function formatTokenLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatChangeLabel(changeType: string): string {
  return resolveChangeEventType(changeType).label || formatTokenLabel(changeType);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function toDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecentRelease(releaseDate: string | null): boolean {
  const parsed = toDate(releaseDate);
  if (!parsed) {
    return false;
  }

  const diffMs = Date.now() - parsed.getTime();
  return diffMs >= 0 && diffMs <= 1000 * 60 * 60 * 24 * 30;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const DESCRIPTION_TEXT_FIELDS = [
  { key: 'about', label: 'About this game' },
  { key: 'detailed', label: 'Detailed description' },
] as const;

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    const named = HTML_ENTITY_MAP[normalized];
    if (named) {
      return named;
    }

    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function stripHtml(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const text = decodeHtmlEntities(value)
    .replace(/\r\n?/g, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|section|article|li|ul|ol|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\*\]/g, '\n- ')
    .replace(/\[url=[^\]]+\]/gi, '')
    .replace(/\[\/url\]/gi, '')
    .replace(/\[\/?(?:b|i|u|h[1-6]|list|olist|quote|code|strike|table|tr|td|th)[^\]]*\]/gi, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || null;
}

function truncate(value: string | null, max = 200): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function toStringList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        return String(entry);
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function toScalarText(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return truncate(JSON.stringify(value), 200);
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue | undefined> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toReadableText(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return stripHtml(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function getDescriptionTextKeys(
  beforeValue: JsonValue | undefined,
  afterValue: JsonValue | undefined
): string[] {
  const orderedKeys = DESCRIPTION_TEXT_FIELDS.map((field) => field.key);
  const discoveredKeys = new Set<string>();

  for (const value of [beforeValue, afterValue]) {
    if (!isJsonRecord(value)) {
      continue;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (
        (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') &&
        stripHtml(String(entry))
      ) {
        discoveredKeys.add(key);
      }
    }
  }

  return [
    ...orderedKeys.filter((key) => discoveredKeys.has(key)),
    ...Array.from(discoveredKeys)
      .filter((key) => !orderedKeys.includes(key as (typeof orderedKeys)[number]))
      .sort(),
  ];
}

function getDescriptionFieldLabel(key: string): string {
  return DESCRIPTION_TEXT_FIELDS.find((field) => field.key === key)?.label ?? formatTokenLabel(key);
}

function buildDescriptionTextSections(
  beforeValue: JsonValue | undefined,
  afterValue: JsonValue | undefined,
  fallbackLabel: string
): ChangeTextDiffSection[] {
  if (!isJsonRecord(beforeValue) && !isJsonRecord(afterValue)) {
    const beforeText = toReadableText(beforeValue);
    const afterText = toReadableText(afterValue);

    return beforeText || afterText
      ? [{ id: 'copy', label: fallbackLabel, beforeText, afterText }]
      : [];
  }

  const keys = getDescriptionTextKeys(beforeValue, afterValue);

  return keys
    .map((key) => {
      const beforeText = isJsonRecord(beforeValue) ? toReadableText(beforeValue[key]) : null;
      const afterText = isJsonRecord(afterValue) ? toReadableText(afterValue[key]) : null;

      if (!beforeText && !afterText) {
        return null;
      }

      if (beforeText === afterText) {
        return null;
      }

      return {
        id: key,
        label: getDescriptionFieldLabel(key),
        beforeText,
        afterText,
      };
    })
    .filter((section): section is ChangeTextDiffSection => Boolean(section));
}

function joinTextSections(
  sections: ChangeTextDiffSection[],
  side: 'beforeText' | 'afterText'
): string | null {
  const text = sections
    .map((section) => section[side])
    .filter((value): value is string => Boolean(value))
    .join('\n\n');

  return text || null;
}

function canonicalizeMediaUrlForComparison(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    const withoutHash = trimmed.split('#', 1)[0] ?? '';
    const withoutQuery = withoutHash.split('?', 1)[0] ?? '';
    return withoutQuery.trim() || null;
  }
}

function extractSteamAssetTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.searchParams.get('t');
  } catch {
    const match = /[?&]t=([^&#]+)/.exec(value);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function isQueryOnlyMediaUrlChange(beforeUrl: string | null, afterUrl: string | null): boolean {
  if (!beforeUrl || !afterUrl || beforeUrl === afterUrl) {
    return false;
  }

  const beforeCanonical = canonicalizeMediaUrlForComparison(beforeUrl);
  const afterCanonical = canonicalizeMediaUrlForComparison(afterUrl);

  return Boolean(beforeCanonical && afterCanonical && beforeCanonical === afterCanonical);
}

function uniqueNonNull(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildQueryOnlyMediaNote(beforeUrls: string[], afterUrls: string[]): string {
  const beforeTimestamps = uniqueNonNull(beforeUrls.map(extractSteamAssetTimestamp));
  const afterTimestamps = uniqueNonNull(afterUrls.map(extractSteamAssetTimestamp));
  const baseNote = 'Steam asset timestamp refreshed; image path unchanged.';

  if (beforeTimestamps.length === 1 && afterTimestamps.length === 1) {
    return `${baseNote} t: ${beforeTimestamps[0]} -> ${afterTimestamps[0]}`;
  }

  return baseNote;
}

function getContextString(event: ChangeDetailEvent, key: string): string | null {
  const value = event.context[key];
  return typeof value === 'string' ? value : null;
}

function hasVerifiedContentHashChange(event: ChangeDetailEvent): boolean {
  return getContextString(event, 'mediaChangeReason') === 'content_hash_changed';
}

function formatCurrencyFromCents(value: JsonValue | undefined): string | null {
  if (typeof value !== 'number') {
    return null;
  }

  return `$${(value / 100).toFixed(2)}`;
}

function signalFamiliesFromChangeTypes(changeTypes: string[]): ChangeActivitySignalFamily[] {
  const families = new Set<ChangeActivitySignalFamily>();

  changeTypes.forEach((changeType) => {
    families.add(resolveChangeEventType(changeType).signalFamily);
  });

  return SIGNAL_ORDER.filter((family) => families.has(family));
}

function storyKindForChange(args: {
  signalFamilies: ChangeActivitySignalFamily[];
  headlineChangeTypes: string[];
  isReleased: boolean | null;
  releaseDate: string | null;
}): ChangeActivityStoryKind {
  const { signalFamilies, headlineChangeTypes, isReleased, releaseDate } = args;
  const has = (family: ChangeActivitySignalFamily) => signalFamilies.includes(family);
  const hasChangeType = (changeType: string) => headlineChangeTypes.includes(changeType);

  if (has('release') || isReleased === false || isRecentRelease(releaseDate)) {
    return 'release-prep';
  }
  if (has('pricing')) {
    return 'commercial-move';
  }
  if (has('store-page') || has('media')) {
    return 'store-refresh';
  }
  if (has('taxonomy')) {
    return 'positioning-shift';
  }
  if (has('platform')) {
    return 'platform-expansion';
  }
  if (has('build') || hasChangeType('build_id_changed') || hasChangeType('last_content_update_changed')) {
    return 'build-activity';
  }

  return 'general-update';
}

function headlineForChangeRow(
  row: Pick<
    ChangeBurstRow,
    'headlineChangeTypes' | 'isReleased' | 'releaseDate' | 'eventCount' | 'changeTypeCount'
  >,
  storyKind: ChangeActivityStoryKind
): string {
  switch (storyKind) {
    case 'release-prep':
      if (row.headlineChangeTypes.includes('release_date_text_change')) {
        return 'Locked in more precise release timing';
      }
      return row.isReleased === false
        ? 'Upcoming title showed fresh launch activity'
        : 'A launch-adjacent activity burst landed';
    case 'commercial-move':
      return 'Adjusted pricing, packages, or monetization setup';
    case 'store-refresh':
      return 'Refreshed store presentation and merchandising';
    case 'positioning-shift':
      return 'Shifted tags, genres, or positioning signals';
    case 'platform-expansion':
      return 'Expanded platform, language, or audience reach';
    case 'build-activity':
      return 'Shipped a new build or content update';
    default:
      return row.changeTypeCount > 1
        ? 'Multiple Steam changes landed together'
        : `Changed ${formatChangeLabel(row.headlineChangeTypes[0] ?? 'activity').toLowerCase()}`;
  }
}

function summaryForChangeRow(
  row: Pick<ChangeBurstRow, 'eventCount' | 'changeTypeCount' | 'relatedNewsCount'>,
  signalFamilies: ChangeActivitySignalFamily[],
  storyKind: ChangeActivityStoryKind
): string {
  const familyCopy = signalFamilies
    .filter((family) => family !== 'build')
    .map((family) => family.replace('-', ' '));

  if (storyKind === 'build-activity') {
    return `Grouped ${row.eventCount} technical updates into one readable activity card.`;
  }

  if (familyCopy.length > 0) {
    return `Grouped ${row.eventCount} updates across ${familyCopy.join(', ')} signals so the change is readable at a glance.`;
  }

  return `Grouped ${row.eventCount} updates into a single activity story.`;
}

function factsForChangeRow(row: ChangeBurstRow, signalFamilies: ChangeActivitySignalFamily[]): string[] {
  const facts: string[] = [];

  if (row.isReleased === false) {
    facts.push('Upcoming title');
  } else if (isRecentRelease(row.releaseDate)) {
    facts.push('Released in the last 30 days');
  }

  if (signalFamilies.includes('build')) {
    facts.push('Build activity detected');
  }
  if (signalFamilies.includes('media')) {
    facts.push('Artwork or media moved');
  }
  if (signalFamilies.includes('pricing')) {
    facts.push('Commercial setup changed');
  }
  if (row.relatedNewsCount > 0) {
    facts.push(
      `${row.relatedNewsCount} nearby ${row.relatedNewsCount === 1 ? 'announcement' : 'announcements'}`
    );
  }

  facts.push(
    `${row.changeTypeCount} ${row.changeTypeCount === 1 ? 'change type' : 'change types'}`
  );

  return facts.slice(0, 4);
}

export function buildActivityId(kind: 'change' | 'announcement', value: string): string {
  return `${kind}:${encodeURIComponent(value)}`;
}

export function parseActivityId(activityId: string): { kind: 'change' | 'announcement'; value: string } | null {
  if (activityId.startsWith('change:')) {
    return { kind: 'change', value: decodeURIComponent(activityId.slice('change:'.length)) };
  }

  if (activityId.startsWith('announcement:')) {
    return {
      kind: 'announcement',
      value: decodeURIComponent(activityId.slice('announcement:'.length)),
    };
  }

  return null;
}

export function buildChangeActivityRow(row: ChangeBurstRow): ChangeActivityRow {
  const signalFamilies = signalFamiliesFromChangeTypes(row.headlineChangeTypes);
  const storyKind = storyKindForChange({
    signalFamilies,
    headlineChangeTypes: row.headlineChangeTypes,
    isReleased: row.isReleased,
    releaseDate: row.releaseDate,
  });

  return {
    activityId: buildActivityId('change', row.burstId),
    activityKind: 'change',
    storyKind,
    appid: row.appid,
    appName: row.appName,
    appType: row.appType,
    isReleased: row.isReleased,
    releaseDate: row.releaseDate,
    occurredAt: row.effectiveAt,
    headline: headlineForChangeRow(row, storyKind),
    summary: summaryForChangeRow(row, signalFamilies, storyKind),
    facts: factsForChangeRow(row, signalFamilies),
    highlightLabels: uniqueStrings(row.headlineChangeTypes.map(formatChangeLabel)).slice(0, 4),
    signalFamilies,
    hasBeforeAfter: row.changeTypeCount > 0,
    relatedAnnouncementCount: row.relatedNewsCount,
    externalUrl: null,
  };
}

export function buildAnnouncementPreview(
  row: Pick<
    ChangeNewsRow,
    'gid' | 'title' | 'url' | 'feedLabel' | 'feedName' | 'publishedAt' | 'firstSeenAt'
  > & { excerpt?: string | null }
): ChangeAnnouncementPreview {
  return {
    gid: row.gid,
    title: row.title,
    url: row.url,
    feedLabel: row.feedLabel,
    feedName: row.feedName,
    publishedAt: row.publishedAt,
    firstSeenAt: row.firstSeenAt,
    excerpt: row.excerpt ?? null,
  };
}

export function buildAnnouncementActivityRow(row: ChangeNewsRow): ChangeActivityRow {
  const tags = [row.feedLabel, row.feedName].filter((value): value is string => Boolean(value));

  return {
    activityId: buildActivityId('announcement', row.gid),
    activityKind: 'announcement',
    storyKind: 'announcement',
    appid: row.appid,
    appName: row.appName,
    appType: row.appType,
    isReleased: null,
    releaseDate: null,
    occurredAt: row.publishedAt ?? row.firstSeenAt ?? new Date().toISOString(),
    headline: row.title ?? 'New Steam announcement published',
    summary:
      tags.length > 0
        ? `${row.appName} published a Steam announcement in ${tags.join(' / ')}.`
        : `${row.appName} published a new Steam announcement.`,
    facts: tags.slice(0, 2),
    highlightLabels: tags.slice(0, 3),
    signalFamilies: ['announcement'],
    hasBeforeAfter: false,
    relatedAnnouncementCount: 0,
    externalUrl: row.url,
  };
}

function scoreActivity(row: ChangeActivityRow): {
  relevance: number;
  magnitude: number;
  commercial: number;
  launch: number;
} {
  const storyWeight: Record<ChangeActivityStoryKind, number> = {
    announcement: 16,
    'release-prep': 42,
    'commercial-move': 38,
    'store-refresh': 32,
    'positioning-shift': 30,
    'platform-expansion': 28,
    'build-activity': 14,
    'general-update': 20,
  };

  const signalWeight: Record<ChangeActivitySignalFamily, number> = {
    announcement: 8,
    release: 18,
    pricing: 18,
    'store-page': 12,
    media: 12,
    taxonomy: 10,
    platform: 10,
    build: 4,
    unknown: 0,
  };

  const familyScore = row.signalFamilies.reduce((total, family) => total + signalWeight[family], 0);
  const announcementBonus = row.relatedAnnouncementCount * 6;
  const launchBonus =
    row.storyKind === 'release-prep' || row.isReleased === false || isRecentRelease(row.releaseDate)
      ? 18
      : 0;
  const magnitude = row.highlightLabels.length * 8 + row.facts.length * 2 + announcementBonus;
  const commercial = row.signalFamilies.includes('pricing')
    ? 50 + announcementBonus + magnitude
    : magnitude / 2;
  const relevance = storyWeight[row.storyKind] + familyScore + announcementBonus + launchBonus;
  const launch = launchBonus + (row.signalFamilies.includes('release') ? 30 : 0) + announcementBonus;

  return {
    relevance,
    magnitude,
    commercial,
    launch,
  };
}

function compareByOccurredAt(left: ChangeActivityRow, right: ChangeActivityRow): number {
  return new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
}

export function filterActivitiesForView(
  rows: ChangeActivityRow[],
  view: ChangeActivityView
): ChangeActivityRow[] {
  switch (view) {
    case 'launch-watch':
      return rows.filter(
        (row) =>
          row.storyKind === 'release-prep' || row.isReleased === false || isRecentRelease(row.releaseDate)
      );
    case 'commercial-moves':
      return rows.filter(
        (row) => row.storyKind === 'commercial-move' || row.signalFamilies.includes('pricing')
      );
    case 'store-refreshes':
      return rows.filter(
        (row) =>
          row.storyKind === 'store-refresh' ||
          row.storyKind === 'positioning-shift' ||
          row.storyKind === 'platform-expansion' ||
          row.signalFamilies.some((family) =>
            ['store-page', 'media', 'taxonomy', 'platform'].includes(family)
          )
      );
    default:
      return rows;
  }
}

export function filterActivitiesBySignalFamilies(
  rows: ChangeActivityRow[],
  signalFamilies: ChangeActivitySignalFamily[] | null
): ChangeActivityRow[] {
  if (!signalFamilies || signalFamilies.length === 0) {
    return rows;
  }

  return rows.filter((row) => signalFamilies.some((family) => row.signalFamilies.includes(family)));
}

export function sortActivities(
  rows: ChangeActivityRow[],
  sort: ChangeActivitySort
): ChangeActivityRow[] {
  return [...rows].sort((left, right) => {
    const leftScores = scoreActivity(left);
    const rightScores = scoreActivity(right);

    switch (sort) {
      case 'biggest-change':
        if (rightScores.magnitude !== leftScores.magnitude) {
          return rightScores.magnitude - leftScores.magnitude;
        }
        break;
      case 'most-commercial':
        if (rightScores.commercial !== leftScores.commercial) {
          return rightScores.commercial - leftScores.commercial;
        }
        break;
      case 'most-launch-relevant':
        if (rightScores.launch !== leftScores.launch) {
          return rightScores.launch - leftScores.launch;
        }
        break;
      case 'newest':
        break;
      default:
        if (rightScores.relevance !== leftScores.relevance) {
          return rightScores.relevance - leftScores.relevance;
        }
        break;
    }

    return compareByOccurredAt(left, right);
  });
}

function buildScalarDiff(id: string, label: string, beforeText: string | null, afterText: string | null): ChangeDiffPreview {
  return {
    id,
    label,
    kind: 'scalar',
    beforeText,
    afterText,
    added: [],
    removed: [],
    beforeImageUrl: null,
    afterImageUrl: null,
    note: null,
  };
}

function buildListDiff(
  id: string,
  label: string,
  added: string[],
  removed: string[],
  beforeText: string | null = null,
  afterText: string | null = null
): ChangeDiffPreview {
  return {
    id,
    label,
    kind: 'list',
    beforeText,
    afterText,
    added,
    removed,
    beforeImageUrl: null,
    afterImageUrl: null,
    note: null,
  };
}

function buildTextDiff(
  id: string,
  label: string,
  beforeText: string | null,
  afterText: string | null,
  textSections?: ChangeTextDiffSection[]
): ChangeDiffPreview {
  return {
    id,
    label,
    kind: 'text',
    beforeText,
    afterText,
    textSections,
    added: [],
    removed: [],
    beforeImageUrl: null,
    afterImageUrl: null,
    note: null,
  };
}

function buildMediaDiff(
  id: string,
  label: string,
  beforeImageUrl: string | null,
  afterImageUrl: string | null,
  note: string | null = null
): ChangeDiffPreview {
  return {
    id,
    label,
    kind: 'media',
    beforeText: null,
    afterText: null,
    added: [],
    removed: [],
    beforeImageUrl,
    afterImageUrl,
    note,
  };
}

function buildNoteDiff(id: string, label: string, note: string): ChangeDiffPreview {
  return {
    id,
    label,
    kind: 'note',
    beforeText: null,
    afterText: null,
    added: [],
    removed: [],
    beforeImageUrl: null,
    afterImageUrl: null,
    note,
  };
}

function buildDescriptionTextDiff(
  event: ChangeDetailEvent,
  label: string
): ChangeDiffPreview {
  const textSections = buildDescriptionTextSections(event.beforeValue, event.afterValue, label);

  if (textSections.length === 0) {
    return buildNoteDiff(
      String(event.eventId),
      label,
      'Readable description copy did not change; embedded markup or media attributes changed. Open Raw for the exact payload.'
    );
  }

  return buildTextDiff(
    String(event.eventId),
    label,
    joinTextSections(textSections, 'beforeText'),
    joinTextSections(textSections, 'afterText'),
    textSections
  );
}

function contextArray(event: ChangeDetailEvent, key: 'added' | 'removed'): string[] {
  return toStringList(event.context[key]);
}

function buildMediaDiffOrTimestampNote(
  event: ChangeDetailEvent,
  label: string,
  note: string | null = null
): ChangeDiffPreview {
  const beforeUrl = toScalarText(event.beforeValue);
  const afterUrl = toScalarText(event.afterValue);

  if (isQueryOnlyMediaUrlChange(beforeUrl, afterUrl) && !hasVerifiedContentHashChange(event)) {
    const timestampNote = buildQueryOnlyMediaNote(beforeUrl ? [beforeUrl] : [], afterUrl ? [afterUrl] : []);
    return buildNoteDiff(
      String(event.eventId),
      label,
      note ? `${note}. ${timestampNote}` : timestampNote
    );
  }

  return buildMediaDiff(String(event.eventId), label, beforeUrl, afterUrl, note);
}

export function buildDiffPreview(event: ChangeDetailEvent): ChangeDiffPreview | null {
  switch (event.changeType) {
    case 'release_date_text_change':
      return buildScalarDiff(
        String(event.eventId),
        'Release timing',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue)
      );
    case 'price_change':
      return buildScalarDiff(
        String(event.eventId),
        'Price',
        formatCurrencyFromCents(event.beforeValue),
        formatCurrencyFromCents(event.afterValue)
      );
    case 'discount_start':
    case 'discount_end':
      return buildScalarDiff(
        String(event.eventId),
        'Discount',
        toScalarText(event.beforeValue) ? `${toScalarText(event.beforeValue)}%` : null,
        toScalarText(event.afterValue) ? `${toScalarText(event.afterValue)}%` : null
      );
    case 'build_id_changed':
      return buildScalarDiff(
        String(event.eventId),
        'Build',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue)
      );
    case 'last_content_update_changed':
      return buildScalarDiff(
        String(event.eventId),
        'Content update timestamp',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue)
      );
    case 'controller_support_changed':
      return buildScalarDiff(
        String(event.eventId),
        'Controller support',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue)
      );
    case 'description_rewrite':
      return buildDescriptionTextDiff(event, 'Store description');
    case 'short_description_rewrite':
      return buildDescriptionTextDiff(event, 'Short description');
    case 'genres_changed':
    case 'categories_changed':
    case 'languages_changed':
    case 'platforms_changed':
    case 'tags_added':
    case 'tags_removed':
    case 'publisher_association_changed':
    case 'developer_association_changed':
    case 'dlc_references_changed':
    case 'package_references_changed':
      return buildListDiff(
        String(event.eventId),
        formatChangeLabel(event.changeType),
        contextArray(event, 'added'),
        contextArray(event, 'removed'),
        null,
        null
      );
    case 'header_url_changed':
      return buildMediaDiffOrTimestampNote(event, 'Header art');
    case 'capsule_url_changed':
      return buildMediaDiffOrTimestampNote(event, 'Capsule art');
    case 'background_url_changed':
      return buildMediaDiffOrTimestampNote(event, 'Background art');
    case 'screenshot_added':
      return buildListDiff(
        String(event.eventId),
        'Screenshots added',
        toStringList(event.afterValue),
        [],
        null,
        null
      );
    case 'screenshot_removed':
      return buildListDiff(
        String(event.eventId),
        'Screenshots removed',
        [],
        toStringList(event.beforeValue),
        null,
        null
      );
    case 'screenshot_reordered':
      return buildNoteDiff(String(event.eventId), 'Screenshot order', 'Reordered screenshot sequence');
    case 'trailer_added':
      return buildListDiff(
        String(event.eventId),
        'Trailers added',
        toStringList(event.afterValue),
        [],
        null,
        null
      );
    case 'trailer_removed':
      return buildListDiff(
        String(event.eventId),
        'Trailers removed',
        [],
        toStringList(event.beforeValue),
        null,
        null
      );
    case 'trailer_reordered':
      return buildNoteDiff(String(event.eventId), 'Trailer order', 'Reordered trailer sequence');
    case 'trailer_thumbnail_changed':
      return buildMediaDiffOrTimestampNote(
        event,
        'Trailer thumbnail',
        toScalarText(event.context.movieName) ?? null
      );
    default:
      return buildNoteDiff(
        String(event.eventId),
        formatChangeLabel(event.changeType),
        'Additional structured change detected'
      );
  }
}

interface ScreenshotDiffEntry {
  eventId: number;
  url: string;
  canonicalUrl: string | null;
}

function toScreenshotEntries(event: ChangeDetailEvent, side: 'beforeValue' | 'afterValue'): ScreenshotDiffEntry[] {
  return toStringList(event[side]).map((url) => ({
    eventId: event.eventId,
    url,
    canonicalUrl: canonicalizeMediaUrlForComparison(url),
  }));
}

function buildScreenshotDiffPreviews(events: ChangeDetailEvent[]): ChangeDiffPreview[] {
  const addedEvents = events.filter((event) => event.changeType === 'screenshot_added');
  const removedEvents = events.filter((event) => event.changeType === 'screenshot_removed');
  const addedEntries = addedEvents.flatMap((event) => toScreenshotEntries(event, 'afterValue'));
  const removedEntries = removedEvents.flatMap((event) => toScreenshotEntries(event, 'beforeValue'));
  const unmatchedAdded = [...addedEntries];
  const timestampPairs: Array<{ beforeUrl: string; afterUrl: string }> = [];

  const unmatchedRemoved = removedEntries.filter((removed) => {
    if (!removed.canonicalUrl) {
      return true;
    }

    const addedIndex = unmatchedAdded.findIndex(
      (added) => added.canonicalUrl && added.canonicalUrl === removed.canonicalUrl
    );

    if (addedIndex === -1) {
      return true;
    }

    const [added] = unmatchedAdded.splice(addedIndex, 1);
    if (isQueryOnlyMediaUrlChange(removed.url, added.url)) {
      timestampPairs.push({ beforeUrl: removed.url, afterUrl: added.url });
    }

    return false;
  });

  const diffs: ChangeDiffPreview[] = [];
  const eventIds = [...addedEvents, ...removedEvents].map((event) => event.eventId).sort((left, right) => left - right);

  if (timestampPairs.length > 0) {
    diffs.push(
      buildNoteDiff(
        `screenshots-query-only-${eventIds.join('-')}`,
        'Screenshots',
        buildQueryOnlyMediaNote(
          timestampPairs.map((pair) => pair.beforeUrl),
          timestampPairs.map((pair) => pair.afterUrl)
        )
      )
    );
  }

  if (unmatchedAdded.length > 0) {
    diffs.push(
      buildListDiff(
        `screenshots-added-${eventIds.join('-')}`,
        'Screenshots added',
        unmatchedAdded.map((entry) => entry.url),
        [],
        null,
        null
      )
    );
  }

  if (unmatchedRemoved.length > 0) {
    diffs.push(
      buildListDiff(
        `screenshots-removed-${eventIds.join('-')}`,
        'Screenshots removed',
        [],
        unmatchedRemoved.map((entry) => entry.url),
        null,
        null
      )
    );
  }

  return diffs;
}

export function buildDiffPreviews(events: ChangeDetailEvent[]): ChangeDiffPreview[] {
  const screenshotEvents = events.filter((event) =>
    event.changeType === 'screenshot_added' || event.changeType === 'screenshot_removed'
  );
  const screenshotDiffs = buildScreenshotDiffPreviews(screenshotEvents);
  let screenshotDiffsInserted = false;
  const diffs: ChangeDiffPreview[] = [];

  for (const event of events) {
    if (event.changeType === 'screenshot_added' || event.changeType === 'screenshot_removed') {
      if (!screenshotDiffsInserted) {
        diffs.push(...screenshotDiffs);
        screenshotDiffsInserted = true;
      }
      continue;
    }

    const diff = buildDiffPreview(event);
    if (diff) {
      diffs.push(diff);
    }
  }

  if (!screenshotDiffsInserted && screenshotDiffs.length > 0) {
    diffs.push(...screenshotDiffs);
  }

  return diffs;
}

export function buildChangeActivityDetail(detail: ChangeBurstDetail): ChangeActivityDetail {
  const row = buildChangeActivityRow(detail);

  return {
    ...row,
    rawEvents: detail.events,
    diffs: buildDiffPreviews(detail.events),
    relatedAnnouncements: detail.relatedNews.map((newsItem) => buildAnnouncementPreview(newsItem)),
    aftermath: detail.impact,
    body: null,
  };
}

export function buildAnnouncementActivityDetail(args: {
  row: ChangeNewsRow;
  body: string | null;
  excerpt: string | null;
}): ChangeActivityDetail {
  const row = buildAnnouncementActivityRow(args.row);

  return {
    ...row,
    summary: args.excerpt ?? row.summary,
    rawEvents: [],
    diffs: [],
    relatedAnnouncements: [buildAnnouncementPreview({ ...args.row, excerpt: args.excerpt })],
    aftermath: null,
    body: args.body,
  };
}
