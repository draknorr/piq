import { NextRequest } from 'next/server';

export async function POST(request: NextRequest): Promise<Response> {
  const targetUrl = new URL('/api/chat/stream', request.url);
  const headers = new Headers(request.headers);
  const body = await request.text();

  return fetch(targetUrl, {
    method: 'POST',
    headers,
    body,
  });
}
