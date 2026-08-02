/**
 * Retry policy for provider calls.
 *
 * Only failures that could plausibly succeed on a second attempt are retried:
 * rate limits, server errors, and transport failures. A bad credential or a
 * malformed request is retried never, because doing so turns a clear error
 * into a slow one.
 *
 * Backoff is exponential with full jitter. Without jitter, several clients
 * that fail together retry together, which is how a recovering service is
 * knocked over a second time.
 */
import { ProviderError } from "./types.js";
import type { ProviderErrorKind } from "./types.js";

export const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  "rate_limit",
  "server",
  "transport",
]);

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

export interface RetryAttempt {
  /** One based. */
  readonly attempt: number;
  readonly delayMs: number;
  readonly error: ProviderError;
}

export interface RetryOptions {
  readonly policy?: RetryPolicy;
  /** Injected so tests do not sleep and jitter is deterministic. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly onRetry?: (attempt: RetryAttempt) => void;
}

export function isRetryable(error: unknown): error is ProviderError {
  return error instanceof ProviderError && RETRYABLE_KINDS.has(error.kind);
}

/**
 * A `Retry-After` header is an instruction, not a suggestion: when the service
 * says how long to wait, that wins over the computed backoff.
 */
export function retryAfterMs(header: string | undefined): number | null {
  if (header === undefined) {
    return null;
  }

  const seconds = Number.parseFloat(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function backoffDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
): number {
  const ceiling = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * Math.pow(2, attempt - 1),
  );

  // Full jitter: uniform over [0, ceiling] rather than a fixed backoff.
  return Math.round(random() * ceiling);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!isRetryable(error) || attempt >= policy.maxRetries) {
        throw error;
      }

      attempt += 1;
      const delayMs =
        error.retryAfterMs ?? backoffDelay(attempt, policy, random);

      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
