import type { Pool } from 'pg';

import { logger } from '@publisheriq/shared';

import { dedupeStrings } from './normalize.js';
import type { RoutedGameCandidate, RoutingLane } from './types.js';

const log = logger.child({ package: 'youtube-cohort' });

interface GameOverrideRow {
  allow_second_page: boolean;
  override_priority_delta: number | null;
  override_query_template_id: string | null;
  override_state: string;
}

interface SourceRelations {
  apps: string;
  syncStatus: string;
  appTrends: string;
}

export interface RoutedGamePlan {
  appid: number;
  appName: string;
  routingState: RoutingLane | 'suppressed';
  sourcePriorityScore: number;
  sourceRefreshTier: string | null;
  queryTemplateId: string;
  allowSecondPage: boolean;
}

async function resolveSourceRelations(sourcePool: Pool): Promise<SourceRelations> {
  const result = await sourcePool.query<{ has_tiger_legacy_apps: boolean }>(
    "SELECT to_regclass('legacy.apps') IS NOT NULL AS has_tiger_legacy_apps"
  );

  if (result.rows[0]?.has_tiger_legacy_apps) {
    return {
      apps: 'legacy.apps',
      syncStatus: 'ops.sync_status',
      appTrends: 'metrics.app_trends',
    };
  }

  return {
    apps: 'apps',
    syncStatus: 'sync_status',
    appTrends: 'app_trends',
  };
}

export async function fetchRoutedGameCandidates(
  sourcePool: Pool,
  targetPool: Pool,
  params: {
    cohortSize: number;
    allowlistAppids: number[];
  }
): Promise<RoutedGameCandidate[]> {
  const limit = Math.max(params.cohortSize * 3, params.cohortSize);
  const allowlistClause = params.allowlistAppids.length > 0
    ? 'AND a.appid = ANY($2::int[])'
    : '';
  const values: unknown[] = [limit];

  if (params.allowlistAppids.length > 0) {
    values.push(params.allowlistAppids);
  }

  const sourceRelations = await resolveSourceRelations(sourcePool);

  const rows = await sourcePool.query<{
    appid: number;
    name: string;
    priority_score: number | null;
    refresh_tier: string | null;
    release_date: string | null;
    review_velocity_7d: number | null;
    trend_change_30d_pct: number | null;
  }>(
    `
      SELECT
        a.appid,
        a.name,
        COALESCE(s.priority_score, 0) AS priority_score,
        s.refresh_tier,
        a.release_date::text AS release_date,
        COALESCE(t.review_velocity_7d, 0) AS review_velocity_7d,
        ABS(COALESCE(t.trend_30d_change_pct, 0)) AS trend_change_30d_pct
      FROM ${sourceRelations.apps} a
      LEFT JOIN ${sourceRelations.syncStatus} s ON s.appid = a.appid
      LEFT JOIN ${sourceRelations.appTrends} t ON t.appid = a.appid
      WHERE a.type = 'game'
        AND COALESCE(a.is_delisted, FALSE) = FALSE
        ${allowlistClause}
      ORDER BY
        COALESCE(s.priority_score, 0) DESC,
        COALESCE(t.review_velocity_7d, 0) DESC,
        ABS(COALESCE(t.trend_30d_change_pct, 0)) DESC,
        a.appid ASC
      LIMIT $1
    `,
    values
  );

  const aliases = await fetchAliases(targetPool, rows.rows.map((row) => row.appid));

  return rows.rows.map((row) => ({
    appid: row.appid,
    name: row.name,
    priorityScore: row.priority_score ?? 0,
    refreshTier: row.refresh_tier,
    releaseDate: row.release_date,
    reviewVelocity7d: row.review_velocity_7d ?? 0,
    trendChange30dPct: row.trend_change_30d_pct ?? 0,
    aliases: dedupeStrings([row.name, ...(aliases.get(row.appid) ?? [])]),
  }));
}

async function fetchAliases(targetPool: Pool, appids: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (appids.length === 0) {
    return map;
  }

  try {
    const result = await targetPool.query<{
      appid: string;
      alias: string;
    }>(
      `
        SELECT
          e.platform_entity_id AS appid,
          a.alias
        FROM core.entities e
        JOIN core.entity_aliases a
          ON a.entity_uid = e.entity_uid
        WHERE e.platform = 'steam'
          AND e.entity_kind = 'game'
          AND e.platform_entity_id = ANY($1::text[])
      `,
      [appids.map(String)]
    );

    for (const row of result.rows) {
      const appid = Number(row.appid);
      const existing = map.get(appid) ?? [];
      existing.push(row.alias);
      map.set(appid, existing);
    }
  } catch (error) {
    log.warn('Falling back to app-name-only aliases because Tiger identity aliases are unavailable', {
      error,
    });
  }

  return map;
}

async function fetchOverrides(targetPool: Pool, appids: number[]): Promise<Map<number, GameOverrideRow>> {
  const map = new Map<number, GameOverrideRow>();
  if (appids.length === 0) {
    return map;
  }

  const result = await targetPool.query<{
    appid: number;
    allow_second_page: boolean;
    override_priority_delta: number | null;
    override_query_template_id: string | null;
    override_state: string;
  }>(
    `
      SELECT
        appid,
        allow_second_page,
        override_priority_delta,
        override_query_template_id,
        override_state
      FROM ops.youtube_game_overrides
      WHERE appid = ANY($1::int[])
    `,
    [appids]
  );

  for (const row of result.rows) {
    map.set(row.appid, row);
  }

  return map;
}

function assignRoutingLane(index: number): RoutingLane {
  if (index < 15) {
    return 'escalated';
  }

  if (index < 40) {
    return 'active_baseline_daily';
  }

  if (index < 85) {
    return 'active_baseline_rotating';
  }

  return 'evergreen_baseline';
}

export async function buildRoutingPlan(
  targetPool: Pool,
  candidates: RoutedGameCandidate[],
  cohortSize: number
): Promise<RoutedGamePlan[]> {
  const selected = candidates.slice(0, cohortSize);
  const overrides = await fetchOverrides(targetPool, selected.map((candidate) => candidate.appid));

  const adjusted = selected
    .map((candidate) => {
      const override = overrides.get(candidate.appid);
      return {
        candidate,
        override,
        adjustedPriority: candidate.priorityScore + (override?.override_priority_delta ?? 0),
      };
    })
    .sort((left, right) =>
      right.adjustedPriority - left.adjustedPriority
      || right.candidate.reviewVelocity7d - left.candidate.reviewVelocity7d
      || right.candidate.trendChange30dPct - left.candidate.trendChange30dPct
      || left.candidate.appid - right.candidate.appid
    );

  return adjusted.map(({ candidate, override }, index) => ({
    appid: candidate.appid,
    appName: candidate.name,
    routingState: override?.override_state === 'suppressed'
      ? 'suppressed'
      : assignRoutingLane(index),
    sourcePriorityScore: candidate.priorityScore,
    sourceRefreshTier: candidate.refreshTier,
    queryTemplateId: override?.override_query_template_id ?? 'canonical_name_v1',
    allowSecondPage: Boolean(override?.allow_second_page) || index < 15,
  }));
}
