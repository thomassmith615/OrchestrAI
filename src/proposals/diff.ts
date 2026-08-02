/**
 * Diff rendering.
 *
 * Diffs are produced by `git diff --no-index` between the file in the working
 * tree and its staged replacement. Using git rather than a hand written differ
 * means the output is exactly what the operator already knows how to read, and
 * there is one less algorithm to be subtly wrong.
 */
import { join } from "node:path";
import { stagedPath } from "./store.js";
import type { FileSystemHost, ProcessHost } from "../core/hosts.js";
import type { FileChange, Proposal } from "./types.js";

/** git diff --no-index exits 1 when files differ, which is not an error. */
function runDiff(
  proc: ProcessHost,
  root: string,
  left: string,
  right: string,
): string | null {
  const result = proc.run(
    "git",
    ["diff", "--no-index", "--no-color", "--", left, right],
    root,
  );

  if (result.stdout.length > 0) {
    return result.stdout;
  }

  return result.ok ? "" : null;
}

const NULL_DEVICE = "/dev/null";

/**
 * `git diff --no-index` names the real paths it was handed, which are the
 * working tree file and the staged copy. Rewrite them to the repository path
 * so the diff reads like one a human would produce.
 */
function normalizeHeaders(diff: string, path: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("diff --git ")) {
        return `diff --git a/${path} b/${path}`;
      }
      if (line.startsWith("--- ") && line !== "--- /dev/null") {
        return `--- a/${path}`;
      }
      if (line.startsWith("+++ ") && line !== "+++ /dev/null") {
        return `+++ b/${path}`;
      }
      return line;
    })
    .join("\n");
}

export function diffForChange(
  proc: ProcessHost,
  fs: FileSystemHost,
  root: string,
  stateDir: string,
  proposalId: string,
  change: FileChange,
): string {
  const current = join(root, change.path);

  if (change.kind === "delete") {
    const removed = runDiff(proc, root, current, NULL_DEVICE);
    return removed === null
      ? `deleted ${change.path} (${String(change.removedLines)} lines)`
      : normalizeHeaders(removed, change.path);
  }

  const staged = stagedPath(stateDir, proposalId, change.path);
  const left = fs.exists(current) ? current : NULL_DEVICE;
  const rendered = runDiff(proc, root, left, staged);

  return rendered === null
    ? `${change.kind} ${change.path} (+${String(change.addedLines)} -${String(
        change.removedLines,
      )})`
    : normalizeHeaders(rendered, change.path);
}

export function diffForProposal(
  proc: ProcessHost,
  fs: FileSystemHost,
  root: string,
  stateDir: string,
  proposal: Proposal,
): string {
  return proposal.changes
    .map((change) =>
      diffForChange(proc, fs, root, stateDir, proposal.id, change),
    )
    .join("\n");
}

/** One line per file, in the shape of `git diff --stat`. */
export function diffStat(proposal: Proposal): readonly string[] {
  return proposal.changes.map(
    (change) =>
      `${change.kind.padEnd(7)} ${change.path}  +${String(
        change.addedLines,
      )} -${String(change.removedLines)}`,
  );
}
