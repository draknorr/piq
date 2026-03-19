import { NextRequest, NextResponse } from 'next/server';
import {
  findSimilarWithTimeout,
  QDRANT_TIMEOUT_ERROR,
  type FindSimilarArgs,
} from '@/lib/qdrant/search-service';
import type { PopularityComparison, ReviewComparison } from '@publisheriq/qdrant';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Auth check (defense-in-depth, middleware also checks)
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;

    const entityType = searchParams.get('entity_type') as 'game' | 'publisher' | 'developer' | null;
    const referenceIdStr = searchParams.get('reference_id');
    const referenceName = searchParams.get('reference_name');
    const limitStr = searchParams.get('limit');
    const popularityComparison = searchParams.get('popularity_comparison') as PopularityComparison | null;
    const reviewComparison = searchParams.get('review_comparison') as ReviewComparison | null;
    const maxPriceCents = searchParams.get('max_price_cents');
    const isFree = searchParams.get('is_free');
    const platforms = searchParams.getAll('platforms');
    const steamDeck = searchParams.getAll('steam_deck');
    const genres = searchParams.getAll('genres');
    const tags = searchParams.getAll('tags');
    const minReviews = searchParams.get('min_reviews');

    const referenceId = referenceIdStr ? parseInt(referenceIdStr, 10) : null;

    if (!entityType || (!referenceName && (referenceId === null || isNaN(referenceId)))) {
      return NextResponse.json(
        { success: false, error: 'entity_type and (reference_id or reference_name) are required' },
        { status: 400 }
      );
    }

    if (!['game', 'publisher', 'developer'].includes(entityType)) {
      return NextResponse.json(
        { success: false, error: 'entity_type must be game, publisher, or developer' },
        { status: 400 }
      );
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 10;
    if (isNaN(limit) || limit < 1 || limit > 50) {
      return NextResponse.json(
        { success: false, error: 'limit must be between 1 and 50' },
        { status: 400 }
      );
    }

    // Build filters
    const filters: FindSimilarArgs['filters'] = {};

    if (popularityComparison) {
      filters.popularity_comparison = popularityComparison;
    }
    if (reviewComparison) {
      filters.review_comparison = reviewComparison;
    }
    if (maxPriceCents) {
      const cents = parseInt(maxPriceCents, 10);
      if (!isNaN(cents)) {
        filters.max_price_cents = cents;
      }
    }
    if (isFree === 'true') {
      filters.is_free = true;
    }
    if (platforms.length > 0) {
      filters.platforms = platforms as ('windows' | 'macos' | 'linux')[];
    }
    if (steamDeck.length > 0) {
      filters.steam_deck = steamDeck as ('verified' | 'playable')[];
    }
    if (genres.length > 0) {
      filters.genres = genres;
    }
    if (tags.length > 0) {
      filters.tags = tags;
    }
    if (minReviews) {
      const reviews = parseInt(minReviews, 10);
      if (!isNaN(reviews)) {
        filters.min_reviews = reviews;
      }
    }

    const result = await findSimilarWithTimeout({
      entity_type: entityType,
      reference_id: referenceId !== null && !isNaN(referenceId) ? referenceId : undefined,
      reference_name: referenceName ?? undefined,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      limit,
    });

    const status = result.success
      ? 200
      : result.error === QDRANT_TIMEOUT_ERROR
        ? 504
        : 200;

    return NextResponse.json(result, { status });
  } catch (error) {
    console.error('Similarity API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
