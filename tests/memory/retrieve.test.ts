import { describe, expect, it } from "vitest";
import { keywordRetriever, tokenize } from "../../src/memory/index.js";
import type { MemoryRecord } from "../../src/memory/index.js";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function record(
  id: string,
  title: string,
  body: string,
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  return {
    id,
    kind: "note",
    createdAt: NOW,
    title,
    body,
    tags: [],
    milestoneId: null,
    commit: null,
    source: "human",
    ...overrides,
  };
}

const CORPUS: readonly MemoryRecord[] = [
  record("r1", "Providers call REST directly", "We rejected vendor SDKs because injected HTTP makes streaming testable."),
  record("r2", "Gate results are persisted", "Status reads the last recorded run so it stays fast."),
  record("r3", "Context is packed under a budget", "Files are skipped, never truncated, so the model never sees half a file."),
  record("r4", "Roadmap stays a document", "Orchestrai parses the roadmap and never rewrites it."),
];

function ids(query: string, options = {}): readonly string[] {
  return keywordRetriever
    .search(query, CORPUS, { now: NOW, ...options })
    .map((entry) => entry.record.id);
}

describe("keywordRetriever", () => {
  it("finds the record about the queried topic", () => {
    expect(ids("streaming vendor sdk")[0]).toBe("r1");
    expect(ids("truncated files budget")[0]).toBe("r3");
  });

  it("returns nothing when no term matches", () => {
    expect(ids("kubernetes helm chart")).toEqual([]);
  });

  it("returns nothing for an empty query or corpus", () => {
    expect(ids("")).toEqual([]);
    expect(keywordRetriever.search("anything", [])).toEqual([]);
  });

  it("weights rare terms above common ones", () => {
    const corpus = [
      record("common", "Orchestrai runs gates", "Orchestrai does many things."),
      record("rare", "Orchestrai and quicksort", "Quicksort is mentioned once."),
    ];

    const ranked = keywordRetriever.search("orchestrai quicksort", corpus, {
      now: NOW,
    });

    expect(ranked[0]?.record.id).toBe("rare");
  });

  it("boosts tag matches", () => {
    const corpus = [
      record("plain", "Some note", "Mentions caching once."),
      record("tagged", "Another note", "Unrelated text.", { tags: ["caching"] }),
    ];

    expect(
      keywordRetriever.search("caching", corpus, { now: NOW })[0]?.record.id,
    ).toBe("tagged");
  });

  it("uses recency as a tiebreaker, not a substitute for relevance", () => {
    const corpus = [
      record("old-relevant", "Streaming providers", "Streaming providers matter.", {
        createdAt: NOW - 400 * DAY,
      }),
      record("new-irrelevant", "Unrelated", "Nothing to do with it.", {
        createdAt: NOW,
      }),
    ];

    expect(
      keywordRetriever.search("streaming providers", corpus, { now: NOW })[0]
        ?.record.id,
    ).toBe("old-relevant");
  });

  it("prefers decisions and constraints over plain notes", () => {
    const corpus = [
      record("note", "Caching approach", "We cache things."),
      record("decision", "Caching approach", "We cache things.", {
        kind: "decision",
      }),
    ];

    expect(
      keywordRetriever.search("caching", corpus, { now: NOW })[0]?.record.id,
    ).toBe("decision");
  });

  it("explains every result", () => {
    for (const entry of keywordRetriever.search("streaming", CORPUS, { now: NOW })) {
      expect(entry.reasons.length).toBeGreaterThan(0);
    }
  });

  it("honours the limit", () => {
    expect(ids("orchestrai the a run", { limit: 2 }).length).toBeLessThanOrEqual(2);
  });

  it("drops stop words and short tokens", () => {
    expect(tokenize("The and for a big REST provider")).toEqual([
      "big",
      "rest",
      "provider",
    ]);
  });
});
