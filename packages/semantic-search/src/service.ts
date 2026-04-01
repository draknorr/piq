import {
  buildEntityFilter,
  buildGameFilter,
  getCollectionName,
  getQdrantClient,
  isQdrantConfigured,
  type EntityFilters,
  type GameFilters,
  type Platform,
  type PopularityComparison,
  type ReviewComparison,
  type SteamDeckCategory,
} from '@publisheriq/qdrant';

export type SemanticSearchMode = 'similarity' | 'concept';
export type SemanticSearchEntityKind = 'game' | 'publisher' | 'developer';

export interface SemanticSearchRange {
  gte?: number;
  lte?: number;
}

export interface SemanticSearchFilters {
  avg_review_percentage?: SemanticSearchRange;
  game_count?: SemanticSearchRange;
  genres?: string[];
  is_free?: boolean;
  is_indie?: boolean;
  is_major?: boolean;
  max_price_cents?: number;
  max_reviews?: number;
  min_reviews?: number;
  platforms?: Platform[];
  popularity_comparison?: PopularityComparison;
  release_year?: SemanticSearchRange;
  review_comparison?: ReviewComparison;
  review_percentage?: SemanticSearchRange;
  same_franchise_only?: boolean;
  steam_deck?: Array<'verified' | 'playable'>;
  tags?: string[];
  top_genres?: string[];
  top_tags?: string[];
}

export interface SemanticSearchRequest {
  description?: string | null;
  entityKind: SemanticSearchEntityKind;
  filters?: SemanticSearchFilters;
  limit?: number;
  mode: SemanticSearchMode;
  referencePlatformEntityId?: string | null;
  referenceQuery?: string | null;
}

export interface SemanticSearchReference {
  id: number;
  name: string;
  type: string;
}

export interface SemanticSearchCandidate {
  id: number;
  name: string;
}

export interface SemanticSearchResultItem {
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
  steam_deck?: SteamDeckCategory;
  tags?: string[];
  top_genres?: string[];
  top_tags?: string[];
  total_reviews?: number | null;
  type?: string;
}

export interface SemanticSearchDebugInfo {
  searchParams?: Record<string, unknown>;
  vectorFilter?: Record<string, unknown>;
}

export interface SemanticSearchEngineResult {
  candidates?: SemanticSearchCandidate[];
  continuation_token?: string | null;
  debug?: SemanticSearchDebugInfo;
  entityType?: 'publisher' | 'developer';
  error?: string;
  mode?: 'heuristic_portfolio' | 'semantic';
  query_description?: string;
  reference?: SemanticSearchReference;
  results?: SemanticSearchResultItem[];
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  success: boolean;
  total_found?: number;
}

export interface ResolvedReferenceEntity {
  id: number;
  metrics?: {
    developer_ids?: number[];
    franchise_ids?: number[];
    price_cents?: number | null;
    publisher_ids?: number[];
    review_percentage?: number | null;
    total_reviews?: number | null;
  };
  name: string;
  type: string;
}

export interface ResolveReferenceResult {
  candidates?: SemanticSearchCandidate[];
  entity?: ResolvedReferenceEntity | null;
  error?: string;
}

export interface SemanticSearchDependencies {
  embedText(text: string): Promise<number[]>;
  resolveReference(params: {
    entityKind: SemanticSearchEntityKind;
    referencePlatformEntityId?: string | null;
    referenceQuery?: string | null;
  }): Promise<ResolveReferenceResult>;
}

interface RetrievedPoint {
  payload: Record<string, unknown>;
  vector: number[];
}

interface SimilarityPayload {
  developer_ids?: number[];
  franchise_ids?: number[];
  franchise_names?: string[];
  genres?: string[];
  name?: string;
  price_cents?: number | null;
  publisher_ids?: number[];
  review_percentage?: number | null;
  steam_deck?: SteamDeckCategory;
  tags?: string[];
  total_reviews?: number | null;
  type?: string;
}

interface CompanyVariantResult {
  payload: Record<string, unknown>;
  score: number;
  variant: 'identity' | 'portfolio';
}

const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 10;
const DEFAULT_COMPANY_RESULTS = 6;
const GAME_SEARCH_PAYLOAD_FIELDS = [
  'name',
  'type',
  'genres',
  'tags',
  'categories',
  'review_percentage',
  'total_reviews',
  'price_cents',
  'is_free',
  'steam_deck',
  'franchise_ids',
  'franchise_names',
  'developer_ids',
  'publisher_ids',
] as const;
const COMPANY_SEARCH_PAYLOAD_FIELDS = [
  'name',
  'game_count',
  'top_genres',
  'top_tags',
  'avg_review_percentage',
  'is_major',
  'is_indie',
] as const;
const INFORMATIVE_ATTRIBUTE_BLACKLIST = new Set([
  'action',
  'adventure',
  'indie',
  'casual',
  'rpg',
  'singleplayer',
  'early access',
  'story rich',
  'exploration',
  'atmospheric',
  'female protagonist',
]);
const TITLE_STOP_WORDS = new Set([
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
const CONCEPT_STOP_WORDS = new Set([
  'game',
  'games',
  'with',
  'that',
  'this',
  'those',
  'from',
  'into',
  'under',
  'over',
  'about',
  'like',
  'similar',
]);

function asOptionalNullableNumber(value: unknown): number | null | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : value === null ? null : undefined;
}

function asOptionalNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  return values.length > 0 ? values : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function normalizeTextToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function sharedNormalizedStrings(left: string[] | undefined, right: string[] | undefined): string[] {
  if (!left?.length || !right?.length) {
    return [];
  }

  const normalizedRight = new Map<string, string>(
    right
      .map((value) => [normalizeTextToken(value), value.trim()] as const)
      .filter(([key]) => key.length > 0)
  );

  const matches: string[] = [];
  for (const value of left) {
    const normalized = normalizeTextToken(value);
    const match = normalizedRight.get(normalized);
    if (match && !matches.some((candidate) => normalizeTextToken(candidate) === normalized)) {
      matches.push(match);
    }
  }

  return matches;
}

function filterInformativeAttributes(values: string[]): string[] {
  return values.filter((value) => !INFORMATIVE_ATTRIBUTE_BLACKLIST.has(normalizeTextToken(value)));
}

function tokenizeTitle(value: string): string[] {
  return normalizeTextToken(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token));
}

function tokenizeConcept(value: string): string[] {
  return normalizeTextToken(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !CONCEPT_STOP_WORDS.has(token));
}

function reviewSupportBonus(totalReviews: number | null | undefined, reviewPercentage: number | null | undefined): number {
  if (
    totalReviews !== null &&
    totalReviews !== undefined &&
    totalReviews >= 500 &&
    reviewPercentage !== null &&
    reviewPercentage !== undefined &&
    reviewPercentage >= 80
  ) {
    return 0.05;
  }

  if (
    totalReviews !== null &&
    totalReviews !== undefined &&
    totalReviews >= 100 &&
    reviewPercentage !== null &&
    reviewPercentage !== undefined &&
    reviewPercentage >= 70
  ) {
    return 0.025;
  }

  return 0;
}

function lowSignalPenalty(totalReviews: number | null | undefined, reviewPercentage: number | null | undefined): number {
  if (totalReviews === null || totalReviews === undefined || totalReviews < 20) {
    return 0.12;
  }

  if (
    reviewPercentage !== null &&
    reviewPercentage !== undefined &&
    totalReviews < 50 &&
    reviewPercentage < 60
  ) {
    return 0.08;
  }

  return 0;
}

function hasSuspiciousGameTitleOverlap(referenceName: string, candidateName: string): boolean {
  const referenceTokens = tokenizeTitle(referenceName);
  const candidateTokens = tokenizeTitle(candidateName);

  if (referenceTokens.length === 0 || candidateTokens.length === 0) {
    return false;
  }

  const shared = referenceTokens.filter((token) => candidateTokens.includes(token));
  const sharedRatio = shared.length / Math.max(referenceTokens.length, candidateTokens.length);

  return sharedRatio >= 0.75;
}

function buildSimilarityFilterEvidence(
  sourcePayload: SimilarityPayload,
  candidatePayload: SimilarityPayload,
  filters: SemanticSearchFilters | undefined
): { bonus: number; hardReject: boolean; penalty: number; reasons: string[] } {
  const reasons: string[] = [];
  let bonus = 0;
  let penalty = 0;
  let hardReject = false;

  const matchedTags = sharedNormalizedStrings(filters?.tags, candidatePayload.tags);
  if (matchedTags.length > 0) {
    reasons.push(matchedTags[0]);
    bonus += 0.04;
  }

  const matchedGenres = sharedNormalizedStrings(filters?.genres, candidatePayload.genres);
  if (matchedGenres.length > 0 && !reasons.includes(matchedGenres[0])) {
    reasons.push(matchedGenres[0]);
    bonus += 0.03;
  }

  if (filters?.steam_deck?.length) {
    if (
      candidatePayload.steam_deck &&
      filters.steam_deck.includes(candidatePayload.steam_deck as 'verified' | 'playable')
    ) {
      reasons.push(`Steam Deck ${candidatePayload.steam_deck}`);
      bonus += 0.03;
    } else {
      hardReject = true;
    }
  }

  const sourceReviewPercentage = sourcePayload.review_percentage;
  const candidateReviewPercentage = candidatePayload.review_percentage;
  if (
    filters?.review_comparison &&
    filters.review_comparison !== 'any' &&
    sourceReviewPercentage !== null &&
    sourceReviewPercentage !== undefined
  ) {
    if (
      candidateReviewPercentage === null ||
      candidateReviewPercentage === undefined ||
      (filters.review_comparison === 'better_only' && candidateReviewPercentage <= sourceReviewPercentage) ||
      (filters.review_comparison === 'similar_or_better' && candidateReviewPercentage < sourceReviewPercentage - 2)
    ) {
      hardReject = true;
    } else {
      reasons.push('Review fit');
      bonus += 0.03;
    }
  }

  if (filters?.popularity_comparison === 'less_popular') {
    if (
      sourcePayload.total_reviews === null ||
      sourcePayload.total_reviews === undefined ||
      candidatePayload.total_reviews === null ||
      candidatePayload.total_reviews === undefined ||
      candidatePayload.total_reviews >= sourcePayload.total_reviews
    ) {
      hardReject = true;
    } else {
      reasons.push('Smaller review footprint');
      bonus += 0.025;
    }
  }

  if (filters?.max_reviews !== undefined) {
    if (
      candidatePayload.total_reviews === null ||
      candidatePayload.total_reviews === undefined ||
      candidatePayload.total_reviews > filters.max_reviews
    ) {
      hardReject = true;
    } else {
      bonus += 0.02;
    }
  }

  if (filters?.review_percentage) {
    const value = candidatePayload.review_percentage;
    if (
      value === null ||
      value === undefined ||
      (filters.review_percentage.gte !== undefined && value < filters.review_percentage.gte) ||
      (filters.review_percentage.lte !== undefined && value > filters.review_percentage.lte)
    ) {
      hardReject = true;
    }
  }

  if (filters?.min_reviews !== undefined) {
    if (
      candidatePayload.total_reviews === null ||
      candidatePayload.total_reviews === undefined ||
      candidatePayload.total_reviews < filters.min_reviews
    ) {
      hardReject = true;
    }
  }

  if (
    filters?.review_comparison &&
    filters.review_comparison !== 'any' &&
    (candidatePayload.total_reviews === null || candidatePayload.total_reviews === undefined || candidatePayload.total_reviews < 50)
  ) {
    penalty += 0.08;
  }

  return {
    bonus: Math.min(bonus, 0.14),
    hardReject,
    penalty,
    reasons,
  };
}

function buildConceptEvidence(
  description: string,
  payload: Record<string, unknown>
): {
  bonus: number;
  hardReject: boolean;
  matchedTerms: string[];
  penalty: number;
  reasons: string[];
} {
  const descriptionTerms = tokenizeConcept(description);
  const payloadTerms = [
    ...(asOptionalStringArray(payload.genres) ?? []),
    ...(asOptionalStringArray(payload.tags) ?? []),
    ...(asOptionalStringArray(payload.categories) ?? []),
    asOptionalString(payload.name) ?? '',
  ]
    .join(' ')
    .toLowerCase();

  const matchedTerms = descriptionTerms.filter((term) => payloadTerms.includes(term));
  let bonus = Math.min(matchedTerms.length * 0.03, 0.12);
  let penalty = 0;
  let hardReject = false;

  if (descriptionTerms.length >= 2 && matchedTerms.length === 0) {
    penalty += 0.12;
    if ((asOptionalString(payload.name) ?? '').toLowerCase().includes(descriptionTerms[0] ?? '')) {
      penalty += 0.06;
      hardReject = true;
    }
  }

  const totalReviews = asOptionalNullableNumber(payload.total_reviews);
  const reviewPercentage = asOptionalNullableNumber(payload.review_percentage);
  bonus += reviewSupportBonus(totalReviews, reviewPercentage);
  penalty += lowSignalPenalty(totalReviews, reviewPercentage);

  const reasons: string[] = [];
  if (matchedTerms.length >= 2) {
    reasons.push(`${matchedTerms[0]} + ${matchedTerms[1]} fit`);
  } else if (matchedTerms.length === 1) {
    reasons.push(`${matchedTerms[0]} fit`);
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
    hardReject,
    matchedTerms,
    penalty,
    reasons,
  };
}

function mapGameFilters(filters: SemanticSearchFilters | undefined): GameFilters {
  const gameFilters: GameFilters = {
    exclude_delisted: true,
    is_released: true,
  };

  if (!filters) {
    return gameFilters;
  }

  if (filters.is_free !== undefined) gameFilters.is_free = filters.is_free;
  if (filters.max_price_cents !== undefined) gameFilters.price_range = { lte: filters.max_price_cents };
  if (filters.platforms?.length) gameFilters.platforms = filters.platforms;
  if (filters.steam_deck?.length) gameFilters.steam_deck = filters.steam_deck;
  if (filters.genres?.length) gameFilters.genres = filters.genres;
  if (filters.tags?.length) gameFilters.tags = filters.tags;
  if (filters.min_reviews !== undefined) gameFilters.min_reviews = filters.min_reviews;
  if (filters.max_reviews !== undefined) gameFilters.max_reviews = filters.max_reviews;
  if (filters.review_percentage) gameFilters.review_percentage = filters.review_percentage;
  if (filters.release_year) gameFilters.release_year = filters.release_year;
  if (filters.review_comparison) gameFilters.review_comparison = filters.review_comparison;
  if (filters.popularity_comparison) gameFilters.popularity_comparison = filters.popularity_comparison;
  if (filters.same_franchise_only) gameFilters.same_franchise_only = true;

  return gameFilters;
}

function mapEntityFilters(filters: SemanticSearchFilters | undefined): EntityFilters {
  const entityFilters: EntityFilters = {};

  if (!filters) {
    return entityFilters;
  }

  if (filters.game_count) entityFilters.game_count = filters.game_count;
  if (filters.avg_review_percentage) entityFilters.avg_review_percentage = filters.avg_review_percentage;
  if (filters.is_major !== undefined) entityFilters.is_major = filters.is_major;
  if (filters.is_indie !== undefined) entityFilters.is_indie = filters.is_indie;
  if (filters.top_genres?.length) entityFilters.top_genres = filters.top_genres;
  if (filters.top_tags?.length) entityFilters.top_tags = filters.top_tags;

  return entityFilters;
}

function buildSearchDescription(description: string): string {
  const normalized = description.trim();
  return /\bgame\b/i.test(normalized) ? normalized : `${normalized} game`;
}

function buildSourceMetrics(sourcePayload: SimilarityPayload, reference: ResolvedReferenceEntity): {
  developer_ids?: number[];
  franchise_ids?: number[];
  price_cents?: number;
  publisher_ids?: number[];
  review_percentage?: number;
  total_reviews?: number | null;
} {
  return {
    developer_ids: sourcePayload.developer_ids ?? reference.metrics?.developer_ids,
    franchise_ids: sourcePayload.franchise_ids ?? reference.metrics?.franchise_ids,
    price_cents:
      sourcePayload.price_cents !== null && sourcePayload.price_cents !== undefined
        ? sourcePayload.price_cents
        : reference.metrics?.price_cents ?? undefined,
    publisher_ids: sourcePayload.publisher_ids ?? reference.metrics?.publisher_ids,
    review_percentage:
      sourcePayload.review_percentage !== null && sourcePayload.review_percentage !== undefined
        ? sourcePayload.review_percentage
        : reference.metrics?.review_percentage ?? undefined,
    total_reviews:
      sourcePayload.total_reviews !== null && sourcePayload.total_reviews !== undefined
        ? sourcePayload.total_reviews
        : reference.metrics?.total_reviews ?? undefined,
  };
}

function applyScoreBoosts(
  referenceName: string,
  sourcePayload: SimilarityPayload,
  results: Array<{ id: number; payload: Record<string, unknown>; score: number }>,
  filters: SemanticSearchFilters | undefined
): Array<{
  hardReject: boolean;
  id: number;
  matchReasons: string[];
  payload: Record<string, unknown>;
  rawScore: number;
  score: number;
}> {
  return results
    .map((result) => {
      const payload: SimilarityPayload = {
        developer_ids: asOptionalNumberArray(result.payload.developer_ids),
        franchise_ids: asOptionalNumberArray(result.payload.franchise_ids),
        franchise_names: asOptionalStringArray(result.payload.franchise_names),
        genres: asOptionalStringArray(result.payload.genres),
        name: asOptionalString(result.payload.name),
        price_cents: asOptionalNullableNumber(result.payload.price_cents),
        publisher_ids: asOptionalNumberArray(result.payload.publisher_ids),
        review_percentage: asOptionalNullableNumber(result.payload.review_percentage),
        steam_deck: result.payload.steam_deck as SteamDeckCategory | undefined,
        tags: asOptionalStringArray(result.payload.tags),
        total_reviews: asOptionalNullableNumber(result.payload.total_reviews),
        type: asOptionalString(result.payload.type),
      };

      let boost = 0;
      let penalty = 0;
      const reasons: string[] = [];

      if (sourcePayload.franchise_ids?.length && payload.franchise_ids?.length) {
        const sharedFranchise = sourcePayload.franchise_ids.find((id) => payload.franchise_ids?.includes(id));
        if (sharedFranchise !== undefined) {
          boost += 0.15;
          const franchiseName = payload.franchise_names?.[payload.franchise_ids.indexOf(sharedFranchise)];
          reasons.push(franchiseName ? `${franchiseName} series` : 'Same series');
        }
      }

      if (sourcePayload.developer_ids?.length && payload.developer_ids?.length) {
        const sharedDeveloper = sourcePayload.developer_ids.some((id) => payload.developer_ids?.includes(id));
        if (sharedDeveloper) {
          boost += 0.08;
          reasons.push('Same developer');
        }
      }

      if (sourcePayload.publisher_ids?.length && payload.publisher_ids?.length) {
        const sharedPublisher = sourcePayload.publisher_ids.some((id) => payload.publisher_ids?.includes(id));
        if (sharedPublisher) {
          boost += 0.03;
          reasons.push('Same publisher');
        }
      }

      const sharedGenres = sharedNormalizedStrings(sourcePayload.genres, payload.genres);
      const sharedTags = sharedNormalizedStrings(sourcePayload.tags, payload.tags);
      const informativeGenres = filterInformativeAttributes(sharedGenres);
      const informativeTags = filterInformativeAttributes(sharedTags);

      boost += Math.min(sharedGenres.length, 2) * 0.02;
      boost += Math.min(sharedTags.length, 3) * 0.01;

      for (const reason of [...informativeTags, ...informativeGenres, ...sharedTags, ...sharedGenres]) {
        if (!reasons.includes(reason)) {
          reasons.push(reason);
        }
        if (reasons.length >= 4) {
          break;
        }
      }

      const filterEvidence = buildSimilarityFilterEvidence(sourcePayload, payload, filters);
      boost += filterEvidence.bonus;
      penalty += filterEvidence.penalty;
      for (const reason of filterEvidence.reasons) {
        if (!reasons.includes(reason)) {
          reasons.push(reason);
        }
      }

      boost += reviewSupportBonus(payload.total_reviews, payload.review_percentage);
      penalty += lowSignalPenalty(payload.total_reviews, payload.review_percentage);

      if (
        payload.name &&
        hasSuspiciousGameTitleOverlap(referenceName, payload.name) &&
        informativeGenres.length === 0 &&
        informativeTags.length === 0 &&
        !reasons.some((reason) => reason === 'Same developer' || reason === 'Same publisher' || reason.endsWith('series'))
      ) {
        penalty += 0.18;
      }

      const adjustedScore = Math.max(0, Math.min(result.score + Math.min(boost, 0.3) - penalty, 1));

      return {
        hardReject: filterEvidence.hardReject,
        id: result.id,
        matchReasons: reasons.slice(0, 4),
        payload: result.payload,
        rawScore: result.score,
        score: adjustedScore,
      };
    })
    .filter((result) => !result.hardReject && result.score >= 0.45)
    .sort((left, right) => right.score - left.score);
}

function closenessScore(left: number | null | undefined, right: number | null | undefined): number {
  if (!left || !right) {
    return 0;
  }

  const leftLog = Math.log10(left + 1);
  const rightLog = Math.log10(right + 1);
  const distance = Math.abs(leftLog - rightLog);

  return Math.max(0, 1 - distance / 3);
}

function mergeCompanyResults(searchGroups: CompanyVariantResult[][], sourceId: number): Array<{
  id: number;
  payloads: Partial<Record<'identity' | 'portfolio', Record<string, unknown>>>;
  variantScores: Partial<Record<'identity' | 'portfolio', number>>;
}> {
  const merged = new Map<
    number,
    {
      payloads: Partial<Record<'identity' | 'portfolio', Record<string, unknown>>>;
      variantScores: Partial<Record<'identity' | 'portfolio', number>>;
    }
  >();

  for (const group of searchGroups) {
    for (const result of group) {
      const id = Number(result.payload.id ?? 0);
      if (!Number.isFinite(id) || id <= 0 || id === sourceId) {
        continue;
      }

      const existing = merged.get(id) ?? { payloads: {}, variantScores: {} };
      const currentScore = existing.variantScores[result.variant] ?? 0;
      if (result.score > currentScore) {
        existing.variantScores[result.variant] = result.score;
        existing.payloads[result.variant] = result.payload;
      }

      merged.set(id, existing);
    }
  }

  return [...merged.entries()].map(([id, value]) => ({ id, ...value }));
}

function buildCompanyMatchReasons(
  sourcePayloads: Partial<Record<'identity' | 'portfolio', Record<string, unknown>>>,
  candidatePayloads: Partial<Record<'identity' | 'portfolio', Record<string, unknown>>>
): string[] {
  const sourcePortfolio = sourcePayloads.portfolio ?? {};
  const sourceIdentity = sourcePayloads.identity ?? {};
  const candidatePortfolio = candidatePayloads.portfolio ?? {};
  const candidateIdentity = candidatePayloads.identity ?? {};

  const sharedGenres = sharedNormalizedStrings(
    asOptionalStringArray(sourcePortfolio.top_genres),
    asOptionalStringArray(candidatePortfolio.top_genres)
  );
  const sharedTags = sharedNormalizedStrings(
    asOptionalStringArray(sourcePortfolio.top_tags),
    asOptionalStringArray(candidatePortfolio.top_tags)
  );

  const reasons: string[] = [];
  if (sharedGenres.length > 0) {
    reasons.push('Similar genre footprint');
  }
  if (sharedTags.length > 0) {
    reasons.push('Overlapping portfolio tags');
  }

  const sourceGameCount = asOptionalNullableNumber(sourcePortfolio.game_count);
  const candidateGameCount = asOptionalNullableNumber(candidatePortfolio.game_count);
  if (closenessScore(sourceGameCount, candidateGameCount) >= 0.65) {
    reasons.push('Similar catalog size');
  }

  const sourceReviewPercentage = asOptionalNullableNumber(sourcePortfolio.avg_review_percentage);
  const candidateReviewPercentage = asOptionalNullableNumber(candidatePortfolio.avg_review_percentage);
  if (
    sourceReviewPercentage !== null &&
    sourceReviewPercentage !== undefined &&
    candidateReviewPercentage !== null &&
    candidateReviewPercentage !== undefined &&
    Math.abs(sourceReviewPercentage - candidateReviewPercentage) <= 6
  ) {
    reasons.push('Similar average review quality');
  }

  const sourceIdentityGenres = sharedNormalizedStrings(
    asOptionalStringArray(sourceIdentity.top_genres),
    asOptionalStringArray(candidateIdentity.top_genres)
  );
  if (sourceIdentityGenres.length > 0 && !reasons.includes('Similar flagship genres')) {
    reasons.push('Similar flagship genres');
  }

  return reasons.slice(0, 4);
}

async function getEntityVectorAndPayload(
  entityKind: SemanticSearchEntityKind,
  id: number,
  variant?: 'identity' | 'portfolio'
): Promise<RetrievedPoint | null> {
  const client = getQdrantClient();
  const collection = getCollectionName(entityKind, variant);

  try {
    const rows = await client.retrieve(collection, {
      ids: [id],
      with_payload: true,
      with_vector: true,
    });

    const row = rows[0];
    if (!row?.vector) {
      return null;
    }

    return {
      payload: (row.payload ?? {}) as Record<string, unknown>,
      vector: row.vector as number[],
    };
  } catch {
    return null;
  }
}

async function runGameSimilarity(
  request: SemanticSearchRequest,
  reference: ResolvedReferenceEntity
): Promise<SemanticSearchEngineResult> {
  const requestedLimit = Math.min(Math.max(request.limit ?? DEFAULT_RESULTS, 1), MAX_RESULTS);
  const sourcePoint = await getEntityVectorAndPayload('game', reference.id);

  if (!sourcePoint) {
    return {
      error: `${reference.name} hasn't been indexed for similarity search yet. Try another game.`,
      success: false,
    };
  }

  const sourcePayload: SimilarityPayload = {
    developer_ids: asOptionalNumberArray(sourcePoint.payload.developer_ids),
    franchise_ids: asOptionalNumberArray(sourcePoint.payload.franchise_ids),
    franchise_names: asOptionalStringArray(sourcePoint.payload.franchise_names),
    genres: asOptionalStringArray(sourcePoint.payload.genres),
    name: asOptionalString(sourcePoint.payload.name) ?? reference.name,
    price_cents: asOptionalNullableNumber(sourcePoint.payload.price_cents),
    publisher_ids: asOptionalNumberArray(sourcePoint.payload.publisher_ids),
    review_percentage: asOptionalNullableNumber(sourcePoint.payload.review_percentage),
    steam_deck: sourcePoint.payload.steam_deck as SteamDeckCategory | undefined,
    tags: asOptionalStringArray(sourcePoint.payload.tags),
    total_reviews: asOptionalNullableNumber(sourcePoint.payload.total_reviews),
    type: asOptionalString(sourcePoint.payload.type) ?? reference.type,
  };

  const sourceMetrics = buildSourceMetrics(sourcePayload, reference);
  if (request.filters?.same_franchise_only && (!sourceMetrics.franchise_ids || sourceMetrics.franchise_ids.length === 0)) {
    return {
      error: `Exact same-series matching is not available for "${reference.name}" because franchise metadata is missing.`,
      reference: {
        id: reference.id,
        name: reference.name,
        type: reference.type,
      },
      success: false,
    };
  }

  if (
    request.filters?.popularity_comparison &&
    request.filters.popularity_comparison !== 'any' &&
    (sourceMetrics.total_reviews === null || sourceMetrics.total_reviews === undefined)
  ) {
    return {
      error: `Popularity filtering is not available for "${reference.name}" because review data is missing.`,
      reference: {
        id: reference.id,
        name: reference.name,
        type: reference.type,
      },
      success: false,
    };
  }

  const gameFilters = mapGameFilters(request.filters);
  gameFilters.exclude_appids = [reference.id];
  const qdrantFilter = buildGameFilter(gameFilters, sourceMetrics);
  const client = getQdrantClient();
  const collection = getCollectionName('game');
  const searchLimit = Math.min(Math.max(requestedLimit * 5, 30), MAX_RESULTS);

  const searchResult = await client.search(collection, {
    vector: sourcePoint.vector,
    filter: qdrantFilter,
    limit: searchLimit,
    with_payload: {
      include: [...GAME_SEARCH_PAYLOAD_FIELDS],
    },
  });

  const boostedResults = applyScoreBoosts(
    reference.name,
    sourcePayload,
    searchResult
      .filter((point) => Number(point.id) !== reference.id)
      .map((point) => ({
        id: Number(point.id),
        payload: (point.payload ?? {}) as Record<string, unknown>,
        score: point.score,
      })),
    request.filters
  );

  return {
    continuation_token: null,
    debug: {
      searchParams: {
        collection,
        entityKind: request.entityKind,
        limit: requestedLimit,
        reference_id: reference.id,
      },
      vectorFilter: qdrantFilter as Record<string, unknown> | undefined,
    },
    mode: 'semantic',
    reference: {
      id: reference.id,
      name: reference.name,
      type: reference.type,
    },
    results: boostedResults.slice(0, requestedLimit).map((result) => ({
      genres: asOptionalStringArray(result.payload.genres),
      id: result.id,
      is_free: Boolean(result.payload.is_free),
      matchReasons: result.matchReasons.length > 0 ? result.matchReasons : undefined,
      name: asOptionalString(result.payload.name) ?? 'Unknown',
      price_cents: asOptionalNullableNumber(result.payload.price_cents),
      rawScore: Math.round(result.rawScore * 100),
      review_percentage: asOptionalNullableNumber(result.payload.review_percentage),
      score: Math.round(result.score * 100),
      steam_deck: result.payload.steam_deck as SteamDeckCategory | undefined,
      tags: asOptionalStringArray(result.payload.tags),
      total_reviews: asOptionalNullableNumber(result.payload.total_reviews),
      type: asOptionalString(result.payload.type),
    })),
    sufficient_to_answer: boostedResults.length > 0,
    sufficiency_reason:
      boostedResults.length > 0
        ? 'Returned similarity rows that already answer the request. Respond directly instead of broadening.'
        : undefined,
    success: true,
    total_found: boostedResults.length,
  };
}

async function runCompanySimilarity(
  request: SemanticSearchRequest & { entityKind: 'developer' | 'publisher' },
  reference: ResolvedReferenceEntity
): Promise<SemanticSearchEngineResult> {
  const requestedLimit = Math.min(
    Math.max(request.limit ?? DEFAULT_COMPANY_RESULTS, 1),
    DEFAULT_COMPANY_RESULTS
  );
  const client = getQdrantClient();
  const entityFilters = mapEntityFilters(request.filters);
  const qdrantFilter = buildEntityFilter(entityFilters);

  const [sourcePortfolio, sourceIdentity] = await Promise.all([
    getEntityVectorAndPayload(request.entityKind, reference.id, 'portfolio'),
    getEntityVectorAndPayload(request.entityKind, reference.id, 'identity'),
  ]);

  if (!sourcePortfolio && !sourceIdentity) {
    return {
      entityType: request.entityKind,
      error: `${reference.name} hasn't been indexed for company similarity yet.`,
      reference: {
        id: reference.id,
        name: reference.name,
        type: request.entityKind,
      },
      success: false,
    };
  }

  const searchLimit = Math.min(Math.max(requestedLimit * 3, 12), MAX_RESULTS);
  const searchGroups = await Promise.all(
    [
      sourcePortfolio
        ? client.search(getCollectionName(request.entityKind, 'portfolio'), {
            vector: sourcePortfolio.vector,
            filter: qdrantFilter,
            limit: searchLimit,
            with_payload: {
              include: [...COMPANY_SEARCH_PAYLOAD_FIELDS, 'id'],
            },
          }).then((rows) =>
            rows.map((row) => ({
              payload: (row.payload ?? {}) as Record<string, unknown>,
              score: row.score,
              variant: 'portfolio' as const,
            }))
          )
        : Promise.resolve([]),
      sourceIdentity
        ? client.search(getCollectionName(request.entityKind, 'identity'), {
            vector: sourceIdentity.vector,
            filter: qdrantFilter,
            limit: searchLimit,
            with_payload: {
              include: [...COMPANY_SEARCH_PAYLOAD_FIELDS, 'id'],
            },
          }).then((rows) =>
            rows.map((row) => ({
              payload: (row.payload ?? {}) as Record<string, unknown>,
              score: row.score,
              variant: 'identity' as const,
            }))
          )
        : Promise.resolve([]),
    ]
  );

  const mergedResults = mergeCompanyResults(searchGroups, reference.id)
    .map((candidate) => {
      const payload = candidate.payloads.portfolio ?? candidate.payloads.identity ?? {};
      const portfolioScore = candidate.variantScores.portfolio ?? 0;
      const identityScore = candidate.variantScores.identity ?? 0;
      const reasons = buildCompanyMatchReasons(
        {
          identity: sourceIdentity?.payload,
          portfolio: sourcePortfolio?.payload,
        },
        candidate.payloads
      );

      let score = portfolioScore * 0.65 + identityScore * 0.35;
      if (reasons.includes('Similar genre footprint')) {
        score += 0.03;
      }
      if (reasons.includes('Overlapping portfolio tags')) {
        score += 0.02;
      }
      if (reasons.includes('Similar catalog size')) {
        score += 0.03;
      }

      return {
        payload,
        reasons,
        score: Math.max(0, Math.min(score, 1)),
      };
    })
    .sort((left, right) => right.score - left.score);

  return {
    continuation_token: null,
    debug: {
      searchParams: {
        entityKind: request.entityKind,
        limit: requestedLimit,
        portfolioCollection: sourcePortfolio ? getCollectionName(request.entityKind, 'portfolio') : null,
        identityCollection: sourceIdentity ? getCollectionName(request.entityKind, 'identity') : null,
        reference_id: reference.id,
      },
      vectorFilter: qdrantFilter as Record<string, unknown> | undefined,
    },
    entityType: request.entityKind,
    mode: 'semantic',
    reference: {
      id: reference.id,
      name: reference.name,
      type: request.entityKind,
    },
    results: mergedResults.slice(0, requestedLimit).map((result) => ({
      avg_review_percentage: asOptionalNullableNumber(result.payload.avg_review_percentage),
      game_count: Number(result.payload.game_count ?? 0),
      id: Number(result.payload.id ?? 0),
      is_indie: typeof result.payload.is_indie === 'boolean' ? result.payload.is_indie : undefined,
      is_major: typeof result.payload.is_major === 'boolean' ? result.payload.is_major : undefined,
      matchReasons: result.reasons.length > 0 ? result.reasons : undefined,
      name: asOptionalString(result.payload.name) ?? 'Unknown',
      score: Math.round(result.score * 100),
      top_genres: asOptionalStringArray(result.payload.top_genres),
      top_tags: asOptionalStringArray(result.payload.top_tags),
      type: request.entityKind,
    })),
    sufficient_to_answer: mergedResults.length > 0,
    sufficiency_reason:
      mergedResults.length > 0
        ? 'Returned comparable peers that already answer the request. Respond directly instead of broadening.'
        : undefined,
    success: true,
    total_found: mergedResults.length,
  };
}

async function runConceptSearch(
  request: SemanticSearchRequest,
  deps: SemanticSearchDependencies
): Promise<SemanticSearchEngineResult> {
  const description = request.description?.trim() ?? '';
  if (!description) {
    return {
      error: 'Description is required for concept search.',
      success: false,
    };
  }

  const requestedLimit = Math.min(Math.max(request.limit ?? DEFAULT_RESULTS, 1), MAX_RESULTS);
  const queryVector = await deps.embedText(buildSearchDescription(description));
  const gameFilters = mapGameFilters(request.filters);

  if (gameFilters.min_reviews === undefined && tokenizeConcept(description).length >= 2) {
    gameFilters.min_reviews = 100;
  }

  const qdrantFilter = buildGameFilter(gameFilters);
  const client = getQdrantClient();
  const collection = getCollectionName('game');
  const searchLimit = Math.min(Math.max(requestedLimit * 5, 30), MAX_RESULTS);
  const searchResult = await client.search(collection, {
    vector: queryVector,
    filter: qdrantFilter,
    limit: searchLimit,
    with_payload: {
      include: [...GAME_SEARCH_PAYLOAD_FIELDS],
    },
  });

  const rerankedResults = searchResult
    .map((point) => {
      const payload = (point.payload ?? {}) as Record<string, unknown>;
      const evidence = buildConceptEvidence(description, payload);
      return {
        evidence,
        payload,
        rawScore: point.score,
        score: Math.max(0, Math.min(point.score + evidence.bonus - evidence.penalty, 1)),
      };
    })
    .filter((item) => !item.evidence.hardReject && (item.score >= 0.42 || item.evidence.matchedTerms.length > 0))
    .sort((left, right) => right.score - left.score);

  return {
    continuation_token: null,
    debug: {
      searchParams: {
        collection,
        description,
        entityKind: request.entityKind,
        limit: requestedLimit,
      },
      vectorFilter: qdrantFilter as Record<string, unknown> | undefined,
    },
    mode: 'semantic',
    query_description: description,
    results: rerankedResults.slice(0, requestedLimit).map((result) => ({
      genres: asOptionalStringArray(result.payload.genres),
      id: Number(result.payload.appid ?? result.payload.id ?? 0),
      is_free: typeof result.payload.is_free === 'boolean' ? result.payload.is_free : undefined,
      matchReasons: result.evidence.reasons.length > 0 ? result.evidence.reasons : undefined,
      name: asOptionalString(result.payload.name) ?? 'Unknown',
      price_cents: asOptionalNullableNumber(result.payload.price_cents),
      rawScore: Math.round(result.rawScore * 100),
      review_percentage: asOptionalNullableNumber(result.payload.review_percentage),
      score: Math.round(result.score * 100),
      steam_deck: result.payload.steam_deck as SteamDeckCategory | undefined,
      tags: asOptionalStringArray(result.payload.tags),
      total_reviews: asOptionalNullableNumber(result.payload.total_reviews),
      type: asOptionalString(result.payload.type),
    })),
    sufficient_to_answer: rerankedResults.length > 0,
    sufficiency_reason:
      rerankedResults.length > 0
        ? 'Returned concept matches that already satisfy the request. Respond directly from these rows instead of broadening.'
        : undefined,
    success: true,
    total_found: rerankedResults.length,
  };
}

export async function runSemanticSearch(
  request: SemanticSearchRequest,
  deps: SemanticSearchDependencies
): Promise<SemanticSearchEngineResult> {
  if (!isQdrantConfigured()) {
    return {
      error: 'Semantic search not configured. QDRANT_URL and QDRANT_API_KEY must be set.',
      success: false,
    };
  }

  if (request.mode === 'concept') {
    if (request.entityKind !== 'game') {
      return {
        error: 'Concept search currently supports only game entities.',
        success: false,
      };
    }

    return runConceptSearch(request, deps);
  }

  const resolved = await deps.resolveReference({
    entityKind: request.entityKind,
    referencePlatformEntityId: request.referencePlatformEntityId,
    referenceQuery: request.referenceQuery,
  });

  if (!resolved.entity) {
    return {
      candidates: resolved.candidates,
      entityType: request.entityKind === 'game' ? undefined : request.entityKind,
      error: resolved.error ?? `Could not resolve the requested ${request.entityKind}.`,
      success: false,
    };
  }

  if (request.entityKind === 'game') {
    return runGameSimilarity(request, resolved.entity);
  }

  return runCompanySimilarity(
    request as SemanticSearchRequest & { entityKind: 'developer' | 'publisher' },
    resolved.entity
  );
}
