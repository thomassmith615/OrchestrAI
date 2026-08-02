/**
 * The command contract.
 *
 * This is the stable interface between the orchestration engine and any
 * surface that drives it. The CLI is the first client; the dashboard, an HTTP
 * API, and an MCP server are later clients of the same definitions.
 *
 * Nothing in this file may import a CLI framework. Commands describe their
 * arguments and options in neutral terms and the surface adapts them.
 */
import type { ExitCode } from "../core/errors.js";
import type { Logger } from "../core/logger.js";

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

export interface CommandContext {
  /** Directory the command should operate against. */
  readonly cwd: string;
  readonly logger: Logger;
  /** Parsed option values, keyed by camelCase option name. */
  readonly options: Readonly<Record<string, unknown>>;
  /** Positional arguments in declaration order. */
  readonly args: readonly string[];
}

export interface CommandDefinition<TData = unknown> {
  /** Invocation name, e.g. `status`. Sub-commands use `provider add`. */
  readonly name: string;
  readonly summary: string;
  readonly args?: readonly CommandArgument[];
  readonly options?: readonly CommandOption[];
  execute(context: CommandContext): Promise<CommandResult<TData>>;
}

/** Convenience helper so commands do not repeat the success default. */
export function ok<TData>(data: TData, report: Report): CommandResult<TData> {
  return { data, report };
}
