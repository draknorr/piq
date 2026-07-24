import { pathToFileURL } from "node:url";

import { logger } from "@publisheriq/shared";
import { Pool, type QueryResultRow } from "pg";

const MAX_APPIDS_PER_RUN = 5_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type PreparationStateMode = "off" | "shadow" | "primary";

export interface PreparationStateConfig {
  appids: number[];
  asOfDate: string | null;
  calculationVersion: string;
  mode: PreparationStateMode;
}

interface CountRow extends QueryResultRow {
  refreshed: number | string;
}

function parseMode(rawValue: string | undefined): PreparationStateMode {
  const value = rawValue?.trim() || "off";
  if (value === "off" || value === "shadow" || value === "primary") {
    return value;
  }

  throw new Error(
    `Invalid PREPARATION_STATE_MODE=${value}; expected off, shadow, or primary`,
  );
}

function parseAppids(rawValue: string | undefined): number[] {
  if (!rawValue?.trim()) {
    return [];
  }

  const appids = [
    ...new Set(
      rawValue.split(",").map((value) => {
        const appid = Number(value.trim());
        if (!Number.isSafeInteger(appid) || appid <= 0) {
          throw new Error(`Invalid PREPARATION_APPIDS value: ${value}`);
        }
        return appid;
      }),
    ),
  ];

  if (appids.length > MAX_APPIDS_PER_RUN) {
    throw new Error(
      `PREPARATION_APPIDS exceeds the bounded limit of ${MAX_APPIDS_PER_RUN}`,
    );
  }

  return appids;
}

function parseAsOfDate(rawValue: string | undefined): string | null {
  const value = rawValue?.trim();
  if (!value) {
    return null;
  }
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(
      `Invalid PREPARATION_AS_OF_DATE=${value}; expected YYYY-MM-DD`,
    );
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid PREPARATION_AS_OF_DATE=${value}`);
  }

  return value;
}

export function readPreparationStateConfig(
  env: NodeJS.ProcessEnv = process.env,
): PreparationStateConfig {
  const mode = parseMode(env.PREPARATION_STATE_MODE);
  const config = {
    appids: parseAppids(env.PREPARATION_APPIDS),
    asOfDate: parseAsOfDate(env.PREPARATION_AS_OF_DATE),
    calculationVersion:
      env.PREPARATION_CALCULATION_VERSION?.trim() || "signal-windows/v1",
    mode,
  } satisfies PreparationStateConfig;

  if (mode === "off") {
    return config;
  }
  if (config.appids.length === 0) {
    throw new Error(
      "PREPARATION_APPIDS is required when PREPARATION_STATE_MODE is not off",
    );
  }
  if (!config.asOfDate) {
    throw new Error(
      "PREPARATION_AS_OF_DATE is required when PREPARATION_STATE_MODE is not off",
    );
  }
  if (
    mode === "primary" &&
    env.PREPARATION_PRIMARY_CUTOVER_APPROVED?.trim() !== "true"
  ) {
    throw new Error(
      "PREPARATION_PRIMARY_CUTOVER_APPROVED=true is required for primary mode",
    );
  }

  return config;
}

function requireTigerConnectionString(env: NodeJS.ProcessEnv): string {
  const value = env.TIGER_PRIMARY_URL?.trim();
  if (!value) {
    throw new Error("TIGER_PRIMARY_URL is required");
  }
  return value;
}

function parseCount(row: CountRow | undefined): number {
  const value = Number(row?.refreshed ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export async function refreshPreparationDerivedState(
  config: PreparationStateConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ creatorRows: number; signalWindowRows: number }> {
  if (config.mode === "off") {
    return { creatorRows: 0, signalWindowRows: 0 };
  }
  if (!config.asOfDate || config.appids.length === 0) {
    throw new Error(
      "Preparation state refresh requires a date and bounded app IDs",
    );
  }

  const pool = new Pool({
    application_name: `publisheriq-preparation-state-${config.mode}`,
    connectionString: requireTigerConnectionString(env),
    max: 1,
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10min'");

    const signalWindows = await client.query<CountRow>(
      `
        SELECT metrics.refresh_app_signal_windows_v1(
          $1::date,
          $2::integer[],
          $3::text
        ) AS refreshed
      `,
      [config.asOfDate, config.appids, config.calculationVersion],
    );
    const creator = await client.query<CountRow>(
      `
        SELECT ops.refresh_creator_readiness_v1(
          $1::date,
          $2::integer[]
        ) AS refreshed
      `,
      [config.asOfDate, config.appids],
    );

    await client.query("COMMIT");
    return {
      creatorRows: parseCount(creator.rows[0]),
      signalWindowRows: parseCount(signalWindows.rows[0]),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const config = readPreparationStateConfig();
  if (config.mode === "off") {
    logger.info("Preparation derived-state refresh is off");
    return;
  }

  const result = await refreshPreparationDerivedState(config);
  logger.info("Preparation derived-state refresh completed", {
    appids: config.appids.length,
    asOfDate: config.asOfDate,
    calculationVersion: config.calculationVersion,
    mode: config.mode,
    ...result,
  });
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error) => {
    logger.error("Preparation derived-state refresh failed", { error });
    process.exitCode = 1;
  });
}
