/**
 * Interpolation Worker
 *
 * Fills gaps in review_deltas with interpolated values for trend visualization.
 * Runs daily to ensure continuous time-series data.
 *
 * Run with: pnpm --filter @publisheriq/ingestion interpolate-reviews
 */

import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type SyncJobUpdate,
  type TigerWriter,
} from "@publisheriq/database";
import {
  InterpolationBatchTimeoutError,
  runInterpolationReviewDeltasBatch,
  type InterpolationBatchResult,
} from "@publisheriq/database/ingestion";
import { logger } from "@publisheriq/shared";

const log = logger.child({ worker: "interpolation" });
const DEFAULT_INTERPOLATION_DAYS = 30;
const DEFAULT_APP_BATCH_SIZE = 1000;
const MIN_APP_BATCH_SIZE = 250;
type SupabaseClient = ReturnType<typeof getServiceClient>;
type InterpolationDbClient = SupabaseClient | null;

async function updateSyncJob(
  jobId: string | null,
  supabase: InterpolationDbClient,
  tiger: TigerWriter | null,
  values: SyncJobUpdate,
): Promise<void> {
  if (!jobId) {
    return;
  }

  if (tiger) {
    await tiger.ops.updateSyncJob(jobId, values);
    return;
  }

  if (!supabase) {
    throw new Error("Supabase client is required for legacy interpolation sync job updates");
  }

  await supabase.from("sync_jobs").update(values).eq("id", jobId);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received "${value}"`);
  }

  return parsed;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const parts = [
      typeof record.message === "string" ? record.message : null,
      typeof record.code === "string" ? `code=${record.code}` : null,
      typeof record.details === "string" ? `details=${record.details}` : null,
      typeof record.hint === "string" ? `hint=${record.hint}` : null,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(" | ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const env = process.env;
  const useTiger = readDataWriteTarget(env) === "tiger";
  const tiger = useTiger ? getTigerWriter(env) : null;
  const githubRunId = env.GITHUB_RUN_ID;

  // Get date range from env or default to last 30 days
  const daysBack = parsePositiveInt(
    env.INTERPOLATION_DAYS,
    DEFAULT_INTERPOLATION_DAYS,
  );
  const initialAppBatchSize = parsePositiveInt(
    env.INTERPOLATION_APP_BATCH_SIZE,
    DEFAULT_APP_BATCH_SIZE,
  );
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const endDate = new Date().toISOString().split("T")[0];

  log.info("Starting review interpolation", {
    githubRunId,
    startDate,
    endDate,
    daysBack,
    initialAppBatchSize,
    minAppBatchSize: MIN_APP_BATCH_SIZE,
  });

  const supabase: InterpolationDbClient = tiger ? null : getServiceClient();

  // Create sync job record
  const jobId = tiger
    ? await tiger.ops.createSyncJob({
        jobType: "interpolation",
        githubRunId,
        batchSize: daysBack,
      })
    : (await supabase!
        .from("sync_jobs")
        .insert({
          job_type: "interpolation",
          github_run_id: githubRunId,
          status: "running",
          batch_size: daysBack,
        })
        .select()
        .single()
      ).data?.id ?? null;

  try {
    let totalInterpolated = 0;
    let appsProcessed = 0;
    let batchCount = 0;
    let lastAppId = 0;
    let hasMore = true;
    let currentBatchSize = initialAppBatchSize;

    while (hasMore) {
      batchCount += 1;
      let attemptCount = 0;
      let attemptBatchSize = currentBatchSize;
      const attemptedBatchSizes: number[] = [];
      let batchResult: InterpolationBatchResult | null = null;

      while (!batchResult) {
        attemptCount += 1;
        attemptedBatchSizes.push(attemptBatchSize);
        const batchStartedAt = Date.now();

        log.info("Running interpolation batch", {
          batchCount,
          attemptCount,
          appBatchSize: attemptBatchSize,
          startDate,
          endDate,
          afterAppId: lastAppId,
        });

        try {
          batchResult = await runInterpolationReviewDeltasBatch({
            startDate,
            endDate,
            afterAppId: lastAppId,
            appLimit: attemptBatchSize,
          });
          currentBatchSize = attemptBatchSize;

          const batchDurationMs = Date.now() - batchStartedAt;
          totalInterpolated += batchResult.total_interpolated ?? 0;
          appsProcessed += batchResult.apps_processed ?? 0;

          log.info("Interpolation batch completed", {
            batchCount,
            attemptCount,
            appBatchSize: attemptBatchSize,
            batchDurationMs,
            appsProcessed: batchResult.apps_processed ?? 0,
            batchInterpolated: batchResult.total_interpolated ?? 0,
            totalInterpolated,
            cumulativeAppsProcessed: appsProcessed,
            lastAppId: batchResult.last_appid,
            hasMore: batchResult.has_more,
          });
        } catch (error) {
          const batchDurationMs = Date.now() - batchStartedAt;

          if (
            error instanceof InterpolationBatchTimeoutError &&
            attemptBatchSize > MIN_APP_BATCH_SIZE
          ) {
            const nextBatchSize = Math.max(
              MIN_APP_BATCH_SIZE,
              Math.floor(attemptBatchSize / 2),
            );

            log.warn("Interpolation batch timed out; reducing batch size", {
              batchCount,
              attemptCount,
              afterAppId: lastAppId,
              attemptedBatchSize: attemptBatchSize,
              nextBatchSize,
              timeoutMs: error.timeoutMs,
              batchDurationMs,
            });

            attemptBatchSize = nextBatchSize;
            continue;
          }

          throw new Error(
            `Failed to interpolate batch ${batchCount} after appid ${lastAppId} with batch sizes [${attemptedBatchSizes.join(", ")}]: ${formatUnknownError(error)}`,
          );
        }
      }

      if ((batchResult.apps_processed ?? 0) === 0 || batchResult.last_appid === null) {
        hasMore = false;
        break;
      }

      if (batchResult.last_appid <= lastAppId) {
        throw new Error(
          `Interpolation batch cursor stalled at appid ${batchResult.last_appid}`,
        );
      }

      lastAppId = batchResult.last_appid;
      hasMore = batchResult.has_more ?? false;
    }

    log.info("Interpolation completed", {
      totalInterpolated,
      appsProcessed,
      batchCount,
      finalBatchSize: currentBatchSize,
    });

    // Get stats on interpolated vs actual data
    let interpolatedCount: number | null = null;
    let actualCount: number | null = null;
    let interpolatedCountError: { message?: string } | null = null;
    let actualCountError: { message?: string } | null = null;

    if (tiger) {
      [interpolatedCount, actualCount] = await Promise.all([
        tiger.metrics.countReviewDeltas({ startDate, interpolated: true }),
        tiger.metrics.countReviewDeltas({ startDate, interpolated: false }),
      ]);
    } else {
      const [interpolatedCountResult, actualCountResult] = await Promise.all([
        supabase!
          .from("review_deltas")
          .select("*", { count: "exact", head: true })
          .gte("delta_date", startDate)
          .eq("is_interpolated", true),
        supabase!
          .from("review_deltas")
          .select("*", { count: "exact", head: true })
          .gte("delta_date", startDate)
          .eq("is_interpolated", false),
      ]);

      interpolatedCount = interpolatedCountResult.count;
      actualCount = actualCountResult.count;
      interpolatedCountError = interpolatedCountResult.error;
      actualCountError = actualCountResult.error;
    }

    if (interpolatedCountError || actualCountError) {
      log.warn("Failed to fetch interpolation delta stats", {
        interpolatedCountError: interpolatedCountError?.message,
        actualCountError: actualCountError?.message,
      });
    }

    log.info("Delta stats", {
      totalRecords: (interpolatedCount ?? 0) + (actualCount ?? 0),
      actualSyncs: actualCount,
      interpolatedRecords: interpolatedCount,
      interpolationRatio:
        typeof actualCount === "number" &&
        actualCount > 0 &&
        typeof interpolatedCount === "number"
          ? (interpolatedCount / actualCount).toFixed(2)
          : "N/A",
    });

    // Update job as completed
    await updateSyncJob(jobId, supabase, tiger, {
      status: "completed",
      completed_at: new Date().toISOString(),
      items_processed: appsProcessed,
      items_succeeded: totalInterpolated,
      items_failed: 0,
      items_created: totalInterpolated,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info("Interpolation worker completed", {
      durationSeconds: duration,
      appsProcessed,
      totalInterpolated,
      batchCount,
    });
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    log.error("Interpolation failed", {
      error: errorMessage,
      stack: errorStack,
      durationSeconds: ((Date.now() - startTime) / 1000).toFixed(2),
    });

    await updateSyncJob(jobId, supabase, tiger, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    });

    process.exit(1);
  }
}

main();
