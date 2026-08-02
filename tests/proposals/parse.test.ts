import { describe, expect, it } from "vitest";
import { parseChangeBlocks, ProposalParseError } from "../../src/proposals/index.js";
import type { ParsedResponse } from "../../src/proposals/index.js";

function parse(
  response: string,
  existing: Record<string, string> = {},
): ParsedResponse {
  return parseChangeBlocks(response, {
    existing: (path) => existing[path] ?? null,
  });
}

describe("parseChangeBlocks", () => {
  it("extracts a full file replacement", () => {
    const parsed = parse(
      ["<<<FILE src/a.ts", "export const a = 1;", ">>>"].join("\n"),
    );

    expect(parsed.changes).toHaveLength(1);
    expect(parsed.changes[0]).toMatchObject({
      path: "src/a.ts",
      kind: "create",
      content: "export const a = 1;\n",
      addedLines: 1,
    });
  });

  it("classifies an existing file as a modification and counts removals", () => {
    const parsed = parse(
      ["<<<FILE src/a.ts", "new", ">>>"].join("\n"),
      { "src/a.ts": "old\nlines\nhere\n" },
    );

    expect(parsed.changes[0]).toMatchObject({
      kind: "modify",
      addedLines: 1,
      removedLines: 3,
    });
  });

  it("handles deletions", () => {
    const parsed = parse("<<<DELETE src/old.ts>>>", { "src/old.ts": "a\nb\n" });

    expect(parsed.changes[0]).toMatchObject({
      path: "src/old.ts",
      kind: "delete",
      content: "",
      removedLines: 2,
    });
  });

  it("keeps prose outside the blocks as notes", () => {
    const parsed = parse(
      [
        "I added the module.",
        "<<<FILE a.ts",
        "x",
        ">>>",
        "Tests were not needed.",
      ].join("\n"),
    );

    expect(parsed.notes).toBe("I added the module.\nTests were not needed.");
  });

  it("preserves fenced code inside a block", () => {
    const parsed = parse(
      ["<<<FILE README.md", "```ts", "const x = 1;", "```", ">>>"].join("\n"),
    );

    expect(parsed.changes[0]?.content).toContain("```ts");
  });

  it("refuses paths that escape the repository", () => {
    for (const path of ["../outside.ts", "/etc/passwd", "a/../../b.ts"]) {
      expect(() => parse(`<<<FILE ${path}\nx\n>>>`)).toThrow(ProposalParseError);
    }
  });

  it("refuses an unterminated block rather than guessing", () => {
    expect(() => parse("<<<FILE a.ts\nconst x = 1;")).toThrow(/Unterminated/);
  });

  it("lets a later block supersede an earlier one for the same path", () => {
    const parsed = parse(
      ["<<<FILE a.ts", "first", ">>>", "<<<FILE a.ts", "second", ">>>"].join("\n"),
    );

    expect(parsed.changes).toHaveLength(1);
    expect(parsed.changes[0]?.content).toBe("second\n");
  });

  it("returns no changes when the model declines", () => {
    const parsed = parse("I cannot do this safely without seeing the schema.");

    expect(parsed.changes).toHaveLength(0);
    expect(parsed.notes).toContain("cannot do this safely");
  });
});
