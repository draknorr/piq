import { Pool } from 'pg';
import { logger } from '@publisheriq/shared';

const log = logger.child({ script: 'backfill-tiger-ccu-snapshots' });

interface SourceSnapshotRow {
  appid: number;
  ccu_tier: number | null;
  player_count: number;
  snapshot_time: string;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const sourceUrl = requireEnv('DATABASE_URL');
  const tigerUrl = requireEnv('TIGER_PRIMARY_URL');
  const days = parsePositiveInteger(process.env.CCU_SNAPSHOT_BACKFILL_DAYS, 30);
  const batchSize = parsePositiveInteger(process.env.BATCH_SIZE, 5000);

  const source = new Pool({
    allowExitOnIdle: true,
    connectionString: sourceUrl,
    max: 2,
  });
  const tiger = new Pool({
    allowExitOnIdle: true,
    connectionString: tigerUrl,
    max: 2,
  });

  let lastSnapshotTime = 'epoch';
  let lastAppid = 0;
  let copied = 0;

  try {
    log.info('Starting Tiger CCU snapshot backfill', { batchSize, days });

    while (true) {
      const { rows } = await source.query<SourceSnapshotRow>(
        `
          SELECT
            appid,
            to_char(snapshot_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_time,
            max(player_count)::integer AS player_count,
            max(ccu_tier)::integer AS ccu_tier
          FROM public.ccu_snapshots
          WHERE snapshot_time >= now() - ($1::integer * INTERVAL '1 day')
            AND (
              snapshot_time > $2::timestamptz
              OR (snapshot_time = $2::timestamptz AND appid > $3::integer)
            )
          GROUP BY appid, snapshot_time
          ORDER BY snapshot_time ASC, appid ASC
          LIMIT $4
        `,
        [days, lastSnapshotTime, lastAppid, batchSize]
      );

      if (rows.length === 0) {
        break;
      }

      const values: unknown[] = [];
      const tuples = rows.map((row, index) => {
        const offset = index * 4;
        values.push(row.appid, row.snapshot_time, row.player_count, row.ccu_tier ?? 3);
        return `($${offset + 1}, $${offset + 2}::timestamptz, $${offset + 3}, $${offset + 4})`;
      });

      const result = await tiger.query(
        `
          INSERT INTO metrics.ccu_snapshots (appid, snapshot_time, player_count, ccu_tier)
          VALUES ${tuples.join(', ')}
          ON CONFLICT (appid, snapshot_time) DO NOTHING
        `,
        values
      );

      copied += result.rowCount ?? 0;
      const lastRow = rows[rows.length - 1];
      const nextSnapshotTime = lastRow.snapshot_time;
      const nextAppid = lastRow.appid;

      if (nextSnapshotTime === lastSnapshotTime && nextAppid === lastAppid) {
        throw new Error(`Backfill cursor did not advance at ${lastSnapshotTime} appid ${lastAppid}`);
      }

      lastSnapshotTime = nextSnapshotTime;
      lastAppid = lastRow.appid;

      log.info('Backfill batch copied', {
        copied,
        lastAppid,
        lastSnapshotTime,
        rowsFetched: rows.length,
        rowsInserted: result.rowCount ?? 0,
      });
    }

    log.info('Tiger CCU snapshot backfill completed', { copied });
  } finally {
    await Promise.all([source.end(), tiger.end()]);
  }
}

main().catch((error) => {
  log.error('Tiger CCU snapshot backfill failed', { error });
  process.exit(1);
});
