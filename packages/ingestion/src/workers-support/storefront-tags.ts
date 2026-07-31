import type { CaptureQueueJob, StorefrontTagEvidenceWrite } from '../change-intel/types.js';
import type { StorefrontTagFetchResult } from '../apis/storefront-tags.js';

const DEFAULT_SWEEP_GUARD_MINUTES = 50;
const URGENT_TAG_PRIORITY = 900;

export interface StorefrontTagBatchDependencies {
  complete: (
    jobIds: string[],
    status: 'completed' | 'failed' | 'queued' | 'dead_letter',
    errorMessage?: string
  ) => Promise<void>;
  defer: (jobIds: string[], delaySeconds: number, errorMessage: string) => Promise<void>;
  fetchTags: (appid: number) => Promise<StorefrontTagFetchResult>;
  upsertEvidence: (rows: StorefrontTagEvidenceWrite[]) => Promise<number>;
}

export interface StorefrontTagBatchResult {
  attempts: number;
  changed: number;
  claimed: number;
  failed: number;
  succeeded: number;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isScheduledStorefrontSweepWindow(
  date = new Date(),
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const guardMinutes = Math.min(
    59,
    readPositiveInteger(env.STOREFRONT_TAG_SWEEP_GUARD_MINUTES, DEFAULT_SWEEP_GUARD_MINUTES)
  );
  return date.getUTCHours() % 2 === 0 && date.getUTCMinutes() < guardMinutes;
}

export function storefrontTagMinimumPriority(
  date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  sweepActive = isScheduledStorefrontSweepWindow(date, env)
): number | undefined {
  return sweepActive
    ? readPositiveInteger(env.STOREFRONT_TAG_URGENT_PRIORITY, URGENT_TAG_PRIORITY)
    : undefined;
}

function toEvidenceWrite(
  result: Extract<StorefrontTagFetchResult, { status: 'success' }>
): StorefrontTagEvidenceWrite {
  return {
    appid: result.appid,
    country: result.evidence.country,
    locale: result.evidence.locale,
    observedAt: result.evidence.observedAt,
    pageUrl: result.evidence.pageUrl,
    parserVersion: result.evidence.parserVersion,
    responseHash: result.evidence.responseHash,
    tags: result.evidence.tags,
  };
}

function retryDelaySeconds(
  result: Extract<StorefrontTagFetchResult, { status: 'failed' }>
): number {
  if (result.circuitOpenUntil) {
    return Math.max(60, Math.ceil((Date.parse(result.circuitOpenUntil) - Date.now()) / 1_000));
  }
  return result.errorCode === 'forbidden' || result.errorCode === 'rate_limited' ? 15 * 60 : 5 * 60;
}

export async function processStorefrontTagBatch(
  jobs: CaptureQueueJob[],
  dependencies: StorefrontTagBatchDependencies,
  urgentPriority = URGENT_TAG_PRIORITY
): Promise<StorefrontTagBatchResult> {
  const result: StorefrontTagBatchResult = {
    attempts: 0,
    changed: 0,
    claimed: jobs.length,
    failed: 0,
    succeeded: 0,
  };
  const normalEvidence: StorefrontTagEvidenceWrite[] = [];
  const normalJobIds: string[] = [];

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    const fetched = await dependencies.fetchTags(job.appid);
    result.attempts += fetched.telemetry.attempts;

    if (fetched.status === 'success') {
      const evidence = toEvidenceWrite(fetched);
      if (job.priority >= urgentPriority) {
        result.changed += await dependencies.upsertEvidence([evidence]);
        await dependencies.complete([job.id], 'completed');
      } else {
        normalEvidence.push(evidence);
        normalJobIds.push(job.id);
      }
      result.succeeded += 1;
      continue;
    }

    result.failed += 1;
    const message = `${fetched.errorCode}: ${fetched.errorMessage}`;
    if (fetched.retryable && job.attempts < 5) {
      await dependencies.defer([job.id], retryDelaySeconds(fetched), message);
    } else {
      await dependencies.complete([job.id], 'dead_letter', message);
    }

    if (fetched.circuitOpenUntil || fetched.errorCode === 'parse_error') {
      const unprocessed = jobs.slice(index + 1).map((queued) => queued.id);
      if (unprocessed.length > 0) {
        await dependencies.defer(
          unprocessed,
          retryDelaySeconds(fetched),
          'storefront_tag_circuit_open'
        );
      }
      break;
    }
  }

  if (normalEvidence.length > 0) {
    try {
      result.changed += await dependencies.upsertEvidence(normalEvidence);
      await dependencies.complete(normalJobIds, 'completed');
    } catch (error) {
      await dependencies.defer(
        normalJobIds,
        5 * 60,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  return result;
}
