import { getServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { seedDiscoveredApps } from '../change-intel/repository.js';
import type { DiscoveredAppSeed } from '../change-intel/types.js';

const log = logger.child({ script: 'repair-dlc-discovered-apps' });
const DEFAULT_BATCH_SIZE = 1000;
const EXISTING_APPS_CHUNK_SIZE = 500;

interface DlcRelationRow {
  dlc_appid: number;
  parent_appid: number;
}

function buildPlaceholderName(appid: number): string {
  return `Steam app ${appid} (pending metadata)`;
}

async function loadRelationBatch(
  supabase: ReturnType<typeof getServiceClient>,
  offset: number,
  batchSize: number
): Promise<DlcRelationRow[]> {
  const { data, error } = await (supabase as any)
    .from('app_dlc')
    .select('parent_appid, dlc_appid')
    .order('parent_appid', { ascending: true })
    .order('dlc_appid', { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (error) {
    throw new Error(`Failed to fetch app_dlc rows: ${error.message}`);
  }

  return (data ?? []) as DlcRelationRow[];
}

async function loadExistingAppids(
  supabase: ReturnType<typeof getServiceClient>,
  appids: number[]
): Promise<Set<number>> {
  const existing = new Set<number>();

  for (let index = 0; index < appids.length; index += EXISTING_APPS_CHUNK_SIZE) {
    const chunk = appids.slice(index, index + EXISTING_APPS_CHUNK_SIZE);
    if (chunk.length === 0) {
      continue;
    }

    const { data, error } = await (supabase as any)
      .from('apps')
      .select('appid')
      .in('appid', chunk);

    if (error) {
      throw new Error(`Failed to fetch existing app rows: ${error.message}`);
    }

    for (const row of data ?? []) {
      const appid = Number(row.appid);
      if (Number.isInteger(appid) && appid > 0) {
        existing.add(appid);
      }
    }
  }

  return existing;
}

function buildMissingSeeds(rows: DlcRelationRow[], existingAppids: Set<number>): DiscoveredAppSeed[] {
  const seeds = new Map<number, DiscoveredAppSeed>();

  for (const row of rows) {
    if (!existingAppids.has(row.parent_appid) && !seeds.has(row.parent_appid)) {
      seeds.set(row.parent_appid, {
        appid: row.parent_appid,
        appType: 'game',
        discoveryReason: 'dlc_parent_relation_backfill',
        placeholderName: buildPlaceholderName(row.parent_appid),
      });
    }

    if (!existingAppids.has(row.dlc_appid) && !seeds.has(row.dlc_appid)) {
      seeds.set(row.dlc_appid, {
        appid: row.dlc_appid,
        appType: 'dlc',
        discoveryReason: 'dlc_relation_backfill',
        placeholderName: buildPlaceholderName(row.dlc_appid),
      });
    }
  }

  return [...seeds.values()];
}

async function main(): Promise<void> {
  const supabase = getServiceClient();
  const batchSize = Math.max(1, parseInt(process.env.BATCH_SIZE || `${DEFAULT_BATCH_SIZE}`, 10));
  let offset = 0;
  let processedRows = 0;
  let seededApps = 0;

  log.info('Starting DLC discovered-app repair', { batchSize });

  while (true) {
    const relationBatch = await loadRelationBatch(supabase, offset, batchSize);
    if (relationBatch.length === 0) {
      break;
    }

    const candidateAppids = [...new Set(relationBatch.flatMap((row) => [row.parent_appid, row.dlc_appid]))];
    const existingAppids = await loadExistingAppids(supabase, candidateAppids);
    const missingSeeds = buildMissingSeeds(relationBatch, existingAppids);

    if (missingSeeds.length > 0) {
      seededApps += await seedDiscoveredApps(supabase, missingSeeds);
    }

    processedRows += relationBatch.length;
    offset += relationBatch.length;

    log.info('Processed DLC relation repair batch', {
      batchSize: relationBatch.length,
      missingSeeds: missingSeeds.length,
      offset,
      processedRows,
      seededApps,
    });

    if (relationBatch.length < batchSize) {
      break;
    }
  }

  log.info('Completed DLC discovered-app repair', {
    processedRows,
    seededApps,
  });
}

main().catch((error) => {
  log.error('Failed DLC discovered-app repair', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
