import { getTigerWriter, type TigerWriter } from '@publisheriq/database/tiger-writer';
import { readDataWriteTarget } from '@publisheriq/database/write-target';

export function useTigerRuntimeWrites(env: NodeJS.ProcessEnv = process.env): boolean {
  return readDataWriteTarget(env) === 'tiger';
}

export function getTigerRuntimeWriter(env: NodeJS.ProcessEnv = process.env): TigerWriter {
  return getTigerWriter(env);
}

export function getDatabaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Database operation failed';
}

export function getDatabaseErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}
