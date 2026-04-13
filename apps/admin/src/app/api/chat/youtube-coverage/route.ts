import { NextRequest } from 'next/server';

import { handleChatYoutubeCoverageRequest } from './handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  return handleChatYoutubeCoverageRequest(request);
}
