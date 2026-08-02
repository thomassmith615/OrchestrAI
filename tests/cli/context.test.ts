import { describe, expect, it } from "vitest";
import { buildBaseContext, enforceRequirements } from "../../src/cli/context.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { fakeFileSystem, fakeHosts } from "../support/fakes.js";
import type { Hosts } from "../../src/core/hosts.js";

function hostsWith(
  files: Record<string, string>,
  env: Record<string, string> = {},
): Hosts {
  return fakeHosts({ fs: fakeFileSystem(files), env });
}

describe("buildBaseContext", () => {
  it("resolves workspace and configuration together", () => {
    const base = buildBaseContext(
      "/repo/src",
      hostsWith({
        "/repo/.git/HEAD": "",
        "/repo/orchestrai.config.json": JSON.stringify({ provider: "openai" }),
      }),
      [],
    );

    expect(base.workspace?.root).toBe("/repo");
    expect(base.config?.values.provider).toBe("openai");
    expect(base.configError).toBeUndefined();
  });

  it("captures a configuration failure instead of throwing", () => {
    const base = buildBaseContext(
      "/repo",
      hostsWith({
        "/repo/.git/HEAD": "",
        "/repo/orchestrai.config.json": "{ broken",
      }),
      [],
    );

    expect(base.config).toBeNull();
    expect(base.configError).toBeInstanceOf(Error);
  });

  it("resolves defaults outside a repository", () => {
    const base = buildBaseContext("/tmp", hostsWith({}), []);

    expect(base.workspace).toBeNull();
    expect(base.config?.values.provider).toBe("anthropic");
  });
});

describe("enforceRequirements", () => {
  const outside = buildBaseContext("/tmp", hostsWith({}), []);
  const uninitialized = buildBaseContext(
    "/repo",
    hostsWith({ "/repo/.git/HEAD": "" }),
    [],
  );
  const broken = buildBaseContext(
    "/repo",
    hostsWith({ "/repo/.git/HEAD": "", "/repo/orchestrai.config.json": "{ x" }),
    [],
  );

  it("passes when nothing is required", () => {
    expect(() => enforceRequirements(undefined, outside)).not.toThrow();
  });

  it("requires a repository with the precondition exit code", () => {
    try {
      enforceRequirements({ repository: true }, outside);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(
        EXIT_CODES.precondition,
      );
    }
  });

  it("requires initialization and points at orch init", () => {
    try {
      enforceRequirements({ initialized: true }, uninitialized);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { hint: string }).hint).toContain("orch init");
      expect((error as { exitCode: number }).exitCode).toBe(
        EXIT_CODES.precondition,
      );
    }
  });

  it("surfaces the original configuration error", () => {
    try {
      enforceRequirements({ config: true }, broken);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(
        EXIT_CODES.configuration,
      );
    }
  });
});
