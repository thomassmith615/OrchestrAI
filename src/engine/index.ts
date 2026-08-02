/**
 * The orchestration engine.
 *
 * Surfaces construct a registry and drive it. They do not reach past this
 * module into individual command implementations.
 */
import { CommandRegistry } from "./registry.js";
import { buildCommand, testCommand } from "./commands/gates.js";
import { configCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { infoCommand } from "./commands/info.js";
import { initCommand } from "./commands/init.js";
import { providerAddCommand } from "./commands/provider-add.js";
import { providersCommand } from "./commands/providers.js";
import { statusCommand } from "./commands/status.js";

export function createRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register(buildCommand);
  registry.register(configCommand);
  registry.register(doctorCommand);
  registry.register(infoCommand);
  registry.register(initCommand);
  registry.register(providerAddCommand);
  registry.register(providersCommand);
  registry.register(statusCommand);
  registry.register(testCommand);

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
