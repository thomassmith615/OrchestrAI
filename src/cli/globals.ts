/**
 * Global flags.
 *
 * These are scanned before the command tree is built so that output format and
 * log level are settled before anything runs. Commander still declares them so
 * that they appear in help output and are accepted anywhere on the line.
 */
import type { CommandOption } from "../engine/command.js";
import type { LogLevel } from "../core/logger.js";

export const GLOBAL_OPTIONS: readonly CommandOption[] = [
  { flags: "--json", description: "Emit machine readable JSON" },
  { flags: "--verbose", description: "Include debug output" },
  { flags: "--quiet", description: "Suppress all output except errors" },
  { flags: "--cwd <path>", description: "Directory to operate against" },
];

export interface GlobalFlags {
  readonly json: boolean;
  readonly level: LogLevel;
  readonly cwd: string | undefined;
}

/**
 * Reads global flags without consuming them, so commander still sees the full
 * argument list.
 */
export function readGlobalFlags(argv: readonly string[]): GlobalFlags {
  const json = argv.includes("--json");
  const quiet = argv.includes("--quiet");
  const verbose = argv.includes("--verbose");

  const cwdIndex = argv.indexOf("--cwd");
  const cwdValue =
    cwdIndex >= 0 && cwdIndex + 1 < argv.length ? argv[cwdIndex + 1] : undefined;

  let level: LogLevel = "info";
  if (quiet) {
    level = "error";
  } else if (verbose) {
    level = "debug";
  }

  return { json, level, cwd: cwdValue };
}
