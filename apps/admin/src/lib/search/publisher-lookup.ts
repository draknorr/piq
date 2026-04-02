/**
 * Publisher/Developer Lookup Service
 *
 * Provides canonical publisher and developer resolution for chat.
 */

import {
  type ResolutionConfidence,
  resolveCompanyReference,
  type CompanyEntityType,
  type CompanyResolutionCandidate,
} from '@/lib/search/company-resolution';
import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import type { ToolSufficiencyMetadata } from '@/lib/llm/types';
import { postToQueryApi } from '@/lib/query-api-client';

interface LookupCompanyCandidate {
  id: number;
  name: string;
  matchKind: CompanyResolutionCandidate['matchKind'];
  resolutionScore: number;
}

interface CanonicalCompanySummary {
  gameCount?: number;
  totalReviews?: number;
  avgReviewScore?: number;
  positiveReviews?: number;
}

interface ResolveEntitiesResponse {
  ambiguity?: {
    message: string | null;
    requiresClarification: boolean;
  };
  entities?: Array<{
    confidence: number;
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
    latestMetrics?: {
      reviewScore: number | null;
      totalReviews: number | null;
    };
    matchQuality: 'exact' | 'prefix' | 'substring';
    platformEntityId: string;
    signals?: {
      gameCount?: number | null;
    };
  }>;
}

interface TigerLookupCompanyCandidate {
  avgReviewScore?: number;
  gameCount?: number;
  id: number;
  matchKind: CompanyResolutionCandidate['matchKind'];
  name: string;
  resolutionScore: number;
  totalReviews?: number;
}

const TIGER_COMPANY_LOOKUP_PROVENANCE: ChatExecutionProvenanceOverride = {
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
    'Company lookup now uses the Tiger resolve-entities contract before falling back to the legacy resolver.',
  recommendedTigerContracts: ['resolveEntities'],
};

/**
 * Arguments for lookup_publishers tool
 */
export interface LookupPublishersArgs {
  query: string;
  limit?: number;
}

/**
 * Result from lookup_publishers
 */
export interface LookupPublishersResult {
  result_shape?: ToolSufficiencyMetadata['result_shape'];
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  success: boolean;
  entityType: 'publisher';
  query: string;
  results: LookupCompanyCandidate[];
  canonicalResult?: {
    id: number;
    name: string;
    confidence: ResolutionConfidence;
  };
  summary?: CanonicalCompanySummary;
  resolutionConfidence?: ResolutionConfidence;
  needsDisambiguation?: boolean;
  error?: string;
}

/**
 * Search for matching publisher names using the canonical company resolver
 */
export async function lookupPublishers(args: LookupPublishersArgs): Promise<LookupPublishersResult> {
  return lookupCompany('publisher', args) as Promise<LookupPublishersResult>;
}

/**
 * Arguments for lookup_developers tool
 */
export interface LookupDevelopersArgs {
  query: string;
  limit?: number;
}

/**
 * Result from lookup_developers
 */
export interface LookupDevelopersResult {
  result_shape?: ToolSufficiencyMetadata['result_shape'];
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  success: boolean;
  entityType: 'developer';
  query: string;
  results: LookupCompanyCandidate[];
  canonicalResult?: {
    id: number;
    name: string;
    confidence: ResolutionConfidence;
  };
  summary?: CanonicalCompanySummary;
  resolutionConfidence?: ResolutionConfidence;
  needsDisambiguation?: boolean;
  error?: string;
}

function summarizeCandidate(candidate?: CompanyResolutionCandidate): CanonicalCompanySummary | undefined {
  if (!candidate) {
    return undefined;
  }

  return {
    gameCount: candidate.gameCount,
    totalReviews: candidate.totalReviews,
    avgReviewScore: candidate.avgReviewScore,
    positiveReviews: candidate.positiveReviews,
  };
}

function stripCandidate(candidate: CompanyResolutionCandidate): LookupCompanyCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    matchKind: candidate.matchKind,
    resolutionScore: candidate.resolutionScore,
  };
}

function inferResolutionConfidence(score: number | undefined): ResolutionConfidence {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return 'low';
  }

  if (score >= 0.9) {
    return 'high';
  }

  if (score >= 0.75) {
    return 'medium';
  }

  return 'low';
}

function mapMatchKind(
  matchQuality: 'exact' | 'prefix' | 'substring'
): CompanyResolutionCandidate['matchKind'] {
  if (matchQuality === 'exact') {
    return 'exact';
  }

  if (matchQuality === 'prefix') {
    return 'prefix';
  }

  return 'substring';
}

function parseCompanyId(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) ? id : null;
}

async function lookupCompanyViaTiger(
  entityType: CompanyEntityType,
  query: string,
  limit: number
): Promise<LookupPublishersResult | LookupDevelopersResult | null> {
  const response = await postToQueryApi<ResolveEntitiesResponse>(
    '/v1/contracts/resolve-entities',
    {
      entityKinds: [entityType],
      includeMetrics: true,
      limit,
      query,
    }
  );

  if (!response.ok || !response.data) {
    return null;
  }

  const rawCandidates = (response.data.entities ?? [])
    .filter((entity) => entity.entityKind === entityType)
    .map((entity): TigerLookupCompanyCandidate | null => {
      const id = parseCompanyId(entity.platformEntityId);
      if (id == null) {
        return null;
      }

      return {
        avgReviewScore: entity.latestMetrics?.reviewScore ?? undefined,
        gameCount: entity.signals?.gameCount ?? undefined,
        id,
        matchKind: mapMatchKind(entity.matchQuality),
        name: entity.displayName,
        resolutionScore: entity.confidence,
        totalReviews: entity.latestMetrics?.totalReviews ?? undefined,
      };
    })
    .filter((candidate): candidate is TigerLookupCompanyCandidate => candidate != null);

  if (rawCandidates.length === 0) {
    return null;
  }

  const topCandidate = rawCandidates[0];
  const needsDisambiguation = response.data.ambiguity?.requiresClarification === true;
  const resolutionConfidence = inferResolutionConfidence(topCandidate?.resolutionScore);
  const ambiguityMessage = response.data.ambiguity?.message ?? null;

  const result = {
    result_shape: 'lookup' as const,
    success: true,
    entityType,
    query,
    results: rawCandidates.map((candidate) => ({
      id: candidate.id,
      matchKind: candidate.matchKind,
      name: candidate.name,
      resolutionScore: candidate.resolutionScore,
    })),
    canonicalResult: topCandidate
      ? {
          confidence: resolutionConfidence,
          id: topCandidate.id,
          name: topCandidate.name,
        }
      : undefined,
    summary: topCandidate
      ? {
          avgReviewScore: topCandidate.avgReviewScore,
          gameCount: topCandidate.gameCount,
          totalReviews: topCandidate.totalReviews,
        }
      : undefined,
    resolutionConfidence,
    needsDisambiguation,
    sufficient_to_answer: needsDisambiguation,
    sufficiency_reason: needsDisambiguation
      ? ambiguityMessage ?? `The ${entityType} name "${query}" is ambiguous and needs clarification.`
      : 'Identity resolved only. For company counts, rankings, comparisons, or top-title answers, run one analytics query before responding.',
    ...(needsDisambiguation
      ? {
          error:
            ambiguityMessage ??
            `The ${entityType} name "${query}" is ambiguous and needs clarification.`,
        }
      : {}),
  };

  return attachToolExecutionProvenance(result, TIGER_COMPANY_LOOKUP_PROVENANCE);
}

/**
 * Search for matching developer names using the canonical company resolver
 */
export async function lookupDevelopers(args: LookupDevelopersArgs): Promise<LookupDevelopersResult> {
  return lookupCompany('developer', args) as Promise<LookupDevelopersResult>;
}

async function lookupCompany(
  entityType: CompanyEntityType,
  args: LookupPublishersArgs | LookupDevelopersArgs
): Promise<LookupPublishersResult | LookupDevelopersResult> {
  const { query, limit = 10 } = args;

  if (!query || query.trim().length === 0) {
    return {
      result_shape: 'lookup',
      sufficient_to_answer: true,
      sufficiency_reason: 'The company lookup needs a non-empty query before any follow-up tool calls.',
      success: false,
      entityType,
      query,
      results: [],
      error: 'Query is required',
    };
  }

  try {
    const maxResults = Math.min(limit, 10);
    const tigerResult = await lookupCompanyViaTiger(entityType, query.trim(), maxResults);
    if (tigerResult) {
      return tigerResult;
    }

    const resolution = await resolveCompanyReference(entityType, query, limit);
    const canonicalCandidate = resolution.canonicalResult
      ? resolution.results.find((candidate) => candidate.id === resolution.canonicalResult?.id)
      : undefined;

    return {
      result_shape: 'lookup',
      success: resolution.success,
      entityType,
      query,
      results: resolution.results.map(stripCandidate),
      canonicalResult: resolution.canonicalResult,
      summary: summarizeCandidate(canonicalCandidate),
      resolutionConfidence: resolution.resolutionConfidence,
      needsDisambiguation: resolution.needsDisambiguation,
      sufficient_to_answer: resolution.needsDisambiguation || !resolution.success ? true : false,
      sufficiency_reason: resolution.needsDisambiguation
        ? resolution.error ?? `The ${entityType} name "${query}" is ambiguous and needs clarification.`
        : resolution.success
          ? 'Identity resolved only. For company counts, rankings, comparisons, or top-title answers, run one analytics query before responding.'
          : resolution.error,
      error: resolution.error,
    };
  } catch (error) {
    if (entityType === 'publisher') {
      return {
        result_shape: 'lookup',
        sufficient_to_answer: true,
        sufficiency_reason: error instanceof Error ? error.message : 'Failed to lookup publishers',
        success: false,
        entityType,
        query,
        results: [],
        error: error instanceof Error ? error.message : 'Failed to lookup publishers',
      };
    }

    return {
      result_shape: 'lookup',
      sufficient_to_answer: true,
      sufficiency_reason: error instanceof Error ? error.message : 'Failed to lookup developers',
      success: false,
      entityType,
      query,
      results: [],
      error: error instanceof Error ? error.message : 'Failed to lookup developers',
    };
  }
}
