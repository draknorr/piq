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
  JsonValue,
} from './change-feed-types';

const CHANGE_LABELS: Record<string, string> = {
  description_rewrite: 'Store description',
  short_description_rewrite: 'Short description',
  release_date_text_change: 'Release timing',
  price_change: 'Price',
  discount_start: 'Discount',
  discount_end: 'Discount',
  tags_added: 'Tags',
  tags_removed: 'Tags',
  genres_changed: 'Genres',
  categories_changed: 'Categories',
  languages_changed: 'Languages',
  platforms_changed: 'Platforms',
  controller_support_changed: 'Controller support',
  steam_deck_status_changed: 'Steam Deck',
  publisher_association_changed: 'Publisher',
  developer_association_changed: 'Developer',
  dlc_references_changed: 'DLC',
  package_references_changed: 'Packages',
  build_id_changed: 'Build',
  last_content_update_changed: 'Content update',
  news_published: 'Announcement',
  news_edited: 'Announcement edit',
  capsule_url_changed: 'Capsule art',
  header_url_changed: 'Header art',
  background_url_changed: 'Background art',
  screenshot_added: 'Screenshots',
  screenshot_removed: 'Screenshots',
  screenshot_reordered: 'Screenshots',
  trailer_added: 'Trailer',
  trailer_removed: 'Trailer',
  trailer_reordered: 'Trailer',
  trailer_thumbnail_changed: 'Trailer art',
};

const SIGNAL_ORDER: ChangeActivitySignalFamily[] = [
  'release',
  'pricing',
  'store-page',
  'media',
  'taxonomy',
  'platform',
  'announcement',
  'build',
];

function formatTokenLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatChangeLabel(changeType: string): string {
  return CHANGE_LABELS[changeType] ?? formatTokenLabel(changeType);
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

function stripHtml(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function formatCurrencyFromCents(value: JsonValue | undefined): string | null {
  if (typeof value !== 'number') {
    return null;
  }

  return `$${(value / 100).toFixed(2)}`;
}

function signalFamiliesFromChangeTypes(changeTypes: string[]): ChangeActivitySignalFamily[] {
  const families = new Set<ChangeActivitySignalFamily>();

  changeTypes.forEach((changeType) => {
    switch (changeType) {
      case 'release_date_text_change':
        families.add('release');
        break;
      case 'price_change':
      case 'discount_start':
      case 'discount_end':
      case 'dlc_references_changed':
      case 'package_references_changed':
        families.add('pricing');
        break;
      case 'description_rewrite':
      case 'short_description_rewrite':
        families.add('store-page');
        break;
      case 'capsule_url_changed':
      case 'header_url_changed':
      case 'background_url_changed':
      case 'screenshot_added':
      case 'screenshot_removed':
      case 'screenshot_reordered':
      case 'trailer_added':
      case 'trailer_removed':
      case 'trailer_reordered':
      case 'trailer_thumbnail_changed':
        families.add('media');
        break;
      case 'tags_added':
      case 'tags_removed':
      case 'genres_changed':
      case 'categories_changed':
      case 'publisher_association_changed':
      case 'developer_association_changed':
        families.add('taxonomy');
        break;
      case 'languages_changed':
      case 'platforms_changed':
      case 'controller_support_changed':
      case 'steam_deck_status_changed':
        families.add('platform');
        break;
      case 'build_id_changed':
      case 'last_content_update_changed':
        families.add('build');
        break;
      case 'news_published':
      case 'news_edited':
        families.add('announcement');
        break;
      default:
        families.add('store-page');
        break;
    }
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

function buildTextDiff(id: string, label: string, beforeText: string | null, afterText: string | null): ChangeDiffPreview {
  return {
    id,
    label,
    kind: 'text',
    beforeText,
    afterText,
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

function contextArray(event: ChangeDetailEvent, key: 'added' | 'removed'): string[] {
  return toStringList(event.context[key]);
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
      return buildTextDiff(
        String(event.eventId),
        'Store description',
        truncate(stripHtml(toScalarText(event.beforeValue)), 260),
        truncate(stripHtml(toScalarText(event.afterValue)), 260)
      );
    case 'short_description_rewrite':
      return buildTextDiff(
        String(event.eventId),
        'Short description',
        truncate(stripHtml(toScalarText(event.beforeValue)), 220),
        truncate(stripHtml(toScalarText(event.afterValue)), 220)
      );
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
      return buildMediaDiff(
        String(event.eventId),
        'Header art',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue)
      );
    case 'capsule_url_changed':
      return buildMediaDiff(
        String(event.eventId),
        'Capsule art',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue)
      );
    case 'background_url_changed':
      return buildMediaDiff(
        String(event.eventId),
        'Background art',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue)
      );
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
      return buildMediaDiff(
        String(event.eventId),
        'Trailer thumbnail',
        toScalarText(event.beforeValue),
        toScalarText(event.afterValue),
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

export function buildChangeActivityDetail(detail: ChangeBurstDetail): ChangeActivityDetail {
  const row = buildChangeActivityRow(detail);

  return {
    ...row,
    diffs: detail.events
      .map(buildDiffPreview)
      .filter((diff): diff is ChangeDiffPreview => Boolean(diff)),
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
    diffs: [],
    relatedAnnouncements: [buildAnnouncementPreview({ ...args.row, excerpt: args.excerpt })],
    aftermath: null,
    body: args.body,
  };
}
