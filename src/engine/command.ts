/**
 * The command contract.
 *
 * This is the stable interface between the orchestration engine and any
 * surface that drives it. The CLI is the first client; the dashboard, an HTTP
 * API, and an MCP server are later clients of the same definitions.
 *
 * Nothing in this file may import a CLI framework. Commands describe their
 * arguments, options, and preconditions in neutral terms and the surface
 * adapts them.
 */
import type { ResolvedConfig } from "../core/config/index.js";
import type { ExitCode } from "../core/errors.js";
import type { Hosts } from "../core/hosts.js";
import type { Logger } from "../core/logger.js";
import type { Workspace } from "../core/workspace.js";

/** Result state of a reported value, used for aligned status output. */
export type FieldStatus = "pass" | "fail" | "warn" | "info";

export interface ReportField {
  readonly label: string;
  readonly value: string | number | boolean | null;
  readonly status?: FieldStatus;
}

/**
 * The human readable view of a command result. Surfaces decide how to render
 * it; commands never format their own output.
 */
export interface Report {
  readonly fields: readonly ReportField[];
  /** Free form lines printed after the fields, e.g. "Ready for review." */
  readonly notes?: readonly string[];
}

export interface CommandResult<TData = unknown> {
  /** Machine readable payload, emitted verbatim under `--json`. */
  readonly data: TData;
  /** Human readable view of the same information. */
  readonly report: Report;
  /** Defaults to success when omitted. */
  readonly exitCode?: ExitCode;
}

export interface CommandArgument {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
}

export interface CommandOption {
  /** Neutral flag spec, e.g. `--force` or `--provider <name>`. */
  readonly flags: string;
  readonly description: string;
}

/**
 * Preconditions enforced by the surface before `execute` runs, so that
 * commands never re-implement the same guard clauses.
 */
export interface CommandRequirements {
  /** Must be inside a git repository. Failure exits 4. */
  readonly repository?: boolean;
  /** `orch init` must have run. Failure exits 4. */
  readonly initialized?: boolean;
  /** Configuration must load cleanly. Failure exits 5. */
  readonly config?: boolean;
}

export interface CommandContext {
  /** Directory the command should operate against. */
  readonly cwd: string;
  readonly logger: Logger;
  /** Parsed option values, keyed by camelCase option name. */
  readonly options: Readonly<Record<string, unknown>>;
  /** Positional arguments in declaration order. */
  readonly args: readonly string[];
  /** Filesystem, subprocess, and environment access. */
  readonly hosts: Hosts;
  /** Null when the working directory is not inside a git repository. */
  readonly workspace: Workspace | null;
  /** Null when configuration failed to load; only tolerated by `doctor`. */
  readonly config: ResolvedConfig | null;
  /** Populated when configuration failed to load. */
  readonly configError: unknown;
}

export interface CommandDefinition<TData = unknown> {
  /** Invocation name, e.g. `status`. */
  readonly name: string;
  readonly summary: string;
  readonly args?: readonly CommandArgument[];
  readonly options?: readonly CommandOption[];
  readonly requires?: CommandRequirements;
  execute(context: CommandContext): Promise<CommandResult<TData>>;
}

/** Convenience helper so commands do not repeat the success default. */
export function ok<TData>(data: TData, report: Report): CommandResult<TData> {
  return { data, report };
}

/**
 * Runs a synchronous command body and returns a promise, converting a throw
 * into a rejection. `execute` promises to return a promise; a synchronous
 * throw breaks that for any caller not already inside an async frame.
 */
export function attempt<TData>(
  body: () => CommandResult<TData> | Promise<CommandResult<TData>>,
): Promise<CommandResult<TData>> {
  try {
    return Promise.resolve(body());
  } catch (error: unknown) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Narrows a context whose requirements have already been enforced by the
 * surface, so commands can use `workspace` and `config` without null checks.
 */
export function requireWorkspace(context: CommandContext): Workspace {
  if (context.workspace === null) {
    throw new Error("Command requires a workspace but none was resolved");
  }
  return context.workspace;
}

export function requireConfig(context: CommandContext): ResolvedConfig {
  if (context.config === null) {
    throw new Error("Command requires configuration but none was resolved");
  }
  return context.config;
}
