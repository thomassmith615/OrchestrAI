import { describe, expect, it } from "vitest";
import {
  describeError,
  EXIT_CODES,
  isOrchestraiError,
  OrchestraiError,
  UsageError,
} from "../../src/core/errors.js";

describe("OrchestraiError", () => {
  it("defaults to the generic failure exit code", () => {
    const error = new OrchestraiError("boom", { code: "core.boom" });

    expect(error.exitCode).toBe(EXIT_CODES.failure);
    expect(error.name).toBe("OrchestraiError");
    expect(isOrchestraiError(error)).toBe(true);
  });

  it("preserves the underlying cause", () => {
    const cause = new Error("root");
    const error = new OrchestraiError("wrapped", { code: "core.wrapped", cause });

    expect(error.cause).toBe(cause);
  });
});

describe("UsageError", () => {
  it("uses the usage exit code and renders its hint", () => {
    const error = new UsageError("unknown command", "run orchestrai --help");

    expect(error.exitCode).toBe(EXIT_CODES.usage);
    expect(describeError(error)).toBe(
      "cli.usage: unknown command (run orchestrai --help)",
    );
  });
});

describe("describeError", () => {
  it("handles plain errors and non-error values", () => {
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError("string failure")).toBe("string failure");
  });
});
