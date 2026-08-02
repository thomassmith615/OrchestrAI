import { describe, expect, it } from "vitest";
import {
  ensureApplicable,
  applyProposal,
  latestOpen,
  listProposals,
  nextProposalId,
  readProposal,
  requireProposal,
  saveProposal,
  setStatus,
} from "../../src/proposals/index.js";
import { CLEAN_STATUS } from "../../src/repo/index.js";
import { fakeFileSystem, fakeProcess } from "../support/fakes.js";
import type { Proposal } from "../../src/proposals/index.js";

const STATE = "/repo/.orchestrai";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "260802a",
    task: "add a thing",
    status: "open",
    createdAt: 1000,
    changes: [
      {
        path: "src/a.ts",
        kind: "create",
        content: "export const a = 1;\n",
        addedLines: 1,
        removedLines: 0,
      },
    ],
    notes: "",
    provider: "mock",
    model: "mock-1",
    promptRef: "propose@1",
    contextTokens: 100,
    usage: { inputTokens: 10, outputTokens: 5 },
    ...overrides,
  };
}

describe("proposal store", () => {
  it("stages file contents on disk alongside the record", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });

    saveProposal(fs, STATE, proposal());

    expect(
      fs.files.get("/repo/.orchestrai/proposals/260802a/files/src/a.ts"),
    ).toBe("export const a = 1;\n");
    expect(readProposal(fs, STATE, "260802a")).toEqual(proposal());
  });

  it("lists newest first and finds the latest open one", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });
    saveProposal(fs, STATE, proposal({ id: "old", createdAt: 1 }));
    saveProposal(fs, STATE, proposal({ id: "new", createdAt: 2 }));
    saveProposal(fs, STATE, proposal({ id: "newest", createdAt: 3, status: "applied" }));

    expect(listProposals(fs, STATE).map((entry) => entry.id)).toEqual([
      "newest",
      "new",
      "old",
    ]);
    expect(latestOpen(fs, STATE)?.id).toBe("new");
  });

  it("names the known ids when one is missing", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });
    saveProposal(fs, STATE, proposal({ id: "abc" }));

    try {
      requireProposal(fs, STATE, "zzz");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { message: string }).message).toContain("zzz");
      expect((error as { hint: string }).hint).toContain("abc");
    }
  });

  it("generates unique ids", () => {
    expect(nextProposalId(1_700_000_000_000, [])).not.toBe("");
    expect(
      nextProposalId(1_700_000_000_000, [nextProposalId(1_700_000_000_000, [])]),
    ).toContain("-1");
  });

  it("records a status change", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });
    saveProposal(fs, STATE, proposal());

    expect(setStatus(fs, STATE, proposal(), "rejected").status).toBe("rejected");
    expect(readProposal(fs, STATE, "260802a")?.status).toBe("rejected");
  });
});

describe("ensureApplicable", () => {
  const clean = { ...CLEAN_STATUS, available: true };
  const dirty = { ...clean, dirty: true, unstaged: 1 };

  it("allows an open proposal against a clean tree", () => {
    expect(() => ensureApplicable(proposal(), clean, false)).not.toThrow();
  });

  it("refuses a dirty tree so checkout stays a clean undo", () => {
    expect(() => ensureApplicable(proposal(), dirty, false)).toThrow(
      /uncommitted changes/,
    );
    expect(() => ensureApplicable(proposal(), dirty, true)).not.toThrow();
  });

  it("refuses an already applied or rejected proposal", () => {
    expect(() =>
      ensureApplicable(proposal({ status: "applied" }), clean, false),
    ).toThrow(/already applied/);
    expect(() =>
      ensureApplicable(proposal({ status: "rejected" }), clean, false),
    ).toThrow(/rejected/);
  });

  it("refuses an empty proposal", () => {
    expect(() =>
      ensureApplicable(proposal({ changes: [] }), clean, false),
    ).toThrow(/no changes/);
  });
});

describe("applyProposal", () => {
  it("writes files and creates parent directories", () => {
    const fs = fakeFileSystem({ "/repo/.git/HEAD": "" });

    const outcome = applyProposal(
      fs,
      fakeProcess(),
      "/repo",
      proposal({
        changes: [
          {
            path: "src/deep/nested/a.ts",
            kind: "create",
            content: "x\n",
            addedLines: 1,
            removedLines: 0,
          },
        ],
      }),
    );

    expect(outcome.written).toEqual(["src/deep/nested/a.ts"]);
    expect(fs.files.get("/repo/src/deep/nested/a.ts")).toBe("x\n");
  });

  it("removes deleted files through git", () => {
    const fs = fakeFileSystem({ "/repo/src/old.ts": "gone" });
    const proc = fakeProcess();

    const outcome = applyProposal(
      fs,
      proc,
      "/repo",
      proposal({
        changes: [
          {
            path: "src/old.ts",
            kind: "delete",
            content: "",
            addedLines: 0,
            removedLines: 1,
          },
        ],
      }),
    );

    expect(outcome.deleted).toEqual(["src/old.ts"]);
    expect(proc.calls[0]?.args).toEqual(["rm", "--quiet", "--", "src/old.ts"]);
  });
});
