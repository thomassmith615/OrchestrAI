import { describe, expect, it } from "vitest";
import {
  composeConfigSchemas,
  namespacedFieldKey,
  namespacedFieldKeys,
} from "../../src/runtime/config.js";
import { engineeringCapability } from "../../src/capabilities/engineering/index.js";
import { CONFIG_FIELDS, DEFAULT_CONFIG } from "../../src/core/config/schema.js";
import type { Capability, CapabilityConfigSchema } from "../../src/runtime/capability.js";

function stubCapability(schema: CapabilityConfigSchema, id = "stub"): Capability {
  return {
    id,
    summary: "A stub capability",
    commandPrefix: id,
    commands: () => [],
    configSchema: () => schema,
  };
}

describe("namespacedFieldKey", () => {
  it("leaves the key unchanged for an empty namespace", () => {
    expect(namespacedFieldKey("", "provider")).toBe("provider");
  });

  it("prepends a declared namespace with a dot", () => {
    expect(namespacedFieldKey("home", "token")).toBe("home.token");
  });
});

describe("namespacedFieldKeys", () => {
  it("namespaces every field a schema declares", () => {
    const schema: CapabilityConfigSchema = {
      namespace: "home",
      fields: { token: { kind: "string", env: "ORCH_HOME_TOKEN", description: "d" } },
      defaults: { token: "" },
    };

    expect(namespacedFieldKeys(schema)).toEqual(["home.token"]);
  });
});

describe("composeConfigSchemas", () => {
  it("returns an empty table for capabilities with no config", () => {
    const none: Capability = {
      id: "none",
      summary: "No configuration",
      commandPrefix: "none",
      commands: () => [],
    };

    expect(composeConfigSchemas([none])).toEqual({ fields: {}, defaults: {} });
  });

  it("composes Engineering's own table unchanged, at the root namespace", () => {
    const composed = composeConfigSchemas([engineeringCapability]);

    expect(composed.fields).toEqual(CONFIG_FIELDS);
    expect(composed.defaults).toEqual(DEFAULT_CONFIG);
  });

  it("namespaces a second capability's fields alongside Engineering's, without collision", () => {
    // This is the config equivalent of the command activation test: if the
    // composition ever special-cased Engineering, a second capability's
    // fields would either collide with or fail to reach their own namespace.
    const second = stubCapability({
      namespace: "second",
      fields: { token: { kind: "string", env: "ORCH_SECOND_TOKEN", description: "d" } },
      defaults: { token: "default-token" },
    });

    const composed = composeConfigSchemas([engineeringCapability, second]);

    for (const key of Object.keys(CONFIG_FIELDS)) {
      expect(composed.fields[key]).toEqual(CONFIG_FIELDS[key as keyof typeof CONFIG_FIELDS]);
    }
    expect(composed.fields["second.token"]).toEqual({
      kind: "string",
      env: "ORCH_SECOND_TOKEN",
      description: "d",
    });
    expect(composed.defaults["second.token"]).toBe("default-token");
    expect(composed.fields["token"]).toBeUndefined();
  });

  it("throws when two capabilities declare the same namespaced field", () => {
    const first = stubCapability(
      {
        namespace: "shared",
        fields: { key: { kind: "string", env: "A", description: "d" } },
        defaults: { key: "a" },
      },
      "first",
    );
    const second = stubCapability(
      {
        namespace: "shared",
        fields: { key: { kind: "string", env: "B", description: "d" } },
        defaults: { key: "b" },
      },
      "second",
    );

    expect(() => composeConfigSchemas([first, second])).toThrow(
      /Config field already declared: shared\.key/,
    );
  });
});
