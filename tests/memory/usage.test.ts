import { describe, expect, it } from "vitest";
import { readUsage, recordUsage, totalUsage } from "../../src/memory/index.js";
import { estimateCost, formatCost, rateFor } from "../../src/providers/index.js";
import { compactMemory, appendMemory, readMemory } from "../../src/memory/index.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { UsageEntry } from "../../src/memory/index.js";
import type { MemoryRecord } from "../../src/memory/index.js";

const STATE = "/repo/.orchestrai";

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    at: 1000,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    promptRef: "plan@1",
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.0105,
    retries: 0,
    fellBack: false,
    ...overrides,
  };
}

describe("usage ledger", () => {
  it("appends and reads entries", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });

    expect(recordUsage(fs, STATE, entry())).toBe(true);
    recordUsage(fs, STATE, entry({ at: 2000 }));

    expect(readUsage(fs, STATE)).toHaveLength(2);
  });

  it("does nothing without a state directory", () => {
    expect(recordUsage(fakeFileSystem(), STATE, entry())).toBe(false);
  });

  it("totals tokens, cost, and retries", () => {
    const totals = totalUsage([
      entry({ inputTokens: 100, outputTokens: 50, costUsd: 0.5, retries: 1 }),
      entry({ inputTokens: 200, outputTokens: 20, costUsd: 0.25 }),
    ]);

    expect(totals).toMatchObject({
      calls: 2,
      inputTokens: 300,
      outputTokens: 70,
      costUsd: 0.75,
      retries: 1,
      unpriced: 0,
    });
  });

  it("counts unpriced calls so the total is not mistaken for complete", () => {
    const totals = totalUsage([entry({ costUsd: null }), entry({ costUsd: 1 })]);

    expect(totals.costUsd).toBe(1);
    expect(totals.unpriced).toBe(1);
  });
});

describe("pricing", () => {
  it("resolves a dated model id to its family rate", () => {
    expect(rateFor("claude-sonnet-4-6")).not.toBeNull();
    expect(rateFor("claude-haiku-4-5-20251001")).toEqual(
      rateFor("claude-haiku-4-5"),
    );
  });

  it("returns null rather than guessing at an unknown model", () => {
    expect(rateFor("some-future-model")).toBeNull();
    expect(estimateCost("some-future-model", { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(formatCost(null)).toBe("unknown rate");
  });

  it("computes cost per million tokens", () => {
    expect(
      estimateCost("claude-sonnet-4-6", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(3);
  });
});

describe("compactMemory", () => {
  function record(id: string, createdAt: number): MemoryRecord {
    return {
      id,
      kind: "note",
      createdAt,
      title: `Record ${id}`,
      body: "",
      tags: [],
      milestoneId: null,
      commit: null,
      source: "human",
    };
  }

  it("drops damaged lines and duplicate ids, and archives the original", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });
    appendMemory(fs, STATE, record("a", 1));
    appendMemory(fs, STATE, record("b", 2));
    appendMemory(fs, STATE, record("a", 3));
    const path = "/repo/.orchestrai/memory/records.jsonl";
    fs.writeFile(path, `${fs.files.get(path) ?? ""}{ broken\n`);

    const result = compactMemory(fs, STATE, 1_700_000_000_000);

    expect(result.before).toBe(4);
    expect(result.after).toBe(2);
    expect(result.removedDamaged).toBe(1);
    expect(result.removedDuplicate).toBe(1);
    expect(fs.files.has(result.archivedTo)).toBe(true);
    expect(readMemory(fs, STATE).records.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("keeps the later version of a re-written id", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });
    appendMemory(fs, STATE, record("a", 1));
    appendMemory(fs, STATE, { ...record("a", 9), title: "Corrected" });

    compactMemory(fs, STATE, 1_700_000_000_000);

    expect(readMemory(fs, STATE).records[0]?.title).toBe("Corrected");
  });
});
