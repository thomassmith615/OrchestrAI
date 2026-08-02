/**
 * Workspace resolution.
 *
 * Orchestrai operates on a git repository. The workspace is discovered by
 * walking upward from the working directory, the same way git, npm, and cargo
 * locate their own roots.
 */
import { dirname, join, resolve } from "node:path";
import type { FileSystemHost } from "./hosts.js";

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
