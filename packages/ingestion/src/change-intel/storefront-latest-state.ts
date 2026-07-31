import {
  getTigerWriter,
  readDataWriteTarget,
  type Database,
  type TypedSupabaseClient,
} from '@publisheriq/database';
import { APP_TYPES, logger, STEAM_CATEGORY_WORKSHOP, type AppType } from '@publisheriq/shared';
import type { ParsedStorefrontApp } from '../apis/storefront.js';
import type { NormalizedStorefrontSnapshot } from './types.js';

const VALID_APP_TYPES = new Set<string>(APP_TYPES);
const MAX_REASONABLE_PRICE_CENTS = 50_000;
const log = logger.child({ component: 'storefront-latest-state' });
type StorefrontTigerWriter = {
  catalog: Pick<ReturnType<typeof getTigerWriter>['catalog'], 'upsertStorefrontApp'>;
};

export interface StorefrontUpsertArgs {
  p_appid: number;
  p_current_discount_percent: number;
  p_current_price_cents: number | null;
  p_developers: string[];
  p_demo_appids?: number[];
  p_dlc_appids?: number[];
  p_has_purchase_packages?: boolean;
  p_has_workshop: boolean;
  p_is_delisted: boolean;
  p_is_free: boolean;
  p_is_released: boolean;
  p_name: string;
  p_parent_appid?: number;
  p_publishers: string[];
  p_release_date: string | null;
  p_release_date_raw: string;
  p_type: string;
  p_categories: Array<{ id: number; name: string }> | null;
  p_evidence_observed_at: string | null;
  p_genres: Array<{ id: string; name: string }> | null;
  p_languages: string[] | null;
  p_platforms: string[] | null;
}

export function parseStorefrontLanguages(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .split(',')
        .map((language) => language.replace(/\*/g, '').trim())
        .filter(Boolean)
    )
  );
}

function enabledStorefrontPlatforms(
  platforms: ParsedStorefrontApp['platforms']
): string[] {
  return (['windows', 'mac', 'linux'] as const).filter((platform) => platforms[platform]);
}

export function normalizeAppType(type: string | undefined): AppType {
  if (!type) {
    return 'game';
  }

  const lower = type.toLowerCase();
  return VALID_APP_TYPES.has(lower) ? (lower as AppType) : 'game';
}

export function sanitizeStorefrontPriceCents(priceCents: number | null): number | null {
  if (priceCents === null || priceCents === undefined) {
    return null;
  }

  if (!Number.isFinite(priceCents) || priceCents < 0 || priceCents > MAX_REASONABLE_PRICE_CENTS) {
    return null;
  }

  return priceCents;
}

function sanitizeAndLogStorefrontPrice(
  appid: number,
  priceCents: number | null
): number | null {
  const sanitizedPriceCents = sanitizeStorefrontPriceCents(priceCents);

  if (priceCents !== sanitizedPriceCents) {
    log.warn('Dropping unreasonable storefront price before upsert', {
      appid,
      priceCents,
    });
  }

  return sanitizedPriceCents;
}

function hasWorkshopCategory(snapshot: NormalizedStorefrontSnapshot): boolean {
  return snapshot.categories.some((category) => category.id === STEAM_CATEGORY_WORKSHOP);
}

function buildSupabaseStorefrontUpsertArgs(
  args: StorefrontUpsertArgs
): Database['public']['Functions']['upsert_storefront_app']['Args'] {
  const supabaseArgs: Partial<StorefrontUpsertArgs> = { ...args };
  delete supabaseArgs.p_demo_appids;
  delete supabaseArgs.p_has_purchase_packages;
  delete supabaseArgs.p_genres;
  delete supabaseArgs.p_categories;
  delete supabaseArgs.p_platforms;
  delete supabaseArgs.p_languages;
  delete supabaseArgs.p_evidence_observed_at;

  return supabaseArgs as unknown as Database['public']['Functions']['upsert_storefront_app']['Args'];
}

async function executeStorefrontUpsert(
  supabase: TypedSupabaseClient,
  args: StorefrontUpsertArgs,
  tiger?: StorefrontTigerWriter
): Promise<void> {
  if (tiger || readDataWriteTarget() === 'tiger') {
    await (tiger ?? getTigerWriter()).catalog.upsertStorefrontApp(args);
    return;
  }

  const { error } = await supabase.rpc(
    'upsert_storefront_app',
    buildSupabaseStorefrontUpsertArgs(args)
  );

  if (error) {
    throw new Error(error.message);
  }
}

export function buildStorefrontUpsertArgs(
  appid: number,
  details: ParsedStorefrontApp,
  observedAt = new Date().toISOString()
): StorefrontUpsertArgs {
  const fieldPresence = details.fieldPresence;
  return {
    p_appid: appid,
    p_name: details.name,
    p_type: normalizeAppType(details.type),
    p_is_free: details.isFree,
    p_is_delisted: details.isDelisted,
    p_has_purchase_packages: details.hasPurchasePackages,
    p_release_date: details.releaseDate,
    p_release_date_raw: details.releaseDateRaw,
    p_has_workshop: details.hasWorkshop,
    p_current_price_cents: sanitizeAndLogStorefrontPrice(appid, details.priceCents),
    p_current_discount_percent: details.discountPercent,
    p_is_released: !details.comingSoon,
    p_developers: details.developers,
    p_publishers: details.publishers,
    ...(details.dlcAppids.length > 0 ? { p_dlc_appids: details.dlcAppids } : {}),
    ...(details.demoAppids.length > 0 ? { p_demo_appids: details.demoAppids } : {}),
    ...(details.parentAppid !== null ? { p_parent_appid: details.parentAppid } : {}),
    p_genres: fieldPresence?.genres === false
      ? null
      : details.genres.map((genre) => ({ id: genre.id, name: genre.description })),
    p_categories: fieldPresence?.categories === false
      ? null
      : details.categories.map((category) => ({
        id: category.id,
        name: category.description,
      })),
    p_platforms: fieldPresence?.platforms === false
      ? null
      : enabledStorefrontPlatforms(details.platforms),
    p_languages: fieldPresence?.languages === false
      ? null
      : parseStorefrontLanguages(details.supportedLanguages),
    p_evidence_observed_at: observedAt,
  };
}

export function buildNormalizedStorefrontSnapshotUpsertArgs(
  appid: number,
  snapshot: NormalizedStorefrontSnapshot
): StorefrontUpsertArgs {
  return {
    p_appid: appid,
    p_name: snapshot.name,
    p_type: normalizeAppType(snapshot.type),
    p_is_free: snapshot.isFree,
    p_is_delisted: snapshot.isDelisted,
    p_has_purchase_packages: snapshot.hasPurchasePackages ?? (
      (snapshot.packageIds?.length ?? 0) + (snapshot.packageGroupSubs?.length ?? 0)
    ) > 0,
    p_release_date: snapshot.releaseDate,
    p_release_date_raw: snapshot.releaseDateText ?? '',
    p_has_workshop: hasWorkshopCategory(snapshot),
    p_current_price_cents: sanitizeAndLogStorefrontPrice(appid, snapshot.price.currentCents),
    p_current_discount_percent: snapshot.price.discountPercent,
    p_is_released: !snapshot.comingSoon,
    p_developers: snapshot.developers,
    p_publishers: snapshot.publishers,
    ...(snapshot.dlcAppids.length > 0 ? { p_dlc_appids: snapshot.dlcAppids } : {}),
    ...((snapshot.demoAppids ?? []).length > 0 ? { p_demo_appids: snapshot.demoAppids } : {}),
    // Historical normalized snapshots predate field-presence evidence. Do not
    // collapse an omitted source field into a known empty value during replay.
    p_genres: null,
    p_categories: null,
    p_platforms: null,
    p_languages: null,
    p_evidence_observed_at: null,
  };
}

export async function upsertLatestStorefrontState(
  supabase: TypedSupabaseClient,
  appid: number,
  details: ParsedStorefrontApp,
  tiger?: StorefrontTigerWriter,
  observedAt?: string
): Promise<void> {
  await executeStorefrontUpsert(
    supabase,
    buildStorefrontUpsertArgs(appid, details, observedAt),
    tiger
  );
}

export async function upsertNormalizedStorefrontSnapshotState(
  supabase: TypedSupabaseClient,
  appid: number,
  snapshot: NormalizedStorefrontSnapshot,
  tiger?: StorefrontTigerWriter
): Promise<void> {
  await executeStorefrontUpsert(
    supabase,
    buildNormalizedStorefrontSnapshotUpsertArgs(appid, snapshot),
    tiger
  );
}
