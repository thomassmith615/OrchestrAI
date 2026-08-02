import { describe, expect, it } from "vitest";
import { appendMemory, nextMemoryId, readMemory } from "../../src/memory/index.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { MemoryRecord } from "../../src/memory/index.js";

const STATE = "/repo/.orchestrai";

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "a1",
    kind: "decision",
    createdAt: 1000,
    title: "Use REST rather than an SDK",
    body: "Testability outweighs convenience.",
    tags: ["providers"],
    milestoneId: "3",
    commit: "abc1234",
    source: "human",
    ...overrides,
  };
}

function state(): ReturnType<typeof fakeFileSystem> {
  return fakeFileSystem({ "/repo/.orchestrai/.gitignore": "cache/" });
}

describe("memory store", () => {
  it("round trips a record", () => {
    const fs = state();

    appendMemory(fs, STATE, record());

    expect(readMemory(fs, STATE).records).toEqual([record()]);
  });

  it("appends without rewriting earlier lines", () => {
    const fs = state();

    appendMemory(fs, STATE, record({ id: "a1" }));
    const afterFirst = fs.files.get("/repo/.orchestrai/memory/records.jsonl") ?? "";
    appendMemory(fs, STATE, record({ id: "a2", title: "Second" }));
    const afterSecond = fs.files.get("/repo/.orchestrai/memory/records.jsonl") ?? "";

    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(readMemory(fs, STATE).records.map((entry) => entry.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("writes one record per line", () => {
    const fs = state();

    appendMemory(fs, STATE, record({ id: "a1" }));
    appendMemory(fs, STATE, record({ id: "a2" }));

    const lines = (fs.files.get("/repo/.orchestrai/memory/records.jsonl") ?? "")
      .trimEnd()
      .split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ id: "a1" });
  });

  it("reports damaged lines rather than dropping them silently", () => {
    const fs = fakeFileSystem({
      "/repo/.orchestrai/.gitignore": "",
      "/repo/.orchestrai/memory/records.jsonl": [
        JSON.stringify(record({ id: "good" })),
        "{ not json",
        JSON.stringify({ id: "wrong-shape" }),
        JSON.stringify(record({ id: "also-good" })),
      ].join("\n"),
    });

    const result = readMemory(fs, STATE);

    expect(result.records.map((entry) => entry.id)).toEqual(["good", "also-good"]);
    expect(result.damaged).toEqual([2, 3]);
  });

  it("returns empty memory when nothing has been written", () => {
    expect(readMemory(state(), STATE)).toEqual({ records: [], damaged: [] });
  });

  it("refuses to write before initialization", () => {
    expect(() => appendMemory(fakeFileSystem(), STATE, record())).toThrow(
      /not initialized/,
    );
  });

  it("generates unique ids", () => {
    const first = nextMemoryId(1_700_000_000_000, []);

    expect(nextMemoryId(1_700_000_000_000, [record({ id: first })])).toContain("-1");
  });
});
