import { describe, expect, it } from "vitest";
import { engineeringCapability } from "../../src/capabilities/engineering/index.js";
import { createRegistry } from "../../src/engine/index.js";
import { CONFIG_FIELDS, DEFAULT_CONFIG } from "../../src/core/config/schema.js";
import { storageRoot } from "../../src/runtime/storage.js";
import type { RepositoryScope } from "../../src/core/workspace.js";

describe("engineeringCapability", () => {
  it("declares an empty command prefix, a backwards-compatibility concession", () => {
    expect(engineeringCapability.commandPrefix).toBe("");
    expect(engineeringCapability.id).toBe("engineering");
  });

  it("contributes exactly the v1 command list, unprefixed", () => {
    const fromCapability = engineeringCapability.commands().map((command) => command.name).sort();
    const fromCreateRegistry = createRegistry().list().map((command) => command.name).sort();

    expect(fromCapability).toEqual(fromCreateRegistry);
  });

  it("declares an empty config namespace, the same concession applied to configuration", () => {
    const schema = engineeringCapability.configSchema?.();

    expect(schema?.namespace).toBe("");
    expect(schema?.fields).toEqual(CONFIG_FIELDS);
    expect(schema?.defaults).toEqual(DEFAULT_CONFIG);
  });

  it("declares an empty storage namespace, resolving to .orchestrai/ itself", () => {
    const scope: RepositoryScope = {
      kind: "repository",
      workspace: {
        root: "/repo",
        stateDir: "/repo/.orchestrai",
        configPath: "/repo/orchestrai.config.json",
        initialized: true,
      },
    };

    expect(engineeringCapability.storageNamespace).toBe("");
    expect(storageRoot(scope, engineeringCapability.storageNamespace ?? "")).toBe(
      scope.workspace.stateDir,
    );
  });
});
