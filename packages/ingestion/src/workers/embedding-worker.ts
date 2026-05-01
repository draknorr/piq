/**
 * Embedding Sync Worker
 *
 * Generates embeddings for games, publishers, and developers
 * and syncs to Qdrant Cloud vector database.
 *
 * Run with: pnpm --filter @publisheriq/ingestion embedding-sync
 */

import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type SyncJobUpdate,
  type TigerWriter,
} from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import {
  getQdrantClient,
  initializeCollections,
  getCollectionStats,
  COLLECTIONS,
  type GamePayload,
  type PriceTier,
  type Platform,
  type SteamDeckCategory,
  type OwnersTier,
  type CcuTier,
  type PlaytimeTier,
  type VelocityTier,
  type TrendDirection,
} from '@publisheriq/qdrant';
import {
  buildGameEmbeddingText,
  buildPublisherPortfolioText,
  buildPublisherIdentityText,
  buildDeveloperPortfolioText,
  buildDeveloperIdentityText,
  hashEmbeddingText,
  isWorthEmbedding,
  generateEmbeddings,
  type GameEmbeddingData,
  type PublisherEmbeddingData,
  type DeveloperEmbeddingData,
} from '../apis/embedding.js';

const log = logger.child({ worker: 'embedding-sync' });

// Retry configuration
const QDRANT_MAX_RETRIES = 3;
const QDRANT_RETRY_BASE_MS = 2000; // Start with 2s, then 4s, 8s

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for Qdrant operations
 * Handles transient errors like 502 Bad Gateway
 */
async function withQdrantRetry<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= QDRANT_MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const message = lastError.message.toLowerCase();

      // Check if retryable (502, 503, 504, timeout, connection errors)
      const isRetryable =
        message.includes('bad gateway') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('socket hang up');

      if (attempt < QDRANT_MAX_RETRIES && isRetryable) {
        const backoffMs = QDRANT_RETRY_BASE_MS * Math.pow(2, attempt);
        log.warn(`Qdrant ${context} failed (attempt ${attempt + 1}/${QDRANT_MAX_RETRIES + 1}), retrying in ${backoffMs}ms`, {
          error: lastError.message,
        });
        await sleep(backoffMs);
      } else {
        throw lastError;
      }
    }
  }

  throw lastError;
}

// Configuration - optimized batch sizes for throughput
const GAME_BATCH_SIZE = 500; // Games to fetch from DB at a time (was 100)
const QDRANT_BATCH_SIZE = 500; // Points to upsert at a time (was 100)
const PUBLISHER_BATCH_SIZE = 200; // Publishers - smaller to avoid RPC timeout
const DEVELOPER_BATCH_SIZE = 100; // Developers - smaller due to complex RPC query
const PROGRESS_LOG_INTERVAL_MS = 30000; // Log progress every 30 seconds

interface SyncStats {
  gamesProcessed: number;
  gamesEmbedded: number;
  gamesSkipped: number;
  gamesFailed: number;
  publishersEmbedded: number;
  developersEmbedded: number;
  tokensUsed: number;
}

type SupabaseClient = ReturnType<typeof getServiceClient>;
type EmbeddingDbClient = SupabaseClient | null;
type QdrantClient = ReturnType<typeof getQdrantClient>;

async function updateSyncJob(
  jobId: string | null,
  supabase: EmbeddingDbClient,
  tiger: TigerWriter | null,
  values: SyncJobUpdate
): Promise<void> {
  if (!jobId) {
    return;
  }

  if (tiger) {
    await tiger.ops.updateSyncJob(jobId, values);
    return;
  }

  if (!supabase) {
    throw new Error('Supabase client is required for legacy embedding sync job updates');
  }

  await supabase.from('sync_jobs').update(values).eq('id', jobId);
}

/**
 * Calculate price tier from cents
 */
function getPriceTier(priceCents: number | null, isFree: boolean): PriceTier {
  if (isFree || priceCents === 0) return 'free';
  if (priceCents === null) return 'under_20'; // Default
  if (priceCents < 1000) return 'under_10';
  if (priceCents < 2000) return 'under_20';
  if (priceCents < 4000) return 'under_40';
  return 'premium';
}

/**
 * Calculate owners tier from owners_min
 */
function getOwnersTier(ownersMin: number | null): OwnersTier | null {
  if (ownersMin === null) return null;
  if (ownersMin >= 1_000_000) return 'over_1m';
  if (ownersMin >= 100_000) return '100k_1m';
  if (ownersMin >= 10_000) return '10k_100k';
  return 'under_10k';
}

/**
 * Calculate CCU tier from ccu_peak
 */
function getCcuTier(ccuPeak: number | null): CcuTier | null {
  if (ccuPeak === null) return null;
  if (ccuPeak >= 10_000) return 'over_10k';
  if (ccuPeak >= 1_000) return '1k_10k';
  if (ccuPeak >= 100) return '100_1k';
  return 'under_100';
}

/**
 * Calculate playtime tier from average_playtime_forever (in minutes)
 */
function getPlaytimeTier(minutes: number | null): PlaytimeTier | null {
  if (minutes === null) return null;
  if (minutes < 300) return 'short'; // < 5 hours
  if (minutes < 1200) return 'medium'; // 5-20 hours
  if (minutes < 6000) return 'long'; // 20-100 hours
  return 'endless'; // 100+ hours
}

/**
 * Parse velocity tier from string
 */
function parseVelocityTier(tier: string | null): VelocityTier | null {
  if (!tier) return null;
  const validTiers: VelocityTier[] = ['high', 'medium', 'low', 'dormant'];
  return validTiers.includes(tier as VelocityTier) ? (tier as VelocityTier) : null;
}

/**
 * Parse trend direction from string
 */
function parseTrendDirection(direction: string | null): TrendDirection | null {
  if (!direction) return null;
  const validDirections: TrendDirection[] = ['up', 'stable', 'down'];
  return validDirections.includes(direction as TrendDirection) ? (direction as TrendDirection) : null;
}

/**
 * Parse platforms string to array
 */
function parsePlatforms(platforms: string | null): Platform[] {
  if (!platforms) return [];
  return platforms
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is Platform => ['windows', 'macos', 'linux'].includes(p));
}

/**
 * Build game payload for Qdrant
 * Now includes all tier fields and new metadata
 */
function buildGamePayload(game: GameEmbeddingData, embeddingHash: string): GamePayload {
  return {
    appid: game.appid,
    name: game.name,
    type: game.type as GamePayload['type'],
    genres: game.genres,
    tags: game.tags.slice(0, 15),
    categories: game.categories,
    platforms: parsePlatforms(game.platforms),
    steam_deck: (game.steam_deck_category as SteamDeckCategory) || 'unknown',
    controller_support: game.controller_support,
    is_free: game.is_free,
    price_tier: getPriceTier(game.current_price_cents, game.is_free),
    price_cents: game.current_price_cents,
    review_score: game.pics_review_score,
    review_percentage: game.pics_review_percentage,
    total_reviews: game.total_reviews,
    // Popularity tiers (now populated)
    owners_tier: getOwnersTier(game.owners_min),
    ccu_tier: getCcuTier(game.ccu_peak),
    // Activity & Engagement tiers (NEW)
    playtime_tier: getPlaytimeTier(game.average_playtime_forever),
    velocity_tier: parseVelocityTier(game.velocity_tier),
    trend_direction: parseTrendDirection(game.trend_30d_direction),
    // External ratings (NEW)
    metacritic_score: game.metacritic_score,
    // Localization (NEW)
    language_count: game.language_count,
    // Franchise names for display (NEW)
    franchise_names: game.franchise_names || [],
    // Dates
    release_year: game.release_date ? new Date(game.release_date).getFullYear() : null,
    // Relationships
    developer_ids: game.developer_ids,
    publisher_ids: game.publisher_ids,
    franchise_ids: game.franchise_ids,
    // Status
    is_released: game.is_released,
    is_delisted: game.is_delisted,
    // Sync tracking
    embedding_hash: embeddingHash,
    updated_at: Date.now(),
  };
}

/**
 * Process a batch of games
 */
async function processGameBatch(
  supabase: EmbeddingDbClient,
  tiger: TigerWriter | null,
  qdrant: QdrantClient,
  games: GameEmbeddingData[],
  stats: SyncStats
): Promise<void> {
  // Filter to games worth embedding
  const worthyGames = games.filter(isWorthEmbedding);
  stats.gamesSkipped += games.length - worthyGames.length;

  if (worthyGames.length === 0) {
    return;
  }

  // Build embedding texts
  const texts = worthyGames.map(buildGameEmbeddingText);
  const hashes = texts.map(hashEmbeddingText);

  // Generate embeddings
  const { embeddings, usage } = await generateEmbeddings(texts);
  stats.tokensUsed += usage.total_tokens;

  // Build Qdrant points (cast payload to satisfy Qdrant client types)
  const points = worthyGames.map((game, i) => ({
    id: game.appid,
    vector: embeddings[i],
    payload: buildGamePayload(game, hashes[i]) as unknown as Record<string, unknown>,
  }));

  // Upsert to Qdrant in batches with retry
  for (let i = 0; i < points.length; i += QDRANT_BATCH_SIZE) {
    const batch = points.slice(i, i + QDRANT_BATCH_SIZE);
    await withQdrantRetry(
      () => qdrant.upsert(COLLECTIONS.GAMES, {
        wait: false, // Async writes for throughput (verification at end)
        points: batch,
      }),
      'games upsert'
    );
  }

  // Mark as embedded in Supabase
  const appids = worthyGames.map((g) => g.appid);
  if (tiger) {
    await tiger.embeddings.markGamesEmbedded(appids, hashes, new Date().toISOString());
  } else if (supabase) {
    await supabase.rpc('mark_apps_embedded', {
      p_appids: appids,
      p_hashes: hashes,
    });
  } else {
    throw new Error('No database client available for embedding status updates');
  }

  stats.gamesEmbedded += worthyGames.length;
  stats.gamesProcessed += games.length;
}

/**
 * Process a batch of publishers
 */
async function processPublisherBatch(
  publishers: PublisherEmbeddingData[],
  qdrant: QdrantClient,
  stats: SyncStats
): Promise<void> {
  // Build portfolio texts
  const portfolioTexts = publishers.map(buildPublisherPortfolioText);
  const portfolioHashes = portfolioTexts.map(hashEmbeddingText);

  // Build identity texts
  const identityTexts = publishers.map(buildPublisherIdentityText);
  const identityHashes = identityTexts.map(hashEmbeddingText);

  // Generate all embeddings
  const { embeddings: portfolioEmbeddings, usage: portfolioUsage } =
    await generateEmbeddings(portfolioTexts);
  stats.tokensUsed += portfolioUsage.total_tokens;

  const { embeddings: identityEmbeddings, usage: identityUsage } =
    await generateEmbeddings(identityTexts);
  stats.tokensUsed += identityUsage.total_tokens;

  // Build payloads and upsert portfolio collection (cast payload to satisfy Qdrant client types)
  const portfolioPoints = publishers.map((pub: PublisherEmbeddingData, i: number) => ({
    id: pub.id,
    vector: portfolioEmbeddings[i],
    payload: {
      id: pub.id,
      name: pub.name,
      game_count: pub.game_count,
      first_release_year: pub.first_game_release_date
        ? new Date(pub.first_game_release_date).getFullYear()
        : null,
      top_genres: pub.top_genres,
      top_tags: pub.top_tags,
      platforms_supported: pub.platforms_supported as Platform[],
      total_owners_tier: null,
      avg_review_percentage: pub.avg_review_percentage ? Math.round(pub.avg_review_percentage) : null,
      total_reviews: pub.total_reviews,
      is_major: pub.game_count >= 10,
      embedding_hash: portfolioHashes[i],
      updated_at: Date.now(),
    } as unknown as Record<string, unknown>,
  }));

  for (let i = 0; i < portfolioPoints.length; i += QDRANT_BATCH_SIZE) {
    const batch = portfolioPoints.slice(i, i + QDRANT_BATCH_SIZE);
    await withQdrantRetry(
      () => qdrant.upsert(COLLECTIONS.PUBLISHERS_PORTFOLIO, {
        wait: false, // Async writes for throughput (verification at end)
        points: batch,
      }),
      'publishers portfolio upsert'
    );
  }

  // Upsert identity collection (cast payload to satisfy Qdrant client types)
  const identityPoints = publishers.map((pub: PublisherEmbeddingData, i: number) => ({
    id: pub.id,
    vector: identityEmbeddings[i],
    payload: {
      id: pub.id,
      name: pub.name,
      game_count: pub.game_count,
      top_game_names: pub.top_game_names.slice(0, 10),
      top_game_appids: pub.top_game_appids.slice(0, 10),
      top_game_genres: pub.top_genres.slice(0, 5),
      flagship_game_appid: pub.top_game_appids[0] || null,
      is_major: pub.game_count >= 10,
      avg_review_percentage: pub.avg_review_percentage ? Math.round(pub.avg_review_percentage) : null,
      embedding_hash: identityHashes[i],
      updated_at: Date.now(),
    } as unknown as Record<string, unknown>,
  }));

  for (let i = 0; i < identityPoints.length; i += QDRANT_BATCH_SIZE) {
    const batch = identityPoints.slice(i, i + QDRANT_BATCH_SIZE);
    await withQdrantRetry(
      () => qdrant.upsert(COLLECTIONS.PUBLISHERS_IDENTITY, {
        wait: false, // Async writes for throughput (verification at end)
        points: batch,
      }),
      'publishers identity upsert'
    );
  }

  stats.publishersEmbedded += publishers.length;
}

/**
 * Process publishers with state-based pagination
 * Loops until no more publishers need embedding
 */
async function processPublishers(
  supabase: EmbeddingDbClient,
  tiger: TigerWriter | null,
  qdrant: QdrantClient,
  stats: SyncStats
): Promise<void> {
  log.info('Processing publishers for embedding');

  let hasMore = true;
  while (hasMore) {
    const publishers = tiger
      ? await tiger.embeddings.listPublishersNeedingEmbedding(PUBLISHER_BATCH_SIZE)
      : null;
    const legacyResult = publishers
      ? null
      : await supabase!.rpc('get_publishers_needing_embedding', {
          p_limit: PUBLISHER_BATCH_SIZE,
        });
    const data = publishers ?? legacyResult?.data ?? null;
    const error = legacyResult?.error ?? null;

    if (error) {
      log.error('Failed to fetch publishers', { error });
      break;
    }

    if (!data || data.length === 0) {
      log.info('No more publishers to embed');
      hasMore = false;
      break;
    }

    log.info('Processing publisher batch', {
      count: data.length,
      totalEmbedded: stats.publishersEmbedded,
    });

    // Process batch and generate embeddings
    await processPublisherBatch(data as PublisherEmbeddingData[], qdrant, stats);

    // Mark as embedded so they don't appear in next call
    const ids = (data as PublisherEmbeddingData[]).map((p) => p.id);
    const hashes = (data as PublisherEmbeddingData[]).map((p) =>
      hashEmbeddingText(buildPublisherPortfolioText(p))
    );
    if (tiger) {
      await tiger.embeddings.markPublishersEmbedded(ids, hashes, new Date().toISOString());
    } else {
      await supabase!.rpc('mark_publishers_embedded', {
        p_ids: ids,
        p_hashes: hashes,
      });
    }

    // Continue if we got a full batch (more might be available)
    hasMore = data.length === PUBLISHER_BATCH_SIZE;
  }

  log.info('Publishers embedding complete', { total: stats.publishersEmbedded });
}

/**
 * Process a batch of developers
 */
async function processDeveloperBatch(
  developers: DeveloperEmbeddingData[],
  qdrant: QdrantClient,
  stats: SyncStats
): Promise<void> {
  // Build portfolio texts
  const portfolioTexts = developers.map(buildDeveloperPortfolioText);
  const portfolioHashes = portfolioTexts.map(hashEmbeddingText);

  // Build identity texts
  const identityTexts = developers.map(buildDeveloperIdentityText);
  const identityHashes = identityTexts.map(hashEmbeddingText);

  // Generate embeddings
  const { embeddings: portfolioEmbeddings, usage: portfolioUsage } =
    await generateEmbeddings(portfolioTexts);
  stats.tokensUsed += portfolioUsage.total_tokens;

  const { embeddings: identityEmbeddings, usage: identityUsage } =
    await generateEmbeddings(identityTexts);
  stats.tokensUsed += identityUsage.total_tokens;

  // Upsert portfolio collection (cast payload to satisfy Qdrant client types)
  const portfolioPoints = developers.map((dev: DeveloperEmbeddingData, i: number) => ({
    id: dev.id,
    vector: portfolioEmbeddings[i],
    payload: {
      id: dev.id,
      name: dev.name,
      game_count: dev.game_count,
      first_release_year: dev.first_game_release_date
        ? new Date(dev.first_game_release_date).getFullYear()
        : null,
      top_genres: dev.top_genres,
      top_tags: dev.top_tags,
      platforms_supported: dev.platforms_supported as Platform[],
      avg_review_percentage: dev.avg_review_percentage ? Math.round(dev.avg_review_percentage) : null,
      total_reviews: dev.total_reviews,
      is_indie: dev.is_indie,
      embedding_hash: portfolioHashes[i],
      updated_at: Date.now(),
    } as unknown as Record<string, unknown>,
  }));

  for (let i = 0; i < portfolioPoints.length; i += QDRANT_BATCH_SIZE) {
    const batch = portfolioPoints.slice(i, i + QDRANT_BATCH_SIZE);
    await withQdrantRetry(
      () => qdrant.upsert(COLLECTIONS.DEVELOPERS_PORTFOLIO, {
        wait: false, // Async writes for throughput (verification at end)
        points: batch,
      }),
      'developers portfolio upsert'
    );
  }

  // Upsert identity collection (cast payload to satisfy Qdrant client types)
  const identityPoints = developers.map((dev: DeveloperEmbeddingData, i: number) => ({
    id: dev.id,
    vector: identityEmbeddings[i],
    payload: {
      id: dev.id,
      name: dev.name,
      game_count: dev.game_count,
      top_game_names: dev.top_game_names.slice(0, 10),
      top_game_appids: dev.top_game_appids.slice(0, 10),
      top_game_genres: dev.top_genres.slice(0, 5),
      flagship_game_appid: dev.top_game_appids[0] || null,
      is_indie: dev.is_indie,
      avg_review_percentage: dev.avg_review_percentage ? Math.round(dev.avg_review_percentage) : null,
      embedding_hash: identityHashes[i],
      updated_at: Date.now(),
    } as unknown as Record<string, unknown>,
  }));

  for (let i = 0; i < identityPoints.length; i += QDRANT_BATCH_SIZE) {
    const batch = identityPoints.slice(i, i + QDRANT_BATCH_SIZE);
    await withQdrantRetry(
      () => qdrant.upsert(COLLECTIONS.DEVELOPERS_IDENTITY, {
        wait: false, // Async writes for throughput (verification at end)
        points: batch,
      }),
      'developers identity upsert'
    );
  }

  stats.developersEmbedded += developers.length;
}

/**
 * Process developers with state-based pagination
 * Loops until no more developers need embedding
 */
async function processDevelopers(
  supabase: EmbeddingDbClient,
  tiger: TigerWriter | null,
  qdrant: QdrantClient,
  stats: SyncStats
): Promise<void> {
  log.info('Processing developers for embedding');

  let hasMore = true;
  while (hasMore) {
    const developers = tiger
      ? await tiger.embeddings.listDevelopersNeedingEmbedding(DEVELOPER_BATCH_SIZE)
      : null;
    const legacyResult = developers
      ? null
      : await supabase!.rpc('get_developers_needing_embedding', {
          p_limit: DEVELOPER_BATCH_SIZE,
        });
    const data = developers ?? legacyResult?.data ?? null;
    const error = legacyResult?.error ?? null;

    if (error) {
      log.error('Failed to fetch developers', { error });
      break;
    }

    if (!data || data.length === 0) {
      log.info('No more developers to embed');
      hasMore = false;
      break;
    }

    log.info('Processing developer batch', {
      count: data.length,
      totalEmbedded: stats.developersEmbedded,
    });

    // Process batch and generate embeddings
    await processDeveloperBatch(data as DeveloperEmbeddingData[], qdrant, stats);

    // Mark as embedded so they don't appear in next call
    const ids = (data as DeveloperEmbeddingData[]).map((d) => d.id);
    const hashes = (data as DeveloperEmbeddingData[]).map((d) =>
      hashEmbeddingText(buildDeveloperPortfolioText(d))
    );
    if (tiger) {
      await tiger.embeddings.markDevelopersEmbedded(ids, hashes, new Date().toISOString());
    } else {
      await supabase!.rpc('mark_developers_embedded', {
        p_ids: ids,
        p_hashes: hashes,
      });
    }

    // Continue if we got a full batch (more might be available)
    hasMore = data.length === DEVELOPER_BATCH_SIZE;
  }

  log.info('Developers embedding complete', { total: stats.developersEmbedded });
}

/**
 * Start progress logging interval
 */
function startProgressLogging(
  stats: SyncStats,
  startTime: number
): NodeJS.Timeout {
  return setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const total = stats.gamesEmbedded + stats.publishersEmbedded + stats.developersEmbedded;
    const rate = total > 0 ? (total / parseFloat(elapsed)).toFixed(0) : '0';
    log.info('Progress update', {
      elapsedMinutes: elapsed,
      gamesEmbedded: stats.gamesEmbedded,
      gamesSkipped: stats.gamesSkipped,
      publishersEmbedded: stats.publishersEmbedded,
      developersEmbedded: stats.developersEmbedded,
      tokensUsed: stats.tokensUsed,
      itemsPerMinute: rate,
    });
  }, PROGRESS_LOG_INTERVAL_MS);
}

/**
 * Verify Qdrant collections have data after sync
 */
async function verifyQdrantCollections(
  qdrant: ReturnType<typeof getQdrantClient>
): Promise<void> {
  log.info('Verifying Qdrant collections...');
  const collectionStats = await getCollectionStats(qdrant);
  log.info('Qdrant collection stats', collectionStats);
}

/**
 * Main worker function
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  const env = process.env;
  const useTiger = readDataWriteTarget(env) === 'tiger';
  const tiger = useTiger ? getTigerWriter(env) : null;
  const githubRunId = env.GITHUB_RUN_ID;
  const batchSize = parseInt(env.BATCH_SIZE || String(GAME_BATCH_SIZE), 10);
  const syncCollection = env.SYNC_COLLECTION || 'all'; // games, publishers, developers, all

  log.info('Starting embedding sync', {
    githubRunId,
    batchSize,
    syncCollection,
    writeTarget: tiger ? 'tiger' : 'supabase',
  });

  const supabase: EmbeddingDbClient = tiger ? null : getServiceClient();
  const qdrant = getQdrantClient();

  // Create sync job record
  const legacyJobResult = tiger
    ? null
    : await supabase!
        .from('sync_jobs')
        .insert({
          job_type: 'embedding',
          github_run_id: githubRunId,
          status: 'running',
        })
        .select()
        .single();
  const jobId = tiger
    ? await tiger.ops.createSyncJob({
        jobType: 'embedding',
        githubRunId,
        batchSize,
      })
    : legacyJobResult?.data?.id ?? null;
  const jobError = legacyJobResult?.error ?? null;

  if (jobError) {
    log.error('Failed to create sync job record', { error: jobError });
  }

  const stats: SyncStats = {
    gamesProcessed: 0,
    gamesEmbedded: 0,
    gamesSkipped: 0,
    gamesFailed: 0,
    publishersEmbedded: 0,
    developersEmbedded: 0,
    tokensUsed: 0,
  };

  // Start progress logging
  const progressInterval = startProgressLogging(stats, startTime);

  try {
    // Initialize Qdrant collections
    log.info('Initializing Qdrant collections');
    await initializeCollections(qdrant);

    // Process games
    if (syncCollection === 'all' || syncCollection === 'games') {
      log.info('Fetching games for embedding');

      // Fetch games in batches
      let hasMore = true;
      while (hasMore) {
        const games = tiger ? await tiger.embeddings.listGameCandidates(batchSize) : null;
        const legacyResult = games
          ? null
          : await supabase!.rpc('get_apps_for_embedding', {
              p_limit: batchSize,
            });
        const data = games ?? legacyResult?.data ?? null;
        const error = legacyResult?.error ?? null;

        if (error) {
          log.error('Failed to fetch games', { error });
          break;
        }

        if (!data || data.length === 0) {
          log.info('No more games to embed');
          hasMore = false;
          break;
        }

        log.info('Processing game batch', {
          count: data.length,
          processed: stats.gamesProcessed,
          embedded: stats.gamesEmbedded,
        });

        await processGameBatch(
          supabase,
          tiger,
          qdrant,
          data as GameEmbeddingData[],
          stats
        );

        // Check if we got a full batch (more might be available)
        hasMore = data.length === batchSize;
      }
    }

    // Process publishers
    if (syncCollection === 'all' || syncCollection === 'publishers') {
      await processPublishers(supabase, tiger, qdrant, stats);
    }

    // Process developers
    if (syncCollection === 'all' || syncCollection === 'developers') {
      await processDevelopers(supabase, tiger, qdrant, stats);
    }

    // Stop progress logging
    clearInterval(progressInterval);

    // Verify Qdrant collections
    await verifyQdrantCollections(qdrant);

    // Update sync job as completed
    await updateSyncJob(jobId, supabase, tiger, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_processed: stats.gamesProcessed + stats.publishersEmbedded + stats.developersEmbedded,
      items_succeeded: stats.gamesEmbedded + stats.publishersEmbedded + stats.developersEmbedded,
      items_failed: stats.gamesFailed,
      items_skipped: stats.gamesSkipped,
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Embedding sync completed', {
      durationMinutes: duration,
      ...stats,
      estimatedCost: `$${((stats.tokensUsed / 1000000) * 0.02).toFixed(4)}`,
    });
  } catch (error) {
    // Stop progress logging on error
    clearInterval(progressInterval);

    log.error('Embedding sync failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Update sync job as failed
    await updateSyncJob(jobId, supabase, tiger, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
      items_processed: stats.gamesProcessed,
      items_succeeded: stats.gamesEmbedded,
      items_failed: stats.gamesFailed,
      items_skipped: stats.gamesSkipped,
    });

    process.exit(1);
  }
}

main();
