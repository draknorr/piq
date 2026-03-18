import type { TypedSupabaseClient } from '@publisheriq/database';
import { APP_TYPES, logger, type AppType } from '@publisheriq/shared';
import type { ParsedStorefrontApp } from '../apis/storefront.js';

const VALID_APP_TYPES = new Set<string>(APP_TYPES);
const MAX_REASONABLE_PRICE_CENTS = 50_000;
const log = logger.child({ component: 'storefront-latest-state' });

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

export async function upsertLatestStorefrontState(
  supabase: TypedSupabaseClient,
  appid: number,
  details: ParsedStorefrontApp
): Promise<void> {
  const db = supabase as any;
  const sanitizedPriceCents = sanitizeStorefrontPriceCents(details.priceCents);

  if (details.priceCents !== sanitizedPriceCents) {
    log.warn('Dropping unreasonable storefront price before upsert', {
      appid,
      priceCents: details.priceCents,
    });
  }

  const { error } = await db.rpc('upsert_storefront_app', {
    p_appid: appid,
    p_name: details.name,
    p_type: normalizeAppType(details.type),
    p_is_free: details.isFree,
    p_is_delisted: details.isDelisted,
    p_release_date: details.releaseDate,
    p_release_date_raw: details.releaseDateRaw,
    p_has_workshop: details.hasWorkshop,
    p_current_price_cents: sanitizedPriceCents,
    p_current_discount_percent: details.discountPercent,
    p_is_released: !details.comingSoon,
    p_developers: details.developers,
    p_publishers: details.publishers,
    ...(details.dlcAppids.length > 0 ? { p_dlc_appids: details.dlcAppids } : {}),
    ...(details.parentAppid !== null ? { p_parent_appid: details.parentAppid } : {}),
  });

  if (error) {
    throw new Error(error.message);
  }
}
