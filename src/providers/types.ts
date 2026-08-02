/**
 * The provider abstraction.
 *
 * This is the single most important interface in the platform. Charter
 * Principle 1: AI providers are interchangeable. Nothing outside
 * `src/providers` may import a vendor SDK, reference a vendor specific type,
 * or hard code a model name.
 *
 * If a capability cannot be expressed here in terms every provider could
 * implement, it does not belong in this interface.
 */
import { EXIT_CODES, OrchestraiError } from "../core/errors.js";
import type { EnvHost, HttpHost } from "../core/hosts.js";

export type MessageRole = "user" | "assistant";

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
}

export interface CompletionRequest {
  /** System prompt, applied outside the message list. */
  readonly system?: string;
  readonly messages: readonly Message[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Overrides the configured model for this request only. */
  readonly model?: string;
  readonly stopSequences?: readonly string[];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Why generation stopped, normalized across providers. */
export type StopReason = "end" | "max_tokens" | "stop_sequence" | "other";

export interface CompletionResult {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly stopReason: StopReason;
  readonly usage: TokenUsage;
}

/** Incremental output. Text chunks arrive first, usage arrives last. */
export type CompletionChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "done"; readonly result: CompletionResult };

export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  /** Context window of the provider's default model, in tokens. */
  readonly contextTokens: number;
}

export interface Provider {
  readonly id: string;
  readonly displayName: string;
  /** Environment variable holding this provider's credential. */
  readonly credentialEnv: string;
  readonly defaultModel: string;
  readonly capabilities: ProviderCapabilities;
  // `this: void` because providers are plain objects built from closures.
  // Methods never depend on their receiver, so they are safe to pass around.
  complete(this: void, request: CompletionRequest): Promise<CompletionResult>;
  /** Only defined when `capabilities.streaming` is true. */
  stream?(this: void, request: CompletionRequest): AsyncIterable<CompletionChunk>;
}

export interface ProviderOptions {
  readonly env: EnvHost;
  readonly http: HttpHost;
  /** Model from configuration, or null to use the provider default. */
  readonly model: string | null;
  /** Endpoint override, for compatible or self hosted deployments. */
  readonly baseUrl?: string | null;
  /** Per-request deadline in milliseconds. */
  readonly timeoutMs?: number;
}

/** Metadata available without constructing a provider. */
export interface ProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly credentialEnv: string;
  readonly defaultModel: string;
  readonly capabilities: ProviderCapabilities;
  create(options: ProviderOptions): Provider;
}

export type ProviderErrorKind =
  | "credentials"
  | "request"
  | "rate_limit"
  | "server"
  | "transport"
  | "unsupported";

/** Provider failures, normalized so callers never inspect a vendor error. */
export class ProviderError extends OrchestraiError {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly status: number | undefined;
  /** Honoured by the retry policy when the service supplied one. */
  readonly retryAfterMs: number | undefined;

  constructor(
    provider: string,
    kind: ProviderErrorKind,
    message: string,
    options: {
      status?: number;
      hint?: string;
      cause?: unknown;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message, {
      code: `provider.${kind}`,
      exitCode:
        kind === "credentials" ? EXIT_CODES.configuration : EXIT_CODES.failure,
      ...(options.hint === undefined ? {} : { hint: options.hint }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.kind = kind;
    this.provider = provider;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Collects a stream into a single result, for callers that do not stream. */
export async function collectStream(
  chunks: AsyncIterable<CompletionChunk>,
): Promise<CompletionResult> {
  let last: CompletionResult | undefined;

  for await (const chunk of chunks) {
    if (chunk.type === "done") {
      last = chunk.result;
    }
  }

  if (last === undefined) {
    throw new Error("Stream ended without a result");
  }

  return last;
}
