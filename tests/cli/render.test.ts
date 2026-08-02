import { describe, expect, it } from "vitest";
import { render, renderHuman, renderJson } from "../../src/cli/render.js";
import type { CommandResult } from "../../src/engine/command.js";

describe("renderHuman", () => {
  it("aligns labels to a common width", () => {
    const output = renderHuman({
      fields: [
        { label: "Repository", value: "camper-cad" },
        { label: "Branch", value: "feature/milestone-12" },
      ],
    });

    expect(output).toBe(
      ["Repository:  camper-cad", "Branch:      feature/milestone-12"].join("\n"),
    );
  });

  it("renders status values as uppercase verdicts", () => {
    const output = renderHuman({
      fields: [
        { label: "Build", value: true, status: "pass" },
        { label: "Tests", value: false, status: "fail" },
        { label: "Lint", value: null, status: "warn" },
      ],
    });

    expect(output).toBe(
      ["Build:  PASS", "Tests:  FAIL", "Lint:   WARN"].join("\n"),
    );
  });

  it("renders null values without a status as a dash", () => {
    expect(renderHuman({ fields: [{ label: "Branch", value: null }] })).toBe(
      "Branch:  -",
    );
  });

  it("prints notes after a blank line", () => {
    const output = renderHuman({
      fields: [{ label: "Build", value: true, status: "pass" }],
      notes: ["Ready for review."],
    });

    expect(output).toBe(["Build:  PASS", "", "Ready for review."].join("\n"));
  });
});

describe("renderJson", () => {
  it("emits the data payload only", () => {
    const result: CommandResult<{ ready: boolean }> = {
      data: { ready: true },
      report: { fields: [{ label: "Ready", value: true, status: "pass" }] },
    };

    expect(JSON.parse(renderJson(result))).toEqual({ ready: true });
    expect(render(result, true)).toBe(renderJson(result));
    expect(render(result, false)).toBe(renderHuman(result.report));
  });
});
