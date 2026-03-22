import fs from 'node:fs/promises';
import path from 'node:path';

import { ROOT } from './constants.mjs';

export async function loadAutolabEnv() {
  const env = { ...process.env };
  const files = [
    path.join(ROOT, '.env'),
    path.join(ROOT, 'apps', 'admin', '.env.local'),
  ];

  for (const file of files) {
    let text = '';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) {
        env[key] = value;
      }
    }
  }

  return env;
}

export function validateAutolabEnv(env) {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BYPASS_AUTH_EMAIL']) {
    if (!env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
}

export async function authenticate(origin, env) {
  const generateResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: env.BYPASS_AUTH_EMAIL,
    }),
  });

  if (!generateResponse.ok) {
    throw new Error(`Failed to generate auth link: ${generateResponse.status}`);
  }

  const generated = await generateResponse.json();
  if (!generated.hashed_token) {
    throw new Error('Missing hashed_token from generated auth link');
  }

  const cookieJar = new Map();
  const confirmUrl = new URL('/auth/confirm', origin);
  confirmUrl.searchParams.set('token_hash', generated.hashed_token);
  confirmUrl.searchParams.set('type', 'magiclink');
  confirmUrl.searchParams.set('next', '/chat');

  const confirmResponse = await fetch(confirmUrl, {
    method: 'GET',
    redirect: 'manual',
  });

  storeResponseCookies(confirmResponse, cookieJar);

  if (confirmResponse.status !== 307 && confirmResponse.status !== 302) {
    throw new Error(`Unexpected auth confirm status: ${confirmResponse.status}`);
  }

  const chatResponse = await fetch(new URL('/chat', origin), {
    headers: {
      Cookie: serializeCookies(cookieJar),
    },
    redirect: 'manual',
  });

  if (chatResponse.status >= 300 && chatResponse.status < 400) {
    const location = chatResponse.headers.get('location') || '';
    throw new Error(`Authentication failed, redirected to ${location || 'unknown location'}`);
  }

  return {
    cookieJar,
    email: env.BYPASS_AUTH_EMAIL,
  };
}

export function serializeCookies(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function storeResponseCookies(response, cookieJar) {
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    cookieJar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}
