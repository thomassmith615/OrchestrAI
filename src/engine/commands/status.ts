/**
 * `orch status` is the one-screen answer to "what is this repository and can
 * Orchestrai work with it".
 *
 * Milestone 5 adds branch information and the build, test, lint, and typecheck
 * verdicts. This milestone reports what was detected, not whether it passes.
 */
import { detectToolchain, formatCommand, scanRepository } from "../../repo/index.js";
import { findProvider } from "../../providers/index.js";
import { requireConfig, requireWorkspace } from "../command.js";
import type { ScanSummary, Toolchain } from "../../repo/index.js";
import type { CommandContext, CommandDefinition, CommandResult, ReportField } from "../command.js";

export interface StatusData {
  readonly repository: string;
  readonly initialized: boolean;
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

    const limitOption = context.options["languages"];
    const limit =
      typeof limitOption === "string" ? Number.parseInt(limitOption, 10) : 4;

    const fields: ReportField[] = [
      { label: "Repository", value: workspace.root },
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
    ];

    const notes: string[] = [];
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
    });
  },
};
