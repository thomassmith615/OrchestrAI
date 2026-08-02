/**
 * The orchestration engine.
 *
 * Surfaces construct an engine and drive it. They do not reach past this
 * module into individual command implementations.
 */
import { CommandRegistry } from "./registry.js";
import { infoCommand } from "./commands/info.js";

export function createRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register(infoCommand);

  return registry;
}

export { CommandRegistry } from "./registry.js";
export { ok } from "./command.js";
export type {
  CommandArgument,
  CommandContext,
  CommandDefinition,
  CommandOption,
  CommandResult,
  FieldStatus,
  Report,
  ReportField,
} from "./command.js";
