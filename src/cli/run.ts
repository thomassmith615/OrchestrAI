/**
 * CLI execution boundary.
 *
 * Resolves the workspace and configuration once, then translates thrown values
 * and command results into exit codes. Nothing above this layer calls
 * `process.exit`.
 */
import { createProgram } from "./program.js";
import { buildBaseContext } from "./context.js";
import { readGlobalFlags } from "./globals.js";
import {
  EXIT_CODES,
  describeError,
  errorToJson,
  isOrchestraiError,
} from "../core/errors.js";
import { createLogger } from "../core/logger.js";
import { nodeHosts } from "../core/hosts.js";
import { createRegistry } from "../engine/index.js";
import type { Hosts } from "../core/hosts.js";
import type { CommandRegistry } from "../engine/registry.js";
import type { ExitCode } from "../core/errors.js";
import type { Logger } from "../core/logger.js";

export interface RunOptions {
  /** Arguments as typed by the user, excluding node and the script path. */
  readonly argv: readonly string[];
  readonly logger?: Logger;
  readonly registry?: CommandRegistry;
  readonly hosts?: Hosts;
  readonly cwd?: string;
}

interface CommanderExitError {
  readonly exitCode: number;
  readonly code: string;
}

function isCommanderExitError(value: unknown): value is CommanderExitError {
  if (!(value instanceof Error)) {
    return false;
  }

  const candidate = value as Error & Partial<CommanderExitError>;

  return (
    typeof candidate.exitCode === "number" &&
    typeof candidate.code === "string" &&
    candidate.code.startsWith("commander.")
  );
}

export async function run(options: RunOptions): Promise<ExitCode> {
  const flags = readGlobalFlags(options.argv);
  const hosts = options.hosts ?? nodeHosts();
  const registry = options.registry ?? createRegistry();
  const cwd = flags.cwd ?? options.cwd ?? process.cwd();

  const base = buildBaseContext(cwd, hosts, flags.overrides);

  // Flags beat configuration, which beats the built-in default.
  const level = flags.level ?? base.config?.values.logLevel ?? "info";
  const logger = options.logger ?? createLogger({ level });

  let exitCode: ExitCode = EXIT_CODES.success;

  const program = createProgram({
    registry,
    logger,
    flags,
    base,
    onExitCode: (code: ExitCode): void => {
      exitCode = code;
    },
  });
  program.exitOverride();

  try {
    await program.parseAsync([...options.argv], { from: "user" });
    return exitCode;
  } catch (error: unknown) {
    if (isCommanderExitError(error)) {
      // `--help` and `--version` are reported as exits by commander.
      return error.exitCode === 0 ? EXIT_CODES.success : EXIT_CODES.usage;
    }

    if (flags.json) {
      logger.printError(JSON.stringify(errorToJson(error), null, 2));
    } else {
      logger.error(describeError(error));
    }

    return isOrchestraiError(error) ? error.exitCode : EXIT_CODES.failure;
  }
}
