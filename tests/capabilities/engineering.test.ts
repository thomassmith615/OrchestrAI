import { describe, expect, it } from "vitest";
import { engineeringCapability } from "../../src/capabilities/engineering/index.js";
import { createRegistry } from "../../src/engine/index.js";

describe("engineeringCapability", () => {
  it("declares an empty command prefix, a backwards-compatibility concession", () => {
    expect(engineeringCapability.commandPrefix).toBe("");
    expect(engineeringCapability.id).toBe("engineering");
  });

  it("contributes exactly the v1 command list, unprefixed", () => {
    const fromCapability = engineeringCapability.commands().map((command) => command.name).sort();
    const fromCreateRegistry = createRegistry().list().map((command) => command.name).sort();

    expect(fromCapability).toEqual(fromCreateRegistry);
  });
});
