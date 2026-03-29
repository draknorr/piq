import { getServiceClient } from '@publisheriq/database';
import * as databaseIngestion from '@publisheriq/database/ingestion';
import type {
  CcuProvenanceRepairCandidate,
  CcuRepairSource,
  CcuValidationBackfillCandidate,
} from '@publisheriq/database/ingestion';
import { logger } from '@publisheriq/shared';
import { refreshCcuQualityCacheSafely } from '../workers-support/ccu-quality-cache.js';

const log = logger.child({ worker: 'repair-current-ccu-state' });

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_REFRESH_TIMEOUT_MS = 900000;
const UPDATE_BATCH_SIZE = 250;

type BackfilledValidationState = 'confirmed_positive' | 'confirmed_zero' | 'invalid' | 'error';

const {
  getCcuProvenanceRepairCandidates,
  getCcuValidationBackfillCandidates,
  refreshMaterializedView,
} = databaseIngestion as {
  getCcuProvenanceRepairCandidates: (params: {
    appids?: number[];
    limit: number;
  }) => Promise<CcuProvenanceRepairCandidate[]>;
  getCcuValidationBackfillCandidates: (params: {
    appids?: number[];
    limit: number;
  }) => Promise<CcuValidationBackfillCandidate[]>;
  refreshMaterializedView: (
    viewName: string,
    options?: { concurrently?: boolean; timeoutMs?: number }
  ) => Promise<void>;
};

interface ValidationBackfillUpdate {
  appid: number;
  last_ccu_validation_at: string;
  last_ccu_validation_state: BackfilledValidationState;
}

interface RepairStats {
  provenanceCandidates: number;
  provenanceUpdated: number;
  validationCandidates: number;
  validationUpdated: number;
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  return raw === '1' || raw.toLowerCase() === 'true';
}

function parseAppIds(raw: string | undefined): number[] | null {
  if (!raw) {
    return null;
  }

  const appids = raw
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return appids.length > 0 ? Array.from(new Set(appids)) : null;
}

function normalizeMetricDateToIso(metricDate: string | null): string | null {
  if (!metricDate) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) {
    return `${metricDate}T00:00:00.000Z`;
  }

  const parsed = new Date(metricDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveValidationBackfill(
  candidate: CcuValidationBackfillCandidate
): ValidationBackfillUpdate | null {
  const atFromExisting = candidate.existingValidationAt
    ?? candidate.lastCcuSynced
    ?? candidate.updatedAt
    ?? normalizeMetricDateToIso(candidate.metricDate);

  if (
    candidate.existingValidationState &&
    atFromExisting &&
    ['confirmed_positive', 'confirmed_zero', 'invalid', 'error'].includes(
      candidate.existingValidationState
    )
  ) {
    return {
      appid: candidate.appid,
      last_ccu_validation_state: candidate.existingValidationState as BackfilledValidationState,
      last_ccu_validation_at: atFromExisting,
    };
  }

  if (candidate.ccuFetchStatus === 'invalid') {
    return {
      appid: candidate.appid,
      last_ccu_validation_state: 'invalid',
      last_ccu_validation_at:
        candidate.lastCcuSynced
        ?? candidate.updatedAt
        ?? normalizeMetricDateToIso(candidate.metricDate)
        ?? new Date().toISOString(),
    };
  }

  if (candidate.latestPositiveSnapshotAt) {
    return {
      appid: candidate.appid,
      last_ccu_validation_state: 'confirmed_positive',
      last_ccu_validation_at: candidate.latestPositiveSnapshotAt,
    };
  }

  if (
    candidate.ccuSource === 'steam_api' &&
    (candidate.ccuPeak ?? 0) > 0 &&
    (candidate.lastCcuSynced || candidate.metricDate)
  ) {
    return {
      appid: candidate.appid,
      last_ccu_validation_state: 'confirmed_positive',
      last_ccu_validation_at:
        candidate.lastCcuSynced
        ?? normalizeMetricDateToIso(candidate.metricDate)
        ?? new Date().toISOString(),
    };
  }

  if (
    candidate.ccuFetchStatus === 'valid' &&
    candidate.ccuSource === 'steam_api' &&
    (candidate.ccuPeak ?? 0) === 0 &&
    (candidate.lastCcuSynced || candidate.metricDate)
  ) {
    return {
      appid: candidate.appid,
      last_ccu_validation_state: 'confirmed_zero',
      last_ccu_validation_at:
        candidate.lastCcuSynced
        ?? normalizeMetricDateToIso(candidate.metricDate)
        ?? new Date().toISOString(),
    };
  }

  return null;
}

function groupProvenanceCandidates(
  candidates: CcuProvenanceRepairCandidate[]
): Map<string, { appids: number[]; metricDate: string; source: CcuRepairSource }> {
  const grouped = new Map<string, { appids: number[]; metricDate: string; source: CcuRepairSource }>();

  for (const candidate of candidates) {
    const key = `${candidate.metricDate}:${candidate.inferredSource}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.appids.push(candidate.appid);
    } else {
      grouped.set(key, {
        appids: [candidate.appid],
        metricDate: candidate.metricDate,
        source: candidate.inferredSource,
      });
    }
  }

  return grouped;
}

async function repairProvenance(
  supabase: ReturnType<typeof getServiceClient>,
  candidates: CcuProvenanceRepairCandidate[],
  dryRun: boolean
): Promise<number> {
  if (dryRun || candidates.length === 0) {
    return 0;
  }

  let updated = 0;
  const grouped = groupProvenanceCandidates(candidates);

  for (const group of grouped.values()) {
    for (let i = 0; i < group.appids.length; i += UPDATE_BATCH_SIZE) {
      const batch = group.appids.slice(i, i + UPDATE_BATCH_SIZE);
      const { error } = await supabase
        .from('daily_metrics')
        .update({ ccu_source: group.source })
        .eq('metric_date', group.metricDate)
        .is('ccu_source', null)
        .in('appid', batch);

      if (error) {
        log.error('Failed to repair CCU provenance batch', {
          batchStart: i,
          error: error.message,
          metricDate: group.metricDate,
          source: group.source,
        });
        continue;
      }

      updated += batch.length;
    }
  }

  return updated;
}

async function backfillValidationState(
  supabase: ReturnType<typeof getServiceClient>,
  candidates: CcuValidationBackfillCandidate[],
  dryRun: boolean
): Promise<number> {
  const updates = candidates
    .map(resolveValidationBackfill)
    .filter((value): value is ValidationBackfillUpdate => value !== null);

  if (dryRun || updates.length === 0) {
    return 0;
  }

  let updated = 0;
  for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
    const batch = updates.slice(i, i + UPDATE_BATCH_SIZE);
    const { error } = await (supabase as any)
      .from('ccu_tier_assignments')
      .upsert(batch, { onConflict: 'appid', ignoreDuplicates: false });

    if (error) {
      log.error('Failed to backfill CCU validation batch', {
        batchStart: i,
        error: error.message,
      });
      continue;
    }

    updated += batch.length;
  }

  return updated;
}

async function main(): Promise<void> {
  const githubRunId = process.env.GITHUB_RUN_ID;
  const batchSize = Number.parseInt(process.env.BATCH_SIZE || `${DEFAULT_BATCH_SIZE}`, 10);
  const refreshTimeoutMs = Number.parseInt(
    process.env.REFRESH_TIMEOUT_MS || `${DEFAULT_REFRESH_TIMEOUT_MS}`,
    10
  );
  const dryRun = parseBooleanEnv(process.env.DRY_RUN, true);
  const repairProvenanceEnabled = parseBooleanEnv(process.env.REPAIR_PROVENANCE, true);
  const backfillValidationEnabled = parseBooleanEnv(process.env.BACKFILL_VALIDATION, true);
  const explicitAppids = parseAppIds(process.env.APPIDS);
  const supabase = getServiceClient();

  log.info('Starting current CCU state repair', {
    backfillValidationEnabled,
    batchSize,
    dryRun,
    explicitAppidsCount: explicitAppids?.length ?? 0,
    githubRunId,
    refreshTimeoutMs,
    repairProvenanceEnabled,
  });

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      batch_size: batchSize,
      github_run_id: githubRunId,
      job_type: 'ccu-current-state-repair',
      status: 'running',
    })
    .select()
    .single();

  const stats: RepairStats = {
    provenanceCandidates: 0,
    provenanceUpdated: 0,
    validationCandidates: 0,
    validationUpdated: 0,
  };

  try {
    const [provenanceCandidates, validationCandidates] = await Promise.all([
      repairProvenanceEnabled
        ? getCcuProvenanceRepairCandidates({
            appids: explicitAppids ?? undefined,
            limit: batchSize,
          })
        : Promise.resolve([]),
      backfillValidationEnabled
        ? getCcuValidationBackfillCandidates({
            appids: explicitAppids ?? undefined,
            limit: batchSize,
          })
        : Promise.resolve([]),
    ]);

    stats.provenanceCandidates = provenanceCandidates.length;
    stats.validationCandidates = validationCandidates.length;

    log.info('Selected current CCU state repair candidates', {
      provenanceCandidates: provenanceCandidates.slice(0, 20),
      validationCandidates: validationCandidates.slice(0, 20),
    });

    stats.provenanceUpdated = await repairProvenance(supabase, provenanceCandidates, dryRun);
    stats.validationUpdated = await backfillValidationState(supabase, validationCandidates, dryRun);

    if (!dryRun && stats.provenanceUpdated > 0) {
      log.info('Refreshing latest_daily_metrics after CCU provenance repair');
      await refreshMaterializedView('latest_daily_metrics', { timeoutMs: refreshTimeoutMs });
    }

    if (
      !dryRun &&
      (stats.provenanceUpdated > 0 || stats.validationUpdated > 0)
    ) {
      await refreshCcuQualityCacheSafely('repair-current-ccu-state', refreshTimeoutMs);
    }

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          completed_at: new Date().toISOString(),
          items_failed: 0,
          items_processed: stats.provenanceCandidates + stats.validationCandidates,
          items_succeeded: stats.provenanceUpdated + stats.validationUpdated,
          status: 'completed',
        })
        .eq('id', job.id);
    }

    log.info('Current CCU state repair completed', { ...stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Current CCU state repair failed', { error: message });

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          completed_at: new Date().toISOString(),
          error_message: message,
          items_failed: 0,
          items_processed: stats.provenanceCandidates + stats.validationCandidates,
          items_succeeded: stats.provenanceUpdated + stats.validationUpdated,
          status: 'failed',
        })
        .eq('id', job.id);
    }

    process.exit(1);
  }
}

main();
