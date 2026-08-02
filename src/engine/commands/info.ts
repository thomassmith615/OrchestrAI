/**
 * `orch info` reports the running environment.
 *
 * Unlike `doctor` it makes no judgement: it is the snapshot you paste into a
 * bug report.
 */
import { describeEnvironment } from "../../core/environment.js";
import { ok } from "../command.js";
import type { EnvironmentSnapshot } from "../../core/environment.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

export interface InfoData extends EnvironmentSnapshot {
  /** Repository root, or null when not inside a git repository. */
  readonly repository: string | null;
  readonly initialized: boolean;
  /** The scope this invocation would run under: "repository", "user", or
   *  null when neither a repository nor a resolvable home directory exists. */
  readonly scope: "repository" | "user" | null;
}

export const infoCommand: CommandDefinition<InfoData> = {
  name: "info",
  summary: "Show the current Orchestrai environment",

  execute(context: CommandContext): Promise<CommandResult<InfoData>> {
    const snapshot = describeEnvironment({ cwd: () => context.cwd });
    const data: InfoData = {
      ...snapshot,
      repository: context.workspace?.root ?? null,
      initialized: context.workspace?.initialized ?? false,
      scope: context.scope?.kind ?? null,
    };

    return Promise.resolve(
      ok(data, {
        fields: [
          { label: "Version", value: data.version },
          { label: "Node", value: data.nodeVersion },
          { label: "Platform", value: `${data.platform}/${data.arch}` },
          { label: "Directory", value: data.workingDirectory },
          { label: "Repository", value: data.repository },
          { label: "Scope", value: data.scope },
        ],
      }),
    );
  },
};
