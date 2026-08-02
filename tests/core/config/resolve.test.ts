import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  DEFAULT_CONFIG,
  parseOverrides,
  resolveConfig,
} from "../../../src/core/config/index.js";
import { fakeFileSystem } from "../../support/fakes.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";

function resolve(
  file: Record<string, unknown> | null,
  env: Record<string, string> = {},
  overrides: string[] = [],
): ReturnType<typeof resolveConfig> {
  const fs =
    file === null
      ? fakeFileSystem()
      : fakeFileSystem({ [CONFIG_PATH]: JSON.stringify(file) });

  return resolveConfig({ configPath: CONFIG_PATH, fs, env, overrides });
}

describe("resolveConfig", () => {
  it("falls back to defaults when no file exists", () => {
    const config = resolve(null);

    expect(config.values).toEqual(DEFAULT_CONFIG);
    expect(config.path).toBeNull();
    expect(config.sources.provider).toBe("default");
  });

  it("applies precedence of default, file, env, then flag", () => {
    const config = resolve(
      { provider: "openai", model: "from-file" },
      { ORCH_MODEL: "from-env" },
      ["model=from-flag"],
    );

    expect(config.values.provider).toBe("openai");
    expect(config.values.model).toBe("from-flag");
    expect(config.sources.provider).toBe("file");
    expect(config.sources.model).toBe("flag");
    expect(config.sources.roadmapPath).toBe("default");
  });

  it("coerces text values from the environment", () => {
    const config = resolve(null, {
      ORCH_IGNORE: "dist, coverage , ",
      ORCH_MODEL: "null",
    });

    expect(config.values.ignore).toEqual(["dist", "coverage"]);
    expect(config.values.model).toBeNull();
  });

  it("rejects unknown settings", () => {
    expect(() => resolve({ nope: true })).toThrow(ConfigurationError);
    expect(() => resolve(null, {}, ["nope=1"])).toThrow(/Unknown setting/);
  });

  it("rejects values of the wrong type", () => {
    expect(() => resolve({ provider: 42 })).toThrow(/non-empty string/);
    expect(() => resolve({ ignore: "dist" })).toThrow(/array of strings/);
    expect(() => resolve({ logLevel: "loud" })).toThrow(/must be one of/);
  });

  it("rejects malformed JSON with the configuration exit code", () => {
    const fs = fakeFileSystem({ [CONFIG_PATH]: "{ not json" });

    try {
      resolveConfig({ configPath: CONFIG_PATH, fs, env: {} });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).exitCode).toBe(5);
    }
  });
});

describe("parseOverrides", () => {
  it("rejects entries without a key", () => {
    expect(() => parseOverrides(["=value"])).toThrow(/Invalid override/);
    expect(() => parseOverrides(["novalue"])).toThrow(/Invalid override/);
  });

  it("keeps values containing an equals sign", () => {
    expect(parseOverrides(["model=a=b"]).get("model")).toBe("a=b");
  });
});
