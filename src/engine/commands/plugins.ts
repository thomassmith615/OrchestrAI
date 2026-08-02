/**
 * `orch plugins` shows what is loaded and what each plugin asked for.
 *
 * Permissions are a disclosure, not a sandbox (see `src/plugins/types.ts`), so
 * printing them is the point rather than a nicety.
 */
import { loadPlugins } from "../../plugins/index.js";
import { requireConfig, requireWorkspace } from "../command.js";
import type { FailedPlugin, LoadedPlugin } from "../../plugins/index.js";
import type { CommandContext, CommandDefinition, CommandResult, ReportField } from "../command.js";
import { EXIT_CODES } from "../../core/errors.js";

export interface PluginsData {
  readonly loaded: readonly {
    readonly name: string;
    readonly version: string;
    readonly specifier: string;
    readonly permissions: readonly string[];
    readonly commands: number;
    readonly steps: number;
  }[];
  readonly failed: readonly FailedPlugin[];
}

function describe(entry: LoadedPlugin): PluginsData["loaded"][number] {
  return {
    name: entry.plugin.name,
    version: entry.plugin.version,
    specifier: entry.specifier,
    permissions: entry.plugin.permissions,
    commands: entry.plugin.commands?.length ?? 0,
    steps: entry.plugin.steps?.length ?? 0,
  };
}

export const pluginsCommand: CommandDefinition<PluginsData> = {
  name: "plugins",
  summary: "List configured plugins and the permissions they request",
  requires: { config: true },

  async execute(context: CommandContext): Promise<CommandResult<PluginsData>> {
    const workspace = requireWorkspace(context);
    const config = requireConfig(context);

    const result = await loadPlugins({
      root: workspace.root,
      specifiers: config.values.plugins,
      hosts: context.hosts,
      logger: context.logger,
    });

    const loaded = result.loaded.map(describe);

    const fields: ReportField[] = [
      { label: "Configured", value: config.values.plugins.length },
      ...loaded.map((entry) => ({
        label: entry.name,
        value: `${entry.version}  [${entry.permissions.join(", ") || "no permissions"}]  ${String(
          entry.commands,
        )} commands, ${String(entry.steps)} steps`,
        status: "pass" as const,
      })),
      ...result.failed.map((entry) => ({
        label: entry.specifier,
        value: entry.reason,
        status: "fail" as const,
      })),
    ];

    const notes: string[] = [];
    if (config.values.plugins.length === 0) {
      notes.push("No plugins configured. Add them with `--set plugins=./my-plugin.js`.");
    } else {
      notes.push(
        "Plugins run in this process. Permissions are a declaration, not a sandbox.",
      );
    }

    return {
      data: { loaded, failed: result.failed },
      report: { fields, notes },
      exitCode:
        result.failed.length > 0 ? EXIT_CODES.failure : EXIT_CODES.success,
    };
  },
};
