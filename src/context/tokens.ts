/**
 * Token estimation.
 *
 * A character ratio, not a real tokenizer. A real one is a per-vendor
 * dependency with its own vocabulary files, and this platform is meant to stay
 * provider neutral. The ratio runs about ten percent low on dense code, which
 * is why the packer reserves headroom rather than filling the budget exactly.
 *
 * Swap this for a real tokenizer behind the same function if the error ever
 * matters more than the dependency.
 */

/** Average characters per token for source code and prose. */
export const CHARS_PER_TOKEN = 3.6;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type TokenEstimator = (text: string) => number;
