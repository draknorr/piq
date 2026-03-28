/**
 * SteamSpy Full Catalog Sync Worker
 *
 * Fetches all apps from SteamSpy's paginated API and syncs to database.
 * Rate limited to 1 request per 60 seconds for the "all" endpoint.
 *
 * NOTE: SteamSpy is used ONLY for enrichment data (CCU, owners, playtime, metrics).
 * Developers and publishers should come from Steam Storefront API, not SteamSpy.
 *
 * Run with: pnpm --filter @publisheriq/ingestion steamspy-sync
 */

import { getServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import {
  fetchAllSteamSpyApps,
  fetchSteamSpyAppDetails,
  parseOwnerEstimate,
  type SteamSpyAppSummary,
} from '../apis/steamspy.js';
import { withRetry } from '../utils/retry.js';

const log = logger.child({ worker: 'steamspy-sync' });
const MAX_REASONABLE_PRICE_CENTS = 50000;
const AVAILABILITY_UPDATE_MAX_RETRIES = 2;

interface SerializedError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  stack?: string;
  raw?: string;
}

interface NormalizedSteamSpyPrice {
  priceCents: number | null;
  discountPercent: number;
  isAppPriceValid: boolean;
  isFree: boolean;
}

interface SyncStats {
  appsProcessed: number;
  errors: number;
}

function stringifyUnknownError(error: unknown): string {
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function serializeUnknownError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const raw = stringifyUnknownError(error);
    return {
      message: typeof record.message === 'string' ? record.message : raw,
      code: typeof record.code === 'string' ? record.code : undefined,
      details: typeof record.details === 'string' ? record.details : undefined,
      hint: typeof record.hint === 'string' ? record.hint : undefined,
      raw,
    };
  }

  return {
    message: String(error),
  };
}

function formatUnknownError(error: unknown): string {
  const serialized = serializeUnknownError(error);
  return [
    serialized.message,
    serialized.code ? `code=${serialized.code}` : null,
    serialized.details ? `details=${serialized.details}` : null,
    serialized.hint ? `hint=${serialized.hint}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

function parseSteamSpyDiscount(discount: string): number {
  const parsed = Number.parseInt(discount, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizeSteamSpyPrice(price: string, discount: string): NormalizedSteamSpyPrice {
  const parsedPrice = Number.parseInt(price, 10);
  const discountPercent = parseSteamSpyDiscount(discount);

  if (
    Number.isNaN(parsedPrice) ||
    parsedPrice < 0 ||
    parsedPrice > MAX_REASONABLE_PRICE_CENTS
  ) {
    return {
      priceCents: null,
      discountPercent,
      isAppPriceValid: false,
      isFree: false,
    };
  }

  return {
    priceCents: parsedPrice,
    discountPercent,
    isAppPriceValid: true,
    isFree: parsedPrice === 0,
  };
}

function getMaxPages(): number {
  const rawMaxPages = process.env.MAX_PAGES ?? process.env.PAGES_LIMIT ?? '0';
  const parsedMaxPages = Number.parseInt(rawMaxPages, 10);

  if (Number.isNaN(parsedMaxPages)) {
    return 0;
  }

  return parsedMaxPages;
}

async function processBatch(
  supabase: ReturnType<typeof getServiceClient>,
  apps: SteamSpyAppSummary[],
  stats: SyncStats
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const appsToUpsertWithPrice: Array<{
    appid: number;
    name: string;
    is_free: boolean;
    current_price_cents: number;
    current_discount_percent: number;
  }> = [];
  const appsToUpsertWithoutPrice: Array<{
    appid: number;
    name: string;
  }> = [];

  const syncStatusToUpsert = apps.map((app) => ({
    appid: app.appid,
    last_steamspy_sync: now,
    is_syncable: true,
    steamspy_available: true,
  }));

  const metricsToUpsert = apps.map((app) => {
    const normalizedPrice = normalizeSteamSpyPrice(app.price, app.discount);
    const owners = parseOwnerEstimate(app.owners);

    const appBase = {
      appid: app.appid,
      name: app.name,
    };

    if (normalizedPrice.isAppPriceValid && normalizedPrice.priceCents !== null) {
      appsToUpsertWithPrice.push({
        ...appBase,
        is_free: normalizedPrice.isFree,
        current_price_cents: normalizedPrice.priceCents,
        current_discount_percent: normalizedPrice.discountPercent,
      });
    } else {
      appsToUpsertWithoutPrice.push(appBase);
    }

    return {
      appid: app.appid,
      metric_date: today,
      owners_min: owners.min,
      owners_max: owners.max,
      ccu_peak: app.ccu,
      average_playtime_forever: app.average_forever,
      average_playtime_2weeks: app.average_2weeks,
      price_cents: normalizedPrice.priceCents,
      discount_percent: normalizedPrice.discountPercent,
    };
  });

  // Apps must complete first (sync_status and daily_metrics have FK to apps)
  for (const [group, rows] of [
    ['with-price', appsToUpsertWithPrice],
    ['without-price', appsToUpsertWithoutPrice],
  ] as const) {
    if (rows.length === 0) {
      continue;
    }

    const appsResult = await supabase.from('apps').upsert(rows, { onConflict: 'appid' });
    if (appsResult.error) {
      log.error('Batch apps upsert failed', {
        error: appsResult.error,
        group,
        batchSize: rows.length,
      });
      stats.errors += apps.length;
      return;
    }
  }

  // Now sync_status and daily_metrics can run in parallel
  const [syncResult, metricsResult] = await Promise.all([
    supabase.from('sync_status').upsert(syncStatusToUpsert, { onConflict: 'appid' }),
    supabase.from('daily_metrics').upsert(metricsToUpsert, { onConflict: 'appid,metric_date' }),
  ]);

  if (syncResult.error) {
    log.error('Batch sync_status upsert failed', { error: syncResult.error });
    stats.errors += apps.length;
  } else if (metricsResult.error) {
    log.error('Batch metrics upsert failed', { error: metricsResult.error });
    stats.errors += apps.length;
  } else {
    stats.appsProcessed += apps.length;
  }
}

interface SupplementaryStats {
  fetched: number;
  found: number;
  notFound: number;
}

/**
 * Fetch SteamSpy data for individual apps that weren't in the pagination results.
 * Uses the appdetails endpoint (1 req/sec) for apps with significant reviews.
 */
async function processSupplementaryFetches(
  supabase: ReturnType<typeof getServiceClient>,
  maxApps: number = 100
): Promise<SupplementaryStats> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const stats: SupplementaryStats = { fetched: 0, found: 0, notFound: 0 };

  // Get candidates from RPC function
  const { data: candidates, error } = await supabase.rpc('get_steamspy_individual_fetch_candidates', {
    p_limit: maxApps,
    p_min_reviews: 1000,
  });

  if (error) {
    log.error('Failed to get supplementary fetch candidates', { error: error.message });
    return stats;
  }

  if (!candidates?.length) {
    log.info('No candidates for supplementary SteamSpy fetch');
    return stats;
  }

  log.info('Starting supplementary SteamSpy individual fetches', { count: candidates.length });

  for (const candidate of candidates) {
    stats.fetched++;
    const details = await fetchSteamSpyAppDetails(candidate.appid);

    if (details?.name) {
      stats.found++;
      const normalizedPrice = normalizeSteamSpyPrice(details.price, details.discount);
      const owners = parseOwnerEstimate(details.owners);

      // Upsert daily_metrics
      const { error: metricsError } = await supabase.from('daily_metrics').upsert(
        {
          appid: candidate.appid,
          metric_date: today,
          owners_min: owners.min,
          owners_max: owners.max,
          ccu_peak: details.ccu,
          average_playtime_forever: details.average_forever,
          average_playtime_2weeks: details.average_2weeks,
          price_cents: normalizedPrice.priceCents,
          discount_percent: normalizedPrice.discountPercent,
        },
        { onConflict: 'appid,metric_date' }
      );

      if (metricsError) {
        log.error('Failed to upsert metrics for individual fetch', {
          appid: candidate.appid,
          error: metricsError.message,
        });
      }

      // Update sync_status - mark as available via individual fetch
      const { error: syncError } = await supabase
        .from('sync_status')
        .update({
          steamspy_available: true,
          last_steamspy_sync: now,
          last_steamspy_individual_fetch: now,
        })
        .eq('appid', candidate.appid);

      if (syncError) {
        log.error('Failed to update sync_status for individual fetch', {
          appid: candidate.appid,
          error: syncError.message,
        });
      }

      log.info('Found SteamSpy data via individual fetch', {
        appid: candidate.appid,
        name: details.name,
        ccu: details.ccu,
        owners: details.owners,
      });
    } else {
      stats.notFound++;

      // Mark as tried but not found
      const { error: syncError } = await supabase
        .from('sync_status')
        .update({
          last_steamspy_individual_fetch: now,
          // Keep steamspy_available = false
        })
        .eq('appid', candidate.appid);

      if (syncError) {
        log.error('Failed to update sync_status for not found app', {
          appid: candidate.appid,
          error: syncError.message,
        });
      }

      log.debug('No SteamSpy data found via individual fetch', {
        appid: candidate.appid,
        name: candidate.name,
      });
    }

    // Progress logging every 10 apps
    if (stats.fetched % 10 === 0) {
      log.info('Supplementary fetch progress', {
        fetched: stats.fetched,
        found: stats.found,
        notFound: stats.notFound,
      });
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;
  const maxPages = getMaxPages();

  log.info('Starting SteamSpy sync', { githubRunId, maxPages: maxPages || 'all' });

  const supabase = getServiceClient();

  // Create sync job record
  const { data: job, error: jobError } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'steamspy',
      github_run_id: githubRunId,
      status: 'running',
    })
    .select()
    .single();

  if (jobError) {
    log.error('Failed to create sync job record', { error: jobError });
  }

  const stats: SyncStats = {
    appsProcessed: 0,
    errors: 0,
  };

  try {
    await fetchAllSteamSpyApps(maxPages, async (apps, page) => {
      log.info('Processing SteamSpy page', { page, appsCount: apps.length });
      await processBatch(supabase, apps, stats);
      log.info('Completed SteamSpy page', {
        page,
        processed: stats.appsProcessed,
        errors: stats.errors,
      });
    });

    // Mark apps not in SteamSpy as unavailable (only if we did a full sync)
    if (maxPages === 0) {
      const unavailableRows = await withRetry(
        async () => {
          const { data, error } = await supabase
            .from('sync_status')
            .update({ steamspy_available: false })
            .is('last_steamspy_sync', null)
            .eq('is_syncable', true)
            .select('appid');

          if (error) {
            throw error;
          }

          return data;
        },
        {
          maxRetries: AVAILABILITY_UPDATE_MAX_RETRIES,
          initialDelayMs: 1000,
          maxDelayMs: 5000,
          shouldRetry: () => true,
          onRetry: (error, attempt, delayMs) => {
            log.warn('Retrying SteamSpy availability update', {
              attempt,
              delayMs,
              error: serializeUnknownError(error),
            });
          },
        }
      );

      log.info('Marked apps as not in SteamSpy catalog', { count: unavailableRows?.length ?? 0 });

      // Supplementary individual fetches for popular apps not in pagination
      const supplementaryLimit = parseInt(process.env.SUPPLEMENTARY_LIMIT || '100', 10);
      if (supplementaryLimit > 0) {
        log.info('Starting supplementary SteamSpy fetches', { limit: supplementaryLimit });
        const supplementaryStats = await processSupplementaryFetches(supabase, supplementaryLimit);
        log.info('Supplementary SteamSpy fetches completed', {
          fetched: supplementaryStats.fetched,
          found: supplementaryStats.found,
          notFound: supplementaryStats.notFound,
        });
      }
    }

    // Update sync job as completed
    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsProcessed,
          items_failed: stats.errors,
        })
        .eq('id', job.id);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('SteamSpy sync completed', {
      durationMinutes: duration,
      appsProcessed: stats.appsProcessed,
      errors: stats.errors,
    });
  } catch (error) {
    const serializedError = serializeUnknownError(error);
    const errorMessage = formatUnknownError(error);

    log.error('SteamSpy sync failed', {
      error: serializedError,
    });

    // Update sync job as failed
    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsProcessed,
          items_failed: stats.errors,
        })
        .eq('id', job.id);
    }

    process.exit(1);
  }
}

main();
