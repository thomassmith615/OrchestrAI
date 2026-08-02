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
    expect(registry.get("stub")).toBe(stub);
    expect(registry.get("missing")).toBeUndefined();
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
      "doctor",
      "info",
      "init",
      "provider add",
      "providers",
      "status",
      "test",
    ]);
  });
});
