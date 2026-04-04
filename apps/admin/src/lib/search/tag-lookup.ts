/**
 * Tag/Genre/Category Lookup Service
 *
 * System-only taxonomy lookup for chat, while keeping cached lists for autocomplete.
 */

import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import { postToQueryApi } from '@/lib/query-api-client';
import { getServiceSupabase } from '@/lib/supabase-service';

interface TagRow {
  id: number;
  name: string;
}

interface TagCache {
  tags: TagRow[];
  genres: string[];
  categories: string[];
  loadedAt: number;
}

let tagCache: TagCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

const TIGER_LOOKUP_TAGS_PROVENANCE: ChatExecutionProvenanceOverride = {
  backendKinds: ['tiger_query_api'],
  dataSources: [
    'query_api:searchCatalog',
    'relation:steam_tags',
    'relation:steam_genres',
    'relation:steam_categories',
  ],
  migrationDisposition: 'already_tiger',
  migrationNotes:
    'Explicit tag and taxonomy lookup now runs through the system search-catalog facet lookup instead of direct Supabase reads.',
  recommendedTigerContracts: ['searchCatalog'],
};

async function getTagCache(): Promise<TagCache> {
  if (tagCache && Date.now() - tagCache.loadedAt < CACHE_TTL_MS) {
    return tagCache;
  }

  const supabase = getServiceSupabase();
  const [tagsResult, genresResult, categoriesResult] = await Promise.all([
    supabase.from('steam_tags').select('tag_id, name').order('name'),
    supabase.from('steam_genres').select('name').order('name'),
    supabase.from('steam_categories').select('name').order('name'),
  ]);

  tagCache = {
    tags: (tagsResult.data || [])
      .map((tag) => ({
        id: Number(tag.tag_id ?? 0),
        name: tag.name,
      }))
      .filter((tag) => Number.isFinite(tag.id) && tag.id > 0 && typeof tag.name === 'string'),
    genres: (genresResult.data || []).map((genre) => genre.name),
    categories: (categoriesResult.data || []).map((category) => category.name),
    loadedAt: Date.now(),
  };

  return tagCache;
}

export interface LookupTagsArgs {
  query: string;
  type?: 'tags' | 'genres' | 'categories' | 'all';
  limit?: number;
}

export interface LookupTagsResult {
  success: boolean;
  query: string;
  found?: number;
  canonicalMatch?: {
    type: 'tag' | 'genre' | 'category';
    name: string;
  };
  adjacentTags?: string[];
  results: {
    tags?: string[];
    genres?: string[];
    categories?: string[];
  };
  debug?: Record<string, unknown>;
  error?: string;
  unavailable?: boolean;
}

interface TigerCatalogFacetResponse {
  facets?: {
    canonicalMatch?: {
      name: string;
      type: 'categories' | 'genres' | 'tags';
    } | null;
    categories?: string[];
    genres?: string[];
    tags?: string[];
  } | null;
}

function lookupTypeToFacetKinds(
  type: LookupTagsArgs['type']
): Array<'categories' | 'genres' | 'tags'> {
  if (type === 'tags') return ['tags'];
  if (type === 'genres') return ['genres'];
  if (type === 'categories') return ['categories'];
  return ['tags', 'genres', 'categories'];
}

async function tryTigerLookupTags(args: LookupTagsArgs): Promise<LookupTagsResult | null> {
  const includeFacets = lookupTypeToFacetKinds(args.type ?? 'all');
  const response = await postToQueryApi<TigerCatalogFacetResponse>(
    '/v1/contracts/search-catalog',
    {
      facetQuery: args.query,
      includeFacets,
      limit: Math.min(args.limit ?? 10, 20),
    }
  );

  if (!response.ok || !response.data) {
    return null;
  }

  const facets = response.data.facets;
  const results: LookupTagsResult['results'] = {
    ...(includeFacets.includes('tags') ? { tags: facets?.tags ?? [] } : {}),
    ...(includeFacets.includes('genres') ? { genres: facets?.genres ?? [] } : {}),
    ...(includeFacets.includes('categories') ? { categories: facets?.categories ?? [] } : {}),
  };
  const found = Object.values(results).reduce((count, bucket) => count + (bucket?.length ?? 0), 0);
  const canonicalMatch: LookupTagsResult['canonicalMatch'] = facets?.canonicalMatch
    ? {
        name: facets.canonicalMatch.name,
        type:
          facets.canonicalMatch.type === 'tags'
            ? 'tag'
            : facets.canonicalMatch.type === 'genres'
              ? 'genre'
              : 'category',
      }
    : undefined;

  return attachToolExecutionProvenance(
    {
      success: true,
      query: args.query,
      found,
      canonicalMatch,
      results,
    },
    TIGER_LOOKUP_TAGS_PROVENANCE
  );
}

export async function lookupTags(args: LookupTagsArgs): Promise<LookupTagsResult> {
  const { query, type = 'all', limit = 10 } = args;

  if (!query || query.trim().length === 0) {
    return {
      success: false,
      query,
      results: {},
      error: 'Query is required',
    };
  }

  try {
    const tigerResult = await tryTigerLookupTags({ query, type, limit });
    if (tigerResult) {
      return tigerResult;
    }

    return {
      success: false,
      query,
      results: {},
      unavailable: true,
      error:
        'Catalog facet lookup could not serve this lookup_tags request. Ask for specific tags, genres, or categories with a narrower taxonomy query.',
    };
  } catch (error) {
    return {
      success: false,
      query,
      results: {},
      error: error instanceof Error ? error.message : 'Failed to lookup tags',
    };
  }
}

export async function getAllTags(): Promise<string[]> {
  const cache = await getTagCache();
  return cache.tags.map((tag) => tag.name);
}

export async function getAllGenres(): Promise<string[]> {
  const cache = await getTagCache();
  return cache.genres;
}

export async function getAllCategories(): Promise<string[]> {
  const cache = await getTagCache();
  return cache.categories;
}
