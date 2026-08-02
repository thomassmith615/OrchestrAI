/**
 * `orch history` shows what has been done: completed milestones and the runs
 * that produced them.
 *
 * Distinct from `orch memory`, which holds why things are the way they are.
 * History is the log; memory is the reasoning.
 */
import { listRuns, loadRoadmap } from "../../workflow/index.js";
import { readMemory, readUsage, totalUsage } from "../../memory/index.js";
import { formatCost } from "../../providers/index.js";
import { attempt, requireConfig, requireWorkspace } from "../command.js";
import type { WorkflowRun } from "../../workflow/index.js";
import type { CommandContext, CommandDefinition, CommandResult, FieldStatus, ReportField } from "../command.js";

export interface HistoryData {
  readonly completed: readonly { readonly id: string; readonly title: string }[];
  readonly runs: readonly WorkflowRun[];
  readonly memoryRecords: number;
  readonly usage: ReturnType<typeof totalUsage>;
}

function relativeAge(now: number, then: number): string {
  const minutes = Math.max(0, Math.round((now - then) / 60000));

  if (minutes < 90) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 36) {
    return `${String(hours)}h ago`;
  }
  return `${String(Math.round(hours / 24))}d ago`;
}

const RUN_STATUS: Readonly<Record<string, FieldStatus>> = {
  ok: "pass",
  failed: "fail",
  skipped: "info",
};

export const historyCommand: CommandDefinition<HistoryData> = {
  name: "history",
  summary: "Display engineering history and completed milestones",
  options: [
    { flags: "--limit <count>", description: "How many runs to show (default 10)" },
    { flags: "--runs", description: "Show only the run log" },
  ],
  requires: { config: true, initialized: true },

  execute(context: CommandContext): Promise<CommandResult<HistoryData>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const config = requireConfig(context);

      const roadmap = loadRoadmap(
        context.hosts.fs,
        workspace.root,
        config.values.roadmapPath,
      );
      const completed = roadmap.milestones
        .filter((milestone) => milestone.complete)
        .map((milestone) => ({ id: milestone.id, title: milestone.title }));

      const limitOption = context.options["limit"];
      const limit =
        typeof limitOption === "string" ? Number.parseInt(limitOption, 10) : 10;

      const runs = listRuns(context.hosts.fs, workspace.stateDir).slice(
        0,
        Number.isNaN(limit) ? 10 : limit,
      );
      const memoryRecords = readMemory(
        context.hosts.fs,
        workspace.stateDir,
      ).records.length;
      const usage = totalUsage(readUsage(context.hosts.fs, workspace.stateDir));

      const now = context.hosts.clock.now();
      const onlyRuns = context.options["runs"] === true;

      const fields: ReportField[] = [
        {
          label: "Completed",
          value: `${String(completed.length)} of ${String(roadmap.total)} milestones`,
        },
        { label: "Runs", value: runs.length },
        { label: "Memory", value: `${String(memoryRecords)} records` },
        {
          label: "Spend",
          value: `${String(usage.calls)} calls, ${String(
            usage.inputTokens + usage.outputTokens,
          )} tokens, ${formatCost(usage.costUsd)}${
            usage.unpriced === 0
              ? ""
              : ` (${String(usage.unpriced)} unpriced)`
          }`,
        },
        ...(onlyRuns
          ? []
          : completed.map(
              (milestone): ReportField => ({
                label: `M${milestone.id}`,
                value: milestone.title,
                status: "pass",
              }),
            )),
        ...runs.map(
          (run): ReportField => ({
            label: run.id,
            value: `${run.milestoneTitle ?? "no milestone"}  ${
              run.failedAt === null ? "" : `stopped at ${run.failedAt}  `
            }${relativeAge(now, run.startedAt)}`,
            status: RUN_STATUS[run.status] ?? "info",
          }),
        ),
      ];

      return {
        data: { completed, runs, memoryRecords, usage },
        report: {
          fields,
          ...(runs.length === 0 ? { notes: ["No runs recorded yet."] } : {}),
        },
      };
    });
  },
};
