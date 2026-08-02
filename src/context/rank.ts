/**
 * Relevance ranking.
 *
 * No embeddings and no model call: ranking must be cheap enough to run before
 * every request. The signals are deliberately explainable, because when the
 * wrong files reach the model the first question is always "why was that
 * chosen", and `orch context` has to be able to answer it.
 */
import type { FileEntry } from "../repo/scan.js";

export interface RankedFile {
  readonly file: FileEntry;
  readonly score: number;
  /** Human readable justification, shown by `orch context`. */
  readonly reasons: readonly string[];
}

export interface RankOptions {
  /** Terms from the task at hand. Matching paths are boosted heavily. */
  readonly focus?: readonly string[];
  /** Paths touched by recent commits, relative to the repository root. */
  readonly recent?: readonly string[];
}

/** Files that describe the project rather than implement it. */
const ENTRY_NAMES: ReadonlySet<string> = new Set([
  "readme.md",
  "package.json",
  "pom.xml",
  "pyproject.toml",
  "go.mod",
  "cargo.toml",
  "makefile",
  "dockerfile",
]);

const INDEX_STEMS: ReadonlySet<string> = new Set([
  "index",
  "main",
  "app",
  "cli",
  "server",
]);

const DOC_DIRS: ReadonlySet<string> = new Set(["docs", "doc"]);
const TEST_MARKERS: readonly string[] = ["test", "spec", "__tests__", "fixture"];

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stem(name: string): string {
  const dot = name.indexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

function looksLikeTest(path: string): boolean {
  const lower = path.toLowerCase();
  return TEST_MARKERS.some((marker) => lower.includes(marker));
}

export function scoreFile(file: FileEntry, options: RankOptions = {}): RankedFile {
  const reasons: string[] = [];
  let score = 1;

  const name = basename(file.path);
  const lowerName = name.toLowerCase();
  const depth = file.path.split("/").length - 1;

  if (ENTRY_NAMES.has(lowerName)) {
    score += 6;
    reasons.push("project manifest");
  }

  if (INDEX_STEMS.has(stem(name))) {
    score += 3;
    reasons.push("entry point");
  }

  // Shallow files describe the shape of a project; deep ones are details.
  const depthBonus = Math.max(0, 3 - depth);
  if (depthBonus > 0) {
    score += depthBonus;
    reasons.push("near the root");
  }

  if (DOC_DIRS.has(file.path.split("/")[0]?.toLowerCase() ?? "")) {
    score += 2;
    reasons.push("documentation");
  }

  if (looksLikeTest(file.path)) {
    score -= 2;
    reasons.push("test file");
  }

  const focus = options.focus ?? [];
  if (focus.length > 0) {
    const lowerPath = file.path.toLowerCase();
    const hits = focus.filter((term) =>
      lowerPath.includes(term.toLowerCase()),
    );
    if (hits.length > 0) {
      score += 10 * hits.length;
      reasons.push(`matches ${hits.join(", ")}`);
    }
  }

  if (options.recent?.includes(file.path) === true) {
    score += 4;
    reasons.push("recently changed");
  }

  // Very large files crowd out several smaller ones for the same budget.
  if (file.bytes > 40_000) {
    score -= 2;
    reasons.push("large file");
  }

  if (reasons.length === 0) {
    // Every included file must be explainable, even the unremarkable ones.
    reasons.push("source file");
  }

  return { file, score, reasons };
}

export function rankFiles(
  files: readonly FileEntry[],
  options: RankOptions = {},
): readonly RankedFile[] {
  return files
    .filter((file) => !file.binary && !file.oversized)
    .map((file) => scoreFile(file, options))
    .sort(
      (a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path),
    );
}
