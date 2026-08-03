import { describe, expect, it } from "vitest";
import {
  createProvider,
  findProvider,
  listProviders,
  providerIds,
} from "../../src/providers/index.js";
import { fakeHttp } from "../support/fakes.js";

describe("provider registry", () => {
  it("lists providers in a stable order", () => {
    expect(providerIds()).toEqual(["anthropic", "mock", "ollama", "openai"]);
  });

  it("exposes metadata without constructing a provider", () => {
    const descriptor = findProvider("anthropic");

    expect(descriptor?.credentialEnv).toBe("ANTHROPIC_API_KEY");
    expect(descriptor?.capabilities.streaming).toBe(true);
    expect(descriptor?.defaultModel.length).toBeGreaterThan(0);
  });

  it("creates a provider that satisfies the common interface", () => {
    for (const descriptor of listProviders()) {
      const provider = createProvider(descriptor.id, {
        env: {},
        http: fakeHttp(),
        model: null,
      });

      expect(provider.id).toBe(descriptor.id);
      expect(typeof provider.complete).toBe("function");
      expect(provider.capabilities.streaming).toBe(true);
      expect(provider.stream).toBeDefined();
    }
  });

  it("rejects an unknown provider with the configuration exit code", () => {
    try {
      createProvider("skynet", { env: {}, http: fakeHttp(), model: null });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(5);
      expect((error as { hint: string }).hint).toContain("anthropic");
    }
  });
});
