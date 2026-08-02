/**
 * OpenAI compatible provider.
 *
 * One implementation covers OpenAI and every service that speaks the chat
 * completions format at a configurable base URL, including local runtimes.
 * That is the whole point of Charter Principle 1: supporting another endpoint
 * is configuration, not code.
 *
 * There is no default model. An endpoint that routes to many vendors has no
 * sensible default, and guessing one produces a confusing 404 rather than a
 * clear "set a model".
 */
import { ProviderError } from "./types.js";
import { retryAfterMs } from "./resilience.js";
import type { HttpHost, HttpResponse } from "../core/hosts.js";
import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderDescriptor,
  ProviderOptions,
  StopReason,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o";
const CREDENTIAL_ENV = "OPENAI_API_KEY";

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
      return reason === null || reason === undefined ? "other" : "other";
  }
}

function failFor(
  status: number,
  detail: string,
  headers: Readonly<Record<string, string>>,
): ProviderError {
  const retryAfter = retryAfterMs(headers["retry-after"]);

  if (status === 401 || status === 403) {
    return new ProviderError("openai", "credentials", detail, {
      status,
      hint: `Set ${CREDENTIAL_ENV} in your environment`,
    });
  }
  if (status === 429) {
    return new ProviderError("openai", "rate_limit", detail, {
      status,
      ...(retryAfter === null ? {} : { retryAfterMs: retryAfter }),
    });
  }
  if (status >= 500) {
    return new ProviderError("openai", "server", detail, {
      status,
      ...(retryAfter === null ? {} : { retryAfterMs: retryAfter }),
    });
  }
  return new ProviderError("openai", "request", detail, { status });
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

function requireCredential(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const key = env[CREDENTIAL_ENV];

  if (key === undefined || key === "") {
    throw new ProviderError(
      "openai",
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
        authorization: `Bearer ${apiKey}`,
        ...(stream ? { accept: "text/event-stream" } : {}),
      },
      body,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  } catch (cause) {
    throw new ProviderError(
      "openai",
      "transport",
      `Could not reach ${baseUrl}`,
      { cause },
    );
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

export const openaiProvider: ProviderDescriptor = {
  id: "openai",
  displayName: "OpenAI compatible",
  credentialEnv: CREDENTIAL_ENV,
  defaultModel: DEFAULT_MODEL,
  capabilities: { streaming: true, tools: true, contextTokens: 128_000 },

  create(options: ProviderOptions): Provider {
    const configuredModel = options.model ?? DEFAULT_MODEL;
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const timeoutMs = options.timeoutMs;

    return {
      id: "openai",
      displayName: openaiProvider.displayName,
      credentialEnv: CREDENTIAL_ENV,
      defaultModel: DEFAULT_MODEL,
      capabilities: openaiProvider.capabilities,

      async complete(request: CompletionRequest): Promise<CompletionResult> {
        const model = request.model ?? configuredModel;
        const response = await send(
          options.http,
          requireCredential(options.env),
          buildBody(request, model, false),
          baseUrl,
          false,
          timeoutMs,
        );

        if (!response.ok) {
          throw failFor(
            response.status,
            await describeFailure(response),
            response.headers,
          );
        }

        const parsed = JSON.parse(await response.text()) as ChatResponse;
        const choice = parsed.choices?.[0];

        return {
          provider: "openai",
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
          options.http,
          requireCredential(options.env),
          buildBody(request, model, true),
          baseUrl,
          true,
          timeoutMs,
        );

        if (!response.ok) {
          throw failFor(
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
            provider: "openai",
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
