/**
 * Persisted gate results.
 *
 * `orch status` should be fast, so it reports the last recorded run rather
 * than executing a build. The file lives in `.orchestrai/` as plain JSON: a
 * human can read it, and a diff shows what changed.
 */
import { join } from "node:path";
import type { GateRun } from "./types.js";
import type { FileSystemHost } from "../core/hosts.js";

export const GATES_FILE = "gates.json";

/** Bumped whenever the on-disk shape changes incompatibly. */
export const GATES_SCHEMA_VERSION = 1;

interface GatesDocument {
  readonly schemaVersion: number;
  readonly run: GateRun;
}

function pathFor(stateDir: string): string {
  return join(stateDir, GATES_FILE);
}

/** Silently does nothing when the state directory does not exist yet. */
export function recordGateRun(
  fs: FileSystemHost,
  stateDir: string,
  run: GateRun,
): boolean {
  if (!fs.exists(stateDir)) {
    return false;
  }

  const document: GatesDocument = { schemaVersion: GATES_SCHEMA_VERSION, run };
  fs.writeFile(pathFor(stateDir), `${JSON.stringify(document, null, 2)}\n`);

  return true;
}

/** Returns null when nothing was recorded, or the file is unreadable or stale. */
export function readGateRun(
  fs: FileSystemHost,
  stateDir: string,
): GateRun | null {
  const path = pathFor(stateDir);

  if (!fs.exists(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFile(path)) as Partial<GatesDocument>;

    if (parsed.schemaVersion !== GATES_SCHEMA_VERSION || parsed.run === undefined) {
      return null;
    }

    return parsed.run;
  } catch {
    return null;
  }
}
