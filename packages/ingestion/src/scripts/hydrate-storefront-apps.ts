import { getServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { fetchStorefrontAppDetails } from '../apis/storefront.js';
import { upsertLatestStorefrontState } from '../change-intel/storefront-latest-state.js';
import { captureStorefrontState } from '../workers-support/change-intel.js';

const log = logger.child({ script: 'hydrate-storefront-apps' });
const DEFAULT_BATCH_SIZE = 100;

type SupabaseClient = ReturnType<typeof getServiceClient>;

interface CandidateRow {
  appid: number;
}

function parseExplicitAppids(envValue: string | undefined): number[] {
  if (!envValue?.trim()) {
    return [];
  }

  return Array.from(
    new Set(
      envValue
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

async function loadStubCandidates(
  supabase: SupabaseClient,
  limit: number
): Promise<number[]> {
  const { data, error } = await (supabase as any)
    .from('apps')
    .select('appid')
    .eq('catalog_seed_state', 'stub')
    .order('appid', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load stub storefront candidates: ${error.message}`);
  }

  return (data ?? []).map((row: CandidateRow) => row.appid);
}

async function markStubInaccessible(supabase: SupabaseClient, appid: number, observedAt: string): Promise<void> {
  await (supabase as any)
    .from('apps')
    .update({
      catalog_seed_state: 'inaccessible',
      updated_at: observedAt,
    })
    .eq('appid', appid)
    .eq('catalog_seed_state', 'stub');

  const { error } = await (supabase as any)
    .from('sync_status')
    .upsert(
      {
        appid,
        storefront_accessible: false,
        last_storefront_sync: observedAt,
      },
      { onConflict: 'appid' }
    );

  if (error) {
    throw new Error(`Failed to mark storefront no-data state for ${appid}: ${error.message}`);
  }
}

async function hydrateApp(supabase: SupabaseClient, appid: number): Promise<'hydrated' | 'inaccessible'> {
  const observedAt = new Date().toISOString();
  const result = await fetchStorefrontAppDetails(appid);

  if (result.status === 'no_data') {
    await markStubInaccessible(supabase, appid, observedAt);
    return 'inaccessible';
  }

  if (result.status === 'error') {
    throw new Error(result.error);
  }

  await captureStorefrontState(supabase, appid, result.data, {
    triggerReason: 'manual_stub_hydration',
    triggerCursor: null,
  });
  await upsertLatestStorefrontState(supabase, appid, result.data);
  return 'hydrated';
}

async function main(): Promise<void> {
  const supabase = getServiceClient();
  const batchSize = Math.max(1, parseInt(process.env.BATCH_SIZE || `${DEFAULT_BATCH_SIZE}`, 10));
  const explicitAppids = parseExplicitAppids(process.env.APPIDS);
  const appids = explicitAppids.length > 0 ? explicitAppids : await loadStubCandidates(supabase, batchSize);

  if (appids.length === 0) {
    log.info('No storefront hydration candidates found', { batchSize });
    return;
  }

  let hydratedCount = 0;
  let inaccessibleCount = 0;

  log.info('Starting storefront hydration repair', {
    appids: explicitAppids.length > 0 ? appids : undefined,
    candidateCount: appids.length,
  });

  for (const appid of appids) {
    const outcome = await hydrateApp(supabase, appid);
    if (outcome === 'hydrated') {
      hydratedCount += 1;
    } else {
      inaccessibleCount += 1;
    }
  }

  log.info('Completed storefront hydration repair', {
    candidateCount: appids.length,
    hydratedCount,
    inaccessibleCount,
  });
}

main().catch((error) => {
  log.error('Failed storefront hydration repair', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
