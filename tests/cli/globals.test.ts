import { describe, expect, it } from "vitest";
import { readGlobalFlags } from "../../src/cli/globals.js";

describe("readGlobalFlags", () => {
  it("leaves the level unset so configuration can supply it", () => {
    expect(readGlobalFlags(["info"])).toEqual({
      json: false,
      level: undefined,
      cwd: undefined,
      overrides: [],
    });
  });

  it("collects repeated --set overrides", () => {
    expect(
      readGlobalFlags(["config", "--set", "provider=openai", "--set", "model=x"])
        .overrides,
    ).toEqual(["provider=openai", "model=x"]);
  });

  it("detects flags after the command name", () => {
    expect(readGlobalFlags(["status", "--json"]).json).toBe(true);
  });

  it("maps quiet and verbose to log levels", () => {
    expect(readGlobalFlags(["info", "--quiet"]).level).toBe("error");
    expect(readGlobalFlags(["info", "--verbose"]).level).toBe("debug");
  });

  it("prefers quiet when both are supplied", () => {
    expect(readGlobalFlags(["info", "--quiet", "--verbose"]).level).toBe("error");
  });

  it("reads the cwd value", () => {
    expect(readGlobalFlags(["info", "--cwd", "/tmp/repo"]).cwd).toBe("/tmp/repo");
    expect(readGlobalFlags(["info", "--cwd"]).cwd).toBeUndefined();
  });
});
