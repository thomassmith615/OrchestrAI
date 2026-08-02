/**
 * The orchestration engine.
 *
 * Surfaces construct a registry and drive it. They do not reach past this
 * module into individual command implementations.
 */
import { CommandRegistry } from "./registry.js";
import { configCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { infoCommand } from "./commands/info.js";
import { initCommand } from "./commands/init.js";

export function createRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register(configCommand);
  registry.register(doctorCommand);
  registry.register(infoCommand);
  registry.register(initCommand);

  return registry;
}

export { CommandRegistry } from "./registry.js";
export { ok, requireConfig, requireWorkspace } from "./command.js";
export type {
  CommandArgument,
  CommandContext,
  CommandDefinition,
  CommandOption,
  CommandRequirements,
  CommandResult,
  FieldStatus,
  Report,
  ReportField,
} from "./command.js";
