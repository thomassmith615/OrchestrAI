/**
 * Capability activation.
 *
 * The runtime's only job is lifecycle: register, activate, assemble, report.
 * This is the assemble-and-report half. Every capability goes through the
 * same loop, in the order it was given, differing only in the data it
 * declared. There is no branch on which capability is being activated, and
 * there must never be one. See ADR 0016.
 */
import { prefixedCommandName } from "./capability.js";
import type { Capability } from "./capability.js";
import type { CommandRegistry } from "../engine/registry.js";

/** One capability's contribution, after its commands were prefixed and registered. */
export interface CapabilityActivation {
  readonly id: string;
  readonly summary: string;
  readonly commandPrefix: string;
  readonly commands: readonly string[];
}

/** A capability that failed to activate. Reported, never fatal. */
export interface CapabilityFailure {
  readonly id: string;
  readonly reason: string;
}

export interface ActivationResult {
  readonly activated: readonly CapabilityActivation[];
  readonly failed: readonly CapabilityFailure[];
}

/**
 * Registers every capability's commands into `registry`, under its declared
 * prefix. A capability whose `commands()` throws, or whose commands collide
 * with one already registered, is recorded as failed rather than aborting
 * the rest — one broken capability must not stop the others, the same
 * tolerance the plugin loader already applies to plugins.
 */
export function activateCapabilities(
  capabilities: readonly Capability[],
  registry: CommandRegistry,
): ActivationResult {
  const activated: CapabilityActivation[] = [];
  const failed: CapabilityFailure[] = [];

  for (const capability of capabilities) {
    try {
      const names = capability.commands().map((command) => {
        const name = prefixedCommandName(capability, command.name);
        registry.register({ ...command, name });
        return name;
      });

      activated.push({
        id: capability.id,
        summary: capability.summary,
        commandPrefix: capability.commandPrefix,
        commands: names,
      });
    } catch (error: unknown) {
      failed.push({
        id: capability.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { activated, failed };
}
