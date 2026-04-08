import { loadYoutubeEnvFiles } from './env.js';

const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

export interface MirrorCheckResult {
  max_time: string | null;
  min_time: string | null;
  row_count: number;
}

export type MirrorCheckMode = 'append_only_window' | 'mutable_full_table';
export type MirrorCheckTimeGranularity = 'day' | 'second';

export interface MirrorCheckDefinition {
  label: string;
  mode: MirrorCheckMode;
  sql: string;
  timeGranularity: MirrorCheckTimeGranularity;
}

export interface MirrorCheckEvaluation {
  label: string;
  notes: string[];
  normalized: {
    previewMaxTime: string | null;
    previewMinTime: string | null;
    productionMaxTime: string | null;
    productionMinTime: string | null;
  };
  preview: MirrorCheckResult;
  production: MirrorCheckResult;
  status: 'fail' | 'pass' | 'warn';
}

export interface MirrorVerificationConfig {
  previewConnectionString: string;
  productionConnectionString: string;
  statementTimeoutMs: number;
}

export const MIRROR_CHECKS: MirrorCheckDefinition[] = [
  {
    label: 'docs.youtube_videos',
    mode: 'mutable_full_table',
    sql: `
      SELECT
        count(*)::int AS row_count,
        min(published_at)::text AS min_time,
        max(last_hydrated_at)::text AS max_time
      FROM docs.youtube_videos
    `,
    timeGranularity: 'second',
  },
  {
    label: 'docs.youtube_channels',
    mode: 'mutable_full_table',
    sql: `
      SELECT
        count(*)::int AS row_count,
        min(published_at)::text AS min_time,
        max(last_hydrated_at)::text AS max_time
      FROM docs.youtube_channels
    `,
    timeGranularity: 'second',
  },
  {
    label: 'docs.youtube_video_matches',
    mode: 'mutable_full_table',
    sql: `
      SELECT
        count(*)::int AS row_count,
        min(matched_at)::text AS min_time,
        max(last_decision_at)::text AS max_time
      FROM docs.youtube_video_matches
    `,
    timeGranularity: 'second',
  },
  {
    label: 'events.youtube_search_hits_30d',
    mode: 'append_only_window',
    sql: `
      SELECT
        count(*)::int AS row_count,
        min(captured_at)::text AS min_time,
        max(captured_at)::text AS max_time
      FROM events.youtube_search_hits
      WHERE captured_at >= now() - INTERVAL '30 days'
    `,
    timeGranularity: 'second',
  },
  {
    label: 'events.youtube_match_decisions_30d',
    mode: 'append_only_window',
    sql: `
      SELECT
        count(*)::int AS row_count,
        min(decided_at)::text AS min_time,
        max(decided_at)::text AS max_time
      FROM events.youtube_match_decisions
      WHERE decided_at >= now() - INTERVAL '30 days'
    `,
    timeGranularity: 'second',
  },
  {
    label: 'metrics.youtube_video_snapshots_30d',
    mode: 'append_only_window',
    sql: `
      SELECT
        count(*)::int AS row_count,
        min(snapshot_time)::text AS min_time,
        max(snapshot_time)::text AS max_time
      FROM metrics.youtube_video_snapshots
      WHERE snapshot_time >= now() - INTERVAL '30 days'
    `,
    timeGranularity: 'second',
  },
  {
    label: 'metrics.youtube_game_daily_30d',
    mode: 'append_only_window',
    sql: `
      SELECT
        count(*)::int AS row_count,
        min(metric_date)::text AS min_time,
        max(metric_date)::text AS max_time
      FROM metrics.youtube_game_daily
      WHERE metric_date >= current_date - INTERVAL '30 days'
    `,
    timeGranularity: 'day',
  },
];

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimestampValue(raw: string): string {
  const trimmed = raw.trim();
  const isoCandidate = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const offsetNormalized =
    /[+-]\d{2}$/.test(isoCandidate) ? `${isoCandidate}:00` : isoCandidate;
  const parsed = new Date(offsetNormalized);

  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString().slice(0, 19) + 'Z';
}

export function normalizeMirrorTime(
  raw: string | null,
  granularity: MirrorCheckTimeGranularity
): string | null {
  if (!raw) {
    return null;
  }

  if (granularity === 'day') {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }

    const normalized = normalizeTimestampValue(trimmed);
    return normalized.length >= 10 ? normalized.slice(0, 10) : normalized;
  }

  return normalizeTimestampValue(raw);
}

function compareNormalizedTimes(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }

  if (a == null) {
    return -1;
  }

  if (b == null) {
    return 1;
  }

  return a < b ? -1 : 1;
}

function formatLag(from: string | null, to: string | null): string {
  if (!from || !to) {
    return 'unknown lag';
  }

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return 'unknown lag';
  }

  let remainingSeconds = Math.max(0, Math.round((toMs - fromMs) / 1000));
  const days = Math.floor(remainingSeconds / 86_400);
  remainingSeconds -= days * 86_400;
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds -= hours * 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  remainingSeconds -= minutes * 60;

  const parts = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    remainingSeconds > 0 ? `${remainingSeconds}s` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' ') : '0s';
}

export function evaluateMirrorCheck(
  check: MirrorCheckDefinition,
  preview: MirrorCheckResult,
  production: MirrorCheckResult
): MirrorCheckEvaluation {
  const normalized = {
    previewMaxTime: normalizeMirrorTime(preview.max_time, check.timeGranularity),
    previewMinTime: normalizeMirrorTime(preview.min_time, check.timeGranularity),
    productionMaxTime: normalizeMirrorTime(production.max_time, check.timeGranularity),
    productionMinTime: normalizeMirrorTime(production.min_time, check.timeGranularity),
  };
  const failures: string[] = [];
  const warnings: string[] = [];

  if (preview.row_count !== production.row_count) {
    failures.push(`row_count mismatch (${preview.row_count} vs ${production.row_count})`);
  }

  if (normalized.previewMinTime !== normalized.productionMinTime) {
    failures.push(
      `min_time mismatch (${normalized.previewMinTime ?? '-'} vs ${normalized.productionMinTime ?? '-'})`
    );
  }

  const maxTimeComparison = compareNormalizedTimes(
    normalized.previewMaxTime,
    normalized.productionMaxTime
  );

  if (check.mode === 'append_only_window') {
    if (normalized.previewMaxTime !== normalized.productionMaxTime) {
      failures.push(
        `max_time mismatch (${normalized.previewMaxTime ?? '-'} vs ${normalized.productionMaxTime ?? '-'})`
      );
    }
  } else if (maxTimeComparison > 0) {
    failures.push(
      `preview max_time is ahead of production (${normalized.previewMaxTime ?? '-'} vs ${normalized.productionMaxTime ?? '-'})`
    );
  } else if (maxTimeComparison < 0) {
    warnings.push(
      `preview max_time trails production by ${formatLag(normalized.previewMaxTime, normalized.productionMaxTime)}`
    );
  }

  return {
    label: check.label,
    notes: failures.length > 0 ? failures : warnings,
    normalized,
    preview,
    production,
    status: failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
  };
}

export function resolveMirrorVerificationConfig(
  env: NodeJS.ProcessEnv = process.env
): MirrorVerificationConfig {
  loadYoutubeEnvFiles();

  const previewConnectionString =
    env.TIGER_PREVIEW_URL?.trim()
    || env.TIGER_PRIMARY_URL?.trim();
  if (!previewConnectionString) {
    throw new Error('Missing TIGER_PREVIEW_URL or TIGER_PRIMARY_URL for preview mirror verification.');
  }

  const productionConnectionString =
    env.YOUTUBE_MIRROR_SOURCE_URL?.trim()
    || env.DATA_PLANE_SOURCE_URL?.trim()
    || env.TIGER_PRODUCTION_URL?.trim();
  if (!productionConnectionString) {
    throw new Error(
      'Missing YOUTUBE_MIRROR_SOURCE_URL, DATA_PLANE_SOURCE_URL, or TIGER_PRODUCTION_URL for mirror verification.'
    );
  }

  return {
    previewConnectionString,
    productionConnectionString,
    statementTimeoutMs: readNumber(env.DATA_PLANE_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS),
  };
}
