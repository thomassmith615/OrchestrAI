import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRegistry } from "../../src/engine/index.js";
import type { CommandDefinition } from "../../src/engine/command.js";

/**
 * A structural guard, not a unit test.
 *
 * Registering a command is a second edit in a second file, and a command that
 * is written but never registered type checks, lints, and passes every test
 * that does not import it. This walks the command directory and asserts that
 * every exported definition actually reached the registry.
 */
const COMMANDS_DIR = new URL("../../src/engine/commands/", import.meta.url)
  .pathname;

function isCommandDefinition(value: unknown): value is CommandDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CommandDefinition>;

  return (
    typeof candidate.name === "string" &&
    typeof candidate.summary === "string" &&
    typeof candidate.execute === "function"
  );
}

async function exportedCommandNames(): Promise<readonly string[]> {
  const files = readdirSync(COMMANDS_DIR).filter((name) => name.endsWith(".ts"));
  const names = new Set<string>();

  for (const file of files) {
    const imported: unknown = await import(join(COMMANDS_DIR, file));
    const module = imported as Record<string, unknown>;

    for (const value of Object.values(module)) {
      if (isCommandDefinition(value)) {
        names.add(value.name);
      }
    }
  }

  return [...names].sort();
}

describe("command registration", () => {
  it("registers every command definition that exists", async () => {
    const declared = await exportedCommandNames();
    const registered = createRegistry()
      .list()
      .map((command) => command.name)
      .sort();

    const missing = declared.filter((name) => !registered.includes(name));

    expect(missing).toEqual([]);
    expect(registered).toEqual(declared);
  });

  it("finds a non-trivial number of commands", async () => {
    // Guards against the walk silently matching nothing.
    expect((await exportedCommandNames()).length).toBeGreaterThan(10);
  });
});
