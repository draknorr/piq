import 'server-only';

import type { Platform, PopularityComparison, ReviewComparison } from '@publisheriq/qdrant';

import { postToQueryApi } from '@/lib/query-api-client';

export const QDRANT_SEARCH_TIMEOUT_MS = 10000;
export const QDRANT_TIMEOUT_ERROR = 'Similarity search timed out. Please try again.';

export interface FindSimilarArgs {
  entity_type: 'developer' | 'game' | 'publisher';
  filters?: {
    avg_review_percentage?: { gte?: number; lte?: number };
    game_count?: { gte?: number; lte?: number };
    genres?: string[];
    is_free?: boolean;
    is_indie?: boolean;
    is_major?: boolean;
    max_price_cents?: number;
    max_reviews?: number;
    min_reviews?: number;
    platforms?: Platform[];
    popularity_comparison?: PopularityComparison;
    release_year?: { gte?: number; lte?: number };
    review_comparison?: ReviewComparison;
    review_percentage?: { gte?: number; lte?: number };
    same_franchise_only?: boolean;
    steam_deck?: ('playable' | 'verified')[];
    tags?: string[];
    top_genres?: string[];
    top_tags?: string[];
  };
  limit?: number;
  reference_id?: number;
  reference_name?: string;
}

export interface SimilarEntity {
  avg_review_percentage?: number | null;
  game_count?: number;
  genres?: string[];
  id: number;
  is_free?: boolean;
  is_indie?: boolean;
  is_major?: boolean;
  matchReasons?: string[];
  name: string;
  price_cents?: number | null;
  rawScore?: number;
  review_percentage?: number | null;
  score: number;
  steam_deck?: 'playable' | 'unknown' | 'unsupported' | 'verified';
  tags?: string[];
  top_genres?: string[];
  top_tags?: string[];
  total_reviews?: number | null;
  type?: string;
}

export interface FindSimilarResult {
  candidates?: Array<{
    id: number;
    name: string;
  }>;
  continuation_token?: string | null;
  debug?: {
    searchParams?: Record<string, unknown>;
    vectorFilter?: Record<string, unknown>;
  };
  entityType?: 'developer' | 'publisher';
  error?: string;
  mode?: 'heuristic_portfolio' | 'semantic';
  reference?: {
    id: number;
    name: string;
    type: string;
  };
  results?: SimilarEntity[];
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  success: boolean;
  total_found?: number;
}

export interface SearchByConceptArgs {
  description: string;
  filters?: {
    genres?: string[];
    is_free?: boolean;
    max_price_cents?: number;
    max_reviews?: number;
    min_reviews?: number;
    platforms?: Platform[];
    release_year?: { gte?: number; lte?: number };
    review_percentage?: { gte?: number; lte?: number };
    steam_deck?: ('playable' | 'verified')[];
    tags?: string[];
  };
  limit?: number;
}

export interface SearchByConceptResult extends FindSimilarResult {
  query_description?: string;
}

interface SemanticSearchRequestBody {
  description?: string | null;
  entityKind: 'developer' | 'game' | 'publisher';
  filters?: Record<string, unknown>;
  limit?: number;
  mode: 'concept' | 'similarity';
  referencePlatformEntityId?: string | null;
  referenceQuery?: string | null;
}

function normalizeReason(reason: string | null | undefined): string {
  if (!reason) {
    return 'Unknown query-api error';
  }

  if (
    reason.includes('This operation was aborted') ||
    reason.includes('The operation was aborted') ||
    reason.includes('TimeoutError')
  ) {
    return QDRANT_TIMEOUT_ERROR;
  }

  return reason;
}

async function callSemanticSearch<T extends FindSimilarResult>(
  body: SemanticSearchRequestBody
): Promise<T> {
  const response = await postToQueryApi<T>('/v1/contracts/semantic-search', body, {
    timeoutMs: QDRANT_SEARCH_TIMEOUT_MS,
  });

  if (!response.ok || !response.data) {
    return {
      error: normalizeReason(response.reason),
      success: false,
    } as T;
  }

  return response.data;
}

export async function findSimilar(args: FindSimilarArgs): Promise<FindSimilarResult> {
  return callSemanticSearch<FindSimilarResult>({
    entityKind: args.entity_type,
    filters: args.filters,
    limit: args.limit,
    mode: 'similarity',
    referencePlatformEntityId:
      typeof args.reference_id === 'number' && Number.isFinite(args.reference_id)
        ? String(args.reference_id)
        : null,
    referenceQuery: args.reference_name?.trim() || null,
  });
}

export async function findSimilarWithTimeout(args: FindSimilarArgs): Promise<FindSimilarResult> {
  return findSimilar(args);
}

export async function searchByConcept(
  args: SearchByConceptArgs
): Promise<SearchByConceptResult> {
  return callSemanticSearch<SearchByConceptResult>({
    description: args.description,
    entityKind: 'game',
    filters: args.filters,
    limit: args.limit,
    mode: 'concept',
  });
}

export async function searchByConceptWithTimeout(
  args: SearchByConceptArgs
): Promise<SearchByConceptResult> {
  return searchByConcept(args);
}
