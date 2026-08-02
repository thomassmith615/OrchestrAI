import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "../../src/core/workspace.js";
import { fakeFileSystem } from "../support/fakes.js";

describe("resolveWorkspace", () => {
  it("finds the repository root by walking upward", () => {
    const fs = fakeFileSystem({ "/repo/.git/HEAD": "ref: refs/heads/main" });

    const workspace = resolveWorkspace("/repo/src/deep/nested", fs);

    expect(workspace?.root).toBe("/repo");
    expect(workspace?.configPath).toBe("/repo/orchestrai.config.json");
    expect(workspace?.stateDir).toBe("/repo/.orchestrai");
  });

  it("reports whether the state directory exists", () => {
    const bare = fakeFileSystem({ "/repo/.git/HEAD": "" });
    expect(resolveWorkspace("/repo", bare)?.initialized).toBe(false);

    const ready = fakeFileSystem({
      "/repo/.git/HEAD": "",
      "/repo/.orchestrai/.gitignore": "cache/",
    });
    expect(resolveWorkspace("/repo", ready)?.initialized).toBe(true);
  });

  it("returns null outside a repository", () => {
    expect(resolveWorkspace("/tmp/scratch", fakeFileSystem())).toBeNull();
  });
});
