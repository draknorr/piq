import { loadYoutubeEnvFiles } from './env.js';

type WriteTarget = 'preview' | 'production';

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseAppids(value: string | undefined): number[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((appid) => Number.isInteger(appid) && appid > 0);
}

export interface YoutubeCollectorConfig {
  targetConnectionString: string;
  sourceConnectionString: string | null;
  mirrorSourceConnectionString: string | null;
  youtubeApiKey: string | null;
  bootstrapLookbackDays: number;
  dailyQuotaBudget: number;
  discoveryBudget: number;
  quotaReserve: number;
  maxSearchCallsPerRun: number;
  maxVideoRefreshesPerRun: number;
  routingCohortSize: number;
  rollupLookbackDays: number;
  channelHydrationStaleDays: number;
  allowlistAppids: number[];
  writeTarget: WriteTarget | null;
  dryRun: boolean;
  statementTimeoutMs: number;
  runLabel: string;
  mirrorBatchSize: number;
}

export function loadYoutubeConfig(
  env: NodeJS.ProcessEnv = process.env
): YoutubeCollectorConfig {
  loadYoutubeEnvFiles();

  const targetConnectionString = env.TIGER_PRIMARY_URL;
  if (!targetConnectionString) {
    throw new Error('Missing TIGER_PRIMARY_URL.');
  }

  const writeTarget = env.YOUTUBE_WRITE_TARGET === 'preview' || env.YOUTUBE_WRITE_TARGET === 'production'
    ? env.YOUTUBE_WRITE_TARGET
    : null;

  return {
    targetConnectionString,
    sourceConnectionString: env.YOUTUBE_SOURCE_DATABASE_URL ?? env.DATABASE_URL ?? null,
    mirrorSourceConnectionString:
      env.YOUTUBE_MIRROR_SOURCE_URL
      ?? env.DATA_PLANE_SOURCE_URL
      ?? null,
    youtubeApiKey: env.YOUTUBE_API_KEY ?? null,
    bootstrapLookbackDays: readNumber(env.YOUTUBE_BOOTSTRAP_LOOKBACK_DAYS, 30),
    dailyQuotaBudget: readNumber(env.YOUTUBE_DAILY_QUOTA_BUDGET, 10_000),
    discoveryBudget: readNumber(env.YOUTUBE_DISCOVERY_BUDGET, 7_200),
    quotaReserve: readNumber(env.YOUTUBE_QUOTA_RESERVE, 500),
    maxSearchCallsPerRun: readNumber(
      env.YOUTUBE_MAX_SEARCH_CALLS_PER_RUN ?? env.YOUTUBE_DISCOVERY_LIMIT,
      25
    ),
    maxVideoRefreshesPerRun: readNumber(
      env.YOUTUBE_MAX_VIDEO_REFRESHES_PER_RUN ?? env.YOUTUBE_REFRESH_LIMIT,
      500
    ),
    routingCohortSize: readNumber(env.YOUTUBE_ROUTING_COHORT_SIZE, 100),
    rollupLookbackDays: readNumber(env.YOUTUBE_ROLLUP_LOOKBACK_DAYS, 30),
    channelHydrationStaleDays: readNumber(env.YOUTUBE_CHANNEL_STALE_DAYS, 7),
    allowlistAppids: parseAppids(env.YOUTUBE_ALLOWLIST_APPIDS),
    writeTarget,
    dryRun: readBoolean(env.YOUTUBE_DRY_RUN, false),
    statementTimeoutMs: readNumber(env.DATA_PLANE_STATEMENT_TIMEOUT_MS, 15_000),
    runLabel: env.YOUTUBE_RUN_LABEL?.trim() || `youtube-${new Date().toISOString().replaceAll(':', '-')}`,
    mirrorBatchSize: readNumber(env.YOUTUBE_MIRROR_BATCH_SIZE, 500),
  };
}

export function assertWriteTarget(
  config: YoutubeCollectorConfig,
  expected: WriteTarget
): void {
  if (config.writeTarget !== expected) {
    throw new Error(
      `This command requires YOUTUBE_WRITE_TARGET=${expected}. Current value: ${config.writeTarget ?? 'unset'}.`
    );
  }
}

export function requireYoutubeApiKey(config: YoutubeCollectorConfig): string {
  if (!config.youtubeApiKey) {
    throw new Error('Missing YOUTUBE_API_KEY.');
  }

  return config.youtubeApiKey;
}
