import { NextRequest } from 'next/server';

import { handleChatStreamRequest } from './handler';

export async function POST(request: NextRequest): Promise<Response> {
  return handleChatStreamRequest(request, { requireEvalSecret: false });
}
