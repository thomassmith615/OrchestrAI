/**
 * Token pricing.
 *
 * Rates change and this table will go stale. It is therefore advisory: a
 * request whose model has no known rate still records its tokens, and reports
 * a null cost rather than a wrong one. Tokens are the fact; money is the
 * estimate.
 *
 * Prices are US dollars per million tokens.
 */
export interface TokenRate {
  readonly input: number;
  readonly output: number;
}

const RATES: Readonly<Record<string, TokenRate>> = {
  "claude-opus-5": { input: 15, output: 75 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "mock-1": { input: 0, output: 0 },
};

/** Longest prefix match, so dated model ids resolve to their family rate. */
export function rateFor(model: string): TokenRate | null {
  const direct = RATES[model];
  if (direct !== undefined) {
    return direct;
  }

  let best: { key: string; rate: TokenRate } | null = null;

  for (const [key, rate] of Object.entries(RATES)) {
    if (model.startsWith(key) && (best === null || key.length > best.key.length)) {
      best = { key, rate };
    }
  }

  return best?.rate ?? null;
}

/** Returns null when the model has no known rate. */
export function estimateCost(
  model: string,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): number | null {
  const rate = rateFor(model);

  if (rate === null) {
    return null;
  }

  return (
    (usage.inputTokens * rate.input + usage.outputTokens * rate.output) /
    1_000_000
  );
}

export function formatCost(cost: number | null): string {
  if (cost === null) {
    return "unknown rate";
  }
  if (cost === 0) {
    return "$0.00";
  }
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}
