import { NextRequest, NextResponse } from 'next/server';

import { postToQueryApi } from '@/lib/query-api-client';
import { createServerClient } from '@/lib/supabase/server';
import type {
  ChatEntityKind,
  ChatEntityPickerRequest,
  ChatEntityPickerResponse,
  ChatEntityPickerResults,
} from '@/lib/chat/chat-entity-picker';

export const dynamic = 'force-dynamic';

const DEFAULT_ENTITY_KINDS: ChatEntityKind[] = [
  'game',
  'publisher',
  'developer',
];

export interface ChatEntityRouteDeps {
  createServerClient: typeof createServerClient;
  postToQueryApi: typeof postToQueryApi;
}

const defaultDeps: ChatEntityRouteDeps = {
  createServerClient,
  postToQueryApi,
};

function createEmptyResults(): ChatEntityPickerResults {
  return {
    ambiguity: {
      candidateNames: [],
      message: null,
      requiresClarification: false,
    },
    entities: [],
    provenance: {
      capturedAt: new Date().toISOString(),
      source: 'tiger',
      tables: [],
    },
  };
}

function normalizeEntityKinds(entityKinds: unknown): ChatEntityKind[] {
  if (!Array.isArray(entityKinds)) {
    return DEFAULT_ENTITY_KINDS;
  }

  const allowedKinds = new Set<ChatEntityKind>([
    'game',
    'publisher',
    'developer',
  ]);

  const normalized = entityKinds.filter(
    (kind): kind is ChatEntityKind => typeof kind === 'string' && allowedKinds.has(kind as ChatEntityKind)
  );

  return normalized.length > 0 ? normalized : DEFAULT_ENTITY_KINDS;
}

export async function handleChatEntityRequest(
  request: NextRequest,
  deps: ChatEntityRouteDeps = defaultDeps
): Promise<NextResponse<ChatEntityPickerResponse>> {
  const startTime = Date.now();

  try {
    const supabase = await deps.createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          query: '',
          results: createEmptyResults(),
          error: 'Authentication required',
        },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => null)) as Partial<ChatEntityPickerRequest> | null;
    const query = typeof body?.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return NextResponse.json({
        success: true,
        query: '',
        results: createEmptyResults(),
      });
    }

    if (query.length < 2) {
      return NextResponse.json({
        success: true,
        query,
        results: createEmptyResults(),
      });
    }

    const limit = typeof body?.limit === 'number' ? Math.max(1, Math.min(body.limit, 10)) : 5;
    const entityKinds = normalizeEntityKinds(body?.entityKinds);
    const includeMetrics = body?.includeMetrics ?? true;

    const result = await deps.postToQueryApi<ChatEntityPickerResults>(
      '/v1/contracts/resolve-entities',
      {
        entityKinds,
        includeMetrics,
        limit,
        query,
      }
    );

    if (!result.ok || !result.data) {
      return NextResponse.json(
        {
          success: false,
          query,
          results: createEmptyResults(),
          error: result.reason ?? 'Unable to resolve entities',
        },
        { status: result.httpStatus ?? 502 }
      );
    }

    return NextResponse.json({
      success: true,
      query,
      results: result.data,
      timing: {
        total_ms: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Chat entity API error:', error);
    return NextResponse.json(
      {
        success: false,
        query: '',
        results: createEmptyResults(),
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ChatEntityPickerResponse>> {
  return handleChatEntityRequest(request);
}
