/**
 * Steam App Change Hints Worker
 *
 * Fetches `last_modified` and `price_change_number` hints from
 * IStoreService/GetAppList and enqueues storefront recaptures when they change.
 *
 * Run with: pnpm --filter @publisheriq/ingestion app-change-hints
 */

import { pathToFileURL } from 'node:url';
import {
  getServiceClient,
  getTigerWriter,
  type CatalogObservationRejection,
  type CatalogObservationRow,
  type CatalogScanBatchResult,
  type CatalogScanStart,
  type TigerWriter,
} from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { fetchSteamAppChangeHints } from '../apis/steam-web.js';
import {
  assertCatalogShadowParity,
  buildCatalogBatchHash,
  buildCatalogInputHash,
  buildCatalogScanRunKey,
  normalizeCatalogObservationRows,
  readCatalogFinalizationBatchSize,
  readCatalogObservationMode,
  type CatalogObservationMode,
} from '../catalog-observation.js';
import {
  partitionHintRows,
  type ExistingHintStatusRow,
  type HintRow,
} from '../change-intel/hints.js';
import {
  createSyncJobRecord,
  enqueueCaptureJobs,
  updateSyncJobRecord,
} from '../change-intel/repository.js';
import { readChangeIntelRuntimeConfig, shouldWriteTiger } from '../change-intel/runtime-config.js';
import {
  getTigerChangeIntelRepository,
  type TigerChangeIntelRepository,
} from '../change-intel/tiger-repository.js';
import { buildHintCursor } from '../workers-support/change-intel.js';
import {
  isLaunchWindowRelease,
  type ReviewPromotion,
  promoteReviewsSyncBatch,
} from '../workers-support/reviews-sync.js';

const log = logger.child({ worker: 'app-change-hints' });

type SupabaseClient = ReturnType<typeof getServiceClient>;
type OptionalSupabaseClient = SupabaseClient | null;

export interface AppChangeHintsResult {
  changed: number;
  enqueued: number;
  promoted: number;
  skipped: number;
  totalHints: number;
}

export interface AppChangeHintsDependencies {
  env?: NodeJS.ProcessEnv;
  fetchHints?: typeof fetchSteamAppChangeHints;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
  getTigerChangeIntel?: () => TigerChangeIntelRepository;
  now?: () => Date;
}

export interface TagCandidateMeta {
  catalogFirstObservationKind: string | null;
  catalogFirstObservedAt: string | null;
  hasKnownTags: boolean;
  isReleased: boolean | null;
  parentAppid: number | null;
  priorityScore: number;
  releaseDate: string | null;
  type: string | null;
}

export interface StorefrontTagHintJob {
  appid: number;
  payload: Record<string, unknown>;
  priority: number;
  source: 'storefront_tags';
  triggerCursor: string;
  triggerReason: string;
}

function daysFromNow(value: string | null, nowMs: number): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : (parsed - nowMs) / (24 * 60 * 60 * 1000);
}

function storefrontTagHintsEnabled(env: NodeJS.ProcessEnv): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (env.STOREFRONT_TAGS_ENABLED ?? '').trim().toLowerCase()
  );
}

export function buildStorefrontTagHintJobs(
  changedRows: HintRow[],
  metadataByAppid: Map<number, TagCandidateMeta>,
  nowMs = Date.now()
): StorefrontTagHintJob[] {
  const jobs = new Map<number, StorefrontTagHintJob>();
  for (const row of changedRows) {
    const app = metadataByAppid.get(row.appid);
    if (!app || app.hasKnownTags) {
      continue;
    }
    const type = app.type?.toLowerCase();
    if (type !== 'game' && type !== 'demo') {
      continue;
    }
    const targetAppid = app.parentAppid && app.parentAppid > 0 ? app.parentAppid : row.appid;
    const releaseDistance = daysFromNow(app.releaseDate, nowMs);
    const firstObservedDistance = daysFromNow(app.catalogFirstObservedAt, nowMs);
    const newlyObserved =
      app.catalogFirstObservationKind === 'new' &&
      firstObservedDistance !== null &&
      firstObservedDistance >= -2;

    let priority = 0;
    let triggerReason = '';
    if (type === 'demo') {
      priority = 900;
      triggerReason = 'new_or_changed_demo_missing_tags';
    } else if (newlyObserved) {
      priority = 900;
      triggerReason = 'new_game_missing_tags';
    } else if (releaseDistance !== null && releaseDistance >= -14 && releaseDistance <= 30) {
      priority = 800;
      triggerReason = 'launch_window_game_missing_tags';
    } else if (app.priorityScore >= 50) {
      priority = 700;
      triggerReason = 'priority_game_missing_tags';
    } else {
      continue;
    }

    const candidate = {
      appid: targetAppid,
      payload: {
        requested_appid: row.appid,
        requested_type: type,
      },
      priority,
      source: 'storefront_tags' as const,
      triggerCursor: buildHintCursor(row.lastModified, row.priceChangeNumber),
      triggerReason,
    };
    const existing = jobs.get(targetAppid);
    if (!existing || existing.priority < candidate.priority) {
      jobs.set(targetAppid, candidate);
    }
  }
  return Array.from(jobs.values());
}

function shouldUseTigerPrimary(env: NodeJS.ProcessEnv = process.env): boolean {
  return readChangeIntelRuntimeConfig(env).writeTarget === 'tiger';
}

async function processHintBatch(
  supabase: OptionalSupabaseClient,
  batch: HintRow[],
  env: NodeJS.ProcessEnv = process.env,
  injectedTiger?: TigerChangeIntelRepository
): Promise<{
  changed: number;
  enqueued: number;
  skipped: number;
  promoted: number;
}> {
  const appids = batch.map((row) => row.appid);
  if (shouldUseTigerPrimary(env)) {
    const tiger = injectedTiger ?? getTigerChangeIntelRepository();
    const hintRows = await tiger.listHintStatusRows(appids);
    const knownAppids = new Set<number>(hintRows.map((row) => row.appid));

    if (knownAppids.size === 0) {
      return {
        changed: 0,
        enqueued: 0,
        skipped: batch.length,
        promoted: 0,
      };
    }

    const existingByAppid = new Map<number, ExistingHintStatusRow>(
      hintRows.map((row) => [
        row.appid,
        {
          appid: row.appid,
          steam_last_modified: row.steam_last_modified,
          steam_price_change_number: row.steam_price_change_number,
        },
      ])
    );
    const priorityByAppid = new Map<number, number>(
      hintRows.map((row) => [row.appid, row.priority_score ?? 0])
    );
    const knownAppMetaByAppid = new Map(
      hintRows.map((row) => [
        row.appid,
        {
          is_released: row.is_released,
          release_date: row.release_date,
          type: row.type,
        },
      ])
    );
    const tagMetaByAppid = new Map<number, TagCandidateMeta>(
      hintRows.map((row) => [
        row.appid,
        {
          catalogFirstObservationKind: row.catalog_first_observation_kind,
          catalogFirstObservedAt: row.catalog_first_observed_at,
          hasKnownTags: row.has_known_tags,
          isReleased: row.is_released,
          parentAppid: row.parent_appid,
          priorityScore: row.priority_score ?? 0,
          releaseDate: row.release_date,
          type: row.type,
        },
      ])
    );

    const partitioned = partitionHintRows(batch, knownAppids, existingByAppid);

    await tiger.upsertHintStatusRows(
      partitioned.changedRows.map((row) => ({
        appid: row.appid,
        steamLastModified: row.lastModified,
        steamPriceChangeNumber: row.priceChangeNumber,
      }))
    );

    const storefrontEnqueued = await tiger.enqueueCaptureJobs(
      partitioned.changedRows.map((row) => ({
        appid: row.appid,
        source: 'storefront',
        triggerReason: 'steam_app_change_hint',
        triggerCursor: buildHintCursor(row.lastModified, row.priceChangeNumber),
        priority: 100,
      }))
    );
    const tagJobs = storefrontTagHintsEnabled(env)
      ? buildStorefrontTagHintJobs(partitioned.changedRows, tagMetaByAppid)
      : [];
    const tagEnqueued = tagJobs.length > 0 ? await tiger.enqueueCaptureJobs(tagJobs) : 0;

    const promotions = buildReviewPromotions(
      partitioned.changedRows,
      knownAppMetaByAppid,
      priorityByAppid
    );
    const promoted = await tiger.promoteReviewsSyncBatch(promotions);

    return {
      changed: partitioned.changedRows.length,
      enqueued: storefrontEnqueued + tagEnqueued,
      skipped: partitioned.skippedRows.length,
      promoted,
    };
  }

  if (!supabase) {
    throw new Error(
      'Supabase service client is required when app-change-hints is not Tiger primary.'
    );
  }

  const db = supabase as any;
  const { data: knownApps, error: knownAppsError } = await db
    .from('apps')
    .select('appid, type, is_released, release_date')
    .in('appid', appids);

  if (knownAppsError) {
    throw new Error(`Failed to fetch known app rows: ${knownAppsError.message}`);
  }

  const knownAppids = new Set<number>((knownApps ?? []).map((row: { appid: number }) => row.appid));
  if (knownAppids.size === 0) {
    return {
      changed: 0,
      enqueued: 0,
      skipped: batch.length,
      promoted: 0,
    };
  }

  const knownRows = batch.filter((row) => knownAppids.has(row.appid));
  const { data: existingRows, error: existingError } = await db
    .from('sync_status')
    .select('appid, steam_last_modified, steam_price_change_number, priority_score')
    .in(
      'appid',
      knownRows.map((row) => row.appid)
    );

  if (existingError) {
    throw new Error(`Failed to fetch existing hint rows: ${existingError.message}`);
  }

  const existingByAppid = new Map<number, ExistingHintStatusRow>(
    (existingRows ?? []).map((row: ExistingHintStatusRow) => [row.appid, row])
  );
  const priorityByAppid = new Map<number, number>(
    (existingRows ?? []).map((row: { appid: number; priority_score: number | null }) => [
      row.appid,
      row.priority_score ?? 0,
    ])
  );
  const knownAppMetaByAppid = new Map<
    number,
    {
      type: string | null;
      is_released: boolean | null;
      release_date: string | null;
    }
  >(
    (knownApps ?? []).map(
      (row: {
        appid: number;
        type: string | null;
        is_released: boolean | null;
        release_date: string | null;
      }) => [
        row.appid,
        {
          type: row.type,
          is_released: row.is_released,
          release_date: row.release_date,
        },
      ]
    )
  );

  const partitioned = partitionHintRows(batch, knownAppids, existingByAppid);

  if (partitioned.changedRows.length > 0) {
    const { error: updateError } = await db.from('sync_status').upsert(
      partitioned.changedRows.map((row) => ({
        appid: row.appid,
        steam_last_modified: row.lastModified,
        steam_price_change_number: row.priceChangeNumber,
      })),
      { onConflict: 'appid' }
    );

    if (updateError) {
      throw new Error(`Failed to upsert hint rows: ${updateError.message}`);
    }
  }

  if (shouldWriteTiger(readChangeIntelRuntimeConfig(env))) {
    await (injectedTiger ?? getTigerChangeIntelRepository()).upsertHintStatusRows(
      partitioned.changedRows.map((row) => ({
        appid: row.appid,
        steamLastModified: row.lastModified,
        steamPriceChangeNumber: row.priceChangeNumber,
      }))
    );
  }

  const enqueued = await enqueueCaptureJobs(
    supabase,
    partitioned.changedRows.map((row) => ({
      appid: row.appid,
      source: 'storefront',
      triggerReason: 'steam_app_change_hint',
      triggerCursor: buildHintCursor(row.lastModified, row.priceChangeNumber),
      priority: 100,
    }))
  );

  const promotions: ReviewPromotion[] = [];
  for (const row of partitioned.changedRows) {
    const app = knownAppMetaByAppid.get(row.appid);
    const priorityScore = priorityByAppid.get(row.appid) ?? 0;

    if (!app || app.type !== 'game') {
      continue;
    }

    if (isLaunchWindowRelease(app.is_released, app.release_date)) {
      promotions.push({
        appid: row.appid,
        bucket: 'launch_critical',
        score: 100,
        reason: 'steam_change_hint_launch_window',
        until: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      });
      continue;
    }

    if (priorityScore >= 50) {
      promotions.push({
        appid: row.appid,
        bucket: 'change_critical',
        score: 80,
        reason: 'steam_change_hint_priority_game',
        until: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });
    }
  }

  const promoted = promotions.length > 0 ? await promoteReviewsSyncBatch(supabase, promotions) : 0;
  if (promotions.length > 0 && shouldWriteTiger(readChangeIntelRuntimeConfig(env))) {
    await (injectedTiger ?? getTigerChangeIntelRepository()).promoteReviewsSyncBatch(promotions);
  }

  return {
    changed: partitioned.changedRows.length,
    enqueued,
    skipped: partitioned.skippedRows.length,
    promoted,
  };
}

function buildReviewPromotions(
  changedRows: HintRow[],
  knownAppMetaByAppid: Map<
    number,
    {
      type: string | null;
      is_released: boolean | null;
      release_date: string | null;
    }
  >,
  priorityByAppid: Map<number, number>
): ReviewPromotion[] {
  const promotions: ReviewPromotion[] = [];
  for (const row of changedRows) {
    const app = knownAppMetaByAppid.get(row.appid);
    const priorityScore = priorityByAppid.get(row.appid) ?? 0;

    if (!app || app.type !== 'game') {
      continue;
    }

    if (isLaunchWindowRelease(app.is_released, app.release_date)) {
      promotions.push({
        appid: row.appid,
        bucket: 'launch_critical',
        score: 100,
        reason: 'steam_change_hint_launch_window',
        until: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      });
      continue;
    }

    if (priorityScore >= 50) {
      promotions.push({
        appid: row.appid,
        bucket: 'change_critical',
        score: 80,
        reason: 'steam_change_hint_priority_game',
        until: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });
    }
  }

  return promotions;
}

async function processObservedHintBatch(params: {
  batchHash: string;
  batchIndex: number;
  mode: Exclude<CatalogObservationMode, 'off'>;
  rejections: CatalogObservationRejection[];
  rows: CatalogObservationRow[];
  scan: CatalogScanStart;
  tiger: TigerWriter;
  tigerChangeIntel: TigerChangeIntelRepository;
  tagHintsEnabled: boolean;
  verifyParity: boolean;
}): Promise<{
  changed: number;
  committed: CatalogScanBatchResult;
  enqueued: number;
  promoted: number;
}> {
  const hintRows: HintRow[] = params.rows.map((row) => ({
    appid: row.appid,
    lastModified: row.last_modified!,
    priceChangeNumber: row.price_change_number!,
  }));
  const existingRows = await params.tigerChangeIntel.listHintStatusRows(
    hintRows.map((row) => row.appid)
  );
  const knownAppids = new Set(existingRows.map((row) => row.appid));
  const existingByAppid = new Map<number, ExistingHintStatusRow>(
    existingRows.map((row) => [
      row.appid,
      {
        appid: row.appid,
        steam_last_modified: row.steam_last_modified,
        steam_price_change_number: row.steam_price_change_number,
      },
    ])
  );
  const partitioned = partitionHintRows(hintRows, knownAppids, existingByAppid);
  const committed = await params.tiger.catalogObservation.commitBatch({
    batchHash: params.batchHash,
    batchIndex: params.batchIndex,
    rejections: params.rejections,
    rows: params.rows,
    scanId: params.scan.id,
  });

  if (params.mode === 'shadow' && params.verifyParity) {
    assertCatalogShadowParity({
      actualChangedKnownAppids: committed.changedKnownAppids,
      actualUnknownAppids: committed.unknownAppids,
      expectedChangedKnownAppids: partitioned.changedRows.map((row) => row.appid),
      expectedUnknownAppids: partitioned.skippedRows.map((row) => row.appid),
    });
  }

  const changedAppids = new Set(committed.changedKnownAppids);
  const changedRows = hintRows.filter((row) => changedAppids.has(row.appid));
  const knownAppMetaByAppid = new Map(
    existingRows.map((row) => [
      row.appid,
      {
        is_released: row.is_released,
        release_date: row.release_date,
        type: row.type,
      },
    ])
  );
  const tagMetaByAppid = new Map<number, TagCandidateMeta>(
    existingRows.map((row) => [
      row.appid,
      {
        catalogFirstObservationKind: row.catalog_first_observation_kind,
        catalogFirstObservedAt: row.catalog_first_observed_at,
        hasKnownTags: row.has_known_tags,
        isReleased: row.is_released,
        parentAppid: row.parent_appid,
        priorityScore: row.priority_score ?? 0,
        releaseDate: row.release_date,
        type: row.type,
      },
    ])
  );
  const priorityByAppid = new Map(existingRows.map((row) => [row.appid, row.priority_score ?? 0]));
  const promotions = buildReviewPromotions(changedRows, knownAppMetaByAppid, priorityByAppid);
  const promoted =
    promotions.length > 0 ? await params.tigerChangeIntel.promoteReviewsSyncBatch(promotions) : 0;
  const tagJobs = params.tagHintsEnabled
    ? buildStorefrontTagHintJobs(changedRows, tagMetaByAppid)
    : [];
  const tagEnqueued =
    tagJobs.length > 0 ? await params.tigerChangeIntel.enqueueCaptureJobs(tagJobs) : 0;

  return {
    changed: committed.changedKnownRows,
    committed,
    enqueued: committed.enqueuedRows + tagEnqueued,
    promoted,
  };
}

export async function runAppChangeHints(
  dependencies: AppChangeHintsDependencies = {}
): Promise<AppChangeHintsResult> {
  const startTime = Date.now();
  const env = dependencies.env ?? process.env;
  const parsedBatchSize = Number.parseInt(env.HINT_BATCH_SIZE || '1000', 10);
  const batchSize =
    Number.isFinite(parsedBatchSize) && parsedBatchSize > 0 ? parsedBatchSize : 1000;
  const mode = readCatalogObservationMode(env);
  const catalogFinalizationBatchSize = readCatalogFinalizationBatchSize(env);
  const tigerPrimary = shouldUseTigerPrimary(env);
  if (mode !== 'off' && !tigerPrimary) {
    throw new Error('Catalog observation requires Tiger to be the primary change-intel writer');
  }

  const now = dependencies.now ?? (() => new Date());
  const fetchHints = dependencies.fetchHints ?? fetchSteamAppChangeHints;
  const supabase = tigerPrimary ? null : (dependencies.getSupabase?.() ?? getServiceClient());
  const tiger = mode === 'off' ? null : (dependencies.getTiger?.() ?? getTigerWriter(env));
  const tigerChangeIntel =
    tigerPrimary || mode !== 'off'
      ? (dependencies.getTigerChangeIntel?.() ?? getTigerChangeIntelRepository())
      : null;
  const jobId = tigerPrimary
    ? await tigerChangeIntel!.createSyncJobRecord('change_hints', batchSize)
    : await createSyncJobRecord(supabase!, 'change_hints', batchSize);
  const updateJob = async (id: string, values: Record<string, unknown>): Promise<void> => {
    if (tigerPrimary) {
      await tigerChangeIntel!.updateSyncJobRecord(id, values);
    } else {
      await updateSyncJobRecord(supabase!, id, values);
    }
  };
  let scan: CatalogScanStart | null = null;

  try {
    if (mode !== 'off') {
      scan = await tiger!.catalogObservation.beginScan({
        forceFull: false,
        mode,
        runKey: buildCatalogScanRunKey('steam_change_hints', env),
        source: 'steam_change_hints',
        sourceStartedAt: now().toISOString(),
      });
      if (scan.status === 'finalizing') {
        await tiger!.catalogObservation.resumeScanFinalization({
          batchSize: catalogFinalizationBatchSize,
          scanId: scan.id,
        });
        const resumedResult: AppChangeHintsResult = {
          changed: 0,
          enqueued: 0,
          promoted: 0,
          skipped: 0,
          totalHints: 0,
        };
        if (jobId) {
          await updateJob(jobId, {
            completed_at: now().toISOString(),
            items_created: 0,
            items_processed: 0,
            items_skipped: 0,
            items_succeeded: 0,
            status: 'completed',
          });
        }
        return resumedResult;
      }
      if (scan.status === 'completed') {
        const completedResult: AppChangeHintsResult = {
          changed: 0,
          enqueued: 0,
          promoted: 0,
          skipped: 0,
          totalHints: 0,
        };
        if (jobId) {
          await updateJob(jobId, {
            completed_at: now().toISOString(),
            items_created: 0,
            items_processed: 0,
            items_skipped: 0,
            items_succeeded: 0,
            status: 'completed',
          });
        }
        return completedResult;
      }
    }

    const hints = await fetchHints({
      ifModifiedSince: scan?.requestedIfModifiedSince ?? null,
    });
    const observation = normalizeCatalogObservationRows(hints, {
      requireHints: true,
    });
    let changed = 0;
    let enqueued = 0;
    let skipped = observation.rejections.length;
    let promoted = 0;

    if (mode === 'off') {
      for (let index = 0; index < observation.rows.length; index += batchSize) {
        const batch = observation.rows.slice(index, index + batchSize);
        const result = await processHintBatch(
          supabase,
          batch.map((row) => ({
            appid: row.appid,
            lastModified: row.last_modified!,
            priceChangeNumber: row.price_change_number!,
          })),
          env,
          tigerChangeIntel ?? undefined
        );
        changed += result.changed;
        enqueued += result.enqueued;
        skipped += result.skipped;
        promoted += result.promoted;
      }
    } else {
      const acceptedBatchCount = Math.ceil(observation.rows.length / batchSize);
      const expectedBatches = Math.max(
        acceptedBatchCount,
        observation.rejections.length > 0 ? 1 : 0
      );

      for (let batchIndex = 0; batchIndex < expectedBatches; batchIndex++) {
        const rows = observation.rows.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
        const rejections = batchIndex === 0 ? observation.rejections : [];
        const result = await processObservedHintBatch({
          batchHash: buildCatalogBatchHash(rows, rejections),
          batchIndex,
          mode,
          rejections,
          rows,
          scan: scan!,
          tiger: tiger!,
          tigerChangeIntel: tigerChangeIntel!,
          tagHintsEnabled: storefrontTagHintsEnabled(env),
          verifyParity: batchIndex > scan!.lastCommittedBatch,
        });
        changed += result.changed;
        enqueued += result.enqueued;
        skipped += result.committed.unknownRows;
        promoted += result.promoted;
      }

      await tiger!.catalogObservation.completeScan({
        expectedBatches,
        expectedSourceRows: observation.sourceRowCount,
        finalizationBatchSize: catalogFinalizationBatchSize,
        inputHash: buildCatalogInputHash(observation),
        reconciliationOutcome: {
          status: mode === 'shadow' ? 'pending_daily_parity' : 'not_applicable',
        },
        scanId: scan!.id,
      });
    }

    if (jobId) {
      await updateJob(jobId, {
        completed_at: now().toISOString(),
        items_created: enqueued,
        items_processed: observation.sourceRowCount,
        items_skipped: skipped,
        items_succeeded: changed,
        status: 'completed',
      });
    }

    log.info('App change hints completed', {
      catalogObservationMode: mode,
      totalHints: observation.sourceRowCount,
      changed,
      enqueued,
      promotedForReviews: promoted,
      skippedUnknownApps: skipped,
      durationSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
    });

    return {
      changed,
      enqueued,
      promoted,
      skipped,
      totalHints: observation.sourceRowCount,
    };
  } catch (error) {
    if (scan && scan.status !== 'completed' && tiger) {
      try {
        await tiger.catalogObservation.failScan(
          scan.id,
          error instanceof Error ? error.message : String(error)
        );
      } catch (scanError) {
        log.warn('Failed to mark durable catalog scan failed', {
          scanError: scanError instanceof Error ? scanError.message : String(scanError),
          scanId: scan.id,
        });
      }
    }

    if (jobId) {
      await updateJob(jobId, {
        completed_at: now().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_skipped: 0,
        status: 'failed',
      });
    }

    throw error;
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runAppChangeHints().catch((error) => {
    log.error('App change hints failed', { error });
    process.exit(1);
  });
}
