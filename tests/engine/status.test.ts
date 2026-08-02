import { describe, expect, it } from "vitest";
import { statusCommand } from "../../src/engine/commands/status.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem, fakeHosts } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
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
  configValues: Record<string, unknown> = {},
): CommandContext {
  const fs: FakeFileSystem = fakeFileSystem({
    "/repo/.git/HEAD": "",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock", ...configValues }),
    ...files,
  });

  return fakeContext({
    workspace,
    hosts: fakeHosts({ fs }),
    config: resolveConfig({ configPath: CONFIG_PATH, fs, env: {} }),
  });
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
});
