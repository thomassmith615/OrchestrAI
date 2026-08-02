/**
 * `orch next` determines the next milestone and prepares the work.
 *
 * It ends at a plan, on purpose. The design is the cheapest thing to argue
 * with, and reading it before any code exists is what keeps a human in the
 * loop rather than reviewing a fait accompli.
 */
import { detectToolchain } from "../../repo/index.js";
import {
  PREPARE_WORKFLOW,
  executeWorkflow,
  findMilestone,
  listRuns,
  loadRoadmap,
  nextRunId,
  recordRun,
} from "../../workflow/index.js";
import { EXIT_CODES } from "../../core/errors.js";
import { aiPort } from "../ai.js";
import { requireConfig, requireWorkspace } from "../command.js";
import { stepFields } from "./milestone.js";
import type { Milestone, WorkflowRun } from "../../workflow/index.js";
import type { ExitCode } from "../../core/errors.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

export interface NextData {
  readonly milestone: Milestone | null;
  readonly plan: string | null;
  readonly run: WorkflowRun;
  readonly remaining: number;
}

export const nextCommand: CommandDefinition<NextData> = {
  name: "next",
  summary: "Determine the next milestone and prepare the engineering workflow",
  options: [
    { flags: "--id <id>", description: "Target a specific milestone" },
    { flags: "--dry-run", description: "List the stages without running them" },
    { flags: "--max-tokens <count>", description: "Response budget per call" },
  ],
  requires: { repository: true, config: true, initialized: true },

  async execute(context: CommandContext): Promise<CommandResult<NextData>> {
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

    const maxTokensOption = context.options["maxTokens"];
    const maxTokens =
      typeof maxTokensOption === "string"
        ? Number.parseInt(maxTokensOption, 10)
        : undefined;

    const dryRun = context.options["dryRun"] === true;

    const outcome = await executeWorkflow({
      steps: PREPARE_WORKFLOW,
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
        apply: false,
        ai: aiPort(
          context,
          maxTokens === undefined || Number.isNaN(maxTokens)
            ? {}
            : { maxTokens },
        ),
      },
    });

    const { run } = outcome;

    if (!dryRun) {
      recordRun(context.hosts.fs, workspace.stateDir, run);
    }

    const plan = (outcome.data.get("plan") as string | undefined) ?? null;
    const remaining = roadmap.total - roadmap.completed;

    const exitCode: ExitCode =
      run.status === "failed" ? EXIT_CODES.validation : EXIT_CODES.success;

    return {
      data: { milestone, plan, run, remaining },
      report: {
        fields: [
          {
            label: "Milestone",
            value:
              milestone === null
                ? "none pending"
                : `M${milestone.id}: ${milestone.title}`,
          },
          { label: "Remaining", value: remaining },
          { label: "Run", value: run.id },
          ...stepFields(run),
        ],
        notes: [
          ...(run.failedAt === null ? [] : [`Stopped at \`${run.failedAt}\`.`]),
          ...(plan === null ? [] : ["", plan]),
        ],
      },
      exitCode,
    };
  },
};
