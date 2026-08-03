import { describe, expect, it } from "vitest";
import {
  buildBaseContext,
  enforceRequirements,
  resolveContextScope,
} from "../../src/cli/context.js";
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
    expect(base.config?.values.provider).toBe("ollama");
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
      enforceRequirements({ scope: "repository" }, outside);
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

  it("defaults to repository scope when requires is declared without one", () => {
    // A command that declares `requires: {}` (no `scope`) behaves exactly
    // like one that declared `scope: "repository"` explicitly. This is the
    // default that kept every Version 1 command's behaviour unchanged when
    // `scope` replaced the old `repository: boolean` flag. See ADR 0017.
    try {
      enforceRequirements({}, outside);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(
        EXIT_CODES.precondition,
      );
    }
  });

  it("succeeds for a command declaring user scope outside a repository", () => {
    const outsideWithHome = buildBaseContext(
      "/tmp",
      hostsWith({}, { HOME: "/Users/demo" }),
      [],
    );

    expect(() =>
      enforceRequirements({ scope: "user" }, outsideWithHome),
    ).not.toThrow();
  });

  it("fails a command requiring user scope when no home directory resolves", () => {
    try {
      enforceRequirements({ scope: "user" }, outside);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(
        EXIT_CODES.precondition,
      );
    }
  });

  it("never fails scope for a command declaring either", () => {
    expect(() => enforceRequirements({ scope: "either" }, outside)).not.toThrow();
  });
});

describe("resolveContextScope", () => {
  it("resolves repository scope inside a repository when nothing was declared", () => {
    const inside = buildBaseContext("/repo", hostsWith({ "/repo/.git/HEAD": "" }), []);

    expect(resolveContextScope(undefined, inside)).toEqual({
      kind: "repository",
      workspace: inside.workspace,
    });
  });

  it("resolves user scope outside a repository for a command declaring user", () => {
    const outsideWithHome = buildBaseContext(
      "/tmp",
      hostsWith({}, { HOME: "/Users/demo" }),
      [],
    );

    expect(resolveContextScope({ scope: "user" }, outsideWithHome)).toEqual({
      kind: "user",
      root: "/Users/demo/.orchestrai",
      stateDir: "/Users/demo/.orchestrai",
    });
  });

  it("falls back to user scope outside a repository when nothing was declared", () => {
    const outsideWithHome = buildBaseContext(
      "/tmp",
      hostsWith({}, { HOME: "/Users/demo" }),
      [],
    );

    expect(resolveContextScope(undefined, outsideWithHome)?.kind).toBe("user");
  });

  it("resolves null when neither a repository nor a home directory exists", () => {
    const outside = buildBaseContext("/tmp", hostsWith({}), []);

    expect(resolveContextScope(undefined, outside)).toBeNull();
  });
});
