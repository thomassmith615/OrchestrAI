import { describe, expect, it } from "vitest";
import { rankFiles, scoreFile } from "../../src/context/index.js";
import type { FileEntry } from "../../src/repo/index.js";

function entry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path,
    bytes: 500,
    language: "TypeScript",
    binary: false,
    oversized: false,
    ...overrides,
  };
}

function order(paths: readonly string[], focus?: readonly string[]): string[] {
  return rankFiles(
    paths.map((path) => entry(path)),
    focus === undefined ? {} : { focus },
  ).map((ranked) => ranked.file.path);
}

describe("scoreFile", () => {
  it("ranks manifests and entry points above deep modules", () => {
    const manifest = scoreFile(entry("package.json"));
    const deep = scoreFile(entry("src/a/b/c/helper.ts"));

    expect(manifest.score).toBeGreaterThan(deep.score);
    expect(manifest.reasons).toContain("project manifest");
  });

  it("penalizes test files", () => {
    expect(scoreFile(entry("src/thing.test.ts")).reasons).toContain("test file");
    expect(scoreFile(entry("src/thing.test.ts")).score).toBeLessThan(
      scoreFile(entry("src/thing.ts")).score,
    );
  });

  it("boosts paths matching the focus terms", () => {
    const matched = scoreFile(entry("src/providers/anthropic.ts"), {
      focus: ["provider"],
    });

    expect(matched.score).toBeGreaterThan(
      scoreFile(entry("src/providers/anthropic.ts")).score,
    );
    expect(matched.reasons.join(" ")).toContain("matches provider");
  });

  it("boosts recently changed files", () => {
    expect(
      scoreFile(entry("src/a.ts"), { recent: ["src/a.ts"] }).reasons,
    ).toContain("recently changed");
  });

  it("penalizes very large files", () => {
    expect(scoreFile(entry("src/big.ts", { bytes: 90_000 })).reasons).toContain(
      "large file",
    );
  });

  it("always explains itself", () => {
    for (const path of ["README.md", "src/index.ts", "deep/a/b/c.ts"]) {
      expect(scoreFile(entry(path)).reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("rankFiles", () => {
  it("excludes binary and oversized files", () => {
    const ranked = rankFiles([
      entry("a.ts"),
      entry("logo.png", { binary: true }),
      entry("dump.sql", { oversized: true }),
    ]);

    expect(ranked.map((item) => item.file.path)).toEqual(["a.ts"]);
  });

  it("is deterministic for equal scores", () => {
    const paths = ["src/z.ts", "src/a.ts", "src/m.ts"];

    expect(order(paths)).toEqual(order(paths));
    expect(order(paths)).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
  });

  it("puts focused files first", () => {
    const ranked = order(
      ["src/unrelated.ts", "src/auth/login.ts", "README.md"],
      ["auth"],
    );

    expect(ranked[0]).toBe("src/auth/login.ts");
  });
});
