/**
 * Config field composition.
 *
 * Mirrors `activate.ts`: every capability's declared config fields go
 * through the same namespacing rule commands already use, just with `.`
 * instead of a space, which is the idiomatic separator for a config key
 * rather than a CLI invocation.
 *
 * `resolveConfig` (`src/core/config/resolve.ts`) still resolves only against
 * `CONFIG_FIELDS`/`DEFAULT_CONFIG` — Engineering's own table — directly.
 * Wiring it to a composed table is deferred to whichever milestone gives a
 * second capability real fields to resolve. See ADR 0018.
 */
import { OrchestraiError } from "../core/errors.js";
import type { FieldSpec } from "../core/config/schema.js";
import type { Capability, CapabilityConfigSchema } from "./capability.js";

/** Applies a capability's declared namespace to one of its field names. */
export function namespacedFieldKey(namespace: string, field: string): string {
  return namespace === "" ? field : `${namespace}.${field}`;
}

export interface ComposedConfigSchema {
  readonly fields: Readonly<Record<string, FieldSpec>>;
  readonly defaults: Readonly<Record<string, unknown>>;
}

/** The namespaced key every field in `schema` composes to. Used for
 *  reporting a single capability's contribution; see `composeConfigSchemas`
 *  for the merged, collision-checked table across several capabilities. */
export function namespacedFieldKeys(
  schema: CapabilityConfigSchema,
): readonly string[] {
  return Object.keys(schema.fields).map((name) =>
    namespacedFieldKey(schema.namespace, name),
  );
}

/**
 * Merges every capability's declared config fields into one flat table,
 * namespaced the same way `activateCapabilities` namespaces command names.
 * Throws if two capabilities declare the same namespace and field name —
 * the config equivalent of a duplicate command registration.
 */
export function composeConfigSchemas(
  capabilities: readonly Capability[],
): ComposedConfigSchema {
  const fields: Record<string, FieldSpec> = {};
  const defaults: Record<string, unknown> = {};

  for (const capability of capabilities) {
    const schema = capability.configSchema?.();
    if (schema === undefined) {
      continue;
    }

    for (const [name, spec] of Object.entries(schema.fields)) {
      const key = namespacedFieldKey(schema.namespace, name);
      if (Object.hasOwn(fields, key)) {
        throw new OrchestraiError(`Config field already declared: ${key}`, {
          code: "runtime.duplicate_config_field",
        });
      }
      fields[key] = spec;
      defaults[key] = schema.defaults[name];
    }
  }

  return { fields, defaults };
}
