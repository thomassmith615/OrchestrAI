/**
 * In-memory doubles for the injectable hosts, so tests never touch disk,
 * spawn a process, or read the real environment.
 */
import { dirname } from "node:path";
import { createLogger } from "../../src/core/logger.js";
import type {
  ClockHost,
  DirEntry,
  EnvHost,
  FileSystemHost,
  Hosts,
  HttpHost,
  HttpRequest,
  HttpResponse,
  ProcessHost,
  ProcessResult,
} from "../../src/core/hosts.js";
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

  // Walk all the way to the root. Stopping at the first known ancestor is
  // wrong: an immediate parent can be registered while its own parents are
  // not, which makes `exists` lie about intermediate directories.
  const registerAncestors = (path: string): void => {
    let parent = dirname(path);
    while (parent !== dirname(parent)) {
      dirs.add(parent);
      parent = dirname(parent);
    }
  };

  for (const path of files.keys()) {
    registerAncestors(path);
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
      registerAncestors(path);
    },
    mkdir: (path: string): void => {
      dirs.add(path);
      registerAncestors(`${path}/x`);
    },
    readDir: (path: string): readonly DirEntry[] => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const seen = new Map<string, boolean>();

      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) {
          continue;
        }
        const rest = file.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) {
          seen.set(rest, false);
        } else {
          seen.set(rest.slice(0, slash), true);
        }
      }

      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) {
          continue;
        }
        const rest = dir.slice(prefix.length);
        const slash = rest.indexOf("/");
        seen.set(slash < 0 ? rest : rest.slice(0, slash), true);
      }

      return [...seen.entries()].map(([name, isDirectory]) => ({
        name,
        isDirectory,
      }));
    },
    size: (path: string): number => Buffer.byteLength(files.get(path) ?? "", "utf8"),
  };
}

export interface FakeProcessCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface FakeProcess extends ProcessHost {
  readonly calls: FakeProcessCall[];
}

/**
 * Serves canned results. `responses` is keyed by the full command line so a
 * single fake can answer several different invocations.
 */
export function fakeProcess(
  result: Partial<ProcessResult> = {},
  responses: Readonly<Record<string, Partial<ProcessResult>>> = {},
): FakeProcess {
  const calls: FakeProcessCall[] = [];

  const build = (partial: Partial<ProcessResult>): ProcessResult => ({
    ok: partial.ok ?? (partial.code ?? 0) === 0,
    code: partial.code ?? (partial.ok === false ? 1 : 0),
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? "",
    timedOut: partial.timedOut ?? false,
  });

  return {
    calls,
    run: (
      command: string,
      args: readonly string[],
      cwd: string,
    ): ProcessResult => {
      calls.push({ command, args, cwd });
      const line = [command, ...args].join(" ");

      for (const [pattern, response] of Object.entries(responses)) {
        if (line === pattern || line.startsWith(`${pattern} `)) {
          return build(response);
        }
      }

      return build(
        Object.keys(result).length > 0
          ? result
          : { stdout: "git version 2.44.0" },
      );
    },
  };
}

export function fakeClock(start = 1_000): ClockHost {
  let current = start;
  return {
    now: (): number => {
      current += 5;
      return current;
    },
  };
}

export interface FakeHttp extends HttpHost {
  readonly requests: HttpRequest[];
}

/**
 * Serves canned responses. `body` is returned verbatim for non-streaming
 * calls; `lines` is returned for server sent events.
 */
export function fakeHttp(
  response: {
    status?: number;
    body?: string;
    lines?: readonly string[];
    throws?: boolean;
    headers?: Record<string, string>;
    /** Statuses to return in order before falling back to `status`. */
    sequence?: readonly number[];
  } = {},
): FakeHttp {
  const requests: HttpRequest[] = [];
  const status = response.status ?? 200;
  const sequence = [...(response.sequence ?? [])];

  return {
    requests,
    send(request: HttpRequest): Promise<HttpResponse> {
      requests.push(request);

      if (response.throws === true) {
        return Promise.reject(new Error("network down"));
      }

      const lines = response.lines ?? [];
      const current = sequence.shift() ?? status;

      return Promise.resolve({
        status: current,
        ok: current >= 200 && current < 300,
        headers: response.headers ?? {},
        text: () => Promise.resolve(response.body ?? ""),
        // eslint-disable-next-line @typescript-eslint/require-await
        lines: async function* (): AsyncGenerator<string, void, undefined> {
          for (const line of lines) {
            yield line;
          }
        },
      });
    },
  };
}

export function fakeHosts(
  overrides: {
    fs?: FileSystemHost;
    proc?: ProcessHost;
    env?: EnvHost;
    http?: HttpHost;
    clock?: ClockHost;
  } = {},
): Hosts {
  return {
    fs: overrides.fs ?? fakeFileSystem(),
    proc: overrides.proc ?? fakeProcess(),
    env: overrides.env ?? {},
    http: overrides.http ?? fakeHttp(),
    clock: overrides.clock ?? fakeClock(),
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
