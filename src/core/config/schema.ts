/**
 * Configuration schema.
 *
 * Fields are declared once, in one table, and everything else derives from it:
 * defaults, environment variable names, JSON validation, and the help text
 * shown by `orch config`. Adding a setting means adding a row here.
 */
import { LOG_LEVELS } from "../logger.js";
import type { LogLevel } from "../logger.js";

export interface ConfigValues {
  /** Name of the AI provider to use. */
  readonly provider: string;
  /** Model identifier, or null to use the provider default. */
  readonly model: string | null;
  /** Path to the roadmap file, relative to the repository root. */
  readonly roadmapPath: string;
  /** Default log level when no flag is supplied. */
  readonly logLevel: LogLevel;
  /** Additional ignore patterns applied on top of .gitignore. */
  readonly ignore: readonly string[];
}

export type ConfigKey = keyof ConfigValues;

export type FieldKind = "string" | "nullableString" | "enum" | "stringArray";

export interface FieldSpec {
  readonly kind: FieldKind;
  /** Environment variable that overrides this field. */
  readonly env: string;
  readonly description: string;
  /** Permitted values, for `enum` fields. */
  readonly values?: readonly string[];
}

export const CONFIG_FIELDS: Readonly<Record<ConfigKey, FieldSpec>> = {
  provider: {
    kind: "string",
    env: "ORCH_PROVIDER",
    description: "AI provider to use",
  },
  model: {
    kind: "nullableString",
    env: "ORCH_MODEL",
    description: "Model identifier, or null for the provider default",
  },
  roadmapPath: {
    kind: "string",
    env: "ORCH_ROADMAP_PATH",
    description: "Roadmap file, relative to the repository root",
  },
  logLevel: {
    kind: "enum",
    env: "ORCH_LOG_LEVEL",
    description: "Default log level",
    values: LOG_LEVELS,
  },
  ignore: {
    kind: "stringArray",
    env: "ORCH_IGNORE",
    description: "Extra ignore patterns, comma separated in the environment",
  },
};

export const CONFIG_KEYS = Object.keys(CONFIG_FIELDS) as readonly ConfigKey[];

export const DEFAULT_CONFIG: ConfigValues = {
  provider: "anthropic",
  model: null,
  roadmapPath: "docs/ROADMAP.md",
  logLevel: "info",
  ignore: [],
};

export function isConfigKey(value: string): value is ConfigKey {
  return Object.hasOwn(CONFIG_FIELDS, value);
}

export function fieldSpec(key: ConfigKey): FieldSpec {
  return CONFIG_FIELDS[key];
}
