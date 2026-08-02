/**
 * Capability registry.
 *
 * Mirrors `engine/registry.ts`: a plain map keyed by identity, kept only so
 * something can ask what is registered. All of the interesting behaviour is
 * in activation, not here.
 */
import { OrchestraiError } from "../core/errors.js";
import type { Capability } from "./capability.js";

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  register(capability: Capability): this {
    if (this.capabilities.has(capability.id)) {
      throw new OrchestraiError(
        `Capability already registered: ${capability.id}`,
        { code: "runtime.duplicate_capability" },
      );
    }
    this.capabilities.set(capability.id, capability);
    return this;
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  /** All registered capabilities, sorted by id for stable output. */
  list(): readonly Capability[] {
    return [...this.capabilities.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
