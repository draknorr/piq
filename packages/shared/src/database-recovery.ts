const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "53300",
]);

/** Only connection failures: SQL, authentication, and data errors remain fatal. */
export function isTransientDatabaseConnectionError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    const candidate = value as {
      code?: string;
      message?: string;
      errors?: unknown[];
      cause?: unknown;
    };
    if (Array.isArray(candidate.errors)) {
      return candidate.errors.length > 0 && candidate.errors.every(visit);
    }
    if (candidate.code) return CONNECTION_CODES.has(candidate.code);
    if (candidate.cause) return visit(candidate.cause);
    return (
      candidate.message === "Connection terminated unexpectedly" ||
      candidate.message === "Connection terminated" ||
      candidate.message === "Client has encountered a connection error and is not queryable" ||
      candidate.message === "timeout exceeded when trying to connect" ||
      candidate.message === "Connection terminated due to connection timeout"
    );
  };
  return visit(error);
}

export function waitForWorkerDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

interface DatabaseRecoveryOptions {
  signal: AbortSignal;
  onUnavailable: (error: unknown, attempt: number, delayMs: number) => void;
  onRecovered: (attempts: number) => void;
  // Inject the clock and jitter for deterministic outage and shutdown tests.
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

/**
 * Resume at the next durable queue cycle, never retry an individual transaction,
 * claimed item, or external send. Interrupted work remains subject to its lease.
 * The retry count is unlimited; the delay is bounded to avoid a restart storm.
 */
export async function runDatabaseWorker(
  runCycle: () => Promise<boolean>,
  options: DatabaseRecoveryOptions,
): Promise<void> {
  let failures = 0;
  const wait = options.wait ?? waitForWorkerDelay;
  const random = options.random ?? Math.random;
  while (!options.signal.aborted) {
    try {
      const keepRunning = await runCycle();
      if (failures > 0) options.onRecovered(failures);
      failures = 0;
      if (!keepRunning) return;
    } catch (error) {
      if (!isTransientDatabaseConnectionError(error)) throw error;
      if (options.signal.aborted) return;
      const baseMs = Math.min(60_000, 5_000 * 2 ** Math.min(failures, 4));
      const delayMs = Math.min(
        60_000,
        Math.round(baseMs * (1 + random() * 0.2)),
      );
      failures += 1;
      options.onUnavailable(error, failures, delayMs);
      await wait(delayMs, options.signal);
    }
  }
}
