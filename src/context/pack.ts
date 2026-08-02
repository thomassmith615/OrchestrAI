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

export interface PackedContext {
  /** The assembled text, ready to interpolate into a prompt. */
  readonly text: string;
  readonly tokens: number;
  readonly budget: number;
  /** Budget minus headroom: what packing was actually allowed to use. */
  readonly usable: number;
  readonly included: readonly IncludedFile[];
  readonly dropped: readonly DroppedFile[];
}

export interface PackOptions {
  readonly root: string;
  readonly fs: FileSystemHost;
  readonly scan: ScanSummary;
  readonly toolchain: Toolchain;
  readonly budget: number;
  readonly focus?: readonly string[];
  readonly recent?: readonly string[];
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

  const sections: string[] = [header(options.scan, options.toolchain)];
  let tokens = estimate(sections[0] ?? "");

  for (const ranked of rankFiles(options.scan.files, rankOptions)) {
    let content: string;
    try {
      content = options.fs.readFile(join(options.root, ranked.file.path));
    } catch {
      dropped.push({ path: ranked.file.path, reason: "empty", tokens: 0 });
      continue;
    }

    if (content.trim().length === 0) {
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
