/**
 * Change proposals.
 *
 * Model output never reaches the working tree directly. It becomes a proposal:
 * a set of staged file contents plus the metadata needed to review it, apply
 * it, or throw it away. Charter Principle 2 lives here.
 */

export type ChangeKind = "create" | "modify" | "delete";

export interface FileChange {
  /** Path relative to the repository root, posix separated. */
  readonly path: string;
  readonly kind: ChangeKind;
  /** Proposed content. Empty for a deletion. */
  readonly content: string;
  readonly addedLines: number;
  readonly removedLines: number;
}

export type ProposalStatus = "open" | "applied" | "rejected";

export interface Proposal {
  readonly id: string;
  readonly task: string;
  readonly status: ProposalStatus;
  readonly createdAt: number;
  readonly changes: readonly FileChange[];
  /** Anything the model said outside the change blocks. */
  readonly notes: string;
  readonly provider: string;
  readonly model: string;
  readonly promptRef: string;
  readonly contextTokens: number;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export function changeSummary(changes: readonly FileChange[]): {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
} {
  return {
    files: changes.length,
    added: changes.reduce((total, change) => total + change.addedLines, 0),
    removed: changes.reduce((total, change) => total + change.removedLines, 0),
  };
}
