/**
 * Tag/Genre/Category Lookup Service
 *
 * Provides fast in-memory cached lookups for Steam tags, genres, and categories.
 * Cache is loaded on first request and refreshed every hour.
 */

import { getServiceSupabase } from '@/lib/supabase-service';

interface TagRow {
  id: number;
  name: string;
}

// Cache structure
interface TagCache {
  tags: TagRow[];
  genres: string[];
  categories: string[];
  tagNameById: Map<number, string>;
  loadedAt: number;
}

let tagCache: TagCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const ADJACENT_TAG_SAMPLE_LIMIT = 1500;
const GENERIC_ADJACENT_TAGS = new Set([
  'indie',
  'singleplayer',
  'multiplayer',
  'simulation',
  'strategy',
  'action',
  'adventure',
  'rpg',
  'casual',
  '2d',
  '3d',
  'early access',
]);

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

/**
 * Load or return cached tag/genre/category data
 */
async function getTagCache(): Promise<TagCache> {
  // Return cached data if still valid
  if (tagCache && Date.now() - tagCache.loadedAt < CACHE_TTL_MS) {
    return tagCache;
  }

  const supabase = getServiceSupabase();

  // Load all in parallel
  const [tagsResult, genresResult, categoriesResult] = await Promise.all([
    supabase.from('steam_tags').select('tag_id, name').order('name'),
    supabase.from('steam_genres').select('name').order('name'),
    supabase.from('steam_categories').select('name').order('name'),
  ]);

  const tags = (tagsResult.data || [])
    .map((tag) => ({
      id: Number(tag.tag_id ?? 0),
      name: tag.name,
    }))
    .filter((tag) => Number.isFinite(tag.id) && tag.id > 0 && typeof tag.name === 'string');

  tagCache = {
    tags,
    genres: (genresResult.data || []).map((g) => g.name),
    categories: (categoriesResult.data || []).map((c) => c.name),
    tagNameById: new Map(tags.map((tag) => [tag.id, tag.name])),
    loadedAt: Date.now(),
  };

  return tagCache;
}

/**
 * Arguments for lookup_tags tool
 */
export interface LookupTagsArgs {
  query: string;
  type?: 'tags' | 'genres' | 'categories' | 'all';
  limit?: number;
}

/**
 * Result from lookup_tags
 */
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
}

function findExactMatch(
  query: string,
  items: string[]
): string | null {
  const normalizedQuery = normalizeLookupValue(query);
  return items.find((item) => normalizeLookupValue(item) === normalizedQuery) ?? null;
}

function findExactTagRow(
  query: string,
  tags: TagRow[]
): TagRow | null {
  const normalizedQuery = normalizeLookupValue(query);
  return tags.find((tag) => normalizeLookupValue(tag.name) === normalizedQuery) ?? null;
}

async function fetchAdjacentTags(
  tagId: number,
  cache: TagCache,
  limit: number
): Promise<string[]> {
  const supabase = getServiceSupabase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('app_filter_data') as any)
    .select('tag_ids')
    .contains('tag_ids', [tagId])
    .limit(ADJACENT_TAG_SAMPLE_LIMIT);

  if (error || !Array.isArray(data)) {
    return [];
  }

  const counts = new Map<number, number>();
  for (const row of data as Array<{ tag_ids?: number[] | null }>) {
    for (const otherTagId of row.tag_ids ?? []) {
      if (!Number.isFinite(otherTagId) || otherTagId === tagId) {
        continue;
      }
      counts.set(otherTagId, (counts.get(otherTagId) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([otherTagId]) => cache.tagNameById.get(otherTagId) ?? null)
    .filter((name): name is string => Boolean(name))
    .filter((name) => !GENERIC_ADJACENT_TAGS.has(normalizeLookupValue(name)))
    .slice(0, Math.min(limit, 5));
}

/**
 * Search for matching tags, genres, and/or categories
 */
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
    const cache = await getTagCache();
    const queryLower = query.toLowerCase().trim();
    const maxResults = Math.min(limit, 20); // Hard cap at 20

    // Filter function - case-insensitive contains
    const matches = (items: string[]): string[] =>
      items.filter((item) => item.toLowerCase().includes(queryLower)).slice(0, maxResults);

    const results: LookupTagsResult['results'] = {};
    const exactTag = (type === 'all' || type === 'tags')
      ? findExactTagRow(query, cache.tags)
      : null;
    const exactGenre = (type === 'all' || type === 'genres')
      ? findExactMatch(query, cache.genres)
      : null;
    const exactCategory = (type === 'all' || type === 'categories')
      ? findExactMatch(query, cache.categories)
      : null;

    if (type === 'all' || type === 'tags') {
      results.tags = matches(cache.tags.map((tag) => tag.name));
    }
    if (type === 'all' || type === 'genres') {
      results.genres = matches(cache.genres);
    }
    if (type === 'all' || type === 'categories') {
      results.categories = matches(cache.categories);
    }

    let canonicalMatch: LookupTagsResult['canonicalMatch'];
    if (exactTag) {
      canonicalMatch = { type: 'tag', name: exactTag.name };
    } else if (exactGenre) {
      canonicalMatch = { type: 'genre', name: exactGenre };
    } else if (exactCategory) {
      canonicalMatch = { type: 'category', name: exactCategory };
    }

    const adjacentTags = exactTag
      ? await fetchAdjacentTags(exactTag.id, cache, maxResults)
      : [];
    const found = Object.values(results).reduce((count, bucket) => count + (bucket?.length ?? 0), 0);

    return {
      success: true,
      query,
      found,
      canonicalMatch,
      adjacentTags,
      results,
      debug: canonicalMatch?.type === 'tag'
        ? {
            canonicalTagId: exactTag?.id ?? null,
            adjacentTagCount: adjacentTags.length,
            adjacentTagSampleLimit: ADJACENT_TAG_SAMPLE_LIMIT,
          }
        : undefined,
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

/**
 * Get all cached tags (for use in game search validation)
 */
export async function getAllTags(): Promise<string[]> {
  const cache = await getTagCache();
  return cache.tags.map((tag) => tag.name);
}

/**
 * Get all cached genres
 */
export async function getAllGenres(): Promise<string[]> {
  const cache = await getTagCache();
  return cache.genres;
}

/**
 * Get all cached categories
 */
export async function getAllCategories(): Promise<string[]> {
  const cache = await getTagCache();
  return cache.categories;
}
