/**
 * Context packing.
 *
 * Decides what a model is allowed to see, under an explicit token budget, and
 * reports what was included, what was dropped, and why. The reporting matters
 * as much as the packing: when an answer is wrong, the first question is what
 * the model actually had in front of it.
 */
import { join } from "node:path";
import { estimateTokens } from "./tokens.js";
import { rankFiles } from "./rank.js";
import { PreconditionError } from "../core/errors.js";
import type { TokenEstimator } from "./tokens.js";
import type { RankOptions } from "./rank.js";
import type { FileSystemHost, ProcessHost } from "../core/hosts.js";
import type { ScanSummary } from "../repo/scan.js";
import type { Toolchain } from "../repo/toolchain.js";

/** Fraction of the budget held back for the system prompt and the response. */
export const HEADROOM = 0.25;

export type DropReason = "budget" | "binary" | "oversized" | "empty";

export interface IncludedFile {
  readonly path: string;
  readonly tokens: number;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface DroppedFile {
  readonly path: string;
  readonly reason: DropReason;
  readonly tokens: number;
}

/**
 * Recalled knowledge, in a shape the packer can render without knowing what
 * produced it. Milestone 10 supplies memory records; another source could
 * supply anything else.
 */
export interface ContextNote {
  readonly title: string;
  readonly body: string;
}

/**
 * A file the task cannot be done correctly without, and why. Produced by
 * `resolveWorkingSet`; consumed here as plain data so the packer never needs to
 * know how a working set was arrived at.
 */
export interface RequiredFile {
  readonly path: string;
  /** Human readable justification, e.g. `references Vehicle`. */
  readonly reason: string;
}

export interface PackedContext {
  /** The assembled text, ready to interpolate into a prompt. */
  readonly text: string;
  readonly tokens: number;
  readonly budget: number;
  /** Budget minus headroom: what packing was actually allowed to use. */
  readonly usable: number;
  readonly included: readonly IncludedFile[];
  readonly dropped: readonly DroppedFile[];
  /** Tokens spent on recalled knowledge rather than on files. */
  readonly noteTokens: number;
  readonly notes: number;
  /** How many of `included` were required rather than merely well ranked. */
  readonly required: number;
}

export interface PackOptions {
  readonly root: string;
  readonly fs: FileSystemHost;
  readonly scan: ScanSummary;
  readonly toolchain: Toolchain;
  readonly budget: number;
  readonly focus?: readonly string[];
  readonly recent?: readonly string[];
  /**
   * Files that must be included. Packed before anything competes for the
   * budget, and a failure rather than a drop when they do not fit.
   */
  readonly required?: readonly RequiredFile[];
  /** Recalled knowledge, budgeted before files because it is denser. */
  readonly notes?: readonly ContextNote[];
  readonly estimate?: TokenEstimator;
  /** Overrides the headroom fraction. Mainly for tests. */
  readonly headroom?: number;
}

function fence(path: string, content: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  return `--- ${path} ---\n\`\`\`${extension}\n${content.trimEnd()}\n\`\`\`\n`;
}

function header(scan: ScanSummary, toolchain: Toolchain): string {
  const languages = scan.languages
    .slice(0, 6)
    .map((entry) => `${entry.language} (${String(entry.files)})`)
    .join(", ");

  return [
    "# Repository overview",
    "",
    `Files: ${String(scan.files.length)}`,
    `Languages: ${languages.length === 0 ? "none detected" : languages}`,
    `Ecosystem: ${toolchain.ecosystem}${
      toolchain.packageManager === null ? "" : ` (${toolchain.packageManager})`
    }`,
    ...(toolchain.manifests.length > 0
      ? [`Manifests: ${toolchain.manifests.join(", ")}`]
      : []),
    "",
  ].join("\n");
}

/**
 * Reads candidates in rank order and includes them while the budget allows.
 * A file too large for the remaining budget is skipped rather than truncated,
 * so the model never sees half a file and assumes it saw all of it.
 */
export function packContext(options: PackOptions): PackedContext {
  const estimate = options.estimate ?? estimateTokens;
  const headroom = options.headroom ?? HEADROOM;
  const usable = Math.max(0, Math.floor(options.budget * (1 - headroom)));

  const rankOptions: RankOptions = {
    ...(options.focus === undefined ? {} : { focus: options.focus }),
    ...(options.recent === undefined ? {} : { recent: options.recent }),
  };

  const included: IncludedFile[] = [];
  const dropped: DroppedFile[] = [];

  for (const file of options.scan.files) {
    if (file.binary) {
      dropped.push({ path: file.path, reason: "binary", tokens: 0 });
    } else if (file.oversized) {
      dropped.push({ path: file.path, reason: "oversized", tokens: 0 });
    }
  }

  const read = (path: string): string | null => {
    let content: string;
    try {
      content = options.fs.readFile(join(options.root, path));
    } catch {
      return null;
    }
    return content.trim().length === 0 ? null : content;
  };

  const headerSection = header(options.scan, options.toolchain);
  let tokens = estimate(headerSection);

  // Required files are measured before anything else competes for the budget.
  // Their cost decides how much room is left for memory and for ranking, rather
  // than being whatever happens to survive it.
  const requiredSections: string[] = [];
  const requiredPaths = new Set<string>();
  let requiredTokens = 0;

  for (const entry of options.required ?? []) {
    if (requiredPaths.has(entry.path)) {
      continue;
    }

    const content = read(entry.path);

    if (content === null) {
      dropped.push({ path: entry.path, reason: "empty", tokens: 0 });
      continue;
    }

    const section = fence(entry.path, content);
    const cost = estimate(section);

    requiredPaths.add(entry.path);
    requiredSections.push(section);
    requiredTokens += cost;
    included.push({
      path: entry.path,
      tokens: cost,
      score: Number.POSITIVE_INFINITY,
      reasons: [entry.reason],
    });
  }

  // The whole point of a required set is that silently sampling it is the bug.
  // A task that cannot be shown what it needs must say so, not guess.
  if (tokens + requiredTokens > usable) {
    throw new PreconditionError(
      `Required context does not fit: ${String(requiredPaths.size)} files need ` +
        `${String(requiredTokens)} tokens, ${String(usable)} available`,
      "Narrow the task with --focus, raise contextBudget, or use a model with a larger context window",
    );
  }

  tokens += requiredTokens;

  // Recalled knowledge goes in before ranked files: it is denser than source,
  // and it is the part a fresh conversation cannot reconstruct. It is capped at
  // a third of what is left after the required set, because a context that is
  // all history explains nothing about the code.
  const notes = options.notes ?? [];
  const sections: string[] = [headerSection];
  let noteTokens = 0;
  let noteCount = 0;

  if (notes.length > 0) {
    const rendered = [
      "# Project memory",
      "",
      ...notes.map((note) => `## ${note.title}\n\n${note.body.trim()}`),
      "",
    ].join("\n");

    const cost = estimate(rendered);

    if (cost <= (usable - requiredTokens) / 3) {
      sections.push(rendered);
      tokens += cost;
      noteTokens = cost;
      noteCount = notes.length;
    }
  }

  sections.push(...requiredSections);

  for (const ranked of rankFiles(options.scan.files, rankOptions)) {
    if (requiredPaths.has(ranked.file.path)) {
      continue;
    }

    const content = read(ranked.file.path);

    if (content === null) {
      dropped.push({ path: ranked.file.path, reason: "empty", tokens: 0 });
      continue;
    }

    const section = fence(ranked.file.path, content);
    const cost = estimate(section);

    if (tokens + cost > usable) {
      dropped.push({
        path: ranked.file.path,
        reason: "budget",
        tokens: cost,
      });
      continue;
    }

    sections.push(section);
    tokens += cost;
    included.push({
      path: ranked.file.path,
      tokens: cost,
      score: ranked.score,
      reasons: ranked.reasons,
    });
  }

  return {
    text: sections.join("\n"),
    tokens,
    budget: options.budget,
    usable,
    included,
    dropped,
    noteTokens,
    notes: noteCount,
    required: requiredPaths.size,
  };
}

/** Paths touched by recent commits, used as a ranking signal. */
export function recentlyChanged(
  proc: ProcessHost,
  root: string,
  commits = 50,
): readonly string[] {
  const result = proc.run(
    "git",
    ["log", `-n`, String(commits), "--name-only", "--pretty=format:"],
    root,
  );

  if (!result.ok) {
    return [];
  }

  return [
    ...new Set(
      result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ];
}
