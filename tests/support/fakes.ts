/**
 * In-memory doubles for the injectable hosts, so tests never touch disk,
 * spawn a process, or read the real environment.
 */
import { dirname } from "node:path";
import { createLogger } from "../../src/core/logger.js";
import type { EnvHost, FileSystemHost, Hosts, ProcessHost, ProcessResult } from "../../src/core/hosts.js";
import type { CommandContext } from "../../src/engine/command.js";
import type { LogSink } from "../../src/core/logger.js";

export interface FakeFileSystem extends FileSystemHost {
  readonly files: Map<string, string>;
  readonly dirs: Set<string>;
}

export function fakeFileSystem(
  seed: Readonly<Record<string, string>> = {},
): FakeFileSystem {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();

  for (const path of files.keys()) {
    dirs.add(dirname(path));
  }

  return {
    files,
    dirs,
    exists: (path: string): boolean => files.has(path) || dirs.has(path),
    readFile: (path: string): string => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return content;
    },
    writeFile: (path: string, content: string): void => {
      files.set(path, content);
      dirs.add(dirname(path));
    },
    mkdir: (path: string): void => {
      dirs.add(path);
    },
  };
}

export function fakeProcess(result: Partial<ProcessResult> = {}): ProcessHost {
  return {
    run: (): ProcessResult => ({
      ok: result.ok ?? true,
      stdout: result.stdout ?? "git version 2.44.0",
      stderr: result.stderr ?? "",
    }),
  };
}

export function fakeHosts(
  overrides: {
    fs?: FileSystemHost;
    proc?: ProcessHost;
    env?: EnvHost;
  } = {},
): Hosts {
  return {
    fs: overrides.fs ?? fakeFileSystem(),
    proc: overrides.proc ?? fakeProcess(),
    env: overrides.env ?? {},
  };
}

export interface RecordingSink extends LogSink {
  readonly lines: string[];
  text(): string;
}

export function recordingSink(): RecordingSink {
  const lines: string[] = [];
  return {
    lines,
    write(line: string): void {
      lines.push(line);
    },
    text(): string {
      return lines.join("\n");
    },
  };
}

/** Builds a command context with every field defaulted. */
export function fakeContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    cwd: "/repo",
    logger: createLogger({ level: "silent" }),
    options: {},
    args: [],
    hosts: fakeHosts(),
    workspace: null,
    config: null,
    configError: undefined,
    ...overrides,
  };
}
