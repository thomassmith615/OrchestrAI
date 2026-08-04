export { scanRepository, DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_BYTES } from "./scan.js";
export { detectToolchain, formatCommand } from "./toolchain.js";
export { detectLanguage, isBinaryName } from "./languages.js";
export { extractSymbols } from "./symbols.js";
export {
  buildSymbolIndex,
  definitionsOf,
  referencesTo,
  EMPTY_SYMBOL_INDEX,
} from "./symbol-index.js";
export {
  CLEAN_STATUS,
  describeGitStatus,
  readDiff,
  readGitStatus,
} from "./git.js";
export {
  configScope,
  isIgnored,
  parseIgnoreFile,
  parseIgnoreRule,
} from "./ignore.js";
export type {
  FileEntry,
  LanguageSummary,
  ScanOptions,
  ScanSummary,
} from "./scan.js";
export type { Ecosystem, ToolCommand, Toolchain } from "./toolchain.js";
export type { FileSymbols } from "./symbols.js";
export type { SymbolIndex, SymbolIndexOptions } from "./symbol-index.js";
export type { IgnoreRule, IgnoreScope } from "./ignore.js";
export type { DiffOptions, GitCommit, GitStatus } from "./git.js";
