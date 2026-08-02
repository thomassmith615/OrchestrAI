import { describe, expect, it } from "vitest";
import { initCommand } from "../../src/engine/commands/init.js";
import { DEFAULT_CONFIG } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem, fakeHosts } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { CommandContext } from "../../src/engine/command.js";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: "/repo/orchestrai.config.json",
  initialized: false,
};

function contextWith(
  fs: FakeFileSystem,
  options: Record<string, unknown> = {},
): CommandContext {
  return fakeContext({ workspace, hosts: fakeHosts({ fs }), options });
}

describe("initCommand", () => {
  it("writes a default config and creates the state directory", async () => {
    const fs = fakeFileSystem({ "/repo/.git/HEAD": "" });

    const result = await initCommand.execute(contextWith(fs));

    expect(result.data.configCreated).toBe(true);
    expect(result.data.stateDirCreated).toBe(true);
    expect(JSON.parse(fs.files.get("/repo/orchestrai.config.json") ?? "")).toEqual(
      DEFAULT_CONFIG,
    );
    expect(fs.files.get("/repo/.orchestrai/.gitignore")).toBe("cache/\n");
  });

  it("is idempotent and never overwrites an existing config", async () => {
    const fs = fakeFileSystem({
      "/repo/.git/HEAD": "",
      "/repo/orchestrai.config.json": '{"provider":"openai"}',
    });

    const result = await initCommand.execute(contextWith(fs));

    expect(result.data.configCreated).toBe(false);
    expect(fs.files.get("/repo/orchestrai.config.json")).toBe(
      '{"provider":"openai"}',
    );
    expect(result.report.notes?.[0]).toMatch(/--force/);
  });

  it("resets the config when --force is supplied", async () => {
    const fs = fakeFileSystem({
      "/repo/.git/HEAD": "",
      "/repo/orchestrai.config.json": '{"provider":"openai"}',
    });

    const result = await initCommand.execute(contextWith(fs, { force: true }));

    expect(result.data.configCreated).toBe(true);
    expect(JSON.parse(fs.files.get("/repo/orchestrai.config.json") ?? "")).toEqual(
      DEFAULT_CONFIG,
    );
  });

  it("declares that it requires a repository", () => {
    expect(initCommand.requires).toEqual({ repository: true });
  });
});
