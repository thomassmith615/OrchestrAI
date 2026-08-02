/**
 * Proposal storage.
 *
 * Each proposal lives under `.orchestrai/proposals/<id>/`: a JSON record plus
 * the staged file contents on disk. Staging the real bytes means the diff shown
 * to a human is produced by git against real files, not reconstructed.
 */
import { dirname, join } from "node:path";
import { EXIT_CODES, OrchestraiError } from "../core/errors.js";
import type { FileSystemHost } from "../core/hosts.js";
import type { Proposal, ProposalStatus } from "./types.js";

export const PROPOSALS_DIR = "proposals";
export const PROPOSAL_SCHEMA_VERSION = 1;

interface ProposalDocument {
  readonly schemaVersion: number;
  readonly proposal: Proposal;
}

export function proposalsRoot(stateDir: string): string {
  return join(stateDir, PROPOSALS_DIR);
}

export function proposalDir(stateDir: string, id: string): string {
  return join(proposalsRoot(stateDir), id);
}

/** Staged copy of one proposed file, mirroring its repository path. */
export function stagedPath(
  stateDir: string,
  id: string,
  path: string,
): string {
  return join(proposalDir(stateDir, id), "files", path);
}

/** Short, sortable, and readable in a directory listing. */
export function nextProposalId(now: number, existing: readonly string[]): string {
  const stamp = new Date(now)
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(2, 13);

  let candidate = stamp;
  let suffix = 1;
  while (existing.includes(candidate)) {
    candidate = `${stamp}-${String(suffix)}`;
    suffix += 1;
  }

  return candidate;
}

export function saveProposal(
  fs: FileSystemHost,
  stateDir: string,
  proposal: Proposal,
): void {
  const dir = proposalDir(stateDir, proposal.id);
  fs.mkdir(dir);

  for (const change of proposal.changes) {
    if (change.kind === "delete") {
      continue;
    }
    // Staged files mirror their repository path, so nested paths need parents.
    const target = stagedPath(stateDir, proposal.id, change.path);
    fs.mkdir(dirname(target));
    fs.writeFile(target, change.content);
  }

  const document: ProposalDocument = {
    schemaVersion: PROPOSAL_SCHEMA_VERSION,
    proposal,
  };
  fs.writeFile(join(dir, "proposal.json"), `${JSON.stringify(document, null, 2)}\n`);
}

export function readProposal(
  fs: FileSystemHost,
  stateDir: string,
  id: string,
): Proposal | null {
  const path = join(proposalDir(stateDir, id), "proposal.json");

  if (!fs.exists(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFile(path)) as Partial<ProposalDocument>;
    return parsed.schemaVersion === PROPOSAL_SCHEMA_VERSION &&
      parsed.proposal !== undefined
      ? parsed.proposal
      : null;
  } catch {
    return null;
  }
}

export function listProposals(
  fs: FileSystemHost,
  stateDir: string,
): readonly Proposal[] {
  const root = proposalsRoot(stateDir);

  if (!fs.exists(root)) {
    return [];
  }

  return fs
    .readDir(root)
    .filter((entry) => entry.isDirectory)
    .map((entry) => readProposal(fs, stateDir, entry.name))
    .filter((proposal): proposal is Proposal => proposal !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function requireProposal(
  fs: FileSystemHost,
  stateDir: string,
  id: string,
): Proposal {
  const proposal = readProposal(fs, stateDir, id);

  if (proposal === null) {
    const known = listProposals(fs, stateDir)
      .map((entry) => entry.id)
      .slice(0, 5);

    throw new OrchestraiError(`No such proposal: ${id}`, {
      code: "proposal.unknown",
      exitCode: EXIT_CODES.usage,
      hint:
        known.length === 0
          ? "There are no proposals yet"
          : `Known: ${known.join(", ")}`,
    });
  }

  return proposal;
}

export function setStatus(
  fs: FileSystemHost,
  stateDir: string,
  proposal: Proposal,
  status: ProposalStatus,
): Proposal {
  const updated: Proposal = { ...proposal, status };
  saveProposal(fs, stateDir, updated);
  return updated;
}

/** Most recent proposal still awaiting a decision. */
export function latestOpen(
  fs: FileSystemHost,
  stateDir: string,
): Proposal | null {
  return (
    listProposals(fs, stateDir).find(
      (proposal) => proposal.status === "open",
    ) ?? null
  );
}
