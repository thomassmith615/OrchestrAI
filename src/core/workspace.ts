/**
 * Workspace and scope resolution.
 *
 * Version 1 assumed every command runs inside a git repository. The workspace
 * is discovered by walking upward from the working directory, the same way
 * git, npm, and cargo locate their own roots.
 *
 * Version 2 generalizes that into a `Scope`: repository scope, unchanged from
 * v1, or user scope, rooted at the invoking user's home directory, with no
 * repository anywhere. See ADR 0017.
 */
import { dirname, join, resolve } from "node:path";
import type { EnvHost, FileSystemHost } from "./hosts.js";

/** Directory holding durable Orchestrai state inside a repository. */
export const STATE_DIR_NAME = ".orchestrai";

/** Project configuration file, at the repository root. */
export const CONFIG_FILE_NAME = "orchestrai.config.json";

export interface Workspace {
  /** Absolute path of the repository root (the directory containing .git). */
  readonly root: string;
  /** Absolute path of the state directory, whether or not it exists. */
  readonly stateDir: string;
  /** Absolute path of the config file, whether or not it exists. */
  readonly configPath: string;
  /** True once `orch init` has created the state directory. */
  readonly initialized: boolean;
}

/**
 * Returns the workspace containing `cwd`, or null when the directory is not
 * inside a git repository.
 */
export function resolveWorkspace(
  cwd: string,
  fs: FileSystemHost,
): Workspace | null {
  let current = resolve(cwd);

  for (;;) {
    if (fs.exists(join(current, ".git"))) {
      const stateDir = join(current, STATE_DIR_NAME);

      return {
        root: current,
        stateDir,
        configPath: join(current, CONFIG_FILE_NAME),
        initialized: fs.exists(stateDir),
      };
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** Discriminant shared by every `Scope` variant. */
export type ScopeKind = "repository" | "user";

/** Rooted at a git repository. Identical to Version 1's only mode. */
export interface RepositoryScope {
  readonly kind: "repository";
  readonly workspace: Workspace;
}

/**
 * Rooted at the invoking user's home directory, independent of any
 * repository. `root` and `stateDir` are the same directory today; they are
 * kept as distinct fields so a capability-scoped subdirectory (planned for
 * V2-4) has somewhere to attach without introducing a second concept.
 */
export interface UserScope {
  readonly kind: "user";
  /** Absolute path of the user's data root: `~/.orchestrai`. */
  readonly root: string;
  readonly stateDir: string;
}

export type Scope = RepositoryScope | UserScope;

/**
 * Reads the home directory through the injected environment host rather than
 * `process.env` directly, so scope resolution stays testable. `HOME` covers
 * macOS and Linux; `USERPROFILE` covers Windows.
 */
export function resolveHomeDir(env: EnvHost): string | null {
  const home = env["HOME"] ?? env["USERPROFILE"];
  return home !== undefined && home !== "" ? home : null;
}

/**
 * Resolves user scope, or null when the home directory cannot be
 * determined. Unlike repository scope, this never depends on `cwd`.
 */
export function resolveUserScope(env: EnvHost): UserScope | null {
  const home = resolveHomeDir(env);
  if (home === null) {
    return null;
  }
  const root = join(home, STATE_DIR_NAME);
  return { kind: "user", root, stateDir: root };
}

/**
 * Resolves whichever scope a command actually needs. `kind` is undefined for
 * a command that expressed no preference (`CommandRequirements.scope` unset
 * or `"either"`), in which case repository scope wins when a workspace is
 * present and user scope is the fallback — the same preference a person
 * standing in a terminal would have.
 */
export function resolveScope(
  kind: ScopeKind | undefined,
  workspace: Workspace | null,
  env: EnvHost,
): Scope | null {
  if (kind === "repository") {
    return workspace === null ? null : { kind: "repository", workspace };
  }
  if (kind === "user") {
    return resolveUserScope(env);
  }
  return workspace === null
    ? resolveUserScope(env)
    : { kind: "repository", workspace };
}
