/**
 * Public library surface.
 *
 * Every client of Orchestrai (the CLI today, the dashboard and API later)
 * imports from here rather than reaching into internal module paths.
 */
export { createRegistry, CommandRegistry, ok } from "./engine/index.js";
export { createProgram } from "./cli/program.js";
export { run } from "./cli/run.js";
export { render, renderHuman, renderJson } from "./cli/render.js";
export { readGlobalFlags, GLOBAL_OPTIONS } from "./cli/globals.js";
export { createLogger, isLogLevel, LOG_LEVELS } from "./core/logger.js";
export { describeEnvironment } from "./core/environment.js";
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
  CommandResult,
  FieldStatus,
  Report,
  ReportField,
} from "./engine/index.js";
export type { ProgramOptions } from "./cli/program.js";
export type { RunOptions } from "./cli/run.js";
export type { GlobalFlags } from "./cli/globals.js";
export type { Logger, LoggerOptions, LogLevel, LogSink } from "./core/logger.js";
export type {
  EnvironmentHost,
  EnvironmentSnapshot,
} from "./core/environment.js";
export type { ExitCode, OrchestraiErrorOptions } from "./core/errors.js";
