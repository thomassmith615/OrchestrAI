export {
  ConfigurationError,
  parseOverrides,
  resolveConfig,
  serializeConfig,
} from "./resolve.js";
export {
  CONFIG_FIELDS,
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  fieldSpec,
  isConfigKey,
} from "./schema.js";
export type { ConfigSource, ResolveConfigOptions, ResolvedConfig } from "./resolve.js";
export type { ConfigKey, ConfigValues, FieldKind, FieldSpec } from "./schema.js";
