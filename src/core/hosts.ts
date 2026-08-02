/**
 * Injectable access to the outside world.
 *
 * Every filesystem read, subprocess call, and environment lookup passes
 * through one of these interfaces so that commands are testable without
 * touching the machine they run on. See ADR 0003.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";

export interface DirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface FileSystemHost {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  /** Creates the directory and any missing parents. */
  mkdir(path: string): void;
  /** Immediate children of a directory. Order is not guaranteed. */
  readDir(path: string): readonly DirEntry[];
  /** Size in bytes. Returns 0 for anything unreadable. */
  size(path: string): number;
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

export interface HttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  text(): Promise<string>;
  /** Response body as newline delimited chunks, for server sent events. */
  lines(): AsyncIterable<string>;
}

export interface HttpHost {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export interface Hosts {
  readonly fs: FileSystemHost;
  readonly proc: ProcessHost;
  readonly env: EnvHost;
  readonly http: HttpHost;
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
  readDir: (path: string): readonly DirEntry[] => {
    try {
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    } catch {
      return [];
    }
  },
  size: (path: string): number => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
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

async function* decodeLines(
  response: Response,
): AsyncGenerator<string, void, undefined> {
  if (response.body === null) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }

  if (buffer.length > 0) {
    yield buffer;
  }
}

export const nodeHttpHost: HttpHost = {
  async send(request: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
    });

    return {
      status: response.status,
      ok: response.ok,
      text: () => response.text(),
      lines: () => decodeLines(response),
    };
  },
};

export function nodeHosts(): Hosts {
  return {
    fs: nodeFileSystem,
    proc: nodeProcessHost,
    env: process.env,
    http: nodeHttpHost,
  };
}
