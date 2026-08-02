/**
 * `orch milestone` executes the workflow for the current milestone.
 *
 * At this milestone the pipeline contains the stages that need no model:
 * understand, analyze, preflight, baseline, verify, summarize. Milestone 9
 * splices design and implement into the same pipeline and exposes it as
 * `orch next`.
 */
import { detectToolchain } from "../../repo/index.js";
import {
  BUILTIN_WORKFLOW,
  executeWorkflow,
  findMilestone,
  listRuns,
  loadRoadmap,
  nextRunId,
  recordRun,
} from "../../workflow/index.js";
import { EXIT_CODES } from "../../core/errors.js";
import { requireConfig, requireWorkspace } from "../command.js";
import type { Milestone, WorkflowRun } from "../../workflow/index.js";
import type { ExitCode } from "../../core/errors.js";
import type { CommandContext, CommandDefinition, CommandResult, FieldStatus, ReportField } from "../command.js";

export interface MilestoneData {
  readonly milestone: Milestone | null;
  readonly run: WorkflowRun;
  readonly recorded: boolean;
}

const STEP_STATUS: Readonly<Record<string, FieldStatus>> = {
  ok: "pass",
  failed: "fail",
  skipped: "info",
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${String(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function stepFields(run: WorkflowRun): ReportField[] {
  return run.steps.map((step) => ({
    label: step.name,
    value:
      step.status === "skipped"
        ? step.detail
        : `${step.detail} (${formatDuration(step.durationMs)})`,
    status: STEP_STATUS[step.status] ?? "info",
  }));
}

export const milestoneCommand: CommandDefinition<MilestoneData> = {
  name: "milestone",
  summary: "Execute the workflow for the current milestone",
  options: [
    { flags: "--id <id>", description: "Target a specific milestone" },
    { flags: "--dry-run", description: "List the stages without running them" },
  ],
  requires: { repository: true, config: true, initialized: true },

  async execute(context: CommandContext): Promise<CommandResult<MilestoneData>> {
    const workspace = requireWorkspace(context);
    const config = requireConfig(context);

    const roadmap = loadRoadmap(
      context.hosts.fs,
      workspace.root,
      config.values.roadmapPath,
    );

    const idOption = context.options["id"];
    const milestone =
      typeof idOption === "string"
        ? (findMilestone(roadmap, idOption) ?? null)
        : roadmap.current;

    const dryRun = context.options["dryRun"] === true;

    const run = await executeWorkflow({
      steps: BUILTIN_WORKFLOW,
      dryRun,
      runId: nextRunId(
        context.hosts.clock.now(),
        listRuns(context.hosts.fs, workspace.stateDir).map((entry) => entry.id),
      ),
      context: {
        root: workspace.root,
        stateDir: workspace.stateDir,
        hosts: context.hosts,
        logger: context.logger,
        toolchain: detectToolchain(context.hosts.fs, workspace.root),
        milestone,
      },
    });

    const recorded = dryRun
      ? false
      : recordRun(context.hosts.fs, workspace.stateDir, run);

    const exitCode: ExitCode =
      run.status === "failed" ? EXIT_CODES.validation : EXIT_CODES.success;

    const notes: string[] = [];
    if (run.failedAt !== null) {
      notes.push(`Stopped at \`${run.failedAt}\`.`);
    }
    if (dryRun) {
      notes.push("Dry run: nothing was executed or recorded.");
    }

    return {
      data: { milestone, run, recorded },
      report: {
        fields: [
          {
            label: "Milestone",
            value:
              milestone === null
                ? "none pending"
                : `M${milestone.id}: ${milestone.title}`,
          },
          { label: "Run", value: run.id },
          ...stepFields(run),
        ],
        ...(notes.length > 0 ? { notes } : {}),
      },
      exitCode,
    };
  },
};
