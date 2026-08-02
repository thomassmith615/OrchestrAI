/**
 * Applying a proposal to the working tree.
 *
 * Preconditions are strict on purpose. The working tree must be clean, so that
 * `git checkout .` is always a complete undo, and so that a human reviewing the
 * result is looking at the model's work rather than a mixture of theirs and
 * its.
 *
 * Nothing is committed. Orchestraᵢ writes files; the operator decides whether
 * they become history.
 */
import { join } from "node:path";
import { PreconditionError } from "../core/errors.js";
import type { FileSystemHost, ProcessHost } from "../core/hosts.js";
import type { GitStatus } from "../repo/git.js";
import type { Proposal } from "./types.js";

export interface ApplyOutcome {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
}

export function ensureApplicable(
  proposal: Proposal,
  git: GitStatus,
  force: boolean,
): void {
  if (proposal.status === "applied") {
    throw new PreconditionError(
      `Proposal ${proposal.id} was already applied`,
      "Reject it, or create a new proposal",
    );
  }

  if (proposal.status === "rejected") {
    throw new PreconditionError(`Proposal ${proposal.id} was rejected`);
  }

  if (proposal.changes.length === 0) {
    throw new PreconditionError(
      `Proposal ${proposal.id} contains no changes`,
    );
  }

  if (git.dirty && !force) {
    throw new PreconditionError(
      "The working tree has uncommitted changes",
      "Commit or stash first, so that `git checkout .` remains a clean undo. Use --force to override",
    );
  }
}

/**
 * Deletion goes through git when the file is tracked, so that the removal is
 * staged the way a human would have done it.
 */
function removeFile(
  proc: ProcessHost,
  fs: FileSystemHost,
  root: string,
  path: string,
): boolean {
  const absolute = join(root, path);

  if (!fs.exists(absolute)) {
    return false;
  }

  const result = proc.run("git", ["rm", "--quiet", "--", path], root);

  if (!result.ok) {
    // Untracked file: git rm refuses, so write an empty marker is wrong.
    // Leave it in place and report it rather than guessing.
    return false;
  }

  return true;
}

export function applyProposal(
  fs: FileSystemHost,
  proc: ProcessHost,
  root: string,
  proposal: Proposal,
): ApplyOutcome {
  const written: string[] = [];
  const deleted: string[] = [];

  for (const change of proposal.changes) {
    if (change.kind === "delete") {
      if (removeFile(proc, fs, root, change.path)) {
        deleted.push(change.path);
      }
      continue;
    }

    const absolute = join(root, change.path);
    const parent = absolute.slice(0, absolute.lastIndexOf("/"));
    if (parent.length > 0) {
      fs.mkdir(parent);
    }

    fs.writeFile(absolute, change.content);
    written.push(change.path);
  }

  return { written, deleted };
}
