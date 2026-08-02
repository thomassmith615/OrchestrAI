/**
 * Builds the command context and enforces declared requirements.
 *
 * Resolution happens once per invocation rather than once per command, and
 * requirement checks live here so that no command re-implements the same guard
 * clauses.
 */
import { ConfigurationError, resolveConfig } from "../core/config/index.js";
import { PreconditionError } from "../core/errors.js";
import { resolveScope, resolveUserScope, resolveWorkspace } from "../core/workspace.js";
import type { ResolvedConfig } from "../core/config/index.js";
import type { Hosts } from "../core/hosts.js";
import type { Scope, Workspace } from "../core/workspace.js";
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
 *
 * A command that declares no `requires` object at all is scope-agnostic and
 * is not checked here at all, exactly as in Version 1. A command that
 * declares `requires` without a `scope` defaults to `"repository"`, which is
 * what kept every Version 1 command's behaviour unchanged when `scope`
 * replaced the old `repository: boolean` flag. See ADR 0017.
 */
export function enforceRequirements(
  requirements: CommandRequirements | undefined,
  base: BaseContext,
): void {
  if (requirements === undefined) {
    return;
  }

  const scopeKind = requirements.scope ?? "repository";

  if (scopeKind === "repository" && base.workspace === null) {
    throw new PreconditionError(
      "Not inside a git repository",
      "Run this from a repository, or pass --cwd",
    );
  }

  if (scopeKind === "user" && resolveUserScope(base.hosts.env) === null) {
    throw new PreconditionError(
      "Could not determine the current user's home directory",
      "Set the HOME environment variable",
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

/**
 * Resolves the scope a command's context will carry, given what it declared.
 * Called only after `enforceRequirements` has already validated that a
 * strictly required scope is available, so this never needs to fail — a
 * command that required nothing simply gets whichever scope is available,
 * preferring repository scope the way a person standing in a terminal would.
 */
export function resolveContextScope(
  requirements: CommandRequirements | undefined,
  base: BaseContext,
): Scope | null {
  const declared = requirements?.scope;
  // "either" resolves exactly like declaring nothing: prefer repository,
  // fall back to user.
  const kind = declared === "either" ? undefined : declared;
  return resolveScope(kind, base.workspace, base.hosts.env);
}
