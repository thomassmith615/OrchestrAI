/**
 * `orch roadmap` shows the milestone progression the project is following.
 *
 * The roadmap file stays the source of truth. Orchestraᵢ reads it; a human
 * edits it. Making the tool the owner of that file would make the plan
 * something you query instead of something you read.
 */
import { describeProgress, loadRoadmap } from "../../workflow/index.js";
import { attempt, requireConfig, requireWorkspace } from "../command.js";
import type { Milestone, Roadmap } from "../../workflow/index.js";
import type { CommandContext, CommandDefinition, CommandResult, ReportField } from "../command.js";

export interface RoadmapData {
  readonly path: string;
  readonly completed: number;
  readonly total: number;
  readonly current: Milestone | null;
  readonly milestones: readonly Milestone[];
}

function milestoneFields(
  roadmap: Roadmap,
  showAll: boolean,
): readonly ReportField[] {
  const shown = showAll
    ? roadmap.milestones
    : roadmap.milestones.filter(
        (milestone) => !milestone.complete || milestone === roadmap.current,
      );

  return shown.map((milestone) => ({
    label: `M${milestone.id}`,
    value: milestone === roadmap.current
      ? `${milestone.title}  <- current`
      : milestone.title,
    status: milestone.complete ? "pass" : "info",
  }));
}

export const roadmapCommand: CommandDefinition<RoadmapData> = {
  name: "roadmap",
  summary: "Display the roadmap and milestone progression",
  options: [
    { flags: "--all", description: "Include completed milestones" },
  ],
  requires: { config: true },

  execute(context: CommandContext): Promise<CommandResult<RoadmapData>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const config = requireConfig(context);

      const roadmap = loadRoadmap(
        context.hosts.fs,
        workspace.root,
        config.values.roadmapPath,
      );

      const notes: string[] = [];
      if (roadmap.total === 0) {
        notes.push(`No milestones found in ${roadmap.path}.`);
      } else if (roadmap.current === null) {
        notes.push("Every milestone is complete.");
      }

      return {
        data: {
          path: roadmap.path,
          completed: roadmap.completed,
          total: roadmap.total,
          current: roadmap.current,
          milestones: roadmap.milestones,
        },
        report: {
          fields: [
            { label: "Roadmap", value: roadmap.path },
            { label: "Progress", value: describeProgress(roadmap) },
            ...milestoneFields(roadmap, context.options["all"] === true),
          ],
          ...(notes.length > 0 ? { notes } : {}),
        },
      };
    });
  },
};
