import { describe, expect, it } from "vitest";
import { memoryAddCommand, memoryCommand } from "../../src/engine/commands/memory.js";
import { historyCommand } from "../../src/engine/commands/history.js";
import { appendMemory, readMemory } from "../../src/memory/index.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { MemoryRecord } from "../../src/memory/index.js";
import type { CommandContext } from "../../src/engine/command.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";
const STATE = "/repo/.orchestrai";

const workspace = {
  root: "/repo",
  stateDir: STATE,
  configPath: CONFIG_PATH,
  initialized: true,
};

const GIT = {
  "git status": { stdout: "# branch.head main" },
  "git log": { stdout: "abc1234def\u001fabc1234\u001fInitial commit" },
};

function build(
  options: Record<string, unknown> = {},
  args: string[] = [],
  files: Record<string, string> = {},
): { context: CommandContext; fs: FakeFileSystem } {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    "/repo/.orchestrai/.gitignore": "cache/",
    "/repo/docs/ROADMAP.md": "- [x] **M1. Foundation**\n\n- [ ] **M2. Next**\n",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock" }),
    ...files,
  });

  return {
    fs,
    context: fakeContext({
      workspace,
      options,
      args,
      hosts: fakeHosts({ fs, proc: fakeProcess({}, GIT) }),
      config: resolveConfig({ configPath: CONFIG_PATH, fs, env: {} }),
    }),
  };
}

function seed(fs: FakeFileSystem, records: readonly Partial<MemoryRecord>[]): void {
  records.forEach((partial, index) => {
    appendMemory(fs, STATE, {
      id: `r${String(index)}`,
      kind: "note",
      createdAt: 1000 + index,
      title: "Untitled",
      body: "",
      tags: [],
      milestoneId: null,
      commit: null,
      source: "human",
      ...partial,
    });
  });
}

describe("memory add", () => {
  it("writes a record with the current commit", async () => {
    const { context, fs } = build(
      { body: "Testability outweighs convenience.", tags: "providers, http" },
      ["Call REST directly rather than using an SDK"],
    );

    const result = await memoryAddCommand.execute(context);

    expect(result.data.record).toMatchObject({
      kind: "decision",
      title: "Call REST directly rather than using an SDK",
      tags: ["providers", "http"],
      commit: "abc1234def",
      source: "human",
    });
    expect(readMemory(fs, STATE).records).toHaveLength(1);
  });

  it("defaults to a decision and rejects an unknown kind", async () => {
    expect(
      (await memoryAddCommand.execute(build({}, ["A title"]).context)).data.record
        .kind,
    ).toBe("decision");

    await expect(
      memoryAddCommand.execute(build({ kind: "rumour" }, ["A title"]).context),
    ).rejects.toThrow(/Unknown kind/);
  });

  it("requires a title", async () => {
    await expect(
      memoryAddCommand.execute(build({}, ["  "]).context),
    ).rejects.toThrow(/title is required/);
  });
});

describe("memory", () => {
  it("lists the most recent records when given no query", async () => {
    const { context, fs } = build();
    seed(fs, [
      { id: "old", title: "Older", createdAt: 1 },
      { id: "new", title: "Newer", createdAt: 2 },
    ]);

    const result = await memoryCommand.execute(context);

    expect(result.data.total).toBe(2);
    expect(result.data.records.map((record) => record.id)).toEqual(["new", "old"]);
  });

  it("searches and explains the match", async () => {
    const { context, fs } = build({}, ["streaming"]);
    seed(fs, [
      { id: "a", title: "Streaming providers", body: "Streaming is supported." },
      { id: "b", title: "Roadmap parsing", body: "Markdown checklist." },
    ]);

    const result = await memoryCommand.execute(context);

    expect(result.data.records.map((record) => record.id)).toEqual(["a"]);
    expect(result.report.fields.map((field) => String(field.value)).join(" ")).toContain(
      "matches streaming",
    );
  });

  it("filters by kind", async () => {
    const { context, fs } = build({ kind: "constraint" });
    seed(fs, [
      { id: "n", kind: "note", title: "A note" },
      { id: "c", kind: "constraint", title: "A constraint" },
    ]);

    const result = await memoryCommand.execute(context);

    expect(result.data.records.map((record) => record.id)).toEqual(["c"]);
  });

  it("reports damaged lines and exits non-zero", async () => {
    const { context } = build({}, [], {
      "/repo/.orchestrai/memory/records.jsonl": "{ broken\n",
    });

    const result = await memoryCommand.execute(context);

    expect(result.data.damaged).toEqual([1]);
    expect(result.exitCode).toBe(1);
  });

  it("says so when memory is empty", async () => {
    const result = await memoryCommand.execute(build().context);

    expect(result.data.total).toBe(0);
    expect(result.report.notes?.join(" ")).toContain("empty");
  });
});

describe("history", () => {
  it("reports completed milestones and memory size", async () => {
    const { context, fs } = build();
    seed(fs, [{ id: "a", title: "A decision" }]);

    const result = await historyCommand.execute(context);

    expect(result.data.completed.map((entry) => entry.id)).toEqual(["1"]);
    expect(result.data.memoryRecords).toBe(1);
    expect(result.report.notes?.join(" ")).toContain("No runs recorded");
  });
});
