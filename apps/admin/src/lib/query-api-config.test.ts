import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveQueryApiBaseUrl } from './query-api-config';

test('resolveQueryApiBaseUrl uses explicit env values when present', () => {
  assert.deepEqual(
    resolveQueryApiBaseUrl({
      QUERY_API_BASE_URL: 'https://query-api.example.com',
    }),
    {
      baseUrl: 'https://query-api.example.com',
      reason: null,
    }
  );
});

test('resolveQueryApiBaseUrl blocks implicit localhost fallback on deployed Vercel envs', () => {
  assert.deepEqual(
    resolveQueryApiBaseUrl({
      VERCEL_ENV: 'preview',
    }),
    {
      baseUrl: null,
      reason: 'QUERY_API_BASE_URL must be set for Vercel preview and production deployments.',
    }
  );

  assert.deepEqual(
    resolveQueryApiBaseUrl({
      VERCEL_ENV: 'production',
    }),
    {
      baseUrl: null,
      reason: 'QUERY_API_BASE_URL must be set for Vercel preview and production deployments.',
    }
  );
});

test('resolveQueryApiBaseUrl keeps localhost fallback for local development and tests', () => {
  assert.deepEqual(
    resolveQueryApiBaseUrl({
      NODE_ENV: 'development',
    }),
    {
      baseUrl: 'http://127.0.0.1:4318',
      reason: null,
    }
  );

  assert.deepEqual(
    resolveQueryApiBaseUrl({
      NODE_ENV: 'test',
    }),
    {
      baseUrl: 'http://127.0.0.1:4318',
      reason: null,
    }
  );
});
