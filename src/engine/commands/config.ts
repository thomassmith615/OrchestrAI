/**
 * `orch config` shows the resolved configuration and where each value came
 * from. Precedence bugs are otherwise invisible.
 */
import { CONFIG_KEYS, fieldSpec } from "../../core/config/index.js";
import { requireConfig } from "../command.js";
import type { ConfigKey, ConfigSource, ConfigValues } from "../../core/config/index.js";
import type { CommandContext, CommandDefinition, CommandResult, ReportField } from "../command.js";

export interface ConfigData {
  readonly path: string | null;
  readonly values: ConfigValues;
  readonly sources: Readonly<Record<ConfigKey, ConfigSource>>;
}

type ConfigValue = ConfigValues[ConfigKey];

function displayValue(value: ConfigValue): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : value.join(", ");
  }
  return String(value);
}

export const configCommand: CommandDefinition<ConfigData> = {
  name: "config",
  summary: "Show the resolved configuration and the source of each value",
  requires: { config: true },

  execute(context: CommandContext): Promise<CommandResult<ConfigData>> {
    const config = requireConfig(context);

    const fields: ReportField[] = CONFIG_KEYS.map((key) => ({
      label: key,
      value: `${displayValue(config.values[key])} (${config.sources[key]})`,
    }));

    const notes =
      config.path === null
        ? ["No config file found. Run `orch init` to create one."]
        : [`Loaded from ${config.path}`];

    return Promise.resolve({
      data: {
        path: config.path,
        values: config.values,
        sources: config.sources,
      },
      report: { fields, notes },
    });
  },
};

/** Exported for the doctor command, which describes settings without values. */
export function describeSetting(key: ConfigKey): string {
  return fieldSpec(key).description;
}
