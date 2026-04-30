export type ChangeIntelWriteTarget = 'supabase' | 'shadow' | 'tiger';
export type ChangeIntelReadTarget = 'supabase' | 'tiger';
export type ChangeIntelArchiveTarget = 'disabled' | 'object_storage';

export interface ChangeIntelRuntimeConfig {
  archiveTarget: ChangeIntelArchiveTarget;
  readTarget: ChangeIntelReadTarget;
  shadowStrict: boolean;
  tigerDatabaseUrl: string | null;
  writeTarget: ChangeIntelWriteTarget;
}

function normalizeEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized as T) ? (normalized as T) : fallback;
}

function readBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function readChangeIntelRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): ChangeIntelRuntimeConfig {
  return {
    archiveTarget: normalizeEnum(
      env.CHANGE_INTEL_ARCHIVE_TARGET ?? env.OBJECT_STORAGE_TARGET,
      ['disabled', 'object_storage'] as const,
      'disabled'
    ),
    readTarget: normalizeEnum(
      env.CHANGE_INTEL_READ_TARGET ?? env.DATA_READ_TARGET,
      ['supabase', 'tiger'] as const,
      'supabase'
    ),
    shadowStrict: readBoolean(env.CHANGE_INTEL_SHADOW_STRICT, false),
    tigerDatabaseUrl: env.CHANGE_INTEL_TIGER_URL ?? env.TIGER_PRIMARY_URL ?? null,
    writeTarget: normalizeEnum(
      env.CHANGE_INTEL_WRITE_TARGET ?? env.DATA_WRITE_TARGET,
      ['supabase', 'shadow', 'tiger'] as const,
      'supabase'
    ),
  };
}

export function shouldWriteSupabase(config = readChangeIntelRuntimeConfig()): boolean {
  return config.writeTarget === 'supabase' || config.writeTarget === 'shadow';
}

export function shouldWriteTiger(config = readChangeIntelRuntimeConfig()): boolean {
  return config.writeTarget === 'tiger' || config.writeTarget === 'shadow';
}
