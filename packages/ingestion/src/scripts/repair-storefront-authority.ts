import { pathToFileURL } from 'node:url';
import { getServiceClient, type TypedSupabaseClient } from '@publisheriq/database';
import * as databaseIngestion from '@publisheriq/database/ingestion';
import { logger } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { fetchStorefrontAppDetails } from '../apis/storefront.js';
import { getLatestStorefrontSnapshot } from '../change-intel/repository.js';
import {
  upsertLatestStorefrontState,
  upsertNormalizedStorefrontSnapshotState,
} from '../change-intel/storefront-latest-state.js';
import type { NormalizedStorefrontSnapshot } from '../change-intel/types.js';
import { captureStorefrontState } from '../workers-support/change-intel.js';

const log = logger.child({ script: 'repair-storefront-authority' });

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_LIMIT = 250;
const DEFAULT_REFRESH_TIMEOUT_MS = 600_000;

const refreshMatView = (
  databaseIngestion as {
    refreshMaterializedView: (
      viewName: string,
      options?: { concurrently?: boolean; timeoutMs?: number }
    ) => Promise<void>;
  }
).refreshMaterializedView;

type MissingStorefrontField = 'is_free' | 'is_released' | 'release_date';

interface AppRow {
  appid: number;
  is_delisted: boolean | null;
  is_free: boolean | null;
  is_released: boolean | null;
  name: string | null;
  release_date: string | null;
  release_date_raw: string | null;
  type: string | null;
}

interface SyncStatusRow {
  appid: number;
  last_pics_sync: string | null;
  last_storefront_sync: string | null;
}

export interface StorefrontAuthorityRepairCandidate {
  appid: number;
  lastPicsSync: string | null;
  lastStorefrontSync: string;
  missingFields: MissingStorefrontField[];
  name: string | null;
  type: string | null;
}

export interface StorefrontAuthorityRepairResult {
  appid: number;
  mode: 'live_fetch' | 'snapshot_replay';
  repaired: boolean;
}

export interface StorefrontAuthorityRepairDeps {
  captureStorefrontState: typeof captureStorefrontState;
  fetchStorefrontAppDetails: typeof fetchStorefrontAppDetails;
  getLatestStorefrontSnapshot: (
    supabase: TypedSupabaseClient,
    appid: number
  ) => Promise<NormalizedStorefrontSnapshot | null>;
  upsertLatestStorefrontState: typeof upsertLatestStorefrontState;
  upsertNormalizedStorefrontSnapshotState: typeof upsertNormalizedStorefrontSnapshotState;
}

const DEFAULT_REPAIR_DEPS: StorefrontAuthorityRepairDeps = {
  captureStorefrontState,
  fetchStorefrontAppDetails,
  getLatestStorefrontSnapshot,
  upsertLatestStorefrontState,
  upsertNormalizedStorefrontSnapshotState,
};

export function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  return raw === '1' || raw.toLowerCase() === 'true';
}

export function parseAppIds(raw: string | undefined): number[] | null {
  if (!raw) {
    return null;
  }

  const appids = raw
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return appids.length > 0 ? Array.from(new Set(appids)) : null;
}

export function getMissingStorefrontAuthorityFields(
  app: Pick<AppRow, 'is_free' | 'is_released' | 'release_date' | 'release_date_raw'>
): MissingStorefrontField[] {
  const missingFields: MissingStorefrontField[] = [];
  const hasReleaseDateRaw = typeof app.release_date_raw === 'string' && app.release_date_raw.trim().length > 0;

  if (app.is_free === null) {
    missingFields.push('is_free');
  }

  if (app.is_released === null) {
    missingFields.push('is_released');
  }

  if (app.release_date === null && hasReleaseDateRaw) {
    missingFields.push('release_date');
  }

  return missingFields;
}

export function buildStorefrontAuthorityRepairCandidate(
  app: AppRow,
  syncStatus: SyncStatusRow | null | undefined
): StorefrontAuthorityRepairCandidate | null {
  if (!syncStatus?.last_storefront_sync || app.is_delisted === true) {
    return null;
  }

  const missingFields = getMissingStorefrontAuthorityFields(app);
  if (missingFields.length === 0) {
    return null;
  }

  return {
    appid: app.appid,
    lastPicsSync: syncStatus.last_pics_sync,
    lastStorefrontSync: syncStatus.last_storefront_sync,
    missingFields,
    name: app.name,
    type: app.type,
  };
}

function selectAllAppids(result: {
  data: Array<{ appid: number }> | null;
  error: { message: string } | null;
}): number[] {
  const { data, error } = result;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: { appid: number }) => row.appid);
}

async function listAffectedAppids(supabase: TypedSupabaseClient): Promise<number[]> {
  const [missingFreeResult, missingReleasedResult, missingReleaseDateResult] = await Promise.all([
    supabase
      .from('apps')
      .select('appid')
      .eq('is_delisted', false)
      .is('is_free', null)
      .order('appid', { ascending: true }),
    supabase
      .from('apps')
      .select('appid')
      .eq('is_delisted', false)
      .is('is_released', null)
      .order('appid', { ascending: true }),
    supabase
      .from('apps')
      .select('appid')
      .eq('is_delisted', false)
      .is('release_date', null)
      .not('release_date_raw', 'is', null)
      .order('appid', { ascending: true }),
  ]);
  const missingFreeAppids = selectAllAppids(missingFreeResult);
  const missingReleasedAppids = selectAllAppids(missingReleasedResult);
  const missingReleaseDateAppids = selectAllAppids(missingReleaseDateResult);

  return Array.from(
    new Set([...missingFreeAppids, ...missingReleasedAppids, ...missingReleaseDateAppids])
  ).sort((left, right) => left - right);
}

async function loadAppRows(
  supabase: TypedSupabaseClient,
  appids: number[],
  batchSize: number
): Promise<Map<number, AppRow>> {
  const rowsByAppid = new Map<number, AppRow>();

  for (let i = 0; i < appids.length; i += batchSize) {
    const batch = appids.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('apps')
      .select('appid,name,type,is_free,is_released,release_date,release_date_raw,is_delisted')
      .in('appid', batch);

    if (error) {
      throw new Error(`Failed to load app rows: ${error.message}`);
    }

    for (const row of (data ?? []) as AppRow[]) {
      rowsByAppid.set(row.appid, row);
    }
  }

  return rowsByAppid;
}

async function loadSyncStatusRows(
  supabase: TypedSupabaseClient,
  appids: number[],
  batchSize: number
): Promise<Map<number, SyncStatusRow>> {
  const rowsByAppid = new Map<number, SyncStatusRow>();

  for (let i = 0; i < appids.length; i += batchSize) {
    const batch = appids.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('sync_status')
      .select('appid,last_storefront_sync,last_pics_sync')
      .in('appid', batch);

    if (error) {
      throw new Error(`Failed to load sync status rows: ${error.message}`);
    }

    for (const row of (data ?? []) as SyncStatusRow[]) {
      rowsByAppid.set(row.appid, row);
    }
  }

  return rowsByAppid;
}

export async function loadStorefrontAuthorityRepairCandidates(
  supabase: TypedSupabaseClient,
  options: {
    appids?: number[] | null;
    batchSize: number;
    limit: number;
  }
): Promise<StorefrontAuthorityRepairCandidate[]> {
  const requestedAppids = options.appids ?? await listAffectedAppids(supabase);
  const selectedAppids = options.appids
    ? requestedAppids
    : requestedAppids.slice(0, Math.max(0, options.limit));

  if (selectedAppids.length === 0) {
    return [];
  }

  const [appRows, syncRows] = await Promise.all([
    loadAppRows(supabase, selectedAppids, options.batchSize),
    loadSyncStatusRows(supabase, selectedAppids, options.batchSize),
  ]);

  return selectedAppids
    .map((appid) => {
      const appRow = appRows.get(appid);
      if (!appRow) {
        return null;
      }

      return buildStorefrontAuthorityRepairCandidate(appRow, syncRows.get(appid));
    })
    .filter((candidate): candidate is StorefrontAuthorityRepairCandidate => candidate !== null);
}

export async function repairStorefrontAuthorityCandidate(
  supabase: TypedSupabaseClient,
  candidate: StorefrontAuthorityRepairCandidate,
  options: {
    deps?: StorefrontAuthorityRepairDeps;
    dryRun: boolean;
  }
): Promise<StorefrontAuthorityRepairResult> {
  const deps = options.deps ?? DEFAULT_REPAIR_DEPS;
  const snapshot = await deps.getLatestStorefrontSnapshot(supabase, candidate.appid);

  if (snapshot) {
    if (!options.dryRun) {
      await deps.upsertNormalizedStorefrontSnapshotState(supabase, candidate.appid, snapshot);
    }

    return {
      appid: candidate.appid,
      mode: 'snapshot_replay',
      repaired: !options.dryRun,
    };
  }

  if (options.dryRun) {
    return {
      appid: candidate.appid,
      mode: 'live_fetch',
      repaired: false,
    };
  }

  const storefrontResult = await deps.fetchStorefrontAppDetails(candidate.appid);

  if (storefrontResult.status === 'error') {
    throw new Error(storefrontResult.error);
  }

  if (storefrontResult.status === 'no_data') {
    throw new Error('Steam storefront returned no repairable data');
  }

  await deps.captureStorefrontState(supabase, candidate.appid, storefrontResult.data, {
    triggerReason: 'manual_storefront_authority_repair',
    triggerCursor: null,
  });
  await deps.upsertLatestStorefrontState(supabase, candidate.appid, storefrontResult.data);

  return {
    appid: candidate.appid,
    mode: 'live_fetch',
    repaired: true,
  };
}

async function refreshAppSurfaces(
  supabase: TypedSupabaseClient,
  timeoutMs: number
): Promise<void> {
  await refreshMatView('app_filter_data', {
    timeoutMs,
  });

  const { error } = await supabase.rpc('refresh_filter_count_views');
  if (error) {
    throw new Error(`Failed to refresh filter count views: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BATCH_SIZE || `${DEFAULT_BATCH_SIZE}`, 10)
  );
  const dryRun = parseBooleanEnv(process.env.DRY_RUN, true);
  const explicitAppids = parseAppIds(process.env.APPIDS);
  const limit = Math.max(0, Number.parseInt(process.env.LIMIT || `${DEFAULT_LIMIT}`, 10));
  const refreshTimeoutMs = Math.max(
    1,
    Number.parseInt(
      process.env.REFRESH_TIMEOUT_MS || `${DEFAULT_REFRESH_TIMEOUT_MS}`,
      10
    )
  );
  const refreshAppSurfaceViews = parseBooleanEnv(process.env.REFRESH_APP_SURFACES, false);
  const supabase = getServiceClient();

  const candidates = await loadStorefrontAuthorityRepairCandidates(supabase, {
    appids: explicitAppids,
    batchSize,
    limit,
  });

  log.info('Selected storefront authority repair candidates', {
    batchSize,
    dryRun,
    explicitAppidsCount: explicitAppids?.length ?? 0,
    limit,
    selected: candidates.length,
  });

  if (candidates.length === 0) {
    return;
  }

  const stats = {
    failed: 0,
    liveFetchCandidates: 0,
    repairedFromLiveFetch: 0,
    repairedFromSnapshot: 0,
    snapshotCandidates: 0,
  };
  const concurrency = pLimit(DEFAULT_CONCURRENCY);

  await Promise.all(
    candidates.map((candidate) =>
      concurrency(async () => {
        try {
          const result = await repairStorefrontAuthorityCandidate(supabase, candidate, { dryRun });
          if (result.mode === 'snapshot_replay') {
            stats.snapshotCandidates += 1;
            if (result.repaired) {
              stats.repairedFromSnapshot += 1;
            }
          } else {
            stats.liveFetchCandidates += 1;
            if (result.repaired) {
              stats.repairedFromLiveFetch += 1;
            }
          }
        } catch (error) {
          stats.failed += 1;
          log.error('Failed storefront authority repair candidate', {
            appid: candidate.appid,
            error: error instanceof Error ? error.message : String(error),
            missingFields: candidate.missingFields,
            name: candidate.name,
          });
        }
      })
    )
  );

  const repairedCount = stats.repairedFromSnapshot + stats.repairedFromLiveFetch;
  if (!dryRun && refreshAppSurfaceViews && repairedCount > 0) {
    log.info('Refreshing app surfaces after storefront authority repair', {
      repairedCount,
      refreshTimeoutMs,
    });
    await refreshAppSurfaces(supabase, refreshTimeoutMs);
  }

  log.info('Completed storefront authority repair', {
    dryRun,
    failed: stats.failed,
    liveFetchCandidates: stats.liveFetchCandidates,
    refreshAppSurfaceViews: !dryRun && refreshAppSurfaceViews && repairedCount > 0,
    repairedFromLiveFetch: stats.repairedFromLiveFetch,
    repairedFromSnapshot: stats.repairedFromSnapshot,
    selected: candidates.length,
    snapshotCandidates: stats.snapshotCandidates,
  });

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error) => {
    log.error('Failed storefront authority repair', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
