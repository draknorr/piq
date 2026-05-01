import { getTigerWriter, type TigerWriter } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import type {
  CCUResultWithStatus,
  CCUValidationState,
} from '../apis/steam-ccu.js';

const log = logger.child({ component: 'ccu-validation' });
const UPDATE_BATCH_SIZE = 500;

export interface PersistOfficialCcuValidationResult {
  confirmedPositive: number;
  confirmedZero: number;
  suspectZero: number;
  invalid: number;
  error: number;
}

function getGroupedAppidsByValidationState(
  results: Map<number, CCUResultWithStatus>
): Record<CCUValidationState, number[]> {
  const grouped: Record<CCUValidationState, number[]> = {
    confirmed_positive: [],
    confirmed_zero: [],
    suspect_zero: [],
    invalid: [],
    error: [],
  };

  for (const [appid, result] of results) {
    grouped[result.validationState].push(appid);
  }

  return grouped;
}

async function updateTierAssignments(
  appids: number[],
  values: Record<string, string | null>,
  tiger: TigerWriter
): Promise<number> {
  let updated = 0;

  for (let i = 0; i < appids.length; i += UPDATE_BATCH_SIZE) {
    const batch = appids.slice(i, i + UPDATE_BATCH_SIZE);

    try {
      updated += await tiger.metrics.updateCcuTierAssignments(batch, values);
    } catch (error) {
      log.warn('Failed to update CCU validation batch', {
        appids: batch.length,
        batchStart: i,
        error: error instanceof Error ? error.message : String(error),
        values,
      });
      continue;
    }
  }

  return updated;
}

export async function persistOfficialCcuValidationResults(
  _supabase: unknown,
  results: Map<number, CCUResultWithStatus>,
  syncTimeIso: string,
  invalidSkipUntilIso: string,
  tiger: TigerWriter = getTigerWriter()
): Promise<PersistOfficialCcuValidationResult> {
  const grouped = getGroupedAppidsByValidationState(results);

  const [confirmedPositive, confirmedZero, suspectZero, invalid, error] = await Promise.all([
    updateTierAssignments(grouped.confirmed_positive, {
      ccu_fetch_status: 'valid',
      ccu_skip_until: null,
      last_ccu_synced: syncTimeIso,
      last_ccu_validation_state: 'confirmed_positive',
      last_ccu_validation_at: syncTimeIso,
    }, tiger),
    updateTierAssignments(grouped.confirmed_zero, {
      ccu_fetch_status: 'valid',
      ccu_skip_until: null,
      last_ccu_synced: syncTimeIso,
      last_ccu_validation_state: 'confirmed_zero',
      last_ccu_validation_at: syncTimeIso,
    }, tiger),
    updateTierAssignments(grouped.suspect_zero, {
      ccu_fetch_status: 'valid',
      ccu_skip_until: null,
      last_ccu_synced: syncTimeIso,
      last_ccu_validation_state: 'suspect_zero',
      last_ccu_validation_at: syncTimeIso,
    }, tiger),
    updateTierAssignments(grouped.invalid, {
      ccu_fetch_status: 'invalid',
      ccu_skip_until: invalidSkipUntilIso,
      last_ccu_synced: syncTimeIso,
      last_ccu_validation_state: 'invalid',
      last_ccu_validation_at: syncTimeIso,
    }, tiger),
    updateTierAssignments(grouped.error, {
      last_ccu_validation_state: 'error',
      last_ccu_validation_at: syncTimeIso,
    }, tiger),
  ]);

  return {
    confirmedPositive,
    confirmedZero,
    suspectZero,
    invalid,
    error,
  };
}
