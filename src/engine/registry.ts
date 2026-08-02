/**
 * Command registry.
 *
 * Surfaces ask the registry what exists rather than importing commands
 * individually. Adding a command in a later milestone means registering it
 * here and nowhere else.
 */
import { OrchestraiError } from "../core/errors.js";
import { attempt } from "./command.js";
import type { CommandContext, CommandDefinition, CommandResult } from "./command.js";

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): this {
    if (this.commands.has(definition.name)) {
      throw new OrchestraiError(
        `Command already registered: ${definition.name}`,
        { code: "engine.duplicate_command" },
      );
    }
    // Surfaces call `execute` directly, so the promise contract is enforced
    // here rather than trusted in every command.
    this.commands.set(definition.name, {
      ...definition,
      execute: (context: CommandContext): Promise<CommandResult> =>
        attempt(() => definition.execute(context)),
    });
    return this;
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /** All registered commands, sorted by name for stable help output. */
  list(): readonly CommandDefinition[] {
    return [...this.commands.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
}
