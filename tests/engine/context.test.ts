import { describe, expect, it } from "vitest";
import { contextCommand } from "../../src/engine/commands/context.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { CommandContext } from "../../src/engine/command.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: CONFIG_PATH,
  initialized: true,
};

function context(
  files: Record<string, string>,
  options: Record<string, unknown> = {},
  args: string[] = [],
  configValues: Record<string, unknown> = {},
): CommandContext {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock", ...configValues }),
    ...files,
  });

  return fakeContext({
    workspace,
    options,
    args,
    hosts: fakeHosts({
      fs,
      proc: fakeProcess({}, { "git log": { stdout: "src/recent.ts\n" } }),
    }),
    config: resolveConfig({ configPath: CONFIG_PATH, fs, env: {} }),
  });
}

describe("contextCommand", () => {
  it("reports the budget, what was packed, and what was dropped", async () => {
    const result = await contextCommand.execute(
      context({ "/repo/src/a.ts": "export const a = 1;", "/repo/logo.png": "b" }),
    );

    expect(result.data.budget).toBe(100_000);
    expect(result.data.usable).toBe(75_000);
    expect(result.data.included.length).toBeGreaterThan(0);
    expect(result.data.dropped.some((file) => file.reason === "binary")).toBe(true);
  });

  it("makes no network calls", async () => {
    const ctx = context({ "/repo/src/a.ts": "x" });

    await contextCommand.execute(ctx);

    expect((ctx.hosts.http as unknown as { requests: unknown[] }).requests).toHaveLength(
      0,
    );
  });

  it("accepts focus terms as a positional argument", async () => {
    const result = await contextCommand.execute(
      context(
        { "/repo/src/auth/login.ts": "x", "/repo/src/other.ts": "y" },
        {},
        ["auth,login"],
      ),
    );

    expect(result.data.focus).toEqual(["auth", "login"]);
    expect(result.data.included[0]?.path).toBe("src/auth/login.ts");
  });

  it("honours a configured budget", async () => {
    const result = await contextCommand.execute(
      context({ "/repo/src/a.ts": "x" }, {}, [], { contextBudget: 4000 }),
    );

    expect(result.data.budget).toBe(4000);
    expect(result.data.usable).toBe(3000);
  });

  it("renders a named prompt around the context when asked", async () => {
    const result = await contextCommand.execute(
      context({ "/repo/src/a.ts": "x" }, { prompt: "analyze" }),
    );

    expect(result.data.prompt).toContain("Review this repository");
    expect(result.data.prompt).toContain("# Repository overview");
  });

  it("lists every included file with its justification", async () => {
    const result = await contextCommand.execute(
      context({ "/repo/package.json": "{}", "/repo/src/a.ts": "x" }),
    );

    expect(result.report.notes?.join("\n")).toContain("project manifest");
  });

  it("requires a repository and valid configuration", () => {
    expect(contextCommand.requires).toEqual({ repository: true, config: true });
  });
});
