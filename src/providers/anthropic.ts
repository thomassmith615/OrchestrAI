/**
 * Anthropic provider.
 *
 * Implemented against the REST API through the injectable HTTP host rather
 * than a vendor SDK. See ADR 0006 for the reasoning and the revisit trigger.
 * Nothing in this file is visible outside `src/providers`.
 */
import { ProviderError } from "./types.js";
import type { HttpHost, HttpResponse } from "../core/hosts.js";
import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderDescriptor,
  ProviderOptions,
  StopReason,
  TokenUsage,
} from "./types.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const CREDENTIAL_ENV = "ANTHROPIC_API_KEY";

interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

interface AnthropicMessageResponse {
  readonly model?: string;
  readonly stop_reason?: string;
  readonly content?: readonly { type?: string; text?: string }[];
  readonly usage?: AnthropicUsage;
  readonly error?: { type?: string; message?: string };
}

function mapStopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case "end_turn":
      return "end";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "other";
  }
}

function failFor(status: number, detail: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("anthropic", "credentials", detail, {
      status,
      hint: `Set ${CREDENTIAL_ENV} in your environment`,
    });
  }
  if (status === 429) {
    return new ProviderError("anthropic", "rate_limit", detail, { status });
  }
  if (status >= 500) {
    return new ProviderError("anthropic", "server", detail, { status });
  }
  return new ProviderError("anthropic", "request", detail, { status });
}

async function describeFailure(response: HttpResponse): Promise<string> {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as AnthropicMessageResponse;
    return parsed.error?.message ?? `HTTP ${String(response.status)}`;
  } catch {
    return body.length > 0 ? body : `HTTP ${String(response.status)}`;
  }
}

function buildBody(
  request: CompletionRequest,
  model: string,
  stream: boolean,
): string {
  return JSON.stringify({
    model,
    max_tokens: request.maxTokens,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(request.system === undefined ? {} : { system: request.system }),
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.stopSequences === undefined
      ? {}
      : { stop_sequences: [...request.stopSequences] }),
    ...(stream ? { stream: true } : {}),
  });
}

function requireCredential(env: Readonly<Record<string, string | undefined>>): string {
  const key = env[CREDENTIAL_ENV];

  if (key === undefined || key === "") {
    throw new ProviderError(
      "anthropic",
      "credentials",
      `${CREDENTIAL_ENV} is not set`,
      { hint: "Export the variable, or run `orch doctor` to confirm" },
    );
  }

  return key;
}

async function send(
  http: HttpHost,
  apiKey: string,
  body: string,
  stream: boolean,
): Promise<HttpResponse> {
  try {
    return await http.send({
      url: API_URL,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        ...(stream ? { accept: "text/event-stream" } : {}),
      },
      body,
    });
  } catch (cause) {
    throw new ProviderError(
      "anthropic",
      "transport",
      "Could not reach the Anthropic API",
      { cause },
    );
  }
}

/** Parses one SSE `data:` payload, ignoring comments and event names. */
function parseEvent(line: string): Record<string, unknown> | null {
  if (!line.startsWith("data:")) {
    return null;
  }

  const payload = line.slice(5).trim();
  if (payload.length === 0 || payload === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readDeltaText(event: Record<string, unknown>): string | null {
  if (event["type"] !== "content_block_delta") {
    return null;
  }

  const delta = event["delta"];
  if (typeof delta !== "object" || delta === null) {
    return null;
  }

  const text = (delta as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function readUsage(event: Record<string, unknown>): Partial<TokenUsage> {
  const source =
    event["type"] === "message_start"
      ? ((event["message"] as { usage?: AnthropicUsage } | undefined)?.usage ??
        undefined)
      : ((event["usage"] as AnthropicUsage | undefined) ?? undefined);

  if (source === undefined) {
    return {};
  }

  return {
    ...(typeof source.input_tokens === "number"
      ? { inputTokens: source.input_tokens }
      : {}),
    ...(typeof source.output_tokens === "number"
      ? { outputTokens: source.output_tokens }
      : {}),
  };
}

export const anthropicProvider: ProviderDescriptor = {
  id: "anthropic",
  displayName: "Anthropic",
  credentialEnv: CREDENTIAL_ENV,
  defaultModel: DEFAULT_MODEL,
  capabilities: { streaming: true, tools: true, contextTokens: 200_000 },

  create(options: ProviderOptions): Provider {
    const configuredModel = options.model ?? DEFAULT_MODEL;

    return {
      id: "anthropic",
      displayName: anthropicProvider.displayName,
      credentialEnv: CREDENTIAL_ENV,
      defaultModel: DEFAULT_MODEL,
      capabilities: anthropicProvider.capabilities,

      async complete(request: CompletionRequest): Promise<CompletionResult> {
        const model = request.model ?? configuredModel;
        const apiKey = requireCredential(options.env);
        const response = await send(
          options.http,
          apiKey,
          buildBody(request, model, false),
          false,
        );

        if (!response.ok) {
          throw failFor(response.status, await describeFailure(response));
        }

        const parsed = JSON.parse(await response.text()) as AnthropicMessageResponse;
        const text = (parsed.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("");

        return {
          provider: "anthropic",
          model: parsed.model ?? model,
          text,
          stopReason: mapStopReason(parsed.stop_reason),
          usage: {
            inputTokens: parsed.usage?.input_tokens ?? 0,
            outputTokens: parsed.usage?.output_tokens ?? 0,
          },
        };
      },

      async *stream(
        request: CompletionRequest,
      ): AsyncGenerator<CompletionChunk, void, undefined> {
        const model = request.model ?? configuredModel;
        const apiKey = requireCredential(options.env);
        const response = await send(
          options.http,
          apiKey,
          buildBody(request, model, true),
          true,
        );

        if (!response.ok) {
          throw failFor(response.status, await describeFailure(response));
        }

        let text = "";
        let stopReason: StopReason = "other";
        let resolvedModel = model;
        let input = 0;
        let output = 0;

        for await (const line of response.lines()) {
          const event = parseEvent(line);
          if (event === null) {
            continue;
          }

          const delta = readDeltaText(event);
          if (delta !== null) {
            text += delta;
            yield { type: "text", text: delta };
          }

          if (event["type"] === "message_start") {
            const message = event["message"] as { model?: unknown } | undefined;
            if (typeof message?.model === "string") {
              resolvedModel = message.model;
            }
          }

          if (event["type"] === "message_delta") {
            const messageDelta = event["delta"] as
              | { stop_reason?: unknown }
              | undefined;
            if (typeof messageDelta?.stop_reason === "string") {
              stopReason = mapStopReason(messageDelta.stop_reason);
            }
          }

          const counted = readUsage(event);
          input = counted.inputTokens ?? input;
          output = counted.outputTokens ?? output;
        }

        yield {
          type: "done",
          result: {
            provider: "anthropic",
            model: resolvedModel,
            text,
            stopReason,
            usage: { inputTokens: input, outputTokens: output },
          },
        };
      },
    };
  },
};
