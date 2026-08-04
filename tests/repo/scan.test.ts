import { describe, expect, it } from "vitest";
import { scanRepository } from "../../src/repo/index.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { ScanSummary } from "../../src/repo/index.js";

function scan(
  files: Record<string, string>,
  options: { ignore?: string[]; maxFiles?: number; maxFileBytes?: number } = {},
): ScanSummary {
  return scanRepository({
    root: "/repo",
    fs: fakeFileSystem(files),
    ...options,
  });
}

describe("scanRepository", () => {
  it("inventories files with paths relative to the root", () => {
    const summary = scan({
      "/repo/src/index.ts": "export const a = 1;",
      "/repo/README.md": "# hi",
    });

    expect(summary.files.map((file) => file.path).sort()).toEqual([
      "README.md",
      "src/index.ts",
    ]);
    expect(summary.totalBytes).toBeGreaterThan(0);
  });

  it("always excludes the git directory", () => {
    const summary = scan({
      "/repo/.git/HEAD": "ref: refs/heads/main",
      "/repo/src/a.ts": "x",
    });

    expect(summary.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  });

  it("always excludes its own state directory", () => {
    // `.orchestrai` is committed, so no gitignore excludes it, and it holds a
    // complete copy of every proposed file. Scanned, it would feed staged and
    // rejected code back to the model as though it were repository source.
    const summary = scan({
      "/repo/.orchestrai/proposals/1/files/src/Server.ts": "export class X {}",
      "/repo/.orchestrai/config.json": "{}",
      "/repo/src/a.ts": "x",
    });

    expect(summary.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  });

  it("honours the root gitignore and prunes ignored directories", () => {
    const summary = scan({
      "/repo/.gitignore": "node_modules/\ndist/\n*.log",
      "/repo/node_modules/pkg/index.js": "module.exports = {}",
      "/repo/dist/out.js": "compiled",
      "/repo/debug.log": "noise",
      "/repo/src/a.ts": "x",
    });

    expect(summary.files.map((file) => file.path)).toEqual([
      ".gitignore",
      "src/a.ts",
    ]);
    expect(summary.counts.ignored).toBeGreaterThan(0);
  });

  it("applies a nested gitignore only to its subtree", () => {
    const summary = scan({
      "/repo/packages/api/.gitignore": "secret.txt",
      "/repo/packages/api/secret.txt": "hidden",
      "/repo/packages/web/secret.txt": "visible",
    });

    const paths = summary.files.map((file) => file.path);
    expect(paths).toContain("packages/web/secret.txt");
    expect(paths).not.toContain("packages/api/secret.txt");
  });

  it("applies configuration ignore patterns", () => {
    const summary = scan(
      { "/repo/coverage/report.html": "x", "/repo/src/a.ts": "y" },
      { ignore: ["coverage"] },
    );

    expect(summary.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  });

  it("classifies languages and skips binaries in the summary", () => {
    const summary = scan({
      "/repo/src/a.ts": "one",
      "/repo/src/b.ts": "two",
      "/repo/main.py": "three",
      "/repo/logo.png": "binarydata",
    });

    expect(summary.languages[0]).toMatchObject({ language: "TypeScript", files: 2 });
    expect(summary.languages.map((entry) => entry.language)).not.toContain("PNG");
    expect(summary.counts.binary).toBe(1);
    expect(summary.files.find((file) => file.path === "logo.png")?.binary).toBe(
      true,
    );
  });

  it("flags oversized files without excluding them from the inventory", () => {
    const summary = scan(
      { "/repo/big.ts": "x".repeat(50), "/repo/small.ts": "y" },
      { maxFileBytes: 10 },
    );

    expect(summary.counts.oversized).toBe(1);
    expect(summary.files).toHaveLength(2);
    expect(summary.files.find((file) => file.path === "big.ts")?.oversized).toBe(
      true,
    );
  });

  it("stops at the file cap and reports truncation", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) {
      files[`/repo/file${String(index)}.ts`] = "x";
    }

    const summary = scan(files, { maxFiles: 5 });

    expect(summary.truncated).toBe(true);
    expect(summary.files).toHaveLength(5);
  });

  it("produces a stable ordering across runs", () => {
    const files = {
      "/repo/z.ts": "z",
      "/repo/a.ts": "a",
      "/repo/m/inner.ts": "m",
    };

    expect(scan(files).files).toEqual(scan(files).files);
  });
});
