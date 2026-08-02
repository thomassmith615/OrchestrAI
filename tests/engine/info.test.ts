import { describe, expect, it } from "vitest";
import { infoCommand } from "../../src/engine/commands/info.js";
import { createLogger } from "../../src/core/logger.js";
import { packageVersion } from "../../src/core/manifest.js";

describe("infoCommand", () => {
  it("reports the environment for the supplied working directory", async () => {
    const result = await infoCommand.execute({
      cwd: "/workspace/demo",
      logger: createLogger({ level: "silent" }),
      options: {},
      args: [],
    });

    expect(result.data.workingDirectory).toBe("/workspace/demo");
    expect(result.data.version).toBe(packageVersion());
    expect(result.report.fields.map((field) => field.label)).toEqual([
      "Version",
      "Node",
      "Platform",
      "Directory",
    ]);
  });
});
