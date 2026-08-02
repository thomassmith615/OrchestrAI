/**
 * Memory retrieval.
 *
 * Writing memory is easy. Getting the right three records into a context
 * window is the actual problem, and it is the one that decides whether memory
 * improves answers or just consumes budget.
 *
 * The default retriever is keyword based: no embedding service, no index to
 * rebuild, no network. Scoring is inverse document frequency over the record
 * corpus, plus boosts for title and tag matches and a mild recency term.
 * Everything is explainable, for the same reason the context ranker is.
 *
 * An embedding backed retriever implements this same interface. Nothing that
 * consumes retrieval knows which one answered.
 */
import type { MemoryRecord } from "./types.js";

export interface RankedRecord {
  readonly record: MemoryRecord;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface RetrievalOptions {
  readonly limit?: number;
  /** Records scoring below this are not returned at all. */
  readonly threshold?: number;
  /** Half life for the recency boost, in days. */
  readonly halfLifeDays?: number;
  readonly now?: number;
}

export interface Retriever {
  readonly id: string;
  search(
    query: string,
    records: readonly MemoryRecord[],
    options?: RetrievalOptions,
  ): readonly RankedRecord[];
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "over", "when",
  "have", "has", "was", "were", "are", "not", "but", "its", "our", "you",
  "use", "used", "using", "add", "adds", "should", "would", "will", "can",
]);

export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

function termFrequencies(text: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const term of tokenize(text)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return counts;
}

/** Terms that appear in every record carry no signal. */
function inverseDocumentFrequency(
  records: readonly MemoryRecord[],
): ReadonlyMap<string, number> {
  const documentCount = new Map<string, number>();

  for (const record of records) {
    for (const term of new Set(tokenize(`${record.title} ${record.body}`))) {
      documentCount.set(term, (documentCount.get(term) ?? 0) + 1);
    }
  }

  const total = Math.max(1, records.length);
  const idf = new Map<string, number>();

  for (const [term, count] of documentCount) {
    idf.set(term, Math.log((total + 1) / (count + 1)) + 1);
  }

  return idf;
}

export const keywordRetriever: Retriever = {
  id: "keyword",

  search(
    query: string,
    records: readonly MemoryRecord[],
    options: RetrievalOptions = {},
  ): readonly RankedRecord[] {
    const terms = [...new Set(tokenize(query))];

    if (terms.length === 0 || records.length === 0) {
      return [];
    }

    const idf = inverseDocumentFrequency(records);
    const now = options.now ?? Date.now();
    const halfLife = (options.halfLifeDays ?? 180) * 24 * 60 * 60 * 1000;
    const threshold = options.threshold ?? 0.01;

    const ranked = records
      .map((record) => {
        const reasons: string[] = [];
        const bodyTerms = termFrequencies(`${record.title} ${record.body}`);
        const titleTerms = new Set(tokenize(record.title));
        const tagTerms = new Set(record.tags.flatMap((tag) => tokenize(tag)));

        let score = 0;
        const matched: string[] = [];

        for (const term of terms) {
          const weight = idf.get(term) ?? 1;
          const count = bodyTerms.get(term) ?? 0;

          if (count > 0) {
            // Saturating, so one long record cannot dominate on repetition.
            score += weight * (1 + Math.log(count));
            matched.push(term);
          }
          if (titleTerms.has(term)) {
            score += weight;
          }
          if (tagTerms.has(term)) {
            score += weight * 1.5;
          }
        }

        if (matched.length > 0) {
          reasons.push(`matches ${matched.join(", ")}`);
        }

        // Recency is a tiebreaker, never a substitute for relevance.
        const age = Math.max(0, now - record.createdAt);
        const recency = Math.pow(0.5, age / halfLife);
        if (score > 0) {
          score *= 0.75 + 0.25 * recency;
          if (recency > 0.75) {
            reasons.push("recent");
          }
        }

        if (record.kind === "decision" || record.kind === "constraint") {
          score *= 1.2;
          reasons.push(record.kind);
        }

        return { record, score, reasons };
      })
      .filter((entry) => entry.score > threshold)
      .sort(
        (a, b) =>
          b.score - a.score || b.record.createdAt - a.record.createdAt,
      );

    return ranked.slice(0, options.limit ?? 5);
  },
};

/** The retriever used unless a caller supplies another. */
export const defaultRetriever: Retriever = keywordRetriever;
