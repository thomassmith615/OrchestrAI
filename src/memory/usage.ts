/**
 * Usage ledger.
 *
 * Every provider call appends one line. Append-only for the same reason memory
 * is: a spend record that can be rewritten is not a record. Cost is nullable
 * because the pricing table is advisory and a wrong number is worse than an
 * absent one.
 */
import { join } from "node:path";
import type { FileSystemHost } from "../core/hosts.js";

export const USAGE_FILE = "usage.jsonl";

export interface UsageEntry {
  readonly at: number;
  readonly provider: string;
  readonly model: string;
  readonly promptRef: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Null when the model has no known rate. */
  readonly costUsd: number | null;
  readonly retries: number;
  readonly fellBack: boolean;
}

export function usagePath(stateDir: string): string {
  return join(stateDir, USAGE_FILE);
}

export function recordUsage(
  fs: FileSystemHost,
  stateDir: string,
  entry: UsageEntry,
): boolean {
  if (!fs.exists(stateDir)) {
    return false;
  }

  const path = usagePath(stateDir);
  const existing = fs.exists(path) ? fs.readFile(path) : "";
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";

  fs.writeFile(path, `${existing}${separator}${JSON.stringify(entry)}\n`);

  return true;
}

export interface UsageTotals {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Sum of known costs only. */
  readonly costUsd: number;
  /** Calls whose model had no known rate, so the total understates spend. */
  readonly unpriced: number;
  readonly retries: number;
}

export function readUsage(
  fs: FileSystemHost,
  stateDir: string,
): readonly UsageEntry[] {
  const path = usagePath(stateDir);

  if (!fs.exists(path)) {
    return [];
  }

  return fs
    .readFile(path)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as UsageEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is UsageEntry => entry !== null);
}

export function totalUsage(entries: readonly UsageEntry[]): UsageTotals {
  return entries.reduce<UsageTotals>(
    (totals, entry) => ({
      calls: totals.calls + 1,
      inputTokens: totals.inputTokens + entry.inputTokens,
      outputTokens: totals.outputTokens + entry.outputTokens,
      costUsd: totals.costUsd + (entry.costUsd ?? 0),
      unpriced: totals.unpriced + (entry.costUsd === null ? 1 : 0),
      retries: totals.retries + entry.retries,
    }),
    {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      unpriced: 0,
      retries: 0,
    },
  );
}
