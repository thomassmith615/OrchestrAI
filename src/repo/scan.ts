/**
 * Repository scanner.
 *
 * Produces a stable inventory of what the repository contains. It classifies
 * and measures; it does not interpret. Milestone 6 decides what a model gets
 * to see, using this as its input.
 */
import { join } from "node:path";
import { configScope, isIgnored, parseIgnoreFile } from "./ignore.js";
import { detectLanguage, isBinaryName } from "./languages.js";
import type { IgnoreScope } from "./ignore.js";
import type { FileSystemHost } from "../core/hosts.js";

/** Files above this size are inventoried but never read. */
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

/** Hard ceiling so a pathological repository cannot hang the tool. */
export const DEFAULT_MAX_FILES = 20_000;

export interface FileEntry {
  /** Path relative to the repository root, always posix separated. */
  readonly path: string;
  readonly bytes: number;
  readonly language: string | null;
  readonly binary: boolean;
  readonly oversized: boolean;
}

export interface LanguageSummary {
  readonly language: string;
  readonly files: number;
  readonly bytes: number;
}

export interface ScanSummary {
  readonly root: string;
  readonly files: readonly FileEntry[];
  readonly totalBytes: number;
  readonly languages: readonly LanguageSummary[];
  readonly counts: {
    readonly ignored: number;
    readonly binary: number;
    readonly oversized: number;
  };
  /** True when the file cap was reached and the inventory is incomplete. */
  readonly truncated: boolean;
}

export interface ScanOptions {
  readonly root: string;
  readonly fs: FileSystemHost;
  /** Extra patterns from configuration, applied at the repository root. */
  readonly ignore?: readonly string[];
  readonly maxFileBytes?: number;
  readonly maxFiles?: number;
}

/**
 * Always excluded, regardless of what .gitignore says.
 *
 * `.orchestrai` is here because the state directory is meant to be committed
 * (only `cache/` is ignored, see `orch init`), and it holds complete copies of
 * every proposed file under `proposals/<id>/files/`. Left in, the scanner would
 * feed Orchestraᵢ's own staging area back to the model as though it were
 * repository source: rejected code indistinguishable from current code,
 * duplicate near-identical files competing for the same budget, and a context
 * that degrades a little further with every proposal ever made.
 */
const ALWAYS_IGNORED: ReadonlySet<string> = new Set([".git", ".orchestrai"]);

function readScope(
  fs: FileSystemHost,
  root: string,
  relativeDir: string,
): IgnoreScope | null {
  const path = join(root, relativeDir, ".gitignore");

  if (!fs.exists(path)) {
    return null;
  }

  return { base: relativeDir, rules: parseIgnoreFile(fs.readFile(path)) };
}

export function scanRepository(options: ScanOptions): ScanSummary {
  const { fs, root } = options;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  const files: FileEntry[] = [];
  const counts = { ignored: 0, binary: 0, oversized: 0 };
  let totalBytes = 0;
  let truncated = false;

  const rootScopes: IgnoreScope[] = [configScope(options.ignore ?? [])];
  const rootIgnore = readScope(fs, root, "");
  if (rootIgnore !== null) {
    rootScopes.push(rootIgnore);
  }

  const walk = (relativeDir: string, scopes: readonly IgnoreScope[]): void => {
    if (truncated) {
      return;
    }

    const absolute = relativeDir.length === 0 ? root : join(root, relativeDir);
    const entries = [...fs.readDir(absolute)].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      if (truncated) {
        return;
      }

      if (ALWAYS_IGNORED.has(entry.name)) {
        continue;
      }

      const relative =
        relativeDir.length === 0 ? entry.name : `${relativeDir}/${entry.name}`;

      if (isIgnored(relative, entry.isDirectory, scopes)) {
        counts.ignored += 1;
        continue;
      }

      if (entry.isDirectory) {
        const nested = readScope(fs, root, relative);
        walk(relative, nested === null ? scopes : [...scopes, nested]);
        continue;
      }

      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }

      const bytes = fs.size(join(root, relative));
      const binary = isBinaryName(entry.name);
      const oversized = bytes > maxFileBytes;

      if (binary) {
        counts.binary += 1;
      }
      if (oversized) {
        counts.oversized += 1;
      }

      totalBytes += bytes;
      files.push({
        path: relative,
        bytes,
        language: detectLanguage(entry.name),
        binary,
        oversized,
      });
    }
  };

  walk("", rootScopes);

  const byLanguage = new Map<string, { files: number; bytes: number }>();
  for (const file of files) {
    if (file.language === null || file.binary) {
      continue;
    }
    const current = byLanguage.get(file.language) ?? { files: 0, bytes: 0 };
    byLanguage.set(file.language, {
      files: current.files + 1,
      bytes: current.bytes + file.bytes,
    });
  }

  const languages: LanguageSummary[] = [...byLanguage.entries()]
    .map(([language, stats]) => ({ language, ...stats }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));

  return { root, files, totalBytes, languages, counts, truncated };
}
