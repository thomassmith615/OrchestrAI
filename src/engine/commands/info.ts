/**
 * `orch info` reports the running environment.
 *
 * Milestone 2 builds `orch doctor` on top of this by adding git, config, and
 * credential checks with pass or fail status per row.
 */
import { describeEnvironment } from "../../core/environment.js";
import { ok } from "../command.js";
import type { EnvironmentSnapshot } from "../../core/environment.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

export const infoCommand: CommandDefinition<EnvironmentSnapshot> = {
  name: "info",
  summary: "Show the current Orchestrai environment",

  execute(context: CommandContext): Promise<CommandResult<EnvironmentSnapshot>> {
    const snapshot = describeEnvironment({ cwd: () => context.cwd });

    return Promise.resolve(
      ok(snapshot, {
        fields: [
          { label: "Version", value: snapshot.version },
          { label: "Node", value: snapshot.nodeVersion },
          { label: "Platform", value: `${snapshot.platform}/${snapshot.arch}` },
          { label: "Directory", value: snapshot.workingDirectory },
        ],
      }),
    );
  },
};
