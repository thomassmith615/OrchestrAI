import { describe, expect, it } from "vitest";
import { infoCommand } from "../../src/engine/commands/info.js";
import { packageVersion } from "../../src/core/manifest.js";
import { fakeContext } from "../support/fakes.js";

describe("infoCommand", () => {
  it("reports the environment for the supplied working directory", async () => {
    const result = await infoCommand.execute(
      fakeContext({ cwd: "/workspace/demo" }),
    );

    expect(result.data.workingDirectory).toBe("/workspace/demo");
    expect(result.data.version).toBe(packageVersion());
    expect(result.data.repository).toBeNull();
  });

  it("includes the repository when one was resolved", async () => {
    const result = await infoCommand.execute(
      fakeContext({
        workspace: {
          root: "/repo",
          stateDir: "/repo/.orchestrai",
          configPath: "/repo/orchestrai.config.json",
          initialized: true,
        },
      }),
    );

    expect(result.data.repository).toBe("/repo");
    expect(result.data.initialized).toBe(true);
  });

  it("reports the active scope", async () => {
    const result = await infoCommand.execute(
      fakeContext({
        workspace: {
          root: "/repo",
          stateDir: "/repo/.orchestrai",
          configPath: "/repo/orchestrai.config.json",
          initialized: true,
        },
        scope: {
          kind: "repository",
          workspace: {
            root: "/repo",
            stateDir: "/repo/.orchestrai",
            configPath: "/repo/orchestrai.config.json",
            initialized: true,
          },
        },
      }),
    );

    expect(result.data.scope).toBe("repository");
    expect(result.report.fields).toContainEqual({
      label: "Scope",
      value: "repository",
    });
  });

  it("reports a null scope when neither a repository nor a home directory exists", async () => {
    const result = await infoCommand.execute(fakeContext());

    expect(result.data.scope).toBeNull();
  });
});
