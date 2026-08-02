import { describe, expect, it } from "vitest";
import { describeGitStatus, readDiff, readGitStatus } from "../../src/repo/index.js";
import { fakeProcess } from "../support/fakes.js";
import type { GitStatus } from "../../src/repo/index.js";

const HEAD = { stdout: "abc123def\u001fabc123d\u001fAdd the thing" };

function statusFrom(porcelain: string): GitStatus {
  return readGitStatus(
    fakeProcess({}, { "git status": { stdout: porcelain }, "git log": HEAD }),
    "/repo",
  );
}

describe("readGitStatus", () => {
  it("parses branch, ahead, and behind", () => {
    const status = statusFrom(
      ["# branch.head feature/milestone-5", "# branch.ab +2 -1"].join("\n"),
    );

    expect(status.available).toBe(true);
    expect(status.branch).toBe("feature/milestone-5");
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
    expect(status.dirty).toBe(false);
  });

  it("counts staged, unstaged, and untracked entries", () => {
    const status = statusFrom(
      [
        "# branch.head main",
        "1 M. N... 100644 100644 100644 aaa bbb staged.ts",
        "1 .M N... 100644 100644 100644 aaa bbb modified.ts",
        "1 MM N... 100644 100644 100644 aaa bbb both.ts",
        "? untracked.ts",
      ].join("\n"),
    );

    expect(status.staged).toBe(2);
    expect(status.unstaged).toBe(2);
    expect(status.untracked).toBe(1);
    expect(status.dirty).toBe(true);
  });

  it("reads the head commit", () => {
    const status = statusFrom("# branch.head main");

    expect(status.head).toEqual({
      sha: "abc123def",
      shortSha: "abc123d",
      subject: "Add the thing",
    });
  });

  it("recognizes a detached head", () => {
    const status = statusFrom("# branch.head (detached)");

    expect(status.detached).toBe(true);
    expect(status.branch).toBeNull();
  });

  it("reports unavailable rather than throwing when git fails", () => {
    const status = readGitStatus(fakeProcess({ ok: false, code: 128 }), "/repo");

    expect(status.available).toBe(false);
    expect(describeGitStatus(status)).toBe("git unavailable");
  });
});

describe("describeGitStatus", () => {
  it("summarizes a clean and a dirty tree", () => {
    expect(describeGitStatus(statusFrom("# branch.head main"))).toBe(
      "main (clean)",
    );
    expect(
      describeGitStatus(
        statusFrom(
          ["# branch.head main", "1 .M N... 1 1 1 a b x.ts", "? y.ts"].join("\n"),
        ),
      ),
    ).toBe("main (1 modified, 1 untracked)");
  });
});

describe("readDiff", () => {
  it("passes staged and path arguments through", () => {
    const proc = fakeProcess({ stdout: "diff --git a/x b/x" });

    expect(readDiff(proc, "/repo", { staged: true, paths: ["src"] })).toContain(
      "diff --git",
    );
    expect(proc.calls[0]?.args).toEqual([
      "diff",
      "--no-color",
      "--staged",
      "--",
      "src",
    ]);
  });

  it("returns null when git fails", () => {
    expect(readDiff(fakeProcess({ ok: false }), "/repo")).toBeNull();
  });
});
