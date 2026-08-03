/**
 * Public library surface.
 *
 * Every client of Orchestrai (the CLI today, the dashboard and API later)
 * imports from here rather than reaching into internal module paths.
 */
export {
  createRegistry,
  CommandRegistry,
  ok,
  requireConfig,
  requireScope,
  requireWorkspace,
} from "./engine/index.js";
export {
  activateCapabilities,
  buildCapabilitiesCommand,
  CapabilityRegistry,
  composeConfigSchemas,
  composeProviders,
  createCapabilityStorage,
  EventBus,
  namespacedFieldKey,
  namespacedFieldKeys,
  prefixedCommandName,
  StorageContainmentError,
  storageRoot,
} from "./runtime/index.js";
export {
  assembleRuntime,
  defaultCapabilities,
  engineeringCapability,
} from "./capabilities/index.js";
export { createProgram } from "./cli/program.js";
export { run } from "./cli/run.js";
export { buildBaseContext, enforceRequirements } from "./cli/context.js";
export { render, renderHuman, renderJson } from "./cli/render.js";
export { readGlobalFlags, GLOBAL_OPTIONS } from "./cli/globals.js";
export { createLogger, isLogLevel, LOG_LEVELS } from "./core/logger.js";
export { describeEnvironment } from "./core/environment.js";
export {
  nodeFileSystem,
  nodeHosts,
  nodeProcessHost,
} from "./core/hosts.js";
export {
  CONFIG_FIELDS,
  CONFIG_KEYS,
  ConfigurationError,
  DEFAULT_CONFIG,
  ENGINEERING_CONFIG_TABLE,
  isConfigKey,
  parseOverrides,
  resolveConfig,
  serializeConfig,
} from "./core/config/index.js";
export {
  CONFIG_FILE_NAME,
  STATE_DIR_NAME,
  resolveHomeDir,
  resolveScope,
  resolveUserScope,
  resolveWorkspace,
  scopeStateDir,
} from "./core/workspace.js";
export {
  describeError,
  errorToJson,
  isOrchestraiError,
  OrchestraiError,
  PreconditionError,
  UsageError,
  EXIT_CODES,
} from "./core/errors.js";
export {
  packageDescription,
  packageName,
  packageVersion,
} from "./core/manifest.js";

export type {
  CommandArgument,
  CommandContext,
  CommandDefinition,
  CommandOption,
  CommandRequirements,
  CommandResult,
  FieldStatus,
  Report,
  ReportField,
} from "./engine/index.js";
export type {
  ActivationResult,
  Capability,
  CapabilitiesData,
  CapabilityActivation,
  CapabilityConfigSchema,
  CapabilityFailure,
  CapabilityStorage,
  ComposedConfigSchema,
  EventBusOptions,
  EventHandler,
  JobContext,
  JobDefinition,
} from "./runtime/index.js";
export type { RuntimeAssembly } from "./capabilities/index.js";
export type { BaseContext } from "./cli/context.js";
export type { ProgramOptions } from "./cli/program.js";
export type { RunOptions } from "./cli/run.js";
export type { GlobalFlags } from "./cli/globals.js";
export type {
  ConfigFieldTable,
  ConfigKey,
  ConfigSource,
  ConfigValues,
  FieldSpec,
  ResolvedConfig,
} from "./core/config/index.js";
export type {
  EnvHost,
  FileSystemHost,
  Hosts,
  ProcessHost,
  ProcessResult,
} from "./core/hosts.js";
export type {
  RepositoryScope,
  Scope,
  ScopeKind,
  UserScope,
  Workspace,
} from "./core/workspace.js";
export type { Logger, LoggerOptions, LogLevel, LogSink } from "./core/logger.js";
export type {
  EnvironmentHost,
  EnvironmentSnapshot,
} from "./core/environment.js";
export type { ExitCode, OrchestraiErrorOptions } from "./core/errors.js";
