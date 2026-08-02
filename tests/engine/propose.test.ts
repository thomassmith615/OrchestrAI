import { describe, expect, it } from "vitest";
import {
  proposeApplyCommand,
  proposeCommand,
  proposeListCommand,
  proposeRejectCommand,
  proposeShowCommand,
} from "../../src/engine/commands/propose.js";
import { reviewCommand } from "../../src/engine/commands/review.js";
import { readProposal } from "../../src/proposals/index.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { CommandContext } from "../../src/engine/command.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";
const STATE = "/repo/.orchestrai";

const workspace = {
  root: "/repo",
  stateDir: STATE,
  configPath: CONFIG_PATH,
  initialized: true,
};

const CLEAN_GIT = { "git status": { stdout: "# branch.head main" } };

function build(
  options: Record<string, unknown> = {},
  args: string[] = [],
  files: Record<string, string> = {},
  responses: Record<string, { stdout?: string; code?: number }> = CLEAN_GIT,
): { context: CommandContext; fs: FakeFileSystem } {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    "/repo/.orchestrai/.gitignore": "cache/",
    "/repo/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "/repo/src/a.ts": "export const a = 1;\n",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock" }),
    ...files,
  });

  return {
    fs,
    context: fakeContext({
      workspace,
      options,
      args,
      hosts: fakeHosts({ fs, proc: fakeProcess({}, responses) }),
      config: resolveConfig({ configPath: CONFIG_PATH, fs, env: {} }),
    }),
  };
}

describe("proposeCommand", () => {
  it("stages a proposal without touching the working tree", async () => {
    const { context, fs } = build({}, ["add a marker file"]);
    const before = new Map(fs.files);

    const result = await proposeCommand.execute(context);

    expect(result.data.proposal.status).toBe("open");
    expect(result.data.proposal.changes.length).toBeGreaterThan(0);

    for (const path of before.keys()) {
      expect(fs.files.get(path)).toBe(before.get(path));
    }
    expect(fs.files.has("/repo/MOCK.md")).toBe(false);
  });

  it("records provenance on the proposal", async () => {
    const { context } = build({}, ["do the thing"]);

    const result = await proposeCommand.execute(context);

    expect(result.data.proposal).toMatchObject({
      provider: "mock",
      promptRef: "propose@1",
      task: "do the thing",
    });
    expect(result.data.proposal.contextTokens).toBeGreaterThan(0);
  });

  it("rejects an empty task", async () => {
    await expect(proposeCommand.execute(build({}, [" "]).context)).rejects.toThrow(
      /task description/,
    );
  });

  it("requires initialization so proposals can be stored", () => {
    expect(proposeCommand.requires).toEqual({
      repository: true,
      config: true,
      initialized: true,
    });
  });
});

describe("propose apply", () => {
  it("writes the staged files and runs the validation gates", async () => {
    const created = build({}, ["add a marker file"]);
    await proposeCommand.execute(created.context);

    const applying = build({}, [], {
      ...Object.fromEntries(created.fs.files),
    });
    const result = await proposeApplyCommand.execute(applying.context);

    expect(result.data.written).toEqual(["MOCK.md"]);
    expect(applying.fs.files.get("/repo/MOCK.md")).toContain("Mock proposal");
    expect(result.data.gates?.results.some((entry) => entry.name === "test")).toBe(
      true,
    );
    expect(result.data.proposal.status).toBe("applied");
  });

  it("refuses a dirty working tree", async () => {
    const created = build({}, ["add a marker file"]);
    await proposeCommand.execute(created.context);

    const dirty = build({}, [], Object.fromEntries(created.fs.files), {
      "git status": {
        stdout: "# branch.head main\n1 .M N... 1 1 1 a b src/a.ts",
      },
    });

    await expect(proposeApplyCommand.execute(dirty.context)).rejects.toMatchObject(
      { exitCode: EXIT_CODES.precondition },
    );
  });

  it("exits 3 when the gates fail after applying", async () => {
    const created = build({}, ["add a marker file"]);
    await proposeCommand.execute(created.context);

    const failing = build({}, [], Object.fromEntries(created.fs.files), {
      ...CLEAN_GIT,
      "npm test": { code: 1, stdout: "boom" },
    });

    const result = await proposeApplyCommand.execute(failing.context);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
    expect(result.report.notes?.join(" ")).toContain("git checkout .");
  });

  it("skips the gates with --no-verify", async () => {
    const created = build({}, ["add a marker file"]);
    await proposeCommand.execute(created.context);

    const applying = build({ verify: false }, [], {
      ...Object.fromEntries(created.fs.files),
    });
    const result = await proposeApplyCommand.execute(applying.context);

    expect(result.data.gates).toBeNull();
  });

  it("refuses to apply the same proposal twice", async () => {
    const created = build({}, ["add a marker file"]);
    await proposeCommand.execute(created.context);

    const applying = build({}, [], Object.fromEntries(created.fs.files));
    await proposeApplyCommand.execute(applying.context);

    const again = build({}, [], Object.fromEntries(applying.fs.files));
    await expect(proposeApplyCommand.execute(again.context)).rejects.toThrow(
      /No open proposal|already applied/,
    );
  });
});

describe("propose list, show, and reject", () => {
  it("lists proposals and shows a diff", async () => {
    const created = build({}, ["add a marker file"]);
    await proposeCommand.execute(created.context);

    const listing = build({}, [], Object.fromEntries(created.fs.files));
    const list = await proposeListCommand.execute(listing.context);
    expect(list.data.proposals).toHaveLength(1);

    const showing = build({}, [], Object.fromEntries(created.fs.files), {
      ...CLEAN_GIT,
      "git diff": { stdout: "diff --git a/MOCK.md b/MOCK.md\n+new", code: 1 },
    });
    const shown = await proposeShowCommand.execute(showing.context);
    expect(shown.data.diff).toContain("MOCK.md");
  });

  it("rejects a proposal without touching the tree", async () => {
    const created = build({}, ["add a marker file"]);
    await proposeCommand.execute(created.context);

    const rejecting = build({}, [], Object.fromEntries(created.fs.files));
    const result = await proposeRejectCommand.execute(rejecting.context);

    expect(result.data.proposal.status).toBe("rejected");
    expect(rejecting.fs.files.has("/repo/MOCK.md")).toBe(false);
    expect(
      readProposal(rejecting.fs, STATE, result.data.proposal.id)?.status,
    ).toBe("rejected");
  });

  it("reports when there is no open proposal", async () => {
    await expect(proposeShowCommand.execute(build().context)).rejects.toThrow(
      /No open proposal/,
    );
  });
});

describe("reviewCommand", () => {
  it("summarizes without writing anything", async () => {
    const { context, fs } = build({}, []);
    const before = new Map(fs.files);

    const result = await reviewCommand.execute(context);

    expect(result.data.summary.length).toBeGreaterThan(0);
    expect(result.data.promptRef).toBe("review@1");
    expect(result.data.filesReviewed).toBeGreaterThan(0);

    // The usage ledger is the only thing a read-only command writes, and it
    // lives under .orchestrai rather than in the repository.
    for (const path of before.keys()) {
      expect(fs.files.get(path)).toBe(before.get(path));
    }
    const added = [...fs.files.keys()].filter((path) => !before.has(path));
    expect(added).toEqual(["/repo/.orchestrai/usage.jsonl"]);
  });
});
