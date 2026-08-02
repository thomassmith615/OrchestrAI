/**
 * Global flags.
 *
 * These are scanned before the command tree is built so that output format,
 * log level, and configuration overrides are settled before anything runs.
 * Commander still declares them so that they appear in help output and are
 * accepted anywhere on the line.
 */
import type { CommandOption } from "../engine/command.js";
import type { LogLevel } from "../core/logger.js";

export const GLOBAL_OPTIONS: readonly CommandOption[] = [
  { flags: "--json", description: "Emit machine readable JSON" },
  { flags: "--verbose", description: "Include debug output" },
  { flags: "--quiet", description: "Suppress all output except errors" },
  { flags: "--cwd <path>", description: "Directory to operate against" },
  {
    flags: "--set <key=value>",
    description: "Override a configuration value (repeatable)",
  },
];

export interface GlobalFlags {
  readonly json: boolean;
  /** Undefined when neither --quiet nor --verbose was supplied. */
  readonly level: LogLevel | undefined;
  readonly cwd: string | undefined;
  readonly overrides: readonly string[];
}

function readValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];

  argv.forEach((entry, index) => {
    if (entry === flag && index + 1 < argv.length) {
      const value = argv[index + 1];
      if (value !== undefined) {
        values.push(value);
      }
    }
  });

  return values;
}

/**
 * Reads global flags without consuming them, so commander still sees the full
 * argument list.
 */
export function readGlobalFlags(argv: readonly string[]): GlobalFlags {
  const quiet = argv.includes("--quiet");
  const verbose = argv.includes("--verbose");

  let level: LogLevel | undefined;
  if (quiet) {
    level = "error";
  } else if (verbose) {
    level = "debug";
  }

  return {
    json: argv.includes("--json"),
    level,
    cwd: readValues(argv, "--cwd")[0],
    overrides: readValues(argv, "--set"),
  };
}
