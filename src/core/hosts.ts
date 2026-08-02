/**
 * Injectable access to the outside world.
 *
 * Every filesystem read, subprocess call, and environment lookup passes
 * through one of these interfaces so that commands are testable without
 * touching the machine they run on. See ADR 0003.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export interface FileSystemHost {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  /** Creates the directory and any missing parents. */
  mkdir(path: string): void;
}

export interface ProcessResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessHost {
  /** Runs a command without a shell. Never throws on a non-zero exit. */
  run(command: string, args: readonly string[], cwd: string): ProcessResult;
}

export type EnvHost = Readonly<Record<string, string | undefined>>;

export interface Hosts {
  readonly fs: FileSystemHost;
  readonly proc: ProcessHost;
  readonly env: EnvHost;
}

export const nodeFileSystem: FileSystemHost = {
  exists: (path: string): boolean => existsSync(path),
  readFile: (path: string): string => readFileSync(path, "utf8"),
  writeFile: (path: string, content: string): void => {
    writeFileSync(path, content, "utf8");
  },
  mkdir: (path: string): void => {
    mkdirSync(path, { recursive: true });
  },
};

export const nodeProcessHost: ProcessHost = {
  run(command: string, args: readonly string[], cwd: string): ProcessResult {
    const result = spawnSync(command, [...args], {
      cwd,
      encoding: "utf8",
      shell: false,
    });

    return {
      ok: result.error === undefined && result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  },
};

export function nodeHosts(): Hosts {
  return { fs: nodeFileSystem, proc: nodeProcessHost, env: process.env };
}
