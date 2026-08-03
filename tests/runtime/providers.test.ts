import { describe, expect, it } from "vitest";
import { composeProviders } from "../../src/runtime/providers.js";
import { listProviders } from "../../src/providers/index.js";
import type { Capability } from "../../src/runtime/capability.js";
import type { Provider, ProviderDescriptor } from "../../src/providers/types.js";

function stubDescriptor(id: string): ProviderDescriptor {
  return {
    id,
    displayName: id,
    credentialEnv: `ORCH_${id.toUpperCase()}_KEY`,
    defaultModel: `${id}-default`,
    capabilities: { streaming: false, tools: false, contextTokens: 8000 },
    create: (): Provider => {
      throw new Error("not implemented in this stub");
    },
  };
}

function providerCapability(id: string, descriptors: readonly ProviderDescriptor[]): Capability {
  return {
    id,
    summary: "A capability that declares a provider",
    commandPrefix: id,
    commands: () => [],
    providers: () => descriptors,
  };
}

describe("composeProviders", () => {
  it("returns exactly the built-in three when no capability adds anything", () => {
    const composed = composeProviders([]);

    expect(composed.map((descriptor) => descriptor.id).sort()).toEqual(
      listProviders().map((descriptor) => descriptor.id).sort(),
    );
  });

  it("is unaffected by a capability that declares no providers", () => {
    const noProviders: Capability = {
      id: "none",
      summary: "No providers",
      commandPrefix: "none",
      commands: () => [],
    };

    const composed = composeProviders([noProviders]);

    expect(composed.map((descriptor) => descriptor.id).sort()).toEqual(
      listProviders().map((descriptor) => descriptor.id).sort(),
    );
  });

  it("merges a capability's new provider alongside the built-ins without collision", () => {
    const ollama = providerCapability("home", [stubDescriptor("ollama")]);

    const composed = composeProviders([ollama]);

    const ids = composed.map((descriptor) => descriptor.id);
    expect(ids).toContain("ollama");
    for (const builtin of listProviders()) {
      expect(ids).toContain(builtin.id);
    }
  });

  it("throws when a capability declares a provider id that is already built in", () => {
    const clashing = providerCapability("home", [stubDescriptor("anthropic")]);

    expect(() => composeProviders([clashing])).toThrow(/already declared: anthropic/);
  });

  it("throws when two capabilities declare the same new provider id", () => {
    const first = providerCapability("first", [stubDescriptor("ollama")]);
    const second = providerCapability("second", [stubDescriptor("ollama")]);

    expect(() => composeProviders([first, second])).toThrow(/already declared: ollama/);
  });

  it("composes against an explicit builtins list, not just the platform default", () => {
    const home = providerCapability("home", [stubDescriptor("ollama")]);

    const composed = composeProviders([home], []);

    expect(composed.map((descriptor) => descriptor.id)).toEqual(["ollama"]);
  });
});
