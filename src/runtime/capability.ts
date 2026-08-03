/**
 * The capability contract.
 *
 * A capability is a self-contained module that declares what it offers to the
 * runtime. Version 2 starts that declaration with commands; later milestones
 * add configuration, storage, events, jobs, routes, and pages to the same
 * shape. A capability never knows which surface is driving it, and the
 * runtime never knows what a capability does beyond what it declares here.
 *
 * See ADR 0016.
 */
import type { CommandDefinition } from "../engine/command.js";
import type { FieldSpec } from "../core/config/schema.js";
import type { JobDefinition } from "./jobs.js";
import type { ProviderDescriptor } from "../providers/types.js";

/**
 * Configuration fields a capability contributes, namespaced under its own
 * name. Empty string composes at the root — Engineering's backwards
 * compatibility concession, same as its empty `commandPrefix`. See ADR 0018.
 */
export interface CapabilityConfigSchema {
  readonly namespace: string;
  readonly fields: Readonly<Record<string, FieldSpec>>;
  readonly defaults: Readonly<Record<string, unknown>>;
}

export interface Capability {
  /** Stable identifier, e.g. `engineering`. Never shown to a user directly. */
  readonly id: string;
  /** One sentence, used by `orch capabilities` and nowhere else load bearing. */
  readonly summary: string;
  /**
   * Namespace prepended to every command this capability registers, e.g.
   * `home` turns a declared `status` command into `home status`.
   *
   * An empty string registers commands under their bare name. That is a
   * backwards-compatibility concession for the one capability that predates
   * this model; new capabilities declare a real prefix. See ADR 0016.
   */
  readonly commandPrefix: string;
  /** Commands this capability contributes to the registry. */
  commands(): readonly CommandDefinition[];
  /**
   * Configuration fields this capability contributes, if any. A capability
   * with nothing to configure omits this entirely.
   */
  configSchema?(): CapabilityConfigSchema;
  /**
   * Directory namespace this capability's persistent state lives under,
   * relative to the active scope's state directory, e.g. `home` roots its
   * storage at `<stateDir>/home`. Empty string roots directly at the state
   * directory — Engineering's concession, same shape as its empty
   * `commandPrefix`. A capability with nothing to persist omits this.
   *
   * Kept independent of `commandPrefix` rather than reusing it: a future
   * capability could reasonably want bare top-level commands while still
   * wanting its files isolated from Engineering's `.orchestrai/memory`,
   * `.orchestrai/gates.json`, and so on, which sharing the empty prefix
   * would prevent. See ADR 0019.
   */
  readonly storageNamespace?: string;
  /**
   * Jobs this capability declares. A contract only — nothing runs them.
   * A capability with nothing to schedule omits this. See ADR 0020.
   */
  jobs?(): readonly JobDefinition[];
  /**
   * AI providers this capability contributes, beyond the built-in
   * `anthropic`/`openai`/`mock` three. A capability with nothing new to add
   * omits this. See ADR 0020.
   */
  providers?(): readonly ProviderDescriptor[];
}

/**
 * Applies a capability's declared prefix to one of its command names. The
 * runtime calls this once per command during activation; nothing else needs
 * to reimplement the rule.
 */
export function prefixedCommandName(
  capability: Pick<Capability, "commandPrefix">,
  name: string,
): string {
  return capability.commandPrefix === "" ? name : `${capability.commandPrefix} ${name}`;
}
