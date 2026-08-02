import { describe, expect, it } from "vitest";
import { statusCommand } from "../../src/engine/commands/status.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { readGateRun } from "../../src/gates/index.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { CommandContext } from "../../src/engine/command.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: CONFIG_PATH,
  initialized: true,
};

function build(
  files: Record<string, string> = {},
  configValues: Record<string, unknown> = {},
  options: Record<string, unknown> = {},
  responses: Record<string, { code?: number; stdout?: string }> = {},
): { context: CommandContext; fs: FakeFileSystem } {
  const fs: FakeFileSystem = fakeFileSystem({
    "/repo/.git/HEAD": "",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock", ...configValues }),
    ...files,
  });

  return {
    fs,
    context: fakeContext({
      workspace,
      options,
      hosts: fakeHosts({
        fs,
        proc: fakeProcess(
          {},
          {
            "git status": { stdout: "# branch.head main\n# branch.ab +0 -0" },
            "git log": {
              stdout: "abc1234def\u001fabc1234\u001fInitial commit",
            },
            ...responses,
          },
        ),
      }),
      config: resolveConfig({ configPath: CONFIG_PATH, fs, env: {} }),
    }),
  };
}

function context(
  files: Record<string, string> = {},
  configValues: Record<string, unknown> = {},
): CommandContext {
  return build(files, configValues).context;
}

describe("statusCommand", () => {
  it("reports inventory, toolchain, and provider together", async () => {
    const result = await statusCommand.execute(
      context({
        "/repo/package.json": JSON.stringify({
          scripts: { build: "tsc", test: "vitest run" },
        }),
        "/repo/src/a.ts": "export const a = 1;",
        "/repo/src/b.ts": "export const b = 2;",
        "/repo/.github/workflows/ci.yml": "on: push",
      }),
    );

    expect(result.data.toolchain.ecosystem).toBe("node");
    expect(result.data.toolchain.test).toBe("npm test");
    expect(result.data.toolchain.ci).toBe("github-actions");
    expect(result.data.scan.files).toBeGreaterThan(2);
    expect(result.data.provider.id).toBe("mock");
  });

  it("respects configured ignore patterns", async () => {
    const withIgnore = await statusCommand.execute(
      context({ "/repo/vendor/big.ts": "x", "/repo/src/a.ts": "y" }, {
        ignore: ["vendor"],
      }),
    );
    const withoutIgnore = await statusCommand.execute(
      context({ "/repo/vendor/big.ts": "x", "/repo/src/a.ts": "y" }),
    );

    expect(withIgnore.data.scan.files).toBeLessThan(
      withoutIgnore.data.scan.files,
    );
  });

  it("warns when no manifest is recognized", async () => {
    const result = await statusCommand.execute(
      context({ "/repo/notes.md": "# hi" }),
    );

    expect(result.data.toolchain.ecosystem).toBe("unknown");
    expect(result.report.notes?.join(" ")).toContain("verification gates");
  });

  it("falls back to the provider default model", async () => {
    const result = await statusCommand.execute(
      context({}, { provider: "anthropic" }),
    );

    expect(result.data.provider.model.length).toBeGreaterThan(0);
    expect(result.data.provider.model).not.toBe("not configured");
  });

  it("requires a repository and valid configuration", () => {
    expect(statusCommand.requires).toEqual({ repository: true, config: true });
  });

  it("reports git branch and head commit", async () => {
    const result = await statusCommand.execute(context({ "/repo/src/a.ts": "x" }));

    expect(result.data.git.branch).toBe("main");
    expect(result.data.git.dirty).toBe(false);
    expect(result.data.git.head?.shortSha).toBe("abc1234");
  });

  it("says gates have not run before any verification", async () => {
    const result = await statusCommand.execute(context({ "/repo/src/a.ts": "x" }));

    expect(result.data.gates).toBeNull();
    expect(result.report.notes?.join(" ")).toContain("--verify");
  });

  it("does not run gates by default", async () => {
    const { context: ctx } = build({
      "/repo/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
    });

    await statusCommand.execute(ctx);
    const calls = (ctx.hosts.proc as unknown as { calls: { command: string }[] })
      .calls;

    expect(calls.every((call) => call.command === "git")).toBe(true);
  });

  it("runs and records gates under --verify", async () => {
    const { context: ctx, fs } = build(
      {
        "/repo/.orchestrai/.gitignore": "cache/",
        "/repo/package.json": JSON.stringify({
          scripts: { build: "tsc", test: "vitest run" },
        }),
      },
      {},
      { verify: true },
    );

    const result = await statusCommand.execute(ctx);

    expect(result.data.gatesFresh).toBe(true);
    expect(result.data.gates?.ok).toBe(true);
    expect(readGateRun(fs, "/repo/.orchestrai")).not.toBeNull();
    expect(result.report.notes?.join(" ")).toContain("Ready for review.");
  });

  it("exits 3 when a recorded gate failed", async () => {
    const { context: ctx } = build(
      {
        "/repo/.orchestrai/.gitignore": "cache/",
        "/repo/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      },
      {},
      { verify: true },
      { "npm test": { code: 1 } },
    );

    const result = await statusCommand.execute(ctx);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
  });
});
