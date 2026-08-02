import { describe, expect, it } from "vitest";
import { createLogger, isLogLevel } from "../../src/core/logger.js";
import type { LogSink } from "../../src/core/logger.js";

function recordingSink(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write(line: string): void {
      lines.push(line);
    },
  };
}

describe("createLogger", () => {
  it("routes messages to the correct stream", () => {
    const out = recordingSink();
    const err = recordingSink();
    const logger = createLogger({ level: "debug", out, err });

    logger.print("plain");
    logger.info("informational");
    logger.warn("careful");
    logger.error("broken");
    logger.debug("details");

    expect(out.lines).toEqual(["plain", "informational"]);
    expect(err.lines).toEqual(["warn: careful", "error: broken", "debug: details"]);
  });

  it("writes verbatim lines to both streams", () => {
    const out = recordingSink();
    const err = recordingSink();
    const logger = createLogger({ level: "info", out, err });

    logger.print("to stdout");
    logger.printError("to stderr");

    expect(out.lines).toEqual(["to stdout"]);
    expect(err.lines).toEqual(["to stderr"]);
  });

  it("suppresses messages below the configured level", () => {
    const out = recordingSink();
    const err = recordingSink();
    const logger = createLogger({ level: "warn", out, err });

    logger.info("hidden");
    logger.debug("hidden");
    logger.warn("shown");

    expect(out.lines).toEqual([]);
    expect(err.lines).toEqual(["warn: shown"]);
  });

  it("silences everything at the silent level", () => {
    const out = recordingSink();
    const err = recordingSink();
    const logger = createLogger({ level: "silent", out, err });

    logger.print("nothing");
    logger.printError("nothing");
    logger.error("nothing");

    expect(out.lines).toEqual([]);
    expect(err.lines).toEqual([]);
  });

  it("defaults to the info level", () => {
    expect(createLogger().level).toBe("info");
  });

  it("validates log level strings", () => {
    expect(isLogLevel("debug")).toBe(true);
    expect(isLogLevel("chatty")).toBe(false);
  });
});
