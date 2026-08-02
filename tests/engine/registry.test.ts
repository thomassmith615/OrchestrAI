import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../../src/engine/registry.js";
import { createRegistry } from "../../src/engine/index.js";
import { ok } from "../../src/engine/command.js";
import type { CommandDefinition } from "../../src/engine/command.js";

const stub: CommandDefinition = {
  name: "stub",
  summary: "Test command",
  execute: () => Promise.resolve(ok({}, { fields: [] })),
};

describe("CommandRegistry", () => {
  it("registers and retrieves commands", () => {
    const registry = new CommandRegistry().register(stub);

    expect(registry.has("stub")).toBe(true);
    // The registry wraps `execute` to guarantee the promise contract, so the
    // stored definition is equal to the registered one but not identical.
    expect(registry.get("stub")).toMatchObject({
      name: "stub",
      summary: "Test command",
    });
    expect(registry.get("missing")).toBeUndefined();
  });

  it("converts a synchronous throw into a rejection", async () => {
    const registry = new CommandRegistry().register({
      name: "boom",
      summary: "Throws before returning",
      execute: () => {
        throw new Error("sync failure");
      },
    });

    await expect(
      registry.get("boom")?.execute({} as never),
    ).rejects.toThrow("sync failure");
  });

  it("rejects duplicate registration", () => {
    const registry = new CommandRegistry().register(stub);

    expect(() => registry.register(stub)).toThrow(/already registered/);
  });

  it("lists commands in a stable order", () => {
    const registry = new CommandRegistry()
      .register({ ...stub, name: "zulu" })
      .register({ ...stub, name: "alpha" });

    expect(registry.list().map((command) => command.name)).toEqual([
      "alpha",
      "zulu",
    ]);
  });
});

describe("createRegistry", () => {
  it("registers the current command surface in stable order", () => {
    expect(createRegistry().list().map((command) => command.name)).toEqual([
      "build",
      "config",
      "context",
      "doctor",
      "history",
      "info",
      "init",
      "memory",
      "memory add",
      "memory compact",
      "memory verify",
      "milestone",
      "next",
      "propose",
      "propose apply",
      "propose list",
      "propose reject",
      "propose show",
      "provider add",
      "providers",
      "review",
      "roadmap",
      "status",
      "test",
    ]);
  });
});
