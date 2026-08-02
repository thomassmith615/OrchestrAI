import { describe, expect, it } from "vitest";
import { grantHosts, isPlugin, loadPlugins, PERMISSIONS } from "../../src/plugins/index.js";
import { createLogger } from "../../src/core/logger.js";
import { fakeFileSystem, fakeHosts } from "../support/fakes.js";
import type { Plugin } from "../../src/plugins/index.js";
import type { LoadResult } from "../../src/plugins/index.js";

function plugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "example",
    version: "1.0.0",
    permissions: [],
    ...overrides,
  };
}

async function load(
  modules: Record<string, unknown>,
  specifiers: readonly string[] = Object.keys(modules),
): Promise<LoadResult> {
  return loadPlugins({
    root: "/repo",
    specifiers,
    hosts: fakeHosts({ fs: fakeFileSystem({ "/repo/a.ts": "x" }) }),
    logger: createLogger({ level: "silent" }),
    load: (specifier) => {
      const found = modules[specifier];
      return found === undefined
        ? Promise.reject(new Error(`Cannot find module ${specifier}`))
        : Promise.resolve(found);
    },
  });
}

describe("isPlugin", () => {
  it("accepts a well formed plugin", () => {
    expect(isPlugin(plugin({ permissions: ["read-repo"] }))).toBe(true);
  });

  it("rejects unknown permissions and malformed objects", () => {
    expect(isPlugin({ ...plugin(), permissions: ["root"] })).toBe(false);
    expect(isPlugin({ name: "x" })).toBe(false);
    expect(isPlugin(null)).toBe(false);
  });
});

describe("loadPlugins", () => {
  it("loads a default export and calls setup once", async () => {
    let setups = 0;
    const result = await load({
      "/repo/a.js": { default: plugin({ setup: () => void (setups += 1) }) },
    }, ["./a.js"]);

    expect(result.loaded.map((entry) => entry.plugin.name)).toEqual(["example"]);
    expect(result.failed).toEqual([]);
    expect(setups).toBe(1);
  });

  it("accepts a named `plugin` export as well", async () => {
    const result = await load({ pkg: { plugin: plugin() } }, ["pkg"]);

    expect(result.loaded).toHaveLength(1);
  });

  it("reports a module that is not a plugin instead of throwing", async () => {
    const result = await load({ pkg: { default: { nope: true } } }, ["pkg"]);

    expect(result.loaded).toEqual([]);
    expect(result.failed[0]?.reason).toContain("plugin contract");
  });

  it("reports a missing module and keeps loading the rest", async () => {
    const result = await load(
      { good: { default: plugin({ name: "good" }) } },
      ["missing", "good"],
    );

    expect(result.failed[0]?.specifier).toBe("missing");
    expect(result.loaded.map((entry) => entry.plugin.name)).toEqual(["good"]);
  });

  it("reports a failing setup rather than aborting", async () => {
    const result = await load({
      bad: {
        default: plugin({
          setup: () => {
            throw new Error("setup exploded");
          },
        }),
      },
    }, ["bad"]);

    expect(result.failed[0]?.reason).toBe("setup exploded");
  });

  it("refuses two plugins with the same name", async () => {
    const result = await load(
      { one: { default: plugin() }, two: { default: plugin() } },
      ["one", "two"],
    );

    expect(result.loaded).toHaveLength(1);
    expect(result.failed[0]?.reason).toContain("already loaded");
  });
});

describe("grantHosts", () => {
  const hosts = fakeHosts({ fs: fakeFileSystem({ "/repo/a.ts": "x" }) });

  it("grants nothing beyond the clock by default", () => {
    const granted = grantHosts(hosts, []);

    expect(granted.fs).toBeUndefined();
    expect(granted.http).toBeUndefined();
    expect(granted.proc).toBeUndefined();
    expect(granted.clock).toBeDefined();
  });

  it("grants a read-only filesystem for read-repo", () => {
    const granted = grantHosts(hosts, ["read-repo"]);

    expect(granted.fs?.readFile("/repo/a.ts")).toBe("x");
    expect(() => granted.fs?.writeFile("/repo/a.ts", "y")).toThrow(
      /write-repo/,
    );
  });

  it("grants writes only for write-repo", () => {
    const granted = grantHosts(hosts, ["write-repo"]);

    expect(() => granted.fs?.writeFile("/repo/b.ts", "y")).not.toThrow();
  });

  it("grants network and process access only when asked", () => {
    expect(grantHosts(hosts, ["network"]).http).toBeDefined();
    expect(grantHosts(hosts, ["network"]).proc).toBeUndefined();
    expect(grantHosts(hosts, ["state"]).proc).toBeDefined();
  });

  it("covers every declared permission", () => {
    for (const permission of PERMISSIONS) {
      expect(() => grantHosts(hosts, [permission])).not.toThrow();
    }
  });
});
