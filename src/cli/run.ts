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
import { assembleRuntime } from "../capabilities/index.js";
import { loadPlugins } from "../plugins/index.js";
import type { Hosts } from "../core/hosts.js";
import type { CommandRegistry } from "../engine/registry.js";
import type { ActivationResult } from "../runtime/index.js";
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

/**
 * A registry supplied by the caller (tests, embedders) bypasses the runtime
 * entirely. Otherwise the default capability set is activated fresh for this
 * invocation.
 */
function resolveRegistry(
  provided: CommandRegistry | undefined,
): { registry: CommandRegistry; failedCapabilities: ActivationResult["failed"] } {
  if (provided !== undefined) {
    return { registry: provided, failedCapabilities: [] };
  }

  const assembly = assembleRuntime();
  return { registry: assembly.registry, failedCapabilities: assembly.activation.failed };
}

export async function run(options: RunOptions): Promise<ExitCode> {
  const flags = readGlobalFlags(options.argv);
  const hosts = options.hosts ?? nodeHosts();
  const { registry, failedCapabilities } = resolveRegistry(options.registry);
  const cwd = flags.cwd ?? options.cwd ?? process.cwd();

  const base = buildBaseContext(cwd, hosts, flags.overrides);

  // Flags beat configuration, which beats the built-in default.
  const level = flags.level ?? base.config?.values.logLevel ?? "info";
  const logger = options.logger ?? createLogger({ level });

  // A capability that failed to activate is a warning, never fatal, the same
  // tolerance the plugin loader applies below.
  for (const failure of failedCapabilities) {
    logger.warn(`capability ${failure.id} failed to activate: ${failure.reason}`);
  }

  // Plugins are loaded only when configured, so an ordinary invocation pays
  // nothing for a feature it is not using.
  const specifiers = base.config?.values.plugins ?? [];
  if (specifiers.length > 0 && base.workspace !== null) {
    const result = await loadPlugins({
      root: base.workspace.root,
      specifiers,
      hosts,
      logger,
    });

    for (const failure of result.failed) {
      logger.warn(`plugin ${failure.specifier}: ${failure.reason}`);
    }

    for (const entry of result.loaded) {
      for (const command of entry.plugin.commands ?? []) {
        try {
          registry.register(command);
        } catch {
          logger.warn(
            `plugin ${entry.plugin.name}: command ${command.name} is already registered`,
          );
        }
      }
    }
  }

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
