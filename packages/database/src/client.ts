import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';
import { assertSupabaseServiceClientAllowed } from './write-target.js';

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Create a Supabase client for server-side operations
 * Uses the service role key for full database access
 */
export function createServiceClient(): TypedSupabaseClient {
  assertSupabaseServiceClientAllowed('@publisheriq/database createServiceClient');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Create a Supabase client for browser/client-side operations
 * Uses the anon key for row-level security
 */
export function createBrowserClient(): TypedSupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables'
    );
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey);
}

// Singleton instance for server-side operations
let serviceClient: TypedSupabaseClient | null = null;

/**
 * Get or create a singleton Supabase service client
 */
export function getServiceClient(): TypedSupabaseClient {
  if (!serviceClient) {
    serviceClient = createServiceClient();
  }
  return serviceClient;
}
