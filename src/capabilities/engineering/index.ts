/**
 * Engineering: the first capability, and the whole of Orchestraᵢ v1.
 *
 * Its implementation did not move. `createRegistry()` in `src/engine` is
 * still where the 27 v1 commands are aggregated; this module wraps that
 * aggregation as a `Capability` rather than duplicating the list, so the two
 * can never drift apart. Nothing was relocated, because proving the seam
 * matters more than tidiness, and a file move can happen later, or never.
 *
 * Its empty command prefix is a backwards-compatibility concession: every
 * v1 invocation (`orch status`, `orch next`, ...) must keep working
 * unchanged. New capabilities declare a real prefix. See ADR 0016.
 *
 * Its config namespace is the same concession, applied to configuration:
 * empty, so `orchestrai.config.json`'s existing keys (`provider`, `model`,
 * ...) are unaffected. See ADR 0018.
 */
import { createRegistry } from "../../engine/index.js";
import { ENGINEERING_CONFIG_TABLE } from "../../core/config/schema.js";
import type { CommandDefinition } from "../../engine/command.js";
import type { Capability, CapabilityConfigSchema } from "../../runtime/capability.js";

export const engineeringCapability: Capability = {
  id: "engineering",
  summary:
    "Repository understanding, providers, verification gates, proposals, and the workflow engine: everything Orchestraᵢ v1 did.",
  commandPrefix: "",
  commands(): readonly CommandDefinition[] {
    return createRegistry().list();
  },
  configSchema(): CapabilityConfigSchema {
    return { namespace: "", ...ENGINEERING_CONFIG_TABLE };
  },
};
