/**
 * Shared OpenAI-compatible chat completions transport.
 *
 * `openai.ts` and `ollama.ts` both speak this exact wire protocol — a local
 * Ollama instance answers the same `/chat/completions` shape a hosted
 * OpenAI-compatible endpoint does. Duplicating the request building, SSE
 * parsing, and error mapping between two files that speak an identical
 * protocol would be exactly the kind of parallel abstraction the project
 * avoids; this factory is the one implementation both configure themselves
 * from. See ADR 0022.
 */
import { ProviderError } from "./types.js";
import { retryAfterMs } from "./resilience.js";
import type { HttpHost, HttpResponse } from "../core/hosts.js";
import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderOptions,
  StopReason,
} from "./types.js";

export interface ChatCompletionsConfig {
  readonly id: string;
  readonly displayName: string;
  readonly credentialEnv: string;
  /** Whether a missing credential is a hard failure. See
   *  `ProviderDescriptor.credentialRequired`. */
  readonly credentialRequired: boolean;
  readonly defaultBaseUrl: string;
  readonly defaultModel: string;
  readonly capabilities: ProviderCapabilities;
}

interface ChatChoice {
  readonly message?: { readonly content?: string };
  readonly delta?: { readonly content?: string };
  readonly finish_reason?: string | null;
}

interface ChatResponse {
  readonly model?: string;
  readonly choices?: readonly ChatChoice[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly error?: { readonly message?: string };
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "stop":
      return "end";
    case "length":
      return "max_tokens";
    default:
      return "other";
  }
}

function failFor(
  id: string,
  credentialEnv: string,
  status: number,
  detail: string,
  headers: Readonly<Record<string, string>>,
): ProviderError {
  const retryAfter = retryAfterMs(headers["retry-after"]);

  if (status === 401 || status === 403) {
    return new ProviderError(id, "credentials", detail, {
      status,
      hint: `Set ${credentialEnv} in your environment`,
    });
  }
  if (status === 429) {
    return new ProviderError(id, "rate_limit", detail, {
      status,
      ...(retryAfter === null ? {} : { retryAfterMs: retryAfter }),
    });
  }
  if (status >= 500) {
    return new ProviderError(id, "server", detail, {
      status,
      ...(retryAfter === null ? {} : { retryAfterMs: retryAfter }),
    });
  }
  return new ProviderError(id, "request", detail, { status });
}

async function describeFailure(response: HttpResponse): Promise<string> {
  const body = await response.text();

  try {
    return (
      (JSON.parse(body) as ChatResponse).error?.message ??
      `HTTP ${String(response.status)}`
    );
  } catch {
    return body.length > 0 ? body : `HTTP ${String(response.status)}`;
  }
}

/**
 * The system prompt becomes a leading message, which is how this format
 * expresses it. The normalized request keeps them separate because not every
 * provider does.
 */
function buildBody(
  request: CompletionRequest,
  model: string,
  stream: boolean,
): string {
  const messages = [
    ...(request.system === undefined
      ? []
      : [{ role: "system", content: request.system }]),
    ...request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  return JSON.stringify({
    model,
    messages,
    max_tokens: request.maxTokens,
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.stopSequences === undefined
      ? {}
      : { stop: [...request.stopSequences] }),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  });
}

/**
 * Returns the credential to send, or `undefined` when none is configured
 * and none is required. Throws only when `credentialRequired` is true and
 * none was found — a hosted provider's existing behaviour, unchanged.
 */
function resolveCredential(
  config: ChatCompletionsConfig,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const key = env[config.credentialEnv];

  if (key !== undefined && key !== "") {
    return key;
  }
  if (config.credentialRequired) {
    throw new ProviderError(
      config.id,
      "credentials",
      `${config.credentialEnv} is not set`,
      { hint: "Export the variable, or run `orch doctor` to confirm" },
    );
  }
  return undefined;
}

async function send(
  config: ChatCompletionsConfig,
  http: HttpHost,
  apiKey: string | undefined,
  body: string,
  baseUrl: string,
  stream: boolean,
  timeoutMs: number | undefined,
): Promise<HttpResponse> {
  try {
    return await http.send({
      url: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
        ...(stream ? { accept: "text/event-stream" } : {}),
      },
      body,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  } catch (cause) {
    throw new ProviderError(config.id, "transport", `Could not reach ${baseUrl}`, {
      cause,
    });
  }
}

function parseEvent(line: string): ChatResponse | null {
  if (!line.startsWith("data:")) {
    return null;
  }

  const payload = line.slice(5).trim();
  if (payload.length === 0 || payload === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(payload) as ChatResponse;
  } catch {
    return null;
  }
}

/** Builds a `ProviderDescriptor` speaking the chat completions protocol,
 *  configured by `config`. `openai.ts` and `ollama.ts` are both this,
 *  differing only in id, defaults, and whether a credential is required. */
export function createChatCompletionsProvider(
  config: ChatCompletionsConfig,
): ProviderDescriptor {
  return {
    id: config.id,
    displayName: config.displayName,
    credentialEnv: config.credentialEnv,
    credentialRequired: config.credentialRequired,
    defaultModel: config.defaultModel,
    capabilities: config.capabilities,

    create(options: ProviderOptions): Provider {
      const configuredModel = options.model ?? config.defaultModel;
      const baseUrl = options.baseUrl ?? config.defaultBaseUrl;
      const timeoutMs = options.timeoutMs;

      return {
        id: config.id,
        displayName: config.displayName,
        credentialEnv: config.credentialEnv,
        defaultModel: config.defaultModel,
        capabilities: config.capabilities,

        async complete(request: CompletionRequest): Promise<CompletionResult> {
          const model = request.model ?? configuredModel;
          const response = await send(
            config,
            options.http,
            resolveCredential(config, options.env),
            buildBody(request, model, false),
            baseUrl,
            false,
            timeoutMs,
          );

          if (!response.ok) {
            throw failFor(
              config.id,
              config.credentialEnv,
              response.status,
              await describeFailure(response),
              response.headers,
            );
          }

          const parsed = JSON.parse(await response.text()) as ChatResponse;
          const choice = parsed.choices?.[0];

          return {
            provider: config.id,
            model: parsed.model ?? model,
            text: choice?.message?.content ?? "",
            stopReason: mapStopReason(choice?.finish_reason),
            usage: {
              inputTokens: parsed.usage?.prompt_tokens ?? 0,
              outputTokens: parsed.usage?.completion_tokens ?? 0,
            },
          };
        },

        async *stream(
          request: CompletionRequest,
        ): AsyncGenerator<CompletionChunk, void, undefined> {
          const model = request.model ?? configuredModel;
          const response = await send(
            config,
            options.http,
            resolveCredential(config, options.env),
            buildBody(request, model, true),
            baseUrl,
            true,
            timeoutMs,
          );

          if (!response.ok) {
            throw failFor(
              config.id,
              config.credentialEnv,
              response.status,
              await describeFailure(response),
              response.headers,
            );
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

            if (typeof event.model === "string") {
              resolvedModel = event.model;
            }

            const choice = event.choices?.[0];
            const delta = choice?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              text += delta;
              yield { type: "text", text: delta };
            }

            if (choice?.finish_reason != null) {
              stopReason = mapStopReason(choice.finish_reason);
            }

            input = event.usage?.prompt_tokens ?? input;
            output = event.usage?.completion_tokens ?? output;
          }

          yield {
            type: "done",
            result: {
              provider: config.id,
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
}
