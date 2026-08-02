/**
 * Plugin loading.
 *
 * A failed plugin is reported, never fatal. One broken extension must not stop
 * a repository from being worked on, and a plugin that silently does nothing is
 * worse than one that says why it did not load.
 */
import { isAbsolute, join } from "node:path";
import { isPlugin } from "./types.js";
import type { Permission, Plugin, PluginContext } from "./types.js";
import type { Hosts } from "../core/hosts.js";
import type { Logger } from "../core/logger.js";

export interface LoadedPlugin {
  readonly specifier: string;
  readonly plugin: Plugin;
}

export interface FailedPlugin {
  readonly specifier: string;
  readonly reason: string;
}

export interface LoadResult {
  readonly loaded: readonly LoadedPlugin[];
  readonly failed: readonly FailedPlugin[];
}

/** Injectable so tests can supply modules without touching disk. */
export type ModuleLoader = (specifier: string) => Promise<unknown>;

const nodeLoader: ModuleLoader = (specifier: string) => import(specifier);

/**
 * Grants only what was declared. A plugin without `network` never receives an
 * HTTP host, so the ordinary way of making a request is simply absent.
 */
export function grantHosts(
  hosts: Hosts,
  permissions: readonly Permission[],
): Partial<Hosts> {
  const granted: { -readonly [K in keyof Hosts]?: Hosts[K] } = {
    clock: hosts.clock,
  };

  if (permissions.includes("read-repo") || permissions.includes("write-repo")) {
    granted.fs = permissions.includes("write-repo")
      ? hosts.fs
      : {
          exists: hosts.fs.exists,
          readFile: hosts.fs.readFile,
          readDir: hosts.fs.readDir,
          size: hosts.fs.size,
          writeFile: (): never => {
            throw new Error("plugin lacks the write-repo permission");
          },
          mkdir: (): never => {
            throw new Error("plugin lacks the write-repo permission");
          },
        };
  }

  if (permissions.includes("network")) {
    granted.http = hosts.http;
  }

  if (permissions.includes("state")) {
    granted.env = hosts.env;
    granted.proc = hosts.proc;
  }

  return granted;
}

function resolveSpecifier(root: string, specifier: string): string {
  if (specifier.startsWith(".")) {
    return join(root, specifier);
  }
  return isAbsolute(specifier) ? specifier : specifier;
}

export interface LoadOptions {
  readonly root: string;
  readonly specifiers: readonly string[];
  readonly hosts: Hosts;
  readonly logger: Logger;
  readonly load?: ModuleLoader;
}

export async function loadPlugins(options: LoadOptions): Promise<LoadResult> {
  const load = options.load ?? nodeLoader;
  const loaded: LoadedPlugin[] = [];
  const failed: FailedPlugin[] = [];

  for (const specifier of options.specifiers) {
    try {
      const imported = (await load(
        resolveSpecifier(options.root, specifier),
      )) as Record<string, unknown>;

      const candidate = imported["default"] ?? imported["plugin"];

      if (!isPlugin(candidate)) {
        failed.push({
          specifier,
          reason: "no default export matching the plugin contract",
        });
        continue;
      }

      if (loaded.some((entry) => entry.plugin.name === candidate.name)) {
        failed.push({
          specifier,
          reason: `a plugin named ${candidate.name} is already loaded`,
        });
        continue;
      }

      const context: PluginContext = {
        hosts: grantHosts(options.hosts, candidate.permissions),
        logger: options.logger,
        root: options.root,
      };

      await candidate.setup?.(context);
      loaded.push({ specifier, plugin: candidate });
    } catch (error: unknown) {
      failed.push({
        specifier,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { loaded, failed };
}
