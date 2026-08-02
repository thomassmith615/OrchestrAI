/**
 * Deterministic provider used by tests and by `--set provider=mock`.
 *
 * It performs no network access and returns a stable, inspectable echo of the
 * request. Every later milestone tests its orchestration logic against this
 * provider so that suites stay fast, free, and repeatable.
 */
import { ProviderError } from "./types.js";
import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderDescriptor,
  ProviderOptions,
} from "./types.js";

export const MOCK_MODEL = "mock-1";

/** Rough token estimate, adequate for a fixture. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function renderResponse(request: CompletionRequest): string {
  const last = request.messages.at(-1);

  if (last === undefined) {
    throw new ProviderError("mock", "request", "No messages supplied");
  }

  return `mock:${last.content}`;
}

function buildResult(
  request: CompletionRequest,
  model: string,
): CompletionResult {
  const text = renderResponse(request);
  const prompt =
    (request.system ?? "") +
    request.messages.map((message) => message.content).join("");

  return {
    provider: "mock",
    model,
    text,
    stopReason: "end",
    usage: {
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(text),
    },
  };
}

export const mockProvider: ProviderDescriptor = {
  id: "mock",
  displayName: "Mock (deterministic, offline)",
  credentialEnv: "ORCH_MOCK_KEY",
  defaultModel: MOCK_MODEL,
  capabilities: { streaming: true, tools: false, contextTokens: 100_000 },

  create(options: ProviderOptions): Provider {
    const model = options.model ?? MOCK_MODEL;

    return {
      id: "mock",
      displayName: mockProvider.displayName,
      credentialEnv: mockProvider.credentialEnv,
      defaultModel: MOCK_MODEL,
      capabilities: mockProvider.capabilities,

      complete(request: CompletionRequest): Promise<CompletionResult> {
        return Promise.resolve(buildResult(request, request.model ?? model));
      },

      // An offline provider has nothing to await, but the generator must
      // still be async to satisfy AsyncIterable.
      // eslint-disable-next-line @typescript-eslint/require-await
      async *stream(
        request: CompletionRequest,
      ): AsyncGenerator<CompletionChunk, void, undefined> {
        const result = buildResult(request, request.model ?? model);

        for (const word of result.text.split(" ")) {
          yield { type: "text", text: word };
        }

        yield { type: "done", result };
      },
    };
  },
};
