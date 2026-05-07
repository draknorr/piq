import type { UnreleasedGame, UnreleasedSortField } from './unreleased-types';

export type UnreleasedColumnCategory =
  | 'opportunity'
  | 'timeline'
  | 'entities'
  | 'activity'
  | 'taxonomy'
  | 'media'
  | 'commercial';

export type UnreleasedColumnId =
  | 'opportunity_score'
  | 'release'
  | 'latest_added'
  | 'publisher_developer'
  | 'latest_update'
  | 'latest_news'
  | 'taxonomy'
  | 'media'
  | 'adult_content'
  | 'genres'
  | 'tags'
  | 'categories'
  | 'platforms'
  | 'pricing'
  | 'free_status'
  | 'purchase_packages'
  | 'workshop'
  | 'publisher_status'
  | 'publisher_name'
  | 'developer_name'
  | 'publisher_game_count'
  | 'publisher_owners'
  | 'signal_families'
  | 'activity_counts'
  | 'release_state'
  | 'app_state';

export interface UnreleasedColumnExportField {
  header: string;
  getValue: (game: UnreleasedGame) => unknown;
}

export interface UnreleasedColumnDefinition {
  id: UnreleasedColumnId;
  label: string;
  shortLabel?: string;
  category: UnreleasedColumnCategory;
  width: number;
  sortable: boolean;
  sortField?: UnreleasedSortField;
  methodology?: string;
  exportFields: UnreleasedColumnExportField[];
}

export const DEFAULT_UNRELEASED_COLUMNS: UnreleasedColumnId[] = [
  'opportunity_score',
  'release',
  'latest_added',
  'publisher_developer',
  'latest_update',
  'latest_news',
  'taxonomy',
  'media',
];

export const UNRELEASED_COLUMN_DEFINITIONS: Record<UnreleasedColumnId, UnreleasedColumnDefinition> = {
  opportunity_score: {
    id: 'opportunity_score',
    label: 'Opportunity Score',
    shortLabel: 'Opp Score',
    category: 'opportunity',
    width: 96,
    sortable: true,
    sortField: 'opportunity_score',
    methodology: '0-100 signal combining release timing, change activity, store completeness, and publisher fit.',
    exportFields: [
      { header: 'opportunity_score', getValue: (game) => game.opportunity_score },
    ],
  },
  release: {
    id: 'release',
    label: 'Release',
    category: 'timeline',
    width: 132,
    sortable: true,
    sortField: 'release_date',
    methodology: 'Release timing and status for upcoming or undated games.',
    exportFields: [
      { header: 'release_date', getValue: (game) => game.release_date },
      { header: 'release_date_raw', getValue: (game) => game.release_date_raw },
      { header: 'release_status', getValue: (game) => game.release_status },
      { header: 'days_until_release', getValue: (game) => game.days_until_release },
    ],
  },
  latest_added: {
    id: 'latest_added',
    label: 'Added',
    category: 'timeline',
    width: 88,
    sortable: true,
    sortField: 'latest_added_at',
    methodology: 'Most recent time this app entered the upcoming-game dataset.',
    exportFields: [
      { header: 'latest_added_at', getValue: (game) => game.latest_added_at },
    ],
  },
  publisher_developer: {
    id: 'publisher_developer',
    label: 'Publisher / Developer',
    category: 'entities',
    width: 190,
    sortable: true,
    sortField: 'publisher_name',
    methodology: 'Publisher and developer links from Steam and PublisherIQ entity matching.',
    exportFields: [
      { header: 'publisher', getValue: (game) => game.publisher_name },
      { header: 'developer', getValue: (game) => game.developer_name },
      { header: 'publisher_status', getValue: (game) => game.publisher_status },
    ],
  },
  latest_update: {
    id: 'latest_update',
    label: 'Latest Update',
    category: 'activity',
    width: 190,
    sortable: true,
    sortField: 'latest_change_at',
    methodology: 'Latest captured Steam storefront or metadata change.',
    exportFields: [
      { header: 'latest_change_at', getValue: (game) => game.latest_change_at },
      { header: 'latest_change_type', getValue: (game) => game.latest_change_type },
      { header: 'latest_change_summary', getValue: (game) => game.latest_change_summary },
      { header: 'change_count_30d', getValue: (game) => game.change_count_30d },
      { header: 'announcement_count_30d', getValue: (game) => game.announcement_count_30d },
    ],
  },
  latest_news: {
    id: 'latest_news',
    label: 'News',
    category: 'activity',
    width: 190,
    sortable: true,
    sortField: 'latest_news_at',
    methodology: 'Most recent Steam news item captured for this app.',
    exportFields: [
      { header: 'latest_news_at', getValue: (game) => game.latest_news_at },
      { header: 'latest_news_title', getValue: (game) => game.latest_news_title },
      { header: 'latest_news_url', getValue: (game) => game.latest_news_url },
    ],
  },
  taxonomy: {
    id: 'taxonomy',
    label: 'Tags / Features',
    category: 'taxonomy',
    width: 210,
    sortable: true,
    sortField: 'primary_tag_name',
    methodology: 'Primary player-facing tags and Steam feature categories.',
    exportFields: [
      { header: 'genres', getValue: (game) => game.genre_names },
      { header: 'tags', getValue: (game) => game.tag_names },
      { header: 'categories', getValue: (game) => game.category_names },
    ],
  },
  media: {
    id: 'media',
    label: 'Media',
    category: 'media',
    width: 84,
    sortable: true,
    sortField: 'screenshot_count',
    methodology: 'Screenshot and trailer counts captured from Steam media data.',
    exportFields: [
      { header: 'screenshots', getValue: (game) => game.screenshot_count },
      { header: 'trailers', getValue: (game) => game.movie_count },
      { header: 'media_count_30d', getValue: (game) => game.media_count_30d },
    ],
  },
  adult_content: {
    id: 'adult_content',
    label: 'Adult Content',
    shortLabel: 'Adult',
    category: 'commercial',
    width: 100,
    sortable: false,
    methodology: 'Whether Steam marks the game as adult content.',
    exportFields: [
      { header: 'adult_content', getValue: (game) => game.is_adult_content ? 'yes' : 'no' },
    ],
  },
  genres: {
    id: 'genres',
    label: 'Genres',
    category: 'taxonomy',
    width: 160,
    sortable: false,
    methodology: 'Steam genre labels.',
    exportFields: [
      { header: 'genres', getValue: (game) => game.genre_names },
    ],
  },
  tags: {
    id: 'tags',
    label: 'Tags',
    category: 'taxonomy',
    width: 190,
    sortable: true,
    sortField: 'primary_tag_name',
    methodology: 'Steam user tag labels.',
    exportFields: [
      { header: 'tags', getValue: (game) => game.tag_names },
    ],
  },
  categories: {
    id: 'categories',
    label: 'Features',
    category: 'taxonomy',
    width: 190,
    sortable: true,
    sortField: 'primary_category_name',
    methodology: 'Steam category and feature labels.',
    exportFields: [
      { header: 'categories', getValue: (game) => game.category_names },
    ],
  },
  platforms: {
    id: 'platforms',
    label: 'Platforms',
    category: 'taxonomy',
    width: 140,
    sortable: false,
    methodology: 'Supported Steam platforms.',
    exportFields: [
      { header: 'platforms', getValue: (game) => game.platform_array },
    ],
  },
  pricing: {
    id: 'pricing',
    label: 'Price',
    category: 'commercial',
    width: 110,
    sortable: false,
    methodology: 'Current captured Steam price and discount state.',
    exportFields: [
      { header: 'current_price_cents', getValue: (game) => game.current_price_cents },
      { header: 'current_discount_percent', getValue: (game) => game.current_discount_percent },
    ],
  },
  free_status: {
    id: 'free_status',
    label: 'Free',
    category: 'commercial',
    width: 80,
    sortable: false,
    methodology: 'Whether the game is currently marked free on Steam.',
    exportFields: [
      { header: 'is_free', getValue: (game) => game.is_free ? 'yes' : 'no' },
    ],
  },
  purchase_packages: {
    id: 'purchase_packages',
    label: 'Packages',
    category: 'commercial',
    width: 100,
    sortable: false,
    methodology: 'Whether PublisherIQ found purchase packages for the app.',
    exportFields: [
      { header: 'has_purchase_packages', getValue: (game) => game.has_purchase_packages ? 'yes' : 'no' },
    ],
  },
  workshop: {
    id: 'workshop',
    label: 'Workshop',
    category: 'commercial',
    width: 100,
    sortable: false,
    methodology: 'Whether the app currently has Steam Workshop support.',
    exportFields: [
      { header: 'has_workshop', getValue: (game) => game.has_workshop ? 'yes' : 'no' },
    ],
  },
  publisher_status: {
    id: 'publisher_status',
    label: 'Publisher Status',
    shortLabel: 'Pub Status',
    category: 'entities',
    width: 130,
    sortable: true,
    sortField: 'publisher_name',
    methodology: 'Opportunity classification for publisher presence and scale.',
    exportFields: [
      { header: 'publisher_status', getValue: (game) => game.publisher_status },
    ],
  },
  publisher_name: {
    id: 'publisher_name',
    label: 'Publisher',
    category: 'entities',
    width: 150,
    sortable: true,
    sortField: 'publisher_name',
    methodology: 'Publisher entity name.',
    exportFields: [
      { header: 'publisher', getValue: (game) => game.publisher_name },
    ],
  },
  developer_name: {
    id: 'developer_name',
    label: 'Developer',
    category: 'entities',
    width: 150,
    sortable: true,
    sortField: 'developer_name',
    methodology: 'Developer entity name.',
    exportFields: [
      { header: 'developer', getValue: (game) => game.developer_name },
    ],
  },
  publisher_game_count: {
    id: 'publisher_game_count',
    label: 'Publisher Games',
    shortLabel: 'Pub Games',
    category: 'entities',
    width: 120,
    sortable: false,
    methodology: 'Known game count for the publisher entity.',
    exportFields: [
      { header: 'publisher_game_count', getValue: (game) => game.publisher_game_count },
      { header: 'publisher_released_game_count', getValue: (game) => game.publisher_released_game_count },
    ],
  },
  publisher_owners: {
    id: 'publisher_owners',
    label: 'Publisher Owners',
    shortLabel: 'Pub Owners',
    category: 'entities',
    width: 120,
    sortable: false,
    methodology: 'Estimated total owners across known publisher games.',
    exportFields: [
      { header: 'publisher_total_owners', getValue: (game) => game.publisher_total_owners },
    ],
  },
  signal_families: {
    id: 'signal_families',
    label: 'Signals',
    category: 'activity',
    width: 160,
    sortable: false,
    methodology: 'Change signal families observed in the last 30 days.',
    exportFields: [
      { header: 'signal_families_30d', getValue: (game) => game.signal_families_30d },
      { header: 'story_kinds_30d', getValue: (game) => game.story_kinds_30d },
    ],
  },
  activity_counts: {
    id: 'activity_counts',
    label: '30d Activity',
    category: 'activity',
    width: 160,
    sortable: true,
    sortField: 'change_count_30d',
    methodology: 'Change counts by signal family over the last 30 days.',
    exportFields: [
      { header: 'change_count_30d', getValue: (game) => game.change_count_30d },
      { header: 'announcement_count_30d', getValue: (game) => game.announcement_count_30d },
      { header: 'release_count_30d', getValue: (game) => game.release_count_30d },
      { header: 'pricing_count_30d', getValue: (game) => game.pricing_count_30d },
      { header: 'store_page_count_30d', getValue: (game) => game.store_page_count_30d },
      { header: 'media_count_30d', getValue: (game) => game.media_count_30d },
      { header: 'taxonomy_count_30d', getValue: (game) => game.taxonomy_count_30d },
      { header: 'platform_count_30d', getValue: (game) => game.platform_count_30d },
      { header: 'build_count_30d', getValue: (game) => game.build_count_30d },
    ],
  },
  release_state: {
    id: 'release_state',
    label: 'Release State',
    category: 'timeline',
    width: 120,
    sortable: false,
    methodology: 'Raw Steam release state captured by PublisherIQ.',
    exportFields: [
      { header: 'release_state', getValue: (game) => game.release_state },
    ],
  },
  app_state: {
    id: 'app_state',
    label: 'App State',
    category: 'timeline',
    width: 120,
    sortable: false,
    methodology: 'Raw Steam app state captured by PublisherIQ.',
    exportFields: [
      { header: 'app_state', getValue: (game) => game.app_state },
    ],
  },
};

export const UNRELEASED_COLUMN_CATEGORIES: Record<
  UnreleasedColumnCategory,
  { label: string; columns: UnreleasedColumnId[] }
> = {
  opportunity: {
    label: 'Opportunity',
    columns: ['opportunity_score'],
  },
  timeline: {
    label: 'Timeline',
    columns: ['release', 'latest_added', 'release_state', 'app_state'],
  },
  entities: {
    label: 'Publisher / Developer',
    columns: [
      'publisher_developer',
      'publisher_status',
      'publisher_name',
      'developer_name',
      'publisher_game_count',
      'publisher_owners',
    ],
  },
  activity: {
    label: 'Activity',
    columns: ['latest_update', 'latest_news', 'signal_families', 'activity_counts'],
  },
  taxonomy: {
    label: 'Tags / Features',
    columns: ['taxonomy', 'genres', 'tags', 'categories', 'platforms'],
  },
  media: {
    label: 'Media',
    columns: ['media'],
  },
  commercial: {
    label: 'Commercial',
    columns: ['pricing', 'free_status', 'purchase_packages', 'workshop', 'adult_content'],
  },
};

export const ALL_UNRELEASED_COLUMN_IDS = Object.keys(
  UNRELEASED_COLUMN_DEFINITIONS
) as UnreleasedColumnId[];

export function isValidUnreleasedColumnId(value: string): value is UnreleasedColumnId {
  return Object.prototype.hasOwnProperty.call(UNRELEASED_COLUMN_DEFINITIONS, value);
}

export function sanitizeUnreleasedColumns(columns: readonly string[]): UnreleasedColumnId[] {
  const seen = new Set<UnreleasedColumnId>();
  const valid: UnreleasedColumnId[] = [];
  for (const column of columns) {
    if (!isValidUnreleasedColumnId(column) || seen.has(column)) continue;
    seen.add(column);
    valid.push(column);
  }
  return valid.length > 0 ? valid : DEFAULT_UNRELEASED_COLUMNS;
}

export function parseUnreleasedColumnsParam(param: string | null | undefined): UnreleasedColumnId[] {
  if (!param) return DEFAULT_UNRELEASED_COLUMNS;
  return sanitizeUnreleasedColumns(param.split(','));
}

export function serializeUnreleasedColumnsParam(columns: readonly UnreleasedColumnId[]): string | null {
  const sanitized = sanitizeUnreleasedColumns(columns);
  if (arraysEqual(sanitized, DEFAULT_UNRELEASED_COLUMNS)) return null;
  return sanitized.join(',');
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
