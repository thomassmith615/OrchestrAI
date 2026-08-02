/**
 * `orch init` prepares an existing repository for Orchestrai.
 *
 * Deliberately conservative: it creates a config file and a state directory
 * and nothing else. It never modifies tracked files and never writes secrets.
 */
import { join } from "node:path";
import { DEFAULT_CONFIG, serializeConfig } from "../../core/config/index.js";
import { STATE_DIR_NAME } from "../../core/workspace.js";
import { requireWorkspace } from "../command.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

export interface InitData {
  readonly root: string;
  readonly configPath: string;
  readonly stateDir: string;
  readonly configCreated: boolean;
  readonly stateDirCreated: boolean;
}

/** Only the cache is disposable; the rest of the state directory is committed. */
const STATE_GITIGNORE = ["cache/\n"].join("");

export const initCommand: CommandDefinition<InitData> = {
  name: "init",
  summary: "Initialize Orchestrai inside an existing repository",
  options: [
    { flags: "--force", description: "Overwrite an existing configuration file" },
  ],
  requires: { repository: true },

  execute(context: CommandContext): Promise<CommandResult<InitData>> {
    const workspace = requireWorkspace(context);
    const { fs } = context.hosts;
    const force = context.options["force"] === true;

    const configExists = fs.exists(workspace.configPath);
    const configCreated = !configExists || force;
    if (configCreated) {
      fs.writeFile(workspace.configPath, serializeConfig(DEFAULT_CONFIG));
    }

    const stateDirCreated = !fs.exists(workspace.stateDir);
    if (stateDirCreated) {
      fs.mkdir(workspace.stateDir);
      fs.writeFile(join(workspace.stateDir, ".gitignore"), STATE_GITIGNORE);
    }

    const notes =
      configExists && !force
        ? ["Configuration already existed. Re-run with --force to reset it."]
        : ["Run `orch doctor` to verify the setup."];

    return Promise.resolve({
      data: {
        root: workspace.root,
        configPath: workspace.configPath,
        stateDir: workspace.stateDir,
        configCreated,
        stateDirCreated,
      },
      report: {
        fields: [
          { label: "Repository", value: workspace.root },
          {
            label: "Config",
            value: configCreated ? "created" : "unchanged",
          },
          {
            label: STATE_DIR_NAME,
            value: stateDirCreated ? "created" : "unchanged",
          },
        ],
        notes,
      },
    });
  },
};
