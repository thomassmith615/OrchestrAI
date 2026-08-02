import { describe, expect, it } from "vitest";
import { readGlobalFlags } from "../../src/cli/globals.js";

describe("readGlobalFlags", () => {
  it("defaults to human output at the info level", () => {
    expect(readGlobalFlags(["info"])).toEqual({
      json: false,
      level: "info",
      cwd: undefined,
    });
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
