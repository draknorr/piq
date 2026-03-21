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
  type EntityType,
  type PopularityComparison,
  type ReviewComparison,
} from '@publisheriq/qdrant';
import { getSupabase } from '@/lib/supabase';
import { getServiceSupabase } from '@/lib/supabase-service';
import {
  resolveCompanyReference,
  type CompanyEntityType,
  type CompanyResolutionCandidate,
  normalizeCompanyName,
} from '@/lib/search/company-resolution';

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
const DEFAULT_COMPANY_RESULTS = 6;
const MIN_USEFUL_COMPANY_SIMILARITY_RESULTS = 3;
const MAX_COMPANY_REFERENCE_TITLES = 4;
const COMPANY_GAME_EVIDENCE_NEIGHBORS = 10;
const MIN_COMPANY_GAME_EVIDENCE_SCORE = 0.6;
const MIN_COMPANY_GAME_EVIDENCE_REVIEWS = 50;
const COMPANY_GENERIC_WORDS = new Set([
  'game',
  'games',
  'studio',
  'studios',
  'digital',
  'interactive',
  'entertainment',
  'publishing',
  'publisher',
  'publishers',
  'developer',
  'developers',
  'company',
  'companies',
  'group',
  'media',
  'labs',
  'lab',
  'team',
  'indie',
]);

const GAME_TITLE_GENERIC_WORDS = new Set([
  'game',
  'games',
  'edition',
  'definitive',
  'remastered',
  'remaster',
  'ultimate',
  'complete',
  'deluxe',
  'version',
  'chapter',
  'episode',
  'demo',
  'beta',
  'alpha',
  'prologue',
  'soundtrack',
  'ost',
  'the',
  'and',
  'of',
  'for',
  'to',
  'a',
  'an',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
]);

const LOW_INFORMATION_GAME_ATTRIBUTES = new Set([
  'action',
  'adventure',
  'indie',
  'casual',
  'rpg',
  'singleplayer',
  'family sharing',
  'captions available',
  'cloud gaming',
  'commentary available',
  'steam achievements',
  'steam cloud',
  'stats',
  'early access',
  'story rich',
  'exploration',
  'atmospheric',
  'female protagonist',
]);

type ConceptFacetDefinition = {
  label: string;
  phrases: string[];
  evidenceTerms: string[];
  titleTerms: string[];
};

const CONCEPT_FACETS: ConceptFacetDefinition[] = [
  {
    label: 'Tactical strategy',
    phrases: ['tactical'],
    evidenceTerms: ['tactical', 'strategy', 'turn based tactics', 'turn based', 'grid based movement'],
    titleTerms: ['tactic', 'tactics'],
  },
  {
    label: 'Deckbuilding',
    phrases: ['deck building', 'deckbuilder'],
    evidenceTerms: ['deckbuilder', 'deck building', 'card battler', 'card game', 'rogue like deckbuilder'],
    titleTerms: ['deck'],
  },
  {
    label: 'Roguelike structure',
    phrases: ['roguelike', 'roguelikes', 'roguelite', 'roguelites'],
    evidenceTerms: ['roguelike', 'roguelite', 'action roguelike', 'rogue like deckbuilder'],
    titleTerms: ['rogue', 'roguelike', 'roguelite'],
  },
  {
    label: 'Horror',
    phrases: ['horror'],
    evidenceTerms: ['horror', 'psychological horror', 'survival horror'],
    titleTerms: ['horror', 'haunted', 'ghost'],
  },
  {
    label: 'Investigation',
    phrases: ['investigation', 'investigative', 'detective', 'mystery'],
    evidenceTerms: ['investigation', 'detective', 'mystery', 'hidden object', 'story rich'],
    titleTerms: ['investigation', 'detective', 'mystery'],
  },
  {
    label: 'Puzzle',
    phrases: ['puzzle', 'puzzles'],
    evidenceTerms: ['puzzle', 'logic'],
    titleTerms: ['puzzle'],
  },
  {
    label: 'Relaxing tone',
    phrases: ['relaxing', 'cozy', 'calm'],
    evidenceTerms: ['relaxing', 'cozy', 'casual', 'atmospheric'],
    titleTerms: ['relaxing', 'cozy'],
  },
  {
    label: 'Beautiful/stylized art',
    phrases: ['beautiful art', 'beautiful visuals', 'beautiful', 'stylized', 'gorgeous'],
    evidenceTerms: ['beautiful', 'stylized', 'hand drawn', 'hand-drawn', 'atmospheric', 'colorful', 'painting', 'nature'],
    titleTerms: ['beautiful', 'beauty', 'art'],
  },
  {
    label: 'Fast-paced action',
    phrases: ['fast paced', 'fast-paced'],
    evidenceTerms: ['fast-paced', 'action', 'arcade', 'bullet hell', 'hack and slash'],
    titleTerms: ['fast', 'action'],
  },
  {
    label: 'Action',
    phrases: ['action'],
    evidenceTerms: ['action', 'arcade', 'hack and slash', 'beat em up'],
    titleTerms: ['action'],
  },
  {
    label: 'Pixel Graphics',
    phrases: ['pixel art', 'pixel graphics', 'pixel'],
    evidenceTerms: ['pixel graphics', 'pixel'],
    titleTerms: ['pixel'],
  },
];

type CompanySimilarityFailureStage =
  | 'game_evidence_search'
  | 'company_collection_search'
  | 'company_similarity_fallback';

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('timeout') || message.includes('aborted');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildCompanySimilarityFailure(
  entityType: CompanyEntityType,
  reference: { id: number; name: string },
  stage: CompanySimilarityFailureStage,
  error: unknown
): FindSimilarResult {
  return {
    success: false,
    entityType,
    reference: {
      id: reference.id,
      name: reference.name,
      type: entityType,
    },
    error: `Company similarity search failed during ${stage.replaceAll('_', ' ')}: ${errorMessage(error)}`,
    debug: {
      searchParams: {
        entity_type: entityType,
        reference_id: reference.id,
        failureStage: stage,
      },
    },
  };
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
    max_reviews?: number;
    review_percentage?: { gte?: number; lte?: number };
    release_year?: { gte?: number; lte?: number };
    same_franchise_only?: boolean;
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
  total_reviews?: number | null;
  price_cents?: number | null;
  is_free?: boolean;
  steam_deck?: 'unknown' | 'unsupported' | 'playable' | 'verified';
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
  mode?: 'semantic' | 'heuristic_portfolio';
  entityType?: CompanyEntityType;
  reference?: {
    id: number;
    name: string;
    type: string;
  };
  results?: SimilarEntity[];
  candidates?: CompanyResolutionCandidate[];
  total_found?: number;
  error?: string;
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
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
    const resolution = await resolveCompanyReference('publisher', name, 5);
    if (resolution.canonicalResult && !resolution.needsDisambiguation) {
      return {
        id: resolution.canonicalResult.id,
        name: resolution.canonicalResult.name,
      };
    }
  } else if (entityType === 'developer') {
    const resolution = await resolveCompanyReference('developer', name, 5);
    if (resolution.canonicalResult && !resolution.needsDisambiguation) {
      return {
        id: resolution.canonicalResult.id,
        name: resolution.canonicalResult.name,
      };
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

async function lookupGameReferenceWithFranchiseMetadata(
  query: string,
  excludeAppid?: number
): Promise<
  | {
      entity: { id: number; name: string; type?: string; metrics?: object };
      qdrantData: { vector: number[]; payload: Record<string, unknown> };
    }
  | null
> {
  const normalizedQuery = normalizeTextToken(query);
  if (!normalizedQuery) {
    return null;
  }

  const supabase = getSupabase();
  const { data } = await supabase
    .from('apps')
    .select('appid, name, type, pics_review_percentage, current_price_cents, publisher_ids:app_publishers(publisher_id), developer_ids:app_developers(developer_id)')
    .ilike('name', `%${query}%`)
    .eq('type', 'game')
    .limit(10);

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const candidates = await Promise.all(
    data
      .filter((row) => Number(row.appid) !== excludeAppid)
      .map(async (row) => {
        const qdrantData = await getEntityVectorAndPayload('game', Number(row.appid));
        if (!qdrantData) {
          return null;
        }

        const franchiseIds = asOptionalNumberArray(qdrantData.payload.franchise_ids);
        if (!franchiseIds || franchiseIds.length === 0) {
          return null;
        }

        const normalizedName = normalizeTextToken(String(row.name ?? ''));
        const exactMatch = normalizedName === normalizedQuery;
        const containsMatch = normalizedName.includes(normalizedQuery);

        return {
          exactMatch,
          containsMatch,
          franchiseCount: franchiseIds.length,
          entity: {
            id: Number(row.appid),
            name: String(row.name ?? ''),
            type: (row.type as string | null | undefined) ?? undefined,
            metrics: {
              review_percentage: row.pics_review_percentage,
              price_cents: row.current_price_cents,
              publisher_ids: (row.publisher_ids as { publisher_id: number }[])?.map((publisher) => publisher.publisher_id) || [],
              developer_ids: (row.developer_ids as { developer_id: number }[])?.map((developer) => developer.developer_id) || [],
            },
          },
          qdrantData,
        };
      })
  );

  const bestCandidate = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      if (left.exactMatch !== right.exactMatch) {
        return Number(right.exactMatch) - Number(left.exactMatch);
      }
      if (left.containsMatch !== right.containsMatch) {
        return Number(right.containsMatch) - Number(left.containsMatch);
      }
      return right.franchiseCount - left.franchiseCount;
    })[0];

  return bestCandidate
    ? {
        entity: bestCandidate.entity,
        qdrantData: bestCandidate.qdrantData,
      }
    : null;
}

async function findSameSeriesByTitleTokens(
  reference: { id: number; name: string; type?: string; metrics?: object },
  limit: number
): Promise<SimilarEntity[]> {
  const titleTokens = tokenizeTitle(reference.name, GAME_TITLE_GENERIC_WORDS).slice(0, 3);
  if (titleTokens.length < 2) {
    return [];
  }

  const supabase = getSupabase();
  const ilikePattern = `%${titleTokens.join('%')}%`;
  const { data } = await supabase
    .from('apps')
    .select('appid, name, type')
    .ilike('name', ilikePattern)
    .eq('type', 'game')
    .limit(20);

  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }

  const candidates = await Promise.all(
    data
      .filter((row) => Number(row.appid) !== reference.id)
      .map(async (row) => {
        const candidateName = String(row.name ?? '');
        const normalizedCandidateName = normalizeTextToken(candidateName);
        if (!titleTokens.every((token) => normalizedCandidateName.includes(token))) {
          return null;
        }

        const qdrantCandidate = await getEntityVectorAndPayload('game', Number(row.appid));
        if (!qdrantCandidate) {
          return null;
        }

        return {
          id: Number(row.appid),
          name: candidateName,
          normalizedName: normalizedCandidateName,
          payload: qdrantCandidate.payload,
        };
      })
  );

  return candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      const leftStartsWithAllTokens = titleTokens.every((token) => left.normalizedName.startsWith(token) || left.normalizedName.includes(`${token} `));
      const rightStartsWithAllTokens = titleTokens.every((token) => right.normalizedName.startsWith(token) || right.normalizedName.includes(`${token} `));
      if (leftStartsWithAllTokens !== rightStartsWithAllTokens) {
        return Number(rightStartsWithAllTokens) - Number(leftStartsWithAllTokens);
      }

      const leftReviews = asOptionalNullableNumber(left.payload.total_reviews) ?? 0;
      const rightReviews = asOptionalNullableNumber(right.payload.total_reviews) ?? 0;
      if (leftReviews !== rightReviews) {
        return rightReviews - leftReviews;
      }

      const leftReviewPercentage = asOptionalNullableNumber(left.payload.review_percentage) ?? 0;
      const rightReviewPercentage = asOptionalNullableNumber(right.payload.review_percentage) ?? 0;
      return rightReviewPercentage - leftReviewPercentage;
    })
    .slice(0, limit)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      score: 100,
      type: candidate.payload.type as string | undefined,
      genres: (candidate.payload.genres as string[] | undefined)?.slice(0, 3),
      tags: (candidate.payload.tags as string[] | undefined)?.slice(0, 5),
      review_percentage: candidate.payload.review_percentage as number | null | undefined,
      total_reviews: candidate.payload.total_reviews as number | null | undefined,
      price_cents: candidate.payload.price_cents as number | null | undefined,
      is_free: candidate.payload.is_free as boolean | undefined,
      steam_deck: candidate.payload.steam_deck as SimilarEntity['steam_deck'],
      matchReasons: ['Same series title match'],
    }));
}

interface CompanyMetricsSnapshot {
  id: number;
  name: string;
  gameCount: number;
  totalReviews: number;
  avgReviewScore: number | null;
  gamesReleasedLastYear: number;
  genreIds: number[];
  tagIds: number[];
}

interface CompanySearchPoint {
  id: number;
  score: number;
  payload: Record<string, unknown>;
  variant: 'portfolio' | 'identity';
}

interface CompanyMergedCandidate {
  id: number;
  semanticScore: number;
  variantScores: Partial<Record<'portfolio' | 'identity', number>>;
  payloads: Partial<Record<'portfolio' | 'identity', Record<string, unknown>>>;
}

interface CompanyReferenceTitleSeed {
  appid: number;
  isFlagship: boolean;
}

interface CompanyGameEvidenceAccumulator {
  bestScoresByReference: Map<number, number>;
  matchedGameIds: Set<number>;
  flagshipHit: boolean;
}

interface CompanyGameEvidence {
  referenceTitleHits: number;
  matchedGameCount: number;
  weightedGameEvidenceScore: number;
  flagshipHit: boolean;
}

interface CompanySimilaritySupport {
  genreOverlap: number;
  tagOverlap: number;
  reviewCloseness: number;
  catalogCloseness: number;
  qualityCloseness: number;
  cadenceCloseness: number;
  portfolioScore: number;
  scaleQualityScore: number;
}

interface RankedCompanySimilarityResult extends SimilarEntity {
  rawScore: number;
  portfolioScore: number;
  type: CompanyEntityType;
  game_count: number;
  genres?: string[];
  tags?: string[];
  review_percentage: number | null;
  is_major: boolean;
  matchReasons: string[];
  variantScores: Partial<Record<'portfolio' | 'identity', number>>;
}

function normalizeMetricArray(values: number[] | null | undefined): number[] {
  return Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return asOptionalNumber(value);
}

function asOptionalNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers = value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
  return numbers.length > 0 ? numbers : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return strings.length > 0 ? strings : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTextToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenizeTitle(name: string, genericWords: Set<string>): string[] {
  const normalized = normalizeTextToken(name);
  if (!normalized) {
    return [];
  }

  return [...new Set(
    normalized
      .split(/\s+/)
      .filter((token) => token.length > 2 && !genericWords.has(token) && !/^\d+$/.test(token))
  )];
}

function sharedNormalizedStrings(left: string[] | undefined, right: string[] | undefined): string[] {
  if (!left?.length || !right?.length) {
    return [];
  }

  const rightSet = new Set(right.map((value) => normalizeTextToken(value)));
  const seen = new Set<string>();
  const shared: string[] = [];

  for (const value of left) {
    const normalized = normalizeTextToken(value);
    if (!normalized || seen.has(normalized) || !rightSet.has(normalized)) {
      continue;
    }

    shared.push(value);
    seen.add(normalized);
  }

  return shared;
}

function payloadTextValues(payload: Record<string, unknown>): string[] {
  return [
    ...(asOptionalStringArray(payload.tags) ?? []),
    ...(asOptionalStringArray(payload.genres) ?? []),
  ];
}

function filterInformativeGameAttributes(values: string[]): string[] {
  return values.filter((value) => !LOW_INFORMATION_GAME_ATTRIBUTES.has(normalizeTextToken(value)));
}

function buildConceptSearchDescription(description: string): string {
  const normalizedDescription = normalizeTextToken(description);
  const expansions: string[] = [];

  const hasTacticalDeckPrompt =
    normalizedDescription.includes('tactical') &&
    (normalizedDescription.includes('deck building') || normalizedDescription.includes('deckbuilder'));
  if (hasTacticalDeckPrompt) {
    expansions.push('turn-based tactics strategy deckbuilder card battler grid-based movement');
  }

  const hasTacticalRoguelikePrompt =
    normalizedDescription.includes('tactical') &&
    (normalizedDescription.includes('roguelike') || normalizedDescription.includes('roguelite'));
  if (hasTacticalRoguelikePrompt) {
    expansions.push('turn-based tactics grid-based movement strategy roguelike roguelite permadeath');
  }

  const hasBeautifulArtPrompt =
    normalizedDescription.includes('beautiful art') ||
    (descriptionIncludesAll(normalizedDescription, ['beautiful', 'puzzle']) &&
      (normalizedDescription.includes('relaxing') || normalizedDescription.includes('cozy') || normalizedDescription.includes('calm')));
  if (hasBeautifulArtPrompt) {
    expansions.push('relaxing atmospheric puzzle with stylized hand-drawn colorful art cozy beautiful visuals');
  }

  const hasPixelActionPrompt =
    normalizedDescription.includes('pixel') &&
    normalizedDescription.includes('action');
  if (hasPixelActionPrompt) {
    expansions.push('fast-paced pixel graphics action arcade run-and-gun bullet hell platformer');
  }

  const hasInvestigationHorrorPrompt =
    normalizedDescription.includes('horror') &&
    (normalizedDescription.includes('investigation') ||
      normalizedDescription.includes('detective') ||
      normalizedDescription.includes('mystery'));
  if (hasInvestigationHorrorPrompt) {
    expansions.push('investigation detective mystery story-rich psychological horror puzzle');
  }

  return expansions.length > 0 ? `${description}. ${expansions.join('. ')}.` : description;
}

function shouldApplyConceptQualityFloor(normalizedDescription: string): boolean {
  return (
    (normalizedDescription.includes('tactical') &&
      (normalizedDescription.includes('deck building') ||
        normalizedDescription.includes('deckbuilder') ||
        normalizedDescription.includes('roguelike') ||
        normalizedDescription.includes('roguelite'))) ||
    normalizedDescription.includes('beautiful art') ||
    (descriptionIncludesAll(normalizedDescription, ['beautiful', 'puzzle']) &&
      (normalizedDescription.includes('relaxing') || normalizedDescription.includes('cozy') || normalizedDescription.includes('calm'))) ||
    (normalizedDescription.includes('pixel') && normalizedDescription.includes('action')) ||
    (normalizedDescription.includes('horror') &&
      (normalizedDescription.includes('investigation') ||
        normalizedDescription.includes('detective') ||
        normalizedDescription.includes('mystery')))
  );
}

function payloadHasEvidenceTerm(payload: Record<string, unknown>, evidenceTerms: string[]): boolean {
  const normalizedValues = payloadTextValues(payload).map((value) => normalizeTextToken(value));
  return evidenceTerms.some((term) =>
    normalizedValues.some((value) => value === term || value.includes(term) || term.includes(value))
  );
}

function titleContainsEvidenceTerm(name: string, titleTerms: string[]): boolean {
  const normalized = normalizeTextToken(name);
  return normalized.length > 0 && titleTerms.some((term) => normalized.includes(term));
}

function nameContainsAnyTerm(name: string, terms: string[]): boolean {
  const normalized = normalizeTextToken(name);
  return normalized.length > 0 && terms.some((term) => normalized.includes(normalizeTextToken(term)));
}

function payloadOrTitleHasEvidenceTerm(
  payload: Record<string, unknown>,
  name: string,
  terms: string[]
): boolean {
  return payloadHasEvidenceTerm(payload, terms) || nameContainsAnyTerm(name, terms);
}

function descriptionIncludesAll(normalizedDescription: string, phrases: string[]): boolean {
  return phrases.every((phrase) => normalizedDescription.includes(normalizeTextToken(phrase)));
}

function formatCompactReviewCount(count: number): string {
  if (count >= 1_000_000) {
    return `${Math.round(count / 100_000) / 10}M`;
  }

  if (count >= 1_000) {
    const compactThousands = Math.round(count / 100) / 10;
    return Number.isInteger(compactThousands) ? `${compactThousands.toFixed(0)}K` : `${compactThousands}K`;
  }

  return `${count}`;
}

function reviewSupportBonus(totalReviews: number | null | undefined, reviewPercentage: number | null | undefined): number {
  let bonus = 0;

  if (totalReviews !== null && totalReviews !== undefined) {
    if (totalReviews >= 5000) bonus += 0.05;
    else if (totalReviews >= 1000) bonus += 0.035;
    else if (totalReviews >= 100) bonus += 0.02;
  }

  if (reviewPercentage !== null && reviewPercentage !== undefined) {
    if (reviewPercentage >= 90) bonus += 0.03;
    else if (reviewPercentage >= 80) bonus += 0.015;
  }

  return bonus;
}

function lowSignalPenalty(totalReviews: number | null | undefined, reviewPercentage: number | null | undefined): number {
  let penalty = 0;

  if (totalReviews === null || totalReviews === undefined) {
    penalty += 0.06;
  } else if (totalReviews < 20) {
    penalty += 0.1;
  } else if (totalReviews < 100) {
    penalty += 0.055;
  } else if (totalReviews < 500) {
    penalty += 0.02;
  }

  if (reviewPercentage === null || reviewPercentage === undefined) {
    penalty += 0.04;
  } else if (reviewPercentage < 50) {
    penalty += 0.09;
  } else if (reviewPercentage < 60) {
    penalty += 0.06;
  } else if (reviewPercentage < 70) {
    penalty += 0.025;
  }

  return penalty;
}

function hasSuspiciousGameTitleOverlap(referenceName: string, candidateName: string): boolean {
  const referenceTokens = tokenizeTitle(referenceName, GAME_TITLE_GENERIC_WORDS);
  const candidateTokens = tokenizeTitle(candidateName, GAME_TITLE_GENERIC_WORDS);

  if (referenceTokens.length === 0 || candidateTokens.length === 0) {
    return false;
  }

  const candidateSet = new Set(candidateTokens);
  if (referenceTokens.some((token) => candidateSet.has(token))) {
    return true;
  }

  const [referencePrimary] = referenceTokens;
  const [candidatePrimary] = candidateTokens;
  if (!referencePrimary || !candidatePrimary) {
    return false;
  }

  const prefixRatio = commonPrefixRatio(referencePrimary, candidatePrimary);
  return referencePrimary.length >= 5 && candidatePrimary.length >= 5 && prefixRatio >= 0.72;
}

function normalizeFindSimilarArgs(args: FindSimilarArgs): FindSimilarArgs {
  const rawArgs = args as FindSimilarArgs & Record<string, unknown>;
  const rawFilters = isPlainObject(rawArgs.filters) ? rawArgs.filters : {};
  const mergedFilters: Record<string, unknown> = { ...rawFilters };

  for (const key of [
    'popularity_comparison',
    'review_comparison',
    'max_price_cents',
    'is_free',
    'platforms',
    'steam_deck',
    'genres',
    'tags',
    'min_reviews',
    'max_reviews',
    'review_percentage',
    'release_year',
    'same_franchise_only',
    'game_count',
    'avg_review_percentage',
    'is_major',
    'is_indie',
    'top_genres',
    'top_tags',
  ] as const) {
    if (rawArgs[key] !== undefined && mergedFilters[key] === undefined) {
      mergedFilters[key] = rawArgs[key];
    }
  }

  return {
    ...args,
    filters: Object.keys(mergedFilters).length > 0
      ? (mergedFilters as FindSimilarArgs['filters'])
      : undefined,
  };
}

function normalizeSearchByConceptArgs(args: SearchByConceptArgs): SearchByConceptArgs {
  const rawArgs = args as SearchByConceptArgs & Record<string, unknown>;
  const rawFilters = isPlainObject(rawArgs.filters) ? rawArgs.filters : {};
  const mergedFilters: Record<string, unknown> = { ...rawFilters };

  for (const key of [
    'max_price_cents',
    'is_free',
    'platforms',
    'steam_deck',
    'genres',
    'tags',
    'min_reviews',
    'max_reviews',
    'release_year',
    'review_percentage',
  ] as const) {
    if (rawArgs[key] !== undefined && mergedFilters[key] === undefined) {
      mergedFilters[key] = rawArgs[key];
    }
  }

  return {
    ...args,
    filters: Object.keys(mergedFilters).length > 0
      ? (mergedFilters as SearchByConceptArgs['filters'])
      : undefined,
  };
}

function applyImplicitConceptFilters(
  description: string,
  filters: SearchByConceptArgs['filters'] | undefined,
  gameFilters: GameFilters
): void {
  const normalizedDescription = normalizeTextToken(description);
  const explicitTags = filters?.tags ?? [];

  if (explicitTags.length === 0) {
    if (normalizedDescription.includes('pixel art') || normalizedDescription.includes('pixel graphics')) {
      gameFilters.tags = ['Pixel Graphics'];
    } else if (
      normalizedDescription.includes('deck building') ||
      normalizedDescription.includes('deckbuilder')
    ) {
      gameFilters.tags = ['Deckbuilding'];
    }
  }

  if (gameFilters.min_reviews === undefined && shouldApplyConceptQualityFloor(normalizedDescription)) {
    gameFilters.min_reviews = 100;
  }

  if (gameFilters.review_percentage === undefined && shouldApplyConceptQualityFloor(normalizedDescription)) {
    gameFilters.review_percentage = { gte: 70 };
  }
}

function buildSimilarityFilterEvidence(
  sourcePayload: SourcePayloadForBoost,
  candidatePayload: ResultPayloadForBoost,
  filters: FindSimilarArgs['filters'] | undefined
): { bonus: number; penalty: number; reasons: string[]; hardReject: boolean } {
  const reasons: string[] = [];
  let bonus = 0;
  let penalty = 0;
  let hardReject = false;

  const candidateTags = candidatePayload.tags ?? [];
  const candidateGenres = candidatePayload.genres ?? [];

  const matchedTags = sharedNormalizedStrings(filters?.tags, candidateTags);
  if (matchedTags.length > 0) {
    reasons.push(matchedTags[0]);
    bonus += 0.04;
  }

  const matchedGenres = sharedNormalizedStrings(filters?.genres, candidateGenres);
  if (matchedGenres.length > 0 && !reasons.includes(matchedGenres[0])) {
    reasons.push(matchedGenres[0]);
    bonus += 0.03;
  }

  if (filters?.steam_deck?.length) {
    if (
      (candidatePayload.steam_deck === 'verified' || candidatePayload.steam_deck === 'playable') &&
      filters.steam_deck.includes(candidatePayload.steam_deck)
    ) {
      reasons.push(`Steam Deck ${candidatePayload.steam_deck}`);
      bonus += 0.03;
    } else {
      hardReject = true;
    }
  }

  const sourceReviewPercentage = asOptionalNullableNumber(sourcePayload.review_percentage);
  const candidateReviewPercentage = asOptionalNullableNumber(candidatePayload.review_percentage);
  if (
    filters?.review_comparison &&
    sourceReviewPercentage !== null &&
    sourceReviewPercentage !== undefined &&
    candidateReviewPercentage !== null &&
    candidateReviewPercentage !== undefined &&
    candidateReviewPercentage >= sourceReviewPercentage
  ) {
    reasons.push('Higher review score');
    bonus += 0.035;
  } else if (filters?.review_comparison && filters.review_comparison !== 'any') {
    hardReject = true;
  }

  const sourceTotalReviews = asOptionalNullableNumber(sourcePayload.total_reviews);
  const candidateTotalReviews = asOptionalNullableNumber(candidatePayload.total_reviews);
  if (
    filters?.popularity_comparison === 'less_popular' &&
    sourceTotalReviews !== null &&
    sourceTotalReviews !== undefined &&
    candidateTotalReviews !== null &&
    candidateTotalReviews !== undefined &&
    candidateTotalReviews < sourceTotalReviews
  ) {
    reasons.push('Smaller review footprint');
    bonus += 0.025;
  } else if (
    filters?.popularity_comparison &&
    filters.popularity_comparison !== 'any' &&
    filters.popularity_comparison === 'less_popular'
  ) {
    hardReject = true;
  }

  if (filters?.max_reviews !== undefined) {
    if (
      candidateTotalReviews === null ||
      candidateTotalReviews === undefined ||
      candidateTotalReviews > filters.max_reviews
    ) {
      hardReject = true;
    } else {
      reasons.push(`Under ${formatCompactReviewCount(filters.max_reviews)} reviews`);
      bonus += 0.02;
    }
  }

  if (filters?.review_percentage) {
    const minReviewPercentage = filters.review_percentage.gte;
    const maxReviewPercentage = filters.review_percentage.lte;

    if (candidateReviewPercentage === null || candidateReviewPercentage === undefined) {
      hardReject = true;
    } else if (
      (minReviewPercentage !== undefined && candidateReviewPercentage < minReviewPercentage) ||
      (maxReviewPercentage !== undefined && candidateReviewPercentage > maxReviewPercentage)
    ) {
      hardReject = true;
    }
  }

  const hasReviewSensitiveConstraint =
    (filters?.review_comparison !== undefined && filters.review_comparison !== 'any') ||
    filters?.review_percentage !== undefined ||
    filters?.max_reviews !== undefined ||
    filters?.min_reviews !== undefined;

  if (hasReviewSensitiveConstraint) {
    if (candidateTotalReviews === null || candidateTotalReviews === undefined) {
      penalty += 0.12;
      if (filters?.review_comparison && filters.review_comparison !== 'any') {
        hardReject = true;
      }
    } else if (candidateTotalReviews < 50) {
      penalty += 0.16;
      if (filters?.review_comparison && filters.review_comparison !== 'any') {
        hardReject = true;
      }
    } else if (candidateTotalReviews < 100) {
      penalty += 0.08;
    }
  }

  return {
    bonus: Math.min(bonus, 0.14),
    penalty,
    reasons,
    hardReject,
  };
}

function buildConceptEvidence(
  description: string,
  payload: Record<string, unknown>
): {
  bonus: number;
  penalty: number;
  reasons: string[];
  matchedFacetCount: number;
  facetCount: number;
  hardReject: boolean;
} {
  const normalizedDescription = normalizeTextToken(description);
  const matchedFacets = CONCEPT_FACETS.filter((facet) =>
    facet.phrases.some((phrase) => normalizedDescription.includes(phrase))
  );
  const candidateName = asOptionalString(payload.name) ?? '';
  const matchedLabels: string[] = [];
  let bonus = 0;
  let penalty = 0;
  let hardReject = false;

  for (const facet of matchedFacets) {
    if (payloadHasEvidenceTerm(payload, facet.evidenceTerms)) {
      matchedLabels.push(facet.label);
      bonus += 0.05;
      continue;
    }

    if (candidateName && titleContainsEvidenceTerm(candidateName, facet.titleTerms)) {
      penalty += 0.11;
    }
  }

  if (matchedFacets.length > 0 && matchedLabels.length === 0) {
    penalty += 0.1;
  } else if (matchedFacets.length >= 2) {
    const missingFacetCount = Math.max(0, matchedFacets.length - matchedLabels.length);
    if (missingFacetCount > 0) {
      penalty += missingFacetCount * 0.08;
    } else {
      bonus += 0.05;
    }
  }

  if (matchedLabels.length >= 2) {
    bonus += 0.03;
  }

  const hasBeautifulArtPrompt =
    normalizedDescription.includes('beautiful art') ||
    (descriptionIncludesAll(normalizedDescription, ['beautiful', 'puzzle']) &&
      (normalizedDescription.includes('relaxing') || normalizedDescription.includes('cozy') || normalizedDescription.includes('calm')));
  if (hasBeautifulArtPrompt) {
    const artEvidence = payloadHasEvidenceTerm(payload, [
      'stylized',
      'hand drawn',
      'hand-drawn',
      'atmospheric',
      'colorful',
      'painting',
      'story rich',
      'nature',
    ]);
    const relaxingEvidence = payloadHasEvidenceTerm(payload, ['relaxing', 'cozy', 'atmospheric', 'wholesome']);
    const lowSignalPuzzle = payloadOrTitleHasEvidenceTerm(payload, candidateName, [
      'jigsaw',
      'coloring',
      'sudoku',
      'mahjong',
      'solitaire',
      'nonogram',
    ]);
    const lowSignalContent = payloadHasEvidenceTerm(payload, [
      'hentai',
      'sexual content',
      'nsfw',
      'clicker',
      'hidden object',
    ]);
    const lowSignalAesthetic = nameContainsAnyTerm(candidateName, [
      'pleasure',
      'sexy',
      'girls',
      'portrait',
      'anime',
    ]);
    if (lowSignalPuzzle) {
      penalty += 0.28;
      hardReject = true;
    }
    if (lowSignalContent) {
      penalty += 0.28;
      hardReject = true;
    }
    if (lowSignalAesthetic) {
      penalty += 0.22;
      hardReject = true;
    }
    if (!artEvidence) {
      penalty += 0.18;
      hardReject = true;
    } else if (payloadHasEvidenceTerm(payload, ['puzzle', 'logic'])) {
      bonus += 0.05;
    }
    if (!relaxingEvidence) {
      penalty += 0.08;
    }
    if (nameContainsAnyTerm(candidateName, ['beauty', 'beautiful']) && !artEvidence) {
      penalty += 0.12;
    }
  }

  const hasTacticalDeckPrompt =
    normalizedDescription.includes('tactical') &&
    (normalizedDescription.includes('deck building') || normalizedDescription.includes('deckbuilder'));
  if (hasTacticalDeckPrompt) {
    const tacticalEvidence = payloadHasEvidenceTerm(payload, [
      'tactical',
      'strategy',
      'turn based tactics',
      'turn based',
      'grid based movement',
    ]);
    const strongTacticalEvidence = payloadHasEvidenceTerm(payload, [
      'turn based tactics',
      'turn based strategy',
      'grid based movement',
      'strategy rpg',
      'turn based combat',
    ]);
    const deckbuildingEvidence = payloadHasEvidenceTerm(payload, [
      'deckbuilder',
      'deck building',
      'rogue like deckbuilder',
    ]);
    const genericCardOnly =
      payloadHasEvidenceTerm(payload, ['card game', 'trading card', 'collectible card']) && !tacticalEvidence;

    if (!tacticalEvidence) {
      penalty += 0.12;
    }
    if (tacticalEvidence && !strongTacticalEvidence) {
      penalty += 0.07;
    }
    if (!deckbuildingEvidence) {
      penalty += 0.08;
    }
    if (genericCardOnly) {
      penalty += 0.12;
    }
    if (tacticalEvidence && deckbuildingEvidence) {
      bonus += 0.07;
    }
  }

  const hasTacticalRoguelikePrompt =
    normalizedDescription.includes('tactical') &&
    (normalizedDescription.includes('roguelike') || normalizedDescription.includes('roguelite'));
  if (hasTacticalRoguelikePrompt) {
    const tacticalEvidence = payloadHasEvidenceTerm(payload, [
      'tactical',
      'strategy',
      'turn based tactics',
      'turn based',
      'grid based movement',
    ]);
    const strongTacticalEvidence = payloadHasEvidenceTerm(payload, [
      'turn based tactics',
      'turn based strategy',
      'grid based movement',
      'strategy rpg',
      'turn based combat',
    ]);
    const roguelikeEvidence = payloadHasEvidenceTerm(payload, [
      'roguelike',
      'roguelite',
      'action roguelike',
      'rogue like deckbuilder',
    ]);

    if (!tacticalEvidence) {
      penalty += 0.12;
      if (titleContainsEvidenceTerm(candidateName, ['rogue'])) {
        penalty += 0.12;
        hardReject = true;
      }
    }
    if (tacticalEvidence && !strongTacticalEvidence) {
      penalty += 0.1;
      if (titleContainsEvidenceTerm(candidateName, ['rogue'])) {
        penalty += 0.08;
      }
    }
    if (!roguelikeEvidence) {
      penalty += 0.06;
    }
    if (tacticalEvidence && roguelikeEvidence) {
      bonus += 0.06;
    }
  }

  const hasPixelActionPrompt =
    normalizedDescription.includes('pixel') &&
    normalizedDescription.includes('action');
  if (hasPixelActionPrompt) {
    const pixelEvidence = payloadHasEvidenceTerm(payload, ['pixel graphics', 'pixel']);
    const actionEvidence = payloadHasEvidenceTerm(payload, [
      'fast-paced',
      'action',
      'arcade',
      'bullet hell',
      'hack and slash',
      'platformer',
      'run and gun',
      'shoot em up',
      'shmup',
    ]);

    if (!pixelEvidence) {
      penalty += 0.16;
    }
    if (!actionEvidence) {
      penalty += 0.1;
    }
    if (nameContainsAnyTerm(candidateName, ['pixel']) && !pixelEvidence) {
      penalty += 0.1;
      hardReject = true;
    }
    if (pixelEvidence && actionEvidence) {
      bonus += 0.06;
    }
  }

  const hasInvestigationHorrorPrompt =
    normalizedDescription.includes('horror') &&
    normalizedDescription.includes('investigation');
  if (hasInvestigationHorrorPrompt) {
    const horrorEvidence = payloadHasEvidenceTerm(payload, [
      'horror',
      'psychological horror',
      'survival horror',
    ]);
    const investigationEvidence = payloadHasEvidenceTerm(payload, [
      'investigation',
      'detective',
      'mystery',
      'story rich',
      'hidden object',
    ]);
    const puzzleEvidence = payloadHasEvidenceTerm(payload, ['puzzle', 'logic']);

    if (nameContainsAnyTerm(candidateName, ['investigation', 'detective']) && !horrorEvidence) {
      penalty += 0.12;
    }
    if (horrorEvidence && investigationEvidence) {
      bonus += 0.05;
    }
    if (normalizedDescription.includes('puzzle') && !puzzleEvidence) {
      penalty += 0.06;
    }
  }

  const totalReviews = asOptionalNullableNumber(payload.total_reviews);
  const reviewPercentage = asOptionalNullableNumber(payload.review_percentage);
  bonus += reviewSupportBonus(totalReviews, reviewPercentage);
  penalty += lowSignalPenalty(totalReviews, reviewPercentage);

  const reasons: string[] = [];
  if (matchedLabels.length >= 2) {
    reasons.push(`${matchedLabels[0]} + ${matchedLabels[1]} fit`);
  } else if (matchedLabels.length === 1) {
    reasons.push(`${matchedLabels[0]} fit`);
  }

  if (
    totalReviews !== null &&
    totalReviews !== undefined &&
    totalReviews >= 100 &&
    reviewPercentage !== null &&
    reviewPercentage !== undefined &&
    reviewPercentage >= 80
  ) {
    reasons.push('Well-supported reviews');
  }

  return {
    bonus,
    penalty,
    reasons,
    matchedFacetCount: matchedLabels.length,
    facetCount: matchedFacets.length,
    hardReject,
  };
}

async function fetchCompanyMetricsSnapshot(
  entityType: CompanyEntityType,
  id: number
): Promise<CompanyMetricsSnapshot | null> {
  const supabase = getServiceSupabase();
  const table = entityType === 'publisher' ? 'publisher_metrics' : 'developer_metrics';
  const idColumn = entityType === 'publisher' ? 'publisher_id' : 'developer_id';
  const nameColumn = entityType === 'publisher' ? 'publisher_name' : 'developer_name';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from(table as any) as any)
    .select(`${idColumn}, ${nameColumn}, game_count, total_reviews, avg_review_score, games_released_last_year, genre_ids, tag_ids`)
    .eq(idColumn, id)
    .maybeSingle();

  if (!data) {
    return null;
  }

  return {
    id: Number(data[idColumn] ?? id),
    name: String(data[nameColumn] ?? ''),
    gameCount: Number(data.game_count ?? 0),
    totalReviews: Number(data.total_reviews ?? 0),
    avgReviewScore: data.avg_review_score as number | null,
    gamesReleasedLastYear: Number(data.games_released_last_year ?? 0),
    genreIds: normalizeMetricArray(data.genre_ids as number[] | null | undefined),
    tagIds: normalizeMetricArray(data.tag_ids as number[] | null | undefined),
  };
}

async function fetchCompanyMetricsSnapshots(
  entityType: CompanyEntityType,
  ids: number[]
): Promise<Map<number, CompanyMetricsSnapshot>> {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(id));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const supabase = getServiceSupabase();
  const table = entityType === 'publisher' ? 'publisher_metrics' : 'developer_metrics';
  const idColumn = entityType === 'publisher' ? 'publisher_id' : 'developer_id';
  const nameColumn = entityType === 'publisher' ? 'publisher_name' : 'developer_name';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from(table as any) as any)
    .select(`${idColumn}, ${nameColumn}, game_count, total_reviews, avg_review_score, games_released_last_year, genre_ids, tag_ids`)
    .in(idColumn, uniqueIds);

  const snapshotMap = new Map<number, CompanyMetricsSnapshot>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = Number(row[idColumn] ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }

    snapshotMap.set(id, {
      id,
      name: String(row[nameColumn] ?? ''),
      gameCount: Number(row.game_count ?? 0),
      totalReviews: Number(row.total_reviews ?? 0),
      avgReviewScore: row.avg_review_score as number | null,
      gamesReleasedLastYear: Number(row.games_released_last_year ?? 0),
      genreIds: normalizeMetricArray(row.genre_ids as number[] | null | undefined),
      tagIds: normalizeMetricArray(row.tag_ids as number[] | null | undefined),
    });
  }

  return snapshotMap;
}

function overlapScore(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  const overlap = left.filter((value) => rightSet.has(value)).length;
  const union = new Set([...left, ...right]).size;

  return union > 0 ? overlap / union : 0;
}

function closenessScore(source: number, candidate: number): number {
  if (!source || !candidate) {
    return 0;
  }

  const sourceLog = Math.log10(source + 1);
  const candidateLog = Math.log10(candidate + 1);
  const distance = Math.abs(sourceLog - candidateLog);

  return Math.max(0, 1 - distance / 3);
}

function buildPortfolioMatchReasons(
  source: CompanyMetricsSnapshot,
  candidate: CompanyMetricsSnapshot,
  genreOverlap: number,
  tagOverlap: number
): string[] {
  const reasons: string[] = [];

  if (genreOverlap >= 0.15) {
    reasons.push('Similar genre footprint');
  }

  if (tagOverlap >= 0.1) {
    reasons.push('Overlapping portfolio tags');
  }

  if (closenessScore(source.totalReviews, candidate.totalReviews) >= 0.5) {
    reasons.push('Comparable review footprint');
  }

  if (closenessScore(source.gameCount, candidate.gameCount) >= 0.6) {
    reasons.push('Similar catalog size');
  }

  if (
    source.avgReviewScore !== null &&
    candidate.avgReviewScore !== null &&
    Math.abs(source.avgReviewScore - candidate.avgReviewScore) <= 5
  ) {
    reasons.push('Similar average review quality');
  }

  if (
    source.gamesReleasedLastYear > 0 &&
    candidate.gamesReleasedLastYear > 0 &&
    Math.abs(source.gamesReleasedLastYear - candidate.gamesReleasedLastYear) <= 2
  ) {
    reasons.push('Similar recent release cadence');
  }

  return reasons.slice(0, 3);
}

async function findSimilarCompaniesFallback(
  entityType: CompanyEntityType,
  reference: { id: number; name: string },
  filters: FindSimilarArgs['filters'] | undefined,
  limit: number
): Promise<FindSimilarResult> {
  const supabase = getServiceSupabase();
  const table = entityType === 'publisher' ? 'publisher_metrics' : 'developer_metrics';
  const idColumn = entityType === 'publisher' ? 'publisher_id' : 'developer_id';
  const nameColumn = entityType === 'publisher' ? 'publisher_name' : 'developer_name';
  const source = await fetchCompanyMetricsSnapshot(entityType, reference.id);

  if (!source) {
    return {
      success: false,
      entityType,
      reference: {
        id: reference.id,
        name: reference.name,
        type: entityType,
      },
      error: `Could not load ${entityType} metrics for "${reference.name}".`,
    };
  }

  const canUseGameEvidence = isQdrantConfigured();
  const sourcePayloads: Partial<Record<'portfolio' | 'identity', Record<string, unknown>>> =
    canUseGameEvidence
      ? await (async () => {
          const [portfolioSource, identitySource] = await Promise.all([
            getEntityVectorAndPayload(entityType, reference.id, 'portfolio'),
            getEntityVectorAndPayload(entityType, reference.id, 'identity'),
          ]);

          return {
            ...(portfolioSource ? { portfolio: portfolioSource.payload as Record<string, unknown> } : {}),
            ...(identitySource ? { identity: identitySource.payload as Record<string, unknown> } : {}),
          };
        })()
      : {};
  let gameEvidenceByCompany = new Map<number, CompanyGameEvidence>();
  if (canUseGameEvidence) {
    try {
      gameEvidenceByCompany = await buildCompanyGameEvidenceMap(entityType, reference, sourcePayloads);
    } catch (error) {
      return buildCompanySimilarityFailure(
        entityType,
        reference,
        'game_evidence_search',
        error
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from(table as any) as any)
    .select(`${idColumn}, ${nameColumn}, game_count, total_reviews, avg_review_score, games_released_last_year, genre_ids, tag_ids`)
    .neq(idColumn, reference.id)
    .order('total_reviews', { ascending: false, nullsFirst: false })
    .limit(Math.max(limit * 8, 40));

  if (source.gameCount > 0) {
    query = query
      .gte('game_count', Math.max(1, Math.floor(source.gameCount / 3)))
      .lte('game_count', Math.max(10, source.gameCount * 3));
  }

  if (filters?.game_count?.gte !== undefined) {
    query = query.gte('game_count', filters.game_count.gte);
  }

  if (filters?.game_count?.lte !== undefined) {
    query = query.lte('game_count', filters.game_count.lte);
  }

  if (filters?.avg_review_percentage?.gte !== undefined) {
    query = query.gte('avg_review_score', filters.avg_review_percentage.gte);
  }

  if (filters?.avg_review_percentage?.lte !== undefined) {
    query = query.lte('avg_review_score', filters.avg_review_percentage.lte);
  }

  if (filters?.is_major === true) {
    query = query.gte('game_count', 10);
  }

  if (filters?.is_major === false) {
    query = query.lt('game_count', 10);
  }

  if (source.genreIds.length > 0) {
    query = query.overlaps('genre_ids', source.genreIds.slice(0, 12));
  } else if (source.tagIds.length > 0) {
    query = query.overlaps('tag_ids', source.tagIds.slice(0, 20));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (query as any);

  if (error || !Array.isArray(data) || data.length === 0) {
    return {
      success: false,
      entityType,
      reference: {
        id: reference.id,
        name: reference.name,
        type: entityType,
      },
      error: `No comparable ${entityType} portfolios were found for "${reference.name}".`,
    };
  }

  const scoredCandidates = data.map((row: Record<string, unknown>) => {
      const candidate: CompanyMetricsSnapshot = {
        id: Number(row[idColumn] ?? 0),
        name: String(row[nameColumn] ?? ''),
        gameCount: Number(row.game_count ?? 0),
        totalReviews: Number(row.total_reviews ?? 0),
        avgReviewScore: row.avg_review_score as number | null,
        gamesReleasedLastYear: Number(row.games_released_last_year ?? 0),
        genreIds: normalizeMetricArray(row.genre_ids as number[] | null | undefined),
        tagIds: normalizeMetricArray(row.tag_ids as number[] | null | undefined),
      };
      const support = buildCompanySimilaritySupport(source, candidate);
      const gameEvidence = gameEvidenceByCompany.get(candidate.id);
      const score = canUseGameEvidence
        ? buildFinalCompanySimilarityScore(
            gameEvidence?.weightedGameEvidenceScore ?? 0,
            support.portfolioScore,
            0,
            support.scaleQualityScore
          )
        : support.portfolioScore;
      const matchReasons = canUseGameEvidence
        ? buildCompanySimilarityMatchReasons(source, candidate, support, gameEvidence, false)
        : buildPortfolioMatchReasons(
            source,
            candidate,
            support.genreOverlap,
            support.tagOverlap
          );

      return {
        candidate,
        score,
        gameEvidence,
        portfolioScore: support.portfolioScore,
        scaleQualityScore: support.scaleQualityScore,
        reviewCloseness: support.reviewCloseness,
        catalogCloseness: support.catalogCloseness,
        matchReasons,
      };
    });

  const rankedResults = scoredCandidates
    .filter((item) => {
      if (canUseGameEvidence) {
        return (
          item.score >= 0.4 &&
          !shouldRejectCompanyCandidate(
            reference.name,
            item.candidate.name,
            0,
            item.portfolioScore,
            item.scaleQualityScore,
            item.reviewCloseness,
            item.catalogCloseness,
            false,
            item.gameEvidence
          )
        );
      }

      return (
        item.score >= 0.35 &&
        !isPlaceholderCompanyName(item.candidate.name) &&
        normalizeCompanyName(reference.name) !== normalizeCompanyName(item.candidate.name)
      );
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  if (rankedResults.length === 0) {
    const relaxedFallback = canUseGameEvidence
      ? scoredCandidates
        .filter((item) => (
          item.portfolioScore >= 0.5 &&
          item.matchReasons.length > 0 &&
          !isPlaceholderCompanyName(item.candidate.name) &&
          normalizeCompanyName(reference.name) !== normalizeCompanyName(item.candidate.name) &&
          !hasLexicalBrandContamination(reference.name, item.candidate.name)
        ))
        .sort((left, right) => right.portfolioScore - left.portfolioScore)
        .slice(0, Math.min(limit, 4))
      : [];

    if (relaxedFallback.length === 0) {
      return {
        success: false,
        entityType,
        reference: {
          id: reference.id,
          name: reference.name,
          type: entityType,
        },
        error: `No comparable ${entityType} portfolios were found for "${reference.name}".`,
      };
    }

    return {
      success: true,
      mode: 'heuristic_portfolio',
      reference: {
        id: reference.id,
        name: reference.name,
        type: entityType,
      },
      results: relaxedFallback.map(({ candidate, portfolioScore, matchReasons }) => ({
        id: candidate.id,
        name: candidate.name,
        score: Math.round(portfolioScore * 100),
        type: entityType,
        game_count: candidate.gameCount,
        review_percentage: candidate.avgReviewScore,
        matchReasons: matchReasons.length > 0 ? matchReasons : ['Comparable portfolio profile'],
      })),
      total_found: relaxedFallback.length,
      sufficient_to_answer: true,
      sufficiency_reason:
        'Returned the smallest useful comparable company set. Respond directly and say the peer set is limited instead of broadening.',
      debug: {
        searchParams: {
          entity_type: entityType,
          reference_id: reference.id,
          fallback: 'heuristic_portfolio',
          relaxedPortfolioOnlyFallback: true,
          gameEvidenceCandidates: gameEvidenceByCompany.size,
        },
      },
    };
  }

  return {
    success: true,
    mode: 'heuristic_portfolio',
    reference: {
      id: reference.id,
      name: reference.name,
      type: entityType,
    },
    results: rankedResults.map(({ candidate, score, matchReasons }) => ({
      id: candidate.id,
      name: candidate.name,
      score: Math.round(score * 100),
      type: entityType,
      game_count: candidate.gameCount,
      review_percentage: candidate.avgReviewScore,
      matchReasons: matchReasons.length > 0 ? matchReasons : ['Comparable portfolio profile'],
    })),
    total_found: rankedResults.length,
    sufficient_to_answer: true,
    sufficiency_reason:
      'Returned comparable company peers that already answer the request. Respond directly instead of broadening to generic rankings.',
    debug: {
      searchParams: {
        entity_type: entityType,
        reference_id: reference.id,
        fallback: 'heuristic_portfolio',
        gameEvidenceCandidates: gameEvidenceByCompany.size,
      },
    },
  };
}

/**
 * Get vector and payload for an entity from Qdrant
 */
async function getEntityVectorAndPayload(
  entityType: EntityType,
  id: number,
  variant?: 'portfolio' | 'identity'
): Promise<{ vector: number[]; payload: Record<string, unknown> } | null> {
  const client = getQdrantClient();
  const collection = getCollectionName(entityType, variant);

  try {
    const result = await client.retrieve(collection, {
      ids: [id],
      with_vector: true,
      with_payload: true,
    });

    if (result.length > 0 && result[0].vector) {
      return {
        vector: result[0].vector as number[],
        payload: (result[0].payload || {}) as Record<string, unknown>,
      };
    }
  } catch {
    // Entity not in Qdrant yet
  }

  return null;
}

function commonPrefixRatio(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let prefixLength = 0;

  while (prefixLength < maxLength && left[prefixLength] === right[prefixLength]) {
    prefixLength++;
  }

  return maxLength > 0 ? prefixLength / maxLength : 0;
}

function significantCompanyTokens(name: string): string[] {
  return normalizeCompanyName(name)
    .split(' ')
    .filter((token) => token.length > 1 && !COMPANY_GENERIC_WORDS.has(token));
}

function isPlaceholderCompanyName(name: string): boolean {
  const normalized = normalizeCompanyName(name);
  const significantTokens = significantCompanyTokens(name);

  return (
    normalized.length < 2 ||
    normalized === '-' ||
    normalized === 'n a' ||
    normalized === 'na' ||
    normalized === 'unknown' ||
    significantTokens.length === 0
  );
}

function hasLexicalBrandContamination(referenceName: string, candidateName: string): boolean {
  const referenceTokens = significantCompanyTokens(referenceName);
  const candidateTokens = significantCompanyTokens(candidateName);

  if (referenceTokens.length === 0 || candidateTokens.length === 0) {
    return false;
  }

  const referencePrimary = referenceTokens[0];
  const candidatePrimary = candidateTokens[0];
  const primaryPrefixRatio = commonPrefixRatio(referencePrimary, candidatePrimary);
  const sharesShortBrandStem =
    referencePrimary.length >= 5 &&
    candidatePrimary.length >= 5 &&
    referencePrimary.slice(0, 3) === candidatePrimary.slice(0, 3);
  const containsPrimary =
    referencePrimary.includes(candidatePrimary) ||
    candidatePrimary.includes(referencePrimary);

  if (referencePrimary === candidatePrimary || containsPrimary) {
    return true;
  }

  return sharesShortBrandStem && primaryPrefixRatio >= 0.45;
}

function uniquePositiveNumbers(values: unknown, limit?: number): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<number>();
  const numbers: number[] = [];

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    numbers.push(value);

    if (limit && numbers.length >= limit) {
      break;
    }
  }

  return numbers;
}

async function fetchCompanyReferenceTitleSeedsFromMetrics(
  entityType: CompanyEntityType,
  companyId: number,
  limit: number
): Promise<number[]> {
  const supabase = getServiceSupabase();
  const table = entityType === 'publisher' ? 'publisher_game_metrics' : 'developer_game_metrics';
  const idColumn = entityType === 'publisher' ? 'publisher_id' : 'developer_id';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from(table as any) as any)
    .select('appid, total_reviews, owners')
    .eq(idColumn, companyId)
    .order('total_reviews', { ascending: false, nullsFirst: false })
    .order('owners', { ascending: false, nullsFirst: false })
    .limit(limit * 3);

  return uniquePositiveNumbers(
    (data ?? []).map((row: Record<string, unknown>) => Number(row.appid ?? 0)),
    limit
  );
}

async function fetchCompanyReferenceTitleSeeds(
  entityType: CompanyEntityType,
  companyId: number,
  payloads: Partial<Record<'portfolio' | 'identity', Record<string, unknown>>>
): Promise<CompanyReferenceTitleSeed[]> {
  const identityPayload = payloads.identity ?? {};
  const payloadAppids = uniquePositiveNumbers(
    identityPayload.top_game_appids,
    MAX_COMPANY_REFERENCE_TITLES
  );
  const flagshipAppid = Number(identityPayload.flagship_game_appid ?? 0);

  const orderedAppids: number[] = [];
  const seen = new Set<number>();
  const pushAppid = (appid: number): void => {
    if (!Number.isFinite(appid) || appid <= 0 || seen.has(appid)) {
      return;
    }
    seen.add(appid);
    orderedAppids.push(appid);
  };

  if (flagshipAppid > 0) {
    pushAppid(flagshipAppid);
  }

  for (const appid of payloadAppids) {
    pushAppid(appid);
  }

  if (orderedAppids.length < MAX_COMPANY_REFERENCE_TITLES) {
    const fallbackAppids = await fetchCompanyReferenceTitleSeedsFromMetrics(
      entityType,
      companyId,
      MAX_COMPANY_REFERENCE_TITLES
    );
    for (const appid of fallbackAppids) {
      pushAppid(appid);
      if (orderedAppids.length >= MAX_COMPANY_REFERENCE_TITLES) {
        break;
      }
    }
  }

  return orderedAppids.slice(0, MAX_COMPANY_REFERENCE_TITLES).map((appid, index) => ({
    appid,
    isFlagship: appid === flagshipAppid || (flagshipAppid <= 0 && index === 0),
  }));
}

function extractCandidateCompanyIdsFromGamePayload(
  entityType: CompanyEntityType,
  payload: Record<string, unknown>
): number[] {
  return entityType === 'publisher'
    ? uniquePositiveNumbers(payload.publisher_ids)
    : uniquePositiveNumbers(payload.developer_ids);
}

function overlapStringScore(left: string[] | undefined, right: string[] | undefined): number {
  if (!left?.length || !right?.length) {
    return 0;
  }

  const rightSet = new Set(right.map((value) => value.toLowerCase()));
  const overlap = left.filter((value) => rightSet.has(value.toLowerCase())).length;
  const union = new Set([
    ...left.map((value) => value.toLowerCase()),
    ...right.map((value) => value.toLowerCase()),
  ]).size;

  return union > 0 ? overlap / union : 0;
}

function scoreGameNeighborEvidence(
  sourcePayload: Record<string, unknown>,
  candidatePayload: Record<string, unknown>,
  rawScore: number
): number {
  const sourceGenres = Array.isArray(sourcePayload.genres)
    ? sourcePayload.genres.filter((value): value is string => typeof value === 'string')
    : [];
  const candidateGenres = Array.isArray(candidatePayload.genres)
    ? candidatePayload.genres.filter((value): value is string => typeof value === 'string')
    : [];
  const sourceTags = Array.isArray(sourcePayload.tags)
    ? sourcePayload.tags.filter((value): value is string => typeof value === 'string')
    : [];
  const candidateTags = Array.isArray(candidatePayload.tags)
    ? candidatePayload.tags.filter((value): value is string => typeof value === 'string')
    : [];
  const genreOverlap = overlapStringScore(sourceGenres, candidateGenres);
  const tagOverlap = overlapStringScore(sourceTags, candidateTags);

  return Math.min(1, rawScore + genreOverlap * 0.08 + tagOverlap * 0.04);
}

function normalizeCompanyGameEvidence(
  accumulators: Map<number, CompanyGameEvidenceAccumulator>
): Map<number, CompanyGameEvidence> {
  const evidenceByCompany = new Map<number, CompanyGameEvidence>();

  for (const [companyId, accumulator] of accumulators.entries()) {
    const referenceScores = [...accumulator.bestScoresByReference.values()];
    if (referenceScores.length === 0) {
      continue;
    }

    const averageScore =
      referenceScores.reduce((sum, score) => sum + score, 0) / referenceScores.length;
    const coverageBonus = referenceScores.length >= 2 ? 0.08 : 0;
    const flagshipBonus = accumulator.flagshipHit ? 0.08 : 0;

    evidenceByCompany.set(companyId, {
      referenceTitleHits: referenceScores.length,
      matchedGameCount: accumulator.matchedGameIds.size,
      weightedGameEvidenceScore: Math.min(1, averageScore + coverageBonus + flagshipBonus),
      flagshipHit: accumulator.flagshipHit,
    });
  }

  return evidenceByCompany;
}

async function buildCompanyGameEvidenceMap(
  entityType: CompanyEntityType,
  reference: { id: number; name: string },
  payloads: Partial<Record<'portfolio' | 'identity', Record<string, unknown>>>
): Promise<Map<number, CompanyGameEvidence>> {
  if (!isQdrantConfigured()) {
    return new Map();
  }

  const referenceSeeds = await fetchCompanyReferenceTitleSeeds(entityType, reference.id, payloads);
  if (referenceSeeds.length === 0) {
    return new Map();
  }

  const client = getQdrantClient();
  const collection = getCollectionName('game');

  const searchGroups = await Promise.all(referenceSeeds.map(async (seed) => {
    const qdrantData = await getEntityVectorAndPayload('game', seed.appid);
    if (!qdrantData) {
      return [];
    }

    const filter = buildGameFilter({
      exclude_delisted: true,
      is_released: true,
      min_reviews: MIN_COMPANY_GAME_EVIDENCE_REVIEWS,
    });

    let searchResult;
    try {
      searchResult = await client.search(collection, {
        vector: qdrantData.vector,
        filter,
        limit: COMPANY_GAME_EVIDENCE_NEIGHBORS,
        with_payload: {
          include: [
            'name',
            'developer_ids',
            'publisher_ids',
            'genres',
            'tags',
            'review_percentage',
            'total_reviews',
          ],
        },
      });
    } catch (error) {
      throw new Error(
        `game_evidence_search: ${entityType} seed ${seed.appid} failed: ${errorMessage(error)}`
      );
    }

    return searchResult
      .filter((point) => point.id !== seed.appid)
      .map((point) => ({
        referenceAppid: seed.appid,
        isFlagship: seed.isFlagship,
        appid: point.id as number,
        score: scoreGameNeighborEvidence(
          qdrantData.payload as Record<string, unknown>,
          (point.payload ?? {}) as Record<string, unknown>,
          point.score
        ),
        payload: (point.payload ?? {}) as Record<string, unknown>,
      }))
      .filter((point) => point.score >= MIN_COMPANY_GAME_EVIDENCE_SCORE);
  }));

  const accumulators = new Map<number, CompanyGameEvidenceAccumulator>();

  for (const group of searchGroups) {
    for (const neighbor of group) {
      const companyIds = extractCandidateCompanyIdsFromGamePayload(entityType, neighbor.payload)
        .filter((id) => id !== reference.id);

      for (const companyId of companyIds) {
        const existing = accumulators.get(companyId) ?? {
          bestScoresByReference: new Map<number, number>(),
          matchedGameIds: new Set<number>(),
          flagshipHit: false,
        };

        const previousBest = existing.bestScoresByReference.get(neighbor.referenceAppid) ?? 0;
        if (neighbor.score > previousBest) {
          existing.bestScoresByReference.set(neighbor.referenceAppid, neighbor.score);
        }

        existing.matchedGameIds.add(neighbor.appid);
        if (neighbor.isFlagship) {
          existing.flagshipHit = true;
        }

        accumulators.set(companyId, existing);
      }
    }
  }

  return normalizeCompanyGameEvidence(accumulators);
}

function mergeGameCountFloor(
  filters: FindSimilarArgs['filters'] | undefined,
  minFloor: number,
  entityType: CompanyEntityType
): EntityFilters {
  const entityFilters: EntityFilters = {};
  const requestedFloor = filters?.game_count?.gte;

  entityFilters.game_count = {
    ...filters?.game_count,
    gte: Math.max(requestedFloor ?? 0, minFloor),
  };

  if (filters?.avg_review_percentage) entityFilters.avg_review_percentage = filters.avg_review_percentage;
  if (filters?.is_major !== undefined) entityFilters.is_major = filters.is_major;
  if (filters?.top_genres) entityFilters.top_genres = filters.top_genres;
  if (filters?.top_tags) entityFilters.top_tags = filters.top_tags;

  if (entityType === 'developer' && filters?.is_indie !== undefined) {
    entityFilters.is_indie = filters.is_indie;
  }

  return entityFilters;
}

function buildIdentityEntityFilter(
  entityType: CompanyEntityType,
  filters: FindSimilarArgs['filters'] | undefined,
  minFloor: number
): EntityFilters {
  const entityFilters: EntityFilters = {
    game_count: {
      ...filters?.game_count,
      gte: Math.max(filters?.game_count?.gte ?? 0, minFloor),
    },
  };

  if (filters?.avg_review_percentage) entityFilters.avg_review_percentage = filters.avg_review_percentage;
  if (filters?.is_major !== undefined) entityFilters.is_major = filters.is_major;

  if (entityType === 'developer' && filters?.is_indie !== undefined) {
    entityFilters.is_indie = filters.is_indie;
  }

  return entityFilters;
}

async function searchCompanyCollection(
  entityType: CompanyEntityType,
  variant: 'portfolio' | 'identity',
  vector: number[],
  filters: FindSimilarArgs['filters'] | undefined,
  limit: number,
  minGameCountFloor: number
): Promise<CompanySearchPoint[]> {
  const client = getQdrantClient();
  const collection = getCollectionName(entityType, variant);
  const entityFilters = variant === 'portfolio'
    ? mergeGameCountFloor(filters, minGameCountFloor, entityType)
    : buildIdentityEntityFilter(entityType, filters, minGameCountFloor);
  const qdrantFilter = buildEntityFilter(entityFilters);
  const payloadFields = variant === 'portfolio'
    ? ['name', 'game_count', 'top_genres', 'top_tags', 'avg_review_percentage', 'is_major', 'is_indie', 'total_reviews']
    : ['name', 'game_count', 'top_game_names', 'top_game_appids', 'top_game_genres', 'flagship_game_appid', 'avg_review_percentage', 'is_major', 'is_indie'];

  let searchResult;
  try {
    searchResult = await client.search(collection, {
      vector,
      filter: qdrantFilter,
      limit,
      with_payload: {
        include: payloadFields,
      },
    });
  } catch (error) {
    throw new Error(
      `company_collection_search: ${entityType}/${variant} failed: ${errorMessage(error)}`
    );
  }

  return searchResult.map((point) => ({
    id: point.id as number,
    score: point.score,
    payload: (point.payload ?? {}) as Record<string, unknown>,
    variant,
  }));
}

function mergeCompanySearchResults(points: CompanySearchPoint[]): CompanyMergedCandidate[] {
  const merged = new Map<number, CompanyMergedCandidate>();

  for (const point of points) {
    const existing = merged.get(point.id) ?? {
      id: point.id,
      semanticScore: 0,
      variantScores: {},
      payloads: {},
    };

    existing.semanticScore = Math.max(existing.semanticScore, point.score);
    existing.variantScores[point.variant] = point.score;
    existing.payloads[point.variant] = point.payload;
    merged.set(point.id, existing);
  }

  return [...merged.values()];
}

function buildCompanySimilaritySupport(
  source: CompanyMetricsSnapshot,
  candidate: CompanyMetricsSnapshot
): CompanySimilaritySupport {
  const genreOverlap = overlapScore(source.genreIds, candidate.genreIds);
  const tagOverlap = overlapScore(source.tagIds, candidate.tagIds);
  const reviewCloseness = closenessScore(source.totalReviews, candidate.totalReviews);
  const catalogCloseness = closenessScore(source.gameCount, candidate.gameCount);
  const qualityCloseness =
    source.avgReviewScore !== null && candidate.avgReviewScore !== null
      ? Math.max(0, 1 - Math.abs(source.avgReviewScore - candidate.avgReviewScore) / 20)
      : 0;
  const cadenceCloseness = closenessScore(source.gamesReleasedLastYear, candidate.gamesReleasedLastYear);

  const portfolioScore =
    genreOverlap * 0.3 +
    tagOverlap * 0.15 +
    reviewCloseness * 0.2 +
    catalogCloseness * 0.15 +
    qualityCloseness * 0.1 +
    cadenceCloseness * 0.1;

  return {
    genreOverlap,
    tagOverlap,
    reviewCloseness,
    catalogCloseness,
    qualityCloseness,
    cadenceCloseness,
    portfolioScore,
    scaleQualityScore:
      reviewCloseness * 0.4 +
      catalogCloseness * 0.25 +
      qualityCloseness * 0.2 +
      cadenceCloseness * 0.15,
  };
}

function buildFinalCompanySimilarityScore(
  gameEvidenceScore: number,
  portfolioScore: number,
  semanticScore: number,
  scaleQualityScore: number
): number {
  return Math.min(
    1,
    gameEvidenceScore * 0.55 +
      portfolioScore * 0.25 +
      semanticScore * 0.1 +
      scaleQualityScore * 0.1
  );
}

function buildCompanySimilarityMatchReasons(
  source: CompanyMetricsSnapshot,
  candidate: CompanyMetricsSnapshot,
  support: CompanySimilaritySupport,
  gameEvidence: CompanyGameEvidence | undefined,
  matchedBothVariants: boolean
): string[] {
  const reasons: string[] = [];

  if (gameEvidence) {
    if (gameEvidence.referenceTitleHits >= 2) {
      reasons.push('Multiple top titles lead to close game-neighbor matches');
    } else if (gameEvidence.flagshipHit) {
      reasons.push('The flagship title has close game-neighbor matches in this portfolio');
    } else if (gameEvidence.matchedGameCount >= 1) {
      reasons.push('A top title has close game-neighbor matches in this portfolio');
    }
  }

  const portfolioReasons = buildPortfolioMatchReasons(
    source,
    candidate,
    support.genreOverlap,
    support.tagOverlap
  );
  for (const reason of portfolioReasons) {
    if (reasons.length >= 3 || reasons.includes(reason)) {
      continue;
    }
    reasons.push(reason);
  }

  if (support.scaleQualityScore >= 0.55 && reasons.length < 3) {
    reasons.push('Comparable scale and review profile');
  }

  if (matchedBothVariants && reasons.length < 3) {
    reasons.push('Matches both company identity and portfolio signals');
  }

  return reasons.slice(0, 3);
}

function hasStrongCompanyGameEvidence(
  gameEvidence: CompanyGameEvidence | undefined,
  portfolioScore: number
): boolean {
  if (!gameEvidence) {
    return false;
  }

  if (gameEvidence.referenceTitleHits >= 2) {
    return true;
  }

  return (
    gameEvidence.referenceTitleHits >= 1 &&
    gameEvidence.weightedGameEvidenceScore >= 0.7 &&
    portfolioScore >= 0.45
  );
}

function extractCompanyGenres(
  payloads: Partial<Record<'portfolio' | 'identity', Record<string, unknown>>>
): string[] | undefined {
  const portfolioGenres = payloads.portfolio?.top_genres;
  if (Array.isArray(portfolioGenres)) {
    return portfolioGenres.filter((value): value is string => typeof value === 'string').slice(0, 3);
  }

  const identityGenres = payloads.identity?.top_game_genres;
  if (Array.isArray(identityGenres)) {
    return identityGenres.filter((value): value is string => typeof value === 'string').slice(0, 3);
  }

  return undefined;
}

function extractCompanyTags(
  payloads: Partial<Record<'portfolio' | 'identity', Record<string, unknown>>>
): string[] | undefined {
  const portfolioTags = payloads.portfolio?.top_tags;
  if (!Array.isArray(portfolioTags)) {
    return undefined;
  }

  const tags = portfolioTags.filter((value): value is string => typeof value === 'string').slice(0, 5);
  return tags.length > 0 ? tags : undefined;
}

function passesCompanySimilarityFilters(
  candidate: CompanyMetricsSnapshot,
  filters: FindSimilarArgs['filters'] | undefined
): boolean {
  if (filters?.game_count?.gte !== undefined && candidate.gameCount < filters.game_count.gte) {
    return false;
  }

  if (filters?.game_count?.lte !== undefined && candidate.gameCount > filters.game_count.lte) {
    return false;
  }

  if (
    filters?.avg_review_percentage?.gte !== undefined &&
    candidate.avgReviewScore !== null &&
    candidate.avgReviewScore < filters.avg_review_percentage.gte
  ) {
    return false;
  }

  if (
    filters?.avg_review_percentage?.lte !== undefined &&
    candidate.avgReviewScore !== null &&
    candidate.avgReviewScore > filters.avg_review_percentage.lte
  ) {
    return false;
  }

  if (filters?.is_major === true && candidate.gameCount < 10) {
    return false;
  }

  if (filters?.is_major === false && candidate.gameCount >= 10) {
    return false;
  }

  return true;
}

function shouldRejectCompanyCandidate(
  referenceName: string,
  candidateName: string,
  _similarityScore: number,
  portfolioScore: number,
  scaleQualityScore: number,
  reviewCloseness: number,
  catalogCloseness: number,
  matchedBothVariants: boolean,
  gameEvidence: CompanyGameEvidence | undefined
): boolean {
  if (isPlaceholderCompanyName(candidateName)) {
    return true;
  }

  const normalizedReference = normalizeCompanyName(referenceName);
  const normalizedCandidate = normalizeCompanyName(candidateName);

  if (!normalizedReference || !normalizedCandidate) {
    return true;
  }

  if (normalizedReference === normalizedCandidate) {
    return true;
  }

  if (!gameEvidence) {
    return true;
  }

  if (!hasStrongCompanyGameEvidence(gameEvidence, portfolioScore)) {
    return true;
  }

  if (scaleQualityScore < 0.32 && gameEvidence.weightedGameEvidenceScore < 0.85) {
    return true;
  }

  if (catalogCloseness < 0.25 && !matchedBothVariants && gameEvidence.weightedGameEvidenceScore < 0.92) {
    return true;
  }

  if (
    scaleQualityScore < 0.4 &&
    (catalogCloseness < 0.4 || reviewCloseness < 0.35) &&
    gameEvidence.weightedGameEvidenceScore < 0.9
  ) {
    return true;
  }

  if (
    hasLexicalBrandContamination(referenceName, candidateName) &&
    (!gameEvidence.flagshipHit || gameEvidence.weightedGameEvidenceScore < (matchedBothVariants ? 0.8 : 0.85))
  ) {
    return true;
  }

  const prefixRatio = commonPrefixRatio(normalizedReference, normalizedCandidate);
  if (prefixRatio >= 0.92 && gameEvidence.weightedGameEvidenceScore < 0.85) {
    return true;
  }

  return false;
}

async function findSimilarCompaniesSemantic(
  entityType: CompanyEntityType,
  reference: { id: number; name: string },
  filters: FindSimilarArgs['filters'] | undefined,
  limit: number,
  actualLimit: number
): Promise<FindSimilarResult | null> {
  const source = await fetchCompanyMetricsSnapshot(entityType, reference.id);
  if (!source) {
    return null;
  }

  const [portfolioSource, identitySource] = await Promise.all([
    getEntityVectorAndPayload(entityType, reference.id, 'portfolio'),
    getEntityVectorAndPayload(entityType, reference.id, 'identity'),
  ]);

  if (!portfolioSource && !identitySource) {
    return null;
  }

  const sourcePayloads: Partial<Record<'portfolio' | 'identity', Record<string, unknown>>> = {
    ...(portfolioSource ? { portfolio: portfolioSource.payload as Record<string, unknown> } : {}),
    ...(identitySource ? { identity: identitySource.payload as Record<string, unknown> } : {}),
  };
  const gameEvidenceByCompany = await buildCompanyGameEvidenceMap(
    entityType,
    reference,
    sourcePayloads
  );

  const requestedFloor = filters?.game_count?.gte ?? 0;
  const defaultFloor = Math.max(requestedFloor, 3);
  const fallbackFloor = Math.max(requestedFloor, 2);
  const searchFloors = defaultFloor === fallbackFloor ? [defaultFloor] : [defaultFloor, fallbackFloor];
  const searchLimit = Math.min(Math.max(actualLimit * 4, 24), MAX_RESULTS);

  for (const minGameCountFloor of searchFloors) {
    const searchTasks: Array<Promise<CompanySearchPoint[]>> = [];

    if (portfolioSource) {
      searchTasks.push(
        searchCompanyCollection(
          entityType,
          'portfolio',
          portfolioSource.vector,
          filters,
          searchLimit,
          minGameCountFloor
        )
      );
    }

    if (identitySource) {
      searchTasks.push(
        searchCompanyCollection(
          entityType,
          'identity',
          identitySource.vector,
          filters,
          searchLimit,
          minGameCountFloor
        )
      );
    }

    if (searchTasks.length === 0) {
      continue;
    }

    const searchResults = await Promise.all(searchTasks);
    const mergedCandidates = mergeCompanySearchResults(searchResults.flat()).filter(
      (candidate) => candidate.id !== reference.id
    );
    const topGameEvidenceCandidateIds = [...gameEvidenceByCompany.entries()]
      .sort((left, right) => right[1].weightedGameEvidenceScore - left[1].weightedGameEvidenceScore)
      .slice(0, searchLimit)
      .map(([candidateId]) => candidateId);
    const candidateIds = [...new Set([
      ...mergedCandidates.map((candidate) => candidate.id),
      ...topGameEvidenceCandidateIds,
    ])].filter((candidateId) => candidateId !== reference.id);

    if (candidateIds.length === 0) {
      continue;
    }
    const mergedCandidateMap = new Map(mergedCandidates.map((candidate) => [candidate.id, candidate]));

    const snapshots = await fetchCompanyMetricsSnapshots(
      entityType,
      candidateIds
    );

    const rankedResults: RankedCompanySimilarityResult[] = [];
    for (const candidateId of candidateIds) {
      const candidate = mergedCandidateMap.get(candidateId);
      const snapshot = snapshots.get(candidateId);
      if (!snapshot || !passesCompanySimilarityFilters(snapshot, filters)) {
        continue;
      }

      const matchedBothVariants =
        candidate?.variantScores.identity !== undefined &&
        candidate?.variantScores.portfolio !== undefined;
      const support = buildCompanySimilaritySupport(source, snapshot);
      const semanticScore = candidate?.semanticScore ?? 0;
      const gameEvidence = gameEvidenceByCompany.get(candidateId);
      const finalScore = buildFinalCompanySimilarityScore(
        gameEvidence?.weightedGameEvidenceScore ?? 0,
        support.portfolioScore,
        semanticScore,
        support.scaleQualityScore
      );

      if (
        shouldRejectCompanyCandidate(
          reference.name,
          snapshot.name,
          semanticScore,
          support.portfolioScore,
          support.scaleQualityScore,
          support.reviewCloseness,
          support.catalogCloseness,
          matchedBothVariants,
          gameEvidence
        )
      ) {
        continue;
      }

      const matchReasons = buildCompanySimilarityMatchReasons(
        source,
        snapshot,
        support,
        gameEvidence,
        matchedBothVariants
      );
      const finalMatchReasons = matchReasons.length > 0
        ? matchReasons
        : ['Comparable portfolio profile'];

      if (finalScore < 0.4) {
        continue;
      }

      rankedResults.push({
        id: snapshot.id,
        name: snapshot.name,
        score: Math.round(finalScore * 100),
        rawScore: Math.round(semanticScore * 100),
        portfolioScore: support.portfolioScore,
        type: entityType,
        game_count: snapshot.gameCount,
        genres: candidate ? extractCompanyGenres(candidate.payloads) : undefined,
        tags: candidate ? extractCompanyTags(candidate.payloads) : undefined,
        review_percentage: snapshot.avgReviewScore,
        is_major: snapshot.gameCount >= 10,
        matchReasons: finalMatchReasons,
        variantScores: candidate?.variantScores ?? {},
      });
    }

    rankedResults.sort((left, right) => right.score - left.score);
    rankedResults.splice(limit);
    const finalResults = rankedResults;

    if (finalResults.length === 0) {
      continue;
    }

    return {
      success: true,
      mode: 'semantic',
      entityType,
      reference: {
        id: reference.id,
        name: reference.name,
        type: entityType,
      },
      results: finalResults.map(({ variantScores: _variantScores, portfolioScore: _portfolioScore, ...candidate }) => candidate),
      total_found: mergedCandidates.length,
      sufficient_to_answer: true,
      sufficiency_reason:
        'Returned comparable company peers that already answer the request. Respond directly instead of broadening to generic rankings.',
      debug: {
        searchParams: {
          entity_type: entityType,
          reference_id: reference.id,
          referenceTitleAppids: sourcePayloads.identity?.top_game_appids ?? [],
          sourceVariants: {
            portfolio: Boolean(portfolioSource),
            identity: Boolean(identitySource),
          },
          gameEvidenceCandidates: gameEvidenceByCompany.size,
          searchLimit,
          appliedGameCountFloor: minGameCountFloor,
          filters,
        },
      },
    };
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
  categories?: string[];
  franchise_names?: string[];
  review_percentage?: number | null;
  total_reviews?: number | null;
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
  categories?: string[];
  franchise_names?: string[];
  name?: string;
  type?: string;
  review_percentage?: number | null;
  total_reviews?: number | null;
  price_cents?: number | null;
  is_free?: boolean;
  steam_deck?: 'unknown' | 'unsupported' | 'playable' | 'verified';
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
  referenceName: string,
  sourcePayload: SourcePayloadForBoost,
  results: Array<{ id: number; score: number; payload: ResultPayloadForBoost }>,
  filters: FindSimilarArgs['filters'] | undefined
): Array<{ id: number; score: number; rawScore: number; payload: ResultPayloadForBoost; matchReasons: string[] }> {
  return results
    .map((result) => {
      let boost = 0;
      let penalty = 0;
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
      const sharedGenres = sharedNormalizedStrings(sourceGenres, resultGenres);
      const sharedInformativeGenres = filterInformativeGameAttributes(sharedGenres);
      if (sourceGenres.length && resultGenres.length) {
        const genreBoostCount = Math.min(sharedGenres.length, SCORE_BOOSTS.MAX_GENRE_BOOSTS);
        boost += genreBoostCount * SCORE_BOOSTS.SHARED_GENRE;
      }

      // Tag boost (+1% each, max 5)
      const sourceTags = sourcePayload.tags || [];
      const resultTags = result.payload.tags || result.payload.top_tags || [];
      const sharedTags = sharedNormalizedStrings(sourceTags, resultTags);
      const sharedInformativeTags = filterInformativeGameAttributes(sharedTags);
      if (sourceTags.length && resultTags.length) {
        const tagBoostCount = Math.min(sharedTags.length, SCORE_BOOSTS.MAX_TAG_BOOSTS);
        boost += tagBoostCount * SCORE_BOOSTS.SHARED_TAG;
      }

      const preferredSharedReasons = [
        ...sharedInformativeTags,
        ...sharedInformativeGenres,
        ...sharedTags,
        ...sharedGenres,
      ];
      for (const reason of preferredSharedReasons) {
        if (!reasons.includes(reason)) {
          reasons.push(reason);
        }
        if (reasons.length >= 4) {
          break;
        }
      }

      const hasStructuralEntityMatch = reasons.some((reason) =>
        reason === 'Same developer' || reason === 'Same publisher' || reason.endsWith('series')
      );
      const strongSimilarityEvidence =
        hasStructuralEntityMatch ||
        sharedInformativeTags.length >= 2 ||
        (sharedInformativeGenres.length > 0 && sharedInformativeTags.length > 0) ||
        sharedInformativeGenres.length >= 2;
      const veryStrongSimilarityEvidence =
        hasStructuralEntityMatch ||
        sharedInformativeTags.length >= 2 ||
        (sharedInformativeGenres.length > 0 && sharedInformativeTags.length > 0) ||
        sharedInformativeGenres.length >= 2 ||
        sharedInformativeTags.length >= 3;
      const mediumSimilarityEvidence =
        strongSimilarityEvidence ||
        sharedInformativeTags.length >= 1 ||
        sharedInformativeGenres.length >= 1 ||
        sharedTags.length >= 2;

      if (sharedInformativeTags.length >= 2) {
        boost += 0.04;
      } else if (sharedInformativeTags.length === 1 && sharedInformativeGenres.length >= 1) {
        boost += 0.025;
      }

      if (strongSimilarityEvidence) {
        boost += 0.05;
      } else if (mediumSimilarityEvidence) {
        boost += 0.02;
      } else {
        penalty += 0.09;
      }

      const hasHardConstraint = Boolean(
        (filters?.steam_deck && filters.steam_deck.length > 0) ||
        (filters?.review_comparison && filters.review_comparison !== 'any') ||
        filters?.review_percentage ||
        filters?.max_reviews !== undefined ||
        filters?.min_reviews !== undefined ||
        (filters?.tags && filters.tags.length > 0) ||
        (filters?.genres && filters.genres.length > 0)
      );
      if (hasHardConstraint && !strongSimilarityEvidence) {
        penalty += 0.08;
      }

      const filterEvidence = buildSimilarityFilterEvidence(sourcePayload, result.payload, filters);
      boost += filterEvidence.bonus;
      penalty += filterEvidence.penalty;
      for (const reason of filterEvidence.reasons) {
        if (!reasons.includes(reason)) {
          reasons.push(reason);
        }
      }

      boost += reviewSupportBonus(
        asOptionalNullableNumber(result.payload.total_reviews),
        asOptionalNullableNumber(result.payload.review_percentage)
      );

      const suspiciousTitlePenalty =
        result.payload.name &&
        hasSuspiciousGameTitleOverlap(referenceName, result.payload.name) &&
        !strongSimilarityEvidence
          ? 0.18
          : 0;
      const candidateTotalReviews = asOptionalNullableNumber(result.payload.total_reviews);
      const lowSignal = lowSignalPenalty(
        candidateTotalReviews,
        asOptionalNullableNumber(result.payload.review_percentage)
      );

      // Cap total boost
      boost = Math.min(boost, SCORE_BOOSTS.MAX_TOTAL_BOOST);
      const adjustedScore = Math.max(
        0,
        Math.min(result.score + boost - penalty - suspiciousTitlePenalty - lowSignal, 1.0)
      );
      const hardReject =
        filterEvidence.hardReject ||
        (
          Boolean(suspiciousTitlePenalty) &&
          !veryStrongSimilarityEvidence
        ) ||
        (
          filters?.review_comparison !== undefined &&
          filters.review_comparison !== 'any' &&
          !veryStrongSimilarityEvidence &&
          sharedInformativeTags.length === 0 &&
          sharedInformativeGenres.length === 0
        ) ||
        (
          filters?.review_comparison !== undefined &&
          filters.review_comparison !== 'any' &&
          !hasStructuralEntityMatch &&
          sharedInformativeTags.length === 0 &&
          result.score < 0.78
        ) ||
        (
          filters?.review_comparison !== undefined &&
          filters.review_comparison !== 'any' &&
          candidateTotalReviews !== null &&
          candidateTotalReviews !== undefined &&
          candidateTotalReviews < 100 &&
          !hasStructuralEntityMatch &&
          sharedInformativeTags.length < 2
        ) ||
        (!mediumSimilarityEvidence && adjustedScore < 0.68);

      return {
        id: result.id,
        score: adjustedScore,
        rawScore: result.score,
        payload: result.payload,
        matchReasons: reasons.slice(0, 4),
        hardReject,
      };
    })
    .filter((item) => !item.hardReject)
    .sort((a, b) => b.score - a.score);
}

/**
 * Execute similarity search
 */
export async function findSimilar(args: FindSimilarArgs): Promise<FindSimilarResult> {
  const normalizedArgs = normalizeFindSimilarArgs(args);
  const { entity_type, reference_id, reference_name, filters, limit = DEFAULT_RESULTS } = normalizedArgs;
  const requestedLimit = entity_type === 'game' ? limit : Math.min(limit, DEFAULT_COMPANY_RESULTS);
  // Request one extra for publishers/developers since we filter client-side
  const extraForFilter = entity_type !== 'game' ? 1 : 0;
  const actualLimit = Math.min(requestedLimit + extraForFilter, MAX_RESULTS);

  if (reference_id === undefined && (!reference_name || reference_name.trim().length === 0)) {
    return {
      success: false,
      error: 'reference_id or reference_name is required.',
    };
  }

  let companyResolution:
    | Awaited<ReturnType<typeof resolveCompanyReference>>
    | null = null;

  if (
    entity_type !== 'game' &&
    reference_id === undefined &&
    reference_name &&
    reference_name.trim().length > 0
  ) {
    companyResolution = await resolveCompanyReference(entity_type, reference_name, 5);

    if (companyResolution.results.length === 0) {
      return {
        success: false,
        error: `Could not find ${entity_type} named "${reference_name}". Try a different name or check spelling.`,
      };
    }

    if (companyResolution.needsDisambiguation) {
      return {
        success: false,
        entityType: entity_type,
        candidates: companyResolution.results,
        error: companyResolution.error ?? `The ${entity_type} name "${reference_name}" is ambiguous.`,
      };
    }
  }

  // Look up the reference entity
  let entity =
    typeof reference_id === 'number' && Number.isFinite(reference_id)
      ? await lookupEntityById(entity_type, reference_id)
      : entity_type !== 'game' && companyResolution?.canonicalResult
        ? {
            id: companyResolution.canonicalResult.id,
            name: companyResolution.canonicalResult.name,
            type: entity_type,
          }
        : reference_name && reference_name.trim().length > 0
          ? await lookupEntityByName(entity_type, reference_name)
          : null;

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

  // Check if Qdrant is configured
  if (!isQdrantConfigured()) {
    return entity_type === 'game'
      ? {
          success: false,
          error: 'Similarity search not configured. QDRANT_URL and QDRANT_API_KEY must be set.',
        }
      : findSimilarCompaniesFallback(entity_type, entity, filters, requestedLimit);
  }

  if (entity_type !== 'game') {
    let semanticFailure: FindSimilarResult | null = null;
    let sparseSemanticResult: FindSimilarResult | null = null;

    try {
      const semanticCompanyResult = await findSimilarCompaniesSemantic(
        entity_type,
        entity,
        filters,
        requestedLimit,
        actualLimit
      );

      if (semanticCompanyResult?.success && semanticCompanyResult.results && semanticCompanyResult.results.length > 0) {
        if (semanticCompanyResult.results.length >= MIN_USEFUL_COMPANY_SIMILARITY_RESULTS) {
          return semanticCompanyResult;
        }

        sparseSemanticResult = {
          ...semanticCompanyResult,
          debug: {
            searchParams: {
              ...(semanticCompanyResult.debug?.searchParams ?? {}),
              semanticSparseFallbackTriggered: true,
              semanticResultCount: semanticCompanyResult.results.length,
              minimumUsefulPeerCount: MIN_USEFUL_COMPANY_SIMILARITY_RESULTS,
            },
          },
        };
      }
    } catch (searchError) {
      semanticFailure = buildCompanySimilarityFailure(
        entity_type,
        entity,
        errorMessage(searchError).startsWith('company_collection_search:')
          ? 'company_collection_search'
          : 'game_evidence_search',
        searchError
      );
      console.error('Company similarity search error:', semanticFailure);
    }

    let fallbackResult: FindSimilarResult;
    try {
      fallbackResult = await findSimilarCompaniesFallback(entity_type, entity, filters, requestedLimit);
    } catch (searchError) {
      fallbackResult = buildCompanySimilarityFailure(
        entity_type,
        entity,
        'company_similarity_fallback',
        searchError
      );
    }
    if (fallbackResult.success || !semanticFailure) {
      if (fallbackResult.success) {
        fallbackResult = {
          ...fallbackResult,
          debug: {
            searchParams: {
              ...(fallbackResult.debug?.searchParams ?? {}),
              semanticSparseFallbackTriggered:
                sparseSemanticResult?.debug?.searchParams?.semanticSparseFallbackTriggered === true,
              semanticResultCount:
                sparseSemanticResult?.debug?.searchParams?.semanticResultCount ?? null,
              minimumUsefulPeerCount: MIN_USEFUL_COMPANY_SIMILARITY_RESULTS,
            },
          },
        };
      }
      return fallbackResult;
    }

    if (sparseSemanticResult) {
      return sparseSemanticResult;
    }

    return {
      ...fallbackResult,
      error: fallbackResult.error ?? semanticFailure.error,
      debug: {
        searchParams: {
          ...(fallbackResult.debug?.searchParams ?? {}),
          semanticFailureStage: semanticFailure.debug?.searchParams?.failureStage ?? null,
        },
      },
    };
  }

  // Get vector and payload for the entity from Qdrant
  let qdrantData = await getEntityVectorAndPayload(entity_type, entity.id);

  if (
    entity_type === 'game' &&
    filters?.same_franchise_only === true &&
    qdrantData &&
    (!asOptionalNumberArray(qdrantData.payload.franchise_ids) ||
      asOptionalNumberArray(qdrantData.payload.franchise_ids)?.length === 0) &&
    reference_name &&
    reference_name.trim().length > 0
  ) {
    const franchiseAwareReference = await lookupGameReferenceWithFranchiseMetadata(
      reference_name,
      entity.id
    );

    if (franchiseAwareReference) {
      entity = franchiseAwareReference.entity;
      qdrantData = franchiseAwareReference.qdrantData;
    }
  }

  if (!qdrantData) {
    return entity_type === 'game'
      ? {
          success: false,
          error: `${entity.name} hasn't been indexed for similarity search yet. Try another ${entity_type}.`,
        }
      : findSimilarCompaniesFallback(entity_type, entity, filters, requestedLimit);
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
    if (filters.max_reviews !== undefined) gameFilters.max_reviews = filters.max_reviews;
    if (filters.review_percentage) gameFilters.review_percentage = filters.review_percentage;
    if (filters.release_year) gameFilters.release_year = filters.release_year;
    if (filters.review_comparison) gameFilters.review_comparison = filters.review_comparison;

    // Get source metrics for relative comparisons
    // Use Qdrant payload for total_reviews (used for popularity comparison)
    // Use Supabase data for other metrics
    const sourceMetrics = {
      total_reviews: asOptionalNullableNumber(sourcePayload.total_reviews),
      review_percentage:
        asOptionalNumber(sourcePayload.review_percentage) ??
        (entity.metrics as { review_percentage?: number })?.review_percentage,
      price_cents:
        asOptionalNumber(sourcePayload.price_cents) ??
        (entity.metrics as { price_cents?: number })?.price_cents,
      publisher_ids:
        asOptionalNumberArray(sourcePayload.publisher_ids) ??
        (entity.metrics as { publisher_ids?: number[] })?.publisher_ids,
      developer_ids:
        asOptionalNumberArray(sourcePayload.developer_ids) ??
        (entity.metrics as { developer_ids?: number[] })?.developer_ids,
      franchise_ids: asOptionalNumberArray(sourcePayload.franchise_ids),
    };

    if (filters.same_franchise_only) {
      if (!sourceMetrics.franchise_ids || sourceMetrics.franchise_ids.length === 0) {
        return {
          success: false,
          reference: {
            id: entity.id,
            name: entity.name,
            type: entity.type || entity_type,
          },
          error: `Exact same-series matching is not available for "${entity.name}" because franchise metadata is missing.`,
        };
      }
      gameFilters.same_franchise_only = true;
    }

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
    const entityFilters: EntityFilters = {};

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
        'name', 'type', 'genres', 'tags', 'categories', 'review_percentage', 'total_reviews', 'price_cents', 'is_free', 'steam_deck',
        'franchise_ids', 'franchise_names', 'developer_ids', 'publisher_ids', // For hybrid scoring
      ]
    : ['name', 'game_count', 'top_genres', 'top_tags', 'avg_review_percentage', 'is_major'];
  const searchLimit = entity_type === 'game'
    ? Math.min(Math.max(actualLimit * 5, 30), MAX_RESULTS)
    : actualLimit;

  let searchResult;
  try {
    searchResult = await client.search(collection, {
      vector,
      filter: qdrantFilter,
      limit: searchLimit,
      with_payload: {
        include: payloadFields,
      },
    });
  } catch (searchError) {
    console.error('Qdrant search error:', searchError);
    return entity_type === 'game'
      ? {
          success: false,
          error: `Search failed: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
        }
      : findSimilarCompaniesFallback(entity_type, entity, filters, limit);
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
      entity.name,
      sourcePayload as SourcePayloadForBoost,
      rawResults,
      filters
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
      total_reviews: item.payload.total_reviews as number | null | undefined,
      price_cents: item.payload.price_cents as number | null | undefined,
      is_free: item.payload.is_free as boolean | undefined,
      steam_deck: item.payload.steam_deck as SimilarEntity['steam_deck'],
      matchReasons: item.matchReasons.length > 0 ? item.matchReasons : undefined,
    }));

    if (filters?.same_franchise_only === true && results.length === 0) {
      results = await findSameSeriesByTitleTokens(entity, limit);
    }
  } else {
    results = [];
  }

  return {
    success: true,
    mode: 'semantic',
    reference: {
      id: entity.id,
      name: entity.name,
      type: entity.type || entity_type,
    },
    results,
    total_found: searchResult.length,
    sufficient_to_answer: results.length > 0,
    sufficiency_reason:
      results.length > 0
        ? entity_type === 'game'
          ? 'Returned similarity rows that already answer the request. Respond directly instead of calling an adjacent discovery tool.'
          : 'Returned comparable peers that already answer the request. Respond directly instead of broadening.'
        : undefined,
    debug: {
      searchParams: {
        collection,
        entity_type,
        reference_id: entity.id,
        filters,
        limit: requestedLimit,
        searchLimit,
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
    max_reviews?: number;
    release_year?: { gte?: number; lte?: number };
    review_percentage?: { gte?: number; lte?: number };
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
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
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

  const normalizedArgs = normalizeSearchByConceptArgs(args);
  const { description, filters, limit = DEFAULT_RESULTS } = normalizedArgs;
  const actualLimit = Math.min(limit, MAX_RESULTS);
  const searchDescription = buildConceptSearchDescription(description);

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
    queryVector = await generateQueryEmbedding(searchDescription);
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
    if (filters.max_reviews !== undefined) gameFilters.max_reviews = filters.max_reviews;
    if (filters.release_year) gameFilters.release_year = filters.release_year;
    if (filters.review_percentage) gameFilters.review_percentage = filters.review_percentage;
  }

  applyImplicitConceptFilters(description, filters, gameFilters);

  const qdrantFilter = buildGameFilter(gameFilters);
  const searchLimit = Math.min(Math.max(actualLimit * 5, 30), MAX_RESULTS);

  // Execute search
  const client = getQdrantClient();
  const collection = COLLECTIONS.GAMES;

  const payloadFields = [
    'name', 'type', 'genres', 'tags', 'categories', 'review_percentage', 'total_reviews', 'price_cents', 'is_free', 'steam_deck',
  ];

  let searchResult;
  try {
    searchResult = await client.search(collection, {
      vector: queryVector,
      filter: qdrantFilter,
      limit: searchLimit,
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
  const rerankedResults = searchResult
    .map((point) => {
      const payload = (point.payload ?? {}) as Record<string, unknown>;
      const conceptEvidence = buildConceptEvidence(description, payload);
      const adjustedScore = Math.max(
        0,
        Math.min(point.score + conceptEvidence.bonus - conceptEvidence.penalty, 1.0)
      );

      return {
        id: point.id as number,
        score: adjustedScore,
        rawScore: point.score,
        payload,
        matchReasons: conceptEvidence.reasons,
        matchedFacetCount: conceptEvidence.matchedFacetCount,
        facetCount: conceptEvidence.facetCount,
        hardReject: conceptEvidence.hardReject,
      };
    })
    .filter((item) => !item.hardReject)
    .sort((left, right) => right.score - left.score);

  const preferredResults = rerankedResults.filter((item) => {
    const minimumFacetMatches = item.facetCount >= 2 ? 2 : item.facetCount >= 1 ? 1 : 0;
    return item.matchedFacetCount >= minimumFacetMatches || item.score >= 0.78;
  });
  const finalResults =
    preferredResults.length >= Math.min(actualLimit, 5)
      ? preferredResults
      : rerankedResults.filter((item) => item.score >= 0.45 || item.matchedFacetCount >= 1);

  const results: SimilarEntity[] = finalResults.slice(0, actualLimit).map((item) => ({
    id: item.id,
    name: asOptionalString(item.payload.name) || 'Unknown',
    score: Math.round(item.score * 100),
    rawScore: Math.round(item.rawScore * 100),
    type: item.payload.type as string | undefined,
    genres: (item.payload.genres as string[] | undefined)?.slice(0, 3),
    tags: (item.payload.tags as string[] | undefined)?.slice(0, 5),
    review_percentage: item.payload.review_percentage as number | null | undefined,
    total_reviews: item.payload.total_reviews as number | null | undefined,
    price_cents: item.payload.price_cents as number | null | undefined,
    is_free: item.payload.is_free as boolean | undefined,
    steam_deck: item.payload.steam_deck as SimilarEntity['steam_deck'],
    matchReasons: item.matchReasons.length > 0 ? item.matchReasons : undefined,
  }));

  return {
    success: true,
    query_description: description,
    results,
    total_found: searchResult.length,
    sufficient_to_answer: results.length > 0,
    sufficiency_reason:
      results.length > 0
        ? 'Returned concept matches that already satisfy the request. Respond from these rows instead of broadening into a second discovery pass.'
        : undefined,
  };
}

export async function searchByConceptWithTimeout(
  args: SearchByConceptArgs
): Promise<SearchByConceptResult> {
  return withSearchTimeout('Concept similarity search', () => searchByConcept(args));
}
