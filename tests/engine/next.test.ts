import { describe, expect, it } from "vitest";
import { nextCommand } from "../../src/engine/commands/next.js";
import { listRuns } from "../../src/workflow/index.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { CommandContext } from "../../src/engine/command.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: CONFIG_PATH,
  initialized: true,
};

const ROADMAP = [
  "- [x] **M1. Foundation**",
  "  Scaffolding.",
  "",
  "- [ ] **M2. Configuration**",
  "  Layered configuration with source tracking.",
  "",
  "- [ ] **M3. Providers**",
  "",
].join("\n");

const CLEAN_GIT = { "git status": { stdout: "# branch.head main" } };

function build(
  options: Record<string, unknown> = {},
  responses: Record<string, { stdout?: string; code?: number }> = CLEAN_GIT,
): { context: CommandContext; fs: FakeFileSystem } {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    "/repo/.orchestrai/.gitignore": "cache/",
    "/repo/docs/ROADMAP.md": ROADMAP,
    "/repo/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "/repo/src/a.ts": "export const a = 1;\n",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock" }),
  });

  return {
    fs,
    context: fakeContext({
      workspace,
      options,
      hosts: fakeHosts({ fs, proc: fakeProcess({}, responses) }),
      config: resolveConfig({ configPath: CONFIG_PATH, fs, env: {} }),
    }),
  };
}

describe("nextCommand", () => {
  it("selects the next incomplete milestone and produces a plan", async () => {
    const { context } = build();

    const result = await nextCommand.execute(context);

    expect(result.data.milestone?.id).toBe("2");
    expect(result.data.remaining).toBe(2);
    expect(result.data.plan).not.toBeNull();
    expect(result.exitCode).toBe(EXIT_CODES.success);
  });

  it("stops at the plan and stages nothing", async () => {
    const { context, fs } = build();
    const before = new Map(fs.files);

    const result = await nextCommand.execute(context);

    expect(result.data.run.steps.map((step) => step.name)).toEqual([
      "understand",
      "analyze",
      "preflight",
      "baseline",
      "plan",
      "summarize",
    ]);
    expect(fs.exists("/repo/.orchestrai/proposals")).toBe(false);
    // Only the run log is new.
    for (const path of before.keys()) {
      expect(fs.files.get(path)).toBe(before.get(path));
    }
  });

  it("records the run", async () => {
    const { context, fs } = build();

    await nextCommand.execute(context);

    expect(listRuns(fs, "/repo/.orchestrai")).toHaveLength(1);
  });

  it("targets a specific milestone with --id", async () => {
    const result = await nextCommand.execute(build({ id: "3" }).context);

    expect(result.data.milestone?.title).toBe("Providers");
  });

  it("lists the stages without calling a provider in a dry run", async () => {
    const { context, fs } = build({ dryRun: true });

    const result = await nextCommand.execute(context);

    expect(result.data.plan).toBeNull();
    expect(result.data.run.steps.every((step) => step.status === "skipped")).toBe(
      true,
    );
    expect(listRuns(fs, "/repo/.orchestrai")).toHaveLength(0);
  });

  it("stops before the provider when the tree is dirty", async () => {
    const { context } = build({}, {
      "git status": {
        stdout: "# branch.head main\n1 .M N... 1 1 1 a b src/a.ts",
      },
    });

    const result = await nextCommand.execute(context);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
    expect(result.data.run.failedAt).toBe("preflight");
    expect(result.data.plan).toBeNull();
  });
});
