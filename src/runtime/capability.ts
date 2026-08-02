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
