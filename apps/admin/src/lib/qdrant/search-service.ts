/**
 * Similarity Search Service
 *
 * Handles semantic similarity searches using Qdrant.
 */

import OpenAI from 'openai';
import {
  getQdrantClient,
  isQdrantConfigured,
  getCollectionName,
  buildGameFilter,
  buildEntityFilter,
  EMBEDDING_CONFIG,
  COLLECTIONS,
  type GameFilters,
  type EntityFilters,
  type GamePayload,
  type EntityType,
  type PopularityComparison,
  type ReviewComparison,
} from '@publisheriq/qdrant';
import { getSupabase } from '@/lib/supabase';

// OpenAI client for concept search embeddings (lazy initialized)
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Generate embedding for a query string
 */
async function generateQueryEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: EMBEDDING_CONFIG.MODEL,
    input: text,
    dimensions: EMBEDDING_CONFIG.DIMENSIONS,
  });
  return response.data[0].embedding;
}

// Maximum results to return
const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 10;
export const QDRANT_SEARCH_TIMEOUT_MS = 10000;
export const QDRANT_TIMEOUT_ERROR = 'Similarity search timed out. Please try again.';

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('timeout') || message.includes('aborted');
}

async function withSearchTimeout<T extends { success: boolean; error?: string }>(
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const operationPromise = operation().catch((error) => {
    console.error(`${label} failed:`, error);

    return {
      success: false,
      error: isTimeoutError(error)
        ? QDRANT_TIMEOUT_ERROR
        : error instanceof Error
          ? error.message
          : 'Unexpected similarity search error.',
    } as T;
  });

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`${label} exceeded ${QDRANT_SEARCH_TIMEOUT_MS}ms`);
      resolve({
        success: false,
        error: QDRANT_TIMEOUT_ERROR,
      } as T);
    }, QDRANT_SEARCH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Arguments for find_similar tool
 */
export interface FindSimilarArgs {
  entity_type: EntityType;
  reference_id?: number;
  reference_name?: string;
  filters?: {
    // Game-specific filters
    popularity_comparison?: PopularityComparison;
    review_comparison?: ReviewComparison;
    max_price_cents?: number;
    is_free?: boolean;
    platforms?: ('windows' | 'macos' | 'linux')[];
    steam_deck?: ('verified' | 'playable')[];
    genres?: string[];
    tags?: string[];
    min_reviews?: number;
    release_year?: { gte?: number; lte?: number };
    // Entity-specific filters (publishers/developers)
    game_count?: { gte?: number; lte?: number };
    avg_review_percentage?: { gte?: number; lte?: number };
    is_major?: boolean;
    is_indie?: boolean;
    top_genres?: string[];
    top_tags?: string[];
  };
  limit?: number;
}

/**
 * Similar entity result with match reasons
 */
export interface SimilarEntity {
  id: number;
  name: string;
  score: number;
  rawScore?: number; // Original vector similarity before boosts
  type?: string;
  genres?: string[];
  tags?: string[];
  review_percentage?: number | null;
  price_cents?: number | null;
  is_free?: boolean;
  // Publisher/Developer fields
  game_count?: number;
  is_major?: boolean;
  // Explainability
  matchReasons?: string[];
}

/**
 * Result from find_similar
 */
export interface FindSimilarResult {
  success: boolean;
  reference?: {
    id: number;
    name: string;
    type: string;
  };
  results?: SimilarEntity[];
  total_found?: number;
  error?: string;
  debug?: {
    searchParams?: Record<string, unknown>;
    vectorFilter?: Record<string, unknown>;
  };
}

/**
 * Look up entity by name
 */
async function lookupEntityByName(
  entityType: EntityType,
  name: string
): Promise<{ id: number; name: string; type?: string; metrics?: object } | null> {
  const supabase = getSupabase();

  if (entityType === 'game') {
    const { data } = await supabase
      .from('apps')
      .select('appid, name, type, pics_review_percentage, current_price_cents, publisher_ids:app_publishers(publisher_id), developer_ids:app_developers(developer_id)')
      .ilike('name', name)
      .eq('type', 'game')
      .limit(1)
      .single();

    if (data) {
      return {
        id: data.appid,
        name: data.name,
        type: data.type ?? undefined,
        metrics: {
          review_percentage: data.pics_review_percentage,
          price_cents: data.current_price_cents,
          publisher_ids: (data.publisher_ids as { publisher_id: number }[])?.map(p => p.publisher_id) || [],
          developer_ids: (data.developer_ids as { developer_id: number }[])?.map(d => d.developer_id) || [],
        },
      };
    }

    // Try partial match
    const { data: partial } = await supabase
      .from('apps')
      .select('appid, name, type, pics_review_percentage, current_price_cents')
      .ilike('name', `%${name}%`)
      .eq('type', 'game')
      .limit(1)
      .single();

    if (partial) {
      return {
        id: partial.appid,
        name: partial.name,
        type: partial.type ?? undefined,
        metrics: {
          review_percentage: partial.pics_review_percentage,
          price_cents: partial.current_price_cents,
        },
      };
    }
  } else if (entityType === 'publisher') {
    const { data } = await supabase
      .from('publishers')
      .select('id, name, game_count')
      .ilike('name', name)
      .limit(1)
      .single();

    if (data) {
      return { id: data.id, name: data.name };
    }

    // Partial match
    const { data: partial } = await supabase
      .from('publishers')
      .select('id, name')
      .ilike('name', `%${name}%`)
      .limit(1)
      .single();

    if (partial) {
      return { id: partial.id, name: partial.name };
    }
  } else if (entityType === 'developer') {
    const { data } = await supabase
      .from('developers')
      .select('id, name, game_count')
      .ilike('name', name)
      .limit(1)
      .single();

    if (data) {
      return { id: data.id, name: data.name };
    }

    // Partial match
    const { data: partial } = await supabase
      .from('developers')
      .select('id, name')
      .ilike('name', `%${name}%`)
      .limit(1)
      .single();

    if (partial) {
      return { id: partial.id, name: partial.name };
    }
  }

  return null;
}

/**
 * Look up entity by ID (exact match)
 */
async function lookupEntityById(
  entityType: EntityType,
  id: number
): Promise<{ id: number; name: string; type?: string; metrics?: object } | null> {
  const supabase = getSupabase();

  if (entityType === 'game') {
    const { data } = await supabase
      .from('apps')
      .select(
        'appid, name, type, pics_review_percentage, current_price_cents, publisher_ids:app_publishers(publisher_id), developer_ids:app_developers(developer_id)'
      )
      .eq('appid', id)
      .eq('type', 'game')
      .single();

    if (data) {
      return {
        id: data.appid,
        name: data.name,
        type: data.type ?? undefined,
        metrics: {
          review_percentage: data.pics_review_percentage,
          price_cents: data.current_price_cents,
          publisher_ids: (data.publisher_ids as { publisher_id: number }[])?.map(p => p.publisher_id) || [],
          developer_ids: (data.developer_ids as { developer_id: number }[])?.map(d => d.developer_id) || [],
        },
      };
    }
  } else if (entityType === 'publisher') {
    const { data } = await supabase
      .from('publishers')
      .select('id, name, game_count')
      .eq('id', id)
      .single();

    if (data) {
      return { id: data.id, name: data.name };
    }
  } else if (entityType === 'developer') {
    const { data } = await supabase
      .from('developers')
      .select('id, name, game_count')
      .eq('id', id)
      .single();

    if (data) {
      return { id: data.id, name: data.name };
    }
  }

  return null;
}

/**
 * Get vector and payload for an entity from Qdrant
 */
async function getEntityVectorAndPayload(
  entityType: EntityType,
  id: number
): Promise<{ vector: number[]; payload: Partial<GamePayload> } | null> {
  const client = getQdrantClient();
  const collection = getCollectionName(entityType);

  try {
    const result = await client.retrieve(collection, {
      ids: [id],
      with_vector: true,
      with_payload: true,
    });

    if (result.length > 0 && result[0].vector) {
      return {
        vector: result[0].vector as number[],
        payload: (result[0].payload || {}) as Partial<GamePayload>,
      };
    }
  } catch {
    // Entity not in Qdrant yet
  }

  return null;
}

/**
 * Score boost configuration for hybrid scoring
 */
const SCORE_BOOSTS = {
  SAME_FRANCHISE: 0.15,    // +15% for same series
  SAME_DEVELOPER: 0.08,    // +8% for same developer
  SAME_PUBLISHER: 0.03,    // +3% for same publisher
  SHARED_GENRE: 0.02,      // +2% per shared genre
  SHARED_TAG: 0.01,        // +1% per shared tag
  MAX_GENRE_BOOSTS: 3,     // Cap genre boosts at 3
  MAX_TAG_BOOSTS: 5,       // Cap tag boosts at 5
  MAX_TOTAL_BOOST: 0.25,   // Cap total boost at 25%
};

/**
 * Source payload fields needed for hybrid scoring
 */
interface SourcePayloadForBoost {
  franchise_ids?: number[];
  developer_ids?: number[];
  publisher_ids?: number[];
  genres?: string[];
  tags?: string[];
  franchise_names?: string[];
}

/**
 * Result payload fields needed for hybrid scoring
 */
interface ResultPayloadForBoost {
  franchise_ids?: number[];
  developer_ids?: number[];
  publisher_ids?: number[];
  genres?: string[];
  tags?: string[];
  franchise_names?: string[];
  name?: string;
  type?: string;
  review_percentage?: number | null;
  price_cents?: number | null;
  is_free?: boolean;
  top_genres?: string[];
  top_tags?: string[];
  game_count?: number;
  is_major?: boolean;
  avg_review_percentage?: number | null;
}

/**
 * Apply hybrid score boosts for shared attributes
 * Returns boosted results sorted by new score with match reasons
 */
function applyScoreBoosts(
  sourcePayload: SourcePayloadForBoost,
  results: Array<{ id: number; score: number; payload: ResultPayloadForBoost }>
): Array<{ id: number; score: number; rawScore: number; payload: ResultPayloadForBoost; matchReasons: string[] }> {
  return results
    .map((result) => {
      let boost = 0;
      const reasons: string[] = [];

      // Franchise boost (+15%)
      if (sourcePayload.franchise_ids?.length && result.payload.franchise_ids?.length) {
        const sharedFranchise = sourcePayload.franchise_ids.find((id) =>
          result.payload.franchise_ids?.includes(id)
        );
        if (sharedFranchise !== undefined) {
          boost += SCORE_BOOSTS.SAME_FRANCHISE;
          // Try to get franchise name for better UX
          const franchiseName = result.payload.franchise_names?.[
            result.payload.franchise_ids?.indexOf(sharedFranchise) ?? 0
          ];
          reasons.push(franchiseName ? `${franchiseName} series` : 'Same series');
        }
      }

      // Developer boost (+8%)
      if (sourcePayload.developer_ids?.length && result.payload.developer_ids?.length) {
        const sharedDev = sourcePayload.developer_ids.some((id) =>
          result.payload.developer_ids?.includes(id)
        );
        if (sharedDev) {
          boost += SCORE_BOOSTS.SAME_DEVELOPER;
          reasons.push('Same developer');
        }
      }

      // Publisher boost (+3%)
      if (sourcePayload.publisher_ids?.length && result.payload.publisher_ids?.length) {
        const sharedPub = sourcePayload.publisher_ids.some((id) =>
          result.payload.publisher_ids?.includes(id)
        );
        if (sharedPub) {
          boost += SCORE_BOOSTS.SAME_PUBLISHER;
          reasons.push('Same publisher');
        }
      }

      // Genre boost (+2% each, max 3)
      const sourceGenres = sourcePayload.genres || [];
      const resultGenres = result.payload.genres || result.payload.top_genres || [];
      if (sourceGenres.length && resultGenres.length) {
        const sharedGenres = sourceGenres.filter((g) =>
          resultGenres.some((rg) => rg.toLowerCase() === g.toLowerCase())
        );
        const genreBoostCount = Math.min(sharedGenres.length, SCORE_BOOSTS.MAX_GENRE_BOOSTS);
        boost += genreBoostCount * SCORE_BOOSTS.SHARED_GENRE;
        // Add top shared genre to reasons
        if (sharedGenres.length > 0) {
          reasons.push(sharedGenres[0]);
        }
      }

      // Tag boost (+1% each, max 5)
      const sourceTags = sourcePayload.tags || [];
      const resultTags = result.payload.tags || result.payload.top_tags || [];
      if (sourceTags.length && resultTags.length) {
        const sharedTags = sourceTags.filter((t) =>
          resultTags.some((rt) => rt.toLowerCase() === t.toLowerCase())
        );
        const tagBoostCount = Math.min(sharedTags.length, SCORE_BOOSTS.MAX_TAG_BOOSTS);
        boost += tagBoostCount * SCORE_BOOSTS.SHARED_TAG;
        // Add top shared tag to reasons (if not already covered by genre)
        if (sharedTags.length > 0 && !reasons.includes(sharedTags[0])) {
          reasons.push(sharedTags[0]);
        }
      }

      // Cap total boost
      boost = Math.min(boost, SCORE_BOOSTS.MAX_TOTAL_BOOST);

      return {
        id: result.id,
        score: Math.min(result.score + boost, 1.0),
        rawScore: result.score,
        payload: result.payload,
        matchReasons: reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Execute similarity search
 */
export async function findSimilar(args: FindSimilarArgs): Promise<FindSimilarResult> {
  // Check if Qdrant is configured
  if (!isQdrantConfigured()) {
    return {
      success: false,
      error: 'Similarity search not configured. QDRANT_URL and QDRANT_API_KEY must be set.',
    };
  }

  const { entity_type, reference_id, reference_name, filters, limit = DEFAULT_RESULTS } = args;
  // Request one extra for publishers/developers since we filter client-side
  const extraForFilter = entity_type !== 'game' ? 1 : 0;
  const actualLimit = Math.min(limit + extraForFilter, MAX_RESULTS);

  // Look up the reference entity
  const entity =
    typeof reference_id === 'number' && Number.isFinite(reference_id)
      ? await lookupEntityById(entity_type, reference_id)
      : reference_name && reference_name.trim().length > 0
        ? await lookupEntityByName(entity_type, reference_name)
        : null;

  if (reference_id === undefined && (!reference_name || reference_name.trim().length === 0)) {
    return {
      success: false,
      error: 'reference_id or reference_name is required.',
    };
  }

  if (!entity) {
    if (typeof reference_id === 'number' && Number.isFinite(reference_id)) {
      return {
        success: false,
        error: `Could not find ${entity_type} with ID ${reference_id}.`,
      };
    }

    return {
      success: false,
      error: `Could not find ${entity_type} named "${reference_name}". Try a different name or check spelling.`,
    };
  }

  // Get vector and payload for the entity from Qdrant
  const qdrantData = await getEntityVectorAndPayload(entity_type, entity.id);

  if (!qdrantData) {
    return {
      success: false,
      error: `${entity.name} hasn't been indexed for similarity search yet. Try another ${entity_type}.`,
    };
  }

  const { vector, payload: sourcePayload } = qdrantData;

  // Build filter
  const client = getQdrantClient();
  const collection = getCollectionName(entity_type);

  let qdrantFilter;
  if (entity_type === 'game' && filters) {
    const gameFilters: GameFilters = {
      exclude_appids: [entity.id],
      exclude_delisted: true,
      is_released: true,
    };

    // Map filter args to GameFilters
    if (filters.is_free !== undefined) gameFilters.is_free = filters.is_free;
    if (filters.max_price_cents) gameFilters.price_range = { lte: filters.max_price_cents };
    if (filters.platforms) gameFilters.platforms = filters.platforms;
    if (filters.steam_deck) gameFilters.steam_deck = filters.steam_deck;
    if (filters.genres) gameFilters.genres = filters.genres;
    if (filters.tags) gameFilters.tags = filters.tags;
    if (filters.min_reviews) gameFilters.min_reviews = filters.min_reviews;
    if (filters.release_year) gameFilters.release_year = filters.release_year;
    if (filters.review_comparison) gameFilters.review_comparison = filters.review_comparison;

    // Get source metrics for relative comparisons
    // Use Qdrant payload for total_reviews (used for popularity comparison)
    // Use Supabase data for other metrics
    const sourceMetrics = {
      total_reviews: sourcePayload.total_reviews,
      review_percentage: sourcePayload.review_percentage ?? (entity.metrics as { review_percentage?: number })?.review_percentage,
      price_cents: sourcePayload.price_cents ?? (entity.metrics as { price_cents?: number })?.price_cents,
      publisher_ids: sourcePayload.publisher_ids ?? (entity.metrics as { publisher_ids?: number[] })?.publisher_ids,
      developer_ids: sourcePayload.developer_ids ?? (entity.metrics as { developer_ids?: number[] })?.developer_ids,
    };

    // Handle popularity comparison - requires total_reviews data
    if (filters.popularity_comparison && filters.popularity_comparison !== 'any') {
      if (sourceMetrics.total_reviews === null || sourceMetrics.total_reviews === undefined) {
        return {
          success: false,
          error: `Popularity filtering is not available for "${entity.name}" - review data hasn't been synced yet. The embedding sync workflow needs to run to populate this data.`,
        };
      }
      gameFilters.popularity_comparison = filters.popularity_comparison;
    }

    qdrantFilter = buildGameFilter(gameFilters, sourceMetrics);
  } else if (entity_type !== 'game') {
    // Build entity filters for publishers/developers
    const entityFilters: EntityFilters = {
      exclude_ids: [entity.id],
    };

    // Map filter args to EntityFilters
    if (filters?.game_count) entityFilters.game_count = filters.game_count;
    if (filters?.avg_review_percentage) entityFilters.avg_review_percentage = filters.avg_review_percentage;
    if (filters?.is_major !== undefined) entityFilters.is_major = filters.is_major;
    if (filters?.is_indie !== undefined) entityFilters.is_indie = filters.is_indie;
    if (filters?.top_genres) entityFilters.top_genres = filters.top_genres;
    if (filters?.top_tags) entityFilters.top_tags = filters.top_tags;

    qdrantFilter = buildEntityFilter(entityFilters);
  }

  // Execute search with entity-type-specific payload fields
  // Include relationship IDs for hybrid scoring boosts
  const payloadFields = entity_type === 'game'
    ? [
        'name', 'type', 'genres', 'tags', 'review_percentage', 'price_cents', 'is_free',
        'franchise_ids', 'franchise_names', 'developer_ids', 'publisher_ids', // For hybrid scoring
      ]
    : ['name', 'game_count', 'top_genres', 'top_tags', 'avg_review_percentage', 'is_major'];

  let searchResult;
  try {
    searchResult = await client.search(collection, {
      vector,
      filter: qdrantFilter,
      limit: actualLimit,
      with_payload: {
        include: payloadFields,
      },
    });
  } catch (searchError) {
    console.error('Qdrant search error:', searchError);
    return {
      success: false,
      error: `Search failed: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
    };
  }

  // Filter out source entity first
  const filteredResults = searchResult.filter((point) => point.id !== entity.id);

  // Format results based on entity type
  let results: SimilarEntity[];

  if (entity_type === 'game') {
    // Prepare for hybrid scoring
    const rawResults = filteredResults.map((point) => ({
      id: point.id as number,
      score: point.score,
      payload: point.payload as ResultPayloadForBoost,
    }));

    // Apply hybrid score boosts for games
    const boostedResults = applyScoreBoosts(
      sourcePayload as SourcePayloadForBoost,
      rawResults
    );

    // Take top results after re-sorting by boosted score
    results = boostedResults.slice(0, limit).map((item) => ({
      id: item.id,
      name: (item.payload.name as string) || 'Unknown',
      score: Math.round(item.score * 100), // Convert to percentage
      rawScore: Math.round(item.rawScore * 100), // Original vector similarity
      type: item.payload.type as string | undefined,
      genres: (item.payload.genres as string[] | undefined)?.slice(0, 3),
      tags: (item.payload.tags as string[] | undefined)?.slice(0, 5),
      review_percentage: item.payload.review_percentage as number | null | undefined,
      price_cents: item.payload.price_cents as number | null | undefined,
      is_free: item.payload.is_free as boolean | undefined,
      matchReasons: item.matchReasons.length > 0 ? item.matchReasons : undefined,
    }));
  } else {
    // Publisher/Developer results (no hybrid scoring for now)
    results = filteredResults.slice(0, limit).map((point) => {
      const payload = point.payload as Record<string, unknown>;
      return {
        id: point.id as number,
        name: (payload.name as string) || 'Unknown',
        score: Math.round(point.score * 100),
        game_count: payload.game_count as number | undefined,
        genres: (payload.top_genres as string[] | undefined)?.slice(0, 3),
        tags: (payload.top_tags as string[] | undefined)?.slice(0, 5),
        review_percentage: payload.avg_review_percentage as number | null | undefined,
        is_major: payload.is_major as boolean | undefined,
      };
    });
  }

  return {
    success: true,
    reference: {
      id: entity.id,
      name: entity.name,
      type: entity.type || entity_type,
    },
    results,
    total_found: searchResult.length,
    debug: {
      searchParams: {
        collection,
        entity_type,
        reference_id: entity.id,
        filters: args.filters,
        limit: actualLimit,
      },
      vectorFilter: qdrantFilter as Record<string, unknown> | undefined,
    },
  };
}

export async function findSimilarWithTimeout(
  args: FindSimilarArgs
): Promise<FindSimilarResult> {
  return withSearchTimeout('Similarity search', () => findSimilar(args));
}

/**
 * Arguments for search_by_concept tool
 */
export interface SearchByConceptArgs {
  description: string;
  filters?: {
    max_price_cents?: number;
    is_free?: boolean;
    platforms?: ('windows' | 'macos' | 'linux')[];
    steam_deck?: ('verified' | 'playable')[];
    genres?: string[];
    tags?: string[];
    min_reviews?: number;
    release_year?: { gte?: number; lte?: number };
    review_percentage?: { gte?: number };
  };
  limit?: number;
}

/**
 * Result from search_by_concept
 */
export interface SearchByConceptResult {
  success: boolean;
  query_description?: string;
  results?: SimilarEntity[];
  total_found?: number;
  error?: string;
}

/**
 * Search for games by concept description
 * Embeds the description and searches the game vector collection
 */
export async function searchByConcept(args: SearchByConceptArgs): Promise<SearchByConceptResult> {
  // Check if Qdrant is configured
  if (!isQdrantConfigured()) {
    return {
      success: false,
      error: 'Concept search not configured. QDRANT_URL and QDRANT_API_KEY must be set.',
    };
  }

  const { description, filters, limit = DEFAULT_RESULTS } = args;
  const actualLimit = Math.min(limit, MAX_RESULTS);

  // Validate description
  if (!description || description.trim().length === 0) {
    return {
      success: false,
      error: 'Description is required for concept search.',
    };
  }

  // Generate embedding for the description
  let queryVector: number[];
  try {
    queryVector = await generateQueryEmbedding(description);
  } catch (embeddingError) {
    console.error('Embedding generation error:', embeddingError);
    return {
      success: false,
      error: `Failed to process description: ${embeddingError instanceof Error ? embeddingError.message : 'Unknown error'}`,
    };
  }

  // Build filter with default exclusions for released, non-delisted games
  const gameFilters: GameFilters = {
    exclude_delisted: true,
    is_released: true,
  };

  // Map filter args to GameFilters
  if (filters) {
    if (filters.is_free !== undefined) gameFilters.is_free = filters.is_free;
    if (filters.max_price_cents) gameFilters.price_range = { lte: filters.max_price_cents };
    if (filters.platforms) gameFilters.platforms = filters.platforms;
    if (filters.steam_deck) gameFilters.steam_deck = filters.steam_deck;
    if (filters.genres) gameFilters.genres = filters.genres;
    if (filters.tags) gameFilters.tags = filters.tags;
    if (filters.min_reviews) gameFilters.min_reviews = filters.min_reviews;
    if (filters.release_year) gameFilters.release_year = filters.release_year;
    if (filters.review_percentage) gameFilters.review_percentage = filters.review_percentage;
  }

  const qdrantFilter = buildGameFilter(gameFilters);

  // Execute search
  const client = getQdrantClient();
  const collection = COLLECTIONS.GAMES;

  const payloadFields = [
    'name', 'type', 'genres', 'tags', 'review_percentage', 'price_cents', 'is_free',
  ];

  let searchResult;
  try {
    searchResult = await client.search(collection, {
      vector: queryVector,
      filter: qdrantFilter,
      limit: actualLimit,
      with_payload: {
        include: payloadFields,
      },
    });
  } catch (searchError) {
    console.error('Qdrant search error:', searchError);
    return {
      success: false,
      error: `Search failed: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
    };
  }

  // Format results (no hybrid scoring for concept search - pure vector similarity)
  const results: SimilarEntity[] = searchResult.map((point) => {
    const payload = point.payload as Record<string, unknown>;
    return {
      id: point.id as number,
      name: (payload.name as string) || 'Unknown',
      score: Math.round(point.score * 100), // Convert to percentage
      type: payload.type as string | undefined,
      genres: (payload.genres as string[] | undefined)?.slice(0, 3),
      tags: (payload.tags as string[] | undefined)?.slice(0, 5),
      review_percentage: payload.review_percentage as number | null | undefined,
      price_cents: payload.price_cents as number | null | undefined,
      is_free: payload.is_free as boolean | undefined,
    };
  });

  return {
    success: true,
    query_description: description,
    results,
    total_found: searchResult.length,
  };
}

export async function searchByConceptWithTimeout(
  args: SearchByConceptArgs
): Promise<SearchByConceptResult> {
  return withSearchTimeout('Concept similarity search', () => searchByConcept(args));
}
