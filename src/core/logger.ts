/**
 * Minimal leveled logger.
 *
 * Output destinations are injected so that commands never write to
 * `process.stdout` directly. This keeps the CLI testable and leaves room for
 * structured (JSON) output in a later milestone.
 */

export const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** Anything that can accept a line of text. */
export interface LogSink {
  write(line: string): void;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly out?: LogSink;
  readonly err?: LogSink;
}

export interface Logger {
  readonly level: LogLevel;
  /** Writes a line to stdout verbatim, unless the level is `silent`. */
  print(message: string): void;
  /** Writes a line to stderr verbatim, unless the level is `silent`. */
  printError(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/* eslint-disable no-console -- this module is the single sanctioned console boundary. */
const defaultOut: LogSink = {
  write(line: string): void {
    console.log(line);
  },
};

const defaultErr: LogSink = {
  write(line: string): void {
    console.error(line);
  },
};
/* eslint-enable no-console */

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const out = options.out ?? defaultOut;
  const err = options.err ?? defaultErr;
  const enabled = (candidate: LogLevel): boolean =>
    LEVEL_RANK[candidate] <= LEVEL_RANK[level];

  return {
    level,
    print(message: string): void {
      if (level !== "silent") {
        out.write(message);
      }
    },
    printError(message: string): void {
      if (level !== "silent") {
        err.write(message);
      }
    },
    error(message: string): void {
      if (enabled("error")) {
        err.write(`error: ${message}`);
      }
    },
    warn(message: string): void {
      if (enabled("warn")) {
        err.write(`warn: ${message}`);
      }
    },
    info(message: string): void {
      if (enabled("info")) {
        out.write(message);
      }
    },
    debug(message: string): void {
      if (enabled("debug")) {
        err.write(`debug: ${message}`);
      }
    },
  };
}
