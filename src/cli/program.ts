/**
 * Builds the `orch` command tree from the engine registry.
 *
 * The CLI is a client of the engine. This module contains adaptation logic
 * only: it translates neutral command definitions into commander commands and
 * translates results back into rendered output. No business logic lives here.
 */
import { Command } from "commander";
import { GLOBAL_OPTIONS } from "./globals.js";
import { enforceRequirements } from "./context.js";
import { render } from "./render.js";
import { EXIT_CODES } from "../core/errors.js";
import { packageDescription, packageVersion } from "../core/manifest.js";
import type { BaseContext } from "./context.js";
import type { GlobalFlags } from "./globals.js";
import type { CommandDefinition } from "../engine/command.js";
import type { CommandRegistry } from "../engine/registry.js";
import type { ExitCode } from "../core/errors.js";
import type { Logger } from "../core/logger.js";

export interface ProgramOptions {
  readonly registry: CommandRegistry;
  readonly logger: Logger;
  readonly flags: GlobalFlags;
  readonly base: BaseContext;
  /** Receives the exit code produced by a command result. */
  readonly onExitCode: (code: ExitCode) => void;
}

function applyGlobalOptions(command: Command): void {
  for (const option of GLOBAL_OPTIONS) {
    command.option(option.flags, option.description);
  }
}

function buildCommand(
  definition: CommandDefinition,
  options: ProgramOptions,
): Command {
  const command = new Command(definition.name).description(definition.summary);

  for (const argument of definition.args ?? []) {
    const token =
      argument.required === false ? `[${argument.name}]` : `<${argument.name}>`;
    command.argument(token, argument.description);
  }

  for (const option of definition.options ?? []) {
    command.option(option.flags, option.description);
  }

  applyGlobalOptions(command);

  command.action(async (...invocation: unknown[]): Promise<void> => {
    enforceRequirements(definition.requires, options.base);

    const positional = invocation.slice(0, definition.args?.length ?? 0);

    const result = await definition.execute({
      cwd: options.base.cwd,
      logger: options.logger,
      options: command.opts(),
      args: positional.map((value) => String(value)),
      hosts: options.base.hosts,
      workspace: options.base.workspace,
      config: options.base.config,
      configError: options.base.configError,
    });

    const output = render(result, options.flags.json);
    if (output.length > 0) {
      options.logger.print(output);
    }

    options.onExitCode(result.exitCode ?? EXIT_CODES.success);
  });

  return command;
}

export function createProgram(options: ProgramOptions): Command {
  const program = new Command();

  program
    .name("orch")
    .description(packageDescription())
    .version(packageVersion(), "-v, --version", "Print the Orchestrai version")
    .showHelpAfterError()
    .configureOutput({
      writeOut: (text: string): void => {
        options.logger.print(text.trimEnd());
      },
      // Commander formats its own `error:` prefix and help text.
      writeErr: (text: string): void => {
        options.logger.printError(text.trimEnd());
      },
    });

  applyGlobalOptions(program);

  for (const definition of options.registry.list()) {
    program.addCommand(buildCommand(definition, options));
  }

  return program;
}
