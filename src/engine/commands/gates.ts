/**
 * `orch build` and `orch test`.
 *
 * Both are thin wrappers over the same gate runner. `build` produces an
 * artifact; `test` runs every configured validation gate, which is the
 * charter's Definition of Done minus the build step.
 *
 * A failing gate exits 3, which is what separates "the repository failed" from
 * "the tool broke".
 */
import { detectToolchain } from "../../repo/index.js";
import { readGateRun, recordGateRun, runGates, VALIDATION_GATES } from "../../gates/index.js";
import { EXIT_CODES } from "../../core/errors.js";
import { requireWorkspace } from "../command.js";
import type { GateName, GateResult, GateRun } from "../../gates/index.js";
import type { ExitCode } from "../../core/errors.js";
import type { CommandContext, CommandDefinition, CommandResult, FieldStatus, ReportField } from "../command.js";

export interface GateCommandData {
  readonly run: GateRun;
  readonly recorded: boolean;
}

const STATUS_MAP: Readonly<Record<GateResult["status"], FieldStatus>> = {
  pass: "pass",
  fail: "fail",
  skipped: "info",
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${String(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function gateFields(run: GateRun): ReportField[] {
  return run.results.map((result) => ({
    label: result.name,
    value:
      result.status === "skipped"
        ? "no command configured"
        : `${result.command ?? ""} (${formatDuration(result.durationMs)})${
            result.timedOut ? " timed out" : ""
          }`,
    status: STATUS_MAP[result.status],
  }));
}

/**
 * Merges a fresh run into whatever was recorded before, so that running only
 * `orch build` does not erase the last test verdict.
 */
function mergeWithPrevious(
  previous: GateRun | null,
  fresh: GateRun,
): GateRun {
  if (previous === null) {
    return fresh;
  }

  const byName = new Map<GateName, GateResult>();
  for (const result of previous.results) {
    byName.set(result.name, result);
  }
  for (const result of fresh.results) {
    byName.set(result.name, result);
  }

  const results = [...byName.values()];

  return {
    startedAt: fresh.startedAt,
    durationMs: fresh.durationMs,
    results,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    ok: results.every((result) => result.status !== "fail"),
  };
}

function execute(
  context: CommandContext,
  gates: readonly GateName[],
): Promise<CommandResult<GateCommandData>> {
  const workspace = requireWorkspace(context);
  const toolchain = detectToolchain(context.hosts.fs, workspace.root);

  const timeoutOption = context.options["timeout"];
  const timeoutMs =
    typeof timeoutOption === "string"
      ? Number.parseInt(timeoutOption, 10) * 1000
      : undefined;

  const run = runGates({
    root: workspace.root,
    toolchain,
    proc: context.hosts.proc,
    clock: context.hosts.clock,
    gates,
    ...(timeoutMs === undefined || Number.isNaN(timeoutMs) ? {} : { timeoutMs }),
    onStart: (name, command) => {
      context.logger.debug(`${name}: ${command}`);
    },
  });

  const recorded = recordGateRun(
    context.hosts.fs,
    workspace.stateDir,
    mergeWithPrevious(readGateRun(context.hosts.fs, workspace.stateDir), run),
  );

  const notes: string[] = [];
  let exitCode: ExitCode = EXIT_CODES.success;

  if (run.failed > 0) {
    exitCode = EXIT_CODES.validation;
    for (const result of run.results) {
      if (result.status === "fail" && result.output.length > 0) {
        notes.push(`--- ${result.name} ---`, result.output);
      }
    }
    notes.push(`${String(run.failed)} of ${String(run.results.length)} gates failed.`);
  } else if (run.results.every((result) => result.status === "skipped")) {
    // Asking for validation and getting none is a setup problem, not a pass.
    exitCode = EXIT_CODES.precondition;
    notes.push(
      "No commands configured for these gates. Run `orch status` to see what was detected.",
    );
  } else {
    const ran = run.results.length - run.skipped;
    notes.push(
      `${String(ran)} gates passed in ${formatDuration(run.durationMs)}.`,
    );
  }

  if (!recorded) {
    notes.push("Results not recorded: run `orch init` to enable tracking.");
  }

  return Promise.resolve({
    data: { run, recorded },
    report: { fields: gateFields(run), notes },
    exitCode,
  });
}

const TIMEOUT_OPTION = {
  flags: "--timeout <seconds>",
  description: "Kill a gate after this many seconds (default 600)",
};

export const buildCommand: CommandDefinition<GateCommandData> = {
  name: "build",
  summary: "Execute the configured build pipeline",
  options: [TIMEOUT_OPTION],
  requires: { repository: true, config: true },
  execute: (context) => execute(context, ["build"]),
};

export const testCommand: CommandDefinition<GateCommandData> = {
  name: "test",
  summary: "Execute all configured validation (typecheck, lint, test)",
  options: [
    TIMEOUT_OPTION,
    { flags: "--all", description: "Include the build gate" },
  ],
  requires: { repository: true, config: true },
  execute: (context) =>
    execute(
      context,
      context.options["all"] === true
        ? ["build", ...VALIDATION_GATES]
        : VALIDATION_GATES,
    ),
};
