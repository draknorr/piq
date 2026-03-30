/**
 * Game Lookup Service
 *
 * Provides efficient database lookups for game names.
 * Prefers the trigram-backed fuzzy search RPC and falls back to ILIKE.
 */

import { getServiceSupabase } from '@/lib/supabase-service';

/**
 * Arguments for lookup_games tool
 */
export interface LookupGamesArgs {
  query: string;
  limit?: number;
}

/**
 * Result from lookup_games
 */
export interface LookupGamesResult {
  success: boolean;
  query: string;
  results: Array<{
    appid: number;
    name: string;
    releaseYear: number | null;
    similarityScore?: number;
    isExactMatch?: boolean;
  }>;
  error?: string;
}

/**
 * Search for matching game names using direct database query
 */
export async function lookupGames(args: LookupGamesArgs): Promise<LookupGamesResult> {
  const { query, limit = 10 } = args;

  if (!query || query.trim().length === 0) {
    return {
      success: false,
      query,
      results: [],
      error: 'Query is required',
    };
  }

  try {
    const supabase = getServiceSupabase();
    const maxResults = Math.min(limit, 20); // Hard cap at 20

    // Exact case-insensitive title matches should win immediately, even for
    // delisted apps, so historical/news queries do not degrade into fuzzy ambiguity.
    const { data: exactData, error: exactError } = await supabase
      .from('apps')
      .select('appid, name, release_date')
      .eq('type', 'game')
      .ilike('name', query.trim())
      .order('release_date', { ascending: false, nullsFirst: false })
      .limit(maxResults);

    if (!exactError && exactData && exactData.length > 0) {
      return {
        success: true,
        query,
        results: exactData.map((g) => ({
          appid: g.appid,
          name: g.name,
          releaseYear: g.release_date ? new Date(g.release_date).getFullYear() : null,
          similarityScore: 1,
          isExactMatch: true,
        })),
      };
    }

    // Prefer the fuzzy search RPC so chat tolerates typos, spacing differences,
    // and near matches on a very large catalog.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fuzzyData, error: fuzzyError } = await (supabase as any).rpc('search_games_fuzzy', {
      p_query: query,
      p_limit: maxResults,
    }) as {
      data: Array<{
        appid: number;
        name: string;
        release_date: string | null;
        similarity_score: number | null;
        is_exact_match: boolean | null;
      }> | null;
      error: { message: string } | null;
    };

    if (!fuzzyError && fuzzyData && fuzzyData.length > 0) {
      return {
        success: true,
        query,
        results: fuzzyData.map((g) => ({
          appid: g.appid,
          name: g.name,
          releaseYear: g.release_date ? new Date(g.release_date).getFullYear() : null,
          similarityScore: g.similarity_score ?? undefined,
          isExactMatch: g.is_exact_match ?? undefined,
        })),
      };
    }

    // Direct ILIKE fallback if the RPC is unavailable.
    const { data, error } = await supabase
      .from('apps')
      .select('appid, name, release_date')
      .eq('type', 'game')
      .eq('is_delisted', false)
      .ilike('name', `%${query.trim()}%`)
      .order('name')
      .limit(maxResults);

    if (error) {
      console.error('Game lookup error:', error);
      return {
        success: false,
        query,
        results: [],
        error: error.message,
      };
    }

    return {
      success: true,
      query,
      results:
        data?.map((g) => ({
          appid: g.appid,
          name: g.name,
          releaseYear: g.release_date ? new Date(g.release_date).getFullYear() : null,
        })) || [],
    };
  } catch (error) {
    return {
      success: false,
      query,
      results: [],
      error: error instanceof Error ? error.message : 'Failed to lookup games',
    };
  }
}
