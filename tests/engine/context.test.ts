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

  it("resolves a task to the files that reference the symbol it names", async () => {
    // The CamperCAD regression, end to end. Ranking by path scores the
    // declaration site highest and cannot see the two reference sites at all,
    // and at this budget only one file survives ranking. Resolution has to put
    // all three in, or a rename is proposed against an incomplete picture.
    const result = await contextCommand.execute(
      context(
        {
          "/repo/src/vehicle/VehicleModel.ts": `export class VehicleModel {}\n${"// filler\n".repeat(60)}`,
          "/repo/src/ui/WeightPanel.ts": `const v: VehicleModel = get();\n${"// filler\n".repeat(60)}`,
          "/repo/src/snapping/SnapEngine.ts": `function snap(v: VehicleModel) {}\n${"// filler\n".repeat(60)}`,
          "/repo/README.md": "# CamperCAD\n".repeat(80),
          "/repo/package.json": `{"name":"campercad"}`,
        },
        {},
        ["rename VehicleModel to Chassis"],
        { contextBudget: 1400 },
      ),
    );

    expect(result.data.symbols).toEqual(["VehicleModel"]);
    expect(result.data.required.map((entry) => entry.path)).toEqual([
      "src/vehicle/VehicleModel.ts",
      "src/snapping/SnapEngine.ts",
      "src/ui/WeightPanel.ts",
    ]);

    const included = result.data.included.map((entry) => entry.path);
    expect(included).toContain("src/ui/WeightPanel.ts");
    expect(included).toContain("src/snapping/SnapEngine.ts");
  });

  it("resolves nothing for a task that names no symbol, and packs as it always did", async () => {
    const result = await contextCommand.execute(
      context({ "/repo/src/a.ts": "export const a = 1;" }, {}, [
        "add a health check endpoint",
      ]),
    );

    expect(result.data.symbols).toEqual([]);
    expect(result.data.required).toEqual([]);
    expect(result.data.included.map((entry) => entry.path)).toContain("src/a.ts");
  });

  it("refuses rather than sampling when the required set cannot fit", async () => {
    await expect(
      contextCommand.execute(
        context(
          {
            "/repo/src/VehicleModel.ts": `export class VehicleModel {}\n${"// filler\n".repeat(500)}`,
          },
          {},
          ["rename VehicleModel to Chassis"],
          { contextBudget: 400 },
        ),
      ),
    ).rejects.toThrow(/Required context does not fit/);
  });

  it("reduces the budget to the provider's window when neither was configured", async () => {
    // `mock` declares 100,000, the same as the default budget, so nothing
    // changes there. `ollama` declares 8,000, and packing 75,000 tokens for it
    // would fail at the API boundary instead of here.
    const result = await contextCommand.execute(
      context({ "/repo/src/a.ts": "x" }, {}, [], { provider: "ollama" }),
    );

    expect(result.data.budget).toBe(8000);
  });

  it("obeys a configured budget even when the provider declares less", async () => {
    const result = await contextCommand.execute(
      context({ "/repo/src/a.ts": "x" }, {}, [], {
        provider: "ollama",
        contextBudget: 32_000,
      }),
    );

    expect(result.data.budget).toBe(32_000);
  });

  it("requires a repository and valid configuration", () => {
    expect(contextCommand.requires).toEqual({ config: true });
  });
});
