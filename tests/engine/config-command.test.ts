import { describe, expect, it } from "vitest";
import { configCommand } from "../../src/engine/commands/config.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem } from "../support/fakes.js";

describe("configCommand", () => {
  it("shows each value with the layer that supplied it", async () => {
    const fs = fakeFileSystem({
      "/repo/orchestrai.config.json": JSON.stringify({ provider: "openai" }),
    });
    const config = resolveConfig({
      configPath: "/repo/orchestrai.config.json",
      fs,
      env: { ORCH_MODEL: "claude-sonnet-4-6" },
    });

    const result = await configCommand.execute(fakeContext({ config }));
    const labels = result.report.fields.map((field) => field.value);

    expect(labels).toContain("openai (file)");
    expect(labels).toContain("claude-sonnet-4-6 (env)");
    expect(labels).toContain("docs/ROADMAP.md (default)");
    expect(result.data.sources.provider).toBe("file");
  });

  it("notes when no config file was found", async () => {
    const config = resolveConfig({
      configPath: "/repo/orchestrai.config.json",
      fs: fakeFileSystem(),
      env: {},
    });

    const result = await configCommand.execute(fakeContext({ config }));

    expect(result.report.notes?.[0]).toMatch(/orch init/);
  });

  it("requires a repository and valid configuration", () => {
    expect(configCommand.requires).toEqual({ config: true });
  });
});
