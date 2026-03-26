import { getReviewsQueueHealth } from '@publisheriq/database/ingestion';
import { logger } from '@publisheriq/shared';

const log = logger.child({ script: 'reviews-queue-health' });

async function main(): Promise<void> {
  try {
    const health = await getReviewsQueueHealth();

    log.info('Reviews queue health snapshot', {
      evaluatedAt: health.evaluatedAt,
      lanes: health.lanes,
      stuckClaimCount: health.stuckClaimCount,
      oldestStuckClaimMinutes: health.oldestStuckClaimMinutes,
    });
  } catch (error) {
    log.error('Failed to inspect reviews queue health', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main();
