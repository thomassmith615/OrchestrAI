import { describe, expect, it } from "vitest";
import { runGates, GATE_NAMES, VALIDATION_GATES } from "../../src/gates/index.js";
import { fakeClock, fakeProcess } from "../support/fakes.js";
import type { Toolchain } from "../../src/repo/index.js";
import type { GateName, GateRun } from "../../src/gates/index.js";

const NODE_TOOLCHAIN: Toolchain = {
  ecosystem: "node",
  packageManager: "npm",
  build: { command: "npm", args: ["run", "build"] },
  typecheck: { command: "npm", args: ["run", "typecheck"] },
  lint: { command: "npm", args: ["run", "lint"] },
  test: { command: "npm", args: ["test"] },
  ci: null,
  manifests: ["package.json"],
};

function run(
  toolchain: Toolchain,
  responses: Record<
    string,
    {
      ok?: boolean;
      code?: number | null;
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
    }
  > = {},
  gates: readonly GateName[] = GATE_NAMES,
): { proc: ReturnType<typeof fakeProcess>; result: GateRun } {
  const proc = fakeProcess({}, responses);
  return {
    proc,
    result: runGates({
      root: "/repo",
      toolchain,
      proc,
      clock: fakeClock(),
      gates,
    }),
  };
}

describe("runGates", () => {
  it("passes when every command succeeds", () => {
    const { result, proc } = run(NODE_TOOLCHAIN);

    expect(result.ok).toBe(true);
    expect(result.passed).toBe(4);
    expect(result.failed).toBe(0);
    expect(proc.calls).toHaveLength(4);
  });

  it("records the failing gate with its exit code and output", () => {
    const { result } = run(NODE_TOOLCHAIN, {
      "npm test": { code: 1, stderr: "2 tests failed" },
    });

    const test = result.results.find((entry) => entry.name === "test");
    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(test?.status).toBe("fail");
    expect(test?.exitCode).toBe(1);
    expect(test?.output).toContain("2 tests failed");
  });

  it("skips gates with no command instead of guessing", () => {
    const { result, proc } = run({
      ...NODE_TOOLCHAIN,
      lint: null,
      typecheck: null,
    });

    expect(result.skipped).toBe(2);
    expect(result.ok).toBe(true);
    expect(proc.calls).toHaveLength(2);
    expect(
      result.results.find((entry) => entry.name === "lint")?.command,
    ).toBeNull();
  });

  it("keeps a skipped gate out of the pass count", () => {
    const { result } = run({ ...NODE_TOOLCHAIN, build: null }, {}, ["build"]);

    expect(result.passed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("runs only the requested gates", () => {
    const { proc } = run(NODE_TOOLCHAIN, {}, VALIDATION_GATES);

    expect(proc.calls.map((call) => call.args.join(" "))).toEqual([
      "run typecheck",
      "run lint",
      "test",
    ]);
  });

  it("marks a timed out gate as failed", () => {
    const { result } = run(NODE_TOOLCHAIN, {
      "npm run build": { ok: false, code: null, timedOut: true },
    });

    const build = result.results.find((entry) => entry.name === "build");
    expect(build?.timedOut).toBe(true);
    expect(build?.status).toBe("fail");
  });

  it("reports progress through the callbacks", () => {
    const started: string[] = [];
    runGates({
      root: "/repo",
      toolchain: NODE_TOOLCHAIN,
      proc: fakeProcess(),
      clock: fakeClock(),
      gates: ["build"],
      onStart: (name, command) => started.push(`${name}:${command}`),
    });

    expect(started).toEqual(["build:npm run build"]);
  });
});
