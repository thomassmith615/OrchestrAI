/**
 * Configuration resolution.
 *
 * Four layers, lowest precedence first: built-in defaults, the project config
 * file, environment variables, then command line overrides. Every field
 * remembers which layer supplied it, which is the whole point of `orch config`.
 */
import { OrchestraiError, EXIT_CODES } from "../errors.js";
import {
  CONFIG_FIELDS,
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  isConfigKey,
} from "./schema.js";
import type { ConfigKey, ConfigValues, FieldSpec } from "./schema.js";
import type { EnvHost, FileSystemHost } from "../hosts.js";

export type ConfigSource = "default" | "file" | "env" | "flag";

export interface ResolvedConfig {
  readonly values: ConfigValues;
  readonly sources: Readonly<Record<ConfigKey, ConfigSource>>;
  /** Absolute path of the config file that was loaded, or null. */
  readonly path: string | null;
}

export class ConfigurationError extends OrchestraiError {
  constructor(message: string, hint?: string) {
    super(message, {
      code: "config.invalid",
      exitCode: EXIT_CODES.configuration,
      ...(hint === undefined ? {} : { hint }),
    });
  }
}

/** Validates a value that came from JSON, where types are already rich. */
function coerceStructured(
  key: ConfigKey,
  spec: FieldSpec,
  value: unknown,
): unknown {
  switch (spec.kind) {
    case "string":
      if (typeof value !== "string" || value.length === 0) {
        throw new ConfigurationError(`${key} must be a non-empty string`);
      }
      return value;

    case "nullableString":
      if (value !== null && typeof value !== "string") {
        throw new ConfigurationError(`${key} must be a string or null`);
      }
      return value;

    case "enum": {
      const permitted = spec.values ?? [];
      if (typeof value !== "string" || !permitted.includes(value)) {
        throw new ConfigurationError(
          `${key} must be one of: ${permitted.join(", ")}`,
        );
      }
      return value;
    }

    case "stringArray": {
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string")
      ) {
        throw new ConfigurationError(`${key} must be an array of strings`);
      }
      return value;
    }
  }
}

/** Validates a value that arrived as a string, from the environment or a flag. */
function coerceText(key: ConfigKey, spec: FieldSpec, raw: string): unknown {
  switch (spec.kind) {
    case "nullableString":
      return raw === "" || raw === "null" ? null : raw;

    case "stringArray":
      return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

    default:
      return coerceStructured(key, spec, raw);
  }
}

function readConfigFile(
  path: string,
  fs: FileSystemHost,
): Readonly<Record<string, unknown>> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFile(path));
  } catch {
    throw new ConfigurationError(
      `${path} is not valid JSON`,
      "Fix the syntax or delete the file",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigurationError(`${path} must contain a JSON object`);
  }

  return parsed as Readonly<Record<string, unknown>>;
}

export interface ResolveConfigOptions {
  /** Absolute path of the config file, if the workspace has one. */
  readonly configPath: string | null;
  readonly fs: FileSystemHost;
  readonly env: EnvHost;
  /** `key=value` pairs from `--set`, highest precedence. */
  readonly overrides?: readonly string[];
}

export function parseOverrides(
  overrides: readonly string[],
): ReadonlyMap<ConfigKey, string> {
  const parsed = new Map<ConfigKey, string>();

  for (const entry of overrides) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new ConfigurationError(
        `Invalid override: ${entry}`,
        "Expected the form key=value",
      );
    }

    const key = entry.slice(0, separator);
    if (!isConfigKey(key)) {
      throw new ConfigurationError(
        `Unknown setting: ${key}`,
        `Known settings: ${CONFIG_KEYS.join(", ")}`,
      );
    }

    parsed.set(key, entry.slice(separator + 1));
  }

  return parsed;
}

export function resolveConfig(options: ResolveConfigOptions): ResolvedConfig {
  const values: Record<string, unknown> = { ...DEFAULT_CONFIG };
  const sources: Record<string, ConfigSource> = {};
  for (const key of CONFIG_KEYS) {
    sources[key] = "default";
  }

  const loaded =
    options.configPath !== null && options.fs.exists(options.configPath)
      ? readConfigFile(options.configPath, options.fs)
      : null;

  if (loaded !== null) {
    for (const [key, value] of Object.entries(loaded)) {
      if (!isConfigKey(key)) {
        throw new ConfigurationError(
          `Unknown setting in config file: ${key}`,
          `Known settings: ${CONFIG_KEYS.join(", ")}`,
        );
      }
      values[key] = coerceStructured(key, CONFIG_FIELDS[key], value);
      sources[key] = "file";
    }
  }

  for (const key of CONFIG_KEYS) {
    const raw = options.env[CONFIG_FIELDS[key].env];
    if (raw !== undefined) {
      values[key] = coerceText(key, CONFIG_FIELDS[key], raw);
      sources[key] = "env";
    }
  }

  for (const [key, raw] of parseOverrides(options.overrides ?? [])) {
    values[key] = coerceText(key, CONFIG_FIELDS[key], raw);
    sources[key] = "flag";
  }

  return {
    values: values as unknown as ConfigValues,
    sources: sources as Readonly<Record<ConfigKey, ConfigSource>>,
    path: loaded === null ? null : options.configPath,
  };
}

/** Serializes the full configuration, used by `orch init`. */
export function serializeConfig(values: ConfigValues): string {
  return `${JSON.stringify(values, null, 2)}\n`;
}
