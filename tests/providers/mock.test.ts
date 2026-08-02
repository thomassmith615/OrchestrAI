import { describe, expect, it } from "vitest";
import { collectStream, mockProvider, MOCK_MODEL } from "../../src/providers/index.js";
import { fakeHttp } from "../support/fakes.js";
import type { Provider } from "../../src/providers/index.js";

function provider(model: string | null = null): Provider {
  return mockProvider.create({ env: {}, http: fakeHttp(), model });
}

describe("mockProvider", () => {
  it("returns a deterministic result", async () => {
    const first = await provider().complete({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 100,
    });
    const second = await provider().complete({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 100,
    });

    expect(first).toEqual(second);
    expect(first.text).toBe("mock:hello");
    expect(first.model).toBe(MOCK_MODEL);
    expect(first.usage.inputTokens).toBeGreaterThan(0);
  });

  it("honours a configured and a per-request model", async () => {
    const configured = await provider("pinned").complete({
      messages: [{ role: "user", content: "x" }],
      maxTokens: 10,
    });
    const perRequest = await provider("pinned").complete({
      messages: [{ role: "user", content: "x" }],
      maxTokens: 10,
      model: "override",
    });

    expect(configured.model).toBe("pinned");
    expect(perRequest.model).toBe("override");
  });

  it("streams chunks that collect into the same result", async () => {
    const request = {
      messages: [{ role: "user" as const, content: "a b c" }],
      maxTokens: 50,
    };
    const streamed = provider().stream;
    if (streamed === undefined) {
      expect.unreachable("mock provider must support streaming");
      return;
    }

    const chunks = [];
    for await (const chunk of streamed(request)) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === "text").length).toBeGreaterThan(1);
    expect(await collectStream(streamed(request))).toEqual(
      await provider().complete(request),
    );
  });

  it("makes no network calls", async () => {
    const http = fakeHttp();
    await mockProvider
      .create({ env: {}, http, model: null })
      .complete({ messages: [{ role: "user", content: "x" }], maxTokens: 5 });

    expect(http.requests).toHaveLength(0);
  });
});
