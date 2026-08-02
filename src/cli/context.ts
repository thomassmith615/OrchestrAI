/**
 * Builds the command context and enforces declared requirements.
 *
 * Resolution happens once per invocation rather than once per command, and
 * requirement checks live here so that no command re-implements the same guard
 * clauses.
 */
import { ConfigurationError, resolveConfig } from "../core/config/index.js";
import { PreconditionError } from "../core/errors.js";
import { resolveWorkspace } from "../core/workspace.js";
import type { ResolvedConfig } from "../core/config/index.js";
import type { Hosts } from "../core/hosts.js";
import type { Workspace } from "../core/workspace.js";
import type { CommandRequirements } from "../engine/command.js";

export interface BaseContext {
  readonly cwd: string;
  readonly hosts: Hosts;
  readonly workspace: Workspace | null;
  readonly config: ResolvedConfig | null;
  readonly configError: unknown;
}

export function buildBaseContext(
  cwd: string,
  hosts: Hosts,
  overrides: readonly string[],
): BaseContext {
  const workspace = resolveWorkspace(cwd, hosts.fs);

  try {
    const config = resolveConfig({
      configPath: workspace?.configPath ?? null,
      fs: hosts.fs,
      env: hosts.env,
      overrides,
    });

    return { cwd, hosts, workspace, config, configError: undefined };
  } catch (error: unknown) {
    return { cwd, hosts, workspace, config: null, configError: error };
  }
}

/**
 * Throws the appropriate typed error when a command's declared preconditions
 * are not met. Exit codes follow the contract in docs/CLI.md.
 */
export function enforceRequirements(
  requirements: CommandRequirements | undefined,
  base: BaseContext,
): void {
  if (requirements === undefined) {
    return;
  }

  if (requirements.repository === true && base.workspace === null) {
    throw new PreconditionError(
      "Not inside a git repository",
      "Run this from a repository, or pass --cwd",
    );
  }

  if (requirements.initialized === true && base.workspace?.initialized !== true) {
    throw new PreconditionError(
      "Orchestrai is not initialized in this repository",
      "Run `orch init`",
    );
  }

  if (requirements.config === true && base.config === null) {
    throw base.configError instanceof ConfigurationError
      ? base.configError
      : new ConfigurationError("Configuration could not be resolved");
  }
}
