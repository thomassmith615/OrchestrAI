import { describe, expect, it } from "vitest";
import { assembleRuntime, defaultCapabilities } from "../../src/capabilities/index.js";
import { engineeringCapability } from "../../src/capabilities/engineering/index.js";
import { createRegistry } from "../../src/engine/index.js";
import { ok } from "../../src/engine/command.js";
import type { Capability } from "../../src/runtime/capability.js";

const secondCapability: Capability = {
  id: "second",
  summary: "A trivial capability activated alongside Engineering",
  commandPrefix: "second",
  commands: () => [
    {
      name: "ping",
      summary: "Test command",
      execute: () => Promise.resolve(ok({}, { fields: [] })),
    },
  ],
};

describe("assembleRuntime", () => {
  it("activates the default capability set (Engineering alone) unchanged", () => {
    const { registry, activation } = assembleRuntime();

    expect(activation.failed).toEqual([]);
    expect(activation.activated.map((entry) => entry.id)).toEqual(["engineering"]);

    const v1Names = createRegistry().list().map((command) => command.name);
    for (const name of v1Names) {
      expect(registry.has(name)).toBe(true);
    }
    expect(registry.has("capabilities")).toBe(true);
  });

  it(
    "activates Engineering into exactly the v1 command names while a second " +
      "capability activates alongside it under its own prefix",
    () => {
      // This is the test that would catch a privileged path: if the runtime
      // ever special-cased Engineering by id, adding a second capability
      // would either collide with it or fail to leave its names untouched.
      const { registry, activation } = assembleRuntime([
        engineeringCapability,
        secondCapability,
      ]);

      expect(activation.failed).toEqual([]);
      expect(activation.activated.map((entry) => entry.id)).toEqual([
        "engineering",
        "second",
      ]);

      const engineeringEntry = activation.activated.find(
        (entry) => entry.id === "engineering",
      );
      const v1Names = createRegistry().list().map((command) => command.name).sort();
      expect([...(engineeringEntry?.commands ?? [])].sort()).toEqual(v1Names);

      expect(registry.has("second ping")).toBe(true);
      expect(registry.has("ping")).toBe(false);
    },
  );

  it("exposes Engineering as the sole first-party default capability", () => {
    expect(defaultCapabilities.map((capability) => capability.id)).toEqual([
      "engineering",
    ]);
  });
});
