import { describe, expect, it } from "vitest";
import { describeEnvironment } from "../../src/core/environment.js";
import { packageVersion } from "../../src/core/manifest.js";

describe("describeEnvironment", () => {
  it("reports the injected host details", () => {
    const snapshot = describeEnvironment({
      nodeVersion: "22.0.0",
      platform: "linux",
      arch: "x64",
      cwd: () => "/workspace/demo",
    });

    expect(snapshot).toEqual({
      name: "orchestrai",
      version: packageVersion(),
      nodeVersion: "22.0.0",
      platform: "linux",
      arch: "x64",
      workingDirectory: "/workspace/demo",
    });
  });

  it("exposes a semantic version", () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
