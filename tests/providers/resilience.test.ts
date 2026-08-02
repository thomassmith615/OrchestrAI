import { describe, expect, it } from "vitest";
import {
  backoffDelay,
  isRetryable,
  ProviderError,
  retryAfterMs,
  withRetry,
} from "../../src/providers/index.js";
import type {
  ProviderErrorKind,
  RetryAttempt,
  RetryPolicy,
} from "../../src/providers/index.js";

const POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
};

function fail(
  kind: ProviderErrorKind,
  extra: { retryAfterMs?: number } = {},
): ProviderError {
  return new ProviderError("test", kind, `${kind} failure`, extra);
}

async function attempt(
  outcomes: readonly ("ok" | ProviderError)[],
): Promise<{ result: string; calls: number; retries: RetryAttempt[] }> {
  let calls = 0;
  const retries: RetryAttempt[] = [];

  const result = await withRetry(
    () => {
      const outcome = outcomes[calls] ?? "ok";
      calls += 1;
      return outcome === "ok"
        ? Promise.resolve("ok")
        : Promise.reject(outcome);
    },
    {
      policy: POLICY,
      sleep: () => Promise.resolve(),
      random: () => 0.5,
      onRetry: (entry) => retries.push(entry),
    },
  );

  return { result, calls, retries };
}

describe("isRetryable", () => {
  it("retries transient failures only", () => {
    expect(isRetryable(fail("rate_limit"))).toBe(true);
    expect(isRetryable(fail("server"))).toBe(true);
    expect(isRetryable(fail("transport"))).toBe(true);
  });

  it("never retries a bad credential or a bad request", () => {
    expect(isRetryable(fail("credentials"))).toBe(false);
    expect(isRetryable(fail("request"))).toBe(false);
    expect(isRetryable(new Error("plain"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately when the first attempt succeeds", async () => {
    const { calls, retries } = await attempt(["ok"]);

    expect(calls).toBe(1);
    expect(retries).toHaveLength(0);
  });

  it("retries a transient failure and then succeeds", async () => {
    const { result, calls, retries } = await attempt([
      fail("server"),
      fail("rate_limit"),
      "ok",
    ]);

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(retries.map((entry) => entry.attempt)).toEqual([1, 2]);
  });

  it("gives up after the configured number of retries", async () => {
    await expect(
      attempt([fail("server"), fail("server"), fail("server"), fail("server")]),
    ).rejects.toMatchObject({ kind: "server" });
  });

  it("does not retry a credential failure", async () => {
    let calls = 0;

    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.reject(fail("credentials"));
        },
        { policy: POLICY, sleep: () => Promise.resolve() },
      ),
    ).rejects.toMatchObject({ kind: "credentials" });

    expect(calls).toBe(1);
  });

  it("honours a Retry-After value over the computed backoff", async () => {
    const { retries } = await attempt([
      fail("rate_limit", { retryAfterMs: 4321 }),
      "ok",
    ]);

    expect(retries[0]?.delayMs).toBe(4321);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially and is capped", () => {
    expect(backoffDelay(1, POLICY, () => 1)).toBe(100);
    expect(backoffDelay(2, POLICY, () => 1)).toBe(200);
    expect(backoffDelay(9, POLICY, () => 1)).toBe(1000);
  });

  it("applies full jitter rather than a fixed delay", () => {
    expect(backoffDelay(3, POLICY, () => 0)).toBe(0);
    expect(backoffDelay(3, POLICY, () => 0.5)).toBe(200);
  });
});

describe("retryAfterMs", () => {
  it("reads a seconds value", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("0.5")).toBe(500);
  });

  it("returns null for a missing or unparsable header", () => {
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
});
