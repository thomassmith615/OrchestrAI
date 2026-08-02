/**
 * `orch doctor` reports whether the environment can support a milestone run.
 *
 * It never throws on a bad environment; reporting the problem is its job. That
 * is why it declares no requirements and tolerates a null workspace and a
 * failed configuration load.
 */
import { EXIT_CODES, describeError } from "../../core/errors.js";
import { CONFIG_FILE_NAME, STATE_DIR_NAME } from "../../core/workspace.js";
import type { CommandContext, CommandDefinition, CommandResult, FieldStatus } from "../command.js";

/** Minimum supported runtime, matching the `engines` field. */
const MINIMUM_NODE = { major: 20, minor: 11 };

/** Environment variable holding the credential for each known provider. */
const CREDENTIAL_ENV: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export interface Check {
  readonly name: string;
  readonly status: FieldStatus;
  readonly detail: string;
}

export interface DoctorData {
  readonly checks: readonly Check[];
  readonly failures: number;
  readonly warnings: number;
  readonly healthy: boolean;
  /** The scope this invocation would run under. See ADR 0017. */
  readonly scope: "repository" | "user" | null;
}

function meetsMinimumNode(version: string): boolean {
  const [major = 0, minor = 0] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  if (Number.isNaN(major) || Number.isNaN(minor)) {
    return false;
  }

  return (
    major > MINIMUM_NODE.major ||
    (major === MINIMUM_NODE.major && minor >= MINIMUM_NODE.minor)
  );
}

export const doctorCommand: CommandDefinition<DoctorData> = {
  name: "doctor",
  summary: "Run diagnostic checks on the repository configuration",

  execute(context: CommandContext): Promise<CommandResult<DoctorData>> {
    const { fs, proc, env } = context.hosts;
    const checks: Check[] = [];

    const nodeVersion = process.versions.node;
    checks.push({
      name: "Node",
      status: meetsMinimumNode(nodeVersion) ? "pass" : "fail",
      detail: `${nodeVersion} (requires ${MINIMUM_NODE.major}.${MINIMUM_NODE.minor}+)`,
    });

    const git = proc.run("git", ["--version"], context.cwd);
    checks.push({
      name: "Git",
      status: git.ok ? "pass" : "fail",
      detail: git.ok ? git.stdout.trim() : "git executable not found on PATH",
    });

    const workspace = context.workspace;
    checks.push({
      name: "Repository",
      status: workspace === null ? "fail" : "pass",
      detail: workspace === null ? `not inside a git repository` : workspace.root,
    });

    checks.push({
      name: "Initialized",
      status: workspace?.initialized === true ? "pass" : "warn",
      detail:
        workspace?.initialized === true
          ? `${STATE_DIR_NAME} present`
          : `${STATE_DIR_NAME} missing, run \`orch init\``,
    });

    // Never a failure: this reports the scope, it does not require one. See
    // ADR 0017.
    checks.push({
      name: "Scope",
      status: context.scope === null ? "warn" : "pass",
      detail:
        context.scope === null
          ? "no repository and no resolvable home directory (HOME not set)"
          : context.scope.kind === "repository"
            ? `repository, ${context.scope.workspace.root}`
            : `user, ${context.scope.root}`,
    });

    if (context.config === null) {
      checks.push({
        name: "Config",
        status: "fail",
        detail: describeError(context.configError),
      });
    } else if (context.config.path === null) {
      checks.push({
        name: "Config",
        status: "warn",
        detail: `${CONFIG_FILE_NAME} missing, using defaults`,
      });
    } else {
      checks.push({
        name: "Config",
        status: "pass",
        detail: context.config.path,
      });
    }

    const provider = context.config?.values.provider ?? "anthropic";
    const credentialVar = CREDENTIAL_ENV[provider];
    if (credentialVar === undefined) {
      checks.push({
        name: "Credentials",
        status: "warn",
        detail: `no known credential variable for provider "${provider}"`,
      });
    } else {
      const present =
        env[credentialVar] !== undefined && env[credentialVar] !== "";
      checks.push({
        name: "Credentials",
        status: present ? "pass" : "warn",
        detail: present ? `${credentialVar} set` : `${credentialVar} not set`,
      });
    }

    // Referenced so the filesystem host stays part of the check surface as
    // later milestones add file based diagnostics.
    void fs;

    const failures = checks.filter((check) => check.status === "fail").length;
    const warnings = checks.filter((check) => check.status === "warn").length;

    const notes =
      failures > 0
        ? [`${String(failures)} check(s) failed.`]
        : warnings > 0
          ? [`${String(warnings)} warning(s). Orchestrai can still run.`]
          : ["All checks passed."];

    return Promise.resolve({
      data: {
        checks,
        failures,
        warnings,
        healthy: failures === 0,
        scope: context.scope?.kind ?? null,
      },
      report: {
        fields: checks.map((check) => ({
          label: check.name,
          value: check.detail,
          status: check.status,
        })),
        notes,
      },
      exitCode: failures > 0 ? EXIT_CODES.precondition : EXIT_CODES.success,
    });
  },
};
