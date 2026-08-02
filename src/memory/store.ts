/**
 * Memory storage.
 *
 * One append-only JSONL file. Append-only because rewriting history is how a
 * record of decisions stops being trustworthy, and JSONL because appending a
 * line is the smallest possible write and produces a diff that shows exactly
 * what was added.
 *
 * A malformed line is reported, never silently skipped. Memory that quietly
 * loses records is worse than memory that admits it is damaged.
 */
import { join } from "node:path";
import { EXIT_CODES, OrchestraiError } from "../core/errors.js";
import { isMemoryKind } from "./types.js";
import type { MemoryRecord } from "./types.js";
import type { FileSystemHost } from "../core/hosts.js";

export const MEMORY_DIR = "memory";
export const MEMORY_FILE = "records.jsonl";

export interface MemoryReadResult {
  readonly records: readonly MemoryRecord[];
  /** Line numbers, one based, that could not be parsed. */
  readonly damaged: readonly number[];
}

export function memoryDir(stateDir: string): string {
  return join(stateDir, MEMORY_DIR);
}

export function memoryPath(stateDir: string): string {
  return join(memoryDir(stateDir), MEMORY_FILE);
}

function isRecord(value: unknown): value is MemoryRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<MemoryRecord>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.kind === "string" &&
    isMemoryKind(candidate.kind) &&
    Array.isArray(candidate.tags)
  );
}

export function readMemory(
  fs: FileSystemHost,
  stateDir: string,
): MemoryReadResult {
  const path = memoryPath(stateDir);

  if (!fs.exists(path)) {
    return { records: [], damaged: [] };
  }

  const records: MemoryRecord[] = [];
  const damaged: number[] = [];

  fs.readFile(path)
    .split("\n")
    .forEach((line, index) => {
      if (line.trim().length === 0) {
        return;
      }

      try {
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed)) {
          records.push(parsed);
        } else {
          damaged.push(index + 1);
        }
      } catch {
        damaged.push(index + 1);
      }
    });

  return { records, damaged };
}

/**
 * Appends one record. The whole file is rewritten because the filesystem host
 * has no append primitive; the operation stays logically append-only, and the
 * read-modify-write is single threaded within one CLI invocation.
 */
export function appendMemory(
  fs: FileSystemHost,
  stateDir: string,
  record: MemoryRecord,
): void {
  if (!fs.exists(stateDir)) {
    throw new OrchestraiError("Orchestrai is not initialized here", {
      code: "memory.uninitialized",
      exitCode: EXIT_CODES.precondition,
      hint: "Run `orch init`",
    });
  }

  fs.mkdir(memoryDir(stateDir));

  const path = memoryPath(stateDir);
  const existing = fs.exists(path) ? fs.readFile(path) : "";
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";

  fs.writeFile(path, `${existing}${separator}${JSON.stringify(record)}\n`);
}

/** Short, sortable, and unique within a millisecond. */
export function nextMemoryId(
  now: number,
  existing: readonly MemoryRecord[],
): string {
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, "").slice(2, 13);
  const taken = new Set(existing.map((record) => record.id));

  let candidate = stamp;
  let suffix = 1;
  while (taken.has(candidate)) {
    candidate = `${stamp}-${String(suffix)}`;
    suffix += 1;
  }

  return candidate;
}
