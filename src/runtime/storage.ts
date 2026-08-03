/**
 * Capability-owned storage.
 *
 * A `CapabilityStorage` is a `FileSystemHost` confined to one directory: a
 * capability's declared namespace, rooted at whatever scope the current
 * invocation resolved to. It is not a new abstraction bolted onto the host
 * pattern — it *is* a `FileSystemHost`, the same interface every command
 * already receives, just with every path resolved against a fixed root and
 * checked before it reaches the real one. Two capabilities with different
 * namespaces get different roots by construction; neither can address the
 * other's files, or anything above its own root, because every path is
 * checked, not merely joined. See ADR 0019.
 */
import { join, relative, isAbsolute, sep } from "node:path";
import { OrchestraiError } from "../core/errors.js";
import { scopeStateDir } from "../core/workspace.js";
import type { DirEntry, FileSystemHost } from "../core/hosts.js";
import type { Scope } from "../core/workspace.js";

export interface CapabilityStorage extends FileSystemHost {
  /** Absolute path this storage is confined to. Every method's `path`
   *  argument is relative to this root. */
  readonly root: string;
}

/** A path resolved outside its capability's storage root: `../` escaping
 *  the namespace, or an absolute path elsewhere. Never a convention
 *  violation the caller could have avoided by being careful — it is caught
 *  here so a capability cannot reach another's files even if it tried. */
export class StorageContainmentError extends OrchestraiError {
  constructor(path: string, root: string) {
    super(`Path escapes capability storage root: ${path}`, {
      code: "runtime.storage_containment",
      hint: `Paths must resolve inside ${root}`,
    });
  }
}

function resolveWithin(root: string, path: string): string {
  const resolved = join(root, path);
  const rel = relative(root, resolved);

  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new StorageContainmentError(path, root);
  }

  return resolved;
}

/**
 * The absolute directory a namespace resolves to, under the given scope's
 * state directory. Empty string resolves to the state directory itself.
 */
export function storageRoot(scope: Scope, namespace: string): string {
  const stateDir = scopeStateDir(scope);
  return namespace === "" ? stateDir : join(stateDir, namespace);
}

/**
 * Builds a capability's storage handle: `fs`, confined to `namespace`'s
 * directory under `scope`'s state directory. Every operation checks
 * containment before delegating to `fs`, so a `writeFile("../x")` throws
 * rather than escaping.
 */
export function createCapabilityStorage(
  scope: Scope,
  namespace: string,
  fs: FileSystemHost,
): CapabilityStorage {
  const root = storageRoot(scope, namespace);

  return {
    root,
    exists: (path: string): boolean => fs.exists(resolveWithin(root, path)),
    readFile: (path: string): string => fs.readFile(resolveWithin(root, path)),
    writeFile: (path: string, content: string): void => {
      fs.writeFile(resolveWithin(root, path), content);
    },
    mkdir: (path: string): void => {
      fs.mkdir(resolveWithin(root, path));
    },
    readDir: (path: string): readonly DirEntry[] => fs.readDir(resolveWithin(root, path)),
    size: (path: string): number => fs.size(resolveWithin(root, path)),
  };
}
