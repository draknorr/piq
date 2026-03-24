import type { TypedSupabaseClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { hashNormalizedContent } from './hashing.js';
import type {
  AppCaptureSource,
  AppChangeEventDraft,
  CaptureQueueJob,
  NormalizedMediaVersion,
  NormalizedNewsVersion,
  NormalizedStorefrontSnapshot,
  VersionWriteResult,
} from './types.js';

const log = logger.child({ component: 'change-intel-repository' });
const DEFAULT_SUPABASE_RETRY_ATTEMPTS = 3;
const DEFAULT_SUPABASE_RETRY_DELAY_MS = 250;

interface SupabaseLikeError {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

interface SupabaseOperationResult<T> {
  data: T;
  error: SupabaseLikeError | null;
}

function getDb(supabase: TypedSupabaseClient): any {
  return supabase as any;
}

function castRecord<T>(value: Record<string, unknown>): T {
  return value as unknown as T;
}

function castRecords<T>(value: Array<Record<string, unknown>>): T {
  return value as unknown as T;
}

function getSupabaseRetryAttempts(): number {
  return Math.max(1, parseInt(process.env.CHANGE_INTEL_SUPABASE_RETRY_ATTEMPTS || `${DEFAULT_SUPABASE_RETRY_ATTEMPTS}`, 10));
}

function getSupabaseRetryDelayMs(): number {
  return Math.max(25, parseInt(process.env.CHANGE_INTEL_SUPABASE_RETRY_DELAY_MS || `${DEFAULT_SUPABASE_RETRY_DELAY_MS}`, 10));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSupabaseError(error: SupabaseLikeError | null | undefined): string {
  if (!error) {
    return 'Unknown Supabase error';
  }

  return [error.message, error.details, error.hint].filter(Boolean).join(' | ');
}

function isTransientSupabaseError(error: SupabaseLikeError | null | undefined): boolean {
  const message = formatSupabaseError(error);
  return [
    /502/i,
    /503/i,
    /504/i,
    /bad gateway/i,
    /statement timeout/i,
    /timed out/i,
    /connection reset/i,
    /fetch failed/i,
    /temporar/i,
  ].some((pattern) => pattern.test(message));
}

async function runSupabaseOperation<T>(
  operation: string,
  fn: () => Promise<SupabaseOperationResult<T>>
): Promise<SupabaseOperationResult<T>> {
  const maxAttempts = getSupabaseRetryAttempts();
  const baseDelayMs = getSupabaseRetryDelayMs();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await fn();
    if (!result.error) {
      return result;
    }

    if (!isTransientSupabaseError(result.error) || attempt === maxAttempts - 1) {
      return result;
    }

    const delayMs = baseDelayMs * 2 ** attempt;
    log.warn('Retrying transient Supabase operation', {
      operation,
      attempt: attempt + 1,
      maxAttempts,
      delayMs,
      error: formatSupabaseError(result.error),
    });
    await sleep(delayMs);
  }

  return fn();
}

interface SnapshotRow {
  id: number;
  content_hash: string;
  snapshot_data: Record<string, unknown>;
}

interface MediaVersionRow {
  id: number;
  content_hash: string;
  hero_assets: Record<string, unknown>;
  screenshots: Array<Record<string, unknown>>;
  trailers: Array<Record<string, unknown>>;
}

interface NewsVersionRow {
  id: number;
  content_hash: string;
  normalized_payload: Record<string, unknown>;
}

async function touchRow(
  supabase: TypedSupabaseClient,
  tableName: string,
  id: number,
  values: Record<string, unknown>
): Promise<void> {
  const { error } = await getDb(supabase).from(tableName).update(values).eq('id', id);
  if (error) {
    throw new Error(`Failed to update ${tableName}: ${error.message}`);
  }
}

export async function getLatestStorefrontSnapshotRow(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<SnapshotRow | null> {
  const { data, error } = await getDb(supabase)
    .from('app_source_snapshots')
    .select('id, content_hash, snapshot_data')
    .eq('appid', appid)
    .eq('source', 'storefront')
    .order('first_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest storefront snapshot: ${error.message}`);
  }

  return data ?? null;
}

export async function getLatestPicsSnapshotRow(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<SnapshotRow | null> {
  const { data, error } = await getDb(supabase)
    .from('app_source_snapshots')
    .select('id, content_hash, snapshot_data')
    .eq('appid', appid)
    .eq('source', 'pics')
    .order('first_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest PICS snapshot: ${error.message}`);
  }

  return data ?? null;
}

export async function getLatestMediaVersionRow(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<MediaVersionRow | null> {
  const { data, error } = await getDb(supabase)
    .from('app_media_versions')
    .select('id, content_hash, hero_assets, screenshots, trailers')
    .eq('appid', appid)
    .order('first_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest media version: ${error.message}`);
  }

  return data ?? null;
}

export async function getLatestNewsVersionRow(
  supabase: TypedSupabaseClient,
  gid: string
): Promise<NewsVersionRow | null> {
  const { data, error } = await getDb(supabase)
    .from('steam_news_versions')
    .select('id, content_hash, normalized_payload')
    .eq('gid', gid)
    .order('first_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest news version: ${error.message}`);
  }

  return data ?? null;
}

export async function writeStorefrontSnapshot(
  supabase: TypedSupabaseClient,
  appid: number,
  snapshot: NormalizedStorefrontSnapshot,
  triggerReason: string,
  triggerCursor: string | null,
  observedAt = new Date().toISOString()
): Promise<VersionWriteResult> {
  const previousSnapshot = await getLatestStorefrontSnapshotRow(supabase, appid);
  const contentHash = hashNormalizedContent(snapshot);

  if (previousSnapshot && previousSnapshot.content_hash === contentHash) {
    await touchRow(supabase, 'app_source_snapshots', previousSnapshot.id, {
      last_seen_at: observedAt,
      observed_at: observedAt,
    });

    return {
      inserted: false,
      currentId: String(previousSnapshot.id),
      previousId: String(previousSnapshot.id),
      currentHash: contentHash,
    };
  }

  const { data, error } = await getDb(supabase)
    .from('app_source_snapshots')
    .insert({
      appid,
      source: 'storefront',
      observed_at: observedAt,
      first_seen_at: observedAt,
      last_seen_at: observedAt,
      content_hash: contentHash,
      previous_snapshot_id: previousSnapshot?.id ?? null,
      trigger_reason: triggerReason,
      trigger_cursor: triggerCursor,
      snapshot_data: snapshot,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to insert storefront snapshot: ${error.message}`);
  }

  return {
    inserted: true,
    currentId: String(data.id),
    previousId: previousSnapshot ? String(previousSnapshot.id) : null,
    currentHash: contentHash,
  };
}

export async function writeMediaVersion(
  supabase: TypedSupabaseClient,
  appid: number,
  storefrontSnapshotId: string,
  mediaVersion: NormalizedMediaVersion,
  observedAt = new Date().toISOString()
): Promise<VersionWriteResult> {
  const previousVersion = await getLatestMediaVersionRow(supabase, appid);
  const contentHash = hashNormalizedContent(mediaVersion);

  if (previousVersion && previousVersion.content_hash === contentHash) {
    await touchRow(supabase, 'app_media_versions', previousVersion.id, {
      last_seen_at: observedAt,
    });

    return {
      inserted: false,
      currentId: String(previousVersion.id),
      previousId: String(previousVersion.id),
      currentHash: contentHash,
    };
  }

  const { data, error } = await getDb(supabase)
    .from('app_media_versions')
    .insert({
      appid,
      storefront_snapshot_id: Number(storefrontSnapshotId),
      content_hash: contentHash,
      hero_assets: mediaVersion.heroImages,
      screenshots: mediaVersion.screenshots,
      trailers: mediaVersion.movies,
      previous_version_id: previousVersion?.id ?? null,
      first_seen_at: observedAt,
      last_seen_at: observedAt,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to insert media version: ${error.message}`);
  }

  return {
    inserted: true,
    currentId: String(data.id),
    previousId: previousVersion ? String(previousVersion.id) : null,
    currentHash: contentHash,
  };
}

export async function upsertNewsItem(
  supabase: TypedSupabaseClient,
  appid: number,
  newsVersion: NormalizedNewsVersion
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getDb(supabase)
    .from('steam_news_items')
    .upsert(
      {
        gid: newsVersion.gid,
        appid,
        url: newsVersion.url,
        author: newsVersion.author,
        feedlabel: newsVersion.feedlabel,
        feedname: newsVersion.feedname,
        published_at: newsVersion.publishedAt,
        first_seen_at: now,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'gid' }
    );

  if (error) {
    throw new Error(`Failed to upsert steam_news_items: ${error.message}`);
  }
}

export async function writeNewsVersion(
  supabase: TypedSupabaseClient,
  newsVersion: NormalizedNewsVersion,
  observedAt = new Date().toISOString()
): Promise<VersionWriteResult> {
  const previousVersion = await getLatestNewsVersionRow(supabase, newsVersion.gid);
  const contentHash = hashNormalizedContent(newsVersion);

  if (previousVersion && previousVersion.content_hash === contentHash) {
    await touchRow(supabase, 'steam_news_versions', previousVersion.id, {
      last_seen_at: observedAt,
    });

    return {
      inserted: false,
      currentId: String(previousVersion.id),
      previousId: String(previousVersion.id),
      currentHash: contentHash,
    };
  }

  const { data, error } = await getDb(supabase)
    .from('steam_news_versions')
    .insert({
      gid: newsVersion.gid,
      content_hash: contentHash,
      title: newsVersion.title,
      contents: newsVersion.contents,
      url: newsVersion.url,
      previous_version_id: previousVersion?.id ?? null,
      normalized_payload: newsVersion,
      first_seen_at: observedAt,
      last_seen_at: observedAt,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to insert steam_news_versions: ${error.message}`);
  }

  return {
    inserted: true,
    currentId: String(data.id),
    previousId: previousVersion ? String(previousVersion.id) : null,
    currentHash: contentHash,
  };
}

export async function insertChangeEvents(
  supabase: TypedSupabaseClient,
  appid: number,
  events: AppChangeEventDraft[],
  options: {
    sourceSnapshotId?: string | null;
    relatedSnapshotId?: string | null;
    mediaVersionId?: string | null;
    newsItemGid?: string | null;
    triggerCursor?: string | null;
  } = {}
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const rows = events.map((event) => ({
    appid,
    source: event.source,
    change_type: event.eventType,
    occurred_at: event.observedAt ?? new Date().toISOString(),
    source_snapshot_id: options.sourceSnapshotId ? Number(options.sourceSnapshotId) : null,
    related_snapshot_id: options.relatedSnapshotId ? Number(options.relatedSnapshotId) : null,
    media_version_id: options.mediaVersionId ? Number(options.mediaVersionId) : null,
    news_item_gid: options.newsItemGid ?? null,
    before_value: event.beforeValue ?? null,
    after_value: event.afterValue ?? null,
    context: event.context ?? {},
    trigger_cursor: options.triggerCursor ?? null,
  }));

  const { error } = await getDb(supabase).from('app_change_events').insert(rows);
  if (error) {
    throw new Error(`Failed to insert app_change_events: ${error.message}`);
  }
}

export async function enqueueCaptureJobs(
  supabase: TypedSupabaseClient,
  jobs: Array<{
    appid: number;
    source: AppCaptureSource;
    triggerReason: string;
    triggerCursor: string | null;
    priority?: number;
    payload?: Record<string, unknown>;
  }>
): Promise<number> {
  if (jobs.length === 0) {
    return 0;
  }

  const availableAt = new Date().toISOString();
  const { data, error } = await getDb(supabase).rpc('enqueue_app_capture_queue', {
    p_jobs: jobs.map((job) => ({
      appid: job.appid,
      source: job.source,
      priority: job.priority ?? 100,
      trigger_reason: job.triggerReason,
      trigger_cursor: job.triggerCursor ?? '',
      payload: job.payload ?? {},
      available_at: availableAt,
    })),
  });

  if (error) {
    throw new Error(`Failed to enqueue app capture jobs: ${error.message}`);
  }

  return Number(data ?? 0);
}

export async function refreshChangeActivityBurstsForApp(
  supabase: TypedSupabaseClient,
  appid: number,
  lookbackDays = 180
): Promise<number> {
  const { data, error } = await runSupabaseOperation<number | null>(
    'refresh_change_activity_bursts_for_app',
    () =>
      getDb(supabase).rpc('refresh_change_activity_bursts_for_app', {
        p_appid: appid,
        p_lookback_days: lookbackDays,
      })
  );

  if (error) {
    throw new Error(`Failed to refresh change_activity_bursts: ${error.message}`);
  }

  return Number(data ?? 0);
}

export async function refreshChangePatternActivityDaysForApp(
  supabase: TypedSupabaseClient,
  appid: number,
  lookbackDays = 180
): Promise<number> {
  const { data, error } = await runSupabaseOperation<number | null>(
    'refresh_change_pattern_activity_days_for_app',
    () =>
      getDb(supabase).rpc('refresh_change_pattern_activity_days_for_app', {
        p_appid: appid,
        p_lookback_days: lookbackDays,
      })
  );

  if (error) {
    throw new Error(`Failed to refresh change_pattern_activity_days: ${error.message}`);
  }

  return Number(data ?? 0);
}

export async function listRecentChangeActivityAppIds(
  supabase: TypedSupabaseClient,
  lookbackDays = 180,
  afterAppid = 0,
  limit = 1000
): Promise<number[]> {
  const { data, error } = await runSupabaseOperation<Array<{ appid: number }> | null>(
    'list_recent_change_activity_appids',
    () =>
      getDb(supabase).rpc('list_recent_change_activity_appids', {
        p_lookback_days: lookbackDays,
        p_after_appid: afterAppid,
        p_limit: limit,
      })
  );

  if (error) {
    throw new Error(`Failed to list recent change activity appids: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => Number(row.appid))
    .filter((appid) => Number.isInteger(appid) && appid > 0);
}

export async function claimCaptureQueue(
  supabase: TypedSupabaseClient,
  sources: AppCaptureSource[],
  limit: number,
  workerId: string
): Promise<CaptureQueueJob[]> {
  const { data, error } = await runSupabaseOperation<Array<Record<string, unknown>> | null>(
    'claim_app_capture_queue',
    () =>
      getDb(supabase).rpc('claim_app_capture_queue', {
        p_sources: sources,
        p_worker_id: workerId,
        p_limit: limit,
      })
  );

  if (error) {
    throw new Error(`Failed to claim app capture queue: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    appid: Number(row.appid),
    source: String(row.source) as AppCaptureSource,
    triggerReason: String(row.trigger_reason),
    triggerCursor: String(row.trigger_cursor ?? ''),
    attempts: Number(row.attempts ?? 0),
  }));
}

export async function completeCaptureQueueItems(
  supabase: TypedSupabaseClient,
  jobIds: string[],
  status: 'completed' | 'failed' | 'queued' | 'dead_letter',
  errorMessage?: string
): Promise<void> {
  if (jobIds.length === 0) {
    return;
  }

  const { error } = await runSupabaseOperation('complete_app_capture_queue', () =>
    getDb(supabase).rpc('complete_app_capture_queue', {
      p_ids: jobIds.map(Number),
      p_status: status,
      p_error: errorMessage ?? null,
    })
  );

  if (error) {
    throw new Error(`Failed to complete app capture queue jobs: ${error.message}`);
  }
}

export async function requeueStaleCaptureClaims(
  supabase: TypedSupabaseClient,
  sources: AppCaptureSource[],
  claimedBeforeIso: string,
  limit = 500
): Promise<number> {
  if (sources.length === 0) {
    return 0;
  }

  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const { data, error } = await runSupabaseOperation<Array<{ id: number }> | null>(
    'select_stale_app_capture_claims',
    () =>
      getDb(supabase)
        .from('app_capture_queue')
        .select('id')
        .eq('status', 'claimed')
        .in('source', sources)
        .lt('claimed_at', claimedBeforeIso)
        .order('claimed_at', { ascending: true })
        .limit(boundedLimit)
  );

  if (error) {
    throw new Error(`Failed to fetch stale app capture queue claims: ${error.message}`);
  }

  const staleIds = (data ?? []).map((row: { id: number }) => String(row.id));
  if (staleIds.length === 0) {
    return 0;
  }

  await completeCaptureQueueItems(supabase, staleIds, 'queued', 'stale_claim_requeued');
  return staleIds.length;
}

export async function updateSyncStatusFields(
  supabase: TypedSupabaseClient,
  appid: number,
  values: Record<string, unknown>
): Promise<void> {
  const { error } = await runSupabaseOperation('upsert_sync_status', () =>
    getDb(supabase)
      .from('sync_status')
      .upsert(
        {
          appid,
          ...values,
        },
        { onConflict: 'appid' }
      )
  );

  if (error) {
    throw new Error(`Failed to update sync_status: ${error.message}`);
  }
}

export async function getLastNewsSyncAt(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<string | null> {
  const { data, error } = await runSupabaseOperation<{ last_news_sync: string | null } | null>(
    'select_last_news_sync',
    () =>
      getDb(supabase)
        .from('sync_status')
        .select('last_news_sync')
        .eq('appid', appid)
        .maybeSingle()
  );

  if (error) {
    throw new Error(`Failed to fetch last_news_sync: ${error.message}`);
  }

  return data?.last_news_sync ?? null;
}

export async function createSyncJobRecord(
  supabase: TypedSupabaseClient,
  jobType: string,
  batchSize: number
): Promise<string | null> {
  const { data, error } = await runSupabaseOperation<{ id: string | number } | null>(
    'insert_sync_job',
    () =>
      getDb(supabase)
        .from('sync_jobs')
        .insert({
          job_type: jobType,
          status: 'running',
          batch_size: batchSize,
        })
        .select('id')
        .maybeSingle()
  );

  if (error) {
    throw new Error(`Failed to create sync job: ${error.message}`);
  }

  return data?.id ? String(data.id) : null;
}

export async function updateSyncJobRecord(
  supabase: TypedSupabaseClient,
  id: string,
  values: Record<string, unknown>
): Promise<void> {
  const { error } = await runSupabaseOperation('update_sync_job', () =>
    getDb(supabase)
      .from('sync_jobs')
      .update(values)
      .eq('id', id)
  );

  if (error) {
    throw new Error(`Failed to update sync job ${id}: ${error.message}`);
  }
}

export async function abandonStaleChangeIntelSyncJobs(
  supabase: TypedSupabaseClient,
  jobTypes: string[],
  startedBeforeIso: string,
  errorMessage = 'worker_abandoned'
): Promise<number> {
  if (jobTypes.length === 0) {
    return 0;
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await runSupabaseOperation<Array<{ id: string | number }> | null>(
    'abandon_stale_change_intel_sync_jobs',
    () =>
      getDb(supabase)
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: completedAt,
          error_message: errorMessage,
        })
        .in('job_type', jobTypes)
        .eq('status', 'running')
        .lt('started_at', startedBeforeIso)
        .select('id')
  );

  if (error) {
    throw new Error(`Failed to abandon stale sync jobs: ${error.message}`);
  }

  return data?.length ?? 0;
}

export async function getLatestMediaVersion(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<NormalizedMediaVersion | null> {
  const row = await getLatestMediaVersionRow(supabase, appid);
  if (!row) {
    return null;
  }

  return {
    heroImages: castRecord<NormalizedMediaVersion['heroImages']>(row.hero_assets),
    screenshots: castRecords<NormalizedMediaVersion['screenshots']>(row.screenshots),
    movies: castRecords<NormalizedMediaVersion['movies']>(row.trailers),
  };
}

export async function getLatestStorefrontSnapshot(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<NormalizedStorefrontSnapshot | null> {
  const row = await getLatestStorefrontSnapshotRow(supabase, appid);
  return row ? castRecord<NormalizedStorefrontSnapshot>(row.snapshot_data) : null;
}

export async function getLatestNewsVersion(
  supabase: TypedSupabaseClient,
  gid: string
): Promise<NormalizedNewsVersion | null> {
  const row = await getLatestNewsVersionRow(supabase, gid);
  return row ? castRecord<NormalizedNewsVersion>(row.normalized_payload) : null;
}

export async function getArchiveEligibility(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<boolean> {
  const db = getDb(supabase);
  const [{ data: appRow, error: appError }, { data: syncRow, error: syncError }] = await Promise.all([
    db.from('apps').select('release_date, is_released').eq('appid', appid).maybeSingle(),
    db.from('sync_status').select('refresh_tier').eq('appid', appid).maybeSingle(),
  ]);

  if (appError || syncError) {
    log.warn('Failed to fetch archive eligibility', {
      appid,
      appError: appError?.message,
      syncError: syncError?.message,
    });
    return false;
  }

  const refreshTier = syncRow?.refresh_tier ?? null;
  const releaseDate = appRow?.release_date ? new Date(appRow.release_date) : null;
  const releasedRecently = releaseDate ? releaseDate.getTime() >= Date.now() - 365 * 24 * 60 * 60 * 1000 : false;

  return refreshTier === 'active' || refreshTier === 'moderate' || releasedRecently || appRow?.is_released === false;
}
