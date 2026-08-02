/**
 * The orchestration engine.
 *
 * Surfaces construct a registry and drive it. They do not reach past this
 * module into individual command implementations.
 */
import { CommandRegistry } from "./registry.js";
import { buildCommand, testCommand } from "./commands/gates.js";
import { configCommand } from "./commands/config.js";
import { contextCommand } from "./commands/context.js";
import { doctorCommand } from "./commands/doctor.js";
import { infoCommand } from "./commands/info.js";
import { milestoneCommand } from "./commands/milestone.js";
import { nextCommand } from "./commands/next.js";
import { roadmapCommand } from "./commands/roadmap.js";
import { initCommand } from "./commands/init.js";
import {
  proposeApplyCommand,
  proposeCommand,
  proposeListCommand,
  proposeRejectCommand,
  proposeShowCommand,
} from "./commands/propose.js";
import { providerAddCommand } from "./commands/provider-add.js";
import { reviewCommand } from "./commands/review.js";
import { providersCommand } from "./commands/providers.js";
import { statusCommand } from "./commands/status.js";

export function createRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register(buildCommand);
  registry.register(configCommand);
  registry.register(contextCommand);
  registry.register(doctorCommand);
  registry.register(infoCommand);
  registry.register(initCommand);
  registry.register(milestoneCommand);
  registry.register(nextCommand);
  registry.register(roadmapCommand);
  registry.register(providerAddCommand);
  registry.register(proposeCommand);
  registry.register(proposeApplyCommand);
  registry.register(proposeListCommand);
  registry.register(proposeRejectCommand);
  registry.register(proposeShowCommand);
  registry.register(providersCommand);
  registry.register(reviewCommand);
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
