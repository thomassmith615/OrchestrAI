/**
 * Provider composition.
 *
 * Unlike config fields or storage, provider ids are a genuinely shared, flat
 * namespace by design — `orch provider add anthropic` and `provider:
 * "anthropic"` in configuration both address one global vocabulary, the same
 * way two capabilities share one npm registry namespace. So unlike
 * `composeConfigSchemas`, this does not prefix anything; it merges declared
 * descriptors into the existing built-in list and rejects a duplicate id,
 * whether the collision is with a built-in or with another capability's.
 *
 * `src/providers/index.ts` (`listProviders`, `createProvider`, ...) is
 * untouched by this: it is still the closed, built-in three, and still what
 * `orch providers` and `orch provider add` consult. This composition exists
 * and is proven correct, without a live consumer yet.
 *
 * Engineering does not declare a `providers()` method: unlike commands,
 * config, and storage, the built-in providers were never capability-mediated
 * even before this milestone — `createProvider` is called directly by
 * command implementations, with no relationship to capability activation.
 * There is nothing for Engineering to "wrap" here; the built-in three simply
 * are the default `builtins`. See ADR 0020.
 */
import { listProviders } from "../providers/index.js";
import { OrchestraiError } from "../core/errors.js";
import type { ProviderDescriptor } from "../providers/types.js";
import type { Capability } from "./capability.js";

/**
 * Merges every capability's declared providers with the built-in set,
 * throwing on a duplicate id — whether the collision is with a built-in or
 * with another capability's. `builtins` defaults to `listProviders()`
 * (anthropic, openai, mock).
 */
export function composeProviders(
  capabilities: readonly Capability[],
  builtins: readonly ProviderDescriptor[] = listProviders(),
): readonly ProviderDescriptor[] {
  const byId = new Map<string, ProviderDescriptor>();

  for (const descriptor of builtins) {
    byId.set(descriptor.id, descriptor);
  }

  for (const capability of capabilities) {
    for (const descriptor of capability.providers?.() ?? []) {
      if (byId.has(descriptor.id)) {
        throw new OrchestraiError(`Provider already declared: ${descriptor.id}`, {
          code: "runtime.duplicate_provider",
        });
      }
      byId.set(descriptor.id, descriptor);
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
