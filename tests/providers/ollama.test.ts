import { describe, expect, it } from "vitest";
import { collectStream, ollamaProvider } from "../../src/providers/index.js";
import { fakeHttp } from "../support/fakes.js";
import type { FakeHttp } from "../support/fakes.js";
import type { Provider } from "../../src/providers/index.js";

const SUCCESS = JSON.stringify({
  model: "llama3.1",
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
  env: Record<string, string> = {},
  baseUrl: string | null = null,
): Provider {
  return ollamaProvider.create({ env, http, model: null, baseUrl });
}

describe("ollamaProvider", () => {
  it("declares that a credential is not required, unlike openai", () => {
    expect(ollamaProvider.credentialRequired).toBe(false);
    expect(ollamaProvider.credentialEnv).toBe("OLLAMA_API_KEY");
  });

  it("defaults to the local Ollama endpoint and a pullable model", async () => {
    const http = fakeHttp({ body: SUCCESS });

    await provider(http).complete(request);

    expect(http.requests[0]?.url).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    const body = JSON.parse(http.requests[0]?.body ?? "{}") as { model: string };
    expect(body.model).toBe("llama3.1");
  });

  it("completes successfully with no credential set at all", async () => {
    const http = fakeHttp({ body: SUCCESS });

    const result = await provider(http, {}).complete(request);

    expect(result).toEqual({
      provider: "ollama",
      model: "llama3.1",
      text: "ok",
      stopReason: "end",
      usage: { inputTokens: 11, outputTokens: 2 },
    });
    expect(http.requests[0]?.headers["authorization"]).toBeUndefined();
  });

  it("still sends a bearer token when OLLAMA_API_KEY happens to be set", async () => {
    const http = fakeHttp({ body: SUCCESS });

    await provider(http, { OLLAMA_API_KEY: "local-key" }).complete(request);

    expect(http.requests[0]?.headers["authorization"]).toBe("Bearer local-key");
  });

  it("honours a base URL override for a non-default Ollama host", async () => {
    const http = fakeHttp({ body: SUCCESS });

    await provider(http, {}, "http://gpu-box:11434/v1").complete(request);

    expect(http.requests[0]?.url).toBe(
      "http://gpu-box:11434/v1/chat/completions",
    );
  });

  it("maps a failure the same way the shared transport does for openai", async () => {
    const http = fakeHttp({
      status: 500,
      body: JSON.stringify({ error: { message: "model not pulled" } }),
    });

    await expect(provider(http).complete(request)).rejects.toMatchObject({
      kind: "server",
      provider: "ollama",
    });
  });

  it("assembles a streamed completion", async () => {
    const http = fakeHttp({
      lines: [
        'data: {"model":"llama3.1","choices":[{"delta":{"content":"He"}}]}',
        'data: {"choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}',
        'data: {"usage":{"prompt_tokens":7,"completion_tokens":3}}',
        "data: [DONE]",
      ],
    });

    const stream = provider(http).stream;
    if (stream === undefined) {
      expect.unreachable("ollama provider must support streaming");
      return;
    }

    const result = await collectStream(stream(request));

    expect(result.text).toBe("Hello");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });
});
