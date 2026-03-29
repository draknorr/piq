import { refreshCcuQualityStats } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';

const log = logger.child({ component: 'ccu-quality-cache' });
const DEFAULT_REFRESH_TIMEOUT_MS = 600_000;

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function refreshCcuQualityCacheSafely(
  trigger: string,
  timeoutMs: number = DEFAULT_REFRESH_TIMEOUT_MS
): Promise<void> {
  try {
    await refreshCcuQualityStats({ timeoutMs });
    log.info('Refreshed CCU quality cache', { trigger, timeoutMs });
  } catch (error) {
    log.warn('Failed to refresh CCU quality cache', {
      trigger,
      timeoutMs,
      error: formatUnknownError(error),
    });
  }
}
