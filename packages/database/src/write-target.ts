export type DataWriteTarget = 'supabase' | 'shadow' | 'tiger';
export type SupabaseServiceClientPurpose =
  | 'auth'
  | 'legacy-read'
  | 'migration'
  | 'parity'
  | 'reference';

const ALLOWED_SUPABASE_SERVICE_PURPOSES = new Set<SupabaseServiceClientPurpose>([
  'auth',
  'legacy-read',
  'migration',
  'parity',
  'reference',
]);

function normalize(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function readBoolean(value: string | undefined): boolean {
  const normalized = normalize(value);
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function readDataWriteTarget(env: NodeJS.ProcessEnv = process.env): DataWriteTarget {
  const target = normalize(env.DATA_WRITE_TARGET ?? env.CHANGE_INTEL_WRITE_TARGET);

  if (target === 'shadow' || target === 'tiger') {
    return target;
  }

  return 'supabase';
}

export function readSupabaseServiceClientPurpose(
  env: NodeJS.ProcessEnv = process.env
): SupabaseServiceClientPurpose | null {
  const purpose = normalize(env.SUPABASE_SERVICE_CLIENT_PURPOSE);
  if (!purpose || !ALLOWED_SUPABASE_SERVICE_PURPOSES.has(purpose as SupabaseServiceClientPurpose)) {
    return null;
  }

  return purpose as SupabaseServiceClientPurpose;
}

export function isSupabaseServiceClientAllowedWithTiger(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (readDataWriteTarget(env) !== 'tiger') {
    return true;
  }

  if (readSupabaseServiceClientPurpose(env)) {
    return true;
  }

  return readBoolean(env.ALLOW_SUPABASE_SERVICE_CLIENT_WITH_TIGER);
}

export function assertSupabaseServiceClientAllowed(
  context: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (isSupabaseServiceClientAllowedWithTiger(env)) {
    return;
  }

  throw new Error(
    [
      `Refusing to create a Supabase service-role client for ${context} while the write target is tiger.`,
      'Workers and app product paths running in Tiger write mode must not hold Supabase service write credentials.',
      'Set SUPABASE_SERVICE_CLIENT_PURPOSE to auth, legacy-read, reference, migration, or parity only for approved non-product-write usage.',
    ].join(' ')
  );
}
