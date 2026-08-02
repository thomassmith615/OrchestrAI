/**
 * `orch status` is the one-screen answer to "what is this repository and can
 * Orchestrai work with it".
 *
 * Milestone 5 adds branch information and the build, test, lint, and typecheck
 * verdicts. This milestone reports what was detected, not whether it passes.
 */
import {
  describeGitStatus,
  detectToolchain,
  formatCommand,
  readGitStatus,
  scanRepository,
} from "../../repo/index.js";
import {
  GATE_NAMES,
  readGateRun,
  recordGateRun,
  runGates,
} from "../../gates/index.js";
import { findProvider } from "../../providers/index.js";
import { EXIT_CODES } from "../../core/errors.js";
import { gateFields } from "./gates.js";
import { requireConfig, requireWorkspace } from "../command.js";
import type { GateRun } from "../../gates/index.js";
import type { GitStatus, ScanSummary, Toolchain } from "../../repo/index.js";
import type { ExitCode } from "../../core/errors.js";
import type { CommandContext, CommandDefinition, CommandResult, ReportField } from "../command.js";

export interface StatusData {
  readonly repository: string;
  readonly initialized: boolean;
  readonly git: GitStatus;
  /** Last recorded or freshly executed gate run, or null if never run. */
  readonly gates: GateRun | null;
  /** True when this invocation executed the gates rather than reading them. */
  readonly gatesFresh: boolean;
  readonly provider: { readonly id: string; readonly model: string };
  readonly scan: {
    readonly files: number;
    readonly bytes: number;
    readonly truncated: boolean;
    readonly ignored: number;
    readonly binary: number;
    readonly oversized: number;
    readonly languages: ScanSummary["languages"];
  };
  readonly toolchain: {
    readonly ecosystem: Toolchain["ecosystem"];
    readonly packageManager: string | null;
    readonly build: string | null;
    readonly test: string | null;
    readonly lint: string | null;
    readonly typecheck: string | null;
    readonly ci: string | null;
    readonly manifests: readonly string[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative age, so a stale verdict is obvious without reading a timestamp. */
function describeAge(now: number, then: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));

  if (seconds < 90) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${String(minutes)} minutes ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 36) {
    return `${String(hours)} hours ago`;
  }
  return `${String(Math.round(hours / 24))} days ago`;
}

function summarizeLanguages(scan: ScanSummary, limit: number): string {
  if (scan.languages.length === 0) {
    return "none detected";
  }

  const shown = scan.languages
    .slice(0, limit)
    .map((entry) => `${entry.language} (${String(entry.files)})`);
  const remaining = scan.languages.length - shown.length;

  return remaining > 0
    ? `${shown.join(", ")}, +${String(remaining)} more`
    : shown.join(", ");
}

export const statusCommand: CommandDefinition<StatusData> = {
  name: "status",
  summary: "Show repository health, toolchain, and configured provider",
  options: [
    {
      flags: "--languages <count>",
      description: "How many languages to list (default 4)",
    },
    {
      flags: "--verify",
      description: "Run the verification gates now instead of reading the last run",
    },
  ],
  requires: { repository: true, config: true },

  execute(context: CommandContext): Promise<CommandResult<StatusData>> {
    const workspace = requireWorkspace(context);
    const config = requireConfig(context);

    const scan = scanRepository({
      root: workspace.root,
      fs: context.hosts.fs,
      ignore: config.values.ignore,
    });
    const toolchain = detectToolchain(context.hosts.fs, workspace.root);

    const descriptor = findProvider(config.values.provider);
    const model =
      config.values.model ?? descriptor?.defaultModel ?? "not configured";

    const git = readGitStatus(context.hosts.proc, workspace.root);

    const shouldVerify = context.options["verify"] === true;
    let gates = readGateRun(context.hosts.fs, workspace.stateDir);
    let exitCode: ExitCode = EXIT_CODES.success;

    if (shouldVerify) {
      gates = runGates({
        root: workspace.root,
        toolchain,
        proc: context.hosts.proc,
        clock: context.hosts.clock,
        gates: GATE_NAMES,
      });
      recordGateRun(context.hosts.fs, workspace.stateDir, gates);
    }

    if (gates !== null && gates.failed > 0) {
      exitCode = EXIT_CODES.validation;
    }

    const limitOption = context.options["languages"];
    const limit =
      typeof limitOption === "string" ? Number.parseInt(limitOption, 10) : 4;

    const fields: ReportField[] = [
      { label: "Repository", value: workspace.root },
      { label: "Branch", value: describeGitStatus(git) },
      { label: "Commit", value: git.head === null ? null : `${git.head.shortSha} ${git.head.subject}` },
      { label: "Files", value: scan.files.length },
      { label: "Size", value: formatBytes(scan.totalBytes) },
      {
        label: "Languages",
        value: summarizeLanguages(scan, Number.isNaN(limit) ? 4 : limit),
      },
      {
        label: "Ecosystem",
        value:
          toolchain.packageManager === null
            ? toolchain.ecosystem
            : `${toolchain.ecosystem} (${toolchain.packageManager})`,
      },
      { label: "Build", value: formatCommand(toolchain.build) },
      { label: "Test", value: formatCommand(toolchain.test) },
      { label: "Lint", value: formatCommand(toolchain.lint) },
      { label: "Typecheck", value: formatCommand(toolchain.typecheck) },
      { label: "CI", value: toolchain.ci },
      { label: "Provider", value: `${config.values.provider} (${model})` },
      ...(gates === null ? [] : gateFields(gates)),
    ];

    const notes: string[] = [];
    if (gates === null) {
      notes.push("Gates have not run. Use `orch status --verify` or `orch test`.");
    } else if (!shouldVerify) {
      notes.push(`Gate results from ${describeAge(context.hosts.clock.now(), gates.startedAt)}.`);
    } else if (gates.ok) {
      notes.push("Ready for review.");
    }
    if (!workspace.initialized) {
      notes.push("Not initialized. Run `orch init`.");
    }
    if (scan.truncated) {
      notes.push("File cap reached; inventory is incomplete.");
    }
    if (toolchain.ecosystem === "unknown") {
      notes.push("No known manifest found; verification gates will be limited.");
    }

    return Promise.resolve({
      data: {
        repository: workspace.root,
        initialized: workspace.initialized,
        git,
        gates,
        gatesFresh: shouldVerify,
        provider: { id: config.values.provider, model },
        scan: {
          files: scan.files.length,
          bytes: scan.totalBytes,
          truncated: scan.truncated,
          ignored: scan.counts.ignored,
          binary: scan.counts.binary,
          oversized: scan.counts.oversized,
          languages: scan.languages,
        },
        toolchain: {
          ecosystem: toolchain.ecosystem,
          packageManager: toolchain.packageManager,
          build: formatCommand(toolchain.build),
          test: formatCommand(toolchain.test),
          lint: formatCommand(toolchain.lint),
          typecheck: formatCommand(toolchain.typecheck),
          ci: toolchain.ci,
          manifests: toolchain.manifests,
        },
      },
      report: { fields, ...(notes.length > 0 ? { notes } : {}) },
      exitCode,
    });
  },
};
