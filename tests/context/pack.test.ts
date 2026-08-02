import { describe, expect, it } from "vitest";
import { estimateTokens, packContext, recentlyChanged } from "../../src/context/index.js";
import { scanRepository } from "../../src/repo/index.js";
import { fakeFileSystem, fakeProcess } from "../support/fakes.js";
import type { PackedContext } from "../../src/context/index.js";
import type { Toolchain } from "../../src/repo/index.js";

const TOOLCHAIN: Toolchain = {
  ecosystem: "node",
  packageManager: "npm",
  build: null,
  typecheck: null,
  lint: null,
  test: null,
  ci: null,
  manifests: ["package.json"],
};

function pack(
  files: Record<string, string>,
  options: { budget?: number; focus?: string[]; recent?: string[]; headroom?: number } = {},
): PackedContext {
  const fs = fakeFileSystem(files);

  return packContext({
    root: "/repo",
    fs,
    scan: scanRepository({ root: "/repo", fs }),
    toolchain: TOOLCHAIN,
    budget: options.budget ?? 10_000,
    ...(options.focus === undefined ? {} : { focus: options.focus }),
    ...(options.recent === undefined ? {} : { recent: options.recent }),
    ...(options.headroom === undefined ? {} : { headroom: options.headroom }),
  });
}

describe("packContext", () => {
  it("includes files and reports the token cost of each", () => {
    const packed = pack({
      "/repo/src/a.ts": "export const a = 1;",
      "/repo/README.md": "# Project",
    });

    expect(packed.included.map((file) => file.path).sort()).toEqual([
      "README.md",
      "src/a.ts",
    ]);
    expect(packed.included.every((file) => file.tokens > 0)).toBe(true);
    expect(packed.tokens).toBeGreaterThan(0);
  });

  it("opens with a repository overview", () => {
    const packed = pack({ "/repo/src/a.ts": "x" });

    expect(packed.text.startsWith("# Repository overview")).toBe(true);
    expect(packed.text).toContain("Ecosystem: node (npm)");
  });

  it("labels each file with its path and a fence", () => {
    const packed = pack({ "/repo/src/a.ts": "export const a = 1;" });

    expect(packed.text).toContain("--- src/a.ts ---");
    expect(packed.text).toContain("```ts");
  });

  it("reserves headroom rather than filling the budget", () => {
    const packed = pack({ "/repo/a.ts": "x" }, { budget: 1000 });

    expect(packed.usable).toBe(750);
    expect(packed.budget).toBe(1000);
  });

  it("drops files that do not fit and says why", () => {
    const packed = pack(
      {
        "/repo/README.md": "# small",
        "/repo/src/huge.ts": "x".repeat(20_000),
      },
      { budget: 1000 },
    );

    const dropped = packed.dropped.find((file) => file.path === "src/huge.ts");
    expect(dropped?.reason).toBe("budget");
    expect(dropped?.tokens).toBeGreaterThan(packed.usable);
    expect(packed.included.map((file) => file.path)).toContain("README.md");
  });

  it("never exceeds the usable budget", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) {
      files[`/repo/src/file${String(index)}.ts`] = "x".repeat(2000);
    }

    const packed = pack(files, { budget: 4000 });

    expect(packed.tokens).toBeLessThanOrEqual(packed.usable);
    expect(packed.dropped.length).toBeGreaterThan(0);
  });

  it("skips a file rather than truncating it", () => {
    const packed = pack(
      { "/repo/big.ts": "y".repeat(8000), "/repo/small.ts": "z" },
      { budget: 1200 },
    );

    for (const file of packed.included) {
      expect(packed.text).toContain(`--- ${file.path} ---`);
    }
    expect(packed.text).not.toContain("y".repeat(8000).slice(0, 100));
  });

  it("excludes binary and oversized files with their own reasons", () => {
    const packed = pack({
      "/repo/logo.png": "binary",
      "/repo/src/a.ts": "code",
    });

    expect(packed.dropped.find((file) => file.path === "logo.png")?.reason).toBe(
      "binary",
    );
    expect(packed.included.map((file) => file.path)).not.toContain("logo.png");
  });

  it("skips empty files", () => {
    const packed = pack({ "/repo/empty.ts": "   \n", "/repo/a.ts": "x" });

    expect(packed.dropped.find((file) => file.path === "empty.ts")?.reason).toBe(
      "empty",
    );
  });

  it("lets focus terms change what survives a tight budget", () => {
    const files = {
      "/repo/src/unrelated.ts": "u".repeat(3000),
      "/repo/src/auth/login.ts": "a".repeat(3000),
    };

    const withFocus = pack(files, { budget: 1600, focus: ["auth"] });

    expect(withFocus.included.map((file) => file.path)).toEqual([
      "src/auth/login.ts",
    ]);
  });

  it("records why each included file was chosen", () => {
    const packed = pack({ "/repo/package.json": "{}", "/repo/src/deep/x.ts": "y" });

    for (const file of packed.included) {
      expect(file.reasons.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    const files = { "/repo/a.ts": "one", "/repo/b.ts": "two" };

    expect(pack(files).text).toEqual(pack(files).text);
  });
});

describe("estimateTokens", () => {
  it("scales with length and never returns zero for content", () => {
    expect(estimateTokens("x".repeat(360))).toBe(100);
    expect(estimateTokens("a")).toBe(1);
  });
});

describe("recentlyChanged", () => {
  it("deduplicates paths from the git log", () => {
    const proc = fakeProcess({}, {
      "git log": { stdout: "src/a.ts\nsrc/b.ts\n\nsrc/a.ts\n" },
    });

    expect(recentlyChanged(proc, "/repo")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns nothing when git is unavailable", () => {
    expect(recentlyChanged(fakeProcess({ ok: false }), "/repo")).toEqual([]);
  });
});
