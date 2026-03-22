import { NextRequest } from 'next/server';
import { handleChatStreamRequest } from '../stream/route';

export async function POST(request: NextRequest): Promise<Response> {
  return handleChatStreamRequest(request, { requireEvalSecret: true });
}
