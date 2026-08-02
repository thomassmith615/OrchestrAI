/**
 * Project memory.
 *
 * Charter Principle 4: critical knowledge must never exist only inside one AI
 * conversation. Memory is the durable answer to "why is it like this", written
 * to the repository so it survives the session that produced it.
 */

export const MEMORY_KINDS = [
  "decision",
  "constraint",
  "milestone",
  "note",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemorySource = "human" | "workflow";

export interface MemoryRecord {
  readonly id: string;
  readonly kind: MemoryKind;
  /** Epoch milliseconds. */
  readonly createdAt: number;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  /** Milestone this record came out of, when it came from one. */
  readonly milestoneId: string | null;
  /** Commit the repository was on when the record was written. */
  readonly commit: string | null;
  readonly source: MemorySource;
}

export function isMemoryKind(value: string): value is MemoryKind {
  return (MEMORY_KINDS as readonly string[]).includes(value);
}

/** Compact one line form, used in listings. */
export function describeRecord(record: MemoryRecord): string {
  const tags = record.tags.length === 0 ? "" : ` [${record.tags.join(", ")}]`;

  return `${record.kind.padEnd(10)} ${record.title}${tags}`;
}
