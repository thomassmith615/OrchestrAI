import { describe, expect, it } from "vitest";
import { buildCapabilitiesCommand } from "../../src/runtime/command.js";
import type { ActivationResult } from "../../src/runtime/activate.js";

describe("buildCapabilitiesCommand", () => {
  it("reports activated capabilities as passing fields", async () => {
    const activation: ActivationResult = {
      activated: [
        { id: "engineering", summary: "v1", commandPrefix: "", commands: ["status", "info"] },
      ],
      failed: [],
    };

    const result = await buildCapabilitiesCommand(activation).execute({} as never);

    expect(result.data.activated).toEqual(activation.activated);
    expect(result.report.fields).toEqual([
      { label: "engineering", value: "(no prefix) · 2 command(s)", status: "pass" },
    ]);
    expect(result.report.notes).toEqual(["1 capability(ies) activated."]);
  });

  it("reports a failed capability as a failing field", async () => {
    const activation: ActivationResult = {
      activated: [],
      failed: [{ id: "broken", reason: "cannot list commands" }],
    };

    const result = await buildCapabilitiesCommand(activation).execute({} as never);

    expect(result.report.fields).toEqual([
      { label: "broken", value: "cannot list commands", status: "fail" },
    ]);
    expect(result.report.notes).toEqual(["1 capability(ies) failed to activate."]);
  });
});
