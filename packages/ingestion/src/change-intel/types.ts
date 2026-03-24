export type AppCaptureSource = 'storefront' | 'news' | 'hero_asset' | 'projection_refresh';

export type AppSnapshotSource = 'storefront' | 'pics';

export type AppChangeSource = 'storefront' | 'pics' | 'news' | 'media';

export type AppChangeType =
  | 'description_rewrite'
  | 'short_description_rewrite'
  | 'release_date_text_change'
  | 'price_change'
  | 'discount_start'
  | 'discount_end'
  | 'tags_added'
  | 'tags_removed'
  | 'genres_changed'
  | 'categories_changed'
  | 'languages_changed'
  | 'platforms_changed'
  | 'controller_support_changed'
  | 'steam_deck_status_changed'
  | 'publisher_association_changed'
  | 'developer_association_changed'
  | 'dlc_references_changed'
  | 'package_references_changed'
  | 'build_id_changed'
  | 'last_content_update_changed'
  | 'news_published'
  | 'news_edited'
  | 'capsule_url_changed'
  | 'header_url_changed'
  | 'background_url_changed'
  | 'screenshot_added'
  | 'screenshot_removed'
  | 'screenshot_reordered'
  | 'trailer_added'
  | 'trailer_removed'
  | 'trailer_reordered'
  | 'trailer_thumbnail_changed';

export type HeroAssetKind = 'header' | 'capsule' | 'background';

export interface StorefrontHeroImages {
  header: string | null;
  capsule: string | null;
  background: string | null;
}

export interface StorefrontScreenshot {
  id: number | null;
  fullUrl: string;
  thumbnailUrl: string | null;
  order: number;
}

export interface StorefrontMovie {
  id: number | null;
  name: string | null;
  highlight: boolean;
  thumbnailUrl: string | null;
  mp4Url: string | null;
  webmUrl: string | null;
  order: number;
}

export interface NormalizedStorefrontSnapshot {
  name: string;
  type: string;
  isFree: boolean;
  isDelisted: boolean;
  comingSoon: boolean;
  releaseDate: string | null;
  releaseDateText: string | null;
  descriptions: {
    short: string | null;
    about: string | null;
    detailed: string | null;
  };
  supportedLanguages: string | null;
  developers: string[];
  publishers: string[];
  price: {
    currentCents: number | null;
    discountPercent: number;
  };
  categories: Array<{ id: number; description: string }>;
  genres: Array<{ id: string; description: string }>;
  platforms: {
    windows: boolean;
    mac: boolean;
    linux: boolean;
  };
  controllerSupport: string | null;
  dlcAppids: number[];
  packageIds: number[];
  packageGroupSubs: number[];
  heroImages: StorefrontHeroImages;
  screenshots: StorefrontScreenshot[];
  movies: StorefrontMovie[];
}

export interface NormalizedMediaVersion {
  heroImages: StorefrontHeroImages;
  screenshots: StorefrontScreenshot[];
  movies: StorefrontMovie[];
}

export interface NormalizedNewsVersion {
  gid: string;
  title: string;
  url: string;
  author: string | null;
  contents: string | null;
  feedlabel: string | null;
  feedname: string | null;
  publishedAt: string;
}

export interface AppChangeEventDraft {
  eventType: AppChangeType;
  source: AppChangeSource;
  beforeValue?: unknown;
  afterValue?: unknown;
  context?: Record<string, unknown> | null;
  observedAt?: string;
}

export interface CaptureQueueJob {
  id: string;
  appid: number;
  source: AppCaptureSource;
  triggerReason: string;
  triggerCursor: string | null;
  attempts: number;
}

export interface VersionWriteResult {
  inserted: boolean;
  currentId: string;
  previousId: string | null;
  currentHash: string;
}

export interface HeroAssetDescriptor {
  kind: HeroAssetKind;
  url: string;
}
