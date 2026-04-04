/**
 * Game Lookup Service
 *
 * Provides efficient database lookups for game names.
 * Prefers the trigram-backed fuzzy search RPC and falls back to ILIKE.
 */

import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import { postToQueryApi } from '@/lib/query-api-client';

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
  unavailable?: boolean;
}

interface ResolveEntitiesResponse {
  entities?: Array<{
    confidence: number;
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
    matchQuality: 'exact' | 'prefix' | 'substring' | 'fuzzy';
    platformEntityId: string;
    releaseYear?: number | null;
  }>;
}

const TIGER_GAME_LOOKUP_PROVENANCE: ChatExecutionProvenanceOverride = {
  backendKinds: ['tiger_query_api'],
  dataSources: [
    'query_api:resolveEntities',
    'relation:apps',
    'relation:latest_daily_metrics',
    'relation:publishers',
    'relation:developers',
  ],
  migrationDisposition: 'already_tiger',
  migrationNotes:
    'lookup_games now uses the system resolve-entities contract before falling back to legacy fuzzy lookup.',
  recommendedTigerContracts: ['resolveEntities'],
};

function buildTigerOnlyLookupFailure(query: string, reason: string): LookupGamesResult {
  return {
    success: false,
    query,
    results: [],
    error: reason,
    unavailable: true,
  };
}

function parseAppId(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const appid = Number.parseInt(value, 10);
  return Number.isFinite(appid) ? appid : null;
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
    const maxResults = Math.min(limit, 20); // Hard cap at 20
    const trimmedQuery = query.trim();

    const tigerResponse = await postToQueryApi<ResolveEntitiesResponse>(
      '/v1/contracts/resolve-entities',
      {
        entityKinds: ['game'],
        limit: maxResults,
        query: trimmedQuery,
      }
    );

    if (tigerResponse.ok && tigerResponse.data) {
      const tigerResults = (tigerResponse.data.entities ?? [])
        .filter((entity) => entity.entityKind === 'game')
        .map((entity): LookupGamesResult['results'][number] | null => {
          const appid = parseAppId(entity.platformEntityId);
          if (appid == null) {
            return null;
          }

          return {
            appid,
            isExactMatch: entity.matchQuality === 'exact',
            name: entity.displayName,
            releaseYear: entity.releaseYear ?? null,
            similarityScore: entity.confidence,
          };
        })
        .filter((entity): entity is LookupGamesResult['results'][number] => entity != null);

      return attachToolExecutionProvenance(
        {
          success: true,
          query,
          results: tigerResults,
        },
        TIGER_GAME_LOOKUP_PROVENANCE
      );
    }

    return buildTigerOnlyLookupFailure(
      query,
      tigerResponse.reason ?? `No game match was found for "${trimmedQuery}".`
    );
  } catch (error) {
    return buildTigerOnlyLookupFailure(
      query,
      error instanceof Error ? error.message : 'Failed to lookup games'
    );
  }
}
