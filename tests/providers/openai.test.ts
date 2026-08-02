import { describe, expect, it } from "vitest";
import { collectStream, openaiProvider, ProviderError } from "../../src/providers/index.js";
import { fakeHttp } from "../support/fakes.js";
import type { FakeHttp } from "../support/fakes.js";
import type { Provider } from "../../src/providers/index.js";

const KEY = { OPENAI_API_KEY: "sk-test" };

const SUCCESS = JSON.stringify({
  model: "gpt-4o",
  choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 11, completion_tokens: 2 },
});

const request = {
  system: "be brief",
  messages: [{ role: "user" as const, content: "hello" }],
  maxTokens: 32,
};

function provider(
  http: FakeHttp,
  env: Record<string, string> = KEY,
  baseUrl: string | null = null,
): Provider {
  return openaiProvider.create({ env, http, model: null, baseUrl });
}

describe("openaiProvider", () => {
  it("normalizes a chat completion", async () => {
    const http = fakeHttp({ body: SUCCESS });

    expect(await provider(http).complete(request)).toEqual({
      provider: "openai",
      model: "gpt-4o",
      text: "ok",
      stopReason: "end",
      usage: { inputTokens: 11, outputTokens: 2 },
    });
  });

  it("sends the system prompt as a leading message", async () => {
    const http = fakeHttp({ body: SUCCESS });

    await provider(http).complete(request);
    const body = JSON.parse(http.requests[0]?.body ?? "{}") as {
      messages: { role: string; content: string }[];
    };

    expect(body.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("uses a bearer token and the default endpoint", async () => {
    const http = fakeHttp({ body: SUCCESS });

    await provider(http).complete(request);

    expect(http.requests[0]?.headers["authorization"]).toBe("Bearer sk-test");
    expect(http.requests[0]?.url).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("honours a base URL override, which is how local models are supported", async () => {
    const http = fakeHttp({ body: SUCCESS });

    await provider(http, KEY, "http://localhost:11434/v1/").complete(request);

    expect(http.requests[0]?.url).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("maps status codes to the shared error kinds", async () => {
    for (const [status, kind] of [
      [401, "credentials"],
      [429, "rate_limit"],
      [503, "server"],
      [400, "request"],
    ] as const) {
      const http = fakeHttp({
        status,
        body: JSON.stringify({ error: { message: "nope" } }),
      });

      await expect(provider(http).complete(request)).rejects.toMatchObject({
        kind,
        provider: "openai",
      });
    }
  });

  it("carries Retry-After into the error", async () => {
    const http = fakeHttp({
      status: 429,
      body: "{}",
      headers: { "retry-after": "3" },
    });

    await expect(provider(http).complete(request)).rejects.toMatchObject({
      retryAfterMs: 3000,
    });
  });

  it("requires a credential", async () => {
    await expect(provider(fakeHttp(), {}).complete(request)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("assembles a streamed completion", async () => {
    const http = fakeHttp({
      lines: [
        'data: {"model":"gpt-4o","choices":[{"delta":{"content":"He"}}]}',
        'data: {"choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}',
        'data: {"usage":{"prompt_tokens":7,"completion_tokens":3}}',
        "data: [DONE]",
      ],
    });

    const stream = provider(http).stream;
    if (stream === undefined) {
      expect.unreachable("openai provider must support streaming");
      return;
    }

    const result = await collectStream(stream(request));

    expect(result.text).toBe("Hello");
    expect(result.stopReason).toBe("end");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });
});
