/**
 * Writing configuration back to disk.
 *
 * Only the keys being changed are touched. Anything else in the file, including
 * settings this version does not recognize, is preserved.
 */
import { CONFIG_KEYS, DEFAULT_CONFIG, isConfigKey } from "./schema.js";
import { ConfigurationError } from "./resolve.js";
import type { ConfigKey, ConfigValues } from "./schema.js";
import type { FileSystemHost } from "../hosts.js";

export type ConfigPatch = Partial<Record<ConfigKey, ConfigValues[ConfigKey]>>;

function readRaw(
  path: string,
  fs: FileSystemHost,
): Record<string, unknown> {
  if (!fs.exists(path)) {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFile(path));
  } catch {
    throw new ConfigurationError(
      `${path} is not valid JSON`,
      "Fix the syntax, or run `orch init --force` to reset it",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigurationError(`${path} must contain a JSON object`);
  }

  return { ...(parsed as Record<string, unknown>) };
}

/**
 * Merges `patch` into the config file and returns the keys that changed.
 * Writing is skipped entirely when nothing would change.
 */
export function patchConfigFile(
  path: string,
  fs: FileSystemHost,
  patch: ConfigPatch,
): readonly ConfigKey[] {
  const current = readRaw(path, fs);
  const changed: ConfigKey[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (!isConfigKey(key)) {
      throw new ConfigurationError(
        `Unknown setting: ${key}`,
        `Known settings: ${CONFIG_KEYS.join(", ")}`,
      );
    }
    if (JSON.stringify(current[key]) === JSON.stringify(value)) {
      continue;
    }
    current[key] = value;
    changed.push(key);
  }

  if (changed.length > 0) {
    fs.writeFile(path, `${JSON.stringify(current, null, 2)}\n`);
  }

  return changed;
}
