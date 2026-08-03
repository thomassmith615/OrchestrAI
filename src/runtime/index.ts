/**
 * The runtime: capability contract, registration, activation.
 *
 * This module may not import anything under `src/capabilities`. It hosts
 * capabilities without knowing which ones exist; the composition root that
 * names them lives one layer up, in `src/capabilities/index.ts`. See ADR 0016.
 */
export { prefixedCommandName } from "./capability.js";
export { CapabilityRegistry } from "./registry.js";
export { activateCapabilities } from "./activate.js";
export { buildCapabilitiesCommand } from "./command.js";
export {
  composeConfigSchemas,
  namespacedFieldKey,
  namespacedFieldKeys,
} from "./config.js";
export {
  createCapabilityStorage,
  StorageContainmentError,
  storageRoot,
} from "./storage.js";
export { EventBus } from "./events.js";
export { composeProviders } from "./providers.js";
export type { Capability, CapabilityConfigSchema } from "./capability.js";
export type {
  ActivationResult,
  CapabilityActivation,
  CapabilityFailure,
} from "./activate.js";
export type { CapabilitiesData } from "./command.js";
export type { ComposedConfigSchema } from "./config.js";
export type { CapabilityStorage } from "./storage.js";
export type { EventBusOptions, EventHandler } from "./events.js";
export type { JobContext, JobDefinition } from "./jobs.js";
