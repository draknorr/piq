import { createHash } from 'node:crypto';

import type {
  CatalogObservationRejection,
  CatalogObservationRow,
  CatalogObservationWriteMode,
  CatalogScanSource,
} from '@publisheriq/database';

export type CatalogObservationMode = 'off' | CatalogObservationWriteMode;

export interface NormalizedCatalogObservation {
  rejections: CatalogObservationRejection[];
  rows: CatalogObservationRow[];
  sourceRowCount: number;
}

const DEFAULT_CATALOG_FINALIZATION_BATCH_SIZE = 1000;
const MAX_CATALOG_FINALIZATION_BATCH_SIZE = 5000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)])
  );
}

function hashValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

export function readCatalogObservationMode(
  env: NodeJS.ProcessEnv = process.env
): CatalogObservationMode {
  const value = env.CATALOG_OBSERVATION_MODE?.trim().toLowerCase();
  if (!value) {
    return 'off';
  }
  if (value === 'off' || value === 'shadow' || value === 'primary') {
    return value;
  }

  throw new Error(
    `Unsupported CATALOG_OBSERVATION_MODE=${env.CATALOG_OBSERVATION_MODE}; expected off, shadow, or primary`
  );
}

export function readCatalogFinalizationBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CATALOG_FINALIZATION_BATCH_SIZE?.trim();
  if (!raw) {
    return DEFAULT_CATALOG_FINALIZATION_BATCH_SIZE;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CATALOG_FINALIZATION_BATCH_SIZE) {
    throw new Error('CATALOG_FINALIZATION_BATCH_SIZE must be an integer between 1 and 5000');
  }
  return value;
}

export function buildCatalogScanRunKey(
  source: CatalogScanSource,
  env: NodeJS.ProcessEnv = process.env
): string {
  const explicit = env.CATALOG_SCAN_RUN_KEY?.trim();
  if (explicit) {
    return explicit;
  }

  const githubRunId = env.GITHUB_RUN_ID?.trim();
  if (githubRunId) {
    return `github:${source}:${githubRunId}`;
  }

  const localRunId = env.CATALOG_LOCAL_RUN_ID?.trim();
  if (localRunId) {
    return `local:${source}:${localRunId}`;
  }

  throw new Error(
    'Catalog observation requires GITHUB_RUN_ID, CATALOG_SCAN_RUN_KEY, or CATALOG_LOCAL_RUN_ID'
  );
}

export function normalizeCatalogObservationRows(
  values: unknown[],
  options: { requireHints: boolean }
): NormalizedCatalogObservation {
  const rows: CatalogObservationRow[] = [];
  const rejections: CatalogObservationRejection[] = [];
  const seenAppids = new Set<number>();

  for (const [sourceIndex, value] of values.entries()) {
    const record = readRecord(value);
    const appid = readInteger(record?.appid);
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    const lastModified = readInteger(record?.lastModified ?? record?.last_modified);
    const priceChangeNumber = readInteger(record?.priceChangeNumber ?? record?.price_change_number);

    let reason: string | null = null;
    if (!record) {
      reason = 'invalid_row';
    } else if (appid === null || appid <= 0) {
      reason = 'invalid_appid';
    } else if (!name) {
      reason = 'missing_name';
    } else if (seenAppids.has(appid)) {
      reason = 'duplicate_appid';
    } else if (options.requireHints && (lastModified === null || lastModified < 0)) {
      reason = 'invalid_last_modified';
    } else if (options.requireHints && (priceChangeNumber === null || priceChangeNumber < 0)) {
      reason = 'invalid_price_change_number';
    }

    if (reason) {
      rejections.push({
        ...(appid !== null ? { appid } : {}),
        reason,
        row_hash: hashValue(value),
        source_index: sourceIndex,
      });
      continue;
    }

    seenAppids.add(appid!);
    rows.push({
      appid: appid!,
      last_modified: options.requireHints ? lastModified : null,
      name,
      price_change_number: options.requireHints ? priceChangeNumber : null,
    });
  }

  rows.sort((left, right) => left.appid - right.appid);
  return {
    rejections,
    rows,
    sourceRowCount: values.length,
  };
}

export function buildCatalogBatchHash(
  rows: CatalogObservationRow[],
  rejections: CatalogObservationRejection[]
): string {
  return hashValue({ rejections, rows });
}

export function buildCatalogInputHash(observation: NormalizedCatalogObservation): string {
  return hashValue(observation);
}

export function assertCatalogShadowParity(params: {
  actualChangedKnownAppids: number[];
  actualUnknownAppids: number[];
  expectedChangedKnownAppids: number[];
  expectedUnknownAppids: number[];
}): void {
  const normalize = (values: number[]): number[] =>
    Array.from(new Set(values)).sort((left, right) => left - right);
  const actualUnknown = normalize(params.actualUnknownAppids);
  const expectedUnknown = normalize(params.expectedUnknownAppids);
  const actualChanged = normalize(params.actualChangedKnownAppids);
  const expectedChanged = normalize(params.expectedChangedKnownAppids);

  if (JSON.stringify(actualUnknown) !== JSON.stringify(expectedUnknown)) {
    throw new Error(
      `Catalog shadow unknown-ID parity failed: expected ${expectedUnknown.length}, received ${actualUnknown.length}`
    );
  }
  if (JSON.stringify(actualChanged) !== JSON.stringify(expectedChanged)) {
    throw new Error(
      `Catalog shadow changed-known parity failed: expected ${expectedChanged.length}, received ${actualChanged.length}`
    );
  }
}
