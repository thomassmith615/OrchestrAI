/**
 * Git integration.
 *
 * Reads state by shelling out through the process host. Nothing here mutates
 * the repository: Orchestrai proposes, the human disposes, and any command
 * that would commit or push arrives later behind an explicit approval step.
 */
import type { ProcessHost } from "../core/hosts.js";

export interface GitCommit {
  readonly sha: string;
  readonly shortSha: string;
  readonly subject: string;
}

export interface GitStatus {
  /** False when git is unavailable or the directory is not a repository. */
  readonly available: boolean;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly head: GitCommit | null;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly ahead: number;
  readonly behind: number;
  /** True when anything is staged, modified, or untracked. */
  readonly dirty: boolean;
}

export const CLEAN_STATUS: GitStatus = {
  available: false,
  branch: null,
  detached: false,
  head: null,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
  dirty: false,
};

/**
 * Porcelain v2 entries: `1` and `2` carry two status characters, the first for
 * the index and the second for the working tree. `u` is an unmerged path and
 * `?` is untracked.
 */
function countEntry(
  line: string,
  counts: { staged: number; unstaged: number; untracked: number },
): void {
  if (line.startsWith("? ")) {
    counts.untracked += 1;
    return;
  }

  if (line.startsWith("u ")) {
    counts.unstaged += 1;
    return;
  }

  if (!line.startsWith("1 ") && !line.startsWith("2 ")) {
    return;
  }

  const xy = line.slice(2, 4);
  if (xy[0] !== "." && xy[0] !== undefined) {
    counts.staged += 1;
  }
  if (xy[1] !== "." && xy[1] !== undefined) {
    counts.unstaged += 1;
  }
}

function parseAheadBehind(value: string): { ahead: number; behind: number } {
  // Format: `+2 -1`
  const match = /^\+(\d+)\s+-(\d+)$/.exec(value.trim());

  if (match === null) {
    return { ahead: 0, behind: 0 };
  }

  return {
    ahead: Number.parseInt(match[1] ?? "0", 10),
    behind: Number.parseInt(match[2] ?? "0", 10),
  };
}

function readHead(proc: ProcessHost, root: string): GitCommit | null {
  const result = proc.run(
    "git",
    ["log", "-1", "--format=%H%x1f%h%x1f%s"],
    root,
  );

  if (!result.ok) {
    return null;
  }

  const [sha = "", shortSha = "", subject = ""] = result.stdout
    .trim()
    .split("\u001f");

  return sha.length === 0 ? null : { sha, shortSha, subject };
}

export function readGitStatus(proc: ProcessHost, root: string): GitStatus {
  const result = proc.run(
    "git",
    ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
    root,
  );

  if (!result.ok) {
    return CLEAN_STATUS;
  }

  const counts = { staged: 0, unstaged: 0, untracked: 0 };
  let branch: string | null = null;
  let detached = false;
  let ahead = 0;
  let behind = 0;

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const value = line.slice("# branch.head ".length).trim();
      detached = value === "(detached)";
      branch = detached ? null : value;
      continue;
    }

    if (line.startsWith("# branch.ab ")) {
      const parsed = parseAheadBehind(line.slice("# branch.ab ".length));
      ahead = parsed.ahead;
      behind = parsed.behind;
      continue;
    }

    countEntry(line, counts);
  }

  return {
    available: true,
    branch,
    detached,
    head: readHead(proc, root),
    ...counts,
    ahead,
    behind,
    dirty: counts.staged + counts.unstaged + counts.untracked > 0,
  };
}

export interface DiffOptions {
  /** Diff the index against HEAD instead of the working tree against the index. */
  readonly staged?: boolean;
  /** Limit output to these paths. */
  readonly paths?: readonly string[];
}

/**
 * Returns a unified diff, or null when git is unavailable. Used by Milestone 7
 * to show a human what a change proposal would do.
 */
export function readDiff(
  proc: ProcessHost,
  root: string,
  options: DiffOptions = {},
): string | null {
  const args = ["diff", "--no-color"];

  if (options.staged === true) {
    args.push("--staged");
  }
  if (options.paths !== undefined && options.paths.length > 0) {
    args.push("--", ...options.paths);
  }

  const result = proc.run("git", args, root);

  return result.ok ? result.stdout : null;
}

/** Human readable one-liner, e.g. `main (3 changed, 1 untracked)`. */
export function describeGitStatus(status: GitStatus): string {
  if (!status.available) {
    return "git unavailable";
  }

  const name = status.detached ? "detached HEAD" : (status.branch ?? "unknown");
  const parts: string[] = [];

  if (status.staged > 0) {
    parts.push(`${String(status.staged)} staged`);
  }
  if (status.unstaged > 0) {
    parts.push(`${String(status.unstaged)} modified`);
  }
  if (status.untracked > 0) {
    parts.push(`${String(status.untracked)} untracked`);
  }
  if (status.ahead > 0) {
    parts.push(`${String(status.ahead)} ahead`);
  }
  if (status.behind > 0) {
    parts.push(`${String(status.behind)} behind`);
  }

  return parts.length === 0 ? `${name} (clean)` : `${name} (${parts.join(", ")})`;
}
