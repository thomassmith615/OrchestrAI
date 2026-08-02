import { describe, expect, it } from "vitest";
import { anthropicProvider, collectStream, ProviderError } from "../../src/providers/index.js";
import { fakeHttp } from "../support/fakes.js";
import type { FakeHttp } from "../support/fakes.js";
import type { CompletionChunk, Provider } from "../../src/providers/index.js";

const KEY = { ANTHROPIC_API_KEY: "sk-test" };

const SUCCESS_BODY = JSON.stringify({
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 12, output_tokens: 3 },
});

function provider(http: FakeHttp, env: Record<string, string> = KEY): Provider {
  return anthropicProvider.create({ env, http, model: null });
}

/** Narrows the optional stream method, which this provider always defines. */
function streamOf(http: FakeHttp): AsyncIterable<CompletionChunk> {
  const stream = provider(http).stream;
  if (stream === undefined) {
    throw new Error("anthropic provider must support streaming");
  }
  return stream(request);
}

const request = {
  system: "be brief",
  messages: [{ role: "user" as const, content: "hello" }],
  maxTokens: 64,
};

describe("anthropicProvider", () => {
  it("normalizes a successful response", async () => {
    const http = fakeHttp({ body: SUCCESS_BODY });

    const result = await provider(http).complete(request);

    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      text: "ok",
      stopReason: "end",
      usage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it("sends the documented headers and body shape", async () => {
    const http = fakeHttp({ body: SUCCESS_BODY });

    await provider(http).complete(request);
    const sent = http.requests[0];
    const body = JSON.parse(sent?.body ?? "{}") as Record<string, unknown>;

    expect(sent?.headers["x-api-key"]).toBe("sk-test");
    expect(sent?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(body["system"]).toBe("be brief");
    expect(body["max_tokens"]).toBe(64);
    expect(body["stream"]).toBeUndefined();
  });

  it("fails with the configuration exit code when the key is missing", async () => {
    try {
      await provider(fakeHttp(), {}).complete(request);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).kind).toBe("credentials");
      expect((error as ProviderError).exitCode).toBe(5);
    }
  });

  it("maps HTTP status codes to error kinds", async () => {
    const cases: readonly [number, string][] = [
      [401, "credentials"],
      [429, "rate_limit"],
      [500, "server"],
      [400, "request"],
    ];

    for (const [status, kind] of cases) {
      const http = fakeHttp({
        status,
        body: JSON.stringify({ error: { message: "nope" } }),
      });

      await expect(provider(http).complete(request)).rejects.toMatchObject({
        kind,
        message: "nope",
      });
    }
  });

  it("reports transport failures without leaking the cause", async () => {
    const http = fakeHttp({ throws: true });

    await expect(provider(http).complete(request)).rejects.toMatchObject({
      kind: "transport",
      code: "provider.transport",
    });
  });

  it("assembles a streamed response", async () => {
    const http = fakeHttp({
      lines: [
        'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":9}}}',
        "",
        ': keep-alive comment',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
        "data: [DONE]",
      ],
    });

    const text: string[] = [];
    let final;
    for await (const chunk of streamOf(http)) {
      if (chunk.type === "text") {
        text.push(chunk.text);
      } else {
        final = chunk.result;
      }
    }

    expect(text).toEqual(["Hel", "lo"]);
    expect(final).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      text: "Hello",
      stopReason: "end",
      usage: { inputTokens: 9, outputTokens: 5 },
    });
    expect(JSON.parse(http.requests[0]?.body ?? "{}")).toMatchObject({
      stream: true,
    });
  });

  it("collects a stream into the same shape as complete", async () => {
    const http = fakeHttp({
      lines: [
        'data: {"type":"content_block_delta","delta":{"text":"ok"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      ],
    });

    const result = await collectStream(streamOf(http));

    expect(result.text).toBe("ok");
    expect(result.provider).toBe("anthropic");
  });
});
