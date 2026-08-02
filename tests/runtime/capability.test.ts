import { describe, expect, it } from "vitest";
import { activateCapabilities } from "../../src/runtime/activate.js";
import { prefixedCommandName } from "../../src/runtime/capability.js";
import { CapabilityRegistry } from "../../src/runtime/registry.js";
import { CommandRegistry } from "../../src/engine/registry.js";
import { ok } from "../../src/engine/command.js";
import type { Capability } from "../../src/runtime/capability.js";
import type { CommandDefinition } from "../../src/engine/command.js";

const stubCommand: CommandDefinition = {
  name: "ping",
  summary: "Test command",
  execute: () => Promise.resolve(ok({}, { fields: [] })),
};

function stubCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "stub",
    summary: "A stub capability",
    commandPrefix: "stub",
    commands: () => [stubCommand],
    ...overrides,
  };
}

describe("prefixedCommandName", () => {
  it("leaves the name unchanged for an empty prefix", () => {
    expect(prefixedCommandName({ commandPrefix: "" }, "status")).toBe("status");
  });

  it("prepends a declared prefix with a space", () => {
    expect(prefixedCommandName({ commandPrefix: "home" }, "status")).toBe(
      "home status",
    );
  });
});

describe("CapabilityRegistry", () => {
  it("registers and retrieves capabilities", () => {
    const registry = new CapabilityRegistry().register(stubCapability());

    expect(registry.has("stub")).toBe(true);
    expect(registry.get("stub")?.id).toBe("stub");
    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate registration by id", () => {
    const registry = new CapabilityRegistry().register(stubCapability());

    expect(() => registry.register(stubCapability())).toThrow(/already registered/);
  });

  it("lists capabilities sorted by id", () => {
    const registry = new CapabilityRegistry()
      .register(stubCapability({ id: "zulu" }))
      .register(stubCapability({ id: "alpha" }));

    expect(registry.list().map((capability) => capability.id)).toEqual([
      "alpha",
      "zulu",
    ]);
  });
});

describe("activateCapabilities", () => {
  it("registers a capability's commands under its declared prefix", () => {
    const registry = new CommandRegistry();

    const result = activateCapabilities([stubCapability()], registry);

    expect(result.activated).toEqual([
      { id: "stub", summary: "A stub capability", commandPrefix: "stub", commands: ["stub ping"] },
    ]);
    expect(result.failed).toEqual([]);
    expect(registry.has("stub ping")).toBe(true);
  });

  it("registers commands under a bare name for an empty prefix", () => {
    const registry = new CommandRegistry();

    activateCapabilities([stubCapability({ commandPrefix: "" })], registry);

    expect(registry.has("ping")).toBe(true);
  });

  it("does not branch on which capability is being activated", () => {
    // Two capabilities, same code path, different declared data: this is
    // the test ADR 0016 calls for. If the runtime ever special-cased one
    // capability's id, activating a second one under its own prefix would
    // either collide with or fail to reach the first's exact command names.
    const registry = new CommandRegistry();
    const first = stubCapability({ id: "alpha", commandPrefix: "alpha" });
    const second = stubCapability({ id: "beta", commandPrefix: "beta" });

    const result = activateCapabilities([first, second], registry);

    expect(result.failed).toEqual([]);
    expect(registry.has("alpha ping")).toBe(true);
    expect(registry.has("beta ping")).toBe(true);
    expect(result.activated.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
  });

  it("records a failed capability without stopping the others", () => {
    const registry = new CommandRegistry();
    const broken: Capability = {
      id: "broken",
      summary: "Throws while listing commands",
      commandPrefix: "broken",
      commands: () => {
        throw new Error("cannot list commands");
      },
    };

    const result = activateCapabilities([broken, stubCapability()], registry);

    expect(result.failed).toEqual([{ id: "broken", reason: "cannot list commands" }]);
    expect(result.activated.map((entry) => entry.id)).toEqual(["stub"]);
    expect(registry.has("stub ping")).toBe(true);
  });

  it("records a failure when two capabilities' commands collide", () => {
    const registry = new CommandRegistry();
    const first = stubCapability({ id: "first", commandPrefix: "" });
    const second = stubCapability({ id: "second", commandPrefix: "" });

    const result = activateCapabilities([first, second], registry);

    expect(result.activated.map((entry) => entry.id)).toEqual(["first"]);
    expect(result.failed).toEqual([
      { id: "second", reason: "Command already registered: ping" },
    ]);
  });
});
