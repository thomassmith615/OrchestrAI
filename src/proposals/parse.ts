/**
 * Parsing model output into file changes.
 *
 * The protocol is full file replacement inside explicit markers, not a diff.
 * Models produce diffs with wrong line numbers and drifting context often
 * enough that applying them becomes the failure mode; a whole file is either
 * parsed or it is not. The cost is more output tokens, which is the cheaper
 * side of that trade.
 *
 *   <<<FILE src/thing.ts
 *   ...complete new contents...
 *   >>>
 *
 *   <<<DELETE src/old.ts>>>
 */
import { EXIT_CODES, OrchestraiError } from "../core/errors.js";
import type { ChangeKind, FileChange } from "./types.js";

const FILE_BLOCK = /^<<<FILE[ \t]+(.+?)[ \t]*$/;
const DELETE_BLOCK = /^<<<DELETE[ \t]+(.+?)[ \t]*>>>[ \t]*$/;
const END_BLOCK = /^>>>[ \t]*$/;

export class ProposalParseError extends OrchestraiError {
  constructor(message: string, hint?: string) {
    super(message, {
      code: "proposal.unparsable",
      exitCode: EXIT_CODES.failure,
      ...(hint === undefined ? {} : { hint }),
    });
  }
}

export interface ParsedResponse {
  readonly changes: readonly FileChange[];
  /** Everything outside the change blocks. */
  readonly notes: string;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.replace(/\n$/, "").split("\n").length;
}

/** Rejects anything that would write outside the repository. */
function validatePath(path: string): string {
  const normalized = path.trim().replace(/^\.\//, "");

  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new ProposalParseError(
      `Refusing a change to an unsafe path: ${path}`,
      "Paths must be relative to the repository root",
    );
  }

  return normalized;
}

export interface ParseOptions {
  /** Existing file contents, used to classify create vs modify and count lines. */
  readonly existing: (path: string) => string | null;
}

export function parseChangeBlocks(
  response: string,
  options: ParseOptions,
): ParsedResponse {
  const lines = response.split("\n");
  const changes: FileChange[] = [];
  const notes: string[] = [];

  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    const deletion = DELETE_BLOCK.exec(line);
    if (deletion !== null) {
      const path = validatePath(deletion[1] ?? "");
      const before = options.existing(path);
      changes.push({
        path,
        kind: "delete",
        content: "",
        addedLines: 0,
        removedLines: before === null ? 0 : countLines(before),
      });
      index += 1;
      continue;
    }

    const opening = FILE_BLOCK.exec(line);
    if (opening === null) {
      notes.push(line);
      index += 1;
      continue;
    }

    const path = validatePath(opening[1] ?? "");
    const body: string[] = [];
    index += 1;

    let closed = false;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (END_BLOCK.test(current)) {
        closed = true;
        index += 1;
        break;
      }
      body.push(current);
      index += 1;
    }

    if (!closed) {
      throw new ProposalParseError(
        `Unterminated change block for ${path}`,
        "The response was cut off, or the model omitted the closing marker",
      );
    }

    const content = `${body.join("\n").replace(/\n+$/, "")}\n`;
    const before = options.existing(path);
    const kind: ChangeKind = before === null ? "create" : "modify";

    changes.push({
      path,
      kind,
      content,
      addedLines: countLines(content),
      removedLines: before === null ? 0 : countLines(before),
    });
  }

  const deduped = new Map<string, FileChange>();
  for (const change of changes) {
    // A later block for the same path supersedes an earlier one.
    deduped.set(change.path, change);
  }

  return {
    changes: [...deduped.values()],
    notes: notes.join("\n").trim(),
  };
}
