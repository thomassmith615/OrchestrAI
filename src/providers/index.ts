/**
 * Provider registry.
 *
 * The rest of the platform asks for a provider by id and receives the common
 * interface. It never learns which vendor answered.
 */
import { OrchestraiError, EXIT_CODES } from "../core/errors.js";
import { anthropicProvider } from "./anthropic.js";
import { mockProvider } from "./mock.js";
import { openaiProvider } from "./openai.js";
import type { Provider, ProviderDescriptor, ProviderOptions } from "./types.js";

const DESCRIPTORS: readonly ProviderDescriptor[] = [
  anthropicProvider,
  mockProvider,
  openaiProvider,
];

/** All known providers, sorted by id for stable output. */
export function listProviders(): readonly ProviderDescriptor[] {
  return [...DESCRIPTORS].sort((a, b) => a.id.localeCompare(b.id));
}

export function findProvider(id: string): ProviderDescriptor | undefined {
  return DESCRIPTORS.find((descriptor) => descriptor.id === id);
}

export function providerIds(): readonly string[] {
  return listProviders().map((descriptor) => descriptor.id);
}

/** Resolves a provider by id, or throws with the known ids in the hint. */
export function createProvider(
  id: string,
  options: ProviderOptions,
): Provider {
  const descriptor = findProvider(id);

  if (descriptor === undefined) {
    throw new OrchestraiError(`Unknown provider: ${id}`, {
      code: "provider.unknown",
      exitCode: EXIT_CODES.configuration,
      hint: `Known providers: ${providerIds().join(", ")}`,
    });
  }

  return descriptor.create(options);
}

export { anthropicProvider } from "./anthropic.js";
export { mockProvider, MOCK_MODEL } from "./mock.js";
export { openaiProvider } from "./openai.js";
export {
  backoffDelay,
  isRetryable,
  retryAfterMs,
  withRetry,
  DEFAULT_RETRY_POLICY,
  RETRYABLE_KINDS,
} from "./resilience.js";
export type { RetryAttempt, RetryOptions, RetryPolicy } from "./resilience.js";
export { estimateCost, formatCost, rateFor } from "./pricing.js";
export type { TokenRate } from "./pricing.js";
export { collectStream, ProviderError } from "./types.js";
export type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  Message,
  MessageRole,
  Provider,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderErrorKind,
  ProviderOptions,
  StopReason,
  TokenUsage,
} from "./types.js";
