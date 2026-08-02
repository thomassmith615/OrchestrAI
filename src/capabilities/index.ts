/**
 * Composition root for first-party capabilities.
 *
 * This is the one place allowed to name a capability. `src/runtime` and
 * `src/core` never do; see ADR 0016. Surfaces that want the default runtime
 * call `assembleRuntime()` here rather than reaching into an individual
 * capability module.
 */
import { CommandRegistry } from "../engine/registry.js";
import { activateCapabilities, buildCapabilitiesCommand } from "../runtime/index.js";
import { engineeringCapability } from "./engineering/index.js";
import type { ActivationResult, Capability } from "../runtime/index.js";

export const defaultCapabilities: readonly Capability[] = [engineeringCapability];

export interface RuntimeAssembly {
  readonly registry: CommandRegistry;
  readonly activation: ActivationResult;
}

/**
 * Activates `capabilities` (the default set, unless told otherwise) into a
 * fresh registry, then adds the runtime's own `capabilities` introspection
 * command. Callers that need a registry without the runtime's involvement
 * still have `createRegistry()` for that.
 */
export function assembleRuntime(
  capabilities: readonly Capability[] = defaultCapabilities,
): RuntimeAssembly {
  const registry = new CommandRegistry();
  const activation = activateCapabilities(capabilities, registry);
  registry.register(buildCapabilitiesCommand(activation));
  return { registry, activation };
}

export { engineeringCapability } from "./engineering/index.js";
