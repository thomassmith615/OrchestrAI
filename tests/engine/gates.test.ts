import { describe, expect, it } from "vitest";
import { buildCommand, testCommand } from "../../src/engine/commands/gates.js";
import { readGateRun } from "../../src/gates/index.js";
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

const PACKAGE_JSON = JSON.stringify({
  scripts: {
    build: "tsc",
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    test: "vitest run",
  },
});

function context(
  responses: Record<string, { code?: number; stderr?: string }> = {},
  options: Record<string, unknown> = {},
  files: Record<string, string> = { "/repo/.orchestrai/.gitignore": "cache/" },
): { context: CommandContext; fs: FakeFileSystem } {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    "/repo/package.json": PACKAGE_JSON,
    [CONFIG_PATH]: JSON.stringify({ provider: "mock" }),
    ...files,
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

describe("buildCommand", () => {
  it("runs only the build gate and exits 0 on success", async () => {
    const { context: ctx } = context();

    const result = await buildCommand.execute(ctx);

    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.data.run.results.map((entry) => entry.name)).toEqual(["build"]);
  });

  it("exits 3 when the build fails", async () => {
    const { context: ctx } = context({ "npm run build": { code: 2, stderr: "boom" } });

    const result = await buildCommand.execute(ctx);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
    expect(result.report.notes?.join("\n")).toContain("boom");
  });

  it("exits 4 when no build command exists", async () => {
    const { context: ctx } = context({}, {}, {
      "/repo/.orchestrai/.gitignore": "",
      "/repo/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
    });

    const result = await buildCommand.execute(ctx);

    expect(result.exitCode).toBe(EXIT_CODES.precondition);
    expect(result.report.notes?.join(" ")).toContain("No commands configured");
  });
});

describe("testCommand", () => {
  it("runs every validation gate but not the build", async () => {
    const { context: ctx } = context();

    const result = await testCommand.execute(ctx);

    expect(result.data.run.results.map((entry) => entry.name)).toEqual([
      "typecheck",
      "lint",
      "test",
    ]);
  });

  it("includes the build gate with --all", async () => {
    const { context: ctx } = context({}, { all: true });

    const result = await testCommand.execute(ctx);

    expect(result.data.run.results.map((entry) => entry.name)).toEqual([
      "build",
      "typecheck",
      "lint",
      "test",
    ]);
  });

  it("records results and merges with a previous partial run", async () => {
    const build = context();
    await buildCommand.execute(build.context);

    const after = readGateRun(build.fs, "/repo/.orchestrai");
    expect(after?.results.map((entry) => entry.name)).toEqual(["build"]);

    const validation = context({}, {}, {
      "/repo/.orchestrai/.gitignore": "cache/",
      "/repo/.orchestrai/gates.json": build.fs.files.get(
        "/repo/.orchestrai/gates.json",
      ) ?? "",
    });
    await testCommand.execute(validation.context);

    const merged = readGateRun(validation.fs, "/repo/.orchestrai");
    expect(merged?.results.map((entry) => entry.name).sort()).toEqual([
      "build",
      "lint",
      "test",
      "typecheck",
    ]);
  });

  it("still runs when uninitialized but says results were not recorded", async () => {
    const { context: ctx } = context({}, {}, {});

    const result = await testCommand.execute(ctx);

    expect(result.data.recorded).toBe(false);
    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.report.notes?.join(" ")).toContain("orch init");
  });
});
