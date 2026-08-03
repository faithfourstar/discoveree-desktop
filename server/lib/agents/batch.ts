/**
 * Competitor Agent Runner
 *
 * Provides `runAgentBatch` — a concurrency-limited, retry-aware alternative to
 * `Promise.all` for running per-competitor agent tasks in the scheduler. Using
 * Promise.all for 20+ competitors simultaneously was causing:
 *   1. Rate-limit 429s from LLM APIs (all requests fired in the same millisecond).
 *   2. Masked errors — a single rejected promise aborted the whole batch.
 *   3. No back-off — transient errors weren't retried.
 *
 * runAgentBatch processes items with bounded concurrency, retries retryable
 * errors with exponential back-off + jitter, and always resolves (individual
 * failures are logged but don't abort the batch).
 */

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

/**
 * Returns the number of milliseconds to wait before the next retry.
 * Combines exponential back-off with ±20% jitter to spread load.
 */
export function retryAfterMs(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

/**
 * Returns true when the error is likely transient and worth retrying:
 *   - HTTP 429 rate-limit responses
 *   - HTTP 5xx server errors
 *   - Network-level timeouts / ECONNRESET
 */
export function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Explicit HTTP status codes embedded in error messages
  if (/\b429\b/.test(msg)) return true;
  if (/\b5[0-9]{2}\b/.test(msg)) return true;

  // Network-level keywords
  if (lower.includes("timeout")) return true;
  if (lower.includes("econnreset")) return true;
  if (lower.includes("econnrefused")) return true;
  if (lower.includes("socket hang up")) return true;
  if (lower.includes("rate limit")) return true;
  if (lower.includes("too many requests")) return true;

  return false;
}

/**
 * Runs `task` for every item in `items` with bounded concurrency.
 *
 * - At most `concurrency` tasks run simultaneously.
 * - Each task is retried up to `maxRetries` times on retryable errors.
 * - Non-retryable errors are caught and logged; the batch continues.
 * - Returns a `SettledResult[]` so callers can inspect per-item outcomes.
 */
export interface SettledResult<T> {
  item: T;
  result?: unknown;
  error?: unknown;
  attempts: number;
}

export async function runAgentBatch<T>(
  items: T[],
  task: (item: T, index: number) => Promise<unknown>,
  options: {
    concurrency?: number;
    maxRetries?: number;
    label?: string;
  } = {},
): Promise<SettledResult<T>[]> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const label = options.label ?? "runAgentBatch";

  const results: SettledResult<T>[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index]!;
      let lastError: unknown;
      let attempts = 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        attempts = attempt + 1;
        try {
          if (attempt > 0) {
            const delay = retryAfterMs(attempt - 1);
            console.log(`[${label}] Retry ${attempt}/${maxRetries} for item[${index}] after ${delay}ms`);
            await new Promise(res => setTimeout(res, delay));
          }
          const result = await task(item, index);
          results.push({ item, result, attempts });
          break;
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries && isRetryableError(err)) {
            // will retry
            continue;
          }
          // Non-retryable or out of retries
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${label}] item[${index}] failed after ${attempts} attempt(s): ${msg}`);
          results.push({ item, error: err, attempts });
          break;
        }
      }
    }
  }

  // Spin up `concurrency` workers; each grabs the next item when it's free.
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runWorker);
  await Promise.all(workers);

  return results;
}
