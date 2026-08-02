import { describe, expect, it } from "vitest";
import { configScope, isIgnored, parseIgnoreFile } from "../../src/repo/index.js";
import type { IgnoreScope } from "../../src/repo/index.js";

function scope(content: string, base = ""): IgnoreScope {
  return { base, rules: parseIgnoreFile(content) };
}

function ignored(
  path: string,
  scopes: readonly IgnoreScope[],
  isDirectory = false,
): boolean {
  return isIgnored(path, isDirectory, scopes);
}

describe("parseIgnoreFile", () => {
  it("skips comments and blank lines", () => {
    expect(parseIgnoreFile("# comment\n\n  \nnode_modules\n")).toHaveLength(1);
  });

  it("records negation and directory-only flags", () => {
    const [negated, directory] = parseIgnoreFile("!keep.txt\nbuild/");

    expect(negated?.negated).toBe(true);
    expect(directory?.directoryOnly).toBe(true);
  });
});

describe("isIgnored", () => {
  const rules = scope(
    ["node_modules", "*.log", "/dist", "build/", "docs/**/*.tmp"].join("\n"),
  );

  it("matches a bare name at any depth", () => {
    expect(ignored("node_modules", [rules], true)).toBe(true);
    expect(ignored("packages/api/node_modules", [rules], true)).toBe(true);
  });

  it("matches extension wildcards", () => {
    expect(ignored("debug.log", [rules])).toBe(true);
    expect(ignored("src/deep/debug.log", [rules])).toBe(true);
    expect(ignored("logger.ts", [rules])).toBe(false);
  });

  it("anchors patterns that start with a slash", () => {
    expect(ignored("dist", [rules], true)).toBe(true);
    expect(ignored("packages/api/dist", [rules], true)).toBe(false);
  });

  it("applies directory-only rules to directories only", () => {
    expect(ignored("build", [rules], true)).toBe(true);
    expect(ignored("build", [rules], false)).toBe(false);
  });

  it("spans directories with a double star", () => {
    expect(ignored("docs/a/b/notes.tmp", [rules])).toBe(true);
    expect(ignored("docs/notes.tmp", [rules])).toBe(true);
  });

  it("lets a later negation re-include a path", () => {
    const withNegation = scope("*.log\n!keep.log");

    expect(ignored("debug.log", [withNegation])).toBe(true);
    expect(ignored("keep.log", [withNegation])).toBe(false);
  });

  it("scopes nested ignore files to their own subtree", () => {
    const nested = scope("secret.txt", "packages/api");

    expect(ignored("packages/api/secret.txt", [nested])).toBe(true);
    expect(ignored("packages/web/secret.txt", [nested])).toBe(false);
  });

  it("applies configuration patterns at the repository root", () => {
    const fromConfig = configScope(["coverage", "*.snap"]);

    expect(ignored("coverage", [fromConfig], true)).toBe(true);
    expect(ignored("tests/a.snap", [fromConfig])).toBe(true);
  });
});
