/**
 * Error taxonomy and exit code contract.
 *
 * Exit codes are part of the public interface of the CLI. Scripts and CI
 * pipelines depend on them, so they are defined once here and never invented
 * at a call site.
 */

export const EXIT_CODES = {
  /** Everything succeeded. */
  success: 0,
  /** Unexpected failure. */
  failure: 1,
  /** The command was invoked incorrectly. */
  usage: 2,
  /** A validation gate failed (build, typecheck, lint, or test). */
  validation: 3,
  /** A precondition was not met (not a repository, not initialized, dirty tree). */
  precondition: 4,
  /** Configuration or credentials are missing or invalid. */
  configuration: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface OrchestraiErrorOptions {
  /** Stable, machine readable identifier, e.g. `config.invalid`. */
  readonly code: string;
  /** Exit code to use if this error reaches the process boundary. */
  readonly exitCode?: ExitCode;
  /** Underlying error, preserved for diagnostics. */
  readonly cause?: unknown;
  /** Actionable next step shown to the operator. */
  readonly hint?: string;
}

/** Base class for all errors intentionally raised by Orchestrai. */
export class OrchestraiError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly hint: string | undefined;

  constructor(message: string, options: OrchestraiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.exitCode = options.exitCode ?? EXIT_CODES.failure;
    this.hint = options.hint;
  }

  /** Machine readable form, used by `--json` output. */
  toJSON(): { error: { code: string; message: string; hint?: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint === undefined ? {} : { hint: this.hint }),
      },
    };
  }
}

/** The operator invoked the CLI incorrectly. */
export class UsageError extends OrchestraiError {
  constructor(message: string, hint?: string) {
    super(message, {
      code: "cli.usage",
      exitCode: EXIT_CODES.usage,
      ...(hint === undefined ? {} : { hint }),
    });
  }
}

/** A required condition of the working environment was not satisfied. */
export class PreconditionError extends OrchestraiError {
  constructor(message: string, hint?: string) {
    super(message, {
      code: "cli.precondition",
      exitCode: EXIT_CODES.precondition,
      ...(hint === undefined ? {} : { hint }),
    });
  }
}

export function isOrchestraiError(value: unknown): value is OrchestraiError {
  return value instanceof OrchestraiError;
}

/** Renders any thrown value as a single human readable line. */
export function describeError(value: unknown): string {
  if (isOrchestraiError(value)) {
    return value.hint === undefined
      ? `${value.code}: ${value.message}`
      : `${value.code}: ${value.message} (${value.hint})`;
  }
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

/** Machine readable error payload for `--json` output. */
export function errorToJson(value: unknown): unknown {
  if (isOrchestraiError(value)) {
    return value.toJSON();
  }
  return {
    error: {
      code: "internal.unexpected",
      message: value instanceof Error ? value.message : String(value),
    },
  };
}
